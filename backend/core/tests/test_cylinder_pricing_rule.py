"""The business pricing rule, checked through every entry point.

* Refill          -> the refill rate only.
* New connection  -> the refill rate PLUS the new-cylinder deposit, each charged once per cylinder.
* There is no cylinder selling price: the legacy ``selling_price`` column must never change a charge.
"""
import uuid
from decimal import Decimal as D

from django.utils import timezone

from core.models import Booking, CylinderType, Payment, Sale, SaleItem
from core.pricing import calculate_pricing, unit_components

from .base import GasBookTestCase

REFILL, DEPOSIT = D("360"), D("450")


class PricingRuleBase(GasBookTestCase):
    def setUp(self):
        super().setUp()
        self.cylinder.refill_rate, self.cylinder.deposit_amount = REFILL, DEPOSIT
        self.cylinder.save()
        self.set_stock(self.shop, filled=60, empty=0)

    def line(self, kind, quantity=1):
        return dict(cylinder_type=self.cylinder.pk, quantity=quantity, rate_type=kind)

    def sale_body(self, kind, quantity=1, **extra):
        body = dict(client_ref=str(uuid.uuid4()), customer=self.customer.pk, location=self.shop.pk, payment_mode="cash",
                    sale_items=[self.line(kind, quantity)])
        body.update(extra)
        return body

    def set_selling_price(self, value):
        CylinderType.objects.filter(pk=self.cylinder.pk).update(selling_price=value)
        self.cylinder.refresh_from_db()


class RuleAtTheSourceTests(PricingRuleBase):
    def test_refill_is_the_refill_rate_only_and_new_connection_adds_the_deposit_once(self):
        for quantity in (1, 3):
            refill = calculate_pricing(self.customer, self.cylinder, quantity, "refill")
            new = calculate_pricing(self.customer, self.cylinder, quantity, "new")
            self.assertEqual((refill["deposit_unit_amount"], refill["refill_unit_amount"]), (D("0.00"), REFILL))
            self.assertEqual(refill["final_amount"], REFILL * quantity)
            self.assertEqual((new["deposit_unit_amount"], new["refill_unit_amount"]), (DEPOSIT, REFILL))
            self.assertEqual(new["final_amount"], (REFILL + DEPOSIT) * quantity)
            self.assertEqual(new["rate"], REFILL + DEPOSIT)

    def test_the_components_helper_is_the_single_definition(self):
        self.assertEqual(unit_components(self.customer, self.cylinder, "refill"), (D("0.00"), REFILL))
        self.assertEqual(unit_components(self.customer, self.cylinder, "new"), (DEPOSIT, REFILL))
        # reviewed per-sale amounts replace the two components, and a refill still never takes a deposit
        override = {"refill_charge": D("300"), "deposit": D("100")}
        self.assertEqual(unit_components(self.customer, self.cylinder, "new", component_rates=override), (D("100"), D("300")))
        self.assertEqual(unit_components(self.customer, self.cylinder, "refill", component_rates=override), (D("0.00"), D("300")))

    def test_selling_price_never_changes_a_charge(self):
        for selling_price in (0, 1, 99999):
            with self.subTest(selling_price=selling_price):
                self.set_selling_price(selling_price)
                self.assertEqual(calculate_pricing(self.customer, self.cylinder, 2, "refill")["final_amount"], D("720"))
                self.assertEqual(calculate_pricing(self.customer, self.cylinder, 2, "new")["final_amount"], D("1620"))

    def test_agreed_rate_and_discount_touch_only_the_refill_part(self):
        from core.models import CustomerCylinderRate
        CustomerCylinderRate.objects.create(customer=self.customer, cylinder_type=self.cylinder, custom_price=300)
        self.customer.global_discount_type, self.customer.global_discount_value = "percentage", D("10")
        self.customer.global_discount_is_active = True
        self.customer.save()
        refill = calculate_pricing(self.customer, self.cylinder, 2, "refill")
        new = calculate_pricing(self.customer, self.cylinder, 2, "new")
        self.assertEqual(refill["final_amount"], D("540"))                 # 2 x 300, less 10%
        self.assertEqual(new["final_amount"], D("1440"))                   # 2 x (300 + 450), less 10% of the refill part only
        self.assertEqual(new["discount_amount"], refill["discount_amount"])


