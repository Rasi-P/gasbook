from decimal import Decimal, ROUND_HALF_UP

from django.conf import settings
from django.contrib.auth.models import AbstractUser
from django.db import models


def quantize_money(value):
    return Decimal(value).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


class User(AbstractUser):
    role = models.ForeignKey("Role", on_delete=models.PROTECT, null=True, blank=True, related_name="users")
    plain_password = models.CharField(max_length=128, blank=True, default="")
    must_change_password = models.BooleanField(default=False)
    phone = models.CharField(max_length=20, blank=True)
    address = models.TextField(blank=True)


class TimeStampedModel(models.Model):
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class Role(TimeStampedModel):
    name = models.CharField(max_length=50, unique=True)
    code = models.SlugField(max_length=50, unique=True)
    
    objects = models.Manager()

    def __str__(self):
        return self.name


class CylinderType(TimeStampedModel):
    name = models.CharField(max_length=80)
    weight = models.DecimalField(max_digits=5, decimal_places=2)
    selling_price = models.DecimalField(max_digits=10, decimal_places=2)
    deposit_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    refill_rate = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    low_stock_threshold = models.PositiveIntegerField(default=5)
    is_active = models.BooleanField(default=True)

    objects = models.Manager()

    class Meta:
        ordering = ["weight", "name"]

    def __str__(self):
        return self.name


class StockLocation(TimeStampedModel):
    name = models.CharField(max_length=80)
    code = models.SlugField(max_length=40, unique=True)
    is_main_supplier = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    
    objects = models.Manager()

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class Stock(TimeStampedModel):
    class Status(models.TextChoices):
        FILLED = "filled", "Filled"
        EMPTY = "empty", "Empty"

    cylinder_type = models.ForeignKey(CylinderType, on_delete=models.CASCADE, related_name="stocks")
    location = models.ForeignKey(StockLocation, on_delete=models.CASCADE, related_name="stocks")
    status = models.CharField(max_length=10, choices=Status.choices)
    quantity = models.PositiveIntegerField(default=0)
    
    objects = models.Manager()

    class Meta:
        unique_together = ("cylinder_type", "location", "status")
        ordering = ["location__name", "cylinder_type__weight", "status"]

    def __str__(self):
        return f"{self.location} - {self.cylinder_type} - {self.status}: {self.quantity}"


class StockMovement(TimeStampedModel):
    cylinder_type = models.ForeignKey(CylinderType, on_delete=models.PROTECT)
    from_location = models.ForeignKey(StockLocation, on_delete=models.PROTECT, related_name="outgoing_movements")
    to_location = models.ForeignKey(StockLocation, on_delete=models.PROTECT, related_name="incoming_movements")
    status = models.CharField(max_length=10, choices=Stock.Status.choices)
    quantity = models.PositiveIntegerField()
    moved_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    note = models.CharField(max_length=200, blank=True)

    objects = models.Manager()

    class Meta:
        ordering = ["-created_at"]


