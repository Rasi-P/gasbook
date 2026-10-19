"""Small domain helpers shared by views and serializers.

This module must not import from ``serializers`` or ``views`` (they import it).
"""
import hashlib
from decimal import Decimal, InvalidOperation

from django.db import IntegrityError, connection, transaction
from django.db.models import Q, Sum
from django.utils import timezone
from django.utils.crypto import get_random_string

from .exceptions import ApiError
from .models import (
    ActivityLog,
    Booking,
    BookingItem,
    CustomerCylinderDiscount,
    CustomerCylinderRate,
    CustomerProfile,
    CylinderType,
    Delivery,
    Expense,
    Notification,
    Payment,
    PaymentReversal,
    Role,
    Sale,
    SaleItem,
    SaleRefund,
    SaleVoid,
    Stock,
    StockLocation,
    StockMovement,
    User,
)


def notify(recipient, booking, notification_type, title, body, dedupe=True):
    """Create a Notification, truncating title/body to the model limits.

    With ``dedupe=True`` an existing notification for the same
    (recipient, booking, notification_type) suppresses the new one and ``None`` is
    returned.
    """
    tmax = Notification._meta.get_field("title").max_length
    bmax = Notification._meta.get_field("body").max_length
    title = title or ""
    body = body or ""
    title = title if len(title) <= tmax else title[: tmax - 1] + "…"
    body = body if len(body) <= bmax else body[: bmax - 1] + "…"
    if dedupe and Notification.objects.filter(
        recipient=recipient, booking=booking, notification_type=notification_type
    ).exists():
        return None
    return Notification.objects.create(
        recipient=recipient,
        booking=booking,
        notification_type=notification_type,
        title=title,
        body=body,
    )


def admin_users():
    return User.objects.filter(role__code="admin")


def display_name(user):
    if user is None:
        return None
    return user.get_full_name() or user.username


def clean_reason(raw, max_length):
    if raw is None:
        raw = ""
    if not isinstance(raw, str):
        raise ApiError("Rejection reason must be text.", code="invalid", field="reason")
    reason = raw.strip()
    if not reason:
        raise ApiError("Rejection reason is required.", code="required", field="reason")
    if len(reason) > max_length:
        raise ApiError(
            f"Rejection reason must be {max_length} characters or fewer.",
            code="max_length",
            field="reason",
            max_length=max_length,
        )
    return reason


def parse_non_negative_int(raw, field, label):
    message = f"{label} must be a non-negative whole number."
    if raw is None or raw == "":
        return 0
    if isinstance(raw, bool):
        raise ApiError(message, code="invalid", field=field)
    if isinstance(raw, int):
        value = raw
    elif isinstance(raw, str) and raw.strip().isdigit():
        value = int(raw.strip())
    else:
        raise ApiError(message, code="invalid", field=field)
    if value < 0:
        raise ApiError(message, code="invalid", field=field)
    return value


def parse_money(raw, field, label):
    message = f"{label} must be a valid amount."
    if raw is None or raw == "":
        return Decimal("0")
    if isinstance(raw, bool):
        raise ApiError(message, code="invalid", field=field)
    try:
        value = Decimal(str(raw).strip())
    except (InvalidOperation, ValueError):
        raise ApiError(message, code="invalid", field=field)
    if not value.is_finite():
        raise ApiError(message, code="invalid", field=field)
    return value


def lock_booking_and_delivery(booking_id):
    """Fixed lock order: Booking, then Delivery.

    No ``select_related`` on locked queries (Postgres rejects FOR UPDATE on nullable
    outer joins).
    """
    booking = Booking.objects.select_for_update().get(pk=booking_id)
    delivery = Delivery.objects.select_for_update().filter(booking_id=booking_id).first()
    return booking, delivery


# ---- sales, payments and stock -----------------------------------------------

# ---- locations and cylinder types ---------------------------------------------
#
# A location is either the supplier (cylinders are sent there to be refilled and come back
# filled; it holds no stock of its own) or a stock location (shop, Kandam, any godown an
# admin adds). Direct sales, deliveries and transfers may use any ACTIVE stock location.
# "With customers" is a figure calculated from sales, not a location, so it is never one.

OPEN_BOOKING_STATUSES = (
    Booking.Status.PENDING,
    Booking.Status.APPROVED,
    Booking.Status.ACCEPTED,
    Booking.Status.OUT_FOR_DELIVERY,
)


def is_supplier_location(location):
    """The supplier is the location flagged as main supplier, or the legacy ``supplier`` code."""
    return bool(location.is_main_supplier or location.code == "supplier")


def stock_locations(active_only=True):
    """Locations that hold stock (everything except the supplier)."""
    queryset = StockLocation.objects.exclude(is_main_supplier=True).exclude(code="supplier")
    return queryset.filter(is_active=True) if active_only else queryset


def supplier_locations(active_only=True):
    queryset = StockLocation.objects.filter(Q(is_main_supplier=True) | Q(code="supplier"))
    return queryset.filter(is_active=True) if active_only else queryset


def require_sellable_location(location, field="location"):
    """Locations a sale or delivery may take stock from: active and not the supplier."""
    if is_supplier_location(location):
        raise ApiError(
            f"{location.name} is the supplier; sales and deliveries take stock from a stock location.",
            code="invalid_location",
            field=field,
        )
    if not location.is_active:
        raise ApiError(f"{location.name} is inactive.", code="location_inactive", field=field)
    return location


def lock_active_stock_location(location_id, field="location"):
    """Lock a stock location row and re-check it is usable. Run inside transaction.atomic, so a
    concurrent deactivation (which locks the same row and needs the stock to be zero) is
    ordered either before this write, which is then refused, or after it, which then sees
    the stock this write left."""
    location = StockLocation.objects.select_for_update().get(pk=location_id)
    return require_sellable_location(location, field)


def default_delivery_location(staff_user):
    """Where a delivery takes stock from when the request names no location: the staff
    member's configured location, else the shop, else the only active stock location.
    Returns None when that is ambiguous or nothing is available (the caller asks for a choice)."""
    profile = getattr(staff_user, "staff_profile", None)
    configured = getattr(profile, "vehicle_location", None)
    if configured is not None and configured.is_active and not is_supplier_location(configured):
        return configured
    candidates = list(stock_locations().order_by("id"))
    shop = next((loc for loc in candidates if loc.code == "shop"), None)
    if shop is not None:
        return shop
    return candidates[0] if len(candidates) == 1 else None


def require_active_cylinder_type(cylinder_type, field="cylinder_type"):
    if not cylinder_type.is_active:
        raise ApiError(f"{cylinder_type.name} is inactive.", code="cylinder_inactive", field=field)
    return cylinder_type


