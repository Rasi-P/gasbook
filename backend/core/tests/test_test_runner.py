from types import SimpleNamespace
from unittest.mock import Mock, patch

from django.core.exceptions import ImproperlyConfigured
from django.test import SimpleTestCase, override_settings
from django.test.runner import DiscoverRunner

from gasbook.test_runner import GasBookTestRunner, RETIRED_TABLES, test_database_flush


@override_settings(GASBOOK_ENV='test')
class DisposableFlushTests(SimpleTestCase):
    def connection(self, name='test_inventory_suite'):
        return SimpleNamespace(settings_dict={'NAME': name}, introspection=SimpleNamespace(
            table_names=Mock(return_value=[*RETIRED_TABLES, 'core_product', 'django_migrations', 'unrelated_table'])))

    def test_includes_only_existing_retired_tables_without_cascade(self):
        connection, original = self.connection(), Mock(return_value=['SQL'])
        result = test_database_flush(connection, 'test_inventory_suite', original)('style', ['core_product'], reset_sequences=True)
        self.assertEqual(result, ['SQL'])
        original.assert_called_once_with('style', sorted({'core_product', *RETIRED_TABLES}),
                                         reset_sequences=True, allow_cascade=False)

    def test_absent_retired_tables_and_empty_flush_are_unchanged(self):
        connection, original = self.connection(), Mock()
        connection.introspection.table_names.return_value = ['core_product']
        flush = test_database_flush(connection, 'test_inventory_suite', original)
        flush('style', ['core_product'])
        original.assert_called_with('style', ['core_product'], reset_sequences=False, allow_cascade=False)
        connection.introspection.table_names.reset_mock()
        flush('style', [])
        connection.introspection.table_names.assert_not_called()
        original.assert_called_with('style', [], reset_sequences=False, allow_cascade=False)

    def test_wrong_database_or_environment_refuses_before_inspection(self):
        for configured, expected, environment in [('existing', 'test_inventory_suite', 'test'),
                                                  ('existing', 'existing', 'test'),
                                                  ('test_inventory_suite', 'test_inventory_suite', 'production')]:
            connection, original = self.connection(configured), Mock()
            with override_settings(GASBOOK_ENV=environment), self.assertRaises(ImproperlyConfigured):
                test_database_flush(connection, expected, original)('style', ['core_product'])
            connection.introspection.table_names.assert_not_called()
            original.assert_not_called()

    def test_runner_refuses_reuse_parallel_or_non_test_mode_before_database_setup(self):
        for environment, options in [('production', {}), ('test', {'keepdb': True}), ('test', {'parallel': 2})]:
            with override_settings(GASBOOK_ENV=environment), patch.object(DiscoverRunner, 'setup_databases') as setup:
                with self.assertRaises(ImproperlyConfigured):
                    GasBookTestRunner(**options).setup_databases()
                setup.assert_not_called()

    def test_runner_refuses_an_unsafe_name_before_database_setup(self):
        connection = self.connection('existing')
        connection.vendor = 'postgresql'
        connection.creation = SimpleNamespace(_get_test_db_name=lambda: 'existing')
        with patch('gasbook.test_runner.connections', {'default': connection}), patch.object(DiscoverRunner, 'setup_databases') as setup:
            with self.assertRaises(ImproperlyConfigured):
                GasBookTestRunner().setup_databases(aliases={'default'})
            setup.assert_not_called()

    def test_normal_flush_method_is_restored_even_if_suite_raises(self):
        for fail in (False, True):
            connection = self.connection()
            original = Mock()
            connection.ops = SimpleNamespace(sql_flush=original)
            runner = GasBookTestRunner()
            runner.test_database_names = {'default': 'test_inventory_suite'}
            def run_suite(*args, **kwargs):
                self.assertIsNot(connection.ops.sql_flush, original)
                if fail:
                    raise RuntimeError('test failure')
                return 'result'
            with patch('gasbook.test_runner.connections', {'default': connection}), patch.object(DiscoverRunner, 'run_suite', side_effect=run_suite):
                if fail:
                    with self.assertRaises(RuntimeError):
                        runner.run_suite(None)
                else:
                    self.assertEqual(runner.run_suite(None), 'result')
            self.assertIs(connection.ops.sql_flush, original)