class RuleThroughEveryFlowTests(PricingRuleBase):
    """The same expectations through each place a charge is made, with several legacy selling prices."""

    EXPECTED = {"refill": (D("0.00"), REFILL), "new": (DEPOSIT, REFILL)}

    def assert_sale(self, sale, kind, quantity):
        deposit, refill = self.EXPECTED[kind]
        item = sale.items.get()
        self.assertEqual((item.rate_type, item.deposit_unit_amount, item.refill_unit_amount), (kind, deposit, refill))
        self.assertEqual(sale.total_amount, (deposit + refill) * quantity)
        self.assertEqual(item.total_amount, sale.total_amount)

    def test_admin_direct_sale_and_its_preview(self):
        self.auth(self.admin)
        for selling_price in (0, 99999):
            self.set_selling_price(selling_price)
            for kind in ("refill", "new"):
                with self.subTest(selling_price=selling_price, kind=kind):
                    quote = self.client.post("/api/sales/preview/", {"customer": self.customer.pk, "sale_items": [self.line(kind, 2)]}, format="json")
                    self.assertEqual(quote.status_code, 200, quote.data)
                    response = self.client.post("/api/sales/", self.sale_body(kind, 2), format="json")
                    self.assertEqual(response.status_code, 201, response.data)
                    self.assertEqual(D(response.data["total_amount"]), D(quote.data["total_amount"]))
                    self.assert_sale(Sale.objects.get(pk=response.data["id"]), kind, 2)

    def test_staff_sale(self):
        self.auth(self.staff_a)
        for kind in ("refill", "new"):
            with self.subTest(kind=kind):
                response = self.client.post("/api/staff-sales/", self.sale_body(kind, 2), format="json")
                self.assertEqual(response.status_code, 201, response.data)
                self.assert_sale(Sale.objects.get(pk=response.data["id"]), kind, 2)

    def test_customer_booking_preview_and_checkout_amounts(self):
        self.auth(self.customer_user)
        for selling_price in (0, 99999):
            self.set_selling_price(selling_price)
            for kind, total in (("refill", "1080.00"), ("new", "2430.00")):
                with self.subTest(selling_price=selling_price, kind=kind):
                    preview = self.client.post("/api/bookings/preview/", {"items": [self.line(kind, 3)]}, format="json")
                    self.assertEqual(preview.status_code, 200, preview.data)
                    self.assertEqual(preview.data["items"][0]["final_amount"], total)
                    booked = self.client.post("/api/bookings/", self.line(kind, 3), format="json")
                    self.assertEqual(booked.status_code, 201, booked.data)
                    self.assertEqual(booked.data["final_amount"], total)
                    self.assertEqual(booked.data["deposit_unit_amount"], "450.00" if kind == "new" else "0.00")
                    self.assertEqual(booked.data["refill_unit_amount"], "360.00")

    def test_delivery_completion_bills_the_booking_amount_once(self):
        for kind in ("refill", "new"):
            with self.subTest(kind=kind):
                self.auth(self.customer_user)
                booked = self.client.post("/api/bookings/", self.line(kind, 2), format="json")
                booking = Booking.objects.get(pk=booked.data["id"])
                booking.status, booking.assigned_staff = "approved", self.staff_a
                booking.save()
                delivery = self.make_delivery(booking, self.staff_a)
                self.auth(self.staff_a)
                done = self.client.post(f"/api/deliveries/{delivery.pk}/complete/", {"empty_collected": 0}, format="json")
                self.assertEqual(done.status_code, 200, done.data)
                booking.refresh_from_db()
                self.assert_sale(booking.sale, kind, 2)
                self.assertEqual(booking.sale.balance_due, booking.sale.total_amount)   # credit: billed once, nothing double counted
                self.assertEqual(Payment.objects.filter(sale=booking.sale).count(), 0)

    def test_receipts_show_the_components_that_were_charged(self):
        self.auth(self.admin)
        sold = {kind: self.client.post("/api/sales/", self.sale_body(kind, 2, paid_amount="0.00", payment_mode="credit",
                                                                       paid_payment_mode="cash"), format="json").data["id"]
                for kind in ("refill", "new")}
        self.auth(self.customer_user)
        refill = self.client.get(f"/api/receipts/sale/{sold['refill']}/").data
        new = self.client.get(f"/api/receipts/sale/{sold['new']}/").data
        self.assertEqual((refill["items"][0]["deposit_unit_amount"], refill["items"][0]["refill_unit_amount"], refill["total_amount"]),
                         ("0.00", "360.00", "720.00"))
        self.assertEqual((new["items"][0]["deposit_unit_amount"], new["items"][0]["refill_unit_amount"], new["total_amount"]),
                         ("450.00", "360.00", "1620.00"))
        self.assertEqual(new["items"][0]["unit_amount"], "810.00")
        self.assertEqual(refill["items"][0]["unit_amount"], "360.00")

    def test_a_paid_new_connection_balances_to_zero_with_the_deposit_counted_once(self):
        self.auth(self.admin)
        response = self.client.post("/api/sales/", self.sale_body("new", 2), format="json")
        sale = Sale.objects.get(pk=response.data["id"])
        self.assertEqual((sale.total_amount, sale.paid_amount, sale.balance_due), (D("1620.00"), D("1620.00"), D("0.00")))
        self.assertEqual(sum(p.amount for p in sale.payments.all()), D("1620.00"))


