from django.http import JsonResponse
from django.utils.deprecation import MiddlewareMixin
from .media_storage import MediaUnavailable


class MediaErrorMiddleware(MiddlewareMixin):
    def __call__(self, request):
        from .media_lifecycle import request_uploads, cleanup_unreferenced
        pending = []
        token = request_uploads.set(pending)
        try:
            return super().__call__(request)
        finally:
            request_uploads.reset(token)
            for storage, name in pending:
                cleanup_unreferenced(storage, name)

    def process_exception(self, request, exception):
        if isinstance(exception, MediaUnavailable):
            response = JsonResponse({"detail": str(exception), "code": "media_unavailable"}, status=503)
            response["Cache-Control"] = "no-store"
            return response
