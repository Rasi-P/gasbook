from decimal import Decimal

from core.models import ActivityLog, Booking, Delivery, Payment, Sale, SaleItem, Stock, StockLocation

from .base import GasBookTestCase


class DeliveryCompleteTests(GasBookTestCase):
    def complete(self, delivery, payload=None, user=None):
        self.auth(user or self.staff_a)
        return self.client.post(f"/api/deliveries/{delivery.id}/complete/", payload or {}, format="json")

    def assert_nothing_written(self, booking, delivery, filled_before, empty_before=0):
        booking.refresh_from_db()
        delivery.refresh_from_db()
        self.assertEqual(Sale.objects.count(), 0)
        self.assertEqual(SaleItem.objects.count(), 0)
        self.assertEqual(Payment.objects.count(), 0)
        self.assertEqual(delivery.status, Delivery.Status.ASSIGNED)
        self.assertEqual(booking.status, Booking.Status.APPROVED)
        self.assertIsNone(booking.sale)
        self.assertEqual(self.stock_qty(self.shop, Stock.Status.FILLED), filled_before)
        self.assertEqual(self.stock_qty(self.shop, Stock.Status.EMPTY), empty_before)

    def test_complete_moves_stock_and_creates_sale(self):
        self.set_stock(self.shop, filled=5, empty=0)
        booking, delivery = self.assigned_booking(self.staff_a, quantity=2)
        response = self.complete(delivery, {"empty_collected": 1, "payment_collected": "1800.00", "payment_method": "cash"})
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["status"], "delivered")
        self.assertEqual(response.data["booking_status"], "delivered")

        self.assertEqual(self.stock_qty(self.shop, Stock.Status.FILLED), 3)
        self.assertEqual(self.stock_qty(self.shop, Stock.Status.EMPTY), 1)

        sale = Sale.objects.get()
        self.assertEqual(sale.total_amount, Decimal("1800.00"))
        self.assertEqual(sale.location, self.shop)
        item = SaleItem.objects.get()
        self.assertEqual((item.quantity, item.empty_returned), (2, 1))
        payment = Payment.objects.get()
        self.assertEqual(payment.amount, Decimal("1800.00"))
        self.assertEqual(payment.empty_collected, 1)

        booking.refresh_from_db()
        delivery.refresh_from_db()
        self.assertEqual(booking.status, Booking.Status.DELIVERED)
        self.assertEqual(booking.sale, sale)
        self.assertEqual(booking.payment_status, "PAID")
        self.assertEqual(delivery.empty_collected, 1)
        self.assertIsNotNone(delivery.completed_at)

        log = ActivityLog.objects.get(action="delivery_completed")
        self.assertEqual(log.metadata["location"], "shop")
        self.assertEqual(log.metadata["filled_after"], 3)
        self.assertEqual(log.metadata["empty_after"], 1)
        self.assertEqual(log.metadata["empty_collected"], 1)
        self.assertEqual(self.notifications(self.customer_user, "ORDER_DELIVERED", booking).count(), 1)
        self.assertEqual(self.notifications(self.admin, "ORDER_DELIVERED", booking).count(), 1)

    def test_insufficient_stock_rejects_before_any_write(self):
        self.set_stock(self.shop, filled=1)
        booking, delivery = self.assigned_booking(self.staff_a, quantity=2)
        response = self.complete(delivery, {"empty_collected": 1})
        self.assertEqual(response.status_code, 400, response.data)
        self.assertEqual(response.data["code"], "insufficient_stock")
        self.assertEqual(response.data["available"], 1)
        self.assertEqual(response.data["required"], 2)
        self.assertEqual(response.data["location"], "shop")
        self.assertEqual(response.data["location_name"], "Shop")
        self.assertIn("Load stock before completing", response.data["detail"])
        self.assert_nothing_written(booking, delivery, filled_before=1)
        self.assertEqual(ActivityLog.objects.filter(action="delivery_completed").count(), 0)

    def test_second_complete_is_already_completed(self):
        self.set_stock(self.shop, filled=5)
        booking, delivery = self.assigned_booking(self.staff_a, quantity=2)
        self.assertEqual(self.complete(delivery).status_code, 200)
        response = self.complete(delivery)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["code"], "already_completed")
        self.assertEqual(response.data["sale_id"], Sale.objects.get().id)
        self.assertEqual(Sale.objects.count(), 1)
        self.assertEqual(self.stock_qty(self.shop, Stock.Status.FILLED), 3)

    def test_complete_invalid_states(self):
        self.set_stock(self.shop, filled=5)
        for status in (Delivery.Status.REJECTED, Delivery.Status.CANCELLED):
            booking, delivery = self.assigned_booking(self.staff_a, delivery_status=status)
            response = self.complete(delivery)
            self.assertEqual(response.status_code, 400)
            self.assertEqual(response.data["code"], "invalid_state")
        self.assertEqual(Sale.objects.count(), 0)
        self.assertEqual(self.stock_qty(self.shop, Stock.Status.FILLED), 5)

    def test_vehicle_location_is_debited_not_shop(self):
        vehicle = StockLocation.objects.create(name="Van 1", code="van1")
        self.staff_a_profile.vehicle_location = vehicle
        self.staff_a_profile.save()
        self.set_stock(self.shop, filled=5)
        self.set_stock(vehicle, filled=4)
        booking, delivery = self.assigned_booking(self.staff_a, quantity=2)
        response = self.complete(delivery, {"empty_collected": 2})
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(self.stock_qty(vehicle, Stock.Status.FILLED), 2)
        self.assertEqual(self.stock_qty(vehicle, Stock.Status.EMPTY), 2)
        self.assertEqual(self.stock_qty(self.shop, Stock.Status.FILLED), 5)
        self.assertEqual(Sale.objects.get().location, vehicle)

    def test_bad_inputs_rejected_before_write(self):
        self.set_stock(self.shop, filled=5)
        booking, delivery = self.assigned_booking(self.staff_a, quantity=2)
        cases = [
            ({"empty_collected": "abc"}, "empty_collected"),
            ({"empty_collected": -1}, "empty_collected"),
            ({"empty_collected": True}, "empty_collected"),
            ({"payment_collected": "x"}, "payment_collected"),
            ({"split_payments": "notalist"}, "split_payments"),
            ({"split_payments": [{"amount": "-5", "mode": "cash"}]}, "split_payments"),
            ({"split_payments": [{"amount": "5", "mode": "bitcoin"}]}, "split_payments"),
            ({"split_payments": ["x"]}, "split_payments"),
            ({"payment_collected": "500", "paid_payment_mode": "bitcoin"}, "paid_payment_mode"),
            ({"payment_collected": "500", "paid_payment_mode": "a-very-long-payment-mode"}, "paid_payment_mode"),
            ({"payment_collected": "1800", "paid_payment_mode": "COD"}, "paid_payment_mode"),
        ]
        for payload, field in cases:
            response = self.complete(delivery, payload)
            self.assertEqual(response.status_code, 400, (payload, response.data))
            self.assertEqual(response.data["code"], "invalid", payload)
            self.assertEqual(response.data["field"], field, payload)
        self.assert_nothing_written(booking, delivery, filled_before=5)

    def test_payment_range_and_split_handling(self):
        self.set_stock(self.shop, filled=5)
        booking, delivery = self.assigned_booking(self.staff_a, quantity=2)  # total 1800
        response = self.complete(delivery, {"payment_collected": "1800.01"})
        self.assertEqual(response.status_code, 400)
        self.assertEqual((response.data["code"], response.data["field"]), ("invalid", "payment_collected"))
        self.assert_nothing_written(booking, delivery, filled_before=5)

        response = self.complete(delivery, {
            "payment_collected": "1",  # ignored: split sum wins
            "split_payments": [{"amount": "1000", "mode": "cash"}, {"amount": "0", "mode": "gpay"}, {"amount": "500", "mode": "bank"}],
        })
        self.assertEqual(response.status_code, 200, response.data)
        sale = Sale.objects.get()
        self.assertEqual(sale.paid_amount, Decimal("1500"))
        self.assertEqual(sale.balance_due, Decimal("300"))
        self.assertEqual(sale.payment_mode, Sale.PaymentMode.SPLIT)
        self.assertEqual(Payment.objects.count(), 2)  # zero-amount row creates no Payment
        booking.refresh_from_db()
        self.assertEqual(booking.payment_status, "COLLECTED")

    def test_valid_paid_payment_mode_is_recorded_on_partial_collection(self):
        self.set_stock(self.shop, filled=5)
        booking, delivery = self.assigned_booking(self.staff_a, quantity=2)  # total 1800
        response = self.complete(delivery, {"payment_collected": "500", "paid_payment_mode": "gpay"})
        self.assertEqual(response.status_code, 200, response.data)
        sale = Sale.objects.get()
        self.assertEqual(sale.payment_mode, Sale.PaymentMode.CREDIT)
        payment = Payment.objects.get()
        self.assertEqual(payment.payment_mode, Sale.PaymentMode.GPAY)
        self.assertEqual(payment.amount, Decimal("500"))

    def test_complete_from_assigned_allowed_and_credit_when_nothing_collected(self):
        self.set_stock(self.shop, filled=2)
        booking, delivery = self.assigned_booking(self.staff_a, quantity=2)
        response = self.complete(delivery, {"payment_collected": "0", "note": "n" * 400})
        self.assertEqual(response.status_code, 200, response.data)
        sale = Sale.objects.get()
        self.assertEqual(sale.payment_mode, Sale.PaymentMode.CREDIT)
        self.assertEqual(Payment.objects.count(), 0)
        self.assertEqual(self.stock_qty(self.shop, Stock.Status.FILLED), 0)
        delivery.refresh_from_db()
        self.assertEqual(len(delivery.note), 300)

    def test_non_owner_cannot_complete(self):
        self.set_stock(self.shop, filled=5)
        booking, delivery = self.assigned_booking(self.staff_a)
        response = self.complete(delivery, user=self.staff_b)
        self.assertIn(response.status_code, (403, 404))
        self.assertEqual(Sale.objects.count(), 0)
