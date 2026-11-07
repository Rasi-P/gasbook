"""Deleting a cylinder type or a location: allowed only when nothing depends on it, and explained when it is not."""
import uuid
from decimal import Decimal as D

from core.models import (
    ActivityLog, CustomerCylinderDiscount, CustomerCylinderRate, CylinderType, Sale, SaleItem, Stock, StockLocation, StockMovement,
)

from .base import GasBookTestCase


class CatalogDeleteBase(GasBookTestCase):
    def setUp(self):
        super().setUp()
        self.kandam = StockLocation.objects.create(name="Kandam", code="kandam")
        self.supplier = StockLocation.objects.create(name="Supplier", code="supplier")
        self.spare = CylinderType.objects.create(name="35kg", weight=D("35"), selling_price=D("0"), deposit_amount=D("1500"), refill_rate=D("2400"))
        self.godown = StockLocation.objects.create(name="Godown 2", code="godown-2")
        self.auth(self.admin)

    def delete_type(self, ct):
        return self.client.delete(f"/api/cylinder-types/{ct.pk}/")

    def delete_location(self, loc):
        return self.client.delete(f"/api/locations/{loc.pk}/")

    def codes(self, response):
        return [b["code"] for b in response.data["blockers"]]


class CylinderTypeDeleteTests(CatalogDeleteBase):
    def test_an_unused_type_is_deleted_and_logged(self):
        usage = self.client.get(f"/api/cylinder-types/{self.spare.pk}/usage/").data
        self.assertEqual(usage["delete_blockers"], [])
        self.assertEqual(self.delete_type(self.spare).status_code, 204)
        self.assertFalse(CylinderType.objects.filter(pk=self.spare.pk).exists())
        self.assertTrue(ActivityLog.objects.filter(action="cylinder_type_deleted", metadata__cylinder_type_id=self.spare.pk).exists())
        ids = {r["id"] for r in self.client.get("/api/cylinder-types/").data["results"]}
        self.assertNotIn(self.spare.pk, ids)

    def test_zero_stock_rows_do_not_block_and_go_with_it(self):
        self.set_stock(self.shop, filled=0, empty=0, cylinder=self.spare)
        self.assertEqual(self.delete_type(self.spare).status_code, 204)
        self.assertFalse(Stock.objects.filter(cylinder_type_id=self.spare.pk).exists())

    def test_stock_blocks_with_its_own_code(self):
        self.set_stock(self.shop, filled=3, empty=1, cylinder=self.spare)
        response = self.delete_type(self.spare)
        self.assertEqual((response.status_code, response.data["code"]), (409, "has_stock"))
        self.assertTrue(CylinderType.objects.filter(pk=self.spare.pk).exists())

    def test_booking_sale_and_movement_history_block_with_a_readable_reason(self):
        self.make_booking()  # the base cylinder is booked
        self.set_stock(self.shop, filled=0, empty=0)
        self.set_stock(self.shop, filled=10)
        sold = self.client.post("/api/sales/", dict(client_ref=str(uuid.uuid4()), customer=self.customer.pk, location=self.shop.pk,
            payment_mode="cash", sale_items=[dict(cylinder_type=self.cylinder.pk, quantity=1, rate_type="refill")]), format="json")
        self.assertEqual(sold.status_code, 201, sold.data)
        StockMovement.objects.create(cylinder_type=self.cylinder, from_location=self.shop, to_location=self.kandam, status="filled", quantity=1, moved_by=self.admin)
        Stock.objects.filter(cylinder_type=self.cylinder).update(quantity=0)  # so only history remains
        usage = self.client.get(f"/api/cylinder-types/{self.cylinder.pk}/usage/").data
        self.assertEqual([b["code"] for b in usage["delete_blockers"]], ["has_history"])
        for word in ("booking", "sale line", "stock movement"):
            self.assertIn(word, usage["delete_blockers"][0]["detail"])
        response = self.delete_type(self.cylinder)
        self.assertEqual((response.status_code, response.data["code"]), (409, "protected"))
        self.assertIn("Deactivate the cylinder type instead", response.data["detail"])
        self.assertTrue(CylinderType.objects.filter(pk=self.cylinder.pk).exists())
        self.assertEqual(SaleItem.objects.filter(cylinder_type=self.cylinder).count(), 1)

    def test_customer_specific_rates_are_not_silently_deleted_with_it(self):
        CustomerCylinderRate.objects.create(customer=self.customer, cylinder_type=self.spare, custom_price=2000)
        CustomerCylinderDiscount.objects.create(customer=self.customer, cylinder_type=self.spare, discount_type="fixed", discount_value=10)
        response = self.delete_type(self.spare)
        self.assertEqual((response.status_code, response.data["code"]), (409, "has_customer_rates"))
        self.assertIn("2 customer-specific", response.data["detail"])
        self.assertTrue(CustomerCylinderRate.objects.filter(cylinder_type=self.spare).exists())
        self.assertTrue(CylinderType.objects.filter(pk=self.spare.pk).exists())

    def test_an_inactive_unused_type_can_be_deleted(self):
        self.spare.is_active = False
        self.spare.save()
        self.assertEqual(self.delete_type(self.spare).status_code, 204)

    def test_only_admins_delete_or_see_usage(self):
        for user in (self.staff_a, self.customer_user):
            self.auth(user)
            self.assertEqual(self.delete_type(self.spare).status_code, 403)
            self.assertEqual(self.client.get(f"/api/cylinder-types/{self.spare.pk}/usage/").status_code, 403)
        self.assertTrue(CylinderType.objects.filter(pk=self.spare.pk).exists())


