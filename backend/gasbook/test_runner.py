"""Include retained migration tables in cleanup of newly created test databases.

0015 deliberately leaves three retired commerce tables in PostgreSQL. Django's
normal flush lists only current models, so their foreign keys prevent TRUNCATE.
Add the retained tables to that same statement; do not use CASCADE, drop tables,
change migration state, or alter the normal management command.
"""
from contextlib import ExitStack
from unittest.mock import patch

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from django.db import connections
from django.test.runner import DiscoverRunner


RETIRED_TABLES = frozenset({"core_commerceorder", "core_commerceline", "core_serviceoffering"})


def test_database_flush(connection, database_name, original):
    def sql_flush(style, tables, *, reset_sequences=False, allow_cascade=False):
        if (settings.GASBOOK_ENV != "test" or not database_name.startswith("test_")
                or connection.settings_dict["NAME"] != database_name):
            raise ImproperlyConfigured("Legacy-table cleanup is restricted to the created test database.")
        if tables:
            retained = RETIRED_TABLES.intersection(connection.introspection.table_names())
            tables = sorted(set(tables).union(retained))
        return original(style, tables, reset_sequences=reset_sequences, allow_cascade=allow_cascade)
    return sql_flush


class GasBookTestRunner(DiscoverRunner):
    def setup_databases(self, **kwargs):
        # These restrictions are checked before Django opens database connections.
        if settings.GASBOOK_ENV != "test" or self.keepdb or self.parallel > 1:
            raise ImproperlyConfigured("Use GASBOOK_ENV=test, a fresh disposable database, and a serial test run.")
        self.test_database_names = {}
        aliases = kwargs.get("aliases")
        for alias in connections if aliases is None else aliases:
            connection = connections[alias]
            if connection.vendor == "postgresql":
                name = str(connection.creation._get_test_db_name())
                if not name.startswith("test_") or name == str(connection.settings_dict["NAME"]):
                    raise ImproperlyConfigured("Use a separate PostgreSQL test database named test_….")
        result = super().setup_databases(**kwargs)
        for connection, _old_name, _destroy in result:
            if connection.vendor == "postgresql":
                name = str(connection.settings_dict["NAME"])
                if not name.startswith("test_"):
                    raise ImproperlyConfigured("PostgreSQL test database names must begin with test_.")
                self.test_database_names[connection.alias] = name
        return result

    def run_suite(self, suite, **kwargs):
        with ExitStack() as cleanup:
            for alias, name in self.test_database_names.items():
                connection = connections[alias]
                cleanup.enter_context(patch.object(connection.ops, "sql_flush",
                    test_database_flush(connection, name, connection.ops.sql_flush)))
            return super().run_suite(suite, **kwargs)
