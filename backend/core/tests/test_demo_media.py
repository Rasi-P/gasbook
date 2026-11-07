"""The free demo needs no upload storage and never writes image bytes."""
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace
import os
import secrets
import subprocess
import sys
import tempfile
from unittest.mock import patch

from django.conf import settings
from django.core.exceptions import PermissionDenied, ValidationError
from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import OperationalError
from django.test import SimpleTestCase, override_settings
from PIL import Image
from rest_framework.exceptions import ValidationError as APIValidationError
from rest_framework.test import APIRequestFactory

from core.demo_media import DEMO_IMAGE_MESSAGE, DisabledMediaStorage
from core.models import CylinderType, Product, ProductCategory, Role, StaffProfile, User
from core.products import ProductInput, ProductSerializer
from core.serializers import CylinderTypeSerializer
from core.uploads import SafeImageField, SafeImageFormField, validated_image
from core.views import get_staff_image_url, serialize_me


def image_upload():
    return SimpleUploadedFile("demo.png", b"not-decoded", content_type="image/png")


class DemoConfigurationTests(SimpleTestCase):
    def test_production_demo_starts_without_media_root_but_keeps_security(self):
        env = {
            "PATH": os.environ.get("PATH", ""), "PYTHONDONTWRITEBYTECODE": "1",
            "GASBOOK_ENV": "production", "DEBUG": "False",
            "SECRET_KEY": secrets.token_urlsafe(64),
            "DATABASE_URL": "postgresql://unused@127.0.0.1:1/config_only",
            "ALLOWED_HOSTS": "api.example.com",
            "CORS_ALLOWED_ORIGINS": "https://admin.example.com,https://customer.example.com",
            "CSRF_TRUSTED_ORIGINS": "https://admin.example.com,https://customer.example.com",
            "DEMO_DISABLE_UPLOADS": "True",
        }
        code = """
from gasbook import settings as s
assert s.DEMO_DISABLE_UPLOADS and not s.MEDIA_ROOT
assert s.STORAGES['default']['BACKEND'] == 'core.demo_media.DisabledMediaStorage'
assert s.STORAGES['staticfiles']['BACKEND'].endswith('CompressedManifestStaticFilesStorage')
assert s.PRODUCTION and not s.DEBUG and s.SECURE_SSL_REDIRECT
assert s.SESSION_COOKIE_SECURE and s.CSRF_COOKIE_SECURE
assert s.DATABASES['default']['ENGINE'] == 'django.db.backends.postgresql'
"""
        def run(values):
            return subprocess.run([sys.executable, "-B", "-c", code],
                                  cwd=settings.BASE_DIR, env=values, capture_output=True)
        self.assertEqual(run(env).returncode, 0)
        for value in ("False", "invalid"):
            self.assertNotEqual(run({**env, "DEMO_DISABLE_UPLOADS": value}).returncode, 0)
        for key in ("SECRET_KEY", "DATABASE_URL", "ALLOWED_HOSTS", "CORS_ALLOWED_ORIGINS", "CSRF_TRUSTED_ORIGINS"):
            self.assertNotEqual(run({k: v for k, v in env.items() if k != key}).returncode, 0, key)
        self.assertNotEqual(run({**env, "DEBUG": "True"}).returncode, 0)
        self.assertNotEqual(run({**env, "DATABASE_URL": "sqlite:///:memory:"}).returncode, 0)


