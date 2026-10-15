from decimal import Decimal

from django.contrib.auth.validators import UnicodeUsernameValidator
from django.db import transaction
from django.db.models import Q
from django.core.validators import RegexValidator
from rest_framework import serializers

from .exceptions import ApiError
from .pricing import calculate_pricing, snapshot, SNAPSHOT_FIELDS
from .models import (
    ActivityLog, Booking, CustomerCylinderDiscount, CustomerCylinderRate, CustomerProfile,
    CylinderType, Delivery, Expense, Notification, Payment, PaymentReversal, Role, Sale, SaleItem,
    SaleRefund, StaffProfile, Stock, StockLocation, StockMovement, User, quantize_money,
)
from .services import (
    DIRECT_SALE_LOCATION_CODES,
    MAX_COUNT,
    MAX_MONEY,
    RECEIPT_MODES,
    check_handover_staff,
    is_active_staff,
    create_customer,
    customer_outstanding,
    display_name,
    get_stock_row,
    lock_customer,
    lock_sale_stock,
    not_voided,
    notify,
    record_customer_payment,
    sale_void,
)

RECEIPT_MODE_CHOICES = [(mode.value, mode.label) for mode in RECEIPT_MODES]

phone_validator = RegexValidator(regex=r"^\d+$", message="Phone number must contain only digits.")

NAME_PART_MAX = User._meta.get_field("first_name").max_length  # 150


def split_full_name(value):
    parts = (value or "").strip().split(" ", 1)
    first = parts[0] if parts else ""
    last = parts[1].strip() if len(parts) > 1 else ""
    return first, last


class UserContactInputSerializer(serializers.Serializer):
    """Length/format validation for the user contact fields written by hand in the
    register / user_detail / me / customer create+update views. Every field is
    optional; only the keys present in the input are validated."""

    full_name = serializers.CharField(required=False, allow_blank=True)
    phone = serializers.CharField(
        required=False, allow_blank=True, max_length=User._meta.get_field("phone").max_length,
        validators=[phone_validator],
    )
    email = serializers.EmailField(
        required=False, allow_blank=True, max_length=User._meta.get_field("email").max_length,
    )
    address = serializers.CharField(required=False, allow_blank=True)
    username = serializers.CharField(
        required=False, allow_blank=True, max_length=User._meta.get_field("username").max_length,
        validators=[UnicodeUsernameValidator()],
    )
    area = serializers.CharField(
        required=False, allow_blank=True, max_length=CustomerProfile._meta.get_field("area").max_length,
    )
    vehicle_number = serializers.CharField(
        required=False, allow_blank=True, max_length=StaffProfile._meta.get_field("vehicle_number").max_length,
    )

    def validate_full_name(self, value):
        first, last = split_full_name(value)
        if len(first) > NAME_PART_MAX or len(last) > NAME_PART_MAX:
            raise serializers.ValidationError(
                f"Name is too long (max {NAME_PART_MAX} characters per part).", code="max_length"
            )
        return value.strip()


def contact_validation_error(errors):
    """Flatten DRF ``serializer.errors`` into an ApiError:
    {"detail": first message, "code": "invalid"|"max_length", "field": name, "errors": {...}}
    plus the field-keyed lists themselves."""
    field, messages = next(iter(errors.items()))
    first = messages[0] if isinstance(messages, (list, tuple)) and messages else messages
    code = getattr(first, "code", None)
    code = "max_length" if code == "max_length" else "invalid"
    plain_errors = {key: [str(message) for message in value] for key, value in errors.items()}
    return ApiError(str(first), code=code, field=field, errors=plain_errors, **plain_errors)


def validate_user_contact(data, *, name_key="full_name", exclude_user=None, check_duplicate_phone=False):
    """Validate the contact fields present in ``data`` (a dict or QueryDict) BEFORE
    any write. Returns the cleaned values (stripped) keyed by canonical field name.
    Raises ApiError (400) on the first problem."""
    payload = {}
    for key in ("phone", "email", "address", "username", "area", "vehicle_number"):
        value = data.get(key)
        if value is not None:
            payload[key] = value
    name = data.get(name_key)
    if name is not None:
        payload["full_name"] = name
    for key, value in payload.items():
        if not isinstance(value, str):
            raise ApiError(f"{key} must be text.", code="invalid", field=key, errors={key: ["Must be text."]})

    serializer = UserContactInputSerializer(data=payload)
    if not serializer.is_valid():
        raise contact_validation_error(serializer.errors)
    cleaned = dict(serializer.validated_data)

    phone = cleaned.get("phone")
    if check_duplicate_phone and phone:
        existing = User.objects.filter(phone=phone, role__code="customer")
        if exclude_user is not None:
            existing = existing.exclude(pk=exclude_user.pk)
        existing = existing.first()
        if existing:
            message = (
                f"This mobile number is already in the system. The user is: "
                f"{display_name(existing)} ({existing.username})."
            )
            raise ApiError(message, code="duplicate_phone", field="phone", errors={"phone": [message]}, phone=[message])
    return cleaned


def serialize_decimal(value):
    return str(quantize_money(value))


def get_customer_pricing_snapshot(customer, cylinder_type, quantity, rate_type="refill"):
    return calculate_pricing(customer, cylinder_type, quantity, rate_type)


def get_booking_pricing_snapshot(booking):
    quantity = Decimal(booking.quantity or 0)
    original_rate = (
        quantize_money(Decimal(booking.original_amount) / quantity)
        if quantity > 0
        else Decimal("0.00")
    )
    effective_rate = (
        quantize_money(Decimal(booking.final_amount) / quantity)
        if quantity > 0
        else Decimal("0.00")
    )
    return {
        **snapshot(booking),
        "rate": original_rate,
        "quantity": booking.quantity,
        "original_amount": quantize_money(booking.original_amount),
        "discount_amount": quantize_money(booking.discount_amount),
        "final_amount": quantize_money(booking.final_amount),
        "has_discount": booking.discount_amount > 0,
        "effective_rate": effective_rate,
        "discount_scope": None,
        "applied_discount_type": booking.applied_discount_type,
        "applied_discount_value": quantize_money(booking.applied_discount_value),
    }


def get_sale_pricing_snapshot(sale):
    if sale.original_amount > 0 or sale.discount_amount > 0 or sale.applied_discount_type:
        return {
            "original_amount": quantize_money(sale.original_amount),
            "discount_amount": quantize_money(sale.discount_amount),
            "final_amount": quantize_money(sale.total_amount),
            "has_discount": sale.discount_amount > 0,
            "applied_discount_type": sale.applied_discount_type,
            "applied_discount_value": quantize_money(sale.applied_discount_value),
        }
    original_amount = quantize_money(sale.total_amount)
    return {
        "original_amount": original_amount,
        "discount_amount": Decimal("0.00"),
        "final_amount": original_amount,
        "has_discount": False,
        "applied_discount_type": None,
        "applied_discount_value": Decimal("0.00"),
    }


class UserSerializer(serializers.ModelSerializer):
    phone = serializers.CharField(validators=[phone_validator], required=False, allow_blank=True)
    role = serializers.SlugRelatedField(slug_field='code', queryset=Role.objects.all())

    class Meta:
        model = User
        fields = ["id", "username", "first_name", "last_name", "role", "is_active", "phone", "address", "email"]


