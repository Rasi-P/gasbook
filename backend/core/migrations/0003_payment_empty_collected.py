from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0002_sale_v2"),
    ]

    operations = [
        migrations.AddField(
            model_name="payment",
            name="empty_collected",
            field=models.PositiveIntegerField(default=0),
        ),
    ]
