"""Staff cylinder edits share admin pricing and retain immutable audit evidence."""
import uuid
from decimal import Decimal as D

from core.models import ActivityLog, CustomerCylinderRate, Payment, Product, ProductCategory, Sale
from core.integrity import violations
from .base import GasBookTestCase


class StaffSaleRateTests(GasBookTestCase):
    def setUp(self):
        super().setUp()
        self.cylinder.deposit_amount = 300
        self.cylinder.refill_rate = 360
        self.cylinder.save()
        CustomerCylinderRate.objects.create(customer=self.customer, cylinder_type=self.cylinder, custom_price=320)
        self.customer.global_discount_type = 'percentage'
        self.customer.global_discount_value = 10
        self.customer.global_discount_is_active = True
        self.customer.save()
        self.set_stock(self.shop, filled=20, empty=0)
        self.product = Product.objects.create(name='Regulator', sku='RATE-REG',
            category=ProductCategory.objects.create(name='Regulators'), selling_price=250, stock=5)
        self.auth(self.staff_a)

    def body(self, **line):
        return dict(client_ref=str(uuid.uuid4()), customer=self.customer.pk, location=self.shop.pk,
            payment_mode='credit', paid_amount='0', sale_items=[dict(cylinder_type=self.cylinder.pk,
            quantity=2, rate_type='refill', empty_returned=2, **line)])

    def post(self, body, path='/api/staff-sales/'):
        return self.client.post(path, body, format='json')

    def test_edited_refill_and_customer_default_match_admin_preview(self):
        for edit, total, refill in [({}, 576, 320), ({'refill_charge':'400'}, 720, 400),
                                    ({'refill_charge':'0'}, 0, 0)]:
            with self.subTest(edit=edit):
                body = self.body(**edit)
                self.auth(self.admin)
                admin = self.post(body, '/api/sales/preview/')
                self.auth(self.staff_a)
                staff = self.post(body, '/api/staff-sales/preview/')
                self.assertEqual(staff.status_code, 200, staff.data)
                self.assertEqual(staff.data, admin.data)
                result = self.post(body)
                self.assertEqual(result.status_code, 201, result.data)
                item = result.data['items'][0]
                self.assertEqual(D(result.data['total_amount']), total)
                self.assertEqual(D(item['refill_unit_amount']), refill)
                self.assertEqual(D(item['deposit_unit_amount']), 0)

    def test_new_deposit_refill_discount_audit_and_retry_preserve_snapshots(self):
        body = self.body(deposit='250', refill_charge='400')
        body['sale_items'][0]['rate_type'] = 'new'
        body.update(accessory_lines=[dict(product=self.product.pk, quantity=1)],
                    paid_amount='400', paid_payment_mode='cash', quoted_total='1470')
        result = self.post(body)
        self.assertEqual(result.status_code, 201, result.data)
        sale = Sale.objects.get(pk=result.data['id'])
        self.assertEqual((sale.total_amount, sale.paid_amount, sale.balance_due), (1470, 400, 1070))
        self.assertEqual((sale.sold_by, sale.handover_staff), (self.staff_a, self.staff_a))
        self.assertEqual(sale.payments.get().received_by, self.staff_a)
        item = sale.items.get()
        self.assertEqual((item.deposit_unit_amount, item.refill_unit_amount, D(result.data['discount_amount']), item.total_amount),
                         (250, 400, 80, 1220))
        self.assertEqual(self.stock_qty(self.shop, 'filled'), 18)
        self.assertEqual(self.stock_qty(self.shop, 'empty'), 2)
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock, 4)
        log = ActivityLog.objects.get(action='sale_created', metadata__sale_id=sale.pk)
        self.assertEqual(log.user, self.staff_a)
        audit = log.metadata['lines'][0]
        for field, expected in [('configured_deposit_unit_amount',300),('configured_refill_unit_amount',360),
                ('customer_refill_unit_amount',320),('deposit_unit_amount',250),('refill_unit_amount',400),
                ('discount_amount',80),('final_amount',1220)]:
            self.assertEqual(D(audit[field]), expected, field)
        self.cylinder.deposit_amount = 999
        self.cylinder.refill_rate = 999
        self.cylinder.save()
        self.customer.custom_rates.update(custom_price=999)
        retry = self.post(body)
        self.assertEqual(retry.status_code, 200, retry.data)
        self.assertEqual(retry.data['id'], sale.pk)
        log.refresh_from_db()
        self.assertEqual(log.metadata['lines'][0], audit)
        self.assertEqual(Sale.objects.count(), 1)
        self.assertEqual(Payment.objects.count(), 1)
        self.assertEqual(ActivityLog.objects.filter(action='sale_created').count(), 1)
        self.auth(self.customer_user)
        receipt = self.client.get(f'/api/receipts/sale/{sale.pk}/')
        self.assertEqual(receipt.status_code, 200)
        self.assertEqual(D(receipt.data['total_amount']), 1470)
        self.assertEqual(violations(), [])

    def test_fixed_discount_caps_at_edited_refill_never_deposit_and_merges_duplicates(self):
        self.customer.global_discount_type = 'fixed'
        self.customer.global_discount_value = 100
        self.customer.save()
        body = self.body(deposit='250', refill_charge='20')
        body['sale_items'][0]['rate_type'] = 'new'
        body['sale_items'].append(dict(body['sale_items'][0]))
        result = self.post(body)
        self.assertEqual(result.status_code, 201, result.data)
        self.assertEqual(len(result.data['items']), 1)
        item = result.data['items'][0]
        self.assertEqual(item['quantity'], 4)
        self.assertEqual(D(result.data['discount_amount']), 80)
        self.assertEqual(D(result.data['total_amount']), 1000)

    def test_invalid_rates_rejected_by_preview_and_create_without_writes(self):
        invalid = [dict(refill_charge=value) for value in ['-1', 'NaN', 'Infinity', 'abc', '', None, '1.001', '100000000']]
        invalid += [dict(deposit=value, rate_type='new') for value in ['-1', 'NaN', '', None, '1.001', '100000000']]
        invalid += [dict(deposit='1'), dict(refill_charge='99999999.99'), dict(rate='1'),
                    dict(deposit_unit_amount='1'), dict(final_amount='1'), dict(discount_amount='999')]
        for edit in invalid:
            with self.subTest(edit=edit):
                body = self.body()
                body['sale_items'][0].update(edit)
                for path in ['/api/staff-sales/preview/', '/api/staff-sales/']:
                    result = self.post(body, path)
                    self.assertEqual(result.status_code, 400, result.data)
        self.assertFalse(Sale.objects.exists())
        self.assertFalse(Payment.objects.exists())
        self.assertFalse(ActivityLog.objects.filter(action='sale_created').exists())
        self.assertEqual(self.stock_qty(self.shop, 'filled'), 20)

    def test_accessory_overrides_and_forged_quote_totals_remain_forbidden(self):
        for field in ['rate', 'selling_price', 'refill_charge', 'deposit', 'total_amount']:
            body = self.body(refill_charge='400')
            body['accessory_lines'] = [dict(product=self.product.pk, quantity=1, **{field:'1'})]
            for path in ['/api/staff-sales/preview/', '/api/staff-sales/']:
                result = self.post(body, path)
                self.assertEqual(result.status_code, 400, result.data)
        body = self.body(refill_charge='400')
        body['quoted_total'] = '1'
        self.assertEqual(self.post(body).status_code, 400)
        self.auth(self.customer_user)
        self.assertEqual(self.post(body).status_code, 403)
        self.assertEqual(self.post(body, '/api/staff-sales/preview/').status_code, 403)
        self.assertFalse(Sale.objects.exists())
