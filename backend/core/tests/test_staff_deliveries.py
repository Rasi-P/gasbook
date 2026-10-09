from datetime import datetime, timedelta
from decimal import Decimal

from django.utils import timezone
from rest_framework.fields import DateTimeField

from core.models import ActivityLog, Booking, Delivery, StaffProfile, User

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
            {"total": 6, "delivered": 1, "active": 3, "cancelled": 1, "declined": 1, "collected": "1800.00", "reassigned": 0},
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
        self.assertEqual(row["involvement"], "current")
        self.assertIsNone(row["handover"])

    def test_declined_delivery_stays_with_staff_and_survives_reassignment(self):
        """Staff decline clears Booking.assigned_staff, but Delivery.staff keeps the history.
        Re-assignment moves the single Delivery row to the new staff; the ActivityLog keeps
        the handover, so the declining staff still sees the booking."""
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
        row = self.client.get(url(self.staff_a)).data["results"][0]
        self.assertEqual((row["booking"], row["involvement"], row["status"]), (booking.pk, "previous", "reassigned"))
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


class StaffHandoverHistoryTests(GasBookTestCase):
    """Bookings a staff member handed over, rebuilt from the approve/decline ActivityLog."""

    def approve(self, booking, staff):
        self.auth(self.admin)
        response = self.client.post(f"/api/bookings/{booking.pk}/approve/", {"assigned_staff": staff.pk}, format="json")
        self.assertEqual(response.status_code, 200, response.data)

    def delivery_action(self, staff, booking, action, **data):
        self.auth(staff)
        delivery = Delivery.objects.get(booking=booking)
        response = self.client.post(f"/api/deliveries/{delivery.pk}/{action}/", data, format="json")
        self.assertEqual(response.status_code, 200, response.data)

    def decline_and_reassign(self, staff, to, reason="Too far"):
        booking = self.make_booking()
        self.approve(booking, staff)
        self.delivery_action(staff, booking, "reject", reason=reason)
        self.approve(booking, to)
        return booking

    def history(self, staff, **params):
        self.auth(self.admin)
        response = self.client.get(url(staff), params)
        self.assertEqual(response.status_code, 200, response.data)
        return response.data

    def rows(self, staff, **params):
        return {row["booking"]: row for row in self.history(staff, **params)["results"]}

    def make_staff(self, username, last_name):
        user = User.objects.create_user(
            username=username, password="Init-Pass-2026!", role=self.staff_role, first_name="Staff", last_name=last_name
        )
        StaffProfile.objects.create(user=user)
        return user

    def test_decline_then_reassign_shows_for_both_without_mixing_their_work(self):
        self.set_stock(self.shop, filled=5)
        booking = self.decline_and_reassign(self.staff_a, self.staff_b, reason="Vehicle issue")
        for action in ("accept", "start"):
            self.delivery_action(self.staff_b, booking, action)
        self.delivery_action(self.staff_b, booking, "complete", payment_collected="1800", empty_collected=1)
        handover_log = ActivityLog.objects.get(action="booking_approved", metadata__previous_staff_id=self.staff_a.pk)

        data = self.history(self.staff_a)
        self.assertEqual(data["count"], 1)
        row = data["results"][0]
        self.assertEqual(
            (row["involvement"], row["status"], row["booking"], row["order_id"], row["booking_status"], row["final_amount"]),
            ("previous", "reassigned", booking.pk, f"GB{booking.pk}", "delivered", "1800.00"),
        )
        self.assertEqual(row["handover"], {
            "outcome": "declined",
            "previous_status": "rejected",
            "reason": "Vehicle issue",
            "handed_over_at": DateTimeField().to_representation(handover_log.created_at),
            "to_staff_id": self.staff_b.pk,
            "to_staff_name": "Staff B",
        })
        for field in (
            "id", "started_at", "completed_at", "payment_method", "payment_collected", "balance_due",
            "empty_collected", "booking_payment_status", "rejection_reason", "booking_rejection_reason", "note",
        ):
            self.assertIsNone(row[field], field)
        self.assertEqual(
            data["summary"],
            {"total": 0, "delivered": 0, "active": 0, "cancelled": 0, "declined": 0, "collected": "0.00", "reassigned": 1},
        )

        current = self.rows(self.staff_b)[booking.pk]
        self.assertEqual(
            (current["involvement"], current["status"], current["payment_collected"], current["empty_collected"]),
            ("current", "delivered", "1800.00", 1),
        )
        self.assertIsNotNone(current["completed_at"])
        self.assertEqual(current["reassigned_from"], {"staff_id": self.staff_a.pk, "staff_name": "Staff A"})
        self.assertIsNone(current["previous_decline"])

    def test_reassigned_from_accepted(self):
        booking = self.make_booking()
        self.approve(booking, self.staff_a)
        self.delivery_action(self.staff_a, booking, "accept")
        self.approve(booking, self.staff_b)
        handover = self.rows(self.staff_a)[booking.pk]["handover"]
        self.assertEqual(
            (handover["outcome"], handover["previous_status"], handover["reason"], handover["to_staff_id"]),
            ("reassigned", "accepted", None, self.staff_b.pk),
        )

    def test_same_staff_reapproval_is_one_current_row_with_the_cleared_decline(self):
        booking = self.decline_and_reassign(self.staff_a, self.staff_a, reason="Flat tyre")
        decline_log = ActivityLog.objects.get(action="delivery_declined")
        data = self.history(self.staff_a)
        self.assertEqual(data["count"], 1)
        row = data["results"][0]
        self.assertEqual((row["booking"], row["involvement"], row["status"], row["rejection_reason"]), (booking.pk, "current", "assigned", ""))
        self.assertEqual(
            row["previous_decline"],
            {"reason": "Flat tyre", "declined_at": DateTimeField().to_representation(decline_log.created_at)},
        )
        self.assertIsNone(row["reassigned_from"])
        self.assertEqual(data["summary"]["reassigned"], 0)

    def test_a_b_a_is_one_row_per_staff(self):
        booking = self.decline_and_reassign(self.staff_a, self.staff_b, reason="r1")
        self.delivery_action(self.staff_b, booking, "reject", reason="r2")
        self.approve(booking, self.staff_a)

        a = self.history(self.staff_a)
        self.assertEqual(a["count"], 1)
        row = a["results"][0]
        self.assertEqual((row["involvement"], row["status"]), ("current", "assigned"))
        self.assertEqual(row["reassigned_from"]["staff_id"], self.staff_b.pk)
        self.assertEqual(row["previous_decline"]["reason"], "r1")

        b = self.history(self.staff_b)
        self.assertEqual(b["count"], 1)
        handover = b["results"][0]["handover"]
        self.assertEqual((handover["outcome"], handover["reason"], handover["to_staff_id"]), ("declined", "r2", self.staff_a.pk))

    def test_latest_handover_wins_and_ties_resolve_by_log_id(self):
        """A -> B -> A -> C with every log sharing one timestamp: order falls back to the log id."""
        staff_c = self.make_staff("staffc", "C")
        booking = self.decline_and_reassign(self.staff_a, self.staff_b, reason="r1")
        self.delivery_action(self.staff_b, booking, "reject", reason="r2")
        self.approve(booking, self.staff_a)
        self.approve(booking, staff_c)
        ActivityLog.objects.filter(metadata__booking_id=booking.pk).update(created_at=timezone.now())

        a = self.rows(self.staff_a)[booking.pk]
        self.assertEqual(
            (a["involvement"], a["handover"]["outcome"], a["handover"]["previous_status"], a["handover"]["reason"], a["handover"]["to_staff_id"]),
            ("previous", "reassigned", "assigned", None, staff_c.pk),
        )
        b = self.rows(self.staff_b)[booking.pk]
        self.assertEqual((b["handover"]["outcome"], b["handover"]["reason"], b["handover"]["to_staff_id"]), ("declined", "r2", self.staff_a.pk))
        c = self.rows(staff_c)[booking.pk]
        self.assertEqual((c["involvement"], c["reassigned_from"]["staff_id"], c["previous_decline"]), ("current", self.staff_a.pk, None))

    def test_admin_rejection(self):
        handed = self.decline_and_reassign(self.staff_a, self.staff_b, reason="Busy")
        kept = self.make_booking()
        self.approve(kept, self.staff_a)
        self.auth(self.admin)
        for booking in (handed, kept):
            response = self.client.post(f"/api/bookings/{booking.pk}/reject/", {"reason": "No stock"}, format="json")
            self.assertEqual(response.status_code, 200, response.data)

        a = self.history(self.staff_a)
        rows = {row["booking"]: row for row in a["results"]}
        self.assertEqual((rows[handed.pk]["involvement"], rows[handed.pk]["booking_status"]), ("previous", "rejected"))
        self.assertIsNone(rows[handed.pk]["booking_rejection_reason"])
        self.assertEqual((rows[kept.pk]["involvement"], rows[kept.pk]["status"]), ("current", "cancelled"))
        self.assertEqual((a["summary"]["cancelled"], a["summary"]["reassigned"]), (1, 1))
        b = self.rows(self.staff_b)[handed.pk]
        self.assertEqual((b["status"], b["booking_rejection_reason"]), ("cancelled", "No stock"))

    def test_filters_search_and_pagination_cover_both_kinds(self):
        current = [
            self.assigned_booking(staff=self.staff_a, delivery_status=status, booking_status=booking_status)[0]
            for status, booking_status in (
                (Delivery.Status.ASSIGNED, Booking.Status.APPROVED),
                (Delivery.Status.DELIVERED, Booking.Status.DELIVERED),
            )
        ]
        declined_now = self.make_booking()
        self.make_delivery(declined_now, self.staff_a, status=Delivery.Status.REJECTED)
        handed = [self.decline_and_reassign(self.staff_a, self.staff_b) for _ in range(2)]
        everything = {b.pk for b in current + handed} | {declined_now.pk}

        seen = []
        for page in (1, 2, 3):
            data = self.history(self.staff_a, page=page, page_size=2)
            self.assertEqual(data["count"], 5)
            seen += [row["booking"] for row in data["results"]]
        self.assertEqual((len(seen), set(seen)), (5, everything))
        self.assertEqual(data["summary"]["total"], 3)
        self.assertEqual(data["summary"]["reassigned"], 2)

        self.assertEqual(set(self.rows(self.staff_a, status="reassigned")), {b.pk for b in handed})
        self.assertEqual(set(self.rows(self.staff_a, status="delivered")), {current[1].pk})
        self.assertEqual(set(self.rows(self.staff_a, status="rejected,reassigned")), {declined_now.pk} | {b.pk for b in handed})
        self.assertEqual(set(self.rows(self.staff_a, search=f"GB{handed[0].pk}")), {handed[0].pk})
        self.assertEqual(set(self.rows(self.staff_a, search="cust one", status="reassigned")), {b.pk for b in handed})

        today = timezone.localdate()
        old = timezone.make_aware(datetime.combine(today - timedelta(days=40), datetime.min.time()) + timedelta(hours=12))
        Booking.objects.filter(pk=handed[1].pk).update(created_at=old)
        recent = self.history(self.staff_a, start=(today - timedelta(days=7)).isoformat())
        self.assertNotIn(handed[1].pk, [row["booking"] for row in recent["results"]])
        self.assertEqual(recent["summary"]["reassigned"], 1)

    def test_history_since_is_the_first_assignment_log(self):
        ActivityLog.objects.create(action="stock_moved", description="Moved", user=self.admin)
        self.assertIsNone(self.history(self.staff_a)["history_since"])
        self.approve(self.make_booking(), self.staff_a)
        first = ActivityLog.objects.get(action="booking_approved")
        self.assertEqual(self.history(self.staff_a)["history_since"], DateTimeField().to_representation(first.created_at))

    def test_handover_to_a_since_deleted_staff_has_no_name(self):
        staff_x = self.make_staff("staffx", "X")
        booking = self.decline_and_reassign(self.staff_a, staff_x)
        self.approve(booking, self.staff_b)
        self.auth(self.admin)
        self.assertEqual(self.client.delete(f"/api/auth/users/{staff_x.pk}/").status_code, 200)
        handover = self.rows(self.staff_a)[booking.pk]["handover"]
        self.assertEqual((handover["to_staff_id"], handover["to_staff_name"]), (staff_x.pk, None))
