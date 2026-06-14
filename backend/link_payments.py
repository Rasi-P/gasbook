import os
import django

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "gasbook.settings")
django.setup()

from decimal import Decimal
from core.models import Sale, Payment, CustomerProfile

def fix():
    for customer in CustomerProfile.objects.all():
        # Reset sales balances first
        sales = customer.sales.order_by("created_at")
        for sale in sales:
            sale.paid_amount = Decimal(0)
            sale.balance_due = sale.total_amount
            sale.save(update_fields=["paid_amount", "balance_due"])
            
        # Unlink all payments so we can re-process them properly
        # Wait, payments that were explicitly linked to a sale originally SHOULD be kept linked!
        # How do we know which were explicitly linked? The ones where empty_collected might be set or not.
        # Actually, let's just replay them in chronological order.
        payments = customer.payments.order_by("created_at")
        for payment in payments:
            if payment.sale:
                sale = payment.sale
                sale.paid_amount += payment.amount
                sale.balance_due = max(Decimal(0), sale.total_amount - sale.paid_amount)
                sale.save(update_fields=["paid_amount", "balance_due"])
            else:
                pending_sales = customer.sales.filter(balance_due__gt=0).order_by("created_at")
                remaining = payment.amount
                first_allocation = True
                
                # If there are no pending sales, this will skip and just leave it unlinked
                for sale in pending_sales:
                    if remaining <= 0:
                        break
                    allocated = sale.balance_due if remaining >= sale.balance_due else remaining
                    
                    sale.paid_amount += allocated
                    sale.balance_due -= allocated
                    sale.save(update_fields=["paid_amount", "balance_due"])
                    
                    if first_allocation:
                        payment.sale = sale
                        payment.amount = allocated
                        payment.save(update_fields=["sale", "amount"])
                        first_allocation = False
                    else:
                        new_p = Payment.objects.create(
                            customer=payment.customer,
                            sale=sale,
                            amount=allocated,
                            payment_mode=payment.payment_mode,
                            received_by=payment.received_by,
                            note=payment.note,
                            empty_collected=0,
                        )
                        # sync dates
                        new_p.created_at = payment.created_at
                        new_p.save(update_fields=["created_at"])
                        
                    remaining -= allocated
                
                # If there is remaining amount after all pending sales are paid
                if remaining > 0:
                    if first_allocation:
                        pass # Nothing was allocated, payment stays unlinked
                    else:
                        new_p = Payment.objects.create(
                            customer=payment.customer,
                            sale=None,
                            amount=remaining,
                            payment_mode=payment.payment_mode,
                            received_by=payment.received_by,
                            note=payment.note,
                            empty_collected=0,
                        )
                        new_p.created_at = payment.created_at
                        new_p.save(update_fields=["created_at"])

if __name__ == "__main__":
    fix()
    print("Payments linked successfully.")
