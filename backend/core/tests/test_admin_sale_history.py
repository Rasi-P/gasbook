"""Admin handover and per-user direct-sale history, without changing delivery eligibility."""
from decimal import Decimal
from django.utils import timezone
from core.models import Payment, Sale, SaleVoid, User
from .base import GasBookTestCase
from .test_attribution import SaleFixtureMixin


class AdminSaleHistoryTests(SaleFixtureMixin, GasBookTestCase):
    def setUp(self):
        super().setUp()
        self.other = User.objects.create_user(username="admin2", role=self.admin_role, first_name="Other", last_name="Admin")
        self.auth(self.admin)

    def test_other_admin_handover_preserves_recorder_and_collector(self):
        self.set_stock(self.shop, filled=10)
        for handover in (self.other, self.admin):
            response = self.client.post('/api/sales/', self.sale_payload(handover_staff=handover.pk), format='json')
            self.assertEqual(response.status_code, 201, response.data)
            sale = Sale.objects.get(pk=response.data['id'])
            self.assertEqual(sale.handover_staff, handover)
            self.assertEqual(sale.sold_by, self.admin)
            self.assertEqual(Payment.objects.get(sale=sale).received_by, self.admin)
            self.assertEqual(response.data['handover_staff_name'], handover.get_full_name())

    def history(self, **params):
        return self.client.get('/api/sales/', {'involved_user': self.other.pk, 'source': 'direct', **params})

    def test_union_no_duplicates_payment_collection_does_not_grant_involvement(self):
        recorded = self.orm_sale(self.other)
        handed = self.orm_sale(self.admin, self.other)
        both = self.orm_sale(self.other, self.other)
        unrelated = self.orm_sale(self.admin)
        Payment.objects.create(customer=self.customer, sale=unrelated, amount='900', payment_mode='cash', received_by=self.other)
        booking_sale = self.orm_sale(self.other)
        self.make_booking(sale=booking_sale)
        response = self.history()
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual([r['id'] for r in response.data['results']], [both.id, handed.id, recorded.id])
        self.assertEqual(response.data['count'], 3)
        summary = response.data['summary']
        self.assertEqual((summary['total'], summary['completed'], summary['cancelled']), (3, 3, 0))
        self.assertEqual(Decimal(summary['sales_amount']), Decimal('2700.00'))

    def test_history_of_inactive_admin_and_cancelled_sales_is_preserved(self):
        sale = self.orm_sale(self.admin, self.other)
        SaleVoid.objects.create(sale=sale, reason='Test cancellation', outcome='refund', paid_amount='900',
                                cancelled_balance='0', refund_due='900', voided_by=self.admin)
        self.other.is_active = False
        self.other.save(update_fields=['is_active'])
        response = self.history(void_status='refund_pending')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['results'][0]['void']['status'], 'refund_pending')
        self.assertEqual(response.data['summary'], {'total': 1, 'completed': 0, 'cancelled': 1, 'sales_amount': '0.00'})
        self.assertEqual(self.history(void_status='active').data['count'], 0)

    def test_sort_before_pagination_search_and_date_filters(self):
        sales = [self.orm_sale(self.other) for _ in range(3)]
        timestamp = timezone.now()
        Sale.objects.filter(pk__in=[s.pk for s in sales]).update(created_at=timestamp)
        response = self.history(page_size=1, page=2)
        self.assertEqual(response.data['results'][0]['id'], sales[1].id)
        self.assertEqual(response.data['summary']['total'], 3)  # all pages
        self.assertEqual(self.history(search=f'#{sales[0].id}').data['count'], 1)
        self.assertEqual(self.history(search='Cust One').data['count'], 3)
        self.assertEqual(self.history(start='2100-01-01').data['count'], 0)
        self.assertEqual(self.history(start='2026-02-02', end='2026-01-01').status_code, 400)

    def test_admin_only_options_and_history_validate_target(self):
        options = self.client.get('/api/sales/handover-options/').data['results']
        self.assertEqual(next(r for r in options if r['user'] == self.other.pk)['role'], 'admin')
        self.assertNotIn(self.customer_user.pk, [r['user'] for r in options])
        self.assertEqual(self.history(involved_user=self.customer_user.pk).status_code, 404)
        self.assertEqual(self.history(involved_user='bad').status_code, 400)
        for user in (self.staff_a, self.customer_user):
            self.auth(user)
            self.assertEqual(self.history().status_code, 403)
            self.assertEqual(self.client.get('/api/sales/handover-options/').status_code, 403)
        self.client.force_authenticate(user=None)
        self.assertEqual(self.history().status_code, 401)
