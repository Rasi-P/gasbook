"""Ownership must be re-checked on the *locked* Delivery row: between get_object()
and lock_booking_and_delivery() an admin may have re-assigned the booking to
another staff member."""
from unittest import mock

from core import views
from core.models import Booking, Delivery, Payment, Sale, Stock

from .base import GasBookTestCase


class LockedOwnershipTests(GasBookTestCase):
    def _reassign_during_lock(self):
        """Patch the lock helper so the delivery moves to staff B right before the locked re-read."""
        real_lock = views.lock_booking_and_delivery
        self.locked_staff_id = None

        def reassign_then_lock(booking_id):
            Delivery.objects.filter(booking_id=booking_id).update(staff=self.staff_b, status=Delivery.Status.ASSIGNED)
            Booking.objects.filter(pk=booking_id).update(assigned_staff=self.staff_b, status=Booking.Status.APPROVED)
            booking, delivery = real_lock(booking_id)
            self.locked_staff_id = delivery.staff_id
            return booking, delivery

        return mock.patch.object(views, "lock_booking_and_delivery", side_effect=reassign_then_lock)

    def _post(self, delivery, action, payload=None):
        self.auth(self.staff_a)
        with self._reassign_during_lock():
            return self.client.post(f"/api/deliveries/{delivery.id}/{action}/", payload or {}, format="json")

    def _assert_untouched(self, booking, delivery, response):
        """The locked row belonged to staff B, staff A got 403 and nothing was written.

        The simulated re-assignment runs inside the view's atomic block, so the
        403 rollback undoes it too (in production it is a separate, committed
        transaction); only the action's own effects are asserted here.
        """
        self.assertEqual(response.status_code, 403, response.data)
        self.assertEqual(response.data["code"], "forbidden")
        self.assertEqual(self.locked_staff_id, self.staff_b.id)
        booking.refresh_from_db()
        delivery.refresh_from_db()
        self.assertEqual(delivery.status, Delivery.Status.ASSIGNED)
        self.assertIsNone(delivery.started_at)
        self.assertIsNone(delivery.completed_at)
        self.assertEqual(booking.status, Booking.Status.APPROVED)

    def test_accept_rechecks_ownership_after_lock(self):
        booking, delivery = self.assigned_booking(self.staff_a)
        self._assert_untouched(booking, delivery, self._post(delivery, "accept"))

    def test_reject_rechecks_ownership_after_lock(self):
        booking, delivery = self.assigned_booking(self.staff_a)
        self._assert_untouched(booking, delivery, self._post(delivery, "reject", {"reason": "Too far"}))
        delivery.refresh_from_db()
        self.assertEqual(delivery.rejection_reason, "")

    def test_start_rechecks_ownership_after_lock(self):
        booking, delivery = self.assigned_booking(self.staff_a)
        self._assert_untouched(booking, delivery, self._post(delivery, "start"))

    def test_complete_rechecks_ownership_after_lock(self):
        self.set_stock(self.shop, filled=5)
        booking, delivery = self.assigned_booking(self.staff_a, quantity=2)
        self._assert_untouched(booking, delivery, self._post(delivery, "complete", {"payment_collected": "1800"}))
        self.assertEqual(Sale.objects.count(), 0)
        self.assertEqual(Payment.objects.count(), 0)
        self.assertEqual(self.stock_qty(self.shop, Stock.Status.FILLED), 5)
        booking.refresh_from_db()
        self.assertIsNone(booking.sale_id)

    def test_admin_still_allowed_after_reassignment(self):
        booking, delivery = self.assigned_booking(self.staff_a)
        self.auth(self.admin)
        with self._reassign_during_lock():
            response = self.client.post(f"/api/deliveries/{delivery.id}/accept/", {}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        delivery.refresh_from_db()
        self.assertEqual((delivery.staff_id, delivery.status), (self.staff_b.id, Delivery.Status.ACCEPTED))
