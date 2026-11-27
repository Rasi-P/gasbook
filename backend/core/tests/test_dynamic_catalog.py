"""Admin-managed cylinder types and stock locations, and how they behave across the app.

Inactive records are refused by the API for NEW transactions (not just hidden in the UI), while
everything already recorded keeps showing them.
"""
import importlib
import io
import uuid
from decimal import Decimal as D

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from django.utils import timezone
from PIL import Image

from core.models import (
    ActivityLog, Booking, CylinderType, Delivery, Sale, SaleItem, Stock, StockLocation, StockMovement,
)

from .base import GasBookTestCase

MEDIA = override_settings(MEDIA_ROOT="/tmp/gasbook-dynamic-catalog-test-media")


def picture(name="cyl.png", fmt="PNG", size=(40, 60)):
    buffer = io.BytesIO()
    Image.new("RGB", size, "#336699").save(buffer, fmt)
    return SimpleUploadedFile(name, buffer.getvalue(), content_type=f"image/{fmt.lower()}")


class DynamicCatalogBase(GasBookTestCase):
    def setUp(self):
        super().setUp()
        self.kandam = StockLocation.objects.create(name="Kandam", code="kandam")
        self.supplier = StockLocation.objects.create(name="Supplier", code="supplier")
        self.small = CylinderType.objects.create(
            name="5kg", weight=D("5"), selling_price=D("450"), deposit_amount=D("300"), refill_rate=D("360")
        )
        self.set_stock(self.shop, filled=10, empty=2)
        self.set_stock(self.kandam, filled=6, empty=1)
        self.set_stock(self.shop, filled=4, cylinder=self.small)

    def sale_payload(self, location, **overrides):
        body = {
            "client_ref": str(uuid.uuid4()), "customer": self.customer.id, "location": location.id,
            "payment_mode": "cash",
            "sale_items": [{"cylinder_type": self.cylinder.id, "quantity": 1, "rate": "900", "empty_returned": 0}],
        }
        body.update(overrides)
        return body

    def movement(self, source, dest, cylinder=None, status="filled", quantity=1, note=""):
        return self.client.post(
            "/api/movements/",
            {"cylinder_type": (cylinder or self.cylinder).pk, "from_location": source.pk, "to_location": dest.pk,
             "status": status, "quantity": quantity, "note": note},
            format="json",
        )

    def qty(self, location, status="filled", cylinder=None):
        row = Stock.objects.filter(cylinder_type=cylinder or self.cylinder, location=location, status=status).first()
        return row.quantity if row else 0


