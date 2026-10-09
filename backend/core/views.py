import re
from datetime import date
from decimal import Decimal

from django.contrib.auth import authenticate
from django.contrib.auth.password_validation import validate_password
from django.utils.crypto import get_random_string
from django.db import transaction
from django.db.models import Count, Q, Sum
from django.core.exceptions import ObjectDoesNotExist
from django.utils import timezone
from rest_framework import permissions, viewsets, filters, mixins
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.exceptions import PermissionDenied
from rest_framework.fields import DateTimeField
from rest_framework.response import Response
from rest_framework import status as drf_status
from rest_framework_simplejwt.views import TokenObtainPairView

from .models import (
    ActivityLog, Booking, CustomerCylinderDiscount, CustomerCylinderRate, CustomerProfile,
    CylinderType, Delivery, Expense, Notification, Payment, Sale, SaleItem,
    StaffProfile, Stock, StockLocation, StockMovement, User, Role
)
from .exceptions import ApiError
from .pagination import StandardPagination
from .services import (
    OPEN_DELIVERY_STATUSES,
    admin_users,
    assignment_logging_started_at,
    clean_reason,
    deactivate_customer,
    deactivate_user,
    default_staff_customers,
    delete_customer,
    delete_user,
    display_name,
    lock_booking_and_delivery,
    notify,
    parse_money,
    parse_non_negative_int,
    reactivate_customer,
    reactivate_user,
    staff_assignment_details,
    staff_handovers,
    user_search_q,
)
from .serializers import (
    ActivityLogSerializer,
    BookingSerializer,
    CustomerCylinderDiscountSerializer,
    CustomerCylinderRateSerializer,
    CustomerProfileSerializer,
    CylinderTypeSerializer,
    DeliverySerializer,
    ExpenseSerializer,
    NotificationSerializer,
    PaymentSerializer,
    SaleSerializer,
    StockLocationSerializer,
    StockMovementSerializer,
    StockSerializer,
    StaffDeliveryHistorySerializer,
    StaffHandoverBookingSerializer,
    StaffProfileSerializer,
    UserSerializer,
    get_booking_pricing_snapshot,
    get_customer_pricing_snapshot,
    get_sale_pricing_snapshot,
    get_stock_row,
    serialize_decimal,
    split_full_name,
    validate_user_contact,
)


def get_staff_image_url(request, user):
    profile = getattr(user, "staff_profile", None)
    if not profile or not profile.image:
        return None
    return request.build_absolute_uri(profile.image.url)


def format_decimal_label(value):
    number = Decimal(value)
    if number == number.to_integral():
        return str(int(number))
    return format(number.normalize(), "f")


def build_sale_history_display(sale):
    billed_items = [item for item in sale.items.all() if item.quantity > 0 or item.total_amount > 0]
    total_quantity = sum(item.quantity for item in billed_items)

    if len(billed_items) == 1:
        item = billed_items[0]
        weight = item.cylinder_type.weight
        weight_label = format_decimal_label(weight)
        return {
            "display_name": f"{weight_label} KG Cylinder",
            "display_badge": f"{weight_label} KG",
            "cylinder_type_id": item.cylinder_type_id,
            "cylinder_type_name": item.cylinder_type.name,
            "cylinder_type_weight": serialize_decimal(weight),
            "quantity": item.quantity,
            "rate": serialize_decimal(item.rate),
            "item_count": 1,
        }

    item_count = len(billed_items)
    primary_item = billed_items[0] if billed_items else None
    quantity_label = total_quantity if total_quantity > 0 else item_count
    return {
        "display_name": "Mixed Cylinders",
        "display_badge": f"{quantity_label} Cylinders" if quantity_label else "Direct Sale",
        "cylinder_type_id": primary_item.cylinder_type_id if item_count == 1 and primary_item else None,
        "cylinder_type_name": "Mixed Cylinders",
        "cylinder_type_weight": None,
        "quantity": total_quantity,
        "rate": serialize_decimal(sale.total_amount),
        "item_count": item_count,
    }


def build_direct_sale_history_entry(sale):
    billed_items = [item for item in sale.items.all() if item.quantity > 0 or item.total_amount > 0]
    if not billed_items:
        return None

    pricing = get_sale_pricing_snapshot(sale)
    display = build_sale_history_display(sale)
    sold_by_name = sale.sold_by.get_full_name() or sale.sold_by.username
    payment_status = "PAID" if sale.balance_due <= 0 else "PENDING"

    return {
        "id": sale.id,
        "history_source": "sale",
        "source_id": sale.id,
        "order_id": f"SALE-{sale.id}",
        "display_reference": f"Direct Sale #{sale.id}",
        "status": Booking.Status.DELIVERED,
        "created_at": sale.created_at.isoformat(),
        "updated_at": sale.updated_at.isoformat(),
        "approved_at": None,
        "delivered_at": sale.created_at.isoformat(),
        "cylinder_type_id": display["cylinder_type_id"],
        "cylinder_type_name": display["cylinder_type_name"],
        "cylinder_type_weight": display["cylinder_type_weight"],
        "display_name": display["display_name"],
        "display_badge": display["display_badge"],
        "quantity": display["quantity"],
        "rate": display["rate"],
        "original_amount": serialize_decimal(pricing["original_amount"]),
        "discount_amount": serialize_decimal(pricing["discount_amount"]),
        "total_amount": serialize_decimal(pricing["final_amount"]),
        "final_amount": serialize_decimal(pricing["final_amount"]),
        "has_discount": pricing["has_discount"],
        "applied_discount_type": pricing["applied_discount_type"],
        "applied_discount_value": serialize_decimal(pricing["applied_discount_value"]),
        "assigned_staff_name": sale.delivery_staff or sold_by_name,
        "assigned_staff_phone": None,
        "payment_method": sale.payment_mode.upper(),
        "payment_status": payment_status,
        "rejection_reason": None,
        "rejected_at": None,
        "can_track": False,
        "can_order_again": bool(display["cylinder_type_id"]),
        "item_count": display["item_count"],
        "note": sale.note,
        "detail_message": (
            f"Direct sale recorded by {sold_by_name}."
            + (f" Balance due: Rs. {serialize_decimal(sale.balance_due)}." if sale.balance_due > 0 else "")
        ),
    }


class CustomTokenObtainPairView(TokenObtainPairView):
    def post(self, request, *args, **kwargs):
        response = super().post(request, *args, **kwargs)
        username = (request.data.get("username") or "").strip()
        user = User.objects.filter(username=username).select_related("role").first()
        if not user:
            return response
        role = getattr(user.role, "code", "") or ""
        client = str(request.data.get("client") or "").strip().lower()
        if client == "customer" and role != "customer":
            return Response(
                {"detail": "This account cannot sign in to the customer app.", "code": "role_not_allowed", "role": role},
                status=drf_status.HTTP_403_FORBIDDEN,
            )
        if client == "management" and role == "customer":
            return Response(
                {
                    "detail": "This account is for the customer app, not the management portal.",
                    "code": "role_not_allowed",
                    "role": "customer",
                },
                status=drf_status.HTTP_403_FORBIDDEN,
            )
        response.data["must_change_password"] = bool(getattr(user, "must_change_password", False))
        response.data["user_id"] = user.id
        response.data["role"] = role
        return response


class IsAdminOrReadOnly(permissions.BasePermission):
    def has_permission(self, request, view):
        if request.method in permissions.SAFE_METHODS:
            return True
        return getattr(getattr(request.user, "role", None), "code", "") == "admin" or request.user.is_superuser


class IsAdminUserRole(permissions.BasePermission):
    def has_permission(self, request, view):
        return getattr(getattr(request.user, "role", None), "code", "") == "admin" or request.user.is_superuser


class IsStaffOrAdmin(permissions.BasePermission):
    def has_permission(self, request, view):
        return getattr(getattr(request.user, "role", None), "code", "") in ["admin", "staff"] or request.user.is_superuser


class CylinderTypeViewSet(viewsets.ModelViewSet):
    queryset = CylinderType.objects.all()
    serializer_class = CylinderTypeSerializer
    permission_classes = [IsAdminOrReadOnly]
    search_fields = ["name"]


class StockLocationViewSet(viewsets.ModelViewSet):
    queryset = StockLocation.objects.all()
    serializer_class = StockLocationSerializer
    permission_classes = [IsStaffOrAdmin]


class StockViewSet(viewsets.ModelViewSet):
    queryset = Stock.objects.select_related("cylinder_type", "location")
    serializer_class = StockSerializer
    permission_classes = [IsStaffOrAdmin]

    def get_queryset(self):
        queryset = super().get_queryset()
        location = self.request.query_params.get("location")
        status = self.request.query_params.get("status")
        if location:
            queryset = queryset.filter(location__code=location)
        if status:
            queryset = queryset.filter(status=status)
        return queryset


class StockMovementViewSet(viewsets.ModelViewSet):
    queryset = StockMovement.objects.select_related("cylinder_type", "from_location", "to_location", "moved_by")
    serializer_class = StockMovementSerializer
    permission_classes = [IsStaffOrAdmin]

    def create(self, request, *args, **kwargs):
        note = request.data.get("note", "")
        if note.startswith("Received refilled cylinders"):
            supplier_id = request.data.get("from_location")
            cylinder_type_id = request.data.get("cylinder_type")
            try:
                qty = float(request.data.get("quantity", 0))
            except ValueError:
                qty = 0

            # Calculate pending balance
            supplier_movements = StockMovement.objects.filter(
                Q(from_location_id=supplier_id) | Q(to_location_id=supplier_id),
                cylinder_type_id=cylinder_type_id
            ).order_by("created_at")
            
            try:
                sup_id_int = int(supplier_id)
            except (ValueError, TypeError):
                sup_id_int = 0

            pending = 0
            for m in supplier_movements:
                is_to = (m.to_location_id == sup_id_int)
                is_from = (m.from_location_id == sup_id_int)
                if is_to and m.status == "empty":
                    pending += m.quantity
                elif is_from and m.status == "filled" and m.note != "New supplier load":
                    pending = max(0, pending - m.quantity)
                    
            if qty > pending:
                return Response(
                    {"detail": f"Cannot receive {int(qty)}. The supplier only owes you {int(pending)} of this cylinder type."}, 
                    status=drf_status.HTTP_400_BAD_REQUEST
                )

        return super().create(request, *args, **kwargs)

    @action(detail=False, methods=["get"])
    def supplier_pending(self, request):
        supplier_movements = StockMovement.objects.filter(
            Q(from_location__code="supplier") | Q(to_location__code="supplier") | 
            Q(from_location__is_main_supplier=True) | Q(to_location__is_main_supplier=True)
        ).order_by("created_at")
        
        pending_balances = []
        for cylinder in CylinderType.objects.filter(is_active=True):
            movements = supplier_movements.filter(cylinder_type=cylinder)
            pending = 0
            for m in movements:
                is_to_supplier = (m.to_location.code == "supplier" or m.to_location.is_main_supplier)
                is_from_supplier = (m.from_location.code == "supplier" or m.from_location.is_main_supplier)
                if is_to_supplier and m.status == "empty":
                    pending += m.quantity
                elif is_from_supplier and m.status == "filled" and m.note != "New supplier load":
                    pending = max(0, pending - m.quantity)
            if pending > 0:
                pending_balances.append({
                    "cylinder_type_id": cylinder.id,
                    "cylinder_type_name": cylinder.name,
                    "pending": pending
                })
        return Response(pending_balances)


