from django.utils import timezone

from core.models import ActivityLog, Booking, Delivery, Notification

from .base import GasBookTestCase


class BookingApproveTests(GasBookTestCase):
    def approve(self, booking, staff=None, **extra):
        self.auth(self.admin)
        payload = dict(extra)
        if staff is not None:
            payload["assigned_staff"] = staff.id
        return self.client.post(f"/api/bookings/{booking.id}/approve/", payload, format="json")

    def test_first_approve_creates_delivery_and_clears_stale_rejected_fields(self):
        booking = self.make_booking(rejected_by_role="staff", rejection_reason="old", rejected_by=self.staff_a, rejected_at=timezone.now())
        response = self.approve(booking, self.staff_a)
        self.assertEqual(response.status_code, 200, response.data)
        booking.refresh_from_db()
        self.assertEqual(booking.status, Booking.Status.APPROVED)
        self.assertEqual(booking.assigned_staff, self.staff_a)
        self.assertEqual(booking.approved_by, self.admin)
        self.assertIsNotNone(booking.approved_at)
        self.assertIsNone(booking.rejection_reason)
        self.assertIsNone(booking.rejected_by)
        self.assertIsNone(booking.rejected_by_role)
        self.assertIsNone(booking.rejected_at)
        delivery = Delivery.objects.get(booking=booking)
        self.assertEqual(delivery.status, Delivery.Status.ASSIGNED)
        self.assertEqual(delivery.staff, self.staff_a)
        self.assertEqual(self.notifications(self.staff_a, "STAFF_ASSIGNED", booking).count(), 1)
        log = ActivityLog.objects.get(action="booking_approved")
        self.assertEqual(log.metadata["booking_id"], booking.id)
        self.assertFalse(log.metadata["reassignment"])
        self.assertEqual(response.data["delivery_status"], "assigned")
        self.assertEqual(response.data["delivery_staff_name"], "Staff A")
        self.assertFalse(response.data["needs_reassignment"])

    def test_approve_after_decline_reuses_delivery_row(self):
        booking = self.make_booking(status=Booking.Status.PENDING)
        delivery = self.make_delivery(
            booking, self.staff_a, status=Delivery.Status.REJECTED, rejection_reason="Too far", started_at=timezone.now()
        )
        Notification.objects.create(recipient=self.staff_a, booking=booking, notification_type="STAFF_ASSIGNED", title="t", body="b")

        response = self.approve(booking, self.staff_b)
        self.assertEqual(response.status_code, 200, response.data)
        delivery.refresh_from_db()
        self.assertEqual(delivery.pk, Delivery.objects.get(booking=booking).pk)
        self.assertEqual(delivery.staff, self.staff_b)
        self.assertEqual(delivery.status, Delivery.Status.ASSIGNED)
        self.assertEqual(delivery.rejection_reason, "")
        self.assertIsNone(delivery.started_at)
        self.assertEqual(self.notifications(self.staff_b, "STAFF_ASSIGNED", booking).count(), 1)
        # A declines again -> re-assign to A: STAFF_ASSIGNED sent to A again although the dedupe key exists
        self.auth(self.staff_b)
        self.client.post(f"/api/deliveries/{delivery.id}/reject/", {"reason": "Busy"}, format="json")
        response = self.approve(booking, self.staff_a)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(self.notifications(self.staff_a, "STAFF_ASSIGNED", booking).count(), 2)
        self.assertEqual(ActivityLog.objects.filter(action="booking_approved", metadata__reassignment=True).count(), 2)

    def test_reassign_from_assigned_staff_notifies_both(self):
        booking, delivery = self.assigned_booking(self.staff_a)
        response = self.approve(booking, self.staff_b)
        self.assertEqual(response.status_code, 200, response.data)
        delivery.refresh_from_db()
        self.assertEqual(delivery.staff, self.staff_b)
        self.assertEqual(self.notifications(self.staff_a, "DELIVERY_REASSIGNED", booking).count(), 1)
        self.assertEqual(self.notifications(self.staff_b, "STAFF_ASSIGNED", booking).count(), 1)
        booking.refresh_from_db()
        self.assertEqual(booking.assigned_staff, self.staff_b)

    def test_reassign_from_accepted_allowed_and_booking_becomes_approved(self):
        booking, delivery = self.assigned_booking(
            self.staff_a, delivery_status=Delivery.Status.ACCEPTED, booking_status=Booking.Status.ACCEPTED
        )
        response = self.approve(booking, self.staff_b)
        self.assertEqual(response.status_code, 200, response.data)
        booking.refresh_from_db()
        delivery.refresh_from_db()
        self.assertEqual(booking.status, Booking.Status.APPROVED)
        self.assertEqual(delivery.status, Delivery.Status.ASSIGNED)
        self.assertEqual(delivery.staff, self.staff_b)
        self.assertEqual(self.notifications(self.staff_a, "DELIVERY_REASSIGNED", booking).count(), 1)

    def test_same_staff_reapprove_is_noop(self):
        for booking_status, delivery_status in (
            (Booking.Status.APPROVED, Delivery.Status.ASSIGNED),
            (Booking.Status.ACCEPTED, Delivery.Status.ACCEPTED),
        ):
            booking, delivery = self.assigned_booking(self.staff_a, delivery_status=delivery_status, booking_status=booking_status)
            before_updated = booking.updated_at
            before_notifications = Notification.objects.count()
            response = self.approve(booking, self.staff_a)
            self.assertEqual(response.status_code, 200, response.data)
            booking.refresh_from_db()
            delivery.refresh_from_db()
            self.assertEqual(booking.status, booking_status)
            self.assertEqual(delivery.status, delivery_status)
            self.assertEqual(booking.updated_at, before_updated)
            self.assertEqual(Notification.objects.count(), before_notifications)
            self.assertFalse(ActivityLog.objects.filter(action="booking_approved", metadata__booking_id=booking.id).exists())

    def test_approve_invalid_states(self):
        for status in (
            Booking.Status.OUT_FOR_DELIVERY, Booking.Status.DELIVERED, Booking.Status.REJECTED, Booking.Status.CANCELLED,
        ):
            booking = self.make_booking(status=status)
            response = self.approve(booking, self.staff_a)
            self.assertEqual(response.status_code, 400, response.data)
            self.assertEqual(response.data["code"], "invalid_state")
            self.assertEqual(response.data["status_value"], status)
            booking.refresh_from_db()
            self.assertEqual(booking.status, status)
            self.assertFalse(Delivery.objects.filter(booking=booking).exists())

    def test_staff_validation(self):
        booking = self.make_booking()
        response = self.approve(booking)
        self.assertEqual(response.status_code, 400)
        self.assertEqual((response.data["code"], response.data["field"]), ("required", "assigned_staff"))

        response = self.approve(booking, assigned_staff=self.customer_user.id)
        self.assertEqual(response.status_code, 400)
        self.assertEqual((response.data["code"], response.data["field"]), ("invalid", "assigned_staff"))

        for bad in ("abc", "1.5", [self.staff_a.id], {"id": self.staff_a.id}, True):
            response = self.approve(booking, assigned_staff=bad)
            self.assertEqual(response.status_code, 400, (bad, response.data))
            self.assertEqual((response.data["code"], response.data["field"]), ("invalid", "assigned_staff"), bad)
        response = self.approve(booking, assigned_staff=str(self.staff_a.id))
        self.assertEqual(response.status_code, 200, response.data)
        booking.refresh_from_db()
        self.assertEqual(booking.assigned_staff_id, self.staff_a.id)
        booking = self.make_booking()

        self.staff_a.is_active = False
        self.staff_a.save(update_fields=["is_active"])
        response = self.approve(booking, self.staff_a)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["code"], "invalid")
        booking.refresh_from_db()
        self.assertEqual(booking.status, Booking.Status.PENDING)

    def test_non_admin_cannot_approve(self):
        booking = self.make_booking()
        self.auth(self.staff_a)
        response = self.client.post(f"/api/bookings/{booking.id}/approve/", {"assigned_staff": self.staff_a.id}, format="json")
        self.assertEqual(response.status_code, 403)