def stock_totals(stock_rows):
    """(filled, empty) cylinders held in the given Stock queryset."""
    totals = {status: 0 for status in Stock.Status.values}
    for status, quantity in stock_rows.values_list("status", "quantity"):
        totals[status] += quantity
    return totals[Stock.Status.FILLED], totals[Stock.Status.EMPTY]


def location_usage(location):
    """What depends on a location, for the admin's confirmation messages."""
    filled, empty = stock_totals(location.stocks.all())
    return {
        "stock_filled": filled,
        "stock_empty": empty,
        "sales": Sale.objects.filter(location=location).count(),
        "movements": StockMovement.objects.filter(Q(from_location=location) | Q(to_location=location)).count(),
        "staff_assigned": location.staffprofile_set.count(),
    }


def cylinder_type_usage(cylinder_type):
    """What depends on a cylinder type, for the admin's confirmation messages."""
    filled, empty = stock_totals(cylinder_type.stocks.all())
    bookings = Booking.objects.filter(Q(cylinder_type=cylinder_type) | Q(order_items__cylinder_type=cylinder_type)).distinct()
    return {
        "stock_filled": filled,
        "stock_empty": empty,
        "open_bookings": bookings.filter(status__in=OPEN_BOOKING_STATUSES).count(),
        "bookings": bookings.count(),
        "sale_lines": SaleItem.objects.filter(cylinder_type=cylinder_type).count(),
        "movements": StockMovement.objects.filter(cylinder_type=cylinder_type).count(),
        "customer_rates": (
            CustomerCylinderRate.objects.filter(cylinder_type=cylinder_type).count()
            + CustomerCylinderDiscount.objects.filter(cylinder_type=cylinder_type).count()
        ),
    }


def _plural(count, one, many=None):
    return f"{count} {one if count == 1 else (many or one + 's')}"


def cylinder_type_delete_blockers(cylinder_type):
    """Why a cylinder type cannot be deleted, as [{"code", "detail"}]. Empty means it can be: it has no stock, no
    booking, sale or movement history and no customer-specific rates. Deactivating is the way to retire a used one."""
    usage = cylinder_type_usage(cylinder_type)
    blockers = []
    held = usage["stock_filled"] + usage["stock_empty"]
    if held:
        blockers.append({"code": "has_stock", "detail": f"{_plural(held, 'cylinder')} of this type are still in stock ({usage['stock_filled']} filled, {usage['stock_empty']} empty)."})
    history = [
        text for count, text in (
            (usage["bookings"], _plural(usage["bookings"], "booking")),
            (usage["sale_lines"], _plural(usage["sale_lines"], "sale line")),
            (usage["movements"], _plural(usage["movements"], "stock movement")),
        ) if count
    ]
    if history:
        blockers.append({"code": "has_history", "detail": f"It appears in {', '.join(history)}. Deleting it would break those records."})
    if usage["customer_rates"]:
        blockers.append({"code": "has_customer_rates", "detail": f"{_plural(usage['customer_rates'], 'customer-specific rate or discount')} refer to it. Remove them first."})
    return blockers


def location_delete_blockers(location):
    """Why a location cannot be deleted: stock held, any sale or stock-movement history, staff set to deliver from it,
    or being the only active location of its kind. Empty means it can be deleted."""
    usage = location_usage(location)
    blockers = []
    held = usage["stock_filled"] + usage["stock_empty"]
    if held:
        blockers.append({"code": "has_stock", "detail": f"It still holds {_plural(held, 'cylinder')} ({usage['stock_filled']} filled, {usage['stock_empty']} empty). Move them out first."})
    history = [
        text for count, text in (
            (usage["sales"], _plural(usage["sales"], "sale")),
            (usage["movements"], _plural(usage["movements"], "stock movement")),
        ) if count
    ]
    if history:
        blockers.append({"code": "has_history", "detail": f"It appears in {', '.join(history)}. Deleting it would break those records."})
    if usage["staff_assigned"]:
        blockers.append({"code": "staff_assigned", "detail": f"{_plural(usage['staff_assigned'], 'staff member')} use it as their delivery location. Change that first."})
    pool = supplier_locations() if is_supplier_location(location) else stock_locations()
    if location.is_active and not pool.exclude(pk=location.pk).exists():
        what = "supplier" if is_supplier_location(location) else "stock location"
        blockers.append({"code": "last_active_location", "detail": f"It is the only active {what}."})
    return blockers

# Ways money is actually received; "credit" and "split" describe a sale, not a payment.
RECEIPT_MODES = (Sale.PaymentMode.CASH, Sale.PaymentMode.GPAY, Sale.PaymentMode.BANK)

# The name customers see for what the business itself did, such as a direct sale; internal
# screens and reports name the actual users.
BUSINESS_DISPLAY_NAME = "Sabco Gas"


def is_admin_user(user):
    return getattr(getattr(user, "role", None), "code", "") == "admin" or user.is_superuser


def is_active_staff(user):
    """An active staff user whose staff profile (if any) is active: who can be named as
    having handed cylinders over. The staff list reports this as can_hand_over."""
    profile = getattr(user, "staff_profile", None)
    return (
        getattr(getattr(user, "role", None), "code", "") == "staff"
        and user.is_active
        and (profile is None or profile.is_active)
    )


def can_hand_over(user):
    """Direct-sale handover eligibility; delivery assignment remains staff-only."""
    return user.is_active and (
        getattr(getattr(user, "role", None), "code", "") == "admin" or is_active_staff(user)
    )


def check_handover_staff(handover, requester):
    """Who may be recorded as having physically handed the cylinders over.

    Admins may name an active admin or eligible staff member, or nobody. Staff may
    name only themselves, or nobody. Staff profile restrictions still apply.
    """
    if handover is None:
        return None
    if not is_admin_user(requester) and handover.pk != requester.pk:
        raise ApiError(
            "Staff can record only themselves as the person who handed over the cylinders.",
            code="handover_self_only",
            status=403,
            field="handover_staff",
        )
    if not can_hand_over(handover):
        raise ApiError(f"{display_name(handover)} is not an active admin or eligible staff member.", code="invalid_handover", field="handover_staff")
    return handover

# Largest values a DecimalField(max_digits=10, decimal_places=2) / PositiveIntegerField hold.
MAX_MONEY = Decimal("99999999.99")
MAX_COUNT = 2147483647

