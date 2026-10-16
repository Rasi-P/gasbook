from core.models import Notification
from .base import GasBookTestCase


class NotificationAccessTests(GasBookTestCase):
    def setUp(self):
        super().setUp()
        self.booking = self.make_booking()
        self.own = Notification.objects.create(recipient=self.admin, booking=self.booking, title='New booking', body='Review booking')
        self.other = Notification.objects.create(recipient=self.staff_a, booking=self.booking, title='Private staff alert', body='Staff only')

    def test_admin_list_and_detail_are_recipient_scoped(self):
        self.auth(self.admin)
        response = self.client.get('/api/notifications/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual([row['id'] for row in response.data['results']], [self.own.pk])
        self.assertEqual(response.data['results'][0]['booking'], self.booking.pk)
        self.assertEqual(self.client.get(f'/api/notifications/{self.other.pk}/').status_code, 404)

    def test_read_is_persisted_and_repeatable_without_changing_booking(self):
        self.auth(self.admin)
        for _ in range(2):
            response = self.client.post(f'/api/notifications/{self.own.pk}/mark_read/')
            self.assertEqual(response.status_code, 200)
            self.assertTrue(response.data['is_read'])
        self.own.refresh_from_db()
        self.other.refresh_from_db()
        self.booking.refresh_from_db()
        self.assertTrue(self.own.is_read)
        self.assertFalse(self.other.is_read)
        self.assertEqual(self.booking.status, 'pending')
        self.assertEqual(Notification.objects.count(), 2)

    def test_cannot_mark_another_recipients_notification_read(self):
        for user, notification in [(self.admin, self.other), (self.staff_a, self.own), (self.customer_user, self.own)]:
            self.auth(user)
            self.assertEqual(self.client.post(f'/api/notifications/{notification.pk}/mark_read/').status_code, 404)
        self.own.refresh_from_db()
        self.other.refresh_from_db()
        self.assertFalse(self.own.is_read)
        self.assertFalse(self.other.is_read)

    def test_anonymous_requests_are_denied(self):
        self.assertEqual(self.client.get('/api/notifications/').status_code, 401)
        self.assertEqual(self.client.post(f'/api/notifications/{self.own.pk}/mark_read/').status_code, 401)
