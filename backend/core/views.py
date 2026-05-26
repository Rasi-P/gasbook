from decimal import Decimal

from django.db import transaction
from django.db.models import Q, Sum
from django.utils import timezone
from rest_framework import permissions, viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response
from rest_framework import status as drf_status

from .models import (
    ActivityLog, Booking, Customer, CustomerCylinderRate, CustomerProfile,
    CylinderType, Delivery, Expense, Notification, Payment, Sale, SaleItem,
    StaffProfile, Stock, StockLocation, StockMovement, User,
)
from .serializers import (
    ActivityLogSerializer,
    BookingSerializer,
    CustomerSerializer,
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
    StaffProfileSerializer,
    UserSerializer,
    get_stock_row,
)


class IsAdminOrReadOnly(permissions.BasePermission):
    def has_permission(self, request, view):
        if request.method in permissions.SAFE_METHODS:
            return True
        return getattr(request.user, "role", "") == "admin" or request.user.is_superuser


class IsAdminUserRole(permissions.BasePermission):
    def has_permission(self, request, view):
        return getattr(request.user, "role", "") == "admin" or request.user.is_superuser


class IsStaffOrAdmin(permissions.BasePermission):
    def has_permission(self, request, view):
        return getattr(request.user, "role", "") in ["admin", "staff"] or request.user.is_superuser


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


class CustomerViewSet(viewsets.ModelViewSet):
    queryset = Customer.objects.prefetch_related("sales__items", "payments")
    serializer_class = CustomerSerializer
    permission_classes = [IsStaffOrAdmin]
    search_fields = ["name", "phone"]

    def get_queryset(self):
        queryset = super().get_queryset()
        term = self.request.query_params.get("search")
        if term:
            queryset = queryset.filter(Q(name__icontains=term) | Q(phone__icontains=term))
        return queryset

    @action(detail=True, methods=["get"])
    def ledger(self, request, pk=None):
        customer = self.get_object()
        sales = SaleSerializer(customer.sales.prefetch_related("items__cylinder_type").all(), many=True).data
        payments = PaymentSerializer(customer.payments.all(), many=True).data
        return Response({"customer": CustomerSerializer(customer).data, "sales": sales, "payments": payments})


class SaleViewSet(viewsets.ModelViewSet):
    queryset = Sale.objects.select_related("customer", "location", "sold_by").prefetch_related("items__cylinder_type")
    serializer_class = SaleSerializer
    permission_classes = [IsStaffOrAdmin]

    def get_queryset(self):
        queryset = super().get_queryset()
        term = self.request.query_params.get("search")
        payment_mode = self.request.query_params.get("payment_mode")
        pending = self.request.query_params.get("pending")
        if term:
            queryset = queryset.filter(Q(customer__name__icontains=term) | Q(customer__phone__icontains=term))
        if payment_mode:
            queryset = queryset.filter(payment_mode=payment_mode)
        if pending == "1":
            queryset = queryset.filter(balance_due__gt=0)
        return queryset


class PaymentViewSet(viewsets.ModelViewSet):
    queryset = Payment.objects.select_related("customer", "sale", "received_by")
    serializer_class = PaymentSerializer
    permission_classes = [IsStaffOrAdmin]


class ExpenseViewSet(viewsets.ModelViewSet):
    queryset = Expense.objects.select_related("spent_by")
    serializer_class = ExpenseSerializer
    permission_classes = [IsAdminUserRole]


class ActivityLogViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = ActivityLog.objects.select_related("user")
    serializer_class = ActivityLogSerializer
    permission_classes = [IsAdminUserRole]


