from core.models import ActivityLog, Booking, Delivery, Notification

from .base import GasBookTestCase


class AdminRejectTests(GasBookTestCase):
    def reject(self, booking, reason="Out of service area"):
        self.auth(self.admin)
        payload = {"reason": reason} if reason is not None else {}
        return self.client.post(f"/api/bookings/{booking.id}/reject/", payload, format="json")

    def test_reject_pending_sets_fields_once(self):
        booking = self.make_booking()
        response = self.reject(booking)
        self.assertEqual(response.status_code, 200, response.data)
        booking.refresh_from_db()
        self.assertEqual(booking.status, Booking.Status.REJECTED)
        self.assertEqual(booking.rejection_reason, "Out of service area")
        self.assertEqual(booking.rejected_by, self.admin)
        self.assertEqual(booking.rejected_by_role, "admin")
        self.assertIsNotNone(booking.rejected_at)
        self.assertEqual(self.notifications(self.customer_user, "ORDER_REJECTED", booking).count(), 1)
        self.assertEqual(response.data["rejected_by_role"], "admin")
        self.assertTrue(ActivityLog.objects.filter(action="booking_rejected", metadata__booking_id=booking.id).exists())

        second = self.reject(booking, "again")
        self.assertEqual(second.status_code, 400)
        self.assertEqual(second.data["code"], "invalid_state")
        self.assertEqual(self.notifications(self.customer_user, "ORDER_REJECTED", booking).count(), 1)
        booking.refresh_from_db()
        self.assertEqual(booking.rejection_reason, "Out of service area")

    def test_reject_approved_cancels_delivery_and_notifies_staff(self):
        booking, delivery = self.assigned_booking(self.staff_a)
        response = self.reject(booking)
        self.assertEqual(response.status_code, 200, response.data)
        delivery.refresh_from_db()
        self.assertEqual(delivery.status, Delivery.Status.CANCELLED)
        self.assertEqual(self.notifications(self.staff_a, "DELIVERY_CANCELLED", booking).count(), 1)
        self.assertIn("rejected by Admin", self.notifications(self.staff_a, "DELIVERY_CANCELLED", booking).get().body)

    def test_reject_accepted_booking_allowed(self):
        booking, delivery = self.assigned_booking(
            self.staff_a, delivery_status=Delivery.Status.ACCEPTED, booking_status=Booking.Status.ACCEPTED
        )
        response = self.reject(booking)
        self.assertEqual(response.status_code, 200, response.data)
        delivery.refresh_from_db()
        self.assertEqual(delivery.status, Delivery.Status.CANCELLED)
        self.assertEqual(self.notifications(self.staff_a, "DELIVERY_CANCELLED", booking).count(), 1)

    def test_reject_pending_with_declined_delivery_cancels_without_staff_notification(self):
        booking = self.make_booking()
        delivery = self.make_delivery(booking, self.staff_a, status=Delivery.Status.REJECTED, rejection_reason="Too far")
        response = self.reject(booking)
        self.assertEqual(response.status_code, 200, response.data)
        delivery.refresh_from_db()
        self.assertEqual(delivery.status, Delivery.Status.CANCELLED)
        self.assertEqual(delivery.rejection_reason, "Too far")
        self.assertEqual(self.notifications(self.staff_a, "DELIVERY_CANCELLED", booking).count(), 0)

    def test_reject_invalid_states(self):
        for status in (Booking.Status.OUT_FOR_DELIVERY, Booking.Status.DELIVERED, Booking.Status.CANCELLED):
            booking = self.make_booking(status=status)
            response = self.reject(booking)
            self.assertEqual(response.status_code, 400)
            self.assertEqual(response.data["code"], "invalid_state")
            self.assertEqual(response.data["status_value"], status)
            booking.refresh_from_db()
            self.assertEqual(booking.status, status)
            self.assertIsNone(booking.rejection_reason)

    def test_reason_validation_no_partial_write(self):
        booking = self.make_booking()
        before = Notification.objects.count()

        response = self.reject(booking, "")
        self.assertEqual(response.status_code, 400)
        self.assertEqual((response.data["code"], response.data["field"]), ("required", "reason"))

        response = self.reject(booking, None)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["code"], "required")

        response = self.reject(booking, "x" * 251)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["code"], "max_length")
        self.assertEqual(response.data["max_length"], 250)
        self.assertEqual(response.data["field"], "reason")

        response = self.reject(booking, 12345)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["code"], "invalid")

        booking.refresh_from_db()
        self.assertEqual(booking.status, Booking.Status.PENDING)
        self.assertIsNone(booking.rejection_reason)
        self.assertIsNone(booking.rejected_at)
        self.assertEqual(Notification.objects.count(), before)

        # exactly 250 chars is accepted and the notification body is truncated safely
        response = self.reject(booking, "y" * 250)
        self.assertEqual(response.status_code, 200, response.data)
        note = self.notifications(self.customer_user, "ORDER_REJECTED", booking).get()
        self.assertLessEqual(len(note.body), 300)
        self.assertTrue(note.body.endswith("…"))