class CylinderTypeSerializer(serializers.ModelSerializer):
    deposit_amount = serializers.DecimalField(max_digits=10, decimal_places=2, min_value=Decimal("0"), required=False)
    refill_rate = serializers.DecimalField(max_digits=10, decimal_places=2, min_value=Decimal("0"), required=False)
    customer_rate = serializers.SerializerMethodField()
    discount_amount = serializers.SerializerMethodField()
    final_price = serializers.SerializerMethodField()
    has_discount = serializers.SerializerMethodField()

    class Meta:
        model = CylinderType
        fields = "__all__"

    def _get_pricing(self, obj):
        request = self.context.get("request")
        user = getattr(request, "user", None)
        profile = getattr(user, "customer_profile", None) if user and user.is_authenticated else None
        return get_customer_pricing_snapshot(profile, obj, 1)

    def get_customer_rate(self, obj):
        return serialize_decimal(self._get_pricing(obj)["rate"])

    def get_discount_amount(self, obj):
        return serialize_decimal(self._get_pricing(obj)["discount_amount"])

    def get_final_price(self, obj):
        return serialize_decimal(self._get_pricing(obj)["final_amount"])

    def get_has_discount(self, obj):
        return self._get_pricing(obj)["has_discount"]


class StockLocationSerializer(serializers.ModelSerializer):
    class Meta:
        model = StockLocation
        fields = "__all__"


class StockSerializer(serializers.ModelSerializer):
    cylinder_type_name = serializers.CharField(source="cylinder_type.name", read_only=True)
    location_name = serializers.CharField(source="location.name", read_only=True)

    class Meta:
        model = Stock
        fields = "__all__"


class StockMovementSerializer(serializers.ModelSerializer):
    moved_by_name = serializers.CharField(source="moved_by.username", read_only=True)
    cylinder_type_name = serializers.CharField(source="cylinder_type.name", read_only=True)
    from_location_name = serializers.CharField(source="from_location.name", read_only=True)
    to_location_name = serializers.CharField(source="to_location.name", read_only=True)
    supplier_pending_after = serializers.SerializerMethodField()

    class Meta:
        model = StockMovement
        fields = "__all__"
        read_only_fields = ["moved_by"]

    def get_supplier_pending_after(self, obj):
        if obj.note and ("Sent for refilling" in obj.note or "Received refilled cylinders" in obj.note):
            movements = StockMovement.objects.filter(
                Q(from_location__code="supplier") | Q(to_location__code="supplier") | 
                Q(from_location__is_main_supplier=True) | Q(to_location__is_main_supplier=True),
                cylinder_type_id=obj.cylinder_type_id,
                created_at__lte=obj.created_at
            ).order_by("created_at")
            pending = 0
            for m in movements:
                is_to = (m.to_location.code == "supplier" or m.to_location.is_main_supplier)
                is_from = (m.from_location.code == "supplier" or m.from_location.is_main_supplier)
                if is_to and m.status == "empty":
                    pending += m.quantity
                elif is_from and m.status == "filled" and m.note and "New supplier load" not in m.note:
                    pending = max(0, pending - m.quantity)
            return pending
        return None

    def validate(self, attrs):
        if attrs["from_location"] == attrs["to_location"]:
            raise serializers.ValidationError("From and to locations must be different.")
        if attrs["quantity"] <= 0:
            raise serializers.ValidationError("Quantity must be greater than zero.")
        return attrs

    @transaction.atomic
    def create(self, validated_data):
        user = self.context["request"].user
        from_location = validated_data["from_location"]
        quantity = validated_data["quantity"]

        if not from_location.is_main_supplier and from_location.code != "supplier":
            source = get_stock_row(validated_data["cylinder_type"], from_location, validated_data["status"])
            if source.quantity < quantity:
                raise serializers.ValidationError("Not enough stock in source location.")
            source.quantity -= quantity
            source.save(update_fields=["quantity", "updated_at"])

        if not validated_data["to_location"].is_main_supplier and validated_data["to_location"].code != "supplier":
            destination = get_stock_row(validated_data["cylinder_type"], validated_data["to_location"], validated_data["status"])
            destination.quantity += quantity
            destination.save(update_fields=["quantity", "updated_at"])

        movement = StockMovement.objects.create(moved_by=user, **validated_data)
        ActivityLog.objects.create(
            action="stock_moved",
            description=f"Moved {quantity} {validated_data['status']} cylinders from {from_location.name} to {validated_data['to_location'].name}",
            user=user,
            metadata={"movement_id": movement.id},
        )
        return movement


class SaleItemSerializer(serializers.ModelSerializer):
    cylinder_type_name = serializers.CharField(source="cylinder_type.name", read_only=True)

    class Meta:
        model = SaleItem
        fields = ["id", "cylinder_type", "cylinder_type_name", "quantity", "rate", "total_amount", "empty_returned", *SNAPSHOT_FIELDS]


class SaleItemWriteSerializer(serializers.Serializer):
    cylinder_type = serializers.PrimaryKeyRelatedField(queryset=CylinderType.objects.all())
    quantity = serializers.IntegerField(min_value=0, max_value=MAX_COUNT)
    rate_type = serializers.ChoiceField(choices=["new", "refill"], default="refill")
    # Optional legacy client assertion, never an override of the calculated price.
    rate = serializers.DecimalField(max_digits=10, decimal_places=2, min_value=Decimal("0"), required=False)
    # Editable components for admin Direct Sales. Snapshot fields stay read-only.
    deposit = serializers.DecimalField(max_digits=10, decimal_places=2, min_value=Decimal("0"), required=False)
    refill_charge = serializers.DecimalField(max_digits=10, decimal_places=2, min_value=Decimal("0"), required=False)
    empty_returned = serializers.IntegerField(min_value=0, max_value=MAX_COUNT, default=0)

    def to_internal_value(self, data):
        if isinstance(data, dict):
            forbidden = {"deposit_unit_amount", "refill_unit_amount", "total_amount", "final_amount", "discount_amount", "original_amount"}.intersection(data)
            if forbidden:
                raise serializers.ValidationError("Pricing components and totals are set by the server.")
        return super().to_internal_value(data)


def price_sale_lines(lines, customer):
    # Check structural/stock eligibility rules before price assertions.
    SaleSerializer.merge_lines(lines)
    # Validate assertions before merging, so a duplicate cannot hide a tampered rate.
    for line in lines:
        if line["rate_type"] == "refill" and line.get("deposit", 0) != 0:
            raise ApiError("Refill transactions cannot include a deposit.", code="invalid", field="sale_items")
        pricing = calculate_pricing(customer, line["cylinder_type"], line["quantity"], line["rate_type"], component_rates=line)
        if "rate" in line and line["rate"] != pricing["rate"]:
            raise ApiError("The submitted rate does not match the calculated price. Refresh the quote.", code="rate_mismatch", field="sale_items")
        line["deposit"] = pricing["deposit_unit_amount"]
        line["refill_charge"] = pricing["refill_unit_amount"]
    lines = SaleSerializer.merge_lines(lines)
    for line in lines:
        line.update(calculate_pricing(customer, line["cylinder_type"], line["quantity"], line["rate_type"], component_rates=line))
    return lines


class SplitPaymentSerializer(serializers.Serializer):
    mode = serializers.ChoiceField(choices=RECEIPT_MODE_CHOICES)
    amount = serializers.DecimalField(max_digits=10, decimal_places=2, min_value=Decimal("0.01"))


