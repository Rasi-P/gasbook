from django.apps import AppConfig


class CoreConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "core"

    def ready(self):
        from . import media_lifecycle  # noqa: F401
        from .tenancy import install_drf_hooks

        install_drf_hooks()
