"""Default cylinder pictures: static SABCO files chosen by the clients from the weight.

The ONE folder is core/static/cylinders/, holding `sabco-<kg>kg.png`. collectstatic packages it (Render build,
backend Dockerfile) and the backend serves it at /static/cylinders/ to both frontends (src/lib/cylinderImages.ts).
The API only ever carries the CUSTOM picture, so existing types need no migration or backfill, nothing is stored per
record or in media storage (ImageKit) for a default, and removing a custom picture can only delete that custom file.
"""
from decimal import Decimal
from io import BytesIO
from pathlib import Path
import re
import tempfile

from django.conf import settings
from django.contrib.staticfiles import finders
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import SimpleTestCase, override_settings
from PIL import Image

from core.models import Booking, CylinderType, Delivery
from .base import GasBookTestCase

DEFAULTS = Path(settings.BASE_DIR) / "core" / "static" / "cylinders"
NINE_WEIGHTS = (2, 3, 4, 5, 12, 14, 19, 21, 33)
NAME = re.compile(r"^sabco-(\d+)kg\.png$")


def upload(name="custom.png"):
    output = BytesIO()
    Image.new("RGB", (8, 6), "red").save(output, "PNG")
    return SimpleUploadedFile(name, output.getvalue(), content_type="image/png")


class DefaultPictureFolderTests(SimpleTestCase):
    """The folder an operator drops the SABCO PNGs into. A weight whose file is not there yet is reported as a
    skipped subtest naming the file to add; clients show the generic cylinder for it until then."""

    def files(self):
        return sorted(path.name for path in DEFAULTS.iterdir() if not path.name.startswith("."))

    def test_folder_is_packaged_as_static_files(self):
        self.assertTrue(DEFAULTS.is_dir(), DEFAULTS)
        self.assertIn("core", settings.INSTALLED_APPS)  # app static dirs are what collectstatic and finders read

    def test_folder_holds_only_correctly_named_pngs(self):
        for name in self.files():
            with self.subTest(name=name):
                self.assertRegex(name, NAME, "Name default pictures sabco-<kg>kg.png")
                with Image.open(DEFAULTS / name) as image:
                    self.assertEqual(image.format, "PNG")
                    image.verify()

    def test_each_of_the_nine_weights(self):
        for kg in NINE_WEIGHTS:
            with self.subTest(kg=kg):
                name = f"sabco-{kg}kg.png"
                if not (DEFAULTS / name).exists():
                    self.skipTest(f"{name} not added yet: add it to {DEFAULTS}")
                found = finders.find(f"cylinders/{name}")
                self.assertEqual(Path(found).resolve(), (DEFAULTS / name).resolve())
                with Image.open(found) as image:
                    self.assertEqual(image.format, "PNG")