# Lock order for every write that touches a customer's money or stock, so no two requests
# ever wait on each other in opposite orders (a deadlock):
#   0. advisory locks on keys with no row yet: a sale's client_ref, then a new customer's
#      phone number                                       advisory_lock
#   1. the customer row                                    lock_customer
#   2. that customer's unpaid sales, oldest first          record_customer_payment
#   2b. the stock location row (lock_active_stock_location), so a deactivation, which locks
#       the same row and needs the stock to be zero, is ordered before or after the write.
#       Every stock writer takes it BEFORE any stock row: a locked stock query that joins the
#       location (the model's default ordering does) locks the location row as well.
#   3. stock rows by cylinder type id, filled before empty lock_sale_stock / get_stock_row
# Stock movements lock their locations by id, then stock rows; deactivating a location locks
# only that location row and reads (never locks) its stock.
# Voiding a sale locks the customer, then that sale, then its location row, then its stock rows as in 3; confirming
# its refund locks the customer, then the sale's void. Delivery completion locks its booking
# and delivery, then the customer, then stock in the same order, and never a customer after
# stock. Nothing that holds a customer lock goes on to lock a booking or delivery.


def advisory_lock(namespace, value):
    """Hold a PostgreSQL advisory lock on (namespace, value) until the transaction ends.

    For things that have no row to lock yet, such as a sale's client_ref or a phone number
    being registered. Must run inside transaction.atomic; outside one it is released at once.
    """
    if connection.vendor != "postgresql":
        return
    key = int.from_bytes(hashlib.sha256(f"{namespace}:{value}".encode()).digest()[:8], "big", signed=True)
    with connection.cursor() as cursor:
        cursor.execute("SELECT pg_advisory_xact_lock(%s)", [key])


def get_stock_row(cylinder_type, location, status):
    stock, _ = Stock.objects.select_for_update().get_or_create(
        cylinder_type=cylinder_type,
        location=location,
        status=status,
        defaults={"quantity": 0},
    )
    return stock


def lock_customer(customer_id):
    return CustomerProfile.objects.select_for_update().get(pk=customer_id)


def lock_stock_row(cylinder_type, location, status):
    """Lock an existing stock row (None if there is none); unlike get_stock_row, never creates one."""
    return Stock.objects.select_for_update().filter(cylinder_type=cylinder_type, location=location, status=status).first()


def lock_sale_stock(location, needed):
    """Lock the stock rows a sale touches and check there is enough filled stock.

    ``needed`` maps a CylinderType to (filled going out, empties coming back), already
    totalled across the sale's lines. The filled row must exist; no row means none in
    stock. Raises 400 ``insufficient_stock`` naming every short type before anything is
    written. Returns {cylinder type id: (filled row or None, empty row or None)}.
    """
    locked, shortages = {}, []
    for cylinder_type in sorted(needed, key=lambda ct: ct.pk):
        going_out, coming_back = needed[cylinder_type]
        filled = None
        if going_out:
            filled = (
                Stock.objects.select_for_update()
                .filter(cylinder_type=cylinder_type, location=location, status=Stock.Status.FILLED)
                .first()
            )
        empty = get_stock_row(cylinder_type, location, Stock.Status.EMPTY) if coming_back else None
        available = filled.quantity if filled else 0
        if going_out > available:
            shortages.append(
                {"cylinder_type": cylinder_type.pk, "name": cylinder_type.name, "required": going_out, "available": available}
            )
        if empty is not None and empty.quantity + coming_back > MAX_COUNT:
            raise ApiError("Too many empty cylinders returned.", code="invalid", field="sale_items")
        locked[cylinder_type.pk] = (filled, empty)
    if shortages:
        detail = "; ".join(f"{s['name']} needs {s['required']}, {s['available']} available" for s in shortages)
        raise ApiError(
            f"Not enough filled stock at {location.name}: {detail}.",
            code="insufficient_stock",
            field="sale_items",
            location_code=location.code,
            location_name=location.name,
            shortages=shortages,
        )
    return locked


def customer_outstanding(profile):
    """What the customer owes: opening balance + Σ sale balances − payments not linked to a sale.

    Same formula as CustomerProfileSerializer.get_pending_amount and integrity.customer_balances.
    Voided sales are left out: their unpaid balance is no longer due. A negative result is
    customer credit, which offsets any later dues automatically.
    """
    sales_due = not_voided(profile.sales.all()).aggregate(total=Sum("balance_due"))["total"] or Decimal("0")
    unallocated = profile.payments.filter(sale__isnull=True).aggregate(total=Sum("amount"))["total"] or Decimal("0")
    return profile.opening_balance + sales_due - unallocated


def not_voided(sales):
    """``sales`` without voided ones (a subquery, so it also works with select_for_update)."""
    return sales.exclude(pk__in=SaleVoid.objects.values("sale_id"))


def sale_void(sale):
    """The sale's SaleVoid, or None."""
    try:
        return sale.void
    except SaleVoid.DoesNotExist:
        return None


@transaction.atomic
def record_customer_payment(customer, amount, mode, received_by, *, sale=None, note="", empty_collected=0):
    """Record money received from a customer and settle what it pays for.

    With ``sale`` the whole amount goes to that sale, which must belong to the customer and
    still owe at least that much. Without it, the amount settles the customer's unpaid sales
    oldest first, and anything left over reduces the opening balance (a payment not linked
    to a sale). The amount may never exceed what is owed. The customer and the affected sales
    are locked first, so concurrent payments cannot both spend the same balance.

    Returns the Payment rows created, the first one first.
    """
    customer = lock_customer(customer.pk)
    if sale is not None:
        sale = Sale.objects.select_for_update().get(pk=sale.pk)
        if sale.customer_id != customer.pk:
            raise ApiError("This sale belongs to another customer.", code="sale_customer_mismatch", field="sale")
        if SaleVoid.objects.filter(sale_id=sale.pk).exists():
            raise ApiError("This sale was cancelled; nothing can be paid against it.", code="sale_voided", status=409, field="sale")
        if amount > sale.balance_due:
            raise ApiError(
                f"Amount is more than this sale's balance of Rs. {sale.balance_due}.",
                code="exceeds_balance",
                field="amount",
                balance_due=str(sale.balance_due),
            )
        allocations, remainder = [(sale, amount)], Decimal("0")
    else:
        outstanding = customer_outstanding(customer)
        if amount > outstanding:
            raise ApiError(
                f"Amount is more than the customer owes (Rs. {max(outstanding, Decimal('0'))}).",
                code="exceeds_balance",
                field="amount",
                outstanding=str(max(outstanding, Decimal("0"))),
            )
        allocations, remainder = [], amount
        unpaid = not_voided(Sale.objects.select_for_update().filter(customer=customer, balance_due__gt=0)).order_by("created_at", "id")
        for unpaid_sale in unpaid:
            if remainder <= 0:
                break
            part = min(remainder, unpaid_sale.balance_due)
            allocations.append((unpaid_sale, part))
            remainder -= part

    payments = []
    for target, part in allocations:
        target.paid_amount += part
        target.balance_due -= part
        target.save(update_fields=["paid_amount", "balance_due", "updated_at"])
        payments.append(Payment.objects.create(
            customer=customer, sale=target, amount=part, payment_mode=mode, received_by=received_by,
            note=note, empty_collected=0 if payments else empty_collected,
        ))
    if remainder > 0:
        payments.append(Payment.objects.create(
            customer=customer, sale=None, amount=remainder, payment_mode=mode, received_by=received_by,
            note=note, empty_collected=0 if payments else empty_collected,
        ))

    ActivityLog.objects.create(
        action="payment_received",
        description=f"Payment received: Rs. {amount}",
        user=received_by,
        metadata={
            "payment_id": payments[0].id,
            "payment_ids": [payment.id for payment in payments],
            "customer_id": customer.pk,
            "mode": mode,
            "amount": str(amount),
            "allocations": [{"sale_id": target.pk, "amount": str(part)} for target, part in allocations],
            "unallocated": str(remainder),
        },
    )
    return payments


