import unittest
import uuid
from django.db import connection
from django.test import TransactionTestCase
from core.models import CustomerProfile, Payment, ProductMovement, Sale, StockLocation
from .test_product_concurrency import ProductConcurrencyTests
from .concurrency import run_concurrently


@unittest.skipUnless(connection.vendor == 'postgresql', 'Requires real PostgreSQL row locks')
class StaffPaymentConcurrencyTests(TransactionTestCase):
    def setUp(self):
        ProductConcurrencyTests.setUp(self)
        self.customer=CustomerProfile.objects.get(user=self.users[0])
        self.shop=StockLocation.objects.get(code='shop')
        self.client.force_authenticate(self.staff)

    def payload(self, customer=None):
        return dict(client_ref=str(uuid.uuid4()),customer=(customer or self.customer).pk,location=self.shop.pk,payment_mode='credit',paid_amount='0',accessory_lines=[dict(product=self.product.pk,quantity=1)])

    def unpaid_sale(self):
        response=self.client.post('/api/staff-sales/',self.payload(),format='json')
        self.assertEqual(response.status_code,201,response.data)
        return Sale.objects.get()

    def test_simultaneous_payment_retry_is_once(self):
        sale=self.unpaid_sale()
        request=(self.staff,f'/api/staff-sales/{sale.pk}/collect-payment/',dict(client_ref=str(uuid.uuid4()),payments=[dict(mode='cash',amount='100')]))
        results=run_concurrently([request,request])
        self.assertEqual(sorted(r[0] for r in results),[200,201],results)
        sale.refresh_from_db();self.assertEqual(sale.paid_amount,100);self.assertEqual(Payment.objects.count(),1)

    def test_concurrent_different_payments_cannot_overcollect(self):
        sale=self.unpaid_sale()
        requests=[(self.staff,f'/api/staff-sales/{sale.pk}/collect-payment/',dict(client_ref=str(uuid.uuid4()),payments=[dict(mode=mode,amount='200')])) for mode in ['cash','gpay']]
        results=run_concurrently(requests)
        self.assertEqual(sorted(r[0] for r in results),[201,400],results)
        sale.refresh_from_db();self.assertEqual((sale.paid_amount,sale.balance_due),(200,50));self.assertEqual(Payment.objects.count(),1)

    def test_concurrent_direct_sale_cannot_take_reserved_or_last_unit_twice(self):
        requests=[(self.staff,'/api/staff-sales/',self.payload(CustomerProfile.objects.get(user=u))) for u in self.users]
        results=run_concurrently(requests)
        self.assertEqual(sorted(r[0] for r in results),[201,400],results)
        self.product.refresh_from_db();self.assertEqual(self.product.stock,0);self.assertEqual(Sale.objects.count(),1)

    def test_concurrent_sale_retry_deducts_once(self):
        request=(self.staff,'/api/staff-sales/',self.payload())
        results=run_concurrently([request,request])
        self.assertEqual(sorted(r[0] for r in results),[200,201],results)
        self.assertEqual(Sale.objects.count(),1);self.assertEqual(ProductMovement.objects.count(),1)
