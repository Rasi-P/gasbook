from django.db.models import Q, Sum
from django.utils import timezone
from rest_framework import permissions, viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.response import Response
from rest_framework import status as drf_status

from .models import ActivityLog, Customer, CylinderType, Expense, Payment, Sale, Stock, StockLocation, StockMovement, User
from .serializers import (
    ActivityLogSerializer,
    CustomerSerializer,
    CylinderTypeSerializer,
    ExpenseSerializer,
    PaymentSerializer,
    SaleSerializer,
    StockLocationSerializer,
    StockMovementSerializer,
    StockSerializer,
    UserSerializer,
)


class IsAdminOrReadOnly(permissions.BasePermission):
    def has_permission(self, request, view):
        if request.method in permissions.SAFE_METHODS:
            return True
        return getattr(request.user, "role", "") == "admin" or request.user.is_superuser


class CylinderTypeViewSet(viewsets.ModelViewSet):
    queryset = CylinderType.objects.all()
    serializer_class = CylinderTypeSerializer
    permission_classes = [IsAdminOrReadOnly]
    search_fields = ["name"]


class StockLocationViewSet(viewsets.ModelViewSet):
    queryset = StockLocation.objects.all()
    serializer_class = StockLocationSerializer
    permission_classes = [IsAdminOrReadOnly]


class StockViewSet(viewsets.ModelViewSet):
    queryset = Stock.objects.select_related("cylinder_type", "location")
    serializer_class = StockSerializer

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


class CustomerViewSet(viewsets.ModelViewSet):
    queryset = Customer.objects.prefetch_related("sales__items", "payments")
    serializer_class = CustomerSerializer
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


class ExpenseViewSet(viewsets.ModelViewSet):
    queryset = Expense.objects.select_related("spent_by")
    serializer_class = ExpenseSerializer


class ActivityLogViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = ActivityLog.objects.select_related("user")
    serializer_class = ActivityLogSerializer


def money_sum(queryset, field):
    return queryset.aggregate(total=Sum(field))["total"] or 0


@api_view(["GET"])
@permission_classes([permissions.IsAuthenticated])
def me(request):
    return Response(
        {
            "id": request.user.id,
            "username": request.user.username,
            "name": request.user.get_full_name() or request.user.username,
            "role": request.user.role,
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
    if not username or not password:
        return Response({"detail": "Username and password required."}, status=drf_status.HTTP_400_BAD_REQUEST)
    if User.objects.filter(username=username).exists():
        return Response({"detail": "Username already exists."}, status=drf_status.HTTP_400_BAD_REQUEST)
    parts = full_name.split(" ", 1)
    user = User.objects.create_user(
        username=username,
        password=password,
        first_name=parts[0],
        last_name=parts[1] if len(parts) > 1 else "",
        role=role,
    )
    return Response(UserSerializer(user).data, status=drf_status.HTTP_201_CREATED)


@api_view(["GET"])
@permission_classes([permissions.IsAuthenticated])
def dashboard(request):
    today = timezone.localdate()
    stocks = Stock.objects.select_related("cylinder_type", "location")
    filled = stocks.filter(status=Stock.Status.FILLED).aggregate(total=Sum("quantity"))["total"] or 0
    empty = stocks.filter(status=Stock.Status.EMPTY).aggregate(total=Sum("quantity"))["total"] or 0
    shop_stock = stocks.filter(location__code="shop").aggregate(total=Sum("quantity"))["total"] or 0
    kandam_stock = stocks.filter(location__code="kandam").aggregate(total=Sum("quantity"))["total"] or 0
    today_sales = Sale.objects.filter(created_at__date=today)
    today_payments = Payment.objects.filter(created_at__date=today)
    pending = Sale.objects.aggregate(total=Sum("balance_due"))["total"] or 0

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
            "filled_cylinders": filled,
            "empty_cylinders": empty,
            "shop_stock": shop_stock,
            "kandam_stock": kandam_stock,
            "today_sales": money_sum(today_sales, "total_amount"),
            "today_collection": money_sum(today_payments, "amount"),
            "pending_payments": pending,
            "low_stock": low_stock,
            "stock_rows": stock_rows,
            "recent_activity": ActivityLogSerializer(ActivityLog.objects.all()[:8], many=True).data,
        }
    )


@api_view(["GET"])
@permission_classes([permissions.IsAuthenticated])
def reports(request):
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