class CustomerProfileViewSet(viewsets.ModelViewSet):
    queryset = CustomerProfile.objects.select_related("user", "linked_customer", "default_staff").prefetch_related("custom_rates")
    serializer_class = CustomerProfileSerializer

    def get_permissions(self):
        if getattr(self.request.user, "role", "") == "customer":
            if self.request.method not in permissions.SAFE_METHODS:
                return [IsAdminUserRole()]
            return [permissions.IsAuthenticated()]
        return [IsAdminUserRole()]

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context["request"] = self.request
        return context

    def get_queryset(self):
        queryset = super().get_queryset()
        if getattr(self.request.user, "role", "") == "customer":
            return queryset.filter(user=self.request.user)
        area = self.request.query_params.get("area")
        active = self.request.query_params.get("active")
        if area:
            queryset = queryset.filter(area__icontains=area)
        if active in ["0", "1"]:
            queryset = queryset.filter(is_active=active == "1")
        return queryset


class StaffProfileViewSet(viewsets.ModelViewSet):
    queryset = StaffProfile.objects.select_related("user", "vehicle_location")
    serializer_class = StaffProfileSerializer
    permission_classes = [IsAdminUserRole]


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


class NotificationViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = NotificationSerializer

    def get_queryset(self):
        return Notification.objects.filter(recipient=self.request.user).select_related("booking")

    @action(detail=True, methods=["post"])
    def mark_read(self, request, pk=None):
        notification = self.get_object()
        notification.is_read = True
        notification.save(update_fields=["is_read", "updated_at"])
        return Response(NotificationSerializer(notification).data)


class BookingViewSet(viewsets.ModelViewSet):
    queryset = Booking.objects.select_related("customer__user", "cylinder_type", "assigned_staff", "sale")
    serializer_class = BookingSerializer

    def get_queryset(self):
        queryset = super().get_queryset()
        role = getattr(self.request.user, "role", "")
        if role == "customer":
            queryset = queryset.filter(customer__user=self.request.user)
        elif role == "staff":
            queryset = queryset.filter(assigned_staff=self.request.user)
        status_param = self.request.query_params.get("status")
        if status_param:
            queryset = queryset.filter(status=status_param)
        return queryset

    def perform_create(self, serializer):
        if getattr(self.request.user, "role", "") != "customer":
            raise PermissionDenied("Only customers can create booking requests.")
        serializer.save()

    @action(detail=True, methods=["post"], permission_classes=[IsAdminUserRole])
    def approve(self, request, pk=None):
        booking = self.get_object()
        staff_id = request.data.get("assigned_staff") or booking.customer.default_staff_id
        if not staff_id:
            return Response({"detail": "Assign delivery staff before approval."}, status=drf_status.HTTP_400_BAD_REQUEST)
        staff = User.objects.filter(id=staff_id, role=User.Role.STAFF, is_active=True).first()
        if not staff:
            return Response({"detail": "Valid active staff user is required."}, status=drf_status.HTTP_400_BAD_REQUEST)
        booking.status = Booking.Status.APPROVED
        booking.assigned_staff = staff
        booking.approved_by = request.user
        booking.approved_at = timezone.now()
        booking.save(update_fields=["status", "assigned_staff", "approved_by", "approved_at", "updated_at"])
        Delivery.objects.get_or_create(booking=booking, defaults={"staff": staff})
        Notification.objects.create(
            recipient=booking.customer.user,
            booking=booking,
            title="Booking Approved",
            body=f"Your {booking.cylinder_type.name} booking was approved.",
        )
        Notification.objects.create(
            recipient=staff,
            booking=booking,
            title="Delivery Assigned",
            body=f"{booking.customer} needs {booking.quantity} x {booking.cylinder_type.name}.",
        )
        return Response(BookingSerializer(booking, context={"request": request}).data)

    @action(detail=True, methods=["post"], permission_classes=[IsAdminUserRole])
    def reject(self, request, pk=None):
        booking = self.get_object()
        booking.status = Booking.Status.REJECTED
        booking.save(update_fields=["status", "updated_at"])
        Notification.objects.create(
            recipient=booking.customer.user,
            booking=booking,
            title="Booking Rejected",
            body=request.data.get("reason") or "Your booking was rejected.",
        )
        return Response(BookingSerializer(booking, context={"request": request}).data)


