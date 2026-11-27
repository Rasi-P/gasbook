"""Shared-database multi-tenancy.

Every business row carries a ``tenant`` (one gas agency). The tenant of the current API request
is held in a context variable, set from the authenticated user, and every query through a
tenant model's ``objects`` manager is filtered to it. Writes are pinned to it as well.

States of the context:
- unset: no API request (management commands, migrations, tests, login). Queries are not
  filtered; new rows without a tenant go to the default tenant.
- a tenant id: an agency user's request. Everything is filtered to that tenant.
- PLATFORM: a platform admin's request. Only rows without a tenant are visible, so all tenant
  data is hidden (fail closed); the platform API works with explicit tenants only.
"""
import contextvars
from contextlib import contextmanager

from django.conf import settings
from django.core.exceptions import PermissionDenied
from django.db import models

_UNSET = object()
PLATFORM = "platform"
PLATFORM_ROLE = "platform_admin"

_current = contextvars.ContextVar("gasbook_tenant", default=_UNSET)


def current_tenant_id():
    """The tenant id of the current request, or None when unset or in the platform context."""
    value = _current.get()
    return value if isinstance(value, int) else None


def in_platform_context():
    return _current.get() == PLATFORM


@contextmanager
def tenant_context(tenant):
    """Run a block as one tenant (a Tenant, its id, or PLATFORM)."""
    value = tenant if tenant == PLATFORM else getattr(tenant, "pk", tenant)
    token = _current.set(value)
    try:
        yield
    finally:
        _current.reset(token)


@contextmanager
def request_scope():
    """Start each API request unscoped and never let its tenant outlive it."""
    token = _current.set(_UNSET)
    try:
        yield
    finally:
        _current.reset(token)


def activate_for_user(user):
    """Scope the rest of the request to the user's tenant; called right after authentication."""
    if not getattr(user, "is_authenticated", False):
        return
    tenant_id = getattr(user, "tenant_id", None)
    # A user without a tenant (the platform admin, or a misconfigured account) sees no tenant data.
    _current.set(tenant_id if tenant_id is not None else PLATFORM)


def default_tenant_id():
    from .models import Tenant

    tenant, _ = Tenant.objects.get_or_create(
        slug=settings.DEFAULT_TENANT_SLUG, defaults={"name": settings.DEFAULT_TENANT_NAME}
    )
    return tenant.pk


def tenant_for_new_row():
    value = _current.get()
    if value is _UNSET:
        return default_tenant_id()
    if value == PLATFORM:
        raise PermissionDenied("Platform requests must name the tenant a record belongs to.")
    return value


def assert_writable(tenant_id):
    """Refuse to write a row that belongs to a different tenant than the current request."""
    value = _current.get()
    if isinstance(value, int) and tenant_id != value:
        raise PermissionDenied("This record belongs to another agency.")


class TenantQuerySet(models.QuerySet):
    def _scoped(self):
        value = _current.get()
        if value is _UNSET:
            return self
        if value == PLATFORM:
            # Business rows always have a tenant, so this is empty for them; for users it leaves
            # only platform accounts (needed e.g. when a platform admin changes their password).
            return self.filter(tenant__isnull=True)
        return self.filter(tenant_id=value)

    def all(self):
        # Querysets built at import time (view and serializer-field ``queryset`` attributes) were
        # created with no tenant active; DRF re-reads them through .all() on every request, so
        # scoping here covers them too.
        return super().all()._scoped()

    def bulk_create(self, objs, *args, **kwargs):
        objs = list(objs)
        for obj in objs:
            if obj.tenant_id is None:
                obj.tenant_id = tenant_for_new_row()
            assert_writable(obj.tenant_id)
        return super().bulk_create(objs, *args, **kwargs)


class TenantManager(models.Manager.from_queryset(TenantQuerySet)):
    def get_queryset(self):
        return super().get_queryset()._scoped()


def install_drf_hooks():
    """Tie the tenant context to DRF's request lifecycle.

    DRF has no global post-authentication hook: views pick their own permission classes, and
    tests may force-authenticate around the authentication classes. Wrapping the two APIView
    methods every DRF view (class-based and @api_view) runs through covers all of them.
    """
    from rest_framework.views import APIView

    if getattr(APIView, "_gasbook_tenancy", False):
        return
    original_dispatch = APIView.dispatch
    original_perform_authentication = APIView.perform_authentication

    def dispatch(self, request, *args, **kwargs):
        with request_scope():
            return original_dispatch(self, request, *args, **kwargs)

    def perform_authentication(self, request):
        original_perform_authentication(self, request)
        user = request.user
        tenant = getattr(user, "tenant", None) if getattr(user, "is_authenticated", False) else None
        if tenant is not None and not tenant.is_active:
            from rest_framework.exceptions import PermissionDenied as ApiPermissionDenied

            raise ApiPermissionDenied({"detail": "This agency's account is suspended.", "code": "tenant_inactive"})
        activate_for_user(user)

    APIView.dispatch = dispatch
    APIView.perform_authentication = perform_authentication
    APIView._gasbook_tenancy = True
