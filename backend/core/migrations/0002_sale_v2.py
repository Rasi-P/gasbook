from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0001_initial"),
    ]

    operations = [
        # Remove old per-cylinder fields from Sale
        migrations.RemoveField(model_name="sale", name="cylinder_type"),
        migrations.RemoveField(model_name="sale", name="quantity"),
        migrations.RemoveField(model_name="sale", name="rate"),
        # Add new fields to Sale
        migrations.AddField(
            model_name="sale",
            name="delivery_type",
            field=models.CharField(
                choices=[("pickup", "Pickup"), ("delivery", "Home Delivery")],
                default="pickup",
                max_length=10,
            ),
        ),
        migrations.AddField(
            model_name="sale",
            name="delivery_staff",
            field=models.CharField(blank=True, max_length=80),
        ),
        migrations.AddField(
            model_name="sale",
            name="note",
            field=models.CharField(blank=True, max_length=300),
        ),
        # Update payment_mode choices on Sale
        migrations.AlterField(
            model_name="sale",
            name="payment_mode",
            field=models.CharField(
                choices=[
                    ("cash", "Cash"),
                    ("gpay", "GPay"),
                    ("bank", "Bank Transfer"),
                    ("credit", "Credit/Pending"),
                ],
                max_length=10,
            ),
        ),
        # Update payment_mode choices on Payment (add gpay/bank, set default)
        migrations.AlterField(
            model_name="payment",
            name="payment_mode",
            field=models.CharField(
                choices=[
                    ("cash", "Cash"),
                    ("gpay", "GPay"),
                    ("bank", "Bank Transfer"),
                    ("credit", "Credit/Pending"),
                ],
                default="cash",
                max_length=10,
            ),
        ),
        # Create SaleItem
        migrations.CreateModel(
            name="SaleItem",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("quantity", models.PositiveIntegerField()),
                ("rate", models.DecimalField(decimal_places=2, max_digits=10)),
                ("total_amount", models.DecimalField(decimal_places=2, max_digits=10)),
                ("empty_returned", models.PositiveIntegerField(default=0)),
                (
                    "cylinder_type",
                    models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, to="core.cylindertype"),
                ),
                (
                    "sale",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="items",
                        to="core.sale",
                    ),
                ),
            ],
            options={"ordering": ["id"]},
        ),
    ]
