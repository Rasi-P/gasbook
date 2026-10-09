"""Booking/Delivery records change only through their workflow actions.

The generic create/update/delete routes of /api/bookings/ and /api/deliveries/ are not used
by the admin, staff or customer apps; leaving them open let a staff member mark their own
delivery delivered (no sale, no stock) or hand it to someone else, and let a customer delete
an approved booking or create one already approved — all without an ActivityLog entry.
"""
from django.test import Client

from core.models import ActivityLog, Booking, Delivery, User

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
        complete = self.client.post(f"/api/deliveries/{delivery_id}/complete/", {"payment_collected": "900"}, format="json")
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
