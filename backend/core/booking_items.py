"""Atomic, retryable cylinder and mixed carts on the existing Booking."""
import hashlib
import json
from decimal import Decimal
from django.core import signing
from django.db import transaction
from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied
from .exceptions import ApiError
from .models import Booking, BookingItem, CylinderType, Product, ProductMovement, SaleItem, Stock
from .pricing import calculate_pricing, snapshot
from .products import StrictSerializer, require_enabled, move
from .services import advisory_lock, lock_customer, get_stock_row, MAX_MONEY


class ItemInput(StrictSerializer):
    client_item_id = serializers.CharField(required=False, max_length=100)
    cylinder_type = serializers.IntegerField(min_value=1, required=False)
    product = serializers.IntegerField(min_value=1, required=False)
    quantity = serializers.IntegerField(min_value=1, max_value=100000)
    rate_type = serializers.ChoiceField(choices=['new', 'refill'], required=False)
    def validate(self, attrs):
        if ('product' in attrs) == ('cylinder_type' in attrs):
            raise serializers.ValidationError('Choose exactly one cylinder or accessory.')
        if 'product' in attrs and 'rate_type' in attrs:
            raise serializers.ValidationError('Accessories do not have cylinder rate types.')
        return attrs


class CheckoutInput(StrictSerializer):
    items = ItemInput(many=True, allow_empty=False)
    client_ref = serializers.UUIDField()
    quote = serializers.CharField(max_length=20000)
    delivery_address = serializers.CharField(max_length=2000)
    delivery_phone = serializers.CharField(max_length=20, allow_blank=True)


def customer(request):
    if getattr(getattr(request.user, 'role', None), 'code', '') != 'customer':
        raise PermissionDenied('Only customers can place bookings.')
    profile = getattr(request.user, 'customer_profile', None)
    if not profile or not profile.is_active or not request.user.is_active:
        raise PermissionDenied('An active customer account is required.')
    return profile


def priced_items(profile, items, lock=False):
    data = ItemInput(data=items, many=True); data.is_valid(raise_exception=True)
    items = data.validated_data
    if not items or len(items) > 50:
        raise ApiError('Choose between 1 and 50 items.', code='invalid')
    ids = [i['product'] for i in items if 'product' in i]
    if ids:
        require_enabled()
    products = Product.objects.filter(id__in=ids).order_by('pk')
    if lock:
        products = products.select_for_update()
    products = {p.pk: p for p in products}
    cylinders = CylinderType.objects.filter(id__in=[i['cylinder_type'] for i in items if 'cylinder_type' in i], is_active=True).in_bulk()
    seen, lines = set(), []
    for item in items:
        qty = item['quantity']
        key = ('product', item['product']) if 'product' in item else ('cylinder', item['cylinder_type'], item.get('rate_type', 'refill'))
        if key in seen:
            raise ApiError('Combine duplicate items into one quantity.', code='duplicate_item')
        seen.add(key)
        if 'product' in item:
            p = products.get(item['product'])
            if not p or not p.is_active or p.stock-p.reserved < qty:
                raise ApiError('An accessory is inactive or has insufficient stock. Update your cart.', code='insufficient_stock')
            price = dict(rate=p.selling_price, original_amount=p.selling_price*qty,
                         discount_amount=Decimal('0'), final_amount=p.selling_price*qty,
                         rate_type=None, deposit_unit_amount=None, refill_unit_amount=None)
            name, category = p.name, p.category.name
        else:
            c = cylinders.get(item['cylinder_type'])
            if not c:
                raise ApiError('Cylinder is invalid or inactive.', code='invalid')
            price = calculate_pricing(profile, c, qty, item.get('rate_type', 'refill'))
            name, category = c.name, 'Cylinder'
        line = dict(client_item_id=item.get('client_item_id'), product=item.get('product'), cylinder_type=item.get('cylinder_type'),
                    name=name, category_name=category, quantity=qty, **{k: str(price[k]) if price[k] is not None and k != 'rate_type' else price[k]
                    for k in ['rate', 'original_amount', 'discount_amount', 'final_amount', 'rate_type', 'deposit_unit_amount', 'refill_unit_amount']})
        line.update(cylinder_type_name=name, cylinder_type_weight=str(cylinders[item['cylinder_type']].weight) if 'cylinder_type' in item else '',
                    has_discount=price['discount_amount'] > 0,
                    applied_discount_type=price.get('applied_discount_type'), applied_discount_value=str(price.get('applied_discount_value', 0)))
        lines.append(line)
    totals = {key: sum((Decimal(line[key]) for line in lines), Decimal('0')) for key in ['original_amount','discount_amount','final_amount']}
    if totals['original_amount'] > MAX_MONEY:
        raise ApiError('Booking total is too large.', code='amount_too_large')
    return dict(items=lines, summary={**{k:str(v) for k,v in totals.items()}, 'has_discount':totals['discount_amount']>0}), products


def quote_for(profile, preview):
    return signing.dumps({'customer':profile.pk, 'preview':preview}, salt='booking-accessories', compress=True)


def preview(request):
    profile = customer(request)
    if set(request.data) != {'items'}:
        raise ApiError('Only item identities and quantities are accepted.', code='invalid')
    result, _ = priced_items(profile, request.data['items'])
    return {**result, 'quote': quote_for(profile, result)}


