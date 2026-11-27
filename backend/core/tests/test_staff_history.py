from datetime import datetime, timezone

from django.utils.dateparse import parse_datetime

from core.models import Booking, Delivery, Payment, Sale, SaleItem, SaleVoid
from .base import GasBookTestCase
from .test_attribution import SaleFixtureMixin


class StaffHistoryTests(SaleFixtureMixin, GasBookTestCase):
    def history(self, user=None, **params):
        self.auth(user or self.staff_a)
        response = self.client.get('/api/deliveries/history/', params)
        self.assertEqual(response.status_code, 200, response.data)
        return response.data

    def test_visibility_is_recorder_or_handover_not_payment_receiver(self):
        recorded = self.orm_sale(self.staff_a)
        handed = self.orm_sale(self.admin, handover=self.staff_a)
        both = self.orm_sale(self.staff_a, handover=self.staff_a)
        hidden = self.orm_sale(self.staff_b, handover=self.staff_b)
        receiver_only = self.orm_sale(self.admin)
        Payment.objects.create(customer=self.customer, sale=receiver_only, amount=900,
                               payment_mode='cash', received_by=self.staff_a)
        self.assertFalse(Booking.objects.exists())
        rows = self.history(staff=self.staff_b.pk, sold_by=self.staff_b.pk, handover_staff=self.staff_b.pk)['results']
        self.assertEqual({r['source_id'] for r in rows}, {recorded.pk, handed.pk, both.pk})
        self.assertEqual(len(rows), 3)
        self.assertTrue(all(r['history_source'] == 'sale' for r in rows))
        self.assertEqual({r['source_id'] for r in self.history(self.staff_b)['results']}, {hidden.pk})

    def test_multiple_lines_and_booking_sale_never_duplicate_entries(self):
        direct = self.orm_sale(self.staff_a, handover=self.staff_a)
        SaleItem.objects.create(sale=direct, cylinder_type=self.cylinder, quantity=1, rate=0, total_amount=0)
        linked = self.orm_sale(self.staff_a, handover=self.staff_a)
        booking = self.make_booking(status='delivered', sale=linked, assigned_staff=self.staff_a)
        delivery = self.make_delivery(booking, self.staff_a, status='delivered', completed_at=booking.created_at)
        other_booking, _ = self.assigned_booking(self.staff_b, booking_status='delivered', delivery_status='delivered')
        rows = self.history()['results']
        self.assertEqual(len(rows), 2)
        self.assertEqual({(r['history_source'], r['source_id']) for r in rows}, {('sale', direct.pk), ('delivery', delivery.pk)})
        delivery_row = next(r for r in rows if r['history_source'] == 'delivery')
        self.assertEqual(delivery_row['delivery'], self.client.get(f'/api/deliveries/{delivery.pk}/').data)
        self.assertNotEqual(delivery_row['delivery']['booking'], other_booking.pk)
        self.assertEqual(len(next(r for r in rows if r['history_source'] == 'sale')['sale']['items']), 2)

    def test_chronological_pagination_uses_completion_and_recorded_instants(self):
        sale = self.orm_sale(self.staff_a)
        booking, delivery = self.assigned_booking(booking_status='delivered', delivery_status='delivered')
        early = datetime(2026, 10, 13, 9, tzinfo=timezone.utc)
        later = datetime(2026, 10, 13, 10, tzinfo=timezone.utc)
        Sale.objects.filter(pk=sale.pk).update(created_at=later)
        # Creation/updated times must not supersede the delivery completion event.
        Delivery.objects.filter(pk=delivery.pk).update(completed_at=early, updated_at=later)
        first = self.history(page_size=1)
        second = self.history(page_size=1, page=2)
        self.assertEqual(first['count'], 2)
        self.assertIsNotNone(first['next'])
        self.assertEqual((first['results'][0]['history_source'], first['results'][0]['source_id']), ('sale', sale.pk))
        self.assertEqual(parse_datetime(first['results'][0]['occurred_at']), later)
        self.assertEqual((second['results'][0]['history_source'], second['results'][0]['source_id']), ('delivery', delivery.pk))
        self.assertEqual(parse_datetime(second['results'][0]['occurred_at']), early)
        # Equal event times still have a stable total order across page boundaries.
        Delivery.objects.filter(pk=delivery.pk).update(completed_at=later)
        keys = [(r['history_source'], r['source_id']) for page in (1, 2)
                for r in self.history(page_size=1, page=page)['results']]
        self.assertEqual(len(set(keys)), 2)
        self.assertEqual(keys, [(r['history_source'], r['source_id']) for r in self.history()['results']])

    def test_cancelled_sales_have_sale_status_and_original_recorded_time(self):
        sale = self.orm_sale(self.admin, handover=self.staff_a)
        void = SaleVoid.objects.create(sale=sale, voided_by=self.admin, reason='Returned', outcome='credit',
                                       paid_amount=900, cancelled_balance=0, refund_due=0)
        row = self.history()['results'][0]
        self.assertEqual(row['sale']['status'], 'cancelled')
        self.assertEqual(parse_datetime(row['sale']['created_at']), sale.created_at)
        self.assertEqual(parse_datetime(row['sale']['cancelled_at']), void.created_at)
        self.assertEqual(parse_datetime(row['occurred_at']), sale.created_at)
        self.assertEqual(row['sale']['customer_name'], 'Cust One')
        self.assertEqual(row['sale']['total_amount'], '900.00')
        self.assertNotIn('delivery', row)
        self.assertNotIn('delivered_at', row['sale'])
        self.assertNotIn('payments', row['sale'])

    def test_return_only_excluded_free_cylinders_included_and_missing_completion_last(self):
        returned = self.orm_sale(self.staff_a, total='0')
        returned.items.update(quantity=0, empty_returned=1)
        free = self.orm_sale(self.staff_a, total='0')
        booking, delivery = self.assigned_booking(booking_status='delivered', delivery_status='delivered')
        rows = self.history()['results']
        self.assertEqual([(r['history_source'], r['source_id']) for r in rows], [('sale', free.pk), ('delivery', delivery.pk)])
        self.assertIsNone(rows[-1]['occurred_at'])
        self.assertEqual(rows[0]['sale']['status'], 'completed')

    def test_staff_only_read_only_and_general_sales_api_stays_restricted(self):
        for user in (self.customer_user, self.admin):
            self.auth(user)
            self.assertEqual(self.client.get('/api/deliveries/history/').status_code, 403)
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get('/api/deliveries/history/').status_code, 401)
        self.auth(self.staff_a)
        self.assertEqual(self.client.post('/api/deliveries/history/', {}, format='json').status_code, 405)
        self.assertEqual(self.client.get('/api/sales/').status_code, 403)
