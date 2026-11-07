"""Quality-first processing, random media names, disk readiness and immutable caching."""
from io import BytesIO
import logging
from pathlib import Path
import random
import tempfile
from unittest.mock import patch

from django.core.exceptions import SuspiciousFileOperation
from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
from django.core.files.uploadedfile import SimpleUploadedFile
from django.http import HttpResponse
from django.test import Client, RequestFactory, SimpleTestCase, override_settings
from PIL import Image, ImageChops, ImageCms, ImageStat

from core import image_processing
from core.image_processing import CONVERT_MIN_BYTES, MAX_RMS_ERROR, prepare_image
from core.media_filesystem import MediaFileSystemStorage
from core.media_lifecycle import request_uploads
from core.models import CylinderType, Product, ProductCategory, StaffProfile

from .base import GasBookTestCase


def encode(image, image_format, **options):
    output = BytesIO()
    image.save(output, image_format, **options)
    return output.getvalue()


def decode(data):
    image = Image.open(BytesIO(data))
    image.load()
    return image


def photo(size=(900, 900), seed=7):
    """Smooth gradients with mild deterministic noise: compresses like a rendered product photo."""
    width, height = size
    ramp = Image.linear_gradient("L").resize(size)
    noise = Image.frombytes("L", size, random.Random(seed).randbytes(width * height)).point(lambda v: v // 40)
    return Image.merge("RGB", [
        ImageChops.add(ramp, noise),
        ImageChops.add(ramp.transpose(Image.Transpose.FLIP_TOP_BOTTOM), noise),
        ImageChops.add(ramp.transpose(Image.Transpose.FLIP_LEFT_RIGHT), noise),
    ])


def rms_error(a, b):
    return max(ImageStat.Stat(ImageChops.difference(a.convert("RGB"), b.convert("RGB"))).rms)


def exif_with(**tags):
    exif = Image.Exif()
    for tag, value in tags.items():
        exif[int(tag.removeprefix("t"), 16)] = value
    return exif


class PrepareImageTests(SimpleTestCase):
    def test_small_clean_images_are_kept_byte_for_byte(self):
        picture = photo((300, 200))
        for image_format, extension in (("JPEG", "jpg"), ("PNG", "png"), ("WEBP", "webp")):
            with self.subTest(image_format):
                data = encode(picture, image_format)
                self.assertEqual(prepare_image(data, "product-images"), (data, extension))

    def test_processed_output_is_stable_so_quality_never_degrades_by_repetition(self):
        sources = {
            "oversized jpeg": encode(photo((2400, 1600)), "JPEG", quality=95),
            "rotated jpeg": encode(photo((300, 200)), "JPEG", exif=exif_with(t0112=6)),
            "large opaque png": encode(photo(), "PNG"),
            "oversized png": encode(photo((1800, 1800)), "PNG"),
        }
        for label, data in sources.items():
            with self.subTest(label):
                once = prepare_image(data, "product-images")
                self.assertEqual(prepare_image(once[0], "product-images"), once)

    def test_oversized_images_shrink_to_their_category_keeping_aspect_ratio(self):
        data = encode(photo((2400, 1600)), "JPEG")
        for category, expected in (("product-images", (1200, 800)), ("cylinder-images", (1200, 800)), ("staff-images", (500, 333))):
            with self.subTest(category):
                out, extension = prepare_image(data, category)
                self.assertEqual(extension, "jpg")
                self.assertEqual(decode(out).size, expected)

    def test_a_small_overshoot_is_not_resampled(self):
        within = encode(photo((1250, 1250)), "JPEG")
        self.assertEqual(prepare_image(within, "product-images"), (within, "jpg"))
        self.assertEqual(decode(prepare_image(encode(photo((1400, 1400)), "JPEG"), "product-images")[0]).size, (1200, 1200))

    def test_exif_rotation_is_applied_and_metadata_removed(self):
        data = encode(photo((300, 200)), "JPEG", exif=exif_with(t0112=6, t010F="Camera"))
        out, _ = prepare_image(data, "staff-images")
        image = decode(out)
        self.assertEqual(image.size, (200, 300))
        self.assertEqual(len(image.getexif()), 0)

    def test_metadata_only_jpeg_is_rewritten_without_visible_loss_or_growth(self):
        picture = photo((600, 400))
        data = encode(picture, "JPEG", quality=90, exif=exif_with(t010F="Camera"))
        out, extension = prepare_image(data, "product-images")
        self.assertEqual(extension, "jpg")
        self.assertEqual(len(decode(out).getexif()), 0)
        self.assertLessEqual(len(out), len(data) * 1.1)
        self.assertLess(rms_error(decode(data), decode(out)), 1.5)

    def test_resized_jpegs_get_the_intended_quality_whatever_the_source_quality(self):
        intended = decode(encode(photo((64, 48)), "JPEG", quality=image_processing.JPEG_QUALITY)).quantization
        for source_quality in (50, 75, 95):
            with self.subTest(source_quality):
                data = encode(photo((2400, 1600)), "JPEG", quality=source_quality)
                self.assertEqual(decode(prepare_image(data, "product-images")[0]).quantization, intended)

    def test_metadata_only_rewrites_keep_the_source_quality_tables(self):
        for mode in ("RGB", "L"):
            with self.subTest(mode):
                data = encode(photo((600, 400)).convert(mode), "JPEG", quality=70, exif=exif_with(t010F="Camera"))
                out, _ = prepare_image(data, "product-images")
                self.assertEqual(decode(out).quantization, decode(data).quantization)
                self.assertEqual(len(decode(out).getexif()), 0)

    def test_colour_profile_survives_processing(self):
        profile = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes()
        data = encode(photo((2400, 1600)), "JPEG", icc_profile=profile)
        self.assertEqual(decode(prepare_image(data, "product-images")[0]).info.get("icc_profile"), profile)

    def test_large_opaque_png_becomes_webp_without_visible_loss(self):
        picture = photo()
        data = encode(picture, "PNG")
        self.assertGreater(len(data), CONVERT_MIN_BYTES)
        out, extension = prepare_image(data, "product-images")
        self.assertEqual(extension, "webp")
        self.assertLessEqual(len(out), len(data) * 0.6)
        converted = decode(out)
        self.assertEqual(converted.size, picture.size)
        self.assertLessEqual(rms_error(picture, converted), MAX_RMS_ERROR)

    def test_png_stays_when_webp_would_visibly_change_it(self):
        noise = Image.frombytes("RGB", (400, 400), random.Random(3).randbytes(400 * 400 * 3))
        data = encode(noise, "PNG")
        self.assertGreater(len(data), CONVERT_MIN_BYTES)
        self.assertEqual(prepare_image(data, "product-images"), (data, "png"))

    def test_large_transparent_png_is_only_ever_converted_losslessly(self):
        picture = photo().convert("RGBA")
        mask = Image.new("L", picture.size, 0)
        mask.paste(255, (100, 100, 800, 800))
        picture.putalpha(mask)
        data = encode(picture, "PNG")
        self.assertGreater(len(data), CONVERT_MIN_BYTES)
        out, extension = prepare_image(data, "product-images")
        result = decode(out).convert("RGBA")
        self.assertEqual(result.getchannel("A").tobytes(), picture.getchannel("A").tobytes())
        if extension == "webp":
            self.assertLess(len(out), len(data))
            self.assertEqual(rms_error(
                Image.alpha_composite(Image.new("RGBA", picture.size, "white"), picture),
                Image.alpha_composite(Image.new("RGBA", picture.size, "white"), result)), 0)
        else:
            self.assertEqual(out, data)

    def test_oversized_transparent_and_palette_pngs_keep_their_transparency(self):
        rgba = photo((2400, 1600)).convert("RGBA")
        rgba.putalpha(Image.linear_gradient("L").resize(rgba.size))
        palette = Image.new("P", (1800, 1800), 0)
        palette.putpalette([255, 0, 0] * 256)
        for label, data in (("rgba", encode(rgba, "PNG")), ("palette", encode(palette, "PNG", transparency=0))):
            with self.subTest(label):
                out, extension = prepare_image(data, "product-images")
                image = decode(out).convert("RGBA")
                self.assertLessEqual(max(image.size), 1200)
                self.assertLess(image.getchannel("A").getextrema()[0], 255)

    def test_animations_are_never_flattened(self):
        frames = [photo((1500, 1500), seed=seed) for seed in (1, 2)]
        webp = encode(frames[0], "WEBP", save_all=True, append_images=frames[1:], duration=100)
        png = encode(frames[0], "PNG", save_all=True, append_images=frames[1:], duration=100)
        for data, extension in ((webp, "webp"), (png, "png")):
            with self.subTest(extension):
                self.assertEqual(prepare_image(data, "product-images"), (data, extension))

    def test_greyscale_and_cmyk_jpegs_are_processed(self):
        grey = encode(photo((2400, 1600)).convert("L"), "JPEG")
        cmyk = encode(photo((2400, 1600)).convert("CMYK"), "JPEG")
        self.assertEqual(decode(prepare_image(grey, "product-images")[0]).size, (1200, 800))
        self.assertEqual(decode(prepare_image(cmyk, "product-images")[0]).mode, "RGB")

    def test_invalid_images_are_rejected(self):
        for data in (b"", b"not an image", encode(photo((8, 6)), "GIF")):
            with self.subTest(data[:8]), self.assertRaises(ValueError):
                prepare_image(data, "product-images")

    def test_a_processing_failure_keeps_the_validated_original(self):
        data = encode(photo((2400, 1600)), "JPEG")
        with patch.object(image_processing, "_prepare", side_effect=RuntimeError("boom")), \
                self.assertLogs("core.image_processing", logging.WARNING):
            self.assertEqual(prepare_image(data, "product-images"), (data, "jpg"))


class MediaFileSystemStorageTests(SimpleTestCase):
    def setUp(self):
        root = tempfile.TemporaryDirectory()
        self.addCleanup(root.cleanup)
        setting = override_settings(MEDIA_ROOT=root.name)
        setting.enable()
        self.addCleanup(setting.disable)
        self.root = Path(root.name)
        self.storage = MediaFileSystemStorage()

    def save(self, folder, data, filename="Passport Photo.png"):
        return self.storage.save(self.storage.generate_filename(f"{folder}/{filename}"), ContentFile(data))

    def test_names_are_random_and_do_not_keep_the_uploaded_filename(self):
        name = self.save("product-images", encode(photo((300, 200)), "PNG"))
        self.assertRegex(name, r"\Aproduct-images/[a-f0-9]{32}\.png\Z")
        self.assertTrue((self.root / name).exists())

    def test_extension_follows_the_processed_format(self):
        name = self.save("product-images", encode(photo(), "PNG"))
        self.assertTrue(name.endswith(".webp"))
        self.assertEqual(decode((self.root / name).read_bytes()).format, "WEBP")

    def test_each_category_applies_its_own_limit(self):
        data = encode(photo((2400, 1600)), "JPEG")
        for folder, longest in (("staff-images", 500), ("cylinder-images", 1200), ("product-images", 1200)):
            with self.subTest(folder):
                name = self.save(folder, data)
                self.assertEqual(max(decode((self.root / name).read_bytes()).size), longest)

    def test_path_traversal_is_refused(self):
        with self.assertRaises(SuspiciousFileOperation):
            self.storage.generate_filename("product-images/../../etc/x.png")

    def test_folders_outside_the_image_categories_are_stored_untouched(self):
        name = self.storage.save("other/notes.txt", ContentFile(b"plain"))
        self.assertEqual((self.root / name).read_bytes(), b"plain")

    def test_invalid_image_is_rejected_and_leaves_no_file(self):
        with self.assertRaises(ValueError):
            self.save("staff-images", b"not an image")
        self.assertEqual(list(self.root.rglob("*.*")), [])

    def test_saved_files_are_registered_for_orphan_cleanup(self):
        pending = []
        token = request_uploads.set(pending)
        try:
            name = self.save("cylinder-images", encode(photo((300, 200)), "PNG"))
        finally:
            request_uploads.reset(token)
        self.assertEqual(pending, [(self.storage, name)])


class MediaServingTests(GasBookTestCase):
    def setUp(self):
        super().setUp()
        root = tempfile.TemporaryDirectory()
        self.addCleanup(root.cleanup)
        setting = override_settings(MEDIA_ROOT=root.name, DEBUG=False)
        setting.enable()
        self.addCleanup(setting.disable)
        self.root = Path(root.name)

    def test_uploaded_catalog_image_is_resized_served_publicly_and_cached_immutably(self):
        self.auth(self.admin)
        response = self.client.patch(f"/api/cylinder-types/{self.cylinder.pk}/", {
            "image": SimpleUploadedFile("big.jpg", encode(photo((2400, 1600)), "JPEG"), content_type="image/jpeg"),
        }, format="multipart")
        self.assertEqual(response.status_code, 200, response.data)
        self.cylinder.refresh_from_db()
        name = self.cylinder.image.name
        self.assertRegex(name, r"\Acylinder-images/[a-f0-9]{32}\.jpg\Z")
        served = Client().get(f"/media/{name}")
        self.assertEqual(served.status_code, 200)
        self.assertEqual(served["Cache-Control"], "public, max-age=31536000, immutable")
        self.assertEqual(decode(b"".join(served.streaming_content)).size, (1200, 800))

    def test_legacy_names_keep_the_short_cache(self):
        (self.root / "cylinder-images").mkdir()
        (self.root / "cylinder-images" / "photo.png").write_bytes(encode(photo((30, 20)), "PNG"))
        self.assertEqual(Client().get("/media/cylinder-images/photo.png")["Cache-Control"], "public, max-age=300")

    def test_staff_photo_is_resized_and_stays_private(self):
        self.auth(self.admin)
        response = self.client.patch(f"/api/auth/users/{self.staff_a.pk}/", {
            "image": SimpleUploadedFile("me.jpg", encode(photo((2000, 2000)), "JPEG"), content_type="image/jpeg"),
        }, format="multipart")
        self.assertEqual(response.status_code, 200, response.data)
        self.staff_a_profile.refresh_from_db()
        name = self.staff_a_profile.image.name
        self.assertEqual(decode((self.root / name).read_bytes()).size, (500, 500))
        self.assertEqual(Client().get(f"/media/{name}").status_code, 404)
        owner = self.client.get(f"/media/{name}")
        self.assertEqual(owner.status_code, 200)
        self.assertEqual(owner["Cache-Control"], "private, no-store")


@override_settings(PRODUCTION=True, MEDIA_STORAGE_BACKEND="filesystem")
class DiskReadinessTests(GasBookTestCase):
    def setUp(self):
        super().setUp()
        root = tempfile.TemporaryDirectory()
        self.addCleanup(root.cleanup)
        setting = override_settings(MEDIA_ROOT=root.name)
        setting.enable()
        self.addCleanup(setting.disable)

    def ready(self):
        return self.client.get("/ready/")

    def test_an_unmounted_disk_is_not_ready(self):
        with patch("core.operations.os.path.ismount", return_value=False):
            response = self.ready()
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json(), {"status": "not_ready", "reason": "media_unavailable"})

    def test_a_mounted_writable_disk_is_ready(self):
        with patch("core.operations.os.path.ismount", return_value=True):
            self.assertEqual(self.ready().status_code, 200)

    def test_a_read_only_disk_is_not_ready(self):
        with patch("core.operations.os.path.ismount", return_value=True), \
                patch("core.operations.os.access", return_value=False):
            self.assertEqual(self.ready().status_code, 503)

    def test_the_mount_requirement_can_be_turned_off_for_other_hosts(self):
        with override_settings(MEDIA_REQUIRE_MOUNT=False):
            self.assertEqual(self.ready().status_code, 200)

    def test_disabled_media_never_checks_the_disk(self):
        with override_settings(MEDIA_STORAGE_BACKEND="disabled"), \
                patch("core.operations.os.path.ismount", side_effect=AssertionError("checked")):
            self.assertEqual(self.ready().status_code, 200)

    def test_development_never_checks_the_disk(self):
        with override_settings(PRODUCTION=False), patch("core.operations.os.path.ismount", side_effect=AssertionError("checked")):
            self.assertEqual(self.ready().status_code, 200)