class NewCustomerSerializer(serializers.Serializer):
    """A customer registered as part of a sale; contact formats are checked like POST /customers/."""

    name = serializers.CharField()
    phone = serializers.CharField()
    address = serializers.CharField(required=False, allow_blank=True)
    email = serializers.CharField(required=False, allow_blank=True)


def receipt_parts(parts, field):
    """Validated (mode, amount) pairs from a list of SplitPaymentSerializer parts: one to three
    parts, each mode at most once."""
    if not parts:
        raise ApiError("Enter at least one payment part.", code="invalid_payment", field=field)
    modes = [part["mode"] for part in parts]
    if len(set(modes)) != len(modes):
        raise ApiError("Each payment mode can appear only once.", code="invalid_payment", field=field)
    return [(part["mode"], part["amount"]) for part in parts]


# Set by the server; a request that tries to send them is refused rather than silently ignored.
SALE_SERVER_FIELDS = frozenset({
    "total_amount", "final_amount", "balance_due", "original_amount", "discount_amount", "has_discount",
    "applied_discount_type", "applied_discount_value", "sold_by", "sold_by_name", "delivery_staff", "payments",
    "sold_by_full_name", "sold_by_role", "handover_staff_name", "is_direct", "void",
})


def payment_kind(payment):
    """What a payment row is: payment, refund (money paid back), credit_reversal (taken off a
    cancelled sale and kept as credit) or credit (that money, kept for the customer)."""
    if payment.amount < 0:
        try:
            link = payment.reverses_link
        except PaymentReversal.DoesNotExist:
            return "reversal"
        return "refund" if link.sale_refund_id else "credit_reversal"
    if payment.sale_id is None:
        try:
            payment.credit_link
        except PaymentReversal.DoesNotExist:
            return "payment"
        return "credit"
    return "payment"


def void_summary(void):
    """A SaleVoid for the screens: who cancelled it, why, and where its money stands."""
    try:
        refund = void.refund
    except SaleRefund.DoesNotExist:
        refund = None
    if void.outcome == void.Outcome.REFUND:
        status = "refunded" if refund else "refund_pending"
    else:
        status = "credited" if void.outcome == void.Outcome.CREDIT else "cancelled"
    return {
        "id": void.pk,
        "outcome": void.outcome,
        "status": status,
        "reason": void.reason,
        "voided_at": void.created_at,
        "voided_by_name": display_name(void.voided_by),
        "paid_amount": serialize_decimal(void.paid_amount),
        "cancelled_balance": serialize_decimal(void.cancelled_balance),
        "refund_due": serialize_decimal(void.refund_due),
        "refund": refund and {
            "amount": serialize_decimal(refund.amount),
            "references": refund.references,
            "confirmed_at": refund.created_at,
            "confirmed_by_name": display_name(refund.confirmed_by),
        },
    }


