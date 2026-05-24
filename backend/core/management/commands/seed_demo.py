from django.core.management.base import BaseCommand

from core.models import CylinderType, Stock, StockLocation, User


class Command(BaseCommand):
    help = "Seed GasBook with default locations, cylinder types, and starter stock."

    def handle(self, *args, **options):
        shop, _ = StockLocation.objects.get_or_create(code="shop", defaults={"name": "Shop"})
        kandam, _ = StockLocation.objects.get_or_create(code="kandam", defaults={"name": "Kandam"})
        StockLocation.objects.get_or_create(code="supplier", defaults={"name": "Supplier"})

        if not User.objects.filter(username="admin").exists():
            User.objects.create_superuser(
                username="admin",
                password="admin123",
                email="admin@gasbook.local",
                role=User.Role.ADMIN,
            )

        cylinder_data = [
            ("5kg", 5, 450, 300, 360),
            ("12kg", 12, 950, 600, 820),
            ("17kg", 17, 1350, 800, 1160),
            ("19kg", 19, 1650, 1000, 1420),
            ("21kg", 21, 1850, 1200, 1600),
        ]
        starter_stock = {
            "5kg": {"shop": {"filled": 10, "empty": 2}, "kandam": {"filled": 30, "empty": 10}},
            "12kg": {"shop": {"filled": 18, "empty": 7}, "kandam": {"filled": 45, "empty": 18}},
            "17kg": {"shop": {"filled": 4, "empty": 1}, "kandam": {"filled": 15, "empty": 5}},
            "19kg": {"shop": {"filled": 10, "empty": 8}, "kandam": {"filled": 23, "empty": 19}},
            "21kg": {"shop": {"filled": 6, "empty": 2}, "kandam": {"filled": 14, "empty": 6}},
        }

        for name, weight, selling, deposit, refill in cylinder_data:
            cylinder, _ = CylinderType.objects.update_or_create(
                name=name,
                defaults={
                    "weight": weight,
                    "selling_price": selling,
                    "deposit_amount": deposit,
                    "refill_rate": refill,
                    "low_stock_threshold": 5,
                },
            )
            for location in (shop, kandam):
                for status in (Stock.Status.FILLED, Stock.Status.EMPTY):
                    Stock.objects.get_or_create(
                        cylinder_type=cylinder,
                        location=location,
                        status=status,
                        defaults={"quantity": 0},
                    )

        self.stdout.write(self.style.SUCCESS("GasBook demo data seeded. Login: admin / admin123"))
