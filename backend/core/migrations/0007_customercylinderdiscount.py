from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0006_customerprofile_global_discount_and_order_pricing"),
    ]

    operations = [
        migrations.CreateModel(
            name="CustomerCylinderDiscount",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "discount_type",
                    models.CharField(
                        choices=[("percentage", "Percentage"), ("fixed", "Fixed Amount")],
                        max_length=20,
                    ),
                ),
                ("discount_value", models.DecimalField(decimal_places=2, default=0, max_digits=10)),
                ("is_active", models.BooleanField(default=True)),
                (
                    "customer",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="cylinder_discounts",
                        to="core.customerprofile",
                    ),
                ),
                (
                    "cylinder_type",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="customer_discounts",
                        to="core.cylindertype",
                    ),
                ),
            ],
            options={
                "ordering": ["cylinder_type__weight", "cylinder_type__name", "id"],
                "unique_together": {("customer", "cylinder_type")},
            },
        ),
    ]
