"""Accessory snapshots on direct sales, using the existing physical stock movements."""
from decimal import Decimal
from .models import Product, SaleAccessoryItem
from .products import StrictSerializer, require_enabled, move
from .exceptions import ApiError
from .services import MAX_MONEY
from rest_framework import serializers


class AccessoryInput(StrictSerializer):
    product = serializers.IntegerField(min_value=1)
    quantity = serializers.IntegerField(min_value=1, max_value=100000)


def quote(lines, lock=False):
    if not lines:
        return []
    require_enabled()
    quantities = {}
    for line in lines:
        quantities[line['product']] = quantities.get(line['product'], 0) + line['quantity']
    products = Product.objects.select_related('category').filter(pk__in=quantities).order_by('pk')
    if lock:
        products = products.select_for_update(of=('self',))
    products = {p.pk: p for p in products}
    result = []
    for pk, quantity in sorted(quantities.items()):
        p = products.get(pk)
        if not p or not p.is_active or p.stock-p.reserved < quantity:
            raise ApiError('An accessory is inactive or has insufficient available stock.', code='insufficient_stock', field='accessory_lines')
        total = p.selling_price * quantity
        if total > MAX_MONEY:
            raise ApiError('Accessory total is too large.', code='amount_too_large')
        result.append(dict(product=p, name=p.name, category_name=p.category.name, quantity=quantity, rate=p.selling_price, total_amount=total))
    return result


def save(sale, lines, actor):
    for line in lines:
        SaleAccessoryItem.objects.create(sale=sale, **line)
        move(line['product'], actor, 'deduction', -line['quantity'], 0, f'Direct Sale #{sale.pk}', sale=sale)


def restore(sale, actor):
    lines = list(sale.accessories.order_by('product_id'))
    products = {p.pk: p for p in Product.objects.select_for_update().filter(pk__in=[i.product_id for i in lines]).order_by('pk')}
    for line in lines:
        move(products[line.product_id], actor, 'return', line.quantity, 0, f'Cancelled Direct Sale #{sale.pk}', sale=sale)


def item_data(sale):
    return [dict(id=i.pk, name=i.name, type='accessory', product=i.product_id, quantity=i.quantity,
                 rate=str(i.rate), total_amount=str(i.total_amount)) for i in sale.accessories.all()]