class DeliveryViewSet(viewsets.ModelViewSet):
    queryset = Delivery.objects.select_related("booking__customer__user", "booking__cylinder_type", "staff")
    serializer_class = DeliverySerializer
    permission_classes = [IsStaffOrAdmin]

    def get_queryset(self):
        queryset = super().get_queryset()
        if getattr(self.request.user, "role", "") == "staff":
            queryset = queryset.filter(staff=self.request.user)
        status_param = self.request.query_params.get("status")
        if status_param:
            queryset = queryset.filter(status=status_param)
        return queryset

    @action(detail=True, methods=["post"])
    def start(self, request, pk=None):
        delivery = self.get_object()
        if request.user.role == "staff" and delivery.staff_id != request.user.id:
            return Response({"detail": "This delivery is not assigned to you."}, status=drf_status.HTTP_403_FORBIDDEN)
        delivery.status = Delivery.Status.OUT_FOR_DELIVERY
        delivery.started_at = timezone.now()
        delivery.booking.status = Booking.Status.OUT_FOR_DELIVERY
        delivery.booking.save(update_fields=["status", "updated_at"])
        delivery.save(update_fields=["status", "started_at", "updated_at"])
        Notification.objects.create(
            recipient=delivery.booking.customer.user,
            booking=delivery.booking,
            title="Delivery Started",
            body=f"{delivery.staff.get_full_name() or delivery.staff.username} started your delivery.",
        )
        for admin in User.objects.filter(role=User.Role.ADMIN):
            Notification.objects.create(
                recipient=admin,
                booking=delivery.booking,
                title="Delivery Started",
                body=f"{delivery.staff} started booking #{delivery.booking_id}.",
            )
        return Response(DeliverySerializer(delivery).data)

    @action(detail=True, methods=["post"])
    @transaction.atomic
    def complete(self, request, pk=None):
        delivery = self.get_object()
        if request.user.role == "staff" and delivery.staff_id != request.user.id:
            return Response({"detail": "This delivery is not assigned to you."}, status=drf_status.HTTP_403_FORBIDDEN)
        if delivery.status == Delivery.Status.DELIVERED:
            return Response({"detail": "Delivery already completed."}, status=drf_status.HTTP_400_BAD_REQUEST)

        booking = delivery.booking
        profile = booking.customer
        customer = profile.linked_customer
        if not customer:
            customer = Customer.objects.create(
                name=profile.user.get_full_name() or profile.user.username,
                phone=profile.phone,
                address=profile.address,
            )
            profile.linked_customer = customer
            profile.save(update_fields=["linked_customer", "updated_at"])

        rate_obj = profile.custom_rates.filter(cylinder_type=booking.cylinder_type).first()
        rate = rate_obj.custom_price if rate_obj else booking.cylinder_type.selling_price
        total = Decimal(booking.quantity) * rate
        payment_collected = Decimal(str(request.data.get("payment_collected", "0") or "0"))
        if payment_collected < 0 or payment_collected > total:
            return Response({"detail": "Collected amount must be between 0 and sale total."}, status=drf_status.HTTP_400_BAD_REQUEST)

        payment_method = request.data.get("payment_method") or Sale.PaymentMode.CREDIT
        empty_collected = int(request.data.get("empty_collected", 0) or 0)
        location = getattr(delivery.staff, "staff_profile", None).vehicle_location if hasattr(delivery.staff, "staff_profile") else None
        if location is None:
            location = StockLocation.objects.filter(code="shop").first() or StockLocation.objects.first()
        if location is None:
            return Response({"detail": "No stock location configured."}, status=drf_status.HTTP_400_BAD_REQUEST)

        stock = get_stock_row(booking.cylinder_type, location, Stock.Status.FILLED)
        if stock.quantity < booking.quantity:
            return Response({"detail": f"Not enough filled stock at {location.name}."}, status=drf_status.HTTP_400_BAD_REQUEST)
        stock.quantity -= booking.quantity
        stock.save(update_fields=["quantity", "updated_at"])

        if empty_collected > 0:
            empty_stock = get_stock_row(booking.cylinder_type, location, Stock.Status.EMPTY)
            empty_stock.quantity += empty_collected
            empty_stock.save(update_fields=["quantity", "updated_at"])

        sale = Sale.objects.create(
            customer=customer,
            location=location,
            total_amount=total,
            paid_amount=payment_collected,
            balance_due=total - payment_collected,
            payment_mode=payment_method if payment_collected > 0 else Sale.PaymentMode.CREDIT,
            delivery_type=Sale.DeliveryType.DELIVERY,
            delivery_staff=delivery.staff.get_full_name() or delivery.staff.username,
            sold_by=request.user,
            note=f"Booking #{booking.id}",
        )
        SaleItem.objects.create(
            sale=sale,
            cylinder_type=booking.cylinder_type,
            quantity=booking.quantity,
            rate=rate,
            total_amount=total,
            empty_returned=empty_collected,
        )
        if payment_collected > 0:
            Payment.objects.create(
                customer=customer,
                sale=sale,
                amount=payment_collected,
                payment_mode=payment_method,
                received_by=request.user,
                note="Delivery collection",
                empty_collected=empty_collected,
            )

        delivery.status = Delivery.Status.DELIVERED
        delivery.payment_collected = payment_collected
        delivery.payment_method = payment_method
        delivery.empty_collected = empty_collected
        delivery.completed_at = timezone.now()
        delivery.note = request.data.get("note", "")
        delivery.save()
        booking.status = Booking.Status.DELIVERED
        booking.delivered_at = delivery.completed_at
        booking.sale = sale
        booking.save(update_fields=["status", "delivered_at", "sale", "updated_at"])
        ActivityLog.objects.create(
            action="delivery_completed",
            description=f"Delivered booking #{booking.id} for Rs. {total}",
            user=request.user,
            metadata={"booking_id": booking.id, "sale_id": sale.id, "delivery_id": delivery.id},
        )
        Notification.objects.create(
            recipient=profile.user,
            booking=booking,
            title="Cylinder Delivered",
            body=f"Delivery completed. Pending amount: Rs. {sale.balance_due}.",
        )
        return Response(DeliverySerializer(delivery).data)