class SaleSerializer(serializers.ModelSerializer):
    quoted_total = serializers.DecimalField(max_digits=10, decimal_places=2, min_value=Decimal("0"), required=False, write_only=True)
    # Exactly one of customer (an existing customer) or new_customer (registered with the sale).
    customer = serializers.PrimaryKeyRelatedField(
        queryset=CustomerProfile.objects.select_related("user"), required=False, allow_null=True
    )
    new_customer = NewCustomerSerializer(required=False, write_only=True)
    # Money collected for the customer's older dues in the same request; never for this sale.
    past_due_payments = SplitPaymentSerializer(many=True, required=False, write_only=True)
    # Who physically handed the cylinders over (optional); see services.check_handover_staff.
    handover_staff = serializers.PrimaryKeyRelatedField(
        queryset=User.objects.select_related("role", "staff_profile"), required=False, allow_null=True
    )
    customer_name = serializers.CharField(source="customer.user.username", read_only=True, default="Guest")
    sold_by_name = serializers.CharField(source="sold_by.username", read_only=True)
    sold_by_full_name = serializers.SerializerMethodField()
    sold_by_role = serializers.SerializerMethodField()
    handover_staff_name = serializers.SerializerMethodField()
    is_direct = serializers.SerializerMethodField()
    location_name = serializers.CharField(source="location.name", read_only=True)
    items = SaleItemSerializer(many=True, read_only=True)
    sale_items = SaleItemWriteSerializer(many=True, write_only=True)
    paid_amount = serializers.DecimalField(max_digits=10, decimal_places=2, min_value=Decimal("0"), required=False)
    paid_payment_mode = serializers.ChoiceField(choices=RECEIPT_MODE_CHOICES, required=False, write_only=True)
    split_payments = SplitPaymentSerializer(many=True, required=False, write_only=True)
    payments = serializers.SerializerMethodField()
    final_amount = serializers.SerializerMethodField()
    has_discount = serializers.SerializerMethodField()
    # The cancellation, if any (see void_summary); the sale itself is never changed by it.
    void = serializers.SerializerMethodField()

    def get_payments(self, obj):
        return [
            {"id": p.pk, "amount": p.amount, "mode": p.payment_mode, "date": p.created_at, "kind": payment_kind(p)}
            for p in obj.payments.select_related("reverses_link").order_by("created_at", "id")
        ]

    def get_void(self, obj):
        void = sale_void(obj)
        return void_summary(void) if void else None

    def get_final_amount(self, obj):
        return serialize_decimal(get_sale_pricing_snapshot(obj)["final_amount"])

    def get_has_discount(self, obj):
        return get_sale_pricing_snapshot(obj)["has_discount"]

    def get_sold_by_full_name(self, obj):
        return display_name(obj.sold_by)

    def get_sold_by_role(self, obj):
        return getattr(obj.sold_by.role, "code", None)

    def get_handover_staff_name(self, obj):
        return display_name(obj.handover_staff) if obj.handover_staff_id else None

    def get_is_direct(self, obj):
        """True for a sale made directly; False for one created by completing a booking."""
        return getattr(obj, "booking", None) is None

    class Meta:
        model = Sale
        fields = [
            "id", "customer", "customer_name", "location", "location_name",
            "original_amount", "discount_amount", "total_amount", "final_amount", "has_discount",
            "applied_discount_type", "applied_discount_value", "paid_amount", "balance_due",
            "payment_mode", "paid_payment_mode", "split_payments", "delivery_type", "delivery_staff", "note",
            "sold_by", "sold_by_name", "sold_by_full_name", "sold_by_role", "handover_staff", "handover_staff_name",
            "is_direct", "void", "created_at", "items", "sale_items", "payments",
            "client_ref", "new_customer", "past_due_payments", "quoted_total",
        ]
        read_only_fields = [
            "total_amount", "balance_due", "sold_by", "original_amount", "discount_amount",
            "applied_discount_type", "applied_discount_value", "delivery_staff",
        ]

    def validate(self, attrs):
        """Every rule a direct sale must pass before anything is locked or written. Stock is
        checked in create(), under lock."""
        spoofed = sorted(SALE_SERVER_FIELDS.intersection(self.initial_data))
        if spoofed:
            raise ApiError(
                f"These fields are set by the server and cannot be sent: {', '.join(spoofed)}.",
                code="read_only_fields",
                fields=spoofed,
            )

        attrs["handover_staff"] = check_handover_staff(attrs.get("handover_staff"), self.context["request"].user)

        customer, new_customer = attrs.get("customer"), attrs.get("new_customer")
        if customer is not None and new_customer is not None:
            raise ApiError("Send either customer or new_customer, not both.", code="invalid", field="customer")
        if customer is None and new_customer is None:
            raise ApiError("Choose a customer or enter a new customer's details.", code="required", field="customer")
        if new_customer is not None:
            # Formats only; the duplicate-phone check runs in create(), under a lock on the number.
            attrs["_new_customer"] = validate_user_contact(new_customer, name_key="name")
        elif not (customer.is_active and customer.user.is_active):
            raise ApiError("This customer is deactivated and cannot take new sales.", code="customer_inactive", field="customer")

        past_due = attrs.get("past_due_payments")
        attrs["_past_due"] = receipt_parts(past_due, "past_due_payments") if past_due is not None else []

        location = attrs["location"]
        if location.code not in DIRECT_SALE_LOCATION_CODES:
            raise ApiError(
                f"Direct sales take stock only from the shop or Kandam (godown), not {location.name}.",
                code="invalid_location",
                field="location",
            )
        if not location.is_active:
            raise ApiError(f"{location.name} is inactive.", code="location_inactive", field="location")

        attrs["sale_items"] = price_sale_lines(attrs.get("sale_items") or [], customer)
        attrs["original_amount"] = sum((line["original_amount"] for line in attrs["sale_items"]), Decimal("0"))
        attrs["discount_amount"] = sum((line["discount_amount"] for line in attrs["sale_items"]), Decimal("0"))
        total = sum((line["final_amount"] for line in attrs["sale_items"]), Decimal("0"))
        if total > MAX_MONEY or attrs["original_amount"] > MAX_MONEY:
            raise ApiError("The sale total is too large.", code="amount_too_large", field="sale_items")
        quoted_total = attrs.pop("quoted_total", None)
        if quoted_total is not None and quoted_total != total:
            raise ApiError("Pricing changed. Refresh the quote before recording the sale.", code="quote_changed", field="quoted_total")
        attrs["_total"] = total
        attrs["_receipts"] = self.receipts(attrs, total)
        return attrs

    @staticmethod
    def merge_lines(lines):
        """Merge lines with the same cylinder, pricing type and component rates, so a cylinder type split over
        several lines is counted once; stock is later checked per type across all lines.

        An inactive (discontinued) cylinder type may appear only on empties-only lines:
        its filled cylinders cannot be sold, but customers can still return its empties.
        Each line is checked before merging, so merging cannot hide a filled line."""
        if not lines:
            raise ApiError("Add at least one cylinder line.", code="no_lines", field="sale_items")
        merged = {}
        for line in lines:
            cylinder_type = line["cylinder_type"]
            if not cylinder_type.is_active and line["quantity"] > 0:
                raise ApiError(
                    f"{cylinder_type.name} is inactive and cannot be sold; only its empties can be returned.",
                    code="cylinder_inactive",
                    field="sale_items",
                )
            if line["quantity"] == 0 and line["empty_returned"] == 0:
                raise ApiError("Each line needs cylinders sold or empties returned.", code="empty_line", field="sale_items")
            key = (cylinder_type.pk, line["rate_type"], line.get("deposit"), line.get("refill_charge"))
            if key in merged:
                merged[key]["quantity"] += line["quantity"]
                merged[key]["empty_returned"] += line["empty_returned"]
            else:
                merged[key] = dict(line)
        if any(line["quantity"] > MAX_COUNT or line["empty_returned"] > MAX_COUNT for line in merged.values()):
            raise ApiError("Too many cylinders on one line.", code="invalid", field="sale_items")
        return list(merged.values())

    @staticmethod
    def receipts(attrs, total):
        """The payment rows the sale will create, as (mode, amount); sets attrs["paid_amount"].

        cash / gpay / bank: paid in full (paid_amount, if sent, must equal the total).
        credit: 0 <= paid <= total, and anything paid needs paid_payment_mode.
        split: one to three parts, each mode at most once; paid is their sum (paid_amount,
        if sent, must match it).
        """
        mode = attrs["payment_mode"]
        parts = attrs.get("split_payments")
        sent_paid = attrs.get("paid_amount")
        if parts and mode != Sale.PaymentMode.SPLIT:
            raise ApiError("split_payments can only be sent with payment mode split.", code="invalid_payment", field="split_payments")

        if mode == Sale.PaymentMode.SPLIT:
            receipts = receipt_parts(parts, "split_payments")
            paid = sum((amount for _, amount in receipts), Decimal("0"))
            if sent_paid is not None and sent_paid != paid:
                raise ApiError(f"paid_amount {sent_paid} does not match the split parts ({paid}).", code="paid_mismatch", field="paid_amount")
        elif mode == Sale.PaymentMode.CREDIT:
            paid = sent_paid if sent_paid is not None else Decimal("0")
            receipts = []
            if paid > 0:
                if not attrs.get("paid_payment_mode"):
                    raise ApiError(
                        "Say how the amount received was paid: cash, gpay or bank.",
                        code="required",
                        field="paid_payment_mode",
                    )
                receipts = [(attrs["paid_payment_mode"], paid)]
        else:
            paid = total if sent_paid is None else sent_paid
            if paid != total:
                raise ApiError(
                    f"A {Sale.PaymentMode(mode).label} sale is paid in full: paid_amount must be {total}.",
                    code="paid_mismatch",
                    field="paid_amount",
                )
            receipts = [(mode, paid)] if paid > 0 else []

        if paid > total:
            raise ApiError(f"Amount paid ({paid}) is more than the sale total ({total}).", code="overpayment", field="paid_amount")
        attrs["paid_amount"] = paid
        return receipts

    @transaction.atomic
    def create(self, validated_data):
        """Everything below runs in one transaction: a failure at any step leaves no customer,
        sale, line, payment, stock change, log or notification behind."""
        user = self.context["request"].user
        lines = validated_data.pop("sale_items")
        receipts = validated_data.pop("_receipts")
        total = validated_data.pop("_total")
        new_contact = validated_data.pop("_new_customer", None)
        past_due = validated_data.pop("_past_due")
        request_hash = validated_data.pop("request_hash", None)
        for key in ("paid_payment_mode", "split_payments", "new_customer", "past_due_payments"):
            validated_data.pop(key, None)
        paid = validated_data["paid_amount"]
        location = validated_data["location"]
        handover = validated_data.get("handover_staff")
        # The name as text too, as delivery completion has always written it.
        validated_data["delivery_staff"] = display_name(handover) if handover else ""

        # Lock order (see services): a new customer's phone number, the customer, their older
        # unpaid sales (past dues), then stock rows.
        if new_contact is not None:
            customer_id = create_customer(new_contact, user, via="sale").pk
        else:
            customer_id = validated_data["customer"].pk
        customer = lock_customer(customer_id)
        if not (customer.is_active and customer.user.is_active):
            raise ApiError("This customer is deactivated and cannot take new sales.", code="customer_inactive", field="customer")
        validated_data["customer"] = customer

        # Past dues are settled before this sale exists, so none of that money can reach it,
        # and each part is capped by what the customer owed before this sale.
        past_due_ids = []
        for mode, amount in past_due:
            payments = record_customer_payment(customer, amount, mode, user, note="Past pending collected during sale")
            past_due_ids.extend(payment.id for payment in payments)

        needed = {}
        for line in lines:
            going_out, coming_back = needed.get(line["cylinder_type"], (0, 0))
            needed[line["cylinder_type"]] = (going_out + line["quantity"], coming_back + line["empty_returned"])
        locked = lock_sale_stock(location, needed)

        stock_after = {}
        for cylinder_type, (going_out, coming_back) in needed.items():
            filled, empty = locked[cylinder_type.pk]
            if going_out:
                filled.quantity -= going_out
                filled.save(update_fields=["quantity", "updated_at"])
            if coming_back:
                empty.quantity += coming_back
                empty.save(update_fields=["quantity", "updated_at"])
            stock_after[str(cylinder_type.pk)] = {
                "filled": filled.quantity if filled else None,
                "empty": empty.quantity if empty else None,
            }

        sale = Sale.objects.create(sold_by=user, total_amount=total, balance_due=total - paid, **validated_data)
        for line in lines:
            SaleItem.objects.create(
                sale=sale, cylinder_type=line["cylinder_type"], quantity=line["quantity"], rate=line["effective_rate"],
                total_amount=line["final_amount"], empty_returned=line["empty_returned"],
                **{field: line[field] for field in SNAPSHOT_FIELDS},
            )
        note = "Sale payment (split)" if sale.payment_mode == Sale.PaymentMode.SPLIT else "Sale payment"
        for mode, amount in receipts:
            Payment.objects.create(customer=customer, sale=sale, amount=amount, payment_mode=mode, received_by=user, note=note)

        ActivityLog.objects.create(
            action="sale_created",
            description=f"Sale of Rs. {total} ({len(lines)} item(s))",
            user=user,
            metadata={
                "sale_id": sale.id,
                "customer_id": customer.pk,
                "location": location.code,
                "payment_mode": sale.payment_mode,
                "total": str(total),
                "paid": str(paid),
                "balance": str(sale.balance_due),
                "lines": [
                    {"cylinder_type": line["cylinder_type"].pk, "quantity": line["quantity"], "rate": str(line["rate"]),
                     "empty_returned": line["empty_returned"],
                     "rate_type": line["rate_type"],
                     "deposit_unit_amount": str(line["deposit_unit_amount"]),
                     "refill_unit_amount": str(line["refill_unit_amount"]),
                     "discount_amount": str(line["discount_amount"]),
                     "final_amount": str(line["final_amount"]),
                     "applied_discount_type": line["applied_discount_type"],
                     "applied_discount_value": str(line["applied_discount_value"])}
                    for line in lines
                ],
                "payments": [{"mode": mode, "amount": str(amount)} for mode, amount in receipts],
                "stock_after": stock_after,
                "new_customer": new_contact is not None,
                "handover_staff_id": handover.pk if handover else None,
                "past_due_payment_ids": past_due_ids,
                # SaleViewSet.create compares a retry against these to tell a retry from a reuse.
                "client_ref": str(sale.client_ref) if sale.client_ref else None,
                "request_hash": request_hash,
            },
        )

        if any(line["quantity"] > 0 for line in lines):
            notify(
                customer.user,
                None,
                "DIRECT_SALE_COMPLETED",
                "Direct Sale Completed",
                "A direct sale has been recorded on your account. Check your order history for the completed entry.",
                dedupe=False,
            )

        return sale