class HistoryIsNeverRepricedTests(PricingRuleBase):
    def test_editing_rates_changes_new_transactions_only(self):
        self.auth(self.admin)
        sold = self.client.post("/api/sales/", self.sale_body("new", 2), format="json")
        self.assertEqual(sold.status_code, 201, sold.data)
        sale = Sale.objects.get(pk=sold.data["id"])
        self.auth(self.customer_user)
        booked = self.client.post("/api/bookings/", self.line("new", 1), format="json")
        booking = Booking.objects.get(pk=booked.data["id"])
        before_receipts = (self.client.get(f"/api/receipts/sale/{sale.pk}/").data, self.client.get(f"/api/receipts/booking/{booking.pk}/").data)

        self.auth(self.admin)
        edit = self.client.patch(f"/api/cylinder-types/{self.cylinder.pk}/", {"refill_rate": "500", "deposit_amount": "700"}, format="json")
        self.assertEqual(edit.status_code, 200, edit.data)

        sale.refresh_from_db(), booking.refresh_from_db()
        item = sale.items.get()
        self.assertEqual((sale.total_amount, item.deposit_unit_amount, item.refill_unit_amount), (D("1620.00"), DEPOSIT, REFILL))
        self.assertEqual((booking.final_amount, booking.deposit_unit_amount, booking.refill_unit_amount), (D("810.00"), DEPOSIT, REFILL))
        self.auth(self.customer_user)
        after_receipts = (self.client.get(f"/api/receipts/sale/{sale.pk}/").data, self.client.get(f"/api/receipts/booking/{booking.pk}/").data)
        self.assertEqual(before_receipts, after_receipts)
        # a new transaction uses the new rates: 500 + 700, and a refill is 500 with no deposit
        self.auth(self.admin)
        new = self.client.post("/api/sales/", self.sale_body("new", 1), format="json").data
        refill = self.client.post("/api/sales/", self.sale_body("refill", 1), format="json").data
        self.assertEqual((new["total_amount"], refill["total_amount"]), ("1200.00", "500.00"))

    def test_a_booking_delivered_after_a_rate_change_keeps_the_booked_price(self):
        self.auth(self.customer_user)
        booking = Booking.objects.get(pk=self.client.post("/api/bookings/", self.line("new", 1), format="json").data["id"])
        self.cylinder.refill_rate, self.cylinder.deposit_amount = D("999"), D("999")
        self.cylinder.save()
        booking.status, booking.assigned_staff = "approved", self.staff_a
        booking.save()
        delivery = self.make_delivery(booking, self.staff_a)
        self.auth(self.staff_a)
        self.assertEqual(self.client.post(f"/api/deliveries/{delivery.pk}/complete/", {}, format="json").status_code, 200)
        booking.refresh_from_db()
        item = booking.sale.items.get()
        self.assertEqual((booking.sale.total_amount, item.deposit_unit_amount, item.refill_unit_amount), (D("810.00"), DEPOSIT, REFILL))


