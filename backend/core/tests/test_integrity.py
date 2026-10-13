"""core.integrity and the check_sales_integrity command.

The checker is what proves later phases leave stock and money consistent and leave the
dev database untouched, so it is tested against both clean and deliberately broken data.
"""
import json
import os
import tempfile
import unittest
import uuid
from decimal import Decimal
from io import StringIO
from unittest import mock

from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import DatabaseError, connection, connections
from django.test import TransactionTestCase

from core import integrity
from core.models import (
    Booking, CustomerCylinderRate, CustomerProfile, CylinderType, Expense, Notification, Payment, Role, Sale,
    SaleItem, Stock, StockLocation, User,
)
from core.serializers import CustomerProfileSerializer

from .base import GasBookTestCase


def serializer_balances(profile):
    data = CustomerProfileSerializer(CustomerProfile.objects.get(pk=profile.pk)).data
    return {
        "pending": data["pending_amount"],
        "empties_owed": {int(key): value["owed"] for key, value in data["empties_owed"].items()},
        "empty_credits": {int(key): value["credit"] for key, value in data["empty_credits"].items()},
    }


class IntegrityChecksTests(GasBookTestCase):
    """A small ledger built through the real endpoints: refill and new-cylinder sales, a
    return-only sale, a standalone payment and an agreed-rate customer."""

    def setUp(self):
        super().setUp()
        self.cylinder.refill_rate = Decimal("800.00")
        self.cylinder.save(update_fields=["refill_rate"])
        self.set_stock(self.shop, filled=20, empty=0)
        self.customer.opening_balance = Decimal("150.00")
        self.customer.save(update_fields=["opening_balance"])
        self.auth(self.admin)

        self.return_only = self.sell(quantity=0, rate="0", empty_returned=3, payment_mode="cash", paid_amount="0")
        self.refill_sale = self.sell(quantity=2, rate="800", empty_returned=1, payment_mode="credit", paid_amount="600")
        self.new_sale = self.sell(quantity=1, rate="900", empty_returned=0, payment_mode="cash", paid_amount="900")
        response = self.client.post(
            "/api/payments/", {"customer": self.customer.id, "amount": "300", "payment_mode": "cash"}, format="json"
        )
        self.assertEqual(response.status_code, 201, response.data)

        other_user = User.objects.create_user(username="cust2", password="x", role=self.customer_role, phone="9000000005")
        self.agreed_customer = CustomerProfile.objects.create(user=other_user)
        CustomerCylinderRate.objects.create(customer=self.agreed_customer, cylinder_type=self.cylinder, custom_price=Decimal("750.00"))
        self.agreed_sale = self.sell(customer=self.agreed_customer, quantity=1, rate="750", empty_returned=0,
                                     payment_mode="credit", paid_amount="0")

    def sell(self, customer=None, *, quantity, rate, empty_returned, payment_mode, paid_amount):
        response = self.client.post("/api/sales/", {
            "client_ref": str(uuid.uuid4()),
            "customer": (customer or self.customer).id,
            "location": self.shop.id,
            "payment_mode": payment_mode,
            "paid_amount": paid_amount,
            "paid_payment_mode": "cash",
            "sale_items": [{"cylinder_type": self.cylinder.id, "quantity": quantity, "rate": rate, "empty_returned": empty_returned}],
        }, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        return Sale.objects.get(pk=response.data["id"])

    def checks(self):
        return {problem["check"] for problem in integrity.violations()}

    def changed(self, before):
        return {change["table"] for change in integrity.compare_fingerprints(before, integrity.fingerprint())}

    def test_clean_ledger_has_no_violations(self):
        self.assertEqual(integrity.violations(), [])
        self.assertEqual(integrity.notices()["guest_sales"], 0)

    def test_reference_balances_match_the_customer_serializer(self):
        reference = integrity.customer_balances()
        for profile in (self.customer, self.agreed_customer):
            self.assertEqual(reference[profile.id], serializer_balances(profile))
        # 3 returned up front become credits; the refill sale uses one, the new-cylinder sale none.
        self.assertEqual(reference[self.customer.id], {
            "pending": "850.00",
            "empties_owed": {self.cylinder.id: 3},
            "empty_credits": {self.cylinder.id: 3},
        })
        # The agreed rate sits below the midpoint, so that sale is a refill owing one empty.
        self.assertEqual(reference[self.agreed_customer.id]["empties_owed"], {self.cylinder.id: 1})

    def test_detects_sale_total_not_matching_lines(self):
        Sale.objects.filter(pk=self.new_sale.pk).update(total_amount=Decimal("950.00"), balance_due=Decimal("50.00"))
        self.assertIn("sale_total_equals_lines", self.checks())

    def test_detects_paid_plus_balance_mismatch(self):
        Sale.objects.filter(pk=self.refill_sale.pk).update(balance_due=Decimal("1.00"))
        self.assertIn("sale_paid_plus_balance", self.checks())

    def test_detects_amounts_out_of_range(self):
        # paid + balance still equals total, but paid exceeds it and the balance is negative.
        Sale.objects.filter(pk=self.new_sale.pk).update(paid_amount=Decimal("1000.00"), balance_due=Decimal("-100.00"))
        checks = self.checks()
        self.assertIn("sale_amounts_in_range", checks)
        self.assertNotIn("sale_paid_plus_balance", checks)

    def test_detects_unknown_sale_payment_mode(self):
        Sale.objects.filter(pk=self.new_sale.pk).update(payment_mode="bitcoin")
        self.assertIn("sale_payment_mode_valid", self.checks())

    def test_detects_payments_not_matching_paid_amount(self):
        Payment.objects.filter(sale=self.new_sale).update(amount=Decimal("100.00"))
        self.assertIn("sale_payments_match_paid", self.checks())

    def test_detects_non_positive_payment(self):
        Payment.objects.create(customer=self.customer, amount=Decimal("-5.00"), received_by=self.admin)
        self.assertIn("payment_positive", self.checks())

    def test_detects_payment_for_another_customers_sale(self):
        Payment.objects.filter(sale=self.new_sale).update(customer=self.agreed_customer)
        self.assertIn("payment_customer_matches_sale", self.checks())

    def test_detects_unknown_payment_mode(self):
        Payment.objects.filter(sale=self.new_sale).update(payment_mode="bitcoin")
        self.assertIn("payment_mode_valid", self.checks())

    def test_detects_sale_without_lines(self):
        SaleItem.objects.filter(sale=self.new_sale).delete()
        self.assertIn("sale_has_items", self.checks())

    def test_detects_delivered_booking_without_sale(self):
        self.make_booking(status=Booking.Status.DELIVERED)
        self.assertIn("booking_sale_link", self.checks())

    def test_detects_booking_with_a_sale_that_is_not_delivered(self):
        self.make_booking(status=Booking.Status.APPROVED, sale=self.new_sale)
        problems = [p for p in integrity.violations() if p["check"] == "booking_sale_link"]
        self.assertEqual(len(problems), 1)
        self.assertIn("status is approved", problems[0]["detail"])

    def test_fingerprint_is_stable_and_detects_changes(self):
        before = integrity.fingerprint()
        self.assertEqual(integrity.fingerprint(), before)
        self.assertEqual(integrity.compare_fingerprints(before, integrity.fingerprint()), [])

        Stock.objects.filter(location=self.shop, status=Stock.Status.FILLED).update(quantity=1)
        Payment.objects.filter(sale=self.new_sale).update(amount=Decimal("899.00"))
        Notification.objects.update(is_read=True)
        self.assertTrue({"stock", "stock_totals", "payment", "notification"} <= self.changed(before))

    def test_whole_database_section_covers_every_table(self):
        with connection.cursor() as cursor:
            tables = set(connection.introspection.table_names(cursor))
        self.assertEqual(set(integrity.fingerprint()["database"]), tables)

    def test_whole_database_section_sees_writes_the_summaries_miss(self):
        self.make_booking()
        before = integrity.fingerprint()
        # A password reset, a bulk update of a column the summaries skip (QuerySet.update()
        # leaves updated_at alone), and a row in a table the summaries do not list.
        self.admin.set_password("Changed-Pass-2026!")
        self.admin.save()
        Booking.objects.update(note="edited")
        Expense.objects.create(category=Expense.Category.FUEL, amount=Decimal("100.00"), spent_by=self.admin)

        changed = self.changed(before)
        self.assertTrue({"db:core_user", "db:core_booking", "db:core_expense"} <= changed, changed)
        self.assertFalse({"user", "booking"} & changed, changed)


def minimal_ledger():
    customer_role = Role.objects.create(name="Customer", code="customer")
    admin = User.objects.create_user(username="ro-admin", password="x", role=Role.objects.create(name="Admin", code="admin"))
    customer = CustomerProfile.objects.create(user=User.objects.create_user(username="ro-cust", password="x", role=customer_role))
    cylinder = CylinderType.objects.create(name="14kg", weight=Decimal("14.2"), selling_price=Decimal("900"))
    shop = StockLocation.objects.create(name="Shop", code="shop")
    Stock.objects.create(cylinder_type=cylinder, location=shop, status=Stock.Status.FILLED, quantity=4)
    sale = Sale.objects.create(customer=customer, location=shop, total_amount=Decimal("900"), paid_amount=Decimal("900"),
                               payment_mode=Sale.PaymentMode.CASH, sold_by=admin)
    SaleItem.objects.create(sale=sale, cylinder_type=cylinder, quantity=1, rate=Decimal("900"), total_amount=Decimal("900"))
    Payment.objects.create(customer=customer, sale=sale, amount=Decimal("900"), received_by=admin)


@unittest.skipUnless(connection.vendor == "postgresql", "read-only transactions are a PostgreSQL feature")
class ReadOnlyCommandTests(TransactionTestCase):
    """Real transactions (not the TestCase wrapper) so SET TRANSACTION READ ONLY is the outermost one."""

    def setUp(self):
        minimal_ledger()

    def run_command(self, *args):
        out = StringIO()
        call_command("check_sales_integrity", "--json", *args, stdout=out)
        return json.loads(out.getvalue())

    def write_baseline(self, data):
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as handle:
            json.dump(data, handle)
        self.addCleanup(os.unlink, handle.name)
        return handle.name

    def test_runner_refuses_writes(self):
        with self.assertRaises(DatabaseError):
            integrity.run_read_only(lambda: Stock.objects.update(quantity=99))
        self.assertEqual(Stock.objects.get().quantity, 4)

    def test_runner_fails_closed_without_postgresql(self):
        calls = []
        with mock.patch.object(connections["default"], "vendor", "sqlite"):
            with self.assertRaises(integrity.ReadOnlyUnavailable):
                integrity.run_read_only(lambda: calls.append("ran"))
            with self.assertRaisesMessage(CommandError, "Refusing to report"):
                self.run_command()
        self.assertEqual(calls, [])

    def test_command_reports_from_a_read_only_transaction(self):
        report = self.run_command()
        self.assertEqual(report["format"], integrity.REPORT_FORMAT)
        self.assertTrue(report["read_only_transaction"])
        self.assertEqual(report["violations"], [])
        self.assertEqual(report["fingerprint"]["tables"]["sale"]["rows"], 1)
        self.assertEqual(report["fingerprint"]["database"]["core_sale"]["rows"], 1)
        self.assertEqual(report["fingerprint"]["stock_totals"], {"empty": 0, "filled": 4})

    def test_compare_passes_when_unchanged_and_fails_on_any_change(self):
        baseline = self.write_baseline(self.run_command())
        self.assertEqual(self.run_command("--compare", baseline)["comparison"]["changes"], [])

        Stock.objects.update(quantity=3)
        with self.assertRaisesMessage(CommandError, "db:core_stock"):
            self.run_command("--compare", baseline)

    def test_fail_on_violations_is_opt_in(self):
        Payment.objects.update(amount=Decimal("1.00"))
        self.assertEqual([p["check"] for p in self.run_command()["violations"]], ["sale_payments_match_paid"])
        with self.assertRaisesMessage(CommandError, "1 invariant violation(s)"):
            self.run_command("--fail-on-violations")

    def test_compare_rejects_files_that_are_not_current_baselines(self):
        current = self.run_command()
        old_format = {**current, "format": 1}
        no_database = {**current, "fingerprint": {**current["fingerprint"]}}
        del no_database["fingerprint"]["database"]
        cases = [
            ({"detail": "not a report"}, "no fingerprint"),
            (old_format, "take a new baseline"),
            (no_database, "missing tables or database section"),
        ]
        for data, message in cases:
            with self.subTest(message=message), self.assertRaisesMessage(CommandError, message):
                self.run_command("--compare", self.write_baseline(data))