@MEDIA
class CylinderTypeManagementTests(DynamicCatalogBase):
    def create(self, **fields):
        body = {"name": "35kg", "weight": "35", "deposit_amount": "1500", "refill_rate": "2400"}
        body.update(fields)
        return self.client.post("/api/cylinder-types/", body, format="multipart")

    def test_admin_creates_with_separate_refill_and_deposit_and_image(self):
        self.auth(self.admin)
        response = self.create(image=picture())
        self.assertEqual(response.status_code, 201, response.data)
        row = CylinderType.objects.get(name="35kg")
        self.assertEqual((row.deposit_amount, row.refill_rate), (D("1500"), D("2400")))
        self.assertEqual(row.selling_price, D("0"))  # legacy column: not part of the business model, never entered
        self.assertTrue(row.is_active)
        self.assertIn("/media/cylinder-images/", response.data["image"])
        self.assertTrue(response.data["image"].startswith("http"))  # built from the request host, not hardcoded
        self.assertTrue(ActivityLog.objects.filter(action="cylinder_type_created").exists())

    def test_edit_changes_prices_without_repricing_history(self):
        self.auth(self.admin)
        self.set_stock(self.shop, filled=10)
        sold = self.client.post("/api/sales/", self.sale_payload(self.shop), format="json")
        self.assertEqual(sold.status_code, 201, sold.data)
        booking = self.make_booking(quantity=2)
        item_before = SaleItem.objects.get()
        booking_total = booking.final_amount
        response = self.client.patch(
            f"/api/cylinder-types/{self.cylinder.pk}/",
            {"refill_rate": "1000", "deposit_amount": "700"}, format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        item_after = SaleItem.objects.get()
        self.assertEqual((item_after.rate, item_after.total_amount), (item_before.rate, item_before.total_amount))
        self.assertEqual((item_after.deposit_unit_amount, item_after.refill_unit_amount),
                         (item_before.deposit_unit_amount, item_before.refill_unit_amount))
        booking.refresh_from_db()
        self.assertEqual(booking.final_amount, booking_total)
        # a NEW transaction uses the new rates
        preview = self.client.post("/api/sales/", self.sale_payload(
            self.shop, sale_items=[{"cylinder_type": self.cylinder.id, "quantity": 1, "rate_type": "new"}]), format="json")
        self.assertEqual(preview.status_code, 201, preview.data)
        self.assertEqual(Sale.objects.order_by("-id").first().total_amount, D("1700.00"))

    def test_validation_messages(self):
        self.auth(self.admin)
        cases = [
            ({"name": "   "}, "name"), ({"weight": "0"}, "weight"), ({"weight": "abc"}, "weight"),
            ({"refill_rate": "-5"}, "refill_rate"),
            ({"deposit_amount": "-5"}, "deposit_amount"), ({"name": "x" * 81}, "name"),
        ]
        for fields, field in cases:
            response = self.create(**fields)
            self.assertEqual(response.status_code, 400, (fields, response.data))
            self.assertIn(field, response.data, (fields, response.data))
        self.assertFalse(CylinderType.objects.filter(name="35kg").exists())

    def test_image_must_be_a_real_supported_picture(self):
        self.auth(self.admin)
        bad = SimpleUploadedFile("note.png", b"not an image", content_type="image/png")
        self.assertEqual(self.create(image=bad).status_code, 400)
        gif = picture("a.gif", "GIF")
        response = self.create(image=gif)
        self.assertEqual(response.status_code, 400)
        self.assertIn("image", response.data)
        self.assertEqual(self.create(image=picture(size=(5000, 10))).status_code, 400)
        self.assertFalse(CylinderType.objects.filter(name="35kg").exists())

    def test_duplicate_names_are_refused_ignoring_case_and_spacing(self):
        self.auth(self.admin)
        response = self.create(name="  5KG ")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["code"], "duplicate_name")
        self.assertEqual(response.data["existing_id"], self.small.pk)
        self.assertEqual(self.client.patch(f"/api/cylinder-types/{self.cylinder.pk}/", {"name": "5kg"}, format="json").status_code, 400)
        # keeping your own name is fine, and so is a new name
        self.assertEqual(self.client.patch(f"/api/cylinder-types/{self.small.pk}/", {"name": "5kg"}, format="json").status_code, 200)
        self.assertEqual(self.client.patch(f"/api/cylinder-types/{self.small.pk}/", {"name": " 5 kg  small"}, format="json").status_code, 200)
        self.small.refresh_from_db()
        self.assertEqual(self.small.name, "5 kg small")

    def test_duplicate_of_an_inactive_type_points_to_reactivation(self):
        self.auth(self.admin)
        self.small.is_active = False
        self.small.save()
        response = self.create(name="5kg")
        self.assertEqual(response.status_code, 400)
        self.assertIn("reactivate", response.data["detail"])

    def test_a_full_update_that_omits_is_active_does_not_reactivate(self):
        self.auth(self.admin)
        self.small.is_active = False
        self.small.save()
        body = {"name": "5kg", "weight": "5", "selling_price": "450", "deposit_amount": "300", "refill_rate": "360"}
        self.assertEqual(self.client.put(f"/api/cylinder-types/{self.small.pk}/", body, format="json").status_code, 200)
        self.small.refresh_from_db()
        self.assertFalse(self.small.is_active)
        # creating without it is active, for JSON as well as for multipart forms
        made = self.client.post("/api/cylinder-types/", {**body, "name": "6kg"}, format="json")
        self.assertTrue(made.data["is_active"])
        loc = self.client.post("/api/locations/", {"name": "Godown 9"}, format="json")
        self.assertTrue(loc.data["is_active"])
        off = self.client.post("/api/locations/", {"name": "Godown 10", "is_active": False}, format="json")
        self.assertFalse(off.data["is_active"])

    def test_only_admins_change_the_catalog_everyone_signed_in_can_read(self):
        for user in (self.staff_a, self.customer_user):
            self.auth(user)
            self.assertEqual(self.client.get("/api/cylinder-types/").status_code, 200)
            self.assertEqual(self.create().status_code, 403)
            self.assertEqual(self.client.patch(f"/api/cylinder-types/{self.cylinder.pk}/", {"is_active": False}, format="json").status_code, 403)
            self.assertEqual(self.client.get(f"/api/cylinder-types/{self.cylinder.pk}/usage/").status_code, 403)
        self.assertTrue(self.cylinder.__class__.objects.get(pk=self.cylinder.pk).is_active)

    def test_active_filter_and_inactive_stay_listed(self):
        self.auth(self.admin)
        self.small.is_active = False
        self.small.save()
        everything = {r["id"] for r in self.client.get("/api/cylinder-types/").data["results"]}
        active = {r["id"] for r in self.client.get("/api/cylinder-types/?active=1").data["results"]}
        inactive = {r["id"] for r in self.client.get("/api/cylinder-types/?active=0").data["results"]}
        self.assertEqual(everything, {self.cylinder.pk, self.small.pk})
        self.assertEqual(active, {self.cylinder.pk})
        self.assertEqual(inactive, {self.small.pk})
        self.assertEqual({r["id"] for r in self.client.get("/api/cylinder-types/?search=5k").data["results"]}, {self.small.pk})

    def test_deactivating_keeps_every_record_and_usage_reports_dependents(self):
        self.auth(self.admin)
        booking = self.make_booking(quantity=1)
        usage = self.client.get(f"/api/cylinder-types/{self.cylinder.pk}/usage/").data
        self.assertEqual((usage["stock_filled"], usage["stock_empty"], usage["open_bookings"]), (16, 3, 1))
        response = self.client.patch(f"/api/cylinder-types/{self.cylinder.pk}/", {"is_active": False}, format="json")
        self.assertEqual(response.status_code, 200)
        self.cylinder.refresh_from_db()
        self.assertFalse(self.cylinder.is_active)
        self.assertEqual(Stock.objects.filter(cylinder_type=self.cylinder).count(), 4)
        self.assertTrue(Booking.objects.filter(pk=booking.pk).exists())
        self.assertTrue(ActivityLog.objects.filter(action="cylinder_type_deactivated").exists())

    def test_replacing_and_removing_the_image_cleans_the_old_file(self):
        self.auth(self.admin)
        with self.captureOnCommitCallbacks(execute=True):
            made = self.create(image=picture("one.png"))
        row = CylinderType.objects.get(pk=made.data["id"])
        first = row.image.name
        self.assertTrue(row.image.storage.exists(first))
        with self.captureOnCommitCallbacks(execute=True):
            self.client.patch(f"/api/cylinder-types/{row.pk}/", {"image": picture("two.png")}, format="multipart")
        row.refresh_from_db()
        self.assertNotEqual(row.image.name, first)
        self.assertFalse(row.image.storage.exists(first))
        second = row.image.name
        with self.captureOnCommitCallbacks(execute=True):
            response = self.client.patch(f"/api/cylinder-types/{row.pk}/", {"remove_image": "true"}, format="multipart")
        self.assertEqual(response.status_code, 200)
        row.refresh_from_db()
        self.assertFalse(row.image)
        self.assertFalse(row.image.storage.exists(second))
        self.assertIsNone(response.data["image"])

    def test_existing_types_without_an_image_still_serialize(self):
        self.auth(self.customer_user)
        rows = self.client.get("/api/cylinder-types/").data["results"]
        self.assertTrue(all(r["image"] is None for r in rows))


