"""One atomic, idempotent request per sale (POST /api/sales/).

- client_ref: a retry of the same request returns the original sale and writes nothing;
  any other use of the key is refused (409).
- new_customer: a customer can be registered with the sale; a phone number already used by a
  customer is refused and that customer is named, never merged.
- past_due_payments: money for the customer's older dues, settled oldest first before the new
  sale exists, capped by what the customer owed before it.
- A failure at any write stage leaves nothing behind (whole-database fingerprint).
"""
import unittest
import uuid
from decimal import Decimal
from unittest import mock

from django.db import connection
from django.test import TransactionTestCase

from core import integrity
from core.models import (
    ActivityLog, CustomerProfile, CylinderType, Notification, Payment, Role, Sale, SaleItem, Stock, StockLocation, User,
)

from .base import GasBookTestCase
from .concurrency import holding_lock, run_concurrently


def credit_sale(customer, location, cylinder, sold_by, total):
    sale = Sale.objects.create(customer=customer, location=location, total_amount=Decimal(total), paid_amount=0,
                               balance_due=Decimal(total), payment_mode=Sale.PaymentMode.CREDIT, sold_by=sold_by)
    SaleItem.objects.create(sale=sale, cylinder_type=cylinder, quantity=1, rate=Decimal(total), total_amount=Decimal(total))
    return sale


class SaleRequestMixin:
    def payload(self, **overrides):
        body = {
            "client_ref": str(uuid.uuid4()),
            "customer": self.customer.id,
            "location": self.shop.id,
            "payment_mode": "cash",
            "sale_items": [{"cylinder_type": self.cylinder.id, "quantity": 1, "rate": "900", "empty_returned": 0}],
        }
        body.update(overrides)
        return body

    def new_customer_payload(self, phone="9555555555", **overrides):
        body = self.payload(**overrides)
        del body["customer"]
        body["new_customer"] = {"name": "New Person", "phone": phone, "address": "1 Lake Road"}
        return body

    def post(self, body):
        return self.client.post("/api/sales/", body, format="json")

    def assert_unchanged(self, before):
        self.assertEqual(integrity.compare_fingerprints(before, integrity.fingerprint()), [])


class IdempotencyTests(SaleRequestMixin, GasBookTestCase):
    def setUp(self):
        super().setUp()
        self.set_stock(self.shop, filled=20)
        self.auth(self.admin)

    def test_client_ref_is_required_and_must_be_a_uuid(self):
        before = integrity.fingerprint()
        body = self.payload()
        del body["client_ref"]
        response = self.post(body)
        self.assertEqual((response.status_code, response.data["code"], response.data["field"]), (400, "required", "client_ref"))
        for bad in ("abc", 123, "1234-not-a-uuid"):
            response = self.post(self.payload(client_ref=bad))
            self.assertEqual((response.status_code, response.data["code"]), (400, "invalid"), bad)
        self.assert_unchanged(before)

    def test_a_retry_returns_the_original_sale_and_writes_nothing(self):
        body = self.payload()
        first = self.post(body)
        self.assertEqual(first.status_code, 201, first.data)
        before = integrity.fingerprint()
        retry = self.post(body)
        self.assertEqual((retry.status_code, retry.data["id"], retry["Idempotent-Replay"]), (200, first.data["id"], "true"))
        self.assertEqual(retry.data, first.data)
        self.assert_unchanged(before)

    def test_a_retry_after_stock_ran_out_still_returns_the_original(self):
        self.set_stock(self.shop, filled=1)
        body = self.payload()
        first = self.post(body)
        self.assertEqual(first.status_code, 201, first.data)
        retry = self.post(body)
        self.assertEqual((retry.status_code, retry.data["id"]), (200, first.data["id"]))

    def test_reusing_a_key_for_a_different_request_is_refused(self):
        body = self.payload()
        self.assertEqual(self.post(body).status_code, 201)
        before = integrity.fingerprint()
        response = self.post({**body, "sale_items": [{**body["sale_items"][0], "quantity": 2}]})
        self.assertEqual((response.status_code, response.data["code"]), (409, "client_ref_reused"))
        self.assert_unchanged(before)

    def test_another_user_cannot_replay_or_reuse_a_key(self):
        body = self.payload()
        self.assertEqual(self.post(body).status_code, 201)
        other_admin = User.objects.create_user(username="admin2", password="x", role=self.admin_role)
        self.auth(other_admin)
        before = integrity.fingerprint()
        response = self.post(body)
        self.assertEqual((response.status_code, response.data["code"]), (409, "client_ref_reused"))
        self.assert_unchanged(before)

    def test_a_key_whose_attempt_failed_can_be_used_again(self):
        body = self.payload(sale_items=[{"cylinder_type": self.cylinder.id, "quantity": 999, "rate": "900"}])
        self.assertEqual(self.post(body).data["code"], "insufficient_stock")
        response = self.post({**body, "sale_items": [{"cylinder_type": self.cylinder.id, "quantity": 1, "rate": "900"}]})
        self.assertEqual(response.status_code, 201, response.data)

    def test_retrying_a_new_customer_sale_creates_the_customer_once(self):
        body = self.new_customer_payload()
        first = self.post(body)
        self.assertEqual(first.status_code, 201, first.data)
        retry = self.post(body)
        self.assertEqual((retry.status_code, retry.data["customer"]), (200, first.data["customer"]))
        self.assertEqual(User.objects.filter(phone="9555555555").count(), 1)


