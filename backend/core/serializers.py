from decimal import Decimal

from django.db import transaction
from django.utils import timezone
from rest_framework import serializers

from .models import (
    ActivityLog, Booking, Customer, CustomerCylinderRate, CustomerProfile,
    CylinderType, Delivery, Expense, Notification, Payment, Sale, SaleItem,
    StaffProfile, Stock, StockLocation, StockMovement, User,
)


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ["id", "username", "first_name", "last_name", "role", "plain_password", "phone", "address"]


class CylinderTypeSerializer(serializers.ModelSerializer):
    class Meta:
        model = CylinderType
        fields = "__all__"


class StockLocationSerializer(serializers.ModelSerializer):
    class Meta:
        model = StockLocation
        fields = "__all__"


class StockSerializer(serializers.ModelSerializer):
    cylinder_type_name = serializers.CharField(source="cylinder_type.name", read_only=True)
    location_name = serializers.CharField(source="location.name", read_only=True)

    class Meta:
        model = Stock
        fields = "__all__"


def get_stock_row(cylinder_type, location, status):
    stock, _ = Stock.objects.select_for_update().get_or_create(
        cylinder_type=cylinder_type,
        location=location,
        status=status,
        defaults={"quantity": 0},
    )
    return stock


class StockMovementSerializer(serializers.ModelSerializer):
    moved_by_name = serializers.CharField(source="moved_by.username", read_only=True)
    cylinder_type_name = serializers.CharField(source="cylinder_type.name", read_only=True)
    from_location_name = serializers.CharField(source="from_location.name", read_only=True)
    to_location_name = serializers.CharField(source="to_location.name", read_only=True)

    class Meta:
        model = StockMovement
        fields = "__all__"
        read_only_fields = ["moved_by"]

    def validate(self, attrs):
        if attrs["from_location"] == attrs["to_location"]:
            raise serializers.ValidationError("From and to locations must be different.")
        if attrs["quantity"] <= 0:
            raise serializers.ValidationError("Quantity must be greater than zero.")
        return attrs

    @transaction.atomic
    def create(self, validated_data):
        user = self.context["request"].user
        from_location = validated_data["from_location"]
        quantity = validated_data["quantity"]

        if from_location.code != "supplier":
            source = get_stock_row(validated_data["cylinder_type"], from_location, validated_data["status"])
            if source.quantity < quantity:
                raise serializers.ValidationError("Not enough stock in source location.")
            source.quantity -= quantity
            source.save(update_fields=["quantity", "updated_at"])

            destination = get_stock_row(validated_data["cylinder_type"], validated_data["to_location"], validated_data["status"])
            destination.quantity += quantity
            destination.save(update_fields=["quantity", "updated_at"])

        movement = StockMovement.objects.create(moved_by=user, **validated_data)
        ActivityLog.objects.create(
            action="stock_moved",
            description=f"Moved {quantity} {validated_data['status']} cylinders",
            user=user,
            metadata={"movement_id": movement.id},
        )
        return movement


class CustomerSerializer(serializers.ModelSerializer):
    pending_balance = serializers.SerializerMethodField()
    empties_owed = serializers.SerializerMethodField()

    class Meta:
        model = Customer
        fields = "__all__"

    def validate_phone(self, value):
        if not value.strip():
            raise serializers.ValidationError("Phone required.")
        return value.strip()

    def get_pending_balance(self, obj):
        sales_due = sum(sale.balance_due for sale in obj.sales.all())
        payments = sum(p.amount for p in obj.payments.filter(sale__isnull=True))
        return obj.opening_balance + sales_due - payments

    def get_empties_owed(self, obj):
        given = sum(item.quantity for sale in obj.sales.all() for item in sale.items.all())
        returned_at_sale = sum(item.empty_returned for sale in obj.sales.all() for item in sale.items.all())
        collected_later = sum(p.empty_collected for p in obj.payments.all())
        return max(given - returned_at_sale - collected_later, 0)


class SaleItemSerializer(serializers.ModelSerializer):
    cylinder_type_name = serializers.CharField(source="cylinder_type.name", read_only=True)

    class Meta:
        model = SaleItem
        fields = ["id", "cylinder_type", "cylinder_type_name", "quantity", "rate", "total_amount", "empty_returned"]


class SaleItemWriteSerializer(serializers.Serializer):
    cylinder_type = serializers.PrimaryKeyRelatedField(queryset=CylinderType.objects.all())
    quantity = serializers.IntegerField(min_value=1)
    rate = serializers.DecimalField(max_digits=10, decimal_places=2)
    empty_returned = serializers.IntegerField(min_value=0, default=0)


