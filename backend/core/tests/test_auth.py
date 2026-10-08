from decimal import Decimal

from rest_framework_simplejwt.tokens import RefreshToken

from core.models import CustomerProfile, User

from .base import PASSWORD, GasBookTestCase


class PasswordChangeRequiredTests(GasBookTestCase):
    def bearer(self, user):
        token = str(RefreshToken.for_user(user).access_token)
        self.client.force_authenticate(None)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")

    def test_flagged_user_is_blocked_except_me_and_change_password(self):
        self.staff_a.must_change_password = True
        self.staff_a.save(update_fields=["must_change_password"])
        self.bearer(self.staff_a)

        response = self.client.get("/api/deliveries/")
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json(), {"detail": "You must change your password before continuing.", "code": "password_change_required"})

        response = self.client.get("/api/dashboard/")
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["code"], "password_change_required")

        response = self.client.get("/api/notifications/")
        self.assertEqual(response.json()["code"], "password_change_required")

        # PATCH /auth/me/ is NOT exempt, only GET
        response = self.client.patch("/api/auth/me/", {"full_name": "X Y"}, format="json")
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["code"], "password_change_required")

        response = self.client.get("/api/auth/me/")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["must_change_password"])

        response = self.client.post(
            "/api/auth/change-password/",
            {"current_password": PASSWORD, "new_password": "Brand-New-Secret-77", "confirm_new_password": "Brand-New-Secret-77"},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.json())

        # access restored immediately with the same token
        response = self.client.get("/api/deliveries/")
        self.assertEqual(response.status_code, 200)

    def test_unflagged_user_unaffected_and_token_endpoints_open(self):
        self.bearer(self.staff_a)
        self.assertEqual(self.client.get("/api/deliveries/").status_code, 200)

        self.staff_a.must_change_password = True
        self.staff_a.save(update_fields=["must_change_password"])
        self.client.credentials()
        response = self.client.post("/api/auth/token/", {"username": "staffa", "password": PASSWORD}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["must_change_password"])
        refresh = response.json()["refresh"]
        response = self.client.post("/api/auth/token/refresh/", {"refresh": refresh}, format="json")
        self.assertEqual(response.status_code, 200)

    def test_anonymous_still_401(self):
        self.client.force_authenticate(None)
        self.client.credentials()
        response = self.client.get("/api/deliveries/")
        self.assertEqual(response.status_code, 401)


class TokenClientTests(GasBookTestCase):
    def login(self, username, client=None):
        self.client.force_authenticate(None)
        payload = {"username": username, "password": PASSWORD}
        if client is not None:
            payload["client"] = client
        return self.client.post("/api/auth/token/", payload, format="json")

    def test_role_in_response_without_client(self):
        for username, role in (("admin1", "admin"), ("staffa", "staff"), ("cust1", "customer")):
            response = self.login(username)
            self.assertEqual(response.status_code, 200, response.json())
            body = response.json()
            self.assertEqual(body["role"], role)
            self.assertIn("access", body)
            self.assertIn("refresh", body)
            self.assertIn("user_id", body)
            self.assertIn("must_change_password", body)

    def test_customer_client_rejects_staff_and_admin(self):
        for username, role in (("staffa", "staff"), ("admin1", "admin")):
            response = self.login(username, client="customer")
            self.assertEqual(response.status_code, 403)
            self.assertEqual(response.json(), {
                "detail": "This account cannot sign in to the customer app.",
                "code": "role_not_allowed",
                "role": role,
            })
        response = self.login("cust1", client="customer")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["role"], "customer")

    def test_management_client_rejects_customer(self):
        response = self.login("cust1", client="management")
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json(), {
            "detail": "This account is for the customer app, not the management portal.",
            "code": "role_not_allowed",
            "role": "customer",
        })
        for username in ("staffa", "admin1"):
            response = self.login(username, client="management")
            self.assertEqual(response.status_code, 200, response.json())

    def test_bad_credentials_still_401(self):
        self.client.force_authenticate(None)
        response = self.client.post("/api/auth/token/", {"username": "cust1", "password": "wrong", "client": "customer"}, format="json")
        self.assertEqual(response.status_code, 401)


class CustomersMeTests(GasBookTestCase):
    def test_customer_gets_own_profile(self):
        other_user = User.objects.create_user(username="other", password=PASSWORD, role=self.customer_role)
        CustomerProfile.objects.create(user=other_user)
        self.auth(self.customer_user)
        response = self.client.get("/api/customers/me/")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["id"], self.customer.id)
        self.assertEqual(response.data["username"], "cust1")
        self.assertEqual(response.data["user_id"], self.customer_user.id)
        self.assertIn("pending_amount", response.data)

    def test_non_customer_forbidden(self):
        for user in (self.staff_a, self.admin):
            self.auth(user)
            response = self.client.get("/api/customers/me/")
            self.assertEqual(response.status_code, 403)
            self.assertEqual(response.data["code"], "role_not_allowed")

    def test_missing_profile_404(self):
        orphan = User.objects.create_user(username="orphan", password=PASSWORD, role=self.customer_role)
        self.auth(orphan)
        response = self.client.get("/api/customers/me/")
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.data["code"], "customer_profile_missing")


class CustomerSelfPatchTests(GasBookTestCase):
    def test_customer_patch_only_honours_contact_fields(self):
        self.auth(self.customer_user)
        response = self.client.patch(
            f"/api/customers/{self.customer.id}/",
            {
                "name": "New Name",
                "phone": "9111111111",
                "email": "new@example.com",
                "address": "New address",
                "opening_balance": "999.00",
                "credit_limit": "5000",
                "global_discount_type": "percentage",
                "global_discount_value": "100",
                "global_discount_is_active": True,
                "is_active": False,
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.customer.refresh_from_db()
        self.customer_user.refresh_from_db()
        self.assertEqual((self.customer_user.first_name, self.customer_user.last_name), ("New", "Name"))
        self.assertEqual(self.customer_user.phone, "9111111111")
        self.assertEqual(self.customer_user.email, "new@example.com")
        self.assertEqual(self.customer_user.address, "New address")
        self.assertEqual(self.customer.opening_balance, Decimal("0"))
        self.assertEqual(self.customer.credit_limit, Decimal("0"))
        self.assertFalse(self.customer.global_discount_is_active)
        self.assertIsNone(self.customer.global_discount_type)
        self.assertTrue(self.customer.is_active)
        self.assertEqual(response.data["name"], "New Name")

    def test_customer_cannot_patch_other_profile(self):
        other_user = User.objects.create_user(username="other", password=PASSWORD, role=self.customer_role)
        other = CustomerProfile.objects.create(user=other_user)
        self.auth(self.customer_user)
        response = self.client.patch(f"/api/customers/{other.id}/", {"name": "Hacked"}, format="json")
        self.assertEqual(response.status_code, 404)

    def test_admin_patch_still_updates_profile_fields(self):
        self.auth(self.admin)
        response = self.client.patch(
            f"/api/customers/{self.customer.id}/",
            {"name": "Admin Set", "credit_limit": "2500", "phone": "9222222222"},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.customer.refresh_from_db()
        self.customer_user.refresh_from_db()
        self.assertEqual(self.customer.credit_limit, Decimal("2500"))
        self.assertEqual(self.customer_user.first_name, "Admin")
        self.assertEqual(self.customer_user.phone, "9222222222")
