"""Current direct-sale behaviour that later phases must keep.

Only correct behaviour is pinned here; the defects found in the audit are covered by the
tests of the phases that fix them. Completing a booking delivery (the other way a Sale is
created) is pinned in test_delivery_complete.
"""
import uuid
from decimal import Decimal

from core import integrity
from core.models import ActivityLog, Booking, Payment, Sale, SaleItem, Stock, StockLocation

from .base import GasBookTestCase


class DirectSaleBaselineTests(GasBookTestCase):
    def setUp(self):
        super().setUp()
        self.kandam = StockLocation.objects.create(name="Kandam", code="kandam")
        self.set_stock(self.shop, filled=5, empty=0)
        self.set_stock(self.kandam, filled=5, empty=0)

    def sell(self, *, user=None, location=None, quantity=2, rate="900", empty_returned=1, **payload):
        self.auth(user or self.admin)
        body = {
            "client_ref": str(uuid.uuid4()),
            "customer": self.customer.id,
            "location": (location or self.shop).id,
            "payment_mode": "cash",
            "paid_amount": str(Decimal(rate) * quantity),
            "sale_items": [{"cylinder_type": self.cylinder.id, "quantity": quantity, "rate": rate, "empty_returned": empty_returned}],
        }
        body.update(payload)
        return self.client.post("/api/sales/", body, format="json")

    def test_cash_sale_moves_stock_at_the_selected_location_and_records_payment(self):
        response = self.sell(location=self.kandam)
        self.assertEqual(response.status_code, 201, response.data)

        self.assertEqual(self.stock_qty(self.kandam, Stock.Status.FILLED), 3)
        self.assertEqual(self.stock_qty(self.kandam, Stock.Status.EMPTY), 1)
        self.assertEqual(self.stock_qty(self.shop, Stock.Status.FILLED), 5)

        sale = Sale.objects.get()
        self.assertEqual((sale.location, sale.sold_by, sale.customer), (self.kandam, self.admin, self.customer))
        self.assertEqual((sale.total_amount, sale.paid_amount, sale.balance_due), (Decimal("1800.00"), Decimal("1800.00"), Decimal("0.00")))
        item = SaleItem.objects.get()
        self.assertEqual((item.quantity, item.rate, item.total_amount, item.empty_returned), (2, Decimal("900.00"), Decimal("1800.00"), 1))
        payment = Payment.objects.get()
        self.assertEqual((payment.sale, payment.amount, payment.payment_mode, payment.received_by),
                         (sale, Decimal("1800.00"), "cash", self.admin))

        self.assertEqual(ActivityLog.objects.get(action="sale_created").metadata["sale_id"], sale.id)
        self.assertEqual(self.notifications(self.customer_user, "DIRECT_SALE_COMPLETED").count(), 1)
        self.assertEqual(integrity.violations(), [])

    def test_credit_sale_records_partial_payment_in_the_received_mode(self):
        response = self.sell(payment_mode="credit", paid_amount="500", paid_payment_mode="gpay")
        self.assertEqual(response.status_code, 201, response.data)
        sale = Sale.objects.get()
        self.assertEqual((sale.payment_mode, sale.paid_amount, sale.balance_due), ("credit", Decimal("500.00"), Decimal("1300.00")))
        self.assertEqual(list(Payment.objects.values_list("amount", "payment_mode")), [(Decimal("500.00"), "gpay")])
        self.assertEqual(integrity.violations(), [])

    def test_split_sale_records_one_payment_per_part(self):
        # Sales.tsx sends paid_amount as the total of the parts.
        response = self.sell(payment_mode="split", paid_amount="1300",
                             split_payments=[{"mode": "cash", "amount": 1000}, {"mode": "gpay", "amount": 300}])
        self.assertEqual(response.status_code, 201, response.data)
        sale = Sale.objects.get()
        self.assertEqual((sale.paid_amount, sale.balance_due), (Decimal("1300.00"), Decimal("500.00")))
        self.assertEqual(sorted(Payment.objects.values_list("payment_mode", "amount")),
                         [("cash", Decimal("1000.00")), ("gpay", Decimal("300.00"))])
        self.assertEqual(integrity.violations(), [])

    def test_return_only_sale_adds_empties_without_charging_or_notifying(self):
        response = self.sell(quantity=0, rate="0", empty_returned=2, paid_amount="0", note="Empty cylinders returned")
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(self.stock_qty(self.shop, Stock.Status.EMPTY), 2)
        self.assertEqual(self.stock_qty(self.shop, Stock.Status.FILLED), 5)
        sale = Sale.objects.get()
        self.assertEqual((sale.total_amount, sale.balance_due), (Decimal("0.00"), Decimal("0.00")))
        self.assertFalse(Payment.objects.exists())
        self.assertFalse(self.notifications(self.customer_user, "DIRECT_SALE_COMPLETED").exists())

    def test_creator_is_always_the_authenticated_user(self):
        # Sending a creator is refused outright (Phase 2), not silently ignored.
        before = integrity.fingerprint()
        response = self.sell(sold_by=self.staff_a.id)
        self.assertEqual((response.status_code, response.data["code"]), (400, "read_only_fields"))
        self.assertEqual(integrity.compare_fingerprints(before, integrity.fingerprint()), [])

        self.assertEqual(self.sell().status_code, 201)
        self.assertEqual(Sale.objects.get().sold_by, self.admin)

    def test_insufficient_stock_writes_nothing(self):
        before = integrity.fingerprint()
        response = self.sell(quantity=6)
        self.assertEqual(response.status_code, 400, response.data)
        # The reason is pinned so the test cannot pass on some other validation error.
        self.assertIn("Not enough filled stock", str(response.data["detail"]))
        self.assertEqual(integrity.compare_fingerprints(before, integrity.fingerprint()), [])

    def test_customers_cannot_create_sales(self):
        response = self.sell(user=self.customer_user)
        self.assertEqual(response.status_code, 403)
        self.assertFalse(Sale.objects.exists())

    def test_customer_history_lists_each_direct_sale_once(self):
        direct = Sale.objects.get(pk=self.sell().data["id"])
        returned = Sale.objects.get(pk=self.sell(quantity=0, rate="0", empty_returned=1, paid_amount="0").data["id"])
        booking_sale = Sale.objects.create(customer=self.customer, location=self.shop, total_amount=Decimal("900.00"),
                                           paid_amount=Decimal("900.00"), payment_mode="cash", sold_by=self.staff_a)
        SaleItem.objects.create(sale=booking_sale, cylinder_type=self.cylinder, quantity=1, rate=Decimal("900.00"),
                                total_amount=Decimal("900.00"))
        booking = self.make_booking(status=Booking.Status.DELIVERED, quantity=1, sale=booking_sale)

        self.auth(self.customer_user)
        response = self.client.get("/api/bookings/history/")
        self.assertEqual(response.status_code, 200)
        entries = [(entry["history_source"], entry["source_id"]) for entry in response.data["results"]]

        self.assertEqual(entries.count(("sale", direct.id)), 1)
        self.assertNotIn(("sale", returned.id), entries)
        self.assertNotIn(("sale", booking_sale.id), entries)
        self.assertEqual(entries.count(("booking", booking.id)), 1)
        entry = next(e for e in response.data["results"] if e["history_source"] == "sale")
        self.assertEqual((entry["order_id"], entry["status"]), (f"SALE-{direct.id}", "delivered"))

    def test_standalone_payment_settles_oldest_dues_first(self):
        first = Sale.objects.get(pk=self.sell(quantity=1, payment_mode="credit", paid_amount="400", paid_payment_mode="cash").data["id"])
        second = Sale.objects.get(pk=self.sell(quantity=1, payment_mode="credit", paid_amount="0").data["id"])
        self.customer.opening_balance = Decimal("100.00")
        self.customer.save(update_fields=["opening_balance"])

        response = self.client.post("/api/payments/", {"customer": self.customer.id, "amount": "1000", "payment_mode": "cash"},
                                    format="json")
        self.assertEqual(response.status_code, 201, response.data)

        first.refresh_from_db()
        second.refresh_from_db()
        self.assertEqual((first.paid_amount, first.balance_due), (Decimal("900.00"), Decimal("0.00")))
        self.assertEqual((second.paid_amount, second.balance_due), (Decimal("500.00"), Decimal("400.00")))
        self.assertEqual(sum(Payment.objects.filter(sale__isnull=False).values_list("amount", flat=True)), Decimal("1400.00"))
        self.assertEqual(integrity.customer_balances()[self.customer.id]["pending"], "500.00")
        self.assertEqual(integrity.violations(), [])
