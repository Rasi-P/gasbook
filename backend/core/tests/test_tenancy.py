from decimal import Decimal

from django.core.exceptions import PermissionDenied
from django.test import override_settings
from rest_framework_simplejwt.tokens import RefreshToken

from core.models import (
    CustomerCylinderRate, CustomerProfile, CylinderType, Role, Sale, SaleItem, StaffProfile, StockLocation, Tenant,
    User,
)
from core.tenancy import PLATFORM_ROLE, tenant_context

from .base import PASSWORD, GasBookTestCase


class TenantFixtures(GasBookTestCase):
    """The base fixtures live in the default tenant (A); tenant B gets its own copy of each kind of row."""

    def setUp(self):
        super().setUp()
        self.tenant_a = self.admin.tenant
        self.tenant_b = Tenant.objects.create(name="Other Gas", slug="other-gas")
        with tenant_context(self.tenant_b):
            self.admin_b = User.objects.create_user(
                username="admin_b", password=PASSWORD, role=self.admin_role, first_name="Bee", phone="8000000001"
            )
            self.staff_b_user = User.objects.create_user(
                username="staff_other", password=PASSWORD, role=self.staff_role, phone="8000000002"
            )
            StaffProfile.objects.create(user=self.staff_b_user)
            customer_b_user = User.objects.create_user(
                username="cust_b", password=PASSWORD, role=self.customer_role, phone="8000000003"
            )
            self.customer_b = CustomerProfile.objects.create(user=customer_b_user)
            self.cylinder_b = CylinderType.objects.create(
                name="Other 19kg", weight=Decimal("19.00"), selling_price=Decimal("1500.00"), refill_rate=Decimal("1400.00")
            )
            self.location_b = StockLocation.objects.create(name="Other Shop", code="shop")
            self.sale_b = Sale.objects.create(
                location=self.location_b, total_amount=Decimal("1400.00"), payment_mode="cash", sold_by=self.admin_b,
            )

    def bearer(self, user):
        self.client.force_authenticate(None)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")

    @staticmethod
    def ids(response):
        body = response.json()
        rows = body["results"] if isinstance(body, dict) and "results" in body else body
        return {row["id"] for row in rows}