@override_settings(DEMO_DISABLE_UPLOADS=True, STORAGES={
    "default": {"BACKEND": "core.demo_media.DisabledMediaStorage"},
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage"},
})
class DemoMediaTests(SimpleTestCase):
    def test_shared_api_and_form_upload_validation_rejects_before_parsing(self):
        with patch("core.uploads.Image.open") as parser:
            for validate, error in (
                (SafeImageField().run_validation, APIValidationError),
                (SafeImageFormField().clean, ValidationError),
                (validated_image, APIValidationError),
            ):
                with self.assertRaises(error) as caught:
                    validate(image_upload())
                self.assertIn(DEMO_IMAGE_MESSAGE, str(caught.exception))
            parser.assert_not_called()

    def test_cylinder_and_product_api_input_rejects_images(self):
        for serializer in (
            CylinderTypeSerializer(data={"name": "Demo", "weight": "5", "image": image_upload()}),
            ProductInput(data={"name": "Demo", "category": "Demo", "selling_price": "10", "image": image_upload()}),
        ):
            self.assertFalse(serializer.is_valid())
            self.assertIn(DEMO_IMAGE_MESSAGE, str(serializer.errors["image"]))

    def test_no_image_remains_valid_and_existing_file_references_are_not_served(self):
        self.assertIsNone(SafeImageField(required=False, allow_null=True).run_validation(None))
        field = CylinderTypeSerializer().fields["image"]
        self.assertIsNone(field.to_representation(SimpleNamespace(url="https://unused.invalid/old.png")))
        product = Product(name="Demo", category=ProductCategory(name="Demo"), selling_price=10,
                          image="product-images/pre-existing.png")
        self.assertIsNone(ProductSerializer(product).data["image"])

    def test_staff_image_and_profile_response_use_existing_placeholder_contract(self):
        user = User(username="demo-staff", role=Role(code="staff"), phone="0000000000")
        user.staff_profile = StaffProfile(user=user, image="staff-images/pre-existing.png")
        request = APIRequestFactory().get("/api/auth/me/")
        request.user = user
        self.assertIsNone(get_staff_image_url(request, user))
        self.assertIsNone(serialize_me(request)["staff_image_url"])

    def test_storage_refuses_direct_uploads_and_never_deletes_existing_files(self):
        self.assertIsInstance(default_storage, DisabledMediaStorage)
        with tempfile.TemporaryDirectory() as root:
            existing = Path(root) / "existing.png"
            existing.write_bytes(b"keep this existing file")
            with self.assertRaises(PermissionDenied):
                default_storage.save("cylinder-images/new.png", ContentFile(b"fake"))
            default_storage.delete(str(existing))
            self.assertEqual(existing.read_bytes(), b"keep this existing file")
            self.assertFalse(default_storage.exists(str(existing)))
            with self.assertRaises(FileNotFoundError):
                default_storage.open(str(existing))
            with self.assertRaises(ValueError):
                default_storage.url(str(existing))

    def test_media_routes_fail_closed_without_touching_the_filesystem(self):
        with patch("core.operations.Path") as path:
            for prefix in ("cylinder-images", "staff-images", "product-images", ".."):
                self.assertEqual(self.client.get(f"/media/{prefix}/photo.png").status_code, 404)
                self.assertEqual(self.client.head(f"/media/{prefix}/photo.png").status_code, 404)
            path.assert_not_called()

    @override_settings(SECURE_SSL_REDIRECT=True)
    def test_health_readiness_and_application_https_policy_are_preserved(self):
        self.assertEqual(self.client.get("/health/").status_code, 200)
        with patch("core.operations.connection") as database:
            database.cursor.side_effect = OperationalError("private")
            response = self.client.get("/ready/")
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["reason"], "database_unavailable")
        self.assertNotIn("Location", response)
        for path in ("/api/cylinder-types/", "/media/cylinder-images/photo.png", "/admin/login/"):
            self.assertEqual(self.client.get(path).status_code, 301)

    @override_settings(DEMO_DISABLE_UPLOADS=False)
    def test_normal_image_validation_and_urls_remain_available_outside_demo(self):
        data = BytesIO()
        Image.new("RGB", (2, 2), "blue").save(data, format="PNG")
        upload = SimpleUploadedFile("photo.png", data.getvalue(), content_type="image/png")
        self.assertIs(validated_image(upload), upload)
        self.assertEqual(SafeImageField().to_representation(SimpleNamespace(url="/media/cylinder-images/photo.png")),
                         "/media/cylinder-images/photo.png")
