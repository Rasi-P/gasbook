"""Server-side validation of direct sales (POST /api/sales/).

Every rejected request must return 4xx and change nothing at all, which is checked with
the whole-database fingerprint.
"""
import unittest
import uuid
from decimal import Decimal

from django.db import connection
from django.test import TransactionTestCase

from core import integrity
from core.models import ActivityLog, CustomerProfile, CylinderType, Payment, Role, Sale, SaleItem, Stock, StockLocation, User
from core.serializers import CustomerProfileSerializer

from .base import GasBookTestCase
from .concurrency import holding_lock, run_concurrently


class SaleTestMixin:
    def payload(self, **overrides):
        body = {
            "client_ref": str(uuid.uuid4()),
            "customer": self.customer.id,
            "location": self.shop.id,
            "payment_mode": "cash",
            "sale_items": [{"cylinder_type": self.cylinder.id, "quantity": 2, "rate": "900", "empty_returned": 0}],
        }
        body.update(overrides)
        return body

    def line(self, quantity=1, rate="900", empty_returned=0, cylinder=None):
        return {"cylinder_type": (cylinder or self.cylinder).id, "quantity": quantity, "rate": rate, "empty_returned": empty_returned}

    def post(self, body):
        return self.client.post("/api/sales/", body, format="json")

    def assert_rejected(self, body, code=None, field=None, status=400):
        before = integrity.fingerprint()
        response = self.post(body)
        self.assertEqual(response.status_code, status, (body, response.data))
        if code is not None:
            self.assertEqual(response.data["code"], code, (body, response.data))
        if field is not None:
            self.assertTrue(response.data.get("field") == field or field in response.data, (body, response.data))
        self.assertEqual(integrity.compare_fingerprints(before, integrity.fingerprint()), [], body)
        return response


