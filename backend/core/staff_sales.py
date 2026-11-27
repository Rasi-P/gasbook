"""Staff sale endpoints reuse admin sale validation, pricing, stock, and retry protection."""
from rest_framework.decorators import action
from rest_framework.response import Response
from .views import SaleViewSet, IsStaffOrAdmin, IsAdminUserRole, parse_client_ref
from .serializers import SplitPaymentSerializer, PaymentSerializer
from .exceptions import ApiError
from .collections import collect, payment_data, today_summary


class StaffSaleViewSet(SaleViewSet):
    def get_queryset(self):
        return super().get_queryset().order_by("-created_at", "-id")

    def get_permissions(self):
        if self.action in ('list', 'retrieve', 'create', 'preview', 'collect_payment', 'collections_today'):
            return [IsStaffOrAdmin()]
        return [IsAdminUserRole()]

    @action(detail=False, methods=['get'], url_path='collections-today')
    def collections_today(self, request):
        return Response(today_summary(request.user))

    @action(detail=True, methods=['post'], url_path='collect-payment')
    def collect_payment(self, request, pk=None):
        sale = self.get_object()
        allowed = {'client_ref', 'payments'}
        if not isinstance(request.data, dict) or set(request.data)-allowed:
            raise ApiError('Send only client_ref and payments.', code='invalid')
        serializer = SplitPaymentSerializer(data=request.data.get('payments', []), many=True)
        serializer.is_valid(raise_exception=True)
        rows, replay = collect(sale.customer, sale, serializer.validated_data, request.user,
                               parse_client_ref(request.data.get('client_ref')))
        sale.refresh_from_db()
        return Response({'payment_summary': payment_data(sale), 'payments': PaymentSerializer(rows, many=True).data},
                        status=200 if replay else 201)
