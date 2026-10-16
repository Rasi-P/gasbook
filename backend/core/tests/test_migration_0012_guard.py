"""Migration 0012 refuses to roll back once voids, refunds or payment reversals exist.

These tests reverse 0012 on the test database (never on a real one) and always migrate
forward again afterwards, so the rest of the suite keeps the full schema.
"""
import unittest
import uuid
from decimal import Decimal

from django.core.management import call_command
from django.db import connection, transaction
from django.db.migrations.exceptions import IrreversibleError
from django.db.migrations.recorder import MigrationRecorder
from django.test import TransactionTestCase
from rest_framework.test import APIClient

from core import integrity
from core.models import CustomerProfile, CylinderType, Payment, Role, Sale, Stock, StockLocation, User

D = Decimal
NEW_TABLES = ["core_salevoid", "core_salerefund", "core_paymentreversal"]
MIGRATION = ("core", "0012_sale_void_refund")


@unittest.skipUnless(connection.vendor == "postgresql", "migrations are reversed on PostgreSQL")
class Migration0012RollbackGuardTests(TransactionTestCase):
    def setUp(self):
        admin_role = Role.objects.create(name="Admin", code="admin")
        customer_role = Role.objects.create(name="Customer", code="customer")
        self.admin = User.objects.create_user(username="m-admin", password="x", role=admin_role)
        self.customer = CustomerProfile.objects.create(user=User.objects.create_user(username="m-cust", password="x", role=customer_role))
        self.shop = StockLocation.objects.create(name="Shop", code="shop")
        self.cylinder = CylinderType.objects.create(name="14kg", weight=D("14.2"), selling_price=D("900"), refill_rate=D("900"))
        Stock.objects.create(cylinder_type=self.cylinder, location=self.shop, status=Stock.Status.FILLED, quantity=5)
        self.client = APIClient()
        self.client.force_authenticate(self.admin)
        response = self.client.post("/api/sales/", {
            "client_ref": str(uuid.uuid4()), "customer": self.customer.id, "location": self.shop.id, "payment_mode": "split",
            "paid_amount": "900", "split_payments": [{"mode": "cash", "amount": "500"}, {"mode": "gpay", "amount": "400"}],
            "sale_items": [{"cylinder_type": self.cylinder.id, "quantity": 1, "rate": "900"}],
        }, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        self.sale_id = response.data["id"]

    def tearDown(self):
        call_command("migrate", "core", verbosity=0)  # back to the latest schema whatever happened

    def tables(self):
        with connection.cursor() as cursor:
            names = set(connection.introspection.table_names(cursor))
        return [table for table in NEW_TABLES if table in names]

    def applied(self):
        return MIGRATION in MigrationRecorder(connection).applied_migrations()

    def schema(self):
        """Columns and constraints of the three tables, and 0012's row in django_migrations."""
        with connection.cursor() as cursor:
            cursor.execute("SELECT table_name, column_name, data_type, is_nullable FROM information_schema.columns "
                           "WHERE table_name = ANY(%s) ORDER BY table_name, column_name", [NEW_TABLES])
            columns = cursor.fetchall()
            cursor.execute("SELECT conrelid::regclass::text, conname, pg_get_constraintdef(oid) FROM pg_constraint "
                           "WHERE conrelid::regclass::text = ANY(%s) ORDER BY 1, 2", [NEW_TABLES])
            constraints = cursor.fetchall()
            cursor.execute("SELECT id, applied FROM django_migrations WHERE app = 'core' AND name = '0012_sale_void_refund'")
            record = cursor.fetchall()
        return columns, constraints, record

    def rows(self):
        with connection.cursor() as cursor:
            cursor.execute("SELECT id, total_amount, paid_amount, balance_due FROM core_sale ORDER BY id")
            sales = cursor.fetchall()
            cursor.execute("SELECT id, sale_id, amount, payment_mode FROM core_payment ORDER BY id")
            return sales, cursor.fetchall()

    def test_without_void_records_the_rollback_runs_and_forward_restores_the_schema(self):
        before = self.rows()
        call_command("migrate", "core", "0011", verbosity=0)
        self.assertEqual((self.tables(), self.applied()), ([], False))
        self.assertEqual(self.rows(), before)  # sales and payments are untouched
        call_command("migrate", "core", "0012", verbosity=0)
        self.assertEqual((self.tables(), self.applied()), (NEW_TABLES, True))
        self.assertEqual(self.rows(), before)

    def test_with_a_void_the_rollback_is_refused_and_nothing_changes(self):
        response = self.client.post(f"/api/sales/{self.sale_id}/void/", {"reason": "typo", "outcome": "credit"}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        before = integrity.fingerprint()
        schema_before = self.schema()
        with self.assertRaises(IrreversibleError) as caught, transaction.atomic():
            call_command("migrate", "core", "0011", verbosity=0)
        self.assertEqual(self.schema(), schema_before)  # same columns, constraints and migration record (id, time)
        self.assertEqual(len(schema_before[2]), 1)
        message = str(caught.exception)
        self.assertIn("Refusing to reverse core.0012_sale_void_refund", message)
        self.assertIn("1 sale voids, 2 payment reversals, 2 negative payments", message)
        self.assertIn("Do not use --fake", message)
        self.assertEqual((self.tables(), self.applied()), (NEW_TABLES, True))
        self.assertEqual(integrity.compare_fingerprints(before, integrity.fingerprint()), [])
        self.assertEqual(integrity.violations(), [])
        # The schema is still usable: a refund void on another sale works afterwards.
        self.assertEqual(Payment.objects.filter(sale_id=self.sale_id, amount__lt=0).count(), 2)

    def test_negative_payments_alone_also_block_the_rollback(self):
        Payment.objects.create(customer=self.customer, sale=Sale.objects.get(pk=self.sale_id), amount=D("-1"), payment_mode="cash",
                               received_by=self.admin)
        with self.assertRaises(IrreversibleError) as caught, transaction.atomic():
            call_command("migrate", "core", "0011", verbosity=0)
        self.assertIn("1 negative payments", str(caught.exception))
        self.assertEqual((self.tables(), self.applied()), (NEW_TABLES, True))
