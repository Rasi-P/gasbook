"""Platform API: the GasBook operator creates and suspends tenants (gas agencies).

Platform admins have no tenant, so every tenant-owned query they make is empty. These views
only touch the Tenant table and, when creating a tenant, write inside that tenant's context.
"""
from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.db import transaction
from django.db.models import Count
from django.utils.crypto import get_random_string
from django.utils.text import slugify
from rest_framework import permissions
from rest_framework import status as drf_status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from .exceptions import ApiError
from .models import Role, StockLocation, Tenant, User
from .serializers import split_full_name, validate_user_contact
from .services import advisory_lock
from .tenancy import PLATFORM_ROLE, tenant_context

DEFAULT_LOCATIONS = (
    {"name": "Shop", "code": "shop", "is_main_supplier": False},
    {"name": "Supplier", "code": "supplier", "is_main_supplier": True},
)


class IsPlatformAdmin(permissions.BasePermission):
    def has_permission(self, request, view):
        user = request.user
        return bool(
            user.is_authenticated
            and user.tenant_id is None
            and getattr(user.role, "code", "") == PLATFORM_ROLE
        )


def serialize_tenant(tenant, user_count=None):
    if user_count is None:
        user_count = User.all_tenants.filter(tenant=tenant).count()
    return {
        "id": tenant.id,
        "name": tenant.name,
        "slug": tenant.slug,
        "is_active": tenant.is_active,
        "created_at": tenant.created_at,
        "user_count": user_count,
        **{key: getattr(tenant, key) for key in BUSINESS_FIELDS},
    }


BUSINESS_FIELDS = ("address", "phone", "email", "tax_id")


def _clean_business_details(data):
    """Optional receipt details present in ``data``, trimmed and validated."""
    cleaned = {}
    for key in BUSINESS_FIELDS:
        if key not in data:
            continue
        value = " ".join(str(data.get(key) or "").split())
        if len(value) > Tenant._meta.get_field(key).max_length:
            raise ApiError("This value is too long.", code="invalid", field=key)
        if key == "email" and value:
            try:
                validate_email(value)
            except ValidationError:
                raise ApiError("Enter a valid email address.", code="invalid", field="email") from None
        cleaned[key] = value
    return cleaned


def _clean_name(data):
    name = " ".join(str(data.get("name") or "").split())
    if not name:
        raise ApiError("Enter the agency name.", code="required", field="name")
    if len(name) > Tenant._meta.get_field("name").max_length:
        raise ApiError("The agency name is too long.", code="invalid", field="name")
    return name


def _clean_slug(raw, name):
    max_length = Tenant._meta.get_field("slug").max_length
    slug = slugify(str(raw or "").strip() or name)[:max_length].strip("-")
    if not slug:
        raise ApiError("Enter a code using letters, numbers and dashes.", code="invalid", field="slug")
    if Tenant.objects.filter(slug=slug).exists():
        raise ApiError("Another agency already uses this code.", code="duplicate_slug", field="slug")
    return slug


@api_view(["GET", "POST"])
@permission_classes([IsPlatformAdmin])
def tenants(request):
    if request.method == "GET":
        rows = Tenant.objects.annotate(user_count=Count("users")).order_by("name")
        return Response([serialize_tenant(t, t.user_count) for t in rows])

    data = request.data
    name = _clean_name(data)
    business = _clean_business_details(data)
    contact = validate_user_contact(
        {
            "username": data.get("admin_username"),
            "full_name": data.get("admin_full_name"),
            "phone": data.get("admin_phone"),
            "email": data.get("admin_email") or "",
        }
    )
    username = contact.get("username", "")
    if not username:
        raise ApiError("Enter a username for the first admin.", code="required", field="admin_username")
    if not contact.get("phone"):
        raise ApiError("Enter a phone number for the first admin.", code="required", field="admin_phone")
    admin_role = Role.objects.filter(code="admin").first()
    if admin_role is None:
        raise ApiError("The admin role is missing; run migrations.", code="misconfigured", status=500)

    password = get_random_string(length=12)
    with transaction.atomic():
        advisory_lock("tenant-slug", slugify(data.get("slug") or name))
        advisory_lock("username", username)
        slug = _clean_slug(data.get("slug"), name)
        # Usernames identify the account at login, so they stay unique across all tenants.
        if User.all_tenants.filter(username=username).exists():
            raise ApiError("This username is already taken.", code="duplicate_username", field="admin_username")
        tenant = Tenant.objects.create(name=name, slug=slug, **business)
        with tenant_context(tenant):
            for location in DEFAULT_LOCATIONS:
                StockLocation.objects.create(**location)
            first_name, last_name = split_full_name(contact.get("full_name", ""))
            User.objects.create_user(
                username=username,
                password=password,
                first_name=first_name,
                last_name=last_name,
                email=contact.get("email", ""),
                phone=contact["phone"],
                role=admin_role,
                tenant=tenant,
                must_change_password=True,
            )

    body = serialize_tenant(tenant)
    body["admin"] = {"username": username, "temporary_password": password}
    return Response(body, status=drf_status.HTTP_201_CREATED)


@api_view(["PATCH"])
@permission_classes([IsPlatformAdmin])
def tenant_detail(request, pk):
    with transaction.atomic():
        tenant = Tenant.objects.select_for_update().filter(pk=pk).first()
        if tenant is None:
            return Response({"detail": "Agency not found.", "code": "not_found"}, status=drf_status.HTTP_404_NOT_FOUND)
        fields = []
        if "name" in request.data:
            tenant.name = _clean_name(request.data)
            fields.append("name")
        for key, value in _clean_business_details(request.data).items():
            setattr(tenant, key, value)
            fields.append(key)
        if "is_active" in request.data:
            value = request.data["is_active"]
            if not isinstance(value, bool):
                raise ApiError("is_active must be true or false.", code="invalid", field="is_active")
            tenant.is_active = value
            fields.append("is_active")
        if fields:
            tenant.save(update_fields=[*fields, "updated_at"])
    return Response(serialize_tenant(tenant))
