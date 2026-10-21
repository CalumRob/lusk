"""Opt-in end-to-end checks against an explicitly disposable PostgreSQL database.

Nothing connects unless both LUSK_TEST_* DSNs and an exact disposable database
name are supplied. Each run owns a fresh schema; public is never modified.
"""

from __future__ import annotations

import json
import concurrent.futures
import csv
from contextlib import contextmanager
import os
import re
import subprocess
import sys
import threading
import uuid
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlsplit, urlunsplit

import pytest


pytestmark = pytest.mark.integration


def _configuration():
    publish_dsn = os.environ.get("LUSK_TEST_PUBLISH_DSN")
    read_dsn = os.environ.get("LUSK_TEST_READ_DSN")
    database_name = os.environ.get("LUSK_TEST_DATABASE_NAME")
    prefix = os.environ.get("LUSK_TEST_DATABASE_PREFIX")
    if not all((publish_dsn, read_dsn, database_name, prefix)):
        pytest.skip("requires explicit LUSK_TEST_* DSNs, database name, and disposable prefix")
    if prefix != "lusk_it_" or not database_name.startswith(prefix):
        pytest.fail("LUSK_TEST_DATABASE_PREFIX must be exactly 'lusk_it_' and prefix the database name")
    if database_name.casefold() in {"lusk", "postgres", "template0", "template1"}:
        pytest.fail("Refusing a production/default PostgreSQL database name")
    publish = urlsplit(publish_dsn)
    reader = urlsplit(read_dsn)
    if publish.scheme not in {"postgres", "postgresql"} or reader.scheme not in {"postgres", "postgresql"}:
        pytest.fail("Integration DSNs must be PostgreSQL URI DSNs")
    if publish.path.lstrip("/") != database_name or reader.path.lstrip("/") != database_name:
        pytest.fail("Both DSNs must target exactly LUSK_TEST_DATABASE_NAME")
    if not publish.hostname or not publish.port or not reader.hostname or not reader.port:
        pytest.fail("Both DSNs must specify an explicit PostgreSQL host and port")
    if publish.hostname.casefold() != reader.hostname.casefold() or publish.port != reader.port:
        pytest.fail("Publish/read DSNs must target the same explicitly named test server")
    if publish.username == reader.username:
        pytest.fail("Use distinct publisher and read-only database roles")
    return publish_dsn, read_dsn


def _aedar_guarded_configuration():
    """Pin AEDAR DDL proofs to the documented operator-owned test target."""
    publish_dsn, read_dsn = _configuration()
    passfile = os.environ.get("PGPASSFILE")
    if not passfile or not Path(passfile).is_file():
        pytest.fail("AEDAR guarded tests require the existing private PGPASSFILE")
    publish, reader = urlsplit(publish_dsn), urlsplit(read_dsn)
    expected = {
        "database": "lusk_it_contract",
        "host": "192.168.1.120",
        "port": 5432,
        "publisher": "lusk_it_contract_pub",
        "reader": "lusk_it_contract_read",
    }
    if (os.environ.get("LUSK_TEST_DATABASE_NAME") != expected["database"] or
            os.environ.get("LUSK_TEST_DATABASE_PREFIX") != "lusk_it_" or
            publish.scheme not in {"postgres", "postgresql"} or
            reader.scheme not in {"postgres", "postgresql"} or
            (publish.hostname, publish.port, publish.path.lstrip("/"), publish.username) !=
            (expected["host"], expected["port"], expected["database"], expected["publisher"]) or
            (reader.hostname, reader.port, reader.path.lstrip("/"), reader.username) !=
            (expected["host"], expected["port"], expected["database"], expected["reader"])):
        pytest.fail("AEDAR guarded tests require the exact documented test host, database, and roles")
    return publish_dsn, read_dsn


def _assert_aedar_server_identity(connection, expected_role):
    identity = connection.execute("""SELECT current_database(),current_user,
        inet_server_addr()::text,inet_server_port()""").fetchone()
    if identity != ("lusk_it_contract", expected_role, "192.168.16.3/32", 5432):
        pytest.fail(f"AEDAR guarded server identity mismatch: {identity!r}")


def _lineage_r_library_preflight():
    """Validate retained-proof settings before any schema or database work."""
    if os.environ.get("LUSK_TEST_ALLOW_SCHEMA_CLEANUP") == "1":
        pytest.fail("Issue #814 comparison proof always retains its schema; unset LUSK_TEST_ALLOW_SCHEMA_CLEANUP")
    r_libs_user = os.environ.get("R_LIBS_USER", "")
    if not r_libs_user or not Path(r_libs_user).is_dir():
        pytest.fail("Guarded R publisher proof requires R_LIBS_USER to name an existing populated R library (Rscript uses --vanilla)")
    return r_libs_user


@pytest.fixture
def lineage_r_library_preflight():
    return _lineage_r_library_preflight()


def test_issue_814_retained_fixture_refuses_cleanup_before_database_work(monkeypatch):
    monkeypatch.setenv("LUSK_TEST_ALLOW_SCHEMA_CLEANUP", "1")
    monkeypatch.delenv("R_LIBS_USER", raising=False)
    monkeypatch.setattr(sys.modules[__name__], "_configuration",
        lambda: pytest.fail("Database configuration must not be reached when cleanup is enabled"))
    with pytest.raises(pytest.fail.Exception, match="always retains its schema"):
        next(retained_canonical_db_env.__wrapped__(None))


def test_generic_canonical_fixture_keeps_cleanup_opt_in_separate(monkeypatch):
    monkeypatch.setenv("LUSK_TEST_ALLOW_SCHEMA_CLEANUP", "1")
    monkeypatch.setattr(sys.modules[__name__], "_configuration",
        lambda: (_ for _ in ()).throw(RuntimeError("generic canonical configuration reached")))
    with pytest.raises(RuntimeError, match="generic canonical configuration reached"):
        next(canonical_db_env.__wrapped__())


def _dsn_with_schema(dsn: str, schema: str) -> str:
    parts = urlsplit(dsn)
    query = parse_qs(parts.query, keep_blank_values=True)
    # psycopg's libpq options set search_path for this connection only.
    query["options"] = [f"-csearch_path={schema}"]
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query, doseq=True), parts.fragment))


def test_migration_040_aedar_reference_contract_matches_fresh_schema():
    """Upgrade the pinned pre-040 AEDAR shape and compare it with fresh DDL."""
    import psycopg

    publish_dsn, _ = _aedar_guarded_configuration()
    root = Path(__file__).resolve().parents[2]
    baseline = subprocess.check_output(
        ["git", "show", "75b6ad661d8ab677c33c73152598d097590c7886:api/schema.sql"],
        cwd=root, text=True, encoding="utf-8")
    migration = (root / "migrations/040_aedar_reference_only_publication.sql").read_text(encoding="utf-8")
    schemas = {"upgrade": "it_810_aedar_upgrade_" + uuid.uuid4().hex[:12],
               "fresh": "it_810_aedar_fresh_" + uuid.uuid4().hex[:12]}
    evidence_dir = Path("E:/Temp/opencode") / ("issue-810-migration-040-" + uuid.uuid4().hex[:12])
    evidence_dir.mkdir(parents=True, exist_ok=False)
    (evidence_dir / "schema-intent.json").write_text(json.dumps({
        "schemas": schemas, "database": os.environ["LUSK_TEST_DATABASE_NAME"],
        "publisher_role": urlsplit(publish_dsn).username,
        "purpose": "issue-810 guarded migration and fresh-schema parity",
    }, indent=2), encoding="utf-8")
    print(f"migration 040 retained schemas: {schemas}; evidence: {evidence_dir}", flush=True)

    tables=["aedar_comparison_publication","aedar_comparison_group","aedar_comparison_territory"]
    def contract(connection, schema):
        columns=connection.execute("""SELECT table_name,column_name,data_type,is_nullable,column_default
            FROM information_schema.columns WHERE table_schema=%s AND table_name=ANY(%s)
            ORDER BY table_name,ordinal_position""",(schema,tables)).fetchall()
        constraints=connection.execute("""SELECT t.relname,c.conname,c.contype,
            pg_get_constraintdef(c.oid),c.convalidated,c.condeferrable
            FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
            JOIN pg_namespace n ON n.oid=t.relnamespace
            WHERE n.nspname=%s AND t.relname=ANY(%s) ORDER BY t.relname,c.conname""",
            (schema,tables)).fetchall()
        triggers=connection.execute("""SELECT t.relname,g.tgname,pg_get_triggerdef(g.oid)
            FROM pg_trigger g JOIN pg_class t ON t.oid=g.tgrelid
            JOIN pg_namespace n ON n.oid=t.relnamespace
            WHERE n.nspname=%s AND t.relname=ANY(%s) AND NOT g.tgisinternal
            ORDER BY t.relname,g.tgname""",(schema,tables)).fetchall()
        grants=connection.execute("""SELECT table_name,grantee,privilege_type,is_grantable
            FROM information_schema.role_table_grants WHERE table_schema=%s AND table_name=ANY(%s)
            ORDER BY table_name,grantee,privilege_type,is_grantable""",(schema,tables)).fetchall()
        function=connection.execute("""SELECT pg_get_functiondef(p.oid) FROM pg_proc p
            JOIN pg_namespace n ON n.oid=p.pronamespace
            WHERE n.nspname=%s AND p.proname='check_aedar_comparison_publication'""",
            (schema,)).fetchall()
        triggers=[(table,name,re.sub(r"\s+"," ",definition.replace(f'"{schema}".',"").replace(f'{schema}.',"")))
            for table,name,definition in triggers]
        function=[re.sub(r"\s+"," ",row[0].replace(f'"{schema}".',"").replace(f'{schema}.',""))
            for row in function]
        return columns,constraints,triggers,grants,function

    with psycopg.connect(publish_dsn, autocommit=True) as connection:
        parts = urlsplit(publish_dsn)
        _assert_aedar_server_identity(connection, parts.username)
        for schema in schemas.values():
            connection.execute(f'CREATE SCHEMA "{schema}"')
        connection.execute(f'SET search_path TO "{schemas["upgrade"]}"')
        connection.execute(baseline)
        before = connection.execute("""SELECT
            (SELECT count(*) FROM aedar_comparison_publication),
            (SELECT count(*) FROM aedar_comparison_group),
            (SELECT count(*) FROM aedar_comparison_territory)""").fetchone()
        connection.execute(migration)
        upgraded = contract(connection, schemas["upgrade"])
        after = connection.execute("""SELECT
            (SELECT count(*) FROM aedar_comparison_publication),
            (SELECT count(*) FROM aedar_comparison_group),
            (SELECT count(*) FROM aedar_comparison_territory)""").fetchone()
        assert after == before == (0, 0, 0)
        connection.execute(f'SET search_path TO "{schemas["fresh"]}"')
        connection.execute((root / "schema.sql").read_text(encoding="utf-8"))
        fresh = contract(connection, schemas["fresh"])
        assert upgraded == fresh
        with (root.parent / "pipeline/inst/extdata/aedar-typequ-2025.csv").open(
                newline="", encoding="utf-8") as typequ_file:
            typequ_count = sum(1 for _ in csv.DictReader(typequ_file))
        from api.aedar_models import AEDAR_MEASURE_KEYS
        # Acceptance arithmetic for the current canonical seven-class registry
        # and the two same-level reference kinds; not a serving-time constant.
        expected_reference_rows = (7 + 2) * typequ_count * len(AEDAR_MEASURE_KEYS)
        sample_tuple_bytes = connection.execute("""SELECT pg_column_size(
            ROW('same_level','53','epci','A104',%s,'median',1.5,
                NULL::bigint,NULL::bigint,NULL::text)::aedar_comparison_group)""",
            (sorted(AEDAR_MEASURE_KEYS)[0],)).fetchone()[0]
        print("AEDAR reference-only schema estimate:", {
            "reference_group_rows": expected_reference_rows,
            "sample_tuple_bytes": sample_tuple_bytes,
            "estimated_group_heap_bytes": expected_reference_rows * sample_tuple_bytes,
            "territory_peer_rows": 0,
            "note": "representative tuple estimate; excludes indexes, page fill and catalog overhead",
        }, flush=True)
        assert connection.execute("""SELECT has_table_privilege('lusk_reader',%s,'SELECT'),
            has_table_privilege('lusk_reader',%s,'SELECT')""",
            (f'{schemas["fresh"]}.aedar_comparison_group',
             f'{schemas["fresh"]}.aedar_comparison_territory')).fetchone() == (True, False)


@pytest.fixture(scope="module")
def db_env(tmp_path_factory):
    publish_dsn, read_dsn = _configuration()
    psycopg = pytest.importorskip("psycopg")
    schema = "it_" + uuid.uuid4().hex[:20]
    scoped_publish = _dsn_with_schema(publish_dsn, schema)
    scoped_read = _dsn_with_schema(read_dsn, schema)
    schema_path = Path(__file__).resolve().parents[2] / "schema.sql"
    created = False
    try:
        with psycopg.connect(publish_dsn, autocommit=True) as connection:
            connection.execute(f'CREATE SCHEMA "{schema}"')
            created = True
            connection.execute(f'SET search_path TO "{schema}"')
            connection.execute(schema_path.read_text(encoding="utf-8"))
            reader_role = urlsplit(read_dsn).username
            if not reader_role or not re.fullmatch(r"[A-Za-z0-9_$-]+", reader_role):
                pytest.fail("Read DSN must identify a simple PostgreSQL role name")
            quoted_role = '"' + reader_role.replace('"', '""') + '"'
            connection.execute(f'GRANT USAGE ON SCHEMA "{schema}" TO {quoted_role}')
            connection.execute(f'GRANT SELECT ON ALL TABLES IN SCHEMA "{schema}" TO {quoted_role}')
        yield {
            "publish_dsn": scoped_publish,
            "read_dsn": scoped_read,
            "schema": schema,
            "artifacts": _write_artifacts(tmp_path_factory.mktemp("canonical")),
        }
    finally:
        if created and os.environ.get("LUSK_TEST_ALLOW_SCHEMA_CLEANUP") == "1":
            with psycopg.connect(publish_dsn, autocommit=True) as connection:
                connection.execute(f'DROP SCHEMA "{schema}" CASCADE')


@pytest.fixture
def canonical_db_env():
    """Generic owned schema; the documented cleanup opt-in applies to this fixture."""
    publish_dsn, read_dsn = _configuration()
    psycopg = pytest.importorskip("psycopg")
    passfile = os.environ.get("PGPASSFILE")
    if not passfile or not Path(passfile).is_file():
        pytest.fail("Guarded comparison publication requires the existing private PGPASSFILE")
    publish, reader = urlsplit(publish_dsn), urlsplit(read_dsn)
    expected_database = "lusk_it_contract"
    expected_host = "192.168.1.120"
    expected_port = 5432
    expected_publisher = "lusk_it_contract_pub"
    expected_reader = "lusk_it_contract_read"
    if (os.environ.get("LUSK_TEST_DATABASE_NAME") != expected_database or
            os.environ.get("LUSK_TEST_DATABASE_PREFIX") != "lusk_it_" or
            (publish.hostname, publish.port, publish.path.lstrip("/"), publish.username) !=
            (expected_host, expected_port, expected_database, expected_publisher) or
            (reader.hostname, reader.port, reader.path.lstrip("/"), reader.username) !=
            (expected_host, expected_port, expected_database, expected_reader)):
        pytest.fail("Guarded comparison publication requires the exact test-only host, database, and roles")
    schema = "it_" + uuid.uuid4().hex[:20]
    scoped_publish = _dsn_with_schema(publish_dsn, schema)
    scoped_read = _dsn_with_schema(read_dsn, schema)
    schema_path = Path(__file__).resolve().parents[2] / "schema.sql"
    created = False
    try:
        for dsn, role in ((publish_dsn, expected_publisher), (read_dsn, expected_reader)):
            with psycopg.connect(dsn, autocommit=True) as connection:
                identity = connection.execute("""SELECT current_database(),current_user,
                    inet_server_addr()::text,inet_server_port()""").fetchone()
                if identity != (expected_database, role, "192.168.16.3/32", expected_port):
                    pytest.fail(f"Guarded comparison database identity mismatch: {identity!r}")
        with psycopg.connect(publish_dsn, autocommit=True) as connection:
            connection.execute(f'CREATE SCHEMA "{schema}"')
            created = True
            connection.execute(f'SET search_path TO "{schema}"')
            connection.execute(schema_path.read_text(encoding="utf-8"))
            reader_role = urlsplit(read_dsn).username
            if not reader_role or not re.fullmatch(r"[A-Za-z0-9_$-]+", reader_role):
                pytest.fail("Read DSN must identify a simple database role name")
            quoted_role = '"' + reader_role.replace('"', '""') + '"'
            connection.execute(f'GRANT USAGE ON SCHEMA "{schema}" TO {quoted_role}')
            connection.execute(f'GRANT SELECT ON ALL TABLES IN SCHEMA "{schema}" TO {quoted_role}')
        yield {"publish_dsn": scoped_publish, "read_dsn": scoped_read, "schema": schema}
    finally:
        if created and os.environ.get("LUSK_TEST_ALLOW_SCHEMA_CLEANUP") == "1":
            with psycopg.connect(publish_dsn, autocommit=True) as connection:
                connection.execute(f'DROP SCHEMA "{schema}" CASCADE')


@pytest.fixture
def retained_canonical_db_env(tmp_path_factory):
    """Issue #814's guarded publisher schema and evidence are always retained."""
    import json
    _lineage_r_library_preflight()
    publish_dsn, read_dsn = _configuration()
    psycopg = pytest.importorskip("psycopg")
    passfile = os.environ.get("PGPASSFILE")
    if not passfile or not Path(passfile).is_file():
        pytest.fail("Guarded comparison publication requires the existing private PGPASSFILE")
    publish, reader = urlsplit(publish_dsn), urlsplit(read_dsn)
    expected_database = "lusk_it_contract"
    expected_host = "192.168.1.120"
    expected_port = 5432
    expected_publisher = "lusk_it_contract_pub"
    expected_reader = "lusk_it_contract_read"
    if (os.environ.get("LUSK_TEST_DATABASE_NAME") != expected_database or
            os.environ.get("LUSK_TEST_DATABASE_PREFIX") != "lusk_it_" or
            (publish.hostname, publish.port, publish.path.lstrip("/"), publish.username) !=
            (expected_host, expected_port, expected_database, expected_publisher) or
            (reader.hostname, reader.port, reader.path.lstrip("/"), reader.username) !=
            (expected_host, expected_port, expected_database, expected_reader)):
        pytest.fail("Guarded comparison publication requires the exact test-only host, database, and roles")
    schema = "it_" + uuid.uuid4().hex[:20]
    scoped_publish = _dsn_with_schema(publish_dsn, schema)
    scoped_read = _dsn_with_schema(read_dsn, schema)
    schema_path = Path(__file__).resolve().parents[2] / "schema.sql"
    for dsn, role in ((publish_dsn, expected_publisher), (read_dsn, expected_reader)):
        with psycopg.connect(dsn, autocommit=True) as connection:
            identity = connection.execute("""SELECT current_database(),current_user,
                inet_server_addr()::text,inet_server_port()""").fetchone()
            if identity != (expected_database, role, "192.168.16.3/32", expected_port):
                pytest.fail(f"Guarded comparison database identity mismatch: {identity!r}")
    configured_evidence_root = os.environ.get("LUSK_TEST_EVIDENCE_DIR", "")
    if configured_evidence_root:
        evidence_root = Path(configured_evidence_root)
        evidence_root.mkdir(parents=True, exist_ok=True)
    else:
        evidence_root = tmp_path_factory.mktemp("issue-814-evidence")
    evidence_dir = evidence_root / ("issue-814-mutable-source-labels-" + uuid.uuid4().hex[:12])
    evidence_dir.mkdir(parents=True, exist_ok=False)
    (evidence_dir / "schema-intent.json").write_text(json.dumps({
        "schema": schema,
        "database": expected_database,
        "host": expected_host,
        "port": expected_port,
        "publisher_role": expected_publisher,
        "reader_role": expected_reader,
        "purpose": "issue #814 guarded mutable source-label publication proof",
        "cleanup": "disabled; retain schema and evidence",
    }, indent=2), encoding="utf-8")
    print(f"issue #814 retained schema intent: {schema}; evidence: {evidence_dir}", flush=True)
    with psycopg.connect(publish_dsn, autocommit=True) as connection:
        connection.execute(f'CREATE SCHEMA "{schema}"')
        connection.execute(f'SET search_path TO "{schema}"')
        connection.execute(schema_path.read_text(encoding="utf-8"))
        reader_role = urlsplit(read_dsn).username
        if not reader_role or not re.fullmatch(r"[A-Za-z0-9_$-]+", reader_role):
            pytest.fail("Read DSN must identify a simple database role name")
        quoted_role = '"' + reader_role.replace('"', '""') + '"'
        connection.execute(f'GRANT USAGE ON SCHEMA "{schema}" TO {quoted_role}')
        connection.execute(f'GRANT SELECT ON ALL TABLES IN SCHEMA "{schema}" TO {quoted_role}')
    yield {"publish_dsn": scoped_publish, "read_dsn": scoped_read, "schema": schema}


@pytest.fixture
def canonical_r_publisher_db_env(lineage_r_library_preflight, retained_canonical_db_env):
    """Order R --vanilla configuration validation before guarded schema DDL."""
    return retained_canonical_db_env


