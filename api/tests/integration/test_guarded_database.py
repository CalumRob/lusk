"""DB-free proof that Python PostgreSQL connections require the shared mutex."""

import pytest

from api.tests.integration.guarded_database import _current_mutex


pytestmark = pytest.mark.integration


def test_guarded_module_cannot_connect_without_shared_mutex():
    import psycopg

    token = _current_mutex.set(None)
    try:
        with pytest.raises(RuntimeError, match="without Local.*LuskIntegrationContractDb"):
            psycopg.connect("postgresql://invalid.invalid/never_connected")
    finally:
        _current_mutex.reset(token)
