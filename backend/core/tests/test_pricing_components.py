"""Deposit/refill policy: trusted inputs, immutable snapshots and financial continuity."""
import uuid
from decimal import Decimal as D
from core.models import Booking, CylinderType, CustomerCylinderRate, CustomerCylinderDiscount, Sale, SaleItem, Payment
from core.pricing import calculate_pricing
from core.serializers import BookingSerializer, SaleSerializer
from core.services import customer_outstanding
from .base import GasBookTestCase


class PricingComponentsTests(GasBookTestCase):
    def setUp(self):
        super().setUp()
        self.cylinder.deposit_amount = D('450')
        self.cylinder.refill_rate = D('360')
        self.cylinder.save()
        self.set_stock(self.shop, filled=30, empty=5)
        self.auth(self.admin)

    def line(self, kind='new', quantity=1, **kwargs):
        return dict(cylinder_type=self.cylinder.pk, quantity=quantity, rate_type=kind, **kwargs)

    def sell(self, lines=None, **kwargs):
        return self.client.post('/api/sales/', dict(client_ref=str(uuid.uuid4()), customer=self.customer.pk,
            location=self.shop.pk, payment_mode='cash', sale_items=lines or [self.line()], **kwargs), format='json')

    def discount(self, kind, value):
        self.customer.global_discount_type = kind
        self.customer.global_discount_value = D(value)
        self.customer.global_discount_is_active = True
        self.customer.save()

    def test_new_refill_quantities_and_different_configured_cylinders(self):
        other = CylinderType.objects.create(name='19kg', weight=19, selling_price=9999, deposit_amount=1000, refill_rate=1420)
        for cylinder, kind, qty, expected in [(self.cylinder,'new',1,'810'), (self.cylinder,'new',3,'2430'),
                (self.cylinder,'refill',3,'1080'), (other,'new',2,'4840'), (other,'refill',2,'2840')]:
            with self.subTest(kind=kind, qty=qty, cylinder=cylinder.name):
                price = calculate_pricing(self.customer, cylinder, qty, kind)
                self.assertEqual(price['final_amount'], D(expected))
                self.assertEqual(price['deposit_unit_amount'], cylinder.deposit_amount if kind == 'new' else 0)

    def test_agreed_price_and_percentage_discount_only_touch_refill(self):
        CustomerCylinderRate.objects.create(customer=self.customer, cylinder_type=self.cylinder, custom_price=300)
        self.discount('percentage','10')
        for kind, expected in [('new','1440'), ('refill','540')]:
            result = self.sell([self.line(kind,2)])
            self.assertEqual(result.status_code, 201, result.data)
            self.assertEqual(D(result.data['total_amount']), D(expected))
            self.assertEqual(D(result.data['discount_amount']), D('60'))
            self.assertEqual(D(result.data['items'][0]['refill_unit_amount']), D('300'))

    def test_fixed_discount_is_once_per_merged_line_and_does_not_erode_deposit(self):
        self.discount('fixed','100')
        result = self.sell([self.line(quantity=1), self.line(quantity=2)])
        self.assertEqual(result.status_code,201,result.data)
        self.assertEqual(len(result.data['items']),1)
        self.assertEqual(D(result.data['total_amount']),D('2330'))
        self.assertEqual(D(result.data['items'][0]['total_amount']),D('2330'))
        self.discount('fixed','9999')
        result = self.sell([self.line(quantity=3)])
        self.assertEqual(D(result.data['total_amount']),D('1350'))
        self.assertEqual(D(result.data['discount_amount']),D('1080'))

    def test_cylinder_discount_precedence_and_inactive_rules(self):
        self.discount('percentage','50')
        rule = CustomerCylinderDiscount.objects.create(customer=self.customer,cylinder_type=self.cylinder,
            discount_type='fixed',discount_value=10,is_active=True)
        self.assertEqual(calculate_pricing(self.customer,self.cylinder,2,'new')['final_amount'],D('1610'))
        rule.is_active=False
        rule.save()
        self.assertEqual(calculate_pricing(self.customer,self.cylinder,2,'new')['final_amount'],D('1260'))

    def test_returns_do_not_waive_deposit_and_returns_only_charge_nothing(self):
        result=self.sell([self.line(quantity=2,empty_returned=4)])
        self.assertEqual(result.status_code,201,result.data)
        self.assertEqual(D(result.data['total_amount']),D('1620'))
        self.assertEqual(self.stock_qty(self.shop,'filled'),28)
        self.assertEqual(self.stock_qty(self.shop,'empty'),9)
        result=self.sell([self.line(quantity=0,empty_returned=2)])
        self.assertEqual(result.status_code,201,result.data)
        self.assertEqual(D(result.data['total_amount']),0)
        self.assertEqual(self.stock_qty(self.shop,'filled'),28)
        self.assertEqual(self.stock_qty(self.shop,'empty'),11)

    def test_partial_payment_reports_void_and_refund_use_combined_total_once(self):
        result=self.client.post('/api/sales/',{
            'client_ref':str(uuid.uuid4()),'customer':self.customer.pk,'location':self.shop.pk,
            'sale_items':[self.line(quantity=2)],'payment_mode':'credit','paid_amount':'500','paid_payment_mode':'cash'},format='json')
        self.assertEqual(result.status_code,201,result.data)
        sale=Sale.objects.get(pk=result.data['id'])
        self.assertEqual((sale.total_amount,sale.paid_amount,sale.balance_due),(D('1620'),D('500'),D('1120')))
        self.assertEqual(customer_outstanding(self.customer),D('1120'))
        summary=self.client.get('/api/reports/').data['summary']
        self.assertEqual((summary['sales'],summary['collection']),(D('1620'),D('500')))
        result=self.client.post(f'/api/sales/{sale.pk}/void/',{'reason':'Returned','outcome':'refund'},format='json')
        self.assertEqual(result.status_code,200,result.data)
        self.assertEqual(customer_outstanding(self.customer),0)
        self.assertEqual(D(result.data['void']['refund_due']),D('500'))
        result=self.client.post(f'/api/sales/{sale.pk}/confirm-refund/',{'amount':'500','references':{'cash':'Paid back'}},format='json')
        self.assertEqual(result.status_code,200,result.data)
        summary=self.client.get('/api/reports/').data['summary']
        self.assertEqual((summary['sales'],summary['cancelled'],summary['net_sales'],summary['collection'],summary['refunds_paid']),
                         (D('1620'),D('1620'),D('0'),D('0'),D('500')))
        sale.refresh_from_db()
        self.assertEqual(sale.total_amount,D('1620'))

    def test_tampered_direct_prices_and_components_rejected_without_writes(self):
        for change in [{'rate':'1'}, {'rate':'450'}, {'deposit_unit_amount':'0'}, {'refill_unit_amount':'1'},
                       {'total_amount':'1'}, {'discount_amount':'800'}, {'rate_type':'custom'}]:
            with self.subTest(change=change):
                line={**self.line(),**change}
                result=self.sell([line])
                self.assertEqual(result.status_code,400,result.data)
                self.assertEqual(Sale.objects.count(),0)
                self.assertEqual(self.stock_qty(self.shop,'filled'),30)
        result=self.sell(total_amount='1')
        self.assertEqual(result.status_code,400)
        # A second duplicate with a forged rate cannot disappear during merging.
        result=self.sell([self.line(rate='810'),self.line(rate='1')])
        self.assertEqual(result.status_code,400)

    def test_booking_tampering_rejected_and_new_refill_preview_matches_creation(self):
        self.auth(self.customer_user)
        for field in ['rate','deposit_unit_amount','refill_unit_amount','total_amount','final_amount','discount_amount']:
            result=self.client.post('/api/bookings/',{**self.line(),field:'1'},format='json')
            self.assertEqual(result.status_code,400,result.data)
        self.assertEqual(Booking.objects.count(),0)
        for kind in ['new','refill']:
            line=self.line(kind,3)
            preview=self.client.post('/api/bookings/preview/',{'items':[line]},format='json')
            result=self.client.post('/api/bookings/',line,format='json')
            self.assertEqual(result.status_code,201,result.data)
            self.assertEqual(D(result.data['final_amount']),D(preview.data['items'][0]['final_amount']))
            self.assertEqual(D(result.data['deposit_unit_amount']),450 if kind=='new' else 0)

    def test_booking_delivery_preserves_snapshots_after_rates_and_discounts_change(self):
        self.discount('fixed','100')
        self.auth(self.customer_user)
        result=self.client.post('/api/bookings/',self.line(quantity=3),format='json')
        self.assertEqual(result.status_code,201,result.data)
        booking=Booking.objects.get(pk=result.data['id'])
        self.cylinder.deposit_amount=999
        self.cylinder.refill_rate=999
        self.cylinder.save()
        self.discount('percentage','80')
        booking.status='approved'
        booking.assigned_staff=self.staff_a
        booking.save()
        delivery=self.make_delivery(booking,self.staff_a)
        self.auth(self.staff_a)
        result=self.client.post(f'/api/deliveries/{delivery.pk}/complete/',{'empty_collected':1,'payment_collected':'500','payment_method':'cash'},format='json')
        self.assertEqual(result.status_code,200,result.data)
        item=SaleItem.objects.get()
        self.assertEqual((item.rate_type,item.deposit_unit_amount,item.refill_unit_amount,item.total_amount),('new',D('450'),D('360'),D('2330')))
        self.assertEqual(item.sale.balance_due,D('1830'))
        self.assertEqual(result.data['deposit_unit_amount'],'450.00')

    def test_legacy_amounts_and_unknown_breakdowns_remain_unchanged(self):
        booking=Booking.objects.create(customer=self.customer,cylinder_type=self.cylinder,quantity=2,original_amount=1500,final_amount=1400,discount_amount=100)
        sale=Sale.objects.create(customer=self.customer,location=self.shop,sold_by=self.admin,total_amount=777,balance_due=777)
        item=SaleItem.objects.create(sale=sale,cylinder_type=self.cylinder,quantity=1,rate=777,total_amount=777)
        self.cylinder.deposit_amount=999
        self.cylinder.refill_rate=999
        self.cylinder.save()
        self.assertEqual(BookingSerializer(booking).data['final_amount'],'1400.00')
        self.assertIsNone(BookingSerializer(booking).data['deposit_unit_amount'])
        self.assertEqual(D(SaleSerializer(sale).data['total_amount']),D('777'))
        self.assertIsNone(SaleSerializer(sale).data['items'][0]['rate_type'])
        booking.final_amount=0
        booking.original_amount=0
        booking.discount_amount=0
        self.assertEqual(BookingSerializer(booking).data['final_amount'],'0.00')

    def test_admin_quote_customer_and_staff_history_expose_same_saved_components(self):
        payload={'customer':self.customer.pk,'sale_items':[self.line(quantity=2)]}
        quote=self.client.post('/api/sales/preview/',payload,format='json')
        self.assertEqual(quote.status_code,200,quote.data)
        self.assertEqual(Sale.objects.count(),0)
        result=self.sell(payload['sale_items'],handover_staff=self.staff_a.pk)
        self.assertEqual(result.status_code,201,result.data)
        self.assertEqual(D(result.data['total_amount']),D(quote.data['total_amount']))
        sale_id=result.data['id']
        self.auth(self.customer_user)
        row=self.client.get('/api/bookings/history/').data['results'][0]
        self.assertEqual(row['source_id'],sale_id)
        self.assertEqual(row['items'][0]['deposit_unit_amount'],'450.00')
        self.auth(self.staff_a)
        row=self.client.get('/api/deliveries/history/').data['results'][0]['sale']
        self.assertEqual(row['items'][0]['refill_unit_amount'],'360.00')
        self.assertEqual(row['total_amount'],'1620.00')
        for user in [self.staff_a,self.customer_user]:
            self.auth(user)
            self.assertEqual(self.client.post('/api/sales/preview/',payload,format='json').status_code,403)
            self.assertEqual(self.client.patch(f'/api/cylinder-types/{self.cylinder.pk}/',{'deposit_amount':'1'},format='json').status_code,403)

    def test_rate_edits_validate_independent_rates_without_touching_selling_price(self):
        for field in ['deposit_amount','refill_rate']:
            result=self.client.patch(f'/api/cylinder-types/{self.cylinder.pk}/',{field:'-1'},format='json')
            self.assertEqual(result.status_code,400)
        result=self.client.patch(f'/api/cylinder-types/{self.cylinder.pk}/',{'deposit_amount':'460','refill_rate':'370'},format='json')
        self.assertEqual(result.status_code,200,result.data)
        self.cylinder.refresh_from_db()
        self.assertEqual(self.cylinder.selling_price,D('900'))
        self.assertEqual(calculate_pricing(None,self.cylinder,1,'new')['final_amount'],D('830'))

    def test_new_customer_and_split_collection_use_configured_components(self):
        result=self.client.post('/api/sales/',{
            'client_ref':str(uuid.uuid4()),'new_customer':{'name':'New Buyer','phone':'9111111111'},
            'location':self.shop.pk,'sale_items':[self.line(quantity=2)],'payment_mode':'split',
            'split_payments':[{'mode':'cash','amount':'500'},{'mode':'gpay','amount':'300'}]},format='json')
        self.assertEqual(result.status_code,201,result.data)
        sale=Sale.objects.get(pk=result.data['id'])
        self.assertEqual((sale.total_amount,sale.paid_amount,sale.balance_due),(D('1620'),D('800'),D('820')))
        result=self.client.post('/api/payments/',{'customer':sale.customer_id,'sale':sale.pk,'amount':'820','payment_mode':'bank'},format='json')
        self.assertEqual(result.status_code,201,result.data)
        sale.refresh_from_db()
        self.assertEqual((sale.paid_amount,sale.balance_due),(D('1620'),0))
        self.assertEqual(sum(Payment.objects.filter(sale=sale).values_list('amount',flat=True)),D('1620'))

    def test_free_refill_and_stale_quote_cannot_reduce_the_deposit(self):
        self.discount('percentage','100')
        self.assertEqual(calculate_pricing(self.customer,self.cylinder,2,'refill')['final_amount'],0)
        self.assertEqual(calculate_pricing(self.customer,self.cylinder,2,'new')['final_amount'],900)
        result=self.sell(quoted_total='810')
        self.assertEqual(result.status_code,400,result.data)
        self.assertEqual(result.data['code'],'quote_changed')
        self.assertFalse(Sale.objects.exists())
        result=self.sell(quoted_total='450')
        self.assertEqual(result.status_code,201,result.data)
        self.assertEqual(result.data['items'][0]['deposit_unit_amount'],'450.00')

    def test_new_type_keeps_empty_credit_independent_of_price_thresholds(self):
        self.sell([self.line(quantity=0,empty_returned=3)])
        # A free refill makes the new-cylinder price lower than the old threshold.
        self.discount('percentage','100')
        result=self.sell([self.line('new',2,empty_returned=0)])
        self.assertEqual(result.status_code,201,result.data)
        from core.serializers import CustomerProfileSerializer
        profile=CustomerProfileSerializer(self.customer).data
        self.assertEqual(profile['empty_credits'][self.cylinder.pk]['credit'],3)
        result=self.sell([self.line('refill',1,empty_returned=0)])
        self.assertEqual(result.status_code,201,result.data)
        profile=CustomerProfileSerializer(self.customer).data
        self.assertEqual(profile['empty_credits'][self.cylinder.pk]['credit'],2)

    def test_idempotent_retry_preserves_original_quote_after_configuration_changes(self):
        body={'client_ref':str(uuid.uuid4()),'customer':self.customer.pk,'location':self.shop.pk,
              'payment_mode':'cash','sale_items':[self.line(rate='810')],'quoted_total':'810'}
        first=self.client.post('/api/sales/',body,format='json')
        self.assertEqual(first.status_code,201,first.data)
        self.cylinder.deposit_amount=999
        self.cylinder.save()
        second=self.client.post('/api/sales/',body,format='json')
        self.assertEqual(second.status_code,200,second.data)
        self.assertEqual(first.data['id'],second.data['id'])
        self.assertEqual(second.data['items'][0]['deposit_unit_amount'],'450.00')
        self.assertEqual(Sale.objects.count(),1)

    def test_preview_validation_and_money_limits(self):
        self.auth(self.customer_user)
        for qty in ['bad',1.2,-1,0,2147483648]:
            result=self.client.post('/api/bookings/preview/',{'items':[self.line(quantity=qty)]},format='json')
            self.assertEqual(result.status_code,400,result.data)
        result=self.client.post('/api/bookings/preview/',{'items':['bad']},format='json')
        self.assertEqual(result.status_code,400)
        result=self.client.post('/api/bookings/',self.line(quantity=2000000),format='json')
        self.assertEqual(result.status_code,400,result.data)
        self.assertFalse(Booking.objects.exists())
