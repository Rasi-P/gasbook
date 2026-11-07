"""DRY RUN ONLY: which existing sales could get handover_staff from their booking's delivery.

Nothing is written under any invocation. There is no option that writes, and the report is
built inside a transaction PostgreSQL itself refuses to write in (integrity.run_read_only).
Actually filling the field would be a separate, reviewed change, made only after the dry-run
output has been approved.

A sale is proposed only when its booking's delivery was completed (status delivered, with a
completion time) by the same user the delivery was assigned to: delivered bookings cannot be
re-assigned, so that person is known to have handed the cylinders over. Everything else is
reported as skipped or ambiguous, with the reason. Direct sales are never proposed: before
handover_staff existed, the handover person was at most a free-text name.
"""
import json

from django.core.management.base import BaseCommand, CommandError
from django.db import connection

from core.integrity import ReadOnlyUnavailable, run_read_only
from core.models import Booking, Delivery, Sale, User
from core.services import display_name


def build_plan():
    with connection.cursor() as cursor:
        sale_columns = {column.name for column in connection.introspection.get_table_description(cursor, Sale._meta.db_table)}
    has_handover = "handover_staff_id" in sale_columns  # absent on a database not yet migrated
    columns = ["id", "sold_by_id", "delivery_staff", "created_at"] + (["handover_staff_id"] if has_handover else [])
    sales = [dict(zip(columns, row)) for row in Sale.objects.order_by("id").values_list(*columns)]

    bookings = {
        row[0]: {"booking_id": row[1], "booking_status": row[2]}
        for row in Booking.objects.exclude(sale_id=None).values_list("sale_id", "id", "status")
    }
    deliveries = {
        row[0]: {"delivery_id": row[1], "status": row[2], "completed_at": row[3], "staff_id": row[4]}
        for row in Delivery.objects.values_list("booking_id", "id", "status", "completed_at", "staff_id")
    }
    users = {user.pk: user for user in User.objects.select_related("role")}
    staff_by_name = {}
    for user in users.values():
        if getattr(user.role, "code", None) == "staff":
            staff_by_name.setdefault(display_name(user).casefold(), []).append(user.pk)

    def who(user_id):
        user = users.get(user_id)
        return {"id": user_id, "name": display_name(user) if user else None, "username": user.username if user else None}

    proposed, ambiguous, skipped = [], [], []
    for sale in sales:
        base = {"sale_id": sale["id"], "created_at": sale["created_at"].isoformat(), "recorded_by": who(sale["sold_by_id"])}
        if sale.get("handover_staff_id"):
            skipped.append({**base, "reason": "handover already recorded"})
            continue
        booking = bookings.get(sale["id"])
        if booking is None:
            text = (sale["delivery_staff"] or "").strip()
            if not text:
                skipped.append({**base, "reason": "direct sale with no handover recorded"})
            else:
                matches = staff_by_name.get(text.casefold(), [])
                ambiguous.append({
                    **base, "delivery_staff_text": text, "staff_with_that_name": [who(pk) for pk in matches],
                    "reason": f"direct sale: handover recorded only as the text {text!r} "
                              f"({len(matches)} staff with that name); not filled from text",
                })
            continue
        base = {**base, "booking_id": booking["booking_id"], "order_id": f"GB{booking['booking_id']}"}
        delivery = deliveries.get(booking["booking_id"])
        if delivery is None:
            skipped.append({**base, "reason": "booking has no delivery record"})
        elif delivery["status"] != Delivery.Status.DELIVERED or delivery["completed_at"] is None:
            skipped.append({**base, "reason": f"delivery not completed (status {delivery['status']})"})
        elif delivery["staff_id"] != sale["sold_by_id"]:
            ambiguous.append({
                **base, "delivery_staff": who(delivery["staff_id"]),
                "reason": "delivery assigned to one user but the sale was recorded by another",
            })
        else:
            staff = users.get(delivery["staff_id"])
            proposed.append({
                **base, "handover_staff": who(delivery["staff_id"]),
                "staff_active": bool(staff and staff.is_active),
                "completed_at": delivery["completed_at"].isoformat(),
            })

    return {
        "dry_run": True,
        "handover_column_present": has_handover,
        "counts": {"sales": len(sales), "proposed": len(proposed), "ambiguous": len(ambiguous), "skipped": len(skipped)},
        "proposed": proposed,
        "ambiguous": ambiguous,
        "skipped": skipped,
    }


class Command(BaseCommand):
    help = (
        "DRY RUN ONLY. Report which sales could get handover_staff from their booking's delivery, "
        "and which are skipped or ambiguous. Never writes to the database."
    )

    def add_arguments(self, parser):
        parser.add_argument("--json", action="store_true", help="Print the full plan as JSON.")

    def handle(self, *args, **options):
        try:
            plan = run_read_only(build_plan)
        except ReadOnlyUnavailable as exc:
            raise CommandError(f"Refusing to run: {exc}") from exc
        if options["json"]:
            self.stdout.write(json.dumps(plan, indent=2, sort_keys=True))
            return

        counts = plan["counts"]
        self.stdout.write("DRY RUN: nothing was written, and this command has no option that writes.")
        if not plan["handover_column_present"]:
            self.stdout.write("Note: this database has no handover_staff column yet (migration 0011 not applied).")
        self.stdout.write(
            f"Sales: {counts['sales']}; proposed: {counts['proposed']}; ambiguous: {counts['ambiguous']}; skipped: {counts['skipped']}"
        )
        self.stdout.write("Proposed (handover_staff = the delivery's staff):")
        for row in plan["proposed"]:
            inactive = "" if row["staff_active"] else " (inactive user)"
            self.stdout.write(
                f"  sale {row['sale_id']} {row['order_id']}: {row['handover_staff']['name']} "
                f"({row['handover_staff']['username']}){inactive}"
            )
        self.stdout.write("Ambiguous (needs a person to decide):")
        for row in plan["ambiguous"]:
            self.stdout.write(f"  sale {row['sale_id']}: {row['reason']}")
        self.stdout.write("Skipped:")
        reasons = {}
        for row in plan["skipped"]:
            reasons.setdefault(row["reason"], []).append(row.get("order_id") or f"sale {row['sale_id']}")
        for reason, refs in reasons.items():
            self.stdout.write(f"  {reason}: {len(refs)} ({', '.join(refs)})")
