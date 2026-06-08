from django.contrib import admin
from django.contrib.auth.admin import UserAdmin

from .models import (
    ActivityLog, Booking, CustomerCylinderRate, CustomerProfile,
    CylinderType, Delivery, Expense, Notification, Payment, Sale, SaleItem,
    StaffProfile, Stock, StockLocation, StockMovement, User,
)


@admin.register(User)
class GasBookUserAdmin(UserAdmin):
    fieldsets = UserAdmin.fieldsets + (("GasBook", {"fields": ("role",)}),)
    list_display = ("username", "email", "role", "is_staff", "is_active")


admin.site.register(CylinderType)
admin.site.register(StockLocation)
admin.site.register(Stock)
admin.site.register(StockMovement)
admin.site.register(Sale)
admin.site.register(SaleItem)
admin.site.register(Payment)
admin.site.register(Expense)
admin.site.register(ActivityLog)
admin.site.register(CustomerProfile)
admin.site.register(StaffProfile)
admin.site.register(CustomerCylinderRate)
admin.site.register(Booking)
admin.site.register(Delivery)
admin.site.register(Notification)
