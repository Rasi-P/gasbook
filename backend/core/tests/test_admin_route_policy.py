"""Production AdminSite stays absent unless the dedicated demo opts in."""
import runpy
from concurrent.futures import ThreadPoolExecutor
from types import ModuleType
from unittest.mock import patch

from django.test import Client, SimpleTestCase, override_settings
from django.urls import Resolver404, resolve


class AdminRoutePolicyTests(SimpleTestCase):
    def urlconf(self, production):
        with override_settings(PRODUCTION=production):
            config = ModuleType('admin_policy_test_urls')
            config.urlpatterns = runpy.run_module('gasbook.urls')['urlpatterns']
            return config

    def test_production_admin_route_absent_for_all_attempts_and_forwarded_headers(self):
        config = self.urlconf(True)
        with override_settings(ROOT_URLCONF=config), patch('django.contrib.auth.authenticate', side_effect=AssertionError('No admin authentication in production')):
            for username in ('known', 'missing'):
                for address in ('127.0.0.1', '198.51.100.10'):
                    for _ in range(8):
                        result = Client().post('/admin/login/', {'username': username, 'password': 'synthetic-attempt'}, secure=True,
                                               REMOTE_ADDR=address, HTTP_X_FORWARDED_FOR='trusted-spoof')
                        self.assertEqual(result.status_code, 404)
            for path in ('/admin/', '/admin/login/', '/admin/core/user/'):
                with self.assertRaises(Resolver404):
                    resolve(path, urlconf=config)

    def test_concurrent_attempts_do_not_enable_route_or_affect_health(self):
        config = self.urlconf(True)
        with override_settings(ROOT_URLCONF=config):
            with ThreadPoolExecutor(max_workers=4) as pool:
                codes = list(pool.map(lambda _: Client().post('/admin/login/', {}, secure=True).status_code, range(12)))
            self.assertEqual(codes, [404] * 12)
            self.assertEqual(Client().get('/health/').status_code, 200)
            self.assertEqual(resolve('/api/auth/token/', urlconf=config).url_name, 'token_obtain_pair')

    def test_development_and_test_keep_admin_routes(self):
        config = self.urlconf(False)
        self.assertEqual(resolve('/admin/login/', urlconf=config).url_name, 'login')

    @override_settings(DEMO_DJANGO_ADMIN_ENABLED=True)
    def test_validated_demo_opt_in_registers_admin_routes(self):
        config = self.urlconf(True)
        self.assertEqual(resolve('/admin/login/', urlconf=config).url_name, 'login')
        self.assertEqual(resolve('/admin/', urlconf=config).url_name, 'index')