@pytest.fixture
def retained_lineage_schema_env():
    """Use only an explicitly named, already-populated retained test schema."""
    if os.environ.get("LUSK_TEST_ALLOW_SCHEMA_CLEANUP") == "1":
        pytest.fail("Issue #814 comparison proof always retains its schema; unset LUSK_TEST_ALLOW_SCHEMA_CLEANUP")
    schema = os.environ.get("LUSK_LINEAGE_TEST_SCHEMA", "")
    if not schema:
        pytest.skip("set LUSK_LINEAGE_TEST_SCHEMA to an existing retained lusk_it_contract it_* schema")
    r_libs_user = _lineage_r_library_preflight()
    if not re.fullmatch(r"it_[A-Za-z0-9_]+", schema):
        pytest.fail("LUSK_LINEAGE_TEST_SCHEMA must name an existing it_* schema")
    publish_dsn, read_dsn = _configuration()
    passfile = os.environ.get("PGPASSFILE")
    if not passfile or not Path(passfile).is_file():
        pytest.fail("Retained lineage rollback check requires the existing private PGPASSFILE")
    publish, reader = urlsplit(publish_dsn), urlsplit(read_dsn)
    if (os.environ.get("LUSK_TEST_DATABASE_NAME") != "lusk_it_contract" or
            os.environ.get("LUSK_TEST_DATABASE_PREFIX") != "lusk_it_" or
            (publish.hostname, publish.port, publish.path.lstrip("/"), publish.username) !=
            ("192.168.1.120", 5432, "lusk_it_contract", "lusk_it_contract_pub") or
            (reader.hostname, reader.port, reader.path.lstrip("/"), reader.username) !=
            ("192.168.1.120", 5432, "lusk_it_contract", "lusk_it_contract_read")):
        pytest.fail("Retained lineage rollback check requires the exact test-only host, database, and roles")
    import psycopg
    with psycopg.connect(_dsn_with_schema(read_dsn, schema), autocommit=True) as connection:
        identity = connection.execute("""SELECT current_database(),current_user,
            inet_server_addr()::text,inet_server_port(),current_schema()""").fetchone()
        if identity != ("lusk_it_contract", "lusk_it_contract_read", "192.168.16.3/32", 5432, schema):
            pytest.fail(f"Retained lineage schema identity mismatch: {identity!r}")
        if connection.execute("SELECT count(*) FROM observed_collection_descriptor WHERE indicator_id='lineage_collection'").fetchone()[0] != 1:
            pytest.fail("Retained schema does not contain the expected synthetic collection descriptor")
        if connection.execute("SELECT count(*) FROM period_detail_observation WHERE indicator_id='lineage_collection'").fetchone()[0] == 0:
            pytest.fail("Retained schema does not contain the expected synthetic collection facts")
    return {
        "publish_dsn": _dsn_with_schema(publish_dsn, schema),
        "read_dsn": _dsn_with_schema(read_dsn, schema),
        "schema": schema,
        "r_libs_user": r_libs_user,
    }


def _write_artifacts(root: Path) -> tuple[Path, Path]:
    """Small canonical Parquet-shaped publication, with metadata owned by fixture."""
    pa = pytest.importorskip("pyarrow")
    import pyarrow.parquet as pq

    territories = [
        {"territoire": "29001", "nom": "Alpha", "departement": "29", "epci": "200000001",
         "classe_densite_code": "D1", "classe_densite_libelle_public": "Centres urbains"},
        {"territoire": "29002", "nom": "Beta", "departement": "29", "epci": "200000001",
         "classe_densite_code": "D1", "classe_densite_libelle_public": "Centres urbains"},
        {"territoire": "29003", "nom": "Gamma", "departement": "29", "epci": "200000002",
         "classe_densite_code": "D2", "classe_densite_libelle_public": "Bourgs ruraux"},
        {"territoire": "200000001", "nom": "Intercommunalité Alpha", "departement": "29", "epci": None,
         "classe_densite_code": None, "classe_densite_libelle_public": None},
    ]
    rows = []
    values = {"t": [0.2, 0.5, 0.8, 0.6], "b": [0.4, 0.5, 0.6, 0.7], "c": [0.8, 0.5, 0.2, 0.4]}
    for index, territory in enumerate(territories):
        for mode, vals in values.items():
            rows.append({"theme": "mobilite", "territoire": territory["territoire"],
                         "type": "epci" if territory["territoire"].startswith("2") and len(territory["territoire"]) == 9 else "commune",
                         "key": f"share_school_{mode}", "value": vals[index], "unit": "%",
                         "vintage_source": "Fixture source", "vintage_version": "2026-01",
                         "vintage_date_reference": "2025-01-01", "vintage_date_publication": "2026-02-01"})
    pq.write_table(pa.Table.from_pylist(territories), root / "territoires.parquet")
    pq.write_table(pa.Table.from_pylist(rows), root / "indicateurs_mobilite.parquet")
    pq.write_table(pa.Table.from_pylist([{"id": "fixture", "source": "Fixture source", "version": "2026-01",
        "date_reference": "2025-01-01", "date_publication": "2026-02-01"}]), root / "vintages.parquet")
    metadata = root / "theme_mobilite.json"
    metadata.write_text(json.dumps({
        "sources": {f"share_school_{mode}": "fixture" for mode in "tbc"},
        "indicator_labels": {f"share_school_{mode}": f"School access {mode}" for mode in "tbc"},
        "indicator_directions": {"share_school_t": "high", "share_school_b": "high", "share_school_c": "low"},
        "comparison_scopes": {"bretagne": {"kind": "communes-bretagne", "label": "communes bretonnes"}},
        "subgroups": [{"key": "services", "indicators": [f"share_school_{mode}" for mode in "tbc"]}],
    }), encoding="utf-8")
    return root, metadata


def test_reader_role_cannot_insert_or_create(db_env):
    import psycopg
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        with psycopg.connect(db_env["read_dsn"], autocommit=True) as connection:
            connection.execute("INSERT INTO table_publication(table_name,content_version,row_count) VALUES ('territory_reference','x',0)")
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        with psycopg.connect(db_env["read_dsn"], autocommit=True) as connection:
            connection.execute("CREATE TABLE forbidden_reader_write (id integer)")
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        with psycopg.connect(db_env["read_dsn"], autocommit=True) as connection:
            connection.execute("CREATE SCHEMA forbidden_reader_schema")


def test_fresh_schema_contains_retained_model_and_excludes_legacy_access_objects(canonical_db_env):
    """Pin the actual fresh-install object boundary, not only the API inventory."""
    import psycopg

    excluded = {
        "access_publication_metadata", "service_registry", "essential_service_access",
        "building_evidence_descriptor", "building_evidence_descriptor_source",
        "building_ramp", "building_grid", "bpe_profile_evidence_descriptor",
        "bpe_profile_class_axis", "bpe_profile_evidence", "bpe_profile_evidence_source",
        "mobility_density_distribution_descriptor", "mobility_density_distribution_range",
        "mobility_density_distribution_point",
    }
    retained = {
        "territory_reference", "source_dataset", "source_vintage", "scalar_descriptor",
        "scalar_observation", "profile_descriptor", "ordered_series",
        "observed_collection_descriptor", "period_detail_observation", "anchored_membership",
        "aedar_territorial_aggregate", "aedar_comparison_publication",
    }
    with psycopg.connect(canonical_db_env["read_dsn"]) as connection:
        tables = {row[0] for row in connection.execute("""SELECT table_name
            FROM information_schema.tables WHERE table_schema=current_schema()
              AND table_type='BASE TABLE'""")}
        functions = {row[0] for row in connection.execute("""SELECT p.proname FROM pg_proc p
            JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=current_schema()""")}
    assert excluded.isdisjoint(tables), f"excluded legacy serving tables remain: {sorted(excluded & tables)}"
    assert retained <= tables, f"retained serving tables missing: {sorted(retained - tables)}"
    excluded_functions = {
        "assert_building_fact_source", "assert_building_dataset_complete",
        "assert_building_descriptor_publication", "assert_current_dataset_complete",
        "assert_bpe_profile_evidence_complete", "validate_mobility_density_distribution_territory",
        "assert_mobility_density_distribution_complete",
    }
    assert excluded_functions.isdisjoint(functions), (
        f"excluded legacy validation functions remain: {sorted(excluded_functions & functions)}")


def test_r_retained_reference_publisher_uses_fresh_schema_and_noops(canonical_db_env):
    """Exercise the production DBI adapter where legacy relations do not exist."""
    publish = urlsplit(os.environ["LUSK_TEST_PUBLISH_DSN"])
    env = os.environ.copy()
    env.update({
        "LUSK_REFERENCE_TEST_HOST": publish.hostname or "",
        "LUSK_REFERENCE_TEST_PORT": str(publish.port or ""),
        "LUSK_REFERENCE_TEST_DATABASE": os.environ["LUSK_TEST_DATABASE_NAME"],
        "LUSK_REFERENCE_TEST_USER": publish.username or "",
        "LUSK_REFERENCE_TEST_SCHEMA": canonical_db_env["schema"],
    })
    pipeline = Path(__file__).resolve().parents[3] / "pipeline"
    completed = subprocess.run(
        ["Rscript", "scripts/smoke-retained-territory-reference.R"],
        cwd=pipeline, env=env, capture_output=True, text=True, timeout=120,
    )
    assert completed.returncode == 0, completed.stdout + "\n" + completed.stderr


def test_migration_036_drops_legacy_access_objects_and_preserves_published_scalar():
    """Apply the additive retirement to populated pinned pre-change schema data."""
    import psycopg

    publish_dsn, _ = _configuration()
    schema = "it_m036_" + uuid.uuid4().hex[:16]
    created = False
    root = Path(__file__).resolve().parents[2]
    old_schema = subprocess.check_output(
        ["git", "show", "09364831:api/schema.sql"], cwd=root,
        text=True, encoding="utf-8")
    migration = (root / "migrations" / "036_retire_legacy_accessibility_serving.sql").read_text(
        encoding="utf-8")
    try:
        with psycopg.connect(publish_dsn, autocommit=True) as connection:
            connection.execute(f'CREATE SCHEMA "{schema}"')
            created = True
            connection.execute(f'SET search_path TO "{schema}"')
            connection.execute(old_schema)
            connection.execute("BEGIN")
            connection.execute("""INSERT INTO territory_reference(territory_id,territory_type,name,
                department_id,epci_id,density_class_code,density_class_label)
                VALUES ('MIG-1','commune','Migration fixture','29','E1','D1','Dense')""")
            connection.execute("""INSERT INTO table_publication(table_name,content_version,row_count)
                VALUES ('territory_reference','ref-m036-v1',1)""")
            connection.execute("INSERT INTO source_dataset VALUES ('migration-fixture','Migration fixture')")
            connection.execute("""INSERT INTO source_vintage(source_id,vintage_id,version)
                VALUES ('migration-fixture','v1','fixture-v1')""")
            connection.execute("""INSERT INTO scalar_descriptor(indicator_id,theme_id,label,unit,direction,
                comparison_facet,allowed_levels,denominator_semantics,completeness,descriptor_version)
                VALUES ('migration_scalar','habitat','Migration scalar','units','high','migration_scalar',
                ARRAY['commune'],'fixture denominator','sparse','descriptor-m036-v1')""")
            connection.execute("""INSERT INTO scalar_descriptor_source
                VALUES ('migration_scalar','migration-fixture')""")
            connection.execute("""INSERT INTO scalar_observation(indicator_id,territory_id,territory_type,
                value,status,support_count,denominator_count)
                VALUES ('migration_scalar','MIG-1','commune',0,'measured',0,1)""")
            connection.execute("""INSERT INTO scalar_observation_source
                VALUES ('migration_scalar','MIG-1','migration-fixture','v1')""")
            connection.execute("""INSERT INTO table_publication(table_name,content_version,row_count,
                reference_content_version)
                VALUES ('scalar_observation','scalar-m036-v7',1,'ref-m036-v1')""")
            connection.execute("""INSERT INTO mobility_reading_story(story_key,groupe,salience_reason,ordinal)
                VALUES ('retired-story','retired-group','fixture',1)""")
            connection.execute("""INSERT INTO mobility_reading_clock(ordinal,clock_name,frequency,reference,trigger)
                VALUES (1,'retired-clock','fixture','fixture','fixture')""")
            connection.execute("""INSERT INTO mobility_reading_descriptor(singleton,descriptor_version,
                source_id,vintage_id,source_name,dataset_name,source_version,unit,direction,allowed_levels,
                missing_status,classification_values,field_keys,story_count,clock_count)
                VALUES (true,'retired-descriptor-v1','migration-fixture','v1','Migration fixture',
                'Migration fixture','fixture-v1','fixture','none',ARRAY['commune'],'unavailable',
                ARRAY['fixture'],ARRAY['story_key'],1,1)""")
            connection.execute("""INSERT INTO mobility_typed_reading(territory_id,territory_type,groupe,
                story_key,salience_reason,div_loss_t,div_loss_b,status,source_id,vintage_id)
                VALUES ('MIG-1','commune','retired-group','retired-story','fixture',0.3,0.2,
                'measured','migration-fixture','v1')""")
            connection.execute("""INSERT INTO table_publication(table_name,content_version,row_count,
                reference_content_version) VALUES ('mobility_typed_reading','retired-m036-v1',1,'ref-m036-v1')""")
            connection.execute("INSERT INTO access_publication_metadata(singleton,bretagne_kind,bretagne_label) VALUES(true,'fixture','Fixture')")
            connection.execute("INSERT INTO service_registry VALUES ('fixture-service')")
            connection.execute("""INSERT INTO essential_service_access(territory_id,service,mode,share,
                indicator_label,effective_direction,source_id,source_name,source_version)
                VALUES ('MIG-1','fixture-service','car',0.25,'Fixture','high',
                'migration-fixture','Migration fixture','fixture-v1')""")
            levels = ["commune", "epci", "departement", "region"]
            ramp_contract = {
                "shape": "building_ramp", "peer_statistic": "building_count_weighted_mean",
                "territory_levels": levels, "direction": "high",
                "axes": {"mode": ["c", "b", "t"],
                         "quantile": [0, .1, .2, .3, .4, .5, .6, .7, .8, .9, 1]},
            }
            grid_contract = {
                "shape": "building_grid", "peer_statistic": "pooled_building_counts",
                "territory_levels": levels,
                "axes": {"mode": "t", "breadth": ["b1", "b2", "b3", "b4", "b5"],
                         "depth": ["d1", "d2", "d3", "d4", "d5", "d6"]},
            }
            for table_name, version, contract in (
                ("building_ramp", "ramp-m036-v1", ramp_contract),
                ("building_grid", "grid-m036-v1", grid_contract),
            ):
                connection.execute("""INSERT INTO building_evidence_descriptor
                    VALUES (%s,%s,%s::jsonb)""", (table_name,version,json.dumps(contract)))
                connection.execute("""INSERT INTO building_evidence_descriptor_source
                    VALUES (%s,'migration-fixture')""", (table_name,))
            connection.execute("""INSERT INTO building_ramp(territory_id,territory_type,availability,mode,
                quantile_index,quantile,accessible_types,total_buildings,source_id,source_version,effective_direction)
                VALUES ('MIG-1','commune','absent','c',-1,NULL,NULL,0,'migration-fixture','v1','high')""")
            connection.execute("""INSERT INTO building_grid(territory_id,territory_type,availability,mode,
                cell_index,breadth_bucket,depth_bucket,building_count,total_buildings,source_id,source_version)
                VALUES ('MIG-1','commune','absent','t',-1,NULL,NULL,NULL,0,'migration-fixture','v1')""")
            connection.execute("""INSERT INTO table_publication(table_name,content_version,row_count,
                reference_content_version) VALUES ('building_ramp','ramp-m036-v1',1,'ref-m036-v1'),
                ('building_grid','grid-m036-v1',1,'ref-m036-v1')""")

            # Seed the BPE legacy family as a coherent four-class partition. Its
            # deferred trigger is exercised at commit before migration removes it.
            connection.execute("""INSERT INTO bpe_profile_evidence_descriptor(singleton,indicator_id,
                descriptor_version,allowed_levels,completeness,classification_id,universe_count,
                universe_sha256,registry_filename,registry_semantic_effect,membership_sha256,source_id,vintage_id)
                VALUES(true,'bpe_access_profile','bpe-m036-v1',ARRAY['commune','epci','departement','region'],
                'dense_complete','fixture-classification',1,repeat('a',64),'fixture.csv','fixture effect',
                repeat('b',64),'migration-fixture','v1')""")
            for ordinal, (class_key, label, count) in enumerate((
                ('class-a','Class A',1),('class-b','Class B',0),
                ('class-c','Class C',0),('class-d','Class D',0),
            )):
                connection.execute("""INSERT INTO bpe_profile_class_axis
                    VALUES (%s,%s,%s,%s)""", (class_key,label,ordinal,'none'))
                exemplar = ('A123','Fixture TYPEQU',0.1,0.2,0.3) if count else (None,None,None,None,None)
                connection.execute("""INSERT INTO bpe_profile_evidence(territory_id,territory_type,class_key,
                    class_label,class_count,universe_count,exemplar_typequ,exemplar_label,exemplar_c,exemplar_b,exemplar_t)
                    VALUES ('MIG-1','commune',%s,%s,%s,1,%s,%s,%s,%s,%s)""",
                    (class_key,label,count,*exemplar))
                connection.execute("""INSERT INTO bpe_profile_evidence_source
                    VALUES ('commune','MIG-1',%s,'migration-fixture','v1')""", (class_key,))
            connection.execute("""INSERT INTO table_publication(table_name,content_version,row_count,
                reference_content_version) VALUES ('bpe_profile_evidence','bpe-m036-v1',4,'ref-m036-v1')""")

            # Exercise the legacy mobility distribution's own dense-axis trigger.
            connection.execute("INSERT INTO source_dataset VALUES ('mobilite_snapshot','Mobility fixture')")
            connection.execute("INSERT INTO source_vintage(source_id,vintage_id,version) VALUES ('mobilite_snapshot','v1','fixture-v1')")
            connection.execute("""INSERT INTO mobility_density_distribution_descriptor
                VALUES(true,'density-m036-v1','mobilite_snapshot','v1',1,
                ARRAY['commune','epci','departement','region'],'km','%')""")
            connection.execute("""INSERT INTO mobility_density_distribution_range
                VALUES('MIG-1','commune',1,3,'measured','mobilite_snapshot','v1')""")
            connection.execute("""INSERT INTO mobility_density_distribution_point
                VALUES('MIG-1','commune',0,2,'measured',50,'measured','mobilite_snapshot','v1')""")
            connection.execute("""INSERT INTO table_publication(table_name,content_version,row_count,
                reference_content_version) VALUES ('mobility_density_distribution','density-m036-v1',2,'ref-m036-v1')""")
            connection.execute("COMMIT")

            before_scalar = connection.execute("""SELECT o.value,o.status,o.support_count,
                o.denominator_count,s.source_id,s.vintage_id,p.content_version,p.reference_content_version
                FROM scalar_observation o JOIN scalar_observation_source s USING(indicator_id,territory_id)
                JOIN table_publication p ON p.table_name='scalar_observation'
                WHERE o.indicator_id='migration_scalar'""").fetchone()
            connection.execute(migration)
            objects = {row[0] for row in connection.execute("""SELECT table_name
                FROM information_schema.tables WHERE table_schema=current_schema()
                  AND table_type='BASE TABLE'""")}
            legacy = {
                "access_publication_metadata", "service_registry", "essential_service_access",
                "building_evidence_descriptor", "building_evidence_descriptor_source",
                "building_ramp", "building_grid", "bpe_profile_evidence_descriptor",
                "bpe_profile_class_axis", "bpe_profile_evidence", "bpe_profile_evidence_source",
                "mobility_density_distribution_descriptor", "mobility_density_distribution_range",
                "mobility_density_distribution_point", "mobility_typed_reading",
                "mobility_reading_descriptor", "mobility_reading_story", "mobility_reading_clock",
            }
            assert legacy.isdisjoint(objects), sorted(legacy & objects)
            assert connection.execute("SELECT count(*) FROM table_publication WHERE table_name='mobility_typed_reading'").fetchone()[0] == 0
            after_scalar = connection.execute("""SELECT o.value,o.status,o.support_count,
                o.denominator_count,s.source_id,s.vintage_id,p.content_version,p.reference_content_version
                FROM scalar_observation o JOIN scalar_observation_source s USING(indicator_id,territory_id)
                JOIN table_publication p ON p.table_name='scalar_observation'
                WHERE o.indicator_id='migration_scalar'""").fetchone()
            assert after_scalar == before_scalar
            assert connection.execute("""SELECT content_version FROM table_publication
                WHERE table_name='territory_reference'""").fetchone()[0] == 'ref-m036-v1'
            assert connection.execute("""SELECT count(*) FROM scalar_descriptor_source
                WHERE indicator_id='migration_scalar' AND source_id='migration-fixture'""").fetchone()[0] == 1
            functions = {row[0] for row in connection.execute("""SELECT proname FROM pg_proc p
                JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=current_schema()""")}
            assert not functions.intersection({
                "assert_building_fact_source", "assert_building_dataset_complete",
                "assert_building_descriptor_publication", "assert_current_dataset_complete",
                "assert_bpe_profile_evidence_complete", "validate_mobility_density_distribution_territory",
                "assert_mobility_density_distribution_complete",
            })
            triggers = {row[0] for row in connection.execute("""SELECT tgname FROM pg_trigger t
                JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
                WHERE n.nspname=current_schema() AND NOT tgisinternal""")}
            assert {"scalar_observation_levels", "scalar_observation_source_required"} <= triggers
    finally:
        if created and os.environ.get("LUSK_TEST_ALLOW_SCHEMA_CLEANUP") == "1":
            with psycopg.connect(publish_dsn, autocommit=True) as connection:
                connection.execute(f'DROP SCHEMA "{schema}" CASCADE')


