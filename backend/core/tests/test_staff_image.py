import base64
import os
import shutil
import tempfile

from django.core.files.base import ContentFile
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings

from core.models import StaffProfile

from .base import GasBookTestCase

# 1x1 transparent PNG
PNG_BYTES = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
)

MEDIA_TMP = tempfile.mkdtemp(prefix="gasbook-test-media-")


@override_settings(MEDIA_ROOT=MEDIA_TMP)
class RemoveStaffImageTests(GasBookTestCase):
    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        shutil.rmtree(MEDIA_TMP, ignore_errors=True)

    def give_image(self, profile, name="old.png"):
        profile.image.save(name, ContentFile(PNG_BYTES), save=True)
        profile.refresh_from_db()
        self.assertTrue(profile.image)
        return profile.image.path

    def test_remove_flag_returns_null_url_and_deletes_file(self):
        path = self.give_image(self.staff_a_profile)
        self.auth(self.admin)

        response = self.client.patch(
            f"/api/auth/users/{self.staff_a.pk}/", {"remove_staff_image": "true"}, format="multipart"
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertIsNone(response.json()["staff_image_url"])
        self.assertIs(response.json()["is_active"], True)
        self.staff_a_profile.refresh_from_db()
        self.assertFalse(self.staff_a_profile.image)
        self.assertFalse(os.path.exists(path))

        response = self.client.get("/api/auth/users/")
        rows = {row["id"]: row for row in response.json()}
        self.assertIsNone(rows[self.staff_a.pk]["staff_image_url"])

    def test_truthy_string_variants_and_json_bool(self):
        self.auth(self.admin)
        for value in ("1", "yes", "ON", " True "):
            self.give_image(self.staff_a_profile, name=f"img-{value.strip().lower()}.png")
            response = self.client.patch(
                f"/api/auth/users/{self.staff_a.pk}/", {"remove_staff_image": value}, format="multipart"
            )
            self.assertEqual(response.status_code, 200, (value, response.data))
            self.assertIsNone(response.json()["staff_image_url"], value)
            self.staff_a_profile.refresh_from_db()
            self.assertFalse(self.staff_a_profile.image, value)

        self.give_image(self.staff_a_profile, name="json.png")
        response = self.client.patch(f"/api/auth/users/{self.staff_a.pk}/", {"remove_staff_image": True}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertIsNone(response.json()["staff_image_url"])

        # Falsy values leave the image alone.
        path = self.give_image(self.staff_a_profile, name="keep.png")
        response = self.client.patch(f"/api/auth/users/{self.staff_a.pk}/", {"remove_staff_image": "0"}, format="multipart")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertIsNotNone(response.json()["staff_image_url"])
        self.assertTrue(os.path.exists(path))

    def test_works_for_non_staff_user_with_a_profile_image(self):
        # An admin (not role staff) who happens to have a StaffProfile with an image.
        self.staff_b.role = self.admin_role
        self.staff_b.save(update_fields=["role"])
        profile = StaffProfile.objects.get(user=self.staff_b)
        self.give_image(profile, name="admin.png")

        self.auth(self.admin)
        response = self.client.patch(
            f"/api/auth/users/{self.staff_b.pk}/", {"remove_staff_image": "true"}, format="multipart"
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertIsNone(response.json()["staff_image_url"])
        profile.refresh_from_db()
        self.assertFalse(profile.image)

    def test_remove_without_image_is_a_noop_and_upload_replaces(self):
        self.auth(self.admin)
        response = self.client.patch(
            f"/api/auth/users/{self.staff_a.pk}/", {"remove_staff_image": "true"}, format="multipart"
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertIsNone(response.json()["staff_image_url"])

        old_path = self.give_image(self.staff_a_profile, name="before.png")
        upload = SimpleUploadedFile("after.png", PNG_BYTES, content_type="image/png")
        response = self.client.patch(f"/api/auth/users/{self.staff_a.pk}/", {"image": upload}, format="multipart")
        self.assertEqual(response.status_code, 200, response.data)
        url = response.json()["staff_image_url"]
        self.assertIsNotNone(url)
        self.assertIn("after", url)
        self.assertFalse(os.path.exists(old_path))
        self.staff_a_profile.refresh_from_db()
        self.assertIn("after", self.staff_a_profile.image.name)

    def test_remove_is_admin_only(self):
        self.give_image(self.staff_a_profile, name="guarded.png")
        self.auth(self.staff_a)
        response = self.client.patch(
            f"/api/auth/users/{self.staff_a.pk}/", {"remove_staff_image": "true"}, format="multipart"
        )
        self.assertEqual(response.status_code, 403)
        self.staff_a_profile.refresh_from_db()
        self.assertTrue(self.staff_a_profile.image)
