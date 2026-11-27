import django.contrib.auth.models
import django.db.models.deletion
from django.db import migrations, models

import core.models

# Every tenant-owned model. The column is added nullable here, filled in 0019 and made
# required in 0020, so existing databases migrate without a default value.
TENANT_MODELS = [
    "cylindertype", "stocklocation", "stock", "stockmovement", "customerprofile", "staffprofile",
    "sale", "saleitem", "payment", "salevoid", "salerefund", "paymentreversal", "expense",
    "activitylog", "customercylinderrate", "customercylinderdiscount", "booking", "delivery",
    "notification", "productcategory", "product", "productmovement", "bookingitem", "saleaccessoryitem",
]


class Migration(migrations.Migration):
    """Multi-tenancy, step 1 of 3: the Tenant table and nullable tenant columns."""

    dependencies = [
        ("core", "0017_cylindertype_image"),
    ]

    operations = [
        migrations.CreateModel(
            name="Tenant",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("name", models.CharField(max_length=120)),
                ("slug", models.SlugField(unique=True)),
                ("is_active", models.BooleanField(default=True)),
            ],
            options={"ordering": ["name"]},
        ),
        migrations.AlterModelManagers(
            name="user",
            managers=[
                ("objects", core.models.TenantUserManager()),
                ("all_tenants", django.contrib.auth.models.UserManager()),
            ],
        ),
        migrations.AddField(
            model_name="user",
            name="tenant",
            field=models.ForeignKey(
                blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name="users", to="core.tenant"
            ),
        ),
        *[
            migrations.AddField(
                model_name=model_name,
                name="tenant",
                field=models.ForeignKey(
                    editable=False, null=True, on_delete=django.db.models.deletion.PROTECT, related_name="+", to="core.tenant"
                ),
            )
            for model_name in TENANT_MODELS
        ],
    ]
