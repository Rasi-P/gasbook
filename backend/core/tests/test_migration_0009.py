import importlib

from django.apps import apps
from django.utils import timezone

from core.models import Booking

from .base import GasBookTestCase

migration = importlib.import_module("core.migrations.0009_deletion_policy_and_cleanup")


class Migration0009DataFixTests(GasBookTestCase):
    def test_clears_stale_rejected_fields_on_non_rejected_bookings_only(self):
        now = timezone.now()
        stale = self.make_booking(
            status=Booking.Status.APPROVED,
            assigned_staff=self.staff_a,
            rejection_reason="Too far",
            rejected_by=self.staff_a,
            rejected_by_role="staff",
            rejected_at=now,
        )
        pending_stale = self.make_booking(
            status=Booking.Status.PENDING, rejection_reason="Busy", rejected_by=self.staff_b, rejected_by_role="staff", rejected_at=now
        )
        rejected = self.make_booking(
            status=Booking.Status.REJECTED,
            rejection_reason="Out of stock",
            rejected_by=self.admin,
            rejected_by_role="admin",
            rejected_at=now,
        )

        migration.clear_stale_rejection_fields(apps, None)

        for booking in (stale, pending_stale):
            booking.refresh_from_db()
            self.assertIsNone(booking.rejection_reason)
            self.assertIsNone(booking.rejected_by)
            self.assertIsNone(booking.rejected_by_role)
            self.assertIsNone(booking.rejected_at)
        stale.refresh_from_db()
        self.assertEqual(stale.status, Booking.Status.APPROVED)
        self.assertEqual(stale.assigned_staff, self.staff_a)

        rejected.refresh_from_db()
        self.assertEqual(rejected.rejection_reason, "Out of stock")
        self.assertEqual(rejected.rejected_by, self.admin)
        self.assertEqual(rejected.rejected_by_role, "admin")
        self.assertEqual(rejected.rejected_at, now)

        # Reverse is a no-op and must not raise.
        migration.noop(apps, None)

    def test_migration_declares_the_data_fix_and_protect_changes(self):
        operations = migration.Migration.operations
        altered = {(op.model_name, op.name): op.field.remote_field.on_delete.__name__ for op in operations if hasattr(op, "field")}
        self.assertEqual(
            altered,
            {
                ("activitylog", "user"): "SET_NULL",
                ("booking", "customer"): "PROTECT",
                ("delivery", "staff"): "PROTECT",
                ("expense", "spent_by"): "PROTECT",
                ("payment", "customer"): "PROTECT",
                ("payment", "received_by"): "PROTECT",
                ("sale", "customer"): "PROTECT",
                ("sale", "sold_by"): "PROTECT",
            },
        )
        self.assertIs(operations[-1].code, migration.clear_stale_rejection_fields)
        self.assertIs(operations[-1].reverse_code, migration.noop)
        self.assertEqual(migration.Migration.dependencies, [("core", "0008_merge_20260821_1743")])
