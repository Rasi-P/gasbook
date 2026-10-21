from io import BytesIO
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from cryptography.fernet import Fernet
from django.core.exceptions import ImproperlyConfigured
from django.core.files.base import ContentFile
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import transaction
from django.test import SimpleTestCase, override_settings
from PIL import Image

from core.media_storage import ImageKitStorage, MediaUnavailable, NAMESPACE
from core.models import Product, ProductCategory, StaffProfile
from gasbook.environment import media_configuration, demo_django_admin_enabled
from .base import GasBookTestCase


def picture(fmt="PNG"):
    stream = BytesIO()
    Image.new("RGB", (3, 3), "blue").save(stream, format=fmt)
    return stream.getvalue()


def upload():
    return SimpleUploadedFile("image.png", picture(), content_type="image/png")


REMOTE_SETTINGS = dict(MEDIA_ENCRYPTION_KEY=Fernet.generate_key().decode(),
    IMAGEKIT_PRIVATE_KEY="synthetic-unused", IMAGEKIT_URL_ENDPOINT="https://ik.imagekit.io/synthetic",
    DEMO_DISABLE_UPLOADS=False)


class FullDemoConfigurationTests(SimpleTestCase):
    def test_storage_configuration_fails_closed(self):
        base = dict(RENDER_SERVICE_ID="srv-dbbk71tg1s2s7398rfag")
        with patch.dict(os.environ, base, clear=True):
            self.assertEqual(media_configuration(production=True, disabled=True), "disabled")
            with self.assertRaises(ImproperlyConfigured):
                media_configuration(production=True, disabled=False)
        configured = {**base, "MEDIA_STORAGE_BACKEND": "imagekit", **{
            key: value for key, value in REMOTE_SETTINGS.items() if isinstance(value, str)}}
        with patch.dict(os.environ, configured, clear=True):
            self.assertEqual(media_configuration(production=True, disabled=False), "imagekit")
            self.assertFalse(demo_django_admin_enabled(production=True, debug=False,
                database={"ENGINE": "django.db.backends.postgresql", "NAME": "neondb",
                    "HOST": "ep-calm-shape-b3nzc13z.c-4.ap-southeast-1.aws.neon.tech", "OPTIONS": {"sslmode": "require"}},
                hosts=["gasbook-demo-api.onrender.com"], uploads_disabled=False, accessories_enabled=True)
)  # default off even with fully configured media
            for key, bad in [("IMAGEKIT_PRIVATE_KEY", ""), ("MEDIA_ENCRYPTION_KEY", "invalid"),
                             ("IMAGEKIT_URL_ENDPOINT", "https://attacker.invalid/endpoint"),
                             ("MEDIA_STORAGE_BACKEND", "unknown")]:
                with self.subTest(key=key), patch.dict(os.environ, {key: bad}), self.assertRaises(ImproperlyConfigured):
                    media_configuration(production=True, disabled=False)
        with patch.dict(os.environ, {**configured, "DEMO_DJANGO_ADMIN_ENABLED": "True"}, clear=True):
            for accessories in (False, True):
                self.assertTrue(demo_django_admin_enabled(production=True, debug=False,
                    database={"ENGINE": "django.db.backends.postgresql", "NAME": "neondb",
                        "HOST": "ep-calm-shape-b3nzc13z.c-4.ap-southeast-1.aws.neon.tech", "OPTIONS": {"sslmode": "require"}},
                    hosts=["gasbook-demo-api.onrender.com"], uploads_disabled=False, accessories_enabled=accessories))


