from datetime import datetime, timezone

from django.utils.dateparse import parse_datetime

from core.models import Booking, CustomerProfile, Sale, SaleItem, User
from .test_sale_void import VoidTestCase


class CustomerHistoryTests(VoidTestCase):
    def history(self, **params):
        self.auth(self.customer_user)
        response = self.client.get('/api/bookings/history/', params)
        self.assertEqual(response.status_code, 200, response.data)
        return response.data

    def test_newest_sale_is_on_first_page_across_timezone_offsets(self):
        # Bookings serialize in IST, while direct sales used UTC isoformat. Sorting
        # those strings put a newer sale behind older bookings and off page one.
        booking = self.make_booking()
        sale = self.sell()
        Booking.objects.filter(pk=booking.pk).update(created_at=datetime(2026, 10, 13, 9, tzinfo=timezone.utc))
        Sale.objects.filter(pk=sale.pk).update(created_at=datetime(2026, 10, 13, 10, tzinfo=timezone.utc))
        first = self.history(page_size=1)
        second = self.history(page_size=1, page=2)
        self.assertEqual(first['count'], 2)
        self.assertEqual((first['results'][0]['history_source'], first['results'][0]['source_id']), ('sale', sale.pk))
        self.assertEqual((second['results'][0]['history_source'], second['results'][0]['source_id']), ('booking', booking.pk))

    def test_customer_isolation_duplicates_filters_and_partner(self):
        sale = self.sell()
        # Multiple line items must not multiply a history row.
        SaleItem.objects.create(sale=sale, cylinder_type=self.cylinder, quantity=1, rate=0, total_amount=0)
        linked = self.sell()
        booking = self.make_booking(status='delivered', assigned_staff=self.staff_a, sale=linked)
        other_user = User.objects.create_user(username='other', role=self.customer_role)
        other = CustomerProfile.objects.create(user=other_user)
        self.sell(customer=other.pk)
        rows = self.history()['results']
        self.assertEqual({(r['history_source'], r['source_id']) for r in rows}, {('sale', sale.pk), ('booking', booking.pk)})
        self.assertEqual(len(rows), 2)
        self.assertEqual(next(r for r in rows if r['history_source'] == 'sale')['assigned_staff_name'], 'Sabco Gas')
        self.assertEqual(next(r for r in rows if r['history_source'] == 'booking')['assigned_staff_name'], 'Staff A')
        self.assertEqual(self.history(status='pending')['count'], 0)
        self.assertEqual(self.history(search=f'SALE-{sale.pk}')['count'], 1)
        self.assertEqual(self.history(search=f'SALE-{sale.pk}')['results'][0]['source_id'], sale.pk)
        for user in (self.admin, self.staff_a):
            self.auth(user)
            self.assertEqual(self.client.get('/api/bookings/history/').status_code, 403)
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get('/api/bookings/history/').status_code, 401)

    def test_cancellation_and_refund_use_event_timestamps(self):
        sale = self.sell()
        preview = self.client.get(f'/api/sales/{sale.pk}/void-preview/').data
        self.assertEqual(parse_datetime(preview['created_at']), sale.created_at)
        self.assertEqual(self.void(sale, reason='Returned', outcome='refund').status_code, 200)
        row = self.history(status='cancelled')['results'][0]
        self.assertEqual(row['status'], 'cancelled')
        self.assertEqual(parse_datetime(row['cancelled_at']), sale.void.created_at)
        self.assertIsNone(row['refunded_at'])
        self.assertEqual(self.history(status='delivered')['count'], 0)
        self.auth(self.admin)
        self.assertEqual(self.confirm(sale).status_code, 200)
        row = self.history()['results'][0]
        sale.refresh_from_db()
        self.assertEqual(parse_datetime(row['refunded_at']), sale.void.refund.created_at)
        self.assertEqual(parse_datetime(row['created_at']), sale.created_at)
        self.auth(self.admin)
        report_row = self.client.get('/api/reports/').json()['cancellation_list'][0]
        self.assertEqual(parse_datetime(report_row['refunded_at']), sale.void.refund.created_at)

    def test_staff_delivery_exposes_booking_and_cancellation_events(self):
        booking, delivery = self.assigned_booking()
        self.auth(self.admin)
        self.assertEqual(self.client.post(f'/api/bookings/{booking.pk}/reject/', {'reason': 'Unavailable'}, format='json').status_code, 200)
        booking.refresh_from_db()
        self.auth(self.staff_a)
        row = self.client.get(f'/api/deliveries/{delivery.pk}/').data
        self.assertEqual(parse_datetime(row['booked_at']), booking.created_at)
        self.assertEqual(parse_datetime(row['cancelled_at']), booking.rejected_at)
        self.assertIsNone(row['completed_at'])
        self.auth(self.admin)
        history = self.client.get(f'/api/auth/users/{self.staff_a.pk}/deliveries/').data
        self.assertEqual(parse_datetime(history['results'][0]['cancelled_at']), booking.rejected_at)