class SaleSerializer(serializers.ModelSerializer):
    customer_name = serializers.CharField(source="customer.name", read_only=True)
    sold_by_name = serializers.CharField(source="sold_by.username", read_only=True)
    location_name = serializers.CharField(source="location.name", read_only=True)
    items = SaleItemSerializer(many=True, read_only=True)
    sale_items = SaleItemWriteSerializer(many=True, write_only=True)

    class Meta:
        model = Sale
        fields = [
            "id", "customer", "customer_name", "location", "location_name",
            "total_amount", "paid_amount", "balance_due",
            "payment_mode", "delivery_type", "delivery_staff", "note",
            "sold_by", "sold_by_name", "created_at", "items", "sale_items",
        ]
        read_only_fields = ["total_amount", "balance_due", "sold_by"]

    def validate(self, attrs):
        items = attrs.get("sale_items", [])
        if not items:
            raise serializers.ValidationError("At least one cylinder item is required.")
        if attrs.get("payment_mode") == Sale.PaymentMode.CREDIT and attrs.get("customer") is None:
            raise serializers.ValidationError("Credit sales must be linked to a customer.")
        if attrs.get("paid_amount", Decimal("0")) < 0:
            raise serializers.ValidationError("Paid amount cannot be negative.")
        return attrs

    @transaction.atomic
    def create(self, validated_data):
        user = self.context["request"].user
        items_data = validated_data.pop("sale_items")
        location = validated_data["location"]
        payment_mode = validated_data["payment_mode"]
        paid = validated_data.get("paid_amount", Decimal("0"))

        total = Decimal("0")
        stock_rows = []
        for item in items_data:
            ctype = item["cylinder_type"]
            qty = item["quantity"]
            stock = get_stock_row(ctype, location, Stock.Status.FILLED)
            if stock.quantity < qty:
                raise serializers.ValidationError(f"Not enough filled stock for {ctype.name} at {location.name}.")
            total += Decimal(qty) * item["rate"]
            stock_rows.append((stock, qty, item))

        if paid > total:
            raise serializers.ValidationError("Paid amount cannot exceed total amount.")

        for stock, qty, item in stock_rows:
            stock.quantity -= qty
            stock.save(update_fields=["quantity", "updated_at"])
            returned = item.get("empty_returned", 0)
            if returned > 0:
                empty_stock = get_stock_row(item["cylinder_type"], location, Stock.Status.EMPTY)
                empty_stock.quantity += returned
                empty_stock.save(update_fields=["quantity", "updated_at"])

        sale = Sale.objects.create(sold_by=user, total_amount=total, balance_due=total - paid, **validated_data)

        for stock, qty, item in stock_rows:
            SaleItem.objects.create(
                sale=sale, cylinder_type=item["cylinder_type"], quantity=qty,
                rate=item["rate"], total_amount=Decimal(qty) * item["rate"],
                empty_returned=item.get("empty_returned", 0),
            )

        if paid > 0 and sale.customer:
            Payment.objects.create(
                customer=sale.customer, sale=sale, amount=paid,
                payment_mode=payment_mode, received_by=user, note="Sale payment",
            )

        ActivityLog.objects.create(
            action="sale_created",
            description=f"Sale of Rs. {total} ({len(items_data)} item(s))",
            user=user, metadata={"sale_id": sale.id},
        )
        return sale


class PaymentSerializer(serializers.ModelSerializer):
    customer_name = serializers.CharField(source="customer.name", read_only=True)

    class Meta:
        model = Payment
        fields = "__all__"
        read_only_fields = ["received_by"]
        extra_kwargs = {"empty_collected": {"required": False}}

    def create(self, validated_data):
        payment = Payment.objects.create(received_by=self.context["request"].user, **validated_data)
        ActivityLog.objects.create(
            action="payment_received",
            description=f"Payment received: Rs. {payment.amount}",
            user=payment.received_by, metadata={"payment_id": payment.id},
        )
        return payment


class ExpenseSerializer(serializers.ModelSerializer):
    spent_by_name = serializers.CharField(source="spent_by.username", read_only=True)

    class Meta:
        model = Expense
        fields = "__all__"
        read_only_fields = ["spent_by"]

    def create(self, validated_data):
        expense = Expense.objects.create(spent_by=self.context["request"].user, **validated_data)
        ActivityLog.objects.create(
            action="expense_created",
            description=f"Expense recorded: Rs. {expense.amount}",
            user=expense.spent_by, metadata={"expense_id": expense.id},
        )
        return expense


class ActivityLogSerializer(serializers.ModelSerializer):
    user_name = serializers.CharField(source="user.username", read_only=True)

    class Meta:
        model = ActivityLog
        fields = "__all__"


# ── ERP Serializers ────────────────────────────────────────────────────────────

class CustomerCylinderRateSerializer(serializers.ModelSerializer):
    cylinder_type_name = serializers.CharField(source="cylinder_type.name", read_only=True)

    class Meta:
        model = CustomerCylinderRate
        fields = "__all__"