class SaleValidationTests(SaleTestMixin, GasBookTestCase):
    def setUp(self):
        super().setUp()
        self.kandam = StockLocation.objects.create(name="Kandam", code="kandam")
        self.small = CylinderType.objects.create(name="5kg", weight=Decimal("5"), selling_price=Decimal("450"), refill_rate=Decimal("450"))
        self.set_stock(self.shop, filled=10, empty=0)
        self.set_stock(self.kandam, filled=10, empty=0)
        self.set_stock(self.shop, filled=10, cylinder=self.small)
        self.auth(self.admin)

    # ---- locations ---------------------------------------------------------

    def test_shop_and_kandam_are_the_eligible_sources(self):
        for location in (self.shop, self.kandam):
            response = self.post(self.payload(location=location.id))
            self.assertEqual(response.status_code, 201, response.data)
            self.assertEqual(self.stock_qty(location, Stock.Status.FILLED), 8)

    def test_other_or_inactive_locations_are_refused(self):
        supplier = StockLocation.objects.create(name="Supplier", code="supplier")
        van = StockLocation.objects.create(name="Van", code="van")
        self.set_stock(van, filled=10)
        self.assert_rejected(self.payload(location=supplier.id), "invalid_location", "location")
        self.assert_rejected(self.payload(location=van.id), "invalid_location", "location")
        self.assert_rejected(self.payload(location=999999), field="location")
        self.kandam.is_active = False
        self.kandam.save(update_fields=["is_active"])
        self.assert_rejected(self.payload(location=self.kandam.id), "location_inactive", "location")

    # ---- customers -----------------------------------------------------------

    def test_a_customer_is_required_and_must_be_active(self):
        body = self.payload()
        del body["customer"]
        self.assert_rejected(body, field="customer")
        self.assert_rejected(self.payload(customer=None), field="customer")
        self.assert_rejected(self.payload(customer=999999), field="customer")
        self.customer.is_active = False
        self.customer.save(update_fields=["is_active"])
        self.assert_rejected(self.payload(), "customer_inactive", "customer")
        self.customer.is_active = True
        self.customer.save(update_fields=["is_active"])
        self.customer_user.is_active = False
        self.customer_user.save(update_fields=["is_active"])
        self.assert_rejected(self.payload(), "customer_inactive", "customer")

    # ---- cylinders and lines -----------------------------------------------

    def test_cylinder_type_must_exist_and_be_active(self):
        self.small.is_active = False
        self.small.save(update_fields=["is_active"])
        self.assert_rejected(self.payload(sale_items=[self.line(cylinder=self.small)]), "cylinder_inactive", "sale_items")
        self.assert_rejected(self.payload(sale_items=[{**self.line(), "cylinder_type": 999999}]), field="sale_items")

    def test_line_rules(self):
        self.assert_rejected(self.payload(sale_items=[]), "no_lines", "sale_items")
        body = self.payload()
        del body["sale_items"]
        self.assert_rejected(body, field="sale_items")
        self.assert_rejected(self.payload(sale_items=[self.line(quantity=0, empty_returned=0)]), "empty_line", "sale_items")

    def test_malformed_quantities_and_rates_are_400(self):
        bad_lines = [
            {"quantity": -1}, {"quantity": "abc"}, {"quantity": 1.5}, {"quantity": 2 ** 31},
            {"empty_returned": -1}, {"empty_returned": "x"},
            {"rate": "-1"}, {"rate": "abc"}, {"rate": "1.234"}, {"rate": "1000000000"},
        ]
        for change in bad_lines:
            with self.subTest(change=change):
                self.assert_rejected(self.payload(sale_items=[{**self.line(), **change}]), field="sale_items")
        for items in ("not a list", ["not an object"], [None]):
            with self.subTest(items=items):
                self.assert_rejected(self.payload(sale_items=items), field="sale_items")

    def test_total_that_cannot_be_stored_is_refused(self):
        self.cylinder.refill_rate = Decimal("99999999")
        self.cylinder.save(update_fields=["refill_rate"])
        self.assert_rejected(self.payload(sale_items=[self.line(quantity=2_000_000, rate="99999999")]), "amount_too_large")

    # ---- stock ---------------------------------------------------------------

    def test_duplicate_lines_are_combined_before_the_stock_check(self):
        self.set_stock(self.shop, filled=5)
        response = self.assert_rejected(self.payload(sale_items=[self.line(4), self.line(4)]), "insufficient_stock", "sale_items")
        self.assertEqual(response.data["shortages"], [{"cylinder_type": self.cylinder.id, "name": self.cylinder.name, "required": 8, "available": 5}])

        response = self.post(self.payload(sale_items=[self.line(2, empty_returned=1), self.line(2, empty_returned=1)]))
        self.assertEqual(response.status_code, 201, response.data)
        item = SaleItem.objects.get()
        self.assertEqual((item.quantity, item.empty_returned, item.total_amount), (4, 2, Decimal("3600.00")))
        self.assertEqual((self.stock_qty(self.shop, Stock.Status.FILLED), self.stock_qty(self.shop, Stock.Status.EMPTY)), (1, 2))

    def test_same_type_at_different_rates_is_checked_together(self):
        self.cylinder.refill_rate = Decimal("800")
        self.cylinder.deposit_amount = Decimal("100")
        self.cylinder.save(update_fields=["refill_rate", "deposit_amount"])
        self.set_stock(self.shop, filled=5)
        self.assert_rejected(self.payload(sale_items=[{**self.line(3, "900"), "rate_type": "new"}, self.line(3, "800")]), "insufficient_stock")
        response = self.post(self.payload(sale_items=[{**self.line(3, "900"), "rate_type": "new"}, self.line(2, "800")]))
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(sorted(SaleItem.objects.values_list("rate", "quantity")), [(Decimal("800.00"), 2), (Decimal("900.00"), 3)])
        self.assertEqual(self.stock_qty(self.shop, Stock.Status.FILLED), 0)

    def test_every_short_type_is_reported_and_no_field_name_keys_leak(self):
        response = self.assert_rejected(
            self.payload(sale_items=[self.line(11), self.line(11, "450", cylinder=self.small)]), "insufficient_stock"
        )
        self.assertEqual([s["required"] for s in response.data["shortages"]], [11, 11])
        # The admin UI shows body.location / body.sale_items verbatim if present, so the
        # error must carry the message in detail and use field / location_code instead.
        self.assertFalse({"location", "sale_items", "customer", "paid_amount"} & set(response.data))
        self.assertIn("Not enough filled stock", response.data["detail"])

    def test_no_filled_row_means_none_in_stock_and_no_row_is_created(self):
        self.assert_rejected(self.payload(location=self.kandam.id, sale_items=[self.line(1, "450", cylinder=self.small)]),
                             "insufficient_stock")
        self.assertFalse(Stock.objects.filter(location=self.kandam, cylinder_type=self.small).exists())

    def test_returned_empties_create_the_empty_row_when_missing(self):
        response = self.post(self.payload(location=self.kandam.id, paid_amount="0",
                                          sale_items=[self.line(0, "0", empty_returned=3, cylinder=self.small)]))
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(self.stock_qty(self.kandam, Stock.Status.EMPTY, cylinder=self.small), 3)

    def test_return_only_sale(self):
        body = self.payload(note="Empty cylinders returned", paid_amount=0,
                            sale_items=[self.line(0, 0, empty_returned=2)])
        response = self.post(body)
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual((self.stock_qty(self.shop, Stock.Status.EMPTY), self.stock_qty(self.shop, Stock.Status.FILLED)), (2, 10))
        self.assertFalse(Payment.objects.exists())
        # A separate request, so it needs its own client_ref (reusing body's would be a 409).
        self.assert_rejected({**body, "client_ref": str(uuid.uuid4()), "paid_amount": 100}, "paid_mismatch")

    # ---- payments ------------------------------------------------------------

    def test_cash_gpay_and_bank_are_paid_in_full(self):
        for mode in ("cash", "gpay", "bank"):
            with self.subTest(mode=mode):
                response = self.post(self.payload(payment_mode=mode, sale_items=[self.line(1)]))
                self.assertEqual(response.status_code, 201, response.data)
                sale = Sale.objects.get(pk=response.data["id"])
                self.assertEqual((sale.paid_amount, sale.balance_due), (Decimal("900.00"), Decimal("0.00")))
                self.assertEqual(list(sale.payments.values_list("payment_mode", "amount")), [(mode, Decimal("900.00"))])
        self.assertEqual(self.post(self.payload(paid_amount="1800")).status_code, 201)
        self.assert_rejected(self.payload(paid_amount="1799"), "paid_mismatch", "paid_amount")
        self.assert_rejected(self.payload(paid_amount="1801"), "paid_mismatch", "paid_amount")
        self.assert_rejected(self.payload(paid_amount="0"), "paid_mismatch", "paid_amount")
        self.assertEqual(integrity.violations(), [])

    def test_credit_rules(self):
        response = self.post(self.payload(payment_mode="credit", paid_amount="0"))
        self.assertEqual(response.status_code, 201, response.data)
        sale = Sale.objects.get(pk=response.data["id"])
        self.assertEqual((sale.paid_amount, sale.balance_due, sale.payments.count()), (Decimal("0.00"), Decimal("1800.00"), 0))

        response = self.post(self.payload(payment_mode="credit", paid_amount="500", paid_payment_mode="gpay"))
        self.assertEqual(response.status_code, 201, response.data)
        sale = Sale.objects.get(pk=response.data["id"])
        self.assertEqual((sale.balance_due, list(sale.payments.values_list("payment_mode", "amount"))),
                         (Decimal("1300.00"), [("gpay", Decimal("500.00"))]))

        self.assert_rejected(self.payload(payment_mode="credit", paid_amount="500"), "required", "paid_payment_mode")
        self.assert_rejected(self.payload(payment_mode="credit", paid_amount="1801", paid_payment_mode="cash"), "overpayment")
        for mode in ("credit", "split", "bitcoin"):
            self.assert_rejected(self.payload(payment_mode="credit", paid_amount="5", paid_payment_mode=mode), field="paid_payment_mode")
        self.assertEqual(integrity.violations(), [])

    def test_split_rules(self):
        parts = [{"mode": "cash", "amount": "1000"}, {"mode": "gpay", "amount": "500"}, {"mode": "bank", "amount": "300"}]
        response = self.post(self.payload(payment_mode="split", paid_amount="1800", split_payments=parts))
        self.assertEqual(response.status_code, 201, response.data)
        sale = Sale.objects.get(pk=response.data["id"])
        self.assertEqual(sorted(sale.payments.values_list("payment_mode", "amount")),
                         [("bank", Decimal("300.00")), ("cash", Decimal("1000.00")), ("gpay", Decimal("500.00"))])
        self.assertEqual((sale.paid_amount, sale.balance_due), (Decimal("1800.00"), Decimal("0.00")))

        response = self.post(self.payload(payment_mode="split", split_payments=[{"mode": "cash", "amount": "1000"}]))
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(Sale.objects.get(pk=response.data["id"]).balance_due, Decimal("800.00"))

        def split(parts, **extra):
            return self.payload(payment_mode="split", split_payments=parts, **extra)

        self.assert_rejected(self.payload(payment_mode="split"), "invalid_payment", "split_payments")
        self.assert_rejected(split([]), "invalid_payment", "split_payments")
        self.assert_rejected(split([{"mode": "cash", "amount": "100"}, {"mode": "cash", "amount": "100"}]), "invalid_payment")
        self.assert_rejected(split([{"mode": "cash", "amount": "1000"}, {"mode": "gpay", "amount": "801"}]), "overpayment")
        self.assert_rejected(split([{"mode": "cash", "amount": "1000"}], paid_amount="900"), "paid_mismatch", "paid_amount")
        self.assert_rejected(self.payload(payment_mode="cash", split_payments=[{"mode": "cash", "amount": "1800"}]),
                             "invalid_payment", "split_payments")
        for part in ({"mode": "credit", "amount": "100"}, {"mode": "bitcoin", "amount": "100"}, {"amount": "100"},
                     {"mode": "cash", "amount": "0"}, {"mode": "cash", "amount": "-5"}, {"mode": "cash", "amount": "abc"}):
            with self.subTest(part=part):
                self.assert_rejected(split([part]), field="split_payments")
        self.assert_rejected(split("not a list"), field="split_payments")
        self.assertEqual(integrity.violations(), [])

    def test_two_decimal_amounts_from_the_admin_form_are_exact(self):
        """Sales.tsx sends paid_amount as paid.toFixed(2). Those strings are accepted and equal
        the server's own total exactly; a raw float artifact is still refused, because the
        server deliberately does not round."""
        self.set_stock(self.shop, filled=30)
        for rate, quantity, paid in (("899.99", 3, "2699.97"), ("450.10", 3, "1350.30"), ("1234.56", 9, "11111.04")):
            self.cylinder.refill_rate = Decimal(rate)
            self.cylinder.save(update_fields=["refill_rate"])
            with self.subTest(rate=rate, quantity=quantity):
                response = self.post(self.payload(paid_amount=paid, sale_items=[self.line(quantity, rate)]))
                self.assertEqual(response.status_code, 201, response.data)
                self.assertEqual((response.data["total_amount"], response.data["paid_amount"], response.data["balance_due"]),
                                 (paid, paid, "0.00"))
        self.cylinder.refill_rate = Decimal("450.10")
        self.cylinder.save(update_fields=["refill_rate"])
        split = self.post(self.payload(payment_mode="split", paid_amount="1350.30", sale_items=[self.line(3, "450.10")],
                                       split_payments=[{"mode": "cash", "amount": "1000.10"}, {"mode": "gpay", "amount": "350.20"}]))
        self.assertEqual((split.status_code, split.data["balance_due"]), (201, "0.00"), split.data)
        self.assert_rejected(self.payload(paid_amount=899.99 * 3, sale_items=[self.line(3, "899.99")]), field="paid_amount")
        self.assertEqual(integrity.violations(), [])

    def test_invalid_mode_or_amount_is_400(self):
        self.assert_rejected(self.payload(payment_mode="bitcoin"), field="payment_mode")
        for paid in ("-1", "abc", "1.234", "1000000000"):
            with self.subTest(paid=paid):
                self.assert_rejected(self.payload(payment_mode="credit", paid_amount=paid, paid_payment_mode="cash"), field="paid_amount")

    # ---- server-set fields and malformed bodies --------------------------------

    def test_server_set_fields_are_refused(self):
        for field, value in (("total_amount", "1"), ("balance_due", "0"), ("sold_by", self.staff_a.id),
                             ("original_amount", "5000"), ("discount_amount", "999"), ("applied_discount_type", "fixed"),
                             ("delivery_staff", "Anyone"), ("final_amount", "1")):
            with self.subTest(field=field):
                response = self.assert_rejected(self.payload(**{field: value}), "read_only_fields")
                self.assertEqual(response.data["fields"], [field])

    def test_bodies_that_are_not_objects_are_400(self):
        for body in ([self.payload()], "sale", 5):
            with self.subTest(body=body):
                self.assert_rejected(body)

    # ---- accounting of a valid sale ------------------------------------------

    def test_a_valid_mixed_sale_is_recorded_consistently(self):
        response = self.post(self.payload(
            payment_mode="split",
            sale_items=[self.line(2, "900", empty_returned=1), self.line(3, "450", empty_returned=3, cylinder=self.small)],
            split_payments=[{"mode": "cash", "amount": "2000"}, {"mode": "bank", "amount": "500"}],
        ))
        self.assertEqual(response.status_code, 201, response.data)
        sale = Sale.objects.get(pk=response.data["id"])
        self.assertEqual((sale.total_amount, sale.paid_amount, sale.balance_due, sale.sold_by),
                         (Decimal("3150.00"), Decimal("2500.00"), Decimal("650.00"), self.admin))
        self.assertEqual(
            (self.stock_qty(self.shop, Stock.Status.FILLED), self.stock_qty(self.shop, Stock.Status.EMPTY),
             self.stock_qty(self.shop, Stock.Status.FILLED, cylinder=self.small), self.stock_qty(self.shop, Stock.Status.EMPTY, cylinder=self.small)),
            (8, 1, 7, 3),
        )
        log = ActivityLog.objects.get(action="sale_created").metadata
        self.assertEqual((log["sale_id"], log["customer_id"], log["location"], log["paid"], log["balance"]),
                         (sale.id, self.customer.id, "shop", "2500.00", "650.00"))
        self.assertEqual(log["stock_after"], {str(self.cylinder.id): {"filled": 8, "empty": 1},
                                              str(self.small.id): {"filled": 7, "empty": 3}})
        self.assertEqual(log["payments"], [{"mode": "cash", "amount": "2000.00"}, {"mode": "bank", "amount": "500.00"}])
        self.assertEqual(integrity.violations(), [])


