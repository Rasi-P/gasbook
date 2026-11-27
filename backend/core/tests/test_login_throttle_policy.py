from types import SimpleNamespace
from unittest.mock import patch
from django.core.cache import cache
from django.test import SimpleTestCase, override_settings
from core.authentication import LoginAccountThrottle, LoginIPThrottle


@override_settings(PRODUCTION=True)
class LoginThrottlePolicyTests(SimpleTestCase):
    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)

    def request(self, username='customer', ip='192.0.2.1', forwarded='203.0.113.1'):
        return SimpleNamespace(data={'username': username}, headers={'x-forwarded-for': forwarded},
                               META={'REMOTE_ADDR': ip, 'HTTP_X_FORWARDED_FOR': forwarded})

    def test_forged_forwarded_headers_do_not_change_ip_bucket(self):
        throttle = LoginIPThrottle()
        self.assertEqual(throttle.get_cache_key(self.request(forwarded='one'), None), throttle.get_cache_key(self.request(forwarded='two'), None))
        self.assertNotEqual(throttle.get_cache_key(self.request(ip='192.0.2.2'), None), throttle.get_cache_key(self.request(), None))

    def test_account_bucket_normalizes_username_and_is_independent_of_ip(self):
        throttle = LoginAccountThrottle()
        self.assertEqual(throttle.get_cache_key(self.request(' Customer '), None), throttle.get_cache_key(self.request('customer', ip='192.0.2.2'), None))
        self.assertNotIn('customer', throttle.get_cache_key(self.request(), None))

    def test_failed_login_budget_expires_without_permanent_account_lockout(self):
        with patch.object(LoginAccountThrottle, 'timer', return_value=100):
            for _ in range(10): self.assertTrue(LoginAccountThrottle().allow_request(self.request(), None))
            self.assertFalse(LoginAccountThrottle().allow_request(self.request(), None))
            self.assertTrue(LoginAccountThrottle().allow_request(self.request('other'), None))
        with patch.object(LoginAccountThrottle, 'timer', return_value=161):
            self.assertTrue(LoginAccountThrottle().allow_request(self.request(), None))
