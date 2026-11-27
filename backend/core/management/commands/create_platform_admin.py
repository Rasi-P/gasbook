"""Create a GasBook platform admin (manages tenants; sees no tenant's business data)."""
from getpass import getpass

from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from core.models import Role, User
from core.tenancy import PLATFORM_ROLE


class Command(BaseCommand):
    help = "Create a platform admin with an interactive password prompt."

    def add_arguments(self, parser):
        parser.add_argument("--username", required=True)
        parser.add_argument("--email", default="")

    def handle(self, *args, **options):
        username = options["username"].strip()
        if not username:
            raise CommandError("Username is required.")
        if User.all_tenants.filter(username=username).exists():
            raise CommandError("That username is already taken.")
        password = getpass("Password: ")
        if password != getpass("Password (again): "):
            raise CommandError("Passwords do not match.")
        candidate = User(username=username, email=options["email"])
        try:
            validate_password(password, candidate)
        except ValidationError as exc:
            raise CommandError(" ".join(exc.messages)) from None
        with transaction.atomic():
            role, _ = Role.objects.get_or_create(code=PLATFORM_ROLE, defaults={"name": "Platform Admin"})
            User.objects.create_user(username=username, email=options["email"], password=password, role=role, tenant=None)
        self.stdout.write(self.style.SUCCESS(f"Platform admin {username} created."))
