import unittest
import uuid
from django.db import connection
from django.test import TransactionTestCase
from rest_framework.test import APIClient
from core.models import Booking, BookingItem, Product, ProductCategory, ProductMovement, CustomerProfile, CylinderType, Role, User, StaffProfile, StockLocation, Stock, Sale
from .concurrency import run_concurrently


@unittest.skipUnless(connection.vendor == 'postgresql', 'Real row locks require PostgreSQL')
class ProductConcurrencyTests(TransactionTestCase):
    def setUp(self):
        role=Role.objects.create(code='customer',name='Customer');admin_role=Role.objects.create(code='admin',name='Admin');staff_role=Role.objects.create(code='staff',name='Staff')
        self.users=[User.objects.create_user(username=f'buyer{i}',role=role) for i in range(2)]
        for user in self.users: CustomerProfile.objects.create(user=user)
        self.admin=User.objects.create_user(username='admin',role=admin_role)
        self.staff=User.objects.create_user(username='staff',role=staff_role);StaffProfile.objects.create(user=self.staff)
        self.cylinder=CylinderType.objects.create(name='5kg',weight=5,selling_price=810,deposit_amount=450,refill_rate=360)
        self.product=Product.objects.create(name='Last regulator',sku='LAST',selling_price=250,stock=1,category=ProductCategory.objects.create(name='Accessory'))
        shop=StockLocation.objects.create(name='Shop',code='shop');Stock.objects.create(cylinder_type=self.cylinder,location=shop,status='filled',quantity=10)
        self.client=APIClient()

    def payload(self,user):
        self.client.force_authenticate(user)
        items=[dict(cylinder_type=self.cylinder.pk,quantity=1),dict(product=self.product.pk,quantity=1)]
        quote=self.client.post('/api/bookings/preview/',{'items':items},format='json').data['quote']
        return dict(items=items,quote=quote,client_ref=str(uuid.uuid4()),delivery_address='Test address',delivery_phone='9000000000')

    def test_two_customers_cannot_buy_last_unit(self):
        requests=[(u,'/api/bookings/checkout/',self.payload(u)) for u in self.users]
        results=run_concurrently(requests)
        self.assertEqual(sorted(r[0] for r in results),[201,400],results)
        self.assertEqual(Booking.objects.count(),1);self.product.refresh_from_db();self.assertEqual(self.product.reserved,1)

    def test_simultaneous_retry_creates_one_booking(self):
        body=self.payload(self.users[0]);request=(self.users[0],'/api/bookings/checkout/',body)
        results=run_concurrently([request,request])
        self.assertEqual(sorted(r[0] for r in results),[200,201],results)
        self.assertEqual(Booking.objects.count(),1);self.assertEqual(ProductMovement.objects.count(),1)

    def cylinder_payload(self, user):
        self.client.force_authenticate(user)
        items = [dict(cylinder_type=self.cylinder.pk, quantity=2, rate_type='refill')]
        quote = self.client.post('/api/bookings/preview/', {'items': items}, format='json').data['quote']
        return dict(items=items, quote=quote, client_ref=str(uuid.uuid4()), delivery_address='Synthetic address', delivery_phone='')

    def test_concurrent_cylinder_retry_creates_one_booking_and_notification_set(self):
        from core.models import Notification
        body = self.cylinder_payload(self.users[0])
        request = (self.users[0], '/api/bookings/checkout/', body)
        results = run_concurrently([request, request])
        self.assertEqual(sorted(r[0] for r in results), [200, 201], results)
        self.assertEqual(Booking.objects.count(), 1)
        self.assertEqual(BookingItem.objects.count(), 1)
        notifications = Notification.objects.count()
        self.assertGreater(notifications, 0)
        self.client.force_authenticate(self.users[0])
        self.assertEqual(self.client.post('/api/bookings/checkout/', body, format='json').status_code, 200)
        self.assertEqual(Notification.objects.count(), notifications)

    def test_concurrent_cross_customer_key_collision_rejected_without_duplicate(self):
        left, right = [self.cylinder_payload(user) for user in self.users]
        right['client_ref'] = left['client_ref']
        results = run_concurrently([(self.users[0], '/api/bookings/checkout/', left), (self.users[1], '/api/bookings/checkout/', right)])
        self.assertEqual(sorted(r[0] for r in results), [201, 409], results)
        self.assertEqual(Booking.objects.count(), 1)

    def test_concurrent_changed_payload_same_key_rejected(self):
        left = self.cylinder_payload(self.users[0])
        right = {**left, 'delivery_address': 'Other address'}
        results = run_concurrently([(self.users[0], '/api/bookings/checkout/', body) for body in (left, right)])
        self.assertEqual(sorted(r[0] for r in results), [201, 409], results)
        self.assertEqual(Booking.objects.count(), 1)

    def test_simultaneous_stock_click_retry_applies_once(self):
        body=dict(client_ref=str(uuid.uuid4()),delta=1,reason='Received')
        request=(self.admin,f'/api/products/{self.product.pk}/stock/',body)
        results=run_concurrently([request,request])
        self.assertEqual([r[0] for r in results],[200,200],results)
        self.product.refresh_from_db();self.assertEqual(self.product.stock,2)
        self.assertEqual(ProductMovement.objects.count(),1)

    def test_concurrent_cancellation_releases_once(self):
        body=self.payload(self.users[0]);self.client.post('/api/bookings/checkout/',body,format='json')
        request=(self.admin,f'/api/bookings/{Booking.objects.get().pk}/reject/',{'reason':'Cancelled'})
        results=run_concurrently([request,request])
        self.assertEqual(sorted(r[0] for r in results),[200,400],results)
        self.product.refresh_from_db();self.assertEqual((self.product.stock,self.product.reserved),(1,0))
        self.assertEqual(ProductMovement.objects.filter(kind='release').count(),1)

    def test_completion_retry_deducts_and_bills_once(self):
        body=self.payload(self.users[0]);self.client.post('/api/bookings/checkout/',body,format='json');booking=Booking.objects.get()
        self.client.force_authenticate(self.admin)
        self.client.post(f'/api/bookings/{booking.pk}/approve/',{'assigned_staff':self.staff.pk},format='json')
        self.client.force_authenticate(self.staff)
        delivery=booking.delivery
        for action in ['accept','start']: self.client.post(f'/api/deliveries/{delivery.pk}/{action}/',{},format='json')
        request=(self.staff,f'/api/deliveries/{delivery.pk}/complete/',{'payment_collected':'610','payment_method':'cash','empty_collected':1})
        results=run_concurrently([request,request])
        self.assertEqual(sorted(r[0] for r in results),[200,400],results)
        self.assertEqual(Sale.objects.count(),1)
        self.product.refresh_from_db();self.assertEqual((self.product.stock,self.product.reserved),(0,0))
        self.assertEqual(ProductMovement.objects.filter(kind='deduction').count(),1)
