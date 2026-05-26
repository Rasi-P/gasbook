from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0003_payment_empty_collected"),
    ]

    operations = [
        # Extend User role choices to include customer
        migrations.AlterField(
            model_name="user",
            name="role",
            field=models.CharField(
                max_length=20,
                choices=[("admin", "Admin"), ("staff", "Staff"), ("customer", "Customer")],
                default="staff",
            ),
        ),
        # CustomerProfile
        migrations.CreateModel(
            name="CustomerProfile",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("phone", models.CharField(max_length=20, blank=True)),
                ("address", models.TextField(blank=True)),
                ("area", models.CharField(max_length=100, blank=True)),
                ("credit_limit", models.DecimalField(max_digits=10, decimal_places=2, default=0)),
                ("deposit_cylinders", models.PositiveIntegerField(default=0)),
                ("is_active", models.BooleanField(default=True)),
                ("user", models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name="customer_profile", to=settings.AUTH_USER_MODEL)),
                ("default_staff", models.ForeignKey(null=True, blank=True, on_delete=django.db.models.deletion.SET_NULL, related_name="assigned_customers", to=settings.AUTH_USER_MODEL)),
                ("linked_customer", models.OneToOneField(null=True, blank=True, on_delete=django.db.models.deletion.SET_NULL, related_name="profile", to="core.customer")),
            ],
            options={"ordering": ["user__username"]},
        ),
        # StaffProfile
        migrations.CreateModel(
            name="StaffProfile",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("assigned_area", models.CharField(max_length=100, blank=True)),
                ("vehicle_number", models.CharField(max_length=30, blank=True)),
                ("is_active", models.BooleanField(default=True)),
                ("user", models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name="staff_profile", to=settings.AUTH_USER_MODEL)),
                ("vehicle_location", models.ForeignKey(null=True, blank=True, on_delete=django.db.models.deletion.SET_NULL, to="core.stocklocation")),
            ],
            options={"ordering": ["user__username"]},
        ),
        # CustomerCylinderRate
        migrations.CreateModel(
            name="CustomerCylinderRate",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("custom_price", models.DecimalField(max_digits=10, decimal_places=2)),
                ("customer", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="custom_rates", to="core.customerprofile")),
                ("cylinder_type", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to="core.cylindertype")),
            ],
            options={"unique_together": {("customer", "cylinder_type")}},
        ),
        # Booking
        migrations.CreateModel(
            name="Booking",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("quantity", models.PositiveIntegerField(default=1)),
                ("note", models.CharField(max_length=300, blank=True)),
                ("status", models.CharField(
                    max_length=20,
                    choices=[
                        ("pending", "Pending Approval"),
                        ("approved", "Approved"),
                        ("rejected", "Rejected"),
                        ("out_for_delivery", "Out for Delivery"),
                        ("delivered", "Delivered"),
                        ("cancelled", "Cancelled"),
                    ],
                    default="pending",
                )),
                ("approved_at", models.DateTimeField(null=True, blank=True)),
                ("delivered_at", models.DateTimeField(null=True, blank=True)),
                ("customer", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="bookings", to="core.customerprofile")),
                ("cylinder_type", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, to="core.cylindertype")),
                ("assigned_staff", models.ForeignKey(null=True, blank=True, on_delete=django.db.models.deletion.SET_NULL, related_name="assigned_bookings", to=settings.AUTH_USER_MODEL)),
                ("approved_by", models.ForeignKey(null=True, blank=True, on_delete=django.db.models.deletion.SET_NULL, related_name="approved_bookings", to=settings.AUTH_USER_MODEL)),
                ("sale", models.OneToOneField(null=True, blank=True, on_delete=django.db.models.deletion.SET_NULL, related_name="booking", to="core.sale")),
            ],
            options={"ordering": ["-created_at"]},
        ),
        # Notification
        migrations.CreateModel(
            name="Notification",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("title", models.CharField(max_length=120)),
                ("body", models.CharField(max_length=300)),
                ("is_read", models.BooleanField(default=False)),
                ("recipient", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="notifications", to=settings.AUTH_USER_MODEL)),
                ("booking", models.ForeignKey(null=True, blank=True, on_delete=django.db.models.deletion.SET_NULL, related_name="notifications", to="core.booking")),
            ],
            options={"ordering": ["-created_at"]},
        ),
    ]
