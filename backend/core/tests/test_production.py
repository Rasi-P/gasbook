"""Production configuration and behavior, using disposable databases/files only."""
import io
import os
from pathlib import Path
import secrets
import subprocess
import sys
import tempfile
from unittest.mock import patch

from django.conf import settings
from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import connection, OperationalError
from django.test import Client, SimpleTestCase, TestCase, override_settings
from PIL import Image
from rest_framework_simplejwt.tokens import RefreshToken

from core.models import User, Role, CylinderType
from .base import GasBookTestCase, PASSWORD


def png():
    output = io.BytesIO()
    Image.new("RGB", (2, 2), "blue").save(output, format="PNG")
    return output.getvalue()


class ProductionConfigurationTests(SimpleTestCase):
    def config(self, **changes):
        env = {"PATH": os.environ.get("PATH", ""), "PYTHONDONTWRITEBYTECODE": "1",
               "GASBOOK_ENV": "production", "DEBUG": "False", "SECRET_KEY": secrets.token_urlsafe(64),
               "DATABASE_URL": "postgresql://unused@127.0.0.1:1/config_only",
               "ALLOWED_HOSTS": "api.example.com", "MEDIA_ROOT": "/var/data/media",
               "CORS_ALLOWED_ORIGINS": "https://admin.example.com,https://customer.example.com",
               "CSRF_TRUSTED_ORIGINS": "https://api.example.com,https://admin.example.com,https://customer.example.com"}
        for key, value in changes.items():
            if value is None:
                env.pop(key, None)
            else:
                env[key] = value
        return subprocess.run([sys.executable, "-B", "-c", "from gasbook import settings; assert settings.PRODUCTION; assert not settings.DEBUG; assert settings.SESSION_COOKIE_SECURE and settings.CSRF_COOKIE_SECURE; assert settings.SECURE_PROXY_SSL_HEADER; assert settings.STORAGES['staticfiles']['BACKEND'].endswith('CompressedManifestStaticFilesStorage')"],
                              cwd=settings.BASE_DIR, env=env, capture_output=True)

    def test_valid_production_configuration_never_connects_to_database(self):
        self.assertEqual(self.config().returncode, 0)

    def test_invalid_production_configuration_fails_closed(self):
        for key, value in [("GASBOOK_ENV", "prod-typo"), ("DEBUG", "True"), ("DEBUG", "typo"),
                           ("SECRET_KEY", None), ("SECRET_KEY", "short"), ("DATABASE_URL", None),
                           ("DATABASE_URL", "sqlite:///:memory:"), ("DATABASE_URL", "invalid"),
                           ("ALLOWED_HOSTS", "*"), ("ALLOWED_HOSTS", ""), ("MEDIA_ROOT", "media"),
                           ("CORS_ALLOWED_ORIGINS", "http://localhost:5173"), ("CSRF_TRUSTED_ORIGINS", ""),
                           ("CSRF_TRUSTED_ORIGINS", "https://*.vercel.app")]:
            with self.subTest(setting=key):
                self.assertNotEqual(self.config(**{key: value}).returncode, 0)

    def test_missing_environment_selects_production(self):
        self.assertNotEqual(self.config(GASBOOK_ENV=None, SECRET_KEY=None).returncode, 0)


