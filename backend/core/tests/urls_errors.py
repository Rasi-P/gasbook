"""Test-only urlconf: views that raise database errors / validation errors so the
custom exception handler can be exercised end to end."""
from django.db import DataError, IntegrityError
from django.db.models import ProtectedError
from django.urls import include, path
from rest_framework.decorators import api_view, permission_classes
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import AllowAny


@api_view(["GET"])
@permission_classes([AllowAny])
def raise_data_error(request):
    raise DataError("value too long for type character varying(250)")


@api_view(["GET"])
@permission_classes([AllowAny])
def raise_integrity_error(request):
    raise IntegrityError("duplicate key value violates unique constraint")


@api_view(["GET"])
@permission_classes([AllowAny])
def raise_protected_error(request):
    raise ProtectedError("protected", set())


@api_view(["GET"])
@permission_classes([AllowAny])
def raise_field_validation_error(request):
    raise ValidationError({"phone": ["Phone number must contain only digits."]})


@api_view(["GET"])
@permission_classes([AllowAny])
def raise_list_validation_error(request):
    raise ValidationError("Not enough filled stock.")


@api_view(["GET"])
@permission_classes([AllowAny])
def raise_detail_validation_error(request):
    raise ValidationError({"detail": "Customer profile is required to place an order."})


urlpatterns = [
    path("test-errors/detail-validation/", raise_detail_validation_error),
    path("test-errors/data/", raise_data_error),
    path("test-errors/integrity/", raise_integrity_error),
    path("test-errors/protected/", raise_protected_error),
    path("test-errors/field-validation/", raise_field_validation_error),
    path("test-errors/list-validation/", raise_list_validation_error),
    path("api/", include("core.urls")),
]
