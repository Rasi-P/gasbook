from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0004_erp_expansion"),
    ]

    operations = [
        migrations.CreateModel(
            name="Delivery",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("assigned", "Assigned"),
                            ("out_for_delivery", "Out for Delivery"),
                            ("delivered", "Delivered"),
                            ("cancelled", "Cancelled"),
                        ],
                        default="assigned",
                        max_length=20,
                    ),
                ),
                ("started_at", models.DateTimeField(blank=True, null=True)),
                ("completed_at", models.DateTimeField(blank=True, null=True)),
                ("payment_collected", models.DecimalField(decimal_places=2, default=0, max_digits=10)),
                (
                    "payment_method",
                    models.CharField(
                        choices=[
                            ("cash", "Cash"),
                            ("gpay", "GPay"),
                            ("bank", "Bank Transfer"),
                            ("credit", "Credit/Pending"),
                        ],
                        default="credit",
                        max_length=10,
                    ),
                ),
                ("empty_collected", models.PositiveIntegerField(default=0)),
                ("note", models.CharField(blank=True, max_length=300)),
                ("booking", models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name="delivery", to="core.booking")),
                ("staff", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="deliveries", to=settings.AUTH_USER_MODEL)),
            ],
            options={"ordering": ["-created_at"]},
        ),
    ]
