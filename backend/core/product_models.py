"""Accessory inventory and saved mixed-booking lines. No separate order lifecycle."""
from django.conf import settings
from django.db import models
from .models import TimeStampedModel


class ProductCategory(TimeStampedModel):
    name = models.CharField(max_length=80, unique=True)
    class Meta:
        ordering = ['name']


class Product(TimeStampedModel):
    name = models.CharField(max_length=150)
    description = models.TextField(blank=True, max_length=3000)
    image = models.ImageField(upload_to='product-images/', null=True, blank=True)
    selling_price = models.DecimalField(max_digits=10, decimal_places=2)
    is_active = models.BooleanField(default=True)
    sku = models.CharField(max_length=50, unique=True)
    stock = models.PositiveIntegerField(default=0)
    reserved = models.PositiveIntegerField(default=0)
    low_stock_threshold = models.PositiveIntegerField(default=5)  # preserved historical field
    category = models.ForeignKey(ProductCategory, on_delete=models.PROTECT)
    class Meta:
        ordering = ['name', 'id']
        constraints = [
            models.CheckConstraint(condition=models.Q(stock__gte=models.F('reserved')), name='product_stock_covers_reserved'),
            models.CheckConstraint(condition=models.Q(selling_price__gte=0), name='product_price_nonnegative'),
        ]


class ProductMovement(TimeStampedModel):
    sale = models.ForeignKey('Sale', on_delete=models.PROTECT, null=True, blank=True)
    product = models.ForeignKey(Product, on_delete=models.PROTECT, related_name='movements')
    booking = models.ForeignKey('Booking', on_delete=models.PROTECT, null=True, blank=True)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    kind = models.CharField(max_length=12, choices=[(s, s.title()) for s in ['in', 'out', 'adjustment', 'reservation', 'release', 'deduction', 'return']])
    quantity_change = models.IntegerField()
    reserved_change = models.IntegerField(default=0)
    stock_before = models.PositiveIntegerField()
    stock_after = models.PositiveIntegerField()
    reserved_before = models.PositiveIntegerField()
    reserved_after = models.PositiveIntegerField()
    reason = models.CharField(max_length=300)
    client_ref = models.UUIDField(null=True, blank=True, unique=True)
    class Meta:
        ordering = ['-created_at', '-id']


class BookingItem(TimeStampedModel):
    booking = models.ForeignKey('Booking', on_delete=models.PROTECT, related_name='order_items')
    cylinder_type = models.ForeignKey('CylinderType', on_delete=models.PROTECT, null=True, blank=True)
    product = models.ForeignKey(Product, on_delete=models.PROTECT, null=True, blank=True)
    name = models.CharField(max_length=150)
    category_name = models.CharField(max_length=80)
    quantity = models.PositiveIntegerField()
    rate = models.DecimalField(max_digits=10, decimal_places=2)
    original_amount = models.DecimalField(max_digits=10, decimal_places=2)
    discount_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    total_amount = models.DecimalField(max_digits=10, decimal_places=2)
    rate_type = models.CharField(max_length=10, null=True, blank=True)
    deposit_unit_amount = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    refill_unit_amount = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    # Only the first cylinder line owns the checkout retry key.
    client_ref = models.UUIDField(null=True, blank=True, unique=True)
    request_hash = models.CharField(max_length=64, blank=True)
    class Meta:
        ordering = ['id']
        constraints = [
            models.CheckConstraint(condition=(models.Q(product__isnull=True, cylinder_type__isnull=False) | models.Q(product__isnull=False, cylinder_type__isnull=True)), name='booking_item_one_type'),
            models.CheckConstraint(condition=models.Q(quantity__gt=0, rate__gte=0, discount_amount__gte=0, total_amount__gte=0, original_amount=models.F('total_amount')+models.F('discount_amount')), name='booking_item_amounts'),
        ]


class SaleAccessoryItem(TimeStampedModel):
    """Saved accessory lines on the existing sale; no separate order/payment lifecycle."""
    sale = models.ForeignKey('Sale', on_delete=models.PROTECT, related_name='accessories')
    product = models.ForeignKey(Product, on_delete=models.PROTECT)
    name = models.CharField(max_length=150)
    category_name = models.CharField(max_length=80)
    quantity = models.PositiveIntegerField()
    rate = models.DecimalField(max_digits=10, decimal_places=2)
    total_amount = models.DecimalField(max_digits=10, decimal_places=2)
    class Meta:
        ordering = ['id']
        constraints = [models.CheckConstraint(condition=models.Q(quantity__gt=0, rate__gte=0, total_amount__gte=0), name='sale_accessory_positive')]
