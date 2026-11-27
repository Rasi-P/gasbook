"""Helpers for tests that send API requests at the same moment from separate threads.

Each thread gets its own database connection, so these tests must use TransactionTestCase
(data committed and visible to every thread) and PostgreSQL row locks behave for real.
"""
import contextlib
import importlib
import threading
import time
from unittest import mock

from django.db import connections
from rest_framework.test import APIClient


def run_concurrently(requests):
    """POST each (user, url, payload) from its own thread, all released at once.

    Returns (status code, response data) per request, in order; an exception raised
    inside a request (a deadlock, say) is returned as ("exception", repr) instead.
    """
    barrier = threading.Barrier(len(requests))
    results = [None] * len(requests)

    def worker(index, user, url, payload):
        try:
            client = APIClient()
            client.force_authenticate(user)
            barrier.wait(timeout=10)
            response = client.post(url, payload, format="json")
            results[index] = (response.status_code, getattr(response, "data", None))
        except Exception as exc:  # reported to the test, which fails on it
            results[index] = ("exception", repr(exc))
        finally:
            connections.close_all()

    threads = [threading.Thread(target=worker, args=(i, *request)) for i, request in enumerate(requests)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=60)
    return results


def holding_lock(target, seconds=0.5):
    """Patch the locking function ``target`` so each caller keeps its locks for ``seconds``
    after taking them. The other request then certainly arrives while the lock is held,
    which is the overlap a race needs."""
    module_path, name = target.rsplit(".", 1)
    real = getattr(importlib.import_module(module_path), name)

    def lock_then_wait(*args, **kwargs):
        result = real(*args, **kwargs)
        time.sleep(seconds)
        return result

    return mock.patch(target, side_effect=lock_then_wait)


def first_then_second(first, second, lock_target, hold=0.4, second_lock_target=None):
    """Send ``first``; only once it holds the lock taken by ``lock_target`` (the dotted path of
    the locking function both requests call), send ``second``. The second request must then wait
    in the database until the first commits: a fixed order, not a timing race.

    ``first`` and ``second`` are (user, url, payload). When the second request takes the shared
    lock through another function (a stock row locked by a different code path, say), name it in
    ``second_lock_target``. Returns (results, timing): results as in run_concurrently, timing with
    how long the second request waited for its lock after the first had taken it (None if the
    second never took that lock).
    """
    first_locked = threading.Event()
    stamps = {}

    def marker(real, role):
        def lock_and_mark(*args, **kwargs):
            result = real(*args, **kwargs)
            who = threading.current_thread().name
            if role in (who, "both"):
                stamps.setdefault(who, time.monotonic())
                if who == "first" and not first_locked.is_set():
                    first_locked.set()
                    time.sleep(hold)  # keep holding it: the second request is sent meanwhile
            return result
        return lock_and_mark

    def patch(target, role):
        module_path, name = target.rsplit(".", 1)
        return mock.patch(target, side_effect=marker(getattr(importlib.import_module(module_path), name), role))

    results = [None, None]

    def worker(index, user, url, payload):
        try:
            if index == 1:
                first_locked.wait(timeout=10)
            client = APIClient()
            client.force_authenticate(user)
            response = client.post(url, payload, format="json")
            results[index] = (response.status_code, getattr(response, "data", None))
        except Exception as exc:
            results[index] = ("exception", repr(exc))
        finally:
            connections.close_all()

    second_target = second_lock_target or lock_target
    with patch(lock_target, "first") if second_target != lock_target else patch(lock_target, "both"):
        extra = patch(second_target, "second") if second_target != lock_target else contextlib.nullcontext()
        with extra:
            threads = [threading.Thread(target=worker, args=(0, *first), name="first"),
                       threading.Thread(target=worker, args=(1, *second), name="second")]
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join(timeout=60)
    waited = stamps["second"] - stamps["first"] if "first" in stamps and "second" in stamps else None
    return results, {"second_waited": waited, "hold": hold}
