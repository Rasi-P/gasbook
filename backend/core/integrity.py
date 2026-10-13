"""Read-only integrity checks and data fingerprint for sales, payments and stock.

Every query either selects an explicit list of long-standing columns (``values_list``) or
reads whole tables with ``SELECT *``, so the report can be produced against a database whose
schema is older than the models, e.g. the dev database before later migrations are applied to
it. Nothing here writes; ``run_read_only`` makes PostgreSQL refuse any write as well.
"""
import hashlib
import json
from collections import defaultdict
from datetime import date, datetime, time
from decimal import Decimal

from django.db import connection, transaction
from django.db.models import Count, Max, Sum

from .models import (
    ActivityLog, Booking, CustomerCylinderDiscount, CustomerCylinderRate, CustomerProfile, CylinderType,
    Delivery, Notification, Payment, PaymentReversal, Role, Sale, SaleItem, SaleRefund, SaleVoid, StaffProfile, Stock,
    StockLocation, StockMovement, User,
)

ZERO = Decimal("0.00")

# Bumped whenever the report layout changes; --compare refuses baselines of another format.
REPORT_FORMAT = 2

# Readable per-table summaries of the business tables: (model, columns), "id" first. These are
# for spotting *what* changed; full coverage of every table and column comes from
# database_fingerprint(). Password columns are left out here but are covered there.
FINGERPRINT_TABLES = {
    "role": (Role, ["id", "code", "name"]),
    "user": (User, ["id", "username", "first_name", "last_name", "role_id", "is_active", "is_staff", "is_superuser",
                    "phone", "email", "address", "must_change_password", "last_login"]),
    "staffprofile": (StaffProfile, ["id", "user_id", "assigned_area", "vehicle_number", "vehicle_location_id", "is_active"]),
    "customerprofile": (CustomerProfile, ["id", "user_id", "opening_balance", "area", "default_staff_id", "credit_limit",
                                          "deposit_cylinders", "global_discount_type", "global_discount_value",
                                          "global_discount_is_active", "is_active"]),
    "customercylinderrate": (CustomerCylinderRate, ["id", "customer_id", "cylinder_type_id", "custom_price"]),
    "customercylinderdiscount": (CustomerCylinderDiscount, ["id", "customer_id", "cylinder_type_id", "discount_type",
                                                            "discount_value", "is_active"]),
    "cylindertype": (CylinderType, ["id", "name", "weight", "selling_price", "deposit_amount", "refill_rate",
                                    "low_stock_threshold", "is_active"]),
    "stocklocation": (StockLocation, ["id", "code", "name", "is_main_supplier", "is_active"]),
    "stock": (Stock, ["id", "cylinder_type_id", "location_id", "status", "quantity"]),
    "stockmovement": (StockMovement, ["id", "cylinder_type_id", "from_location_id", "to_location_id", "status",
                                      "quantity", "moved_by_id", "note", "created_at"]),
    "sale": (Sale, ["id", "customer_id", "location_id", "original_amount", "discount_amount", "total_amount",
                    "applied_discount_type", "applied_discount_value", "paid_amount", "balance_due", "payment_mode",
                    "delivery_type", "delivery_staff", "note", "sold_by_id", "created_at"]),
    "saleitem": (SaleItem, ["id", "sale_id", "cylinder_type_id", "quantity", "rate", "total_amount", "empty_returned"]),
    "payment": (Payment, ["id", "customer_id", "sale_id", "amount", "payment_mode", "received_by_id", "note",
                          "empty_collected", "created_at"]),
    "booking": (Booking, ["id", "customer_id", "cylinder_type_id", "quantity", "final_amount", "status",
                          "payment_method", "payment_status", "assigned_staff_id", "approved_by_id", "sale_id",
                          "rejected_by_id", "delivered_at"]),
    "delivery": (Delivery, ["id", "booking_id", "staff_id", "status", "started_at", "completed_at",
                            "payment_collected", "payment_method", "empty_collected"]),
    "activitylog": (ActivityLog, ["id", "action", "user_id", "metadata", "created_at"]),
    "notification": (Notification, ["id", "recipient_id", "booking_id", "notification_type", "is_read", "created_at"]),
    # Present once migration 0012 is applied; skipped (like any missing table) before that.
    "salevoid": (SaleVoid, ["id", "sale_id", "reason", "outcome", "paid_amount", "cancelled_balance", "refund_due",
                            "voided_by_id", "created_at"]),
    "salerefund": (SaleRefund, ["id", "void_id", "amount", "references", "confirmed_by_id", "created_at"]),
    "paymentreversal": (PaymentReversal, ["id", "original_id", "reversal_id", "credit_id", "sale_void_id", "sale_refund_id"]),
}

