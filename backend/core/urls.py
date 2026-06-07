from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import (
    ActivityLogViewSet,
    BookingViewSet,
    CustomerCylinderRateViewSet,
    CustomerProfileViewSet,
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
    change_password,
    dashboard,
    me,
    register,
    reports,
    user_detail,
    user_credentials,
    users_list,
    customer_credentials,
)

router = DefaultRouter()
router.register("cylinder-types", CylinderTypeViewSet)
router.register("locations", StockLocationViewSet)
router.register("stock", StockViewSet)
router.register("movements", StockMovementViewSet)
router.register("customers", CustomerProfileViewSet, basename="customers")
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
    path("auth/change-password/", change_password),
    path("auth/register/", register),
    path("auth/users/", users_list),
    path("auth/users/<int:pk>/", user_detail),
    path("auth/users/<int:pk>/credentials/", user_credentials),
    path("dashboard/", dashboard),
    path("reports/", reports),
    path("customers/<int:pk>/credentials/", customer_credentials),
] + router.urls
