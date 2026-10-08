from decimal import Decimal

from django.utils import timezone
from rest_framework.test import APITestCase

from core.models import (
    Booking,
    CustomerProfile,
    CylinderType,
    Delivery,
    Notification,
    Role,
    StaffProfile,
    Stock,
    StockLocation,
    User,
)

PASSWORD = "Init-Pass-2026!"


class GasBookTestCase(APITestCase):
    """Shared fixtures: admin, staff A, staff B, customer; a cylinder type; the `shop` location."""

    def setUp(self):
        super().setUp()
        self.admin_role = Role.objects.create(name="Admin", code="admin")
        self.staff_role = Role.objects.create(name="Staff", code="staff")
        self.customer_role = Role.objects.create(name="Customer", code="customer")

        self.admin = User.objects.create_user(
            username="admin1", password=PASSWORD, role=self.admin_role, first_name="Ad", last_name="Min", phone="9000000001"
        )
        self.staff_a = User.objects.create_user(
            username="staffa", password=PASSWORD, role=self.staff_role, first_name="Staff", last_name="A", phone="9000000002"
        )
        self.staff_b = User.objects.create_user(
            username="staffb", password=PASSWORD, role=self.staff_role, first_name="Staff", last_name="B", phone="9000000003"
        )
        self.staff_a_profile = StaffProfile.objects.create(user=self.staff_a)
        self.staff_b_profile = StaffProfile.objects.create(user=self.staff_b)
        self.customer_user = User.objects.create_user(
            username="cust1", password=PASSWORD, role=self.customer_role, first_name="Cust", last_name="One",
            phone="9000000004", address="12 Main Street",
        )
        self.customer = CustomerProfile.objects.create(user=self.customer_user)

        self.cylinder = CylinderType.objects.create(
            name="14kg Domestic", weight=Decimal("14.20"), selling_price=Decimal("900.00")
        )
        self.shop = StockLocation.objects.create(name="Shop", code="shop")

    # ---- helpers -------------------------------------------------------
    def auth(self, user):
        self.client.force_authenticate(user)

    def make_booking(self, status=Booking.Status.PENDING, quantity=2, assigned_staff=None, customer=None, **kwargs):
        customer = customer or self.customer
        pricing = customer.calculate_booking_pricing(self.cylinder, quantity)
        defaults = {
            "original_amount": pricing["original_amount"],
            "discount_amount": pricing["discount_amount"],
            "final_amount": pricing["final_amount"],
            "delivery_address": customer.user.address,
            "delivery_phone": customer.user.phone,
        }
        defaults.update(kwargs)
        booking = Booking.objects.create(
            customer=customer,
            cylinder_type=self.cylinder,
            quantity=quantity,
            status=status,
            assigned_staff=assigned_staff,
            **defaults,
        )
        if assigned_staff is not None and status != Booking.Status.PENDING:
            booking.approved_by = self.admin
            booking.approved_at = timezone.now()
            booking.save(update_fields=["approved_by", "approved_at"])
        return booking

    def make_delivery(self, booking, staff, status=Delivery.Status.ASSIGNED, **kwargs):
        return Delivery.objects.create(booking=booking, staff=staff, status=status, **kwargs)

    def set_stock(self, location, filled=None, empty=None, cylinder=None):
        cylinder = cylinder or self.cylinder
        rows = {}
        if filled is not None:
            rows["filled"], _ = Stock.objects.update_or_create(
                cylinder_type=cylinder, location=location, status=Stock.Status.FILLED, defaults={"quantity": filled}
            )
        if empty is not None:
            rows["empty"], _ = Stock.objects.update_or_create(
                cylinder_type=cylinder, location=location, status=Stock.Status.EMPTY, defaults={"quantity": empty}
            )
        return rows

    def stock_qty(self, location, status, cylinder=None):
        row = Stock.objects.filter(cylinder_type=cylinder or self.cylinder, location=location, status=status).first()
        return row.quantity if row else 0

    def notifications(self, recipient, notification_type, booking=None):
        qs = Notification.objects.filter(recipient=recipient, notification_type=notification_type)
        if booking is not None:
            qs = qs.filter(booking=booking)
        return qs

    def assigned_booking(self, staff=None, delivery_status=Delivery.Status.ASSIGNED, booking_status=Booking.Status.APPROVED, quantity=2):
        staff = staff or self.staff_a
        booking = self.make_booking(status=booking_status, assigned_staff=staff, quantity=quantity)
        delivery = self.make_delivery(booking, staff, status=delivery_status)
        return booking, delivery
