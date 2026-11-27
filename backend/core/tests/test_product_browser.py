"""Opt-in full UI test. All traffic is routed to a disposable live test server."""
import json
import os
import subprocess
import unittest
from pathlib import Path
from django.core.management import call_command
from django.test import LiveServerTestCase, override_settings
from rest_framework_simplejwt.tokens import RefreshToken
from core.models import User, Role, CustomerProfile, StaffProfile, CylinderType, StockLocation, Stock, Booking, Product, Sale


@unittest.skipUnless(os.environ.get('RUN_INVENTORY_BROWSER') == '1','Opt-in browser acceptance')
@override_settings(DEBUG=True, CORS_ALLOW_ALL_ORIGINS=True)
class ProductBrowserTests(LiveServerTestCase):
    def test_existing_workflow_with_accessories(self):
        roles={code:Role.objects.create(code=code,name=code.title()) for code in ('admin','staff','customer')}
        users={code:User.objects.create_user(username=f'browser-{code}',first_name=f'Browser {code}',role=roles[code],phone='9000000001',address='12 Test Street') for code in roles}
        CustomerProfile.objects.create(user=users['customer']);StaffProfile.objects.create(user=users['staff'])
        cylinder=CylinderType.objects.create(name='5kg Cylinder',weight=5,selling_price=450,deposit_amount=450,refill_rate=360)
        shop=StockLocation.objects.create(name='Shop',code='shop');Stock.objects.create(cylinder_type=cylinder,location=shop,status='filled',quantity=10)
        from django.db import connection
        from unittest.mock import patch
        with patch.dict(os.environ,{'GASBOOK_ENV':'development'}):
            call_command('seed_accessories',database_name=str(connection.settings_dict['NAME']),actor=users['admin'].username,verbosity=0)
        tokens={}
        for key,user in users.items():
            refresh=RefreshToken.for_user(user);tokens[key]={'id':user.pk,'access':str(refresh.access_token),'refresh':str(refresh)}
        root=Path(__file__).resolve().parents[4]
        env={**os.environ,'INVENTORY_LIVE_URL':self.live_server_url,'INVENTORY_FIXTURES':json.dumps(tokens),'INVENTORY_IMAGE':str(root/'gasbook/backend/core/demo_products/regulator.png')}
        result=subprocess.run(['node','e2e/products-live.mjs'],cwd=root/'gasbook-customer',env=env,text=True,capture_output=True,timeout=180)
        self.assertEqual(result.returncode,0,result.stdout+'\n'+result.stderr)
        print(result.stdout)
        booking=Booking.objects.get();self.assertEqual(booking.order_items.count(),3)
        self.assertEqual(str(booking.final_amount),'1420.00');self.assertEqual(booking.status,'delivered')
        self.assertEqual(Sale.objects.count(),1);self.assertEqual(str(booking.sale.paid_amount),'1420.00')
        product=Product.objects.get(name='Browser regulator');self.assertEqual((product.stock,product.reserved),(5,0))
