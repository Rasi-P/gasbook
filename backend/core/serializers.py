from decimal import Decimal

from django.db import transaction
from rest_framework import serializers

from .models import (
    ActivityLog,
    Customer,
    CylinderType,
    Expense,
    Payment,
    Sale,
    SaleItem,
    Stock,
    StockLocation,
    StockMovement,
    User,
)


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ["id", "username", "first_name", "last_name", "role"]


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

        # Skip stock deduction/addition for supplier source — it's a virtual origin
        if from_location.code != "supplier":
            source = get_stock_row(
                validated_data["cylinder_type"],
                from_location,
                validated_data["status"],
            )
            if source.quantity < quantity:
                raise serializers.ValidationError("Not enough stock in source location.")
            source.quantity -= quantity
            source.save(update_fields=["quantity", "updated_at"])

            destination = get_stock_row(
                validated_data["cylinder_type"],
                validated_data["to_location"],
                validated_data["status"],
            )
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
    # write-only items list
    sale_items = SaleItemWriteSerializer(many=True, write_only=True)

    class Meta:
        model = Sale
        fields = [
            "id", "customer", "customer_name", "location", "location_name",
            "total_amount", "paid_amount", "balance_due",
            "payment_mode", "delivery_type", "delivery_staff", "note",
            "sold_by", "sold_by_name", "created_at",
            "items", "sale_items",
        ]
        read_only_fields = ["total_amount", "balance_due", "sold_by"]

    def validate(self, attrs):
        items = attrs.get("sale_items", [])
        if not items:
            raise serializers.ValidationError("At least one cylinder item is required.")
        payment_mode = attrs.get("payment_mode")
        customer = attrs.get("customer")
        paid_amount = attrs.get("paid_amount", Decimal("0"))
        if payment_mode == Sale.PaymentMode.CREDIT and customer is None:
            raise serializers.ValidationError("Credit sales must be linked to a customer.")
        if paid_amount < 0:
            raise serializers.ValidationError("Paid amount cannot be negative.")
        return attrs

    @transaction.atomic
    def create(self, validated_data):
        user = self.context["request"].user
        items_data = validated_data.pop("sale_items")
        location = validated_data["location"]
        payment_mode = validated_data["payment_mode"]
        paid = validated_data.get("paid_amount", Decimal("0"))

        # Validate stock and compute total
        total = Decimal("0")
        stock_rows = []
        for item in items_data:
            ctype = item["cylinder_type"]
            qty = item["quantity"]
            rate = item["rate"]
            stock = get_stock_row(ctype, location, Stock.Status.FILLED)
            if stock.quantity < qty:
                raise serializers.ValidationError(
                    f"Not enough filled stock for {ctype.name} at {location.name}."
                )
            total += Decimal(qty) * rate
            stock_rows.append((stock, qty, item))

        if paid > total:
            raise serializers.ValidationError("Paid amount cannot exceed total amount.")

        # Deduct filled stock; only add empties that were physically returned at sale time
        for stock, qty, item in stock_rows:
            stock.quantity -= qty
            stock.save(update_fields=["quantity", "updated_at"])
            returned = item.get("empty_returned", 0)
            if returned > 0:
                empty_stock = get_stock_row(item["cylinder_type"], location, Stock.Status.EMPTY)
                empty_stock.quantity += returned
                empty_stock.save(update_fields=["quantity", "updated_at"])

        sale = Sale.objects.create(
            sold_by=user,
            total_amount=total,
            balance_due=total - paid,
            **validated_data,
        )

        for stock, qty, item in stock_rows:
            line_total = Decimal(qty) * item["rate"]
            SaleItem.objects.create(
                sale=sale,
                cylinder_type=item["cylinder_type"],
                quantity=qty,
                rate=item["rate"],
                total_amount=line_total,
                empty_returned=item.get("empty_returned", 0),
            )

        if paid > 0 and sale.customer:
            Payment.objects.create(
                customer=sale.customer,
                sale=sale,
                amount=paid,
                payment_mode=payment_mode,
                received_by=user,
                note="Sale payment",
            )

        ActivityLog.objects.create(
            action="sale_created",
            description=f"Sale of Rs. {total} ({len(items_data)} item(s))",
            user=user,
            metadata={"sale_id": sale.id},
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
            user=payment.received_by,
            metadata={"payment_id": payment.id},
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
            user=expense.spent_by,
            metadata={"expense_id": expense.id},
        )
        return expense


class ActivityLogSerializer(serializers.ModelSerializer):
    user_name = serializers.CharField(source="user.username", read_only=True)

    class Meta:
        model = ActivityLog
        fields = "__all__"
