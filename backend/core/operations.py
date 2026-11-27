"""Small public operational endpoints; never return configuration or exception text."""
from functools import lru_cache
from io import BytesIO
from pathlib import Path

from django.conf import settings
from django.core.files.storage import default_storage, FileSystemStorage
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.authentication import SessionAuthentication
from rest_framework.permissions import AllowAny
from .authentication import GasBookJWTAuthentication
from .media_access import may_view_staff_image
from django.db import connection, DatabaseError
from django.db.migrations.loader import MigrationLoader
from django.db.migrations.recorder import MigrationRecorder
from django.http import FileResponse, Http404, JsonResponse
from django.views.decorators.http import require_safe
from .uploads import MAX_IMAGE_BYTES, inspect_image


@require_safe
def health(request):
    return JsonResponse({"status": "ok"})


@lru_cache(maxsize=1)
def required_migrations():
    return set(MigrationLoader(None).disk_migrations)


@require_safe
def readiness(request):
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            cursor.fetchone()
        applied = set(MigrationRecorder(connection).applied_migrations())
        if required_migrations() - applied:
            response = JsonResponse({"status": "not_ready", "reason": "migrations_pending"}, status=503)
        else:
            response = JsonResponse({"status": "ready"})
    except DatabaseError:
        response = JsonResponse({"status": "not_ready", "reason": "database_unavailable"}, status=503)
    response["Cache-Control"] = "no-store"
    return response


@api_view(["GET", "HEAD"])
@authentication_classes([GasBookJWTAuthentication, SessionAuthentication])
@permission_classes([AllowAny])
def media_image(request, path):
    """Serve bounded, validated media; staff bytes always require authentication."""
    if settings.DEMO_DISABLE_UPLOADS:
        raise Http404
    prefix = path.split("/", 1)[0]
    if prefix not in {"product-images", "staff-images", "cylinder-images"} or any(
            part in {"", ".", ".."} for part in path.split("/")) or "\\" in path:
        raise Http404
    private = prefix == "staff-images"
    if private:
        if not request.user.is_authenticated:
            raise Http404
        from .models import StaffProfile
        profile = StaffProfile.objects.filter(image=path).first()
        if not profile or not may_view_staff_image(request.user, profile):
            raise Http404
    if isinstance(default_storage, FileSystemStorage):
        root = Path(settings.MEDIA_ROOT).resolve()
        if not (root / path).resolve().is_relative_to(root):
            raise Http404
    try:
        with default_storage.open(path, "rb") as handle:
            data = handle.read(MAX_IMAGE_BYTES + 1)
        image_format = inspect_image(data).format
        response = FileResponse(BytesIO(data), content_type={"JPEG": "image/jpeg", "PNG": "image/png", "WEBP": "image/webp"}[image_format])
    except (OSError, ValueError):
        raise Http404 from None
    response["X-Content-Type-Options"] = "nosniff"
    response["Content-Security-Policy"] = "default-src 'none'; sandbox"
    response["Cache-Control"] = "private, no-store" if private else "public, max-age=300"
    if private:
        response["Vary"] = "Authorization, Cookie"
    return response
