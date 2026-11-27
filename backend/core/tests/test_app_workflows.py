"""Workflows the apps use today must keep working after the endpoint restrictions.

Each test sends the same requests as the screen named in it: admin frontend
pages/Sales.tsx, Customers.tsx and Stock.tsx, the staff delivery app
(pages/staff/StaffMobileLayout.tsx) and gasbook-customer (lib/auth.ts, history views).
"""
import uuid
from decimal import Decimal

from core import integrity
from core.models import ActivityLog, Booking, CustomerCylinderDiscount, CustomerProfile, Delivery, Payment, Sale, Stock, StockLocation

from .base import GasBookTestCase


class AdminSalesWorkflowTests(GasBookTestCase):
    """Sales.tsx (New Sale, Return Empties, History) and Customers.tsx (Receive Payment, ledger)."""

    def setUp(self):
        super().setUp()
        self.set_stock(self.shop, filled=10, empty=0)
        self.auth(self.admin)

    def sale(self, customer_id, quantity=2, empty_returned=2, payment_mode="cash", paid_amount=None):
        response = self.client.post("/api/sales/", {
            "client_ref": str(uuid.uuid4()),
            "customer": customer_id,
            "location": self.shop.id,
            "payment_mode": payment_mode,
            "paid_amount": paid_amount if paid_amount is not None else 900 * quantity,
            "sale_items": [{"cylinder_type": self.cylinder.id, "quantity": quantity, "rate": "900", "empty_returned": empty_returned}],
            "paid_payment_mode": "cash",
        }, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        return Sale.objects.get(pk=response.data["id"])

    def test_new_sale_for_a_new_customer(self):
        created = self.client.post("/api/customers/", {"name": "Walk In", "phone": "9222222222", "address": "Main Road"}, format="json")
        self.assertEqual(created.status_code, 201, created.data)
        sale = self.sale(created.data["id"])
        self.assertEqual((sale.customer_id, sale.balance_due), (created.data["id"], Decimal("0.00")))
        self.assertEqual(self.stock_qty(self.shop, Stock.Status.FILLED), 8)
        self.assertEqual(self.stock_qty(self.shop, Stock.Status.EMPTY), 2)

    def test_new_sale_collecting_past_dues(self):
        earlier = self.sale(self.customer.id, quantity=1, empty_returned=1, payment_mode="credit", paid_amount=0)
        self.sale(self.customer.id)
        response = self.client.post("/api/payments/", {
            "customer": self.customer.id, "amount": 500, "payment_mode": "gpay", "note": "Past pending collected during sale",
        }, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        earlier.refresh_from_db()
        self.assertEqual((earlier.paid_amount, earlier.balance_due), (Decimal("500.00"), Decimal("400.00")))
        self.assertEqual(integrity.violations(), [])

    def test_return_empties_only(self):
        response = self.client.post("/api/sales/", {
            "client_ref": str(uuid.uuid4()),
            "customer": self.customer.id,
            "location": self.shop.id,
            "payment_mode": "cash",
            "paid_amount": 0,
            "note": "Empty cylinders returned",
            "sale_items": [{"cylinder_type": self.cylinder.id, "quantity": 0, "rate": 0, "empty_returned": 3}],
        }, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(self.stock_qty(self.shop, Stock.Status.EMPTY), 3)

    def test_sales_history_with_filters(self):
        self.sale(self.customer.id, payment_mode="credit", paid_amount=0)
        for params, expected in (({}, 1), ({"search": "cust1"}, 1), ({"pending": "1"}, 1), ({"payment_mode": "cash"}, 0)):
            response = self.client.get("/api/sales/", params)
            self.assertEqual(response.status_code, 200, params)
            self.assertEqual(response.data["count"], expected, params)

    def test_receive_payment_single_and_split(self):
        sale = self.sale(self.customer.id, quantity=2, payment_mode="credit", paid_amount=0)
        single = self.client.post("/api/payments/", {
            "customer": self.customer.id, "amount": 600, "payment_mode": "cash", "note": "Balance clearance",
        }, format="json")
        self.assertEqual(single.status_code, 201, single.data)
        for mode, amount in (("cash", 300), ("gpay", 500), ("bank", 400)):
            split = self.client.post("/api/payments/", {
                "customer": self.customer.id, "amount": amount, "payment_mode": mode, "note": "Balance clearance",
            }, format="json")
            self.assertEqual(split.status_code, 201, split.data)
        sale.refresh_from_db()
        self.assertEqual((sale.paid_amount, sale.balance_due), (Decimal("1800.00"), Decimal("0.00")))

        ledger = self.client.get(f"/api/customers/{self.customer.pk}/ledger/")
        self.assertEqual(ledger.status_code, 200)
        self.assertEqual(ledger.data["customer"]["pending_amount"], "0.00")
        self.assertEqual(integrity.violations(), [])


class StockWorkflowTests(GasBookTestCase):
    """Stock.tsx: the page reads and its five movement forms."""

    def setUp(self):
        super().setUp()
        self.kandam = StockLocation.objects.create(name="Kandam", code="kandam")
        self.supplier = StockLocation.objects.create(name="Supplier", code="supplier")
        self.set_stock(self.shop, filled=10, empty=6)
        self.auth(self.admin)

    def move(self, from_location, to_location, status, quantity, note=None, expect=201):
        payload = {"cylinder_type": self.cylinder.id, "from_location": from_location.id, "to_location": to_location.id,
                   "status": status, "quantity": quantity}
        if note is not None:
            payload["note"] = note
        response = self.client.post("/api/movements/", payload, format="json")
        self.assertEqual(response.status_code, expect, response.data)
        return response

    def test_page_reads(self):
        for url in ("/api/stock/", "/api/locations/", "/api/movements/", "/api/movements/supplier_pending/"):
            self.assertEqual(self.client.get(url).status_code, 200, url)

    def test_transfer_between_locations(self):
        self.move(self.shop, self.kandam, "filled", 3)
        self.assertEqual((self.stock_qty(self.shop, Stock.Status.FILLED), self.stock_qty(self.kandam, Stock.Status.FILLED)), (7, 3))
        self.assertTrue(ActivityLog.objects.filter(action="stock_moved").exists())

    def test_new_supplier_load(self):
        self.move(self.supplier, self.shop, "filled", 5, note="New supplier load")
        self.assertEqual(self.stock_qty(self.shop, Stock.Status.FILLED), 15)

    def test_send_empties_for_refilling(self):
        self.move(self.shop, self.supplier, "empty", 4, note="Sent for refilling - truck 2")
        self.assertEqual(self.stock_qty(self.shop, Stock.Status.EMPTY), 2)

    def test_receive_refilled_cylinders_quick_and_form(self):
        self.move(self.shop, self.supplier, "empty", 4, note="Sent for refilling")
        self.move(self.supplier, self.shop, "filled", 3, note="Received refilled cylinders")
        self.move(self.supplier, self.shop, "filled", 1, note="Received refilled cylinders - batch 7")
        self.assertEqual(self.stock_qty(self.shop, Stock.Status.FILLED), 14)
        # The supplier now owes nothing, so a further receipt is refused.
        self.move(self.supplier, self.shop, "filled", 1, note="Received refilled cylinders", expect=400)


class CustomerEditingWorkflowTests(GasBookTestCase):
    """Customers.tsx: edit contact details, global discount and per-cylinder discounts."""

    def setUp(self):
        super().setUp()
        self.auth(self.admin)

    def test_edit_contact_details(self):
        response = self.client.patch(f"/api/customers/{self.customer.pk}/", {
            "name": "Cust Renamed", "phone": "9333333333", "email": "c@example.com", "address": "9 Hill Road",
        }, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.customer_user.refresh_from_db()
        self.assertEqual((self.customer_user.get_full_name(), self.customer_user.phone), ("Cust Renamed", "9333333333"))

    def test_edit_global_discount(self):
        response = self.client.patch(f"/api/customers/{self.customer.pk}/", {
            "global_discount_type": "percentage", "global_discount_value": "10", "global_discount_is_active": True,
        }, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.customer.refresh_from_db()
        self.assertEqual((self.customer.global_discount_type, self.customer.global_discount_is_active), ("percentage", True))

    def test_manage_cylinder_discounts(self):
        created = self.client.post("/api/customer-cylinder-discounts/", {
            "customer": self.customer.pk, "cylinder_type": self.cylinder.pk, "discount_type": "fixed",
            "discount_value": "50", "is_active": True,
        }, format="json")
        self.assertEqual(created.status_code, 201, created.data)
        url = f"/api/customer-cylinder-discounts/{created.data['id']}/"
        self.assertEqual(self.client.patch(url, {"discount_value": "75"}, format="json").status_code, 200)
        self.assertEqual(self.client.delete(url).status_code, 204)
        self.assertFalse(CustomerCylinderDiscount.objects.exists())


class StaffAndCustomerAppWorkflowTests(GasBookTestCase):
    def test_staff_completion_still_records_the_sale_and_payment(self):
        """StaffMobileLayout payload. Staff cannot use /sales/ or /payments/ directly, but
        completing a delivery still creates both."""
        self.set_stock(self.shop, filled=3)
        booking, delivery = self.assigned_booking(self.staff_a, delivery_status=Delivery.Status.OUT_FOR_DELIVERY,
                                                  booking_status=Booking.Status.OUT_FOR_DELIVERY, quantity=1)
        self.auth(self.staff_a)
        response = self.client.post(f"/api/deliveries/{delivery.id}/complete/",
                                    {"payment_method": "cash", "empty_collected": 1, "payment_collected": "900.00"}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        sale = Sale.objects.get()
        self.assertEqual((sale.sold_by, sale.paid_amount), (self.staff_a, Decimal("900.00")))
        self.assertEqual(Payment.objects.get().received_by, self.staff_a)
        self.assertEqual(self.client.get("/api/sales/").status_code, 403)
        self.assertEqual(integrity.violations(), [])

    def test_staff_completion_of_a_non_cod_order_records_gpay(self):
        """StaffMobileLayout sends payment_method 'gpay' for orders that are not cash on delivery."""
        self.set_stock(self.shop, filled=1)
        booking = self.make_booking(status=Booking.Status.OUT_FOR_DELIVERY, assigned_staff=self.staff_a, quantity=1,
                                    payment_method="ONLINE")
        delivery = self.make_delivery(booking, self.staff_a, status=Delivery.Status.OUT_FOR_DELIVERY)
        self.auth(self.staff_a)
        response = self.client.post(f"/api/deliveries/{delivery.id}/complete/",
                                    {"payment_method": "gpay", "empty_collected": 1, "payment_collected": "900.00"}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        booking.refresh_from_db()
        self.assertEqual((Sale.objects.get().payment_mode, Payment.objects.get().payment_mode, booking.payment_status),
                         ("gpay", "gpay", "PAID"))
        self.assertEqual(integrity.violations(), [])

    def test_customer_profile_and_history(self):
        """gasbook-customer: profile load and update, then order history including a direct sale."""
        self.set_stock(self.shop, filled=2)
        self.auth(self.admin)
        sale_response = self.client.post("/api/sales/", {
            "client_ref": str(uuid.uuid4()),
            "customer": self.customer.id, "location": self.shop.id, "payment_mode": "cash", "paid_amount": 900,
            "sale_items": [{"cylinder_type": self.cylinder.id, "quantity": 1, "rate": "900", "empty_returned": 1}],
        }, format="json")
        self.assertEqual(sale_response.status_code, 201, sale_response.data)

        self.auth(self.customer_user)
        self.assertEqual(self.client.get("/api/customers/me/").status_code, 200)
        updated = self.client.patch(f"/api/customers/{self.customer.pk}/", {
            "name": "Cust One", "phone": "9000000004", "email": "me@example.com", "address": "12 Main Street",
        }, format="json")
        self.assertEqual(updated.status_code, 200, updated.data)
        self.assertEqual(CustomerProfile.objects.get(pk=self.customer.pk).user.email, "me@example.com")
        history = self.client.get("/api/bookings/history/")
        self.assertEqual(history.status_code, 200)
        self.assertIn(("sale", sale_response.data["id"]), [(e["history_source"], e["source_id"]) for e in history.data["results"]])