class NewCustomerTests(SaleRequestMixin, GasBookTestCase):
    def setUp(self):
        super().setUp()
        self.set_stock(self.shop, filled=20)
        self.auth(self.admin)

    def test_a_customer_can_be_registered_with_the_sale(self):
        response = self.post(self.new_customer_payload())
        self.assertEqual(response.status_code, 201, response.data)
        profile = CustomerProfile.objects.get(pk=response.data["customer"])
        user = profile.user
        self.assertEqual((user.first_name, user.last_name, user.phone, user.address, user.role.code, user.must_change_password),
                         ("New", "Person", "9555555555", "1 Lake Road", "customer", True))
        self.assertFalse(user.has_usable_password())
        self.assertEqual(ActivityLog.objects.get(action="customer_created").metadata["via"], "sale")
        self.assertTrue(ActivityLog.objects.get(action="sale_created").metadata["new_customer"])
        self.assertEqual(integrity.violations(), [])

    def test_a_phone_already_used_by_a_customer_is_refused_and_named(self):
        before = integrity.fingerprint()
        response = self.post(self.new_customer_payload(phone=self.customer_user.phone))
        self.assertEqual((response.status_code, response.data["code"], response.data["field"]), (400, "duplicate_phone", "phone"))
        self.assertEqual(response.data["existing_customer"],
                         {"id": self.customer.id, "name": "Cust One", "phone": self.customer_user.phone})
        self.assertIn("already in the system", response.data["phone"][0])  # the admin UI shows body.phone
        self.assert_unchanged(before)

    def test_exactly_one_of_customer_or_new_customer(self):
        before = integrity.fingerprint()
        both = self.new_customer_payload()
        both["customer"] = self.customer.id
        self.assertEqual(self.post(both).data["code"], "invalid")
        neither = self.payload()
        del neither["customer"]
        self.assertEqual(self.post(neither).data["code"], "required")
        self.assertEqual(self.post(self.payload(customer=None)).data["code"], "required")
        self.assert_unchanged(before)

    def test_new_customer_contact_formats(self):
        before = integrity.fingerprint()
        cases = [
            {"name": "Ok Name", "phone": "98ab"},
            {"name": "Ok Name"},
            {"phone": "9666666666"},
            {"name": "Z" * 400, "phone": "9666666666"},
            {"name": "Ok Name", "phone": "9" * 21},
        ]
        for new_customer in cases:
            with self.subTest(new_customer=new_customer):
                body = self.new_customer_payload()
                body["new_customer"] = new_customer
                self.assertEqual(self.post(body).status_code, 400)
        self.assert_unchanged(before)

    def test_customers_endpoint_requires_a_phone_and_logs_creation(self):
        response = self.client.post("/api/customers/", {"name": "No Phone"}, format="json")
        self.assertEqual((response.status_code, response.data["code"], response.data["field"]), (400, "required", "phone"))
        response = self.client.post("/api/customers/", {"name": "Has Phone", "phone": "9777777771"}, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(ActivityLog.objects.get(action="customer_created").metadata["via"], "customers")

    def test_register_refuses_a_duplicate_customer_phone(self):
        response = self.client.post("/api/auth/register/", {
            "username": "dupcust", "full_name": "Dup Cust", "phone": self.customer_user.phone, "role": "customer",
        }, format="json")
        self.assertEqual((response.status_code, response.data["code"]), (400, "duplicate_phone"))
        self.assertFalse(User.objects.filter(username="dupcust").exists())


class RollbackTests(SaleRequestMixin, GasBookTestCase):
    """A failure at any stage of a sale leaves no trace: no customer, past-due payment,
    sale, line, payment, stock change, log or notification."""

    def setUp(self):
        super().setUp()
        self.set_stock(self.shop, filled=20)
        credit_sale(self.customer, self.shop, self.cylinder, self.admin, "900.00")
        self.auth(self.admin)
        self.client.raise_request_exception = False

    def bodies(self, attempt):
        return {
            "existing customer + past dues": self.payload(payment_mode="credit", paid_amount="0",
                                                          past_due_payments=[{"mode": "cash", "amount": "500"}]),
            # A fresh phone each time: the retry after each failure registers the customer.
            "new customer": self.new_customer_payload(phone=f"95555{attempt:05d}"),
        }

    def failing(self, stage):
        if stage == "stock":
            return mock.patch("core.serializers.lock_sale_stock", side_effect=RuntimeError(stage))
        if stage == "sale line":
            return mock.patch.object(SaleItem.objects, "create", side_effect=RuntimeError(stage))
        if stage == "notification":
            return mock.patch("core.serializers.notify", side_effect=RuntimeError(stage))
        manager, matches = {
            "sale payment": (Payment.objects, lambda kwargs: kwargs.get("note", "").startswith("Sale payment")),
            "activity log": (ActivityLog.objects, lambda kwargs: kwargs.get("action") == "sale_created"),
        }[stage]
        real = manager.create

        def create(**kwargs):
            if matches(kwargs):
                raise RuntimeError(stage)
            return real(**kwargs)

        return mock.patch.object(manager, "create", side_effect=create)

    def test_a_failure_at_any_write_stage_rolls_everything_back(self):
        for attempt, stage in enumerate(("stock", "sale line", "sale payment", "activity log", "notification")):
            for label, body in self.bodies(attempt).items():
                if stage == "sale payment" and body["payment_mode"] == "credit":
                    continue  # a credit sale with nothing paid creates no sale payment
                with self.subTest(stage=stage, request=label):
                    before = integrity.fingerprint()
                    with self.failing(stage):
                        response = self.post(body)
                    self.assertEqual(response.status_code, 500)
                    self.assert_unchanged(before)
                    # Nothing was kept, so the same key works once the failure is gone.
                    self.assertEqual(self.post(body).status_code, 201)

    def test_validation_failures_after_a_new_customer_leave_no_customer(self):
        before = integrity.fingerprint()
        short = self.new_customer_payload(sale_items=[{"cylinder_type": self.cylinder.id, "quantity": 999, "rate": "900"}])
        self.assertEqual(self.post(short).data["code"], "insufficient_stock")
        owes_nothing = self.new_customer_payload(payment_mode="credit", paid_amount="0",
                                                 past_due_payments=[{"mode": "cash", "amount": "1"}])
        self.assertEqual(self.post(owes_nothing).data["code"], "exceeds_balance")
        self.assert_unchanged(before)
        self.assertFalse(User.objects.filter(phone="9555555555").exists())


class PastDueTests(SaleRequestMixin, GasBookTestCase):
    """The customer owes 900 (oldest) and 500 from earlier sales."""

    def setUp(self):
        super().setUp()
        self.set_stock(self.shop, filled=20)
        self.oldest = credit_sale(self.customer, self.shop, self.cylinder, self.admin, "900.00")
        self.older = credit_sale(self.customer, self.shop, self.cylinder, self.admin, "500.00")
        self.auth(self.admin)

    def credit_sale_with(self, *parts, quantity=2):
        return self.payload(payment_mode="credit", paid_amount="0",
                            sale_items=[{"cylinder_type": self.cylinder.id, "quantity": quantity, "rate": "900"}],
                            past_due_payments=[{"mode": mode, "amount": amount} for mode, amount in parts])

    def balances(self):
        self.oldest.refresh_from_db()
        self.older.refresh_from_db()
        return self.oldest.balance_due, self.older.balance_due

    def test_collection_for_older_dues_leaves_the_new_sale_unpaid(self):
        response = self.post(self.credit_sale_with(("cash", "600")))
        self.assertEqual(response.status_code, 201, response.data)
        new_sale = Sale.objects.get(pk=response.data["id"])
        self.assertEqual((new_sale.total_amount, new_sale.paid_amount, new_sale.balance_due),
                         (Decimal("1800.00"), Decimal("0.00"), Decimal("1800.00")))
        self.assertFalse(new_sale.payments.exists())
        self.assertEqual(self.balances(), (Decimal("300.00"), Decimal("500.00")))
        past_due = Payment.objects.get(id__in=ActivityLog.objects.get(action="sale_created").metadata["past_due_payment_ids"])
        self.assertEqual((past_due.sale_id, past_due.amount, past_due.received_by), (self.oldest.id, Decimal("600.00"), self.admin))
        self.assertEqual(integrity.violations(), [])

    def test_older_sales_are_settled_oldest_first(self):
        self.assertEqual(self.post(self.credit_sale_with(("cash", "1100"))).status_code, 201)
        self.assertEqual(self.balances(), (Decimal("0.00"), Decimal("300.00")))

    def test_the_cap_is_what_was_owed_before_the_new_sale(self):
        before = integrity.fingerprint()
        response = self.post(self.credit_sale_with(("cash", "1400.01")))
        self.assertEqual((response.status_code, response.data["code"]), (400, "exceeds_balance"))
        self.assert_unchanged(before)
        response = self.post(self.credit_sale_with(("cash", "1400")))
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(self.balances(), (Decimal("0.00"), Decimal("0.00")))
        self.assertEqual(Sale.objects.get(pk=response.data["id"]).balance_due, Decimal("1800.00"))

    def test_what_is_left_after_older_sales_reduces_the_opening_balance(self):
        self.customer.opening_balance = Decimal("300.00")
        self.customer.save(update_fields=["opening_balance"])
        response = self.post(self.credit_sale_with(("bank", "1700")))
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(self.balances(), (Decimal("0.00"), Decimal("0.00")))
        self.assertEqual(Payment.objects.get(sale__isnull=True).amount, Decimal("300.00"))
        self.assertEqual(Sale.objects.get(pk=response.data["id"]).balance_due, Decimal("1800.00"))
        self.assertEqual(integrity.customer_balances()[self.customer.id]["pending"], "1800.00")

    def test_split_past_dues_keep_their_modes(self):
        response = self.post(self.credit_sale_with(("cash", "500"), ("gpay", "600")))
        self.assertEqual(response.status_code, 201, response.data)
        rows = sorted(Payment.objects.filter(sale__in=[self.oldest, self.older]).values_list("sale_id", "payment_mode", "amount"))
        self.assertEqual(rows, [(self.oldest.id, "cash", Decimal("500.00")), (self.oldest.id, "gpay", Decimal("400.00")),
                                (self.older.id, "gpay", Decimal("200.00"))])
        before = integrity.fingerprint()
        self.assertEqual(self.post(self.credit_sale_with(("cash", "1"), ("cash", "1"))).data["code"], "invalid_payment")
        self.assertEqual(self.post(self.credit_sale_with(("credit", "1"))).status_code, 400)
        self.assert_unchanged(before)

    def test_a_cash_sale_and_past_dues_in_one_request(self):
        response = self.post(self.payload(past_due_payments=[{"mode": "cash", "amount": "300"}]))
        self.assertEqual(response.status_code, 201, response.data)
        new_sale = Sale.objects.get(pk=response.data["id"])
        self.assertEqual(list(new_sale.payments.values_list("payment_mode", "amount", "note")),
                         [("cash", Decimal("900.00"), "Sale payment")])
        self.assertEqual(self.balances(), (Decimal("600.00"), Decimal("500.00")))
        self.assertEqual(integrity.violations(), [])


@unittest.skipUnless(connection.vendor == "postgresql", "locks are tested on PostgreSQL")
class ConcurrentRequestTests(TransactionTestCase):
    def setUp(self):
        admin_role = Role.objects.create(name="Admin", code="admin")
        self.customer_role = Role.objects.create(name="Customer", code="customer")
        self.admin = User.objects.create_user(username="a-admin", password="x", role=admin_role)
        self.customer = CustomerProfile.objects.create(
            user=User.objects.create_user(username="a-cust", password="x", role=self.customer_role)
        )
        self.shop = StockLocation.objects.create(name="Shop", code="shop")
        self.cylinder = CylinderType.objects.create(name="14kg", weight=Decimal("14.2"), selling_price=Decimal("900"))
        Stock.objects.create(cylinder_type=self.cylinder, location=self.shop, status=Stock.Status.FILLED, quantity=10)

    def sale(self, client_ref=None, **extra):
        return {"client_ref": client_ref or str(uuid.uuid4()), "location": self.shop.id, "payment_mode": "cash",
                "sale_items": [{"cylinder_type": self.cylinder.id, "quantity": 1, "rate": "900"}], **extra}

    def test_two_identical_requests_record_one_sale(self):
        body = self.sale(customer=self.customer.id)
        with holding_lock("core.views.advisory_lock"):
            results = run_concurrently([(self.admin, "/api/sales/", body), (self.admin, "/api/sales/", body)])
        self.assertEqual(sorted(status for status, _ in results), [200, 201], results)
        self.assertEqual(results[0][1]["id"], results[1][1]["id"])
        self.assertEqual((Sale.objects.count(), Payment.objects.count(), ActivityLog.objects.filter(action="sale_created").count(),
                          Notification.objects.filter(notification_type="DIRECT_SALE_COMPLETED").count()), (1, 1, 1, 1))
        self.assertEqual(Stock.objects.get(status=Stock.Status.FILLED).quantity, 9)
        self.assertEqual(integrity.violations(), [])

    def test_two_sales_registering_one_new_phone_create_one_customer(self):
        new_customer = {"name": "Same Phone", "phone": "9888888888"}
        with holding_lock("core.services.advisory_lock"):
            results = run_concurrently([
                (self.admin, "/api/sales/", self.sale(new_customer=new_customer)),
                (self.admin, "/api/sales/", self.sale(new_customer=new_customer)),
            ])
        self.assertEqual(sorted(status for status, _ in results), [201, 400], results)
        self.assertEqual(next(data for status, data in results if status == 400)["code"], "duplicate_phone")
        self.assertEqual((User.objects.filter(phone="9888888888").count(), Sale.objects.count()), (1, 1))

    def test_two_registrations_of_one_phone_create_one_customer(self):
        body = {"name": "Same Phone", "phone": "9888888889"}
        with holding_lock("core.services.advisory_lock"):
            results = run_concurrently([(self.admin, "/api/customers/", body), (self.admin, "/api/customers/", body)])
        self.assertEqual(sorted(status for status, _ in results), [201, 400], results)
        self.assertEqual(User.objects.filter(phone="9888888889").count(), 1)
