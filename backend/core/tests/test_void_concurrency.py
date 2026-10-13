"""Voids and refunds racing each other, payments, new sales and delivery completions.

Each request runs in its own thread and connection (TransactionTestCase), so PostgreSQL row
locks and unique constraints behave for real. holding_lock makes a request keep the customer
lock for a moment, so the other request certainly arrives while it is held.
"""
import unittest
import uuid
from decimal import Decimal

from django.db import connection
from django.test import TransactionTestCase
from django.utils import timezone
from rest_framework.test import APIClient

from core import integrity
from core.services import customer_outstanding
from core.models import (
    ActivityLog, Booking, CustomerProfile, CylinderType, Delivery, Payment, PaymentReversal, Role, Sale, SaleRefund, SaleVoid, StaffProfile,
    Stock, StockLocation, StockMovement, User,
)

from .concurrency import first_then_second, holding_lock, run_concurrently

D = Decimal


@unittest.skipUnless(connection.vendor == "postgresql", "locks are tested on PostgreSQL")
class ConcurrentVoidTests(TransactionTestCase):
    def setUp(self):
        roles = {code: Role.objects.create(name=code.title(), code=code) for code in ("admin", "staff", "customer")}
        self.admin = User.objects.create_user(username="v-admin", password="x", role=roles["admin"])
        self.staff = User.objects.create_user(username="v-staff", password="x", role=roles["staff"])
        StaffProfile.objects.create(user=self.staff)
        self.customer = CustomerProfile.objects.create(
            user=User.objects.create_user(username="v-cust", password="x", role=roles["customer"], address="1 Road", phone="9811111111")
        )
        self.shop = StockLocation.objects.create(name="Shop", code="shop")
        self.cylinder = CylinderType.objects.create(name="14kg", weight=D("14.2"), selling_price=D("900"))
        Stock.objects.create(cylinder_type=self.cylinder, location=self.shop, status=Stock.Status.FILLED, quantity=20)
        Stock.objects.create(cylinder_type=self.cylinder, location=self.shop, status=Stock.Status.EMPTY, quantity=5)
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

    def sell(self, **extra):
        body = {"client_ref": str(uuid.uuid4()), "customer": self.customer.id, "location": self.shop.id, "payment_mode": "cash",
                "sale_items": [{"cylinder_type": self.cylinder.id, "quantity": 1, "rate": "900"}], **extra}
        response = self.client.post("/api/sales/", body, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        return Sale.objects.get(pk=response.data["id"])

    def test_two_voids_at_once_record_one(self):
        sale = self.sell()
        url = f"/api/sales/{sale.id}/void/"
        with holding_lock("core.services.lock_customer"):
            results = run_concurrently([(self.admin, url, {"reason": "a", "outcome": "credit"}),
                                        (self.admin, url, {"reason": "b", "outcome": "refund"})])
        self.assertEqual(sorted(status for status, _ in results), [200, 409], results)
        self.assertEqual([data["code"] for status, data in results if status == 409], ["already_voided"])
        void = SaleVoid.objects.get(sale=sale)
        self.assertEqual(PaymentReversal.objects.count(), 1 if void.outcome == "credit" else 0)
        self.assertEqual(Stock.objects.get(location=self.shop, cylinder_type=self.cylinder, status="filled").quantity, 20)
        self.assertEqual(integrity.violations(), [])

    def test_two_refund_confirmations_at_once_record_one(self):
        sale = self.sell(payment_mode="gpay")
        self.assertEqual(self.client.post(f"/api/sales/{sale.id}/void/", {"reason": "a", "outcome": "refund"}, format="json").status_code, 200)
        url = f"/api/sales/{sale.id}/confirm-refund/"
        with holding_lock("core.services.lock_customer"):
            results = run_concurrently([(self.admin, url, {"references": {"gpay": "UTR1"}}),
                                        (self.admin, url, {"references": {"gpay": "UTR2"}})])
        self.assertEqual(sorted(status for status, _ in results), [200, 409], results)
        self.assertEqual([data["code"] for status, data in results if status == 409], ["refund_already_confirmed"])
        self.assertEqual(SaleRefund.objects.count(), 1)
        self.assertEqual(list(Payment.objects.filter(amount__lt=0).values_list("amount", flat=True)), [D("-900.00")])
        self.assertEqual(integrity.violations(), [])

    def test_a_void_and_a_payment_on_the_same_sale(self):
        sale = self.sell(payment_mode="credit", paid_amount="0")
        with holding_lock("core.services.lock_customer"):
            results = run_concurrently([
                (self.admin, f"/api/sales/{sale.id}/void/", {"reason": "typo"}),
                (self.admin, "/api/payments/", {"customer": self.customer.id, "sale": sale.id, "amount": "300", "payment_mode": "cash"}),
            ])
        (void_status, void_data), (pay_status, pay_data) = results
        # Either the void came first and the payment was refused, or the payment came first
        # and the void then needs an outcome for the money now paid. Never both.
        self.assertIn(((void_status, void_data.get("code")), (pay_status, pay_data.get("code"))), [
            ((200, None), (409, "sale_voided")),
            ((400, "outcome_required"), (201, None)),
        ], results)
        self.assertEqual(integrity.violations(), [])

    def test_a_void_and_a_delivery_completion_for_the_same_customer(self):
        earlier = self.sell()
        booking = Booking.objects.create(customer=self.customer, cylinder_type=self.cylinder, quantity=1, original_amount=D("900"), final_amount=D("900"),
                                         status=Booking.Status.APPROVED, assigned_staff=self.staff)
        delivery = Delivery.objects.create(booking=booking, staff=self.staff, status=Delivery.Status.ASSIGNED)
        with holding_lock("core.services.lock_customer"), holding_lock("core.views.lock_customer"):
            results = run_concurrently([
                (self.admin, f"/api/sales/{earlier.id}/void/", {"reason": "typo", "outcome": "refund"}),
                (self.staff, f"/api/deliveries/{delivery.id}/complete/", {"payment_method": "cash", "payment_collected": "900.00"}),
            ])
        (void_status, void_data), (done_status, done_data) = results
        self.assertEqual(done_status, 200, results)
        delivered = Sale.objects.get(booking=booking)
        if void_status == 200:
            # The delivery waited for the void: its sale was created after the void committed.
            self.assertGreater(delivered.created_at, SaleVoid.objects.get(sale=earlier).created_at)
        else:
            self.assertEqual((void_status, void_data["code"]), (409, "later_sales"), results)
        self.assertEqual(integrity.violations(), [])

    def test_a_void_and_a_new_sale_of_the_same_type(self):
        earlier = self.sell()
        body = {"client_ref": str(uuid.uuid4()), "customer": self.customer.id, "location": self.shop.id, "payment_mode": "cash",
                "sale_items": [{"cylinder_type": self.cylinder.id, "quantity": 1, "rate": "900"}]}
        with holding_lock("core.services.lock_customer"):
            results = run_concurrently([
                (self.admin, f"/api/sales/{earlier.id}/void/", {"reason": "typo", "outcome": "refund"}),
                (self.admin, "/api/sales/", body),
            ])
        (void_status, void_data), (sale_status, sale_data) = results
        self.assertEqual(sale_status, 201, results)
        if void_status == 200:
            self.assertGreater(Sale.objects.get(pk=sale_data["id"]).created_at, SaleVoid.objects.get(sale=earlier).created_at)
        else:
            self.assertEqual((void_status, void_data["code"]), (409, "later_sales"), results)
        self.assertEqual(integrity.violations(), [])


@unittest.skipUnless(connection.vendor == "postgresql", "locks are tested on PostgreSQL")
class OrderedVoidAndPaymentTests(ConcurrentVoidTests):
    """A void and a Receive Payment for the same customer, in a fixed order: the second request is
    sent only while the first holds the customer lock, so it has to wait for the first to commit."""

    LOCK = "core.services.lock_customer"

    def setUp(self):
        super().setUp()
        self.sale = self.sell(payment_mode="credit", paid_amount="0")  # owes 900, nothing paid
        self.filled = Stock.objects.get(location=self.shop, cylinder_type=self.cylinder, status="filled").quantity

    def void(self, **body):
        return (self.admin, f"/api/sales/{self.sale.id}/void/", {"reason": "typo", **body})

    def receive(self, amount, sale=None):
        body = {"customer": self.customer.id, "amount": amount, "payment_mode": "cash"}
        return (self.admin, "/api/payments/", body | ({"sale": sale.id} if sale else {}))

    def assert_waited(self, timing):
        self.assertIsNotNone(timing["second_waited"], "the second request never took the customer lock")
        self.assertGreaterEqual(timing["second_waited"], timing["hold"] - 0.05, timing)

    def filled_now(self):
        return Stock.objects.get(location=self.shop, cylinder_type=self.cylinder, status="filled").quantity

    def test_void_first_then_receive_payment(self):
        results, timing = first_then_second(self.void(), self.receive("300"), self.LOCK)
        self.assertEqual([(status, data.get("code")) for status, data in results], [(200, None), (400, "exceeds_balance")], results)
        self.assert_waited(timing)
        void = SaleVoid.objects.get(sale=self.sale)
        self.assertEqual((void.outcome, void.paid_amount, void.cancelled_balance), ("none", D("0.00"), D("900.00")))
        self.assertEqual(Payment.objects.count(), 0)
        self.assertEqual(customer_outstanding(self.customer), D("0.00"))
        self.assertEqual(self.filled_now(), self.filled + 1)
        self.assertEqual((ActivityLog.objects.filter(action="sale_voided").count(), ActivityLog.objects.filter(action="payment_received").count()), (1, 0))
        self.assertEqual(integrity.violations(), [])

    def test_void_first_then_payment_against_that_sale(self):
        results, timing = first_then_second(self.void(), self.receive("300", sale=self.sale), self.LOCK)
        self.assertEqual([(status, data.get("code")) for status, data in results], [(200, None), (409, "sale_voided")], results)
        self.assert_waited(timing)
        self.assertEqual(Payment.objects.count(), 0)
        self.assertEqual(integrity.violations(), [])

    def test_receive_payment_first_then_void_with_refund(self):
        results, timing = first_then_second(self.receive("300"), self.void(outcome="refund"), self.LOCK)
        self.assertEqual([(status, data.get("code")) for status, data in results], [(201, None), (200, None)], results)
        self.assert_waited(timing)
        payment = Payment.objects.get()
        self.assertEqual((payment.sale_id, payment.amount), (self.sale.id, D("300.00")))  # allocated before the void
        void = SaleVoid.objects.get(sale=self.sale)
        self.assertEqual((void.outcome, void.paid_amount, void.cancelled_balance, void.refund_due),
                         ("refund", D("300.00"), D("600.00"), D("300.00")))
        self.assertEqual(customer_outstanding(self.customer), D("0.00"))
        self.assertEqual(self.filled_now(), self.filled + 1)
        self.assertEqual((ActivityLog.objects.filter(action="sale_voided").count(), ActivityLog.objects.filter(action="payment_received").count()), (1, 1))
        self.assertEqual(integrity.violations(), [])

    def test_receive_payment_first_then_void_without_an_outcome(self):
        results, timing = first_then_second(self.receive("300"), self.void(), self.LOCK)
        self.assertEqual([(status, data.get("code")) for status, data in results], [(201, None), (400, "outcome_required")], results)
        self.assert_waited(timing)
        self.assertFalse(SaleVoid.objects.exists())
        self.assertEqual(customer_outstanding(self.customer), D("600.00"))
        self.assertEqual(self.filled_now(), self.filled)
        self.assertEqual(integrity.violations(), [])

    def test_two_refund_confirmations_in_order(self):
        paid = self.sell(payment_mode="gpay")
        self.assertEqual(self.client.post(f"/api/sales/{paid.id}/void/", {"reason": "a", "outcome": "refund"}, format="json").status_code, 200)
        url = f"/api/sales/{paid.id}/confirm-refund/"
        results, timing = first_then_second((self.admin, url, {"references": {"gpay": "UTR1"}}),
                                            (self.admin, url, {"references": {"gpay": "UTR2"}}), self.LOCK)
        self.assertEqual([(status, data.get("code")) for status, data in results], [(200, None), (409, "refund_already_confirmed")], results)
        self.assert_waited(timing)
        self.assertEqual(SaleRefund.objects.get().references, {"gpay": "UTR1"})
        self.assertEqual(Payment.objects.filter(amount__lt=0).count(), 1)
        self.assertEqual(integrity.violations(), [])

    # The race tests of the parent class run once, there.
    test_two_voids_at_once_record_one = None
    test_two_refund_confirmations_at_once_record_one = None
    test_a_void_and_a_payment_on_the_same_sale = None
    test_a_void_and_a_delivery_completion_for_the_same_customer = None
    test_a_void_and_a_new_sale_of_the_same_type = None


class _OrderedBase(ConcurrentVoidTests):
    LOCK = "core.services.lock_customer"

    def statuses(self, results):
        self.assertNotIn("exception", [status for status, _ in results], results)  # no deadlock or crash
        return [(status, data.get("code") if isinstance(data, dict) else None) for status, data in results]

    def assert_waited(self, timing):
        self.assertIsNotNone(timing["second_waited"], "the second request never took the shared lock")
        self.assertGreaterEqual(timing["second_waited"], timing["hold"] - 0.05, timing)

    def logs(self, *actions):
        return tuple(ActivityLog.objects.filter(action=action).count() for action in actions)

    # The parent's race tests run once, in ConcurrentVoidTests.
    test_two_voids_at_once_record_one = None
    test_two_refund_confirmations_at_once_record_one = None
    test_a_void_and_a_payment_on_the_same_sale = None
    test_a_void_and_a_delivery_completion_for_the_same_customer = None
    test_a_void_and_a_new_sale_of_the_same_type = None


@unittest.skipUnless(connection.vendor == "postgresql", "locks are tested on PostgreSQL")
class OrderedRefundAndPaymentTests(_OrderedBase):
    """Refund confirmation and Receive Payment for the same customer, in a fixed order. The
    customer has a cancelled sale with Rs. 900 refund owed and an unpaid Rs. 500 sale."""

    def setUp(self):
        super().setUp()
        small = CylinderType.objects.create(name="5kg", weight=D("5"), selling_price=D("450"))
        Stock.objects.create(cylinder_type=small, location=self.shop, status=Stock.Status.FILLED, quantity=10)
        self.voided = self.sell(payment_mode="split", paid_amount="900",
                                split_payments=[{"mode": "cash", "amount": "500"}, {"mode": "gpay", "amount": "400"}])
        response = self.client.post(f"/api/sales/{self.voided.id}/void/", {"reason": "typo", "outcome": "refund"}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.unpaid = self.sell(payment_mode="credit", paid_amount="0", sale_items=[{"cylinder_type": small.id, "quantity": 1, "rate": "500"}])
        self.assertEqual(customer_outstanding(self.customer), D("500.00"))

    def confirm(self):
        return (self.admin, f"/api/sales/{self.voided.id}/confirm-refund/", {"references": {"gpay": "UTR9"}})

    def receive(self, sale=None):
        body = {"customer": self.customer.id, "amount": "200", "payment_mode": "cash"}
        return (self.admin, "/api/payments/", body | ({"sale": sale.id} if sale else {}))

    def assert_refunded(self):
        refund = SaleRefund.objects.get()
        self.assertEqual((refund.amount, refund.void.sale_id, refund.references), (D("900.00"), self.voided.id, {"gpay": "UTR9"}))
        self.assertEqual(sorted(Payment.objects.filter(sale=self.voided, amount__lt=0).values_list("payment_mode", "amount")),
                         [("cash", D("-500.00")), ("gpay", D("-400.00"))])
        self.assertEqual(PaymentReversal.objects.filter(sale_refund=refund).count(), 2)
        voided = Sale.objects.get(pk=self.voided.pk)
        self.assertEqual((voided.paid_amount, voided.balance_due), (D("900.00"), D("0.00")))  # never edited

    def test_refund_confirmation_first_then_receive_payment(self):
        results, timing = first_then_second(self.confirm(), self.receive(), self.LOCK)
        self.assertEqual(self.statuses(results), [(200, None), (201, None)], results)
        self.assert_waited(timing)
        self.assert_both_applied()

    def test_receive_payment_first_then_refund_confirmation(self):
        results, timing = first_then_second(self.receive(), self.confirm(), self.LOCK)
        self.assertEqual(self.statuses(results), [(201, None), (200, None)], results)
        self.assert_waited(timing)
        self.assert_both_applied()

    def assert_both_applied(self):
        self.assert_refunded()
        unpaid = Sale.objects.get(pk=self.unpaid.pk)
        self.assertEqual((unpaid.paid_amount, unpaid.balance_due), (D("200.00"), D("300.00")))
        self.assertEqual(list(Payment.objects.filter(sale=self.unpaid).values_list("amount", "payment_mode")), [(D("200.00"), "cash")])
        self.assertEqual(Payment.objects.count(), 5)  # 2 originals, 2 refund reversals, 1 new payment
        self.assertEqual(customer_outstanding(self.customer), D("300.00"))
        self.assertEqual(self.logs("sale_voided", "refund_confirmed", "payment_received"), (1, 1, 1))
        self.assertEqual(integrity.violations(), [])

    def test_refund_confirmation_first_then_payment_against_the_cancelled_sale(self):
        results, timing = first_then_second(self.confirm(), self.receive(sale=self.voided), self.LOCK)
        self.assertEqual(self.statuses(results), [(200, None), (409, "sale_voided")], results)
        self.assert_waited(timing)
        self.assert_refunded()
        self.assertEqual(Payment.objects.count(), 4)
        self.assertEqual(self.logs("refund_confirmed", "payment_received"), (1, 0))
        self.assertEqual(integrity.violations(), [])

    def test_payment_against_the_cancelled_sale_first_then_refund_confirmation(self):
        results, timing = first_then_second(self.receive(sale=self.voided), self.confirm(), self.LOCK)
        self.assertEqual(self.statuses(results), [(409, "sale_voided"), (200, None)], results)
        self.assert_waited(timing)
        self.assert_refunded()
        self.assertEqual(Payment.objects.count(), 4)
        self.assertEqual(integrity.violations(), [])


@unittest.skipUnless(connection.vendor == "postgresql", "locks are tested on PostgreSQL")
class OrderedVoidAndTransferTests(_OrderedBase):
    """A void and a Stock-page transfer at the same location and cylinder type, in a fixed order.
    The sale took 1 filled out and 3 empties in, so the shop has 19 filled and 8 empty."""

    VOID_FILLED = "core.services.get_stock_row"      # the void's filled-row lock
    VOID_EMPTY = "core.services.lock_stock_row"      # the void's empty-row lock
    TRANSFER = "core.serializers.get_stock_row"      # the transfer's source/destination locks

    def setUp(self):
        super().setUp()
        self.kandam = StockLocation.objects.create(name="Kandam", code="kandam")
        self.sale = self.sell(sale_items=[{"cylinder_type": self.cylinder.id, "quantity": 1, "rate": "900", "empty_returned": 3}])
        self.assertEqual(self.qty(self.shop), (19, 8))

    def qty(self, location):
        rows = {row.status: row.quantity for row in Stock.objects.filter(location=location, cylinder_type=self.cylinder)}
        return rows.get("filled", 0), rows.get("empty", 0)

    def void(self):
        return (self.admin, f"/api/sales/{self.sale.id}/void/", {"reason": "typo", "outcome": "refund"})

    def transfer(self, status, quantity):
        return (self.admin, "/api/movements/", {"cylinder_type": self.cylinder.id, "from_location": self.shop.id,
                                               "to_location": self.kandam.id, "status": status, "quantity": quantity})

    def test_transfer_of_empties_first_then_void_sees_the_fresh_count(self):
        results, timing = first_then_second(self.transfer("empty", 6), self.void(), self.TRANSFER, second_lock_target=self.VOID_EMPTY)
        self.assertEqual(self.statuses(results), [(201, None), (409, "insufficient_empty_stock")], results)
        self.assert_waited(timing)
        self.assertEqual(results[1][1]["shortages"][0] | {}, {"cylinder_type": self.cylinder.id, "name": "14kg", "required": 3, "available": 2})
        self.assertEqual((self.qty(self.shop), self.qty(self.kandam)), ((19, 2), (0, 6)))  # the refused void changed nothing
        self.assertFalse(SaleVoid.objects.exists())
        self.assertEqual(self.logs("stock_moved", "sale_voided"), (1, 0))
        self.assertEqual(integrity.violations(), [])

    def test_void_first_then_transfer_of_empties_sees_the_fresh_count(self):
        results, timing = first_then_second(self.void(), self.transfer("empty", 6), self.VOID_EMPTY, second_lock_target=self.TRANSFER)
        self.assertEqual([status for status, _ in results], [200, 400], results)
        self.assertIn("Not enough stock", str(results[1][1]))
        self.assert_waited(timing)
        self.assertEqual((self.qty(self.shop), self.qty(self.kandam)), ((20, 5), (0, 0)))  # the refused transfer moved nothing
        self.assertEqual((SaleVoid.objects.count(), StockMovement.objects.count()), (1, 0))
        self.assertEqual(integrity.violations(), [])

    def test_void_first_then_transfer_of_filled_sees_the_returned_cylinder(self):
        # 20 filled can only move if the transfer sees the cylinder the void returned.
        results, timing = first_then_second(self.void(), self.transfer("filled", 20), self.VOID_FILLED, second_lock_target=self.TRANSFER)
        self.assertEqual(self.statuses(results), [(200, None), (201, None)], results)
        self.assert_waited(timing)
        self.assertEqual((self.qty(self.shop), self.qty(self.kandam)), ((0, 5), (20, 0)))
        self.assertEqual(self.logs("sale_voided", "stock_moved"), (1, 1))
        self.assertEqual(integrity.violations(), [])

    def test_transfer_of_filled_first_then_void(self):
        results, timing = first_then_second(self.transfer("filled", 19), self.void(), self.TRANSFER, second_lock_target=self.VOID_FILLED)
        self.assertEqual(self.statuses(results), [(201, None), (200, None)], results)
        self.assert_waited(timing)
        self.assertEqual((self.qty(self.shop), self.qty(self.kandam)), ((1, 5), (19, 0)))
        void_log = ActivityLog.objects.get(action="sale_voided").metadata
        self.assertEqual((void_log["stock_before"][str(self.cylinder.id)], void_log["stock_after"][str(self.cylinder.id)]),
                         ({"filled": 0, "empty": 8}, {"filled": 1, "empty": 5}))  # the void saw the transfer
        self.assertEqual(integrity.violations(), [])
