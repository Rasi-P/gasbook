"""Cancelling (voiding) a direct sale, confirming its refund, and customer credit.

A void never edits or deletes the sale, its lines or its payments. It returns the stock, stops
the unpaid balance being due and settles any money paid by a refund (owed, then confirmed once
in full) or by customer credit. Every refusal leaves the whole database unchanged.
"""
import uuid
from decimal import Decimal
from unittest import mock

from django.db import IntegrityError, transaction

from core import integrity, services
from core.models import (
    ActivityLog, Notification, Payment, PaymentReversal, Sale, SaleRefund, SaleVoid, Stock, StockLocation,
)
from core.services import customer_outstanding

from .base import GasBookTestCase

D = Decimal


class VoidTestCase(GasBookTestCase):
    def setUp(self):
        super().setUp()
        self.set_stock(self.shop, filled=20, empty=5)
        self.auth(self.admin)

    def sell(self, *, lines=None, **overrides):
        body = {
            "client_ref": str(uuid.uuid4()), "customer": self.customer.id, "location": self.shop.id, "payment_mode": "cash",
            "sale_items": lines or [{"cylinder_type": self.cylinder.id, "quantity": 1, "rate": "900", "empty_returned": 1}],
        }
        body.update(overrides)
        response = self.client.post("/api/sales/", body, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        return Sale.objects.get(pk=response.data["id"])

    def split_sale(self):
        return self.sell(payment_mode="split", paid_amount="900",
                         split_payments=[{"mode": "cash", "amount": "500"}, {"mode": "gpay", "amount": "400"}])

    def void(self, sale, **body):
        return self.client.post(f"/api/sales/{sale.id}/void/", body, format="json")

    def confirm(self, sale, **body):
        return self.client.post(f"/api/sales/{sale.id}/confirm-refund/", body, format="json")

    def stock(self, status):
        return Stock.objects.get(cylinder_type=self.cylinder, location=self.shop, status=status).quantity

    def refused(self, response, status, code):
        self.assertEqual((response.status_code, response.data.get("code")), (status, code), response.data)

    def assert_clean(self):
        self.assertEqual(integrity.violations(), [])


class AuthorizationTests(VoidTestCase):
    def test_only_admins_can_void_preview_or_confirm(self):
        sale = self.sell()
        before = integrity.fingerprint()
        for user in (self.staff_a, self.customer_user):
            self.auth(user)
            with self.subTest(user=user.username):
                self.assertEqual(self.void(sale, reason="x", outcome="refund").status_code, 403)
                self.assertEqual(self.client.get(f"/api/sales/{sale.id}/void-preview/").status_code, 403)
                self.assertEqual(self.confirm(sale).status_code, 403)
        self.client.force_authenticate(None)
        self.assertEqual(self.void(sale, reason="x", outcome="refund").status_code, 401)
        self.assertEqual(integrity.compare_fingerprints(before, integrity.fingerprint()), [])


class ValidationTests(VoidTestCase):
    def test_booking_delivery_sales_cannot_be_voided(self):
        booking, delivery = self.assigned_booking(self.staff_a, quantity=1)
        self.auth(self.staff_a)
        response = self.client.post(f"/api/deliveries/{delivery.id}/complete/", {"payment_method": "cash", "payment_collected": "900.00"},
                                    format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.auth(self.admin)
        sale = Sale.objects.get(booking=booking)
        before = integrity.fingerprint()
        self.refused(self.void(sale, reason="wrong", outcome="refund"), 409, "booking_sale")
        self.assertFalse(self.client.get(f"/api/sales/{sale.id}/void-preview/").data["can_void"])
        self.assertEqual(integrity.compare_fingerprints(before, integrity.fingerprint()), [])

    def test_reason_and_outcome_are_validated(self):
        from core.models import CylinderType
        small = CylinderType.objects.create(name="5kg", weight=D("5"), selling_price=D("450"))
        self.set_stock(self.shop, filled=10, cylinder=small)
        paid = self.sell()
        unpaid = self.sell(payment_mode="credit", paid_amount="0", lines=[{"cylinder_type": small.id, "quantity": 1, "rate": "450"}])
        before = integrity.fingerprint()
        for body, code in (
            ({"outcome": "refund"}, "reason_required"),
            ({"reason": "   ", "outcome": "refund"}, "reason_required"),
            ({"reason": 5, "outcome": "refund"}, "reason_required"),
            ({"reason": "x" * 301, "outcome": "refund"}, "max_length"),
            ({"reason": "typo", "outcome": "cash-back"}, "invalid_outcome"),
            ({"reason": "typo"}, "outcome_required"),
            ({"reason": "typo", "outcome": "none"}, "outcome_required"),
        ):
            with self.subTest(body=body):
                self.refused(self.void(paid, **body), 400, code)
        for outcome in ("refund", "credit"):
            with self.subTest(outcome=outcome):
                self.refused(self.void(unpaid, reason="typo", outcome=outcome), 400, "nothing_paid")
        self.assertEqual(self.client.post(f"/api/sales/{paid.id}/void/", ["x"], format="json").status_code, 400)
        self.assertEqual(integrity.compare_fingerprints(before, integrity.fingerprint()), [])

    def test_a_sale_is_voided_once(self):
        sale = self.sell()
        self.assertEqual(self.void(sale, reason="typo", outcome="credit").status_code, 200)
        before = integrity.fingerprint()
        for outcome in ("credit", "refund"):
            self.refused(self.void(sale, reason="again", outcome=outcome), 409, "already_voided")
        self.assertEqual(integrity.compare_fingerprints(before, integrity.fingerprint()), [])
        with self.assertRaises(IntegrityError), transaction.atomic():
            SaleVoid.objects.create(sale=sale, reason="db", outcome="credit", paid_amount=D("900"), cancelled_balance=0,
                                    voided_by=self.admin)

    def test_inactive_location_is_refused(self):
        sale = self.sell()
        StockLocation.objects.filter(pk=self.shop.pk).update(is_active=False)
        before = integrity.fingerprint()
        self.refused(self.void(sale, reason="typo", outcome="refund"), 409, "location_inactive")
        self.assertEqual(integrity.compare_fingerprints(before, integrity.fingerprint()), [])

    def test_empties_no_longer_at_the_location_are_refused(self):
        sale = self.sell(lines=[{"cylinder_type": self.cylinder.id, "quantity": 1, "rate": "900", "empty_returned": 2}])
        Stock.objects.filter(cylinder_type=self.cylinder, location=self.shop, status="empty").update(quantity=1)  # sent away
        before = integrity.fingerprint()
        response = self.void(sale, reason="typo", outcome="refund")
        self.refused(response, 409, "insufficient_empty_stock")
        self.assertEqual(response.data["shortages"], [{"cylinder_type": self.cylinder.id, "name": "14kg Domestic", "required": 2, "available": 1}])
        self.assertEqual(integrity.compare_fingerprints(before, integrity.fingerprint()), [])

    def test_a_later_sale_of_the_same_cylinder_type_blocks_the_void(self):
        from core.models import CylinderType
        small = CylinderType.objects.create(name="5kg", weight=D("5"), selling_price=D("450"))
        self.set_stock(self.shop, filled=10, cylinder=small)
        first = self.sell()
        other_type = self.sell(lines=[{"cylinder_type": small.id, "quantity": 1, "rate": "450"}])
        later = self.sell()
        response = self.void(first, reason="typo", outcome="refund")
        self.refused(response, 409, "later_sales")
        self.assertEqual(response.data["blockers"][0]["sale_ids"], [later.id])
        self.assertIn(f"#{later.id}", response.data["detail"])
        # The latest first, then the earlier one; a later sale of another type never blocks.
        self.assertEqual(self.void(later, reason="typo", outcome="refund").status_code, 200)
        self.assertEqual(self.void(first, reason="typo", outcome="refund").status_code, 200)
        self.assertFalse(SaleVoid.objects.filter(sale=other_type).exists())
        self.assert_clean()

    def test_nothing_can_be_paid_against_a_voided_sale(self):
        sale = self.sell(payment_mode="credit", paid_amount="0",
                         lines=[{"cylinder_type": self.cylinder.id, "quantity": 1, "rate": "900"}])
        self.assertEqual(self.void(sale, reason="typo").status_code, 200)
        response = self.client.post("/api/payments/", {"customer": self.customer.id, "sale": sale.id, "amount": "100",
                                                       "payment_mode": "cash"}, format="json")
        self.refused(response, 409, "sale_voided")
        response = self.client.post("/api/payments/", {"customer": self.customer.id, "amount": "100", "payment_mode": "cash"},
                                    format="json")
        self.refused(response, 400, "exceeds_balance")  # the voided balance is no longer owed

    def test_refund_confirmation_is_refused_in_the_wrong_state(self):
        sale = self.sell()
        self.refused(self.confirm(sale), 409, "not_voided")
        self.assertEqual(self.void(sale, reason="typo", outcome="credit").status_code, 200)
        self.refused(self.confirm(sale), 409, "no_refund_owed")


class UnpaidVoidTests(VoidTestCase):
    def test_an_unpaid_sale_is_cancelled_without_money_records(self):
        sale = self.sell(payment_mode="credit", paid_amount="0")
        self.assertEqual(customer_outstanding(self.customer), D("900.00"))
        filled, empty = self.stock("filled"), self.stock("empty")
        payments = Payment.objects.count()
        response = self.void(sale, reason="Entered for the wrong customer")
        self.assertEqual(response.status_code, 200, response.data)
        void = SaleVoid.objects.get(sale=sale)
        self.assertEqual((void.outcome, void.paid_amount, void.cancelled_balance, void.refund_due, void.voided_by),
                         ("none", D("0.00"), D("900.00"), D("0.00"), self.admin))
        self.assertEqual(response.data["void"]["status"], "cancelled")
        self.assertEqual((self.stock("filled"), self.stock("empty")), (filled + 1, empty - 1))
        self.assertEqual(Payment.objects.count(), payments)
        self.assertEqual(customer_outstanding(self.customer), D("0.00"))
        sale_row = Sale.objects.get(pk=sale.pk)
        self.assertEqual((sale_row.total_amount, sale_row.paid_amount, sale_row.balance_due), (D("900.00"), D("0.00"), D("900.00")))
        log = ActivityLog.objects.get(action="sale_voided")
        self.assertEqual((log.metadata["outcome"], log.metadata["reason"], log.metadata["cancelled_balance"]),
                         ("none", "Entered for the wrong customer", "900.00"))
        note = Notification.objects.get(recipient=self.customer_user, notification_type="DIRECT_SALE_CANCELLED")
        self.assertIn("has been cancelled. The unpaid balance of Rs. 900.00 is no longer due.", note.body)
        self.assertEqual(ActivityLog.objects.filter(action="sale_created", metadata__sale_id=sale.pk).count(), 1)
        self.assert_clean()

    def test_partly_paid_sale_needs_an_outcome_for_the_paid_part(self):
        sale = self.sell(payment_mode="credit", paid_amount="300", paid_payment_mode="cash")
        self.refused(self.void(sale, reason="typo"), 400, "outcome_required")
        self.assertEqual(self.void(sale, reason="typo", outcome="refund").status_code, 200)
        void = SaleVoid.objects.get(sale=sale)
        self.assertEqual((void.paid_amount, void.cancelled_balance, void.refund_due), (D("300.00"), D("600.00"), D("300.00")))
        note = Notification.objects.get(notification_type="DIRECT_SALE_CANCELLED")
        self.assertIn("A refund of Rs. 300.00 is owed to you and will be sent. The unpaid balance of Rs. 600.00 is no longer due.", note.body)
        self.assertEqual(customer_outstanding(self.customer), D("0.00"))
        self.assert_clean()


class RefundTests(VoidTestCase):
    def setUp(self):
        super().setUp()
        from core.models import User
        self.admin2 = User.objects.create_user(username="admin2", password="x", role=self.admin_role, first_name="Second", last_name="Admin")

    def test_refund_is_owed_at_void_time_and_paid_on_confirmation(self):
        sale = self.split_sale()
        collection = self.client.get("/api/reports/").data["summary"]["collection"]
        payments = Payment.objects.count()
        response = self.void(sale, reason="Customer returned the cylinder", outcome="refund")
        self.assertEqual(response.status_code, 200, response.data)
        void = SaleVoid.objects.get(sale=sale)
        self.assertEqual((void.outcome, void.paid_amount, void.refund_due), ("refund", D("900.00"), D("900.00")))
        self.assertEqual(response.data["void"]["status"], "refund_pending")
        # Owed, not paid: no payment rows, collections and the customer's balance unchanged.
        self.assertEqual(Payment.objects.count(), payments)
        report = self.client.get("/api/reports/").data["summary"]
        self.assertEqual((report["collection"], report["refunds_owed"], report["refunds_paid"]), (collection, D("900.00"), 0))
        self.assertEqual(customer_outstanding(self.customer), D("0.00"))
        cancelled = Notification.objects.get(notification_type="DIRECT_SALE_CANCELLED")
        self.assertIn("A refund of Rs. 900.00 is owed to you and will be sent.", cancelled.body)
        self.assertFalse(Notification.objects.filter(notification_type="REFUND_COMPLETED").exists())
        self.assert_clean()

        self.auth(self.admin2)
        response = self.confirm(sale, references={"gpay": " UTR123 "})
        self.assertEqual(response.status_code, 200, response.data)
        refund = SaleRefund.objects.get(void=void)
        self.assertEqual((refund.amount, refund.references, refund.confirmed_by), (D("900.00"), {"gpay": "UTR123"}, self.admin2))
        reversals = Payment.objects.filter(sale=sale, amount__lt=0).order_by("id")
        self.assertEqual([(p.payment_mode, p.amount, p.received_by) for p in reversals],
                         [("cash", D("-500.00"), self.admin2), ("gpay", D("-400.00"), self.admin2)])
        self.assertEqual([link.sale_refund for link in PaymentReversal.objects.filter(sale_void=void)], [refund, refund])
        self.assertEqual(response.data["void"]["status"], "refunded")
        self.assertEqual([p["kind"] for p in response.data["payments"]], ["payment", "payment", "refund", "refund"])
        report = self.client.get("/api/reports/").data["summary"]
        self.assertEqual((report["collection"], report["refunds_owed"], report["refunds_paid"]),
                         (collection - D("900.00"), 0, D("900.00")))
        self.assertEqual(customer_outstanding(self.customer), D("0.00"))
        done = Notification.objects.get(notification_type="REFUND_COMPLETED")
        self.assertIn("Your refund of Rs. 900.00", done.body)
        self.assertIn("Cash Rs. 500.00, GPay Rs. 400.00 (ref UTR123)", done.body)
        self.assertEqual(ActivityLog.objects.get(action="refund_confirmed").user, self.admin2)
        self.assert_clean()

        before = integrity.fingerprint()
        self.refused(self.confirm(sale, references={"gpay": "UTR123"}), 409, "refund_already_confirmed")
        self.assertEqual(integrity.compare_fingerprints(before, integrity.fingerprint()), [])

    def test_references_by_mode(self):
        gpay = self.split_sale()
        bank = self.sell(payment_mode="bank")
        cash = self.sell(lines=[{"cylinder_type": self.cylinder.id, "quantity": 1, "rate": "900", "empty_returned": 0}])
        for sale in (cash, bank, gpay):
            self.assertEqual(self.void(sale, reason="typo", outcome="refund").status_code, 200)
        before = integrity.fingerprint()
        for sale, body, code in (
            (gpay, {}, "reference_required"),
            (gpay, {"references": {"gpay": "  "}}, "reference_required"),
            (bank, {"references": {"cash": "x"}}, "invalid"),        # nothing was paid in cash
            (bank, {"references": {"bank": "x" * 101}}, "max_length"),
            (bank, {"references": {"bank": 5}}, "invalid"),
            (bank, {"references": "NEFT1"}, "invalid"),
            (bank, {"references": {"bank": "NEFT1"}, "amount": "500"}, "amount_mismatch"),
            (bank, {"references": {"bank": "NEFT1"}, "amount": "1000"}, "amount_mismatch"),  # never more than paid
        ):
            with self.subTest(sale=sale.payment_mode, body=body):
                self.refused(self.confirm(sale, **body), 400, code)
        self.assertEqual(integrity.compare_fingerprints(before, integrity.fingerprint()), [])
        self.assertEqual(self.confirm(cash).status_code, 200)  # cash reference optional
        self.assertEqual(SaleRefund.objects.get(void__sale=cash).references, {})
        self.assertEqual(self.confirm(bank, references={"bank": "NEFT1"}, amount="900.00").status_code, 200)
        self.assert_clean()

    def test_the_database_refuses_a_second_refund_or_a_refund_unlike_the_payment(self):
        sale = self.sell()
        self.void(sale, reason="typo", outcome="refund")
        self.assertEqual(self.confirm(sale).status_code, 200)
        void = SaleVoid.objects.get(sale=sale)
        with self.assertRaises(IntegrityError), transaction.atomic():
            SaleRefund.objects.create(void=void, amount=D("900"), confirmed_by=self.admin)
        original = Payment.objects.get(sale=sale, amount__gt=0)
        reversal = Payment.objects.create(customer=self.customer, sale=sale, amount=D("-900"), payment_mode="cash", received_by=self.admin)
        with self.assertRaises(IntegrityError), transaction.atomic():
            PaymentReversal.objects.create(original=original, reversal=reversal, sale_void=void,
                                           sale_refund=SaleRefund.objects.get(void_id=void.pk))
        with self.assertRaises(IntegrityError), transaction.atomic():  # refund_due must equal what was paid
            SaleVoid.objects.filter(pk=void.pk).update(refund_due=D("1000"))


class CreditTests(VoidTestCase):
    def test_credit_reverses_each_payment_and_keeps_it_for_the_customer(self):
        sale = self.split_sale()
        today = self.client.get("/api/reports/").data["summary"]
        response = self.void(sale, reason="Wrong cylinder; customer will buy again", outcome="credit")
        self.assertEqual(response.status_code, 200, response.data)
        void = SaleVoid.objects.get(sale=sale)
        self.assertEqual((void.outcome, void.refund_due, response.data["void"]["status"]), ("credit", D("0.00"), "credited"))
        links = list(PaymentReversal.objects.filter(sale_void=void).select_related("original", "reversal", "credit"))
        self.assertEqual(
            [(l.original.payment_mode, l.original.amount, l.reversal.amount, l.reversal.sale_id, l.credit.amount, l.credit.sale_id,
              l.credit.payment_mode, l.reversal.received_by, l.sale_refund) for l in links],
            [("cash", D("500.00"), D("-500.00"), sale.id, D("500.00"), None, "cash", self.admin, None),
             ("gpay", D("400.00"), D("-400.00"), sale.id, D("400.00"), None, "gpay", self.admin, None)],
        )
        # Same-day collections, in total and per mode, are what they were before the void.
        after = self.client.get("/api/reports/").data["summary"]
        self.assertEqual(after["collection"], today["collection"])
        for mode in ("cash", "gpay"):
            self.assertEqual(sum(p.amount for p in Payment.objects.filter(payment_mode=mode)),
                             {"cash": D("500.00"), "gpay": D("400.00")}[mode])
        self.assertEqual(customer_outstanding(self.customer), D("-900.00"))
        detail = self.client.get(f"/api/customers/{self.customer.id}/").data
        self.assertEqual((detail["pending_balance"], detail["credit_balance"]), ("-900.00", "900.00"))
        note = Notification.objects.get(notification_type="DIRECT_SALE_CANCELLED")
        self.assertIn("The Rs. 900.00 you paid is kept as credit on your account.", note.body)
        kinds = {p["id"]: p["kind"] for p in self.client.get(f"/api/customers/{self.customer.id}/ledger/").data["payments"]}
        self.assertEqual(sorted(kinds.values()), ["credit", "credit", "credit_reversal", "credit_reversal", "payment", "payment"])
        self.assert_clean()

    def test_credit_offsets_later_dues_with_the_opening_balance_and_unlinked_payments(self):
        self.customer.opening_balance = D("200.00")
        self.customer.save(update_fields=["opening_balance"])
        # 150 paid towards the opening balance (not linked to a sale).
        response = self.client.post("/api/payments/", {"customer": self.customer.id, "amount": "150", "payment_mode": "cash"},
                                    format="json")
        self.assertEqual(response.status_code, 201, response.data)
        self.assertIsNone(Payment.objects.get(pk=response.data["id"]).sale_id)
        sale = self.sell()                                                   # paid in full, 900
        self.assertEqual(customer_outstanding(self.customer), D("50.00"))     # 200 - 150
        self.void(sale, reason="typo", outcome="credit")
        self.assertEqual(customer_outstanding(self.customer), D("-850.00"))   # 50 - 900 credit
        later = self.sell(payment_mode="credit", paid_amount="0",
                          lines=[{"cylinder_type": self.cylinder.id, "quantity": 1, "rate": "900", "empty_returned": 1}])
        self.assertEqual(customer_outstanding(self.customer), D("50.00"))     # the credit pays for the new sale
        detail = self.client.get(f"/api/customers/{self.customer.id}/").data
        self.assertEqual((detail["pending_balance"], detail["credit_balance"]), ("50.00", "0.00"))
        # No advance payments: only what is owed after the credit can be paid.
        response = self.client.post("/api/payments/", {"customer": self.customer.id, "amount": "60", "payment_mode": "cash"},
                                    format="json")
        self.refused(response, 400, "exceeds_balance")
        self.assertEqual(self.client.post("/api/payments/", {"customer": self.customer.id, "amount": "50", "payment_mode": "cash"},
                                          format="json").status_code, 201)
        self.assertEqual(customer_outstanding(self.customer), D("0.00"))
        self.assertEqual(Sale.objects.get(pk=later.pk).balance_due, D("850.00"))  # the sale itself is untouched by credit
        reference = integrity.customer_balances()[self.customer.id]
        self.assertEqual(reference["pending"], str(customer_outstanding(self.customer)))
        self.assert_clean()


class EmptiesAndBalancesTests(VoidTestCase):
    def test_a_voided_sale_leaves_the_customer_empties_and_dues(self):
        sale = self.sell(payment_mode="credit", paid_amount="0",
                         lines=[{"cylinder_type": self.cylinder.id, "quantity": 2, "rate": "900", "empty_returned": 0}])
        detail = self.client.get(f"/api/customers/{self.customer.id}/").data
        self.assertEqual(detail["empties_owed"], {self.cylinder.id: {"owed": 2, "name": "14kg Domestic"}})
        dashboard = self.client.get("/api/dashboard/").data
        self.assertEqual((dashboard["pending_payments"], dashboard["stock_rows"][0]["with_customers"]), (D("1800.00"), 2))
        self.assertEqual(self.void(sale, reason="typo").status_code, 200)
        detail = self.client.get(f"/api/customers/{self.customer.id}/").data
        self.assertEqual((detail["empties_owed"], detail["pending_balance"]), ({}, "0.00"))
        dashboard = self.client.get("/api/dashboard/").data
        self.assertEqual((dashboard["pending_payments"], dashboard["stock_rows"][0]["with_customers"]), (0, 0))
        reports = self.client.get("/api/reports/").data
        self.assertEqual((reports["summary"]["pending"], reports["pending_dues"]), (0, []))
        self.assertEqual(reports["stock_snapshot"][0]["with_customers"], 0)
        reference = integrity.customer_balances()[self.customer.id]
        self.assertEqual((reference["pending"], reference["empties_owed"]), ("0.00", {}))
        self.assert_clean()

    def test_sales_list_filters(self):
        kept = self.sell(payment_mode="credit", paid_amount="0")
        cancelled = self.sell(payment_mode="credit", paid_amount="0", lines=[{"cylinder_type": self.cylinder.id, "quantity": 1, "rate": "900"}])
        refund = self.sell(lines=[{"cylinder_type": self.cylinder.id, "quantity": 1, "rate": "900"}])
        self.void(refund, reason="typo", outcome="refund")
        self.void(cancelled, reason="typo")

        def ids(**params):
            return sorted(row["id"] for row in self.client.get("/api/sales/", params).data["results"])

        self.assertEqual(ids(pending="1"), [kept.id])
        self.assertEqual(ids(void_status="active"), [kept.id])
        self.assertEqual(ids(void_status="cancelled"), sorted([cancelled.id, refund.id]))
        self.assertEqual(ids(void_status="refund_pending"), [refund.id])
        self.assertEqual(self.client.get("/api/sales/", {"void_status": "gone"}).status_code, 400)


class PreviewTests(VoidTestCase):
    def test_preview_shows_the_effects_and_blockers_without_writing(self):
        sale = self.split_sale()
        before = integrity.fingerprint()
        data = self.client.get(f"/api/sales/{sale.id}/void-preview/").data
        self.assertEqual((data["can_void"], data["paid"], data["cancelled_balance"], data["outcomes"]),
                         (True, "900.00", "0.00", ["refund", "credit"]))
        self.assertEqual(data["stock_changes"], [{"cylinder_type": self.cylinder.id, "name": "14kg Domestic", "filled_back": 1, "empties_out": 1}])
        self.assertEqual([(p["mode"], p["amount"]) for p in data["payments"]], [("cash", "500.00"), ("gpay", "400.00")])
        StockLocation.objects.filter(pk=self.shop.pk).update(is_active=False)
        Stock.objects.filter(location=self.shop, status="empty").update(quantity=0)
        data = self.client.get(f"/api/sales/{sale.id}/void-preview/").data
        self.assertEqual((data["can_void"], [b["code"] for b in data["blockers"]]), (False, ["location_inactive", "insufficient_empty_stock"]))
        StockLocation.objects.filter(pk=self.shop.pk).update(is_active=True)
        Stock.objects.filter(location=self.shop, status="empty").update(quantity=6)
        self.assertEqual(integrity.compare_fingerprints(before, integrity.fingerprint()), [])


class CustomerHistoryTests(VoidTestCase):
    def history(self, **params):
        self.auth(self.customer_user)
        response = self.client.get("/api/bookings/history/", params)
        self.auth(self.admin)
        return {(e["history_source"], e["source_id"]): e for e in response.data["results"]}

    def test_cancelled_direct_sales_and_unchanged_bookings(self):
        booking, delivery = self.assigned_booking(self.staff_a, quantity=1)
        self.auth(self.staff_a)
        self.client.post(f"/api/deliveries/{delivery.id}/complete/", {"payment_method": "cash", "payment_collected": "900.00"}, format="json")
        self.auth(self.admin)
        booking_entry = self.history()[("booking", booking.id)]
        Stock.objects.filter(location=self.shop, status="empty").update(quantity=10)
        line = [{"cylinder_type": self.cylinder.id, "quantity": 1, "rate": "900"}]
        refund_sale, credit_sale = self.sell(lines=line), self.sell(lines=line)
        unpaid_sale = self.sell(lines=line, payment_mode="credit", paid_amount="0")
        # The latest sale of a cylinder type is voided first.
        for sale, outcome in ((unpaid_sale, None), (credit_sale, "credit"), (refund_sale, "refund")):
            body = {"reason": "typo"} | ({"outcome": outcome} if outcome else {})
            self.assertEqual(self.void(sale, **body).status_code, 200)
        entries = self.history()
        expected = {
            refund_sale.id: "Direct sale by Sabco Gas was cancelled. A refund of Rs. 900.00 is owed to you.",
            credit_sale.id: "Direct sale by Sabco Gas was cancelled. Rs. 900.00 is kept as credit on your account.",
            unpaid_sale.id: "Direct sale by Sabco Gas was cancelled. Nothing is due.",
        }
        for sale_id, message in expected.items():
            entry = entries[("sale", sale_id)]
            self.assertEqual((entry["status"], entry["detail_message"], entry["payment_status"], entry["delivered_at"],
                              entry["assigned_staff_name"]), ("cancelled", message, "CANCELLED", None, "Sabco Gas"))
        self.confirm(refund_sale)
        self.assertEqual(self.history()[("sale", refund_sale.id)]["detail_message"],
                         "Direct sale by Sabco Gas was cancelled. Rs. 900.00 has been refunded.")
        self.assertEqual(self.history()[("booking", booking.id)], booking_entry)  # bookings unchanged
        self.assertIn(("sale", refund_sale.id), self.history(status="cancelled"))
        self.assertNotIn(("sale", refund_sale.id), self.history(status="delivered"))
        self.assertIn(("booking", booking.id), self.history(status="delivered"))


class RollbackTests(VoidTestCase):
    """A failure at any step leaves nothing behind: stock, records, payments, log, notification."""

    def attempt(self, target, call):
        before = integrity.fingerprint()
        with mock.patch(target, side_effect=RuntimeError("boom")), self.assertRaises(RuntimeError):
            call()
        self.assertEqual(integrity.compare_fingerprints(before, integrity.fingerprint()), [])

    def test_void_rolls_back_at_every_step(self):
        sale = self.split_sale()
        for target in (
            "core.services.get_stock_row",
            "core.services.SaleVoid.objects.create",
            "core.services.PaymentReversal.objects.create",
            "core.services.ActivityLog.objects.create",
            "core.services.notify",
        ):
            with self.subTest(target=target):
                self.attempt(target, lambda: self.void(sale, reason="typo", outcome="credit"))
        self.assertEqual(self.void(sale, reason="typo", outcome="credit").status_code, 200)

    def test_refund_confirmation_rolls_back_at_every_step(self):
        sale = self.split_sale()
        self.void(sale, reason="typo", outcome="refund")
        for target in (
            "core.services.SaleRefund.objects.create",
            "core.services.PaymentReversal.objects.create",
            "core.services.ActivityLog.objects.create",
            "core.services.notify",
        ):
            with self.subTest(target=target):
                self.attempt(target, lambda: self.confirm(sale, references={"gpay": "UTR9"}))
        self.assertEqual(self.confirm(sale, references={"gpay": "UTR9"}).status_code, 200)
        self.assert_clean()


class IntegrityRuleTests(VoidTestCase):
    def codes(self):
        return sorted({problem["check"] for problem in integrity.violations()})

    def test_negative_payments_are_valid_only_as_exact_linked_reversals(self):
        sale = self.split_sale()
        self.void(sale, reason="typo", outcome="credit")
        self.assert_clean()
        stray = Payment.objects.create(customer=self.customer, sale=None, amount=D("-10"), payment_mode="cash", received_by=self.admin)
        self.assertEqual(self.codes(), ["payment_positive"])
        stray.delete()
        reversal = PaymentReversal.objects.filter(sale_void__sale=sale).first().reversal
        Payment.objects.filter(pk=reversal.pk).update(amount=D("-499.00"))
        self.assertEqual(self.codes(), ["payment_positive", "payment_reversal_valid"])
        Payment.objects.filter(pk=reversal.pk).update(amount=D("-500.00"), payment_mode="bank")
        self.assertEqual(self.codes(), ["payment_positive", "payment_reversal_valid"])

    def test_voids_must_match_their_sale_and_refund(self):
        sale = self.sell()
        self.void(sale, reason="typo", outcome="refund")
        void = SaleVoid.objects.get(sale=sale)
        # A refund recorded without its reversal payments.
        SaleRefund.objects.create(void=void, amount=D("900"), confirmed_by=self.admin)
        self.assertEqual(self.codes(), ["sale_refund_matches_void", "sale_void_reversals_complete"])
        SaleRefund.objects.filter(void=void).delete()
        Sale.objects.filter(pk=sale.pk).update(paid_amount=D("800"), balance_due=D("100"))
        self.assertIn("sale_void_matches_sale", self.codes())
