from decimal import Decimal

from django.db.models import ProtectedError
from rest_framework_simplejwt.tokens import RefreshToken

from core.models import (
    ActivityLog,
    Booking,
    CustomerProfile,
    Delivery,
    Payment,
    Sale,
    StaffProfile,
    User,
)

from .base import PASSWORD, GasBookTestCase


class DeletionTestCase(GasBookTestCase):
    def make_sale(self, customer=None, sold_by=None, total="900.00"):
        return Sale.objects.create(
            customer=customer or self.customer,
            location=self.shop,
            total_amount=Decimal(total),
            original_amount=Decimal(total),
            paid_amount=Decimal("0"),
            balance_due=Decimal(total),
            payment_mode=Sale.PaymentMode.CREDIT,
            sold_by=sold_by or self.admin,
        )

    def make_customer(self, username="cust2", phone="9000000099"):
        user = User.objects.create_user(
            username=username, password=PASSWORD, role=self.customer_role, first_name="Typo", last_name="Account", phone=phone
        )
        return CustomerProfile.objects.create(user=user)

    def bearer(self, user):
        token = str(RefreshToken.for_user(user).access_token)
        self.client.force_authenticate(None)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")


class CustomerDeletionTests(DeletionTestCase):
    def test_delete_zero_history_customer_via_both_urls(self):
        self.auth(self.admin)
        first = self.make_customer("typo1", "9000000011")
        response = self.client.delete(f"/api/customers/{first.pk}/")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.json(), {"detail": "Customer deleted.", "mode": "deleted"})
        self.assertFalse(User.objects.filter(username="typo1").exists())
        self.assertFalse(CustomerProfile.objects.filter(pk=first.pk).exists())
        log = ActivityLog.objects.get(action="customer_deleted")
        self.assertEqual(log.user, self.admin)
        self.assertEqual(log.metadata["username"], "typo1")

        second = self.make_customer("typo2", "9000000012")
        response = self.client.delete(f"/api/customers/{second.pk}/credentials/")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.json()["mode"], "deleted")
        self.assertFalse(User.objects.filter(username="typo2").exists())

    def test_delete_customer_with_history_is_409_and_nothing_deleted(self):
        self.auth(self.admin)
        sale = self.make_sale()
        booking = self.make_booking(status=Booking.Status.DELIVERED)
        Payment.objects.create(customer=self.customer, amount=Decimal("100.00"), received_by=self.admin)

        for url in (f"/api/customers/{self.customer.pk}/", f"/api/customers/{self.customer.pk}/credentials/"):
            response = self.client.delete(url)
            self.assertEqual(response.status_code, 409, response.data)
            body = response.json()
            self.assertEqual(body["code"], "has_history")
            self.assertIn("Deactivate the account instead.", body["detail"])
            self.assertEqual(body["counts"], {"sales": 1, "payments": 1, "bookings": 1})
            # opening_balance 0 + balance_due 900 - unlinked payment 100
            self.assertEqual(body["pending_amount"], "800.00")
            self.assertIs(body["is_active"], True)

        self.assertTrue(User.objects.filter(pk=self.customer_user.pk).exists())
        self.assertTrue(Sale.objects.filter(pk=sale.pk).exists())
        self.assertTrue(Booking.objects.filter(pk=booking.pk).exists())
        self.assertEqual(Payment.objects.count(), 1)
        self.assertFalse(ActivityLog.objects.filter(action="customer_deleted").exists())

    def test_opening_balance_or_deposit_counts_as_history(self):
        self.auth(self.admin)
        with_balance = self.make_customer("bal", "9000000013")
        with_balance.opening_balance = Decimal("50.00")
        with_balance.save(update_fields=["opening_balance"])
        response = self.client.delete(f"/api/customers/{with_balance.pk}/")
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["counts"], {"sales": 0, "payments": 0, "bookings": 0})
        self.assertEqual(response.json()["pending_amount"], "50.00")

        with_deposit = self.make_customer("dep", "9000000014")
        with_deposit.deposit_cylinders = 2
        with_deposit.save(update_fields=["deposit_cylinders"])
        response = self.client.delete(f"/api/customers/{with_deposit.pk}/")
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["code"], "has_history")

    def test_deactivate_blocked_by_open_orders_then_allowed_and_login_fails(self):
        self.auth(self.admin)
        booking = self.make_booking(status=Booking.Status.PENDING)
        delivered = self.make_booking(status=Booking.Status.DELIVERED)

        response = self.client.post(f"/api/customers/{self.customer.pk}/deactivate/")
        self.assertEqual(response.status_code, 409, response.data)
        body = response.json()
        self.assertEqual(body["code"], "has_open_orders")
        self.assertEqual(body["open_order_ids"], [f"GB{booking.pk}"])
        self.assertEqual(body["detail"], "Customer has 1 open order(s). Reject or complete them first.")
        self.customer_user.refresh_from_db()
        self.assertTrue(self.customer_user.is_active)

        # Reject the open order through the API, then deactivation succeeds.
        response = self.client.post(f"/api/bookings/{booking.pk}/reject/", {"reason": "Out of area"}, format="json")
        self.assertEqual(response.status_code, 200, response.data)

        # Token issued while active must stop working after deactivation.
        customer_token = str(RefreshToken.for_user(self.customer_user).access_token)

        response = self.client.post(f"/api/customers/{self.customer.pk}/deactivate/")
        self.assertEqual(response.status_code, 200, response.data)
        body = response.json()
        self.assertEqual(body["mode"], "deactivated")
        self.assertEqual(body["detail"], "Customer deactivated. Ledger and order history are preserved.")
        self.assertIs(body["customer"]["is_active"], False)
        self.assertEqual(body["customer"]["id"], self.customer.pk)
        self.assertIn("pending_amount", body)
        self.customer_user.refresh_from_db()
        self.customer.refresh_from_db()
        self.assertFalse(self.customer_user.is_active)
        self.assertFalse(self.customer.is_active)
        self.assertTrue(Booking.objects.filter(pk=delivered.pk).exists())
        self.assertTrue(ActivityLog.objects.filter(action="customer_deactivated", user=self.admin).exists())

        # Idempotent.
        response = self.client.post(f"/api/customers/{self.customer.pk}/deactivate/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["mode"], "deactivated")

        # Login fails and the old token is rejected.
        self.client.force_authenticate(None)
        self.client.credentials()
        response = self.client.post("/api/auth/token/", {"username": "cust1", "password": PASSWORD}, format="json")
        self.assertEqual(response.status_code, 401, response.data)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {customer_token}")
        response = self.client.get("/api/bookings/")
        self.assertEqual(response.status_code, 401, response.data)
        self.client.credentials()

        # Reactivate -> login works again.
        self.auth(self.admin)
        response = self.client.post(f"/api/customers/{self.customer.pk}/reactivate/")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.json()["mode"], "reactivated")
        self.assertIs(response.json()["customer"]["is_active"], True)
        self.customer_user.refresh_from_db()
        self.assertTrue(self.customer_user.is_active)
        self.assertTrue(ActivityLog.objects.filter(action="customer_reactivated").exists())

        self.client.force_authenticate(None)
        response = self.client.post("/api/auth/token/", {"username": "cust1", "password": PASSWORD}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.json()["role"], "customer")

    def test_pending_balance_does_not_block_deactivation(self):
        self.auth(self.admin)
        self.make_sale()
        response = self.client.post(f"/api/customers/{self.customer.pk}/deactivate/")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.json()["pending_amount"], "900.00")

    def test_customer_delete_and_deactivate_are_admin_only(self):
        self.auth(self.staff_a)
        self.assertEqual(self.client.delete(f"/api/customers/{self.customer.pk}/").status_code, 403)
        self.assertEqual(self.client.delete(f"/api/customers/{self.customer.pk}/credentials/").status_code, 403)
        self.assertEqual(self.client.post(f"/api/customers/{self.customer.pk}/deactivate/").status_code, 403)
        self.assertEqual(self.client.post(f"/api/customers/{self.customer.pk}/reactivate/").status_code, 403)
        self.auth(self.customer_user)
        self.assertEqual(self.client.delete(f"/api/customers/{self.customer.pk}/").status_code, 403)
        self.assertEqual(self.client.post(f"/api/customers/{self.customer.pk}/deactivate/").status_code, 403)
        self.assertTrue(User.objects.filter(pk=self.customer_user.pk).exists())

    def test_patch_is_active_mirrors_to_user(self):
        self.auth(self.admin)
        response = self.client.patch(f"/api/customers/{self.customer.pk}/", {"is_active": False}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.customer_user.refresh_from_db()
        self.assertFalse(self.customer_user.is_active)
        response = self.client.patch(f"/api/customers/{self.customer.pk}/", {"is_active": True}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.customer_user.refresh_from_db()
        self.assertTrue(self.customer_user.is_active)

    def test_staff_cannot_patch_is_active(self):
        self.auth(self.staff_a)
        response = self.client.patch(f"/api/customers/{self.customer.pk}/", {"is_active": False}, format="json")
        self.assertEqual(response.status_code, 403, response.data)
        self.assertEqual(response.json()["code"], "forbidden")
        self.assertEqual(response.json()["detail"], "Only admins can change account status.")
        self.customer_user.refresh_from_db()
        self.customer.refresh_from_db()
        self.assertTrue(self.customer_user.is_active)
        self.assertTrue(self.customer.is_active)
        self.assertFalse(ActivityLog.objects.filter(action="customer_deactivated").exists())

        # Staff also cannot silently re-enable an account an admin deactivated.
        self.auth(self.admin)
        self.assertEqual(self.client.post(f"/api/customers/{self.customer.pk}/deactivate/").status_code, 200)
        self.auth(self.staff_a)
        response = self.client.patch(f"/api/customers/{self.customer.pk}/", {"is_active": True}, format="json")
        self.assertEqual(response.status_code, 403, response.data)
        self.customer_user.refresh_from_db()
        self.assertFalse(self.customer_user.is_active)

        # Other profile fields are still editable by staff.
        response = self.client.patch(f"/api/customers/{self.customer.pk}/", {"area": "North"}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.json()["area"], "North")

    def test_admin_patch_is_active_uses_deactivate_policy(self):
        self.auth(self.admin)
        booking = self.make_booking(status=Booking.Status.PENDING)
        response = self.client.patch(
            f"/api/customers/{self.customer.pk}/", {"is_active": False, "area": "South"}, format="json"
        )
        self.assertEqual(response.status_code, 409, response.data)
        body = response.json()
        self.assertEqual(body["code"], "has_open_orders")
        self.assertEqual(body["open_order_ids"], [f"GB{booking.pk}"])
        self.customer_user.refresh_from_db()
        self.customer.refresh_from_db()
        self.assertTrue(self.customer_user.is_active)
        self.assertTrue(self.customer.is_active)
        self.assertEqual(self.customer.area, "")  # no partial write

        booking.status = Booking.Status.DELIVERED
        booking.save(update_fields=["status"])
        response = self.client.patch(f"/api/customers/{self.customer.pk}/", {"is_active": False}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertIs(response.json()["is_active"], False)
        self.customer_user.refresh_from_db()
        self.assertFalse(self.customer_user.is_active)
        self.assertEqual(ActivityLog.objects.filter(action="customer_deactivated", user=self.admin).count(), 1)

        # Echoing the current flag is a no-op (no extra audit row).
        response = self.client.patch(f"/api/customers/{self.customer.pk}/", {"is_active": False}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(ActivityLog.objects.filter(action="customer_deactivated").count(), 1)

        response = self.client.patch(f"/api/customers/{self.customer.pk}/", {"is_active": True}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.customer_user.refresh_from_db()
        self.assertTrue(self.customer_user.is_active)
        self.assertEqual(ActivityLog.objects.filter(action="customer_reactivated", user=self.admin).count(), 1)

    def test_password_reset_does_not_reactivate_customer(self):
        self.auth(self.admin)
        self.client.post(f"/api/customers/{self.customer.pk}/deactivate/")
        self.customer_user.refresh_from_db()
        self.assertFalse(self.customer_user.is_active)

        response = self.client.post(f"/api/customers/{self.customer.pk}/credentials/", {}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertIn("temporary_password", response.json())
        self.customer_user.refresh_from_db()
        self.assertFalse(self.customer_user.is_active)
        self.assertTrue(self.customer_user.must_change_password)

    def test_inactive_profile_cannot_place_booking(self):
        self.customer.is_active = False
        self.customer.save(update_fields=["is_active"])
        self.auth(self.customer_user)
        response = self.client.post(
            "/api/bookings/", {"cylinder_type": self.cylinder.id, "quantity": 1}, format="json"
        )
        self.assertEqual(response.status_code, 403, response.data)
        self.assertEqual(response.json(), {"detail": "This account is inactive.", "code": "inactive"})
        self.assertEqual(Booking.objects.count(), 0)


class UserDeletionTests(DeletionTestCase):
    def test_staff_with_delivery_is_409_has_history(self):
        self.auth(self.admin)
        booking, delivery = self.assigned_booking(staff=self.staff_a, delivery_status=Delivery.Status.DELIVERED, booking_status=Booking.Status.DELIVERED)
        self.customer.default_staff = self.staff_a
        self.customer.save(update_fields=["default_staff"])

        response = self.client.delete(f"/api/auth/users/{self.staff_a.pk}/")
        self.assertEqual(response.status_code, 409, response.data)
        body = response.json()
        self.assertEqual(body["code"], "has_history")
        self.assertEqual(body["counts"]["deliveries"], 1)
        self.assertEqual(body["counts"]["bookings"], 1)  # assigned_bookings
        self.assertEqual(body["default_staff_customers"], 1)
        self.assertIs(body["is_active"], True)
        self.assertTrue(User.objects.filter(pk=self.staff_a.pk).exists())
        self.assertTrue(Delivery.objects.filter(pk=delivery.pk).exists())

        # Same policy via the staff-profiles router.
        response = self.client.delete(f"/api/staff-profiles/{self.staff_a_profile.pk}/")
        self.assertEqual(response.status_code, 409, response.data)
        self.assertEqual(response.json()["code"], "has_history")
        self.assertTrue(StaffProfile.objects.filter(pk=self.staff_a_profile.pk).exists())

    def test_staff_with_sales_or_payments_is_409(self):
        self.auth(self.admin)
        self.make_sale(sold_by=self.staff_b)
        response = self.client.delete(f"/api/auth/users/{self.staff_b.pk}/")
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["counts"]["sales"], 1)
        self.assertTrue(Sale.objects.filter(sold_by=self.staff_b).exists())

    def test_zero_history_staff_is_deleted_via_both_urls(self):
        self.auth(self.admin)
        response = self.client.delete(f"/api/auth/users/{self.staff_a.pk}/")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.json(), {"detail": "User deleted.", "mode": "deleted"})
        self.assertFalse(User.objects.filter(pk=self.staff_a.pk).exists())
        self.assertFalse(StaffProfile.objects.filter(pk=self.staff_a_profile.pk).exists())
        log = ActivityLog.objects.get(action="user_deleted")
        self.assertEqual(log.user, self.admin)
        self.assertEqual(log.metadata["username"], "staffa")

        response = self.client.delete(f"/api/staff-profiles/{self.staff_b_profile.pk}/")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.json()["mode"], "deleted")
        self.assertFalse(User.objects.filter(pk=self.staff_b.pk).exists())

    def test_self_delete_and_self_deactivate_are_400(self):
        self.auth(self.admin)
        response = self.client.delete(f"/api/auth/users/{self.admin.pk}/")
        self.assertEqual(response.status_code, 400, response.data)
        self.assertEqual(response.json(), {"detail": "You cannot delete or deactivate your own account.", "code": "self_action"})
        response = self.client.post(f"/api/auth/users/{self.admin.pk}/deactivate/")
        self.assertEqual(response.status_code, 400, response.data)
        self.assertEqual(response.json()["code"], "self_action")
        self.admin.refresh_from_db()
        self.assertTrue(self.admin.is_active)

    def test_deactivate_staff_blocked_by_open_delivery_then_allowed(self):
        self.auth(self.admin)
        booking, delivery = self.assigned_booking(staff=self.staff_a)
        self.customer.default_staff = self.staff_a
        self.customer.save(update_fields=["default_staff"])

        response = self.client.post(f"/api/auth/users/{self.staff_a.pk}/deactivate/")
        self.assertEqual(response.status_code, 409, response.data)
        body = response.json()
        self.assertEqual(body["code"], "has_open_deliveries")
        self.assertEqual(body["open_order_ids"], [booking.order_id])
        self.assertEqual(body["detail"], "Staff has 1 open deliver(ies). Reassign or complete them first.")

        # Re-assign to staff B through the API, then deactivate A.
        response = self.client.post(f"/api/bookings/{booking.pk}/approve/", {"assigned_staff": self.staff_b.pk}, format="json")
        self.assertEqual(response.status_code, 200, response.data)

        staff_token = str(RefreshToken.for_user(self.staff_a).access_token)
        response = self.client.post(f"/api/auth/users/{self.staff_a.pk}/deactivate/")
        self.assertEqual(response.status_code, 200, response.data)
        body = response.json()
        self.assertEqual(body["mode"], "deactivated")
        self.assertEqual(body["detail"], "User deactivated. History is preserved.")
        self.assertEqual(body["default_staff_customers"], 1)
        self.assertIs(body["user"]["is_active"], False)
        self.assertEqual(body["user"]["id"], self.staff_a.pk)
        self.staff_a.refresh_from_db()
        self.staff_a_profile.refresh_from_db()
        self.assertFalse(self.staff_a.is_active)
        self.assertFalse(self.staff_a_profile.is_active)
        self.customer.refresh_from_db()
        self.assertEqual(self.customer.default_staff_id, self.staff_a.pk)  # not cleared
        self.assertTrue(ActivityLog.objects.filter(action="user_deactivated", user=self.admin).exists())

        # Token no longer works; users list flags inactive.
        response = self.client.get("/api/auth/users/")
        rows = {row["id"]: row for row in response.json()}
        self.assertIs(rows[self.staff_a.pk]["is_active"], False)
        self.assertIs(rows[self.staff_b.pk]["is_active"], True)

        self.client.force_authenticate(None)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token}")
        self.assertEqual(self.client.get("/api/deliveries/").status_code, 401)
        self.client.credentials()
        response = self.client.post("/api/auth/token/", {"username": "staffa", "password": PASSWORD}, format="json")
        self.assertEqual(response.status_code, 401)

        # Reactivate mirrors back to both rows.
        self.auth(self.admin)
        response = self.client.post(f"/api/auth/users/{self.staff_a.pk}/reactivate/")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.json()["mode"], "reactivated")
        self.assertIs(response.json()["user"]["is_active"], True)
        self.staff_a.refresh_from_db()
        self.staff_a_profile.refresh_from_db()
        self.assertTrue(self.staff_a.is_active)
        self.assertTrue(self.staff_a_profile.is_active)

    def test_user_endpoints_are_admin_only(self):
        self.auth(self.staff_a)
        self.assertEqual(self.client.delete(f"/api/staff-profiles/{self.staff_b_profile.pk}/").status_code, 403)
        self.assertEqual(self.client.delete(f"/api/auth/users/{self.staff_b.pk}/").status_code, 403)
        self.assertEqual(self.client.post(f"/api/auth/users/{self.staff_b.pk}/deactivate/").status_code, 403)
        self.assertEqual(self.client.post(f"/api/auth/users/{self.staff_b.pk}/reactivate/").status_code, 403)
        self.assertTrue(User.objects.filter(pk=self.staff_b.pk).exists())
        # Customers are never listed under /auth/users/.
        self.auth(self.admin)
        self.assertEqual(self.client.delete(f"/api/auth/users/{self.customer_user.pk}/").status_code, 404)
        self.assertEqual(self.client.post(f"/api/auth/users/{self.customer_user.pk}/deactivate/").status_code, 404)

    def test_password_reset_does_not_reactivate_user(self):
        self.auth(self.admin)
        self.client.post(f"/api/auth/users/{self.staff_a.pk}/deactivate/")
        self.staff_a.refresh_from_db()
        self.assertFalse(self.staff_a.is_active)
        response = self.client.post(f"/api/auth/users/{self.staff_a.pk}/credentials/", {}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.staff_a.refresh_from_db()
        self.assertFalse(self.staff_a.is_active)
        self.assertTrue(self.staff_a.must_change_password)


class ProtectBehaviourTests(DeletionTestCase):
    def test_model_level_delete_is_protected_by_history(self):
        self.make_sale()
        with self.assertRaises(ProtectedError):
            self.customer_user.delete()
        self.assertTrue(User.objects.filter(pk=self.customer_user.pk).exists())

        self.assigned_booking(staff=self.staff_a)
        with self.assertRaises(ProtectedError):
            self.staff_a.delete()

        Payment.objects.create(customer=self.customer, amount=Decimal("1.00"), received_by=self.staff_b)
        with self.assertRaises(ProtectedError):
            self.staff_b.delete()

    def test_activity_log_survives_actor_deletion(self):
        # ActivityLog.user is SET_NULL (was CASCADE): an out-of-band user delete keeps the audit row.
        log = ActivityLog.objects.create(action="x", description="y", user=self.staff_b)
        self.staff_b.delete()
        log.refresh_from_db()
        self.assertIsNone(log.user)

    def test_protected_error_from_a_real_endpoint_is_409_json(self):
        self.auth(self.admin)
        self.make_booking(status=Booking.Status.PENDING)  # Booking.cylinder_type is PROTECT
        response = self.client.delete(f"/api/cylinder-types/{self.cylinder.pk}/")
        self.assertEqual(response.status_code, 409, response.data)
        self.assertEqual(response.json()["code"], "protected")
        self.assertTrue(self.cylinder.__class__.objects.filter(pk=self.cylinder.pk).exists())
