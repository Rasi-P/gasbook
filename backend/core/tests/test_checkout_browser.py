"""Real PostgreSQL + Django + browser recovery; faults only simulate transport loss."""
import json
import os
import re
from pathlib import Path
import subprocess
import unittest
from django.test import LiveServerTestCase, override_settings
from rest_framework_simplejwt.tokens import RefreshToken
from core.models import Booking, CustomerProfile, CylinderType, Role, User


@unittest.skipUnless(os.environ.get('RUN_INVENTORY_BROWSER') == '1', 'Opt-in isolated checkout browser test')
@override_settings(DEBUG=True, CORS_ALLOW_ALL_ORIGINS=True, ACCESSORIES_ENABLED=False)
class CheckoutBrowserTests(LiveServerTestCase):
    def test_catalog_and_cylinder_checkout_recovery_across_layouts_and_reload(self):
        role = Role.objects.create(code='customer', name='Customer')
        user = User.objects.create_user(username='isolated-checkout', role=role, first_name='Synthetic Buyer',
                                        phone='9000000000', address='Synthetic browser address')
        CustomerProfile.objects.create(user=user)
        for index in range(1, 16):
            CylinderType.objects.create(name=f'{index}kg test cylinder', weight=index, selling_price=0,
                                        refill_rate=360, deposit_amount=450, is_active=index > 10)
        refresh = RefreshToken.for_user(user)
        root = Path(__file__).resolve().parents[4]
        env = {**os.environ, 'INVENTORY_LIVE_URL': self.live_server_url,
               'CHECKOUT_FIXTURE': json.dumps({'id': user.pk, 'access': str(refresh.access_token), 'refresh': str(refresh)})}
        result = subprocess.run(['node', 'e2e/checkout-live.mjs'], cwd=root/'gasbook-customer', env=env,
                                capture_output=True, text=True, timeout=180)
        # Browser transport diagnostics may include request Authorization headers.
        # Even these disposable fixture tokens must not appear in test reports.
        output = re.sub(r'(?i)Bearer\s+[A-Za-z0-9._~-]+', 'Bearer [redacted]', result.stdout + '\n' + result.stderr)
        self.assertEqual(result.returncode, 0, output)
        print(output)
        bookings = list(Booking.objects.order_by('pk'))
        self.assertEqual(len(bookings), 2)  # two distinct, acknowledged checkout intents
        self.assertEqual([booking.order_items.count() for booking in bookings], [2, 1])
        self.assertEqual([str(booking.final_amount) for booking in bookings], ['720.00', '360.00'])
