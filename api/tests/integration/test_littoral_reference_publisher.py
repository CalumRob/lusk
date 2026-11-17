"""#1041 — guarded roundtrip of the REAL R territory-reference publisher.

Bounded synthetic classified reference, no scalar/profile artifact dependency.
The proof creates and drops only its own random schema and holds the documented
shared mutex. Both dedicated roles and the exact test database are verified
before any DDL.
"""

from __future__ import annotations

import os
import subprocess
import uuid
from pathlib import Path
from urllib.parse import urlsplit

import pytest

from api.tests.integration.test_postgres_publication import (
    _aedar_guarded_configuration, _assert_aedar_server_identity)
from api.tests.integration.test_selected_profile_mean_http import (
    _acquire_mutex, _release_mutex)

pytestmark = pytest.mark.integration

ROOT = Path(__file__).resolve().parents[3]
SCHEMA = Path(__file__).resolve().parents[2] / "schema.sql"
PIPELINE = ROOT / "pipeline"


def test_littoral_reference_publisher_roundtrip():
    publish_dsn, read_dsn = _aedar_guarded_configuration()
    if os.environ.get("LUSK_TEST_ALLOW_SCHEMA_CLEANUP") != "1":
        pytest.fail("the littoral publisher proof is non-retained; set LUSK_TEST_ALLOW_SCHEMA_CLEANUP=1")
    psycopg = pytest.importorskip("psycopg")
    mutex = _acquire_mutex()
    verified = False
    schema = "it_littoral_pub_" + uuid.uuid4().hex[:12]
    try:
        with psycopg.connect(publish_dsn, autocommit=True) as identity:
            _assert_aedar_server_identity(identity, "lusk_it_contract_pub")
        with psycopg.connect(read_dsn, autocommit=True) as identity:
            _assert_aedar_server_identity(identity, "lusk_it_contract_read")
        verified = True

        with psycopg.connect(publish_dsn, autocommit=True) as connection:
            connection.execute(f'CREATE SCHEMA "{schema}"')
            connection.execute(f'SET search_path TO "{schema}"')
            connection.execute(SCHEMA.read_text(encoding="utf-8"))

        publish = urlsplit(publish_dsn)
        env = os.environ.copy()
        env.update({
            "LUSK_REFERENCE_TEST_HOST": publish.hostname or "",
            "LUSK_REFERENCE_TEST_PORT": str(publish.port or ""),
            "LUSK_REFERENCE_TEST_DATABASE": publish.path.lstrip("/"),
            "LUSK_REFERENCE_TEST_USER": publish.username or "",
            "LUSK_REFERENCE_TEST_SCHEMA": schema,
        })
        completed = subprocess.run(
            ["Rscript", "scripts/smoke-littoral-reference.R"],
            cwd=PIPELINE, env=env, capture_output=True, text=True, timeout=240,
        )
        assert completed.returncode == 0, (
            completed.stdout + "\n" + completed.stderr)

        with psycopg.connect(publish_dsn, autocommit=True) as connection:
            connection.execute(f'SET search_path TO "{schema}"')
            rows = connection.execute("""
                SELECT territory_id,littoral_code,littoral_classement_source
                FROM territory_reference ORDER BY territory_id""").fetchall()
            assert rows == [
                ("22", None, None),
                ("22001", "C", "Mer"),
                ("29083", "C", "Mer"),
                ("29209", "NC", None),
                ("53", None, None),
            ]
            marker = connection.execute("""
                SELECT row_count FROM table_publication
                WHERE table_name='territory_reference'""").fetchone()
            assert marker == (5,)
    finally:
        try:
            if verified:
                with psycopg.connect(publish_dsn, autocommit=True) as connection:
                    connection.execute(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE')
        finally:
            _release_mutex(mutex)