@api_view(["GET", "POST"])
@permission_classes([permissions.IsAuthenticated])
def customer_credentials(request, pk):
    """GET: return username for a customer. POST: reset their password."""
    if request.user.role != "admin" and not request.user.is_superuser:
        return Response({"detail": "Admin only."}, status=drf_status.HTTP_403_FORBIDDEN)
    try:
        customer = Customer.objects.get(pk=pk)
    except Customer.DoesNotExist:
        return Response({"detail": "Not found."}, status=drf_status.HTTP_404_NOT_FOUND)
    # Find linked user via profile
    profile = getattr(customer, "profile", None)
    if not profile:
        return Response({"detail": "No login account linked to this customer."}, status=drf_status.HTTP_404_NOT_FOUND)
    user = profile.user
    if request.method == "GET":
        return Response({
            "username": user.username,
            "full_name": user.get_full_name() or user.username,
            "plain_password": user.plain_password or "(not available — set a new password)",
        })
    # POST — reset password
    new_password = request.data.get("password", "").strip()
    if not new_password:
        return Response({"detail": "Password required."}, status=drf_status.HTTP_400_BAD_REQUEST)
    user.set_password(new_password)
    user.plain_password = new_password
    user.save(update_fields=["password", "plain_password"])
    return Response({"detail": "Password updated.", "username": user.username})


def money_sum(queryset, field):
    return queryset.aggregate(total=Sum(field))["total"] or 0


@api_view(["GET"])
@permission_classes([permissions.IsAuthenticated])
def me(request):
    redirects = {
        "admin": "/admin-dashboard",
        "staff": "/staff-dashboard",
        "customer": "/customer-dashboard",
    }
    return Response(
        {
            "id": request.user.id,
            "username": request.user.username,
            "name": request.user.get_full_name() or request.user.username,
            "role": request.user.role,
            "redirect": redirects.get(request.user.role, "/"),
        }
    )