# ---- voids, refunds and customer credit --------------------------------------
#
# A direct sale is corrected by voiding it and recording a new one; it is never edited. A void
# returns the stock, stops the unpaid balance being due, and settles any money paid in one of
# two ways, chosen by the admin:
#   refund  the money is owed back. Nothing changes in collections until the refund is
#           confirmed; confirm_refund then records one negative payment per original payment,
#           in its mode, as money paid out by the confirming admin.
#   credit  each original payment is reversed (negative, on the sale) and the same amount is
#           recorded again as a payment not linked to any sale, in the same mode, by the same
#           admin, at the same moment: collections net to zero and the customer keeps credit,
#           which the existing balance formula offsets against what they owe.
# PaymentReversal links every negative payment to the payment it reverses (once only).

VOID_REASON_MAX = 300
REFUND_REFERENCE_MAX = 100
REFERENCE_REQUIRED_MODES = (Sale.PaymentMode.GPAY, Sale.PaymentMode.BANK)


def original_payments(sale):
    """The payments that paid for ``sale``: positive and linked to it (reversals are negative,
    credit is never linked to a sale)."""
    return sale.payments.filter(amount__gt=0).order_by("id")


def void_stock_changes(sale):
    """{cylinder type: (filled coming back, empties going back out)} at the sale's location."""
    changes = {}
    for item in sale.items.select_related("cylinder_type").order_by("id"):
        filled_back, empties_out = changes.get(item.cylinder_type, (0, 0))
        changes[item.cylinder_type] = (filled_back + item.quantity, empties_out + item.empty_returned)
    return changes


def later_sales_of_same_types(sale):
    """Ids of the customer's later, not voided sales with any of this sale's cylinder types.

    The empty-cylinder balance is a running total in date order, so a later sale may rely on
    this one (for instance on empties returned here); the latest sale must be voided first.
    """
    type_ids = list(sale.items.values_list("cylinder_type_id", flat=True))
    later = (
        Sale.objects.filter(customer_id=sale.customer_id, items__cylinder_type_id__in=type_ids)
        .filter(Q(created_at__gt=sale.created_at) | Q(created_at=sale.created_at, pk__gt=sale.pk))
        .exclude(pk=sale.pk)
    )
    return sorted(set(not_voided(later).values_list("pk", flat=True)))


def void_blockers(sale):
    """Why ``sale`` cannot be voided, as a list of {code, detail, ...}; empty when it can.

    Shared by the preview and by void_sale, which repeats it under its locks. Stock is checked
    against the current quantities, which void_sale re-reads under lock.
    """
    if Booking.objects.filter(sale_id=sale.pk).exists():
        return [{"code": "booking_sale", "detail": "Sales created by delivering a booking cannot be cancelled here."}]
    if SaleVoid.objects.filter(sale_id=sale.pk).exists():
        return [{"code": "already_voided", "detail": "This sale has already been cancelled."}]
    if sale.customer_id is None:
        return [{"code": "guest_sale", "detail": "This sale has no customer, so it cannot be cancelled here."}]
    blockers = []
    if not sale.location.is_active:
        blockers.append({"code": "location_inactive", "detail": f"{sale.location.name} is inactive; reactivate it before cancelling."})
    paid = original_payments(sale).aggregate(total=Sum("amount"))["total"] or Decimal("0")
    if paid != sale.paid_amount or sale.payments.filter(amount__lte=0).exists():
        blockers.append({"code": "payments_mismatch",
                         "detail": f"This sale's payments (Rs. {paid}) do not match its paid amount (Rs. {sale.paid_amount})."})
    later = later_sales_of_same_types(sale)
    if later:
        blockers.append({"code": "later_sales", "sale_ids": later,
                         "detail": "The customer has later sales of the same cylinder type "
                                   f"(#{', #'.join(map(str, later))}); cancel the latest sale first."})
    for cylinder_type, (_filled_back, empties_out) in sorted(void_stock_changes(sale).items(), key=lambda kv: kv[0].pk):
        if not empties_out:
            continue
        row = Stock.objects.filter(cylinder_type=cylinder_type, location=sale.location, status=Stock.Status.EMPTY).first()
        available = row.quantity if row else 0
        if available < empties_out:
            blockers.append({
                "code": "insufficient_empty_stock", "cylinder_type": cylinder_type.pk, "required": empties_out, "available": available,
                "detail": f"{sale.location.name} has {available} empty {cylinder_type.name} but this sale took in {empties_out}; "
                          "the empties to hand back are no longer there.",
            })
    return blockers


def void_preview(sale):
    """What voiding ``sale`` would do and whether it is allowed now. Not authoritative:
    void_sale repeats every check under lock."""
    paid_rows = list(original_payments(sale))
    paid = sum((p.amount for p in paid_rows), Decimal("0"))
    blockers = void_blockers(sale)
    return {
        "sale_id": sale.pk,
        "created_at": sale.created_at.isoformat(),
        "can_void": not blockers,
        "blockers": blockers,
        "location": {"id": sale.location_id, "name": sale.location.name},
        "stock_changes": [
            {"cylinder_type": ct.pk, "name": ct.name, "filled_back": filled_back, "empties_out": empties_out}
            for ct, (filled_back, empties_out) in sorted(void_stock_changes(sale).items(), key=lambda kv: kv[0].pk)
        ],
        "accessory_stock_changes": [{"product": i.product_id, "name": i.name, "quantity": i.quantity} for i in sale.accessories.all()],
        "total": str(sale.total_amount),
        "paid": str(paid),
        "payments": [{"id": p.pk, "mode": p.payment_mode, "amount": str(p.amount)} for p in paid_rows],
        "cancelled_balance": str(sale.balance_due),
        "outcomes": [SaleVoid.Outcome.REFUND, SaleVoid.Outcome.CREDIT] if paid > 0 else [SaleVoid.Outcome.NONE],
    }


