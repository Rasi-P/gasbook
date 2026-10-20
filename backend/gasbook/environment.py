"""Validate deployment configuration without opening database connections."""
import os
import re
from pathlib import Path
from urllib.parse import urlsplit

from django.core.exceptions import ImproperlyConfigured


def boolean(name, default=False):
    value = os.environ.get(name, str(default)).strip().lower()
    if value not in {"true", "false", "1", "0"}:
        raise ImproperlyConfigured(f"{name} must be true or false.")
    return value in {"true", "1"}


def csv(name, default=""):
    return [value.strip() for value in os.environ.get(name, default).split(",") if value.strip()]


def production_origins(name):
    values = csv(name)
    if not values:
        raise ImproperlyConfigured(f"{name} is required in production.")
    for value in values:
        try:
            url = urlsplit(value)
            valid = (url.scheme == "https" and url.hostname and not url.username and not url.password
                     and not url.path and not url.query and not url.fragment and "*" not in value
                     and url.hostname not in {"localhost", "127.0.0.1", "::1"})
            url.port
        except ValueError:
            valid = False
        if not valid:
            raise ImproperlyConfigured(f"{name} must contain explicit HTTPS origins without paths.")
    return values


def production_hosts():
    hosts = csv("ALLOWED_HOSTS")
    if not hosts or any(not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9.-]*", h)
                        or h in {"localhost", "127.0.0.1"} for h in hosts):
        raise ImproperlyConfigured("ALLOWED_HOSTS must contain explicit production hostnames.")
    return hosts


def production_media_root():
    value = os.environ.get("MEDIA_ROOT", "")
    if not value or not Path(value).is_absolute():
        raise ImproperlyConfigured("An absolute MEDIA_ROOT on persistent storage is required in production.")
    return Path(value)


def _demo_database_target_matches(database):
    """Constrain every source of connection-target options, without connecting.

    Django merges OPTIONS into libpq parameters, and libpq can fill omitted
    parameters from PG* environment variables or a service file. Permit only
    reviewed non-target options; unknown options must fail closed.
    """
    options = database.get("OPTIONS", {})
    allowed_options = {"sslmode", "sslrootcert", "channel_binding", "connect_timeout", "application_name"}
    target_environment = {
        "PGHOST", "PGHOSTADDR", "PGPORT", "PGDATABASE",
        "PGSERVICE", "PGSERVICEFILE", "PGSYSCONFDIR", "PGOPTIONS",
    }
    if not isinstance(options, dict) or options.keys() - allowed_options:
        return False
    if any(os.environ.get(name) for name in target_environment):
        return False
    if any(not isinstance(value, str) for key, value in options.items() if key != "connect_timeout"):
        return False
    if "connect_timeout" in options and (
        type(options["connect_timeout"]) is not int or options["connect_timeout"] <= 0
    ):
        return False
    return (
        database.get("ENGINE") == "django.db.backends.postgresql"
        and database.get("NAME") == "neondb"
        and database.get("HOST") in {
            # Exact direct hostname from the approved endpoint metadata.
            # Pooled aliases require independent verification before admission.
            "ep-calm-shape-b3nzc13z.c-4.ap-southeast-1.aws.neon.tech",
        }
        and database.get("PORT") in {None, "", 5432, "5432"}
        and options.get("sslmode") in {"require", "verify-ca", "verify-full"}
        and options.get("channel_binding", "prefer") in {"disable", "prefer", "require"}
    )


def demo_django_admin_enabled(*, production, debug, database, hosts, uploads_disabled, accessories_enabled):
    """An opt-in for this specific demo, never a general production admin switch.

    These are public resource identifiers, not credentials. Moving the demo to a
    different service/endpoint requires a reviewed code change, not a broad flag.
    This validates configuration only and never opens a database connection.
    """
    if not boolean("DEMO_DJANGO_ADMIN_ENABLED"):
        return False
    if not (
        production and not debug
        and os.environ.get("RENDER_SERVICE_ID") == "srv-dbbk71tg1s2s7398rfag"
        and hosts == ["gasbook-demo-api.onrender.com"]
        and _demo_database_target_matches(database)
        and uploads_disabled and not accessories_enabled
    ):
        raise ImproperlyConfigured(
            "DEMO_DJANGO_ADMIN_ENABLED is restricted to the approved GasBook demo "
            "service/database with production security and demo restrictions."
        )
    return True