class InactiveCylinderTypeEnforcementTests(DynamicCatalogBase):
    def setUp(self):
        super().setUp()
        self.small.is_active = False
        self.small.save()

    def test_new_bookings_refuse_an_inactive_type(self):
        self.auth(self.customer_user)
        response = self.client.post("/api/bookings/", {"cylinder_type": self.small.pk, "quantity": 1}, format="json")
        self.assertEqual(response.status_code, 400, response.data)
        self.assertIn("cylinder_type", response.data)
        self.assertEqual(Booking.objects.count(), 0)

    def test_direct_sales_refuse_to_sell_but_accept_empties_of_an_inactive_type(self):
        self.auth(self.admin)
        sell = self.client.post("/api/sales/", self.sale_payload(
            self.shop, sale_items=[{"cylinder_type": self.small.id, "quantity": 1, "rate": "450", "empty_returned": 0}]), format="json")
        self.assertEqual(sell.status_code, 400)
        self.assertEqual(sell.data["code"], "cylinder_inactive")
        empties = self.client.post("/api/sales/", self.sale_payload(
            self.shop, sale_items=[{"cylinder_type": self.small.id, "quantity": 0, "empty_returned": 2}],
            payment_mode="credit"), format="json")
        self.assertEqual(empties.status_code, 201, empties.data)
        self.assertEqual(self.qty(self.shop, "empty", self.small), 2)

    def test_stock_movements_cannot_load_or_refill_an_inactive_type_but_can_move_existing_stock(self):
        self.auth(self.admin)
        load = self.movement(self.supplier, self.shop, self.small, note="New supplier load")
        self.assertEqual(load.status_code, 400)
        self.assertEqual(load.data["code"], "cylinder_inactive")
        refill = self.movement(self.shop, self.supplier, self.small, status="empty")
        self.assertEqual(refill.status_code, 400)
        moved = self.movement(self.shop, self.kandam, self.small, quantity=3)
        self.assertEqual(moved.status_code, 201, moved.data)
        self.assertEqual((self.qty(self.shop, cylinder=self.small), self.qty(self.kandam, cylinder=self.small)), (1, 3))

    def test_a_booking_placed_before_deactivation_can_still_be_delivered(self):
        self.small.is_active = True
        self.small.save()
        booking = self.make_booking(quantity=1)
        booking.cylinder_type = self.small
        booking.save()
        booking.assigned_staff = self.staff_a
        booking.status = Booking.Status.APPROVED
        booking.save()
        delivery = self.make_delivery(booking, self.staff_a)
        self.small.is_active = False
        self.small.save()
        self.auth(self.staff_a)
        response = self.client.post(f"/api/deliveries/{delivery.pk}/complete/", {}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(self.qty(self.shop, cylinder=self.small), 3)

    def test_history_and_reports_still_show_the_inactive_type(self):
        self.auth(self.admin)
        self.small.is_active = True
        self.small.save()
        sale = self.client.post("/api/sales/", self.sale_payload(
            self.shop, sale_items=[{"cylinder_type": self.small.id, "quantity": 1, "rate": "360", "empty_returned": 0}]), format="json")
        self.assertEqual(sale.status_code, 201, sale.data)
        self.small.is_active = False
        self.small.save()
        listed = self.client.get("/api/sales/").data["results"][0]
        self.assertEqual(listed["items"][0]["cylinder_type_name"], "5kg")
        today = timezone.localdate().isoformat()
        report = self.client.get(f"/api/reports/?start={today}&end={today}").data
        self.assertEqual([r["cylinder_type__name"] for r in report["cylinder_sales"]], ["5kg"])
        # 3 filled cylinders still in stock keep the inactive type in the stock tables and totals
        snapshot = {r["type"]: r for r in report["stock_snapshot"]}
        self.assertIn("5kg", snapshot)
        self.assertFalse(snapshot["5kg"]["is_active"])
        self.assertEqual(snapshot["5kg"]["physical_stock"], 3)
        dash = self.client.get("/api/dashboard/").data
        rows = {r["type"]: r for r in dash["stock_rows"]}
        self.assertIn("5kg", rows)
        self.assertEqual(rows["5kg"]["filled"], 3)
        self.assertEqual(dash["filled_cylinders"], 16 + 3)

    def test_an_inactive_type_with_nothing_left_drops_out_of_the_stock_tables(self):
        self.auth(self.admin)
        Stock.objects.filter(cylinder_type=self.small).update(quantity=0)
        dash = self.client.get("/api/dashboard/").data
        self.assertNotIn("5kg", [r["type"] for r in dash["stock_rows"]])


class HistoryKeepsInactiveRecordsTests(DynamicCatalogBase):
    def test_customer_receipts_and_history_still_show_a_deactivated_type_and_location(self):
        self.auth(self.admin)
        godown = StockLocation.objects.create(name="Godown 2", code="godown-2")
        self.set_stock(godown, filled=5)
        sold = self.client.post("/api/sales/", self.sale_payload(
            godown, sale_items=[{"cylinder_type": self.cylinder.id, "quantity": 1, "rate": "900", "empty_returned": 0}]), format="json")
        self.assertEqual(sold.status_code, 201, sold.data)
        booking = self.make_booking(quantity=1)
        self.cylinder.is_active = False
        self.cylinder.save()
        Stock.objects.filter(location=godown).update(quantity=0)
        godown.is_active = False
        godown.save()
        self.auth(self.customer_user)
        receipt = self.client.get(f"/api/receipts/sale/{sold.data['id']}/")
        self.assertEqual(receipt.status_code, 200, receipt.data)
        self.assertIn("14kg Domestic", str(receipt.data))
        self.assertEqual(self.client.get(f"/api/receipts/booking/{booking.pk}/").status_code, 200)
        history = self.client.get("/api/bookings/history/")
        self.assertEqual(history.status_code, 200)
        self.assertIn("14kg Domestic", str(history.data))
        mine = self.client.get(f"/api/bookings/{booking.pk}/")
        self.assertEqual(mine.data["cylinder_type_name"], "14kg Domestic")
        # staff delivery history also still renders the inactive type
        booking.assigned_staff = self.staff_a
        booking.status = Booking.Status.DELIVERED
        booking.save()
        self.make_delivery(booking, self.staff_a, status=Delivery.Status.DELIVERED)
        self.auth(self.staff_a)
        self.assertEqual(self.client.get("/api/deliveries/").status_code, 200)


class LocationManagementTests(DynamicCatalogBase):
    def add(self, name="Godown 2", **fields):
        return self.client.post("/api/locations/", {"name": name, **fields}, format="json")

    def test_admin_adds_a_location_without_code_changes(self):
        self.auth(self.admin)
        response = self.add()
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["code"], "godown-2")
        self.assertEqual(response.data["kind"], "stock")
        self.assertTrue(response.data["is_active"])
        again = self.add("Godown 2")
        self.assertEqual(again.status_code, 400)
        self.assertEqual(again.data["code"], "duplicate_name")
        self.assertEqual(self.add("  godown   2 ").status_code, 400)
        # a code in the request is ignored; codes are generated and stay unique
        other = self.add("Godown-2", code="shop")
        self.assertEqual(other.status_code, 201, other.data)
        self.assertEqual(other.data["code"], "godown-2-2")
        self.assertEqual(self.add("   ").status_code, 400)

    def test_supplier_type_is_chosen_at_creation_and_then_locked(self):
        self.auth(self.admin)
        made = self.add("Plant B", is_main_supplier=True)
        self.assertEqual(made.status_code, 201)
        self.assertEqual(made.data["kind"], "supplier")
        locked = self.client.patch(f"/api/locations/{made.data['id']}/", {"is_main_supplier": False}, format="json")
        self.assertEqual(locked.status_code, 400)
        self.assertEqual(locked.data["code"], "type_locked")
        self.assertEqual(self.client.patch(f"/api/locations/{made.data['id']}/", {"name": "Plant B2"}, format="json").status_code, 200)

    def test_editing_never_changes_the_code(self):
        self.auth(self.admin)
        self.client.patch(f"/api/locations/{self.shop.pk}/", {"name": "Main shop", "code": "hacked"}, format="json")
        self.shop.refresh_from_db()
        self.assertEqual((self.shop.name, self.shop.code), ("Main shop", "shop"))

    def test_staff_read_but_cannot_change_customers_cannot_see(self):
        self.auth(self.staff_a)
        self.assertEqual(self.client.get("/api/locations/").status_code, 200)
        self.assertEqual(self.add().status_code, 403)
        self.assertEqual(self.client.patch(f"/api/locations/{self.shop.pk}/", {"is_active": False}, format="json").status_code, 403)
        self.assertEqual(self.client.get(f"/api/locations/{self.shop.pk}/usage/").status_code, 403)
        self.auth(self.customer_user)
        self.assertEqual(self.client.get("/api/locations/").status_code, 403)

    def test_filters(self):
        self.auth(self.admin)
        self.add("Godown 2")
        self.kandam.is_active = False
        self.kandam.save()
        names = lambda q: {r["name"] for r in self.client.get(f"/api/locations/{q}").data["results"]}
        self.assertEqual(names(""), {"Shop", "Kandam", "Supplier", "Godown 2"})
        self.assertEqual(names("?active=1&kind=stock"), {"Shop", "Godown 2"})
        self.assertEqual(names("?kind=supplier"), {"Supplier"})
        self.assertEqual(names("?active=0"), {"Kandam"})

    def test_cannot_deactivate_a_location_that_holds_stock(self):
        self.auth(self.admin)
        response = self.client.patch(f"/api/locations/{self.kandam.pk}/", {"is_active": False}, format="json")
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.data["code"], "has_stock")
        self.assertEqual((response.data["stock_filled"], response.data["stock_empty"]), (6, 1))
        self.kandam.refresh_from_db()
        self.assertTrue(self.kandam.is_active)
        # moving the stock out is the resolution
        self.assertEqual(self.movement(self.kandam, self.shop, quantity=6).status_code, 201)
        self.assertEqual(self.movement(self.kandam, self.shop, status="empty", quantity=1).status_code, 201)
        done = self.client.patch(f"/api/locations/{self.kandam.pk}/", {"is_active": False}, format="json")
        self.assertEqual(done.status_code, 200, done.data)
        self.assertEqual(self.qty(self.shop), 16)  # nothing was moved automatically and nothing lost
        self.assertTrue(StockLocation.objects.filter(pk=self.kandam.pk).exists())
        self.assertTrue(ActivityLog.objects.filter(action="location_deactivated").exists())

    def test_cannot_deactivate_the_last_active_stock_location_or_supplier(self):
        self.auth(self.admin)
        Stock.objects.update(quantity=0)
        self.kandam.is_active = False
        self.kandam.save()
        last = self.client.patch(f"/api/locations/{self.shop.pk}/", {"is_active": False}, format="json")
        self.assertEqual((last.status_code, last.data["code"]), (409, "last_active_location"))
        sup = self.client.patch(f"/api/locations/{self.supplier.pk}/", {"is_active": False}, format="json")
        self.assertEqual((sup.status_code, sup.data["code"]), (409, "last_active_location"))
        self.assertEqual(self.client.patch(f"/api/locations/{self.kandam.pk}/", {"is_active": True}, format="json").status_code, 200)

    def test_usage_lists_dependents(self):
        self.auth(self.admin)
        self.client.post("/api/sales/", self.sale_payload(self.shop), format="json")
        usage = self.client.get(f"/api/locations/{self.shop.pk}/usage/").data
        self.assertEqual((usage["sales"], usage["stock_filled"]), (1, 13))

    def test_deleting_a_location_with_history_is_refused(self):
        self.auth(self.admin)
        spare = StockLocation.objects.create(name="Spare", code="spare")
        StockMovement.objects.create(cylinder_type=self.cylinder, from_location=self.shop, to_location=spare,
                                     status="filled", quantity=1, moved_by=self.admin)
        response = self.client.delete(f"/api/locations/{spare.pk}/")
        self.assertEqual(response.status_code, 409)
        self.assertTrue(StockLocation.objects.filter(pk=spare.pk).exists())


