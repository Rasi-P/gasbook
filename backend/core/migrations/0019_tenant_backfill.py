from django.conf import settings
from django.db import migrations

TENANT_MODELS = [
    "CylinderType", "StockLocation", "Stock", "StockMovement", "CustomerProfile", "StaffProfile",
    "Sale", "SaleItem", "Payment", "SaleVoid", "SaleRefund", "PaymentReversal", "Expense",
    "ActivityLog", "CustomerCylinderRate", "CustomerCylinderDiscount", "Booking", "Delivery",
    "Notification", "ProductCategory", "Product", "ProductMovement", "BookingItem", "SaleAccessoryItem",
]


def assign_existing_rows(apps, schema_editor):
    """Everything recorded before multi-tenancy belongs to the original agency."""
    Tenant = apps.get_model("core", "Tenant")
    tenant, _ = Tenant.objects.get_or_create(
        slug=settings.DEFAULT_TENANT_SLUG, defaults={"name": settings.DEFAULT_TENANT_NAME}
    )
    for model_name in TENANT_MODELS:
        apps.get_model("core", model_name)._base_manager.filter(tenant__isnull=True).update(tenant=tenant)
    apps.get_model("core", "User")._base_manager.filter(tenant__isnull=True).update(tenant=tenant)


class Migration(migrations.Migration):
    """Multi-tenancy, step 2 of 3: existing rows and users join the default tenant."""

    dependencies = [
        ("core", "0018_tenant_schema"),
    ]

    operations = [
        migrations.RunPython(assign_existing_rows, migrations.RunPython.noop),
    ]
