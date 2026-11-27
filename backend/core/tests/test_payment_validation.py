"""Server-side validation and allocation of payments (POST /api/payments/).

A payment may never exceed what it pays for: the sale's balance when a sale is named,
otherwise what the customer owes. Rejected requests change nothing (whole-database
fingerprint). Concurrent payments are serialised by locking the customer first.
"""
import unittest
from decimal import Decimal

from django.db import connection
from django.test import TransactionTestCase

from core import integrity
from core.models import ActivityLog, CustomerProfile, CylinderType, Payment, Role, Sale, SaleItem, StockLocation, User

from .base import GasBookTestCase
from .concurrency import holding_lock, run_concurrently


def credit_sale(customer, location, cylinder, sold_by, total="900.00"):
    sale = Sale.objects.create(customer=customer, location=location, total_amount=Decimal(total), paid_amount=0,
                               balance_due=Decimal(total), payment_mode=Sale.PaymentMode.CREDIT, sold_by=sold_by)
    SaleItem.objects.create(sale=sale, cylinder_type=cylinder, quantity=1, rate=Decimal(total), total_amount=Decimal(total))
    return sale


class PaymentValidationTests(GasBookTestCase):
    def setUp(self):
        super().setUp()
        self.first = credit_sale(self.customer, self.shop, self.cylinder, self.admin)
        self.second = credit_sale(self.customer, self.shop, self.cylinder, self.admin)
        other_user = User.objects.create_user(username="cust2", password="x", role=self.customer_role, phone="9000000005")
        self.other = CustomerProfile.objects.create(user=other_user)
        self.others_sale = credit_sale(self.other, self.shop, self.cylinder, self.admin)
        self.auth(self.admin)

    def pay(self, amount, mode="cash", **extra):
        return self.client.post("/api/payments/", {"customer": self.customer.id, "amount": amount, "payment_mode": mode, **extra},
                                format="json")

    def assert_rejected(self, response_factory, code=None, field=None):
        before = integrity.fingerprint()
        response = response_factory()
        self.assertEqual(response.status_code, 400, response.data)
        if code:
            self.assertEqual(response.data["code"], code, response.data)
        if field:
            self.assertTrue(response.data.get("field") == field or field in response.data, response.data)
        self.assertEqual(integrity.compare_fingerprints(before, integrity.fingerprint()), [])
        return response

    def refresh(self):
        for sale in (self.first, self.second):
            sale.refresh_from_db()

    def test_amount_must_be_a_positive_money_value(self):
        for amount in (0, "-5", "abc", "1.234", "1000000000", None):
            with self.subTest(amount=amount):
                self.assert_rejected(lambda: self.pay(amount), field="amount")

    def test_mode_must_be_cash_gpay_or_bank(self):
        response = self.client.post("/api/payments/", {"customer": self.customer.id, "amount": "10"}, format="json")
        self.assertEqual(response.status_code, 400, response.data)
        for mode in ("credit", "split", "bitcoin"):
            with self.subTest(mode=mode):
                self.assert_rejected(lambda: self.pay("10", mode), field="payment_mode")

    def test_sale_must_belong_to_the_customer(self):
        self.assert_rejected(lambda: self.pay("10", sale=self.others_sale.id), "sale_customer_mismatch", "sale")

    def test_a_sale_payment_cannot_exceed_that_sales_balance(self):
        self.assert_rejected(lambda: self.pay("900.01", sale=self.first.id), "exceeds_balance", "amount")
        self.assertEqual(self.pay("900", sale=self.first.id).status_code, 201)
        self.refresh()
        self.assertEqual((self.first.paid_amount, self.first.balance_due), (Decimal("900.00"), Decimal("0.00")))
        self.assert_rejected(lambda: self.pay("1", sale=self.first.id), "exceeds_balance")
        self.assertEqual(integrity.violations(), [])

    def test_a_payment_cannot_exceed_what_the_customer_owes(self):
        self.assert_rejected(lambda: self.pay("1800.01"), "exceeds_balance", "amount")
        self.assertEqual(self.pay("1800").status_code, 201)
        self.assert_rejected(lambda: self.pay("1"), "exceeds_balance")
        self.assertEqual(integrity.customer_balances()[self.customer.id]["pending"], "0.00")

    def test_settles_oldest_sales_first_then_the_opening_balance(self):
        self.customer.opening_balance = Decimal("200.00")
        self.customer.save(update_fields=["opening_balance"])

        response = self.pay("1000", mode="gpay", note="Balance clearance")
        self.assertEqual(response.status_code, 201, response.data)
        self.refresh()
        self.assertEqual((self.first.balance_due, self.second.balance_due), (Decimal("0.00"), Decimal("800.00")))
        log = ActivityLog.objects.get(action="payment_received").metadata
        self.assertEqual(log["allocations"], [{"sale_id": self.first.id, "amount": "900.00"}, {"sale_id": self.second.id, "amount": "100.00"}])
        self.assertEqual(log["unallocated"], "0.00")

        self.assertEqual(self.pay("1000").status_code, 201)
        self.refresh()
        self.assertEqual(self.second.balance_due, Decimal("0.00"))
        unallocated = Payment.objects.get(customer=self.customer, sale__isnull=True)
        self.assertEqual((unallocated.amount, unallocated.payment_mode), (Decimal("200.00"), "cash"))
        self.assertEqual(integrity.customer_balances()[self.customer.id]["pending"], "0.00")
        self.assertEqual(integrity.violations(), [])

    def test_deactivated_customers_can_still_settle_their_dues(self):
        self.customer.is_active = False
        self.customer.save(update_fields=["is_active"])
        self.assertEqual(self.pay("100").status_code, 201)

    def test_receiver_cannot_be_sent(self):
        response = self.assert_rejected(lambda: self.pay("10", received_by=self.staff_a.id), "read_only_fields")
        self.assertEqual(response.data["fields"], ["received_by"])

    def test_bodies_that_are_not_objects_are_400(self):
        for body in ([{"customer": self.customer.id}], "x"):
            with self.subTest(body=body):
                self.assert_rejected(lambda: self.client.post("/api/payments/", body, format="json"))