@api_view(["GET"])
@permission_classes([permissions.IsAuthenticated])
def users_list(request):
    """List all staff users — admin only."""
    if request.user.role != "admin" and not request.user.is_superuser:
        return Response({"detail": "Admin only."}, status=drf_status.HTTP_403_FORBIDDEN)
    users = User.objects.all().order_by("username")
    return Response(UserSerializer(users, many=True).data)


@api_view(["POST"])
@permission_classes([permissions.IsAuthenticated])
def register(request):
    """Create a new staff user — admin only."""
    if request.user.role != "admin" and not request.user.is_superuser:
        return Response({"detail": "Admin only."}, status=drf_status.HTTP_403_FORBIDDEN)
    username = request.data.get("username", "").strip()
    password = request.data.get("password", "").strip()
    full_name = request.data.get("full_name", "").strip()
    role = request.data.get("role", "staff")
    phone = request.data.get("phone", "").strip()
    address = request.data.get("address", "").strip()
    area = request.data.get("area", "").strip()
    if not username or not password:
        return Response({"detail": "Username and password required."}, status=drf_status.HTTP_400_BAD_REQUEST)
    if User.objects.filter(username=username).exists():
        return Response({"detail": "Username already exists."}, status=drf_status.HTTP_400_BAD_REQUEST)
    if role not in [choice[0] for choice in User.Role.choices]:
        return Response({"detail": "Invalid role."}, status=drf_status.HTTP_400_BAD_REQUEST)
    parts = full_name.split(" ", 1)
    user = User.objects.create_user(
        username=username,
        password=password,
        first_name=parts[0],
        last_name=parts[1] if len(parts) > 1 else "",
        role=role,
        plain_password=password,
    )
    if role == User.Role.CUSTOMER:
        customer = Customer.objects.create(
            name=full_name or username,
            phone=phone,
            address=address,
            opening_balance=request.data.get("opening_balance") or 0,
        )
        CustomerProfile.objects.create(
            user=user,
            linked_customer=customer,
            phone=phone,
            address=address,
            area=area,
            default_staff_id=request.data.get("default_staff") or None,
            credit_limit=request.data.get("credit_limit") or 0,
            deposit_cylinders=request.data.get("deposit_cylinders") or 0,
        )
    elif role == User.Role.STAFF:
        StaffProfile.objects.create(
            user=user,
            assigned_area=area,
            vehicle_number=request.data.get("vehicle_number", "").strip(),
            vehicle_location_id=request.data.get("vehicle_location") or None,
        )
    return Response(UserSerializer(user).data, status=drf_status.HTTP_201_CREATED)


