"""Reports and the dashboard around voided sales.

Gross sales stay on the sale's own day; a cancellation is reported once, on the day of the
void; net sales = gross - cancelled. Collections are payments by date: a refund owed is not
money paid out (refunds_owed), a confirmed refund is (a negative payment, also in
refunds_paid). A credit void nets to zero in collections on its day.
"""
from datetime import datetime, time, timedelta
from decimal import Decimal

from django.utils import timezone

from core import integrity
from core.models import Payment, Sale, SaleRefund, SaleVoid, Stock, StockLocation

from .test_sale_void import VoidTestCase

D = Decimal


class VoidReportingTests(VoidTestCase):
    def day(self, offset):
        return timezone.localdate() + timedelta(days=offset)

    def at(self, day, clock=time(12)):
        return timezone.make_aware(datetime.combine(day, clock))

    def summary(self, start, end, **params):
        response = self.client.get("/api/reports/", {"start": start.isoformat(), "end": end.isoformat(), **params})
        self.assertEqual(response.status_code, 200, response.data)
        return response.data["summary"]

    def figures(self, start, end):
        s = self.summary(start, end)
        return {key: s[key] for key in ("sales", "cancelled", "net_sales", "collection", "refunds_paid", "refunds_owed")}

    def test_refund_across_three_days_with_midnight_boundaries(self):
        d1, d2, d3 = self.day(-2), self.day(-1), self.day(0)
        sale = self.sell()  # cash 900
        Sale.objects.filter(pk=sale.pk).update(created_at=self.at(d1))
        Payment.objects.filter(sale=sale).update(created_at=self.at(d1))
        self.assertEqual(self.void(sale, reason="typo", outcome="refund").status_code, 200)
        SaleVoid.objects.filter(sale=sale).update(created_at=self.at(d2, time(23, 59, 59)))  # last second of d2

        z = 0
        self.assertEqual(self.figures(d1, d1), {"sales": D("900.00"), "cancelled": z, "net_sales": D("900.00"),
                                                "collection": D("900.00"), "refunds_paid": z, "refunds_owed": D("900.00")})
        self.assertEqual(self.figures(d2, d2), {"sales": z, "cancelled": D("900.00"), "net_sales": D("-900.00"),
                                                "collection": z, "refunds_paid": z, "refunds_owed": D("900.00")})
        self.assertEqual(self.figures(d3, d3), {"sales": z, "cancelled": z, "net_sales": z,
                                                "collection": z, "refunds_paid": z, "refunds_owed": D("900.00")})
        self.assertEqual(self.figures(d1, d3), {"sales": D("900.00"), "cancelled": D("900.00"), "net_sales": D("0.00"),
                                                "collection": D("900.00"), "refunds_paid": z, "refunds_owed": D("900.00")})

        self.assertEqual(self.confirm(sale).status_code, 200)
        refund_payment = Payment.objects.get(sale=sale, amount__lt=0)
        Payment.objects.filter(pk=refund_payment.pk).update(created_at=self.at(d3, time(0, 0, 1)))  # first second of d3
        SaleRefund.objects.filter(void__sale=sale).update(created_at=self.at(d3, time(0, 0, 1)))

        self.assertEqual(self.figures(d1, d1)["collection"], D("900.00"))  # history unchanged
        self.assertEqual(self.figures(d2, d2), {"sales": z, "cancelled": D("900.00"), "net_sales": D("-900.00"),
                                                "collection": z, "refunds_paid": z, "refunds_owed": z})
        self.assertEqual(self.figures(d3, d3), {"sales": z, "cancelled": z, "net_sales": z,
                                                "collection": D("-900.00"), "refunds_paid": D("900.00"), "refunds_owed": z})
        self.assertEqual(self.figures(d1, d3), {"sales": D("900.00"), "cancelled": D("900.00"), "net_sales": D("0.00"),
                                                "collection": D("0.00"), "refunds_paid": D("900.00"), "refunds_owed": z})
        self.assert_clean()

    def test_credit_void_nets_to_zero_on_its_day(self):
        d1, today = self.day(-1), self.day(0)
        sale = self.split_sale()
        Sale.objects.filter(pk=sale.pk).update(created_at=self.at(d1))
        Payment.objects.filter(sale=sale).update(created_at=self.at(d1))
        self.assertEqual(self.void(sale, reason="typo", outcome="credit").status_code, 200)
        self.assertEqual(self.figures(today, today), {"sales": 0, "cancelled": D("900.00"), "net_sales": D("-900.00"),
                                                      "collection": D("0.00"), "refunds_paid": 0, "refunds_owed": 0})
        self.assertEqual(self.figures(d1, d1)["collection"], D("900.00"))
        breakdown = self.client.get("/api/reports/").data["staff_breakdown"]["collections_by_receiver"]
        self.assertEqual([(row["name"], row["count"], row["amount"]) for row in breakdown], [("Ad Min", 4, D("0.00"))])

    def test_cancellations_follow_the_location_filter_and_are_listed(self):
        kandam = StockLocation.objects.create(name="Kandam", code="kandam")
        self.set_stock(kandam, filled=5)
        at_shop = self.sell(lines=[{"cylinder_type": self.cylinder.id, "quantity": 1, "rate": "900"}])
        self.void(at_shop, reason="typo", outcome="refund")
        at_kandam = self.sell(location=kandam.id, lines=[{"cylinder_type": self.cylinder.id, "quantity": 1, "rate": "900"}])
        self.void(at_kandam, reason="Wrong location", outcome="credit")
        today = self.day(0)
        self.assertEqual(self.summary(today, today)["cancelled"], D("1800.00"))
        self.assertEqual(self.summary(today, today, location=kandam.id)["cancelled"], D("900.00"))
        rows = self.client.get("/api/reports/", {"location": kandam.id}).data["cancellation_list"]
        self.assertEqual([(r["sale_id"], r["outcome"], r["reason"], r["voided_by_name"], r["refunded"]) for r in rows],
                         [(at_kandam.id, "credit", "Wrong location", "Ad Min", False)])

    def test_dashboard_today_figures(self):
        self.sell()
        sale = self.sell(lines=[{"cylinder_type": self.cylinder.id, "quantity": 1, "rate": "900"}])
        self.void(sale, reason="typo", outcome="refund")
        data = self.client.get("/api/dashboard/").data
        self.assertEqual((data["today_sales"], data["today_cancelled"], data["today_net_sales"]),
                         (D("1800.00"), D("900.00"), D("900.00")))
        self.assertEqual(data["today_collection"], D("1800.00"))  # the refund is still owed
        monthly = self.client.get("/api/reports/").data["monthly"]
        self.assertEqual((monthly["sales"], monthly["cancelled"], monthly["net_sales"]), (D("1800.00"), D("900.00"), D("900.00")))

    def test_credit_void_across_midnight_nets_to_zero_per_mode(self):
        d1, d2 = self.day(-1), self.day(0)
        sale = self.split_sale()  # cash 500 + gpay 400
        Sale.objects.filter(pk=sale.pk).update(created_at=self.at(d1, time(23, 59, 59)))
        Payment.objects.filter(sale=sale).update(created_at=self.at(d1, time(23, 59, 59)))
        self.assertEqual(self.void(sale, reason="typo", outcome="credit").status_code, 200)
        Payment.objects.filter(sale=sale, amount__lt=0).update(created_at=self.at(d2, time(0, 0, 1)))
        Payment.objects.filter(sale=None).update(created_at=self.at(d2, time(0, 0, 1)))
        SaleVoid.objects.filter(sale=sale).update(created_at=self.at(d2, time(0, 0, 1)))

        def by_mode(day):
            totals = {}
            for p in Payment.objects.filter(created_at__date=day):
                totals[p.payment_mode] = totals.get(p.payment_mode, D("0")) + p.amount
            return totals

        self.assertEqual(by_mode(d1), {"cash": D("500.00"), "gpay": D("400.00")})
        self.assertEqual(by_mode(d2), {"cash": D("0.00"), "gpay": D("0.00")})  # reversal and credit, same mode, same day
        self.assertEqual(self.figures(d1, d1), {"sales": D("900.00"), "cancelled": 0, "net_sales": D("900.00"),
                                                "collection": D("900.00"), "refunds_paid": 0, "refunds_owed": 0})
        self.assertEqual(self.figures(d2, d2), {"sales": 0, "cancelled": D("900.00"), "net_sales": D("-900.00"),
                                                "collection": D("0.00"), "refunds_paid": 0, "refunds_owed": 0})
        from core.services import customer_outstanding
        self.assertEqual(customer_outstanding(self.customer), D("-900.00"))
        self.assert_clean()

    def test_each_confirmed_refund_counts_once(self):
        first = self.sell(lines=[{"cylinder_type": self.cylinder.id, "quantity": 1, "rate": "900"}])
        second = self.sell(payment_mode="gpay", lines=[{"cylinder_type": self.cylinder.id, "quantity": 1, "rate": "900"}])
        today = self.day(0)
        gross_collection = self.summary(today, today)["collection"]
        for sale in (second, first):  # latest first
            self.void(sale, reason="typo", outcome="refund")
        self.assertEqual(self.summary(today, today)["collection"], gross_collection)  # owed, not paid out
        self.confirm(second, references={"gpay": "UTR7"})
        self.confirm(first)
        s = self.summary(today, today)
        self.assertEqual((s["refunds_paid"], s["refunds_owed"]), (D("1800.00"), 0))
        self.assertEqual(s["refunds_paid"], sum(r.amount for r in SaleRefund.objects.all()))
        self.assertEqual(s["collection"], gross_collection - D("1800.00"))  # each refund taken off once

    def test_by_person_and_cylinder_tables_stay_gross(self):
        kept = self.sell(lines=[{"cylinder_type": self.cylinder.id, "quantity": 1, "rate": "900"}])
        cancelled = self.sell(lines=[{"cylinder_type": self.cylinder.id, "quantity": 2, "rate": "900"}])
        self.void(cancelled, reason="typo", outcome="refund")
        data = self.client.get("/api/reports/").data
        self.assertEqual(data["summary"]["sales"], D("2700.00"))
        self.assertEqual([(r["name"], r["count"], r["amount"]) for r in data["staff_breakdown"]["recorded_by"]], [("Ad Min", 2, D("2700.00"))])
        self.assertEqual([(r["total_qty"], r["total_amount"]) for r in data["cylinder_sales"]], [(3, D("2700.00"))])
        self.assertEqual(data["summary"]["net_sales"], D("900.00"))
        self.assertIsNone(next(r for r in data["sales_list"] if r["id"] == kept.id)["void"])

    def test_refunds_are_not_location_filtered(self):
        kandam = StockLocation.objects.create(name="Kandam", code="kandam")
        self.set_stock(kandam, filled=5)
        sale = self.sell(location=kandam.id, lines=[{"cylinder_type": self.cylinder.id, "quantity": 1, "rate": "900"}])
        self.void(sale, reason="typo", outcome="refund")
        self.confirm(sale)
        today = self.day(0)
        at_shop = self.summary(today, today, location=self.shop.id)
        self.assertEqual((at_shop["cancelled"], at_shop["refunds_paid"], at_shop["collection"]), (0, D("900.00"), D("0.00")))

    def test_booking_delivery_sales_and_their_reports_are_unchanged(self):
        booking, delivery = self.assigned_booking(self.staff_a, quantity=1)
        self.auth(self.staff_a)
        self.client.post(f"/api/deliveries/{delivery.id}/complete/", {"payment_method": "cash", "payment_collected": "900.00"}, format="json")
        self.auth(self.admin)
        booking_sale = Sale.objects.get(booking=booking)
        report_before = self.client.get("/api/reports/").data
        row = next(r for r in report_before["sales_list"] if r["id"] == booking_sale.id)
        Stock.objects.filter(location=self.shop, status="empty").update(quantity=10)
        direct = self.sell(lines=[{"cylinder_type": self.cylinder.id, "quantity": 1, "rate": "900"}])
        self.void(direct, reason="typo", outcome="credit")
        report = self.client.get("/api/reports/").data
        self.assertEqual(next(r for r in report["sales_list"] if r["id"] == booking_sale.id), row)
        self.assertIn(("Staff A", 1, D("900.00")),
                      [(r["name"], r["count"], r["amount"]) for r in report["staff_breakdown"]["handed_over_by"]])
        self.refused(self.void(booking_sale, reason="typo", outcome="refund"), 409, "booking_sale")
        self.assertEqual(report["summary"]["cancelled"], D("900.00"))  # only the direct sale

    def test_with_customers_is_as_of_the_end_date(self):
        d1, today = self.day(-2), self.day(0)
        sale = self.sell(payment_mode="credit", paid_amount="0",
                         lines=[{"cylinder_type": self.cylinder.id, "quantity": 1, "rate": "900"}])
        Sale.objects.filter(pk=sale.pk).update(created_at=self.at(d1))
        self.void(sale, reason="typo")

        def with_customers(end):
            data = self.client.get("/api/reports/", {"start": d1.isoformat(), "end": end.isoformat()}).data
            return data["stock_snapshot"][0]["with_customers"]

        self.assertEqual(with_customers(self.day(-1)), 1)  # voided after that day
        self.assertEqual(with_customers(today), 0)
        self.assertEqual(integrity.violations(), [])
