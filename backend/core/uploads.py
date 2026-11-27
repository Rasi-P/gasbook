"""Bound image bytes and select an allowed decoder before parsing untrusted data."""
from io import BytesIO
import warnings

from django import forms
from django.conf import settings
from django.core.exceptions import ValidationError as DjangoValidationError
from PIL import Image
from rest_framework import serializers
from .demo_media import DEMO_IMAGE_MESSAGE

MAX_IMAGE_BYTES = 5 * 1024 * 1024
MAX_IMAGE_SIDE = 4096
ALLOWED_IMAGE_FORMATS = ("PNG", "JPEG", "WEBP")
IMAGE_ERROR = "Use a valid JPEG, PNG or WebP image up to 5 MB and 4096 pixels."


def _check_dimensions(size):
    if min(size) <= 0 or max(size) > MAX_IMAGE_SIDE:
        raise ValueError(IMAGE_ERROR)


def _check_webp_header(data):
    """WebP allocates its canvas during open(), so bound the header first."""
    kind = data[12:16]
    if kind == b"VP8X" and len(data) >= 30:
        size = (1 + int.from_bytes(data[24:27], "little"),
                1 + int.from_bytes(data[27:30], "little"))
    elif kind == b"VP8L" and len(data) >= 25 and data[20] == 0x2F:
        bits = int.from_bytes(data[21:25], "little")
        size = ((bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1)
    elif kind == b"VP8 " and len(data) >= 30 and data[23:26] == b"\x9d\x01\x2a":
        size = (int.from_bytes(data[26:28], "little") & 0x3FFF,
                int.from_bytes(data[28:30], "little") & 0x3FFF)
    else:
        raise ValueError(IMAGE_ERROR)
    _check_dimensions(size)


def inspect_image(data):
    """Return verified metadata; never let Pillow choose an unsupported parser.

    Only the first frame is decoded, after its dimensions have been bounded.
    This avoids traversing arbitrary animation frames during validation.
    """
    if not data or len(data) > MAX_IMAGE_BYTES:
        raise ValueError(IMAGE_ERROR)
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        image_format = "PNG"
    elif data.startswith(b"\xff\xd8\xff"):
        image_format = "JPEG"
    elif data.startswith(b"RIFF") and data[8:12] == b"WEBP":
        image_format = "WEBP"
        _check_webp_header(data)
    else:
        raise ValueError(IMAGE_ERROR)
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(data), formats=[image_format]) as picture:
                _check_dimensions(picture.size)
                picture.verify()
            # verify() checks structure; load() also rejects truncated/corrupt pixels.
            with Image.open(BytesIO(data), formats=[image_format]) as decoded:
                decoded.load()
        return picture
    except (OSError, ValueError, SyntaxError, EOFError, Image.DecompressionBombError,
            Image.DecompressionBombWarning):
        raise ValueError(IMAGE_ERROR) from None


class SafeImageFormField(forms.ImageField):
    def to_python(self, data):
        # FileField checks the upload metadata without invoking Pillow.
        upload = forms.FileField.to_python(self, data)
        if upload is None:
            return None
        if settings.DEMO_DISABLE_UPLOADS:
            raise DjangoValidationError(DEMO_IMAGE_MESSAGE, code="demo_uploads_disabled")
        try:
            if upload.size > MAX_IMAGE_BYTES:
                raise ValueError(IMAGE_ERROR)
            upload.seek(0)
            # Bound the read as well, even if the reported size is incorrect.
            picture = inspect_image(upload.read(MAX_IMAGE_BYTES + 1))
            upload.image = picture
            upload.content_type = Image.MIME[picture.format]
            return upload
        except (OSError, ValueError):
            raise DjangoValidationError(IMAGE_ERROR, code="invalid_image") from None
        finally:
            upload.seek(0)


class SafeImageField(serializers.ImageField):
    def to_representation(self, value):
        if settings.DEMO_DISABLE_UPLOADS:
            return None
        try:
            return super().to_representation(value)
        except (ValueError, OSError):
            return None

    def to_internal_value(self, data):
        data = serializers.FileField.to_internal_value(self, data)
        try:
            return SafeImageFormField().clean(data)
        except DjangoValidationError as exc:
            raise serializers.ValidationError(exc.messages) from None


def validated_image(value):
    """Use the same validation for manually handled staff uploads."""
    return SafeImageField().run_validation(value)
