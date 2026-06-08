from django.conf import settings
from django.contrib.auth.models import AbstractUser
from django.db import models


class User(AbstractUser):
    class Role(models.TextChoices):
        ADMIN = "admin", "Admin"
        STAFF = "staff", "Staff"
        CUSTOMER = "customer", "Customer"

    role = models.CharField(max_length=20, choices=Role.choices, default=Role.STAFF)
    plain_password = models.CharField(max_length=128, blank=True, default="")
    must_change_password = models.BooleanField(default=False)
    phone = models.CharField(max_length=20, blank=True)
    address = models.TextField(blank=True)


class TimeStampedModel(models.Model):
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class CylinderType(TimeStampedModel):
    name = models.CharField(max_length=80)
    weight = models.DecimalField(max_digits=5, decimal_places=2)
    selling_price = models.DecimalField(max_digits=10, decimal_places=2)
    deposit_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    refill_rate = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    low_stock_threshold = models.PositiveIntegerField(default=5)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["weight", "name"]

    def __str__(self):
        return self.name


class StockLocation(TimeStampedModel):
    name = models.CharField(max_length=80)
    code = models.SlugField(max_length=40, unique=True)
    is_main_supplier = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)

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

    class Meta:
        ordering = ["-created_at"]


class CustomerProfile(TimeStampedModel):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="customer_profile")
    opening_balance = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    area = models.CharField(max_length=100, blank=True)
    default_staff = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="assigned_customers")
    credit_limit = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    deposit_cylinders = models.PositiveIntegerField(default=0)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["user__username"]

    def __str__(self):
        return self.user.get_full_name() or self.user.username


class StaffProfile(TimeStampedModel):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="staff_profile")
    assigned_area = models.CharField(max_length=100, blank=True)
    vehicle_number = models.CharField(max_length=30, blank=True)
    vehicle_location = models.ForeignKey(StockLocation, null=True, blank=True, on_delete=models.SET_NULL)
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

    class DeliveryType(models.TextChoices):
        PICKUP = "pickup", "Pickup"
        DELIVERY = "delivery", "Home Delivery"

    customer = models.ForeignKey(CustomerProfile, on_delete=models.CASCADE, related_name="sales", null=True, blank=True)
    location = models.ForeignKey(StockLocation, on_delete=models.PROTECT)
    total_amount = models.DecimalField(max_digits=10, decimal_places=2)
    paid_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    balance_due = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    payment_mode = models.CharField(max_length=10, choices=PaymentMode.choices)
    delivery_type = models.CharField(max_length=10, choices=DeliveryType.choices, default=DeliveryType.PICKUP)
    delivery_staff = models.CharField(max_length=80, blank=True)
    note = models.CharField(max_length=300, blank=True)
    sold_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)

    class Meta:
        ordering = ["-created_at"]


class SaleItem(TimeStampedModel):
    sale = models.ForeignKey(Sale, on_delete=models.CASCADE, related_name="items")
    cylinder_type = models.ForeignKey(CylinderType, on_delete=models.PROTECT)
    quantity = models.PositiveIntegerField()
    rate = models.DecimalField(max_digits=10, decimal_places=2)
    total_amount = models.DecimalField(max_digits=10, decimal_places=2)
    empty_returned = models.PositiveIntegerField(default=0)

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

    class Meta:
        ordering = ["-created_at"]


class ActivityLog(TimeStampedModel):
    action = models.CharField(max_length=80)
    description = models.CharField(max_length=255)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, null=True, blank=True)
    metadata = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ["-created_at"]


class CustomerCylinderRate(TimeStampedModel):
    customer = models.ForeignKey(CustomerProfile, on_delete=models.CASCADE, related_name="custom_rates")
    cylinder_type = models.ForeignKey(CylinderType, on_delete=models.CASCADE)
    custom_price = models.DecimalField(max_digits=10, decimal_places=2)

    class Meta:
        unique_together = ("customer", "cylinder_type")

    def __str__(self):
        return f"{self.customer} - {self.cylinder_type}: {self.custom_price}"


class Booking(TimeStampedModel):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending Approval"
        APPROVED = "approved", "Approved"
        REJECTED = "rejected", "Rejected"
        OUT_FOR_DELIVERY = "out_for_delivery", "Out for Delivery"
        DELIVERED = "delivered", "Delivered"
        CANCELLED = "cancelled", "Cancelled"

    customer = models.ForeignKey(CustomerProfile, on_delete=models.CASCADE, related_name="bookings")
    cylinder_type = models.ForeignKey(CylinderType, on_delete=models.PROTECT)
    quantity = models.PositiveIntegerField(default=1)
    note = models.CharField(max_length=300, blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    assigned_staff = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="assigned_bookings")
    approved_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="approved_bookings")
    sale = models.OneToOneField(Sale, null=True, blank=True, on_delete=models.CASCADE, related_name="booking")
    approved_at = models.DateTimeField(null=True, blank=True)
    delivered_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"Booking #{self.id} - {self.customer} - {self.status}"


class Delivery(TimeStampedModel):
    class Status(models.TextChoices):
        ASSIGNED = "assigned", "Assigned"
        OUT_FOR_DELIVERY = "out_for_delivery", "Out for Delivery"
        DELIVERED = "delivered", "Delivered"
        CANCELLED = "cancelled", "Cancelled"

    booking = models.OneToOneField(Booking, on_delete=models.CASCADE, related_name="delivery")
    staff = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="deliveries")
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.ASSIGNED)
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    payment_collected = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    payment_method = models.CharField(max_length=10, choices=Sale.PaymentMode.choices, default=Sale.PaymentMode.CREDIT)
    empty_collected = models.PositiveIntegerField(default=0)
    note = models.CharField(max_length=300, blank=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"Delivery #{self.id} - {self.booking}"


class Notification(TimeStampedModel):
    recipient = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="notifications")
    booking = models.ForeignKey(Booking, null=True, blank=True, on_delete=models.CASCADE, related_name="notifications")
    title = models.CharField(max_length=120)
    body = models.CharField(max_length=300)
    is_read = models.BooleanField(default=False)

    class Meta:
        ordering = ["-created_at"]