@transaction.atomic
def checkout(request):
    profile = customer(request)
    data = CheckoutInput(data=request.data); data.is_valid(raise_exception=True)
    values = data.validated_data
    # Lock the globally unique retry key before the customer and product locks.
    # This also serializes collisions between two different customer accounts.
    advisory_lock('booking-checkout', values['client_ref'])
    profile = lock_customer(profile.pk)
    canonical = {k:v for k,v in values.items() if k not in ('quote','client_ref')}
    digest = hashlib.sha256(json.dumps(canonical, sort_keys=True).encode()).hexdigest()
    previous = BookingItem.objects.select_related('booking').filter(client_ref=values['client_ref']).first()
    if previous:
        if previous.booking.customer_id != profile.pk or previous.request_hash != digest:
            raise ApiError('Retry key belongs to another booking request.', code='conflict', status=409)
        return previous.booking, False
    if not any('cylinder_type' in i for i in values['items']):
        raise ApiError('Add accessories together with a cylinder booking.', code='cylinder_required')
    result, products = priced_items(profile, values['items'], lock=True)
    try:
        quoted = signing.loads(values['quote'], salt='booking-accessories', max_age=600)
    except signing.BadSignature:
        raise ApiError('Refresh the booking total before confirming.', code='quote_expired', status=409)
    if quoted != {'customer':profile.pk, 'preview':result}:
        raise ApiError('Prices changed. Refresh and review the total before confirming.', code='price_changed', status=409)
    first = next(i for i in result['items'] if i['cylinder_type'])
    # Reuse the normal booking creation and notifications, then persist the mixed
    # total in the same transaction. The serializer accepts no browser money.
    from .serializers import BookingSerializer
    serializer = BookingSerializer(data=dict(cylinder_type=first['cylinder_type'],quantity=first['quantity'],rate_type=first['rate_type'],
        delivery_address=values['delivery_address'],delivery_phone=values['delivery_phone'],payment_method='COD'), context={'request':request, 'booking_totals':result['summary']})
    serializer.is_valid(raise_exception=True)
    booking = serializer.save()
    for key in ('original_amount','discount_amount','final_amount'):
        setattr(booking, key, Decimal(result['summary'][key]))
    booking.save(update_fields=['original_amount','discount_amount','final_amount','updated_at'])
    for line in result['items']:
        primary = line is first
        BookingItem.objects.create(booking=booking, product_id=line['product'], cylinder_type_id=line['cylinder_type'],
            name=line['name'], category_name=line['category_name'], quantity=line['quantity'], rate=line['rate'],
            original_amount=line['original_amount'], discount_amount=line['discount_amount'], total_amount=line['final_amount'],
            **{k:line[k] for k in ('rate_type','deposit_unit_amount','refill_unit_amount')},
            client_ref=values['client_ref'] if primary else None, request_hash=digest if primary else '')
        if line['product']:
            move(products[line['product']], request.user, 'reservation', 0, line['quantity'], 'Booking placed', booking)
    return booking, True


def saved_items(booking):
    # Feature flags gate new accessory purchases, never persisted financial or
    # fulfillment facts (including cylinder-only carts).
    if not hasattr(booking, '_saved_inventory_items'):
        booking._saved_inventory_items = list(booking.order_items.all())
    return booking._saved_inventory_items


def item_data(booking):
    return [dict(id=i.pk, name=i.name, type='accessory' if i.product_id else 'cylinder', product=i.product_id,
                 cylinder_type=i.cylinder_type_id, quantity=i.quantity, rate=str(i.rate), original_amount=str(i.original_amount),
                 discount_amount=str(i.discount_amount), total_amount=str(i.total_amount), **{k:str(v) if v is not None and k!='rate_type' else v for k,v in snapshot(i).items()}) for i in saved_items(booking)]


def release(booking, actor):
    for line in sorted((i for i in saved_items(booking) if i.product_id), key=lambda i:i.product_id):
        product = Product.objects.select_for_update().get(pk=line.product_id)
        if not ProductMovement.objects.filter(product=product, booking=booking, kind='release').exists():
            move(product, actor, 'release', 0, -line.quantity, 'Booking rejected', booking)


def consume(booking, actor):
    for line in sorted((i for i in saved_items(booking) if i.product_id), key=lambda i:i.product_id):
        product = Product.objects.select_for_update().get(pk=line.product_id)
        move(product, actor, 'deduction', -line.quantity, -line.quantity, 'Delivery completed', booking)


def cylinder_lines(booking):
    return [i for i in saved_items(booking) if i.cylinder_type_id]


def deduct_cylinders(booking, location, empties):
    """Same filled/empty semantics, once per cylinder type in a mixed booking."""
    lines = cylinder_lines(booking)
    quantities = {}
    for line in lines:
        quantities[line.cylinder_type_id] = quantities.get(line.cylinder_type_id,0)+line.quantity
    rows = {}
    for cid, qty in sorted(quantities.items()):
        ct = CylinderType.objects.get(pk=cid)
        filled = get_stock_row(ct, location, Stock.Status.FILLED)
        if filled.quantity < qty:
            raise ApiError(f'Not enough filled {ct.name} stock at {location.name}.', code='insufficient_stock')
        filled.quantity -= qty; filled.save(update_fields=['quantity','updated_at'])
        empty = None
        if empties.get(cid,0):
            empty = get_stock_row(ct, location, Stock.Status.EMPTY)
            empty.quantity += empties[cid]; empty.save(update_fields=['quantity','updated_at'])
        rows[cid] = (filled,empty)
    return rows[booking.cylinder_type_id]


def sale_cylinders(booking, sale, empties):
    for line in cylinder_lines(booking):
        returned = empties.pop(line.cylinder_type_id,0)
        SaleItem.objects.create(sale=sale,cylinder_type_id=line.cylinder_type_id,quantity=line.quantity,
            rate=(line.total_amount/line.quantity).quantize(Decimal('.01')),total_amount=line.total_amount,
            empty_returned=returned,**snapshot(line))