class InactiveCylinderTypeTests(SaleTestMixin, GasBookTestCase):
    """A discontinued cylinder type: its filled cylinders cannot be sold, but customers can
    still return its empties (decision of 2026-10-10)."""

    def setUp(self):
        super().setUp()
        self.small = CylinderType.objects.create(name="5kg", weight=Decimal("5"), selling_price=Decimal("450"), refill_rate=Decimal("450"))
        self.set_stock(self.shop, filled=10)
        self.set_stock(self.shop, filled=5, cylinder=self.small)
        self.auth(self.admin)
        # Sold while still active: the customer now owes 2 empties of it.
        response = self.post(self.payload(sale_items=[self.line(2, "450", cylinder=self.small)]))
        self.assertEqual(response.status_code, 201, response.data)
        self.small.is_active = False
        self.small.save(update_fields=["is_active"])

    def empties_owed(self):
        """Empties the customer owes, per cylinder type; the frozen reference and the
        customer screen's serializer must agree."""
        reference = integrity.customer_balances()[self.customer.id]["empties_owed"]
        screen = CustomerProfileSerializer(CustomerProfile.objects.get(pk=self.customer.pk)).data["empties_owed"]
        self.assertEqual(reference, {int(key): value["owed"] for key, value in screen.items()})
        return reference

    def returns(self, quantity, cylinder=None):
        return self.line(0, "0", empty_returned=quantity, cylinder=cylinder or self.small)

    def test_empties_of_an_inactive_type_can_still_be_returned(self):
        self.assertEqual(self.empties_owed(), {self.small.id: 2})
        response = self.post(self.payload(paid_amount="0", note="Empty cylinders returned", sale_items=[self.returns(2)]))
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(
            (self.stock_qty(self.shop, Stock.Status.EMPTY, cylinder=self.small), self.stock_qty(self.shop, Stock.Status.FILLED, cylinder=self.small)),
            (2, 3),
        )
        self.assertEqual(self.empties_owed(), {})
        self.assertFalse(Payment.objects.filter(sale_id=response.data["id"]).exists())
        self.assertEqual(integrity.violations(), [])

    def test_filled_cylinders_of_an_inactive_type_cannot_be_sold(self):
        for line in (self.line(1, "450", cylinder=self.small), self.line(1, "450", empty_returned=1, cylinder=self.small)):
            with self.subTest(line=line):
                response = self.assert_rejected(self.payload(sale_items=[line]), "cylinder_inactive", "sale_items")
                self.assertIn("only its empties can be returned", response.data["detail"])

    def test_mixed_lines_with_an_inactive_type(self):
        # Selling an active type while taking back the inactive type's empties is fine.
        response = self.post(self.payload(sale_items=[self.line(1), self.returns(2)]))
        self.assertEqual(response.status_code, 201, response.data)
        sale = Sale.objects.get(pk=response.data["id"])
        self.assertEqual((sale.total_amount, sale.paid_amount, sale.balance_due), (Decimal("900.00"), Decimal("900.00"), Decimal("0.00")))
        self.assertEqual((self.stock_qty(self.shop, Stock.Status.FILLED), self.stock_qty(self.shop, Stock.Status.EMPTY, cylinder=self.small)), (9, 2))
        self.assertEqual(self.empties_owed(), {self.cylinder.id: 1})
        self.assertEqual(integrity.violations(), [])

        # Any line selling the inactive type is refused, even beside valid lines or an
        # empties-only line of the same type that it would otherwise be merged with.
        self.assert_rejected(self.payload(sale_items=[self.line(1), self.line(1, "450", cylinder=self.small)]), "cylinder_inactive")
        self.assert_rejected(self.payload(sale_items=[self.returns(1), self.line(1, "0", cylinder=self.small)]), "cylinder_inactive")