@override_settings(**REMOTE_SETTINGS)
class RemoteStorageTests(SimpleTestCase):
    def setUp(self):
        self.storage = ImageKitStorage()
        self.client = MagicMock()
        self.client.__enter__.return_value = self.client
        def result(**kwargs):
            return SimpleNamespace(file_id="a" * 24, file_path=kwargs["folder"] + "/" + kwargs["file_name"], is_private_file=True)
        self.client.files.upload.side_effect = result
        patcher = patch.object(self.storage, "client", return_value=self.client)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_all_formats_upload_with_unique_names_and_validated_private_objects(self):
        names = []
        for fmt in ("PNG", "JPEG", "WEBP"):
            name = self.storage.save("product-images/input.png", ContentFile(picture(fmt)))
            names.append(name)
            self.assertLessEqual(len(name), 100)
            call = self.client.files.upload.call_args.kwargs
            self.assertTrue(call["is_private_file"])
            self.assertFalse(call["overwrite_file"])
            self.assertEqual(call["file"], picture(fmt))
            self.assertEqual(self.storage.url(name), "/media/" + name)
        self.assertEqual(len(set(names)), 3)

    def test_staff_bytes_are_encrypted_even_if_provider_delivery_policy_is_wrong(self):
        name = self.storage.save("staff-images/input.png", ContentFile(picture()))
        encrypted = self.client.files.upload.call_args.kwargs["file"]
        self.assertNotIn(picture(), encrypted)
        self.assertEqual(self.storage.cipher().decrypt(encrypted), picture())
        self.assertTrue(name.endswith(".bin"))

    def test_bad_oversize_or_unsupported_inputs_never_reach_provider(self):
        for data in (b"<svg/>", b"bad", b"x" * (5 * 1024 * 1024 + 1), picture("GIF")):
            with self.assertRaises(ValueError):
                self.storage.save("product-images/input.png", ContentFile(data))
        self.client.files.upload.assert_not_called()

    def test_provider_auth_quota_and_timeout_errors_are_redacted(self):
        for status in (401, 403, 429, 507, 503):
            error = RuntimeError("secret-provider-response")
            error.status_code = status
            self.client.files.upload.side_effect = error
            with self.assertRaises(MediaUnavailable) as caught:
                self.storage.save("product-images/input.png", ContentFile(picture()))
            self.assertNotIn("secret-provider-response", str(caught.exception))
        self.client.files.upload.side_effect = TimeoutError("secret-timeout")
        with self.assertRaises(MediaUnavailable):
            self.storage.save("staff-images/input.png", ContentFile(picture()))

    def read(self, name, data, status=200):
        prefix, _, filename = self.storage._parts(name)
        self.client.helper.build_url.return_value = REMOTE_SETTINGS["IMAGEKIT_URL_ENDPOINT"] + NAMESPACE + "/" + prefix + "/" + filename + "?ik-s=synthetic"
        http = MagicMock()
        http.__enter__.return_value = http
        response = MagicMock(status_code=status)
        response.__enter__.return_value = response
        response.iter_bytes.return_value = [data]
        http.stream.return_value = response
        with patch("core.media_storage.httpx.Client", return_value=http):
            return self.storage.open(name).read()

    def test_retrieval_decrypts_staff_and_survives_new_storage_instance(self):
        for prefix in ("staff-images", "cylinder-images"):
            name = self.storage.save(prefix + "/input.png", ContentFile(picture()))
            data = self.client.files.upload.call_args.kwargs["file"]
            self.assertEqual(self.read(name, data), picture())
            self.assertEqual(ImageKitStorage().url(name), "/media/" + name)

    def test_bad_signature_response_redirect_corruption_and_limits_fail_closed(self):
        name = self.storage.save("staff-images/input.png", ContentFile(picture()))
        for data in (picture(), b"corrupt", b"x" * 8000000):
            with self.assertRaises(MediaUnavailable):
                self.read(name, data)
        self.client.helper.build_url.return_value = "https://attacker.invalid/image"
        with patch("core.media_storage.httpx.Client") as http, self.assertRaises(MediaUnavailable):
            self.storage.open(name)
        http.assert_not_called()

    def test_delete_uses_stored_id_and_legacy_names_never_guess_provider_objects(self):
        name = self.storage.save("product-images/input.png", ContentFile(picture()))
        self.storage.delete(name)
        self.client.files.delete.assert_called_once_with("a" * 24)
        self.assertEqual(self.storage.url("staff-images/legacy.png"), "/media/staff-images/legacy.png")
        with self.assertRaises(FileNotFoundError):
            self.storage.open("staff-images/legacy.png")
        with self.assertRaises(FileNotFoundError):
            self.storage.delete("product-images/../../other.png")