class CustomerProfile(TimeStampedModel):
    class DiscountType(models.TextChoices):
        PERCENTAGE = "percentage", "Percentage"
        FIXED = "fixed", "Fixed Amount"

    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="customer_profile")
    opening_balance = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    area = models.CharField(max_length=100, blank=True)
    default_staff = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="assigned_customers")
    credit_limit = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    deposit_cylinders = models.PositiveIntegerField(default=0)
    global_discount_type = models.CharField(max_length=20, choices=DiscountType.choices, null=True, blank=True)
    global_discount_value = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    global_discount_is_active = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    
    objects = models.Manager()

    class Meta:
        ordering = ["user__username"]

    def __str__(self):
        return self.user.get_full_name() or self.user.username

    def get_rate_for_cylinder(self, cylinder_type):
        prefetched_rates = getattr(self, "_prefetched_objects_cache", {}).get("custom_rates")
        if prefetched_rates is not None:
            custom = next((rate for rate in prefetched_rates if rate.cylinder_type_id == cylinder_type.id), None)
        else:
            custom = self.custom_rates.filter(cylinder_type=cylinder_type).first()
        return custom.custom_price if custom else cylinder_type.selling_price

    def get_active_discount_for_cylinder(self, cylinder_type):
        prefetched_discounts = getattr(self, "_prefetched_objects_cache", {}).get("cylinder_discounts")
        if prefetched_discounts is not None:
            discount = next(
                (
                    item
                    for item in prefetched_discounts
                    if item.cylinder_type_id == cylinder_type.id and item.is_active
                ),
                None,
            )
        else:
            discount = self.cylinder_discounts.filter(cylinder_type=cylinder_type, is_active=True).first()

        if not discount or not discount.discount_type or discount.discount_value <= 0:
            return None
        return discount

    def get_discount_configuration(self, cylinder_type=None):
        if cylinder_type is not None:
            cylinder_discount = self.get_active_discount_for_cylinder(cylinder_type)
            if cylinder_discount:
                return {
                    "scope": "cylinder",
                    "type": cylinder_discount.discount_type,
                    "value": quantize_money(cylinder_discount.discount_value),
                }

        if (
            self.global_discount_is_active
            and self.global_discount_type
            and self.global_discount_value > 0
        ):
            return {
                "scope": "global",
                "type": self.global_discount_type,
                "value": quantize_money(self.global_discount_value),
            }

        return {"scope": None, "type": None, "value": Decimal("0.00")}

    def calculate_discount_for_amount(self, amount, cylinder_type=None):
        original_amount = quantize_money(amount or Decimal("0"))
        discount_amount = Decimal("0.00")
        discount_rule = self.get_discount_configuration(cylinder_type)
        discount_type = discount_rule["type"]
        discount_value = discount_rule["value"]

        if discount_type and discount_value > 0 and original_amount > 0:
            if discount_type == self.DiscountType.PERCENTAGE:
                discount_amount = quantize_money(
                    original_amount * discount_value / Decimal("100")
                )
            elif discount_type == self.DiscountType.FIXED:
                discount_amount = quantize_money(min(original_amount, discount_value))

        final_amount = quantize_money(max(Decimal("0"), original_amount - discount_amount))
        has_discount = discount_amount > 0

        return {
            "original_amount": original_amount,
            "discount_amount": discount_amount,
            "final_amount": final_amount,
            "has_discount": has_discount,
            "discount_scope": discount_rule["scope"] if has_discount else None,
            "applied_discount_type": discount_type if has_discount else None,
            "applied_discount_value": quantize_money(discount_value if has_discount else Decimal("0")),
        }

    def calculate_booking_pricing(self, cylinder_type, quantity):
        quantity_decimal = Decimal(quantity or 0)
        base_rate = quantize_money(self.get_rate_for_cylinder(cylinder_type))
        original_amount = quantize_money(base_rate * quantity_decimal)
        pricing = self.calculate_discount_for_amount(original_amount, cylinder_type=cylinder_type)
        pricing["rate"] = base_rate
        pricing["quantity"] = int(quantity or 0)
        pricing["effective_rate"] = (
            quantize_money(pricing["final_amount"] / quantity_decimal)
            if quantity_decimal > 0
            else Decimal("0.00")
        )
        return pricing


