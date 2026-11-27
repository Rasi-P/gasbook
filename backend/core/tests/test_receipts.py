from datetime import datetime, timezone
from decimal import Decimal as D

from django.test import override_settings
from rest_framework_simplejwt.tokens import RefreshToken

from core.models import Booking, CustomerProfile, Payment, Sale, SaleItem, SaleVoid, SaleRefund, User
from .base import GasBookTestCase


class CustomerReceiptTests(GasBookTestCase):
    def setUp(self):
        super().setUp()
        self.auth(self.customer_user)
        self.at = datetime(2026, 10, 15, 20, 10, tzinfo=timezone.utc)

    def sale(self, **kwargs):
        sale = Sale.objects.create(customer=self.customer, location=self.shop, sold_by=self.admin,
            original_amount=1620, discount_amount=60, total_amount=1560, paid_amount=500,
            balance_due=1060, payment_mode='credit', **kwargs)
        Sale.objects.filter(pk=sale.pk).update(created_at=self.at)
        SaleItem.objects.create(sale=sale, cylinder_type=self.cylinder, quantity=2, rate=780,
            total_amount=1560, rate_type='new', deposit_unit_amount=450, refill_unit_amount=360)
        Payment.objects.create(customer=self.customer, sale=sale, received_by=self.admin, amount=500, payment_mode='gpay')
        return sale

    def get_receipt(self, source, pk):
        return self.client.get(f'/api/receipts/{source}/{pk}/')

    def test_direct_sale_snapshots_discount_and_partial_payment(self):
        sale = self.sale()
        response = self.get_receipt('sale', sale.pk)
        self.assertEqual(response.status_code, 200, response.data)
        data = response.data
        self.assertEqual(data['number'], f'SALE-{sale.pk}')
        self.assertEqual(data['transaction_type'], 'Direct Sale')
        self.assertEqual(data['business'], {'name': 'Sabco Gas'})
        self.assertEqual(data['created_at'], self.at.isoformat())
        self.assertEqual([data[k] for k in ['subtotal', 'discount_amount', 'total_amount', 'paid_amount', 'balance_due']],
                         ['1620.00', '60.00', '1560.00', '500.00', '1060.00'])
        self.assertEqual(data['payment_status'], 'Partially paid')
        self.assertEqual(data['payment_method'], 'GPay')
        self.assertEqual(data['items'][0]['unit_amount'], '810.00')
        self.assertEqual(data['items'][0]['deposit_unit_amount'], '450.00')
        self.assertIsNone(data['delivery_partner'])
        self.assertIsNone(data['completed_at'])
        self.assertEqual(response['Cache-Control'], 'private, no-store')

    def test_booking_receipt_uses_saved_amounts_and_actual_delivery_partner(self):
        sale = self.sale()
        booking = self.make_booking(status='delivered', assigned_staff=self.staff_a, sale=sale,
            original_amount=1620, discount_amount=60, final_amount=1560, rate_type='new',
            deposit_unit_amount=450, refill_unit_amount=360, delivered_at=self.at,
            delivery_address='Saved delivery address', delivery_phone='9111111111')
        self.make_delivery(booking, self.staff_b, status='delivered', completed_at=self.at)
        response = self.get_receipt('booking', booking.pk)
        self.assertEqual(response.status_code, 200, response.data)
        data = response.data
        self.assertEqual(data['number'], booking.order_id)
        self.assertEqual(data['transaction_type'], 'Booking')
        self.assertEqual(data['total_amount'], '1560.00')
        self.assertEqual(data['paid_amount'], '500.00')
        self.assertEqual(data['delivery_partner'], self.staff_b.get_full_name())
        self.assertEqual(data['completed_at'], self.at.isoformat())
        self.assertEqual(data['customer']['address'], 'Saved delivery address')
        self.assertEqual(data['customer']['phone'], '9111111111')
        # Linked delivery sales cannot masquerade as a second direct-sale receipt.
        self.assertEqual(self.get_receipt('sale', sale.pk).status_code, 404)

    def test_pending_booking_does_not_invent_payment_amounts_or_completion(self):
        booking = self.make_booking(original_amount=777, final_amount=777)
        data = self.get_receipt('booking', booking.pk).data
        self.assertEqual(data['status'], 'Pending Approval')
        self.assertEqual(data['payment_status'], 'Payment not confirmed')
        for key in ['paid_amount', 'balance_due', 'completed_at', 'delivery_partner']:
            self.assertIsNone(data[key])
        self.assertEqual(data['items'][0]['unit_label'], 'Average unit price')
        self.assertEqual(data['items'][0]['unit_amount'], '388.50')
        self.assertIsNone(data['items'][0]['deposit_unit_amount'])

    def test_multiple_items_and_legacy_amounts_never_use_current_rates(self):
        sale = self.sale()
        SaleItem.objects.create(sale=sale, cylinder_type=self.cylinder, quantity=1, rate=0, total_amount=0)
        self.cylinder.deposit_amount = 9999
        self.cylinder.refill_rate = 9999
        self.cylinder.save()
        data = self.get_receipt('sale', sale.pk).data
        self.assertEqual(len(data['items']), 2)
        self.assertEqual(data['items'][1]['total_amount'], '0.00')
        self.assertIsNone(data['items'][1]['refill_unit_amount'])
        self.assertEqual(data['total_amount'], '1560.00')
        sale.refresh_from_db()
        self.assertEqual(sale.total_amount, D('1560'))

    def test_legacy_sale_without_original_amount_retains_its_original_total(self):
        sale = self.sale()
        Sale.objects.filter(pk=sale.pk).update(original_amount=0, discount_amount=0, total_amount=777)
        data = self.get_receipt('sale', sale.pk).data
        self.assertEqual((data['subtotal'], data['total_amount']), ('777.00', '777.00'))

    def test_cancelled_sale_refund_pending_then_refunded(self):
        sale = self.sale()
        void = SaleVoid.objects.create(sale=sale, reason='Customer returned cylinders', outcome='refund',
            paid_amount=500, cancelled_balance=1060, refund_due=500, voided_by=self.admin)
        data = self.get_receipt('sale', sale.pk).data
        self.assertEqual(data['status'], 'Cancelled')
        self.assertTrue(data['cancelled'])
        self.assertEqual(data['payment_status'], 'Refund pending')
        self.assertEqual(data['balance_due'], '0.00')
        self.assertEqual(data['refund_due'], '500.00')
        self.assertIsNone(data['refunded_at'])
        self.assertEqual(data['cancelled_at'], void.created_at.isoformat())
        refund = SaleRefund.objects.create(void=void, amount=500, confirmed_by=self.admin)
        data = self.get_receipt('sale', sale.pk).data
        self.assertEqual(data['payment_status'], 'Refunded')
        self.assertEqual(data['refund_amount'], '500.00')
        self.assertIsNone(data['refund_due'])
        self.assertEqual(data['refunded_at'], refund.created_at.isoformat())
        self.assertEqual(data['total_amount'], '1560.00')

    def test_credit_outcome_is_not_a_refund(self):
        sale = self.sale()
        SaleVoid.objects.create(sale=sale, reason='Keep credit', outcome='credit',
            paid_amount=500, cancelled_balance=1060, voided_by=self.admin)
        data = self.get_receipt('sale', sale.pk).data
        self.assertEqual(data['credit_amount'], '500.00')
        self.assertEqual(data['payment_status'], 'Transferred to customer credit')
        self.assertIsNone(data['refund_amount'])

    def test_cancelled_booking_and_missing_details_are_not_fabricated(self):
        self.customer_user.phone = ''
        self.customer_user.address = ''
        self.customer_user.save()
        booking = self.make_booking(status='cancelled', delivery_address='', delivery_phone='')
        data = self.get_receipt('booking', booking.pk).data
        self.assertTrue(data['cancelled'])
        self.assertEqual(data['balance_due'], '0.00')
        for key in ['completed_at', 'delivery_partner', 'cancelled_at', 'refunded_at']:
            self.assertIsNone(data[key])
        self.assertIsNone(data['customer']['phone'])
        self.assertIsNone(data['customer']['address'])

    @override_settings(RECEIPT_BUSINESS_DETAILS={'address': 'Configured office', 'phone': '', 'tax_id': 'Configured ID'})
    def test_optional_business_configuration(self):
        data = self.get_receipt('sale', self.sale().pk).data
        self.assertEqual(data['business'], {'name': 'Sabco Gas', 'address': 'Configured office', 'tax_id': 'Configured ID'})

    def test_cross_customer_access_is_rejected_by_backend(self):
        sale = self.sale()
        booking = self.make_booking()
        other_user = User.objects.create_user(username='other', role=self.customer_role)
        CustomerProfile.objects.create(user=other_user)
        self.auth(other_user)
        for source, pk in [('booking', booking.pk), ('sale', sale.pk)]:
            response = self.get_receipt(source, pk)
            self.assertEqual(response.status_code, 404)
            self.assertNotIn('customer', response.data)
        self.auth(self.customer_user)
        # Even inconsistent legacy links cannot leak a different customer's sale/payments.
        Sale.objects.filter(pk=sale.pk).update(customer=other_user.customer_profile)
        Booking.objects.filter(pk=booking.pk).update(sale=sale)
        self.assertEqual(self.get_receipt('booking', booking.pk).status_code, 404)

    def test_auth_roles_methods_and_password_change_rules(self):
        sale = self.sale()
        for user in [self.admin, self.staff_a]:
            self.auth(user)
            self.assertEqual(self.get_receipt('sale', sale.pk).status_code, 403)
        self.client.force_authenticate(user=None)
        self.assertEqual(self.get_receipt('sale', sale.pk).status_code, 401)
        self.customer_user.must_change_password = True
        self.customer_user.save()
        token = str(RefreshToken.for_user(self.customer_user).access_token)
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {token}')
        self.assertEqual(self.get_receipt('sale', sale.pk).status_code, 403)
        self.client.credentials()
        self.auth(self.customer_user)
        self.assertEqual(self.client.post(f'/api/receipts/sale/{sale.pk}/', {}).status_code, 405)
        self.assertEqual(self.get_receipt('unknown', sale.pk).status_code, 404)

    def test_returns_only_records_are_not_exposed_as_sales(self):
        sale = self.sale()
        sale.items.update(quantity=0, total_amount=0, empty_returned=2)
        self.assertEqual(self.get_receipt('sale', sale.pk).status_code, 404)
