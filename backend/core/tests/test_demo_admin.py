"""Demo AdminSite policy, request protection, and real disposable-DB authentication."""
from concurrent.futures import ThreadPoolExecutor
import os
import runpy
import secrets
import subprocess
import sys
from types import ModuleType
from unittest.mock import patch
from urllib.parse import urlencode

import dj_database_url
from django.conf import settings
from django.contrib import admin
from django.core.cache import cache
from django.core.exceptions import ImproperlyConfigured
from django.db import DatabaseError, OperationalError
from django.db.backends.postgresql.base import DatabaseWrapper
from django.test import Client, RequestFactory, SimpleTestCase, TestCase, override_settings
from rest_framework.test import APIClient

from core.admin_site import AdminLoginLimiter, GasBookAdminSite
from core.models import Role, User
from gasbook.environment import demo_django_admin_enabled


class DemoAdminConfigurationTests(SimpleTestCase):
    def config(self, **changes):
        options = {
            "production": True, "debug": False, "hosts": ["gasbook-demo-api.onrender.com"],
            "database": {
                "ENGINE": "django.db.backends.postgresql", "NAME": "neondb",
                "HOST": "ep-calm-shape-b3nzc13z.ap-southeast-1.aws.neon.tech",
                "OPTIONS": {"sslmode": "require"},
            },
            "uploads_disabled": True, "accessories_enabled": False,
        }
        options.update(changes)
        return demo_django_admin_enabled(**options)

    def test_default_is_disabled_even_on_demo_target(self):
        with patch.dict(os.environ, {"RENDER_SERVICE_ID": "srv-dbbk71tg1s2s7398rfag"}, clear=True):
            self.assertFalse(self.config())

    def test_only_explicit_demo_target_can_enable_admin(self):
        with patch.dict(os.environ, {
            "DEMO_DJANGO_ADMIN_ENABLED": "True", "RENDER_SERVICE_ID": "srv-dbbk71tg1s2s7398rfag",
        }, clear=True):
            self.assertTrue(self.config())
            for key, value in (
                ("production", False), ("debug", True), ("hosts", ["real-business.example.com"]),
                ("uploads_disabled", False), ("accessories_enabled", True),
            ):
                with self.subTest(setting=key), self.assertRaises(ImproperlyConfigured):
                    self.config(**{key: value})
            for database in (
                {"NAME": "other"}, {"NAME": "gasbook_qa"}, {"ENGINE": "django.db.backends.sqlite3"},
                {"HOST": "ep-another.neon.tech"}, {"HOST": "ep-calm-shape-b3nzc13z.attacker.example"},
                {"OPTIONS": {"sslmode": "disable"}},
            ):
                base = {
                    "ENGINE": "django.db.backends.postgresql", "NAME": "neondb",
                    "HOST": "ep-calm-shape-b3nzc13z.ap-southeast-1.aws.neon.tech",
                    "OPTIONS": {"sslmode": "require"},
                }
                base.update(database)
                with self.subTest(database_keys=list(database)), self.assertRaises(ImproperlyConfigured):
                    self.config(database=base)

    def test_flag_cannot_open_another_or_missing_render_service(self):
        for service in ("", "srv-another"):
            with self.subTest(service=service), patch.dict(os.environ, {
                "DEMO_DJANGO_ADMIN_ENABLED": "True", "RENDER_SERVICE_ID": service,
            }, clear=True), self.assertRaises(ImproperlyConfigured):
                self.config()

    def test_invalid_boolean_fails_closed(self):
        with patch.dict(os.environ, {"DEMO_DJANGO_ADMIN_ENABLED": "yes-please"}, clear=True):
            with self.assertRaises(ImproperlyConfigured):
                self.config()

    def database_url(self, query=None, pooled=False):
        endpoint = "ep-calm-shape-b3nzc13z" + ("-pooler" if pooled else "")
        return (
            f"postgresql://unused@{endpoint}.ap-southeast-1.aws.neon.tech/neondb?"
            + urlencode({"sslmode": "require", **(query or {})})
        )

    def test_approved_parsed_target_matches_actual_connection_parameters_without_connecting(self):
        with patch.dict(os.environ, {
            "DEMO_DJANGO_ADMIN_ENABLED": "True", "RENDER_SERVICE_ID": "srv-dbbk71tg1s2s7398rfag",
        }, clear=True), patch("socket.socket.connect", side_effect=AssertionError("No network")), \
                patch("django.db.backends.base.base.BaseDatabaseWrapper.ensure_connection",
                      side_effect=AssertionError("No database")):
            for pooled in (False, True):
                for tls in ("require", "verify-ca", "verify-full"):
                    options = {
                        "sslmode": tls, "channel_binding": "require", "connect_timeout": "5",
                        "application_name": "gasbook-demo",
                    }
                    if tls == "verify-full":
                        options["sslrootcert"] = "system"
                    database = dj_database_url.parse(self.database_url(options, pooled=pooled))
                    # Normally populated by Django's ConnectionHandler, which
                    # this deliberately unregistered/unconnected wrapper avoids.
                    database["TIME_ZONE"] = None
                    for port in ("", "5432", 5432):
                        database["PORT"] = port
                        with self.subTest(pooled=pooled, tls=tls, port=port):
                            self.assertTrue(self.config(database=database))
                            wrapper = DatabaseWrapper(database, alias="unconnected_guard_probe")
                            params = wrapper.get_connection_params()
                            self.assertIsNone(wrapper.connection)
                            self.assertEqual(params["dbname"], "neondb")
                            self.assertEqual(params["host"], database["HOST"])
                            self.assertEqual(str(params.get("port", 5432)), "5432")
                            self.assertEqual(params["sslmode"], tls)
                            self.assertNotIn("hostaddr", params)
                            self.assertNotIn("service", params)

    def test_url_query_overrides_and_unknown_options_are_rejected_without_leaking_values(self):
        with patch.dict(os.environ, {
            "DEMO_DJANGO_ADMIN_ENABLED": "True", "RENDER_SERVICE_ID": "srv-dbbk71tg1s2s7398rfag",
        }, clear=True):
            for key in (
                "dbname", "host", "hostaddr", "port", "service", "servicefile", "options",
                "user", "password", "passfile", "target_session_attrs", "load_balance_hosts",
                "future_unknown_option",
            ):
                with self.subTest(option=key):
                    database = dj_database_url.parse(self.database_url({key: "private-override-value"}))
                    with self.assertRaises(ImproperlyConfigured) as error:
                        self.config(database=database)
                    self.assertNotIn("private-override-value", str(error.exception))

    def test_libpq_environment_target_overrides_are_rejected(self):
        for variable in (
            "PGHOST", "PGHOSTADDR", "PGPORT", "PGDATABASE",
            "PGSERVICE", "PGSERVICEFILE", "PGSYSCONFDIR", "PGOPTIONS",
        ):
            with self.subTest(variable=variable), patch.dict(os.environ, {
                "DEMO_DJANGO_ADMIN_ENABLED": "True", "RENDER_SERVICE_ID": "srv-dbbk71tg1s2s7398rfag",
                variable: "private-override-value",
            }, clear=True), self.assertRaises(ImproperlyConfigured) as error:
                self.config()
            self.assertNotIn("private-override-value", str(error.exception))

    def test_alternate_ports_hosts_and_malformed_options_fail_closed(self):
        with patch.dict(os.environ, {
            "DEMO_DJANGO_ADMIN_ENABLED": "True", "RENDER_SERVICE_ID": "srv-dbbk71tg1s2s7398rfag",
        }, clear=True):
            for change in (
                {"PORT": 6432},
                {"HOST": "ep-calm-shape-b3nzc13z.other-region.aws.neon.tech"},
                {"HOST": "ep-calm-shape-b3nzc13z.ap-southeast-1.aws.neon.tech,other"},
                {"OPTIONS": None},
                {"OPTIONS": {"sslmode": "require", "connect_timeout": False}},
                {"OPTIONS": {"sslmode": "require", "channel_binding": "unknown"}},
                {"OPTIONS": {"sslmode": "require", "application_name": {"dbname": "other"}}},
            ):
                database = dj_database_url.parse(self.database_url())
                database.update(change)
                with self.subTest(changed_keys=list(change)), self.assertRaises(ImproperlyConfigured):
                    self.config(database=database)

    def test_real_settings_import_validates_demo_without_database_connection(self):
        env = {
            "PATH": os.environ.get("PATH", ""), "PYTHONDONTWRITEBYTECODE": "1",
            "GASBOOK_ENV": "production", "DEBUG": "False", "SECRET_KEY": secrets.token_urlsafe(64),
            "DATABASE_URL": "postgresql://unused@ep-calm-shape-b3nzc13z.ap-southeast-1.aws.neon.tech/neondb?sslmode=require",
            "ALLOWED_HOSTS": "gasbook-demo-api.onrender.com", "DEMO_DISABLE_UPLOADS": "True",
            "ACCESSORIES_ENABLED": "False", "DEMO_DJANGO_ADMIN_ENABLED": "True",
            "RENDER_SERVICE_ID": "srv-dbbk71tg1s2s7398rfag",
            "CORS_ALLOWED_ORIGINS": "https://admin.example.com",
            "CSRF_TRUSTED_ORIGINS": "https://admin.example.com",
        }
        code = (
            "import socket; from unittest.mock import patch; "
            "p=patch.object(socket.socket, 'connect', side_effect=AssertionError('No network allowed')); p.start(); "
            "from gasbook import settings; assert settings.DEMO_DJANGO_ADMIN_ENABLED; "
            "assert settings.PRODUCTION and not settings.DEBUG; "
            "assert settings.SECURE_SSL_REDIRECT and settings.SESSION_COOKIE_SECURE and settings.CSRF_COOKIE_SECURE"
        )
        for service, success in (("srv-dbbk71tg1s2s7398rfag", True), ("srv-non-demo-production", False)):
            env["RENDER_SERVICE_ID"] = service
            result = subprocess.run([sys.executable, "-B", "-c", code], cwd=settings.BASE_DIR,
                                    env=env, capture_output=True)
            self.assertEqual(result.returncode == 0, success)
        env["RENDER_SERVICE_ID"] = "srv-dbbk71tg1s2s7398rfag"
        for query in ({"dbname": "other"}, {"hostaddr": "192.0.2.1"}, {"service": "other"}):
            env["DATABASE_URL"] = self.database_url(query)
            result = subprocess.run([sys.executable, "-B", "-c", code], cwd=settings.BASE_DIR,
                                    env=env, capture_output=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn(b"DEMO_DJANGO_ADMIN_ENABLED is restricted", result.stderr)
        env["DATABASE_URL"] = self.database_url()
        env["PGSERVICE"] = "other"
        result = subprocess.run([sys.executable, "-B", "-c", code], cwd=settings.BASE_DIR,
                                env=env, capture_output=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(b"DEMO_DJANGO_ADMIN_ENABLED is restricted", result.stderr)


class AdminLoginLimiterTests(SimpleTestCase):
    def setUp(self):
        self.now = 1000
        self.limiter = AdminLoginLimiter(clock=lambda: self.now)
        self.factory = RequestFactory()

    def request(self, username="operator", peer="192.0.2.1", forwarded="203.0.113.1"):
        return self.factory.post("/admin/login/", {"username": username}, REMOTE_ADDR=peer,
                                 HTTP_X_FORWARDED_FOR=forwarded)

    def test_attempt_budget_and_expiry_do_not_extend_on_blocked_attempts(self):
        for _ in range(10):
            self.assertEqual(self.limiter.retry_after(self.request()), 0)
        self.assertEqual(self.limiter.retry_after(self.request()), 60)
        self.now += 59
        self.assertEqual(self.limiter.retry_after(self.request()), 1)
        self.now += 1
        self.assertEqual(self.limiter.retry_after(self.request()), 0)

    def test_forged_headers_and_case_changes_do_not_reset_budget(self):
        for _ in range(10):
            self.limiter.retry_after(self.request())
        self.assertGreater(self.limiter.retry_after(self.request(" OPERATOR ", forwarded="198.51.100.99")), 0)

    def test_ascii_and_full_width_usernames_share_one_bucket(self):
        variants = ("admin", "ａｄｍｉｎ", "ＡＤＭＩＮ", " ADMIN ")
        for i in range(10):
            self.assertEqual(self.limiter.retry_after(self.request(variants[i % len(variants)])), 0)
        for name in variants:
            self.assertGreater(self.limiter.retry_after(self.request(name)), 0)
        self.now += 60
        self.assertEqual(self.limiter.retry_after(self.request("ａｄｍｉｎ")), 0)

    def test_equivalent_usernames_cannot_overrun_concurrent_budget(self):
        variants = ("admin", "ａｄｍｉｎ", "ＡＤＭＩＮ", " ADMIN ")
        with ThreadPoolExecutor(max_workers=12) as pool:
            waits = list(pool.map(
                lambda i: self.limiter.retry_after(self.request(variants[i % len(variants)])), range(40)
            ))
        self.assertEqual(waits.count(0), 10)
        self.assertEqual(sum(wait > 0 for wait in waits), 30)

    def test_oversized_invalid_username_does_not_trigger_unbounded_normalization(self):
        oversized = "ａ" * (User._meta.get_field(User.USERNAME_FIELD).max_length + 1)
        request = self.request(oversized)
        with patch("django.contrib.auth.forms.unicodedata.normalize",
                   side_effect=AssertionError("Invalid overlength input needs no normalization")):
            self.assertEqual(self.limiter.retry_after(request), 0)

    def test_no_account_wide_lockout_across_socket_peers(self):
        for _ in range(10):
            self.limiter.retry_after(self.request())
        self.assertEqual(self.limiter.retry_after(self.request(peer="192.0.2.2")), 0)
        self.assertEqual(self.limiter.retry_after(self.request(username="another")), 0)

    def test_peer_budget_limits_username_rotation(self):
        for i in range(30):
            self.assertEqual(self.limiter.retry_after(self.request(username=f"name-{i}")), 0)
        self.assertGreater(self.limiter.retry_after(self.request(username="next-name")), 0)

    def test_global_budget_bounds_work_and_memory_with_rotating_names_and_peers(self):
        for i in range(60):
            self.assertEqual(self.limiter.retry_after(self.request(str(i), peer=f"192.0.2.{i}")), 0)
        for i in range(60, 300):
            self.assertGreater(self.limiter.retry_after(self.request(str(i), peer=f"198.51.100.{i}")), 0)
        self.assertLessEqual(len(self.limiter.buckets), 121)
        self.now += 60
        self.assertEqual(self.limiter.retry_after(self.request()), 0)
        self.assertEqual(len(self.limiter.buckets), 3)

    def test_concurrent_attempts_cannot_overrun_budget(self):
        with ThreadPoolExecutor(max_workers=12) as pool:
            waits = list(pool.map(lambda _: self.limiter.retry_after(self.request()), range(40)))
        self.assertEqual(waits.count(0), 10)
        self.assertEqual(sum(wait > 0 for wait in waits), 30)


@override_settings(
    PRODUCTION=True, DEMO_DJANGO_ADMIN_ENABLED=True, SECURE_SSL_REDIRECT=True,
    SESSION_COOKIE_SECURE=True, CSRF_COOKIE_SECURE=True,
    PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"],
    STORAGES={
        "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
        "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
    },
)
class DemoAdminAuthenticationTests(TestCase):
    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)
        urlconf = ModuleType("demo_admin_test_urls")
        urlconf.urlpatterns = runpy.run_module("gasbook.urls")["urlpatterns"]
        override = override_settings(ROOT_URLCONF=urlconf)
        override.enable()
        self.addCleanup(override.disable)
        limiter = patch("core.admin_site.login_limiter", AdminLoginLimiter())
        limiter.start()
        self.addCleanup(limiter.stop)
        self.password = secrets.token_urlsafe(24)
        role = Role.objects.create(code="admin", name="Admin")
        self.user = User.objects.create_superuser("demo-owner", password=self.password, role=role)

    def login(self, client=None, **changes):
        data = {"username": self.user.username, "password": self.password, "next": "/admin/"}
        data.update(changes)
        return (client or self.client).post("/admin/login/", data, secure=True)

    def test_registered_models_and_valid_superuser_login(self):
        self.assertIsInstance(admin.site, GasBookAdminSite)
        self.assertIn(User, admin.site._registry)
        response = self.login()
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response["Location"], "/admin/")
        self.assertTrue(response.cookies["sessionid"]["secure"])
        self.assertEqual(self.client.get("/admin/", secure=True).status_code, 200)
        self.assertEqual(self.client.get("/admin/core/user/", secure=True).status_code, 200)

    def test_temporary_password_is_rejected_without_creating_admin_session(self):
        self.user.must_change_password = True
        self.user.save(update_fields=["must_change_password"])
        response = self.login()
        self.assertContains(response, "Change your temporary password in the GasBook management app")
        self.assertNotIn("_auth_user_id", self.client.session)
        self.assertEqual(self.client.get("/admin/", secure=True).status_code, 302)

    def test_flagged_existing_session_cannot_read_or_write_model_views(self):
        self.client.force_login(self.user)
        self.user.must_change_password = True
        self.user.save(update_fields=["must_change_password"])
        for path in ("/admin/", "/admin/core/user/", "/admin/password_change/"):
            self.assertEqual(self.client.get(path, secure=True).status_code, 302)
        response = self.client.post("/admin/core/user/add/", {}, secure=True)
        self.assertEqual(response.status_code, 302)
        self.assertEqual(User.objects.count(), 1)

    def test_password_reset_invalidates_an_existing_admin_session(self):
        self.assertEqual(self.login().status_code, 302)
        self.user.set_password(secrets.token_urlsafe(24))
        self.user.save(update_fields=["password"])
        self.assertEqual(self.client.get("/admin/", secure=True).status_code, 302)
        self.assertNotIn("_auth_user_id", self.client.session)

    def test_admin_keeps_https_secure_csrf_and_static_assets(self):
        self.assertEqual(self.client.get("/admin/login/").status_code, 301)
        response = self.client.get("/admin/login/", secure=True)
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.cookies["csrftoken"]["secure"])
        response = self.client.get("/static/admin/css/base.css", secure=True)
        self.assertEqual(response.status_code, 200)
        self.assertIn("text/css", response["Content-Type"])
        self.assertTrue(b"".join(response.streaming_content))

    def test_inactive_or_nonstaff_account_is_not_admitted(self):
        for field in ("is_active", "is_staff"):
            User.objects.filter(pk=self.user.pk).update(**{field: False})
            self.assertEqual(self.login().status_code, 200)
            self.assertNotIn("_auth_user_id", self.client.session)
            User.objects.filter(pk=self.user.pk).update(**{field: True})

    def test_failed_logins_are_throttled_before_authentication_and_logs_are_redacted(self):
        with self.assertLogs("core.admin_site", level="WARNING") as logs:
            for _ in range(10):
                self.assertEqual(self.login(password="wrong-synthetic-password").status_code, 200)
            with patch("django.contrib.auth.forms.authenticate", side_effect=AssertionError("Must not authenticate")):
                response = self.login()
        self.assertEqual(response.status_code, 429)
        self.assertGreater(int(response["Retry-After"]), 0)
        self.assertIn("no-store", response["Cache-Control"])
        self.assertNotIn(self.password, " ".join(logs.output))
        self.assertNotIn(self.user.username, " ".join(logs.output))
        self.assertNotIn("wrong-synthetic-password", " ".join(logs.output))
        self.user.refresh_from_db()
        self.assertTrue(self.user.is_active)

    def test_full_width_admin_login_cannot_get_another_authentication_budget(self):
        self.user.username = "admin"
        self.user.save(update_fields=["username"])
        for _ in range(10):
            self.assertEqual(self.login(password="wrong-synthetic-password").status_code, 200)
        with patch("django.contrib.auth.forms.authenticate", side_effect=AssertionError("Budget exhausted")):
            self.assertEqual(self.login(username="ａｄｍｉｎ").status_code, 429)

    def test_csrf_is_required_and_untrusted_origins_stay_forbidden(self):
        client = Client(enforce_csrf_checks=True)
        self.assertEqual(self.login(client).status_code, 403)
        self.assertEqual(client.get("/admin/login/", secure=True).status_code, 200)
        token = client.cookies["csrftoken"].value
        data = {"username": self.user.username, "password": self.password, "csrfmiddlewaretoken": token}
        self.assertEqual(client.post("/admin/login/", data, secure=True,
                                     HTTP_ORIGIN="https://untrusted.invalid").status_code, 403)
        self.assertEqual(client.post("/admin/login/", data, secure=True,
                                     HTTP_ORIGIN="https://testserver").status_code, 302)

    def test_throttling_does_not_change_health_readiness_or_react_login(self):
        with patch("core.admin_site.login_limiter.retry_after", return_value=60):
            self.assertEqual(self.login().status_code, 429)
            self.assertEqual(self.client.get("/health/").status_code, 200)
            self.assertEqual(self.client.get("/ready/").status_code, 200)
            with patch("core.operations.connection.cursor", side_effect=OperationalError("private")):
                self.assertEqual(self.client.get("/health/").status_code, 200)
                response = self.client.get("/ready/")
                self.assertEqual(response.status_code, 503)
                self.assertNotContains(response, "private", status_code=503)
            api = APIClient()
            response = api.post("/api/auth/token/", {
                "username": self.user.username, "password": self.password, "client": "management",
            }, format="json", secure=True)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.data["role"], "admin")

    def test_react_password_change_unlocks_admin_and_revokes_old_token(self):
        self.assertEqual(self.login().status_code, 302)
        self.user.must_change_password = True
        self.user.save(update_fields=["must_change_password"])
        self.assertEqual(self.login().status_code, 200)
        api = APIClient()
        response = api.post("/api/auth/token/", {
            "username": self.user.username, "password": self.password, "client": "management",
        }, format="json", secure=True)
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["must_change_password"])
        token = response.data["access"]
        refresh = response.data["refresh"]
        api.credentials(HTTP_AUTHORIZATION="Bearer " + token)
        self.assertEqual(api.get("/api/auth/me/", secure=True).status_code, 200)
        self.assertEqual(api.get("/api/cylinder-types/", secure=True).status_code, 403)
        new_password = secrets.token_urlsafe(24)
        response = api.post("/api/auth/change-password/", {
            "current_password": self.password, "new_password": new_password, "confirm_new_password": new_password,
        }, format="json", secure=True)
        self.assertEqual(response.status_code, 200)
        replacement_access = response.data["access"]
        self.assertEqual(api.get("/api/auth/me/", secure=True).status_code, 401)
        self.assertEqual(api.post("/api/auth/token/refresh/", {"refresh": refresh},
                                  format="json", secure=True).status_code, 401)
        self.user.refresh_from_db()
        self.assertFalse(self.user.must_change_password)
        self.assertTrue(self.user.check_password(new_password))
        self.assertFalse(self.user.check_password(self.password))
        self.assertEqual(self.client.get("/admin/", secure=True).status_code, 302)
        self.assertNotIn("_auth_user_id", self.client.session)
        api.credentials(HTTP_AUTHORIZATION="Bearer " + replacement_access)
        self.assertEqual(api.get("/api/cylinder-types/", secure=True).status_code, 200)
        self.assertEqual(self.login(password=new_password).status_code, 302)
        self.assertEqual(self.client.get("/admin/", secure=True).status_code, 200)

    def password_change_client(self):
        api = APIClient()
        response = api.post("/api/auth/token/", {
            "username": self.user.username, "password": self.password, "client": "management",
        }, format="json", secure=True)
        self.assertEqual(response.status_code, 200)
        api.credentials(HTTP_AUTHORIZATION="Bearer " + response.data["access"])
        return api, response.data["refresh"]

    def test_reusing_password_preserves_hash_flag_and_tokens_without_unlocking_admin(self):
        for flagged in (True, False):
            with self.subTest(must_change_password=flagged):
                self.user.must_change_password = flagged
                self.user.save(update_fields=["must_change_password"])
                original_hash = self.user.password
                api, refresh = self.password_change_client()
                response = api.post("/api/auth/change-password/", {
                    "current_password": self.password, "new_password": self.password,
                    "confirm_new_password": self.password,
                }, format="json", secure=True)
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.data["code"], "password_reuse")
                self.assertNotIn("access", response.data)
                self.assertNotIn(self.password, str(response.data))
                self.user.refresh_from_db()
                self.assertEqual(self.user.password, original_hash)
                self.assertEqual(self.user.must_change_password, flagged)
                self.assertEqual(api.get("/api/auth/me/", secure=True).status_code, 200)
                self.assertEqual(api.post("/api/auth/token/refresh/", {"refresh": refresh},
                                          format="json", secure=True).status_code, 200)
                if flagged:
                    self.assertEqual(api.get("/api/cylinder-types/", secure=True).status_code, 403)
                    self.assertEqual(self.login().status_code, 200)
                    self.assertNotIn("_auth_user_id", self.client.session)

    def test_invalid_new_password_does_not_clear_required_change(self):
        self.user.must_change_password = True
        self.user.save(update_fields=["must_change_password"])
        original_hash = self.user.password
        api, _refresh = self.password_change_client()
        response = api.post("/api/auth/change-password/", {
            "current_password": self.password, "new_password": "123", "confirm_new_password": "123",
        }, format="json", secure=True)
        self.assertEqual(response.status_code, 400)
        self.user.refresh_from_db()
        self.assertEqual(self.user.password, original_hash)
        self.assertTrue(self.user.must_change_password)

    def test_failed_password_save_does_not_clear_persisted_required_change(self):
        self.user.must_change_password = True
        self.user.save(update_fields=["must_change_password"])
        original_hash = self.user.password
        api, _refresh = self.password_change_client()
        new_password = secrets.token_urlsafe(24)
        with patch.object(User, "save", side_effect=DatabaseError("Synthetic save failure")):
            with self.assertRaises(DatabaseError):
                api.post("/api/auth/change-password/", {
                    "current_password": self.password, "new_password": new_password,
                    "confirm_new_password": new_password,
                }, format="json", secure=True)
        self.user.refresh_from_db()
        self.assertEqual(self.user.password, original_hash)
        self.assertTrue(self.user.must_change_password)
        self.assertTrue(self.user.check_password(self.password))