def _sale_label(sale):
    return f"purchase #{sale.pk} on {timezone.localtime(sale.created_at).strftime('%d %b %Y')}"


def void_notification_body(sale, void):
    unpaid = f" The unpaid balance of Rs. {void.cancelled_balance} is no longer due." if void.cancelled_balance > 0 else ""
    head = f"Your {_sale_label(sale)} has been cancelled."
    if void.outcome == SaleVoid.Outcome.REFUND:
        return f"{head} A refund of Rs. {void.refund_due} is owed to you and will be sent.{unpaid}"
    if void.outcome == SaleVoid.Outcome.CREDIT:
        return f"{head} The Rs. {void.paid_amount} you paid is kept as credit on your account.{unpaid}"
    return f"{head}{unpaid}" if unpaid else f"{head} Nothing is due."


@transaction.atomic
def void_sale(sale, actor, reason, outcome):
    """Void a direct sale. Every check is repeated here under lock; see the section comment.

    Lock order: the customer, the sale, then its stock rows by cylinder type id, filled before
    empty. A second void of the same sale waits on the customer lock and is then refused; the
    one-to-one SaleVoid.sale is the database's own guard.
    """
    if not isinstance(reason, str) or not reason.strip():
        raise ApiError("A reason is required to cancel a sale.", code="reason_required", field="reason")
    reason = reason.strip()
    if len(reason) > VOID_REASON_MAX:
        raise ApiError(f"Reason must be {VOID_REASON_MAX} characters or fewer.", code="max_length", field="reason")
    if outcome in (None, ""):
        outcome = None
    elif outcome not in SaleVoid.Outcome.values:
        raise ApiError("Outcome must be refund or credit.", code="invalid_outcome", field="outcome")

    if sale.customer_id is None:
        raise ApiError("This sale has no customer, so it cannot be cancelled here.", code="guest_sale", status=409)
    customer = lock_customer(sale.customer_id)
    sale = Sale.objects.select_for_update().get(pk=sale.pk)
    # The sale's location row next, before any stock row: the order every stock write uses.
    # (A locked stock query that joins the location, as the empty-row lock below does, locks
    # that row too, so taking it late would meet a transfer holding it and waiting for stock.)
    StockLocation.objects.select_for_update().get(pk=sale.location_id)

    blockers = [b for b in void_blockers(sale) if b["code"] != "insufficient_empty_stock"]
    if blockers:
        raise ApiError(blockers[0]["detail"], code=blockers[0]["code"], status=409, blockers=blockers)

    payments = list(original_payments(sale))
    paid = sum((p.amount for p in payments), Decimal("0"))
    if paid == 0:
        if outcome not in (None, SaleVoid.Outcome.NONE):
            raise ApiError("Nothing was paid on this sale, so there is nothing to refund or keep as credit.",
                           code="nothing_paid", field="outcome")
        outcome = SaleVoid.Outcome.NONE
    elif outcome not in (SaleVoid.Outcome.REFUND, SaleVoid.Outcome.CREDIT):
        raise ApiError(f"Rs. {paid} was paid on this sale: choose a refund or customer credit.",
                       code="outcome_required", field="outcome", paid=str(paid))

    # Stock, under lock: filled cylinders come back, the empties taken in go back out.
    changes = void_stock_changes(sale)
    stock_before, stock_after, shortages = {}, {}, []
    rows = {}
    for cylinder_type in sorted(changes, key=lambda ct: ct.pk):
        filled_back, empties_out = changes[cylinder_type]
        filled = get_stock_row(cylinder_type, sale.location, Stock.Status.FILLED) if filled_back else None
        empty = None
        if empties_out:
            empty = lock_stock_row(cylinder_type, sale.location, Stock.Status.EMPTY)
            available = empty.quantity if empty else 0
            if available < empties_out:
                shortages.append({"cylinder_type": cylinder_type.pk, "name": cylinder_type.name,
                                  "required": empties_out, "available": available})
        rows[cylinder_type] = (filled, empty)
    if shortages:
        detail = "; ".join(f"{s['available']} empty {s['name']} at {sale.location.name}, {s['required']} to hand back" for s in shortages)
        raise ApiError(f"The empties this sale took in are no longer there ({detail}).",
                       code="insufficient_empty_stock", status=409, shortages=shortages)
    for cylinder_type, (filled, empty) in rows.items():
        filled_back, empties_out = changes[cylinder_type]
        key = str(cylinder_type.pk)
        stock_before[key] = {"filled": filled.quantity if filled else None, "empty": empty.quantity if empty else None}
        if filled:
            filled.quantity += filled_back
            filled.save(update_fields=["quantity", "updated_at"])
        if empty:
            empty.quantity -= empties_out
            empty.save(update_fields=["quantity", "updated_at"])
        stock_after[key] = {"filled": filled.quantity if filled else None, "empty": empty.quantity if empty else None}

    try:
        with transaction.atomic():
            void = SaleVoid.objects.create(
                sale=sale, reason=reason, outcome=outcome, paid_amount=paid, cancelled_balance=sale.balance_due,
                refund_due=paid if outcome == SaleVoid.Outcome.REFUND else Decimal("0"), voided_by=actor,
            )
    except IntegrityError:
        raise ApiError("This sale has already been cancelled.", code="already_voided", status=409)

    from .sale_accessories import restore
    restore(sale, actor)
    reversal_ids, credit_ids = [], []
    if outcome == SaleVoid.Outcome.CREDIT:
        for original in payments:
            reversal = Payment.objects.create(
                customer=customer, sale=sale, amount=-original.amount, payment_mode=original.payment_mode, received_by=actor,
                note=f"Reversal of payment #{original.pk}: sale #{sale.pk} cancelled, kept as credit",
            )
            credit = Payment.objects.create(
                customer=customer, sale=None, amount=original.amount, payment_mode=original.payment_mode, received_by=actor,
                note=f"Credit from cancelled sale #{sale.pk} (payment #{original.pk})",
            )
            PaymentReversal.objects.create(original=original, reversal=reversal, credit=credit, sale_void=void)
            reversal_ids.append(reversal.pk)
            credit_ids.append(credit.pk)

    ActivityLog.objects.create(
        action="sale_voided",
        description=f"Sale #{sale.pk} cancelled ({void.get_outcome_display().lower()})",
        user=actor,
        metadata={
            "sale_id": sale.pk, "void_id": void.pk, "customer_id": customer.pk, "outcome": outcome, "reason": reason,
            "paid": str(paid), "cancelled_balance": str(void.cancelled_balance), "refund_due": str(void.refund_due),
            "location": sale.location.code, "stock_before": stock_before, "stock_after": stock_after,
            "reversal_payment_ids": reversal_ids, "credit_payment_ids": credit_ids,
        },
    )
    notify(customer.user, None, "DIRECT_SALE_CANCELLED", "Purchase cancelled", void_notification_body(sale, void), dedupe=False)
    return void


