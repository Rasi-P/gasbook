"""Opt-in, development-only accessory examples; never changes an existing row."""
import os
from pathlib import Path
from django.conf import settings
from django.core.files import File
from django.core.management.base import BaseCommand, CommandError
from django.db import connection, transaction
from django.db.migrations.recorder import MigrationRecorder
from core.models import Product, ProductCategory, User
from core.products import move


class Command(BaseCommand):
    help = 'Add five clearly labelled DEMO accessories with bundled images to a verified development database.'

    def add_arguments(self, parser):
        parser.add_argument('--database-name', required=True, help='Exact verified database name; required safety check.')
        parser.add_argument('--actor', required=True, help='Existing admin username for stock audit attribution.')

    @transaction.atomic
    def handle(self, *args, **options):
        config = connection.settings_dict
        name = str(config['NAME'])
        if os.environ.get('GASBOOK_ENV') != 'development' or not settings.DEBUG or options['database_name'] != name or 'qa' in name.lower():
            raise CommandError('Development only: verify the target, set GASBOOK_ENV=development and DEBUG=True, and supply its exact database name. QA is forbidden.')
        if config['ENGINE'].endswith('postgresql') and config['HOST'] not in ('db', '127.0.0.1', 'localhost'):
            raise CommandError('Seed only a local development database.')
        applied = MigrationRecorder(connection).applied_migrations()
        if ('core','0014_commerce_catalog_orders') not in applied:
            raise CommandError('The existing product tables are not installed. This command never migrates.')
        legacy_inventory = ('core','0015_minimal_booking_inventory') not in applied
        if legacy_inventory:
            # 0014 is already applied on development. Seed its existing catalog and
            # movement columns without applying 0015 or referring to booking_id.
            from django.db.migrations.loader import MigrationLoader
            old_apps = MigrationLoader(connection).project_state([('core','0014_commerce_catalog_orders')]).apps
            old_movement = old_apps.get_model('core', 'ProductMovement')
        actor = User.objects.filter(username=options['actor'], role__code='admin',is_active=True).first()
        if not actor:
            raise CommandError('Choose an existing active admin for audit attribution.')
        samples = [('regulator','Gas regulator','Regulator','250.00',5),('stove','Two-burner gas stove','Stove','2200.00',3),
                   ('hose','LPG gas hose','Hose','180.00',8),('clips','Hose clips (pair)','Clips','30.00',12),('burner','Replacement burner','Burner','350.00',4)]
        directory = Path(__file__).resolve().parents[2] / 'demo_products'
        created = 0
        for slug, label, category, price, stock in samples:
            sku = f'DEMO-ACCESSORY-{slug.upper()}'
            if Product.objects.filter(sku=sku).exists():
                continue
            kind, _ = ProductCategory.objects.get_or_create(name=category)
            product = Product(name=f'[DEMO] {label}',description='Development sample only — illustrative price, stock and product image.',category=kind,selling_price=price,sku=sku)
            with (directory/f'{slug}.png').open('rb') as image:
                product.image.save(f'demo-{slug}.png',File(image),save=False)
            product.save()
            if legacy_inventory:
                old_movement.objects.create(product_id=product.pk, actor_id=actor.pk, kind='in',
                    quantity_change=stock, reserved_change=0, stock_before=0, stock_after=stock,
                    reserved_before=0, reserved_after=0, reason='Development demo initial stock')
                product.stock = stock
                product.save(update_fields=['stock', 'updated_at'])
            else:
                move(product, actor, 'in', stock, 0, 'Development demo initial stock')
            created += 1
        self.stdout.write(self.style.SUCCESS(f'Created {created} demo accessories in {name}. Existing products and customer records unchanged.'))
