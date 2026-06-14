import os
import django

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "gasbook.settings")
django.setup()

from core.models import Sale, Payment, CustomerProfile

for s in Sale.objects.all():
    print(f"Sale {s.id}: total={s.total_amount}, paid={s.paid_amount}, due={s.balance_due}, mode={s.payment_mode}")
    
for p in Payment.objects.all():
    print(f"Payment {p.id}: amount={p.amount}, sale={p.sale_id}")
