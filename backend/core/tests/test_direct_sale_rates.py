"""Editable admin Direct Sale components remain validated and snapshotted."""
import uuid
from decimal import Decimal as D

from core.models import Booking, Sale
from .base import GasBookTestCase


class DirectSaleRatesTests(GasBookTestCase):
    def setUp(self):
        super().setUp()
        self.cylinder.deposit_amount = D('450')
        self.cylinder.refill_rate = D('360')
        self.cylinder.save()
        self.set_stock(self.shop, filled=30, empty=5)
        self.auth(self.admin)

    def line(self, **kwargs):
        return dict(cylinder_type=self.cylinder.pk, quantity=3, rate_type='new',
                    deposit='500.25', refill_charge='370.50', empty_returned=2) | kwargs

    def sell(self, lines=None, **kwargs):
        return self.client.post('/api/sales/', dict(
            client_ref=str(uuid.uuid4()), customer=self.customer.pk, location=self.shop.pk,
            payment_mode='cash', sale_items=lines or [self.line()]) | kwargs, format='json')

    def test_edited_components_quote_payment_and_snapshots_match_without_changing_rates(self):
        quote = self.client.post('/api/sales/preview/', {
            'customer': self.customer.pk, 'sale_items': [self.line()]}, format='json')
        self.assertEqual(quote.status_code, 200, quote.data)
        self.assertEqual(D(quote.data['total_amount']), D('2612.25'))
        result = self.sell(quoted_total=quote.data['total_amount'], paid_amount='2612.25')
        self.assertEqual(result.status_code, 201, result.data)
        sale = Sale.objects.get(pk=result.data['id'])
        item = sale.items.get()
        self.assertEqual((item.deposit_unit_amount, item.refill_unit_amount, item.total_amount),
                         (D('500.25'), D('370.50'), D('2612.25')))
        self.assertEqual((sale.total_amount, sale.paid_amount, sale.balance_due),
                         (D('2612.25'), D('2612.25'), 0))
        self.cylinder.refresh_from_db()
        self.assertEqual((self.cylinder.deposit_amount, self.cylinder.refill_rate), (D('450'), D('360')))
        self.assertEqual((self.stock_qty(self.shop, 'filled'), self.stock_qty(self.shop, 'empty')), (27, 7))

    def test_refill_uses_only_edited_refill_and_rejects_a_deposit(self):
        result = self.sell([self.line(rate_type='refill', deposit='0')])
        self.assertEqual(result.status_code, 201, result.data)
        self.assertEqual(D(result.data['total_amount']), D('1111.50'))
        self.assertEqual(D(result.data['items'][0]['deposit_unit_amount']), 0)
        result = self.sell([self.line(rate_type='refill', deposit='1')])
        self.assertEqual(result.status_code, 400, result.data)
        self.assertEqual(Sale.objects.count(), 1)

    def test_discount_and_partial_payment_do_not_reduce_deposit(self):
        self.customer.global_discount_type = 'percentage'
        self.customer.global_discount_value = D('10')
        self.customer.global_discount_is_active = True
        self.customer.save()
        result = self.sell(payment_mode='credit', paid_amount='500', paid_payment_mode='cash')
        self.assertEqual(result.status_code, 201, result.data)
        self.assertEqual(D(result.data['discount_amount']), D('111.15'))
        self.assertEqual(D(result.data['total_amount']), D('2501.10'))
        self.assertEqual(D(result.data['balance_due']), D('2001.10'))
        self.assertEqual(D(result.data['items'][0]['deposit_unit_amount']), D('500.25'))

    def test_duplicates_merge_only_if_both_components_match(self):
        result = self.sell([self.line(quantity=1), self.line(quantity=2),
                            self.line(quantity=1, deposit='400.25')])
        self.assertEqual(result.status_code, 201, result.data)
        self.assertEqual(len(result.data['items']), 2)
        self.assertEqual(D(result.data['total_amount']), D('3383.00'))
        self.assertEqual(sorted(i['quantity'] for i in result.data['items']), [1, 3])

    def test_invalid_components_and_forged_totals_cannot_write(self):
        for change in [{'deposit': '-1'}, {'refill_charge': '-1'}, {'deposit': '1.001'},
                       {'refill_charge': 'NaN'}, {'deposit': '99999999999'},
                       {'total_amount': '1'}, {'deposit_unit_amount': '1'}, {'rate': '1'}]:
            with self.subTest(change=change):
                result = self.sell([self.line(**change)])
                self.assertEqual(result.status_code, 400, result.data)
        self.assertEqual(self.sell(quoted_total='1').status_code, 400)
        self.assertEqual(self.sell(paid_amount='1').status_code, 400)
        self.assertFalse(Sale.objects.exists())
        self.assertEqual(self.stock_qty(self.shop, 'filled'), 30)

    def test_edits_are_admin_only_and_cannot_override_booking_prices(self):
        for user in [self.staff_a, self.customer_user]:
            self.auth(user)
            self.assertEqual(self.sell().status_code, 403)
            result = self.client.post('/api/sales/preview/', {
                'customer': self.customer.pk, 'sale_items': [self.line()]}, format='json')
            self.assertEqual(result.status_code, 403)
        for field in ['deposit', 'refill_charge']:
            result = self.client.post('/api/bookings/', {
                'cylinder_type': self.cylinder.pk, 'quantity': 1, 'rate_type': 'new', field: '1'}, format='json')
            self.assertEqual(result.status_code, 400, result.data)
        self.assertFalse(Booking.objects.exists())
        self.assertFalse(Sale.objects.exists())
