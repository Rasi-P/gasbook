"""Atomic cylinder carts, persisted replay, and recovery on disposable test data."""
import uuid
from decimal import Decimal
from unittest.mock import patch

from django.test import override_settings
from rest_framework.exceptions import ValidationError
from core.models import (Booking, BookingItem, CylinderType, CustomerProfile, Notification,
                         ProductMovement, SaleItem, User)
from core.integrity import violations
from .base import GasBookTestCase


class CylinderCheckoutTests(GasBookTestCase):
    def setUp(self):
        super().setUp()
        self.cylinder.refill_rate = Decimal('360')
        self.cylinder.deposit_amount = Decimal('450')
        self.cylinder.save()
        self.other = CylinderType.objects.create(name='Other cylinder', weight=9, selling_price=0, refill_rate=500, deposit_amount=600)
        self.set_stock(self.shop, filled=20, empty=0)
        self.set_stock(self.shop, filled=10, empty=0, cylinder=self.other)
        self.auth(self.customer_user)

    def payload(self):
        items = [dict(client_item_id='first', cylinder_type=self.cylinder.pk, quantity=2, rate_type='refill'),
                 dict(client_item_id='second', cylinder_type=self.other.pk, quantity=1, rate_type='new')]
        preview = self.client.post('/api/bookings/preview/', {'items': items}, format='json')
        self.assertEqual(preview.status_code, 200, preview.data)
        return dict(items=items, quote=preview.data['quote'], client_ref=str(uuid.uuid4()),
                    delivery_address='Synthetic checkout address', delivery_phone='9000000004')

    def post(self, payload):
        return self.client.post('/api/bookings/checkout/', payload, format='json')

    @override_settings(ACCESSORIES_ENABLED=False)
    def test_all_cylinders_create_one_booking_with_persisted_lines_when_accessories_disabled(self):
        result = self.post(self.payload())
        self.assertEqual(result.status_code, 201, result.data)
        self.assertEqual(Booking.objects.count(), 1)
        self.assertEqual(len(result.data['order_items']), 2)
        self.assertEqual(result.data['final_amount'], '1820.00')
        self.assertEqual(BookingItem.objects.filter(client_ref__isnull=False).count(), 1)
        self.assertEqual(ProductMovement.objects.count(), 0)
        self.assertEqual(self.stock_qty(self.shop, 'filled'), 20)  # deduction is at delivery

    def test_lost_response_retry_replays_without_side_effects_even_after_quote_expires(self):
        body = self.payload()
        first = self.post(body)
        notifications = Notification.objects.count()
        with patch('core.booking_items.signing.loads', side_effect=AssertionError('Replay must precede quote validation')):
            replay = self.post(body)
        self.assertEqual([first.status_code, replay.status_code], [201, 200])
        self.assertEqual(first.data, replay.data)
        self.assertEqual(Notification.objects.count(), notifications)
        self.assertEqual(Booking.objects.count(), 1)
        self.assertEqual(BookingItem.objects.count(), 2)

    def test_expired_new_quote_creates_nothing(self):
        from django.core.signing import SignatureExpired
        body = self.payload()
        with patch('core.booking_items.signing.loads', side_effect=SignatureExpired()):
            result = self.post(body)
        self.assertEqual(result.status_code, 409)
        self.assertFalse(Booking.objects.exists())

    def test_changed_payload_or_customer_cannot_reuse_key(self):
        body = self.payload()
        self.assertEqual(self.post(body).status_code, 201)
        self.assertEqual(self.post({**body, 'delivery_address': 'Changed'}).status_code, 409)
        other = User.objects.create_user(username='other-customer', role=self.customer_role)
        CustomerProfile.objects.create(user=other)
        self.auth(other)
        self.assertEqual(self.post(body).status_code, 409)
        status = self.client.get('/api/bookings/checkout-status/', {'client_ref': body['client_ref']})
        self.assertEqual(status.data, {'booking': None})
        self.assertEqual(Booking.objects.count(), 1)

    def test_recovery_requires_customer_and_does_not_create_or_expose_other_bookings(self):
        body = self.payload()
        path = '/api/bookings/checkout-status/'
        self.assertEqual(self.client.get(path, {'client_ref': body['client_ref']}).data, {'booking': None})
        booking = self.post(body)
        self.assertEqual(self.client.get(path, {'client_ref': body['client_ref']}).data['booking']['id'], booking.data['id'])
        self.assertEqual(self.client.get(path, {'client_ref': 'bad'}).status_code, 400)
        self.auth(self.staff_a)
        self.assertEqual(self.client.get(path, {'client_ref': body['client_ref']}).status_code, 403)

    def test_invalid_later_line_leaves_no_partial_booking(self):
        body = self.payload()
        body['items'][1]['quantity'] = 0
        self.assertEqual(self.post(body).status_code, 400)
        self.assertFalse(Booking.objects.exists())
        self.assertFalse(BookingItem.objects.exists())

    def test_failure_after_booking_and_first_line_rolls_back_notifications_and_all_lines(self):
        body = self.payload()
        create = BookingItem.objects.create
        calls = 0
        def fail_second(**kwargs):
            nonlocal calls
            calls += 1
            if calls == 2:
                raise ValidationError('Synthetic later-line failure')
            return create(**kwargs)
        before = Notification.objects.count()
        with patch('core.booking_items.BookingItem.objects.create', side_effect=fail_second):
            self.assertEqual(self.post(body).status_code, 400)
        self.assertFalse(Booking.objects.exists())
        self.assertFalse(BookingItem.objects.exists())
        self.assertEqual(Notification.objects.count(), before)
        self.assertEqual(self.post(body).status_code, 201)

    @override_settings(ACCESSORIES_ENABLED=False)
    def test_delivery_deducts_all_cylinders_and_preserves_snapshots(self):
        response = self.post(self.payload())
        self.assertEqual(response.status_code, 201, response.data)
        booking = Booking.objects.get(pk=response.data['id'])
        self.auth(self.admin)
        self.assertEqual(self.client.post(f'/api/bookings/{booking.pk}/approve/', {'assigned_staff': self.staff_a.pk}, format='json').status_code, 200)
        self.auth(self.staff_a)
        delivery = booking.delivery
        for action in ('accept', 'start'):
            self.assertEqual(self.client.post(f'/api/deliveries/{delivery.pk}/{action}/', {}, format='json').status_code, 200)
        response = self.client.post(f'/api/deliveries/{delivery.pk}/complete/', {
            'payment_collected': '1820', 'payment_method': 'cash',
            'empty_collected_by_type': {str(self.cylinder.pk): 2, str(self.other.pk): 0}}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(self.stock_qty(self.shop, 'filled'), 18)
        self.assertEqual(self.stock_qty(self.shop, 'filled', self.other), 9)
        self.assertEqual(SaleItem.objects.count(), 2)
        self.assertEqual(violations(), [])

    def test_catalog_pagination_is_stable_and_includes_inactive_types(self):
        # Names are unique, so the PK tie-breaker is verified on the queryset too.
        from core.views import CylinderTypeViewSet
        self.assertEqual(CylinderTypeViewSet.queryset.query.order_by, ('weight', 'name', 'pk'))
        for index in range(12):
            CylinderType.objects.create(name=f'Catalog {index:02}', weight=1, selling_price=0, is_active=index != 0)
        expected = list(CylinderType.objects.order_by('weight', 'name', 'pk').values_list('pk', flat=True))
        rows = []
        for page in (1, 2):
            response = self.client.get('/api/cylinder-types/', {'page': page})
            self.assertEqual(response.status_code, 200)
            rows.extend(row['id'] for row in response.data['results'])
        self.assertEqual(rows, expected)
