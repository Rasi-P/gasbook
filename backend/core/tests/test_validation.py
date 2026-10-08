from decimal import Decimal

from core.models import CustomerProfile, StaffProfile, User

from .base import PASSWORD, GasBookTestCase


class RegisterValidationTests(GasBookTestCase):
    def register(self, **overrides):
        self.auth(self.admin)
        payload = {"username": "newstaff", "full_name": "New Staff", "phone": "9333333333", "role": "staff", "password": "Temp-Pass-99!"}
        payload.update(overrides)
        return self.client.post("/api/auth/register/", payload, format="json")

    def test_long_name_rejected_without_write(self):
        before = User.objects.count()
        response = self.register(full_name="N" * 300)
        self.assertEqual(response.status_code, 400, response.data)
        self.assertEqual(response.data["code"], "max_length")
        self.assertEqual(response.data["field"], "full_name")
        self.assertIn("150", response.data["detail"])
        self.assertIn("full_name", response.data["errors"])
        self.assertEqual(User.objects.count(), before)
        self.assertFalse(StaffProfile.objects.filter(user__username="newstaff").exists())

    def test_two_part_name_each_limited_to_150(self):
        response = self.register(full_name="A" * 150 + " " + "B" * 150)
        self.assertEqual(response.status_code, 201, response.data)
        user = User.objects.get(username="newstaff")
        self.assertEqual((len(user.first_name), len(user.last_name)), (150, 150))
        response = self.register(username="newstaff2", phone="9333333334", full_name="A" * 150 + " " + "B" * 151)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["code"], "max_length")

    def test_other_field_limits(self):
        response = self.register(username="u" * 151)
        self.assertEqual(response.status_code, 400)
        self.assertEqual((response.data["code"], response.data["field"]), ("max_length", "username"))

        response = self.register(phone="12ab")
        self.assertEqual(response.status_code, 400)
        self.assertEqual((response.data["code"], response.data["field"]), ("invalid", "phone"))
        self.assertEqual(response.data["detail"], "Phone number must contain only digits.")

        response = self.register(phone="9" * 21)
        self.assertEqual(response.status_code, 400)
        self.assertEqual((response.data["code"], response.data["field"]), ("max_length", "phone"))

        response = self.register(email="not-an-email")
        self.assertEqual(response.status_code, 400)
        self.assertEqual((response.data["code"], response.data["field"]), ("invalid", "email"))

        response = self.register(vehicle_number="V" * 31)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["field"], "vehicle_number")

        self.assertFalse(User.objects.filter(username="newstaff").exists())

    def test_valid_register_still_works(self):
        response = self.register(vehicle_number="KL-07-1234", area="North")
        self.assertEqual(response.status_code, 201, response.data)
        profile = StaffProfile.objects.get(user__username="newstaff")
        self.assertEqual(profile.vehicle_number, "KL-07-1234")
        self.assertEqual(profile.assigned_area, "North")


class UserDetailPatchValidationTests(GasBookTestCase):
    def test_long_name_rejected(self):
        self.auth(self.admin)
        response = self.client.patch(f"/api/auth/users/{self.staff_a.id}/", {"full_name": "X" * 200}, format="json")
        self.assertEqual(response.status_code, 400, response.data)
        self.assertEqual((response.data["code"], response.data["field"]), ("max_length", "full_name"))
        self.staff_a.refresh_from_db()
        self.assertEqual(self.staff_a.first_name, "Staff")

    def test_phone_rules(self):
        self.auth(self.admin)
        response = self.client.patch(f"/api/auth/users/{self.staff_a.id}/", {"phone": "98ab"}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["code"], "invalid")
        response = self.client.patch(f"/api/auth/users/{self.staff_a.id}/", {"phone": ""}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["code"], "required")
        response = self.client.patch(f"/api/auth/users/{self.staff_a.id}/", {"phone": "9444444444", "full_name": "Renamed Person"}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.staff_a.refresh_from_db()
        self.assertEqual((self.staff_a.first_name, self.staff_a.last_name, self.staff_a.phone), ("Renamed", "Person", "9444444444"))


class MePatchValidationTests(GasBookTestCase):
    def test_long_name_and_bad_phone(self):
        self.auth(self.staff_a)
        response = self.client.patch("/api/auth/me/", {"full_name": "Y" * 151}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["code"], "max_length")
        response = self.client.patch("/api/auth/me/", {"phone": "12-34"}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["detail"], "Phone number must contain only digits.")
        response = self.client.patch("/api/auth/me/", {"full_name": "Me Myself", "phone": "9555555555"}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["name"], "Me Myself")


class CustomerProfileValidationTests(GasBookTestCase):
    def test_create_long_name_no_write(self):
        self.auth(self.admin)
        before = User.objects.count()
        response = self.client.post("/api/customers/", {"name": "Z" * 160, "phone": "9666666666"}, format="json")
        self.assertEqual(response.status_code, 400, response.data)
        self.assertEqual(response.data["code"], "max_length")
        self.assertEqual(User.objects.count(), before)

    def test_create_duplicate_phone(self):
        self.auth(self.admin)
        response = self.client.post("/api/customers/", {"name": "Dup Phone", "phone": self.customer_user.phone}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertEqual((response.data["code"], response.data["field"]), ("duplicate_phone", "phone"))
        self.assertIn("already in the system", response.data["detail"])

    def test_create_valid(self):
        self.auth(self.admin)
        response = self.client.post("/api/customers/", {"name": "Fresh Customer", "phone": "9777777777", "email": "f@example.com"}, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        profile = CustomerProfile.objects.get(id=response.data["id"])
        self.assertEqual(profile.user.first_name, "Fresh")
        self.assertTrue(profile.user.must_change_password)

    def test_patch_non_digit_phone_rejected_for_admin_and_customer(self):
        for actor in (self.admin, self.customer_user):
            self.auth(actor)
            response = self.client.patch(f"/api/customers/{self.customer.id}/", {"phone": "98ab"}, format="json")
            self.assertEqual(response.status_code, 400, response.data)
            self.assertEqual(response.data["detail"], "Phone number must contain only digits.")
            self.assertEqual((response.data["code"], response.data["field"]), ("invalid", "phone"))
            self.assertEqual(response.data["phone"], ["Phone number must contain only digits."])
            self.customer_user.refresh_from_db()
            self.assertEqual(self.customer_user.phone, "9000000004")

    def test_patch_long_phone_and_name(self):
        self.auth(self.customer_user)
        response = self.client.patch(f"/api/customers/{self.customer.id}/", {"phone": "9" * 25}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertEqual((response.data["code"], response.data["field"]), ("max_length", "phone"))
        response = self.client.patch(f"/api/customers/{self.customer.id}/", {"name": "L" * 151}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertEqual((response.data["code"], response.data["field"]), ("max_length", "full_name"))

    def test_patch_duplicate_phone_and_profile_not_partially_written(self):
        other_user = User.objects.create_user(username="other", password=PASSWORD, role=self.customer_role, phone="9888888888")
        CustomerProfile.objects.create(user=other_user)
        self.auth(self.admin)
        response = self.client.patch(
            f"/api/customers/{self.customer.id}/", {"phone": "9888888888", "credit_limit": "777"}, format="json"
        )
        self.assertEqual(response.status_code, 400, response.data)
        self.assertEqual(response.data["code"], "duplicate_phone")
        self.customer.refresh_from_db()
        self.assertEqual(self.customer.credit_limit, Decimal("0"))  # validated before any write

        # own number is not a duplicate of itself
        response = self.client.patch(f"/api/customers/{self.customer.id}/", {"phone": "9000000004"}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
