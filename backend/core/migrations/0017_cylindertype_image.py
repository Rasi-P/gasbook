from django.db import migrations, models


class Migration(migrations.Migration):
    """Optional picture for a cylinder type. Additive and nullable: existing rows keep no image
    (clients fall back to their built-in artwork) and nothing is rewritten."""

    dependencies = [
        ('core', '0016_staff_collections_sale_accessories'),
    ]

    operations = [
        migrations.AddField(
            model_name='cylindertype',
            name='image',
            field=models.ImageField(blank=True, null=True, upload_to='cylinder-images/'),
        ),
    ]