class SellingPriceFieldTests(PricingRuleBase):
    def create(self, **fields):
        body = {"name": "35kg", "weight": "35", "refill_rate": "2400", "deposit_amount": "1500"}
        body.update(fields)
        return self.client.post("/api/cylinder-types/", body, format="json")

    def test_new_types_need_both_rates_and_get_no_selling_price(self):
        self.auth(self.admin)
        made = self.create()
        self.assertEqual(made.status_code, 201, made.data)
        self.assertEqual(made.data["selling_price"], "0.00")
        self.assertEqual((made.data["refill_rate"], made.data["deposit_amount"]), ("2400.00", "1500.00"))
        for missing in ("refill_rate", "deposit_amount"):
            body = {"name": "40kg", "weight": "40", "refill_rate": "1", "deposit_amount": "1"}
            body.pop(missing)
            response = self.client.post("/api/cylinder-types/", body, format="json")
            self.assertEqual(response.status_code, 400, response.data)
            self.assertIn(missing, response.data)
        self.assertEqual(self.create(name="41kg", deposit_amount="0").status_code, 201)  # a zero deposit is allowed once stated

    def test_a_selling_price_sent_by_a_client_is_ignored_on_create_and_edit(self):
        self.auth(self.admin)
        made = self.create(name="36kg", selling_price="9999")
        self.assertEqual(made.status_code, 201)
        self.assertEqual(made.data["selling_price"], "0.00")
        self.set_selling_price(450)
        edit = self.client.patch(f"/api/cylinder-types/{self.cylinder.pk}/", {"selling_price": "1", "refill_rate": "370"}, format="json")
        self.assertEqual(edit.status_code, 200, edit.data)
        self.cylinder.refresh_from_db()
        self.assertEqual((self.cylinder.selling_price, self.cylinder.refill_rate), (D("450.00"), D("370.00")))

    def test_the_legacy_value_is_still_returned_read_only_for_old_clients_and_records(self):
        self.auth(self.customer_user)
        self.set_selling_price(450)
        row = next(r for r in self.client.get("/api/cylinder-types/").data["results"] if r["id"] == self.cylinder.pk)
        self.assertEqual(row["selling_price"], "450.00")

    def test_legacy_lines_are_still_read_against_the_stored_legacy_value(self):
        """Old sale lines (no rate_type) were classified refill-or-new by a threshold built from the stored value,
        which still exists and no longer changes, so history and reports keep reading the same way."""
        self.set_selling_price(450)
        sale = Sale.objects.create(customer=self.customer, location=self.shop, sold_by=self.admin, total_amount=500, balance_due=0)
        SaleItem.objects.create(sale=sale, cylinder_type=self.cylinder, quantity=1, rate=D("500"), total_amount=D("500"))
        self.auth(self.admin)
        today = timezone.localdate().isoformat()
        report = self.client.get(f"/api/reports/?start={today}&end={today}")
        self.assertEqual(report.status_code, 200)
        row = next(r for r in report.data["stock_snapshot"] if r["type"] == self.cylinder.name)
        # rate 500 > (450 + 360) / 2 = 405, so the legacy line counts as a new connection and nothing is credited back
        self.assertEqual((row["with_customers"], row["customer_credits"]), (1, 0))


class DepositAccountingTests(PricingRuleBase):
    """A deposit stays inside the billed total, as always, but is now visible on its own in the report."""

    def report(self):
        today = timezone.localdate().isoformat()
        return self.client.get(f"/api/reports/?start={today}&end={today}").data["summary"]

    def test_reports_show_the_deposit_part_of_new_connections_only(self):
        self.auth(self.admin)
        self.client.post("/api/sales/", self.sale_body("new", 2), format="json")
        self.client.post("/api/sales/", self.sale_body("refill", 3), format="json")
        summary = self.report()
        self.assertEqual(D(str(summary["sales"])), D("1620") + D("1080"))      # deposits stay inside the sales total
        self.assertEqual(D(str(summary["deposits_included"])), D("900"))        # 2 new connections x 450, no refill deposit

    def test_the_figure_comes_from_saved_lines_and_ignores_discounts_and_later_rate_edits(self):
        self.customer.global_discount_type, self.customer.global_discount_value = "percentage", D("50")
        self.customer.global_discount_is_active = True
        self.customer.save()
        self.auth(self.admin)
        sold = self.client.post("/api/sales/", self.sale_body("new", 1), format="json")
        self.assertEqual(D(sold.data["total_amount"]), D("630"))                # 450 + (360 - 180): the deposit is never discounted
        self.client.patch(f"/api/cylinder-types/{self.cylinder.pk}/", {"deposit_amount": "10"}, format="json")
        self.assertEqual(D(str(self.report()["deposits_included"])), D("450"))

    def test_no_new_connections_means_no_deposit_figure(self):
        self.auth(self.admin)
        self.client.post("/api/sales/", self.sale_body("refill", 2), format="json")
        self.assertEqual(D(str(self.report()["deposits_included"])), D("0"))