@override_settings(ACCESSORIES_ENABLED=True, DEMO_DISABLE_UPLOADS=False)
class MediaWorkflowTests(GasBookTestCase):
    def setUp(self):
        super().setUp()
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        config = override_settings(MEDIA_ROOT=self.directory.name)
        config.enable()
        self.addCleanup(config.disable)

    def test_staff_profile_write_is_admin_only_and_cannot_reassign(self):
        path = f"/api/staff-profiles/{self.staff_a_profile.pk}/"
        for user in (self.staff_a, self.staff_b, self.customer_user):
            self.auth(user)
            self.assertEqual(self.client.patch(path, {"image": upload()}, format="multipart").status_code, 403)
        self.auth(self.admin)
        self.assertEqual(self.client.patch(path, {"user": self.staff_b.pk}, format="json").status_code, 400)
        self.assertEqual(self.client.patch(path, {"image": SimpleUploadedFile("bad.svg", b"<svg/>")}, format="multipart").status_code, 400)
        self.assertEqual(self.client.patch(path, {"image": upload()}, format="multipart").status_code, 200)

    def test_private_staff_media_checks_owner_admin_and_password_change(self):
        profile = self.staff_a_profile
        profile.image.save("private.png", ContentFile(picture()))
        path = "/media/" + profile.image.name
        self.auth(None)
        self.assertEqual(self.client.get(path).status_code, 404)
        for user in (self.customer_user, self.staff_b):
            self.auth(user)
            self.assertEqual(self.client.get(path).status_code, 404)
        for user in (self.staff_a, self.admin):
            self.auth(user)
            response = self.client.get(path)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response["Cache-Control"], "private, no-store")
            self.assertEqual(b"".join(response.streaming_content), picture())
        self.staff_a.must_change_password = True
        self.auth(self.staff_a)
        self.assertEqual(self.client.get(path).status_code, 404)

    def test_authorized_staff_media_preserves_all_supported_formats(self):
        self.auth(self.staff_a)
        for fmt in ("PNG", "JPEG", "WEBP"):
            self.staff_a_profile.image.save("staff-photo.png", ContentFile(picture(fmt)))
            response = self.client.get("/media/" + self.staff_a_profile.image.name)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(b"".join(response.streaming_content), picture(fmt))
            self.assertEqual(response["Content-Type"], Image.MIME[fmt])

    def test_product_replace_remove_and_failed_upload_keep_old_image_until_commit(self):
        self.auth(self.admin)
        response = self.client.post("/api/products/", {"name": "Synthetic", "category": "Test", "selling_price": "20", "initial_stock": 3, "image": upload()}, format="multipart")
        self.assertEqual(response.status_code, 201, response.data)
        product = Product.objects.get(pk=response.data["id"])
        old = product.image.path
        with patch("django.core.files.storage.FileSystemStorage._save", side_effect=MediaUnavailable()):
            failed = self.client.patch(f"/api/products/{product.pk}/", {"image": upload()}, format="multipart")
        self.assertEqual(failed.status_code, 503)
        product.refresh_from_db()
        self.assertEqual(product.image.path, old)
        with self.captureOnCommitCallbacks(execute=True):
            response = self.client.patch(f"/api/products/{product.pk}/", {"remove_image": True}, format="json")
            self.assertTrue(Path(old).exists())
        self.assertEqual(response.status_code, 200)
        self.assertFalse(Path(old).exists())

    def test_cleanup_failure_does_not_turn_success_into_unknown_order_or_image_result(self):
        category = ProductCategory.objects.create(name="Synthetic")
        product = Product.objects.create(name="Photo", category=category, selling_price=10, image=upload())
        self.auth(self.admin)
        with patch("django.core.files.storage.FileSystemStorage.delete", side_effect=MediaUnavailable()), self.assertLogs("core.media_lifecycle", level="WARNING"), self.captureOnCommitCallbacks(execute=True):
            response = self.client.patch(f"/api/products/{product.pk}/", {"remove_image": True}, format="json")
        self.assertEqual(response.status_code, 200)
        product.refresh_from_db()
        self.assertFalse(product.image)

    def test_transaction_rollback_does_not_delete_original(self):
        profile = self.staff_a_profile
        profile.image.save("keep.png", ContentFile(picture()))
        old = profile.image.path
        with self.captureOnCommitCallbacks(execute=True):
            try:
                with transaction.atomic():
                    profile.image = None
                    profile.save()
                    raise ValueError("rollback")
            except ValueError:
                pass
        self.assertTrue(Path(old).exists())
        profile.refresh_from_db()
        self.assertTrue(profile.image)

    def test_me_reports_capabilities_and_disabled_products_remain_guarded(self):
        self.auth(self.admin)
        self.assertEqual(self.client.get("/api/auth/me/").data["capabilities"], {"accessories": True, "image_uploads": True})
        with override_settings(ACCESSORIES_ENABLED=False, DEMO_DISABLE_UPLOADS=True):
            self.assertEqual(self.client.get("/api/auth/me/").data["capabilities"], {"accessories": False, "image_uploads": False})
            self.assertEqual(self.client.post("/api/products/", {}, format="json").status_code, 503)


