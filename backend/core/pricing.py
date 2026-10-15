"""Trusted pricing for new transactions; never reprice historical records.

Component snapshots are before discount. Fixed discounts apply once to the merged
cylinder/type line, not once per unit. Final totals retain exact cent rounding.
"""
from decimal import Decimal
from .exceptions import ApiError
from .models import quantize_money

SNAPSHOT_FIELDS = ("rate_type", "deposit_unit_amount", "refill_unit_amount")


def calculate_pricing(customer, cylinder, quantity, rate_type="refill", *, component_rates=None):
    if rate_type not in ("new", "refill"):
        raise ApiError("Choose New Cylinder or Refill.", code="invalid", field="rate_type")
    from .services import MAX_COUNT, MAX_MONEY
    quantity = int(quantity)
    if quantity < 0 or quantity > MAX_COUNT:
        raise ApiError("Quantity is out of range.", code="invalid", field="quantity")
    deposit = quantize_money(cylinder.deposit_amount if rate_type == "new" and quantity else 0)
    refill = quantize_money((customer.get_rate_for_cylinder(cylinder) if customer else cylinder.refill_rate) if quantity else 0)
    # Only the admin direct-sale serializers supply validated per-sale components.
    # Bookings and catalog prices continue to use configured/agreed rates.
    if component_rates is not None:
        deposit = quantize_money(component_rates.get("deposit", deposit)) if rate_type == "new" and quantity else Decimal("0.00")
        refill = quantize_money(component_rates.get("refill_charge", refill)) if quantity else Decimal("0.00")
    if deposit < 0 or refill < 0:
        raise ApiError("Configured rates must not be negative.", code="invalid_rate", field="cylinder_type")
    refill_total = quantize_money(refill * quantity)
    if customer:
        pricing = customer.calculate_discount_for_amount(refill_total, cylinder_type=cylinder)
    else:
        pricing = dict(discount_amount=Decimal("0.00"), has_discount=False,
                       discount_scope=None, applied_discount_type=None, applied_discount_value=Decimal("0.00"))
    # The discount cannot consume any of the deposit (including rules above 100%).
    discount = min(refill_total, pricing["discount_amount"])
    original = quantize_money((deposit + refill) * quantity)
    if original > MAX_MONEY:
        raise ApiError("The transaction total is too large.", code="amount_too_large", field="quantity")
    final = original - discount
    pricing.update(rate_type=rate_type, deposit_unit_amount=deposit, refill_unit_amount=refill,
                   rate=deposit + refill, quantity=quantity, original_amount=original,
                   discount_amount=discount, final_amount=final,
                   effective_rate=quantize_money(final / quantity) if quantity else Decimal("0.00"))
    return pricing


def snapshot(record):
    return {field: getattr(record, field) for field in SNAPSHOT_FIELDS}
