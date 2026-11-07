"""backfill_sale_handover is a dry run under every invocation: it reports, never writes."""
import json
import unittest
from decimal import Decimal
from io import StringIO

from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import connection
from django.test import TransactionTestCase
from django.utils import timezone

from core import integrity
from core.management.commands.backfill_sale_handover import build_plan
from core.models import Booking, CustomerProfile, CylinderType, Delivery, Role, Sale, SaleItem, StockLocation, User

from .base import GasBookTestCase


def make_sale(customer, location, cylinder, sold_by, handover=None, delivery_staff=""):
    sale = Sale.objects.create(customer=customer, location=location, total_amount=Decimal("900"), paid_amount=Decimal("900"),
                               payment_mode="cash", sold_by=sold_by, handover_staff=handover, delivery_staff=delivery_staff)
    SaleItem.objects.create(sale=sale, cylinder_type=cylinder, quantity=1, rate=Decimal("900"), total_amount=Decimal("900"))
    return sale


class BackfillPlanTests(GasBookTestCase):
    def setUp(self):
        super().setUp()
        self.staff_b_twin = User.objects.create_user(username="staffb2", password="x", role=self.staff_role,
                                                     first_name="Staff", last_name="B")  # same display name as staff B

        def booked(sold_by, delivery_staff=None, delivery_status=Delivery.Status.DELIVERED, completed=True, handover=None):
            sale = make_sale(self.customer, self.shop, self.cylinder, sold_by, handover=handover)
            booking = self.make_booking(status=Booking.Status.DELIVERED, quantity=1, sale=sale)
            if delivery_staff is not None:
                Delivery.objects.create(booking=booking, staff=delivery_staff, status=delivery_status,
                                        completed_at=timezone.now() if completed else None)
            return sale

        self.proposed = booked(self.staff_a, delivery_staff=self.staff_a)
        self.by_admin = booked(self.admin, delivery_staff=self.staff_b)
        self.no_delivery = booked(self.admin)
        self.not_completed = booked(self.staff_a, delivery_staff=self.staff_a, delivery_status=Delivery.Status.OUT_FOR_DELIVERY,
                                    completed=False)
        self.already = booked(self.staff_a, delivery_staff=self.staff_a, handover=self.staff_a)
        self.direct_blank = make_sale(self.customer, self.shop, self.cylinder, self.admin)
        self.direct_one_name = make_sale(self.customer, self.shop, self.cylinder, self.admin, delivery_staff="Staff A")
        self.direct_two_names = make_sale(self.customer, self.shop, self.cylinder, self.admin, delivery_staff="Staff B")

    def test_every_sale_is_proposed_skipped_or_ambiguous_with_a_reason(self):
        plan = build_plan()
        self.assertTrue(plan["dry_run"])
        self.assertEqual(plan["counts"], {"sales": 8, "proposed": 1, "ambiguous": 3, "skipped": 4})

        proposed = plan["proposed"][0]
        self.assertEqual((proposed["sale_id"], proposed["handover_staff"]["id"], proposed["staff_active"]), (self.proposed.id, self.staff_a.id, True))

        ambiguous = {row["sale_id"]: row for row in plan["ambiguous"]}
        self.assertEqual(set(ambiguous), {self.by_admin.id, self.direct_one_name.id, self.direct_two_names.id})
        self.assertIn("recorded by another", ambiguous[self.by_admin.id]["reason"])
        self.assertEqual(len(ambiguous[self.direct_one_name.id]["staff_with_that_name"]), 1)
        self.assertEqual(len(ambiguous[self.direct_two_names.id]["staff_with_that_name"]), 2)

        skipped = {row["sale_id"]: row["reason"] for row in plan["skipped"]}
        self.assertEqual(skipped, {
            self.no_delivery.id: "booking has no delivery record",
            self.not_completed.id: "delivery not completed (status out_for_delivery)",
            self.already.id: "handover already recorded",
            self.direct_blank.id: "direct sale with no handover recorded",
        })


@unittest.skipUnless(connection.vendor == "postgresql", "read-only transactions are a PostgreSQL feature")
class BackfillCommandWritesNothingTests(TransactionTestCase):
    def setUp(self):
        staff_role = Role.objects.create(name="Staff", code="staff")
        customer_role = Role.objects.create(name="Customer", code="customer")
        self.staff = User.objects.create_user(username="d-staff", password="x", role=staff_role)
        customer = CustomerProfile.objects.create(user=User.objects.create_user(username="d-cust", password="x", role=customer_role))
        cylinder = CylinderType.objects.create(name="14kg", weight=Decimal("14.2"), selling_price=Decimal("900"))
        shop = StockLocation.objects.create(name="Shop", code="shop")
        self.sale = make_sale(customer, shop, cylinder, self.staff)
        booking = Booking.objects.create(customer=customer, cylinder_type=cylinder, quantity=1, status=Booking.Status.DELIVERED, sale=self.sale)
        Delivery.objects.create(booking=booking, staff=self.staff, status=Delivery.Status.DELIVERED, completed_at=timezone.now())

    def test_no_invocation_writes(self):
        before = integrity.fingerprint()
        out = StringIO()
        call_command("backfill_sale_handover", stdout=out)
        self.assertIn("DRY RUN: nothing was written", out.getvalue())
        self.assertIn(f"sale {self.sale.id} GB", out.getvalue())
        out = StringIO()
        call_command("backfill_sale_handover", "--json", stdout=out)
        self.assertEqual([row["sale_id"] for row in json.loads(out.getvalue())["proposed"]], [self.sale.id])
        for option in ("--execute", "--apply", "--write"):
            with self.subTest(option=option), self.assertRaises(CommandError):
                call_command("backfill_sale_handover", option)
        self.assertEqual(integrity.compare_fingerprints(before, integrity.fingerprint()), [])
        self.sale.refresh_from_db()
        self.assertIsNone(self.sale.handover_staff_id)
