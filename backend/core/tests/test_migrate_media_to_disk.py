"""The ImageKit-to-disk copy must be reversible, resumable and unable to touch remote objects."""
import csv
import hashlib
from io import BytesIO, StringIO
from pathlib import Path
from types import SimpleNamespace
import tempfile
from unittest.mock import MagicMock, patch

from cryptography.fernet import Fernet
import httpx
from django.core.files import File
from django.core.files.base import ContentFile
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import override_settings
from PIL import Image

from core.media_storage import ImageKitStorage, MediaUnavailable
from core.models import CylinderType, Product, ProductCategory, StaffProfile

from .base import GasBookTestCase

COMMAND = "core.management.commands.migrate_media_to_disk"
CREDENTIALS = dict(IMAGEKIT_PRIVATE_KEY="synthetic", IMAGEKIT_URL_ENDPOINT="https://ik.imagekit.io/synthetic",
                   MEDIA_ENCRYPTION_KEY="synthetic")


def png(color):
    output = BytesIO()
    Image.new("RGB", (8, 6), color).save(output, "PNG")
    return output.getvalue()


def remote_name(prefix, seed):
    return f"{prefix}/{seed * 24}/{seed * 32}.{'bin' if prefix == 'staff-images' else 'png'}"


class FakeRemote:
    """Stands in for ImageKitStorage: serves decrypted bytes and fails the test on any delete."""

    def __init__(self, objects, on_open=None):
        self.objects, self.on_open = objects, on_open

    def open(self, name):
        if self.on_open:
            self.on_open(name)
        if name not in self.objects:
            raise FileNotFoundError(name)
        if isinstance(self.objects[name], Exception):
            raise self.objects[name]
        return File(BytesIO(self.objects[name]), name=name)

    def delete(self, name):
        raise AssertionError("A remote object must never be deleted.")


