from core.models import Booking, Delivery, Notification

from .base import GasBookTestCase


class DeliveryAcceptTests(GasBookTestCase):
    def accept(self, delivery, user=None):
        self.auth(user or self.staff_a)
        return self.client.post(f"/api/deliveries/{delivery.id}/accept/", {}, format="json")

    def test_accept_sets_booking_accepted_and_notifies(self):
        booking, delivery = self.assigned_booking(self.staff_a)
        response = self.accept(delivery)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["status"], "accepted")
        self.assertEqual(response.data["booking_status"], "accepted")
        self.assertEqual(response.data["order_id"], booking.order_id)
        booking.refresh_from_db()
        delivery.refresh_from_db()
        self.assertEqual(booking.status, Booking.Status.ACCEPTED)
        self.assertEqual(delivery.status, Delivery.Status.ACCEPTED)
        customer_note = self.notifications(self.customer_user, "ORDER_ACCEPTED", booking).get()
        self.assertEqual(customer_note.title, "Order Accepted")
        self.assertIn("Staff A", customer_note.body)
        self.assertEqual(self.notifications(self.admin, "STAFF_ACCEPTED", booking).count(), 1)
        self.assertEqual(Notification.objects.filter(notification_type="ORDER_OUT_FOR_DELIVERY").count(), 0)

    def test_accept_twice_is_noop(self):
        booking, delivery = self.assigned_booking(self.staff_a)
        self.accept(delivery)
        delivery.refresh_from_db()
        before_updated = delivery.updated_at
        before_count = Notification.objects.count()
        response = self.accept(delivery)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["status"], "accepted")
        delivery.refresh_from_db()
        self.assertEqual(delivery.updated_at, before_updated)
        self.assertEqual(Notification.objects.count(), before_count)

    def test_non_owner_and_invalid_states(self):
        booking, delivery = self.assigned_booking(self.staff_a)
        response = self.accept(delivery, user=self.staff_b)
        self.assertIn(response.status_code, (403, 404))
        delivery.refresh_from_db()
        self.assertEqual(delivery.status, Delivery.Status.ASSIGNED)

        # admin may act on behalf of staff
        response = self.accept(delivery, user=self.admin)
        self.assertEqual(response.status_code, 200, response.data)

        for status in (Delivery.Status.REJECTED, Delivery.Status.DELIVERED, Delivery.Status.CANCELLED, Delivery.Status.OUT_FOR_DELIVERY):
            booking, delivery = self.assigned_booking(self.staff_a, delivery_status=status)
            response = self.accept(delivery)
            self.assertEqual(response.status_code, 400, response.data)
            self.assertEqual(response.data["code"], "invalid_state")
            self.assertEqual(response.data["status_value"], status)

    def test_start_after_accept_fires_out_for_delivery_notification(self):
        booking, delivery = self.assigned_booking(self.staff_a)
        self.accept(delivery)
        response = self.client.post(f"/api/deliveries/{delivery.id}/start/", {}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["booking_status"], "out_for_delivery")
        booking.refresh_from_db()
        delivery.refresh_from_db()
        self.assertEqual(booking.status, Booking.Status.OUT_FOR_DELIVERY)
        self.assertEqual(delivery.status, Delivery.Status.OUT_FOR_DELIVERY)
        self.assertIsNotNone(delivery.started_at)
        self.assertEqual(self.notifications(self.customer_user, "ORDER_OUT_FOR_DELIVERY", booking).count(), 1)
        self.assertEqual(self.notifications(self.admin, "ORDER_OUT_FOR_DELIVERY", booking).count(), 1)

    def test_start_invalid_state(self):
        for status in (Delivery.Status.DELIVERED, Delivery.Status.CANCELLED, Delivery.Status.REJECTED):
            booking, delivery = self.assigned_booking(self.staff_a, delivery_status=status)
            self.auth(self.staff_a)
            response = self.client.post(f"/api/deliveries/{delivery.id}/start/", {}, format="json")
            self.assertEqual(response.status_code, 400)
            self.assertEqual(response.data["code"], "invalid_state")
