import os
import django

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "gasbook.settings")
django.setup()

from core.models import StockMovement

print("All Stock Movements involving supplier:")
movements = StockMovement.objects.filter(
    from_location__code__icontains="supplier"
) | StockMovement.objects.filter(
    to_location__code__icontains="supplier"
) | StockMovement.objects.filter(
    from_location__is_main_supplier=True
) | StockMovement.objects.filter(
    to_location__is_main_supplier=True
)

for m in movements:
    print(f"{m.created_at.date()}: {m.quantity} x {m.cylinder_type.name} [{m.status}] FROM {m.from_location.name} TO {m.to_location.name}")