class NewLocationWorksEverywhereTests(DynamicCatalogBase):
    def setUp(self):
        super().setUp()
        self.auth(self.admin)
        self.godown = StockLocation.objects.create(name="Godown 2", code="godown-2")

    def test_stock_flows_into_the_new_location_and_totals_stay_correct(self):
        self.assertEqual(self.movement(self.supplier, self.godown, quantity=7, note="New supplier load").status_code, 201)
        self.assertEqual(self.movement(self.shop, self.godown, quantity=3).status_code, 201)
        self.assertEqual(self.qty(self.godown), 10)
        self.assertEqual(self.qty(self.shop), 7)
        # the same cylinder type is tracked independently at each location
        self.assertEqual((self.qty(self.kandam), self.qty(self.godown)), (6, 10))
        rows = self.client.get(f"/api/stock/?location={self.godown.code}").data["results"]
        self.assertEqual([(r["cylinder_type"], r["quantity"]) for r in rows], [(self.cylinder.pk, 10)])
        self.assertEqual(len(self.client.get(f"/api/stock/?location_id={self.godown.pk}").data["results"]), 1)
        dash = self.client.get("/api/dashboard/").data
        row = {r["type"]: r for r in dash["stock_rows"]}[self.cylinder.name]
        by_code = {c["code"]: c for c in row["locations"]}
        self.assertEqual((by_code["shop"]["filled"], by_code["kandam"]["filled"], by_code["godown-2"]["filled"]), (7, 6, 10))
        self.assertEqual(row["filled"], 23)
        self.assertEqual(row["shop_filled"], 7)  # legacy keys still present
        self.assertIn("godown-2", [l["code"] for l in dash["locations"]])
        self.assertEqual(dash["filled_cylinders"], 23 + 4)

    def test_direct_sale_from_the_new_location_debits_only_that_location(self):
        self.set_stock(self.godown, filled=5, empty=0)
        response = self.client.post("/api/sales/", self.sale_payload(
            self.godown, sale_items=[{"cylinder_type": self.cylinder.id, "quantity": 2, "rate": "900", "empty_returned": 1}]), format="json")
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual((self.qty(self.godown), self.qty(self.godown, "empty"), self.qty(self.shop)), (3, 1, 10))
        self.assertEqual(response.data["location_name"], "Godown 2")

    def test_sale_stock_checks_use_the_chosen_locations_stock(self):
        response = self.client.post("/api/sales/", self.sale_payload(self.godown), format="json")  # godown has none
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["code"], "insufficient_stock")
        self.assertEqual(response.data["location_code"], "godown-2")

    def test_sales_refuse_inactive_and_supplier_locations(self):
        self.set_stock(self.godown, filled=5)
        self.godown.is_active = False
        self.godown.save()
        inactive = self.client.post("/api/sales/", self.sale_payload(self.godown), format="json")
        self.assertEqual((inactive.status_code, inactive.data["code"]), (400, "location_inactive"))
        supplier = self.client.post("/api/sales/", self.sale_payload(self.supplier), format="json")
        self.assertEqual((supplier.status_code, supplier.data["code"]), (400, "invalid_location"))
        self.assertEqual(Sale.objects.count(), 0)
        self.assertEqual(self.qty(self.godown), 5)

    def test_staff_sale_endpoint_enforces_the_same_rules(self):
        self.set_stock(self.godown, filled=5)
        self.auth(self.staff_a)
        ok = self.client.post("/api/staff-sales/", self.sale_payload(self.godown), format="json")
        self.assertEqual(ok.status_code, 201, ok.data)
        self.godown.is_active = False
        self.godown.save()
        refused = self.client.post("/api/staff-sales/", self.sale_payload(self.godown), format="json")
        self.assertEqual(refused.status_code, 400)
        self.assertEqual(refused.data["code"], "location_inactive")

    def test_movements_into_an_inactive_location_are_refused_but_out_of_one_is_allowed(self):
        self.movement(self.supplier, self.godown, quantity=4, note="New supplier load")
        self.godown.is_active = False
        self.godown.save()
        into = self.movement(self.shop, self.godown)
        self.assertEqual((into.status_code, into.data["code"]), (400, "location_inactive"))
        out = self.movement(self.godown, self.shop, quantity=4)
        self.assertEqual(out.status_code, 201, out.data)
        self.assertEqual((self.qty(self.godown), self.qty(self.shop)), (0, 14))
        self.supplier.is_active = False
        self.supplier.save()
        sup = self.movement(self.supplier, self.shop, note="New supplier load")
        self.assertEqual((sup.status_code, sup.data["code"]), (400, "location_inactive"))

    def test_history_keeps_showing_a_location_that_was_later_deactivated(self):
        self.set_stock(self.godown, filled=5)
        self.client.post("/api/sales/", self.sale_payload(self.godown), format="json")
        self.movement(self.godown, self.shop, quantity=4)
        self.godown.is_active = False
        self.godown.save()
        today = timezone.localdate().isoformat()
        sale = self.client.get("/api/sales/").data["results"][0]
        self.assertEqual(sale["location_name"], "Godown 2")
        report = self.client.get(f"/api/reports/?start={today}&end={today}").data
        self.assertEqual(report["sales_list"][0]["location_name"], "Godown 2")
        self.assertEqual(report["movement_history"][0]["from_location_name"], "Godown 2")
        self.assertEqual({r["sale__location__name"] for r in report["cylinder_sales"]}, {"Godown 2"})
        self.assertEqual(self.client.get(f"/api/reports/?start={today}&end={today}&location={self.godown.pk}").status_code, 200)
        # the report's stock tables still show the (now empty) inactive location only if it holds stock
        self.assertNotIn("godown-2", [l["code"] for l in report["stock_locations"]])

    def test_an_inactive_location_that_still_holds_stock_stays_in_the_stock_tables(self):
        self.set_stock(self.godown, filled=5, empty=1)
        self.godown.is_active = False  # (the API refuses this with stock; the data can still exist, e.g. via old data)
        self.godown.save()
        today = timezone.localdate().isoformat()
        report = self.client.get(f"/api/reports/?start={today}&end={today}").data
        row = {r["type"]: r for r in report["stock_snapshot"]}[self.cylinder.name]
        self.assertEqual(row["physical_stock"], 10 + 2 + 6 + 1 + 5 + 1)
        self.assertIn("godown-2", [l["code"] for l in report["stock_locations"]])
        dash = self.client.get("/api/dashboard/").data
        self.assertEqual({r["type"]: r for r in dash["stock_rows"]}[self.cylinder.name]["filled"], 10 + 6 + 5)

    def test_report_stock_snapshot_includes_the_new_location_column(self):
        self.set_stock(self.godown, filled=5, empty=2)
        today = timezone.localdate().isoformat()
        report = self.client.get(f"/api/reports/?start={today}&end={today}").data
        row = {r["type"]: r for r in report["stock_snapshot"]}[self.cylinder.name]
        godown = {c["code"]: c for c in row["locations"]}["godown-2"]
        self.assertEqual((godown["filled"], godown["empty"]), (5, 2))
        self.assertEqual(row["physical_stock"], 10 + 2 + 6 + 1 + 5 + 2)
        self.assertEqual((row["shop_filled"], row["kandam_empty"]), (10, 1))


