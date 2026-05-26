from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0006_alter_user_groups_alter_user_is_active_and_more'),
    ]

    operations = [
        migrations.AddField(
            model_name='user',
            name='plain_password',
            field=models.CharField(blank=True, default='', max_length=128),
        ),
    ]