@transaction.atomic
def confirm_refund(sale, actor, references, amount=None):
    """Record that the refund owed by a voided sale was paid back: all of it, once.

    One negative payment per original payment, in its mode, received_by the confirming admin.
    GPay and bank need a transaction reference; cash may have one. Lock order: the customer,
    then the sale's void. SaleRefund.void is one-to-one, so a second confirmation is refused.
    """
    if references in (None, ""):
        references = {}
    if not isinstance(references, dict):
        raise ApiError("References must be given per payment mode.", code="invalid", field="references")
    if sale.customer_id is None:
        raise ApiError("This sale has no refund to confirm.", code="no_refund_owed", status=409)
    customer = lock_customer(sale.customer_id)
    void = SaleVoid.objects.select_for_update().filter(sale_id=sale.pk).first()
    if void is None:
        raise ApiError("This sale has not been cancelled.", code="not_voided", status=409)
    if void.outcome != SaleVoid.Outcome.REFUND:
        raise ApiError("This cancellation did not owe a refund.", code="no_refund_owed", status=409, void_outcome=void.outcome)
    if SaleRefund.objects.filter(void=void).exists():
        raise ApiError("This refund has already been confirmed.", code="refund_already_confirmed", status=409)

    payments = list(original_payments(sale))
    total = sum((p.amount for p in payments), Decimal("0"))
    if total != void.refund_due or PaymentReversal.objects.filter(original__in=payments).exists():
        raise ApiError("This sale's payments no longer match the refund owed; it cannot be confirmed.",
                       code="refund_mismatch", status=409, refund_due=str(void.refund_due))
    if amount not in (None, ""):
        try:
            requested = Decimal(str(amount))
        except (InvalidOperation, ValueError):
            raise ApiError("Amount must be a valid amount.", code="invalid", field="amount")
        if requested != void.refund_due:
            raise ApiError(f"The whole refund of Rs. {void.refund_due} is confirmed at once.",
                           code="amount_mismatch", field="amount", refund_due=str(void.refund_due))

    modes = {p.payment_mode for p in payments}
    unknown = set(references) - modes
    if unknown:
        raise ApiError(f"No refund is due in {', '.join(sorted(unknown))}.", code="invalid", field="references")
    clean = {}
    for mode in sorted(modes):
        value = references.get(mode, "")
        if not isinstance(value, str):
            raise ApiError("Each reference must be text.", code="invalid", field="references")
        value = value.strip()
        if len(value) > REFUND_REFERENCE_MAX:
            raise ApiError(f"References must be {REFUND_REFERENCE_MAX} characters or fewer.", code="max_length", field="references")
        if not value and mode in REFERENCE_REQUIRED_MODES:
            raise ApiError(f"A transaction reference is required for the {Sale.PaymentMode(mode).label} refund.",
                           code="reference_required", field="references", mode=mode)
        if value:
            clean[mode] = value

    try:
        with transaction.atomic():
            refund = SaleRefund.objects.create(void=void, amount=total, references=clean, confirmed_by=actor)
    except IntegrityError:
        raise ApiError("This refund has already been confirmed.", code="refund_already_confirmed", status=409)
    reversal_ids = []
    for original in payments:
        ref = clean.get(original.payment_mode)
        reversal = Payment.objects.create(
            customer=customer, sale=sale, amount=-original.amount, payment_mode=original.payment_mode, received_by=actor,
            note=f"Refund of payment #{original.pk}: sale #{sale.pk} cancelled" + (f", ref {ref}" if ref else ""),
        )
        PaymentReversal.objects.create(original=original, reversal=reversal, sale_void=void, sale_refund=refund)
        reversal_ids.append(reversal.pk)

    ActivityLog.objects.create(
        action="refund_confirmed",
        description=f"Refund of Rs. {total} for cancelled sale #{sale.pk}",
        user=actor,
        metadata={"sale_id": sale.pk, "void_id": void.pk, "refund_id": refund.pk, "customer_id": customer.pk,
                  "amount": str(total), "references": clean, "reversal_payment_ids": reversal_ids},
    )
    sent = ", ".join(
        f"{Sale.PaymentMode(mode).label} Rs. {sum((p.amount for p in payments if p.payment_mode == mode), Decimal('0'))}"
        + (f" (ref {clean[mode]})" if mode in clean else "")
        for mode in sorted(modes)
    )
    notify(customer.user, None, "REFUND_COMPLETED", "Refund completed",
           f"Your refund of Rs. {total} for cancelled {_sale_label(sale)} has been sent: {sent}.", dedupe=False)
    return refund


def user_search_q(term, prefix=""):
    """Build a Q matching every whitespace-separated token of ``term`` (AND across
    tokens) against first_name / last_name / username / phone of a User.

    ``prefix`` is the relation path to the user, e.g. ``"user__"`` for
    CustomerProfile or ``"customer__user__"`` for Sale.
    """
    query = Q()
    for token in (term or "").split():
        query &= (
            Q(**{f"{prefix}first_name__icontains": token})
            | Q(**{f"{prefix}last_name__icontains": token})
            | Q(**{f"{prefix}username__icontains": token})
            | Q(**{f"{prefix}phone__icontains": token})
        )
    return query


# ---------------------------------------------------------------------------
# Assignment history (ActivityLog)
#
# A booking has a single Delivery row that moves to the new staff on re-assignment.
# The approve / decline actions log every move, so a staff member's earlier part in a
# booking is read back from those logs — always in (created_at, id) order, since
# several events can share a timestamp. Nothing before the first log is recoverable.
# ---------------------------------------------------------------------------

ASSIGNMENT_LOG_ACTIONS = ("booking_approved", "delivery_declined", "booking_rejected")


def _log_key(log):
    return (log.created_at, log.id)


def assignment_logging_started_at():
    """When the approve/decline/reject actions first logged anything, or ``None``."""
    first = ActivityLog.objects.filter(action__in=ASSIGNMENT_LOG_ACTIONS).order_by("created_at", "id").first()
    return first.created_at if first else None


