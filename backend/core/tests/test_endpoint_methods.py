"""Records change only through their workflow actions.

The generic create/update/delete routes of /api/bookings/ and /api/deliveries/ are not used
by the admin, staff or customer apps; leaving them open let a staff member mark their own
delivery delivered (no sale, no stock) or hand it to someone else, and let a customer delete
an approved booking or create one already approved — all without an ActivityLog entry.

The same holds for sales, payments, stock and stock movements: editing or deleting them
through the API (or Django admin) moved debt between customers, left stock unrestored and
put payments out of step with their sales. Sales, payments, stock movements, the customer
ledger and the dashboard are admin-only; staff change only a customer's contact details and
area. Delivery completion must name how collected money was paid, and locations or cylinder
types still holding stock cannot be deleted.
"""
import uuid

from django.test import Client

from core import integrity
from core.models import (
    ActivityLog, Booking, CustomerProfile, CylinderType, Delivery, Payment, Sale, SaleItem, Stock, StockLocation,
    StockMovement, User,
)

from .base import PASSWORD, GasBookTestCase


class DeliveryGenericWriteTests(GasBookTestCase):
    def setUp(self):
        super().setUp()
        self.booking, self.delivery = self.assigned_booking(staff=self.staff_a)
        self.other_booking = self.make_booking()

    def assert_untouched(self):
        self.delivery.refresh_from_db()
        self.assertEqual((self.delivery.staff_id, self.delivery.status), (self.staff_a.id, Delivery.Status.ASSIGNED))
        self.assertFalse(Delivery.objects.filter(booking=self.other_booking).exists())
        self.assertFalse(ActivityLog.objects.exists())

    def generic_writes(self):
        detail = f"/api/deliveries/{self.delivery.pk}/"
        payload = {"booking": self.other_booking.pk, "staff": self.staff_b.pk, "status": "delivered"}
        return [
            self.client.post("/api/deliveries/", payload, format="json"),
            self.client.put(detail, payload, format="json"),
            self.client.patch(detail, {"staff": self.staff_b.pk, "status": "delivered"}, format="json"),
            self.client.delete(detail),
        ]

    def test_staff_cannot_create_edit_or_delete_deliveries(self):
        self.auth(self.staff_a)
        self.assertEqual([r.status_code for r in self.generic_writes()], [405, 405, 405, 405])
        self.assert_untouched()

    def test_admin_cannot_bypass_approve_either(self):
        self.auth(self.admin)
        self.assertEqual([r.status_code for r in self.generic_writes()], [405, 405, 405, 405])
        self.assert_untouched()

    def test_customer_is_still_forbidden(self):
        self.auth(self.customer_user)
        self.assertEqual([r.status_code for r in self.generic_writes()], [403, 403, 403, 403])
        self.assert_untouched()


