from django.db import DataError, IntegrityError
from django.db.models import ProtectedError
from rest_framework.exceptions import APIException, ValidationError
from rest_framework.response import Response
from rest_framework.views import exception_handler as drf_handler, set_rollback


class ApiError(APIException):
    """4xx with JSON body {"detail", "code", ...extras}.

    ``detail`` is assigned directly (not wrapped in ErrorDetail) so ints/bools in the
    extras survive serialization unchanged.
    """

    def __init__(self, detail, code, status=400, **extra):
        self.status_code = status
        self.detail = {"detail": detail, "code": code, **extra}


def _first_message(value):
    """Return the first human-readable message found in a DRF error structure."""
    if isinstance(value, dict):
        for item in value.values():
            found = _first_message(item)
            if found:
                return found
        return None
    if isinstance(value, (list, tuple)):
        for item in value:
            found = _first_message(item)
            if found:
                return found
        return None
    if value is None:
        return None
    text = str(value)
    return text or None


def api_exception_handler(exc, context):
    response = drf_handler(exc, context)
    if response is not None:
        if isinstance(exc, ValidationError):
            data = response.data
            if isinstance(data, dict):
                if "detail" not in data:
                    message = _first_message(data)
                    if message:
                        data["detail"] = message
                elif isinstance(data["detail"], (list, tuple, dict)):
                    # ValidationError({"detail": "msg"}) renders detail as a list.
                    data["detail"] = _first_message(data["detail"]) or "Invalid input."
                data.setdefault("code", "invalid")
            elif isinstance(data, list):
                message = _first_message(data)
                response.data = {
                    "detail": message or "Invalid input.",
                    "code": "invalid",
                    "non_field_errors": data,
                }
        return response
    if isinstance(exc, ProtectedError):
        set_rollback()
        return Response(
            {"detail": "This record is referenced by other records and cannot be deleted.", "code": "protected"},
            status=409,
        )
    if isinstance(exc, IntegrityError):
        set_rollback()
        return Response({"detail": "This change conflicts with existing data.", "code": "conflict"}, status=409)
    if isinstance(exc, DataError):
        set_rollback()
        return Response(
            {"detail": "One of the submitted values is too long or invalid.", "code": "invalid_data"},
            status=400,
        )
    return None