# Set by the server on payments.
PAYMENT_SERVER_FIELDS = frozenset({"received_by"})


class PaymentSerializer(serializers.ModelSerializer):
    customer_name = serializers.CharField(source="customer.user.username", read_only=True)
    amount = serializers.DecimalField(max_digits=10, decimal_places=2, min_value=Decimal("0.01"))
    payment_mode = serializers.ChoiceField(choices=RECEIPT_MODE_CHOICES)
    kind = serializers.SerializerMethodField()

    def get_kind(self, obj):
        return payment_kind(obj)

    class Meta:
        model = Payment
        fields = "__all__"
        read_only_fields = ["received_by"]
        extra_kwargs = {"empty_collected": {"required": False}}

    def validate(self, attrs):
        spoofed = sorted(PAYMENT_SERVER_FIELDS.intersection(self.initial_data))
        if spoofed:
            raise ApiError(
                f"These fields are set by the server and cannot be sent: {', '.join(spoofed)}.",
                code="read_only_fields",
                fields=spoofed,
            )
        return attrs

    def create(self, validated_data):
        # Locks the customer and the sales it settles; see services.record_customer_payment.
        payments = record_customer_payment(
            validated_data["customer"],
            validated_data["amount"],
            validated_data["payment_mode"],
            self.context["request"].user,
            sale=validated_data.get("sale"),
            note=validated_data.get("note", ""),
            empty_collected=validated_data.get("empty_collected", 0),
        )
        return payments[0]


class ExpenseSerializer(serializers.ModelSerializer):
    spent_by_name = serializers.CharField(source="spent_by.username", read_only=True)

    class Meta:
        model = Expense
        fields = "__all__"
        read_only_fields = ["spent_by"]

    def create(self, validated_data):
        expense = Expense.objects.create(spent_by=self.context["request"].user, **validated_data)
        ActivityLog.objects.create(
            action="expense_created",
            description=f"Expense recorded: Rs. {expense.amount}",
            user=expense.spent_by, metadata={"expense_id": expense.id},
        )
        return expense


class ActivityLogSerializer(serializers.ModelSerializer):
    user_name = serializers.CharField(source="user.username", read_only=True)

    class Meta:
        model = ActivityLog
        fields = "__all__"


class CustomerCylinderRateSerializer(serializers.ModelSerializer):
    cylinder_type_name = serializers.CharField(source="cylinder_type.name", read_only=True)

    class Meta:
        model = CustomerCylinderRate
        fields = "__all__"


class CustomerCylinderDiscountSerializer(serializers.ModelSerializer):
    cylinder_type_name = serializers.CharField(source="cylinder_type.name", read_only=True)

    class Meta:
        model = CustomerCylinderDiscount
        fields = "__all__"

    def validate(self, attrs):
        customer = attrs.get("customer") or getattr(self.instance, "customer", None)
        cylinder_type = attrs.get("cylinder_type") or getattr(self.instance, "cylinder_type", None)
        discount_type = attrs.get("discount_type") or getattr(self.instance, "discount_type", None)
        discount_value = attrs.get("discount_value", getattr(self.instance, "discount_value", Decimal("0")))

        if discount_value < 0:
            raise serializers.ValidationError({"discount_value": "Discount value cannot be negative."})
        if discount_type == CustomerProfile.DiscountType.PERCENTAGE and discount_value > 100:
            raise serializers.ValidationError({"discount_value": "Percentage discount cannot exceed 100%."})
        if (
            customer
            and cylinder_type
            and discount_type == CustomerProfile.DiscountType.FIXED
            and discount_value > customer.get_rate_for_cylinder(cylinder_type)
        ):
            raise serializers.ValidationError({"discount_value": "Fixed discount cannot exceed the refill charge."})
        return attrs


