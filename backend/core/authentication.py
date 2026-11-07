from rest_framework.exceptions import PermissionDenied
from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework_simplejwt.serializers import TokenRefreshSerializer
from rest_framework.throttling import SimpleRateThrottle
from django.conf import settings
import hashlib
from collections.abc import Mapping


class PasswordAwareTokenRefreshSerializer(TokenRefreshSerializer):
    def validate(self, attrs):
        # SimpleJWT checks the password fingerprint on access authentication, but
        # its refresh serializer also needs this check before minting new tokens.
        token = self.token_class(attrs["refresh"])
        JWTAuthentication().get_user(token)
        return super().validate(attrs)


class LoginAccountThrottle(SimpleRateThrottle):
    scope = "login_account"

    def allow_request(self, request, view):
        return not settings.PRODUCTION or super().allow_request(request, view)

    def get_cache_key(self, request, view):
        data = request.data if isinstance(request.data, Mapping) else {}
        name = str(data.get("username", "")).strip().casefold()
        digest = hashlib.sha256(name.encode()).hexdigest()
        return self.cache_format % {"scope": self.scope, "ident": digest}


class LoginIPThrottle(LoginAccountThrottle):
    scope = "login_ip"

    def get_cache_key(self, request, view):
        return self.cache_format % {"scope": self.scope, "ident": self.get_ident(request)}

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