class OperationalEndpointTests(TestCase):
    @override_settings(SECURE_PROXY_SSL_HEADER=('HTTP_X_FORWARDED_PROTO', 'https'),
                       CSRF_TRUSTED_ORIGINS=['https://admin.example.com', 'https://customer.example.com'])
    def test_admin_csrf_accepts_explicit_origins_and_rejects_untrusted_origin(self):
        client = Client(enforce_csrf_checks=True)
        client.get('/admin/login/', HTTP_X_FORWARDED_PROTO='https')
        token = client.cookies['csrftoken'].value
        for origin in settings.CSRF_TRUSTED_ORIGINS:
            response = client.post('/admin/login/', {'csrfmiddlewaretoken': token, 'username': 'missing', 'password': 'incorrect'},
                                   HTTP_ORIGIN=origin, HTTP_X_FORWARDED_PROTO='https')
            self.assertEqual(response.status_code, 200)
        response = client.post('/admin/login/', {'csrfmiddlewaretoken': token}, HTTP_ORIGIN='https://untrusted.example.com', HTTP_X_FORWARDED_PROTO='https')
        self.assertEqual(response.status_code, 403)

    def test_readiness_requires_database_and_applied_migrations(self):
        self.assertEqual(self.client.get('/health/').json(), {"status": "ok"})
        self.assertEqual(self.client.get('/ready/').json(), {"status": "ready"})
        with patch('core.operations.MigrationRecorder.applied_migrations', return_value={}):
            response = self.client.get('/ready/')
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()['reason'], 'migrations_pending')

    def test_database_failure_does_not_leak_exception(self):
        with patch('core.operations.connection.cursor', side_effect=OperationalError('private diagnostic')):
            response = self.client.get('/ready/')
            self.assertEqual(self.client.get('/health/').status_code, 200)
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json(), {"status": "not_ready", "reason": "database_unavailable"})
        self.assertEqual(response['Cache-Control'], 'no-store')

    @override_settings(SECURE_SSL_REDIRECT=True, SECURE_PROXY_SSL_HEADER=('HTTP_X_FORWARDED_PROTO', 'https'),
                       CORS_ALLOWED_ORIGINS=['https://admin.example.com', 'https://customer.example.com'])
    def test_proxy_https_and_both_frontend_preflights(self):
        self.assertEqual(self.client.get('/api/cylinder-types/').status_code, 301)
        self.assertEqual(self.client.get('/health/').status_code, 200)
        self.assertEqual(self.client.get('/health/', HTTP_X_FORWARDED_PROTO='https').status_code, 200)
        for origin in settings.CORS_ALLOWED_ORIGINS:
            response = self.client.options('/api/cylinder-types/', HTTP_X_FORWARDED_PROTO='https', HTTP_ORIGIN=origin,
                HTTP_ACCESS_CONTROL_REQUEST_METHOD='GET', HTTP_ACCESS_CONTROL_REQUEST_HEADERS='authorization')
            self.assertEqual(response['Access-Control-Allow-Origin'], origin)
        response = self.client.options('/api/cylinder-types/', HTTP_ORIGIN='https://untrusted.example.com', HTTP_ACCESS_CONTROL_REQUEST_METHOD='GET')
        self.assertNotIn('Access-Control-Allow-Origin', response)

    @override_settings(SECURE_SSL_REDIRECT=True, SECURE_PROXY_SSL_HEADER=('HTTP_X_FORWARDED_PROTO', 'https'))
    def test_http_readiness_cannot_pass_via_redirect(self):
        for headers in ({}, {'HTTP_X_FORWARDED_PROTO': 'http'}, {'HTTP_X_FORWARDED_PROTO': 'https'}):
            response = self.client.get('/ready/', **headers)
            self.assertEqual(response.status_code, 200)
            self.assertNotIn('Location', response)
            with patch('core.operations.MigrationRecorder.applied_migrations', return_value={}):
                response = self.client.get('/ready/', **headers)
            self.assertEqual(response.status_code, 503)
            self.assertEqual(response.json()['reason'], 'migrations_pending')
            self.assertNotIn('Location', response)
            with patch('core.operations.connection.cursor', side_effect=OperationalError('private')):
                response = self.client.get('/ready/', **headers)
                self.assertEqual(self.client.get('/health/', **headers).status_code, 200)
            self.assertEqual(response.status_code, 503)
            self.assertEqual(response.json()['reason'], 'database_unavailable')
            self.assertNotIn('Location', response)

    @override_settings(SECURE_SSL_REDIRECT=True, SECURE_PROXY_SSL_HEADER=('HTTP_X_FORWARDED_PROTO', 'https'))
    def test_only_exact_probe_paths_are_exempt_from_https(self):
        for path in ('/api/cylinder-types/', '/admin/login/', '/media/staff-images/test.png',
                     '/ready', '/ready/extra', '/health/extra', '/prefix/ready/'):
            response = self.client.get(path)
            self.assertEqual(response.status_code, 301, path)
            self.assertTrue(response['Location'].startswith('https://'))
        self.assertEqual(self.client.post('/ready/').status_code, 405)


class ProductionMediaTests(SimpleTestCase):
    def test_media_serving_works_with_debug_off_and_rejects_unsafe_files(self):
        with tempfile.TemporaryDirectory() as root, override_settings(MEDIA_ROOT=root, DEBUG=False):
            folder = Path(root) / 'staff-images'
            folder.mkdir()
            (folder / 'valid.png').write_bytes(png())
            (folder / 'bad.png').write_text('<script>unsafe()</script>')
            (folder / 'bad.svg').write_text('<svg/>')
            (Path(root) / 'private.txt').write_text('private')
            response = self.client.get('/media/staff-images/valid.png')
            self.assertEqual(response.status_code, 200)
            self.assertEqual(b''.join(response.streaming_content), png())
            self.assertEqual(response['Content-Type'], 'image/png')
            self.assertEqual(response['X-Content-Type-Options'], 'nosniff')
            for path in ['staff-images/bad.png', 'staff-images/bad.svg', 'private.txt', 'staff-images/../../private.txt', 'staff-images/missing.png']:
                self.assertEqual(self.client.get('/media/' + path).status_code, 404)
            (folder / 'outside.png').symlink_to(Path(root).parent / 'outside-phaseb.png')
            self.assertEqual(self.client.get('/media/staff-images/outside.png').status_code, 404)