@unittest.skipUnless(connection.vendor == "postgresql", "row locks are tested on PostgreSQL")
class PaymentConcurrencyTests(TransactionTestCase):
    """Two payments at the same moment, the first holding the customer lock for a while.
    Without the lock both would read the same balance and both would be accepted."""

    def setUp(self):
        admin_role = Role.objects.create(name="Admin", code="admin")
        customer_role = Role.objects.create(name="Customer", code="customer")
        self.admin = User.objects.create_user(username="p-admin", password="x", role=admin_role)
        self.customer = CustomerProfile.objects.create(user=User.objects.create_user(username="p-cust", password="x", role=customer_role))
        shop = StockLocation.objects.create(name="Shop", code="shop")
        cylinder = CylinderType.objects.create(name="14kg", weight=Decimal("14.2"), selling_price=Decimal("900"))
        self.first = credit_sale(self.customer, shop, cylinder, self.admin)
        self.second = credit_sale(self.customer, shop, cylinder, self.admin)

    def payment(self, amount, **extra):
        return (self.admin, "/api/payments/", {"customer": self.customer.id, "amount": amount, "payment_mode": "cash", **extra})

    def assert_one_accepted(self, results):
        self.assertEqual(sorted(status for status, _ in results), [201, 400], results)
        self.assertEqual(next(data for status, data in results if status == 400)["code"], "exceeds_balance")
        self.assertEqual(integrity.violations(), [])

    def test_two_payments_cannot_spend_the_same_sale_balance(self):
        with holding_lock("core.services.lock_customer"):
            results = run_concurrently([self.payment("600", sale=self.first.id), self.payment("600", sale=self.first.id)])
        self.assert_one_accepted(results)
        self.first.refresh_from_db()
        self.assertEqual((self.first.paid_amount, self.first.balance_due), (Decimal("600.00"), Decimal("300.00")))

    def test_two_payments_cannot_spend_the_same_outstanding_amount(self):
        with holding_lock("core.services.lock_customer"):
            results = run_concurrently([self.payment("1000"), self.payment("1000")])
        self.assert_one_accepted(results)
        self.assertEqual(integrity.customer_balances()[self.customer.id]["pending"], "800.00")