@api_view(["GET"])
@permission_classes([permissions.IsAuthenticated])
def dashboard(request):
    if request.user.role not in ["admin", "staff"] and not request.user.is_superuser:
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
    pending_deliveries = Booking.objects.filter(status__in=[Booking.Status.APPROVED, Booking.Status.OUT_FOR_DELIVERY]).count()
    today_bookings = Booking.objects.filter(created_at__date=today).count()
    staff_live_status = [
        {
            "id": staff.id,
            "name": staff.get_full_name() or staff.username,
            "area": staff.staff_profile.assigned_area if hasattr(staff, "staff_profile") else "",
            "active": staff.staff_profile.is_active if hasattr(staff, "staff_profile") else staff.is_active,
            "assigned_deliveries": staff.deliveries.exclude(status=Delivery.Status.DELIVERED).count(),
        }
        for staff in User.objects.filter(role=User.Role.STAFF).prefetch_related("deliveries")
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

    from .models import SaleItem
    stock_rows = []
    for cylinder in CylinderType.objects.filter(is_active=True):
        cylinder_stocks = stocks.filter(cylinder_type=cylinder)
        sold = SaleItem.objects.filter(cylinder_type=cylinder).aggregate(t=Sum("quantity"))["t"] or 0
        returned_at_sale = SaleItem.objects.filter(cylinder_type=cylinder).aggregate(t=Sum("empty_returned"))["t"] or 0
        collected = Payment.objects.filter(sale__items__cylinder_type=cylinder).aggregate(t=Sum("empty_collected"))["t"] or 0
        with_customers = max(sold - returned_at_sale - collected, 0)
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
            "total_customers": Customer.objects.count(),
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
    if request.user.role != "admin" and not request.user.is_superuser:
        return Response({"detail": "Admin only."}, status=drf_status.HTTP_403_FORBIDDEN)
    from django.db.models import Count
    today = timezone.localdate()
    start_str = request.query_params.get("start") or today.isoformat()
    end_str = request.query_params.get("end") or today.isoformat()
    try:
        from datetime import date
        start = date.fromisoformat(start_str)
        end = date.fromisoformat(end_str)
    except ValueError:
        start = end = today
    month_start = today.replace(day=1)

    range_sales = Sale.objects.filter(created_at__date__gte=start, created_at__date__lte=end)
    range_payments = Payment.objects.filter(created_at__date__gte=start, created_at__date__lte=end)
    range_expenses = Expense.objects.filter(created_at__date__gte=start, created_at__date__lte=end)
    range_movements = StockMovement.objects.filter(created_at__date__gte=start, created_at__date__lte=end)

    # Cylinder-wise sales for the range
    from .models import SaleItem
    cylinder_sales = (
        SaleItem.objects.filter(sale__created_at__date__gte=start, sale__created_at__date__lte=end)
        .values("cylinder_type__name")
        .annotate(total_qty=Sum("quantity"), total_amount=Sum("total_amount"))
        .order_by("cylinder_type__name")
    )

    # Pending dues — customers with balance_due > 0
    pending_sales = (
        Sale.objects.filter(balance_due__gt=0)
        .select_related("customer")
        .values("customer__name", "customer__phone")
        .annotate(total_due=Sum("balance_due"), sale_count=Count("id"))
        .order_by("-total_due")
    )

    # Sales list for the range
    range_sales_list = SaleSerializer(
        range_sales.select_related("customer", "location", "sold_by").prefetch_related("items__cylinder_type"),
        many=True,
    ).data

    # Expense list for the range
    range_expense_list = ExpenseSerializer(
        range_expenses.select_related("spent_by"),
        many=True,
    ).data

    # Current stock snapshot per cylinder type
    from .models import SaleItem
    stocks = Stock.objects.select_related("cylinder_type", "location")
    stock_snapshot = []
    for cylinder in CylinderType.objects.filter(is_active=True):
        cstocks = stocks.filter(cylinder_type=cylinder)
        sold_all = SaleItem.objects.filter(cylinder_type=cylinder).aggregate(t=Sum("quantity"))["t"] or 0
        returned_all = SaleItem.objects.filter(cylinder_type=cylinder).aggregate(t=Sum("empty_returned"))["t"] or 0
        collected_all = Payment.objects.filter(sale__items__cylinder_type=cylinder).aggregate(t=Sum("empty_collected"))["t"] or 0
        with_customers = max(sold_all - returned_all - collected_all, 0)
        stock_snapshot.append({
            "type": cylinder.name,
            "shop_filled": cstocks.filter(location__code="shop", status="filled").aggregate(t=Sum("quantity"))["t"] or 0,
            "shop_empty": cstocks.filter(location__code="shop", status="empty").aggregate(t=Sum("quantity"))["t"] or 0,
            "kandam_filled": cstocks.filter(location__code="kandam", status="filled").aggregate(t=Sum("quantity"))["t"] or 0,
            "kandam_empty": cstocks.filter(location__code="kandam", status="empty").aggregate(t=Sum("quantity"))["t"] or 0,
            "with_customers": with_customers,
            "total": (cstocks.aggregate(t=Sum("quantity"))["t"] or 0) + with_customers,
        })

    # Loads (supplier movements) in range
    range_loads = range_movements.filter(from_location__code="supplier")
    load_summary = (
        range_loads.values("cylinder_type__name", "to_location__name")
        .annotate(total_qty=Sum("quantity"))
        .order_by("cylinder_type__name")
    )

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
