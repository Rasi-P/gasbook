"""Small domain helpers shared by views and serializers.

This module must not import from ``serializers`` or ``views`` (they import it).
"""
from decimal import Decimal, InvalidOperation

from django.db.models import Q

from .exceptions import ApiError
from .models import (
    ActivityLog,
    Booking,
    CustomerProfile,
    Delivery,
    Expense,
    Notification,
    Payment,
    Sale,
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
    sales_due = sum((sale.balance_due for sale in profile.sales.all()), Decimal("0"))
    payments = sum((p.amount for p in profile.payments.filter(sale__isnull=True)), Decimal("0"))
    return str(profile.opening_balance + sales_due - payments)


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
