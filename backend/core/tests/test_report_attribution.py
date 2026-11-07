"""Report breakdowns by person, checked against a known fixture.

Every sale is counted once in the overall total. "Recorded by", "Handed over by" and
"Collections by receiver" are three separate views: each adds up to its own total, and
they are never added together. Sales have several lines and several payments, so any join
that repeated rows would show up as inflated totals.
"""
import uuid
from decimal import Decimal

from core.models import CylinderType, Sale, StockLocation, User

from .base import GasBookTestCase


class ReportAttributionTests(GasBookTestCase):
    """Fixture, all today:
      A  recorded by admin, handed over by Staff A, Shop: 2 x 14kg @900 + 1 x 5kg @450 = 2250,
         paid in two parts (cash 1000 + gpay 1250).
      B  recorded by a second admin, no handover, Kandam: 1 x 14kg @900 = 900 on credit;
         the second admin later receives 400 against it.
      C  Staff A completes a booking delivery, Shop: 1 x 14kg = 900 cash (recorded and handed
         over by Staff A).
    """

    def setUp(self):
        super().setUp()
        self.kandam = StockLocation.objects.create(name="Kandam", code="kandam")
        self.small = CylinderType.objects.create(name="5kg", weight=Decimal("5"), selling_price=Decimal("450"), refill_rate=Decimal("450"))
        self.admin2 = User.objects.create_user(username="admin2", password="x", role=self.admin_role, first_name="Second", last_name="Admin")
        self.set_stock(self.shop, filled=10)
        self.set_stock(self.shop, filled=10, cylinder=self.small)
        self.set_stock(self.kandam, filled=10)

        self.auth(self.admin)
        self.a = self.sell(location=self.shop.id, payment_mode="split", paid_amount="2250", handover_staff=self.staff_a.id,
                           split_payments=[{"mode": "cash", "amount": "1000"}, {"mode": "gpay", "amount": "1250"}],
                           sale_items=[self.line(2, "900"), self.line(1, "450", self.small)])
        self.auth(self.admin2)
        self.b = self.sell(location=self.kandam.id, payment_mode="credit", paid_amount="0", sale_items=[self.line(1, "900")])
        response = self.client.post("/api/payments/", {"customer": self.customer.id, "sale": self.b.id, "amount": "400",
                                                       "payment_mode": "cash"}, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        booking, delivery = self.assigned_booking(self.staff_a, quantity=1)
        self.auth(self.staff_a)
        response = self.client.post(f"/api/deliveries/{delivery.id}/complete/",
                                    {"payment_method": "cash", "payment_collected": "900.00"}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.c = Sale.objects.get(booking=booking)
        self.auth(self.admin)

    def line(self, quantity, rate, cylinder=None):
        return {"cylinder_type": (cylinder or self.cylinder).id, "quantity": quantity, "rate": rate}

    def sell(self, **payload):
        response = self.client.post("/api/sales/", {"client_ref": str(uuid.uuid4()), "customer": self.customer.id, **payload}, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        return Sale.objects.get(pk=response.data["id"])

    def report(self, **params):
        response = self.client.get("/api/reports/", params)
        self.assertEqual(response.status_code, 200, response.data)
        return response.data

    @staticmethod
    def by_name(rows):
        return {row["name"]: (row["count"], row["amount"]) for row in rows}

    def test_overall_totals_count_each_sale_and_payment_once(self):
        data = self.report()
        self.assertEqual(data["summary"]["sales"], Decimal("4050.00"))      # 2250 + 900 + 900
        self.assertEqual(data["summary"]["collection"], Decimal("3550.00"))  # 1000 + 1250 + 400 + 900
        self.assertEqual(len(data["sales_list"]), 3)

    def test_recorded_by(self):
        rows = self.report()["staff_breakdown"]["recorded_by"]
        self.assertEqual(self.by_name(rows), {
            "Ad Min": (1, Decimal("2250.00")), "Second Admin": (1, Decimal("900.00")), "Staff A": (1, Decimal("900.00")),
        })
        self.assertEqual({row["name"]: row["role"] for row in rows}, {"Ad Min": "admin", "Second Admin": "admin", "Staff A": "staff"})
        self.assertEqual(sum(row["amount"] for row in rows), Decimal("4050.00"))

    def test_handed_over_by(self):
        rows = self.report()["staff_breakdown"]["handed_over_by"]
        self.assertEqual(self.by_name(rows), {"Staff A": (2, Decimal("3150.00")), "Not specified": (1, Decimal("900.00"))})
        self.assertEqual(sum(row["amount"] for row in rows), Decimal("4050.00"))

    def test_collections_by_receiver(self):
        rows = self.report()["staff_breakdown"]["collections_by_receiver"]
        # The receiver is whoever took the money: the sale's recorder, never the handover person.
        self.assertEqual(self.by_name(rows), {
            "Ad Min": (2, Decimal("2250.00")), "Staff A": (1, Decimal("900.00")), "Second Admin": (1, Decimal("400.00")),
        })
        self.assertEqual(sum(row["amount"] for row in rows), Decimal("3550.00"))

    def test_cylinder_sales_are_grouped_by_type_and_location(self):
        rows = self.report()["cylinder_sales"]
        self.assertEqual({(r["cylinder_type__name"], r["sale__location__name"]): (r["total_qty"], r["total_amount"]) for r in rows}, {
            ("14kg Domestic", "Shop"): (3, Decimal("2700.00")),
            ("14kg Domestic", "Kandam"): (1, Decimal("900.00")),
            ("5kg", "Shop"): (1, Decimal("450.00")),
        })
        self.assertEqual({key for row in rows for key in row}, {"cylinder_type__name", "sale__location__name", "total_qty", "total_amount"})
        self.assertEqual(sum(r["total_amount"] for r in rows), Decimal("4050.00"))

    def test_location_filter_applies_to_sales_sections(self):
        data = self.report(location=self.kandam.id)
        self.assertEqual(data["summary"]["sales"], Decimal("900.00"))
        self.assertEqual(self.by_name(data["staff_breakdown"]["recorded_by"]), {"Second Admin": (1, Decimal("900.00"))})
        self.assertEqual(self.by_name(data["staff_breakdown"]["handed_over_by"]), {"Not specified": (1, Decimal("900.00"))})
        self.assertEqual([r["sale__location__name"] for r in data["cylinder_sales"]], ["Kandam"])
        self.assertEqual([row["id"] for row in data["sales_list"]], [self.b.id])
        # Payments have no location, so collections stay whole.
        self.assertEqual(data["summary"]["collection"], Decimal("3550.00"))
        self.assertEqual(data["filters"]["location"], self.kandam.id)
        self.assertEqual(self.client.get("/api/reports/", {"location": "kandam"}).status_code, 400)

    def test_other_days_are_excluded(self):
        Sale.objects.filter(pk=self.c.pk).update(created_at="2026-01-05T10:00:00Z")
        data = self.report()
        self.assertEqual(data["summary"]["sales"], Decimal("3150.00"))
        self.assertEqual(self.by_name(data["staff_breakdown"]["recorded_by"])["Ad Min"], (1, Decimal("2250.00")))
        self.assertNotIn("Staff A", self.by_name(data["staff_breakdown"]["recorded_by"]))