class StaffUploadSecurityTests(GasBookTestCase):
    def test_staff_upload_limits_match_cylinder_upload_limits(self):
        self.auth(self.admin)
        wide = io.BytesIO()
        Image.new('RGB', (4097, 1)).save(wide, format='PNG')
        for data in [wide.getvalue(), png() + b'\0' * (5 * 1024 * 1024)]:
            response = self.client.patch(f'/api/auth/users/{self.staff_a.pk}/',
                {'image': SimpleUploadedFile('invalid-size.png', data, content_type='image/png')}, format='multipart')
            self.assertEqual(response.status_code, 400)

    def test_invalid_uploads_are_rejected_before_profile_changes(self):
        self.auth(self.admin)
        bad = SimpleUploadedFile('bad.png', b'<script>unsafe()</script>', content_type='image/png')
        response = self.client.patch(f'/api/auth/users/{self.staff_a.pk}/', {'image': bad, 'full_name': 'Must Roll Back'}, format='multipart')
        self.assertEqual(response.status_code, 400)
        self.staff_a.refresh_from_db()
        self.assertNotEqual(self.staff_a.get_full_name(), 'Must Roll Back')
        response = self.client.post('/api/auth/register/', {'username': 'bad-upload', 'phone': '9998887771', 'role': 'staff',
            'image': SimpleUploadedFile('bad.svg', b'<svg/>', content_type='image/svg+xml')}, format='multipart')
        self.assertEqual(response.status_code, 400)
        self.assertFalse(User.objects.filter(username='bad-upload').exists())

    def test_valid_upload_uses_shared_image_validation(self):
        with tempfile.TemporaryDirectory() as root, override_settings(MEDIA_ROOT=root):
            self.auth(self.admin)
            response = self.client.patch(f'/api/auth/users/{self.staff_a.pk}/',
                {'image': SimpleUploadedFile('valid.png', png(), content_type='image/png')}, format='multipart')
            self.assertEqual(response.status_code, 200)
            self.assertTrue((Path(root) / 'staff-images/valid.png').exists())


class AuthenticationSecurityTests(GasBookTestCase):
    def test_admin_reset_revokes_the_users_access_and_refresh(self):
        old = RefreshToken.for_user(self.staff_a)
        self.auth(self.admin)
        response = self.client.post(f'/api/auth/users/{self.staff_a.pk}/credentials/', {}, format='json')
        self.assertEqual(response.status_code, 200)
        self.client.force_authenticate(None)
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {old.access_token}')
        self.assertEqual(self.client.get('/api/auth/me/').status_code, 401)
        self.client.credentials()
        self.assertEqual(self.client.post('/api/auth/token/refresh/', {'refresh': str(old)}, format='json').status_code, 401)

    def test_password_change_revokes_access_and_refresh_and_issues_replacements(self):
        token = RefreshToken.for_user(self.staff_a)
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {token.access_token}')
        new_password = secrets.token_urlsafe(24)
        response = self.client.post('/api/auth/change-password/', {'current_password': PASSWORD, 'new_password': new_password,
            'confirm_new_password': new_password}, format='json')
        self.assertEqual(response.status_code, 200)
        replacements = response.json()
        self.assertEqual(self.client.get('/api/auth/me/').status_code, 401)
        self.client.credentials()
        self.assertEqual(self.client.post('/api/auth/token/refresh/', {'refresh': str(token)}, format='json').status_code, 401)
        self.assertEqual(self.client.post('/api/auth/token/refresh/', {'refresh': replacements['refresh']}, format='json').status_code, 200)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {replacements['access']}")
        self.assertEqual(self.client.get('/api/auth/me/').status_code, 200)

    @override_settings(PRODUCTION=True)
    def test_production_login_is_throttled(self):
        cache.clear()
        try:
            for _ in range(10):
                response = self.client.post('/api/auth/token/', {'username': 'missing-user', 'password': 'incorrect'}, format='json')
                self.assertEqual(response.status_code, 401)
            response = self.client.post('/api/auth/token/', {'username': 'missing-user', 'password': 'incorrect'}, format='json')
            self.assertEqual(response.status_code, 429)
            self.assertIn('Retry-After', response)
        finally:
            cache.clear()


class BootstrapSecurityTests(TestCase):
    def test_demo_seed_is_blocked_before_writes(self):
        with override_settings(GASBOOK_ENV='production', DEBUG=False), self.assertRaises(CommandError):
            call_command('seed_demo', stdout=io.StringIO())
        self.assertFalse(Role.objects.exists())
        self.assertFalse(User.objects.exists())

    def test_bootstrap_creates_roles_and_one_admin_without_business_data(self):
        password = secrets.token_urlsafe(32)
        output = io.StringIO()
        options = {'database_name': connection.settings_dict['NAME'], 'username': 'first-owner', 'email': 'owner@example.com', 'stdout': output}
        with patch('core.management.commands.bootstrap_admin.getpass', return_value=password):
            call_command('bootstrap_admin', **options)
            with self.assertRaises(CommandError):
                call_command('bootstrap_admin', **{**options, 'username': 'second-owner'})
        user = User.objects.get(username='first-owner')
        self.assertTrue(user.is_superuser and user.is_staff and user.check_password(password))
        self.assertEqual(user.role.code, 'admin')
        self.assertEqual(user.plain_password, '')
        self.assertEqual(Role.objects.count(), 3)
        self.assertFalse(CylinderType.objects.exists())
        self.assertNotIn(password, output.getvalue())

    def test_bootstrap_rejects_wrong_database_confirmation(self):
        with self.assertRaises(CommandError):
            call_command('bootstrap_admin', database_name='wrong-target', username='owner', email='owner@example.com')
        self.assertFalse(User.objects.exists())