class CylinderDefaultImageTests(GasBookTestCase):
    def setUp(self):
        super().setUp()
        root = tempfile.TemporaryDirectory()
        self.addCleanup(root.cleanup)
        setting = override_settings(MEDIA_ROOT=root.name)
        setting.enable()
        self.addCleanup(setting.disable)
        self.media = Path(root.name)
        self.auth(self.admin)

    def stored_files(self):
        return sorted(str(path.relative_to(self.media)) for path in self.media.rglob("*") if path.is_file())

    def test_existing_types_without_a_picture_need_no_backfill(self):
        # Records as they exist today: no picture, any of the supported weights. The API reports no custom picture and
        # the weight, which is all a client needs to show the right default; nothing is written to storage.
        for kg in (2, 3, 4, 5, 12, 14, 19, 21, 33):
            CylinderType.objects.create(name=f"{kg}kg", weight=Decimal(kg), selling_price=0, refill_rate=100)
        rows = {row["name"]: row for row in self.client.get("/api/cylinder-types/", {"page_size": 100}).data["results"]}
        for kg in (2, 3, 4, 5, 12, 14, 19, 21, 33):
            self.assertIsNone(rows[f"{kg}kg"]["image"])
            self.assertEqual(Decimal(rows[f"{kg}kg"]["weight"]), Decimal(kg))
        self.assertEqual(self.stored_files(), [])

    def test_creating_a_type_without_a_picture_stores_no_default_copy(self):
        made = self.client.post("/api/cylinder-types/", {"name": "33kg", "weight": "33", "refill_rate": "1", "deposit_amount": "0"}, format="json")
        self.assertEqual(made.status_code, 201, made.data)
        self.assertIsNone(made.data["image"])
        self.assertFalse(CylinderType.objects.get(pk=made.data["id"]).image)
        self.assertEqual(self.stored_files(), [])

    def test_removing_a_custom_picture_returns_to_no_picture_and_deletes_only_that_file(self):
        made = self.client.post("/api/cylinder-types/", {
            "name": "19kg custom", "weight": "19", "refill_rate": "1", "deposit_amount": "0", "image": upload()}, format="multipart")
        self.assertEqual(made.status_code, 201, made.data)
        self.assertIn("/media/cylinder-images/", made.data["image"])
        other = self.client.post("/api/cylinder-types/", {
            "name": "5kg custom", "weight": "5", "refill_rate": "1", "deposit_amount": "0", "image": upload("other.png")}, format="multipart")
        before = self.stored_files()
        self.assertEqual(len(before), 2)
        with self.captureOnCommitCallbacks(execute=True):
            removed = self.client.patch(f"/api/cylinder-types/{made.data['id']}/", {"remove_image": "true"}, format="multipart")
        self.assertEqual(removed.status_code, 200, removed.data)
        self.assertIsNone(removed.data["image"])
        self.assertEqual(Decimal(removed.data["weight"]), Decimal("19"))
        self.assertIsNone(self.client.get(f"/api/cylinder-types/{made.data['id']}/").data["image"])
        # Only the removed type's own upload is gone; the other type's custom picture is untouched.
        after = self.stored_files()
        self.assertEqual(len(after), 1)
        self.assertTrue(CylinderType.objects.get(pk=other.data["id"]).image.name in after)

    def test_weight_change_keeps_a_custom_picture_and_leaves_none_when_there_was_none(self):
        with_custom = self.client.post("/api/cylinder-types/", {
            "name": "Commercial", "weight": "19", "refill_rate": "1", "deposit_amount": "0", "image": upload()}, format="multipart").data
        changed = self.client.patch(f"/api/cylinder-types/{with_custom['id']}/", {"weight": "33"}, format="json")
        self.assertEqual(changed.status_code, 200, changed.data)
        self.assertEqual(changed.data["image"], with_custom["image"])
        changed = self.client.patch(f"/api/cylinder-types/{self.cylinder.pk}/", {"weight": "2"}, format="json")
        self.assertEqual(changed.status_code, 200, changed.data)
        self.assertIsNone(changed.data["image"])
        self.assertEqual(Decimal(changed.data["weight"]), Decimal("2"))

    def test_staff_deliveries_carry_the_weight_and_custom_picture_for_display(self):
        booking = self.make_booking(status=Booking.Status.APPROVED, assigned_staff=self.staff_a)
        self.make_delivery(booking, self.staff_a, status=Delivery.Status.ASSIGNED)
        self.auth(self.staff_a)
        row = self.client.get("/api/deliveries/").data["results"][0]
        self.assertEqual(Decimal(row["cylinder_type_weight"]), Decimal("14.20"))
        self.assertIsNone(row["cylinder_type_image"])

        self.cylinder.image = upload()
        self.cylinder.save()
        row = self.client.get("/api/deliveries/").data["results"][0]
        self.assertIn("/media/cylinder-images/", row["cylinder_type_image"])

        self.cylinder.image = None
        self.cylinder.save()
        self.assertIsNone(self.client.get("/api/deliveries/").data["results"][0]["cylinder_type_image"])

    def test_the_new_delivery_fields_are_read_only(self):
        booking = self.make_booking(status=Booking.Status.APPROVED, assigned_staff=self.staff_a)
        delivery = self.make_delivery(booking, self.staff_a)
        self.client.patch(f"/api/deliveries/{delivery.pk}/", {"cylinder_type_weight": "99", "cylinder_type_image": "x"}, format="json")
        self.cylinder.refresh_from_db()
        self.assertEqual(self.cylinder.weight, Decimal("14.20"))
        self.assertFalse(self.cylinder.image)
