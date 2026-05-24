from django.conf import settings
import django.contrib.auth.models
import django.contrib.auth.validators
from django.db import migrations, models
import django.db.models.deletion
import django.utils.timezone


class Migration(migrations.Migration):
    initial = True

    dependencies = [
        ("auth", "0012_alter_user_first_name_max_length"),
    ]

    operations = [
        migrations.CreateModel(
            name="User",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("password", models.CharField(max_length=128, verbose_name="password")),
                ("last_login", models.DateTimeField(blank=True, null=True, verbose_name="last login")),
                ("is_superuser", models.BooleanField(default=False)),
                ("username", models.CharField(error_messages={"unique": "A user with that username already exists."}, help_text="Required. 150 characters or fewer.", max_length=150, unique=True, validators=[django.contrib.auth.validators.UnicodeUsernameValidator()], verbose_name="username")),
                ("first_name", models.CharField(blank=True, max_length=150, verbose_name="first name")),
                ("last_name", models.CharField(blank=True, max_length=150, verbose_name="last name")),
                ("email", models.EmailField(blank=True, max_length=254, verbose_name="email address")),
                ("is_staff", models.BooleanField(default=False, verbose_name="staff status")),
                ("is_active", models.BooleanField(default=True, verbose_name="active")),
                ("date_joined", models.DateTimeField(default=django.utils.timezone.now, verbose_name="date joined")),
                ("role", models.CharField(choices=[("admin", "Admin"), ("staff", "Staff")], default="staff", max_length=20)),
                ("groups", models.ManyToManyField(blank=True, related_name="user_set", related_query_name="user", to="auth.group", verbose_name="groups")),
                ("user_permissions", models.ManyToManyField(blank=True, related_name="user_set", related_query_name="user", to="auth.permission", verbose_name="user permissions")),
            ],
            options={"verbose_name": "user", "verbose_name_plural": "users", "abstract": False},
            managers=[("objects", django.contrib.auth.models.UserManager())],
        ),
        migrations.CreateModel(
            name="Customer",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("name", models.CharField(max_length=120)),
                ("phone", models.CharField(blank=True, max_length=20)),
                ("address", models.TextField(blank=True)),
                ("opening_balance", models.DecimalField(decimal_places=2, default=0, max_digits=10)),
            ],
            options={"ordering": ["name"]},
        ),
        migrations.CreateModel(
            name="CylinderType",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("name", models.CharField(max_length=80)),
                ("weight", models.DecimalField(decimal_places=2, max_digits=5)),
                ("selling_price", models.DecimalField(decimal_places=2, max_digits=10)),
                ("deposit_amount", models.DecimalField(decimal_places=2, default=0, max_digits=10)),
                ("refill_rate", models.DecimalField(decimal_places=2, default=0, max_digits=10)),
                ("low_stock_threshold", models.PositiveIntegerField(default=5)),
                ("is_active", models.BooleanField(default=True)),
            ],
            options={"ordering": ["weight", "name"]},
        ),
        migrations.CreateModel(
            name="StockLocation",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("name", models.CharField(max_length=80)),
                ("code", models.SlugField(max_length=40, unique=True)),
                ("is_active", models.BooleanField(default=True)),
            ],
            options={"ordering": ["name"]},
        ),
        migrations.CreateModel(
            name="ActivityLog",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("action", models.CharField(max_length=80)),
                ("description", models.CharField(max_length=255)),
                ("metadata", models.JSONField(blank=True, default=dict)),
                ("user", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, to=settings.AUTH_USER_MODEL)),
            ],
            options={"ordering": ["-created_at"]},
        ),
        migrations.CreateModel(
            name="Expense",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("category", models.CharField(choices=[("fuel", "Fuel"), ("salary", "Salary"), ("transport", "Transport"), ("misc", "Miscellaneous")], max_length=20)),
                ("amount", models.DecimalField(decimal_places=2, max_digits=10)),
                ("note", models.CharField(blank=True, max_length=200)),
                ("spent_by", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, to=settings.AUTH_USER_MODEL)),
            ],
            options={"ordering": ["-created_at"]},
        ),
        migrations.CreateModel(
            name="Sale",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("quantity", models.PositiveIntegerField()),
                ("rate", models.DecimalField(decimal_places=2, max_digits=10)),
                ("total_amount", models.DecimalField(decimal_places=2, max_digits=10)),
                ("paid_amount", models.DecimalField(decimal_places=2, default=0, max_digits=10)),
                ("balance_due", models.DecimalField(decimal_places=2, default=0, max_digits=10)),
                ("payment_mode", models.CharField(choices=[("cash", "Cash"), ("upi", "UPI"), ("credit", "Credit")], max_length=10)),
                ("customer", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name="sales", to="core.customer")),
                ("cylinder_type", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, to="core.cylindertype")),
                ("location", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, to="core.stocklocation")),
                ("sold_by", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, to=settings.AUTH_USER_MODEL)),
            ],
            options={"ordering": ["-created_at"]},
        ),
        migrations.CreateModel(
            name="Payment",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("amount", models.DecimalField(decimal_places=2, max_digits=10)),
                ("payment_mode", models.CharField(choices=[("cash", "Cash"), ("upi", "UPI"), ("credit", "Credit")], max_length=10)),
                ("note", models.CharField(blank=True, max_length=200)),
                ("customer", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="payments", to="core.customer")),
                ("received_by", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, to=settings.AUTH_USER_MODEL)),
                ("sale", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="payments", to="core.sale")),
            ],
            options={"ordering": ["-created_at"]},
        ),
        migrations.CreateModel(
            name="Stock",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("status", models.CharField(choices=[("filled", "Filled"), ("empty", "Empty")], max_length=10)),
                ("quantity", models.PositiveIntegerField(default=0)),
                ("cylinder_type", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="stocks", to="core.cylindertype")),
                ("location", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="stocks", to="core.stocklocation")),
            ],
            options={"ordering": ["location__name", "cylinder_type__weight", "status"], "unique_together": {("cylinder_type", "location", "status")}},
        ),
        migrations.CreateModel(
            name="StockMovement",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("status", models.CharField(choices=[("filled", "Filled"), ("empty", "Empty")], max_length=10)),
                ("quantity", models.PositiveIntegerField()),
                ("note", models.CharField(blank=True, max_length=200)),
                ("cylinder_type", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, to="core.cylindertype")),
                ("from_location", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="outgoing_movements", to="core.stocklocation")),
                ("moved_by", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, to=settings.AUTH_USER_MODEL)),
                ("to_location", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="incoming_movements", to="core.stocklocation")),
            ],
            options={"ordering": ["-created_at"]},
        ),
    ]
