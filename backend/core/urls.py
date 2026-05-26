from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import (
    ActivityLogViewSet,
    BookingViewSet,
    CustomerCylinderRateViewSet,
    CustomerProfileViewSet,
    CustomerViewSet,
    CylinderTypeViewSet,
    DeliveryViewSet,
    ExpenseViewSet,
    NotificationViewSet,
    PaymentViewSet,
    SaleViewSet,
    StaffProfileViewSet,
    StockLocationViewSet,
    StockMovementViewSet,
    StockViewSet,
    dashboard,
    me,
    register,
    reports,
    users_list,
    customer_credentials,
)

router = DefaultRouter()
router.register("cylinder-types", CylinderTypeViewSet)
router.register("locations", StockLocationViewSet)
router.register("stock", StockViewSet)
router.register("movements", StockMovementViewSet)
router.register("customers", CustomerViewSet)
router.register("customer-profiles", CustomerProfileViewSet)
router.register("staff-profiles", StaffProfileViewSet)
router.register("customer-rates", CustomerCylinderRateViewSet)
router.register("bookings", BookingViewSet)
router.register("deliveries", DeliveryViewSet)
router.register("notifications", NotificationViewSet, basename="notifications")
router.register("sales", SaleViewSet)
router.register("payments", PaymentViewSet)
router.register("expenses", ExpenseViewSet)
router.register("activity", ActivityLogViewSet)

urlpatterns = [
    path("auth/me/", me),
    path("auth/register/", register),
    path("auth/users/", users_list),
    path("dashboard/", dashboard),
    path("reports/", reports),
    path("customers/<int:pk>/credentials/", customer_credentials),
] + router.urls