@override_settings(**REMOTE_SETTINGS)
class ImageKitSDKContractTests(SimpleTestCase):
    def test_real_sdk_upload_and_signing_contract_without_network(self):
        import httpx
        from imagekitio import ImageKit
        observed = []
        def handle(request):
            observed.append(request)
            self.assertEqual(request.method, "POST")
            self.assertIn(request.url.host, {"upload.imagekit.io", "api.imagekit.io"})
            self.assertIn(b'isPrivateFile', request.content)
            self.assertIn(b'overwriteFile', request.content)
            return httpx.Response(200, json={"fileId": "a" * 24,
                "filePath": "/gasbook-demo/staff-images/" + "b" * 32 + ".bin", "isPrivateFile": True}, request=request)
        client = ImageKit(private_key="synthetic-unused", http_client=httpx.Client(transport=httpx.MockTransport(handle)), max_retries=0)
        storage = ImageKitStorage()
        with patch.object(storage, "client", return_value=client), patch("core.media_storage.uuid.uuid4", return_value=SimpleNamespace(hex="b" * 32)):
            name = storage.save("staff-images/test.png", ContentFile(picture()))
        self.assertEqual(name, "staff-images/" + "a" * 24 + "/" + "b" * 32 + ".bin")
        self.assertEqual(len(observed), 1)
        with ImageKit(private_key="synthetic-unused", http_client=httpx.Client(transport=httpx.MockTransport(handle))) as signer:
            url = signer.helper.build_url(url_endpoint=REMOTE_SETTINGS["IMAGEKIT_URL_ENDPOINT"], src="/gasbook-demo/product-images/photo.png", signed=True, expires_in=60)
        from urllib.parse import urlsplit, parse_qs
        parsed = urlsplit(url)
        self.assertEqual(parsed.path, "/synthetic/gasbook-demo/product-images/photo.png")
        self.assertIn("ik-s", parse_qs(parsed.query))
        self.assertIn("ik-t", parse_qs(parsed.query))

    def test_provider_status_timeout_and_redirect_fail_without_local_fallback(self):
        import httpx
        storage = ImageKitStorage()
        name = "cylinder-images/" + "a" * 24 + "/" + "b" * 32 + ".png"
        signer = MagicMock()
        signer.__enter__.return_value = signer
        signer.helper.build_url.return_value = REMOTE_SETTINGS["IMAGEKIT_URL_ENDPOINT"] + "/gasbook-demo/cylinder-images/" + "b" * 32 + ".png?ik-s=synthetic"
        real_client = httpx.Client
        for status in (301, 302, 401, 403, 429, 500, 507):
            def handle(request):
                return httpx.Response(status, text="secret-provider-body", headers={"location": "https://attacker.invalid"}, request=request)
            with self.subTest(status=status), patch.object(storage, "client", return_value=signer), patch("core.media_storage.httpx.Client", return_value=real_client(transport=httpx.MockTransport(handle))):
                with self.assertRaises(MediaUnavailable) as caught:
                    storage.open(name)
                self.assertNotIn("secret-provider-body", str(caught.exception))
        with patch.object(storage, "client", return_value=signer), patch("core.media_storage.httpx.Client", side_effect=httpx.TimeoutException("private-timeout")), self.assertRaises(MediaUnavailable):
            storage.open(name)
