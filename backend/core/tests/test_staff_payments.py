import uuid
from datetime import datetime, timezone as dt_timezone
from decimal import Decimal as D
from unittest.mock import patch
from core.models import Payment, Product, ProductCategory, ProductMovement, Sale, SaleAccessoryItem, Stock
from core.integrity import violations
from .base import GasBookTestCase


class StaffPaymentTests(GasBookTestCase):
    def setUp(self):
        super().setUp()
        self.set_stock(self.shop, filled=20, empty=0)
        self.product = Product.objects.create(name='Regulator', sku='PAY-REG', category=ProductCategory.objects.create(name='Regulators'), selling_price=250, stock=5)
        self.auth(self.staff_a)

    def payload(self, **extra):
        data = dict(client_ref=str(uuid.uuid4()), customer=self.customer.pk, location=self.shop.pk,
                    sale_items=[dict(cylinder_type=self.cylinder.pk, quantity=1, rate_type='refill', empty_returned=1)],
                    payment_mode='credit', paid_amount='0')
        data.update(extra)
        return data

    def sell(self, data=None):
        response = self.client.post('/api/staff-sales/', data or self.payload(), format='json')
        self.assertEqual(response.status_code, 201, response.data)
        return Sale.objects.get(pk=response.data['id'])

    def collect(self, sale, payments, ref=None):
        return self.client.post(f'/api/staff-sales/{sale.pk}/collect-payment/',dict(client_ref=ref or str(uuid.uuid4()),payments=payments),format='json')

    def test_delivery_cash_upi_bank_split_partial_and_unpaid(self):
        for parts, paid in [([('cash','1800')],1800),([('gpay','1800')],1800),([('bank','1800')],1800),([('cash','400'),('gpay','1400')],1800),([('cash','400')],400),([],0)]:
            with self.subTest(parts=parts):
                booking, delivery=self.assigned_booking()
                body=dict(payment_collected=str(paid))
                if parts: body['split_payments']=[dict(mode=m,amount=a) for m,a in parts]
                response=self.client.post(f'/api/deliveries/{delivery.pk}/complete/',body,format='json')
                self.assertEqual(response.status_code,200,response.data)
                booking.refresh_from_db();sale=booking.sale
                self.assertEqual((sale.paid_amount,sale.balance_due),(D(paid),D(1800-paid)))
                self.assertEqual(booking.payment_status,'PAID' if paid==1800 else 'PARTIAL' if paid else 'PENDING')
                self.assertEqual(set(sale.payments.values_list('received_by_id',flat=True)),{self.staff_a.pk} if parts else set())
                count=Payment.objects.count()
                self.assertEqual(self.client.post(f'/api/deliveries/{delivery.pk}/complete/',body,format='json').status_code,400)
                self.assertEqual(Payment.objects.count(),count)
        self.assertEqual(violations(),[])

    def test_subsequent_payment_settles_original_booking_and_retries(self):
        booking,delivery=self.assigned_booking()
        self.client.post(f'/api/deliveries/{delivery.pk}/complete/',dict(payment_collected='400',payment_method='cash'),format='json')
        booking.refresh_from_db();sale=booking.sale
        ref=str(uuid.uuid4());parts=[dict(mode='bank',amount='1400')]
        first=self.collect(sale,parts,ref);again=self.collect(sale,parts,ref)
        self.assertEqual([first.status_code,again.status_code],[201,200],first.data)
        booking.refresh_from_db();sale.refresh_from_db()
        self.assertEqual((sale.paid_amount,sale.balance_due),(D(1800),D(0)))
        self.assertEqual(sale.payments.count(),2)
        self.assertEqual(self.collect(sale,[dict(mode='cash',amount='1')],ref).status_code,409)
        self.auth(self.customer_user)
        booking_data=self.client.get(f'/api/bookings/{booking.pk}/').data
        self.assertEqual(booking_data['payment_status'],'PAID')
        data=booking_data['payment_summary']
        self.assertEqual(data['balance_due'],'0.00');self.assertEqual(len(data['payments']),2)
        self.assertNotIn('received_by',data['payments'][0])
        self.auth(self.admin)
        self.assertEqual(len(self.client.get(f'/api/sales/{sale.pk}/').data['payment_summary']['payments']),2)
        self.assertEqual(violations(),[])

    def test_mixed_direct_sale_prices_stock_history_receipt_and_retry(self):
        self.cylinder.deposit_amount=300;self.cylinder.refill_rate=360;self.cylinder.save()
        self.customer.global_discount_type='percentage';self.customer.global_discount_value=10;self.customer.global_discount_is_active=True;self.customer.save()
        body=self.payload(sale_items=[dict(cylinder_type=self.cylinder.pk,quantity=2,rate_type='new',empty_returned=2)],accessory_lines=[dict(product=self.product.pk,quantity=2)],payment_mode='split',split_payments=[dict(mode='cash',amount='400'),dict(mode='gpay',amount='1348')])
        body.pop('paid_amount')
        sale=self.sell(body)
        self.assertEqual((sale.total_amount,sale.paid_amount,sale.balance_due),(D(1748),D(1748),D(0)))
        self.assertEqual((sale.sold_by,sale.handover_staff),(self.staff_a,self.staff_a))
        self.product.refresh_from_db();self.assertEqual(self.product.stock,3)
        self.assertEqual(SaleAccessoryItem.objects.get().rate,250)
        self.assertEqual(self.stock_qty(self.shop,Stock.Status.EMPTY),2)
        self.assertEqual(self.client.post('/api/staff-sales/',body,format='json').status_code,200)
        self.assertEqual(Sale.objects.count(),1);self.assertEqual(Payment.objects.count(),2)
        self.assertEqual(ProductMovement.objects.filter(sale=sale).count(),1)
        self.product.selling_price=999;self.product.save()
        self.auth(self.customer_user)
        history=self.client.get('/api/bookings/history/').data['results']
        row=next(i for i in history if i.get('source_id')==sale.pk)
        self.assertEqual(len(row['order_items']),2);self.assertEqual(row['payment_summary']['paid_amount'],'1748.00')
        receipt=self.client.get(f'/api/receipts/sale/{sale.pk}/').data
        self.assertEqual(receipt['total_amount'],'1748.00');self.assertEqual(receipt['items'][-1]['unit_amount'],'250.00')
        self.assertEqual(violations(),[])

    def test_accessory_only_and_credit_sale(self):
        sale=self.sell(self.payload(sale_items=[],accessory_lines=[dict(product=self.product.pk,quantity=1)]))
        self.assertEqual((sale.total_amount,sale.balance_due),(250,250));self.assertFalse(Payment.objects.exists())
        self.auth(self.customer_user)
        rows=self.client.get('/api/bookings/history/').data['results']
        row=next(r for r in rows if r.get('source_id')==sale.pk)
        self.assertEqual(row['display_badge'],'Accessories');self.assertEqual(row['quantity'],1)
        self.assertFalse(row['can_order_again'])

    def test_unauthorized_staff_and_tampered_prices(self):
        for extra in [dict(sold_by=self.staff_b.pk),dict(handover_staff=self.staff_b.pk),dict(sale_items=[dict(cylinder_type=self.cylinder.pk,quantity=1,deposit='1',rate_type='new')]),dict(accessory_lines=[dict(product=self.product.pk,quantity=1,rate='1')]),dict(total_amount='1')]:
            response=self.client.post('/api/staff-sales/',self.payload(**extra),format='json')
            self.assertIn(response.status_code,[400,403],response.data)
        self.assertFalse(Sale.objects.exists())
        sale=self.sell();self.auth(self.staff_b)
        self.assertEqual(self.client.get(f'/api/staff-sales/{sale.pk}/').status_code,404)
        self.assertEqual(self.collect(sale,[dict(mode='cash',amount='10')]).status_code,404)
        self.auth(self.customer_user)
        self.assertEqual(self.client.post('/api/staff-sales/',self.payload(),format='json').status_code,403)
        self.assertEqual(self.client.get('/api/staff-sales/collections-today/').status_code,403)
        self.assertFalse(Payment.objects.exists())

    def test_overpayment_is_atomic_and_stock_not_oversold(self):
        sale=self.sell()
        response=self.collect(sale,[dict(mode='cash',amount='500'),dict(mode='bank',amount='500')])
        self.assertEqual(response.status_code,400,response.data)
        sale.refresh_from_db();self.assertEqual(sale.balance_due,900);self.assertFalse(Payment.objects.exists())
        self.product.reserved=5;self.product.save()
        response=self.client.post('/api/staff-sales/',self.payload(accessory_lines=[dict(product=self.product.pk,quantity=1)]),format='json')
        self.assertEqual(response.status_code,400);self.assertEqual(Sale.objects.count(),1)

    def test_today_summary_uses_payment_time_collector_and_ist_boundaries(self):
        sale=self.sell()
        for user,amount,mode,when in [(self.staff_a,100,'cash','2026-10-15T18:30:00+00:00'),(self.staff_a,200,'gpay','2026-10-16T10:00:00+00:00'),(self.staff_a,50,'bank','2026-10-16T18:29:59+00:00'),(self.staff_a,99,'cash','2026-10-15T18:29:59+00:00'),(self.staff_a,88,'cash','2026-10-16T18:30:00+00:00'),(self.staff_b,70,'cash','2026-10-16T10:00:00+00:00')]:
            row=Payment.objects.create(customer=self.customer,sale=sale,amount=amount,payment_mode=mode,received_by=user)
            Payment.objects.filter(pk=row.pk).update(created_at=datetime.fromisoformat(when))
        with patch('core.collections.timezone.now',return_value=datetime(2026,10,16,12,tzinfo=dt_timezone.utc)):
            data=self.client.get('/api/staff-sales/collections-today/').data
        self.assertEqual(D(data['total']),350);self.assertEqual({k:D(v) for k,v in data['methods'].items()},{'cash':100,'gpay':200,'bank':50})
        self.assertEqual(data['date'],'2026-10-16')

    def test_admin_atomic_split_collection_and_replay(self):
        sale=self.sell();self.auth(self.admin)
        body=dict(client_ref=str(uuid.uuid4()),customer=self.customer.pk,payments=[dict(mode='cash',amount='400'),dict(mode='bank',amount='500')])
        first=self.client.post('/api/payments/collect/',body,format='json');again=self.client.post('/api/payments/collect/',body,format='json')
        self.assertEqual([first.status_code,again.status_code],[201,200],first.data)
        sale.refresh_from_db();self.assertEqual(sale.balance_due,0)
        self.assertEqual(Payment.objects.filter(received_by=self.admin).count(),2)
        self.auth(self.staff_a)
        self.assertEqual(D(self.client.get('/api/staff-sales/collections-today/').data['total']),0)
        self.assertEqual(violations(),[])

    def test_cancel_accessories_restocks_once_and_credit_transfer_is_not_collection(self):
        sale=self.sell(self.payload(accessory_lines=[dict(product=self.product.pk,quantity=2)],payment_mode='credit',paid_amount='400',paid_payment_mode='cash'))
        self.auth(self.admin)
        response=self.client.post(f'/api/sales/{sale.pk}/void/',dict(reason='Wrong items',outcome='credit'),format='json')
        self.assertEqual(response.status_code,200,response.data)
        self.product.refresh_from_db();self.assertEqual(self.product.stock,5)
        self.assertEqual(self.client.post(f'/api/sales/{sale.pk}/void/',dict(reason='Retry',outcome='credit'),format='json').status_code,409)
        self.assertEqual(ProductMovement.objects.filter(sale=sale,kind='return').count(),1)
        data=self.client.get('/api/staff-sales/collections-today/').data
        self.assertEqual(D(data['total']),0)  # admin moved credit, did not receive cash
        self.auth(self.staff_a)
        self.assertEqual(D(self.client.get('/api/staff-sales/collections-today/').data['total']),400)
        self.assertEqual(self.collect(sale,[dict(mode='cash',amount='1')]).status_code,409)
        self.assertEqual(violations(),[])

    def test_refund_summary_is_separate_from_collections(self):
        sale=self.sell(self.payload(payment_mode='cash',paid_amount='900'))
        self.auth(self.admin)
        self.assertEqual(self.client.post(f'/api/sales/{sale.pk}/void/',dict(reason='Return',outcome='refund'),format='json').status_code,200)
        response=self.client.post(f'/api/sales/{sale.pk}/confirm-refund/',dict(payment_mode='bank',reference='Test refund'),format='json')
        self.assertEqual(response.status_code,200,response.data)
        data=self.client.get('/api/staff-sales/collections-today/').data
        self.assertEqual(D(data['total']),0);self.assertEqual(D(data['refunds']),900)
        self.assertEqual(violations(),[])

    def test_customer_cannot_read_other_customer_sale_or_its_receipt(self):
        from core.models import CustomerProfile, User
        other_user=User.objects.create_user(username='otherbuyer',role=self.customer_role)
        other=CustomerProfile.objects.create(user=other_user)
        sale=self.sell(self.payload(customer=other.pk))
        self.auth(self.customer_user)
        history=self.client.get('/api/bookings/history/').data['results']
        self.assertFalse(any(row.get('source_id')==sale.pk for row in history))
        self.assertEqual(self.client.get(f'/api/receipts/sale/{sale.pk}/').status_code,404)
        # Even inconsistent legacy links must not expose another customer's payments.
        booking=self.make_booking(sale=sale)
        self.assertIsNone(self.client.get(f'/api/bookings/{booking.pk}/').data['payment_summary'])
