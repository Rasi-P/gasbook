import django.db.models.deletion
from django.db import migrations, models

TENANT_MODELS = [
    "cylindertype", "stocklocation", "stock", "stockmovement", "customerprofile", "staffprofile",
    "sale", "saleitem", "payment", "salevoid", "salerefund", "paymentreversal", "expense",
    "activitylog", "customercylinderrate", "customercylinderdiscount", "booking", "delivery",
    "notification", "productcategory", "product", "productmovement", "bookingitem", "saleaccessoryitem",
]


class Migration(migrations.Migration):
    """Multi-tenancy, step 3 of 3: tenant becomes required, and codes/names are unique per tenant."""

    dependencies = [
        ("core", "0019_tenant_backfill"),
    ]

    operations = [
        *[
            migrations.AlterField(
                model_name=model_name,
                name="tenant",
                field=models.ForeignKey(
                    editable=False, on_delete=django.db.models.deletion.PROTECT, related_name="+", to="core.tenant"
                ),
            )
            for model_name in TENANT_MODELS
        ],
        migrations.AlterField(
            model_name="stocklocation",
            name="code",
            field=models.SlugField(max_length=40),
        ),
        migrations.AddConstraint(
            model_name="stocklocation",
            constraint=models.UniqueConstraint(fields=("tenant", "code"), name="stocklocation_code_per_tenant"),
        ),
        migrations.AlterField(
            model_name="productcategory",
            name="name",
            field=models.CharField(max_length=80),
        ),
        migrations.AddConstraint(
            model_name="productcategory",
            constraint=models.UniqueConstraint(fields=("tenant", "name"), name="productcategory_name_per_tenant"),
        ),
        migrations.AlterField(
            model_name="product",
            name="sku",
            field=models.CharField(max_length=50),
        ),
        migrations.AddConstraint(
            model_name="product",
            constraint=models.UniqueConstraint(fields=("tenant", "sku"), name="product_sku_per_tenant"),
        ),
    ]
