"""Small public operational endpoints; never return configuration or exception text."""
from functools import lru_cache
from io import BytesIO
from pathlib import Path

from django.conf import settings
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


@require_safe
def media_image(request, path):
    """Serve validated raster images only, including uploads predating validation."""
    if settings.DEMO_DISABLE_UPLOADS:
        raise Http404
    root = Path(settings.MEDIA_ROOT).resolve()
    target = (root / path).resolve()
    if not target.is_relative_to(root) or path.split("/", 1)[0] not in {
        "product-images", "staff-images", "cylinder-images"
    }:
        raise Http404
    try:
        with target.open("rb") as handle:
            data = handle.read(MAX_IMAGE_BYTES + 1)
        image_format = inspect_image(data).format
        response = FileResponse(BytesIO(data), content_type={"JPEG": "image/jpeg", "PNG": "image/png", "WEBP": "image/webp"}[image_format])
    except (OSError, ValueError):
        raise Http404 from None
    response["X-Content-Type-Options"] = "nosniff"
    response["Content-Security-Policy"] = "default-src 'none'; sandbox"
    response["Cache-Control"] = "public, max-age=3600"
    return response