class CustomerProfileSerializer(serializers.ModelSerializer):
    username = serializers.CharField(source="user.username", read_only=True)
    full_name = serializers.SerializerMethodField()
    pending_amount = serializers.SerializerMethodField()
    last_delivery_date = serializers.SerializerMethodField()
    custom_rates = CustomerCylinderRateSerializer(many=True, read_only=True)

    class Meta:
        model = CustomerProfile
        fields = "__all__"

    def get_full_name(self, obj):
        return obj.user.get_full_name() or obj.user.username

    def get_pending_amount(self, obj):
        customer = obj.linked_customer
        if not customer:
            return "0.00"
        sales_due = sum(sale.balance_due for sale in customer.sales.all())
        payments = sum(p.amount for p in customer.payments.filter(sale__isnull=True))
        return str(customer.opening_balance + sales_due - payments)

    def get_last_delivery_date(self, obj):
        booking = obj.bookings.filter(status=Booking.Status.DELIVERED).order_by("-delivered_at").first()
        return booking.delivered_at if booking else None


class StaffProfileSerializer(serializers.ModelSerializer):
    username = serializers.CharField(source="user.username", read_only=True)
    full_name = serializers.SerializerMethodField()
    vehicle_location_name = serializers.CharField(source="vehicle_location.name", read_only=True)

    class Meta:
        model = StaffProfile
        fields = "__all__"

    def get_full_name(self, obj):
        return obj.user.get_full_name() or obj.user.username


class NotificationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Notification
        fields = "__all__"
        read_only_fields = ["recipient"]


class BookingSerializer(serializers.ModelSerializer):
    customer_name = serializers.SerializerMethodField()
    customer_phone = serializers.SerializerMethodField()
    customer_address = serializers.SerializerMethodField()
    customer_area = serializers.SerializerMethodField()
    cylinder_type_name = serializers.CharField(source="cylinder_type.name", read_only=True)
    assigned_staff_name = serializers.SerializerMethodField()
    rate = serializers.SerializerMethodField()

    class Meta:
        model = Booking
        fields = "__all__"
        read_only_fields = ["customer", "approved_by", "approved_at", "delivered_at", "sale"]

    def get_customer_name(self, obj):
        return obj.customer.user.get_full_name() or obj.customer.user.username

    def get_customer_phone(self, obj):
        return obj.customer.phone

    def get_customer_address(self, obj):
        return obj.customer.address

    def get_customer_area(self, obj):
        return obj.customer.area

    def get_assigned_staff_name(self, obj):
        if obj.assigned_staff:
            return obj.assigned_staff.get_full_name() or obj.assigned_staff.username
        return None

    def get_rate(self, obj):
        custom = obj.customer.custom_rates.filter(cylinder_type=obj.cylinder_type).first()
        if custom:
            return str(custom.custom_price)
        return str(obj.cylinder_type.selling_price)

    def create(self, validated_data):
        user = self.context["request"].user
        profile = user.customer_profile
        booking = Booking.objects.create(customer=profile, **validated_data)
        # Notify all admins
        for admin in User.objects.filter(role=User.Role.ADMIN):
            Notification.objects.create(
                recipient=admin, booking=booking,
                title="New Booking",
                body=f"{profile} requested {booking.quantity}× {booking.cylinder_type.name}",
            )
        return booking


class DeliverySerializer(serializers.ModelSerializer):
    customer_name = serializers.SerializerMethodField()
    customer_phone = serializers.CharField(source="booking.customer.phone", read_only=True)
    customer_address = serializers.CharField(source="booking.customer.address", read_only=True)
    customer_area = serializers.CharField(source="booking.customer.area", read_only=True)
    cylinder_type_name = serializers.CharField(source="booking.cylinder_type.name", read_only=True)
    quantity = serializers.IntegerField(source="booking.quantity", read_only=True)
    booking_status = serializers.CharField(source="booking.status", read_only=True)
    staff_name = serializers.SerializerMethodField()
    rate = serializers.SerializerMethodField()
    pending_amount = serializers.SerializerMethodField()
    deposit_cylinders = serializers.IntegerField(source="booking.customer.deposit_cylinders", read_only=True)

    class Meta:
        model = Delivery
        fields = "__all__"
        read_only_fields = ["started_at", "completed_at"]

    def get_customer_name(self, obj):
        user = obj.booking.customer.user
        return user.get_full_name() or user.username

    def get_staff_name(self, obj):
        return obj.staff.get_full_name() or obj.staff.username

    def get_rate(self, obj):
        custom = obj.booking.customer.custom_rates.filter(cylinder_type=obj.booking.cylinder_type).first()
        if custom:
            return str(custom.custom_price)
        return str(obj.booking.cylinder_type.selling_price)

    def get_pending_amount(self, obj):
        customer = obj.booking.customer.linked_customer
        if not customer:
            return "0.00"
        sales_due = sum(sale.balance_due for sale in customer.sales.all())
        payments = sum(p.amount for p in customer.payments.filter(sale__isnull=True))
        return str(customer.opening_balance + sales_due - payments)