class CustomerProfileViewSet(viewsets.ModelViewSet):
    queryset = CustomerProfile.objects.select_related("user", "default_staff").prefetch_related(
        "custom_rates",
        "cylinder_discounts__cylinder_type",
        "sales",
        "payments",
    )
    serializer_class = CustomerProfileSerializer

    def get_permissions(self):
        if getattr(self, "action", None) == "me":
            return [permissions.IsAuthenticated()]
        if self.request.method == "DELETE" or getattr(self, "action", None) in ("deactivate", "reactivate"):
            return [IsAdminUserRole()]
        if getattr(getattr(self.request.user, "role", None), "code", "") == "customer":
            if self.request.method == "POST":
                return [IsAdminUserRole()]
            return [permissions.IsAuthenticated()]
        return [IsStaffOrAdmin()]

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context["request"] = self.request
        return context

    def get_queryset(self):
        queryset = super().get_queryset()
        if getattr(getattr(self.request.user, "role", None), "code", "") == "customer":
            return queryset.filter(user=self.request.user)
        area = self.request.query_params.get("area")
        active = self.request.query_params.get("active")
        term = self.request.query_params.get("search")
        if area:
            queryset = queryset.filter(area__icontains=area)
        if active in ["0", "1"]:
            queryset = queryset.filter(is_active=active == "1")
        if term and term.split():
            queryset = queryset.filter(user_search_q(term, prefix="user__"))
        return queryset

    @transaction.atomic
    def create(self, request, *args, **kwargs):
        contact = validate_user_contact(request.data, name_key="name", check_duplicate_phone=True)
        name = contact.get("full_name", "")
        phone = contact.get("phone", "")
        email = contact.get("email", "")
        address = contact.get("address", "")
        parts = name.split(" ", 1)

        base_name = "_".join(parts).lower() if parts else "customer"
        username_str = f"{base_name}_{phone[-4:]}" if phone else f"{base_name}_{get_random_string(8)}"
        
        if User.objects.filter(username=username_str).exists():
            username_str = f"{username_str}_{get_random_string(4)}"

        customer_role = Role.objects.filter(code="customer").first()
        user = User.objects.create_user(
            username=username_str,
            first_name=parts[0] if parts else "",
            last_name=parts[1] if len(parts) > 1 else "",
            email=email,
            phone=phone,
            address=address,
            role=customer_role,
            must_change_password=True,
            is_active=True
        )
        profile = CustomerProfile.objects.create(user=user)
        return Response(self.get_serializer(profile).data, status=drf_status.HTTP_201_CREATED)

    @action(detail=False, methods=["get"], url_path="me", permission_classes=[permissions.IsAuthenticated])
    def me(self, request):
        if getattr(getattr(request.user, "role", None), "code", "") != "customer":
            raise ApiError("Customer account required.", code="role_not_allowed", status=403)
        profile = getattr(request.user, "customer_profile", None)
        if profile is None:
            raise ApiError("Customer profile not found.", code="customer_profile_missing", status=404)
        profile = self.get_queryset().filter(pk=profile.pk).first() or profile
        return Response(self.get_serializer(profile).data)

    @transaction.atomic
    def destroy(self, request, *args, **kwargs):
        profile = self.get_object()
        return Response(delete_customer(profile, request.user))

    @action(detail=True, methods=["post"], permission_classes=[IsAdminUserRole])
    @transaction.atomic
    def deactivate(self, request, pk=None):
        profile = deactivate_customer(self.get_object(), request.user)
        profile = self.get_queryset().filter(pk=profile.pk).first() or profile
        data = self.get_serializer(profile).data
        return Response(
            {
                "detail": "Customer deactivated. Ledger and order history are preserved.",
                "mode": "deactivated",
                "pending_amount": data.get("pending_amount"),
                "customer": data,
            }
        )

    @action(detail=True, methods=["post"], permission_classes=[IsAdminUserRole])
    @transaction.atomic
    def reactivate(self, request, pk=None):
        profile = reactivate_customer(self.get_object(), request.user)
        profile = self.get_queryset().filter(pk=profile.pk).first() or profile
        return Response(
            {"detail": "Customer reactivated.", "mode": "reactivated", "customer": self.get_serializer(profile).data}
        )

    @action(detail=True, methods=["get"], permission_classes=[IsStaffOrAdmin])
    def ledger(self, request, pk=None):
        customer_profile = self.get_object()
        sales = SaleSerializer(customer_profile.sales.prefetch_related("items__cylinder_type").all(), many=True).data
        payments = PaymentSerializer(customer_profile.payments.all(), many=True).data
        bookings = BookingSerializer(customer_profile.bookings.select_related("assigned_staff", "cylinder_type").order_by("-created_at"), many=True, context={'request': request}).data
        return Response({"customer": CustomerProfileSerializer(customer_profile).data, "sales": sales, "payments": payments, "bookings": bookings})

    def update(self, request, *args, **kwargs):
        if getattr(getattr(request.user, "role", None), "code", "") == "customer":
            # Customers may only change their own contact details (name/phone/email/address);
            # every profile field (balances, discounts, default_staff, is_active...) is ignored.
            instance = self.get_object()
            serializer = self.get_serializer(instance, data={}, partial=True)
            serializer.is_valid(raise_exception=True)
            self.perform_update(serializer)
            return Response(self.get_serializer(instance).data)
        return super().update(request, *args, **kwargs)

    @transaction.atomic
    def perform_update(self, serializer):
        user = serializer.instance.user
        contact = validate_user_contact(
            self.request.data, name_key="name", exclude_user=user, check_duplicate_phone=True
        )
        if "is_active" in serializer.validated_data:
            # Account status is admin-only and must go through the deactivate/reactivate
            # policy (open-order guard + ActivityLog), never through a plain field write.
            wants_active = bool(serializer.validated_data.pop("is_active"))
            if getattr(getattr(self.request.user, "role", None), "code", "") != "admin":
                raise ApiError("Only admins can change account status.", code="forbidden", status=403)
            currently_active = bool(serializer.instance.is_active and user.is_active)
            if wants_active != currently_active:
                if wants_active:
                    reactivate_customer(serializer.instance, self.request.user)
                else:
                    deactivate_customer(serializer.instance, self.request.user)
        profile = serializer.save()
        user = profile.user
        update_fields = ["first_name", "last_name", "phone", "address", "email"]

        if "full_name" in contact:
            user.first_name, user.last_name = split_full_name(contact["full_name"])
        if "phone" in contact:
            user.phone = contact["phone"]
        if "address" in contact:
            user.address = contact["address"]
        if "email" in contact:
            user.email = contact["email"]

        user.save(update_fields=update_fields)


class SaleViewSet(viewsets.ModelViewSet):
    queryset = Sale.objects.select_related("customer__user", "location", "sold_by").prefetch_related("items__cylinder_type")
    serializer_class = SaleSerializer
    permission_classes = [IsStaffOrAdmin]

    def get_queryset(self):
        queryset = super().get_queryset()
        term = self.request.query_params.get("search")
        payment_mode = self.request.query_params.get("payment_mode")
        pending = self.request.query_params.get("pending")
        if term and term.split():
            queryset = queryset.filter(user_search_q(term, prefix="customer__user__"))
        if payment_mode:
            queryset = queryset.filter(payment_mode=payment_mode)
        if pending == "1":
            queryset = queryset.filter(balance_due__gt=0)
        return queryset


class PaymentViewSet(viewsets.ModelViewSet):
    queryset = Payment.objects.select_related("customer__user", "sale", "received_by")
    serializer_class = PaymentSerializer
    permission_classes = [IsStaffOrAdmin]

    @transaction.atomic
    def perform_create(self, serializer):
        payment = serializer.save()
        if payment.sale:
            sale = payment.sale
            sale.paid_amount += payment.amount
            sale.balance_due = max(Decimal(0), sale.total_amount - sale.paid_amount)
            sale.save(update_fields=["paid_amount", "balance_due"])
        else:
            pending_sales = Sale.objects.filter(customer=payment.customer, balance_due__gt=0).order_by("created_at")
            remaining_payment = payment.amount
            first_allocation = True
            for sale in pending_sales:
                if remaining_payment <= 0:
                    break
                
                allocated = sale.balance_due if remaining_payment >= sale.balance_due else remaining_payment
                
                sale.paid_amount += allocated
                sale.balance_due -= allocated
                sale.save(update_fields=["paid_amount", "balance_due"])
                
                if first_allocation:
                    payment.sale = sale
                    payment.amount = allocated
                    payment.save(update_fields=["sale", "amount"])
                    first_allocation = False
                else:
                    new_p = Payment.objects.create(
                        customer=payment.customer,
                        sale=sale,
                        amount=allocated,
                        payment_mode=payment.payment_mode,
                        received_by=payment.received_by,
                        note=payment.note,
                        empty_collected=0,
                    )
                    # Sync created_at for grouping
                    new_p.created_at = payment.created_at
                    new_p.save(update_fields=["created_at"])
                    
                remaining_payment -= allocated

            if remaining_payment > 0:
                if first_allocation:
                    pass # Left as generic
                else:
                    new_p = Payment.objects.create(
                        customer=payment.customer,
                        sale=None,
                        amount=remaining_payment,
                        payment_mode=payment.payment_mode,
                        received_by=payment.received_by,
                        note=payment.note,
                        empty_collected=0,
                    )
                    new_p.created_at = payment.created_at
                    new_p.save(update_fields=["created_at"])