VOID_MODELS = (SaleVoid, SaleRefund, PaymentReversal)


class ReadOnlyUnavailable(RuntimeError):
    """The database cannot guarantee a read-only transaction, so the report is not produced."""


def _plain(value):
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, (datetime, date, time)):
        return value.isoformat()
    if isinstance(value, (bytes, memoryview)):
        return bytes(value).hex()
    return value


def _row_json(row):
    return json.dumps([_plain(value) for value in row], sort_keys=True, default=str)


def _digest(rows):
    payload = json.dumps([[_plain(value) for value in row] for row in rows], sort_keys=True, default=str)
    return hashlib.sha256(payload.encode()).hexdigest()


def _table_names():
    with connection.cursor() as cursor:
        return set(connection.introspection.table_names(cursor))


def _voids_present():
    """Whether this database has the void/refund tables (migration 0012). Without them there
    are no voided sales and no payment reversals, and the checks below see exactly the data
    they always did."""
    return {model._meta.db_table for model in VOID_MODELS} <= _table_names()


def _voided_sale_ids():
    return set(SaleVoid.objects.values_list("sale_id", flat=True)) if _voids_present() else set()


def table_fingerprint(model, columns):
    rows = list(model.objects.order_by("id").values_list(*columns))
    has_updated_at = any(field.name == "updated_at" for field in model._meta.concrete_fields)
    return {
        "rows": len(rows),
        "max_id": rows[-1][columns.index("id")] if rows else None,
        "max_updated_at": _plain(model.objects.aggregate(value=Max("updated_at"))["value"]) if has_updated_at else None,
        "hash": _digest(rows),
    }


def database_fingerprint():
    """Every table in the database, every column: row count plus a digest of all rows.

    Rows are serialised and sorted before hashing, so the digest does not depend on the order
    the database returns them in. Column names are part of the digest, so a schema change
    shows up as a change too. This is what proves a database was left untouched.
    """
    result = {}
    with connection.cursor() as cursor:
        for table in sorted(connection.introspection.table_names(cursor)):
            cursor.execute(f"SELECT * FROM {connection.ops.quote_name(table)}")
            columns = [column[0] for column in cursor.description]
            rows = sorted(_row_json(row) for row in cursor.fetchall())
            payload = json.dumps(columns) + "\n" + "\n".join(rows)
            result[table] = {"rows": len(rows), "hash": hashlib.sha256(payload.encode()).hexdigest()}
    return result