class CustomerProfileSerializer(serializers.ModelSerializer):
    username = serializers.CharField(source="user.username", read_only=True)
    full_name = serializers.SerializerMethodField()
    name = serializers.SerializerMethodField()
    phone = serializers.CharField(source="user.phone", read_only=True)
    email = serializers.EmailField(source="user.email", read_only=True)
    address = serializers.CharField(source="user.address", read_only=True)
    pending_amount = serializers.SerializerMethodField()
    pending_balance = serializers.SerializerMethodField()
    last_delivery_date = serializers.SerializerMethodField()
    empties_owed = serializers.SerializerMethodField()
    custom_rates = CustomerCylinderRateSerializer(many=True, read_only=True)
    cylinder_discounts = CustomerCylinderDiscountSerializer(many=True, read_only=True)
    user_id = serializers.IntegerField(source="user.id", read_only=True)
    sales_count = serializers.SerializerMethodField()
    empty_credits = serializers.SerializerMethodField()
    credit_balance = serializers.SerializerMethodField()

    class Meta:
        model = CustomerProfile
        fields = "__all__"
        # The linked account is set when the customer is created and never re-pointed.
        read_only_fields = ["user"]

    def validate(self, attrs):
        discount_type = attrs.get("global_discount_type", getattr(self.instance, "global_discount_type", None))
        discount_value = attrs.get("global_discount_value", getattr(self.instance, "global_discount_value", Decimal("0")))
        discount_active = attrs.get("global_discount_is_active", getattr(self.instance, "global_discount_is_active", False))

        if discount_value < 0:
            raise serializers.ValidationError({"global_discount_value": "Discount value cannot be negative."})
        if discount_active and not discount_type:
            raise serializers.ValidationError({"global_discount_type": "Select a discount type before enabling the discount."})
        if discount_type == CustomerProfile.DiscountType.PERCENTAGE and discount_value > 100:
            raise serializers.ValidationError({"global_discount_value": "Percentage discount cannot exceed 100%."})
        return attrs

    def get_full_name(self, obj):
        return obj.user.get_full_name() or obj.user.username

    def get_name(self, obj):
        return obj.user.get_full_name() or obj.user.username

    def get_pending_amount(self, obj):
        return str(customer_outstanding(obj))

    def get_credit_balance(self, obj):
        """Credit the customer holds (a negative pending amount); it offsets later dues."""
        return str(max(Decimal("0.00"), -customer_outstanding(obj)))

    def get_pending_balance(self, obj):
        return self.get_pending_amount(obj)

    def _calculate_cylinder_balances(self, obj):
        balances = {}
        custom_rates = {cr.cylinder_type_id: cr.custom_price for cr in obj.custom_rates.all()}
        
        # Voided sales never happened as far as empty cylinders go.
        for sale in not_voided(obj.sales.all()).prefetch_related('items__cylinder_type').order_by('created_at'):
            for item in sale.items.all():
                tid = item.cylinder_type_id
                tname = item.cylinder_type.name
                if tid not in balances:
                    balances[tid] = {"owed": 0, "credits": 0, "name": tname}
                
                # Step 1: Process returned empties
                returned_qty = item.empty_returned
                balances[tid]["owed"] -= returned_qty
                if balances[tid]["owed"] < 0:
                    balances[tid]["credits"] += abs(balances[tid]["owed"])
                    balances[tid]["owed"] = 0
                
                # Step 2: Process taken cylinders
                taken_qty = item.quantity
                balances[tid]["owed"] += taken_qty
                
                # Step 3: Consume credits if they got the discounted refill rate
                refill_rate = custom_rates.get(tid, item.cylinder_type.refill_rate)
                threshold = (item.cylinder_type.selling_price + refill_rate) / 2
                
                if (item.rate_type == "refill" or (item.rate_type is None and item.rate <= threshold)) and taken_qty > 0:
                    credits_needed = max(0, taken_qty - returned_qty)
                    balances[tid]["credits"] -= credits_needed
                    if balances[tid]["credits"] < 0:
                        balances[tid]["credits"] = 0
                        
        return balances

    def get_empties_owed(self, obj):
        balances = self._calculate_cylinder_balances(obj)
        final_owed = {}
        for tid, data in balances.items():
            if data["owed"] > 0:
                final_owed[tid] = {"owed": data["owed"], "name": data["name"]}
        return final_owed

    def get_sales_count(self, obj):
        return obj.sales.count()

    def get_empty_credits(self, obj):
        balances = self._calculate_cylinder_balances(obj)
        final_credits = {}
        for tid, data in balances.items():
            if data["credits"] > 0:
                final_credits[tid] = {"credit": data["credits"], "name": data["name"]}
        return final_credits

    def get_last_delivery_date(self, obj):
        booking = obj.bookings.filter(status=Booking.Status.DELIVERED).order_by("-delivered_at").first()
        return booking.delivered_at if booking else None


class StaffProfileSerializer(serializers.ModelSerializer):
    first_name = serializers.CharField(source="user.first_name", read_only=True)
    last_name = serializers.CharField(source="user.last_name", read_only=True)
    phone = serializers.CharField(source="user.phone", read_only=True)
    email = serializers.EmailField(source="user.email", read_only=True)
    address = serializers.CharField(source="user.address", read_only=True)
    username = serializers.CharField(source="user.username", read_only=True)
    role = serializers.CharField(source="user.role", read_only=True)
    is_active = serializers.BooleanField(source="user.is_active", read_only=True)
    vehicle_location_name = serializers.CharField(source="vehicle_location.name", read_only=True)
    user_id = serializers.IntegerField(source="user.id", read_only=True)
    # is_active above is the user's flag; this also needs an active profile and the staff role,
    # exactly as the server requires of a sale's handover_staff.
    can_hand_over = serializers.SerializerMethodField()

    class Meta:
        model = StaffProfile
        fields = "__all__"

    def get_full_name(self, obj):
        return obj.user.get_full_name() or obj.user.username

    def get_can_hand_over(self, obj):
        return is_active_staff(obj.user)


class NotificationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Notification
        fields = "__all__"
        read_only_fields = ["recipient"]