@override_settings(**CREDENTIALS)
class MigrateMediaToDiskTests(GasBookTestCase):
    def setUp(self):
        super().setUp()
        root = tempfile.TemporaryDirectory()
        self.addCleanup(root.cleanup)
        self.root = Path(root.name)
        category = ProductCategory.objects.create(name="Test category")
        self.product = Product.objects.create(name="Gauge", category=category, selling_price=10, sku="MIGRATE-1")
        self.records = {
            "cylinder": (CylinderType, self.cylinder.pk, remote_name("cylinder-images", "a"), png("red")),
            "staff": (StaffProfile, self.staff_a_profile.pk, remote_name("staff-images", "b"), png("green")),
            "product": (Product, self.product.pk, remote_name("product-images", "c"), png("blue")),
        }
        for model, pk, name, _data in self.records.values():
            model.objects.filter(pk=pk).update(image=name)
        self.remote = FakeRemote({name: data for _m, _pk, name, data in self.records.values()})
        patcher = patch(f"{COMMAND}.ImageKitStorage", return_value=self.remote)
        patcher.start()
        self.addCleanup(patcher.stop)

    def run_command(self, **options):
        output = StringIO()
        call_command("migrate_media_to_disk", media_root=str(self.root), stdout=output, **options)
        return output.getvalue()

    def current(self, key):
        model, pk = self.records[key][:2]
        return model.objects.get(pk=pk).image.name

    def test_dry_run_reads_the_source_but_writes_nothing(self):
        output = self.run_command()
        self.assertIn("would-migrate=3", output)
        self.assertEqual(list(self.root.rglob("*")), [])
        for key, (_m, _pk, name, _data) in self.records.items():
            self.assertEqual(self.current(key), name)

    def test_apply_copies_bytes_unchanged_and_repoints_without_signals_or_remote_deletes(self):
        profile_before = StaffProfile.objects.get(pk=self.staff_a_profile.pk).updated_at
        with patch("core.media_lifecycle.delete_after_commit") as cleanup:
            output = self.run_command(apply=True)
        cleanup.assert_not_called()
        self.assertIn("migrated=3", output)
        for key, (_m, _pk, old, data) in self.records.items():
            new = self.current(key)
            self.assertRegex(new, r"\A(cylinder|product|staff)-images/[a-f0-9]{32}\.png\Z")
            self.assertNotEqual(new, old)
            self.assertEqual((self.root / new).read_bytes(), data)
        self.assertEqual(StaffProfile.objects.get(pk=self.staff_a_profile.pk).updated_at, profile_before)
        with (self.root / ".migration" / "manifest.csv").open() as handle:
            self.assertEqual(len(list(csv.DictReader(handle))), 3)

    def test_a_second_run_is_a_no_op(self):
        self.run_command(apply=True)
        files = sorted(path.name for path in self.root.rglob("*") if path.is_file())
        self.assertIn("skipped=3", self.run_command(apply=True))
        self.assertEqual(sorted(path.name for path in self.root.rglob("*") if path.is_file()), files)

    def test_verify_passes_and_detects_a_damaged_file(self):
        self.run_command(apply=True)
        self.assertIn("ok=3", self.run_command(verify=True))
        (self.root / self.current("product")).write_bytes(b"damaged")
        with self.assertRaisesMessage(CommandError, "1 problem"):
            self.run_command(verify=True)

    def test_verify_rejects_a_file_that_matches_its_hash_but_is_not_an_image(self):
        self.run_command(apply=True)
        manifest = self.root / ".migration" / "manifest.csv"
        rows = list(csv.DictReader(manifest.open()))
        junk = b"not an image"
        (self.root / rows[0]["new_name"]).write_bytes(junk)
        rows[0]["sha256"] = hashlib.sha256(junk).hexdigest()
        with manifest.open("w", newline="") as handle:
            writer = csv.DictWriter(handle, rows[0].keys())
            writer.writeheader()
            writer.writerows(rows)
        with self.assertRaisesMessage(CommandError, "1 problem"):
            self.run_command(verify=True)

    def test_records_edited_after_migration_are_not_treated_as_faults(self):
        self.run_command(apply=True)
        CylinderType.objects.filter(pk=self.cylinder.pk).update(image="")
        self.assertIn("changed-since=1", self.run_command(verify=True))

    def test_revert_restores_remote_names_and_keeps_disk_files(self):
        self.run_command(apply=True)
        migrated = {key: self.current(key) for key in self.records}
        self.assertIn("would revert 3", self.run_command(revert=True))
        self.assertEqual({key: self.current(key) for key in self.records}, migrated)
        self.assertIn("reverted 3", self.run_command(revert=True, apply=True))
        for key, (_m, _pk, old, _data) in self.records.items():
            self.assertEqual(self.current(key), old)
            self.assertTrue((self.root / migrated[key]).exists())

    def test_a_missing_remote_object_is_reported_while_the_rest_still_migrate(self):
        del self.remote.objects[self.records["staff"][2]]
        with self.assertRaisesMessage(CommandError, "1 problem"):
            self.run_command(apply=True)
        self.assertEqual(self.current("staff"), self.records["staff"][2])
        self.assertNotEqual(self.current("cylinder"), self.records["cylinder"][2])

    def test_an_unavailable_provider_is_an_error_not_a_crash(self):
        self.remote.objects[self.records["product"][2]] = MediaUnavailable()
        with self.assertRaisesMessage(CommandError, "1 problem"):
            self.run_command(apply=True)
        self.assertEqual(self.current("product"), self.records["product"][2])

    def test_a_record_edited_during_the_copy_keeps_its_newer_image_and_leaves_no_orphan(self):
        newer = "cylinder-images/" + "f" * 32 + ".png"
        target = self.records["cylinder"][2]
        self.remote.on_open = lambda name: CylinderType.objects.filter(pk=self.cylinder.pk).update(image=newer) if name == target else None
        output = self.run_command(apply=True)
        self.assertIn("changed=1", output)
        self.assertEqual(self.current("cylinder"), newer)
        self.assertEqual([path for path in (self.root / "cylinder-images").glob("*")], [])

    def test_names_that_are_not_remote_references_are_skipped(self):
        CylinderType.objects.filter(pk=self.cylinder.pk).update(image="cylinder-images/legacy-photo.png")
        self.assertIn("skipped=1", self.run_command())

    def test_source_credentials_are_required(self):
        with override_settings(IMAGEKIT_PRIVATE_KEY=""), self.assertRaisesMessage(CommandError, "required to read the source"):
            self.run_command()

    def test_writes_are_refused_when_production_disk_is_not_mounted(self):
        with override_settings(PRODUCTION=True, MEDIA_REQUIRE_MOUNT=True), \
                self.assertRaisesMessage(CommandError, "not a mounted disk"):
            self.run_command(apply=True)
        self.assertEqual(list(self.root.rglob("*")), [])

    def test_a_relative_media_root_is_refused(self):
        with self.assertRaisesMessage(CommandError, "absolute"):
            call_command("migrate_media_to_disk", media_root="media", stdout=StringIO())


