"""Who recorded a sale, who handed the cylinders over, and who sees what.

- sold_by is always the user who recorded the sale; Payment.received_by is whoever took the
  money; handover_staff is optional and separate from both.
- Admins may name any active admin or staff member as handover staff, or nobody; staff only themselves.
- Staff never see sales they neither recorded nor handed over, on any endpoint.
- Customers see "Sabco Gas" on direct sales, and their delivery partner on bookings.
"""
import uuid
from decimal import Decimal
from unittest import mock

from rest_framework.request import Request
from rest_framework.test import APIRequestFactory

from core import integrity, views
from core.exceptions import ApiError
from core.models import ActivityLog, Booking, Delivery, Payment, Sale, SaleItem, StaffProfile, StockLocation, User
from core.serializers import SaleSerializer
from core.services import check_handover_staff

from .base import GasBookTestCase


class SaleFixtureMixin:
    def sale_payload(self, **overrides):
        body = {
            "client_ref": str(uuid.uuid4()),
            "customer": self.customer.id,
            "location": self.shop.id,
            "payment_mode": "cash",
            "sale_items": [{"cylinder_type": self.cylinder.id, "quantity": 1, "rate": "900"}],
        }
        body.update(overrides)
        return body

    def orm_sale(self, sold_by, handover=None, location=None, total="900.00"):
        sale = Sale.objects.create(customer=self.customer, location=location or self.shop, total_amount=Decimal(total),
                                   paid_amount=Decimal(total), payment_mode="cash", sold_by=sold_by, handover_staff=handover)
        SaleItem.objects.create(sale=sale, cylinder_type=self.cylinder, quantity=1, rate=Decimal(total), total_amount=Decimal(total))
        return sale


