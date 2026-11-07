"""Receipts into the existing Payment ledger, with persistent retry protection."""
import hashlib
import json
from datetime import datetime, time, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo
from django.db import transaction
from django.db.models import Q, Sum
from django.utils import timezone
from .exceptions import ApiError
from .models import ActivityLog, Payment, Sale
from .services import advisory_lock, is_admin_user, lock_customer, record_customer_payment


def visible_sales(user):
    qs = Sale.objects.all()
    if not is_admin_user(user):
        qs = qs.filter(Q(sold_by=user) | Q(handover_staff=user))
    return qs


def payment_data(sale, include_actor=False):
    """Saved transaction facts. Collector names are opt-in for admin serializers only."""
    if sale is None:
        return None
    from .serializers import payment_kind
    void = getattr(sale, 'void', None)
    return dict(sale_id=sale.pk, total_amount=str(sale.total_amount),
                paid_amount=str(void.paid_amount if void else sale.paid_amount),
                balance_due='0.00' if void else str(sale.balance_due),
                status='CANCELLED' if void else 'PAID' if sale.balance_due == 0 else 'PARTIAL' if sale.paid_amount else 'PENDING',
                payments=[dict(id=p.pk, amount=str(p.amount), mode=p.payment_mode, created_at=p.created_at.isoformat(), kind=payment_kind(p), **({"received_by_name": p.received_by.get_full_name() or p.received_by.username} if include_actor and p.received_by_id else {}))
                          for p in sale.payments.select_related('reverses_link', 'credit_link', 'received_by').order_by('created_at', 'pk')])


@transaction.atomic
def collect(customer, sale, parts, actor, client_ref, *, note='', empty_collected=0):
    from .serializers import receipt_parts
    receipts = receipt_parts(parts, 'payments')
    fingerprint = hashlib.sha256(json.dumps(dict(customer=customer.pk, sale=sale.pk if sale else None,
        parts=[(mode, str(amount)) for mode, amount in receipts], note=note, empty_collected=empty_collected), sort_keys=True).encode()).hexdigest()
    advisory_lock('payment-client-ref', client_ref)
    existing = Payment.objects.filter(client_ref=client_ref).first()
    if existing:
        log = ActivityLog.objects.filter(action='collection_recorded', metadata__client_ref=str(client_ref)).first()
        if existing.received_by_id != actor.pk or not log or log.metadata.get('request_hash') != fingerprint:
            raise ApiError('This payment reference was used for a different collection.', code='client_ref_reused', status=409)
        return list(Payment.objects.filter(pk__in=log.metadata['payment_ids']).order_by('pk')), True
    customer = lock_customer(customer.pk)
    if sale:
        sale = Sale.objects.select_for_update().get(pk=sale.pk)
        # Recheck attribution while holding the sale lock.
        if not visible_sales(actor).filter(pk=sale.pk).exists():
            raise ApiError('You cannot collect for this sale.', code='forbidden', status=403)
    elif not is_admin_user(actor):
        raise ApiError('Staff must select the original sale.', code='sale_required', status=403)
    payments = []
    for mode, amount in receipts:
        payments += record_customer_payment(customer, amount, mode, actor, sale=sale, note=note,
                                             empty_collected=empty_collected if not payments else 0)
    payments[0].client_ref = client_ref
    payments[0].save(update_fields=['client_ref'])
    ActivityLog.objects.create(action='collection_recorded', user=actor, description='Customer balance collection',
        metadata=dict(client_ref=str(client_ref), request_hash=fingerprint, payment_ids=[p.pk for p in payments]))
    return payments, False


def today_summary(user):
    zone = ZoneInfo('Asia/Kolkata')
    today = timezone.localtime(timezone.now(), zone).date()
    start = datetime.combine(today, time.min, tzinfo=zone)
    qs = Payment.objects.filter(received_by=user, created_at__gte=start, created_at__lt=start+timedelta(days=1))
    collected = qs.filter(amount__gt=0, credit_link__isnull=True)
    modes = {mode: collected.filter(payment_mode=mode).aggregate(total=Sum('amount'))['total'] or Decimal('0') for mode in ('cash','gpay','bank')}
    refunds = -(qs.filter(amount__lt=0, reverses_link__sale_refund__isnull=False).aggregate(total=Sum('amount'))['total'] or Decimal('0'))
    return dict(date=today.isoformat(), timezone='Asia/Kolkata', total=str(sum(modes.values())),
                methods={k: str(v) for k,v in modes.items()}, refunds=str(refunds))
