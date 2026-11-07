from core.models import Booking, Notification

from .base import GasBookTestCase


class BookingCreateNotificationTests(GasBookTestCase):
    def test_long_address_truncates_admin_notification(self):
        self.auth(self.customer_user)
        response = self.client.post(
            "/api/bookings/",
            {"cylinder_type": self.cylinder.id, "quantity": 1, "delivery_address": "A" * 500},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        booking = Booking.objects.get(id=response.data["id"])
        admin_note = self.notifications(self.admin, "ORDER_PLACED", booking).get()
        self.assertLessEqual(len(admin_note.body), 300)
        self.assertTrue(admin_note.body.endswith("…"))
        self.assertEqual(self.notifications(self.customer_user, "ORDER_PLACED", booking).count(), 1)
        self.assertEqual(response.data["delivery_status"], None)
        self.assertFalse(response.data["needs_reassignment"])

    def test_non_customer_cannot_create_booking(self):
        self.auth(self.staff_a)
        response = self.client.post("/api/bookings/", {"cylinder_type": self.cylinder.id, "quantity": 1}, format="json")
        self.assertEqual(response.status_code, 403)
        self.assertEqual(Notification.objects.count(), 0)


class DeliverySerializerTests(GasBookTestCase):
    def test_order_id_uses_booking_pk(self):
        # a booking rejected before approval never gets a Delivery, so pks diverge
        self.make_booking(status=Booking.Status.REJECTED)
        booking, delivery = self.assigned_booking(self.staff_a)
        self.assertNotEqual(booking.pk, delivery.pk)

        self.auth(self.staff_a)
        response = self.client.get("/api/deliveries/")
        self.assertEqual(response.status_code, 200)
        row = response.data["results"][0]
        self.assertEqual(row["order_id"], f"GB{booking.pk}")
        self.assertEqual(row["order_id"], f"GB{row['booking']}")
        self.assertNotEqual(row["order_id"], f"GB{row['id']}")

        response = self.client.post(f"/api/deliveries/{delivery.id}/accept/", {}, format="json")
        self.assertEqual(response.data["order_id"], f"GB{booking.pk}")
