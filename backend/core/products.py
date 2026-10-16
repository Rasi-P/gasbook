"""Small catalog/stock API; all booking fulfilment stays in the existing views."""
import uuid
from decimal import Decimal
from django.conf import settings
from django.db import transaction
from django.db.models import F
from rest_framework import serializers, viewsets, mixins
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response
from .exceptions import ApiError
from .models import Product, ProductCategory, ProductMovement


def require_enabled():
    if not settings.ACCESSORIES_ENABLED:
        raise ApiError('Accessories are not enabled yet.', code='unavailable', status=503)


def require_admin(user):
    if not user.is_active or getattr(getattr(user, 'role', None), 'code', '') != 'admin':
        raise PermissionDenied('Only admins can manage products and stock.')


class StrictSerializer(serializers.Serializer):
    def to_internal_value(self, data):
        extra = set(data) - set(self.fields)
        if extra:
            raise serializers.ValidationError({key: 'This field is not accepted.' for key in sorted(extra)})
        return super().to_internal_value(data)


class ProductInput(StrictSerializer):
    name = serializers.CharField(max_length=150)
    description = serializers.CharField(max_length=3000, allow_blank=True, required=False)
    category = serializers.CharField(max_length=80)
    selling_price = serializers.DecimalField(max_digits=10, decimal_places=2, min_value=Decimal('0'))
    image = serializers.ImageField(required=False, allow_null=True)
    is_active = serializers.BooleanField(required=False)
    initial_stock = serializers.IntegerField(min_value=0, max_value=100000, required=False)

    def validate_image(self, value):
        if value is not None and (value.size > 5*1024*1024 or value.image.format not in ('PNG', 'JPEG', 'WEBP') or max(value.image.size) > 4096):
            raise serializers.ValidationError('Use a JPEG, PNG or WebP image up to 5 MB and 4096 pixels.')
        return value


class ProductSerializer(serializers.ModelSerializer):
    category = serializers.CharField(source='category.name')
    available = serializers.SerializerMethodField()
    class Meta:
        model = Product
        fields = ['id', 'name', 'description', 'category', 'selling_price', 'image', 'is_active', 'available', 'stock', 'reserved', 'low_stock_threshold']
        read_only_fields = fields

    def get_available(self, obj):
        return obj.is_active and obj.stock > obj.reserved

    def to_representation(self, instance):
        data = super().to_representation(instance)
        user = getattr(self.context.get('request'), 'user', None)
        if getattr(getattr(user, 'role', None), 'code', '') != 'admin':
            data.pop('stock'); data.pop('reserved'); data.pop('low_stock_threshold')
        return data


def move(product, actor, kind, stock_change, reserved_change, reason, booking=None, client_ref=None, sale=None):
    """Caller holds the product lock and an atomic transaction."""
    stock_after, reserved_after = product.stock + stock_change, product.reserved + reserved_change
    if reserved_after < 0 or stock_after < reserved_after:
        raise ApiError('Stock cannot be negative or below quantities reserved for bookings.', code='insufficient_stock')
    movement = ProductMovement.objects.create(product=product, actor=actor, kind=kind,
        quantity_change=stock_change, reserved_change=reserved_change, stock_before=product.stock,
        stock_after=stock_after, reserved_before=product.reserved, reserved_after=reserved_after,
        reason=reason, booking=booking, client_ref=client_ref, sale=sale)
    product.stock, product.reserved = stock_after, reserved_after
    product.save(update_fields=['stock', 'reserved', 'updated_at'])
    return movement


class StockInput(StrictSerializer):
    client_ref = serializers.UUIDField()
    delta = serializers.IntegerField(min_value=-1, max_value=1, required=False)
    quantity = serializers.IntegerField(min_value=0, max_value=100000, required=False)
    reason = serializers.CharField(max_length=300)
    def validate(self, attrs):
        if ('delta' in attrs) == ('quantity' in attrs) or attrs.get('delta') == 0:
            raise serializers.ValidationError('Use delta +1/-1 or an explicit stock quantity.')
        return attrs


class ProductViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    queryset = Product.objects.select_related('category').all()
    serializer_class = ProductSerializer

    def get_queryset(self):
        if not settings.ACCESSORIES_ENABLED:
            return super().get_queryset().none()
        qs = super().get_queryset()
        if getattr(getattr(self.request.user, 'role', None), 'code', '') != 'admin':
            qs = qs.filter(is_active=True, stock__gt=F('reserved'))
        return qs

    @transaction.atomic
    def create(self, request):
        require_enabled(); require_admin(request.user)
        data = ProductInput(data=request.data); data.is_valid(raise_exception=True)
        values = dict(data.validated_data)
        initial = values.pop('initial_stock', 0)
        category, _ = ProductCategory.objects.get_or_create(name=values.pop('category'))
        product = Product.objects.create(category=category, sku=uuid.uuid4().hex, **values)
        move(product, request.user, 'in', initial, 0, 'Initial stock')
        return Response(self.get_serializer(product).data, status=201)

    @transaction.atomic
    def partial_update(self, request, pk=None):
        require_enabled(); require_admin(request.user)
        product = self.get_queryset().select_for_update(of=('self',)).get(pk=self.get_object().pk)
        data = ProductInput(data=request.data, partial=True); data.is_valid(raise_exception=True)
        values = dict(data.validated_data)
        if 'initial_stock' in values:
            raise ApiError('Use the stock adjustment control.', code='read_only_fields')
        if 'category' in values:
            values['category'], _ = ProductCategory.objects.get_or_create(name=values['category'])
        for key, value in values.items():
            setattr(product, key, value)
        product.save()
        return Response(self.get_serializer(product).data)

    @action(detail=True, methods=['post'])
    @transaction.atomic
    def stock(self, request, pk=None):
        require_enabled(); require_admin(request.user)
        data = StockInput(data=request.data); data.is_valid(raise_exception=True)
        values = data.validated_data
        product = Product.objects.select_for_update().get(pk=self.get_object().pk)
        previous = ProductMovement.objects.filter(client_ref=values['client_ref']).first()
        change = values.get('delta', values.get('quantity', product.stock) - product.stock)
        if previous:
            matches = previous.product_id == product.pk and previous.actor_id == request.user.pk and previous.reason == values['reason']
            matches = matches and (previous.quantity_change == values['delta'] if 'delta' in values else previous.stock_after == values['quantity'])
            if not matches:
                raise ApiError('This retry key was used for a different adjustment.', code='conflict', status=409)
        else:
            move(product, request.user, 'adjustment', change, 0, values['reason'], client_ref=values['client_ref'])
        return Response(self.get_serializer(product).data)

    @action(detail=True, methods=['get'])
    def movements(self, request, pk=None):
        require_enabled(); require_admin(request.user)
        rows = self.get_object().movements.select_related('actor')
        page = self.paginate_queryset(rows)
        data = [dict(id=r.id, kind=r.kind, quantity_change=r.quantity_change, reserved_change=r.reserved_change,
                     stock_before=r.stock_before, stock_after=r.stock_after, booking=r.booking_id,
                     actor=r.actor.get_full_name() or r.actor.username, created_at=r.created_at, reason=r.reason)
                for r in page]
        return self.get_paginated_response(data)
