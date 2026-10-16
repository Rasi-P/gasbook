"""Disposable test databases only; never reads the application's DATABASE_URL."""
import sys
import tempfile
import atexit
from .settings import *  # noqa: F403
if 'test' not in sys.argv:
    raise RuntimeError('These settings are only for manage.py test.')
DATABASES = {'default': dj_database_url.parse(os.environ.get('INVENTORY_TEST_DATABASE_URL', 'sqlite:///:memory:'))}
config = DATABASES['default']
if config['ENGINE'].endswith('postgresql'):
    if config['HOST'] not in ('127.0.0.1','localhost') or config['NAME'] != 'inventory_test':
        raise RuntimeError('Use a disposable localhost inventory_test database.')
    config['TEST'] = {'NAME': 'test_inventory_suite'}
elif config['NAME'] != ':memory:':
    raise RuntimeError('SQLite tests must be in memory.')
ACCESSORIES_ENABLED = True
PASSWORD_HASHERS = ['django.contrib.auth.hashers.MD5PasswordHasher']
SECRET_KEY = 'isolated-inventory-tests-only-secret-not-for-real-use'
CACHES = {'default': {'BACKEND': 'django.core.cache.backends.locmem.LocMemCache'}}
_media = tempfile.TemporaryDirectory(prefix='inventory-test-media-')
MEDIA_ROOT = _media.name
atexit.register(_media.cleanup)
# Retired commerce tables are deliberately retained by 0015. Test flush must also
# clear their FK dependents, exclusively in the disposable database guarded above.
from django.core.management.commands.flush import Command as FlushCommand
_original_flush = FlushCommand.handle
def _flush_test_database(self, **options):
    options['allow_cascade'] = True
    return _original_flush(self, **options)
FlushCommand.handle = _flush_test_database