class ImmutableCachePatternTests(SimpleTestCase):
    def test_immutable_pattern_matches_only_random_catalog_names(self):
        from core.operations import IMMUTABLE_MEDIA
        good = "product-images/" + "a" * 32 + ".webp"
        for bad in ("staff-images/" + "a" * 32 + ".png", "product-images/photo.png", "product-images/x/" + "a" * 32 + ".png",
                    good + ".exe", "../" + good):
            self.assertIsNone(IMMUTABLE_MEDIA.fullmatch(bad), bad)
        self.assertTrue(IMMUTABLE_MEDIA.fullmatch(good))


@override_settings(ACCESSORIES_ENABLED=True)
class UploadReplaceDeleteTests(GasBookTestCase):
    """Each category through the real API: first upload, replacement, removal; files follow the record."""

    def setUp(self):
        super().setUp()
        root = tempfile.TemporaryDirectory()
        self.addCleanup(root.cleanup)
        setting = override_settings(MEDIA_ROOT=root.name)
        setting.enable()
        self.addCleanup(setting.disable)
        self.root = Path(root.name)
        self.auth(self.admin)
        category = ProductCategory.objects.create(name="Test category")
        self.product = Product.objects.create(name="Gauge", category=category, selling_price=10, sku="LIFECYCLE-1")

    def files(self, folder):
        directory = self.root / folder
        return sorted(path.name for path in directory.iterdir()) if directory.exists() else []

    def image(self, size):
        return SimpleUploadedFile("photo.jpg", encode(photo(size), "JPEG"), content_type="image/jpeg")

    def patch_with_commit(self, endpoint, payload):
        with self.captureOnCommitCallbacks(execute=True):
            response = self.client.patch(endpoint, payload, format="multipart")
        self.assertEqual(response.status_code, 200, response.data)

    def test_upload_replace_and_remove_for_every_category(self):
        cases = (
            ("cylinder-images", f"/api/cylinder-types/{self.cylinder.pk}/", "remove_image",
             lambda: CylinderType.objects.get(pk=self.cylinder.pk).image),
            ("staff-images", f"/api/auth/users/{self.staff_a.pk}/", "remove_staff_image",
             lambda: StaffProfile.objects.get(pk=self.staff_a_profile.pk).image),
            ("product-images", f"/api/products/{self.product.pk}/", "remove_image",
             lambda: Product.objects.get(pk=self.product.pk).image),
        )
        for folder, endpoint, remove_flag, current in cases:
            with self.subTest(folder):
                self.assertEqual(self.files(folder), [])
                self.patch_with_commit(endpoint, {"image": self.image((300, 200))})
                first = current().name
                self.assertEqual(self.files(folder), [first.split("/", 1)[1]])
                self.patch_with_commit(endpoint, {"image": self.image((320, 220))})
                second = current().name
                self.assertNotEqual(first, second)
                self.assertEqual(self.files(folder), [second.split("/", 1)[1]])
                self.patch_with_commit(endpoint, {remove_flag: "true"})
                self.assertFalse(current())
                self.assertEqual(self.files(folder), [])

    def test_deleting_a_record_removes_its_file(self):
        for model, folder, kwargs in (
            (CylinderType, "cylinder-images", dict(name="Temp", weight=7, selling_price=0)),
            (Product, "product-images", dict(name="Temp", category=self.product.category, selling_price=1, sku="TEMP-1")),
        ):
            with self.subTest(folder):
                record = model.objects.create(**kwargs)
                record.image.save("x.jpg", ContentFile(encode(photo((300, 200)), "JPEG")))
                self.assertEqual(len(self.files(folder)), 1)
                with self.captureOnCommitCallbacks(execute=True):
                    record.delete()
                self.assertEqual(self.files(folder), [])

    def run_request_that(self, action):
        from core.media_errors import MediaErrorMiddleware
        names = []

        def view(request):
            names.append(action())
            return HttpResponse("ok")

        MediaErrorMiddleware(view)(RequestFactory().get("/"))
        return names[0]

    def test_a_file_written_by_a_request_that_never_referenced_it_is_removed_afterwards(self):
        data = encode(photo((300, 200)), "JPEG")
        name = self.run_request_that(
            lambda: default_storage.save(default_storage.generate_filename("product-images/x.jpg"), ContentFile(data)))
        self.assertFalse(default_storage.exists(name))

    def test_a_file_written_by_a_request_that_did_reference_it_is_kept(self):
        def action():
            self.product.image.save("x.jpg", ContentFile(encode(photo((300, 200)), "JPEG")))
            return self.product.image.name

        name = self.run_request_that(action)
        self.assertTrue(default_storage.exists(name))
