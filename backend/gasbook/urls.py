from django.contrib import admin
from django.conf import settings
from django.urls import include, path
from rest_framework_simplejwt.views import TokenRefreshView

from core.views import CustomTokenObtainPairView
from core.operations import health, readiness, media_image

urlpatterns = [
    path("health/", health, name="health"),
    path("ready/", readiness, name="readiness"),
    path("media/<path:path>", media_image, name="media-image"),
    path("api/auth/token/", CustomTokenObtainPairView.as_view(), name="token_obtain_pair"),
    path("api/auth/token/refresh/", TokenRefreshView.as_view(), name="token_refresh"),
    path("api/", include("core.urls")),
]

# Business staff use the React management UI. Raw Django admin has no public
# production route; API login throttling does not protect AdminSite.login.
if not settings.PRODUCTION:
    urlpatterns.append(path("admin/", admin.site.urls))
