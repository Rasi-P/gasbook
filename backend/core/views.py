from datetime import date
from decimal import Decimal

from django.contrib.auth import authenticate
from django.contrib.auth.password_validation import validate_password
from django.utils.crypto import get_random_string
from django.db import transaction
from django.db.models import Count, Q, Sum
from django.utils import timezone
from rest_framework import permissions, viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response
from rest_framework import status as drf_status
from rest_framework_simplejwt.views import TokenObtainPairView

from .models import (
    ActivityLog, Booking, CustomerCylinderRate, CustomerProfile,
    CylinderType, Delivery, Expense, Notification, Payment, Sale, SaleItem,
    StaffProfile, Stock, StockLocation, StockMovement, User, Role
)
from .serializers import (
    ActivityLogSerializer,
    BookingSerializer,
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


class CustomTokenObtainPairView(TokenObtainPairView):
    def post(self, request, *args, **kwargs):
        response = super().post(request, *args, **kwargs)
        username = (request.data.get("username") or "").strip()
        try:
            user = User.objects.get(username=username)
        except User.DoesNotExist:
            return response
        response.data["must_change_password"] = bool(getattr(user, "must_change_password", False))
        response.data["user_id"] = user.id
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
    queryset = CustomerProfile.objects.select_related("user", "default_staff").prefetch_related("custom_rates", "sales", "payments")
    serializer_class = CustomerProfileSerializer

    def get_permissions(self):
        if getattr(getattr(self.request.user, "role", None), "code", "") == "customer":
            if self.request.method not in permissions.SAFE_METHODS:
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
        if term:
            queryset = queryset.filter(Q(user__first_name__icontains=term) | Q(user__last_name__icontains=term) | Q(user__phone__icontains=term))
        return queryset

    @transaction.atomic
    def create(self, request, *args, **kwargs):
        name = request.data.get("name", "").strip()
        phone = request.data.get("phone", "").strip()
        email = request.data.get("email", "").strip()
        address = request.data.get("address", "").strip()
        parts = name.split(" ", 1)
        
        if phone and not phone.isdigit():
            return Response({"detail": "Phone number must contain only digits."}, status=drf_status.HTTP_400_BAD_REQUEST)

        if phone:
            existing_user = User.objects.filter(phone=phone, role__code="customer").first()
            if existing_user:
                full_name = existing_user.get_full_name() or existing_user.username
                return Response(
                    {"detail": f"This mobile number is already in the system. The user is: {full_name} ({existing_user.username})."}, 
                    status=drf_status.HTTP_400_BAD_REQUEST
                )

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

    @action(detail=True, methods=["get"], permission_classes=[IsStaffOrAdmin])
    def ledger(self, request, pk=None):
        customer_profile = self.get_object()
        sales = SaleSerializer(customer_profile.sales.prefetch_related("items__cylinder_type").all(), many=True).data
        payments = PaymentSerializer(customer_profile.payments.all(), many=True).data
        return Response({"customer": CustomerProfileSerializer(customer_profile).data, "sales": sales, "payments": payments})

    def perform_update(self, serializer):
        profile = serializer.save()
        user = profile.user
        name = self.request.data.get("name")
        phone = self.request.data.get("phone")
        address = self.request.data.get("address")
        email = self.request.data.get("email")

        if name is not None:
            parts = name.strip().split(" ", 1)
            user.first_name = parts[0] if parts else ""
            user.last_name = parts[1] if len(parts) > 1 else ""
        if phone is not None:
            user.phone = phone.strip()
        if address is not None:
            user.address = address.strip()
        if email is not None:
            user.email = email.strip()
            
        user.save(update_fields=["first_name", "last_name", "phone", "address", "email"])


class SaleViewSet(viewsets.ModelViewSet):
    queryset = Sale.objects.select_related("customer__user", "location", "sold_by").prefetch_related("items__cylinder_type")
    serializer_class = SaleSerializer
    permission_classes = [IsStaffOrAdmin]

    def get_queryset(self):
        queryset = super().get_queryset()
        term = self.request.query_params.get("search")
        payment_mode = self.request.query_params.get("payment_mode")
        pending = self.request.query_params.get("pending")
        if term:
            queryset = queryset.filter(Q(customer__user__first_name__icontains=term) | Q(customer__user__last_name__icontains=term) | Q(customer__user__phone__icontains=term))
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
        role = getattr(getattr(self.request.user, "role", None), "code", "")
        if role == "customer":
            queryset = queryset.filter(customer__user=self.request.user)
        elif role == "staff":
            queryset = queryset.filter(assigned_staff=self.request.user)
        status_param = self.request.query_params.get("status")
        if status_param:
            queryset = queryset.filter(status=status_param)
        return queryset

    def perform_create(self, serializer):
        if getattr(getattr(self.request.user, "role", None), "code", "") != "customer":
            raise PermissionDenied("Only customers can create booking requests.")
        serializer.save()

    @action(detail=True, methods=["post"], permission_classes=[IsAdminUserRole])
    def approve(self, request, pk=None):
        booking = self.get_object()
        staff_id = request.data.get("assigned_staff") or booking.customer.default_staff_id
        if not staff_id:
            return Response({"detail": "Assign delivery staff before approval."}, status=drf_status.HTTP_400_BAD_REQUEST)
        staff = User.objects.filter(id=staff_id, role__code="staff", is_active=True).first()
        if not staff:
            return Response({"detail": "Valid active staff user is required."}, status=drf_status.HTTP_400_BAD_REQUEST)
        booking.status = Booking.Status.APPROVED
        booking.assigned_staff = staff
        booking.approved_by = request.user
        booking.approved_at = timezone.now()
        booking.save(update_fields=["status", "assigned_staff", "approved_by", "approved_at", "updated_at"])
        
        delivery, created = Delivery.objects.get_or_create(booking=booking, defaults={"staff": staff, "status": Delivery.Status.ASSIGNED})
        if not created and (delivery.staff_id != staff.id or delivery.status == Delivery.Status.REJECTED):
            delivery.staff = staff
            delivery.status = Delivery.Status.ASSIGNED
            delivery.rejection_reason = ""
            delivery.save(update_fields=["staff", "status", "rejection_reason", "updated_at"])

        # Staff notification
        if not Notification.objects.filter(recipient=staff, booking=booking, notification_type="STAFF_ASSIGNED").exists():
            Notification.objects.create(
                recipient=staff,
                booking=booking,
                notification_type="STAFF_ASSIGNED",
                title="New Delivery Assigned",
                body=f"New delivery assigned — Order #{booking.id}.",
            )

        return Response(BookingSerializer(booking, context={"request": request}).data)

    @action(detail=True, methods=["post"], permission_classes=[IsAdminUserRole])
    def reject(self, request, pk=None):
        booking = self.get_object()
        booking.status = Booking.Status.REJECTED
        booking.save(update_fields=["status", "updated_at"])
        if not Notification.objects.filter(recipient=booking.customer.user, booking=booking, notification_type="ORDER_REJECTED").exists():
            Notification.objects.create(
                recipient=booking.customer.user,
                booking=booking,
                notification_type="ORDER_REJECTED",
                title="Booking Rejected",
                body=request.data.get("reason") or f"Your GasBook order #{booking.id} was rejected.",
            )
        return Response(BookingSerializer(booking, context={"request": request}).data)


class DeliveryViewSet(viewsets.ModelViewSet):
    queryset = Delivery.objects.select_related("booking__customer__user", "booking__cylinder_type", "staff")
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

    @action(detail=True, methods=["post"])
    def accept(self, request, pk=None):
        delivery = self.get_object()
        if (getattr(request.user.role, "code", "") == "staff") and delivery.staff_id != request.user.id:
            return Response({"detail": "This delivery is not assigned to you."}, status=drf_status.HTTP_403_FORBIDDEN)
        
        if delivery.status not in [Delivery.Status.ASSIGNED, Delivery.Status.ACCEPTED]:
            return Response({"detail": f"Cannot accept delivery from current status ({delivery.status})."}, status=drf_status.HTTP_400_BAD_REQUEST)

        delivery.status = Delivery.Status.ACCEPTED
        delivery.save(update_fields=["status", "updated_at"])
        delivery.booking.status = Booking.Status.OUT_FOR_DELIVERY
        delivery.booking.save(update_fields=["status", "updated_at"])

        staff_name = delivery.staff.get_full_name() or delivery.staff.username

        if not Notification.objects.filter(recipient=delivery.booking.customer.user, booking=delivery.booking, notification_type="ORDER_OUT_FOR_DELIVERY").exists():
            Notification.objects.create(
                recipient=delivery.booking.customer.user,
                booking=delivery.booking,
                notification_type="ORDER_OUT_FOR_DELIVERY",
                title="Out for Delivery",
                body=f"Your GasBook order #{delivery.booking_id} is out for delivery.",
            )

        for admin in User.objects.filter(role__code="admin"):
            if not Notification.objects.filter(recipient=admin, booking=delivery.booking, notification_type="STAFF_ACCEPTED").exists():
                Notification.objects.create(
                    recipient=admin,
                    booking=delivery.booking,
                    notification_type="STAFF_ACCEPTED",
                    title="Delivery Accepted by Staff",
                    body=f"Staff {staff_name} accepted order #{delivery.booking_id}.",
                )

        return Response(DeliverySerializer(delivery).data)

    @action(detail=True, methods=["post"])
    def reject(self, request, pk=None):
        delivery = self.get_object()
        if (getattr(request.user.role, "code", "") == "staff") and delivery.staff_id != request.user.id:
            return Response({"detail": "This delivery is not assigned to you."}, status=drf_status.HTTP_403_FORBIDDEN)
        
        reason = request.data.get("reason", "").strip() or "Other"
        delivery.status = Delivery.Status.REJECTED
        delivery.rejection_reason = reason
        delivery.save(update_fields=["status", "rejection_reason", "updated_at"])

        # Reset booking status to pending & clear assigned staff so admin can reassign
        booking = delivery.booking
        booking.status = Booking.Status.PENDING
        booking.assigned_staff = None
        booking.save(update_fields=["status", "assigned_staff", "updated_at"])

        staff_name = delivery.staff.get_full_name() or delivery.staff.username

        # Admin notification
        for admin in User.objects.filter(role__code="admin"):
            Notification.objects.create(
                recipient=admin,
                booking=booking,
                notification_type="STAFF_REJECTED",
                title="Staff Delivery Rejected",
                body=f"Staff {staff_name} rejected order #{booking.id}. Reason: {reason}",
            )

        # Reassignment customer notification (graceful, no internal staff rejection details)
        Notification.objects.create(
            recipient=booking.customer.user,
            booking=booking,
            notification_type="STAFF_REJECTED",
            title="Order Status Update",
            body=f"Your order #{booking.id} is being reassigned for delivery.",
        )

        return Response(DeliverySerializer(delivery).data)

    @action(detail=True, methods=["post"])
    def start(self, request, pk=None):
        delivery = self.get_object()
        if (getattr(request.user.role, "code", "") == "staff") and delivery.staff_id != request.user.id:
            return Response({"detail": "This delivery is not assigned to you."}, status=drf_status.HTTP_403_FORBIDDEN)
        
        if delivery.status in [Delivery.Status.DELIVERED, Delivery.Status.CANCELLED, Delivery.Status.REJECTED]:
            return Response({"detail": f"Cannot start delivery from current status ({delivery.status})."}, status=drf_status.HTTP_400_BAD_REQUEST)

        delivery.status = Delivery.Status.OUT_FOR_DELIVERY
        delivery.started_at = timezone.now()
        delivery.booking.status = Booking.Status.OUT_FOR_DELIVERY
        delivery.booking.save(update_fields=["status", "updated_at"])
        delivery.save(update_fields=["status", "started_at", "updated_at"])

        if not Notification.objects.filter(recipient=delivery.booking.customer.user, booking=delivery.booking, notification_type="ORDER_OUT_FOR_DELIVERY").exists():
            Notification.objects.create(
                recipient=delivery.booking.customer.user,
                booking=delivery.booking,
                notification_type="ORDER_OUT_FOR_DELIVERY",
                title="Out for Delivery",
                body=f"Your GasBook order #{delivery.booking_id} is out for delivery.",
            )

        for admin in User.objects.filter(role__code="admin"):
            if not Notification.objects.filter(recipient=admin, booking=delivery.booking, notification_type="ORDER_OUT_FOR_DELIVERY").exists():
                Notification.objects.create(
                    recipient=admin,
                    booking=delivery.booking,
                    notification_type="ORDER_OUT_FOR_DELIVERY",
                    title="Order Out for Delivery",
                    body=f"Order #{delivery.booking_id} is out for delivery by {delivery.staff.username}.",
                )
        return Response(DeliverySerializer(delivery).data)

    @action(detail=True, methods=["post"])
    @transaction.atomic
    def complete(self, request, pk=None):
        delivery = self.get_object()
        if (getattr(request.user.role, "code", "") == "staff") and delivery.staff_id != request.user.id:
            return Response({"detail": "This delivery is not assigned to you."}, status=drf_status.HTTP_403_FORBIDDEN)
        if delivery.status == Delivery.Status.DELIVERED:
            return Response({"detail": "Delivery already completed."}, status=drf_status.HTTP_400_BAD_REQUEST)

        booking = delivery.booking
        profile = booking.customer
        
        rate_obj = profile.custom_rates.filter(cylinder_type=booking.cylinder_type).first()
        rate = rate_obj.custom_price if rate_obj else booking.cylinder_type.selling_price
        total = Decimal(booking.quantity) * rate
        
        payment_collected = Decimal(str(request.data.get("payment_collected", "0") or "0"))
        split_payments = request.data.get("split_payments", [])
        if split_payments:
            payment_collected = sum(Decimal(str(p.get("amount", 0))) for p in split_payments)
            
        if payment_collected < 0 or payment_collected > total:
            return Response({"detail": "Collected amount must be between 0 and sale total."}, status=drf_status.HTTP_400_BAD_REQUEST)

        payment_method = request.data.get("payment_method") or booking.payment_method or Sale.PaymentMode.COD
        paid_payment_mode = request.data.get("paid_payment_mode", "cash")
        empty_collected = int(request.data.get("empty_collected", 0) or 0)
        location = getattr(delivery.staff, "staff_profile", None).vehicle_location if hasattr(delivery.staff, "staff_profile") else None
        if location is None:
            location = StockLocation.objects.filter(code="shop").first() or StockLocation.objects.first()
        if location is None:
            return Response({"detail": "No stock location configured."}, status=drf_status.HTTP_400_BAD_REQUEST)
        # Temporary: staff delivery completion should not be blocked by stock/load sync
        # until the warehouse/vehicle stock workflow is finalized.
        # stock = get_stock_row(booking.cylinder_type, location, Stock.Status.FILLED)
        # if stock.quantity < booking.quantity:
        #     return Response({"detail": f"Not enough filled stock at {location.name}."}, status=drf_status.HTTP_400_BAD_REQUEST)
        # stock.quantity -= booking.quantity
        # stock.save(update_fields=["quantity", "updated_at"])

        # if empty_collected > 0:
        #     empty_stock = get_stock_row(booking.cylinder_type, location, Stock.Status.EMPTY)
        #     empty_stock.quantity += empty_collected
        #     empty_stock.save(update_fields=["quantity", "updated_at"])
        if split_payments:
            sale_payment_mode = Sale.PaymentMode.SPLIT
        else:
            sale_payment_mode = Sale.PaymentMode.CREDIT if payment_collected < total else payment_method
        
        sale = Sale.objects.create(
            customer=profile,
            location=location,
            total_amount=total,
            paid_amount=payment_collected,
            balance_due=total - payment_collected,
            payment_mode=sale_payment_mode,
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
            if split_payments:
                for sp in split_payments:
                    amt = Decimal(str(sp.get("amount", 0)))
                    mode = sp.get("mode", Sale.PaymentMode.CASH)
                    if amt > 0:
                        Payment.objects.create(
                            customer=profile, sale=sale, amount=amt,
                            payment_mode=mode, received_by=request.user,
                            note="Delivery collection (split)", empty_collected=empty_collected if sp == split_payments[0] else 0,
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
        delivery.note = request.data.get("note", "")
        delivery.save()

        booking.status = Booking.Status.DELIVERED
        booking.payment_status = "PAID" if payment_collected >= total or booking.payment_method.upper() == "ONLINE" else "COLLECTED"
        booking.delivered_at = delivery.completed_at
        booking.sale = sale
        booking.save(update_fields=["status", "payment_status", "delivered_at", "sale", "updated_at"])

        ActivityLog.objects.create(
            action="delivery_completed",
            description=f"Delivered booking #{booking.id} for Rs. {total}",
            user=request.user,
            metadata={"booking_id": booking.id, "sale_id": sale.id, "delivery_id": delivery.id},
        )

        staff_name = delivery.staff.get_full_name() or delivery.staff.username

        # Customer Notification
        customer_msg = f"Your GasBook order #{booking.id} has been delivered successfully."
        if booking.payment_method.upper() == "COD" and payment_collected > 0:
            customer_msg += f" Payment of ₹{payment_collected} was collected successfully."

        if not Notification.objects.filter(recipient=profile.user, booking=booking, notification_type="ORDER_DELIVERED").exists():
            Notification.objects.create(
                recipient=profile.user,
                booking=booking,
                notification_type="ORDER_DELIVERED",
                title="Order Delivered",
                body=customer_msg,
            )

        # Admin Notification
        for admin in User.objects.filter(role__code="admin"):
            if not Notification.objects.filter(recipient=admin, booking=booking, notification_type="ORDER_DELIVERED").exists():
                Notification.objects.create(
                    recipient=admin,
                    booking=booking,
                    notification_type="ORDER_DELIVERED",
                    title="Order Delivered",
                    body=f"Order #{booking.id} was delivered by {staff_name}.",
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
    except CustomerProfile.DoesNotExist:
        return Response({"detail": "Not found."}, status=drf_status.HTTP_404_NOT_FOUND)
    
    user = profile.user
    if request.method == "GET":
        return Response({
            "username": user.username,
            "full_name": user.get_full_name() or user.username,
            "is_active": user.is_active,
        })
    if request.method == "DELETE":
        user.delete()
        return Response({"detail": "Customer deleted completely."})
    
    new_password = request.data.get("password", "").strip() or get_random_string(length=12)
    user.set_password(new_password)
    user.plain_password = ""
    user.must_change_password = True
    user.is_active = True
    user.save(update_fields=["password", "plain_password", "must_change_password", "is_active"])
    return Response({"detail": "Temporary password generated.", "username": user.username, "temporary_password": new_password})


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
    location_name = None
    if (getattr(request.user.role, "code", "") == "staff") and hasattr(request.user, "staff_profile"):
        loc = request.user.staff_profile.vehicle_location
        if loc:
            location_name = loc.name
            
    return Response(
        {
            "id": request.user.id,
            "username": request.user.username,
            "name": request.user.get_full_name() or request.user.username,
            "role": getattr(request.user.role, "code", ""),
            "redirect": redirects.get(getattr(request.user.role, "code", ""), "/"),
            "must_change_password": bool(getattr(request.user, "must_change_password", False)),
            "vehicle_location_name": location_name,
        }
    )


@api_view(["GET"])
@permission_classes([permissions.IsAuthenticated])
def users_list(request):
    if (getattr(request.user.role, "code", "") != "admin") and not request.user.is_superuser:
        return Response({"detail": "Admin only."}, status=drf_status.HTTP_403_FORBIDDEN)
    users = User.objects.exclude(role__code="customer").order_by("username")
    data = []
    for u in users:
        data.append({
            "id": u.id,
            "username": u.username,
            "first_name": u.first_name,
            "last_name": u.last_name,
            "role": getattr(u.role, "code", ""),
            "phone": u.phone,
            "email": u.email,
            "address": u.address,
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
        user = User.objects.exclude(role__code="customer").get(pk=pk)
    except User.DoesNotExist:
        return Response({"detail": "Not found."}, status=drf_status.HTTP_404_NOT_FOUND)
    if request.method == "DELETE":
        user.delete()
        return Response({"detail": "User completely deleted."})

    full_name = request.data.get("full_name")
    phone = request.data.get("phone")
    address = request.data.get("address")
    email = request.data.get("email")

    if full_name is not None:
        parts = full_name.strip().split(" ", 1)
        user.first_name = parts[0] if parts else ""
        user.last_name = parts[1] if len(parts) > 1 else ""
    if phone is not None:
        user.phone = phone.strip()
        if not user.phone:
            return Response({"detail": "Phone required."}, status=drf_status.HTTP_400_BAD_REQUEST)
    if address is not None:
        user.address = address.strip()
    if email is not None:
        user.email = email.strip()

    user.save(update_fields=["first_name", "last_name", "phone", "address", "email"])

    if getattr(getattr(user, "role", None), "code", "") == "staff":
        # Just ensure the profile exists, no phone/address fields on StaffProfile
        StaffProfile.objects.get_or_create(user=user)

    return Response(UserSerializer(user).data)


@api_view(["GET", "POST"])
@permission_classes([permissions.IsAuthenticated])
def user_credentials(request, pk):
    if (getattr(request.user.role, "code", "") != "admin") and not request.user.is_superuser:
        return Response({"detail": "Admin only."}, status=drf_status.HTTP_403_FORBIDDEN)
    try:
        user = User.objects.exclude(role__code="customer").get(pk=pk)
    except User.DoesNotExist:
        return Response({"detail": "Not found."}, status=drf_status.HTTP_404_NOT_FOUND)
    if request.method == "GET":
        return Response({
            "username": user.username,
            "full_name": user.get_full_name() or user.username,
            "is_active": user.is_active,
        })
    new_password = request.data.get("password", "").strip() or get_random_string(length=12)
    user.set_password(new_password)
    user.plain_password = ""
    user.must_change_password = True
    user.is_active = True
    user.save(update_fields=["password", "plain_password", "must_change_password", "is_active"])
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
def register(request):
    if (getattr(request.user.role, "code", "") != "admin") and not request.user.is_superuser:
        return Response({"detail": "Admin only."}, status=drf_status.HTTP_403_FORBIDDEN)
    username = request.data.get("username", "").strip()
    password = request.data.get("password", "").strip() or get_random_string(length=12)
    full_name = request.data.get("full_name", "").strip()
    role = request.data.get("role", "staff")
    phone = request.data.get("phone", "").strip()
    email = request.data.get("email", "").strip()
    address = request.data.get("address", "").strip()
    area = request.data.get("area", "").strip()
    if not username:
        return Response({"detail": "Username required."}, status=drf_status.HTTP_400_BAD_REQUEST)
    if not phone:
        return Response({"detail": "Phone required."}, status=drf_status.HTTP_400_BAD_REQUEST)
    if phone and not phone.isdigit():
        return Response({"detail": "Phone number must contain only digits."}, status=drf_status.HTTP_400_BAD_REQUEST)
    if User.objects.filter(username=username).exists():
        return Response({"detail": "Username already exists."}, status=drf_status.HTTP_400_BAD_REQUEST)
    if role not in [r.code for r in Role.objects.all()]:
        return Response({"detail": "Invalid role."}, status=drf_status.HTTP_400_BAD_REQUEST)
    parts = full_name.split(" ", 1)
    user = User.objects.create_user(
        username=username,
        password=password,
        first_name=parts[0],
        last_name=parts[1] if len(parts) > 1 else "",
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
            vehicle_number=request.data.get("vehicle_number", "").strip(),
            vehicle_location_id=request.data.get("vehicle_location") or None,
        )
    response_data = UserSerializer(user).data
    if request.data.get("password", "").strip() == "":
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
    except ValueError:
        start = end = today
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
