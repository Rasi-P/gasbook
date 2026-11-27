"""Explicit, interactive first-admin setup; never seeds business/demo records."""
from getpass import getpass

from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.core.management.base import BaseCommand, CommandError
from django.db import connection, transaction

from core.models import Role, User


class Command(BaseCommand):
    help = "Create the first GasBook admin using an interactive password prompt on a verified database."

    def add_arguments(self, parser):
        parser.add_argument("--database-name", required=True)
        parser.add_argument("--username", required=True)
        parser.add_argument("--email", required=True)

    def handle(self, *args, **options):
        config = connection.settings_dict
        if config["ENGINE"] != "django.db.backends.postgresql" or str(config["NAME"]) == "gasbook_qa":
            raise CommandError("Bootstrap requires an approved PostgreSQL database; QA is forbidden.")
        if options["database_name"] != str(config["NAME"]):
            raise CommandError("Database name confirmation does not match configuration.")
        with connection.cursor() as cursor:
            cursor.execute("SELECT current_database()")
            if cursor.fetchone()[0] != options["database_name"]:
                raise CommandError("Connected database identity does not match confirmation.")
        username = options["username"].strip()
        email = options["email"].strip()
        candidate = User(username=username, email=email, is_staff=True, is_superuser=True)
        try:
            validate_email(email)
            candidate.full_clean(exclude=["password"])
            password = getpass("New admin password: ")
            if password != getpass("Confirm password: "):
                raise CommandError("Passwords do not match.")
            validate_password(password, candidate)
        except (ValidationError, EOFError):
            raise CommandError("Invalid account details or password; use a unique username, valid email and strong password.") from None
        with transaction.atomic():
            # Serialize concurrent bootstrap attempts without adding a schema migration.
            with connection.cursor() as cursor:
                cursor.execute("SELECT pg_advisory_xact_lock(712903812)")
            if User.objects.filter(is_superuser=True).exists() or User.objects.filter(role__code="admin").exists():
                raise CommandError("An administrator already exists. Use the established account recovery process.")
            roles = {}
            for code, name in (("admin", "Admin"), ("staff", "Staff"), ("customer", "Customer")):
                roles[code], _ = Role.objects.get_or_create(code=code, defaults={"name": name})
            User.objects.create_superuser(username=username, email=email, password=password, role=roles["admin"], plain_password="")
        self.stdout.write(self.style.SUCCESS("First GasBook administrator created. No business data was seeded."))
