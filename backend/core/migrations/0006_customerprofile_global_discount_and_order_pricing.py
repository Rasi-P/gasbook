from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0005_staffprofile_image"),
    ]

    operations = [
        migrations.AddField(
            model_name="booking",
            name="applied_discount_type",
            field=models.CharField(blank=True, choices=[("percentage", "Percentage"), ("fixed", "Fixed Amount")], max_length=20, null=True),
        ),
        migrations.AddField(
            model_name="booking",
            name="applied_discount_value",
            field=models.DecimalField(decimal_places=2, default=0, max_digits=10),
        ),
        migrations.AddField(
            model_name="booking",
            name="discount_amount",
            field=models.DecimalField(decimal_places=2, default=0, max_digits=10),
        ),
        migrations.AddField(
            model_name="booking",
            name="final_amount",
            field=models.DecimalField(decimal_places=2, default=0, max_digits=10),
        ),
        migrations.AddField(
            model_name="booking",
            name="original_amount",
            field=models.DecimalField(decimal_places=2, default=0, max_digits=10),
        ),
        migrations.AddField(
            model_name="customerprofile",
            name="global_discount_is_active",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="customerprofile",
            name="global_discount_type",
            field=models.CharField(blank=True, choices=[("percentage", "Percentage"), ("fixed", "Fixed Amount")], max_length=20, null=True),
        ),
        migrations.AddField(
            model_name="customerprofile",
            name="global_discount_value",
            field=models.DecimalField(decimal_places=2, default=0, max_digits=10),
        ),
        migrations.AddField(
            model_name="sale",
            name="applied_discount_type",
            field=models.CharField(blank=True, choices=[("percentage", "Percentage"), ("fixed", "Fixed Amount")], max_length=20, null=True),
        ),
        migrations.AddField(
            model_name="sale",
            name="applied_discount_value",
            field=models.DecimalField(decimal_places=2, default=0, max_digits=10),
        ),
        migrations.AddField(
            model_name="sale",
            name="discount_amount",
            field=models.DecimalField(decimal_places=2, default=0, max_digits=10),
        ),
        migrations.AddField(
            model_name="sale",
            name="original_amount",
            field=models.DecimalField(decimal_places=2, default=0, max_digits=10),
        ),
    ]