def staff_handovers(user):
    """``{booking_id: ActivityLog}`` — the latest re-assignment that took each booking away
    from ``user``, for bookings whose Delivery is not ``user``'s now.

    A booking ``user`` holds again (A -> B -> A) is left out: its current Delivery row
    already covers it, so every booking appears at most once in a staff history.
    """
    handovers = {}
    logs = ActivityLog.objects.filter(
        action="booking_approved", metadata__previous_staff_id=user.id
    ).order_by("created_at", "id")
    for log in logs:
        booking_id = log.metadata.get("booking_id")
        if booking_id is not None and log.metadata.get("staff_id") != user.id:
            handovers[booking_id] = log
    held = set(Delivery.objects.filter(booking_id__in=list(handovers), staff=user).values_list("booking_id", flat=True))
    return {booking_id: log for booking_id, log in handovers.items() if booking_id not in held}


def staff_assignment_details(user, booking_ids, handovers):
    """What the logs add to ``user``'s history rows for ``booking_ids``.

    Handed-over bookings get ``handover`` (outcome, previous delivery status, decline
    reason, when, to whom). Bookings ``user`` holds get ``reassigned_from`` (the staff it
    came from) and ``previous_decline`` (a decline by ``user`` that a later re-approval
    cleared from the Delivery row). Only facts present in the logs are returned.
    """
    events = {}
    logs = ActivityLog.objects.filter(
        action__in=("booking_approved", "delivery_declined"), metadata__booking_id__in=list(booking_ids)
    ).order_by("created_at", "id")
    for log in logs:
        events.setdefault(log.metadata.get("booking_id"), []).append(log)

    def last_decline_before(booking_events, before):
        declines = [
            log for log in booking_events
            if log.action == "delivery_declined" and log.metadata.get("staff_id") == user.id and _log_key(log) < before
        ]
        return declines[-1] if declines else None

    details = {}
    for booking_id in booking_ids:
        booking_events = events.get(booking_id, [])
        handover = handovers.get(booking_id)
        if handover is not None:
            previous_status = handover.metadata.get("previous_delivery_status")
            decline = last_decline_before(booking_events, _log_key(handover)) if previous_status == Delivery.Status.REJECTED else None
            details[booking_id] = {
                "handover": {
                    "outcome": "declined" if previous_status == Delivery.Status.REJECTED else "reassigned",
                    "previous_status": previous_status,
                    "reason": decline.metadata.get("reason") if decline else None,
                    "handed_over_at": handover.created_at,
                    "to_staff_id": handover.metadata.get("staff_id"),
                },
            }
            continue
        assignments = [
            log for log in booking_events
            if log.action == "booking_approved" and log.metadata.get("staff_id") == user.id
        ]
        if not assignments:
            continue
        assigned = assignments[-1]
        from_id = assigned.metadata.get("previous_staff_id")
        decline = last_decline_before(booking_events, _log_key(assigned))
        details[booking_id] = {
            "reassigned_from_id": from_id if from_id not in (None, user.id) else None,
            "previous_decline": (
                {"reason": decline.metadata.get("reason"), "declined_at": decline.created_at} if decline else None
            ),
        }
    return details


# ---------------------------------------------------------------------------
# Deletion / deactivation policy (finalSpec §6)
#
# A party with history is never deleted — only deactivated. Hard delete is reserved
# for zero-reference records (typo accounts). Nothing financial is ever deleted here.
# ---------------------------------------------------------------------------

OPEN_BOOKING_STATUSES = (
    Booking.Status.PENDING,
    Booking.Status.APPROVED,
    Booking.Status.ACCEPTED,
    Booking.Status.OUT_FOR_DELIVERY,
)
OPEN_DELIVERY_STATUSES = (
    Delivery.Status.ASSIGNED,
    Delivery.Status.ACCEPTED,
    Delivery.Status.OUT_FOR_DELIVERY,
)

SELF_ACTION_MESSAGE = "You cannot delete or deactivate your own account."


def _set_user_active(user, active):
    """Mirror ``is_active`` to the User and to whichever profile it has."""
    user.is_active = active
    user.save(update_fields=["is_active"])
    staff_profile = getattr(user, "staff_profile", None)
    if staff_profile is not None:
        staff_profile.is_active = active
        staff_profile.save(update_fields=["is_active", "updated_at"])
    customer_profile = getattr(user, "customer_profile", None)
    if customer_profile is not None:
        customer_profile.is_active = active
        customer_profile.save(update_fields=["is_active", "updated_at"])


def _order_ids(booking_ids):
    return [f"GB{pk}" for pk in booking_ids]


# ---- customers -------------------------------------------------------------

def customer_history_counts(profile):
    return {
        "sales": profile.sales.count(),
        "payments": profile.payments.count(),
        "bookings": profile.bookings.count(),
    }


def customer_has_history(profile, counts=None):
    counts = counts if counts is not None else customer_history_counts(profile)
    return any(counts.values()) or profile.opening_balance != 0 or profile.deposit_cylinders > 0


def customer_pending_amount(profile):
    """Same formula as ``CustomerProfileSerializer.get_pending_amount``."""
    return str(customer_outstanding(profile))


def ensure_customer_phone_free(phone):
    """Lock the phone number and refuse it (400 duplicate_phone) if a customer already uses it.

    Two requests registering the same new number queue on the lock, so only one of them
    creates a customer. An existing customer is never merged or reused silently; the error
    names it so the caller can choose it instead.
    """
    advisory_lock("customer-phone", phone)
    existing = User.objects.filter(phone=phone, role__code="customer").select_related("customer_profile").first()
    if existing is None:
        return
    message = (
        f"This mobile number is already in the system. The user is: "
        f"{display_name(existing)} ({existing.username})."
    )
    extra = {}
    profile = getattr(existing, "customer_profile", None)
    if profile is not None:
        extra["existing_customer"] = {"id": profile.pk, "name": display_name(existing), "phone": existing.phone}
    raise ApiError(message, code="duplicate_phone", field="phone", errors={"phone": [message]}, phone=[message], **extra)


