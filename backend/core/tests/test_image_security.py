"""Image parser boundaries, shared by APIs, Django admin and public media."""
from io import BytesIO
from pathlib import Path
import tempfile
from unittest.mock import patch

from django.contrib import admin
from django.core.exceptions import ValidationError
from django.core.files.uploadedfile import SimpleUploadedFile, TemporaryUploadedFile
from django.test import SimpleTestCase, override_settings
from PIL import Image, ImageFile
from rest_framework.exceptions import ValidationError as APIValidationError

from core.models import CylinderType, Product, ProductCategory, StaffProfile, User
from core.uploads import (
    ALLOWED_IMAGE_FORMATS, MAX_IMAGE_BYTES, SafeImageField, SafeImageFormField, inspect_image,
)
from .base import GasBookTestCase


def picture(fmt="PNG", size=(8, 6), **options):
    output = BytesIO()
    Image.new("RGB", size, "blue").save(output, fmt, **options)
    return output.getvalue()


def upload(data, fmt="PNG"):
    extension = {"JPEG": "jpg", "WEBP": "webp", "PNG": "png"}[fmt]
    return SimpleUploadedFile(f"photo.{extension}", data, content_type=f"image/{extension}")


def rejected_inputs():
    # An advisory-shaped XBM header must never reach Pillow's XBM parser.
    xbm = b"#define " + b" " * 100 + b"_width 1\r#define _height 1\r_bits"
    return [picture("GIF"), picture("BMP"), picture("TIFF"), b"<svg/>",
            b"%PDF-1.7", xbm, b"not an image"]