def test_shared_scalar_schema_constraints_and_bounded_read(canonical_db_env):
    import psycopg
    from fastapi.testclient import TestClient
    from psycopg_pool import ConnectionPool
    from api import main

    with psycopg.connect(canonical_db_env["publish_dsn"], autocommit=True) as connection:
        connection.execute("INSERT INTO territory_reference(territory_id,territory_type,name) VALUES ('29001','commune','Alpha')")
        connection.execute("INSERT INTO territory_reference(territory_id,territory_type,name) VALUES ('29002','commune','Beta')")
        connection.execute("INSERT INTO territory_reference(territory_id,territory_type,name) VALUES ('29003','commune','Gamma')")
        connection.execute("INSERT INTO territory_reference(territory_id,territory_type,name) VALUES ('E1','epci','Intercommunalité')")
        connection.execute("UPDATE territory_reference SET epci_id='E1' WHERE territory_id='29002'")
        connection.execute("UPDATE territory_reference SET density_class_code='D1',density_class_label='Dense' WHERE territory_type='commune' AND territory_id IN ('29001','29002')")
        connection.execute("INSERT INTO source_dataset(source_id,name) VALUES ('fixture','Fixture source')")
        connection.execute("INSERT INTO source_vintage(source_id,vintage_id,version) VALUES ('fixture','v2026','2026')")
        connection.execute("INSERT INTO source_dataset(source_id,name) VALUES ('fixture_secondary','Secondary source')")
        connection.execute("INSERT INTO source_vintage(source_id,vintage_id,version) VALUES ('fixture_secondary','v2025','2025')")
        with connection.transaction():
            connection.execute("INSERT INTO scalar_descriptor(indicator_id,theme_id,label,unit,direction,comparison_facet,allowed_levels,denominator_semantics,completeness,descriptor_version) VALUES ('fixture_scalar','demographie','Fixture scalar','count','high','fixture_scalar',ARRAY['commune'],'buildings','sparse','d1')")
            connection.execute("INSERT INTO scalar_descriptor(indicator_id,theme_id,label,unit,direction,comparison_facet,allowed_levels,denominator_semantics,completeness,descriptor_version) VALUES ('other_theme_scalar','habitat','Other theme scalar','count','high','other_theme_scalar',ARRAY['commune'],'buildings','sparse','other-v1')")
            connection.execute("INSERT INTO scalar_descriptor_source VALUES ('fixture_scalar','fixture'),('fixture_scalar','fixture_secondary')")
            connection.execute("INSERT INTO scalar_descriptor_source VALUES ('other_theme_scalar','fixture')")
        with connection.transaction():
            connection.execute("INSERT INTO scalar_observation(indicator_id,territory_id,territory_type,value,status,support_count,denominator_count) VALUES ('fixture_scalar','29001','commune',0,'measured',0,0)")
            connection.execute("INSERT INTO scalar_observation_source VALUES ('fixture_scalar','29001','fixture','v2026')")
            connection.execute("INSERT INTO scalar_observation_source VALUES ('fixture_scalar','29001','fixture_secondary','v2025')")
            connection.execute("INSERT INTO scalar_observation(indicator_id,territory_id,territory_type,value,status,support_count,denominator_count) VALUES ('fixture_scalar','29002','commune',2,'measured',1,1)")
            connection.execute("INSERT INTO scalar_observation_source VALUES ('fixture_scalar','29002','fixture','v2026')")
            connection.execute("INSERT INTO scalar_observation(indicator_id,territory_id,territory_type,value,status,support_count,denominator_count) VALUES ('other_theme_scalar','29001','commune',99,'measured',1,1)")
            connection.execute("INSERT INTO scalar_observation_source VALUES ('other_theme_scalar','29001','fixture','v2026')")
        with pytest.raises(psycopg.errors.ForeignKeyViolation):
            with connection.transaction():
                connection.execute("DELETE FROM scalar_descriptor_source WHERE indicator_id='fixture_scalar' AND source_id='fixture'")
        with connection.transaction():
            connection.execute("INSERT INTO scalar_descriptor(indicator_id,theme_id,label,unit,direction,comparison_facet,allowed_levels,denominator_semantics,completeness,descriptor_version) VALUES ('unreferenced_fixture','demographie','Unreferenced fixture','count','high',NULL,ARRAY['commune'],'buildings','sparse','d1')")
            connection.execute("INSERT INTO scalar_descriptor_source VALUES ('unreferenced_fixture','fixture'),('unreferenced_fixture','fixture_secondary')")
        # A non-last source can be removed without involving the observed
        # fixture's provenance; the remaining declared source keeps the
        # descriptor invariant satisfied.
        connection.execute("DELETE FROM scalar_descriptor_source WHERE indicator_id='unreferenced_fixture' AND source_id='fixture_secondary'")
        with pytest.raises(psycopg.errors.RaiseException, match="descriptor must declare at least one source dataset"):
            with connection.transaction():
                connection.execute("DELETE FROM scalar_descriptor_source WHERE indicator_id='unreferenced_fixture' AND source_id='fixture'")
        with connection.transaction():
            connection.execute("INSERT INTO scalar_descriptor(indicator_id,theme_id,label,unit,direction,comparison_facet,allowed_levels,denominator_semantics,completeness,descriptor_version) VALUES ('cascade_fixture','demographie','Cascade fixture','count','high',NULL,ARRAY['commune'],'buildings','sparse','d1')")
            connection.execute("INSERT INTO scalar_descriptor_source VALUES ('cascade_fixture','fixture')")
        connection.execute("DELETE FROM scalar_descriptor WHERE indicator_id='cascade_fixture'")
        connection.execute("INSERT INTO table_publication(table_name,content_version,row_count) VALUES ('territory_reference','territory-v1',4)")
        connection.execute("INSERT INTO table_publication(table_name,content_version,row_count,reference_content_version) VALUES ('scalar_observation','fixture-v1',3,'territory-v1')")
        # The fixed default context must have a coherent comparison owner;
        # fixtures do not fall back to read-time aggregates or raw provenance.
        connection.execute("INSERT INTO scalar_comparison_group(comparison_context,group_id,territory_type,indicator_id,statistic,median,member_count,eligible_count,missing_count,lineage_source_count) VALUES ('density_class','D1','commune','fixture_scalar','median',1,2,2,0,2)")
        connection.execute("INSERT INTO scalar_comparison_territory(comparison_context,group_id,territory_type,indicator_id,territory_id,value,status,rank,tie_count,rank_size) VALUES ('density_class','D1','commune','fixture_scalar','29001',0,'measured',2,1,2),('density_class','D1','commune','fixture_scalar','29002',2,'measured',1,1,2)")
        connection.execute("INSERT INTO comparison_source_lineage(comparison_family,comparison_context,group_id,territory_type,facet_id,source_id,vintage_id,comparison_content_version) VALUES ('scalar','density_class','D1','commune','fixture_scalar','fixture','v2026','comparison-v1'),('scalar','density_class','D1','commune','fixture_scalar','fixture_secondary','v2025','comparison-v1')")
        connection.execute("INSERT INTO scalar_comparison_publication(singleton,content_version,scalar_content_version,reference_content_version,group_row_count,territory_row_count,lineage_row_count) VALUES (true,'comparison-v1','fixture-v1','territory-v1',1,2,2)")
        # Zero is measured; null is legal only with typed unavailability.
        with pytest.raises(psycopg.errors.CheckViolation):
            connection.execute("INSERT INTO scalar_observation(indicator_id,territory_id,territory_type,value,status) VALUES ('fixture_scalar','29001','commune',NULL,'measured')")
        with pytest.raises(psycopg.errors.RaiseException):
            connection.execute("INSERT INTO scalar_observation(indicator_id,territory_id,territory_type,value,status) VALUES ('fixture_scalar','29001','region',1,'measured')")
        with pytest.raises(psycopg.errors.RaiseException):
            connection.execute("UPDATE scalar_descriptor SET allowed_levels=ARRAY['epci'] WHERE indicator_id='fixture_scalar'")
        with pytest.raises(psycopg.errors.RaiseException):
            connection.execute("UPDATE territory_reference SET territory_type='region' WHERE territory_id='29001'")
        with pytest.raises(psycopg.errors.CheckViolation):
            with connection.transaction():
                connection.execute("UPDATE scalar_observation SET value=0.5 WHERE indicator_id='fixture_scalar'")
                connection.execute("UPDATE table_publication SET content_version='partial' WHERE table_name='scalar_observation'")
                connection.execute("INSERT INTO scalar_observation(indicator_id,territory_id,territory_type,value,status) VALUES ('fixture_scalar','29001','commune',NULL,'measured')")
        assert connection.execute("SELECT value FROM scalar_observation WHERE indicator_id='fixture_scalar'").fetchone()[0] == 0
        assert connection.execute("SELECT content_version FROM table_publication WHERE table_name='scalar_observation'").fetchone()[0] == "fixture-v1"
        with pytest.raises(psycopg.errors.RaiseException, match="lacks a source-vintage association"):
            with connection.transaction():
                connection.execute("DELETE FROM scalar_observation_source WHERE indicator_id='fixture_scalar'")

    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        with psycopg.connect(canonical_db_env["read_dsn"], autocommit=True) as reader:
            reader.execute("INSERT INTO scalar_observation(indicator_id,territory_id,territory_type,value,status) VALUES ('fixture_scalar','29001','commune',1,'measured')")

    from dataclasses import replace

    pool = ConnectionPool(conninfo=canonical_db_env["read_dsn"], min_size=0, max_size=2, open=True,
                          kwargs={"autocommit": True})
    scalar_sql_reads = []
    class RecordingConnection:
        def __init__(self, connection): self._connection = connection
        def execute(self, sql, params=None):
            if "FROM scalar_observation o" in sql:
                scalar_sql_reads.append(sql)
            return self._connection.execute(sql, params)
        def __getattr__(self, name): return getattr(self._connection, name)
    class RecordingConnections:
        @contextmanager
        def connection(self):
            with pool.connection() as connection:
                yield RecordingConnection(connection)

    catalogue = main.default_resource_catalogue()
    template = catalogue.resources_by_id["densite"]
    fixture_resource = replace(template, resource_id="fixture_scalar", indicator_id="fixture_scalar",
        theme_id="demographie", label="Fixture scalar", unit="count")
    test_catalogue = replace(catalogue, resources=(*catalogue.resources, fixture_resource))
    previous = main.app.dependency_overrides.get(main.get_repository)
    previous_catalogue = main.app.dependency_overrides.get(main.get_resource_catalogue)
    main.app.dependency_overrides[main.get_repository] = lambda: main.ReadRepository(RecordingConnections())
    main.app.dependency_overrides[main.get_resource_catalogue] = lambda: test_catalogue

    target = {"kind": "territory", "type": "commune", "id": "29001"}
    facts = {"resource": "fixture_scalar", "target": target, "intent": {"kind": "facts"}}
    support_facts = {**facts, "fields": ["support_count"]}
    value_facts = {**facts, "fields": ["value"]}
    comparison = {"resource": "fixture_scalar", "target": target,
                  "intent": {"kind": "fixed_comparison", "context": "default"}}
    try:
        with TestClient(main.app) as client:
            full = client.post("/api/resources/read", json=facts)
            support_only = client.post("/api/resources/read", json=support_facts)
            value_only = client.post("/api/resources/read", json=value_facts)
            compared = client.post("/api/resources/read", json=comparison)
            one_batch = client.post("/api/resources/read-batch", json={"items": [
                {"id": "facts", **value_facts}, {"id": "comparison", **comparison}]})
            absent = client.post("/api/resources/read", json={**facts,
                "target": {**target, "id": "29003"}})
            mismatched = client.post("/api/resources/read", json={**facts,
                "target": {"kind": "territory", "type": "epci", "id": "29001"}})
        assert full.status_code == 200, full.text
        assert full.json()["value"] == 0 and full.json()["status"] == "measured"
        assert full.json()["content_version"] == "fixture-v1"
        assert [source["version"] for source in full.json()["sources"]] == ["2026", "2025"]
        assert support_only.status_code == 200, support_only.text
        assert value_only.status_code == 200, value_only.text
        assert full.json()["status"] == "measured"
        assert support_only.json()["support_count"] == 0 and "value" not in support_only.json()
        assert value_only.json()["value"] == 0 and "support_count" not in value_only.json()
        assert len(scalar_sql_reads) >= 4
        assert any("o.status" in sql and "o.value" not in sql.split("FROM scalar_observation o")[0]
                   for sql in scalar_sql_reads)
        assert any("o.support_count" in sql and "o.value" not in sql.split("FROM scalar_observation o")[0]
                   for sql in scalar_sql_reads)
        assert compared.status_code == 200, compared.text
        result = compared.json()["result"]
        assert result["median"] == 1 and result["rank"] == 2
        assert {(source["source_id"], source["vintage_id"])
                for source in result["comparison_sources"]} == {
                    ("fixture", "v2026"), ("fixture_secondary", "v2025")}
        assert one_batch.status_code == 200, one_batch.text
        batch = {entry["id"]: entry["data"] for entry in one_batch.json()["results"]}
        assert batch["facts"] == value_only.json()
        assert batch["comparison"] == compared.json()
        assert absent.status_code == 404
        assert mismatched.status_code == 422
        with psycopg.connect(canonical_db_env["publish_dsn"], autocommit=True) as publisher:
            publisher.execute("UPDATE table_publication SET content_version='territory-v2' WHERE table_name='territory_reference'")
        stale = client.post("/api/resources/read", json=facts)
        assert stale.status_code == 503
        with psycopg.connect(canonical_db_env["publish_dsn"], autocommit=True) as publisher:
            publisher.execute("UPDATE table_publication SET reference_content_version='territory-v2' WHERE table_name='scalar_observation'")
        rebound = client.post("/api/resources/read", json=facts)
        assert rebound.status_code == 200, rebound.text
        with psycopg.connect(canonical_db_env["publish_dsn"], autocommit=True) as publisher:
            publisher.execute("UPDATE table_publication SET reference_content_version='obsolete' WHERE table_name='scalar_observation'")
        stale = client.post("/api/resources/read", json=facts)
        assert stale.status_code == 503
    finally:
        if previous is None:
            main.app.dependency_overrides.pop(main.get_repository, None)
        else:
            main.app.dependency_overrides[main.get_repository] = previous
        if previous_catalogue is None:
            main.app.dependency_overrides.pop(main.get_resource_catalogue, None)
        else:
            main.app.dependency_overrides[main.get_resource_catalogue] = previous_catalogue
        pool.close()


def _restore_populated_pre_lineage_comparisons(connection, root):
    """Rebuild only comparison storage using the actual pre-033 DDL and facts.

    The initial real R publication supplies valid numerical rows. Recreating
    these tables from the pinned old schema avoids inventing a legacy shape by
    subtracting columns from today's schema. Fact/reference tables are unchanged.
    """
    baseline = subprocess.run(
        ["git", "show", "d5832fcac665299156dff05b6ddd55d9c1d2f60a:api/schema.sql"],
        cwd=root.parent, capture_output=True, text=True, timeout=15, check=True,
    ).stdout
    definitions = re.findall(
        r"CREATE TABLE ((?:scalar|profile|ordered_series|observed_collection)_comparison_"
        r"(?:publication|group|territory))\s*\(.*?\);", baseline, re.DOTALL)
    assert len(definitions) == 12, definitions
    snapshots = {}
    for table in definitions:
        cursor = connection.execute(f'SELECT * FROM "{table}"')
        names = [column.name for column in cursor.description]
        snapshots[table] = [dict(zip(names, row)) for row in cursor.fetchall()]
        assert snapshots[table], f"The legacy rehearsal must populate {table}"

    connection.execute("DROP TABLE comparison_source_lineage,ordered_series_comparison_lineage,"
        "ordered_series_comparison_zero_reason,observed_collection_comparison_lineage")
    for table in reversed(definitions):
        connection.execute(f'DROP TABLE "{table}"')
    connection.execute("DROP FUNCTION validate_observed_collection_comparison_lineage()")
    # The old publication validator must also be restored: today's validator
    # references the lineage columns deliberately absent from this old schema.
    validator = re.search(r"CREATE FUNCTION validate_observed_collection_comparison_publication\(\)"
        r".*?\$\$;", baseline, re.DOTALL)
    assert validator is not None
    connection.execute(validator.group().replace("CREATE FUNCTION", "CREATE OR REPLACE FUNCTION", 1))
    old_rows = {}
    for table in definitions:
        ddl = re.search(r"CREATE TABLE " + re.escape(table) + r"\s*\(.*?\);", baseline, re.DOTALL)
        assert ddl is not None
        connection.execute(ddl.group())
        cursor = connection.execute(f'SELECT * FROM "{table}" LIMIT 0')
        columns = [column.name for column in cursor.description]
        values = [tuple(row[column] for column in columns) for row in snapshots[table]]
        connection.cursor().executemany(
            f'INSERT INTO "{table}" (' + ','.join(f'"{column}"' for column in columns)
            + ') VALUES (' + ','.join(['%s'] * len(columns)) + ')', values)
        old_rows[table] = (columns, sorted(values, key=repr))
    # Reinstall the genuine old owned-write and deferred publication contracts
    # after copying the already validated R numerical publication.
    triggers = re.findall(r"CREATE (?:CONSTRAINT )?TRIGGER\s+.*?;", baseline, re.DOTALL)
    for trigger in triggers:
        if any(re.search(r"\bON\s+" + re.escape(table) + r"\b", trigger)
               for table in definitions):
            connection.execute(trigger)
    connection.execute("UPDATE observed_collection_comparison_publication SET published_at=published_at")
    return old_rows


def _remove_comparison_bases_for_upgrade(connection):
    """Model an existing schema that never received the comparison bases.

    The starting point is a fresh schema with real synthetically published
    facts. Only comparison storage and the 033/034 lineage additions are
    removed; every fact, descriptor, source, marker and unrelated relation
    stays. This is the #806 production shape, not a table-presence simulation.
    """
    connection.execute("DROP TABLE scalar_comparison_territory")
    connection.execute("DROP TABLE scalar_comparison_group")
    connection.execute("DROP TABLE scalar_comparison_publication")
    connection.execute("DROP TABLE ordered_series_comparison_zero_reason")
    connection.execute("DROP TABLE ordered_series_comparison_lineage")
    connection.execute("DROP TABLE ordered_series_comparison_territory")
    connection.execute("DROP TABLE ordered_series_comparison_group")
    connection.execute("DROP TABLE ordered_series_comparison_publication")
    connection.execute("DROP TABLE comparison_source_lineage")
    connection.execute("ALTER TABLE profile_comparison_group DROP COLUMN lineage_source_count")


