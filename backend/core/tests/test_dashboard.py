from core.models import Booking, Delivery

from .base import GasBookTestCase


class DashboardCounterTests(GasBookTestCase):
    def test_pending_deliveries_and_staff_workload(self):
        approved = self.make_booking(status=Booking.Status.APPROVED, assigned_staff=self.staff_a)
        accepted = self.make_booking(status=Booking.Status.ACCEPTED, assigned_staff=self.staff_a)
        out = self.make_booking(status=Booking.Status.OUT_FOR_DELIVERY, assigned_staff=self.staff_a)
        delivered = self.make_booking(status=Booking.Status.DELIVERED, assigned_staff=self.staff_a)
        declined = self.make_booking(status=Booking.Status.PENDING)
        cancelled = self.make_booking(status=Booking.Status.REJECTED)
        self.make_booking(status=Booking.Status.PENDING)

        self.make_delivery(approved, self.staff_a, status=Delivery.Status.ASSIGNED)
        self.make_delivery(accepted, self.staff_a, status=Delivery.Status.ACCEPTED)
        self.make_delivery(out, self.staff_a, status=Delivery.Status.OUT_FOR_DELIVERY)
        self.make_delivery(delivered, self.staff_a, status=Delivery.Status.DELIVERED)
        self.make_delivery(declined, self.staff_a, status=Delivery.Status.REJECTED)
        self.make_delivery(cancelled, self.staff_a, status=Delivery.Status.CANCELLED)

        self.auth(self.admin)
        response = self.client.get("/api/dashboard/")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["pending_deliveries"], 3)
        staff_rows = {row["id"]: row for row in response.data["staff_live_status"]}
        self.assertEqual(staff_rows[self.staff_a.id]["assigned_deliveries"], 3)
        self.assertEqual(staff_rows[self.staff_b.id]["assigned_deliveries"], 0)