class BookingSerializer(serializers.ModelSerializer):
    rate_type = serializers.ChoiceField(choices=["new", "refill"], default="refill")

    def validate(self, attrs):
        forbidden = {"deposit", "refill_charge", "rate", "deposit_unit_amount", "refill_unit_amount", "original_amount", "discount_amount", "final_amount", "total_amount", "applied_discount_type", "applied_discount_value"}.intersection(self.initial_data)
        if forbidden:
            raise ApiError("Pricing is set by the server.", code="read_only_fields", fields=sorted(forbidden))
        if attrs.get("quantity", 1) < 1:
            raise serializers.ValidationError({"quantity": "Quantity must be greater than zero."})
        if not attrs["cylinder_type"].is_active:
            raise serializers.ValidationError({"cylinder_type": "Cylinder type is inactive."})
        return attrs

    customer_name = serializers.SerializerMethodField()
    customer_phone = serializers.SerializerMethodField()
    customer_address = serializers.SerializerMethodField()
    customer_area = serializers.SerializerMethodField()
    cylinder_type_name = serializers.CharField(source="cylinder_type.name", read_only=True)
    cylinder_type_weight = serializers.DecimalField(source="cylinder_type.weight", max_digits=5, decimal_places=2, read_only=True)
    assigned_staff_name = serializers.SerializerMethodField()
    assigned_staff_phone = serializers.SerializerMethodField()
    rate = serializers.SerializerMethodField()
    original_amount = serializers.SerializerMethodField()
    discount_amount = serializers.SerializerMethodField()
    total_amount = serializers.SerializerMethodField()
    final_amount = serializers.SerializerMethodField()
    has_discount = serializers.SerializerMethodField()
    applied_discount_type = serializers.SerializerMethodField()
    applied_discount_value = serializers.SerializerMethodField()
    order_id = serializers.CharField(read_only=True)
    rejected_by_name = serializers.SerializerMethodField()
    rejected_by_role = serializers.SerializerMethodField()
    delivery_status = serializers.SerializerMethodField()
    delivery_staff_name = serializers.SerializerMethodField()
    delivery_rejection_reason = serializers.SerializerMethodField()
    needs_reassignment = serializers.SerializerMethodField()

    class Meta:
        model = Booking
        fields = "__all__"
        # Workflow fields are set by the approve/reject/delivery actions, never by the create payload.
        read_only_fields = [
            "customer", "status", "payment_status", "assigned_staff", "rejection_reason",
            "approved_by", "approved_at", "delivered_at", "sale", "rejected_by", "rejected_at", "deposit_unit_amount", "refill_unit_amount",
        ]

    def _get_delivery(self, obj):
        try:
            return obj.delivery
        except Delivery.DoesNotExist:
            return None

    def _requester_is_staff_or_admin(self):
        request = self.context.get("request")
        user = getattr(request, "user", None)
        if user is None or not getattr(user, "is_authenticated", False):
            return False
        role = getattr(getattr(user, "role", None), "code", "")
        return role in ("admin", "staff") or bool(getattr(user, "is_superuser", False))

    def get_delivery_status(self, obj):
        delivery = self._get_delivery(obj)
        return delivery.status if delivery else None

    def get_delivery_staff_name(self, obj):
        delivery = self._get_delivery(obj)
        return display_name(delivery.staff) if delivery else None

    def get_delivery_rejection_reason(self, obj):
        delivery = self._get_delivery(obj)
        if not delivery or not self._requester_is_staff_or_admin():
            return None
        return delivery.rejection_reason or None

    def get_needs_reassignment(self, obj):
        delivery = self._get_delivery(obj)
        return bool(
            obj.status == Booking.Status.PENDING
            and delivery is not None
            and delivery.status == Delivery.Status.REJECTED
        )

    def get_rejected_by_name(self, obj):
        rejected_by = getattr(obj, "rejected_by", None)
        if not rejected_by:
            return None
        return rejected_by.get_full_name() or rejected_by.username

    def get_rejected_by_role(self, obj):
        return getattr(obj, "rejected_by_role", None)

    def _get_pricing(self, obj):
        return get_booking_pricing_snapshot(obj)

    def get_original_amount(self, obj):
        return serialize_decimal(self._get_pricing(obj)["original_amount"])

    def get_discount_amount(self, obj):
        return serialize_decimal(self._get_pricing(obj)["discount_amount"])

    def get_total_amount(self, obj):
        return serialize_decimal(self._get_pricing(obj)["final_amount"])

    def get_final_amount(self, obj):
        return serialize_decimal(self._get_pricing(obj)["final_amount"])

    def get_has_discount(self, obj):
        return self._get_pricing(obj)["has_discount"]

    def get_applied_discount_type(self, obj):
        return self._get_pricing(obj)["applied_discount_type"]

    def get_applied_discount_value(self, obj):
        return serialize_decimal(self._get_pricing(obj)["applied_discount_value"])

    def get_customer_name(self, obj):
        return obj.customer.user.get_full_name() or obj.customer.user.username

    def get_customer_phone(self, obj):
        return obj.customer.user.phone

    def get_customer_address(self, obj):
        return obj.customer.user.address

    def get_customer_area(self, obj):
        return obj.customer.area

    def get_assigned_staff_name(self, obj):
        if obj.assigned_staff:
            return obj.assigned_staff.get_full_name() or obj.assigned_staff.username
        return None

    def get_assigned_staff_phone(self, obj):
        if obj.assigned_staff:
            return obj.assigned_staff.phone
        return None

    def get_rate(self, obj):
        return serialize_decimal(self._get_pricing(obj)["rate"])

    def create(self, validated_data):
        user = self.context["request"].user
        profile = getattr(user, "customer_profile", None)
        if not profile:
            raise serializers.ValidationError({"detail": "Customer profile is required to place an order."})
        if profile.is_active is False or not user.is_active:
            raise ApiError("This account is inactive.", code="inactive", status=403)
        if not validated_data.get("delivery_address"):
            validated_data["delivery_address"] = user.address
        if not validated_data.get("delivery_phone"):
            validated_data["delivery_phone"] = user.phone

        cylinder_type = validated_data["cylinder_type"]
        quantity = validated_data["quantity"]
        pricing = get_customer_pricing_snapshot(profile, cylinder_type, quantity, validated_data["rate_type"])

        booking = Booking.objects.create(
            customer=profile,
            deposit_unit_amount=pricing["deposit_unit_amount"],
            refill_unit_amount=pricing["refill_unit_amount"],
            original_amount=pricing["original_amount"],
            discount_amount=pricing["discount_amount"],
            final_amount=pricing["final_amount"],
            applied_discount_type=pricing["applied_discount_type"],
            applied_discount_value=pricing["applied_discount_value"],
            **validated_data,
        )

        admin_role_users = User.objects.filter(role__code="admin")
        customer_name = display_name(profile.user)

        notify(
            profile.user,
            booking,
            "ORDER_PLACED",
            "Order Placed",
            f"Your GasBook order #{booking.order_id} has been placed successfully.",
            dedupe=True,
        )

        for admin in admin_role_users:
            discount_line = ""
            if pricing["has_discount"]:
                discount_line = f"\nDiscount: -₹{pricing['discount_amount']:,.2f}"
            notify(
                admin,
                booking,
                "ORDER_PLACED",
                "New GasBook Order Received",
                f"Order #{booking.order_id} - {customer_name}\nProduct: {booking.quantity}x {booking.cylinder_type.name}\nOriginal: ₹{pricing['original_amount']:,.2f}{discount_line}\nFinal: ₹{pricing['final_amount']:,.2f}\nPayment: 💵 COD\nAddress: {booking.delivery_address}",
                dedupe=True,
            )
        return booking


class StaffDirectSaleHistorySerializer(serializers.ModelSerializer):
    """Minimal read-only sale details for an already staff-scoped history query."""

    customer_name = serializers.SerializerMethodField()
    items = SaleItemSerializer(many=True, read_only=True)
    status = serializers.SerializerMethodField()
    cancelled_at = serializers.SerializerMethodField()

    class Meta:
        model = Sale
        fields = ["id", "customer_name", "items", "total_amount", "created_at", "status", "cancelled_at"]
        read_only_fields = fields

    def get_customer_name(self, obj):
        return display_name(obj.customer.user) if obj.customer_id else "Walk-in customer"

    def get_status(self, obj):
        return "cancelled" if sale_void(obj) else "completed"

    def get_cancelled_at(self, obj):
        void = sale_void(obj)
        return serializers.DateTimeField().to_representation(void.created_at) if void else None