class DeliveryLocationTests(DynamicCatalogBase):
    def complete(self, delivery, payload=None):
        self.auth(self.staff_a)
        return self.client.post(f"/api/deliveries/{delivery.pk}/complete/", payload or {}, format="json")

    def setUp(self):
        super().setUp()
        self.godown = StockLocation.objects.create(name="Godown 2", code="godown-2")
        self.set_stock(self.godown, filled=8)

    def test_default_is_the_shop_and_an_explicit_location_overrides_it(self):
        _booking, delivery = self.assigned_booking(self.staff_a, quantity=2)
        response = self.complete(delivery, {"location": self.godown.pk})
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual((self.qty(self.godown), self.qty(self.shop)), (6, 10))
        self.assertEqual(Sale.objects.get().location, self.godown)
        _booking, delivery = self.assigned_booking(self.staff_a, quantity=2)
        self.assertEqual(self.complete(delivery).status_code, 200)
        self.assertEqual(self.qty(self.shop), 8)

    def test_inactive_supplier_and_unknown_locations_are_refused(self):
        _booking, delivery = self.assigned_booking(self.staff_a, quantity=1)
        self.godown.is_active = False
        self.godown.save()
        for location, code in ((self.godown.pk, "location_inactive"), (self.supplier.pk, "invalid_location"), (99999, "invalid")):
            response = self.complete(delivery, {"location": location})
            self.assertEqual((response.status_code, response.data["code"]), (400, code), response.data)
        self.assertEqual(Sale.objects.count(), 0)
        self.assertEqual(self.qty(self.shop), 10)

    def test_a_choice_is_required_when_the_shop_is_unavailable_and_several_remain(self):
        _booking, delivery = self.assigned_booking(self.staff_a, quantity=1)
        self.shop.is_active = False
        self.shop.save()
        response = self.complete(delivery)
        self.assertEqual((response.status_code, response.data["code"]), (400, "location_required"))
        self.assertEqual({l["name"] for l in response.data["locations"]}, {"Kandam", "Godown 2"})
        self.assertEqual(self.complete(delivery, {"location": self.kandam.pk}).status_code, 200)

    def test_the_only_remaining_location_is_used_automatically(self):
        _booking, delivery = self.assigned_booking(self.staff_a, quantity=1)
        self.shop.is_active = False
        self.shop.save()
        self.godown.is_active = False
        self.godown.save()
        self.assertEqual(self.complete(delivery).status_code, 200)
        self.assertEqual(Sale.objects.get().location, self.kandam)

    def test_a_staff_members_inactive_configured_location_is_skipped(self):
        self.staff_a_profile.vehicle_location = self.godown
        self.staff_a_profile.save()
        self.godown.is_active = False
        self.godown.save()
        _booking, delivery = self.assigned_booking(self.staff_a, quantity=1)
        self.assertEqual(self.complete(delivery).status_code, 200)
        self.assertEqual(Sale.objects.get().location, self.shop)


class MigrationCompatibilityTests(GasBookTestCase):
    def test_0017_only_adds_a_nullable_image_column(self):
        module = importlib.import_module("core.migrations.0017_cylindertype_image")
        migration = module.Migration
        self.assertEqual(migration.dependencies, [("core", "0016_staff_collections_sale_accessories")])
        self.assertEqual(len(migration.operations), 1)
        operation = migration.operations[0]
        self.assertEqual((type(operation).__name__, operation.model_name, operation.name), ("AddField", "cylindertype", "image"))
        self.assertTrue(operation.field.null and operation.field.blank)

    def test_existing_cylinder_types_keep_every_value_and_have_no_image(self):
        fresh = CylinderType.objects.get(pk=self.cylinder.pk)
        self.assertEqual((fresh.name, fresh.selling_price, fresh.refill_rate, fresh.is_active), ("14kg Domestic", D("900"), D("900"), True))
        self.assertFalse(fresh.image)