class StaffProfile(TimeStampedModel):
    objects = models.Manager()
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="staff_profile")
    assigned_area = models.CharField(max_length=100, blank=True)
    vehicle_number = models.CharField(max_length=30, blank=True)
    vehicle_location = models.ForeignKey(StockLocation, null=True, blank=True, on_delete=models.SET_NULL)
    image = models.ImageField(upload_to="staff-images/", blank=True, null=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["user__username"]

    def __str__(self):
        return self.user.get_full_name() or self.user.username


class Sale(TimeStampedModel):
    class PaymentMode(models.TextChoices):
        CASH = "cash", "Cash"
        GPAY = "gpay", "GPay"
        BANK = "bank", "Bank Transfer"
        CREDIT = "credit", "Credit/Pending"
        SPLIT = "split", "Split Payment"

    class DeliveryType(models.TextChoices):
        PICKUP = "pickup", "Pickup"
        DELIVERY = "delivery", "Home Delivery"

    customer = models.ForeignKey(CustomerProfile, on_delete=models.CASCADE, related_name="sales", null=True, blank=True)
    location = models.ForeignKey(StockLocation, on_delete=models.PROTECT)
    original_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    discount_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    total_amount = models.DecimalField(max_digits=10, decimal_places=2)
    applied_discount_type = models.CharField(max_length=20, choices=CustomerProfile.DiscountType.choices, null=True, blank=True)
    applied_discount_value = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    paid_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    balance_due = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    payment_mode = models.CharField(max_length=10, choices=PaymentMode.choices)
    delivery_type = models.CharField(max_length=10, choices=DeliveryType.choices, default=DeliveryType.PICKUP)
    delivery_staff = models.CharField(max_length=80, blank=True)
    note = models.CharField(max_length=300, blank=True)
    sold_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    
    objects = models.Manager()

    class Meta:
        ordering = ["-created_at"]


class SaleItem(TimeStampedModel):
    sale = models.ForeignKey(Sale, on_delete=models.CASCADE, related_name="items")
    cylinder_type = models.ForeignKey(CylinderType, on_delete=models.PROTECT)
    quantity = models.PositiveIntegerField()
    rate = models.DecimalField(max_digits=10, decimal_places=2)
    total_amount = models.DecimalField(max_digits=10, decimal_places=2)
    empty_returned = models.PositiveIntegerField(default=0)

    objects = models.Manager()

    class Meta:
        ordering = ["id"]


class Payment(TimeStampedModel):
    customer = models.ForeignKey(CustomerProfile, on_delete=models.CASCADE, related_name="payments")
    sale = models.ForeignKey(Sale, on_delete=models.CASCADE, related_name="payments", null=True, blank=True)
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    payment_mode = models.CharField(max_length=10, choices=Sale.PaymentMode.choices, default=Sale.PaymentMode.CASH)
    received_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    note = models.CharField(max_length=200, blank=True)
    empty_collected = models.PositiveIntegerField(default=0)
    
    objects = models.Manager()

    class Meta:
        ordering = ["-created_at"]


class Expense(TimeStampedModel):
    class Category(models.TextChoices):
        FUEL = "fuel", "Fuel"
        SALARY = "salary", "Salary"
        TRANSPORT = "transport", "Transport"
        MISC = "misc", "Miscellaneous"

    category = models.CharField(max_length=20, choices=Category.choices)
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    note = models.CharField(max_length=200, blank=True)
    spent_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)

    objects = models.Manager()

    class Meta:
        ordering = ["-created_at"]


class ActivityLog(TimeStampedModel):
    action = models.CharField(max_length=80)
    description = models.CharField(max_length=255)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, null=True, blank=True)
    metadata = models.JSONField(default=dict, blank=True)
    
    objects = models.Manager()

    class Meta:
        ordering = ["-created_at"]


class CustomerCylinderRate(TimeStampedModel):
    customer = models.ForeignKey(CustomerProfile, on_delete=models.CASCADE, related_name="custom_rates")
    cylinder_type = models.ForeignKey(CylinderType, on_delete=models.CASCADE)
    custom_price = models.DecimalField(max_digits=10, decimal_places=2)

    objects = models.Manager()

    class Meta:
        unique_together = ("customer", "cylinder_type")

    def __str__(self):
        return f"{self.customer} - {self.cylinder_type}: {self.custom_price}"


