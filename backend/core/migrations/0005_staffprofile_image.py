from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0004_booking_rejection_reason"),
    ]

    operations = [
        migrations.AddField(
            model_name="staffprofile",
            name="image",
            field=models.ImageField(blank=True, null=True, upload_to="staff-images/"),
        ),
    ]