def customer_balances():
    """Reference copy of the customer balance rules shown on the customer screen, frozen so
    later code can be compared to it.

    pending = opening balance + Σ sale balance_due − Σ payments not linked to a sale.
    Voided sales (migration 0012) are left out of both the balance and the empties: their
    unpaid balance is no longer due and their cylinders came back. A database with no voids
    gives exactly the figures it gave before voids existed.
    Empties owed / empty credits follow CustomerProfileSerializer._calculate_cylinder_balances:
    returned empties pay off what is owed first (any excess becomes a credit), taken cylinders
    are owed, and a line priced at or below the midpoint of the selling and refill price counts
    as a refill that consumes credits for cylinders taken without an empty.

    Scope: only the customer screen (CustomerProfileSerializer and the pending-amount copies in
    services / DeliverySerializer). The dashboard "with customers" figure and the reports use
    different empties rules and must not be compared with this. Sales with identical created_at
    are ordered by id here; the serializer leaves such ties in database order.

    To check that changed application code still gives the same balances, compare its output
    with this function customer by customer. ``customer_balances_hash`` in the fingerprint is
    computed by this frozen copy, so it only changes when the data changes, never when
    application code changes.
    """
    cylinders = {
        row[0]: {"selling_price": row[1], "refill_rate": row[2]}
        for row in CylinderType.objects.values_list("id", "selling_price", "refill_rate")
    }
    custom_rates = defaultdict(dict)
    for customer_id, cylinder_type_id, price in CustomerCylinderRate.objects.values_list(
        "customer_id", "cylinder_type_id", "custom_price"
    ):
        custom_rates[customer_id][cylinder_type_id] = price

    items_by_sale = defaultdict(list)
    for sale_id, cylinder_type_id, quantity, rate, empty_returned in SaleItem.objects.order_by("id").values_list(
        "sale_id", "cylinder_type_id", "quantity", "rate", "empty_returned"
    ):
        items_by_sale[sale_id].append((cylinder_type_id, quantity, rate, empty_returned))

    voided = _voided_sale_ids()
    sales_due = defaultdict(lambda: ZERO)
    cylinder_state = defaultdict(dict)
    for sale_id, customer_id, balance_due in Sale.objects.exclude(customer_id=None).order_by("created_at", "id").values_list(
        "id", "customer_id", "balance_due"
    ):
        if sale_id in voided:
            continue
        sales_due[customer_id] += balance_due
        balances = cylinder_state[customer_id]
        for cylinder_type_id, taken, rate, returned in items_by_sale[sale_id]:
            state = balances.setdefault(cylinder_type_id, {"owed": 0, "credits": 0})
            state["owed"] -= returned
            if state["owed"] < 0:
                state["credits"] += -state["owed"]
                state["owed"] = 0
            state["owed"] += taken
            cylinder = cylinders[cylinder_type_id]
            refill_rate = custom_rates[customer_id].get(cylinder_type_id, cylinder["refill_rate"])
            threshold = (cylinder["selling_price"] + refill_rate) / 2
            if rate <= threshold and taken > 0:
                state["credits"] = max(0, state["credits"] - max(0, taken - returned))

    unallocated = defaultdict(lambda: ZERO)
    for customer_id, amount in Payment.objects.filter(sale_id=None).values_list("customer_id", "amount"):
        unallocated[customer_id] += amount

    result = {}
    for customer_id, opening_balance in CustomerProfile.objects.order_by("id").values_list("id", "opening_balance"):
        balances = cylinder_state.get(customer_id, {})
        result[customer_id] = {
            "pending": str(opening_balance + sales_due[customer_id] - unallocated[customer_id]),
            "empties_owed": {tid: data["owed"] for tid, data in sorted(balances.items()) if data["owed"] > 0},
            "empty_credits": {tid: data["credits"] for tid, data in sorted(balances.items()) if data["credits"] > 0},
        }
    return result


def fingerprint(balances=None):
    tables = _table_names()
    report = {}
    for name, (model, columns) in FINGERPRINT_TABLES.items():
        if model._meta.db_table in tables:
            report[name] = table_fingerprint(model, columns)
    if balances is None:
        balances = customer_balances()
    stock_totals = {
        status: Stock.objects.filter(status=status).aggregate(total=Sum("quantity"))["total"] or 0
        for status in Stock.Status.values
    }
    return {
        "tables": report,
        "database": database_fingerprint(),
        "stock_totals": stock_totals,
        # A data fingerprint of the frozen reference above, not a check of application code.
        "customer_balances_hash": _digest(sorted((key, json.dumps(value, sort_keys=True)) for key, value in balances.items())),
    }


def fingerprint_sha256(data):
    return hashlib.sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()


