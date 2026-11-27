"""A location cannot be deactivated while a concurrent write is adding stock to it.

Deactivation locks the location row and needs its stock to be zero; every stock write locks the same
row first. Each test fixes the order (the stock write first, held open by a short pause) instead of
racing on timing. Like the other concurrency tests these use real threads and so a TransactionTestCase.
"""
import importlib
import threading
import time
import unittest
import uuid
from unittest import mock

from decimal import Decimal

from django.db import connection, connections
from django.test import TransactionTestCase
from rest_framework.test import APIClient

from core.models import CustomerProfile, CylinderType, Role, Stock, StockLocation, User


def write_then_deactivate(write, location, lock_target, hold=0.5):
    """Send ``write`` (method, url, payload); once it has taken the lock named by ``lock_target``
    and is holding it open, send the deactivation of ``location``. Returns both responses."""
    write_locked = threading.Event()
    module_path, name = lock_target.rsplit(".", 1)
    real = getattr(importlib.import_module(module_path), name)
    results = [None, None]

    def lock_and_hold(*args, **kwargs):
        result = real(*args, **kwargs)
        if threading.current_thread().name == "write" and not write_locked.is_set():
            write_locked.set()
            time.sleep(hold)
        return result

    def worker(index, user, method, url, payload):
        try:
            if index == 1:
                write_locked.wait(timeout=10)
            client = APIClient()
            client.force_authenticate(user)
            response = getattr(client, method)(url, payload, format="json")
            results[index] = (response.status_code, getattr(response, "data", None))
        except Exception as exc:
            results[index] = ("exception", repr(exc))
        finally:
            connections.close_all()

    admin = write[0]
    with mock.patch(lock_target, side_effect=lock_and_hold):
        threads = [
            threading.Thread(target=worker, args=(0, *write), name="write"),
            threading.Thread(target=worker, args=(1, admin, "patch", f"/api/locations/{location.pk}/", {"is_active": False}), name="deactivate"),
        ]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=60)
    return results


@unittest.skipUnless(connection.vendor == "postgresql", "locks are tested on PostgreSQL")
class LocationDeactivationRaceTests(TransactionTestCase):
    def setUp(self):
        roles = {code: Role.objects.create(name=code.title(), code=code) for code in ("admin", "customer")}
        self.admin = User.objects.create_user(username="k-admin", password="x", role=roles["admin"])
        self.customer = CustomerProfile.objects.create(
            user=User.objects.create_user(username="k-cust", password="x", role=roles["customer"], address="1 Road", phone="9822222222")
        )
        self.cylinder = CylinderType.objects.create(name="14kg", weight=Decimal("14.2"), selling_price=Decimal("900"), refill_rate=Decimal("900"))
        self.godown = StockLocation.objects.create(name="Godown 2", code="godown-2")
        self.kandam = StockLocation.objects.create(name="Kandam", code="kandam")  # so Godown 2 is not the last stock location
        self.supplier = StockLocation.objects.create(name="Supplier", code="supplier")

    def set_stock(self, location, filled):
        Stock.objects.create(cylinder_type=self.cylinder, location=location, status=Stock.Status.FILLED, quantity=filled)

    def test_a_sale_that_adds_empties_is_not_lost_to_a_concurrent_deactivation(self):
        body = {
            "client_ref": str(uuid.uuid4()), "customer": self.customer.id, "location": self.godown.id, "payment_mode": "credit",
            "paid_amount": "0.00", "paid_payment_mode": "cash",
            "sale_items": [{"cylinder_type": self.cylinder.id, "quantity": 0, "empty_returned": 3}],
        }
        results = write_then_deactivate(
            (self.admin, "post", "/api/sales/", body), self.godown, "core.serializers.lock_sale_stock")  # runs after the location lock
        self.assertEqual(results[0][0], 201, results)
        self.assertEqual(results[1][0], 409, results)
        self.assertEqual(results[1][1]["code"], "has_stock")
        self.godown.refresh_from_db()
        self.assertTrue(self.godown.is_active)
        self.assertEqual(Stock.objects.get(location=self.godown, status="empty").quantity, 3)

    def test_a_transfer_into_the_location_is_not_lost_to_a_concurrent_deactivation(self):
        self.set_stock(self.kandam, filled=5)
        body = {"cylinder_type": self.cylinder.id, "from_location": self.kandam.id, "to_location": self.godown.id,
                "status": "filled", "quantity": 4}
        results = write_then_deactivate(
            (self.admin, "post", "/api/movements/", body), self.godown, "core.serializers.get_stock_row")
        self.assertEqual(results[0][0], 201, results)
        self.assertEqual(results[1][0], 409, results)
        self.assertEqual(results[1][1]["code"], "has_stock")
        self.godown.refresh_from_db()
        self.assertTrue(self.godown.is_active)
        self.assertEqual(Stock.objects.get(location=self.godown, status="filled").quantity, 4)