class DeliverySerializer(serializers.ModelSerializer):
    rate_type = serializers.CharField(source="booking.rate_type", read_only=True, allow_null=True)
    deposit_unit_amount = serializers.DecimalField(source="booking.deposit_unit_amount", max_digits=10, decimal_places=2, read_only=True, allow_null=True)
    refill_unit_amount = serializers.DecimalField(source="booking.refill_unit_amount", max_digits=10, decimal_places=2, read_only=True, allow_null=True)
    booked_at = serializers.DateTimeField(source="booking.created_at", read_only=True)
    cancelled_at = serializers.SerializerMethodField()
    customer_name = serializers.SerializerMethodField()
    customer_phone = serializers.CharField(source="booking.customer.user.phone", read_only=True)
    customer_address = serializers.CharField(source="booking.customer.user.address", read_only=True)
    customer_area = serializers.CharField(source="booking.customer.area", read_only=True)
    cylinder_type_name = serializers.CharField(source="booking.cylinder_type.name", read_only=True)
    quantity = serializers.IntegerField(source="booking.quantity", read_only=True)
    booking_status = serializers.CharField(source="booking.status", read_only=True)
    order_id = serializers.CharField(source="booking.order_id", read_only=True)
    booking_payment_method = serializers.CharField(source="booking.payment_method", read_only=True)
    booking_payment_status = serializers.CharField(source="booking.payment_status", read_only=True)
    staff_name = serializers.SerializerMethodField()
    rate = serializers.SerializerMethodField()
    original_amount = serializers.SerializerMethodField()
    discount_amount = serializers.SerializerMethodField()
    final_amount = serializers.SerializerMethodField()
    has_discount = serializers.SerializerMethodField()
    pending_amount = serializers.SerializerMethodField()
    deposit_cylinders = serializers.IntegerField(source="booking.customer.deposit_cylinders", read_only=True)

    class Meta:
        model = Delivery
        fields = "__all__"
        read_only_fields = ["started_at", "completed_at"]

    def _get_pricing(self, obj):
        return get_booking_pricing_snapshot(obj.booking)

    def get_cancelled_at(self, obj):
        # Admin rejection cancels the delivery; its event is recorded on Booking.
        if obj.status == Delivery.Status.CANCELLED and obj.booking.rejected_at:
            return serializers.DateTimeField().to_representation(obj.booking.rejected_at)
        return None

    def get_customer_name(self, obj):
        user = obj.booking.customer.user
        return user.get_full_name() or user.username

    def get_staff_name(self, obj):
        return obj.staff.get_full_name() or obj.staff.username

    def get_rate(self, obj):
        return serialize_decimal(self._get_pricing(obj)["rate"])

    def get_original_amount(self, obj):
        return serialize_decimal(self._get_pricing(obj)["original_amount"])

    def get_discount_amount(self, obj):
        return serialize_decimal(self._get_pricing(obj)["discount_amount"])

    def get_final_amount(self, obj):
        return serialize_decimal(self._get_pricing(obj)["final_amount"])

    def get_has_discount(self, obj):
        return self._get_pricing(obj)["has_discount"]

    def get_pending_amount(self, obj):
        return str(customer_outstanding(obj.booking.customer))


class StaffDeliveryHistorySerializer(serializers.ModelSerializer):
    rate_type = serializers.CharField(source="booking.rate_type", read_only=True, allow_null=True)
    deposit_unit_amount = serializers.DecimalField(source="booking.deposit_unit_amount", max_digits=10, decimal_places=2, read_only=True, allow_null=True)
    refill_unit_amount = serializers.DecimalField(source="booking.refill_unit_amount", max_digits=10, decimal_places=2, read_only=True, allow_null=True)

    """Read-only row of the admin staff delivery history: one Delivery and its Booking."""

    order_id = serializers.CharField(source="booking.order_id", read_only=True)
    booking_status = serializers.CharField(source="booking.status", read_only=True)
    booked_at = serializers.DateTimeField(source="booking.created_at", read_only=True)
    cancelled_at = serializers.SerializerMethodField()
    customer_name = serializers.SerializerMethodField()
    customer_phone = serializers.CharField(source="booking.customer.user.phone", read_only=True)
    customer_area = serializers.CharField(source="booking.customer.area", read_only=True)
    cylinder_type_name = serializers.CharField(source="booking.cylinder_type.name", read_only=True)
    quantity = serializers.IntegerField(source="booking.quantity", read_only=True)
    booking_payment_method = serializers.CharField(source="booking.payment_method", read_only=True)
    booking_payment_status = serializers.CharField(source="booking.payment_status", read_only=True)
    booking_rejection_reason = serializers.CharField(source="booking.rejection_reason", read_only=True)
    original_amount = serializers.SerializerMethodField()
    discount_amount = serializers.SerializerMethodField()
    final_amount = serializers.SerializerMethodField()
    balance_due = serializers.SerializerMethodField()

    class Meta:
        model = Delivery
        fields = [
            "id", "booking", "order_id", "status", "booking_status", "booked_at",
            "started_at", "completed_at", "cancelled_at",
            "customer_name", "customer_phone", "customer_area",
            "cylinder_type_name", "quantity", *SNAPSHOT_FIELDS,
            "original_amount", "discount_amount", "final_amount",
            "booking_payment_method", "booking_payment_status",
            "payment_method", "payment_collected", "balance_due", "empty_collected",
            "rejection_reason", "booking_rejection_reason", "note",
        ]
        read_only_fields = fields

    def _get_pricing(self, obj):
        return get_booking_pricing_snapshot(obj.booking)

    def get_cancelled_at(self, obj):
        if obj.status == Delivery.Status.CANCELLED and obj.booking.rejected_at:
            return serializers.DateTimeField().to_representation(obj.booking.rejected_at)
        return None

    def get_customer_name(self, obj):
        return display_name(obj.booking.customer.user)

    def get_original_amount(self, obj):
        return serialize_decimal(self._get_pricing(obj)["original_amount"])

    def get_discount_amount(self, obj):
        return serialize_decimal(self._get_pricing(obj)["discount_amount"])

    def get_final_amount(self, obj):
        return serialize_decimal(self._get_pricing(obj)["final_amount"])

    def get_balance_due(self, obj):
        sale = obj.booking.sale
        return serialize_decimal(sale.balance_due) if sale else None


class StaffHandoverBookingSerializer(serializers.ModelSerializer):
    """Booking-level part of a handed-over row in a staff history (same keys as
    ``StaffDeliveryHistorySerializer``). Deliberately a whitelist: the Delivery now belongs
    to another staff member, so its timestamps, collection, empties and the resulting
    payment status are theirs and must not appear here."""

    booking = serializers.IntegerField(source="pk", read_only=True)
    order_id = serializers.CharField(read_only=True)
    booking_status = serializers.CharField(source="status", read_only=True)
    booked_at = serializers.DateTimeField(source="created_at", read_only=True)
    customer_name = serializers.SerializerMethodField()
    customer_phone = serializers.CharField(source="customer.user.phone", read_only=True)
    customer_area = serializers.CharField(source="customer.area", read_only=True)
    cylinder_type_name = serializers.CharField(source="cylinder_type.name", read_only=True)
    booking_payment_method = serializers.CharField(source="payment_method", read_only=True)
    original_amount = serializers.SerializerMethodField()
    discount_amount = serializers.SerializerMethodField()
    final_amount = serializers.SerializerMethodField()

    class Meta:
        model = Booking
        fields = [
            "booking", "order_id", "booking_status", "booked_at",
            "customer_name", "customer_phone", "customer_area",
            "cylinder_type_name", "quantity", *SNAPSHOT_FIELDS,
            "original_amount", "discount_amount", "final_amount", "booking_payment_method",
        ]
        read_only_fields = fields

    def get_customer_name(self, obj):
        return display_name(obj.customer.user)

    def get_original_amount(self, obj):
        return serialize_decimal(get_booking_pricing_snapshot(obj)["original_amount"])

    def get_discount_amount(self, obj):
        return serialize_decimal(get_booking_pricing_snapshot(obj)["discount_amount"])

    def get_final_amount(self, obj):
        return serialize_decimal(get_booking_pricing_snapshot(obj)["final_amount"])