class LocationDeleteTests(CatalogDeleteBase):
    def test_an_unused_location_is_deleted_and_logged(self):
        self.assertEqual(self.client.get(f"/api/locations/{self.godown.pk}/usage/").data["delete_blockers"], [])
        self.assertEqual(self.delete_location(self.godown).status_code, 204)
        self.assertFalse(StockLocation.objects.filter(pk=self.godown.pk).exists())
        self.assertTrue(ActivityLog.objects.filter(action="location_deleted", metadata__code="godown-2").exists())
        self.assertNotIn("Godown 2", [r["name"] for r in self.client.get("/api/locations/").data["results"]])

    def test_stock_history_and_staff_assignment_each_block(self):
        self.set_stock(self.godown, filled=2)
        r = self.delete_location(self.godown)
        self.assertEqual((r.status_code, r.data["code"]), (409, "has_stock"))
        Stock.objects.filter(location=self.godown).update(quantity=0)
        StockMovement.objects.create(cylinder_type=self.cylinder, from_location=self.godown, to_location=self.shop, status="filled", quantity=1, moved_by=self.admin)
        r = self.delete_location(self.godown)
        self.assertEqual((r.status_code, r.data["code"]), (409, "protected"))
        self.assertIn("stock movement", r.data["detail"])
        StockMovement.objects.all().delete()
        self.staff_a_profile.vehicle_location = self.godown
        self.staff_a_profile.save()
        r = self.delete_location(self.godown)
        self.assertEqual((r.status_code, r.data["code"]), (409, "staff_assigned"))
        self.staff_a_profile.refresh_from_db()
        self.assertEqual(self.staff_a_profile.vehicle_location_id, self.godown.pk)   # not silently unlinked
        self.staff_a_profile.vehicle_location = None
        self.staff_a_profile.save()
        self.assertEqual(self.delete_location(self.godown).status_code, 204)

    def test_a_location_with_sales_cannot_be_deleted(self):
        self.set_stock(self.godown, filled=5)
        sold = self.client.post("/api/sales/", dict(client_ref=str(uuid.uuid4()), customer=self.customer.pk, location=self.godown.pk,
            payment_mode="cash", sale_items=[dict(cylinder_type=self.cylinder.pk, quantity=1, rate_type="refill")]), format="json")
        self.assertEqual(sold.status_code, 201, sold.data)
        Stock.objects.filter(location=self.godown).update(quantity=0)
        usage = self.client.get(f"/api/locations/{self.godown.pk}/usage/").data
        self.assertEqual([b["code"] for b in usage["delete_blockers"]], ["has_history"])
        r = self.delete_location(self.godown)
        self.assertEqual((r.status_code, r.data["code"]), (409, "protected"))
        self.assertIn("1 sale", r.data["detail"])
        self.assertEqual(Sale.objects.count(), 1)

    def test_the_last_active_stock_location_or_supplier_cannot_be_deleted(self):
        self.godown.delete()
        self.kandam.delete()
        r = self.delete_location(self.shop)
        self.assertEqual((r.status_code, r.data["code"]), (409, "last_active_location"))
        r = self.delete_location(self.supplier)
        self.assertEqual((r.status_code, r.data["code"]), (409, "last_active_location"))
        self.assertTrue(StockLocation.objects.filter(pk__in=[self.shop.pk, self.supplier.pk]).count() == 2)

    def test_an_inactive_location_is_not_counted_as_the_last_one_and_can_be_deleted(self):
        self.godown.is_active = False
        self.godown.save()
        self.assertEqual(self.delete_location(self.godown).status_code, 204)

    def test_only_admins_delete(self):
        for user in (self.staff_a, self.customer_user):
            self.auth(user)
            self.assertIn(self.delete_location(self.godown).status_code, (403,))
        self.assertTrue(StockLocation.objects.filter(pk=self.godown.pk).exists())