@pytest.mark.parametrize("publication_schema", ["fresh", "populated_upgrade", "bases_absent_upgrade"])
def test_synthetic_r_comparison_lineage_publish_to_api_reader(canonical_r_publisher_db_env, tmp_path, publication_schema):
    """Exercise R publishers through the semantic single/batch API against PostgreSQL."""
    from dataclasses import replace
    import psycopg
    from fastapi.testclient import TestClient
    from psycopg_pool import ConnectionPool
    from api import main
    from api import snapshot_reads

    canonical_db_env = canonical_r_publisher_db_env
    publish_dsn = canonical_db_env["publish_dsn"]
    read_dsn = canonical_db_env["read_dsn"]
    print(f"retained synthetic lineage schema ({publication_schema}): {canonical_db_env['schema']}", flush=True)
    publish = urlsplit(os.environ["LUSK_TEST_PUBLISH_DSN"])
    manifest_path = tmp_path / "lineage-manifest.json"
    bundle_path = tmp_path / "lineage-inputs.rds"
    env = os.environ.copy()
    env.update({
        "LUSK_LINEAGE_TEST_HOST": publish.hostname or "",
        "LUSK_LINEAGE_TEST_PORT": str(publish.port or ""),
        "LUSK_LINEAGE_TEST_DATABASE": os.environ["LUSK_TEST_DATABASE_NAME"],
        "LUSK_LINEAGE_TEST_USER": publish.username or "",
        "LUSK_LINEAGE_TEST_SCHEMA": canonical_db_env["schema"],
        "LUSK_LINEAGE_TEST_MANIFEST": str(manifest_path),
        "LUSK_LINEAGE_TEST_BUNDLE": str(bundle_path),
        "R_LIBS_USER": os.environ["R_LIBS_USER"],
    })
    pipeline = Path(__file__).resolve().parents[3] / "pipeline"
    completed = subprocess.run(
        ["Rscript", "--vanilla", "scripts/smoke-comparison-lineage-fixture.R"],
        cwd=pipeline, env=env, capture_output=True, text=True, timeout=120,
    )
    assert completed.returncode == 0, completed.stdout + "\n" + completed.stderr
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert manifest["schema"] == canonical_db_env["schema"]

    catalogue = main.default_resource_catalogue()
    resources = list(catalogue.resources)

    def fixture_resource(resource_id, shape):
        template = next(resource for resource in catalogue.resources if shape in resource.shapes)
        resources.append(replace(template, resource_id=resource_id, indicator_id=resource_id))

    # These fixture-only identities mirror real producer shapes while keeping
    # discovery's production catalogue unchanged. The guarded test opts into
    # them explicitly so the actual typed readers can verify R's publications.
    fixture_resource("lineage_sparse", "scalar")
    fixture_resource(manifest["ordered_series"]["indicator_id"], "ordered_series")
    fixture_resource(manifest["numeric_collection"]["indicator_id"], "period_detail")
    test_catalogue = replace(catalogue, resources=tuple(resources))

    pool = ConnectionPool(conninfo=read_dsn, min_size=0, max_size=2, open=True,
        kwargs={"autocommit": True})
    query_trace = []
    class TraceConnection:
        def __init__(self, connection): self.connection = connection
        def __getattr__(self, name): return getattr(self.connection,name)
        def execute(self, sql, *args, **kwargs):
            query_trace.append(sql)
            return self.connection.execute(sql,*args,**kwargs)
        @contextmanager
        def transaction(self):
            with self.connection.transaction(): yield self
    class TracePool:
        def connection(self):
            @contextmanager
            def acquire():
                with pool.connection() as connection: yield TraceConnection(connection)
            return acquire()
    trace_pool = TracePool()
    previous = main.app.dependency_overrides.get(main.get_repository)
    previous_catalogue = main.app.dependency_overrides.get(main.get_resource_catalogue)
    main.app.dependency_overrides[main.get_repository] = lambda: main.ReadRepository(trace_pool)
    main.app.dependency_overrides[main.get_resource_catalogue] = lambda: test_catalogue

    def semantic_item(resource, territory_type, territory_id, *, fields=None,
                      intent=None, members=None):
        target = {"kind": "territory", "type": territory_type, "id": territory_id}
        if intent == "facts":
            intent_value = {"kind": "facts"}
        elif members is not None:
            intent_value = {"kind": "selected_comparison", "members": [
                {"type": level, "id": code} for level, code in members]}
        else:
            intent_value = {"kind": "fixed_comparison", "context": "default"}
        item = {"resource": resource, "target": target, "intent": intent_value}
        if fields is not None:
            item["fields"] = fields
        return item

    def post_semantic(client, item):
        return client.post("/api/resources/read", json=item)

    def post_semantic_batch(client, items):
        return client.post("/api/resources/read-batch", json={"items": items})
    try:
        series_fixture = manifest["ordered_series"]
        collection_fixture = manifest["numeric_collection"]
        comparison_items = [
            semantic_item("densite", "commune", "22001"),
            semantic_item("structure_age", "commune", "22001"),
            semantic_item("lineage_sparse", "commune", "22001"),
            semantic_item(series_fixture["indicator_id"], series_fixture["level"],
                          series_fixture["territory_id"]),
            semantic_item(collection_fixture["indicator_id"], "commune",
                          collection_fixture["territory_id"]),
            semantic_item(collection_fixture["indicator_id"], "commune",
                          collection_fixture["empty_territory_id"]),
        ]

        def read_comparisons():
            with TestClient(main.app) as client:
                singles = [post_semantic(client, item) for item in comparison_items]
                batch = post_semantic_batch(client, [
                    {"id": f"comparison-{index}", **item}
                    for index, item in enumerate(comparison_items)])
                return singles, batch

        expected_responses, expected_batch = read_comparisons()
        assert all(response.status_code == 200 for response in expected_responses), [
            response.text for response in expected_responses]
        assert expected_batch.status_code == 200, expected_batch.text
        assert [row["data"] for row in expected_batch.json()["results"]] == [
            response.json() for response in expected_responses]
        if publication_schema in {"populated_upgrade", "bases_absent_upgrade"}:
            root = Path(__file__).resolve().parents[2]
            with psycopg.connect(publish_dsn) as publisher:
                if publication_schema == "populated_upgrade":
                    old_rows = _restore_populated_pre_lineage_comparisons(publisher, root)
                    untouched = None
                else:
                    untouched = {
                        table: sorted(publisher.execute(f'SELECT * FROM "{table}"').fetchall(), key=repr)
                        for table in ("territory_reference", "table_publication",
                                      "scalar_observation", "scalar_observation_source",
                                      "series_dataset_observation", "series_observation_provenance",
                                      "observed_collection_comparison_publication")
                    }
                    _remove_comparison_bases_for_upgrade(publisher)
                    old_rows = {}
                reader = urlsplit(read_dsn).username
                assert reader and re.fullmatch(r"[A-Za-z0-9_$-]+", reader)
                publisher.execute(f'GRANT SELECT ON ALL TABLES IN SCHEMA "{canonical_db_env["schema"]}" TO "{reader}"')
            # Unapplied storage must be intentionally unavailable, not a 500.
            # The absent-bases case removes only the scalar and ordered-series
            # families; the numeric-collection publication is untouched and must
            # keep serving its own 200 responses.
            expected_unavailable_statuses = (
                [503, 503, 503, 503, 200, 200]
                if publication_schema == "bases_absent_upgrade"
                else [503] * len(comparison_items)
            )
            unavailable_singles, unavailable_batch = read_comparisons()
            assert [response.status_code for response in unavailable_singles] == expected_unavailable_statuses
            assert unavailable_batch.status_code == 503
            if publication_schema == "populated_upgrade":
                # A relation created by an incomplete/manual upgrade is also an
                # unavailable publication, not an UndefinedColumn -> HTTP 500.
                with psycopg.connect(publish_dsn, autocommit=True) as publisher:
                    publisher.execute("""CREATE TABLE comparison_source_lineage(
                        comparison_context text,group_id text,territory_type text,facet_id text,
                        source_id text,vintage_id text,comparison_content_version text)""")
                    publisher.execute(f'GRANT SELECT ON comparison_source_lineage TO "{reader}"')
                unavailable_singles, unavailable_batch = read_comparisons()
                assert [response.status_code for response in unavailable_singles] == [503] * len(comparison_items)
                assert unavailable_batch.status_code == 503
                with psycopg.connect(publish_dsn, autocommit=True) as publisher:
                    publisher.execute("DROP TABLE comparison_source_lineage")
            with psycopg.connect(publish_dsn, autocommit=True) as publisher:
                migrations = (("039_comparison_base_objects.sql",
                               "033_comparison_source_lineage.sql",
                               "034_ordered_series_comparison_lineage.sql")
                              if publication_schema == "bases_absent_upgrade" else
                              ("033_comparison_source_lineage.sql",
                               "034_ordered_series_comparison_lineage.sql",
                               "035_numeric_collection_comparison_lineage.sql"))
                for migration in migrations:
                    publisher.execute((root / "migrations" / migration).read_text(encoding="utf-8"))
                if untouched is not None:
                    # Migration 039 and the lineage steps are DDL-only: all
                    # existing facts, descriptors, sources and markers survive.
                    for table, expected in untouched.items():
                        actual = sorted(publisher.execute(f'SELECT * FROM "{table}"').fetchall(), key=repr)
                        assert actual == expected, table
                # Migration must not rewrite or delete any previous result or marker.
                for table, (columns, expected) in old_rows.items():
                    projection = ','.join(f'"{column}"' for column in columns)
                    actual = publisher.execute(f'SELECT {projection} FROM "{table}"').fetchall()
                    assert sorted(actual, key=repr) == expected, table
                for table in ("scalar_comparison_group", "profile_comparison_group",
                              "ordered_series_comparison_group"):
                    assert publisher.execute(
                        f'SELECT count(*)=0 OR bool_and(lineage_source_count IS NULL) FROM "{table}"'
                    ).fetchone()[0], table
                if publication_schema == "populated_upgrade":
                    assert publisher.execute("SELECT bool_and(NOT lineage_complete) FROM observed_collection_comparison_publication").fetchone()[0]
                # Newly created lineage tables need the dedicated test reader grant;
                # migration grants target the production role names, not this test role.
                publisher.execute(f'GRANT SELECT ON ALL TABLES IN SCHEMA "{canonical_db_env["schema"]}" TO "{reader}"')
            unavailable_singles, unavailable_batch = read_comparisons()
            assert [response.status_code for response in unavailable_singles] == expected_unavailable_statuses
            assert unavailable_batch.status_code == 503
            republish_env = dict(env, LUSK_LINEAGE_TEST_REPUBLISH=str(bundle_path))
            # Two separate invocations prove the supported unchanged retry/no-op
            # path, not just the initial repair after an additive upgrade.
            repaired_markers = None
            for _ in range(2):
                repaired = subprocess.run(
                    ["Rscript", "--vanilla", "scripts/smoke-comparison-lineage-fixture.R"],
                    cwd=pipeline, env=republish_env, capture_output=True, text=True, timeout=120)
                assert repaired.returncode == 0, repaired.stdout + "\n" + repaired.stderr
                actual_responses, actual_batch = read_comparisons()
                assert all(response.status_code == 200 for response in actual_responses), [
                    response.text for response in actual_responses]
                assert [response.json() for response in actual_responses] == [
                    response.json() for response in expected_responses]
                assert actual_batch.status_code == 200, actual_batch.text
                assert [row["data"] for row in actual_batch.json()["results"]] == [
                    response.json() for response in expected_responses]
                with psycopg.connect(publish_dsn) as publisher:
                    marker_tables = (old_rows if old_rows else {
                        "scalar_comparison_publication": None,
                        "profile_comparison_publication": None,
                        "ordered_series_comparison_publication": None,
                        "observed_collection_comparison_publication": None,
                    })
                    markers = {table: sorted(publisher.execute(f'SELECT * FROM "{table}"').fetchall(), key=repr)
                        for table in marker_tables if table.endswith("_publication")}
                if repaired_markers is not None:
                    assert markers == repaired_markers, "Unchanged retry must not republish markers"
                repaired_markers = markers
        scalar = expected_responses[0].json()["result"]
        profile = expected_responses[1].json()["result"]
        sparse = expected_responses[2].json()["result"]
        assert expected_responses[0].json()["content_version"]
        assert expected_responses[1].json()["profile_content_version"]
        assert scalar["indicator_id"] == "densite"
        assert profile["indicator_id"] == "structure_age"
        assert sparse["indicator_id"] == "lineage_sparse"
        assert sparse["status"] == "unavailable"
        assert sparse["comparison_sources"] == []

        expected_scalar_pairs = {
            (row["source_id"], row["vintage_id"])
            for row in manifest["scalar"]["source_pairs"]
            if row["facet_id"] == "densite"
        }
        actual_scalar_pairs = {(row["source_id"], row["vintage_id"])
            for row in scalar["comparison_sources"]}
        expected_profile_pairs = {
            (row["source_id"], row["vintage_id"])
            for row in manifest["profile"]["source_pairs"]
            if row["facet_id"] == "structure_age"
        }
        actual_profile_pairs = {(row["source_id"], row["vintage_id"])
            for row in profile["comparison_sources"]}
        assert expected_scalar_pairs and actual_scalar_pairs == expected_scalar_pairs
        assert expected_profile_pairs and actual_profile_pairs == expected_profile_pairs

        # Compose focal facts and comparison through the semantic single and
        # batch contract, retaining the same resource and optional field set.
        facts_item = semantic_item("densite", "commune", "22001",
                                   fields=["value"], intent="facts")
        comparison_item = semantic_item("densite", "commune", "22001", fields=["median"])
        with TestClient(main.app) as client:
            single_facts = post_semantic(client, facts_item)
            single_comparison = post_semantic(client, comparison_item)
            combined = post_semantic_batch(client, [
                {"id": "facts", **facts_item},
                {"id": "comparison", **comparison_item},
            ])
        assert single_facts.status_code == single_comparison.status_code == 200
        assert combined.status_code == 200, combined.text
        batch_data = {item["id"]: item["data"] for item in combined.json()["results"]}
        assert batch_data == {"facts": single_facts.json(), "comparison": single_comparison.json()}

        # An unknown later named comparison must be rejected during metadata
        # preflight, before a preceding valid fact item reads observations.
        fact_item = {"id": "facts", **facts_item}
        unknown_item = {"id": "unknown", **semantic_item(
            "not_registered_fixture_indicator", "commune", "22001")}
        with TestClient(main.app) as client:
            retired_route = client.post(
                "/api/territories/commune/22001/indicators/not_registered_fixture_indicator/comparison")
            single_unknown = post_semantic(client, {key: value for key, value in unknown_item.items()
                                                      if key != "id"})
            unknown_batches = []
            for items in ([fact_item, unknown_item], [unknown_item, fact_item]):
                query_trace.clear()
                failed = post_semantic_batch(client, items)
                unknown_batches.append((failed.status_code, failed.json(), list(query_trace)))
        assert retired_route.status_code == 404
        assert single_unknown.status_code == 422
        assert all(status == 422 and "results" not in body and "data" not in body
                   for status, body, _ in unknown_batches)
        forbidden_read_tokens = ("scalar_observation", "profile_observation", "series_observation",
            "comparison_group", "comparison_territory", "comparison_result")
        assert all(not any(any(token in sql.lower() for token in forbidden_read_tokens)
                           for sql in trace)
                   for _, _, trace in unknown_batches), unknown_batches

        # A stale fixed-scalar-comparison clock is a preflight dependency, not
        # just the scalar-fact publication clock. Prove it rejects either item
        # position without reading facts or materialized comparison results.
        with psycopg.connect(publish_dsn, autocommit=True) as publisher:
            scalar_marker = publisher.execute("""SELECT content_version,scalar_content_version,
                reference_content_version FROM scalar_comparison_publication WHERE singleton""").fetchone()
            publisher.execute("UPDATE scalar_comparison_publication SET scalar_content_version='stale-scalar-fixture'")
        stale_comparison_batches = []
        stale_comparison_item = {"id": "comparison", **semantic_item("densite", "commune", "22001")}
        try:
            with TestClient(main.app) as client:
                for items in ([fact_item, stale_comparison_item],
                              [stale_comparison_item, fact_item]):
                    query_trace.clear()
                    failed = post_semantic_batch(client, items)
                    stale_comparison_batches.append((failed.status_code, failed.json(), list(query_trace)))
        finally:
            with psycopg.connect(publish_dsn, autocommit=True) as publisher:
                publisher.execute("""UPDATE scalar_comparison_publication SET content_version=%s,
                    scalar_content_version=%s,reference_content_version=%s WHERE singleton""", scalar_marker)
        assert all(status == 503 and "results" not in body and "data" not in body
                   for status, body, _ in stale_comparison_batches)
        forbidden_comparison_reads = ("FROM scalar_observation ", "FROM scalar_observation_source",
            "FROM profile_observation ", "FROM scalar_comparison_group",
            "FROM scalar_comparison_territory", "FROM profile_comparison_group",
            "FROM profile_comparison_territory")
        assert all(not any(any(token in sql for token in forbidden_comparison_reads)
                           for sql in trace)
                   for _, _, trace in stale_comparison_batches), stale_comparison_batches

        profile_full_item = semantic_item("structure_age", "commune", "22001", intent="facts")
        profile_status_item = profile_full_item
        profile_value_item = semantic_item("structure_age", "commune", "22001",
                                           fields=["value"], intent="facts")
        profile_invalid_item = semantic_item("structure_age", "commune", "22001",
                                             fields=["mean"], intent="facts")
        with TestClient(main.app) as client:
            alias_full=post_semantic(client, profile_full_item)
            alias_status=post_semantic(client, profile_status_item)
            alias_value=post_semantic(client, profile_value_item)
            alias_invalid=post_semantic(client, profile_invalid_item)
            profile_status=post_semantic(client, profile_status_item)
            profile_value=post_semantic(client, profile_value_item)
        assert alias_full.status_code==alias_status.status_code==alias_value.status_code==200
        assert alias_invalid.status_code==422
        assert profile_status.status_code==profile_value.status_code==200
        full_profile=alias_full.json()
        selected_status,selected_value=alias_status.json(),alias_value.json()
        assert selected_value["observations"]==full_profile["observations"]
        assert all("value" in cell and cell["status"] in ("measured","suppressed","unsupported","not_available")
            and cell["sources"] for cell in full_profile["observations"])
        assert full_profile["descriptor"]["axes"] and full_profile["descriptor"]["descriptor_version"] and full_profile["content_version"]
        assert all("status" in cell for cell in selected_status["observations"])
        def profile_axis_status_values(cells, *, include_value):
            keys=("detail","sex","status","value") if include_value else ("detail","sex","status")
            return [{key:cell.get(key) for key in keys} for cell in cells]
        assert profile_axis_status_values(full_profile["observations"],include_value=True)==profile_axis_status_values(
            profile_value.json()["observations"],include_value=True)
        assert profile_axis_status_values(selected_status["observations"],include_value=True)==profile_axis_status_values(
            profile_status.json()["observations"],include_value=True)
        assert all(cell["status"]==full_profile["observations"][index]["status"]
            and cell["sources"]==full_profile["observations"][index]["sources"]
            and cell["detail"]==full_profile["observations"][index]["detail"]
            and cell.get("sex")==full_profile["observations"][index].get("sex")
            for index,cell in enumerate(selected_status["observations"]))
        assert {key:selected_status["descriptor"][key] for key in
            ("indicator","label","unit","axes","descriptor_version")} == {
                key:full_profile["descriptor"][key] for key in
                ("indicator","label","unit","axes","descriptor_version")}

        profile_only = post_semantic(client, semantic_item(
            "structure_age", "commune", "22001", fields=["median"]))
        profile_invalid_field=post_semantic(client, semantic_item(
            "structure_age", "commune", "22001", fields=["mean"]))
        assert profile_only.status_code == 200, profile_only.text
        assert profile_invalid_field.status_code == 422
        profile_result = profile_only.json()["result"]
        assert profile_result["median"] == profile["median"]
        assert profile_result["status"] == profile["status"]
        assert profile_result["comparison_sources"] == profile["comparison_sources"]
        assert not {"focal_value","rank","rank_size","rank_ties","eligible_count"} & set(profile_result)

        series = manifest["ordered_series"]
        captured_publication_reads=[]
        original_publication_read=snapshot_reads._execute_comparison_publication_read
        def capture_publication_read(connection,sql,params=None):
            if "ordered_series_comparison_group" in sql or "ordered_series_comparison_territory" in sql:
                captured_publication_reads.append((sql,params))
            return original_publication_read(connection,sql,params)
        snapshot_reads._execute_comparison_publication_read=capture_publication_read
        series_item = semantic_item(series["indicator_id"], series["level"],
                                    series["territory_id"])
        owned_item_data = semantic_item(series["indicator_id"], series["level"],
                                        series["territory_id"], intent="facts")
        with TestClient(main.app) as client:
            series_response = post_semantic(client, series_item)
            owned_single = post_semantic(client, owned_item_data)
            owned_batch = post_semantic_batch(client, [{"id": "owned-series", **owned_item_data}])
        assert series_response.status_code == 200, series_response.text
        assert owned_single.status_code == owned_batch.status_code == 200, (
            owned_single.text, owned_batch.text)
        owned = owned_single.json()
        assert owned_batch.json()["results"][0]["data"] == owned
        assert owned.get("observations") or owned.get("points"), "owned-series read must expose published focal rows"
        owned_pairs = {(source["source_id"], source["vintage_id"])
            for row in owned.get("observations", owned.get("points", []))
            for source in row.get("sources", row.get("provenance", []))}
        # Focal facts retain the focal territory's two axis vintages; the
        # comparison-lineage assertion below separately checks cohort-wide
        # vintages across all eligible territories.
        assert owned_pairs == {("fixture_a", "v1"), ("fixture_b", "v1")}
        # Stale owned dataset markers reject either item position in metadata
        # preflight; query_trace records the actual connection statements.
        owned_item = {"id":"owned", **series_item}
        profile_item = {"id":"profile", **semantic_item(
            "structure_age", "commune", "22001", intent="facts")}
        with psycopg.connect(publish_dsn,autocommit=True) as publisher:
            owned_reference_version=publisher.execute("SELECT reference_content_version FROM series_dataset_publication WHERE dataset_id=%s",
                (series["dataset_id"],)).fetchone()[0]
            publisher.execute("ALTER TABLE series_dataset_publication DISABLE TRIGGER series_dataset_publication_complete")
            publisher.execute("UPDATE series_dataset_publication SET reference_content_version='stale-owned-ref' WHERE dataset_id=%s",
                              (series["dataset_id"],))
            publisher.execute("ALTER TABLE series_dataset_publication ENABLE TRIGGER series_dataset_publication_complete")
        owned_preflight_failures=[]
        for items in ([owned_item,profile_item],[profile_item,owned_item]):
            query_trace.clear()
            failed=post_semantic_batch(client,items)
            owned_preflight_failures.append((failed.status_code,failed.json(),list(query_trace)))
        with psycopg.connect(publish_dsn,autocommit=True) as publisher:
            publisher.execute("ALTER TABLE series_dataset_publication DISABLE TRIGGER series_dataset_publication_complete")
            publisher.execute("UPDATE series_dataset_publication SET reference_content_version=%s WHERE dataset_id=%s",
                              (owned_reference_version,series["dataset_id"]))
            publisher.execute("ALTER TABLE series_dataset_publication ENABLE TRIGGER series_dataset_publication_complete")
        assert all(status==503 and "results" not in body and "data" not in body
                   for status,body,_ in owned_preflight_failures)
        assert all(not any("series_dataset_observation" in sql or "profile_observation" in sql
                           for sql in trace) for _,_,trace in owned_preflight_failures)
        series_result = series_response.json()["result"]
        expected_series_pairs = {(row["source_id"],row["vintage_id"]) for row in series["source_pairs"]
            if row["axis_value"] == "2025"}
        actual_series_pairs = {(row["source_id"],row["vintage_id"])
            for row in series_result["comparison_sources"]}
        assert expected_series_pairs and actual_series_pairs == expected_series_pairs
        assert {source for source,_ in actual_series_pairs} == {"fixture_b"}
        assert {vintage for _,vintage in actual_series_pairs} == {"v1", "v2"}
        with TestClient(main.app) as client:
            series_rank_only = post_semantic(client, semantic_item(
                series["indicator_id"], series["level"], series["territory_id"], fields=["rank"]))
            series_invalid_field=post_semantic(client, semantic_item(
                series["indicator_id"], series["level"], series["territory_id"], fields=["mean"]))
        snapshot_reads._execute_comparison_publication_read=original_publication_read
        assert series_rank_only.status_code == 200, series_rank_only.text
        assert series_invalid_field.status_code == 422
        group_projection=[(sql,params) for sql,params in captured_publication_reads
            if "FROM ordered_series_comparison_group" in sql][-1]
        focal_projection=[(sql,params) for sql,params in captured_publication_reads
            if "ordered_series_comparison_territory" in sql][-1]
        assert "CASE WHEN %s THEN group_value" in group_projection[0]
        assert group_projection[1][0] is False
        assert "CASE WHEN %s THEN t.value" in focal_projection[0]
        assert focal_projection[1][:4]==(False,True,False,False)
        rank_result=series_rank_only.json()["result"]
        assert rank_result["rank"] == series_result["rank"]
        assert rank_result["status"] == series_result["status"]
        assert rank_result["comparison_sources"] == series_result["comparison_sources"]
        assert not {"focal_value","median","rank_size","rank_ties","eligible_count"} & set(rank_result)

        collection = manifest["numeric_collection"]
        collection_item = semantic_item(collection["indicator_id"], "commune",
                                        collection["territory_id"])
        collection_response = expected_responses[4]
        assert collection_response.status_code == 200, collection_response.text
        collection_result = collection_response.json()["result"]
        expected_collection_pairs = {(row["source_id"],row["vintage_id"]) for row in collection["source_pairs"]}
        actual_collection_pairs = {(row["source_id"],row["vintage_id"])
            for row in collection_result["comparison_sources"]}
        assert expected_collection_pairs == actual_collection_pairs
        assert len({vintage for _,vintage in actual_collection_pairs}) == 2
        assert collection_result["source_facet"] == {"detail":"total","observation_period":"2025"}
        with psycopg.connect(publish_dsn,autocommit=True) as publisher:
            collection_reference_version=publisher.execute("SELECT reference_content_version FROM observed_collection_publication WHERE indicator_id=%s",
                (collection["indicator_id"],)).fetchone()[0]
            publisher.execute("ALTER TABLE observed_collection_publication DISABLE TRIGGER observed_collection_publication_contract")
            publisher.execute("UPDATE observed_collection_publication SET reference_content_version='stale-collection-ref' WHERE indicator_id=%s",
                              (collection["indicator_id"],))
            publisher.execute("ALTER TABLE observed_collection_publication ENABLE TRIGGER observed_collection_publication_contract")
        collection_batch_item={"id":"collection", **collection_item}
        collection_preflight_failures=[]
        for items in ([collection_batch_item,profile_item],[profile_item,collection_batch_item]):
            query_trace.clear()
            failed=post_semantic_batch(client,items)
            collection_preflight_failures.append((failed.status_code,failed.json(),list(query_trace)))
        with psycopg.connect(publish_dsn,autocommit=True) as publisher:
            publisher.execute("ALTER TABLE observed_collection_publication DISABLE TRIGGER observed_collection_publication_contract")
            publisher.execute("UPDATE observed_collection_publication SET reference_content_version=%s WHERE indicator_id=%s",
                              (collection_reference_version,collection["indicator_id"]))
            publisher.execute("ALTER TABLE observed_collection_publication ENABLE TRIGGER observed_collection_publication_contract")
        assert all(status==503 and "results" not in body and "data" not in body
                   for status,body,_ in collection_preflight_failures)
        assert all(not any("period_detail_observation" in sql or "profile_observation" in sql
                           for sql in trace) for _,_,trace in collection_preflight_failures)
        with TestClient(main.app) as client:
            collection_median = post_semantic(client, semantic_item(
                collection["indicator_id"], "commune", collection["territory_id"], fields=["median"]))
            collection_invalid_field=post_semantic(client, semantic_item(
                collection["indicator_id"], "commune", collection["territory_id"], fields=["mean"]))
        assert collection_median.status_code == 200, collection_median.text
        assert collection_invalid_field.status_code == 422
        selected_collection=collection_median.json()["result"]
        assert selected_collection["median"] == collection_result["median"]
        assert selected_collection["status"] == collection_result["status"]
        assert selected_collection["comparison_sources"] == collection_result["comparison_sources"]
        assert not {"rank","rank_size","eligible_count","missing_count"} & set(selected_collection)
        with TestClient(main.app) as client:
            empty_collection_response = post_semantic(client, semantic_item(
                collection["indicator_id"], "commune", collection["empty_territory_id"]))
        assert empty_collection_response.status_code == 200, empty_collection_response.text
        empty_collection = empty_collection_response.json()["result"]
        assert empty_collection["status"] == "unavailable"
        assert empty_collection["comparison_sources"] == []
        with psycopg.connect(publish_dsn, autocommit=True) as publisher:
            publisher.execute("ALTER TABLE observed_collection_comparison_lineage DISABLE TRIGGER observed_collection_comparison_lineage_owned_write")
            removed_collection_lineage = publisher.execute("""DELETE FROM observed_collection_comparison_lineage
                WHERE indicator_id=%s AND comparison_context='density_class' AND group_id='D_TEST'
                  AND territory_type='commune' RETURNING source_id,vintage_id,comparison_content_version""",
                (collection["indicator_id"],)).fetchall()
            assert removed_collection_lineage
        with TestClient(main.app) as client:
            truncated_collection = post_semantic(client, collection_item)
        assert truncated_collection.status_code == 503
        with psycopg.connect(publish_dsn, autocommit=True) as publisher:
            publisher.cursor().executemany("""INSERT INTO observed_collection_comparison_lineage
                (indicator_id,comparison_context,group_id,territory_type,detail_key,observation_period,
                 source_id,vintage_id,comparison_content_version)
                VALUES (%s,'density_class','D_TEST','commune','total','2025',%s,%s,%s)""",
                [(collection["indicator_id"],*row) for row in removed_collection_lineage])
            publisher.execute("ALTER TABLE observed_collection_comparison_lineage ENABLE TRIGGER observed_collection_comparison_lineage_owned_write")
        with TestClient(main.app) as client:
            restored_collection = post_semantic(client, collection_item)
        assert restored_collection.status_code == 200, restored_collection.text
        with psycopg.connect(publish_dsn, autocommit=True) as publisher:
            publisher.execute("ALTER TABLE observed_collection_comparison_lineage DISABLE TRIGGER observed_collection_comparison_lineage_owned_write")
            publisher.execute("UPDATE observed_collection_comparison_lineage SET comparison_content_version='stale-fixture' WHERE indicator_id=%s",
                (collection["indicator_id"],))
            publisher.execute("ALTER TABLE observed_collection_comparison_lineage ENABLE TRIGGER observed_collection_comparison_lineage_owned_write")
        with TestClient(main.app) as client:
            stale_collection = post_semantic(client, collection_item)
        assert stale_collection.status_code == 503
        with psycopg.connect(publish_dsn, autocommit=True) as publisher:
            publisher.execute("ALTER TABLE observed_collection_comparison_lineage DISABLE TRIGGER observed_collection_comparison_lineage_owned_write")
            publisher.execute("UPDATE observed_collection_comparison_lineage SET comparison_content_version=%s WHERE indicator_id=%s",
                (collection["comparison_content_version"],collection["indicator_id"]))
            publisher.execute("ALTER TABLE observed_collection_comparison_lineage ENABLE TRIGGER observed_collection_comparison_lineage_owned_write")
        resolved_scope=series_response.json()["scope"]
        lineage_context=resolved_scope["kind"]
        if lineage_context=="density_class":
            lineage_group=resolved_scope["density_class_code"]
        elif lineage_context=="same_level":
            with psycopg.connect(publish_dsn) as publisher:
                lineage_group=publisher.execute("SELECT territory_id FROM territory_reference WHERE territory_type='region'").fetchone()[0]
        else:
            raise AssertionError(f"Unexpected fixed ordered-series context: {resolved_scope}")

        with psycopg.connect(publish_dsn, autocommit=True) as publisher:
            removed = publisher.execute("""DELETE FROM ordered_series_comparison_lineage
                WHERE dataset_id=%s AND comparison_context=%s AND group_id=%s
                  AND territory_type=%s AND axis_value='2025'
                RETURNING provenance_revision_id""", (series["dataset_id"],lineage_context,
                    lineage_group,series["level"])).fetchall()
            assert removed
        with TestClient(main.app) as client:
            incomplete_series = post_semantic(client, series_item)
        assert incomplete_series.status_code == 503
        with psycopg.connect(publish_dsn, autocommit=True) as publisher:
            publisher.cursor().executemany("""INSERT INTO ordered_series_comparison_lineage
                (dataset_id,indicator_id,comparison_context,group_id,territory_type,axis_value,provenance_revision_id)
                VALUES (%s,%s,%s,%s,%s,'2025',%s)""",
                [(series["dataset_id"],series["indicator_id"],lineage_context,
                    lineage_group,series["level"],row[0]) for row in removed])

        # Both physical families fail closed on truncated/stale lineage and read
        # normally again after restoring the exact row.
        def assert_lineage_guard(family, facet):
            with psycopg.connect(publish_dsn, autocommit=True) as connection:
                row = connection.execute("""DELETE FROM comparison_source_lineage
                    WHERE comparison_family=%s AND comparison_context='density_class'
                      AND group_id='D_TEST' AND facet_id=%s
                    RETURNING comparison_context,group_id,territory_type,facet_id,source_id,vintage_id,
                      comparison_content_version""", (family, facet)).fetchone()
                assert row is not None
            with TestClient(main.app) as client:
                truncated = post_semantic(client, semantic_item(facet, "commune", "22001"))
            assert truncated.status_code == 503
            with psycopg.connect(publish_dsn, autocommit=True) as connection:
                connection.execute("""INSERT INTO comparison_source_lineage
                    (comparison_family,comparison_context,group_id,territory_type,facet_id,source_id,vintage_id,comparison_content_version)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s)""", (family, *row))
                connection.execute("""UPDATE comparison_source_lineage
                    SET comparison_content_version='stale-test-version'
                    WHERE comparison_family=%s AND comparison_context=%s AND group_id=%s
                      AND territory_type=%s AND facet_id=%s AND source_id=%s AND vintage_id=%s""",
                    (family, *row[:6]))
            with TestClient(main.app) as client:
                stale = post_semantic(client, semantic_item(facet, "commune", "22001"))
            assert stale.status_code == 503
            with psycopg.connect(publish_dsn, autocommit=True) as connection:
                connection.execute("""UPDATE comparison_source_lineage SET comparison_content_version=%s
                    WHERE comparison_family=%s AND comparison_context=%s AND group_id=%s
                      AND territory_type=%s AND facet_id=%s AND source_id=%s AND vintage_id=%s""",
                    (row[6], family, *row[:6]))
                stale_rows = connection.execute("""SELECT comparison_family,group_id,facet_id,
                    source_id,vintage_id,comparison_content_version FROM comparison_source_lineage
                    WHERE comparison_content_version='stale-test-version'""").fetchall()
                assert not stale_rows, stale_rows
            with TestClient(main.app) as client:
                restored = post_semantic(client, semantic_item(facet, "commune", "22001"))
            assert restored.status_code == 200, restored.text

        assert_lineage_guard("scalar", "densite")
        assert_lineage_guard("profile", "structure_age")
    finally:
        if previous is None:
            main.app.dependency_overrides.pop(main.get_repository, None)
        else:
            main.app.dependency_overrides[main.get_repository] = previous
        pool.close()


