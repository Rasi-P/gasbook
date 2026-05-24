from django.conf import settings
from django.contrib.auth.models import AbstractUser
from django.db import models


class User(AbstractUser):
    class Role(models.TextChoices):
        ADMIN = "admin", "Admin"
        STAFF = "staff", "Staff"

    role = models.CharField(max_length=20, choices=Role.choices, default=Role.STAFF)


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


class Customer(TimeStampedModel):
    name = models.CharField(max_length=120)
    phone = models.CharField(max_length=20, blank=True)
    address = models.TextField(blank=True)
    opening_balance = models.DecimalField(max_digits=10, decimal_places=2, default=0)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


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


class Sale(TimeStampedModel):
    class PaymentMode(models.TextChoices):
        CASH = "cash", "Cash"
        GPAY = "gpay", "GPay"
        BANK = "bank", "Bank Transfer"
        CREDIT = "credit", "Credit/Pending"

    class DeliveryType(models.TextChoices):
        PICKUP = "pickup", "Pickup"
        DELIVERY = "delivery", "Home Delivery"

    customer = models.ForeignKey(Customer, on_delete=models.PROTECT, related_name="sales", null=True, blank=True)
    location = models.ForeignKey(StockLocation, on_delete=models.PROTECT)
    total_amount = models.DecimalField(max_digits=10, decimal_places=2)
    paid_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    balance_due = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    payment_mode = models.CharField(max_length=10, choices=PaymentMode.choices)
    delivery_type = models.CharField(max_length=10, choices=DeliveryType.choices, default=DeliveryType.PICKUP)
    delivery_staff = models.CharField(max_length=80, blank=True)
    note = models.CharField(max_length=300, blank=True)
    sold_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)

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
    customer = models.ForeignKey(Customer, on_delete=models.PROTECT, related_name="payments")
    sale = models.ForeignKey(Sale, on_delete=models.SET_NULL, related_name="payments", null=True, blank=True)
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    payment_mode = models.CharField(max_length=10, choices=Sale.PaymentMode.choices, default=Sale.PaymentMode.CASH)
    received_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
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
    spent_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)

    class Meta:
        ordering = ["-created_at"]


class ActivityLog(TimeStampedModel):
    action = models.CharField(max_length=80)
    description = models.CharField(max_length=255)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True)
    metadata = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ["-created_at"]