class ExpenseViewSet(viewsets.ModelViewSet):
    queryset = Expense.objects.select_related("spent_by")
    serializer_class = ExpenseSerializer
    permission_classes = [IsAdminUserRole]


class ActivityLogViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = ActivityLog.objects.select_related("user")
    serializer_class = ActivityLogSerializer
    permission_classes = [IsAdminUserRole]


class StaffProfileViewSet(viewsets.ModelViewSet):
    queryset = StaffProfile.objects.select_related("user", "vehicle_location")
    serializer_class = StaffProfileSerializer
    permission_classes = [IsStaffOrAdmin]

    def get_permissions(self):
        if self.request.method == "DELETE":
            return [IsAdminUserRole()]
        return super().get_permissions()

    @transaction.atomic
    def destroy(self, request, *args, **kwargs):
        # Routed through the same deletion policy as DELETE /api/auth/users/{pk}/.
        profile = self.get_object()
        return Response(delete_user(profile.user, request.user))


class CustomerCylinderRateViewSet(viewsets.ModelViewSet):
    queryset = CustomerCylinderRate.objects.select_related("customer", "cylinder_type")
    serializer_class = CustomerCylinderRateSerializer
    permission_classes = [IsAdminUserRole]

    def get_queryset(self):
        queryset = super().get_queryset()
        customer = self.request.query_params.get("customer")
        if customer:
            queryset = queryset.filter(customer_id=customer)
        return queryset


class CustomerCylinderDiscountViewSet(viewsets.ModelViewSet):
    queryset = CustomerCylinderDiscount.objects.select_related("customer", "cylinder_type")
    serializer_class = CustomerCylinderDiscountSerializer
    permission_classes = [IsAdminUserRole]

    def get_queryset(self):
        queryset = super().get_queryset()
        customer = self.request.query_params.get("customer")
        if customer:
            queryset = queryset.filter(customer_id=customer)
        return queryset


class NotificationViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = NotificationSerializer

    def get_queryset(self):
        return Notification.objects.filter(recipient=self.request.user).select_related("booking").order_by("-created_at")

    @action(detail=True, methods=["post"])
    def mark_read(self, request, pk=None):
        notification = self.get_object()
        notification.is_read = True
        notification.save(update_fields=["is_read", "updated_at"])
        return Response(NotificationSerializer(notification).data)


