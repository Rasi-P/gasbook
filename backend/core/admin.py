from django.contrib import admin
from django.contrib.auth.admin import UserAdmin

from .models import (
    ActivityLog, Booking, CustomerCylinderRate, CustomerProfile,
    CylinderType, Delivery, Expense, Notification, Payment, Role, Sale, SaleItem,
    StaffProfile, Stock, StockLocation, StockMovement, User,
)


@admin.register(User)
class GasBookUserAdmin(UserAdmin):
    fieldsets = UserAdmin.fieldsets + (("GasBook", {"fields": ("role",)}),)
    list_display = ("username", "email", "role", "is_staff", "is_active")


@admin.register(ActivityLog)
class ActivityLogAdmin(admin.ModelAdmin):
    """Audit trail: viewable here, written only by the application."""

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


admin.site.register(Role)
admin.site.register(CylinderType)
admin.site.register(StockLocation)
admin.site.register(Stock)
admin.site.register(StockMovement)
admin.site.register(Sale)
admin.site.register(SaleItem)
admin.site.register(Payment)
admin.site.register(Expense)
admin.site.register(CustomerProfile)
admin.site.register(StaffProfile)
admin.site.register(CustomerCylinderRate)
admin.site.register(Booking)
admin.site.register(Delivery)
admin.site.register(Notification)