class RealDecryptionTests(GasBookTestCase):
    """The real ImageKitStorage (encrypt on save, signed fetch, decrypt on open) against an in-memory provider."""

    def setUp(self):
        super().setUp()
        root = tempfile.TemporaryDirectory()
        self.addCleanup(root.cleanup)
        self.root = Path(root.name)
        self.key = Fernet.generate_key().decode()
        setting = override_settings(MEDIA_ENCRYPTION_KEY=self.key, DEMO_DISABLE_UPLOADS=False, **{
            k: v for k, v in CREDENTIALS.items() if k != "MEDIA_ENCRYPTION_KEY"})
        setting.enable()
        self.addCleanup(setting.disable)
        self.objects = {}
        client = MagicMock()
        client.__enter__.return_value = client

        def upload(**kwargs):
            self.objects[kwargs["file_name"]] = kwargs["file"]
            return SimpleNamespace(file_id="a" * 24, file_path=kwargs["folder"] + "/" + kwargs["file_name"], is_private_file=True)

        client.files.upload.side_effect = upload
        client.helper.build_url.side_effect = lambda **kw: kw["url_endpoint"] + kw["src"] + "?ik-s=synthetic"
        self.storage = ImageKitStorage()
        patcher = patch.object(self.storage, "client", return_value=client)
        patcher.start()
        self.addCleanup(patcher.stop)

        def provider(request):
            return httpx.Response(200, content=self.objects[request.url.path.rsplit("/", 1)[1]], request=request)

        real_client = httpx.Client  # captured first: the patch below replaces httpx.Client itself
        patcher = patch("core.media_storage.httpx.Client", side_effect=lambda *a, **k: real_client(transport=httpx.MockTransport(provider)))
        patcher.start()
        self.addCleanup(patcher.stop)
        patcher = patch(f"{COMMAND}.ImageKitStorage", return_value=self.storage)
        patcher.start()
        self.addCleanup(patcher.stop)

        self.staff_png, self.product_png = png("purple"), png("orange")
        self.staff_name = self.storage.save("staff-images/me.png", ContentFile(self.staff_png))
        self.product_name = self.storage.save("product-images/gauge.png", ContentFile(self.product_png))
        category = ProductCategory.objects.create(name="Test category")
        self.product = Product.objects.create(name="Gauge", category=category, selling_price=10, sku="DECRYPT-1")
        StaffProfile.objects.filter(pk=self.staff_a_profile.pk).update(image=self.staff_name)
        Product.objects.filter(pk=self.product.pk).update(image=self.product_name)

    def run_command(self, **options):
        call_command("migrate_media_to_disk", media_root=str(self.root), stdout=StringIO(), **options)

    def test_the_provider_really_holds_ciphertext_for_staff_photos(self):
        self.assertTrue(self.staff_name.endswith(".bin"))
        stored = next(data for name, data in self.objects.items() if name.endswith(".bin"))
        self.assertNotIn(self.staff_png, stored)

    def test_staff_photos_are_decrypted_and_verified_end_to_end(self):
        self.run_command(apply=True)
        staff = StaffProfile.objects.get(pk=self.staff_a_profile.pk).image.name
        product = Product.objects.get(pk=self.product.pk).image.name
        self.assertRegex(staff, r"\Astaff-images/[a-f0-9]{32}\.png\Z")
        self.assertEqual((self.root / staff).read_bytes(), self.staff_png)
        self.assertEqual((self.root / product).read_bytes(), self.product_png)
        manifest = {row["model"]: row for row in csv.DictReader((self.root / ".migration" / "manifest.csv").open())}
        self.assertEqual(manifest["StaffProfile"]["sha256"], hashlib.sha256(self.staff_png).hexdigest())
        self.run_command(verify=True)

    def test_a_wrong_key_is_an_error_that_writes_nothing_and_changes_nothing(self):
        with override_settings(MEDIA_ENCRYPTION_KEY=Fernet.generate_key().decode()), \
                self.assertRaisesMessage(CommandError, "1 problem"):
            self.run_command(apply=True)
        self.assertEqual(StaffProfile.objects.get(pk=self.staff_a_profile.pk).image.name, self.staff_name)
        self.assertEqual(list((self.root / "staff-images").glob("*")) if (self.root / "staff-images").exists() else [], [])
        self.assertNotEqual(Product.objects.get(pk=self.product.pk).image.name, self.product_name)
