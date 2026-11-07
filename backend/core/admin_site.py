"""Protected AdminSite for the explicitly opted-in, single-worker demo."""
from collections import deque
import hashlib
import logging
import math
from threading import Lock
import time

from django.conf import settings
from django.contrib.admin import AdminSite
from django.contrib.admin.forms import AdminAuthenticationForm
from django.contrib.auth import get_user_model
from django.contrib.auth.decorators import login_not_required
from django.contrib.auth.forms import UsernameField
from django.core.exceptions import ValidationError
from django.http import HttpResponse
from django.utils.decorators import method_decorator
from django.views.decorators.cache import never_cache
from django.views.decorators.csrf import csrf_protect
from django.views.decorators.debug import sensitive_post_parameters


logger = logging.getLogger(__name__)


class AdminLoginLimiter:
    """Atomic sliding windows across threads in one worker; never lock a user row.

    All attempts consume the budget, including successes. Account budgets are
    paired with the socket peer so another peer cannot lock out a named account.
    The global budget bounds password work and memory even with changing names/IPs.
    Forwarded headers are deliberately ignored. Counters reset on process restart;
    multiple workers/instances require a shared atomic store before enabling admin.
    """
    window = 60

    def __init__(self, clock=None):
        self.clock = clock or time.monotonic
        self.lock = Lock()
        self.buckets = {}

    def retry_after(self, request):
        peer = str(request.META.get("REMOTE_ADDR", "unknown"))
        user_model = get_user_model()
        # Reuse the login form's stripping/NFKC behavior, including its length
        # bound on normalization work. Case-folding keeps the existing budget.
        field = UsernameField(max_length=user_model._meta.get_field(user_model.USERNAME_FIELD).max_length)
        username = field.to_python(str(request.POST.get("username", ""))).casefold()
        pair = hashlib.sha256((peer + "\0" + username).encode()).hexdigest()
        keys = [("global", 60), ("peer:" + peer, 30), ("account-peer:" + pair, 10)]
        with self.lock:
            now = self.clock()
            for key in list(self.buckets):
                bucket = self.buckets[key]
                while bucket and bucket[0] <= now - self.window:
                    bucket.popleft()
                if not bucket:
                    del self.buckets[key]
            waits = [
                self.window - (now - self.buckets[key][0])
                for key, limit in keys if len(self.buckets.get(key, ())) >= limit
            ]
            if waits:
                return max(1, math.ceil(max(waits)))
            for key, _limit in keys:
                self.buckets.setdefault(key, deque()).append(now)
        return 0


login_limiter = AdminLoginLimiter()


class GasBookAdminAuthenticationForm(AdminAuthenticationForm):
    def confirm_login_allowed(self, user):
        super().confirm_login_allowed(user)
        if user.must_change_password:
            raise ValidationError(
                "Change your temporary password in the GasBook management app "
                "before signing in to Django Admin.",
                code="password_change_required",
            )


class GasBookAdminSite(AdminSite):
    login_form = GasBookAdminAuthenticationForm

    def has_permission(self, request):
        # Also protect direct model URLs and sessions created before a reset flag.
        return super().has_permission(request) and not getattr(request.user, "must_change_password", False)

    @method_decorator(never_cache)
    @method_decorator(sensitive_post_parameters("username", "password"))
    @method_decorator(csrf_protect)
    @login_not_required
    def login(self, request, extra_context=None):
        if settings.PRODUCTION and request.method == "POST":
            wait = login_limiter.retry_after(request)
            if wait:
                logger.warning("Django Admin login throttled")
                response = HttpResponse("Too many login attempts. Please try again shortly.", status=429)
                response["Retry-After"] = str(wait)
                return response
        response = super().login(request, extra_context=extra_context)
        if settings.PRODUCTION and request.method == "POST" and response.status_code == 200:
            logger.warning("Django Admin login rejected")
        return response
