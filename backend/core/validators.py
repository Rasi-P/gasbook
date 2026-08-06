import re

PHONE_PATTERN = re.compile(r"^[0-9]{10}$")
DIGITS_ONLY_PATTERN = re.compile(r"^[0-9]+$")

PHONE_REQUIRED_MESSAGE = "Phone number is required."
PHONE_DIGITS_MESSAGE = "Phone number must contain only digits."
PHONE_LENGTH_MESSAGE = "Phone number must be exactly 10 digits."

CUSTOMER_REQUIRED_MESSAGE = (
    "Please select a registered customer before creating a sale."
)
CUSTOMER_NOT_FOUND_MESSAGE = (
    "Customer not found. Please register the customer before creating a sale."
)


def check_phone_number(phone, required=True):
    """Validate a customer phone number.

    Returns the cleaned phone on success, or raises ValueError with a
    user-facing message. Digits only (0-9), exactly 10 of them.
    """
    value = (phone or "").strip()
    if not value:
        if required:
            raise ValueError(PHONE_REQUIRED_MESSAGE)
        return value
    if not DIGITS_ONLY_PATTERN.match(value):
        raise ValueError(PHONE_DIGITS_MESSAGE)
    if not PHONE_PATTERN.match(value):
        raise ValueError(PHONE_LENGTH_MESSAGE)
    return value