def violations():
    """Accounting invariants that must hold for every row; returns a list of problems."""
    problems = []

    def add(check, detail, **ids):
        problems.append({"check": check, "detail": detail, **ids})

    item_sums = {
        row["sale_id"]: row
        for row in SaleItem.objects.order_by().values("sale_id").annotate(total=Sum("total_amount"), lines=Count("id"))
    }
    payments = {
        row[0]: {"customer_id": row[1], "sale_id": row[2], "amount": row[3], "mode": row[4]}
        for row in Payment.objects.order_by("id").values_list("id", "customer_id", "sale_id", "amount", "payment_mode")
    }
    sale_modes = set(Sale.PaymentMode.values)

    # Payment reversals (migration 0012): a negative payment is valid only as the exact
    # reversal of a positive payment on a voided sale: same customer, sale and mode, opposite
    # amount; a credit reversal also has the same amount again as a payment linked to no sale.
    voids_present = _voids_present()
    voids = {}
    links = []
    refunds = {}
    if voids_present:
        voids = {
            row[0]: {"sale_id": row[1], "outcome": row[2], "paid": row[3], "cancelled": row[4], "refund_due": row[5]}
            for row in SaleVoid.objects.values_list("id", "sale_id", "outcome", "paid_amount", "cancelled_balance", "refund_due")
        }
        refunds = {row[0]: {"void_id": row[1], "amount": row[2]} for row in SaleRefund.objects.values_list("id", "void_id", "amount")}
        links = list(PaymentReversal.objects.order_by("id").values_list(
            "id", "original_id", "reversal_id", "credit_id", "sale_void_id", "sale_refund_id"
        ))
    reversal_ids = {link[2] for link in links}
    valid_reversal_ids = set()
    for link_id, original_id, reversal_id, credit_id, void_id, refund_id in links:
        original, reversal, void = payments.get(original_id), payments.get(reversal_id), voids.get(void_id)
        credit = payments.get(credit_id) if credit_id else None
        problem = None
        if original is None or reversal is None or void is None:
            problem = "missing payment or void"
        elif original["amount"] <= 0 or original_id in reversal_ids:
            problem = f"original payment amount {original['amount']} is not an original payment"
        elif reversal["amount"] != -original["amount"]:
            problem = f"reversal {reversal['amount']} != -{original['amount']}"
        elif (reversal["customer_id"], reversal["sale_id"], reversal["mode"]) != (original["customer_id"], original["sale_id"], original["mode"]):
            problem = "reversal customer, sale or mode differs from the original"
        elif original["sale_id"] is None or original["sale_id"] != void["sale_id"]:
            problem = "original payment is not on the voided sale"
        elif credit_id and (credit is None or credit["amount"] != original["amount"] or credit["sale_id"] is not None
                            or (credit["customer_id"], credit["mode"]) != (original["customer_id"], original["mode"])):
            problem = "credit payment does not equal the original, unlinked, same customer and mode"
        elif refund_id and refunds.get(refund_id, {}).get("void_id") != void_id:
            problem = "refund belongs to another void"
        elif (void["outcome"] == SaleVoid.Outcome.CREDIT) != bool(credit_id) or (void["outcome"] == SaleVoid.Outcome.REFUND) != bool(refund_id):
            problem = f"link does not fit the void's outcome ({void['outcome']})"
        if problem:
            add("payment_reversal_valid", problem, payment_reversal_id=link_id, payment_id=reversal_id)
        else:
            valid_reversal_ids.add(reversal_id)

    payment_sums = defaultdict(lambda: ZERO)
    for payment_id, row in payments.items():
        if row["sale_id"] is not None and payment_id not in reversal_ids:
            payment_sums[row["sale_id"]] += row["amount"]

    for sale_id, customer_id, total, paid, balance, mode in Sale.objects.order_by("id").values_list(
        "id", "customer_id", "total_amount", "paid_amount", "balance_due", "payment_mode"
    ):
        items = item_sums.get(sale_id)
        if not items:
            add("sale_has_items", "Sale has no lines.", sale_id=sale_id)
        elif items["total"] != total:
            add("sale_total_equals_lines", f"total {total} != lines {items['total']}", sale_id=sale_id)
        if paid + balance != total:
            add("sale_paid_plus_balance", f"paid {paid} + balance {balance} != total {total}", sale_id=sale_id)
        if paid < 0 or balance < 0 or paid > total:
            add("sale_amounts_in_range", f"paid {paid}, balance {balance}, total {total}", sale_id=sale_id)
        if mode not in sale_modes:
            add("sale_payment_mode_valid", f"payment_mode {mode!r}", sale_id=sale_id)
        # The original payments (reversals excluded) always add up to the paid amount; a void
        # never edits the sale.
        if customer_id is not None and payment_sums.get(sale_id, ZERO) != paid:
            add("sale_payments_match_paid", f"payments {payment_sums.get(sale_id, ZERO)} != paid {paid}", sale_id=sale_id)

    sale_rows = {row[0]: row for row in Sale.objects.values_list("id", "paid_amount", "balance_due")}
    booking_sale_ids = set(Booking.objects.exclude(sale_id=None).values_list("sale_id", flat=True))
    links_by_void = defaultdict(list)
    for link in links:
        links_by_void[link[4]].append(link)
    refund_by_void = {row["void_id"]: (refund_id, row["amount"]) for refund_id, row in refunds.items()}
    for void_id, void in voids.items():
        sale = sale_rows.get(void["sale_id"])
        if sale is None:
            continue
        if void["sale_id"] in booking_sale_ids:
            add("sale_void_direct_only", "a sale created by a booking delivery was voided", sale_id=void["sale_id"])
        if (void["paid"], void["cancelled"]) != (sale[1], sale[2]):
            add("sale_void_matches_sale", f"void paid {void['paid']} / cancelled {void['cancelled']} != sale paid {sale[1]} / "
                f"balance {sale[2]}", sale_id=void["sale_id"])
        originals = {pid for pid, row in payments.items() if row["sale_id"] == void["sale_id"] and pid not in reversal_ids}
        reversed_originals = {link[1] for link in links_by_void[void_id]}
        refund = refund_by_void.get(void_id)
        expected = originals if void["outcome"] == SaleVoid.Outcome.CREDIT or refund else set()
        if reversed_originals != expected:
            add("sale_void_reversals_complete", f"{void['outcome']} void reversed payments {sorted(reversed_originals)}, "
                f"expected {sorted(expected)}", sale_id=void["sale_id"])
        if refund is not None:
            refunded = -sum((payments[link[2]]["amount"] for link in links_by_void[void_id] if link[2] in payments), ZERO)
            if void["outcome"] != SaleVoid.Outcome.REFUND or refund[1] != void["refund_due"] or refunded != refund[1]:
                add("sale_refund_matches_void", f"refund {refund[1]}, refunded {refunded}, owed {void['refund_due']}",
                    sale_id=void["sale_id"])

    sale_customers = dict(Sale.objects.values_list("id", "customer_id"))
    for payment_id, customer_id, sale_id, amount, mode in Payment.objects.order_by("id").values_list(
        "id", "customer_id", "sale_id", "amount", "payment_mode"
    ):
        if amount <= 0 and payment_id not in valid_reversal_ids:
            add("payment_positive", f"amount {amount}", payment_id=payment_id)
        if mode not in sale_modes:
            add("payment_mode_valid", f"payment_mode {mode!r}", payment_id=payment_id)
        if sale_id is not None and sale_customers.get(sale_id) != customer_id:
            add("payment_customer_matches_sale", f"payment customer {customer_id}, sale customer {sale_customers.get(sale_id)}",
                payment_id=payment_id, sale_id=sale_id)

    for stock_id, quantity in Stock.objects.filter(quantity__lt=0).values_list("id", "quantity"):
        add("stock_non_negative", f"quantity {quantity}", stock_id=stock_id)

    for booking_id, status in Booking.objects.exclude(sale_id=None).exclude(status=Booking.Status.DELIVERED).values_list("id", "status"):
        add("booking_sale_link", f"booking has a sale but status is {status}", booking_id=booking_id)
    for booking_id in Booking.objects.filter(status=Booking.Status.DELIVERED, sale_id=None).values_list("id", flat=True):
        add("booking_sale_link", "booking is delivered but has no sale", booking_id=booking_id)

    return problems


