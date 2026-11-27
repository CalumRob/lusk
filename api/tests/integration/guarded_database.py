"""Shared process mutex and retention policy for guarded PostgreSQL tests."""

from __future__ import annotations

from contextvars import ContextVar
import ctypes
import os


MUTEX_NAME = r"Local\LuskIntegrationContractDb"
MUTEX_TIMEOUT_MS = 600_000
_current_mutex = ContextVar("lusk_guarded_database_mutex", default=None)


def guarded_configuration_present():
    return all(os.environ.get(name) for name in (
        "LUSK_TEST_PUBLISH_DSN", "LUSK_TEST_READ_DSN",
        "LUSK_TEST_DATABASE_NAME", "LUSK_TEST_DATABASE_PREFIX",
    ))


def acquire_mutex():
    if os.name != "nt":
        return None
    kernel32 = ctypes.windll.kernel32
    handle = kernel32.CreateMutexW(None, False, MUTEX_NAME)
    if not handle:
        raise RuntimeError("could not create the integration database mutex")
    result = kernel32.WaitForSingleObject(handle, MUTEX_TIMEOUT_MS)
    if result not in (0, 0x80):
        kernel32.CloseHandle(handle)
        raise RuntimeError(f"timed out waiting for {MUTEX_NAME}")
    return handle


def release_mutex(handle):
    if handle is None:
        return
    kernel32 = ctypes.windll.kernel32
    kernel32.ReleaseMutex(handle)
    kernel32.CloseHandle(handle)


def retain_schema():
    """Inspection retention is explicit and off in every documented command."""
    return os.environ.get("LUSK_TEST_RETAIN_SCHEMA") == "1"