@unittest.skipUnless(connection.vendor == "postgresql", "row locks are tested on PostgreSQL")
class SaleConcurrencyTests(TransactionTestCase):
    """Two sales at the same moment, each holding its stock locks for a while."""

    def setUp(self):
        admin_role = Role.objects.create(name="Admin", code="admin")
        customer_role = Role.objects.create(name="Customer", code="customer")
        self.admin = User.objects.create_user(username="c-admin", password="x", role=admin_role)
        self.customers = [
            CustomerProfile.objects.create(user=User.objects.create_user(username=f"c-cust{i}", password="x", role=customer_role))
            for i in range(2)
        ]
        self.shop = StockLocation.objects.create(name="Shop", code="shop")
        self.big = CylinderType.objects.create(name="14kg", weight=Decimal("14.2"), selling_price=Decimal("900"), refill_rate=Decimal("100"))
        self.small = CylinderType.objects.create(name="5kg", weight=Decimal("5"), selling_price=Decimal("450"), refill_rate=Decimal("100"))

    def sale(self, customer, *lines):
        return (self.admin, "/api/sales/", {
            "client_ref": str(uuid.uuid4()),
            "customer": customer.id, "location": self.shop.id, "payment_mode": "cash",
            "sale_items": [{"cylinder_type": ct.id, "quantity": qty, "rate": "100"} for ct, qty in lines],
        })

    def filled(self, cylinder):
        return Stock.objects.get(cylinder_type=cylinder, location=self.shop, status=Stock.Status.FILLED).quantity

    def test_two_sales_cannot_both_take_the_last_cylinders(self):
        Stock.objects.create(cylinder_type=self.big, location=self.shop, status=Stock.Status.FILLED, quantity=5)
        with holding_lock("core.serializers.lock_sale_stock"):
            results = run_concurrently([self.sale(self.customers[0], (self.big, 3)), self.sale(self.customers[1], (self.big, 3))])
        self.assertEqual(sorted(status for status, _ in results), [201, 400], results)
        self.assertEqual(next(data for status, data in results if status == 400)["code"], "insufficient_stock")
        self.assertEqual(self.filled(self.big), 2)
        self.assertEqual(Sale.objects.count(), 1)
        self.assertEqual(integrity.violations(), [])

    def test_opposite_line_orders_do_not_deadlock(self):
        for cylinder in (self.big, self.small):
            Stock.objects.create(cylinder_type=cylinder, location=self.shop, status=Stock.Status.FILLED, quantity=10)
        with holding_lock("core.serializers.lock_sale_stock"):
            results = run_concurrently([
                self.sale(self.customers[0], (self.big, 2), (self.small, 1)),
                self.sale(self.customers[1], (self.small, 1), (self.big, 2)),
            ])
        self.assertEqual([status for status, _ in results], [201, 201], results)
        self.assertEqual((self.filled(self.big), self.filled(self.small)), (6, 8))
        self.assertEqual(integrity.violations(), [])