def notices(balances=None):
    """Pre-existing data patterns worth knowing about; not invariant violations."""
    if balances is None:
        balances = customer_balances()
    non_stock_locations = StockLocation.objects.filter(code="supplier") | StockLocation.objects.filter(is_main_supplier=True)
    unallocated = Payment.objects.filter(sale_id=None).aggregate(count=Count("id"), total=Sum("amount"))
    return {
        "guest_sales": Sale.objects.filter(customer_id=None).count(),
        "sales_at_supplier_locations": Sale.objects.filter(location__in=non_stock_locations).count(),
        "sales_at_inactive_locations": Sale.objects.filter(location__is_active=False).count(),
        "unallocated_payments": {"count": unallocated["count"], "total": str(unallocated["total"] or ZERO)},
        "customers_with_credit_balance": sum(1 for row in balances.values() if Decimal(row["pending"]) < 0),
        "refunds_owed": refunds_owed(),
    }


def refunds_owed():
    """Refunds owed by voided sales and not yet confirmed (none before migration 0012)."""
    if not _voids_present():
        return {"count": 0, "total": str(ZERO)}
    owed = SaleVoid.objects.filter(outcome=SaleVoid.Outcome.REFUND).exclude(
        pk__in=SaleRefund.objects.values("void_id")
    ).aggregate(count=Count("id"), total=Sum("refund_due"))
    return {"count": owed["count"], "total": str(owed["total"] or ZERO)}


