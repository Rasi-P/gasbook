from datetime import datetime, timedelta
from decimal import Decimal

from django.utils import timezone

from core.models import Booking, Delivery

from .base import GasBookTestCase


def url(user):
    return f"/api/auth/users/{user.pk}/deliveries/"


class StaffDeliveryHistoryTests(GasBookTestCase):
    def make_history(self):
        """staff_a: one delivery in every status; staff_b: one delivered."""
        rows = {}
        for delivery_status, booking_status in (
            (Delivery.Status.ASSIGNED, Booking.Status.APPROVED),
            (Delivery.Status.ACCEPTED, Booking.Status.ACCEPTED),
            (Delivery.Status.OUT_FOR_DELIVERY, Booking.Status.OUT_FOR_DELIVERY),
            (Delivery.Status.DELIVERED, Booking.Status.DELIVERED),
            (Delivery.Status.CANCELLED, Booking.Status.REJECTED),
        ):
            rows[delivery_status] = self.assigned_booking(
                staff=self.staff_a, delivery_status=delivery_status, booking_status=booking_status
            )
        declined = self.make_booking(status=Booking.Status.PENDING)
        rows[Delivery.Status.REJECTED] = (
            declined,
            self.make_delivery(declined, self.staff_a, status=Delivery.Status.REJECTED, rejection_reason="Too far"),
        )
        _, delivered = rows[Delivery.Status.DELIVERED]
        delivered.payment_collected = Decimal("1800.00")
        delivered.save(update_fields=["payment_collected"])
        self.other = self.assigned_booking(
            staff=self.staff_b, delivery_status=Delivery.Status.DELIVERED, booking_status=Booking.Status.DELIVERED
        )
        return rows

    def set_booked_on(self, booking, day):
        booked = timezone.make_aware(datetime.combine(day, datetime.min.time()) + timedelta(hours=12))
        Booking.objects.filter(pk=booking.pk).update(created_at=booked)

    # ---- permissions ---------------------------------------------------

    def test_admin_only(self):
        self.assertEqual(self.client.get(url(self.staff_a)).status_code, 401)
        self.auth(self.staff_a)
        self.assertEqual(self.client.get(url(self.staff_a)).status_code, 403)
        self.auth(self.customer_user)
        self.assertEqual(self.client.get(url(self.staff_a)).status_code, 403)

    def test_unknown_or_customer_user_is_404(self):
        self.auth(self.admin)
        self.assertEqual(self.client.get("/api/auth/users/999999/deliveries/").status_code, 404)
        self.assertEqual(self.client.get(url(self.customer_user)).status_code, 404)

    # ---- content -------------------------------------------------------

    def test_lists_every_status_for_this_staff_only(self):
        rows = self.make_history()
        self.auth(self.admin)
        response = self.client.get(url(self.staff_a))
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["count"], 6)
        self.assertEqual(
            {row["id"] for row in response.data["results"]},
            {delivery.id for _, delivery in rows.values()},
        )
        self.assertNotIn(self.other[1].id, {row["id"] for row in response.data["results"]})
        self.assertEqual(
            response.data["summary"],
            {"total": 6, "delivered": 1, "active": 3, "cancelled": 1, "declined": 1, "collected": "1800.00"},
        )
        self.assertEqual(response.data["staff"]["username"], "staffa")
        self.assertEqual(response.data["staff"]["role"], "staff")

    def test_row_shape(self):
        booking, delivery = self.assigned_booking(
            delivery_status=Delivery.Status.DELIVERED, booking_status=Booking.Status.DELIVERED
        )
        self.auth(self.admin)
        row = self.client.get(url(self.staff_a)).data["results"][0]
        self.assertEqual(row["id"], delivery.id)
        self.assertEqual(row["booking"], booking.id)
        self.assertEqual(row["order_id"], f"GB{booking.id}")
        self.assertEqual(row["customer_name"], "Cust One")
        self.assertEqual(row["cylinder_type_name"], "14kg Domestic")
        self.assertEqual(row["quantity"], 2)
        self.assertEqual(row["final_amount"], "1800.00")
        self.assertEqual(row["booking_payment_method"], "COD")
        self.assertIsNone(row["balance_due"])

    def test_declined_delivery_stays_with_staff_until_reassigned(self):
        """Staff decline clears Booking.assigned_staff, but Delivery.staff keeps the history.
        Re-assignment moves the single Delivery row to the new staff (documented limitation)."""
        booking = self.make_booking(status=Booking.Status.PENDING)
        self.auth(self.admin)
        self.assertEqual(
            self.client.post(f"/api/bookings/{booking.pk}/approve/", {"assigned_staff": self.staff_a.pk}).status_code, 200
        )
        delivery = Delivery.objects.get(booking=booking)
        self.auth(self.staff_a)
        self.assertEqual(
            self.client.post(f"/api/deliveries/{delivery.pk}/reject/", {"reason": "Vehicle issue"}).status_code, 200
        )
        booking.refresh_from_db()
        self.assertIsNone(booking.assigned_staff)

        self.auth(self.admin)
        row = self.client.get(url(self.staff_a)).data["results"][0]
        self.assertEqual((row["id"], row["status"], row["rejection_reason"]), (delivery.pk, "rejected", "Vehicle issue"))

        self.assertEqual(
            self.client.post(f"/api/bookings/{booking.pk}/approve/", {"assigned_staff": self.staff_b.pk}).status_code, 200
        )
        self.assertEqual(self.client.get(url(self.staff_a)).data["count"], 0)
        self.assertEqual(self.client.get(url(self.staff_b)).data["results"][0]["id"], delivery.pk)

    # ---- filters -------------------------------------------------------

    def test_status_filter_keeps_summary(self):
        self.make_history()
        self.auth(self.admin)
        response = self.client.get(url(self.staff_a), {"status": "assigned,accepted,out_for_delivery"})
        self.assertEqual(response.data["count"], 3)
        self.assertEqual({row["status"] for row in response.data["results"]}, {"assigned", "accepted", "out_for_delivery"})
        self.assertEqual(response.data["summary"]["total"], 6)

    def test_search_by_order_id_and_customer(self):
        rows = self.make_history()
        booking, delivery = rows[Delivery.Status.DELIVERED]
        self.auth(self.admin)
        for term in (f"GB{booking.pk}", f"#{booking.pk}", f"gb{booking.pk}"):
            ids = [row["id"] for row in self.client.get(url(self.staff_a), {"search": term}).data["results"]]
            self.assertIn(delivery.id, ids, term)
        self.assertEqual(self.client.get(url(self.staff_a), {"search": "cust one"}).data["count"], 6)
        self.assertEqual(self.client.get(url(self.staff_a), {"search": "nobody"}).data["count"], 0)

    def test_date_range_filters_rows_and_summary(self):
        rows = self.make_history()
        today = timezone.localdate()
        old_booking, _ = rows[Delivery.Status.DELIVERED]
        self.set_booked_on(old_booking, today - timedelta(days=40))
        self.auth(self.admin)

        recent = self.client.get(url(self.staff_a), {"start": (today - timedelta(days=7)).isoformat(), "end": today.isoformat()})
        self.assertEqual(recent.status_code, 200, recent.data)
        self.assertEqual(recent.data["count"], 5)
        self.assertEqual(recent.data["summary"]["delivered"], 0)
        self.assertEqual(recent.data["summary"]["collected"], "0.00")

        older = self.client.get(url(self.staff_a), {"end": (today - timedelta(days=30)).isoformat()})
        self.assertEqual([row["booking"] for row in older.data["results"]], [old_booking.pk])

    def test_invalid_dates(self):
        self.auth(self.admin)
        response = self.client.get(url(self.staff_a), {"start": "2026-13-01"})
        self.assertEqual((response.status_code, response.data["code"]), (400, "invalid_date"))
        response = self.client.get(url(self.staff_a), {"start": "2026-10-09", "end": "2026-10-01"})
        self.assertEqual((response.status_code, response.data["code"]), (400, "invalid_range"))

    def test_paginated_newest_booking_first(self):
        rows = self.make_history()
        today = timezone.localdate()
        newest_booking, _ = rows[Delivery.Status.CANCELLED]
        self.set_booked_on(newest_booking, today + timedelta(days=1))
        self.auth(self.admin)
        response = self.client.get(url(self.staff_a), {"page_size": 2})
        self.assertEqual(response.data["count"], 6)
        self.assertEqual(len(response.data["results"]), 2)
        self.assertIsNotNone(response.data["next"])
        self.assertEqual(response.data["results"][0]["booking"], newest_booking.pk)
