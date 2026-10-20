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