def build_report():
    balances = customer_balances()
    data = fingerprint(balances)
    return {
        "format": REPORT_FORMAT,
        "database": connection.settings_dict.get("NAME"),
        "vendor": connection.vendor,
        "violations": violations(),
        "notices": notices(balances),
        "fingerprint": data,
        "fingerprint_sha256": fingerprint_sha256(data),
    }


def run_read_only(func):
    """Run ``func`` in a transaction that PostgreSQL itself refuses to write in, then roll back.

    Fails closed: on any other database, or if the transaction does not report itself as
    read-only, ``func`` is never called.
    """
    if connection.vendor != "postgresql":
        raise ReadOnlyUnavailable(f"Read-only transactions need PostgreSQL; this database is {connection.vendor}.")
    with transaction.atomic():
        with connection.cursor() as cursor:
            cursor.execute("SET TRANSACTION READ ONLY")
            cursor.execute("SELECT current_setting('transaction_read_only')")
            if cursor.fetchone()[0] != "on":
                raise ReadOnlyUnavailable("The transaction did not become read-only.")
        result = func()
        transaction.set_rollback(True)
    return result


def compare_fingerprints(before, after):
    """Differences between two fingerprint dicts (empty when identical).

    Business-table summaries are named after the table ("sale"); whole-database entries are
    prefixed "db:" ("db:core_sale"), so one write can appear under both.
    """
    changes = []
    for section, prefix in (("tables", ""), ("database", "db:")):
        old_section, new_section = before.get(section, {}), after.get(section, {})
        for name in sorted(set(old_section) | set(new_section)):
            old, new = old_section.get(name), new_section.get(name)
            if old != new:
                changes.append({"table": f"{prefix}{name}", "before": old, "after": new})
    for key in ("stock_totals", "customer_balances_hash"):
        if before.get(key) != after.get(key):
            changes.append({"table": key, "before": before.get(key), "after": after.get(key)})
    return changes
