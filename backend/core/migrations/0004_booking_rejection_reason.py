from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0003_delivery_rejection_reason_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="booking",
            name="rejection_reason",
            field=models.CharField(blank=True, max_length=250, null=True),
        ),
    ]
