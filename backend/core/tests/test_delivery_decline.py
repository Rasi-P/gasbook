from core.models import ActivityLog, Booking, Delivery, Notification

from .base import GasBookTestCase


class DeliveryDeclineTests(GasBookTestCase):
    def decline(self, delivery, reason="Too far", user=None):
        self.auth(user or self.staff_a)
        payload = {"reason": reason} if reason is not None else {}
        return self.client.post(f"/api/deliveries/{delivery.id}/reject/", payload, format="json")

    def test_decline_returns_booking_to_pending(self):
        booking, delivery = self.assigned_booking(self.staff_a)
        response = self.decline(delivery)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["status"], "rejected")
        self.assertEqual(response.data["booking_status"], "pending")
        self.assertEqual(response.data["order_id"], booking.order_id)

        delivery.refresh_from_db()
        booking.refresh_from_db()
        self.assertEqual(delivery.status, Delivery.Status.REJECTED)
        self.assertEqual(delivery.rejection_reason, "Too far")
        self.assertEqual(booking.status, Booking.Status.PENDING)
        self.assertIsNone(booking.assigned_staff)
        self.assertIsNone(booking.approved_by)
        self.assertIsNone(booking.approved_at)
        self.assertIsNone(booking.rejection_reason)
        self.assertIsNone(booking.rejected_by)
        self.assertIsNone(booking.rejected_by_role)
        self.assertIsNone(booking.rejected_at)

        admin_note = self.notifications(self.admin, "STAFF_REJECTED", booking).get()
        self.assertEqual(admin_note.title, "Staff Declined Delivery")
        self.assertIn("Too far", admin_note.body)
        customer_note = self.notifications(self.customer_user, "ORDER_REASSIGNMENT", booking).get()
        self.assertEqual(customer_note.title, "Order Update")
        self.assertNotIn("reject", customer_note.body.lower())
        self.assertNotIn("reject", customer_note.title.lower())
        self.assertEqual(self.notifications(self.customer_user, "ORDER_REJECTED", booking).count(), 0)

        log = ActivityLog.objects.get(action="delivery_declined")
        self.assertEqual(log.metadata["booking_id"], booking.id)
        self.assertEqual(log.metadata["staff_id"], self.staff_a.id)
        self.assertEqual(log.metadata["reason"], "Too far")
        self.assertEqual(log.metadata["previous_delivery_status"], "assigned")

    def test_decline_from_accepted(self):
        booking, delivery = self.assigned_booking(
            self.staff_a, delivery_status=Delivery.Status.ACCEPTED, booking_status=Booking.Status.ACCEPTED
        )
        response = self.decline(delivery, "Vehicle breakdown")
        self.assertEqual(response.status_code, 200, response.data)
        booking.refresh_from_db()
        self.assertEqual(booking.status, Booking.Status.PENDING)

    def test_decline_twice_and_invalid_states(self):
        booking, delivery = self.assigned_booking(self.staff_a)
        self.decline(delivery)
        before = Notification.objects.count()
        response = self.decline(delivery, "again")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["code"], "invalid_state")
        self.assertEqual(Notification.objects.count(), before)

        for status in (Delivery.Status.OUT_FOR_DELIVERY, Delivery.Status.DELIVERED, Delivery.Status.CANCELLED):
            booking, delivery = self.assigned_booking(self.staff_a, delivery_status=status)
            response = self.decline(delivery)
            self.assertEqual(response.status_code, 400)
            self.assertEqual(response.data["code"], "invalid_state")
            booking.refresh_from_db()
            self.assertEqual(booking.status, Booking.Status.APPROVED)

    def test_reason_validation_no_partial_write(self):
        booking, delivery = self.assigned_booking(self.staff_a)
        response = self.decline(delivery, None)
        self.assertEqual(response.status_code, 400)
        self.assertEqual((response.data["code"], response.data["field"]), ("required", "reason"))

        response = self.decline(delivery, "   ")
        self.assertEqual(response.data["code"], "required")

        response = self.decline(delivery, "x" * 201)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["code"], "max_length")
        self.assertEqual(response.data["max_length"], 200)

        delivery.refresh_from_db()
        booking.refresh_from_db()
        self.assertEqual(delivery.status, Delivery.Status.ASSIGNED)
        self.assertEqual(booking.status, Booking.Status.APPROVED)
        self.assertEqual(booking.assigned_staff, self.staff_a)
        self.assertEqual(Notification.objects.filter(booking=booking).count(), 0)

    def test_booking_serializer_exposes_decline_to_admin_not_customer(self):
        booking, delivery = self.assigned_booking(self.staff_a)
        self.decline(delivery, "Too far")

        self.auth(self.admin)
        response = self.client.get(f"/api/bookings/{booking.id}/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["status"], "pending")
        self.assertEqual(response.data["delivery_status"], "rejected")
        self.assertEqual(response.data["delivery_staff_name"], "Staff A")
        self.assertEqual(response.data["delivery_rejection_reason"], "Too far")
        self.assertTrue(response.data["needs_reassignment"])
        self.assertIsNone(response.data["rejection_reason"])

        self.auth(self.customer_user)
        response = self.client.get(f"/api/bookings/{booking.id}/")
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.data["delivery_rejection_reason"])
        self.assertIsNone(response.data["rejection_reason"])
        self.assertIsNone(response.data["rejected_by_role"])
        self.assertTrue(response.data["needs_reassignment"])
        self.assertEqual(response.data["delivery_status"], "rejected")

    def test_customer_active_filter_still_contains_declined_booking(self):
        booking, delivery = self.assigned_booking(self.staff_a)
        self.decline(delivery)
        self.auth(self.customer_user)
        response = self.client.get("/api/bookings/?status=pending,approved,accepted,out_for_delivery")
        self.assertEqual(response.status_code, 200)
        ids = [row["id"] for row in response.data["results"]]
        self.assertIn(booking.id, ids)

    def test_staff_list_hides_declined_delivery_via_status_filter(self):
        booking, delivery = self.assigned_booking(self.staff_a)
        self.decline(delivery)
        self.auth(self.staff_a)
        response = self.client.get("/api/deliveries/?status=assigned")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["count"], 0)