class ImageBoundaryTests(SimpleTestCase):
    def test_supported_formats_preserve_bytes_and_rewind_upload(self):
        for fmt in ALLOWED_IMAGE_FORMATS:
            for field in (SafeImageField(), SafeImageFormField()):
                with self.subTest(format=fmt, field=type(field).__name__):
                    data = picture(fmt)
                    value = upload(data, fmt)
                    result = field.run_validation(value) if isinstance(field, SafeImageField) else field.clean(value)
                    self.assertIs(result, value)
                    self.assertEqual(result.image.format, fmt)
                    self.assertEqual(result.image.size, (8, 6))
                    self.assertEqual(result.tell(), 0)
                    self.assertEqual(result.read(), data)

    def test_unsupported_formats_and_spoofed_names_never_reach_pillow(self):
        inputs = rejected_inputs()
        with patch("core.uploads.Image.open") as parser:
            for data in inputs:
                with self.subTest(prefix=data[:8]), self.assertRaises(APIValidationError):
                    SafeImageField().run_validation(upload(data))
            parser.assert_not_called()

    def test_every_pillow_open_has_an_explicit_decoder_allowlist(self):
        for fmt in ALLOWED_IMAGE_FORMATS:
            data = picture(fmt)
            with patch("core.uploads.Image.open", wraps=Image.open) as parser:
                inspect_image(data)
                self.assertEqual(parser.call_count, 2)
                for call in parser.call_args_list:
                    self.assertEqual(call.kwargs["formats"], [fmt])

    def test_oversized_upload_metadata_rejected_before_read_or_parse(self):
        value = upload(b"small")
        value.size = MAX_IMAGE_BYTES + 1
        with patch.object(value.file, "read") as read, patch("core.uploads.Image.open") as parser:
            with self.assertRaises(APIValidationError):
                SafeImageField().run_validation(value)
            read.assert_not_called()
            parser.assert_not_called()

    def test_bounded_read_does_not_trust_reported_size(self):
        value = upload(b"x" * (MAX_IMAGE_BYTES + 2))
        value.size = 1
        with patch.object(value.file, "read", wraps=value.file.read) as read, patch("core.uploads.Image.open") as parser:
            with self.assertRaises(APIValidationError):
                SafeImageField().run_validation(value)
            read.assert_called_once_with(MAX_IMAGE_BYTES + 1)
            parser.assert_not_called()

    def test_byte_limit_boundary(self):
        data = picture()
        data += b"\0" * (MAX_IMAGE_BYTES - len(data))
        self.assertEqual(inspect_image(data).format, "PNG")
        with patch("core.uploads.Image.open") as parser, self.assertRaises(ValueError):
            inspect_image(data + b"\0")
        parser.assert_not_called()

    def test_png_and_jpeg_dimensions_rejected_before_pixel_decode(self):
        for fmt in ("PNG", "JPEG"):
            for size in ((4097, 1), (1, 4097)):
                data = picture(fmt, size)
                with patch.object(ImageFile.ImageFile, "load") as decode:
                    with self.assertRaises(ValueError):
                        inspect_image(data)
                    decode.assert_not_called()
        self.assertEqual(inspect_image(picture(size=(4096, 1))).size, (4096, 1))

    def test_webp_canvas_rejected_before_native_decoder_creation(self):
        # Exercise simple lossy, simple lossless and extended-container headers.
        for options in ({}, {"lossless": True}, {"exif": b"test metadata"}):
            for size in ((4097, 1), (1, 4097)):
                data = picture("WEBP", size, **options)
                with patch("core.uploads.Image.open") as parser:
                    with self.assertRaises(ValueError):
                        inspect_image(data)
                    parser.assert_not_called()

    def test_supported_webp_container_variants_remain_accepted(self):
        for options in ({}, {"lossless": True}, {"exif": b"test metadata"}):
            self.assertEqual(inspect_image(picture("WEBP", **options)).size, (8, 6))

    def test_animated_png_and_webp_preserve_existing_support(self):
        for fmt in ("PNG", "WEBP"):
            data = picture(fmt, save_all=True, append_images=[Image.new("RGB", (8, 6), "red")], duration=100)
            self.assertEqual(inspect_image(data).size, (8, 6))

    def test_malformed_webp_header_rejected_before_pillow(self):
        for data in (b"RIFF\0\0\0\0WEBP", b"RIFF\0\0\0\0WEBPXXXX" + b"\0" * 20):
            with patch("core.uploads.Image.open") as parser, self.assertRaises(ValueError):
                inspect_image(data)
            parser.assert_not_called()

    def test_corrupt_and_truncated_supported_images_are_rejected(self):
        valid_png = picture()
        inputs = [b"", b"\x89PNG\r\n\x1a\ninvalid", b"\xff\xd8\xffinvalid",
                  valid_png[:-12], valid_png[:35] + b"broken" + valid_png[41:],
                  picture("JPEG")[:-10], picture("WEBP")[:-8]]
        for data in inputs:
            with self.subTest(prefix=data[:10]), self.assertRaises(APIValidationError):
                SafeImageField().run_validation(upload(data))

    def test_decompression_bomb_exceptions_are_validation_errors(self):
        data = picture()
        for error in (Image.DecompressionBombError, Image.DecompressionBombWarning):
            with patch("core.uploads.Image.open", side_effect=error("internal diagnostic")):
                with self.assertRaises(APIValidationError) as caught:
                    SafeImageField().run_validation(upload(data))
                self.assertNotIn("internal diagnostic", str(caught.exception))

    def test_disk_backed_upload_and_optional_clear(self):
        data = picture("JPEG")
        value = TemporaryUploadedFile("photo.jpg", "image/jpeg", len(data), None)
        try:
            value.write(data)
            self.assertIs(SafeImageField().run_validation(value), value)
            self.assertEqual(value.read(), data)
        finally:
            value.close()
        self.assertIsNone(SafeImageField(required=False, allow_null=True).run_validation(None))

    def test_django_admin_uses_safe_fields_for_cylinder_and_staff(self):
        for model in (CylinderType, StaffProfile):
            field = admin.site._registry[model].formfield_for_dbfield(model._meta.get_field("image"), None)
            self.assertIsInstance(field, SafeImageFormField)
            self.assertEqual(field.clean(upload(picture())).image.format, "PNG")
            with patch("core.uploads.Image.open") as parser, self.assertRaises(ValidationError):
                field.clean(upload(b"#define invalid XBM"))
            parser.assert_not_called()

    def test_public_media_serves_supported_formats_in_all_image_directories(self):
        with tempfile.TemporaryDirectory() as root, override_settings(MEDIA_ROOT=root, DEBUG=False):
            for directory in ("cylinder-images", "staff-images", "product-images"):
                folder = Path(root) / directory
                folder.mkdir()
                for fmt in ALLOWED_IMAGE_FORMATS:
                    data = picture(fmt)
                    (folder / "photo.png").write_bytes(data)
                    response = self.client.get(f"/media/{directory}/photo.png")
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(b"".join(response.streaming_content), data)
                    self.assertEqual(response["Content-Type"], Image.MIME[fmt])

    def test_public_media_rejects_unsupported_oversized_and_malformed_content(self):
        inputs = rejected_inputs() + [b"x" * (MAX_IMAGE_BYTES + 1)]
        with tempfile.TemporaryDirectory() as root, override_settings(MEDIA_ROOT=root, DEBUG=False):
            folder = Path(root) / "cylinder-images"
            folder.mkdir()
            for data in inputs:
                (folder / "bad.png").write_bytes(data)
                with patch("core.uploads.Image.open") as parser:
                    self.assertEqual(self.client.get("/media/cylinder-images/bad.png").status_code, 404)
                    parser.assert_not_called()
            for data in (picture()[:-12], picture(size=(4097, 1))):
                (folder / "bad.png").write_bytes(data)
                self.assertEqual(self.client.get("/media/cylinder-images/bad.png").status_code, 404)


