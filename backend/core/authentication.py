from rest_framework.exceptions import PermissionDenied
from rest_framework_simplejwt.authentication import JWTAuthentication

# (url name, allowed HTTP method) pairs a user may call while a password change is pending.
PASSWORD_CHANGE_EXEMPT = {
    ("auth-me", "GET"),
    ("auth-change-password", "POST"),
}


def is_password_change_exempt(request):
    match = getattr(getattr(request, "_request", request), "resolver_match", None)
    url_name = getattr(match, "url_name", None)
    method = (request.method or "").upper()
    if method == "OPTIONS":
        return True
    return (url_name, method) in PASSWORD_CHANGE_EXEMPT


class GasBookJWTAuthentication(JWTAuthentication):
    """JWT authentication that enforces the forced password change.

    Users flagged ``must_change_password`` get 403 ``password_change_required`` on
    every endpoint except ``GET /api/auth/me/`` and ``POST /api/auth/change-password/``.
    """

    def authenticate(self, request):
        result = super().authenticate(request)
        if result is None:
            return None
        user, _token = result
        if getattr(user, "must_change_password", False) and not is_password_change_exempt(request):
            raise PermissionDenied(
                {"detail": "You must change your password before continuing.", "code": "password_change_required"}
            )
        return result
