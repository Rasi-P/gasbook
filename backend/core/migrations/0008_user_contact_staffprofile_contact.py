from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0007_user_plain_password"),
    ]

    operations = [
        migrations.AddField(
            model_name="user",
            name="address",
            field=models.TextField(blank=True),
        ),
        migrations.AddField(
            model_name="user",
            name="phone",
            field=models.CharField(blank=True, max_length=20),
        ),
        migrations.AddField(
            model_name="staffprofile",
            name="address",
            field=models.TextField(blank=True),
        ),
        migrations.AddField(
            model_name="staffprofile",
            name="phone",
            field=models.CharField(blank=True, max_length=20),
        ),
    ]
