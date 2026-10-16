import io
import uuid
from decimal import Decimal as D
from PIL import Image
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from core.models import Booking, BookingItem, Product, ProductCategory, ProductMovement, Sale, SaleItem, Payment, CylinderType
from core.integrity import violations
from .base import GasBookTestCase


class ProductBookingTests(GasBookTestCase):
    def setUp(self):
        super().setUp()
        self.category = ProductCategory.objects.create(name='Regulator')
        self.product = Product.objects.create(name='Gas regulator', category=self.category, selling_price=D('250'),stock=5,sku='TEST')
        self.cylinder.deposit_amount = D('450'); self.cylinder.refill_rate = D('360'); self.cylinder.save()
        self.set_stock(self.shop, filled=20, empty=0)
        self.auth(self.customer_user)

    def items(self, quantity=1, rate_type='refill'):
        return [dict(client_item_id='cyl',cylinder_type=self.cylinder.pk,quantity=quantity,rate_type=rate_type),
                dict(client_item_id='accessory',product=self.product.pk,quantity=quantity)]

    def payload(self, items=None):
        items = items or self.items()
        response = self.client.post('/api/bookings/preview/', {'items':items},format='json')
        self.assertEqual(response.status_code,200,response.data)
        return dict(items=items,client_ref=str(uuid.uuid4()),quote=response.data['quote'],delivery_address='12 Main Street',delivery_phone='9000000004')

    def place(self, items=None):
        response=self.client.post('/api/bookings/checkout/',self.payload(items),format='json')
        self.assertEqual(response.status_code,201,response.data)
        return Booking.objects.get(pk=response.data['id'])

    def assign(self, booking):
        self.auth(self.admin)
        response=self.client.post(f'/api/bookings/{booking.pk}/approve/',{'assigned_staff':self.staff_a.pk},format='json')
        self.assertEqual(response.status_code,200,response.data)
        self.auth(self.staff_a)
        delivery=booking.delivery
        for action in ['accept','start']:
            response=self.client.post(f'/api/deliveries/{delivery.pk}/{action}/',{},format='json')
            self.assertEqual(response.status_code,200,response.data)
        return delivery

    def test_combined_booking_and_price_snapshots(self):
        booking=self.place(self.items(2,'new'))
        self.assertEqual(Booking.objects.count(),1)
        self.assertEqual(booking.final_amount,D('2120'))
        self.assertEqual(booking.order_items.count(),2)
        self.product.refresh_from_db(); self.assertEqual((self.product.stock,self.product.reserved),(5,2))
        self.product.selling_price=999;self.product.name='Edited';self.product.save()
        row=self.client.get(f'/api/bookings/{booking.pk}/').data
        self.assertEqual(row['order_items'][1]['name'],'Gas regulator')
        self.assertEqual(row['order_items'][1]['total_amount'],'500.00')
        receipt=self.client.get(f'/api/receipts/booking/{booking.pk}/').data
        self.assertEqual(receipt['total_amount'],'2120.00');self.assertEqual(len(receipt['items']),2)

    def test_discount_applies_only_to_refill_not_accessory_or_deposit(self):
        self.customer.global_discount_type='percentage';self.customer.global_discount_value=10;self.customer.global_discount_is_active=True;self.customer.save()
        booking=self.place(self.items(2,'new'))
        self.assertEqual(booking.discount_amount,D('72'));self.assertEqual(booking.final_amount,D('2048'))
        self.assertEqual(booking.order_items.get(product=self.product).discount_amount,0)

    def test_refill_and_cylinder_only_preserved(self):
        booking=self.place();self.assertEqual(booking.final_amount,D('610'))
        response=self.client.post('/api/bookings/',{'cylinder_type':self.cylinder.pk,'quantity':2,'rate_type':'refill'},format='json')
        self.assertEqual(response.status_code,201,response.data);self.assertEqual(response.data['final_amount'],'720.00')
        self.assertEqual(response.data['order_items'],[])

    def test_retries_do_not_duplicate_booking_or_reservations(self):
        payload=self.payload()
        first=self.client.post('/api/bookings/checkout/',payload,format='json')
        second=self.client.post('/api/bookings/checkout/',payload,format='json')
        self.assertEqual([first.status_code,second.status_code],[201,200]);self.assertEqual(first.data['id'],second.data['id'])
        self.assertEqual(ProductMovement.objects.filter(kind='reservation').count(),1)
        payload['delivery_address']='Changed'
        self.assertEqual(self.client.post('/api/bookings/checkout/',payload,format='json').status_code,409)

    def test_tampered_amounts_and_duplicate_lines_rejected(self):
        payload=self.payload();payload['items'][1]['rate']='1'
        self.assertEqual(self.client.post('/api/bookings/checkout/',payload,format='json').status_code,400)
        payload=self.payload();payload['total_amount']='1'
        self.assertEqual(self.client.post('/api/bookings/checkout/',payload,format='json').status_code,400)
        items=self.items();items.append(items[1])
        self.assertEqual(self.client.post('/api/bookings/preview/',{'items':items},format='json').status_code,400)
        self.assertFalse(Booking.objects.exists())

    def test_stale_quote_inactive_and_insufficient_stock(self):
        payload=self.payload();self.product.selling_price=251;self.product.save()
        self.assertEqual(self.client.post('/api/bookings/checkout/',payload,format='json').status_code,409)
        payload=self.payload();self.product.is_active=False;self.product.save()
        self.assertEqual(self.client.post('/api/bookings/checkout/',payload,format='json').status_code,400)
        self.product.is_active=True;self.product.stock=0;self.product.save()
        self.assertEqual(self.client.post('/api/bookings/preview/',{'items':self.items()},format='json').status_code,400)
        self.assertFalse(Booking.objects.exists())

    def test_rejection_releases_once_decline_keeps_stock(self):
        booking=self.place();self.auth(self.admin)
        self.client.post(f'/api/bookings/{booking.pk}/approve/',{'assigned_staff':self.staff_a.pk},format='json')
        self.auth(self.staff_a)
        response=self.client.post(f'/api/deliveries/{booking.delivery.pk}/reject/',{'reason':'Unavailable'},format='json')
        self.assertEqual(response.status_code,200,response.data)
        self.product.refresh_from_db();self.assertEqual(self.product.reserved,1)
        self.auth(self.admin)
        response=self.client.post(f'/api/bookings/{booking.pk}/reject/',{'reason':'Customer cancelled'},format='json')
        self.assertEqual(response.status_code,200,response.data)
        self.client.post(f'/api/bookings/{booking.pk}/reject/',{'reason':'Retry'},format='json')
        self.product.refresh_from_db();self.assertEqual((self.product.stock,self.product.reserved),(5,0))
        self.assertEqual(ProductMovement.objects.filter(kind='release').count(),1)

    def test_delivery_payment_history_and_inventory_consistent(self):
        booking=self.place(self.items(2,'new'));delivery=self.assign(booking)
        response=self.client.post(f'/api/deliveries/{delivery.pk}/complete/',{'empty_collected':1,'split_payments':[{'mode':'cash','amount':'200'},{'mode':'gpay','amount':'300'}]},format='json')
        self.assertEqual(response.status_code,200,response.data)
        booking.refresh_from_db();sale=booking.sale
        self.assertEqual((sale.total_amount,sale.paid_amount,sale.balance_due),(D('2120'),D('500'),D('1620')))
        self.assertEqual(sale.items.get().total_amount,D('1620'))
        self.assertEqual(Payment.objects.count(),2)
        self.product.refresh_from_db();self.assertEqual((self.product.stock,self.product.reserved),(3,0))
        self.assertEqual(self.stock_qty(self.shop,'filled'),18);self.assertEqual(self.stock_qty(self.shop,'empty'),1)
        response=self.client.post(f'/api/deliveries/{delivery.pk}/complete/',{'empty_collected':1,'payment_collected':'500','payment_method':'cash'},format='json')
        self.assertNotEqual(response.status_code,200);self.assertEqual(Sale.objects.count(),1)
        self.assertEqual(ProductMovement.objects.filter(kind='deduction').count(),1)
        self.assertEqual(violations(),[])
        self.assertEqual(len(self.client.get('/api/deliveries/history/').data['results'][0]['delivery']['order_items']),2)
        self.auth(self.customer_user)
        self.assertEqual(len(self.client.get('/api/bookings/history/').data['results']),1)
        self.assertEqual(self.client.get(f'/api/receipts/booking/{booking.pk}/').data['balance_due'],'1620.00')

    def test_multiple_cylinder_types_keep_empty_returns_separate(self):
        other=CylinderType.objects.create(name='5kg',weight=5,selling_price=500,refill_rate=400)
        self.set_stock(self.shop,filled=4,empty=0,cylinder=other)
        items=self.items()+[dict(cylinder_type=other.pk,quantity=2,rate_type='refill')]
        booking=self.place(items);delivery=self.assign(booking)
        response=self.client.post(f'/api/deliveries/{delivery.pk}/complete/',{'payment_collected':'0','empty_collected_by_type':{str(self.cylinder.pk):1,str(other.pk):2}},format='json')
        self.assertEqual(response.status_code,200,response.data)
        self.assertEqual(self.stock_qty(self.shop,'empty',other),2)
        self.assertEqual(SaleItem.objects.count(),2);self.assertEqual(violations(),[])

    def test_customer_and_staff_isolation(self):
        booking=self.place();self.assign(booking)
        self.auth(self.staff_b)
        self.assertEqual(self.client.get(f'/api/deliveries/{booking.delivery.pk}/').status_code,404)
        self.assertEqual(self.client.get(f'/api/bookings/{booking.pk}/').status_code,404)
        from core.models import User, CustomerProfile
        user=User.objects.create_user(username='other',role=self.customer_role)
        CustomerProfile.objects.create(user=user);self.auth(user)
        self.assertEqual(self.client.get(f'/api/bookings/{booking.pk}/').status_code,404)
        self.assertEqual(self.client.get(f'/api/receipts/booking/{booking.pk}/').status_code,404)

    def test_admin_catalog_images_stock_and_permissions(self):
        self.assertNotIn('stock',self.client.get('/api/products/').data['results'][0])
        self.assertNotIn('reserved',self.client.get('/api/products/').data['results'][0])
        self.assertEqual(self.client.post('/api/products/',{},format='json').status_code,403)
        self.auth(self.admin)
        buffer=io.BytesIO();Image.new('RGB',(24,24),'blue').save(buffer,'PNG')
        response=self.client.post('/api/products/',dict(name='Hose',category='Hose',selling_price='180',initial_stock=3,image=SimpleUploadedFile('hose.png',buffer.getvalue(),content_type='image/png')),format='multipart')
        self.assertEqual(response.status_code,201,response.data)
        self.assertTrue(response.data['image']);self.assertEqual(response.data['stock'],3)
        pid=response.data['id'];payload=dict(client_ref=str(uuid.uuid4()),delta=1,reason='Received stock')
        for _ in range(2):
            result=self.client.post(f'/api/products/{pid}/stock/',payload,format='json');self.assertEqual(result.status_code,200,result.data)
        self.assertEqual(Product.objects.get(pk=pid).stock,4)
        self.assertEqual(self.client.patch(f'/api/products/{pid}/',{'name':'New hose','selling_price':'190','is_active':False},format='json').status_code,200)
        self.assertEqual(self.client.patch(f'/api/products/{pid}/',{'stock':9},format='json').status_code,400)
        response=self.client.post('/api/products/',dict(name='Bad',category='Bad',selling_price='10',image=SimpleUploadedFile('bad.png',b'not an image',content_type='image/png')),format='multipart')
        self.assertEqual(response.status_code,400)
        self.auth(self.customer_user);self.assertEqual(self.client.get(f'/api/products/{pid}/').status_code,404)

    def test_customer_catalog_only_lists_available_active_products(self):
        empty = Product.objects.create(name='Empty hose', category=self.category, selling_price=180, stock=0, sku='EMPTY')
        reserved = Product.objects.create(name='Reserved hose', category=self.category, selling_price=180, stock=2, reserved=2, sku='RESERVED')
        inactive = Product.objects.create(name='Inactive hose', category=self.category, selling_price=180, stock=3, is_active=False, sku='INACTIVE')
        self.product.reserved = 4
        self.product.save()
        response = self.client.get('/api/products/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['count'], 1)
        self.assertEqual([p['id'] for p in response.data['results']], [self.product.pk])
        self.assertTrue(response.data['results'][0]['available'])
        self.assertNotIn('stock', response.data['results'][0])
        self.assertNotIn('reserved', response.data['results'][0])
        for product in [empty, reserved, inactive]:
            self.assertEqual(self.client.get(f'/api/products/{product.pk}/').status_code, 404)
        self.auth(self.admin)
        response = self.client.get('/api/products/')
        self.assertEqual(response.data['count'], 4)
        rows = {p['id']: p for p in response.data['results']}
        self.assertEqual(rows[empty.pk]['stock'], 0)
        self.assertEqual(rows[reserved.pk]['stock'], 2)
        self.assertEqual(rows[reserved.pk]['reserved'], 2)
        self.assertIn(inactive.pk, rows)

    def test_stock_cannot_drop_below_reservations(self):
        self.place();self.auth(self.admin)
        response=self.client.post(f'/api/products/{self.product.pk}/stock/',dict(client_ref=str(uuid.uuid4()),quantity=0,reason='Count correction'),format='json')
        self.assertEqual(response.status_code,400)
        self.product.refresh_from_db();self.assertEqual(self.product.stock,5)

    def test_accessories_require_a_cylinder(self):
        payload=self.payload([self.items()[1]])
        self.assertEqual(self.client.post('/api/bookings/checkout/',payload,format='json').status_code,400)

    @override_settings(ACCESSORIES_ENABLED=False)
    def test_disabled_feature_keeps_old_booking_api_working(self):
        self.assertEqual(self.client.get('/api/products/').data['results'],[])
        response=self.client.post('/api/bookings/',{'cylinder_type':self.cylinder.pk,'quantity':1},format='json')
        self.assertEqual(response.status_code,201,response.data)

    def test_seed_is_repeatable_and_uses_renderable_local_images(self):
        import os
        from unittest.mock import patch
        from django.core.management import call_command
        from django.db import connection
        with override_settings(DEBUG=True), patch.dict(os.environ, {'GASBOOK_ENV':'development'}):
            for _ in range(2):
                call_command('seed_accessories',database_name=str(connection.settings_dict['NAME']),actor=self.admin.username,stdout=io.StringIO())
        seeded=Product.objects.filter(sku__startswith='DEMO-ACCESSORY-')
        self.assertEqual(seeded.count(),5)
        for p in seeded:
            with p.image.open('rb') as source:
                image=Image.open(source);image.verify()
        self.assertEqual(ProductMovement.objects.filter(reason='Development demo initial stock').count(),5)
        self.product.refresh_from_db();self.assertEqual(self.product.stock,5)

    def test_seed_refuses_unverified_environment(self):
        from django.core.management import call_command, CommandError
        with self.assertRaises(CommandError):
            call_command('seed_accessories',database_name='production',actor=self.admin.username)
        self.assertFalse(Product.objects.filter(sku__startswith='DEMO-ACCESSORY-').exists())

    def test_retired_commerce_tables_are_preserved_and_populated_orders_block_retirement(self):
        import importlib
        from types import SimpleNamespace
        from django.db import connection
        from django.db.migrations.executor import MigrationExecutor
        tables=connection.introspection.table_names()
        for name in ['core_commerceorder','core_commerceline','core_serviceoffering']:
            self.assertIn(name,tables)
        historical=MigrationExecutor(connection).loader.project_state([('core','0014_commerce_catalog_orders')]).apps
        old=historical.get_model('core','CommerceOrder').objects.create(customer_id=self.customer.pk,client_ref=uuid.uuid4(),request_hash='x',original_amount=0,discount_amount=0,final_amount=0,delivery_address='Test',delivery_phone='',customer_name='Customer')
        guard=importlib.import_module('core.migrations.0015_minimal_booking_inventory').check_retired_orders
        with self.assertRaisesRegex(RuntimeError,'preservation plan'):
            guard(historical,SimpleNamespace(connection=connection))
        self.assertTrue(historical.get_model('core','CommerceOrder').objects.filter(pk=old.pk).exists())

    def test_mixed_sales_use_existing_report_and_void_boundaries(self):
        booking=self.place();delivery=self.assign(booking)
        self.client.post(f'/api/deliveries/{delivery.pk}/complete/',{'payment_collected':'0','empty_collected':0},format='json')
        booking.refresh_from_db();self.auth(self.admin)
        sale=self.client.get(f'/api/sales/{booking.sale_id}/').data
        self.assertEqual(sale['total_amount'],'610.00');self.assertEqual(sale['items'][0]['total_amount'],'360.00')
        self.assertEqual(sale['accessory_items'][0]['total_amount'],'250.00')
        response=self.client.post(f'/api/sales/{booking.sale_id}/void/',{'reason':'Not a direct sale'},format='json')
        self.assertEqual(response.status_code,409)
        self.assertEqual(response.data['code'],'booking_sale')
        self.assertEqual(violations(),[])

    def test_seed_works_with_the_existing_0014_catalog_without_migrating(self):
        import os
        from unittest.mock import patch
        from django.core.management import call_command
        from django.db import connection
        with override_settings(DEBUG=True,ACCESSORIES_ENABLED=False), patch.dict(os.environ,{'GASBOOK_ENV':'development'}), patch('core.management.commands.seed_accessories.MigrationRecorder.applied_migrations', return_value={('core','0014_commerce_catalog_orders')}):
            call_command('seed_accessories',database_name=str(connection.settings_dict['NAME']),actor=self.admin.username,stdout=io.StringIO())
        self.assertEqual(Product.objects.filter(sku__startswith='DEMO-ACCESSORY-').count(),5)
        self.assertEqual(ProductMovement.objects.filter(reason='Development demo initial stock',booking__isnull=True).count(),5)