class TenantIsolationTests(TenantFixtures):
    def test_fixtures_land_in_their_tenants(self):
        self.assertEqual(self.tenant_a.slug, "sabco")
        self.assertEqual(self.cylinder.tenant_id, self.tenant_a.id)
        self.assertEqual(self.cylinder_b.tenant_id, self.tenant_b.id)
        self.assertEqual(self.admin_b.tenant_id, self.tenant_b.id)
        # The same location code may exist once per tenant.
        self.assertEqual(self.shop.code, self.location_b.code)

    def test_lists_show_only_the_callers_tenant(self):
        for user in (self.admin, self.admin_b):
            with self.subTest(user=user.username):
                self.bearer(user)
                own = user.tenant_id
                expected = {
                    "/api/cylinder-types/": set(CylinderType.all_rows().filter(tenant_id=own).values_list("id", flat=True)),
                    "/api/locations/": set(StockLocation.all_rows().filter(tenant_id=own).values_list("id", flat=True)),
                    "/api/customers/": set(CustomerProfile.all_rows().filter(tenant_id=own).values_list("id", flat=True)),
                    "/api/sales/": set(Sale.all_rows().filter(tenant_id=own).values_list("id", flat=True)),
                }
                for url, want in expected.items():
                    response = self.client.get(url)
                    self.assertEqual(response.status_code, 200, url)
                    self.assertEqual(self.ids(response), want, url)
                users = self.client.get("/api/auth/users/").json()
                self.assertEqual({u["id"] for u in users}, set(
                    User.all_tenants.filter(tenant_id=own).exclude(role__code="customer").values_list("id", flat=True)
                ))

    def test_force_authenticated_requests_are_scoped_too(self):
        self.client.force_authenticate(self.admin)
        self.assertNotIn(self.cylinder_b.id, self.ids(self.client.get("/api/cylinder-types/")))

    def test_other_tenants_records_are_not_found(self):
        self.bearer(self.admin)
        self.assertEqual(self.client.get(f"/api/cylinder-types/{self.cylinder_b.id}/").status_code, 404)
        self.assertEqual(self.client.get(f"/api/customers/{self.customer_b.id}/").status_code, 404)
        self.assertEqual(self.client.get(f"/api/sales/{self.sale_b.id}/").status_code, 404)
        self.assertEqual(self.client.patch(f"/api/auth/users/{self.admin_b.id}/", {"full_name": "X"}, format="json").status_code, 404)
        self.assertEqual(self.client.delete(f"/api/cylinder-types/{self.cylinder_b.id}/").status_code, 404)
        self.assertTrue(CylinderType.all_rows().filter(pk=self.cylinder_b.pk).exists())

    def test_foreign_keys_to_another_tenant_are_rejected(self):
        self.bearer(self.admin)
        response = self.client.post(
            "/api/customer-rates/",
            {"customer": self.customer.id, "cylinder_type": self.cylinder_b.id, "custom_price": "10.00"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertFalse(CustomerCylinderRate.all_rows().exists())

        response = self.client.post(
            "/api/auth/register/",
            {"username": "newstaff", "full_name": "New Staff", "phone": "9111111111", "role": "staff",
             "vehicle_location": self.location_b.id},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertFalse(User.all_tenants.filter(username="newstaff").exists())

    def test_created_rows_belong_to_the_callers_tenant(self):
        self.bearer(self.admin_b)
        response = self.client.post("/api/locations/", {"name": "Godown"}, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(StockLocation.all_rows().get(pk=response.json()["id"]).tenant_id, self.tenant_b.id)

        response = self.client.post(
            "/api/auth/register/",
            {"username": "b_staff2", "full_name": "B Staff", "phone": "8111111111", "role": "staff"},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(User.all_tenants.get(username="b_staff2").tenant_id, self.tenant_b.id)

    def test_usernames_are_unique_across_tenants(self):
        self.bearer(self.admin)
        response = self.client.post(
            "/api/auth/register/",
            {"username": "admin_b", "full_name": "Clash", "phone": "9222222222", "role": "staff"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_agency_admin_cannot_create_a_platform_admin(self):
        Role.objects.create(name="Platform Admin", code=PLATFORM_ROLE)
        self.bearer(self.admin)
        response = self.client.post(
            "/api/auth/register/",
            {"username": "sneaky", "full_name": "Sneaky", "phone": "9333333333", "role": PLATFORM_ROLE},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertNotIn(PLATFORM_ROLE, {r["code"] for r in self.client.get("/api/auth/roles/").json()})

    def test_writing_another_tenants_row_is_refused(self):
        with tenant_context(self.tenant_a):
            self.cylinder_b.name = "Hijacked"
            with self.assertRaises(PermissionDenied):
                self.cylinder_b.save()

    def test_me_reports_the_tenant(self):
        self.bearer(self.admin_b)
        tenant = self.client.get("/api/auth/me/").json()["tenant"]
        self.assertEqual(tenant, {"id": self.tenant_b.id, "name": "Other Gas", "slug": "other-gas", "is_default": False})


class PlatformTests(TenantFixtures):
    def setUp(self):
        super().setUp()
        self.platform_role = Role.objects.create(name="Platform Admin", code=PLATFORM_ROLE)
        self.operator = User.objects.create_user(username="operator", password=PASSWORD, role=self.platform_role)

    def test_platform_admin_has_no_tenant_and_sees_no_tenant_data(self):
        self.assertIsNone(self.operator.tenant_id)
        self.bearer(self.operator)
        self.assertEqual(self.client.get("/api/cylinder-types/").json()["results"], [])
        self.assertEqual(self.client.get("/api/auth/me/").json()["redirect"], "/platform")

    def test_agency_admin_cannot_use_the_platform_api(self):
        self.bearer(self.admin)
        self.assertEqual(self.client.get("/api/platform/tenants/").status_code, 403)
        self.assertEqual(self.client.post("/api/platform/tenants/", {"name": "X"}, format="json").status_code, 403)

    def test_create_tenant_with_locations_and_first_admin(self):
        self.bearer(self.operator)
        response = self.client.post(
            "/api/platform/tenants/",
            {"name": "City Gas Agency", "admin_username": "cityadmin", "admin_full_name": "City Admin", "admin_phone": "7000000001"},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        body = response.json()
        self.assertEqual(body["slug"], "city-gas-agency")
        tenant = Tenant.objects.get(pk=body["id"])
        self.assertEqual(
            set(StockLocation.all_rows().filter(tenant=tenant).values_list("code", flat=True)), {"shop", "supplier"}
        )
        admin = User.all_tenants.get(username="cityadmin")
        self.assertEqual((admin.tenant_id, admin.role.code, admin.must_change_password), (tenant.id, "admin", True))
        self.assertTrue(admin.check_password(body["admin"]["temporary_password"]))

        listed = {t["slug"]: t for t in self.client.get("/api/platform/tenants/").json()}
        self.assertEqual(listed["city-gas-agency"]["user_count"], 1)

    def test_duplicate_slug_and_username_are_rejected(self):
        self.bearer(self.operator)
        payload = {"name": "Other Gas", "admin_username": "fresh", "admin_full_name": "F", "admin_phone": "7000000002"}
        self.assertEqual(self.client.post("/api/platform/tenants/", payload, format="json").status_code, 400)
        payload = {"name": "Brand New", "admin_username": "admin_b", "admin_full_name": "F", "admin_phone": "7000000003"}
        self.assertEqual(self.client.post("/api/platform/tenants/", payload, format="json").status_code, 400)
        self.assertFalse(Tenant.objects.filter(slug="brand-new").exists())

    def test_suspended_tenant_cannot_log_in_or_use_the_api(self):
        self.bearer(self.operator)
        response = self.client.patch(f"/api/platform/tenants/{self.tenant_b.id}/", {"is_active": False}, format="json")
        self.assertEqual(response.status_code, 200)

        self.bearer(self.admin_b)
        response = self.client.get("/api/cylinder-types/")
        self.assertEqual((response.status_code, response.json()["code"]), (403, "tenant_inactive"))

        self.client.credentials()
        response = self.client.post("/api/auth/token/", {"username": "admin_b", "password": PASSWORD}, format="json")
        self.assertEqual((response.status_code, response.json()["code"]), (403, "tenant_inactive"))

        # The other tenant is unaffected.
        self.bearer(self.admin)
        self.assertEqual(self.client.get("/api/cylinder-types/").status_code, 200)


class CustomerAppTenancyTests(TenantFixtures):
    def setUp(self):
        super().setUp()
        Tenant.objects.filter(pk=self.tenant_b.pk).update(address="1 Market Road", tax_id="GST-B")
        with tenant_context(self.tenant_b):
            self.customer_sale_b = Sale.objects.create(
                customer=self.customer_b, location=self.location_b, sold_by=self.admin_b,
                total_amount=Decimal("1400.00"), paid_amount=Decimal("1400.00"), payment_mode="cash",
            )
            SaleItem.objects.create(
                sale=self.customer_sale_b, cylinder_type=self.cylinder_b, quantity=1,
                rate=Decimal("1400.00"), total_amount=Decimal("1400.00"),
            )

    @override_settings(RECEIPT_BUSINESS_DETAILS={"address": "Sabco office", "phone": "", "email": "", "tax_id": ""})
    def test_receipts_carry_the_customers_agency(self):
        self.bearer(self.customer_b.user)
        business = self.client.get(f"/api/receipts/sale/{self.customer_sale_b.pk}/").json()["business"]
        # The deployment-wide settings only fill in for the original agency.
        self.assertEqual(business, {"name": "Other Gas", "address": "1 Market Road", "tax_id": "GST-B"})

    def test_customer_cannot_read_another_agencys_receipt(self):
        self.bearer(self.customer_user)
        self.assertEqual(self.client.get(f"/api/receipts/sale/{self.customer_sale_b.pk}/").status_code, 404)

    def test_direct_sale_history_names_the_agency(self):
        self.bearer(self.customer_b.user)
        rows = self.client.get("/api/bookings/history/").json()
        rows = rows["results"] if isinstance(rows, dict) else rows
        direct = [r for r in rows if r["history_source"] == "sale"]
        self.assertEqual([r["assigned_staff_name"] for r in direct], ["Other Gas"])
        self.assertTrue(direct[0]["detail_message"].startswith("Direct sale by Other Gas."))

    def test_customer_me_reports_the_agency(self):
        self.bearer(self.customer_b.user)
        self.assertEqual(
            self.client.get("/api/auth/me/").json()["tenant"],
            {"id": self.tenant_b.id, "name": "Other Gas", "slug": "other-gas", "is_default": False},
        )

    def test_customer_of_a_suspended_agency_cannot_log_in(self):
        Tenant.objects.filter(pk=self.tenant_b.pk).update(is_active=False)
        response = self.client.post(
            "/api/auth/token/", {"username": "cust_b", "password": PASSWORD, "client": "customer"}, format="json"
        )
        self.assertEqual((response.status_code, response.json()["code"]), (403, "tenant_inactive"))


class PlatformDetailsTests(TenantFixtures):
    def test_platform_admin_edits_receipt_details(self):
        operator = User.objects.create_user(
            username="operator", password=PASSWORD, role=Role.objects.create(name="Platform Admin", code=PLATFORM_ROLE)
        )
        self.bearer(operator)
        url = f"/api/platform/tenants/{self.tenant_b.id}/"
        response = self.client.patch(url, {"address": " 2  Hill Road ", "email": "office@other.example"}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual((response.json()["address"], response.json()["email"]), ("2 Hill Road", "office@other.example"))
        self.assertEqual(self.client.patch(url, {"email": "not-an-email"}, format="json").status_code, 400)
