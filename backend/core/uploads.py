"""Shared checks for uploaded pictures (same limits as accessory images)."""
from rest_framework import serializers

MAX_IMAGE_BYTES = 5 * 1024 * 1024
MAX_IMAGE_SIDE = 4096
ALLOWED_IMAGE_FORMATS = ("PNG", "JPEG", "WEBP")


def validate_image_upload(value):
    """Reject anything that is not a JPEG/PNG/WebP up to 5 MB and 4096 px a side."""
    if value is None:
        return value
    try:
        fmt = value.image.format
        side = max(value.image.size)
    except Exception:  # the ImageField already verified it opens; be defensive about the attribute
        raise serializers.ValidationError("Upload a valid JPEG, PNG or WebP image.")
    if value.size > MAX_IMAGE_BYTES or fmt not in ALLOWED_IMAGE_FORMATS or side > MAX_IMAGE_SIDE:
        raise serializers.ValidationError("Use a JPEG, PNG or WebP image up to 5 MB and 4096 pixels.")
    return value
