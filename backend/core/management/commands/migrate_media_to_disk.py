"""Copy ImageKit-hosted images onto the persistent media disk. Temporary: remove with the ImageKit code.

Nothing remote is ever deleted. References are repointed with QuerySet.update(), never save(): the
media lifecycle signals would otherwise delete the replaced ImageKit object. Bytes are copied
unchanged (staff photos are decrypted), so migration never recompresses an image.
"""
import csv
import hashlib
import os
from collections import Counter
from pathlib import Path
import uuid

from django.conf import settings
from django.core.files.base import ContentFile
from django.core.files.storage import FileSystemStorage
from django.core.management.base import BaseCommand, CommandError

from core.media_storage import REMOTE_NAME, ImageKitStorage, MediaUnavailable
from core.models import CylinderType, Product, StaffProfile
from core.uploads import inspect_image

MODELS = {model.__name__: model for model in (CylinderType, Product, StaffProfile)}
EXTENSIONS = {"PNG": "png", "JPEG": "jpg", "WEBP": "webp"}
FIELDS = ["model", "pk", "old_name", "new_name", "sha256", "bytes"]


class Command(BaseCommand):
    help = "Copy ImageKit images to MEDIA_ROOT (dry run unless --apply); --verify and --revert use the manifest."

    def add_arguments(self, parser):
        parser.add_argument("--apply", action="store_true", help="Write files and repoint references.")
        parser.add_argument("--verify", action="store_true", help="Check migrated files against the manifest; changes nothing.")
        parser.add_argument("--revert", action="store_true", help="Repoint references back to the ImageKit names (needs --apply).")
        parser.add_argument("--media-root", default=os.environ.get("MEDIA_ROOT", ""))
        parser.add_argument("--manifest", default="", help="Default: <media root>/.migration/manifest.csv")

    def handle(self, *, apply, verify, revert, media_root, manifest, **_):
        root = Path(media_root)
        if not root.is_absolute():
            raise CommandError("An absolute --media-root (or MEDIA_ROOT) is required.")
        if verify and revert:
            raise CommandError("Use --verify or --revert, not both.")
        manifest = Path(manifest) if manifest else root / ".migration" / "manifest.csv"
        if verify:
            problems = self.verify(root, manifest)
        elif revert:
            problems = self.revert(manifest, apply)
        else:
            problems = self.migrate(root, manifest, apply)
        if problems:
            raise CommandError(f"{problems} problem(s); see the output above.")

    def migrate(self, root, manifest, apply):
        if not all((settings.IMAGEKIT_PRIVATE_KEY, settings.IMAGEKIT_URL_ENDPOINT, settings.MEDIA_ENCRYPTION_KEY)):
            raise CommandError("IMAGEKIT_PRIVATE_KEY, IMAGEKIT_URL_ENDPOINT and MEDIA_ENCRYPTION_KEY are required to read the source.")
        if apply and settings.PRODUCTION and settings.MEDIA_REQUIRE_MOUNT and not os.path.ismount(root):
            raise CommandError("MEDIA_ROOT is not a mounted disk; refusing to write to the ephemeral filesystem.")
        source, target, counts = ImageKitStorage(), FileSystemStorage(location=str(root)), Counter()
        log = None
        try:
            if apply:
                manifest.parent.mkdir(parents=True, exist_ok=True)
                fresh = not manifest.exists() or manifest.stat().st_size == 0
                log = manifest.open("a", newline="")
                writer = csv.DictWriter(log, FIELDS)
                if fresh:
                    writer.writeheader()
            for name, model in MODELS.items():
                for record in model.objects.exclude(image__isnull=True).exclude(image="").order_by("pk"):
                    status, row = self.copy(model, record, source, target, apply)
                    counts[status] += 1
                    self.stdout.write(f"{status}\t{name}#{record.pk}\t{record.image.name}")
                    if row and log:
                        writer.writerow({"model": name, **row})
                        log.flush()
        finally:
            if log:
                log.close()
        self.stdout.write(", ".join(f"{key}={value}" for key, value in sorted(counts.items())) or "no images found")
        if not apply:
            self.stdout.write("DRY RUN: nothing was written. Re-run with --apply.")
        return counts["error"] + counts["missing"]

    def copy(self, model, record, source, target, apply):
        old = record.image.name
        if not REMOTE_NAME.fullmatch(old):
            return "skipped", None  # already on disk, or a legacy reference with no remote object
        try:
            with source.open(old) as handle:  # signed fetch, bounded size, decrypted and validated
                data = handle.read()
            new = f"{old.split('/', 1)[0]}/{uuid.uuid4().hex}.{EXTENSIONS[inspect_image(data).format]}"
        except FileNotFoundError:
            return "missing", None
        except (MediaUnavailable, ValueError):
            return "error", None
        if not apply:
            return "would-migrate", None
        digest = hashlib.sha256(data).hexdigest()
        saved = None
        try:
            saved = target.save(new, ContentFile(data))
            with target.open(saved) as written:
                if hashlib.sha256(written.read()).hexdigest() != digest:
                    raise OSError("Checksum mismatch after writing.")
            # Compare-and-set: a record edited meanwhile keeps its newer image.
            if not model.objects.filter(pk=record.pk, image=old).update(image=saved):
                target.delete(saved)
                return "changed", None
        except Exception:
            if saved:
                target.delete(saved)
            return "error", None
        return "migrated", {"pk": record.pk, "old_name": old, "new_name": saved, "sha256": digest, "bytes": len(data)}

    def rows(self, manifest):
        if not manifest.exists():
            raise CommandError(f"No manifest at {manifest}.")
        with manifest.open(newline="") as handle:
            return list(csv.DictReader(handle))

    def verify(self, root, manifest):
        target, counts = FileSystemStorage(location=str(root)), Counter()
        for row in self.rows(manifest):
            current = MODELS[row["model"]].objects.filter(pk=row["pk"]).values_list("image", flat=True).first()
            if current != row["new_name"]:
                counts["changed-since"] += 1  # edited or deleted after migration; not a fault
                continue
            try:
                with target.open(row["new_name"]) as handle:
                    data = handle.read()
                ok = hashlib.sha256(data).hexdigest() == row["sha256"]
                if ok:
                    inspect_image(data)
            except (FileNotFoundError, ValueError):
                ok = False
            counts["ok" if ok else "problem"] += 1
            if not ok:
                self.stdout.write(f"problem\t{row['model']}#{row['pk']}\t{row['new_name']}")
        self.stdout.write(", ".join(f"{key}={value}" for key, value in sorted(counts.items())) or "manifest is empty")
        return counts["problem"]

    def revert(self, manifest, apply):
        reverted = 0
        for row in self.rows(manifest):
            if apply:
                reverted += MODELS[row["model"]].objects.filter(pk=row["pk"], image=row["new_name"]).update(image=row["old_name"])
            else:
                reverted += 1
        self.stdout.write(f"{'reverted' if apply else 'would revert'} {reverted} reference(s); disk files were left in place.")
        return 0
