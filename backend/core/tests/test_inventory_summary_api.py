import uuid
from core.models import Product, ProductCategory
from .base import GasBookTestCase


class InventorySummaryApiTests(GasBookTestCase):
    def setUp(self):
        super().setUp()
        category = ProductCategory.objects.create(name='Accessories')
        self.product = Product.objects.create(name='Regulator', category=category, sku='SUMMARY', selling_price=250, stock=10, reserved=8, low_stock_threshold=2)

    def test_admin_receives_actual_threshold_and_stock_on_list_and_detail(self):
        self.auth(self.admin)
        for url in ['/api/products/', f'/api/products/{self.product.pk}/']:
            response = self.client.get(url)
            self.assertEqual(response.status_code, 200)
            row = response.data['results'][0] if 'results' in response.data else response.data
            self.assertEqual((row['stock'], row['reserved'], row['low_stock_threshold']), (10, 8, 2))

    def test_other_roles_do_not_receive_inventory_fields(self):
        for user in [self.customer_user, self.staff_a]:
            self.auth(user)
            response = self.client.get('/api/products/')
            self.assertEqual(response.status_code, 200)
            row = response.data['results'][0]
            for field in ['stock', 'reserved', 'low_stock_threshold']:
                self.assertNotIn(field, row)

    def test_adjustment_and_edit_responses_keep_threshold_for_recalculation(self):
        self.auth(self.admin)
        response = self.client.post(f'/api/products/{self.product.pk}/stock/', {'delta': 1, 'client_ref': str(uuid.uuid4()), 'reason': 'Test stock'}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual((response.data['stock'], response.data['reserved'], response.data['low_stock_threshold']), (11, 8, 2))
        response = self.client.patch(f'/api/products/{self.product.pk}/', {'is_active': False}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertFalse(response.data['is_active'])
        self.assertEqual(response.data['low_stock_threshold'], 2)