_SCALAR_COMPARISON_BASES = (
    "scalar_comparison_territory", "scalar_comparison_group",
    "scalar_comparison_publication",
)
_ORDERED_SERIES_COMPARISON_BASES = (
    "ordered_series_comparison_territory", "ordered_series_comparison_group",
    "ordered_series_comparison_publication",
)


def _drop_pre_lineage_comparison_bases(connection):
    """Remove the six base relations from a pinned pre-lineage schema."""
    for table in _SCALAR_COMPARISON_BASES + _ORDERED_SERIES_COMPARISON_BASES:
        connection.execute(f"DROP TABLE {table}")


def _table_snapshot(connection, tables):
    return {
        table: sorted(connection.execute(f'SELECT * FROM "{table}"').fetchall(), key=repr)
        for table in tables
    }


def test_collection_vintage_conflict_rolls_back_label_and_full_schema_snapshot(
    retained_lineage_schema_env, tmp_path
):
    """Run only the vintage-conflict rollback against a retained synthetic schema."""
    import psycopg

    env_config = retained_lineage_schema_env
    with psycopg.connect(env_config["read_dsn"], autocommit=True) as connection:
        tables = tuple(row[0] for row in connection.execute("""
            SELECT table_name FROM information_schema.tables
            WHERE table_schema=current_schema() AND table_type='BASE TABLE'
            ORDER BY table_name
        """).fetchall())
        if not tables:
            pytest.fail("Retained synthetic schema has no base tables to snapshot")
        before = _table_snapshot(connection, tables)
    print(f"collection vintage-conflict rollback: retained schema {env_config['schema']}; snapshotting {len(tables)} tables", flush=True)

    publish = urlsplit(os.environ["LUSK_TEST_PUBLISH_DSN"])
    env = os.environ.copy()
    env.update({
        "LUSK_LINEAGE_TEST_HOST": publish.hostname or "",
        "LUSK_LINEAGE_TEST_PORT": str(publish.port or ""),
        "LUSK_LINEAGE_TEST_DATABASE": os.environ["LUSK_TEST_DATABASE_NAME"],
        "LUSK_LINEAGE_TEST_USER": publish.username or "",
        "LUSK_LINEAGE_TEST_SCHEMA": env_config["schema"],
        "LUSK_LINEAGE_TEST_MANIFEST": str(tmp_path / "lineage-conflict-manifest.json"),
        "LUSK_LINEAGE_TEST_COLLECTION_CONFLICT_ONLY": "1",
        "R_LIBS_USER": env_config["r_libs_user"],
    })
    pipeline = Path(__file__).resolve().parents[3] / "pipeline"
    completed = subprocess.run(
        ["Rscript", "--vanilla", "scripts/smoke-comparison-lineage-fixture.R"],
        cwd=pipeline, env=env, capture_output=True, text=True, timeout=120,
    )
    print(completed.stdout, flush=True)
    if completed.stderr:
        print(completed.stderr, flush=True)
    with psycopg.connect(env_config["read_dsn"], autocommit=True) as connection:
        after = _table_snapshot(connection, tables)
    assert after == before, "The failed collection publish must leave every retained schema row unchanged"
    assert completed.returncode == 0, completed.stdout + "\n" + completed.stderr
    assert "expected vintage conflict rolled back changed source label and collection publication" in completed.stdout


_COMPARISON_CONTRACT_TABLES = (
    "scalar_comparison_publication", "scalar_comparison_group", "scalar_comparison_territory",
    "ordered_series_comparison_publication", "ordered_series_comparison_group",
    "ordered_series_comparison_territory", "comparison_source_lineage",
    "ordered_series_comparison_lineage", "ordered_series_comparison_zero_reason",
)

# Fresh schema.sql makes these count columns NOT NULL. Migrations 033/034 add
# them nullable on purpose: NULL marks a pre-migration publication until the R
# publisher replaces it. Keep that documented sentinel out of the structural
# comparison, but do not hide any other column or constraint difference.
_COMPARISON_NULLABLE_SENTINELS = {
    "scalar_comparison_publication": ("lineage_row_count",),
    "scalar_comparison_group": ("lineage_source_count",),
    "ordered_series_comparison_publication": ("lineage_row_count",),
    "ordered_series_comparison_group": ("lineage_source_count",),
}


def _scrub_relation_schema(text, schema):
    text = " ".join((text or "").split())
    return re.sub(rf'"{re.escape(schema)}"\.|\b{re.escape(schema)}\.', "", text)


def _comparison_contract(connection, schema):
    """Structural contract for both comparison families in one schema."""
    contract = {}
    for table in _COMPARISON_CONTRACT_TABLES:
        columns = connection.execute("""
            SELECT column_name,data_type,is_nullable,column_default
            FROM information_schema.columns
            WHERE table_schema=%s AND table_name=%s ORDER BY ordinal_position
        """, (schema, table)).fetchall()
        sentinels = set(_COMPARISON_NULLABLE_SENTINELS.get(table, ()))
        columns = tuple(sorted(
            (name, data_type, "YES" if name in sentinels and is_nullable == "NO" else is_nullable, default)
            for name, data_type, is_nullable, default in columns
        ))
        constraints = set()
        for contype, definition in connection.execute("""
            SELECT c.contype, pg_get_constraintdef(c.oid)
            FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
            JOIN pg_namespace n ON n.oid=t.relnamespace
            WHERE n.nspname=%s AND t.relname=%s
        """, (schema, table)).fetchall():
            definition = _scrub_relation_schema(definition, schema)
            if contype == "n" and definition in {f"NOT NULL {name}" for name in sentinels}:
                continue
            # Known retained-034 divergence, recorded separately below: fresh
            # schema.sql declares the zero-reason group FK deferrable but not
            # cascading; 034 declares it cascading but not deferrable. Neither
            # form is introduced by 039, so compare the rest of the constraint.
            if table == "ordered_series_comparison_zero_reason" and contype == "f":
                definition = definition.replace(" ON DELETE CASCADE", "")
            constraints.add((contype, definition.replace(" DEFERRABLE INITIALLY DEFERRED", "")))
        indexes = {
            _scrub_relation_schema(definition, schema)
            for (definition,) in connection.execute("""
                SELECT pg_get_indexdef(i.indexrelid)
                FROM pg_index i JOIN pg_class t ON t.oid=i.indrelid
                JOIN pg_namespace n ON n.oid=t.relnamespace
                WHERE n.nspname=%s AND t.relname=%s
            """, (schema, table)).fetchall()
        }
        grants = tuple(connection.execute("""
            SELECT grantee, privilege_type
            FROM information_schema.role_table_grants
            WHERE table_schema=%s AND table_name=%s
              AND grantee IN ('lusk_reader','lusk_publisher')
            ORDER BY grantee, privilege_type
        """, (schema, table)).fetchall())
        triggers = tuple(connection.execute("""
            SELECT g.tgname
            FROM pg_trigger g JOIN pg_class t ON t.oid=g.tgrelid
            JOIN pg_namespace n ON n.oid=t.relnamespace
            WHERE n.nspname=%s AND t.relname=%s AND NOT g.tgisinternal
            ORDER BY g.tgname
        """, (schema, table)).fetchall())
        functions = tuple(connection.execute("""
            SELECT p.proname, p.prosrc
            FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
            WHERE n.nspname=%s AND p.prosrc LIKE %s ORDER BY p.proname
        """, (schema, f"%{table}%")).fetchall())
        contract[table] = (columns, constraints, indexes, grants, triggers, functions)
    return contract


_M039_FACT_TABLES = (
    "territory_reference", "table_publication", "scalar_descriptor",
    "scalar_descriptor_source", "scalar_observation", "scalar_observation_source",
    "series_descriptor", "ordered_series",
)


def _seed_m039_facts(connection):
    """Real legacy scalar and ordered-series facts plus their publication markers."""
    with connection.transaction():
        connection.execute("""
            INSERT INTO territory_reference(territory_id,territory_type,name,department_id,epci_id,
                density_class_code,density_class_label)
            VALUES ('80601','commune','Legacy focal','22','e1','D1','Dense'),
                   ('80602','commune','Legacy peer','22','e1','D1','Dense')""")
        connection.execute("INSERT INTO source_dataset(source_id,name) VALUES ('m039_fixture','M039 fixture')")
        connection.execute("""INSERT INTO source_vintage(source_id,vintage_id,version,reference_date,publication_date)
            VALUES ('m039_fixture','v1','2026-01','2025-01-01','2026-02-01')""")
        connection.execute("""INSERT INTO scalar_descriptor(indicator_id,theme_id,label,unit,direction,
            allowed_levels,denominator_semantics,completeness,descriptor_version)
            VALUES ('m039_scalar','test','M039 scalar','units','high',ARRAY['commune'],
            'population','sparse','m039-d1')""")
        connection.execute("INSERT INTO scalar_descriptor_source VALUES ('m039_scalar','m039_fixture')")
        connection.execute("""INSERT INTO scalar_observation(indicator_id,territory_id,territory_type,value,status)
            VALUES ('m039_scalar','80601','commune',2,'measured'),
                   ('m039_scalar','80602','commune',1,'measured')""")
        connection.execute("""INSERT INTO scalar_observation_source(indicator_id,territory_id,source_id,vintage_id)
            VALUES ('m039_scalar','80601','m039_fixture','v1'),
                   ('m039_scalar','80602','m039_fixture','v1')""")
        connection.execute("""INSERT INTO table_publication(table_name,content_version,row_count)
            VALUES ('territory_reference','m039-territory-v1',2)""")
        connection.execute("""INSERT INTO table_publication(table_name,content_version,row_count,reference_content_version)
            VALUES ('scalar_observation','m039-scalar-v1',2,'m039-territory-v1')""")
        connection.execute("""INSERT INTO series_descriptor(indicator_id,axis_kind,axis_values,completeness,
            comparison_point,allowed_levels,label,unit,direction,source_id,vintage_id,descriptor_version)
            VALUES ('m039_series','year',ARRAY['2022','2024'],'may_be_missing','2024',
            ARRAY['commune'],'M039 series','units','high','m039_fixture','v1','m039-series-d1')""")
        connection.execute("""INSERT INTO ordered_series(indicator_id,territory_id,territory_type,
            axis_value,observation_period,value,status,source_id,vintage_id)
            VALUES ('m039_series','80601','commune','2022','2022',1,'measured','m039_fixture','v1'),
                   ('m039_series','80601','commune','2024','2024',2,'measured','m039_fixture','v1'),
                   ('m039_series','80602','commune','2024','2024',1,'measured','m039_fixture','v1')""")
        connection.execute("""INSERT INTO table_publication(table_name,content_version,row_count,reference_content_version)
            VALUES ('ordered_series','m039-series-v1',3,'m039-territory-v1')""")