@override_settings(ACCESSORIES_ENABLED=True)
class ImageUploadAPITests(GasBookTestCase):
    def setUp(self):
        super().setUp()
        root = tempfile.TemporaryDirectory()
        self.addCleanup(root.cleanup)
        setting = override_settings(MEDIA_ROOT=root.name)
        setting.enable()
        self.addCleanup(setting.disable)
        self.auth(self.admin)
        category = ProductCategory.objects.create(name="Test category")
        self.product = Product.objects.create(name="Existing product", category=category, selling_price=10, sku="IMAGE-TEST")

    def test_supported_cylinder_staff_and_product_create_and_update(self):
        for index, fmt in enumerate(ALLOWED_IMAGE_FORMATS):
            data = picture(fmt)
            cylinder = self.client.post("/api/cylinder-types/", {
                "name": f"Image cylinder {index}", "weight": "5", "deposit_amount": "10", "refill_rate": "20",
                "image": upload(data, fmt)}, format="multipart")
            self.assertEqual(cylinder.status_code, 201, cylinder.data)
            staff = self.client.post("/api/auth/register/", {
                "username": f"image-staff-{index}", "phone": f"800000000{index}", "role": "staff",
                "image": upload(data, fmt)}, format="multipart")
            self.assertEqual(staff.status_code, 201, staff.data)
            product = self.client.post("/api/products/", {
                "name": f"Image product {index}", "category": "Test category", "selling_price": "10",
                "image": upload(data, fmt)}, format="multipart")
            self.assertEqual(product.status_code, 201, product.data)
            records = (
                (f"/api/cylinder-types/{cylinder.data['id']}/", CylinderType.objects.get(pk=cylinder.data['id'])),
                (f"/api/auth/users/{staff.data['id']}/", StaffProfile.objects.get(user_id=staff.data['id'])),
                (f"/api/products/{product.data['id']}/", Product.objects.get(pk=product.data['id'])),
            )
            replacement = picture(fmt, size=(7, 5))
            for endpoint, record in records:
                with record.image.open("rb") as stored:
                    self.assertEqual(stored.read(), data)
                response = self.client.patch(endpoint, {"image": upload(replacement, fmt)}, format="multipart")
                self.assertEqual(response.status_code, 200, response.data)
                record.refresh_from_db()
                with record.image.open("rb") as stored:
                    self.assertEqual(stored.read(), replacement)

    def test_bad_uploads_do_not_update_cylinders_staff_or_products(self):
        inputs = rejected_inputs() + [picture(size=(4097, 1)), b"x" * (MAX_IMAGE_BYTES + 1), picture("JPEG")[:-10]]
        for data in inputs:
            for endpoint, fields in (
                (f"/api/cylinder-types/{self.cylinder.pk}/", {"name": "Must roll back"}),
                (f"/api/auth/users/{self.staff_a.pk}/", {"full_name": "Must roll back"}),
                (f"/api/products/{self.product.pk}/", {"name": "Must roll back"}),
            ):
                response = self.client.patch(endpoint, {**fields, "image": upload(data)}, format="multipart")
                self.assertEqual(response.status_code, 400, response.data)
        self.cylinder.refresh_from_db()
        self.staff_a.refresh_from_db()
        self.product.refresh_from_db()
        self.assertNotEqual(self.cylinder.name, "Must roll back")
        self.assertNotEqual(self.staff_a.get_full_name(), "Must roll back")
        self.assertNotEqual(self.product.name, "Must roll back")

    def test_unsupported_upload_does_not_create_business_records(self):
        before = (CylinderType.objects.count(), User.objects.count(), Product.objects.count())
        for endpoint, fields in (
            ("/api/cylinder-types/", {"name": "Bad image", "weight": "5", "deposit_amount": "10", "refill_rate": "20"}),
            ("/api/auth/register/", {"username": "bad-image-staff", "phone": "8000000099", "role": "staff"}),
            ("/api/products/", {"name": "Bad image", "category": "Test category", "selling_price": "10"}),
        ):
            with patch("core.uploads.Image.open") as parser:
                response = self.client.post(endpoint, {**fields, "image": upload(b"#define invalid XBM")}, format="multipart")
                self.assertEqual(response.status_code, 400, response.data)
                parser.assert_not_called()
        self.assertEqual((CylinderType.objects.count(), User.objects.count(), Product.objects.count()), before)