@transaction.atomic
def create_customer(contact, actor, via):
    """Create a customer's login and profile from contact fields already validated with
    ``validate_user_contact``. ``via`` records where it happened ("customers" or "sale").

    The phone number is required and must not belong to another customer (checked under a
    lock on the number). The login has no usable password and must change it on first use.
    Logs customer_created. Returns the CustomerProfile.
    """
    phone = contact.get("phone", "")
    if not phone:
        message = "Phone number is required to register a new customer."
        raise ApiError(message, code="required", field="phone", errors={"phone": [message]}, phone=[message])
    ensure_customer_phone_free(phone)

    name = contact.get("full_name", "")
    parts = name.split(" ", 1)
    base_name = "_".join(parts).lower() if parts else "customer"
    username = f"{base_name}_{phone[-4:]}"
    customer_role = Role.objects.filter(code="customer").first()
    user = None
    for attempt in range(5):
        candidate = username if attempt == 0 else f"{username}_{get_random_string(4)}"
        if User.objects.filter(username=candidate).exists():
            continue
        try:
            with transaction.atomic():
                user = User.objects.create_user(
                    username=candidate,
                    first_name=parts[0] if parts else "",
                    last_name=parts[1] if len(parts) > 1 else "",
                    email=contact.get("email", ""),
                    phone=phone,
                    address=contact.get("address", ""),
                    role=customer_role,
                    must_change_password=True,
                    is_active=True,
                )
            break
        except IntegrityError:  # the username was taken by a concurrent request
            continue
    if user is None:
        raise ApiError("Could not choose a unique username for this customer; please try again.", code="conflict", status=409)

    profile = CustomerProfile.objects.create(user=user)
    ActivityLog.objects.create(
        action="customer_created",
        description=f"Created customer {display_name(user)}"[:255],
        user=actor,
        metadata={"customer_id": profile.pk, "user_id": user.pk, "username": user.username, "via": via},
    )
    return profile


def delete_customer(profile, actor):
    """Hard-delete a zero-history customer; 409 ``has_history`` otherwise.

    Returns the response payload. Must run inside ``transaction.atomic``.
    """
    counts = customer_history_counts(profile)
    if customer_has_history(profile, counts):
        raise ApiError(
            "This customer has transaction history and cannot be deleted. Deactivate the account instead.",
            code="has_history",
            status=409,
            counts=counts,
            pending_amount=customer_pending_amount(profile),
            is_active=bool(profile.is_active and profile.user.is_active),
        )
    user = profile.user
    ActivityLog.objects.create(
        action="customer_deleted",
        user=actor,
        description=f"Deleted customer {display_name(user)}"[:255],
        metadata={"customer_id": profile.id, "user_id": user.id, "username": user.username},
    )
    # Cascades the (empty) profile, notifications, custom rates and discounts.
    user.delete()
    return {"detail": "Customer deleted.", "mode": "deleted"}


def deactivate_customer(profile, actor):
    """Deactivate a customer (idempotent). 409 ``has_open_orders`` when orders are open."""
    open_ids = list(
        profile.bookings.filter(status__in=OPEN_BOOKING_STATUSES).order_by("pk").values_list("pk", flat=True)
    )
    if open_ids:
        raise ApiError(
            f"Customer has {len(open_ids)} open order(s). Reject or complete them first.",
            code="has_open_orders",
            status=409,
            open_order_ids=_order_ids(open_ids),
        )
    user = profile.user
    user.customer_profile = profile  # keep a single instance so the mirror hits this row
    _set_user_active(user, False)
    ActivityLog.objects.create(
        action="customer_deactivated",
        user=actor,
        description=f"Deactivated customer {display_name(user)}"[:255],
        metadata={"customer_id": profile.id, "user_id": user.id, "username": user.username},
    )
    return profile


def reactivate_customer(profile, actor):
    user = profile.user
    user.customer_profile = profile
    _set_user_active(user, True)
    ActivityLog.objects.create(
        action="customer_reactivated",
        user=actor,
        description=f"Reactivated customer {display_name(user)}"[:255],
        metadata={"customer_id": profile.id, "user_id": user.id, "username": user.username},
    )
    return profile


# ---- staff / non-customer users ------------------------------------------------

def user_history_counts(user):
    return {
        "deliveries": user.deliveries.count(),
        "sales": Sale.objects.filter(sold_by=user).count(),
        "handover_sales": Sale.objects.filter(handover_staff=user).count(),
        "sale_voids": SaleVoid.objects.filter(voided_by=user).count(),
        "sale_refunds": SaleRefund.objects.filter(confirmed_by=user).count(),
        "payments": Payment.objects.filter(received_by=user).count(),
        "expenses": Expense.objects.filter(spent_by=user).count(),
        "movements": StockMovement.objects.filter(moved_by=user).count(),
        "bookings": (
            user.assigned_bookings.count() + user.approved_bookings.count() + user.rejected_bookings.count()
        ),
        "activity": ActivityLog.objects.filter(user=user).count(),
    }


def default_staff_customers(user):
    return CustomerProfile.objects.filter(default_staff=user).count()


def _ensure_not_self(user, actor):
    if actor is not None and user.pk == actor.pk:
        raise ApiError(SELF_ACTION_MESSAGE, code="self_action", status=400)


def delete_user(user, actor):
    """Hard-delete a zero-history non-customer user; 400 ``self_action`` / 409 ``has_history``."""
    _ensure_not_self(user, actor)
    counts = user_history_counts(user)
    if any(counts.values()):
        raise ApiError(
            "This user has delivery or transaction history and cannot be deleted. Deactivate the account instead.",
            code="has_history",
            status=409,
            counts=counts,
            default_staff_customers=default_staff_customers(user),
            is_active=user.is_active,
        )
    staff_profile = getattr(user, "staff_profile", None)
    if staff_profile is not None and staff_profile.image:
        staff_profile.image.delete(save=False)
    ActivityLog.objects.create(
        action="user_deleted",
        user=actor,
        description=f"Deleted user {display_name(user)}"[:255],
        metadata={"user_id": user.id, "username": user.username, "role": getattr(user.role, "code", None)},
    )
    user.delete()
    return {"detail": "User deleted.", "mode": "deleted"}


def deactivate_user(user, actor):
    """Deactivate a non-customer user (idempotent). 409 ``has_open_deliveries`` when deliveries are open."""
    _ensure_not_self(user, actor)
    open_ids = list(
        user.deliveries.filter(status__in=OPEN_DELIVERY_STATUSES).order_by("booking_id").values_list("booking_id", flat=True)
    )
    if open_ids:
        raise ApiError(
            f"Staff has {len(open_ids)} open deliver(ies). Reassign or complete them first.",
            code="has_open_deliveries",
            status=409,
            open_order_ids=_order_ids(open_ids),
        )
    _set_user_active(user, False)
    ActivityLog.objects.create(
        action="user_deactivated",
        user=actor,
        description=f"Deactivated user {display_name(user)}"[:255],
        metadata={"user_id": user.id, "username": user.username, "role": getattr(user.role, "code", None)},
    )
    return user


def reactivate_user(user, actor):
    _set_user_active(user, True)
    ActivityLog.objects.create(
        action="user_reactivated",
        user=actor,
        description=f"Reactivated user {display_name(user)}"[:255],
        metadata={"user_id": user.id, "username": user.username, "role": getattr(user.role, "code", None)},
    )
    return user
