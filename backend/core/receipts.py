"""Read-only customer receipts, normalized exclusively from saved transactions."""
from decimal import Decimal

from django.conf import settings
from django.db.models import Q
from django.http import Http404
from django.shortcuts import get_object_or_404
from rest_framework.decorators import api_view, permission_classes
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .models import Booking, Sale
from .serializers import get_booking_pricing_snapshot, get_sale_pricing_snapshot, serialize_decimal
from .services import BUSINESS_DISPLAY_NAME


def timestamp(value):
    return value.isoformat() if value else None


def component_line(record, final_amount, original_amount=None, legacy_rate=None):
    """Keep unknown historical components unknown; never consult today's cylinder rates."""
    deposit, refill = record.deposit_unit_amount, record.refill_unit_amount
    has_components = record.rate_type in ('new', 'refill') and deposit is not None and refill is not None
    unit = deposit + refill if has_components else legacy_rate
    unit_label = 'Unit price' if has_components else 'Recorded unit rate'
    if unit is None and original_amount is not None and record.quantity:
        unit = original_amount / record.quantity
        unit_label = 'Average unit price'
    return {
        'description': record.cylinder_type.name,
        'quantity': record.quantity,
        'rate_type': record.rate_type if has_components else None,
        'unit_amount': serialize_decimal(unit) if unit is not None else None,
        'unit_label': unit_label,
        'deposit_unit_amount': serialize_decimal(deposit) if has_components else None,
        'refill_unit_amount': serialize_decimal(refill) if has_components else None,
        'total_amount': serialize_decimal(final_amount),
    }


def normalize_receipt(record, source):
    booking = record if source == 'booking' else None
    sale = booking.sale if booking else record
    customer = record.customer.user
    pricing = get_booking_pricing_snapshot(booking) if booking else get_sale_pricing_snapshot(sale)
    void = getattr(sale, 'void', None) if sale else None
    refund = getattr(void, 'refund', None) if void else None
    cancelled = bool(void) or bool(booking and booking.status in ('cancelled', 'rejected'))
    delivery = getattr(booking, 'delivery', None) if booking else None
    completed_at = None
    partner = None
    if booking and booking.status == Booking.Status.DELIVERED:
        completed_at = (delivery.completed_at if delivery else None) or booking.delivered_at
        staff = delivery.staff if delivery else booking.assigned_staff
        partner = (staff.get_full_name() or staff.username) if staff else None

    if booking:
        items = [component_line(booking, pricing['final_amount'], pricing['original_amount'])]
    else:
        items = [component_line(item, item.total_amount, legacy_rate=item.rate)
                 for item in sale.items.all() if item.quantity > 0 or item.total_amount > 0]

    if booking:
        from .booking_items import saved_items
        mixed = saved_items(booking)
        if mixed:
            items = [dict(description=i.name, quantity=i.quantity, rate_type=i.rate_type,
                          unit_amount=serialize_decimal(i.rate), unit_label='Unit price',
                          deposit_unit_amount=serialize_decimal(i.deposit_unit_amount) if i.deposit_unit_amount is not None else None,
                          refill_unit_amount=serialize_decimal(i.refill_unit_amount) if i.refill_unit_amount is not None else None,
                          total_amount=serialize_decimal(i.total_amount)) for i in mixed]

    paid = sale.paid_amount if sale else None
    balance = sale.balance_due if sale else None
    payment_status = 'Paid' if sale and balance <= 0 else 'Partially paid' if sale and paid > 0 else 'Unpaid'
    if not sale:
        # Booking payment flags do not establish an amount collected; do not invent one.
        payment_status = {'PAID': 'Paid (recorded status)', 'COLLECTED': 'Collected (recorded status)'}.get(
            booking.payment_status.upper(), 'Payment not confirmed')
    if cancelled:
        balance = Decimal('0')
        payment_status = 'Refunded' if refund else 'Refund pending' if void and void.outcome == 'refund' else (
            'Transferred to customer credit' if void and void.outcome == 'credit' else 'Cancelled')
        if void:
            paid = void.paid_amount

    methods = []
    if sale:
        # Reversals are negative payments, not additional collections or payment methods.
        methods = sorted({p.get_payment_mode_display() for p in sale.payments.all() if p.amount > 0})
    method = ', '.join(methods) if methods else sale.get_payment_mode_display() if sale else {
        'COD': 'Cash on delivery', 'ONLINE': 'Online',
    }.get(booking.payment_method.upper(), booking.payment_method)
    business = {'name': BUSINESS_DISPLAY_NAME}
    business.update({key: value for key, value in settings.RECEIPT_BUSINESS_DETAILS.items() if value})
    return {
        'number': booking.order_id if booking else f'SALE-{sale.pk}',
        'source': source,
        'transaction_type': 'Booking' if booking else 'Direct Sale',
        'business': business,
        'customer': {
            'name': customer.get_full_name() or customer.username,
            'phone': (booking.delivery_phone if booking else '') or customer.phone or None,
            'address': (booking.delivery_address if booking else '') or customer.address or None,
            'email': customer.email or None,
        },
        'created_at': timestamp(record.created_at),
        'status': 'Cancelled' if void else booking.get_status_display() if booking else 'Completed',
        'cancelled': cancelled,
        'cancelled_at': timestamp(void.created_at if void else booking.rejected_at if cancelled else None),
        'cancellation_reason': void.reason if void else booking.rejection_reason if cancelled else None,
        'items': items,
        'subtotal': serialize_decimal(pricing['original_amount']),
        'discount_amount': serialize_decimal(pricing['discount_amount']),
        'total_amount': serialize_decimal(pricing['final_amount']),
        'paid_amount': serialize_decimal(paid) if paid is not None else None,
        'balance_due': serialize_decimal(balance) if balance is not None else None,
        'payment_status': payment_status,
        'payment_method': method or None,
        'refund_amount': serialize_decimal(refund.amount) if refund else None,
        'refund_due': serialize_decimal(void.refund_due) if void and void.outcome == 'refund' and not refund else None,
        'refunded_at': timestamp(refund.created_at) if refund else None,
        'credit_amount': serialize_decimal(void.paid_amount) if void and void.outcome == 'credit' else None,
        'delivery_partner': partner,
        'completed_at': timestamp(completed_at),
    }


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def customer_receipt(request, source, pk):
    if getattr(getattr(request.user, 'role', None), 'code', '') != 'customer':
        raise PermissionDenied('Only customers can view their receipts.')
    if source == 'booking':
        queryset = Booking.objects.filter(customer__user=request.user).filter(
            Q(sale__isnull=True) | Q(sale__customer__user=request.user)
        ).select_related('customer__user', 'cylinder_type', 'assigned_staff', 'delivery__staff', 'sale__void__refund').prefetch_related('sale__payments')
    elif source == 'sale':
        queryset = Sale.objects.filter(customer__user=request.user, booking__isnull=True).select_related(
            'customer__user', 'void__refund').prefetch_related('items__cylinder_type', 'payments')
    else:
        raise Http404
    record = get_object_or_404(queryset, pk=pk)
    data = normalize_receipt(record, source)
    if not data['items']:
        # Empty-return-only records are not billed sales in customer history either.
        raise Http404
    response = Response(data)
    response['Cache-Control'] = 'private, no-store'
    response['Vary'] = 'Authorization'
    return response
