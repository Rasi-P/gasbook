from django.contrib.admin.apps import AdminConfig


class GasBookAdminConfig(AdminConfig):
    default_site = "core.admin_site.GasBookAdminSite"