class BookingGenericWriteTests(GasBookTestCase):
    def setUp(self):
        super().setUp()
        self.booking, self.delivery = self.assigned_booking(staff=self.staff_a)

    def test_put_patch_delete_rejected_for_every_role(self):
        detail = f"/api/bookings/{self.booking.pk}/"
        for user in (self.customer_user, self.staff_a, self.admin):
            self.auth(user)
            responses = [
                self.client.put(detail, {"cylinder_type": self.cylinder.pk, "quantity": 9, "status": "delivered"}, format="json"),
                self.client.patch(detail, {"status": "delivered", "assigned_staff": self.staff_b.pk}, format="json"),
                self.client.delete(detail),
            ]
            self.assertEqual([r.status_code for r in responses], [405, 405, 405], user.username)
        self.booking.refresh_from_db()
        self.assertEqual(
            (self.booking.status, self.booking.assigned_staff_id, self.booking.quantity),
            (Booking.Status.APPROVED, self.staff_a.id, 2),
        )
        self.assertTrue(Delivery.objects.filter(pk=self.delivery.pk).exists())

    def test_customer_create_ignores_workflow_fields(self):
        self.auth(self.customer_user)
        response = self.client.post(
            "/api/bookings/",
            {
                "cylinder_type": self.cylinder.pk,
                "quantity": 1,
                "status": "approved",
                "assigned_staff": self.staff_a.pk,
                "payment_status": "PAID",
                "rejection_reason": "x",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        booking = Booking.objects.get(pk=response.data["id"])
        self.assertEqual(
            (booking.status, booking.assigned_staff_id, booking.payment_status, booking.rejection_reason),
            (Booking.Status.PENDING, None, "PENDING", None),
        )
        self.assertFalse(Delivery.objects.filter(booking=booking).exists())

    def test_customer_app_checkout_payload_still_works(self):
        """Exact payload of gasbook-customer CheckoutView / DesktopCheckoutView."""
        self.auth(self.customer_user)
        response = self.client.post(
            "/api/bookings/",
            {
                "cylinder_type": self.cylinder.pk,
                "quantity": 2,
                "note": "Order via Customer App (COD)",
                "payment_method": "COD",
                "payment_status": "PENDING",
                "delivery_address": "5 Lake Road",
                "delivery_phone": "9000000099",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        booking = Booking.objects.get(pk=response.data["id"])
        self.assertEqual(
            (booking.status, booking.quantity, booking.note, booking.payment_method, booking.payment_status,
             booking.delivery_address, booking.delivery_phone),
            ("pending", 2, "Order via Customer App (COD)", "COD", "PENDING", "5 Lake Road", "9000000099"),
        )

    def test_staff_and_admin_still_cannot_create_bookings(self):
        for user in (self.staff_a, self.admin):
            self.auth(user)
            response = self.client.post("/api/bookings/", {"cylinder_type": self.cylinder.pk, "quantity": 1}, format="json")
            self.assertEqual(response.status_code, 403, user.username)


class SupportedWorkflowTests(GasBookTestCase):
    """Every booking/delivery call the three apps make still works end to end."""

    def test_order_lifecycle(self):
        self.set_stock(self.shop, filled=5)
        self.auth(self.customer_user)
        preview = self.client.post("/api/bookings/preview/", {"items": [{"cylinder_type": self.cylinder.pk, "quantity": 1}]}, format="json")
        self.assertEqual(preview.status_code, 200, preview.data)
        created = self.client.post("/api/bookings/", {"cylinder_type": self.cylinder.pk, "quantity": 1}, format="json")
        self.assertEqual(created.status_code, 201, created.data)
        booking_id = created.data["id"]

        self.auth(self.admin)
        self.assertIn(booking_id, [b["id"] for b in self.client.get("/api/bookings/", {"status": "pending"}).data["results"]])
        approve = self.client.post(f"/api/bookings/{booking_id}/approve/", {"assigned_staff": self.staff_a.pk}, format="json")
        self.assertEqual(approve.status_code, 200, approve.data)

        self.auth(self.staff_a)
        deliveries = self.client.get("/api/deliveries/").data["results"]
        delivery_id = next(d["id"] for d in deliveries if d["booking"] == booking_id)
        self.assertEqual(self.client.get(f"/api/deliveries/{delivery_id}/").status_code, 200)
        self.assertEqual(self.client.get("/api/bookings/").status_code, 200)
        for action in ("accept", "start"):
            self.assertEqual(self.client.post(f"/api/deliveries/{delivery_id}/{action}/").status_code, 200, action)
        complete = self.client.post(f"/api/deliveries/{delivery_id}/complete/",
                                    {"payment_method": "cash", "empty_collected": 1, "payment_collected": "900"}, format="json")
        self.assertEqual(complete.status_code, 200, complete.data)

        self.auth(self.customer_user)
        detail = self.client.get(f"/api/bookings/{booking_id}/")
        self.assertEqual((detail.status_code, detail.data["status"]), (200, "delivered"))
        history = self.client.get("/api/bookings/history/")
        self.assertIn(booking_id, [row["id"] for row in history.data["results"]])

    def test_decline_and_admin_reject(self):
        booking = self.make_booking()
        self.auth(self.admin)
        self.client.post(f"/api/bookings/{booking.pk}/approve/", {"assigned_staff": self.staff_a.pk}, format="json")
        delivery = Delivery.objects.get(booking=booking)
        self.auth(self.staff_a)
        self.assertEqual(self.client.post(f"/api/deliveries/{delivery.pk}/reject/", {"reason": "Busy"}, format="json").status_code, 200)
        self.auth(self.admin)
        self.assertEqual(self.client.post(f"/api/bookings/{booking.pk}/reject/", {"reason": "No stock"}, format="json").status_code, 200)


class ActivityLogAdminTests(GasBookTestCase):
    def setUp(self):
        super().setUp()
        self.superuser = User.objects.create_superuser(username="root", password=PASSWORD, email="root@example.com")
        self.browser = Client()
        self.browser.force_login(self.superuser)
        self.log = ActivityLog.objects.create(action="booking_approved", description="Assigned", user=self.admin, metadata={"booking_id": 1})

    def test_log_is_view_only(self):
        base = "/admin/core/activitylog/"
        self.assertEqual(self.browser.get(base).status_code, 200)
        self.assertEqual(self.browser.get(f"{base}{self.log.pk}/change/").status_code, 200)
        self.assertEqual(self.browser.get(f"{base}add/").status_code, 403)
        self.assertEqual(self.browser.post(f"{base}{self.log.pk}/change/", {"action": "edited", "description": "x"}).status_code, 403)
        self.assertEqual(self.browser.post(f"{base}{self.log.pk}/delete/", {"post": "yes"}).status_code, 403)
        self.log.refresh_from_db()
        self.assertEqual(self.log.action, "booking_approved")

    def test_deleting_a_user_from_admin_still_keeps_their_log_rows(self):
        temp = User.objects.create_user(username="temp", password=PASSWORD)
        ActivityLog.objects.create(action="stock_moved", description="Moved", user=temp)
        url = f"/admin/core/user/{temp.pk}/delete/"
        self.assertFalse(self.browser.get(url).context["perms_lacking"])
        self.assertEqual(self.browser.post(url, {"post": "yes"}).status_code, 302)
        self.assertFalse(User.objects.filter(pk=temp.pk).exists())
        self.assertTrue(ActivityLog.objects.filter(action="stock_moved", user__isnull=True).exists())


class UnchangedMixin:
    def assert_unchanged(self, before):
        self.assertEqual(integrity.compare_fingerprints(before, integrity.fingerprint()), [])


class SaleAndPaymentRouteTests(UnchangedMixin, GasBookTestCase):
    """Admin-only, and never edited or deleted through the API."""

    def setUp(self):
        super().setUp()
        self.set_stock(self.shop, filled=5)
        self.auth(self.admin)
        response = self.client.post("/api/sales/", self.sale_payload(), format="json")
        self.assertEqual(response.status_code, 201, response.data)
        self.sale = Sale.objects.get(pk=response.data["id"])
        self.payment = Payment.objects.get(sale=self.sale)

    def sale_payload(self):
        return {
            "client_ref": str(uuid.uuid4()),
            "customer": self.customer.id, "location": self.shop.id, "payment_mode": "credit",
            "paid_amount": "300", "paid_payment_mode": "cash",
            "sale_items": [{"cylinder_type": self.cylinder.id, "quantity": 1, "rate": "900", "empty_returned": 0}],
        }

    def edits(self):
        sale_url, payment_url = f"/api/sales/{self.sale.pk}/", f"/api/payments/{self.payment.pk}/"
        return [
            self.client.put(sale_url, {**self.sale_payload(), "paid_amount": "0"}, format="json"),
            self.client.patch(sale_url, {"customer": self.staff_b.id, "paid_amount": "0"}, format="json"),
            self.client.delete(sale_url),
            self.client.put(payment_url, {"customer": self.customer.id, "amount": "1", "payment_mode": "cash"}, format="json"),
            self.client.patch(payment_url, {"amount": "1"}, format="json"),
            self.client.delete(payment_url),
        ]

    def test_admin_cannot_edit_or_delete_sales_or_payments(self):
        before = integrity.fingerprint()
        self.auth(self.admin)
        self.assertEqual([r.status_code for r in self.edits()], [405] * 6)
        self.assert_unchanged(before)

    def test_admin_can_still_list_and_read(self):
        self.auth(self.admin)
        for url in ("/api/sales/", f"/api/sales/{self.sale.pk}/", "/api/payments/", f"/api/payments/{self.payment.pk}/"):
            self.assertEqual(self.client.get(url).status_code, 200, url)

    def test_staff_and_customers_have_no_access(self):
        before = integrity.fingerprint()
        for user in (self.staff_a, self.customer_user):
            self.auth(user)
            responses = [
                self.client.get("/api/sales/"),
                self.client.get(f"/api/sales/{self.sale.pk}/"),
                self.client.post("/api/sales/", self.sale_payload(), format="json"),
                self.client.get("/api/payments/"),
                self.client.get(f"/api/payments/{self.payment.pk}/"),
                self.client.post("/api/payments/", {"customer": self.customer.id, "amount": "100", "payment_mode": "cash"}, format="json"),
                *self.edits(),
            ]
            self.assertEqual({r.status_code for r in responses}, {403}, user.username)
        self.assert_unchanged(before)


class StockRouteTests(UnchangedMixin, GasBookTestCase):
    def setUp(self):
        super().setUp()
        self.row = self.set_stock(self.shop, filled=5, empty=2)["filled"]

    def test_stock_is_read_only_for_admin_and_staff(self):
        before = integrity.fingerprint()
        detail = f"/api/stock/{self.row.pk}/"
        payload = {"cylinder_type": self.cylinder.id, "location": self.shop.id, "status": "filled", "quantity": 999}
        for user in (self.admin, self.staff_a):
            self.auth(user)
            self.assertEqual(self.client.get("/api/stock/").status_code, 200)
            self.assertEqual(self.client.get(detail).status_code, 200)
            writes = [
                self.client.post("/api/stock/", payload, format="json"),
                self.client.put(detail, payload, format="json"),
                self.client.patch(detail, {"quantity": 999}, format="json"),
                self.client.delete(detail),
            ]
            self.assertEqual([r.status_code for r in writes], [405] * 4, user.username)
        self.assert_unchanged(before)

    def test_customers_cannot_read_stock(self):
        self.auth(self.customer_user)
        self.assertEqual(self.client.get("/api/stock/").status_code, 403)


class StockMovementRouteTests(UnchangedMixin, GasBookTestCase):
    def setUp(self):
        super().setUp()
        self.kandam = StockLocation.objects.create(name="Kandam", code="kandam")
        self.supplier = StockLocation.objects.create(name="Supplier", code="supplier")
        self.set_stock(self.shop, filled=5)
        self.auth(self.admin)
        response = self.client.post("/api/movements/", self.transfer(2), format="json")
        self.assertEqual(response.status_code, 201, response.data)
        self.movement = StockMovement.objects.get(pk=response.data["id"])

    def transfer(self, quantity):
        return {"cylinder_type": self.cylinder.id, "from_location": self.shop.id, "to_location": self.kandam.id,
                "status": "filled", "quantity": quantity}

    def all_calls(self):
        detail = f"/api/movements/{self.movement.pk}/"
        supplier_load = {"cylinder_type": self.cylinder.id, "from_location": self.supplier.id, "to_location": self.shop.id,
                         "status": "filled", "quantity": 500, "note": "New supplier load"}
        return [
            self.client.get("/api/movements/"),
            self.client.get(detail),
            self.client.get("/api/movements/supplier_pending/"),
            self.client.post("/api/movements/", self.transfer(1), format="json"),
            self.client.post("/api/movements/", supplier_load, format="json"),
            self.client.put(detail, self.transfer(5), format="json"),
            self.client.patch(detail, {"quantity": 5}, format="json"),
            self.client.delete(detail),
        ]

    def test_admin_cannot_edit_or_delete_movements(self):
        before = integrity.fingerprint()
        detail = f"/api/movements/{self.movement.pk}/"
        writes = [
            self.client.put(detail, self.transfer(5), format="json"),
            self.client.patch(detail, {"quantity": 5}, format="json"),
            self.client.delete(detail),
        ]
        self.assertEqual([r.status_code for r in writes], [405] * 3)
        self.assert_unchanged(before)

    def test_admin_can_still_record_and_read_movements(self):
        response = self.client.post("/api/movements/", self.transfer(1), format="json")
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual((self.stock_qty(self.shop, Stock.Status.FILLED), self.stock_qty(self.kandam, Stock.Status.FILLED)), (2, 3))
        for url in ("/api/movements/", f"/api/movements/{self.movement.pk}/", "/api/movements/supplier_pending/"):
            self.assertEqual(self.client.get(url).status_code, 200, url)

    def test_staff_and_customers_cannot_read_or_record_movements(self):
        """Intentional: a supplier load would let staff add unlimited filled stock."""
        before = integrity.fingerprint()
        for user in (self.staff_a, self.customer_user):
            self.auth(user)
            self.assertEqual({r.status_code for r in self.all_calls()}, {403}, user.username)
        self.assert_unchanged(before)


class StockLocationRouteTests(UnchangedMixin, GasBookTestCase):
    def test_staff_can_read_but_not_change_locations(self):
        before = integrity.fingerprint()
        detail = f"/api/locations/{self.shop.pk}/"
        self.auth(self.staff_a)
        self.assertEqual(self.client.get("/api/locations/").status_code, 200)
        self.assertEqual(self.client.get(detail).status_code, 200)
        writes = [
            self.client.post("/api/locations/", {"name": "Van", "code": "van"}, format="json"),
            self.client.put(detail, {"name": "Shop", "code": "shop", "is_main_supplier": True}, format="json"),
            self.client.patch(detail, {"is_active": False}, format="json"),
            self.client.delete(detail),
        ]
        self.assertEqual([r.status_code for r in writes], [403] * 4)
        self.assert_unchanged(before)

    def test_admin_can_still_manage_locations(self):
        self.auth(self.admin)
        self.assertEqual(self.client.post("/api/locations/", {"name": "Van", "code": "van"}, format="json").status_code, 201)
        self.assertEqual(self.client.patch(f"/api/locations/{self.shop.pk}/", {"name": "Main shop"}, format="json").status_code, 200)
        self.shop.refresh_from_db()
        self.assertEqual(self.shop.name, "Main shop")

    def test_customers_cannot_read_locations(self):
        self.auth(self.customer_user)
        self.assertEqual(self.client.get("/api/locations/").status_code, 403)


class CustomerFieldPermissionTests(UnchangedMixin, GasBookTestCase):
    def sensitive_fields(self):
        return {
            "opening_balance": "5000.00",
            "credit_limit": "9000.00",
            "global_discount_type": "percentage",
            "global_discount_value": "50",
            "global_discount_is_active": True,
            "default_staff": self.staff_b.id,
            "deposit_cylinders": 3,
            "user": self.staff_b.id,
        }

    def patch(self, data):
        return self.client.patch(f"/api/customers/{self.customer.pk}/", data, format="json")

    def test_staff_cannot_change_any_sensitive_field(self):
        before = integrity.fingerprint()
        self.auth(self.staff_a)
        for field, value in self.sensitive_fields().items():
            with self.subTest(field=field):
                response = self.patch({field: value})
                self.assertEqual(response.status_code, 403, response.data)
                self.assertEqual((response.data["code"], response.data["fields"]), ("forbidden_fields", [field]))
        self.assert_unchanged(before)

    def test_staff_request_mixing_allowed_and_sensitive_fields_changes_nothing(self):
        before = integrity.fingerprint()
        self.auth(self.staff_a)
        response = self.patch({"name": "Renamed Customer", "opening_balance": "1.00", "credit_limit": "2.00"})
        self.assertEqual(response.status_code, 403, response.data)
        self.assertEqual(response.data["fields"], ["credit_limit", "opening_balance"])
        self.assert_unchanged(before)

    def test_staff_can_change_contact_details_and_area(self):
        self.auth(self.staff_a)
        response = self.patch({"name": "New Name", "phone": "9111111111", "email": "new@example.com",
                               "address": "7 New Road", "area": "North"})
        self.assertEqual(response.status_code, 200, response.data)
        self.customer.refresh_from_db()
        self.customer_user.refresh_from_db()
        self.assertEqual(
            (self.customer_user.get_full_name(), self.customer_user.phone, self.customer_user.email,
             self.customer_user.address, self.customer.area),
            ("New Name", "9111111111", "new@example.com", "7 New Road", "North"),
        )

    def test_admin_can_still_change_financial_fields(self):
        self.auth(self.admin)
        fields = {key: value for key, value in self.sensitive_fields().items() if key != "user"}
        response = self.patch(fields)
        self.assertEqual(response.status_code, 200, response.data)
        self.customer.refresh_from_db()
        self.assertEqual(
            (str(self.customer.opening_balance), str(self.customer.credit_limit), self.customer.global_discount_type,
             self.customer.global_discount_is_active, self.customer.default_staff_id, self.customer.deposit_cylinders),
            ("5000.00", "9000.00", "percentage", True, self.staff_b.id, 3),
        )

    def test_linked_user_is_never_repointed(self):
        self.auth(self.admin)
        self.assertEqual(self.patch({"user": self.staff_b.id}).status_code, 200)
        self.assertEqual(CustomerProfile.objects.get(pk=self.customer.pk).user_id, self.customer_user.id)

    def test_bodies_that_are_not_objects_get_400_not_500(self):
        before = integrity.fingerprint()
        url = f"/api/customers/{self.customer.pk}/"
        for user in (self.staff_a, self.customer_user, self.admin):
            self.auth(user)
            for body in ([{"name": "x"}], 5, "name"):
                for method in (self.client.patch, self.client.put):
                    with self.subTest(user=user.username, body=body, method=method.__name__):
                        response = method(url, body, format="json")
                        self.assertEqual(response.status_code, 400, response.data)
                        self.assertEqual(response.data["code"], "invalid")
        self.assert_unchanged(before)


class LedgerAndDashboardAccessTests(GasBookTestCase):
    def test_staff_cannot_open_the_ledger_or_dashboard(self):
        self.auth(self.staff_a)
        self.assertEqual(self.client.get(f"/api/customers/{self.customer.pk}/ledger/").status_code, 403)
        self.assertEqual(self.client.get("/api/dashboard/").status_code, 403)

    def test_customers_cannot_open_even_their_own_ledger(self):
        self.auth(self.customer_user)
        self.assertEqual(self.client.get(f"/api/customers/{self.customer.pk}/ledger/").status_code, 403)
        self.assertEqual(self.client.get("/api/dashboard/").status_code, 403)

    def test_admin_still_can(self):
        self.auth(self.admin)
        self.assertEqual(self.client.get(f"/api/customers/{self.customer.pk}/ledger/").status_code, 200)
        self.assertEqual(self.client.get("/api/dashboard/").status_code, 200)


class FinancialRecordAdminTests(UnchangedMixin, GasBookTestCase):
    """Django admin can view sales, payments and stock but not add, change or delete them."""

    def setUp(self):
        super().setUp()
        self.superuser = User.objects.create_superuser(username="root", password=PASSWORD, email="root@example.com")
        self.browser = Client()
        self.browser.force_login(self.superuser)
        kandam = StockLocation.objects.create(name="Kandam", code="kandam")
        stock = self.set_stock(self.shop, filled=5)["filled"]
        sale = Sale.objects.create(customer=self.customer, location=self.shop, total_amount=900, paid_amount=900,
                                   payment_mode=Sale.PaymentMode.CASH, sold_by=self.admin)
        item = SaleItem.objects.create(sale=sale, cylinder_type=self.cylinder, quantity=1, rate=900, total_amount=900)
        payment = Payment.objects.create(customer=self.customer, sale=sale, amount=900, received_by=self.admin)
        movement = StockMovement.objects.create(cylinder_type=self.cylinder, from_location=self.shop, to_location=kandam,
                                                status="filled", quantity=1, moved_by=self.admin)
        self.records = {"sale": sale, "saleitem": item, "payment": payment, "stock": stock, "stockmovement": movement}

    def test_sales_payments_and_stock_are_view_only(self):
        # The login above updated last_login; measure from here.
        before = integrity.fingerprint()
        for name, obj in self.records.items():
            with self.subTest(model=name):
                base = f"/admin/core/{name}/"
                self.assertEqual(self.browser.get(base).status_code, 200)
                self.assertEqual(self.browser.get(f"{base}{obj.pk}/change/").status_code, 200)
                self.assertEqual(self.browser.get(f"{base}add/").status_code, 403)
                self.assertEqual(self.browser.post(f"{base}{obj.pk}/change/", {}).status_code, 403)
                self.assertEqual(self.browser.post(f"{base}{obj.pk}/delete/", {"post": "yes"}).status_code, 403)
        self.assert_unchanged(before)

    def test_locations_stay_editable_in_admin(self):
        self.assertEqual(self.browser.get("/admin/core/stocklocation/add/").status_code, 200)


class DeliveryPaymentMethodTests(UnchangedMixin, GasBookTestCase):
    """Collected money must say how it was paid (cash, gpay or bank), checked before any write."""

    def setUp(self):
        super().setUp()
        self.set_stock(self.shop, filled=5)
        self.booking, self.delivery = self.assigned_booking(self.staff_a, quantity=1)  # total 900
        self.auth(self.staff_a)

    def complete(self, payload, delivery=None):
        return self.client.post(f"/api/deliveries/{(delivery or self.delivery).id}/complete/", payload, format="json")

    def test_missing_or_invalid_methods_are_rejected_before_any_write(self):
        before = integrity.fingerprint()
        cases = [
            ({"payment_collected": "900"}, "required", "payment_method"),
            ({"payment_collected": "400"}, "required", "payment_method"),
            ({"payment_collected": "900", "payment_method": "bitcoin"}, "invalid", "payment_method"),
            ({"payment_collected": "900", "payment_method": "COD"}, "invalid", "payment_method"),
            ({"payment_collected": "900", "payment_method": "credit"}, "invalid", "payment_method"),
            ({"payment_collected": "900", "payment_method": "split"}, "invalid", "payment_method"),
            ({"payment_collected": "0", "payment_method": "bitcoin"}, "invalid", "payment_method"),
            ({"split_payments": [{"amount": "900"}]}, "invalid", "split_payments"),
            ({"split_payments": [{"amount": "900", "mode": "credit"}]}, "invalid", "split_payments"),
        ]
        for payload, code, field in cases:
            with self.subTest(payload=payload):
                response = self.complete(payload)
                self.assertEqual(response.status_code, 400, response.data)
                self.assertEqual((response.data["code"], response.data["field"]), (code, field))
        self.assert_unchanged(before)

    def test_every_receipt_mode_is_recorded(self):
        for mode in ("cash", "gpay", "bank"):
            with self.subTest(mode=mode):
                booking, delivery = self.assigned_booking(self.staff_a, quantity=1)
                response = self.complete({"payment_method": mode, "empty_collected": 1, "payment_collected": "900"}, delivery)
                self.assertEqual(response.status_code, 200, response.data)
                sale = Sale.objects.get(booking=booking)
                delivery.refresh_from_db()
                self.assertEqual((sale.payment_mode, Payment.objects.get(sale=sale).payment_mode, delivery.payment_method),
                                 (mode, mode, mode))
        self.assertEqual(integrity.violations(), [])

    def test_partial_collection_records_the_given_method(self):
        response = self.complete({"payment_collected": "400", "payment_method": "gpay"})
        self.assertEqual(response.status_code, 200, response.data)
        sale = Sale.objects.get(booking=self.booking)
        self.assertEqual((sale.payment_mode, sale.balance_due), ("credit", 500))
        self.assertEqual(list(Payment.objects.values_list("payment_mode", "amount")), [("gpay", 400)])

    def test_nothing_collected_needs_no_method(self):
        response = self.complete({"payment_collected": "0"})
        self.assertEqual(response.status_code, 200, response.data)
        self.delivery.refresh_from_db()
        self.assertEqual((Sale.objects.get(booking=self.booking).payment_mode, self.delivery.payment_method), ("credit", "credit"))
        self.assertFalse(Payment.objects.exists())
        self.assertEqual(integrity.violations(), [])


class StockHoldingDeletionTests(GasBookTestCase):
    """Deleting a location or cylinder type would cascade to its stock rows and erase them."""

    def setUp(self):
        super().setUp()
        self.van = StockLocation.objects.create(name="Van", code="van")
        self.auth(self.admin)

    def stock_total(self, location=None, cylinder=None):
        rows = Stock.objects.filter(location=location or self.van, cylinder_type=cylinder or self.cylinder)
        return sum(rows.values_list("quantity", flat=True))

    def test_location_holding_filled_or_empty_cylinders_is_refused(self):
        for filled, empty in ((3, 0), (0, 2)):
            with self.subTest(filled=filled, empty=empty):
                self.set_stock(self.van, filled=filled, empty=empty)
                response = self.client.delete(f"/api/locations/{self.van.pk}/")
                self.assertEqual(response.status_code, 409, response.data)
                self.assertEqual((response.data["code"], response.data["filled"], response.data["empty"]), ("has_stock", filled, empty))
                self.assertIn("deactivate the location", response.data["detail"])
                self.assertEqual(self.stock_total(), filled + empty)

    def test_location_with_only_zero_rows_can_be_deleted(self):
        self.set_stock(self.van, filled=0, empty=0)
        self.assertEqual(self.client.delete(f"/api/locations/{self.van.pk}/").status_code, 204)
        self.assertFalse(StockLocation.objects.filter(pk=self.van.pk).exists())

    def test_cylinder_type_holding_filled_or_empty_cylinders_is_refused(self):
        for filled, empty in ((4, 0), (0, 1)):
            with self.subTest(filled=filled, empty=empty):
                self.set_stock(self.van, filled=filled, empty=empty)
                response = self.client.delete(f"/api/cylinder-types/{self.cylinder.pk}/")
                self.assertEqual(response.status_code, 409, response.data)
                self.assertEqual((response.data["code"], response.data["filled"], response.data["empty"]), ("has_stock", filled, empty))
                self.assertIn("deactivate the cylinder type", response.data["detail"])
                self.assertEqual(self.stock_total(), filled + empty)

    def test_cylinder_type_with_only_zero_rows_can_be_deleted(self):
        spare = CylinderType.objects.create(name="19kg", weight=19, selling_price=1650)
        self.set_stock(self.van, filled=0, empty=0, cylinder=spare)
        self.assertEqual(self.client.delete(f"/api/cylinder-types/{spare.pk}/").status_code, 204)
        self.assertFalse(CylinderType.objects.filter(pk=spare.pk).exists())

    def test_staff_cannot_delete_either(self):
        self.auth(self.staff_a)
        self.assertEqual(self.client.delete(f"/api/locations/{self.van.pk}/").status_code, 403)
        self.assertEqual(self.client.delete(f"/api/cylinder-types/{self.cylinder.pk}/").status_code, 403)