def _m039_catalog_snapshot(connection, schema):
    """Full target-relation catalog state, including names and grant options."""
    relations = list(_COMPARISON_CONTRACT_TABLES)
    existing = {row[0] for row in connection.execute("""
        SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname=%s AND c.relname=ANY(%s)""", (schema, relations)).fetchall()}
    columns = connection.execute("""
        SELECT table_name,column_name,data_type,is_nullable,column_default,ordinal_position
        FROM information_schema.columns WHERE table_schema=%s AND table_name=ANY(%s)
        ORDER BY table_name,ordinal_position""", (schema, relations)).fetchall()
    constraints = connection.execute("""
        SELECT t.relname,c.conname,c.contype,pg_get_constraintdef(c.oid),c.convalidated,c.condeferrable
        FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
        JOIN pg_namespace n ON n.oid=t.relnamespace
        WHERE n.nspname=%s AND t.relname=ANY(%s) ORDER BY t.relname,c.contype,c.conname""",
        (schema, relations)).fetchall()
    indexes = connection.execute("""
        SELECT t.relname,i.indexrelid::regclass::text,pg_get_indexdef(i.indexrelid),
               i.indisvalid,i.indisready,i.indislive,i.indisunique,i.indisprimary
        FROM pg_index i JOIN pg_class t ON t.oid=i.indrelid
        JOIN pg_namespace n ON n.oid=t.relnamespace
        WHERE n.nspname=%s AND t.relname=ANY(%s) ORDER BY t.relname,2""",
        (schema, relations)).fetchall()
    triggers = connection.execute("""
        SELECT t.relname,g.tgname,pg_get_triggerdef(g.oid)
        FROM pg_trigger g JOIN pg_class t ON t.oid=g.tgrelid
        JOIN pg_namespace n ON n.oid=t.relnamespace
        WHERE n.nspname=%s AND t.relname=ANY(%s) AND NOT g.tgisinternal
        ORDER BY t.relname,g.tgname""", (schema, relations)).fetchall()
    grants = connection.execute("""
        SELECT table_name,grantee,privilege_type,is_grantable
        FROM information_schema.role_table_grants
        WHERE table_schema=%s AND table_name=ANY(%s)
        ORDER BY table_name,grantee,privilege_type,is_grantable""", (schema, relations)).fetchall()
    column_grants = connection.execute("""
        SELECT table_name,column_name,grantee,privilege_type,is_grantable
        FROM information_schema.column_privileges
        WHERE table_schema=%s AND table_name=ANY(%s)
        ORDER BY table_name,column_name,grantee,privilege_type,is_grantable""",
        (schema, relations)).fetchall()
    functions = tuple(connection.execute("""
        SELECT p.oid::regprocedure::text,pg_get_functiondef(p.oid)
        FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname=%s ORDER BY p.oid::regprocedure::text""",
        (schema,)).fetchall())
    def grouped(rows):
        result = {table: [] for table in relations}
        for row in rows:
            result[row[0]].append(row[1:])
        return {table: tuple(result[table]) for table in relations}

    columns_by_table = grouped(columns)
    constraints_by_table = grouped(constraints)
    indexes_by_table = grouped(indexes)
    triggers_by_table = grouped(triggers)
    grants_by_table = grouped(grants)
    column_grants_by_table = grouped(column_grants)
    snapshot = {}
    for table in relations:
        if table not in existing:
            snapshot[table] = None
            continue
        snapshot[table] = (
            columns_by_table[table], constraints_by_table[table], indexes_by_table[table],
            triggers_by_table[table], grants_by_table[table], column_grants_by_table[table], functions)
    return snapshot


def _m039_constraint_name(connection, table, kind, definition_pattern):
    row = connection.execute("""
        SELECT c.conname FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
        JOIN pg_namespace n ON n.oid=t.relnamespace
        WHERE n.nspname=current_schema() AND t.relname=%s AND c.contype=%s
          AND pg_get_constraintdef(c.oid) LIKE %s
        ORDER BY c.conname LIMIT 1""", (table, kind, definition_pattern)).fetchone()
    assert row is not None, (table, kind, definition_pattern)
    return row[0]


def _break_m039_contract(connection, break_name):
    """Apply exactly one catalog breakage to a validated family."""
    if break_name == "drop_primary_key":
        name = _m039_constraint_name(connection, "scalar_comparison_publication", "p", "%")
        connection.execute(f'ALTER TABLE scalar_comparison_publication DROP CONSTRAINT "{name}"')
    elif break_name == "alter_fk_target":
        name = _m039_constraint_name(connection, "scalar_comparison_group", "f", "%scalar_descriptor%")
        connection.execute(f'ALTER TABLE scalar_comparison_group DROP CONSTRAINT "{name}"')
        connection.execute("""ALTER TABLE scalar_comparison_group ADD CONSTRAINT m039_broken_fk
            FOREIGN KEY (indicator_id) REFERENCES territory_reference(territory_id)""")
    elif break_name == "alter_fk_action":
        name = _m039_constraint_name(connection, "scalar_comparison_territory", "f", "%scalar_comparison_group%")
        connection.execute(f'ALTER TABLE scalar_comparison_territory DROP CONSTRAINT "{name}"')
        connection.execute("""ALTER TABLE scalar_comparison_territory ADD CONSTRAINT m039_broken_fk
            FOREIGN KEY (comparison_context,group_id,territory_type,indicator_id)
            REFERENCES scalar_comparison_group(comparison_context,group_id,territory_type,indicator_id)
            ON DELETE RESTRICT""")
    elif break_name == "alter_check":
        name = _m039_constraint_name(connection, "scalar_comparison_group", "c", "%statistic%")
        connection.execute(f'ALTER TABLE scalar_comparison_group DROP CONSTRAINT "{name}"')
        connection.execute("""ALTER TABLE scalar_comparison_group ADD CONSTRAINT m039_broken_check
            CHECK (statistic IN ('median','mean'))""")
    elif break_name == "not_valid_check":
        name = _m039_constraint_name(connection, "scalar_comparison_group", "c", "%statistic%")
        connection.execute(f'ALTER TABLE scalar_comparison_group DROP CONSTRAINT "{name}"')
        connection.execute("""ALTER TABLE scalar_comparison_group ADD CONSTRAINT m039_unvalidated_check
            CHECK (statistic='median') NOT VALID""")
    elif break_name == "alter_default":
        connection.execute("""ALTER TABLE scalar_comparison_publication
            ALTER COLUMN published_at SET DEFAULT '2020-01-01'::timestamptz""")
    elif break_name == "extra_trigger":
        connection.execute("""CREATE FUNCTION m039_broken_trigger_fn() RETURNS trigger
            LANGUAGE plpgsql AS $$BEGIN RETURN NEW; END$$""")
        connection.execute("""CREATE TRIGGER m039_broken_trigger BEFORE INSERT ON scalar_comparison_group
            FOR EACH ROW EXECUTE FUNCTION m039_broken_trigger_fn()""")
    elif break_name == "extra_unique_index":
        connection.execute("""CREATE UNIQUE INDEX m039_broken_unique
            ON scalar_comparison_group(group_id)""")
    elif break_name == "missing_grant":
        connection.execute("REVOKE SELECT ON scalar_comparison_publication FROM lusk_reader")
    elif break_name == "drop_lineage_primary_key":
        name = _m039_constraint_name(connection, "comparison_source_lineage", "p", "%")
        connection.execute(f'ALTER TABLE comparison_source_lineage DROP CONSTRAINT "{name}"')
    elif break_name == "alter_lineage_check":
        name = _m039_constraint_name(connection, "comparison_source_lineage", "c", "%comparison_family%")
        connection.execute(f'ALTER TABLE comparison_source_lineage DROP CONSTRAINT "{name}"')
        connection.execute("""ALTER TABLE comparison_source_lineage ADD CONSTRAINT m039_broken_check
            CHECK (comparison_family IN
              ('scalar','profile','ordered_series','period_detail','aedar','bogus'))""")
    elif break_name == "alter_lineage_fk_target":
        name = _m039_constraint_name(connection, "comparison_source_lineage", "f", "%source_vintage%")
        connection.execute(f'ALTER TABLE comparison_source_lineage DROP CONSTRAINT "{name}"')
        connection.execute("""ALTER TABLE comparison_source_lineage ADD CONSTRAINT m039_broken_fk
            FOREIGN KEY (source_id) REFERENCES source_dataset(source_id)""")
    elif break_name == "alter_zero_reason_fk_action":
        name = _m039_constraint_name(connection,
            "ordered_series_comparison_zero_reason", "f", "%ordered_series_comparison_group%")
        connection.execute(f'ALTER TABLE ordered_series_comparison_zero_reason DROP CONSTRAINT "{name}"')
        connection.execute("""ALTER TABLE ordered_series_comparison_zero_reason ADD CONSTRAINT m039_broken_fk
            FOREIGN KEY (dataset_id,indicator_id,comparison_context,group_id,territory_type,axis_value)
            REFERENCES ordered_series_comparison_group(dataset_id,indicator_id,comparison_context,
              group_id,territory_type,axis_value) ON DELETE RESTRICT""")
    elif break_name == "extra_lineage_trigger":
        connection.execute("""CREATE FUNCTION m039_broken_lineage_trigger_fn() RETURNS trigger
            LANGUAGE plpgsql AS $$BEGIN RETURN NEW; END$$""")
        connection.execute("""CREATE TRIGGER m039_broken_lineage_trigger BEFORE INSERT
            ON comparison_source_lineage FOR EACH ROW
            EXECUTE FUNCTION m039_broken_lineage_trigger_fn()""")
    elif break_name == "missing_lineage_grant":
        connection.execute("REVOKE SELECT ON comparison_source_lineage FROM lusk_reader")
    else:
        raise AssertionError(break_name)


_M039_BROKEN_CONTRACTS = (
    ("present", "drop_primary_key"),
    ("present", "alter_fk_target"),
    ("present", "alter_fk_action"),
    ("present", "alter_check"),
    ("present", "not_valid_check"),
    ("present", "alter_default"),
    ("present", "extra_trigger"),
    ("present", "extra_unique_index"),
    ("present", "missing_grant"),
    ("current", "drop_lineage_primary_key"),
    ("current", "alter_lineage_check"),
    ("current", "alter_lineage_fk_target"),
    ("current", "alter_zero_reason_fk_action"),
    ("current", "extra_lineage_trigger"),
    ("current", "missing_lineage_grant"),
)


def test_migration_039_rejects_broken_contract_without_mutation():
    """One malformed structure at a time must abort before target changes.

    Each schema starts from a valid present or current family with real facts
    and markers. The single breakage is snapshotted, 039 must fail, and both
    the fact rows and the complete target catalog state must be unchanged.
    """
    import psycopg

    publish_dsn, _ = _configuration()
    root = Path(__file__).resolve().parents[2]
    baseline = subprocess.check_output(
        ["git", "show", "d5832fcac665299156dff05b6ddd55d9c1d2f60a:api/schema.sql"],
        cwd=root, text=True, encoding="utf-8")
    migration = (root / "migrations/039_comparison_base_objects.sql").read_text(encoding="utf-8")
    for state, break_name in _M039_BROKEN_CONTRACTS:
        schema = f"it_m039_reject_{state}_{break_name}_" + uuid.uuid4().hex[:12]
        print(f"migration 039 retained broken-contract schema ({state}/{break_name}): {schema}")
        with psycopg.connect(publish_dsn, autocommit=True) as connection:
            connection.execute(f'CREATE SCHEMA "{schema}"')
            connection.execute(f'SET search_path TO "{schema}"')
            connection.execute(baseline)
            _drop_pre_lineage_comparison_bases(connection)
            _seed_m039_facts(connection)
            connection.execute(migration)
            if state == "current":
                connection.execute((root / "migrations/033_comparison_source_lineage.sql").read_text(encoding="utf-8"))
                connection.execute((root / "migrations/034_ordered_series_comparison_lineage.sql").read_text(encoding="utf-8"))
            _break_m039_contract(connection, break_name)
            facts_before = _table_snapshot(connection, _M039_FACT_TABLES)
            catalog_before = _m039_catalog_snapshot(connection, schema)
            with pytest.raises(psycopg.errors.RaiseException, match="migration 039"):
                connection.execute(migration)
        with psycopg.connect(publish_dsn, autocommit=True) as connection:
            connection.execute(f'SET search_path TO "{schema}"')
            assert _table_snapshot(connection, _M039_FACT_TABLES) == facts_before, break_name
            assert _m039_catalog_snapshot(connection, schema) == catalog_before, break_name


def test_migration_039_preserves_valid_independent_nonunique_index():
    """A caller-owned valid non-unique index is allowed and untouched."""
    import psycopg

    publish_dsn, _ = _configuration()
    root = Path(__file__).resolve().parents[2]
    baseline = subprocess.check_output(
        ["git", "show", "d5832fcac665299156dff05b6ddd55d9c1d2f60a:api/schema.sql"],
        cwd=root, text=True, encoding="utf-8")
    migration = (root / "migrations/039_comparison_base_objects.sql").read_text(encoding="utf-8")
    schema = f"it_m039_nonunique_index_{uuid.uuid4().hex[:12]}"
    print("migration 039 retained caller-index schema:", schema)
    with psycopg.connect(publish_dsn, autocommit=True) as connection:
        connection.execute(f'CREATE SCHEMA "{schema}"')
        connection.execute(f'SET search_path TO "{schema}"')
        connection.execute(baseline)
        _drop_pre_lineage_comparison_bases(connection)
        _seed_m039_facts(connection)
        connection.execute(migration)
        connection.execute("""CREATE INDEX m039_caller_lookup
            ON scalar_comparison_group(indicator_id)""")
        before = _m039_catalog_snapshot(connection, schema)
        connection.execute(migration)
        assert _m039_catalog_snapshot(connection, schema) == before


def test_migration_039_inventory_marks_malformed_family_as_shape_only():
    """A right-shaped family with a broken FK is never reported as validated/current."""
    import psycopg

    publish_dsn, _ = _configuration()
    root = Path(__file__).resolve().parents[2]
    schema = f"it_m039_inventory_advisory_{uuid.uuid4().hex[:12]}"
    inventory = (root / "migrations/039_operator_state_inventory.sql").read_text(encoding="utf-8")
    query = inventory.split("WITH families(family, base_relations", 1)[1]
    query = query.split("FROM family_state ORDER BY family;", 1)[0]
    query = "WITH families(family, base_relations" + query
    query += "FROM family_state ORDER BY family"
    print(f"migration 039 retained advisory-inventory schema: {schema}")
    with psycopg.connect(publish_dsn, autocommit=True) as connection:
        connection.execute(f'CREATE SCHEMA "{schema}"')
        connection.execute(f'SET search_path TO "{schema}"')
        connection.execute((root / "schema.sql").read_text(encoding="utf-8"))
        fk = _m039_constraint_name(connection, "scalar_comparison_group", "f", "%scalar_descriptor%")
        connection.execute(f'ALTER TABLE scalar_comparison_group DROP CONSTRAINT "{fk}"')
        rows = connection.execute(query).fetchall()
        scalar = next(row for row in rows if row[0] == "scalar")
        assert scalar[-3] is False
        assert "ADVISORY ONLY" in scalar[-2]
        assert scalar[-1] == "CURRENT_SHAPE_ONLY"


def test_migration_039_comparison_base_upgrade_states_and_fresh_equivalence():
    """Rehearse #806 absent/present/current/partial states and the documented chain."""
    import psycopg

    publish_dsn, _ = _configuration()
    root = Path(__file__).resolve().parents[2]
    baseline = subprocess.check_output(
        ["git", "show", "d5832fcac665299156dff05b6ddd55d9c1d2f60a:api/schema.sql"],
        cwd=root, text=True, encoding="utf-8")
    migration = (root / "migrations/039_comparison_base_objects.sql").read_text(encoding="utf-8")
    schemas = {
        state: f"it_m039_{state}_" + uuid.uuid4().hex[:12]
        for state in ("upgrade", "fresh", "partial", "current", "mixed")
    }
    print("migration 039 retained schemas:", schemas)
    with psycopg.connect(publish_dsn, autocommit=True) as connection:
        for schema in schemas.values():
            connection.execute(f'CREATE SCHEMA "{schema}"')

    # Fresh contract of record.
    with psycopg.connect(publish_dsn, autocommit=True) as connection:
        connection.execute(f'SET search_path TO "{schemas["fresh"]}"')
        connection.execute((root / "schema.sql").read_text(encoding="utf-8"))

    # Existing serving schema: pinned pre-lineage shape, real legacy facts, no bases.
    with psycopg.connect(publish_dsn, autocommit=True) as connection:
        connection.execute(f'SET search_path TO "{schemas["upgrade"]}"')
        connection.execute(baseline)
        _drop_pre_lineage_comparison_bases(connection)
        _seed_m039_facts(connection)
        untouched_tables = _M039_FACT_TABLES
        before = _table_snapshot(connection, untouched_tables)

        # Absent -> 039 creates only the exact pre-lineage bases.
        connection.execute(migration)
        for table, expected in (
            ("scalar_comparison_publication", {
                "content_version", "group_row_count", "published_at",
                "reference_content_version", "scalar_content_version", "singleton",
                "territory_row_count"}),
            ("ordered_series_comparison_publication", {
                "content_version", "dataset_id", "group_row_count", "indicator_id",
                "ordered_series_content_version", "published_at",
                "reference_content_version", "territory_row_count"}),
        ):
            columns = {row[0] for row in connection.execute("""
                SELECT column_name FROM information_schema.columns
                WHERE table_schema=%s AND table_name=%s""", (schemas["upgrade"], table)).fetchall()}
            assert columns == expected, table
        # Present -> a second 039 is a structural no-op.
        connection.execute(migration)
        for table in ("scalar_comparison_publication", "ordered_series_comparison_publication"):
            assert connection.execute("""SELECT count(*) FROM information_schema.columns
                WHERE table_schema=%s AND table_name=%s AND column_name LIKE 'lineage%%'""",
                (schemas["upgrade"], table)).fetchone()[0] == 0

        # Documented chain: 039 -> 033 -> 034.
        connection.execute((root / "migrations/033_comparison_source_lineage.sql").read_text(encoding="utf-8"))
        connection.execute((root / "migrations/034_ordered_series_comparison_lineage.sql").read_text(encoding="utf-8"))
        assert _table_snapshot(connection, untouched_tables) == before
        assert connection.execute("""SELECT count(*) FROM information_schema.columns
            WHERE table_schema=%s AND table_name='scalar_comparison_publication'
              AND column_name='lineage_row_count'""", (schemas["upgrade"],)).fetchone()[0] == 1
        assert connection.execute("""SELECT count(*) FROM information_schema.columns
            WHERE table_schema=%s AND table_name='ordered_series_comparison_publication'
              AND column_name='comparison_axes'""", (schemas["upgrade"],)).fetchone()[0] == 1
        # A migrated current family is a no-op on a later 039 invocation.
        connection.execute(migration)
        assert _table_snapshot(connection, untouched_tables) == before

    # Current -> 039 leaves existing facts and markers untouched.
    with psycopg.connect(publish_dsn, autocommit=True) as connection:
        connection.execute(f'SET search_path TO "{schemas["current"]}"')
        connection.execute((root / "schema.sql").read_text(encoding="utf-8"))
        with connection.transaction():
            connection.execute("""INSERT INTO territory_reference(territory_id,territory_type,name)
                VALUES ('80603','commune','Current focal')""")
            connection.execute("INSERT INTO source_dataset(source_id,name) VALUES ('m039_current','M039 current')")
            connection.execute("""INSERT INTO source_vintage(source_id,vintage_id,version,reference_date,publication_date)
                VALUES ('m039_current','v1','2026-01','2025-01-01','2026-02-01')""")
            connection.execute("""INSERT INTO scalar_descriptor(indicator_id,theme_id,label,unit,direction,
                allowed_levels,denominator_semantics,completeness,descriptor_version)
                VALUES ('m039_current_scalar','test','Current scalar','units','high',ARRAY['commune'],
                'population','sparse','m039-current-d1')""")
            connection.execute("INSERT INTO scalar_descriptor_source VALUES ('m039_current_scalar','m039_current')")
            connection.execute("""INSERT INTO scalar_comparison_publication(singleton,content_version,
                scalar_content_version,reference_content_version,group_row_count,territory_row_count,lineage_row_count)
                VALUES (true,'m039-comparison-v1','m039-scalar-v1','m039-territory-v1',1,1,1)""")
            connection.execute("""INSERT INTO scalar_comparison_group(comparison_context,group_id,territory_type,
                indicator_id,statistic,median,member_count,eligible_count,missing_count,lineage_source_count)
                VALUES ('bretagne','m039','commune','m039_current_scalar','median',1.5,2,2,0,1)""")
        current_before = _table_snapshot(connection, (
            "scalar_comparison_publication", "scalar_comparison_group"))
        connection.execute(migration)
        assert _table_snapshot(connection, (
            "scalar_comparison_publication", "scalar_comparison_group")) == current_before

    # Partial states abort before mutation and leave the rest of the schema alone.
    with psycopg.connect(publish_dsn, autocommit=True) as connection:
        connection.execute(f'SET search_path TO "{schemas["partial"]}"')
        connection.execute(baseline)
        _drop_pre_lineage_comparison_bases(connection)
        connection.execute("CREATE TABLE scalar_comparison_group(comparison_context text, group_id text)")
        with pytest.raises(psycopg.errors.RaiseException, match="incompatible partial state"):
            connection.execute(migration)
    with psycopg.connect(publish_dsn, autocommit=True) as connection:
        connection.execute(f'SET search_path TO "{schemas["partial"]}"')
        assert connection.execute("SELECT to_regclass('scalar_comparison_publication')").fetchone()[0] is None
        assert connection.execute("SELECT to_regclass('ordered_series_comparison_publication')").fetchone()[0] is None
        assert connection.execute("""SELECT count(*) FROM information_schema.columns
            WHERE table_schema=%s AND table_name='scalar_comparison_group'""",
            (schemas["partial"],)).fetchone()[0] == 2
        connection.execute("DROP TABLE scalar_comparison_group")
        connection.execute(migration)
        for table in ("ordered_series_comparison_territory", "ordered_series_comparison_group",
                      "ordered_series_comparison_publication"):
            connection.execute(f"DROP TABLE {table}")
        connection.execute("ALTER TABLE scalar_comparison_publication ADD COLUMN unexpected_column text")
        with pytest.raises(psycopg.errors.RaiseException, match="does not match the expected column contract"):
            connection.execute(migration)
    with psycopg.connect(publish_dsn, autocommit=True) as connection:
        connection.execute(f'SET search_path TO "{schemas["partial"]}"')
        assert connection.execute("SELECT to_regclass('ordered_series_comparison_publication')").fetchone()[0] is None
        assert connection.execute("""SELECT count(*) FROM information_schema.columns
            WHERE table_schema=%s AND table_name='scalar_comparison_publication'
              AND column_name='unexpected_column'""", (schemas["partial"],)).fetchone()[0] == 1

    # The families are independent: an exact present family plus an absent one
    # is a supported mixed state in either direction.
    with psycopg.connect(publish_dsn, autocommit=True) as connection:
        connection.execute(f'SET search_path TO "{schemas["mixed"]}"')
        connection.execute(baseline)
        _drop_pre_lineage_comparison_bases(connection)
        connection.execute(migration)
        for table in _ORDERED_SERIES_COMPARISON_BASES:
            connection.execute(f"DROP TABLE {table}")
        connection.execute(migration)
        for table in _SCALAR_COMPARISON_BASES:
            connection.execute(f"DROP TABLE {table}")
        connection.execute(migration)
        for table in _SCALAR_COMPARISON_BASES + _ORDERED_SERIES_COMPARISON_BASES:
            assert connection.execute("SELECT to_regclass(%s) IS NOT NULL", (table,)).fetchone()[0], table

    # Structural equivalence, excluding only the documented NULL sentinels.
    with psycopg.connect(publish_dsn) as connection:
        upgraded = _comparison_contract(connection, schemas["upgrade"])
        fresh = _comparison_contract(connection, schemas["fresh"])
        assert upgraded == fresh, {
            table: (upgraded[table], fresh[table])
            for table in _COMPARISON_CONTRACT_TABLES if upgraded[table] != fresh[table]
        }
        # Known retained-034 divergence, recorded rather than hidden: fresh
        # schema.sql declares the zero-reason group FK deferrable but not
        # cascading; 034 declares it cascading but not deferrable. The R
        # publisher deletes comparison groups directly before rewriting them,
        # so 034's cascade is load-bearing on the upgrade path. Changing either
        # shape is outside #806; this test pins the difference for review.
        def zero_reason_fks(schema):
            return {definition for _, definition in connection.execute("""
                SELECT c.contype, pg_get_constraintdef(c.oid)
                FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
                JOIN pg_namespace n ON n.oid=t.relnamespace
                WHERE n.nspname=%s AND t.relname='ordered_series_comparison_zero_reason'
                  AND c.contype='f'
            """, (schema,)).fetchall()}
        upgrade_fks = zero_reason_fks(schemas["upgrade"])
        fresh_fks = zero_reason_fks(schemas["fresh"])
        assert len(upgrade_fks) == len(fresh_fks) == 1
        assert "ON DELETE CASCADE" in next(iter(upgrade_fks))
        assert "DEFERRABLE INITIALLY DEFERRED" not in next(iter(upgrade_fks))
        assert "DEFERRABLE INITIALLY DEFERRED" in next(iter(fresh_fks))
        assert "ON DELETE CASCADE" not in next(iter(fresh_fks))


