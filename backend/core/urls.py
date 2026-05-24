from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import (
    ActivityLogViewSet,
    CustomerViewSet,
    CylinderTypeViewSet,
    ExpenseViewSet,
    PaymentViewSet,
    SaleViewSet,
    StockLocationViewSet,
    StockMovementViewSet,
    StockViewSet,
    dashboard,
    me,
    register,
    reports,
    users_list,
)

router = DefaultRouter()
router.register("cylinder-types", CylinderTypeViewSet)
router.register("locations", StockLocationViewSet)
router.register("stock", StockViewSet)
router.register("movements", StockMovementViewSet)
router.register("customers", CustomerViewSet)
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
] + router.urls