class HandoverRuleTests(SaleFixtureMixin, GasBookTestCase):
    def setUp(self):
        super().setUp()
        self.set_stock(self.shop, filled=20)
        self.auth(self.admin)

    def test_admin_records_and_a_staff_member_hands_over(self):
        response = self.client.post("/api/sales/", self.sale_payload(handover_staff=self.staff_a.id), format="json")
        self.assertEqual(response.status_code, 201, response.data)
        sale = Sale.objects.get(pk=response.data["id"])
        self.assertEqual((sale.sold_by, sale.handover_staff, sale.delivery_staff), (self.admin, self.staff_a, "Staff A"))
        # The money was taken by whoever recorded the sale, not the handover person.
        self.assertEqual(Payment.objects.get(sale=sale).received_by, self.admin)
        self.assertEqual(ActivityLog.objects.get(action="sale_created").metadata["handover_staff_id"], self.staff_a.id)
        self.assertEqual((response.data["sold_by_full_name"], response.data["sold_by_role"], response.data["handover_staff_name"],
                          response.data["is_direct"]), ("Ad Min", "admin", "Staff A", True))

    def test_handover_can_be_left_blank(self):
        response = self.client.post("/api/sales/", self.sale_payload(), format="json")
        self.assertEqual(response.status_code, 201, response.data)
        sale = Sale.objects.get(pk=response.data["id"])
        self.assertEqual((sale.handover_staff, sale.delivery_staff, response.data["handover_staff_name"]), (None, "", None))

    def test_only_active_admins_or_eligible_staff_can_be_named(self):
        inactive = User.objects.create_user(username="gone", password="x", role=self.staff_role, is_active=False)
        self.staff_b_profile.is_active = False
        self.staff_b_profile.save(update_fields=["is_active"])
        inactive_admin = User.objects.create_user(username="inactive-admin", role=self.admin_role, is_active=False)
        before = integrity.fingerprint()
        for person, code in ((self.customer_user, "invalid_handover"), (inactive_admin, "invalid_handover"),
                             (inactive, "invalid_handover"), (self.staff_b, "invalid_handover")):
            with self.subTest(person=person.username):
                response = self.client.post("/api/sales/", self.sale_payload(handover_staff=person.id), format="json")
                self.assertEqual((response.status_code, response.data["code"]), (400, code), response.data)
        response = self.client.post("/api/sales/", self.sale_payload(handover_staff=999999), format="json")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(integrity.compare_fingerprints(before, integrity.fingerprint()), [])

    def test_the_handover_list_offers_only_people_the_server_accepts(self):
        """The admin form's handover list shows rows with can_hand_over; the server must accept exactly those."""
        gone = User.objects.create_user(username="gone", password="x", role=self.staff_role, is_active=False)
        StaffProfile.objects.create(user=gone)                    # inactive user, active profile
        self.staff_b_profile.is_active = False                    # active user, inactive profile
        self.staff_b_profile.save(update_fields=["is_active"])
        StaffProfile.objects.create(user=self.admin)              # a profile on a user who is not staff
        rows = self.client.get("/api/sales/handover-options/", {"page_size": 200}).data["results"]
        offered = {row["user"]: row["can_hand_over"] for row in rows}
        self.assertEqual(offered, {self.staff_a.id: True, self.staff_b.id: False, gone.id: False, self.admin.id: True})
        self.assertNotIn(self.customer_user.id, offered)
        for user_id, can in offered.items():
            with self.subTest(user=user_id):
                response = self.client.post("/api/sales/", self.sale_payload(handover_staff=user_id), format="json")
                self.assertEqual(response.status_code, 201 if can else 400, response.data)

    def test_staff_may_name_only_themselves_or_nobody(self):
        self.assertIsNone(check_handover_staff(None, self.staff_a))
        self.assertEqual(check_handover_staff(self.staff_a, self.staff_a), self.staff_a)
        with self.assertRaises(ApiError) as caught:
            check_handover_staff(self.staff_b, self.staff_a)
        self.assertEqual((caught.exception.status_code, caught.exception.detail["code"]), (403, "handover_self_only"))
        self.assertEqual(check_handover_staff(self.staff_b, self.admin), self.staff_b)

        with self.assertRaises(ApiError):
            check_handover_staff(self.admin, self.staff_a)

        # Enforced inside the sale serializer itself, whatever view calls it.
        request = APIRequestFactory().post("/api/sales/")
        request.user = self.staff_a
        serializer = SaleSerializer(data=self.sale_payload(handover_staff=self.staff_b.id), context={"request": request})
        with self.assertRaises(ApiError) as caught:
            serializer.is_valid(raise_exception=True)
        self.assertEqual(caught.exception.detail["code"], "handover_self_only")

    def test_handover_is_part_of_the_retry_fingerprint(self):
        body = self.sale_payload(handover_staff=self.staff_a.id)
        self.assertEqual(self.client.post("/api/sales/", body, format="json").status_code, 201)
        response = self.client.post("/api/sales/", {**body, "handover_staff": self.staff_b.id}, format="json")
        self.assertEqual((response.status_code, response.data["code"]), (409, "client_ref_reused"))

    def test_delivery_completion_records_the_delivery_staff_as_handover(self):
        booking, delivery = self.assigned_booking(self.staff_a, quantity=1)
        self.auth(self.staff_a)
        response = self.client.post(f"/api/deliveries/{delivery.id}/complete/",
                                    {"payment_method": "cash", "payment_collected": "900.00"}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        sale = Sale.objects.get(booking=booking)
        self.assertEqual((sale.sold_by, sale.handover_staff, sale.delivery_staff), (self.staff_a, self.staff_a, "Staff A"))
        self.assertEqual(Payment.objects.get(sale=sale).received_by, self.staff_a)

    def test_a_handover_sale_keeps_the_staff_member_from_being_deleted(self):
        self.orm_sale(self.admin, handover=self.staff_b)
        response = self.client.delete(f"/api/auth/users/{self.staff_b.id}/")
        self.assertEqual((response.status_code, response.data["code"], response.data["counts"]["handover_sales"]), (409, "has_history", 1))
        self.assertTrue(User.objects.filter(pk=self.staff_b.pk).exists())


class StaffVisibilityTests(SaleFixtureMixin, GasBookTestCase):
    """Staff see only sales they recorded or handed over, on every endpoint."""

    def setUp(self):
        super().setUp()
        self.recorded_by_a = self.orm_sale(self.staff_a)
        self.handed_by_a = self.orm_sale(self.admin, handover=self.staff_a)
        self.handed_by_b = self.orm_sale(self.admin, handover=self.staff_b)
        self.no_handover = self.orm_sale(self.admin)

    def scoped_ids(self, user):
        request = Request(APIRequestFactory().get("/api/sales/"))
        request.user = user
        view = views.SaleViewSet(request=request, format_kwarg=None, action="list")
        return set(view.get_queryset().values_list("id", flat=True))

    def test_sale_queries_are_scoped_to_the_staff_member(self):
        self.assertEqual(self.scoped_ids(self.staff_a), {self.recorded_by_a.id, self.handed_by_a.id})
        self.assertEqual(self.scoped_ids(self.staff_b), {self.handed_by_b.id})
        self.assertEqual(len(self.scoped_ids(self.admin)), 4)

    def test_no_endpoint_shows_staff_other_peoples_sales(self):
        own_booking, own_delivery = self.assigned_booking(self.staff_a)
        other_booking, other_delivery = self.assigned_booking(self.staff_b)
        self.auth(self.staff_a)
        for url in ("/api/sales/", f"/api/sales/{self.handed_by_b.id}/", "/api/payments/", "/api/reports/", "/api/dashboard/",
                    f"/api/customers/{self.customer.id}/ledger/", "/api/activity/", f"/api/auth/users/{self.staff_b.id}/deliveries/"):
            with self.subTest(url=url):
                self.assertEqual(self.client.get(url).status_code, 403)
        delivery_ids = [d["id"] for d in self.client.get("/api/deliveries/").data["results"]]
        self.assertEqual(delivery_ids, [own_delivery.id])
        booking_ids = [b["id"] for b in self.client.get("/api/bookings/").data["results"]]
        self.assertEqual(booking_ids, [own_booking.id])
        customer = self.client.get(f"/api/customers/{self.customer.id}/").data
        self.assertFalse({"sales", "payments", "items"} & set(customer), "customer detail must not list sales")


class CustomerHistoryLabelTests(SaleFixtureMixin, GasBookTestCase):
    def setUp(self):
        super().setUp()
        self.set_stock(self.shop, filled=20)
        self.auth(self.admin)
        response = self.client.post("/api/sales/", self.sale_payload(handover_staff=self.staff_a.id), format="json")
        self.direct_sale = Sale.objects.get(pk=response.data["id"])
        booking_sale = self.orm_sale(self.staff_b, handover=self.staff_b)
        self.booking = self.make_booking(status=Booking.Status.DELIVERED, quantity=1, assigned_staff=self.staff_b, sale=booking_sale)
        Delivery.objects.create(booking=self.booking, staff=self.staff_b, status=Delivery.Status.DELIVERED)

    def history(self, **params):
        self.auth(self.customer_user)
        response = self.client.get("/api/bookings/history/", params)
        self.assertEqual(response.status_code, 200)
        return {(e["history_source"], e["source_id"]): e for e in response.data["results"]}

    def test_direct_sales_show_the_business_and_bookings_the_partner(self):
        entries = self.history()
        direct = entries[("sale", self.direct_sale.id)]
        self.assertEqual(direct["assigned_staff_name"], "Sabco Gas")
        self.assertTrue(direct["detail_message"].startswith("Direct sale by Sabco Gas."))
        for name in ("admin1", "Ad Min", "staffa", "Staff A"):  # who recorded it / handed it over
            self.assertNotIn(name, str(direct), "no user name may reach the customer on a direct sale")
        self.assertEqual(entries[("booking", self.booking.id)]["assigned_staff_name"], "Staff B")

    def test_status_filter_applies_to_each_entry(self):
        self.assertIn(("sale", self.direct_sale.id), self.history(status="delivered"))
        self.assertNotIn(("sale", self.direct_sale.id), self.history(status="cancelled"))
        self.assertNotIn(("sale", self.direct_sale.id), self.history(status="pending"))

    def test_a_direct_sale_can_show_as_cancelled_without_touching_bookings(self):
        """The hook Phase 6 will use for voided sales: one function decides the status."""
        with mock.patch.object(views, "direct_sale_history_status", return_value=Booking.Status.CANCELLED):
            cancelled = self.history(status="cancelled")
            delivered = self.history(status="delivered")
        self.assertEqual(cancelled[("sale", self.direct_sale.id)]["status"], "cancelled")
        self.assertIsNone(cancelled[("sale", self.direct_sale.id)]["delivered_at"])
        self.assertNotIn(("sale", self.direct_sale.id), delivered)
        self.assertEqual(delivered[("booking", self.booking.id)]["status"], "delivered")
        self.assertEqual(delivered[("booking", self.booking.id)]["assigned_staff_name"], "Staff B")


class SalesListFilterTests(SaleFixtureMixin, GasBookTestCase):
    def setUp(self):
        super().setUp()
        self.kandam = StockLocation.objects.create(name="Kandam", code="kandam")
        self.admin2 = User.objects.create_user(username="admin2", password="x", role=self.admin_role, first_name="Second", last_name="Admin")
        self.a = self.orm_sale(self.admin, handover=self.staff_a)
        self.b = self.orm_sale(self.admin2, location=self.kandam)
        self.c = self.orm_sale(self.staff_a, handover=self.staff_a)
        self.make_booking(status=Booking.Status.DELIVERED, sale=self.c)
        self.auth(self.admin)

    def ids(self, **params):
        response = self.client.get("/api/sales/", params)
        self.assertEqual(response.status_code, 200, response.data)
        return sorted(row["id"] for row in response.data["results"])

    def test_filters(self):
        self.assertEqual(self.ids(sold_by=self.admin2.id), [self.b.id])
        self.assertEqual(self.ids(handover_staff=self.staff_a.id), sorted([self.a.id, self.c.id]))
        self.assertEqual(self.ids(handover_staff="none"), [self.b.id])
        self.assertEqual(self.ids(location=self.kandam.id), [self.b.id])
        self.assertEqual(self.ids(source="direct"), sorted([self.a.id, self.b.id]))
        self.assertEqual(self.ids(source="booking"), [self.c.id])
        Sale.objects.filter(pk=self.b.pk).update(created_at="2026-01-05T10:00:00Z")
        self.assertEqual(self.ids(start="2026-01-01", end="2026-01-31"), [self.b.id])
        for params in ({"sold_by": "x"}, {"source": "phone"}, {"start": "2026-13-01"}, {"start": "2026-02-01", "end": "2026-01-01"}):
            with self.subTest(params=params):
                self.assertEqual(self.client.get("/api/sales/", params).status_code, 400)

    def test_rows_name_who_recorded_and_who_handed_over(self):
        rows = {row["id"]: row for row in self.client.get("/api/sales/").data["results"]}
        self.assertEqual((rows[self.a.id]["sold_by_full_name"], rows[self.a.id]["handover_staff_name"], rows[self.a.id]["is_direct"]),
                         ("Ad Min", "Staff A", True))
        self.assertEqual((rows[self.b.id]["sold_by_full_name"], rows[self.b.id]["handover_staff_name"]), ("Second Admin", None))
        self.assertEqual((rows[self.c.id]["sold_by_role"], rows[self.c.id]["is_direct"]), ("staff", False))