def test_migration_035_adds_collection_lineage_to_pre_migration_shape():
    """Rehearse the additive migration only inside its own guarded schema."""
    import psycopg

    publish_dsn, _ = _configuration()
    schema = "it_migration_035_" + uuid.uuid4().hex[:16]
    root = Path(__file__).resolve().parents[2]
    created = False
    try:
        with psycopg.connect(publish_dsn, autocommit=True) as connection:
            connection.execute(f'CREATE SCHEMA "{schema}"')
            created = True
            connection.execute(f'SET search_path TO "{schema}"')
            connection.execute((root / "schema.sql").read_text(encoding="utf-8"))
            # Reconstruct the migration-034 table shape from the fresh schema.
            connection.execute("DROP TRIGGER observed_collection_comparison_lineage_contract ON observed_collection_comparison_publication")
            connection.execute("DROP FUNCTION validate_observed_collection_comparison_lineage()")
            connection.execute("DROP TABLE observed_collection_comparison_lineage")
            connection.execute("ALTER TABLE observed_collection_comparison_group DROP CONSTRAINT observed_collection_lineage_support_shape")
            connection.execute("ALTER TABLE observed_collection_comparison_group DROP CONSTRAINT IF EXISTS observed_collection_comparison_group_member_count_check")
            connection.execute("ALTER TABLE observed_collection_comparison_group DROP COLUMN lineage_source_count")
            connection.execute("ALTER TABLE observed_collection_comparison_publication DROP COLUMN lineage_row_count,DROP COLUMN lineage_complete")
            connection.execute((root / "migrations/035_numeric_collection_comparison_lineage.sql").read_text(encoding="utf-8"))
            columns = {row[0] for row in connection.execute("""SELECT column_name FROM information_schema.columns
                WHERE table_schema=%s AND table_name='observed_collection_comparison_publication'""", (schema,)).fetchall()}
            assert {"lineage_row_count", "lineage_complete"} <= columns
            assert connection.execute("SELECT to_regclass(%s)", (f"{schema}.observed_collection_comparison_lineage",)).fetchone()[0]
            complete_default = connection.execute("""SELECT column_default FROM information_schema.columns
                WHERE table_schema=%s AND table_name='observed_collection_comparison_publication' AND column_name='lineage_complete'""",
                (schema,)).fetchone()[0]
            assert complete_default in ("false", "false::boolean")
    finally:
        if created and os.environ.get("LUSK_TEST_ALLOW_SCHEMA_CLEANUP") == "1":
            with psycopg.connect(publish_dsn, autocommit=True) as connection:
                connection.execute(f'DROP SCHEMA "{schema}" CASCADE')


def test_ordered_series_bounded_read_comparison_and_rollback():
    import psycopg
    from fastapi.testclient import TestClient
    from psycopg_pool import ConnectionPool
    from api import main

    publish_dsn, read_dsn = _configuration()
    schema = "it_" + uuid.uuid4().hex[:20]
    scoped_publish = _dsn_with_schema(publish_dsn, schema)
    scoped_read = _dsn_with_schema(read_dsn, schema)
    schema_path = Path(__file__).resolve().parents[2] / "schema.sql"
    with psycopg.connect(publish_dsn, autocommit=True) as connection:
        connection.execute(f'CREATE SCHEMA "{schema}"')
    try:
        reader_role = urlsplit(read_dsn).username
        if not reader_role or not re.fullmatch(r"[A-Za-z0-9_$-]+", reader_role):
            pytest.fail("Read DSN must identify a simple PostgreSQL role name")
        quoted_role = '"' + reader_role.replace('"', '""') + '"'
        with psycopg.connect(scoped_publish, autocommit=True) as publisher:
            publisher.execute(schema_path.read_text(encoding="utf-8"))
            publisher.execute(f'GRANT USAGE ON SCHEMA "{schema}" TO {quoted_role}')
            publisher.execute(f'GRANT SELECT ON ALL TABLES IN SCHEMA "{schema}" TO {quoted_role}')
            publisher.execute("INSERT INTO territory_reference(territory_id,territory_type,name,department_id,epci_id,density_class_code,density_class_label) VALUES ('59701','commune','Series focal','22','e1','D1','Dense'),('59702','commune','Series peer','22','e1','D1','Dense'),('59703','commune','Series tie','22','e2','D1','Dense'),('53','region','Series region',NULL,NULL,NULL,NULL)")
            publisher.execute("INSERT INTO source_dataset(source_id,name) VALUES ('series_fixture','Series fixture')")
            publisher.execute("INSERT INTO source_vintage(source_id,vintage_id,version,reference_date,publication_date) VALUES ('series_fixture','v1','2026-01','2025-01-01','2026-02-01')")
            publisher.execute("""INSERT INTO series_descriptor(indicator_id,axis_kind,axis_values,completeness,comparison_point,allowed_levels,label,unit,direction,source_id,vintage_id,descriptor_version)
                VALUES ('fixture_annual','year',ARRAY['2022','2023','2024'],'may_be_missing','2024',ARRAY['commune','region'],'Fixture annual','ha','low','series_fixture','v1','d1')""")
            publisher.execute("""INSERT INTO series_descriptor(indicator_id,axis_kind,axis_values,completeness,comparison_point,allowed_levels,label,unit,direction,source_id,vintage_id,descriptor_version)
                VALUES ('fixture_unranked','year',ARRAY['2024'],'may_be_missing',NULL,ARRAY['commune'],'Unranked series','ha','none','series_fixture','v1','d1')""")
            publisher.execute("""INSERT INTO ordered_series(indicator_id,territory_id,territory_type,axis_value,observation_period,value,status,source_id,vintage_id) VALUES
                ('fixture_annual','59701','commune','2022','2022',0,'measured','series_fixture','v1'),
                ('fixture_annual','59701','commune','2024','2024',2,'measured','series_fixture','v1'),
                ('fixture_annual','59702','commune','2024','2024',1,'measured','series_fixture','v1'),
                ('fixture_annual','59703','commune','2024','2024',2,'measured','series_fixture','v1'),
                ('fixture_annual','53','region','2024','2024',10,'measured','series_fixture','v1')""")
            publisher.execute("""INSERT INTO table_publication(table_name,content_version,row_count)
                VALUES ('territory_reference','territory-series-v1',4)
                ON CONFLICT (table_name) DO UPDATE SET content_version=EXCLUDED.content_version,row_count=EXCLUDED.row_count""")
            publisher.execute("INSERT INTO table_publication(table_name,content_version,row_count,reference_content_version) VALUES ('ordered_series','series-v1',5,'territory-series-v1')")
            publisher.execute("INSERT INTO source_dataset(source_id,name) VALUES ('collection_fixture','Collection fixture')")
            publisher.execute("INSERT INTO source_vintage(source_id,vintage_id,version,reference_date,publication_date) VALUES ('collection_fixture','v1','2026-01','2025-01-01','2026-02-01')")
            with publisher.transaction():
                publisher.execute("INSERT INTO observed_collection_publication(indicator_id,content_version,reference_content_version,row_count) VALUES ('fixture_period','collection-v1','territory-series-v1',1)")
                publisher.execute("INSERT INTO observed_collection_descriptor(indicator_id,theme_id,kind,label,unit,descriptor_version,allowed_levels,direction) VALUES ('fixture_period','test','period_detail','Fixture period','units','d1',ARRAY['commune'],'none')")
                publisher.execute("INSERT INTO observed_collection_category(indicator_id,detail_key,label,ordinal,source_id) VALUES ('fixture_period','detail-a','Detail A',0,'collection_fixture')")
                publisher.execute("INSERT INTO period_detail_observation(indicator_id,territory_id,territory_type,detail_key,observation_period,value,source_id,vintage_id) VALUES ('fixture_period','59701','commune','detail-a','2024',0,'collection_fixture','v1')")
            with publisher.transaction():
                publisher.execute("INSERT INTO series_dataset_publication(dataset_id,content_version,reference_content_version,row_count) VALUES ('owned_fixture','owned-v1','territory-series-v1',4)")
                publisher.execute("""INSERT INTO series_dataset_descriptor(dataset_id,indicator_id,axis_kind,axis_values,
                    completeness,comparison_point,label,unit,direction,allowed_levels,descriptor_version,active_read_route)
                    VALUES ('owned_fixture','fixture_owned','year',ARRAY['2022','2024'],'dense_complete',NULL,
                    'Owned fixture','units','none',ARRAY['commune'],'owned-d1',true)""")
                publisher.execute("""INSERT INTO series_named_reference_descriptor(dataset_id,indicator_id,reference_id,
                    reference_label,reference_role,reference_statistic,required,reference_indicator_id,active_read_route)
                    VALUES ('owned_fixture','fixture_owned','reference-a','Reference A','analytical_reference',
                    'declared baseline',true,'fixture_named_reference',true)""")
                publisher.execute("""INSERT INTO series_provenance_revision(provenance_revision_id,source_id,vintage_id,
                    source_name,dataset_name,source_version,reference_date,publication_date,revision_hash)
                    VALUES ('owned-revision','series_fixture','v1','Series fixture','Fixture dataset','2026-01',
                    '2025-01-01','2026-02-01','owned-hash')""")
                for axis, value in (("2022", 0.0), ("2024", 2.0)):
                    publisher.execute("""INSERT INTO series_dataset_observation(dataset_id,indicator_id,territory_id,
                        territory_type,axis_value,observation_period,value,status) VALUES
                        ('owned_fixture','fixture_owned','59701','commune',%s,%s,%s,'measured')""",
                        (axis, axis, value))
                    publisher.execute("""INSERT INTO series_observation_provenance(dataset_id,indicator_id,territory_id,
                        axis_value,provenance_revision_id) VALUES ('owned_fixture','fixture_owned','59701',%s,'owned-revision')""", (axis,))
                    publisher.execute("""INSERT INTO series_named_reference(dataset_id,indicator_id,reference_id,
                        axis_value,observation_period,value,status) VALUES
                        ('owned_fixture','fixture_owned','reference-a',%s,%s,%s,'measured')""", (axis, axis, value))
                    publisher.execute("""INSERT INTO series_named_reference_provenance(dataset_id,indicator_id,
                        reference_id,axis_value,provenance_revision_id) VALUES
                        ('owned_fixture','fixture_owned','reference-a',%s,'owned-revision')""", (axis,))
            publisher.execute("""INSERT INTO profile_descriptor(indicator_id,label,unit,allowed_levels,completeness,
                descriptor_version,comparison_detail,comparison_sex,comparison_direction,theme_id)
                VALUES ('fixture_profile','Fixture profile','units',ARRAY['commune'],'dense_complete',
                'profile-d1','detail-a','F','low','test')""")
            publisher.execute("""INSERT INTO profile_axis(indicator_id,axis_name,axis_key,label,ordinal) VALUES
                ('fixture_profile','detail','detail-a','Detail A',0),('fixture_profile','detail','detail-b','Detail B',1),
                ('fixture_profile','sex','F','Female',0),('fixture_profile','sex','M','Male',1)""")
            publisher.execute("INSERT INTO profile_descriptor_source VALUES ('fixture_profile','series_fixture')")
            for detail, sex, value in (("detail-a", "F", .2), ("detail-a", "M", .3),
                                       ("detail-b", "F", .4), ("detail-b", "M", .5)):
                publisher.execute("""INSERT INTO profile_observation(indicator_id,territory_id,territory_type,
                    detail_key,sex_key,value,status) VALUES ('fixture_profile','59701','commune',%s,%s,%s,'measured')""",
                    (detail, sex, value))
                publisher.execute("INSERT INTO profile_observation_source VALUES ('fixture_profile','59701',%s,%s,'series_fixture','v1')",
                                  (detail, sex))
            publisher.execute("INSERT INTO table_publication(table_name,content_version,row_count,reference_content_version) VALUES ('declared_profile','profile-fixture-v1',4,'territory-series-v1')")
            publisher.execute("""INSERT INTO series_descriptor(indicator_id,axis_kind,axis_values,completeness,comparison_point,allowed_levels,label,unit,direction,source_id,vintage_id,descriptor_version)
                VALUES ('fixture_sparse','year',ARRAY['2024'],'may_be_missing','2024',ARRAY['commune'],'Fixture sparse','ha','low','series_fixture','v1','d1')""")
            publisher.execute("""INSERT INTO ordered_series(indicator_id,territory_id,territory_type,axis_value,observation_period,value,status,source_id,vintage_id) VALUES
                ('fixture_sparse','59701','commune','2024','2024',4,'measured','series_fixture','v1'),
                ('fixture_sparse','59702','commune','2024','2024',NULL,'missing','series_fixture','v1')""")
            publisher.execute("UPDATE table_publication SET content_version='series-v2',row_count=7 WHERE table_name='ordered_series'")
            with pytest.raises(psycopg.errors.CheckViolation):
                with publisher.transaction():
                    publisher.execute("UPDATE ordered_series SET value=99 WHERE territory_id='59701' AND axis_value='2024'")
                    publisher.execute("UPDATE table_publication SET content_version='partial' WHERE table_name='ordered_series'")
                    publisher.execute("INSERT INTO ordered_series(indicator_id,territory_id,territory_type,axis_value,observation_period,value,status,source_id,vintage_id) VALUES ('fixture_annual','59701','commune','2023','2023',NULL,'measured','series_fixture','v1')")
            assert publisher.execute("SELECT value FROM ordered_series WHERE territory_id='59701' AND axis_value='2024'").fetchone()[0] == 2
            assert publisher.execute("SELECT content_version FROM table_publication WHERE table_name='ordered_series'").fetchone()[0] == 'series-v2'

        from dataclasses import replace
        from api.resource_catalogue import default_resource_catalogue

        pool = ConnectionPool(conninfo=scoped_read, min_size=0, max_size=2, open=True,
                              kwargs={"autocommit": True})
        catalogue = default_resource_catalogue()
        resources = list(catalogue.resources)
        def add_fixture_resource(resource_id, template_id, **changes):
            template = catalogue.resources_by_id[template_id]
            resources.append(replace(template, resource_id=resource_id,
                indicator_id=resource_id, theme_id="test", **changes))
        add_fixture_resource("fixture_annual", "prix_m2")
        add_fixture_resource("fixture_sparse", "prix_m2")
        add_fixture_resource("fixture_owned", "artif_par_habitant")
        add_fixture_resource("fixture_named_reference", "raccordement_reference",
            target_kinds=("named_reference",), target_ids=("reference-a",))
        add_fixture_resource("fixture_profile", "structure_age")
        add_fixture_resource("fixture_period", "subventions_par_domaine")
        test_catalogue = replace(catalogue, resources=tuple(resources))
        previous = main.app.dependency_overrides.get(main.get_repository)
        previous_catalogue = main.app.dependency_overrides.get(main.get_resource_catalogue)
        main.app.dependency_overrides[main.get_repository] = lambda: main.ReadRepository(pool)
        main.app.dependency_overrides[main.get_resource_catalogue] = lambda: test_catalogue

        def fact_item(resource, resource_target=None, fields=None):
            item = {"resource": resource,
                "target": resource_target or {"kind": "territory", "type": "commune", "id": "59701"},
                "intent": {"kind": "facts"}}
            if fields is not None:
                item["fields"] = fields
            return item
        def comparison_item(resource, members=None):
            intent = ({"kind": "fixed_comparison", "context": "default"} if members is None else
                {"kind": "selected_comparison", "members": members})
            return {"resource": resource,
                "target": {"kind": "territory", "type": "commune", "id": "59701"},
                "intent": intent}
        try:
            with TestClient(main.app) as client:
                annual = client.post("/api/resources/read", json=fact_item("fixture_annual"))
                annual_value = client.post("/api/resources/read", json=fact_item("fixture_annual", fields=["value"]))
                profile = client.post("/api/resources/read", json=fact_item("fixture_profile"))
                collection = client.post("/api/resources/read", json=fact_item("fixture_period"))
                owned = client.post("/api/resources/read", json=fact_item("fixture_owned"))
                reference = client.post("/api/resources/read", json=fact_item("fixture_named_reference",
                    {"kind": "named_reference", "id": "reference-a"}, fields=["value"]))
                compared = client.post("/api/resources/read", json=comparison_item("fixture_annual", [
                    {"type": "commune", "id": "59702"}, {"type": "commune", "id": "59703"}]))
                sparse = client.post("/api/resources/read", json=comparison_item("fixture_sparse"))
                combined = client.post("/api/resources/read-batch", json={"items": [
                    {"id": "annual", **fact_item("fixture_annual")},
                    {"id": "profile", **fact_item("fixture_profile")},
                    {"id": "owned", **fact_item("fixture_owned")}]})
                retired_series = client.get("/api/territories/commune/59701/series/fixture_annual")
                retired_owned = client.get("/api/series-datasets/owned_fixture/territories/commune/59701/fixture_owned")
            assert annual.status_code == annual_value.status_code == 200, (annual.text, annual_value.text)
            series_data = annual.json()
            assert [point["axis"] for point in series_data["points"]] == ["2022", "2023", "2024"]
            assert series_data["points"][0]["value"] == 0
            assert series_data["points"][1]["status"] == "missing"
            assert [point["value"] for point in annual_value.json()["points"]] == [
                point["value"] for point in series_data["points"]]
            assert [point["status"] for point in annual_value.json()["points"]] == [
                point["status"] for point in series_data["points"]]
            assert series_data["publication_id"] == "series-v2"
            assert profile.status_code == 200, profile.text
            assert [cell["value"] for cell in profile.json()["observations"]] == [.2, .3, .4, .5]
            assert collection.status_code == 200, collection.text
            assert collection.json()["entries"][0]["value"] == 0
            assert owned.status_code == 200, owned.text
            assert [point["axis"] for point in owned.json()["points"]] == ["2022", "2024"]
            assert all(point["provenance"] for point in owned.json()["points"])
            assert reference.status_code == 200, reference.text
            assert [point["value"] for point in reference.json()["points"]] == [0, 2]
            assert compared.status_code == 200, compared.text
            assert compared.json()["result"]["median"] == 1.5
            assert sparse.status_code == 200, sparse.text
            assert sparse.json()["result"]["status"] == "unavailable"
            assert combined.status_code == 200, combined.text
            combined_data = {entry["id"]: entry["data"] for entry in combined.json()["results"]}
            assert combined_data["annual"] == annual.json()
            assert combined_data["profile"] == profile.json()
            assert combined_data["owned"] == owned.json()
            assert retired_series.status_code == retired_owned.status_code == 404
        finally:
            if previous is None:
                main.app.dependency_overrides.pop(main.get_repository, None)
            else:
                main.app.dependency_overrides[main.get_repository] = previous
            if previous_catalogue is None:
                main.app.dependency_overrides.pop(main.get_resource_catalogue, None)
            else:
                main.app.dependency_overrides[main.get_resource_catalogue] = previous_catalogue
            pool.close()
    finally:
        if os.environ.get("LUSK_TEST_ALLOW_SCHEMA_CLEANUP") == "1":
            with psycopg.connect(publish_dsn, autocommit=True) as connection:
                connection.execute(f'DROP SCHEMA "{schema}" CASCADE')



