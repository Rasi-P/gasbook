from django.contrib import admin
from django.contrib.auth.admin import UserAdmin

from .models import (
    ActivityLog, Booking, CustomerCylinderRate, CustomerProfile,
    CylinderType, Delivery, Expense, Notification, Payment, PaymentReversal, Role, Sale, SaleItem,
    SaleRefund, SaleVoid, StaffProfile, Stock, StockLocation, StockMovement, User,
)


@admin.register(User)
class GasBookUserAdmin(UserAdmin):
    fieldsets = UserAdmin.fieldsets + (("GasBook", {"fields": ("role",)}),)
    list_display = ("username", "email", "role", "is_staff", "is_active")


class ViewOnlyAdmin(admin.ModelAdmin):
    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(ActivityLog)
class ActivityLogAdmin(ViewOnlyAdmin):
    """Audit trail: viewable here, written only by the application."""


@admin.register(Sale, SaleItem, Payment, Stock, StockMovement, SaleVoid, SaleRefund, PaymentReversal)
class FinancialRecordAdmin(ViewOnlyAdmin):
    """Sales, payments and stock change only through the app's workflows, which keep them
    consistent with each other and log the change; editing them here would bypass both."""


admin.site.register(Role)
admin.site.register(CylinderType)
admin.site.register(StockLocation)
admin.site.register(Expense)
admin.site.register(CustomerProfile)
admin.site.register(StaffProfile)
admin.site.register(CustomerCylinderRate)
admin.site.register(Booking)
admin.site.register(Delivery)
admin.site.register(Notification)
