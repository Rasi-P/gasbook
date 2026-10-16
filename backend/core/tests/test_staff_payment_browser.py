"""Real browser workflow using a disposable test DB; no development API writes."""
import json
import os
import subprocess
import unittest
from pathlib import Path
from django.test import LiveServerTestCase, override_settings
from rest_framework_simplejwt.tokens import RefreshToken
from core.models import Role, User, StaffProfile, CustomerProfile, StockLocation, Stock, CylinderType, Booking, Delivery, Product, ProductCategory, Sale, Payment

@unittest.skipUnless(os.environ.get('RUN_PAYMENT_BROWSER')=='1','Opt-in isolated payment browser test')
@override_settings(DEBUG=True, CORS_ALLOW_ALL_ORIGINS=True)
class StaffPaymentBrowserTests(LiveServerTestCase):
    def test_staff_delivery_collection_sale_and_customer_history(self):
        users={}
        for code in ['admin','staff','customer']:
            role=Role.objects.create(code=code,name=code.title())
            users[code]=User.objects.create_user(username=f'payment-{code}',first_name=f'Payment {code}',role=role,phone='9000000001',address='12 Test Street')
        staff=users['staff'];StaffProfile.objects.create(user=staff)
        customer=CustomerProfile.objects.create(user=users['customer'])
        cylinder=CylinderType.objects.create(name='5kg',weight=5,selling_price=450,deposit_amount=300,refill_rate=360)
        shop=StockLocation.objects.create(name='Shop',code='shop');Stock.objects.create(cylinder_type=cylinder,location=shop,status='filled',quantity=20)
        product=Product.objects.create(name='Test regulator',sku='BROWSER-PAY',selling_price=250,stock=10,category=ProductCategory.objects.create(name='Regulators'))
        booking=Booking.objects.create(customer=customer,cylinder_type=cylinder,quantity=1,rate_type='refill',deposit_unit_amount=0,refill_unit_amount=360,original_amount=360,final_amount=360,status='approved',assigned_staff=staff,delivery_address='12 Test Street',delivery_phone='9000000001',payment_method='COD')
        Delivery.objects.create(booking=booking,staff=staff,status='out_for_delivery')
        tokens={key:{'id':u.pk,'access':str(RefreshToken.for_user(u).access_token)} for key,u in users.items()}
        root=Path(__file__).resolve().parents[4]
        env={**os.environ,'PAYMENT_LIVE_URL':self.live_server_url,'PAYMENT_FIXTURES':json.dumps(tokens)}
        result=subprocess.run(['node','e2e/staff-payments-live.mjs'],cwd=root/'gasbook/frontend',env=env,text=True,capture_output=True,timeout=180)
        self.assertEqual(result.returncode,0,result.stdout+'\n'+result.stderr)
        print(result.stdout)
        booking.refresh_from_db();product.refresh_from_db()
        self.assertEqual(booking.status,'delivered');self.assertEqual(booking.sale.paid_amount,360)
        self.assertEqual(Sale.objects.count(),2);self.assertEqual(Payment.objects.count(),4)
        self.assertEqual(product.stock,9)
        self.assertFalse(Payment.objects.exclude(received_by=staff).exists())
