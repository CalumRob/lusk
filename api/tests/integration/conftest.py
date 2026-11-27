"""One guarded-database mutex fixture for every Python integration module."""

from __future__ import annotations

import importlib
import os

import pytest

from api.tests.integration.guarded_database import (
    _current_mutex, acquire_mutex, guarded_configuration_present, release_mutex,
    retain_schema,
)


@pytest.fixture(scope="session", autouse=True)
def guarded_psycopg_connections():
    """No Python test can open PostgreSQL outside the shared module mutex."""
    try:
        psycopg = importlib.import_module("psycopg")
    except ImportError:
        yield
        return
    original = psycopg.connect

    def connect(*args, **kwargs):
        if _current_mutex.get() is None:
            raise RuntimeError(
                "Guarded PostgreSQL connection attempted without Local\\LuskIntegrationContractDb")
        return original(*args, **kwargs)

    psycopg.connect = connect
    try:
        yield
    finally:
        psycopg.connect = original


@pytest.fixture(scope="module", autouse=True)
def integration_db_mutex():
    """Hold the shared mutex for setup, every test, cleanup and verification."""
    if not guarded_configuration_present():
        yield
        return
    handle = acquire_mutex()
    token = _current_mutex.set(handle)
    try:
        yield
    finally:
        _current_mutex.reset(token)
        release_mutex(handle)


@pytest.fixture(scope="module", autouse=True)
def guarded_module_schema_lifetime(integration_db_mutex, request):
    """Fail in the owning module if any guarded schema crosses its boundary."""
    if not guarded_configuration_present() or retain_schema():
        yield
        return
    import psycopg

    publish_dsn = os.environ["LUSK_TEST_PUBLISH_DSN"]
    with psycopg.connect(publish_dsn, autocommit=True) as connection:
        before = {row[0] for row in connection.execute(
            "SELECT nspname FROM pg_namespace WHERE nspname LIKE 'it\\_%'"
        ).fetchall()}
    try:
        yield
    finally:
        with psycopg.connect(publish_dsn, autocommit=True) as connection:
            after = {row[0] for row in connection.execute(
                "SELECT nspname FROM pg_namespace WHERE nspname LIKE 'it\\_%'"
            ).fetchall()}
        leaked = sorted(after - before)
        if leaked:
            pytest.fail(
                f"{request.node.module.__name__} left guarded schemas: {leaked}")