class BookingViewSet(
    mixins.CreateModelMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    """Bookings change only through customer ``create`` and the approve/reject actions;
    there are no generic update/delete routes (they bypassed the workflow and its log)."""

    queryset = Booking.objects.select_related(
        "customer__user", "cylinder_type", "assigned_staff", "sale", "delivery", "delivery__staff"
    ).prefetch_related(
        "customer__custom_rates",
        "customer__cylinder_discounts__cylinder_type",
    )
    serializer_class = BookingSerializer
    filter_backends = [filters.SearchFilter]
    search_fields = ["id", "cylinder_type__name", "status"]

    def get_queryset(self):
        queryset = super().get_queryset()
        role = getattr(getattr(self.request.user, "role", None), "code", "")
        if role == "customer":
            queryset = queryset.filter(customer__user=self.request.user)
        elif role == "staff":
            queryset = queryset.filter(assigned_staff=self.request.user)
        status_param = self.request.query_params.get("status")
        if status_param:
            statuses = [s.strip() for s in status_param.split(",") if s.strip()]
            if len(statuses) > 1:
                queryset = queryset.filter(status__in=statuses)
            elif len(statuses) == 1:
                queryset = queryset.filter(status=statuses[0])
        return queryset

    @transaction.atomic
    def perform_create(self, serializer):
        if getattr(getattr(self.request.user, "role", None), "code", "") != "customer":
            raise PermissionDenied("Only customers can create booking requests.")
        serializer.save()

    @action(detail=False, methods=["get"], permission_classes=[permissions.IsAuthenticated])
    def history(self, request):
        if getattr(getattr(request.user, "role", None), "code", "") != "customer":
            raise PermissionDenied("Only customers can view booking history.")

        profile = getattr(request.user, "customer_profile", None)
        if not profile:
            return Response({"count": 0, "next": None, "previous": None, "results": []})

        status_param = request.query_params.get("status", "")
        statuses = [status.strip() for status in status_param.split(",") if status.strip()]
        search_term = (request.query_params.get("search") or "").strip().lower()

        booking_queryset = self.get_queryset().filter(customer=profile).select_related("cylinder_type", "assigned_staff")
        booking_data = BookingSerializer(booking_queryset, many=True, context={"request": request}).data

        history_entries = []

        for row in booking_data:
            history_entries.append({
                **row,
                "history_source": "booking",
                "source_id": row["id"],
                "display_reference": f"Order #{row['order_id']}",
                "display_name": None,
                "display_badge": None,
                "cylinder_type_id": row.get("cylinder_type"),
                "can_track": True,
                "can_order_again": True,
                "item_count": 1,
                "detail_message": None,
            })

        include_direct_sales = not statuses or Booking.Status.DELIVERED in statuses
        if include_direct_sales:
            direct_sales = (
                Sale.objects.filter(customer=profile, booking__isnull=True)
                .select_related("customer__user", "location", "sold_by")
                .prefetch_related("items__cylinder_type")
                .order_by("-created_at")
            )
            for sale in direct_sales:
                entry = build_direct_sale_history_entry(sale)
                if entry is not None:
                    history_entries.append(entry)

        if search_term:
            def matches_search(entry):
                haystack = [
                    str(entry.get("display_reference", "")),
                    str(entry.get("order_id", "")),
                    str(entry.get("cylinder_type_name", "")),
                    str(entry.get("display_name", "")),
                    str(entry.get("note", "")),
                ]
                return search_term in " ".join(haystack).lower()

            history_entries = [entry for entry in history_entries if matches_search(entry)]

        history_entries.sort(key=lambda entry: str(entry.get("created_at") or ""), reverse=True)

        page = self.paginate_queryset(history_entries)
        if page is not None:
            return self.get_paginated_response(page)

        return Response(history_entries)

    @action(detail=False, methods=["post"], permission_classes=[permissions.IsAuthenticated])
    def preview(self, request):
        if getattr(getattr(request.user, "role", None), "code", "") != "customer":
            raise PermissionDenied("Only customers can preview booking totals.")

        profile = getattr(request.user, "customer_profile", None)
        if not profile:
            return Response({"detail": "Customer profile is required to preview booking totals."}, status=drf_status.HTTP_400_BAD_REQUEST)

        items = request.data.get("items") or []
        if not isinstance(items, list):
            return Response({"detail": "Items must be a list."}, status=drf_status.HTTP_400_BAD_REQUEST)

        cylinder_ids = []
        for item in items:
            try:
                cylinder_ids.append(int(item.get("cylinder_type")))
            except (TypeError, ValueError):
                return Response({"detail": "Each item requires a valid cylinder_type."}, status=drf_status.HTTP_400_BAD_REQUEST)

        cylinders = CylinderType.objects.filter(id__in=cylinder_ids, is_active=True).in_bulk()
        response_items = []
        original_total = Decimal("0.00")
        discount_total = Decimal("0.00")
        final_total = Decimal("0.00")

        for item in items:
            cylinder_id = int(item.get("cylinder_type"))
            quantity = int(item.get("quantity") or 0)
            if quantity <= 0:
                return Response({"detail": "Quantity must be greater than zero."}, status=drf_status.HTTP_400_BAD_REQUEST)

            cylinder = cylinders.get(cylinder_id)
            if cylinder is None:
                return Response({"detail": f"Cylinder type {cylinder_id} is invalid or inactive."}, status=drf_status.HTTP_400_BAD_REQUEST)

            pricing = get_customer_pricing_snapshot(profile, cylinder, quantity)
            original_total += pricing["original_amount"]
            discount_total += pricing["discount_amount"]
            final_total += pricing["final_amount"]
            response_items.append({
                "client_item_id": item.get("client_item_id"),
                "cylinder_type": cylinder.id,
                "cylinder_type_name": cylinder.name,
                "cylinder_type_weight": str(cylinder.weight),
                "quantity": quantity,
                "rate": str(pricing["rate"]),
                "original_amount": str(pricing["original_amount"]),
                "discount_amount": str(pricing["discount_amount"]),
                "final_amount": str(pricing["final_amount"]),
                "has_discount": pricing["has_discount"],
                "applied_discount_type": pricing["applied_discount_type"],
                "applied_discount_value": str(pricing["applied_discount_value"]),
            })

        return Response({
            "items": response_items,
            "summary": {
                "original_amount": str(original_total),
                "discount_amount": str(discount_total),
                "final_amount": str(final_total),
                "has_discount": discount_total > 0,
            },
        })

    @action(detail=True, methods=["post"], permission_classes=[IsAdminUserRole])
    @transaction.atomic
    def approve(self, request, pk=None):
        booking = self.get_object()
        booking, delivery = lock_booking_and_delivery(booking.pk)

        if booking.status not in (Booking.Status.PENDING, Booking.Status.APPROVED, Booking.Status.ACCEPTED):
            raise ApiError(
                f"Cannot approve booking in {booking.status} status.",
                code="invalid_state",
                status_value=booking.status,
            )

        staff_id = request.data.get("assigned_staff") or booking.customer.default_staff_id
        if not staff_id:
            raise ApiError("Assign delivery staff before approval.", code="required", field="assigned_staff")
        try:
            staff_id = int(str(staff_id).strip())
        except (TypeError, ValueError):
            raise ApiError("Valid active staff user is required.", code="invalid", field="assigned_staff")
        staff = User.objects.filter(id=staff_id, role__code="staff", is_active=True).first()
        if not staff:
            raise ApiError("Valid active staff user is required.", code="invalid", field="assigned_staff")

        # Same staff, delivery still live: nothing to do (keeps an `accepted` booking accepted).
        if (
            delivery
            and delivery.staff_id == staff.id
            and delivery.status in (Delivery.Status.ASSIGNED, Delivery.Status.ACCEPTED)
        ):
            return Response(BookingSerializer(booking, context={"request": request}).data)

        if delivery and delivery.status in (
            Delivery.Status.OUT_FOR_DELIVERY, Delivery.Status.DELIVERED, Delivery.Status.CANCELLED
        ):
            raise ApiError("Delivery state is inconsistent with the booking.", code="conflict", status=409)

        booking.status = Booking.Status.APPROVED
        booking.assigned_staff = staff
        booking.approved_by = request.user
        booking.approved_at = timezone.now()
        booking.rejection_reason = None
        booking.rejected_by = None
        booking.rejected_by_role = None
        booking.rejected_at = None
        booking.save(update_fields=[
            "status", "assigned_staff", "approved_by", "approved_at",
            "rejection_reason", "rejected_by", "rejected_by_role", "rejected_at", "updated_at",
        ])

        previous_staff = None
        previous_status = None
        if delivery is None:
            delivery = Delivery.objects.create(booking=booking, staff=staff, status=Delivery.Status.ASSIGNED)
            created = True
        else:
            created = False
            previous_staff = delivery.staff
            previous_status = delivery.status
            delivery.staff = staff
            delivery.status = Delivery.Status.ASSIGNED
            delivery.rejection_reason = ""
            delivery.started_at = None
            delivery.completed_at = None
            delivery.note = ""
            delivery.empty_collected = 0
            delivery.payment_collected = 0
            delivery.save(update_fields=[
                "staff", "status", "rejection_reason", "started_at", "completed_at",
                "note", "empty_collected", "payment_collected", "updated_at",
            ])

        ActivityLog.objects.create(
            action="booking_approved",
            user=request.user,
            description=f"Assigned order #{booking.order_id} to {display_name(staff)}"[:255],
            metadata={
                "booking_id": booking.id,
                "delivery_id": delivery.id,
                "staff_id": staff.id,
                "previous_staff_id": previous_staff.id if previous_staff else None,
                "previous_delivery_status": previous_status,
                "reassignment": not created,
            },
        )

        notify(
            staff,
            booking,
            "STAFF_ASSIGNED",
            "New Delivery Assigned",
            f"New delivery assigned — Order #{booking.order_id}.",
            dedupe=created,
        )
        if (
            not created
            and previous_staff is not None
            and previous_staff.id != staff.id
            and previous_status in (Delivery.Status.ASSIGNED, Delivery.Status.ACCEPTED)
        ):
            notify(
                previous_staff,
                booking,
                "DELIVERY_REASSIGNED",
                "Delivery Reassigned",
                f"Order #{booking.order_id} has been reassigned to another staff member.",
                dedupe=False,
            )

        return Response(BookingSerializer(booking, context={"request": request}).data)

    @action(detail=True, methods=["post"], permission_classes=[IsAdminUserRole])
    @transaction.atomic
    def reject(self, request, pk=None):
        booking = self.get_object()
        booking, delivery = lock_booking_and_delivery(booking.pk)

        if booking.status in (
            Booking.Status.REJECTED, Booking.Status.OUT_FOR_DELIVERY,
            Booking.Status.DELIVERED, Booking.Status.CANCELLED,
        ):
            raise ApiError(
                f"Cannot reject booking in {booking.status} status.",
                code="invalid_state",
                status_value=booking.status,
            )

        reason = clean_reason(request.data.get("reason"), Booking._meta.get_field("rejection_reason").max_length)

        booking.status = Booking.Status.REJECTED
        booking.rejection_reason = reason
        booking.rejected_by = request.user
        booking.rejected_by_role = "admin"
        booking.rejected_at = timezone.now()
        booking.save(update_fields=["status", "rejection_reason", "rejected_by", "rejected_by_role", "rejected_at", "updated_at"])

        if delivery and delivery.status in (
            Delivery.Status.ASSIGNED, Delivery.Status.ACCEPTED, Delivery.Status.REJECTED
        ):
            previous_status = delivery.status
            delivery.status = Delivery.Status.CANCELLED
            delivery.save(update_fields=["status", "updated_at"])
            if previous_status in (Delivery.Status.ASSIGNED, Delivery.Status.ACCEPTED):
                notify(
                    delivery.staff,
                    booking,
                    "DELIVERY_CANCELLED",
                    "Delivery Cancelled",
                    f"Order #{booking.order_id} was rejected by Admin and removed from your deliveries.",
                    dedupe=False,
                )

        ActivityLog.objects.create(
            action="booking_rejected",
            user=request.user,
            description=f"Rejected order #{booking.order_id}: {reason}"[:255],
            metadata={"booking_id": booking.id, "delivery_id": delivery.id if delivery else None, "reason": reason},
        )

        notify(
            booking.customer.user,
            booking,
            "ORDER_REJECTED",
            "Booking Rejected",
            f"Your GasBook order #{booking.order_id} was rejected by Admin. Reason: {reason}",
            dedupe=True,
        )
        return Response(BookingSerializer(booking, context={"request": request}).data)


class DeliveryViewSet(viewsets.ReadOnlyModelViewSet):
    """Deliveries change only through the accept/reject/start/complete actions; there are
    no generic create/update/delete routes (they bypassed the workflow and its log)."""

    queryset = Delivery.objects.select_related("booking__customer__user", "booking__cylinder_type", "staff").prefetch_related(
        "booking__customer__custom_rates",
        "booking__customer__cylinder_discounts__cylinder_type",
    )
    serializer_class = DeliverySerializer
    permission_classes = [IsStaffOrAdmin]

    def get_queryset(self):
        queryset = super().get_queryset()
        if getattr(getattr(self.request.user, "role", None), "code", "") == "staff":
            queryset = queryset.filter(staff=self.request.user)
        status_param = self.request.query_params.get("status")
        if status_param:
            queryset = queryset.filter(status=status_param)
        return queryset

    def _check_ownership(self, request, delivery):
        if (getattr(request.user.role, "code", "") == "staff") and delivery.staff_id != request.user.id:
            raise ApiError("This delivery is not assigned to you.", code="forbidden", status=403)

    @action(detail=True, methods=["post"])
    @transaction.atomic
    def accept(self, request, pk=None):
        delivery = self.get_object()
        self._check_ownership(request, delivery)
        booking, delivery = lock_booking_and_delivery(delivery.booking_id)
        # Re-check on the locked row: a concurrent re-assignment may have changed the staff.
        self._check_ownership(request, delivery)

        if delivery.status not in (Delivery.Status.ASSIGNED, Delivery.Status.ACCEPTED):
            raise ApiError(
                f"Cannot accept delivery from current status ({delivery.status}).",
                code="invalid_state",
                status_value=delivery.status,
            )
        if delivery.status == Delivery.Status.ACCEPTED:
            return Response(DeliverySerializer(delivery).data)

        delivery.status = Delivery.Status.ACCEPTED
        delivery.save(update_fields=["status", "updated_at"])
        booking.status = Booking.Status.ACCEPTED
        booking.save(update_fields=["status", "updated_at"])

        staff_name = display_name(delivery.staff)
        notify(
            booking.customer.user,
            booking,
            "ORDER_ACCEPTED",
            "Order Accepted",
            f"Your GasBook order #{booking.order_id} has been accepted by {staff_name} and will be delivered soon.",
            dedupe=True,
        )
        for admin in admin_users():
            notify(
                admin,
                booking,
                "STAFF_ACCEPTED",
                "Delivery Accepted by Staff",
                f"Staff {staff_name} accepted order #{booking.order_id}.",
                dedupe=True,
            )

        return Response(DeliverySerializer(delivery).data)

    @action(detail=True, methods=["post"])
    @transaction.atomic
    def reject(self, request, pk=None):
        """Staff *decline*: the Delivery is rejected and the Booking returns to the
        pending queue for re-assignment. The Booking's rejected_* fields are never
        written here (they mean "order rejected by admin")."""
        delivery = self.get_object()
        self._check_ownership(request, delivery)
        booking, delivery = lock_booking_and_delivery(delivery.booking_id)
        # Re-check on the locked row: a concurrent re-assignment may have changed the staff.
        self._check_ownership(request, delivery)

        if delivery.status not in (Delivery.Status.ASSIGNED, Delivery.Status.ACCEPTED):
            raise ApiError(
                f"Cannot decline delivery from current status ({delivery.status}).",
                code="invalid_state",
                status_value=delivery.status,
            )

        reason = clean_reason(request.data.get("reason"), Delivery._meta.get_field("rejection_reason").max_length)
        previous_status = delivery.status

        delivery.status = Delivery.Status.REJECTED
        delivery.rejection_reason = reason
        delivery.save(update_fields=["status", "rejection_reason", "updated_at"])

        booking.status = Booking.Status.PENDING
        booking.assigned_staff = None
        booking.approved_by = None
        booking.approved_at = None
        booking.save(update_fields=["status", "assigned_staff", "approved_by", "approved_at", "updated_at"])

        staff_name = display_name(delivery.staff)
        ActivityLog.objects.create(
            action="delivery_declined",
            user=request.user,
            description=f"{staff_name} declined order #{booking.order_id}: {reason}"[:255],
            metadata={
                "booking_id": booking.id,
                "delivery_id": delivery.id,
                "staff_id": delivery.staff_id,
                "reason": reason,
                "previous_delivery_status": previous_status,
            },
        )

        for admin in admin_users():
            notify(
                admin,
                booking,
                "STAFF_REJECTED",
                "Staff Declined Delivery",
                f"Staff {staff_name} declined order #{booking.order_id}. Reason: {reason}. Please assign another staff.",
                dedupe=False,
            )
        notify(
            booking.customer.user,
            booking,
            "ORDER_REASSIGNMENT",
            "Order Update",
            f"Your GasBook order #{booking.order_id} is being reassigned to another delivery partner. "
            "We will notify you once a new partner is assigned.",
            dedupe=False,
        )

        return Response(DeliverySerializer(delivery).data)

    @action(detail=True, methods=["post"])
    @transaction.atomic
    def start(self, request, pk=None):
        delivery = self.get_object()
        self._check_ownership(request, delivery)
        booking, delivery = lock_booking_and_delivery(delivery.booking_id)
        # Re-check on the locked row: a concurrent re-assignment may have changed the staff.
        self._check_ownership(request, delivery)

        if delivery.status in (Delivery.Status.DELIVERED, Delivery.Status.CANCELLED, Delivery.Status.REJECTED):
            raise ApiError(
                f"Cannot start delivery from current status ({delivery.status}).",
                code="invalid_state",
                status_value=delivery.status,
            )

        delivery.status = Delivery.Status.OUT_FOR_DELIVERY
        delivery.started_at = timezone.now()
        booking.status = Booking.Status.OUT_FOR_DELIVERY
        booking.save(update_fields=["status", "updated_at"])
        delivery.save(update_fields=["status", "started_at", "updated_at"])

        notify(
            booking.customer.user,
            booking,
            "ORDER_OUT_FOR_DELIVERY",
            "Out for Delivery",
            f"Your GasBook order #{booking.order_id} is out for delivery.",
            dedupe=True,
        )
        for admin in admin_users():
            notify(
                admin,
                booking,
                "ORDER_OUT_FOR_DELIVERY",
                "Order Out for Delivery",
                f"Order #{booking.order_id} is out for delivery by {delivery.staff.username}.",
                dedupe=True,
            )
        return Response(DeliverySerializer(delivery).data)

    @action(detail=True, methods=["post"])
    @transaction.atomic
    def complete(self, request, pk=None):
        delivery = self.get_object()
        self._check_ownership(request, delivery)
        booking, delivery = lock_booking_and_delivery(delivery.booking_id)
        # Re-check on the locked row: a concurrent re-assignment may have changed the staff.
        self._check_ownership(request, delivery)

        # --- guards (no writes yet) ---
        if (
            delivery.status == Delivery.Status.DELIVERED
            or booking.sale_id is not None
            or booking.status == Booking.Status.DELIVERED
        ):
            raise ApiError("Delivery already completed.", code="already_completed", sale_id=booking.sale_id)
        if delivery.status in (Delivery.Status.REJECTED, Delivery.Status.CANCELLED):
            raise ApiError(
                f"Cannot complete delivery from current status ({delivery.status}).",
                code="invalid_state",
                status_value=delivery.status,
            )

        profile = booking.customer
        pricing = get_booking_pricing_snapshot(booking)
        total = pricing["final_amount"]

        # --- input validation ---
        data = request.data
        empty_collected = parse_non_negative_int(data.get("empty_collected"), "empty_collected", "Empty cylinders collected")
        payment_collected = parse_money(data.get("payment_collected", "0"), "payment_collected", "Collected amount")
        split_payments = data.get("split_payments") or []
        if not isinstance(split_payments, list):
            raise ApiError("Split payments must be a list.", code="invalid", field="split_payments")
        parsed_splits = []
        for item in split_payments:
            if not isinstance(item, dict):
                raise ApiError("Split payments must be a list.", code="invalid", field="split_payments")
            amount = parse_money(item.get("amount"), "split_payments", "Split amount")
            if amount < 0:
                raise ApiError("Split amount must be a valid amount.", code="invalid", field="split_payments")
            mode = item.get("mode", Sale.PaymentMode.CASH)
            if mode not in Sale.PaymentMode.values:
                raise ApiError("Split payment mode is invalid.", code="invalid", field="split_payments")
            parsed_splits.append((amount, mode))
        if parsed_splits:
            payment_collected = sum((amount for amount, _mode in parsed_splits), Decimal("0"))

        if payment_collected < 0 or payment_collected > total:
            raise ApiError("Collected amount must be between 0 and sale total.", code="invalid", field="payment_collected")

        payment_method = data.get("payment_method") or booking.payment_method or "COD"
        paid_payment_mode = data.get("paid_payment_mode") or Sale.PaymentMode.CASH
        if paid_payment_mode not in Sale.PaymentMode.values:
            raise ApiError("Payment mode is invalid.", code="invalid", field="paid_payment_mode")
        note = str(data.get("note", "") or "")[:300]

        # --- location ---
        staff_profile = getattr(delivery.staff, "staff_profile", None)
        location = staff_profile.vehicle_location if staff_profile else None
        if location is None:
            location = StockLocation.objects.filter(code="shop").first() or StockLocation.objects.first()
        if location is None:
            raise ApiError("No stock location configured.", code="no_location")

        # --- stock: lock FILLED then EMPTY, refuse before any write if short ---
        filled = get_stock_row(booking.cylinder_type, location, Stock.Status.FILLED)
        if filled.quantity < booking.quantity:
            raise ApiError(
                f"Not enough filled {booking.cylinder_type.name} stock at {location.name} "
                f"({filled.quantity} available, {booking.quantity} needed). Load stock before completing.",
                code="insufficient_stock",
                location=location.code,
                location_name=location.name,
                available=filled.quantity,
                required=booking.quantity,
            )
        filled.quantity -= booking.quantity
        filled.save(update_fields=["quantity", "updated_at"])
        empty = None
        if empty_collected > 0:
            empty = get_stock_row(booking.cylinder_type, location, Stock.Status.EMPTY)
            empty.quantity += empty_collected
            empty.save(update_fields=["quantity", "updated_at"])

        if parsed_splits:
            sale_payment_mode = Sale.PaymentMode.SPLIT
        else:
            sale_payment_mode = Sale.PaymentMode.CREDIT if payment_collected < total else payment_method

        sale = Sale.objects.create(
            customer=profile,
            location=location,
            original_amount=pricing["original_amount"],
            discount_amount=pricing["discount_amount"],
            total_amount=total,
            applied_discount_type=pricing["applied_discount_type"],
            applied_discount_value=pricing["applied_discount_value"],
            paid_amount=payment_collected,
            balance_due=total - payment_collected,
            payment_mode=sale_payment_mode,
            delivery_type=Sale.DeliveryType.DELIVERY,
            delivery_staff=display_name(delivery.staff),
            sold_by=request.user,
            note=f"Booking #{booking.order_id}",
        )
        SaleItem.objects.create(
            sale=sale,
            cylinder_type=booking.cylinder_type,
            quantity=booking.quantity,
            rate=pricing["effective_rate"],
            total_amount=total,
            empty_returned=empty_collected,
        )
        if payment_collected > 0:
            if parsed_splits:
                for index, (amt, mode) in enumerate(parsed_splits):
                    if amt > 0:
                        Payment.objects.create(
                            customer=profile, sale=sale, amount=amt,
                            payment_mode=mode, received_by=request.user,
                            note="Delivery collection (split)", empty_collected=empty_collected if index == 0 else 0,
                        )
            else:
                actual_payment_mode = paid_payment_mode if sale_payment_mode == Sale.PaymentMode.CREDIT and paid_payment_mode else payment_method
                Payment.objects.create(
                    customer=profile,
                    sale=sale,
                    amount=payment_collected,
                    payment_mode=actual_payment_mode,
                    received_by=request.user,
                    note="Delivery collection",
                    empty_collected=empty_collected,
                )

        delivery.status = Delivery.Status.DELIVERED
        delivery.payment_collected = payment_collected
        delivery.payment_method = payment_method
        delivery.empty_collected = empty_collected
        delivery.completed_at = timezone.now()
        delivery.note = note
        delivery.save()

        booking.status = Booking.Status.DELIVERED
        booking.payment_status = "PAID" if payment_collected >= total or booking.payment_method.upper() == "ONLINE" else "COLLECTED"
        booking.delivered_at = delivery.completed_at
        booking.sale = sale
        booking.save(update_fields=["status", "payment_status", "delivered_at", "sale", "updated_at"])

        ActivityLog.objects.create(
            action="delivery_completed",
            description=f"Delivered booking #{booking.order_id} for Rs. {total}",
            user=request.user,
            metadata={
                "booking_id": booking.id,
                "sale_id": sale.id,
                "delivery_id": delivery.id,
                "location": location.code,
                "filled_after": filled.quantity,
                "empty_after": empty.quantity if empty is not None else None,
                "empty_collected": empty_collected,
            },
        )

        staff_name = display_name(delivery.staff)

        customer_msg = f"Your GasBook order #{booking.order_id} has been delivered successfully."
        if booking.payment_method.upper() == "COD" and payment_collected > 0:
            customer_msg += f" Payment of ₹{payment_collected} was collected successfully."

        notify(profile.user, booking, "ORDER_DELIVERED", "Order Delivered", customer_msg, dedupe=True)
        for admin in admin_users():
            notify(
                admin,
                booking,
                "ORDER_DELIVERED",
                "Order Delivered",
                f"Order #{booking.order_id} was delivered by {staff_name}.",
                dedupe=True,
            )

        return Response(DeliverySerializer(delivery).data)


@api_view(["GET", "POST", "DELETE"])
@permission_classes([permissions.IsAuthenticated])
def customer_credentials(request, pk):
    """GET: return username for a customer profile. POST: reset their password."""
    if (getattr(request.user.role, "code", "") != "admin") and not request.user.is_superuser:
        return Response({"detail": "Admin only."}, status=drf_status.HTTP_403_FORBIDDEN)
    try:
        profile = CustomerProfile.objects.get(pk=pk)
    except ObjectDoesNotExist:
        return Response({"detail": "Not found."}, status=drf_status.HTTP_404_NOT_FOUND)
    
    user = profile.user
    if request.method == "GET":
        return Response({
            "username": user.username,
            "full_name": user.get_full_name() or user.username,
            "is_active": user.is_active,
        })
    if request.method == "DELETE":
        with transaction.atomic():
            return Response(delete_customer(profile, request.user))

    # A password reset must not silently reactivate a deactivated account.
    new_password = request.data.get("password", "").strip() or get_random_string(length=12)
    user.set_password(new_password)
    user.plain_password = ""
    user.must_change_password = True
    user.save(update_fields=["password", "plain_password", "must_change_password"])
    return Response({"detail": "Temporary password generated.", "username": user.username, "temporary_password": new_password})


def money_sum(queryset, field):
    return queryset.aggregate(total=Sum(field))["total"] or 0


def serialize_me(request):
    redirects = {
        "admin": "/admin-dashboard",
        "staff": "/staff-dashboard",
        "customer": "/customer-dashboard",
    }
    location_name = None
    assigned_area = None
    vehicle_number = None
    staff_image_url = None
    if (getattr(request.user.role, "code", "") == "staff") and hasattr(request.user, "staff_profile"):
        loc = request.user.staff_profile.vehicle_location
        if loc:
            location_name = loc.name
        assigned_area = request.user.staff_profile.assigned_area or None
        vehicle_number = request.user.staff_profile.vehicle_number or None
        if request.user.staff_profile.image:
            staff_image_url = request.build_absolute_uri(request.user.staff_profile.image.url)
            
    return {
        "id": request.user.id,
        "username": request.user.username,
        "name": request.user.get_full_name() or request.user.username,
        "role": getattr(request.user.role, "code", ""),
        "phone": request.user.phone,
        "email": request.user.email,
        "address": request.user.address,
        "date_joined": request.user.date_joined,
        "redirect": redirects.get(getattr(request.user.role, "code", ""), "/"),
        "must_change_password": bool(getattr(request.user, "must_change_password", False)),
        "vehicle_location_name": location_name,
        "assigned_area": assigned_area,
        "vehicle_number": vehicle_number,
        "staff_image_url": staff_image_url,
    }


@api_view(["GET", "PATCH"])
@permission_classes([permissions.IsAuthenticated])
def me(request):
    if request.method == "PATCH":
        contact = validate_user_contact(request.data)

        if "full_name" in contact:
            request.user.first_name, request.user.last_name = split_full_name(contact["full_name"])
        if "phone" in contact:
            request.user.phone = contact["phone"]
        if "email" in contact:
            request.user.email = contact["email"]
        if "address" in contact:
            request.user.address = contact["address"]

        request.user.save(update_fields=["first_name", "last_name", "phone", "email", "address"])

    return Response(serialize_me(request))


@api_view(["GET"])
@permission_classes([permissions.IsAuthenticated])
def users_list(request):
    if (getattr(request.user.role, "code", "") != "admin") and not request.user.is_superuser:
        return Response({"detail": "Admin only."}, status=drf_status.HTTP_403_FORBIDDEN)
    users = User.objects.exclude(role__code="customer").select_related("role", "staff_profile").order_by("username")
    data = []
    for u in users:
        data.append({
            "id": u.id,
            "username": u.username,
            "first_name": u.first_name,
            "last_name": u.last_name,
            "role": getattr(u.role, "code", ""),
            "is_active": u.is_active,
            "phone": u.phone,
            "email": u.email,
            "address": u.address,
            "staff_image_url": get_staff_image_url(request, u),
        })
    return Response(data)

@api_view(["GET"])
@permission_classes([permissions.IsAuthenticated])
def roles_list(request):
    if (getattr(request.user.role, "code", "") != "admin") and not request.user.is_superuser:
        raise PermissionDenied("Only admins can view roles.")
    roles = Role.objects.exclude(code="customer").values("code", "name").order_by("name")
    return Response(list(roles))


@api_view(["PATCH", "DELETE"])
@permission_classes([permissions.IsAuthenticated])
def user_detail(request, pk):
    if (getattr(request.user.role, "code", "") != "admin") and not request.user.is_superuser:
        return Response({"detail": "Admin only."}, status=drf_status.HTTP_403_FORBIDDEN)
    try:
        user = User.objects.exclude(role__code="customer").select_related("role", "staff_profile").get(pk=pk)
    except ObjectDoesNotExist:
        return Response({"detail": "Not found."}, status=drf_status.HTTP_404_NOT_FOUND)
    if request.method == "DELETE":
        with transaction.atomic():
            return Response(delete_user(user, request.user))

    contact = validate_user_contact(request.data)
    if "phone" in contact and not contact["phone"]:
        raise ApiError("Phone required.", code="required", field="phone")

    with transaction.atomic():
        if "full_name" in contact:
            user.first_name, user.last_name = split_full_name(contact["full_name"])
        if "phone" in contact:
            user.phone = contact["phone"]
        if "address" in contact:
            user.address = contact["address"]
        if "email" in contact:
            user.email = contact["email"]

        user.save(update_fields=["first_name", "last_name", "phone", "address", "email"])

        new_image = request.FILES.get("image")
        remove_image = str(request.data.get("remove_staff_image", "")).strip().lower() in {"1", "true", "yes", "on"}
        # Work on the instance cached by select_related so the response reflects the
        # saved state (a second StaffProfile instance would leave the cache stale).
        profile = getattr(user, "staff_profile", None)
        if profile is None and getattr(getattr(user, "role", None), "code", "") == "staff":
            profile = StaffProfile.objects.create(user=user)
        if profile is not None:
            if remove_image and profile.image:
                profile.image.delete(save=False)
                profile.image = None
            if new_image:
                if profile.image:
                    profile.image.delete(save=False)
                profile.image = new_image
            if remove_image or new_image:
                profile.save(update_fields=["image", "updated_at"])
            user.staff_profile = profile

    return Response({
        **UserSerializer(user).data,
        "staff_image_url": get_staff_image_url(request, user),
    })


def _admin_user_or_response(request, pk):
    if (getattr(request.user.role, "code", "") != "admin") and not request.user.is_superuser:
        return None, Response({"detail": "Admin only."}, status=drf_status.HTTP_403_FORBIDDEN)
    try:
        user = User.objects.exclude(role__code="customer").select_related("role", "staff_profile").get(pk=pk)
    except ObjectDoesNotExist:
        return None, Response({"detail": "Not found."}, status=drf_status.HTTP_404_NOT_FOUND)
    return user, None


@api_view(["POST"])
@permission_classes([permissions.IsAuthenticated])
def user_deactivate(request, pk):
    user, error = _admin_user_or_response(request, pk)
    if error is not None:
        return error
    with transaction.atomic():
        user = deactivate_user(user, request.user)
    return Response({
        "detail": "User deactivated. History is preserved.",
        "mode": "deactivated",
        "default_staff_customers": default_staff_customers(user),
        "user": {**UserSerializer(user).data, "staff_image_url": get_staff_image_url(request, user)},
    })


@api_view(["POST"])
@permission_classes([permissions.IsAuthenticated])
def user_reactivate(request, pk):
    user, error = _admin_user_or_response(request, pk)
    if error is not None:
        return error
    with transaction.atomic():
        user = reactivate_user(user, request.user)
    return Response({
        "detail": "User reactivated.",
        "mode": "reactivated",
        "user": {**UserSerializer(user).data, "staff_image_url": get_staff_image_url(request, user)},
    })


# Row status (and ``status`` filter value) of a booking the staff member handed over.
HANDED_OVER_STATUS = "reassigned"


def build_staff_history_row(booking, staff, detail, names):
    """One row of a staff history: the booking's Delivery when it is ``staff``'s
    (``involvement: current``), else the handover read from the ActivityLog
    (``involvement: previous``) with booking-level data only."""
    to_datetime = DateTimeField().to_representation
    try:
        delivery = booking.delivery
    except Delivery.DoesNotExist:
        delivery = None

    if delivery is not None and delivery.staff_id == staff.id:
        from_id = detail.get("reassigned_from_id")
        decline = detail.get("previous_decline")
        return {
            **StaffDeliveryHistorySerializer(delivery).data,
            "involvement": "current",
            "handover": None,
            "reassigned_from": {"staff_id": from_id, "staff_name": names.get(from_id)} if from_id else None,
            "previous_decline": (
                {"reason": decline["reason"], "declined_at": to_datetime(decline["declined_at"])} if decline else None
            ),
        }

    handover = detail["handover"]
    return {
        **{field: None for field in StaffDeliveryHistorySerializer.Meta.fields},
        **StaffHandoverBookingSerializer(booking).data,
        "status": HANDED_OVER_STATUS,
        "involvement": "previous",
        "handover": {
            **handover,
            "handed_over_at": to_datetime(handover["handed_over_at"]),
            "to_staff_name": names.get(handover["to_staff_id"]),
        },
        "reassigned_from": None,
        "previous_decline": None,
    }


@api_view(["GET"])
@permission_classes([permissions.IsAuthenticated])
def user_deliveries(request, pk):
    """Delivery history of one staff member: one row per booking.

    ``involvement: current`` rows are the bookings whose Delivery is theirs now
    (``Delivery.staff``). ``involvement: previous`` rows are bookings they handed over —
    declined, or re-assigned by an admin — read from the ActivityLog, which only exists
    from ``history_since``; earlier handovers are not recoverable and not listed.

    Query params: ``status`` (comma-separated delivery statuses, plus ``reassigned`` for
    handed-over rows), ``start`` / ``end`` (booking date, YYYY-MM-DD), ``search`` (order id
    or customer name/phone), ``page``, ``page_size``. ``summary`` covers the date range
    only, not ``status`` / ``search``; its delivery counts are current rows only.
    """
    user, error = _admin_user_or_response(request, pk)
    if error is not None:
        return error

    start_str = (request.query_params.get("start") or "").strip()
    end_str = (request.query_params.get("end") or "").strip()
    try:
        start = date.fromisoformat(start_str) if start_str else None
        end = date.fromisoformat(end_str) if end_str else None
    except ValueError:
        return Response(
            {"detail": "Invalid date. Use YYYY-MM-DD.", "code": "invalid_date"},
            status=drf_status.HTTP_400_BAD_REQUEST,
        )
    if start and end and start > end:
        return Response(
            {"detail": "Start date must be on or before end date.", "code": "invalid_range", "start": start_str, "end": end_str},
            status=drf_status.HTTP_400_BAD_REQUEST,
        )

    deliveries = Delivery.objects.filter(staff=user)
    if start:
        deliveries = deliveries.filter(booking__created_at__date__gte=start)
    if end:
        deliveries = deliveries.filter(booking__created_at__date__lte=end)

    summary = deliveries.aggregate(
        total=Count("id"),
        delivered=Count("id", filter=Q(status=Delivery.Status.DELIVERED)),
        active=Count("id", filter=Q(status__in=OPEN_DELIVERY_STATUSES)),
        cancelled=Count("id", filter=Q(status=Delivery.Status.CANCELLED)),
        declined=Count("id", filter=Q(status=Delivery.Status.REJECTED)),
        collected=Sum("payment_collected", filter=Q(status=Delivery.Status.DELIVERED)),
    )
    summary["collected"] = serialize_decimal(summary["collected"] or 0)

    handovers = staff_handovers(user)
    bookings = Booking.objects.all()
    if start:
        bookings = bookings.filter(created_at__date__gte=start)
    if end:
        bookings = bookings.filter(created_at__date__lte=end)
    summary["reassigned"] = bookings.filter(pk__in=list(handovers)).count()

    statuses = [s.strip() for s in (request.query_params.get("status") or "").split(",") if s.strip()]
    scope = Q(delivery__staff=user)
    if statuses:
        scope &= Q(delivery__status__in=[s for s in statuses if s != HANDED_OVER_STATUS])
    if handovers and (not statuses or HANDED_OVER_STATUS in statuses):
        scope |= Q(pk__in=list(handovers))
    bookings = bookings.filter(scope)
    term = (request.query_params.get("search") or "").strip()
    if term:
        query = user_search_q(term, prefix="customer__user__")
        order_match = re.fullmatch(r"#?(?:GB)?(\d+)", term, re.IGNORECASE)
        if order_match:
            query |= Q(pk=int(order_match.group(1)))
        bookings = bookings.filter(query)

    bookings = bookings.select_related(
        "customer__user", "cylinder_type", "sale", "delivery"
    ).prefetch_related(
        "customer__custom_rates",
        "customer__cylinder_discounts__cylinder_type",
    ).order_by("-created_at", "-id")

    paginator = StandardPagination()
    page = paginator.paginate_queryset(bookings, request)
    details = staff_assignment_details(user, [booking.pk for booking in page], handovers)
    staff_ids = {d["handover"]["to_staff_id"] for d in details.values() if "handover" in d}
    staff_ids |= {d["reassigned_from_id"] for d in details.values() if d.get("reassigned_from_id")}
    names = {u.id: display_name(u) for u in User.objects.filter(pk__in=[i for i in staff_ids if i is not None])}
    data = [build_staff_history_row(booking, user, details.get(booking.pk, {}), names) for booking in page]
    logging_since = assignment_logging_started_at()
    staff_profile = getattr(user, "staff_profile", None)
    vehicle_location = staff_profile.vehicle_location if staff_profile else None
    return Response({
        **paginator.get_paginated_response(data).data,
        "summary": summary,
        "history_since": DateTimeField().to_representation(logging_since) if logging_since else None,
        "staff": {
            **UserSerializer(user).data,
            "staff_image_url": get_staff_image_url(request, user),
            "assigned_area": staff_profile.assigned_area if staff_profile else "",
            "vehicle_number": staff_profile.vehicle_number if staff_profile else "",
            "vehicle_location_name": vehicle_location.name if vehicle_location else None,
        },
    })


@api_view(["GET", "POST"])
@permission_classes([permissions.IsAuthenticated])
def user_credentials(request, pk):
    if (getattr(request.user.role, "code", "") != "admin") and not request.user.is_superuser:
        return Response({"detail": "Admin only."}, status=drf_status.HTTP_403_FORBIDDEN)
    try:
        user = User.objects.exclude(role__code="customer").get(pk=pk)
    except ObjectDoesNotExist:
        return Response({"detail": "Not found."}, status=drf_status.HTTP_404_NOT_FOUND)
    if request.method == "GET":
        return Response({
            "username": user.username,
            "full_name": user.get_full_name() or user.username,
            "is_active": user.is_active,
        })
    # A password reset must not silently reactivate a deactivated account.
    new_password = request.data.get("password", "").strip() or get_random_string(length=12)
    user.set_password(new_password)
    user.plain_password = ""
    user.must_change_password = True
    user.save(update_fields=["password", "plain_password", "must_change_password"])
    return Response({"detail": "Temporary password generated.", "username": user.username, "temporary_password": new_password})


@api_view(["POST"])
@permission_classes([permissions.IsAuthenticated])
def change_password(request):
    current_password = (request.data.get("current_password") or "").strip()
    new_password = (request.data.get("new_password") or "").strip()
    confirm_password = (request.data.get("confirm_new_password") or "").strip()

    if not current_password or not new_password or not confirm_password:
        return Response({"detail": "Current password, new password, and confirmation are required."}, status=drf_status.HTTP_400_BAD_REQUEST)
    if new_password != confirm_password:
        return Response({"detail": "New passwords do not match."}, status=drf_status.HTTP_400_BAD_REQUEST)

    user = authenticate(username=request.user.username, password=current_password)
    if user is None or user.id != request.user.id:
        return Response({"detail": "Current password is incorrect."}, status=drf_status.HTTP_400_BAD_REQUEST)

    try:
        validate_password(new_password, user=request.user)
    except Exception as exc:
        return Response({"detail": " ".join(exc.messages) if hasattr(exc, "messages") else str(exc)}, status=drf_status.HTTP_400_BAD_REQUEST)

    request.user.set_password(new_password)
    request.user.must_change_password = False
    request.user.plain_password = ""
    request.user.save(update_fields=["password", "must_change_password", "plain_password"])
    return Response({"detail": "Password updated successfully."})


@api_view(["POST"])
@permission_classes([permissions.IsAuthenticated])
@transaction.atomic
def register(request):
    if (getattr(request.user.role, "code", "") != "admin") and not request.user.is_superuser:
        return Response({"detail": "Admin only."}, status=drf_status.HTTP_403_FORBIDDEN)
    contact = validate_user_contact(request.data)
    username = contact.get("username", "")
    password = str(request.data.get("password", "") or "").strip() or get_random_string(length=12)
    full_name = contact.get("full_name", "")
    role = request.data.get("role", "staff")
    phone = contact.get("phone", "")
    email = contact.get("email", "")
    address = contact.get("address", "")
    area = contact.get("area", "")
    vehicle_number = contact.get("vehicle_number", "")
    staff_image = request.FILES.get("image")
    if not username:
        return Response({"detail": "Username required.", "code": "required", "field": "username"}, status=drf_status.HTTP_400_BAD_REQUEST)
    if not phone:
        return Response({"detail": "Phone required.", "code": "required", "field": "phone"}, status=drf_status.HTTP_400_BAD_REQUEST)
    if User.objects.filter(username=username).exists():
        return Response({"detail": "Username already exists."}, status=drf_status.HTTP_400_BAD_REQUEST)
    if role not in [r.code for r in Role.objects.all()]:
        return Response({"detail": "Invalid role."}, status=drf_status.HTTP_400_BAD_REQUEST)
    first_name, last_name = split_full_name(full_name)
    user = User.objects.create_user(
        username=username,
        password=password,
        first_name=first_name,
        last_name=last_name,
        email=email,
        role=Role.objects.get(code=role),
        plain_password="",
        must_change_password=True,
        phone=phone,
        address=address,
    )
    if role == "customer":
        CustomerProfile.objects.create(
            user=user,
            area=area,
            default_staff_id=request.data.get("default_staff") or None,
            credit_limit=request.data.get("credit_limit") or 0,
            deposit_cylinders=request.data.get("deposit_cylinders") or 0,
            opening_balance=request.data.get("opening_balance") or 0,
        )
    elif role == "staff":
        StaffProfile.objects.create(
            user=user,
            assigned_area=area,
            vehicle_number=vehicle_number,
            vehicle_location_id=request.data.get("vehicle_location") or None,
            image=staff_image,
        )
    response_data = UserSerializer(user).data
    if str(request.data.get("password", "") or "").strip() == "":
        response_data["temporary_password"] = password
    return Response(response_data, status=drf_status.HTTP_201_CREATED)


@api_view(["GET"])
@permission_classes([permissions.IsAuthenticated])
def dashboard(request):
    user_role_code = getattr(getattr(request.user, "role", None), "code", "")
    if user_role_code not in ["admin", "staff"] and not request.user.is_superuser:
        return Response({"detail": "Admin or staff only."}, status=drf_status.HTTP_403_FORBIDDEN)
    today = timezone.localdate()
    stocks = Stock.objects.select_related("cylinder_type", "location")
    filled = stocks.filter(status=Stock.Status.FILLED).aggregate(total=Sum("quantity"))["total"] or 0
    empty = stocks.filter(status=Stock.Status.EMPTY).aggregate(total=Sum("quantity"))["total"] or 0
    shop_stock = stocks.filter(location__code="shop").aggregate(total=Sum("quantity"))["total"] or 0
    kandam_stock = stocks.filter(location__code="kandam").aggregate(total=Sum("quantity"))["total"] or 0
    today_sales = Sale.objects.filter(created_at__date=today)
    today_payments = Payment.objects.filter(created_at__date=today)
    pending = Sale.objects.aggregate(total=Sum("balance_due"))["total"] or 0
    pending_deliveries = Booking.objects.filter(
        status__in=[Booking.Status.APPROVED, Booking.Status.ACCEPTED, Booking.Status.OUT_FOR_DELIVERY]
    ).count()
    today_bookings = Booking.objects.filter(created_at__date=today).count()
    staff_live_status = [
        {
            "id": staff.id,
            "name": staff.get_full_name() or staff.username,
            "area": staff.staff_profile.assigned_area if hasattr(staff, "staff_profile") else "",
            "active": staff.staff_profile.is_active if hasattr(staff, "staff_profile") else staff.is_active,
            "assigned_deliveries": staff.deliveries.exclude(
                status__in=[Delivery.Status.DELIVERED, Delivery.Status.REJECTED, Delivery.Status.CANCELLED]
            ).count(),
        }
        for staff in User.objects.filter(role__code="staff").prefetch_related("deliveries")
    ]

    low_stock = [
        {
            "cylinder_type": stock.cylinder_type.name,
            "location": stock.location.name,
            "status": stock.status,
            "quantity": stock.quantity,
            "threshold": stock.cylinder_type.low_stock_threshold,
        }
        for stock in stocks
        if stock.status == Stock.Status.FILLED
        and stock.quantity > 0
        and stock.quantity <= stock.cylinder_type.low_stock_threshold
    ]

    # Calculate with_customers correctly by summing physical possession per customer per cylinder type
    # Using a chronological running balance where returned empties pay off existing debt first,
    # and excess returns (banked credits) do NOT artificially lower the debt below 0.
    customers = CustomerProfile.objects.prefetch_related("sales__items__cylinder_type")
    with_customers_by_type = {c.id: 0 for c in CylinderType.objects.filter(is_active=True)}
    
    for customer in customers:
        # We must process sales chronologically to maintain the correct running balance
        sales = customer.sales.order_by("created_at")
        balances = {} # tid -> debt
        
        for sale in sales:
            for item in sale.items.all():
                tid = item.cylinder_type_id
                if tid not in balances:
                    balances[tid] = 0
                
                taken = item.quantity
                returned = item.empty_returned
                
                # 1. Returned empties pay off existing debt first
                payoff = min(balances[tid], returned)
                balances[tid] -= payoff
                
                # 2. Taken cylinders ALWAYS increase debt
                balances[tid] += taken
                
        for tid, debt in balances.items():
            if tid in with_customers_by_type and debt > 0:
                with_customers_by_type[tid] += debt

    stock_rows = []
    for cylinder in CylinderType.objects.filter(is_active=True):
        cylinder_stocks = stocks.filter(cylinder_type=cylinder)
        with_customers = with_customers_by_type.get(cylinder.id, 0)
        stock_rows.append(
            {
                "id": cylinder.id,
                "type": cylinder.name,
                "filled": cylinder_stocks.filter(status=Stock.Status.FILLED).aggregate(total=Sum("quantity"))["total"] or 0,
                "empty": cylinder_stocks.filter(status=Stock.Status.EMPTY).aggregate(total=Sum("quantity"))["total"] or 0,
                "shop_filled": cylinder_stocks.filter(location__code="shop", status=Stock.Status.FILLED).aggregate(total=Sum("quantity"))["total"] or 0,
                "shop_empty": cylinder_stocks.filter(location__code="shop", status=Stock.Status.EMPTY).aggregate(total=Sum("quantity"))["total"] or 0,
                "kandam_filled": cylinder_stocks.filter(location__code="kandam", status=Stock.Status.FILLED).aggregate(total=Sum("quantity"))["total"] or 0,
                "kandam_empty": cylinder_stocks.filter(location__code="kandam", status=Stock.Status.EMPTY).aggregate(total=Sum("quantity"))["total"] or 0,
                "total": (cylinder_stocks.aggregate(total=Sum("quantity"))["total"] or 0) + with_customers,
                "with_customers": with_customers,
            }
        )

    return Response(
        {
            "total_cylinders": filled + empty + sum(r["with_customers"] for r in stock_rows),
            "total_customers": CustomerProfile.objects.count(),
            "today_bookings": today_bookings,
            "pending_deliveries": pending_deliveries,
            "filled_cylinders": filled,
            "empty_cylinders": empty,
            "shop_stock": shop_stock,
            "kandam_stock": kandam_stock,
            "today_sales": money_sum(today_sales, "total_amount"),
            "today_collection": money_sum(today_payments, "amount"),
            "pending_payments": pending,
            "staff_live_status": staff_live_status,
            "low_stock": low_stock,
            "stock_rows": stock_rows,
            "recent_activity": ActivityLogSerializer(ActivityLog.objects.all()[:8], many=True).data,
        }
    )


@api_view(["GET"])
@permission_classes([permissions.IsAuthenticated])
def reports(request):
    if (getattr(request.user.role, "code", "") != "admin") and not request.user.is_superuser:
        return Response({"detail": "Admin only."}, status=drf_status.HTTP_403_FORBIDDEN)
    today = timezone.localdate()
    start_str = request.query_params.get("start") or today.isoformat()
    end_str = request.query_params.get("end") or today.isoformat()
    try:
        start = date.fromisoformat(start_str)
        end = date.fromisoformat(end_str)
    except (TypeError, ValueError):
        return Response(
            {"detail": "Invalid date. Use YYYY-MM-DD.", "code": "invalid_date"},
            status=drf_status.HTTP_400_BAD_REQUEST,
        )
    if start > end:
        return Response(
            {
                "detail": "Start date must be on or before end date.",
                "code": "invalid_range",
                "start": start_str,
                "end": end_str,
            },
            status=drf_status.HTTP_400_BAD_REQUEST,
        )
    month_start = today.replace(day=1)

    range_sales = Sale.objects.filter(created_at__date__gte=start, created_at__date__lte=end)
    range_payments = Payment.objects.filter(created_at__date__gte=start, created_at__date__lte=end)
    range_expenses = Expense.objects.filter(created_at__date__gte=start, created_at__date__lte=end)
    range_movements = StockMovement.objects.filter(created_at__date__gte=start, created_at__date__lte=end)
    cylinder_sales = (
        SaleItem.objects.filter(sale__created_at__date__gte=start, sale__created_at__date__lte=end)
        .values("cylinder_type__name", "sale__location__name", "sale__sold_by__role")
        .annotate(total_qty=Sum("quantity"), total_amount=Sum("total_amount"))
        .order_by("cylinder_type__name")
    )

    pending_sales = (
        Sale.objects.filter(balance_due__gt=0)
        .select_related("customer__user")
        .values("customer__user__first_name", "customer__user__last_name", "customer__user__phone")
        .annotate(total_due=Sum("balance_due"), sale_count=Count("id"))
        .order_by("-total_due")
    )

    range_sales_list = SaleSerializer(
        range_sales.select_related("customer__user", "location", "sold_by").prefetch_related("items__cylinder_type"),
        many=True,
    ).data

    range_expense_list = ExpenseSerializer(
        range_expenses.select_related("spent_by"),
        many=True,
    ).data

    stocks = Stock.objects.select_related("cylinder_type", "location")
    stock_snapshot = []
    
    # Calculate with_customers correctly by summing physical possession per customer per cylinder type
    # Using a chronological running balance
    customers = CustomerProfile.objects.prefetch_related("sales__items__cylinder_type", "custom_rates")
    with_customers_by_type = {c.id: 0 for c in CylinderType.objects.filter(is_active=True)}
    customer_credits_by_type = {c.id: 0 for c in CylinderType.objects.filter(is_active=True)}
    
    for customer in customers:
        sales = customer.sales.filter(created_at__date__lte=end).order_by("created_at")
        custom_rates = {cr.cylinder_type_id: cr.custom_price for cr in customer.custom_rates.all()}
        balances = {} # tid -> {owed, credits}
        
        for sale in sales:
            for item in sale.items.all():
                tid = item.cylinder_type_id
                if tid not in balances:
                    balances[tid] = {"owed": 0, "credits": 0}
                
                returned_qty = item.empty_returned
                balances[tid]["owed"] -= returned_qty
                if balances[tid]["owed"] < 0:
                    balances[tid]["credits"] += abs(balances[tid]["owed"])
                    balances[tid]["owed"] = 0
                
                taken_qty = item.quantity
                balances[tid]["owed"] += taken_qty
                
                refill_rate = custom_rates.get(tid, item.cylinder_type.refill_rate)
                threshold = (item.cylinder_type.selling_price + refill_rate) / 2
                
                if item.rate <= threshold and taken_qty > 0:
                    credits_needed = max(0, taken_qty - returned_qty)
                    balances[tid]["credits"] -= credits_needed
                    if balances[tid]["credits"] < 0:
                        balances[tid]["credits"] = 0
                
        for tid, data in balances.items():
            if tid in with_customers_by_type and data["owed"] > 0:
                with_customers_by_type[tid] += data["owed"]
            if tid in customer_credits_by_type and data["credits"] > 0:
                customer_credits_by_type[tid] += data["credits"]
                    
    for cylinder in CylinderType.objects.filter(is_active=True):
        cstocks = stocks.filter(cylinder_type=cylinder)
        with_customers = with_customers_by_type.get(cylinder.id, 0)
        customer_credits = customer_credits_by_type.get(cylinder.id, 0)
        
        shop_filled = cstocks.filter(location__code="shop", status="filled").aggregate(t=Sum("quantity"))["t"] or 0
        shop_empty = cstocks.filter(location__code="shop", status="empty").aggregate(t=Sum("quantity"))["t"] or 0
        kandam_filled = cstocks.filter(location__code="kandam", status="filled").aggregate(t=Sum("quantity"))["t"] or 0
        kandam_empty = cstocks.filter(location__code="kandam", status="empty").aggregate(t=Sum("quantity"))["t"] or 0
        
        stock_snapshot.append({
            "type": cylinder.name,
            "shop_filled": shop_filled,
            "shop_empty": shop_empty,
            "kandam_filled": kandam_filled,
            "kandam_empty": kandam_empty,
            "with_customers": with_customers,
            "customer_credits": customer_credits,
            "supplier_stock": shop_filled + shop_empty + kandam_filled + kandam_empty + with_customers - customer_credits,
            "physical_stock": shop_filled + shop_empty + kandam_filled + kandam_empty,
        })

    range_loads = range_movements.filter(
        Q(from_location__code="supplier") | Q(from_location__is_main_supplier=True),
        status="filled"
    ).exclude(note="Received refilled cylinders")
    load_summary = (
        range_loads.values("cylinder_type__name", "to_location__name")
        .annotate(total_qty=Sum("quantity"))
        .order_by("cylinder_type__name")
    )
    
    supplier_balance = []
    supplier_movements = StockMovement.objects.filter(
        Q(from_location__code="supplier") | Q(to_location__code="supplier") | 
        Q(from_location__is_main_supplier=True) | Q(to_location__is_main_supplier=True)
    ).order_by("created_at")
    
    for cylinder in CylinderType.objects.filter(is_active=True):
        movements = supplier_movements.filter(cylinder_type=cylinder)
        sent_total = 0
        received_total = 0
        pending = 0
        
        for m in movements:
            is_to_supplier = (m.to_location.code == "supplier" or m.to_location.is_main_supplier)
            is_from_supplier = (m.from_location.code == "supplier" or m.from_location.is_main_supplier)
            
            if is_to_supplier and m.status == "empty":
                sent_total += m.quantity
                pending += m.quantity
            elif is_from_supplier and m.status == "filled" and m.note != "New supplier load":
                received_total += m.quantity
                pending = max(0, pending - m.quantity)
        
        if sent_total > 0 or received_total > 0:
            supplier_balance.append({
                "type": cylinder.name,
                "sent_empty": sent_total,
                "received_filled": received_total,
                "pending": pending,
            })

    return Response(
        {
            "range": {"start": start_str, "end": end_str},
            "summary": {
                "sales": money_sum(range_sales, "total_amount"),
                "collection": money_sum(range_payments, "amount"),
                "expenses": money_sum(range_expenses, "amount"),
                "movements": range_movements.count(),
                "pending": Sale.objects.aggregate(total=Sum("balance_due"))["total"] or 0,
            },
            "monthly": {
                "sales": money_sum(Sale.objects.filter(created_at__date__gte=month_start), "total_amount"),
                "collection": money_sum(Payment.objects.filter(created_at__date__gte=month_start), "amount"),
                "expenses": money_sum(Expense.objects.filter(created_at__date__gte=month_start), "amount"),
            },
            "cylinder_sales": list(cylinder_sales),
            "pending_dues": list(pending_sales),
            "sales_list": range_sales_list,
            "expense_list": range_expense_list,
            "stock_snapshot": stock_snapshot,
            "supplier_balance": supplier_balance,
            "load_summary": list(load_summary),
            "movement_history": StockMovementSerializer(
                range_movements.select_related("cylinder_type", "from_location", "to_location", "moved_by"),
                many=True,
            ).data,
            "expense_breakdown": list(
                range_expenses.values("category").annotate(total=Sum("amount")).order_by("category")
            ),
        }
    )
