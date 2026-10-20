import os
from pathlib import Path

# pyrefly: ignore [missing-import]
import dj_database_url

from datetime import timedelta
from django.core.exceptions import ImproperlyConfigured
from .environment import boolean, csv, production_hosts, production_origins, production_media_root

BASE_DIR = Path(__file__).resolve().parent.parent

GASBOOK_ENV = os.environ.get("GASBOOK_ENV", "production")
if GASBOOK_ENV not in {"production", "development", "test"}:
    raise ImproperlyConfigured("GASBOOK_ENV must be production, development, or test.")
PRODUCTION = GASBOOK_ENV == "production"
DEBUG = boolean("DEBUG", not PRODUCTION)
SECRET_KEY = os.environ.get("SECRET_KEY", "")
if PRODUCTION:
    if DEBUG:
        raise ImproperlyConfigured("DEBUG must be false in production.")
    if len(SECRET_KEY) < 50 or len(set(SECRET_KEY)) < 5 or SECRET_KEY.startswith("django-insecure-"):
        raise ImproperlyConfigured("A strong SECRET_KEY of at least 50 characters is required in production.")
else:
    SECRET_KEY = SECRET_KEY or "development-only-not-a-production-signing-key"
ALLOWED_HOSTS = production_hosts() if PRODUCTION else csv("ALLOWED_HOSTS", "localhost,127.0.0.1,[::1]")
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https") if PRODUCTION else None
SECURE_SSL_REDIRECT = PRODUCTION
# Render accepts redirects as healthy: these exact probes must execute their
# views over HTTP too. All application/admin/media routes still require HTTPS.
SECURE_REDIRECT_EXEMPT = [r"^health/\Z", r"^ready/\Z"]
SESSION_COOKIE_SECURE = PRODUCTION
CSRF_COOKIE_SECURE = PRODUCTION
SESSION_COOKIE_HTTPONLY = True
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_HSTS_SECONDS = 3600 if PRODUCTION else 0
SECURE_HSTS_INCLUDE_SUBDOMAINS = False
SECURE_HSTS_PRELOAD = False

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "corsheaders",
    "rest_framework",
    "rest_framework_simplejwt",
    "core",
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "gasbook.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "gasbook.wsgi.application"

database_url = os.environ.get("DATABASE_URL", "")
if PRODUCTION and not database_url:
    raise ImproperlyConfigured("DATABASE_URL is required in production.")
try:
    database = dj_database_url.parse(database_url or f"sqlite:///{BASE_DIR / 'db.sqlite3'}", conn_max_age=600)
except Exception:
    raise ImproperlyConfigured("DATABASE_URL is invalid.") from None
if str(database.get("NAME", "")).lower() == "gasbook_qa":
    raise ImproperlyConfigured("The QA database is forbidden for this application configuration.")
if PRODUCTION and database["ENGINE"] != "django.db.backends.postgresql":
    raise ImproperlyConfigured("Production DATABASE_URL must select PostgreSQL.")
if database["ENGINE"] == "django.db.backends.postgresql":
    database.setdefault("OPTIONS", {})["connect_timeout"] = 5
    database["CONN_HEALTH_CHECKS"] = True
DATABASES = {"default": database}

# Redis cache — falls back gracefully if REDIS_URL not set
REDIS_URL = os.environ.get("REDIS_URL", "")
if REDIS_URL:
    CACHES = {
        "default": {
            "BACKEND": "django_redis.cache.RedisCache",
            "LOCATION": REDIS_URL,
            "OPTIONS": {"CLIENT_CLASS": "django_redis.client.DefaultClient"},
        }
    }
    SESSION_ENGINE = "django.contrib.sessions.backends.cache"
    SESSION_CACHE_ALIAS = "default"

AUTH_USER_MODEL = "core.User"

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "en-us"
TIME_ZONE = "Asia/Kolkata"
# Optional receipt details. Blank values are omitted; never invent business contact/tax data.
RECEIPT_BUSINESS_DETAILS = {
    "address": os.environ.get("RECEIPT_BUSINESS_ADDRESS", ""),
    "phone": os.environ.get("RECEIPT_BUSINESS_PHONE", ""),
    "email": os.environ.get("RECEIPT_BUSINESS_EMAIL", ""),
    "tax_id": os.environ.get("RECEIPT_BUSINESS_TAX_ID", ""),
}
USE_I18N = True
USE_TZ = True

STATIC_URL = "/static/"
STATIC_ROOT = Path(os.environ.get("STATIC_ROOT", BASE_DIR / "staticfiles"))
DEMO_DISABLE_UPLOADS = boolean("DEMO_DISABLE_UPLOADS", False)
STORAGES = {
    "default": {"BACKEND": (
        "core.demo_media.DisabledMediaStorage" if DEMO_DISABLE_UPLOADS
        else "django.core.files.storage.FileSystemStorage"
    )},
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage"},
}
MEDIA_URL = "/media/"
MEDIA_ROOT = "" if DEMO_DISABLE_UPLOADS else (
    production_media_root() if PRODUCTION else Path(os.environ.get("MEDIA_ROOT", BASE_DIR / "media"))
)
# Shared across threads in the initial single-worker deployment; restart clears counters.
CACHES = globals().get("CACHES", {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}})

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
TEST_RUNNER = "gasbook.test_runner.GasBookTestRunner"

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "core.authentication.GasBookJWTAuthentication",
    ),
    "DEFAULT_PERMISSION_CLASSES": ("rest_framework.permissions.IsAuthenticated",),
    "DEFAULT_PAGINATION_CLASS": "core.pagination.StandardPagination",
    "PAGE_SIZE": 10,
    "EXCEPTION_HANDLER": "core.exceptions.api_exception_handler",
    "DEFAULT_THROTTLE_RATES": {"login_account": "10/minute", "login_ip": "60/minute"},
    # Provider proxy/header behavior is not yet verified. Never accept a
    # caller-supplied X-Forwarded-For as a rate-limit identity.
    "NUM_PROXIES": 0,
}

CORS_ALLOWED_ORIGINS = production_origins("CORS_ALLOWED_ORIGINS") if PRODUCTION else [
    origin.strip()
    for origin in os.environ.get(
        "CORS_ALLOWED_ORIGINS",
        "http://localhost:5173,http://localhost:5174,http://localhost:80,http://localhost"
    ).split(",")
    if origin.strip()
]
CORS_ALLOW_CREDENTIALS = True
CSRF_TRUSTED_ORIGINS = production_origins("CSRF_TRUSTED_ORIGINS") if PRODUCTION else csv("CSRF_TRUSTED_ORIGINS")

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(hours=12),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=30),
    "ROTATE_REFRESH_TOKENS": True,
    "CHECK_REVOKE_TOKEN": True,
    "TOKEN_REFRESH_SERIALIZER": "core.authentication.PasswordAwareTokenRefreshSerializer",
}

# Enable only after the minimal inventory migration has been reviewed/applied.
ACCESSORIES_ENABLED = os.environ.get('ACCESSORIES_ENABLED', 'False') == 'True'