def test_ordered_series_read_uses_one_repeatable_read_publication_snapshot():
    """Pause after the marker read while a second complete publication commits."""
    from contextlib import contextmanager
    import threading

    import psycopg
    from fastapi.testclient import TestClient
    from psycopg_pool import ConnectionPool
    from api import main
    from dataclasses import replace
    from api.resource_catalogue import default_resource_catalogue

    publish_dsn, read_dsn = _configuration()
    schema = "it_" + uuid.uuid4().hex[:20]
    scoped_publish = _dsn_with_schema(publish_dsn, schema)
    scoped_read = _dsn_with_schema(read_dsn, schema)
    schema_path = Path(__file__).resolve().parents[2] / "schema.sql"
    marker_read = threading.Event()
    continue_read = threading.Event()
    with psycopg.connect(publish_dsn, autocommit=True) as connection:
        connection.execute(f'CREATE SCHEMA "{schema}"')
    try:
        reader_role = urlsplit(read_dsn).username
        if not reader_role or not re.fullmatch(r"[A-Za-z0-9_$-]+", reader_role):
            pytest.fail("Read DSN must identify a simple PostgreSQL role name")
        quoted_role = '"' + reader_role.replace('"', '""') + '"'
        with psycopg.connect(scoped_publish, autocommit=True) as publisher:
            publisher.execute(schema_path.read_text(encoding="utf-8"))
            publisher.execute(f'GRANT USAGE ON SCHEMA "{schema}" TO {quoted_role}')
            publisher.execute(f'GRANT SELECT ON ALL TABLES IN SCHEMA "{schema}" TO {quoted_role}')
            publisher.execute("INSERT INTO territory_reference(territory_id,territory_type,name,department_id,epci_id) VALUES ('59791','commune','Snapshot focal','22','e1'),('59792','commune','Snapshot peer','22','e1')")
            publisher.execute("INSERT INTO source_dataset(source_id,name) VALUES ('snapshot_fixture','Snapshot fixture')")
            publisher.execute("INSERT INTO source_vintage(source_id,vintage_id,version,reference_date,publication_date) VALUES ('snapshot_fixture','v1','2026-01','2025-01-01','2026-02-01')")
            publisher.execute("""INSERT INTO series_descriptor(indicator_id,axis_kind,axis_values,completeness,comparison_point,allowed_levels,label,unit,direction,source_id,vintage_id,descriptor_version)
                VALUES ('snapshot_annual','year',ARRAY['2022','2023','2024'],'may_be_missing','2024',ARRAY['commune'],'Snapshot annual','ha','low','snapshot_fixture','v1','descriptor-v1')""")
            publisher.execute("""INSERT INTO ordered_series(indicator_id,territory_id,territory_type,axis_value,observation_period,value,status,source_id,vintage_id) VALUES
                ('snapshot_annual','59791','commune','2022','2022',0,'measured','snapshot_fixture','v1'),
                ('snapshot_annual','59791','commune','2024','2024',2,'measured','snapshot_fixture','v1'),
                ('snapshot_annual','59792','commune','2024','2024',1,'measured','snapshot_fixture','v1')""")
            publisher.execute("""INSERT INTO table_publication(table_name,content_version,row_count)
                VALUES ('territory_reference','territory-snapshot-v1',2)
                ON CONFLICT (table_name) DO UPDATE SET content_version=EXCLUDED.content_version,row_count=EXCLUDED.row_count""")
            publisher.execute("INSERT INTO table_publication(table_name,content_version,row_count,reference_content_version) VALUES ('ordered_series','series-snapshot-v1',3,'territory-snapshot-v1')")

        pool = ConnectionPool(conninfo=scoped_read, min_size=0, max_size=2, open=True,
                              kwargs={"autocommit": True})

        catalogue = default_resource_catalogue()
        snapshot_resource = replace(catalogue.resources_by_id["prix_m2"],
            resource_id="snapshot_annual", indicator_id="snapshot_annual")
        test_catalogue = replace(catalogue, resources=(*catalogue.resources, snapshot_resource))

        class ConnectionProxy:
            def __init__(self, connection):
                self.connection = connection

            def execute(self, query, *args, **kwargs):
                result = self.connection.execute(query, *args, **kwargs)
                if isinstance(query, str) and "FROM table_publication s LEFT JOIN" in query:
                    marker_read.set()
                    if not continue_read.wait(timeout=15):
                        raise TimeoutError("publication snapshot test barrier was not released")
                return result

            def __getattr__(self, name):
                return getattr(self.connection, name)

        class PausingPool:
            @contextmanager
            def connection(self):
                with pool.connection() as connection:
                    yield ConnectionProxy(connection)

        previous = main.app.dependency_overrides.get(main.get_repository)
        previous_catalogue = main.app.dependency_overrides.get(main.get_resource_catalogue)
        main.app.dependency_overrides[main.get_repository] = lambda: main.ReadRepository(PausingPool())
        main.app.dependency_overrides[main.get_resource_catalogue] = lambda: test_catalogue
        request = {"resource": "snapshot_annual",
            "target": {"kind": "territory", "type": "commune", "id": "59791"},
            "intent": {"kind": "facts"}}
        try:
            with TestClient(main.app) as client:
                with concurrent.futures.ThreadPoolExecutor(max_workers=1) as requests:
                    pending = requests.submit(client.post, "/api/resources/read", json=request)
                    assert marker_read.wait(timeout=10), "API did not reach the publication-marker barrier"
                    with psycopg.connect(scoped_publish) as publisher:
                        with publisher.transaction():
                            publisher.execute("UPDATE series_descriptor SET descriptor_version='descriptor-v2' WHERE indicator_id='snapshot_annual'")
                            publisher.execute("UPDATE source_vintage SET version='2026-02' WHERE source_id='snapshot_fixture' AND vintage_id='v1'")
                            publisher.execute("UPDATE ordered_series SET value=9 WHERE indicator_id='snapshot_annual' AND territory_id='59791' AND axis_value='2024'")
                            publisher.execute("UPDATE table_publication SET content_version='series-snapshot-v2',row_count=3 WHERE table_name='ordered_series'")
                    continue_read.set()
                    response = pending.result(timeout=20)
                assert response.status_code == 200, response.text
                old = response.json()
                assert old["publication_id"] == "series-snapshot-v1"
                assert old["descriptor_version"] == "descriptor-v1"
                assert old["points"][2]["value"] == 2
                assert old["points"][2]["source_version"] == "2026-01"

                # A new request must see the next committed snapshot, proving
                # the paused response was consistently old, not stale forever.
                current = client.post("/api/resources/read", json=request)
                assert current.status_code == 200, current.text
                new = current.json()
                assert new["publication_id"] == "series-snapshot-v2"
                assert new["descriptor_version"] == "descriptor-v2"
                assert new["points"][2]["value"] == 9
                assert new["points"][2]["source_version"] == "2026-02"
        finally:
            continue_read.set()
            if previous is None:
                main.app.dependency_overrides.pop(main.get_repository, None)
            else:
                main.app.dependency_overrides[main.get_repository] = previous
            if previous_catalogue is None:
                main.app.dependency_overrides.pop(main.get_resource_catalogue, None)
            else:
                main.app.dependency_overrides[main.get_resource_catalogue] = previous_catalogue
            pool.close()
    finally:
        if os.environ.get("LUSK_TEST_ALLOW_SCHEMA_CLEANUP") == "1":
            with psycopg.connect(publish_dsn, autocommit=True) as connection:
                connection.execute(f'DROP SCHEMA "{schema}" CASCADE')


def test_shared_scalar_additive_migration_rehearsal(db_env):
    """Rehearse migration 004 in an isolated schema with the pre-594 catalog."""
    import psycopg

    schema = "it_" + uuid.uuid4().hex[:20]
    scoped = _dsn_with_schema(db_env["publish_dsn"], schema)
    api_root = Path(__file__).resolve().parents[2]
    with psycopg.connect(db_env["publish_dsn"], autocommit=True) as connection:
        connection.execute(f'CREATE SCHEMA "{schema}"')
    try:
        with psycopg.connect(scoped, autocommit=True) as connection:
            # Model the pre-594 catalog directly. Do not start from today's
            # fresh-install schema and reverse-engineer extensions: later
            # profile/scalar FKs would make that teardown depend on new objects.
            connection.execute("""
                CREATE TABLE table_publication (
                    table_name text PRIMARY KEY CHECK (table_name IN (
                        'territory_reference','service_registry','essential_service_access',
                        'building_ramp','building_grid')),
                    content_version text NOT NULL,
                    row_count integer NOT NULL CHECK (row_count >= 0),
                    published_at timestamptz NOT NULL DEFAULT now()
                );
                CREATE TABLE territory_reference (
                    territory_id text PRIMARY KEY,
                    territory_type text NOT NULL,
                    name text NOT NULL,
                    department_id text,
                    epci_id text,
                    density_class_code text,
                    density_class_label text
                );
            """)
            connection.execute((api_root / "migrations/004_shared_scalar.sql").read_text(encoding="utf-8"))
            connection.execute((api_root / "migrations/012_scalar_theme_identity.sql").read_text(encoding="utf-8"))
            names = {row[0] for row in connection.execute("SELECT tablename FROM pg_tables WHERE schemaname=current_schema()").fetchall()}
            assert {"scalar_descriptor", "scalar_descriptor_source", "scalar_observation", "scalar_observation_source"} <= names
            assert connection.execute("SELECT count(*) FROM territory_reference").fetchone()[0] == 0
            connection.execute("INSERT INTO territory_reference(territory_id,territory_type,name) VALUES ('fixture-01','commune','Fixture')")
            connection.execute("INSERT INTO source_dataset(source_id,name) VALUES ('fixture_source','Fixture source')")
            connection.execute("INSERT INTO source_vintage(source_id,vintage_id,version) VALUES ('fixture_source','v2026','2026')")
            with connection.transaction():
                connection.execute("INSERT INTO scalar_descriptor(indicator_id,theme_id,label,unit,direction,comparison_facet,allowed_levels,denominator_semantics,completeness,descriptor_version) VALUES ('fixture_scalar','demographie','Fixture scalar','count','high',NULL,ARRAY['commune'],'fixture count','sparse','fixture-descriptor-v1')")
                connection.execute("INSERT INTO scalar_descriptor_source VALUES ('fixture_scalar','fixture_source')")
            with connection.transaction():
                connection.execute("INSERT INTO scalar_observation(indicator_id,territory_id,territory_type,value,status) VALUES ('fixture_scalar','fixture-01','commune',3.5,'measured')")
                connection.execute("INSERT INTO scalar_observation_source VALUES ('fixture_scalar','fixture-01','fixture_source','v2026')")
            connection.execute("INSERT INTO table_publication(table_name,content_version,row_count) VALUES ('territory_reference','migrated-reference-v1',1)")
            connection.execute("INSERT INTO table_publication(table_name,content_version,row_count,reference_content_version) VALUES ('scalar_observation','migrated-scalar-v1',1,'migrated-reference-v1')")
            role = urlsplit(db_env["read_dsn"]).username
            assert role and re.fullmatch(r"[A-Za-z0-9_$-]+", role)
            quoted_role = '"' + role.replace('"', '""') + '"'
            connection.execute(f'GRANT USAGE ON SCHEMA "{schema}" TO {quoted_role}')
            connection.execute(f'GRANT SELECT ON ALL TABLES IN SCHEMA "{schema}" TO {quoted_role}')

        from fastapi.testclient import TestClient
        from psycopg_pool import ConnectionPool
        from api import main
        from dataclasses import replace
        from api.resource_catalogue import default_resource_catalogue
        pool = ConnectionPool(conninfo=_dsn_with_schema(db_env["read_dsn"], schema),
                              min_size=0, max_size=1, open=True,
                              kwargs={"autocommit": True})
        catalogue = default_resource_catalogue()
        fixture_resource = replace(catalogue.resources_by_id["densite"],
            resource_id="fixture_scalar", indicator_id="fixture_scalar", theme_id="demographie",
            label="Fixture scalar", unit="count", allowed_levels=("commune",),
            sources=("fixture_source",))
        test_catalogue = replace(catalogue, resources=(*catalogue.resources, fixture_resource))
        previous = main.app.dependency_overrides.get(main.get_repository)
        previous_catalogue = main.app.dependency_overrides.get(main.get_resource_catalogue)
        main.app.dependency_overrides[main.get_repository] = lambda: main.ReadRepository(pool)
        main.app.dependency_overrides[main.get_resource_catalogue] = lambda: test_catalogue
        try:
            with TestClient(main.app) as client:
                response = client.post("/api/resources/read", json={
                    "resource": "fixture_scalar",
                    "target": {"kind": "territory", "type": "commune", "id": "fixture-01"},
                    "intent": {"kind": "facts"},
                })
            assert response.status_code == 200, response.text
            assert response.json()["value"] == pytest.approx(3.5)
            assert len(response.json()["sources"]) == 1
            assert response.json()["content_version"] == "migrated-scalar-v1"
        finally:
            if previous is None:
                main.app.dependency_overrides.pop(main.get_repository, None)
            else:
                main.app.dependency_overrides[main.get_repository] = previous
            if previous_catalogue is None:
                main.app.dependency_overrides.pop(main.get_resource_catalogue, None)
            else:
                main.app.dependency_overrides[main.get_resource_catalogue] = previous_catalogue
            pool.close()
    finally:
        if os.environ.get("LUSK_TEST_ALLOW_SCHEMA_CLEANUP") == "1":
            with psycopg.connect(db_env["publish_dsn"], autocommit=True) as connection:
                connection.execute(f'DROP SCHEMA "{schema}" CASCADE')


def test_profile_and_series_migration_chain_matches_fresh_schema():
    """Rehearse existing-schema 004→006→007 and compare fresh marker contracts."""
    import psycopg

    publish_dsn, _ = _configuration()
    api_root = Path(__file__).resolve().parents[2]
    profile_migration = api_root / "migrations/006_declared_profile.sql"
    if not profile_migration.exists():
        pytest.skip("migration 006 is supplied by the #596 branch; fetch its SQL before combined rehearsal")
    schema, fresh_schema = ("it_" + uuid.uuid4().hex[:20] for _ in range(2))
    fresh_dsn = _dsn_with_schema(publish_dsn, fresh_schema)
    chain_dsn = _dsn_with_schema(publish_dsn, schema)
    with psycopg.connect(publish_dsn, autocommit=True) as connection:
        connection.execute(f'CREATE SCHEMA "{schema}"')
        connection.execute(f'CREATE SCHEMA "{fresh_schema}"')
    try:
        with psycopg.connect(fresh_dsn, autocommit=True) as fresh:
            fresh.execute((api_root / "schema.sql").read_text(encoding="utf-8"))

        with psycopg.connect(chain_dsn, autocommit=True) as chain:
            # Model the pre-594 publication/reference catalog directly. Do not
            # reverse-engineer it from today's fresh schema: later profile and
            # scalar foreign keys make that teardown depend on downstream DDL.
            chain.execute("""
                CREATE TABLE table_publication (
                    table_name text PRIMARY KEY CHECK (table_name IN (
                        'territory_reference','service_registry','essential_service_access',
                        'building_ramp','building_grid')),
                    content_version text NOT NULL,
                    row_count integer NOT NULL CHECK (row_count >= 0),
                    published_at timestamptz NOT NULL DEFAULT now()
                );
                CREATE TABLE territory_reference (
                    territory_id text PRIMARY KEY,
                    territory_type text NOT NULL,
                    name text NOT NULL,
                    department_id text,
                    epci_id text,
                    density_class_code text,
                    density_class_label text
                );
            """)
            chain.execute((api_root / "migrations/004_shared_scalar.sql").read_text(encoding="utf-8"))
            chain.execute(profile_migration.read_text(encoding="utf-8"))
            chain.execute((api_root / "migrations/007_ordered_series.sql").read_text(encoding="utf-8"))
            chain.execute((api_root / "migrations/020_demographic_typed_reading.sql").read_text(encoding="utf-8"))

            # Both publication markers must reference the same committed territory snapshot.
            chain.execute("INSERT INTO territory_reference(territory_id,territory_type,name) VALUES ('reconcile','commune','Reconcile')")
            chain.execute("INSERT INTO table_publication(table_name,content_version,row_count) VALUES ('territory_reference','territory-v1',1)")
            chain.execute("INSERT INTO table_publication(table_name,content_version,row_count,reference_content_version) VALUES ('declared_profile','profile-v1',1,'territory-v1'),('ordered_series','series-v1',1,'territory-v1')")
            for marker in ("declared_profile", "ordered_series"):
                with pytest.raises(psycopg.errors.CheckViolation):
                    with chain.transaction():
                        chain.execute("UPDATE table_publication SET reference_content_version=NULL WHERE table_name=%s", (marker,))

            def marker_contract(connection):
                return connection.execute("""SELECT c.conname, pg_get_constraintdef(c.oid)
                    FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
                    JOIN pg_namespace n ON n.oid=t.relnamespace
                    WHERE n.nspname=current_schema() AND t.relname='table_publication' AND c.contype='c'
                    ORDER BY c.conname""").fetchall()

            # Different equivalent CHECK partitioning is acceptable; assert
            # both marker values and reference semantics in actual DDL behavior.
            with psycopg.connect(fresh_dsn, autocommit=True) as fresh:
                # This deliberately rehearses only the legacy 004/006/007
                # chain. Fresh installs include newer additive markers; retain
                # the independently-tested legacy marker constraints here.
                fresh_contract = dict(marker_contract(fresh))
                chain_contract = dict(marker_contract(chain))
                assert all(name in fresh_contract for name in chain_contract)
                assert "declared_profile" in fresh_contract["table_publication_table_name_check"]
                assert "ordered_series" in fresh_contract["table_publication_table_name_check"]
            marker_constraint_names = {name for name, _definition in marker_contract(chain)}
            assert "shared_fact_publication_requires_reference" in marker_constraint_names
            marker_names = {row[0] for row in chain.execute(
                "SELECT table_name FROM table_publication WHERE table_name IN ('declared_profile','ordered_series')").fetchall()}
            assert marker_names == {"declared_profile", "ordered_series"}
            with psycopg.connect(fresh_dsn, autocommit=True) as fresh:
                fresh.execute("INSERT INTO table_publication(table_name,content_version,row_count,reference_content_version) VALUES ('declared_profile','profile-v1',1,'territory-v1'),('ordered_series','series-v1',1,'territory-v1')")
                fresh_markers = dict(fresh.execute("SELECT table_name,reference_content_version FROM table_publication WHERE table_name IN ('declared_profile','ordered_series')").fetchall())
                assert fresh_markers == {"declared_profile": "territory-v1", "ordered_series": "territory-v1"}
            with pytest.raises(psycopg.errors.CheckViolation):
                with chain.transaction():
                    chain.execute("INSERT INTO table_publication(table_name,content_version,row_count) VALUES ('unregistered_marker','x',1)")
    finally:
        if os.environ.get("LUSK_TEST_ALLOW_SCHEMA_CLEANUP") == "1":
            with psycopg.connect(publish_dsn, autocommit=True) as connection:
                connection.execute(f'DROP SCHEMA "{schema}" CASCADE')
                connection.execute(f'DROP SCHEMA "{fresh_schema}" CASCADE')