class CustomerCylinderDiscount(TimeStampedModel):
    customer = models.ForeignKey(CustomerProfile, on_delete=models.CASCADE, related_name="cylinder_discounts")
    cylinder_type = models.ForeignKey(CylinderType, on_delete=models.CASCADE, related_name="customer_discounts")
    discount_type = models.CharField(max_length=20, choices=CustomerProfile.DiscountType.choices)
    discount_value = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["cylinder_type__weight", "cylinder_type__name", "id"]
        unique_together = ("customer", "cylinder_type")

    def __str__(self):
        return f"{self.customer} - {self.cylinder_type}: {self.discount_type} {self.discount_value}"


class Booking(TimeStampedModel):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending Approval"
        APPROVED = "approved", "Approved"
        ACCEPTED = "accepted", "Accepted"
        REJECTED = "rejected", "Rejected"
        OUT_FOR_DELIVERY = "out_for_delivery", "Out for Delivery"
        DELIVERED = "delivered", "Delivered"
        CANCELLED = "cancelled", "Cancelled"

    objects = models.Manager()

    customer = models.ForeignKey(CustomerProfile, on_delete=models.CASCADE, related_name="bookings")
    cylinder_type = models.ForeignKey(CylinderType, on_delete=models.PROTECT)
    quantity = models.PositiveIntegerField(default=1)
    original_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    discount_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    final_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    applied_discount_type = models.CharField(max_length=20, choices=CustomerProfile.DiscountType.choices, null=True, blank=True)
    applied_discount_value = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    note = models.CharField(max_length=300, blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    payment_method = models.CharField(max_length=10, default="COD")
    payment_status = models.CharField(max_length=15, default="PENDING")
    delivery_address = models.TextField(blank=True)
    delivery_phone = models.CharField(max_length=20, blank=True)
    assigned_staff = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="assigned_bookings")
    approved_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="approved_bookings")
    sale = models.OneToOneField(Sale, null=True, blank=True, on_delete=models.CASCADE, related_name="booking")
    rejection_reason = models.CharField(max_length=250, blank=True, null=True)
    rejected_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="rejected_bookings")
    rejected_by_role = models.CharField(max_length=20, choices=[("admin", "Admin"), ("staff", "Delivery Staff")], null=True, blank=True)
    rejected_at = models.DateTimeField(null=True, blank=True)
    approved_at = models.DateTimeField(null=True, blank=True)
    delivered_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"Booking #{self.pk} - {self.customer} - {self.status}"

    @property
    def order_id(self):
        return f"GB{self.pk}"


class Delivery(TimeStampedModel):
    class Status(models.TextChoices):
        ASSIGNED = "assigned", "Assigned"
        ACCEPTED = "accepted", "Accepted"
        REJECTED = "rejected", "Rejected"
        OUT_FOR_DELIVERY = "out_for_delivery", "Out for Delivery"
        DELIVERED = "delivered", "Delivered"
        CANCELLED = "cancelled", "Cancelled"

    objects = models.Manager()

    booking = models.OneToOneField(Booking, on_delete=models.CASCADE, related_name="delivery")
    staff = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="deliveries")
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.ASSIGNED)
    rejection_reason = models.CharField(max_length=200, blank=True)
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    payment_collected = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    payment_method = models.CharField(max_length=10, choices=Sale.PaymentMode.choices, default=Sale.PaymentMode.CREDIT)
    empty_collected = models.PositiveIntegerField(default=0)
    note = models.CharField(max_length=300, blank=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"Delivery #{self.pk} - {self.booking}"


class Notification(TimeStampedModel):
    recipient = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="notifications")
    booking = models.ForeignKey(Booking, null=True, blank=True, on_delete=models.CASCADE, related_name="notifications")
    notification_type = models.CharField(max_length=50, blank=True, default="GENERAL")
    title = models.CharField(max_length=120)
    body = models.CharField(max_length=300)
    is_read = models.BooleanField(default=False)
    
    objects = models.Manager()

    class Meta:
        ordering = ["-created_at"]
