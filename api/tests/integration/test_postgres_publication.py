"""Opt-in end-to-end checks against an explicitly disposable PostgreSQL database.

Nothing connects unless both LUSK_TEST_* DSNs and an exact disposable database
name are supplied. Each run owns a fresh schema; public is never modified.
"""

from __future__ import annotations

import json
import os
import re
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


def _dsn_with_schema(dsn: str, schema: str) -> str:
    parts = urlsplit(dsn)
    query = parse_qs(parts.query, keep_blank_values=True)
    # psycopg's libpq options set search_path for this connection only.
    query["options"] = [f"-csearch_path={schema}"]
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query, doseq=True), parts.fragment))


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


def _current(dsn: str) -> str | None:
    import psycopg
    with psycopg.connect(dsn) as connection:
        row = connection.execute(
            "SELECT publication_id FROM dataset_publication WHERE dataset_key = 'essential_service_access'"
        ).fetchone()
        return row[0] if row else None


def test_schema_import_and_public_api(db_env, monkeypatch):
    import psycopg
    from fastapi.testclient import TestClient
    from psycopg_pool import ConnectionPool
    from api import importer, main

    root, metadata = db_env["artifacts"]
    with psycopg.connect(db_env["publish_dsn"], autocommit=True) as connection:
        published = importer.import_publication(connection, root, metadata)
    assert _current(db_env["publish_dsn"]) == published.publication_id

    pool = ConnectionPool(conninfo=db_env["read_dsn"], min_size=0, max_size=2, open=True,
                          kwargs={"autocommit": True})
    previous_override = main.app.dependency_overrides.get(main.get_repository)
    main.app.dependency_overrides[main.get_repository] = lambda: main.ReadRepository(pool)
    try:
        with TestClient(main.app) as client:
            response = client.get("/api/territories/commune/29001/essential-services?comparison=densite")
            regional_response = client.get("/api/territories/commune/29001/essential-services?comparison=bretagne")
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["publication_id"] == published.publication_id
        assert body["scope"]["member_count"] == 2
        school = next(service for service in body["services"] if service["id"] == "school")
        assert school["modes"]["walk_transit"]["value"] == pytest.approx(0.2)
        assert school["modes"]["walk_transit"]["median"] == pytest.approx(0.35)
        # Higher is better: 0.5 ranks ahead of Alpha's 0.2 in this density class.
        assert school["modes"]["walk_transit"]["rank"] == {"position": 2, "size": 2}
        assert school["modes"]["car"]["direction"] == "low"
        assert school["modes"]["walk_transit"]["source_name"] == "Fixture source"
        assert regional_response.status_code == 200, regional_response.text
        assert regional_response.json()["scope"] == {
            "kind": "communes-bretagne", "label": "communes bretonnes", "member_count": 3,
        }
    finally:
        if previous_override is None:
            main.app.dependency_overrides.pop(main.get_repository, None)
        else:
            main.app.dependency_overrides[main.get_repository] = previous_override
        pool.close()


def test_reader_role_cannot_insert(db_env):
    import psycopg
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        with psycopg.connect(db_env["read_dsn"], autocommit=True) as connection:
            connection.execute("INSERT INTO dataset_publication(dataset_key,publication_id,row_count,bretagne_kind,bretagne_label) VALUES ('forbidden','x',1,'x','x')")


def test_failed_replacement_keeps_current_dataset(db_env, tmp_path):
    import psycopg
    from api import importer

    root, metadata = db_env["artifacts"]
    with psycopg.connect(db_env["publish_dsn"], autocommit=True) as connection:
        first = importer.import_publication(connection, root, metadata)
        before = _current(db_env["publish_dsn"])

        bad_root = tmp_path / "invalid"
        bad_root.mkdir()
        for source in root.iterdir():
            (bad_root / source.name).write_bytes(source.read_bytes())
        invalid_meta = tmp_path / "invalid.json"
        invalid_meta.write_text(metadata.read_text(encoding="utf-8").replace('"high"', '"sideways"'), encoding="utf-8")
        with pytest.raises(importer.ImportError):
            importer.import_publication(connection, bad_root, invalid_meta)
        assert _current(db_env["publish_dsn"]) == before == first.publication_id

        # Force a database-side constraint failure midway through a distinct valid import.
        changed_meta = tmp_path / "changed.json"
        changed_meta.write_text(metadata.read_text(encoding="utf-8").replace("School access", "Schools access"), encoding="utf-8")
        connection.execute("""CREATE FUNCTION reject_integration_rows() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN RAISE EXCEPTION 'integration constraint probe' USING ERRCODE = 'check_violation'; END $$""")
        connection.execute("CREATE TRIGGER integration_constraint_probe BEFORE INSERT ON essential_service_access FOR EACH ROW EXECUTE FUNCTION reject_integration_rows()")
        with pytest.raises(psycopg.errors.CheckViolation):
            importer.import_publication(connection, root, changed_meta)
        assert _current(db_env["publish_dsn"]) == before
        assert connection.execute("SELECT count(*) FROM essential_service_access").fetchone()[0] == len(first.rows)
        connection.execute("DROP TRIGGER integration_constraint_probe ON essential_service_access")
        connection.execute("DROP FUNCTION reject_integration_rows()")

        # A malformed row also demonstrates the serving schema's own CHECK constraint.
        with pytest.raises(psycopg.errors.CheckViolation):
            with connection.transaction():
                connection.execute("INSERT INTO essential_service_access(territory_id,service,mode,share,indicator_label,effective_direction,source_id,source_name,source_version) VALUES ('29001','school','plane',0.1,'x','high','x','x','x')")
        assert _current(db_env["publish_dsn"]) == before


def test_database_rejects_missing_service_group(db_env):
    import psycopg

    with psycopg.connect(db_env["publish_dsn"], autocommit=True) as connection:
        with pytest.raises(psycopg.errors.RaiseException, match="incomplete essential-service dataset"):
            with connection.transaction():
                connection.execute("DELETE FROM essential_service_access WHERE territory_id = '29003'")
                connection.execute("SELECT assert_current_dataset_complete(%s)",
                                   (connection.execute("SELECT count(*) FROM essential_service_access").fetchone()[0],))
        assert connection.execute("SELECT count(*) FROM essential_service_access WHERE territory_id = '29003'").fetchone()[0] == 3


def test_successful_replacement_keeps_only_current_rows(db_env, tmp_path):
    import psycopg
    import pyarrow as pa
    import pyarrow.parquet as pq
    from api import importer

    root, metadata = db_env["artifacts"]
    with psycopg.connect(db_env["publish_dsn"], autocommit=True) as connection:
        original = importer.import_publication(connection, root, metadata)
        # Even after replacement starts, a concurrent reader sees committed rows.
        with pytest.raises(RuntimeError, match="rollback probe"):
            with connection.transaction():
                connection.execute("DELETE FROM essential_service_access")
                with psycopg.connect(db_env["read_dsn"], autocommit=True) as reader:
                    assert reader.execute("SELECT count(*) FROM essential_service_access").fetchone()[0] == len(original.rows)
                    assert reader.execute("SELECT publication_id FROM dataset_publication").fetchone()[0] == original.publication_id
                raise RuntimeError("rollback probe")
        replacement_root = tmp_path / "changed"
        replacement_root.mkdir()
        for source in root.glob("*.parquet"):
            (replacement_root / source.name).write_bytes(source.read_bytes())
        facts_path = replacement_root / "indicateurs_mobilite.parquet"
        facts = pq.read_table(facts_path).to_pylist()
        next(row for row in facts if row["territoire"] == "29001" and row["key"] == "share_school_t")["value"] = 0.9
        pq.write_table(pa.Table.from_pylist(facts), facts_path)
        updated = importer.import_publication(connection, replacement_root, metadata)
        assert updated.publication_id != original.publication_id
        assert _current(db_env["publish_dsn"]) == updated.publication_id
        assert connection.execute("SELECT count(*) FROM essential_service_access").fetchone()[0] == len(updated.rows)
        assert connection.execute("SELECT count(*) FROM dataset_publication").fetchone()[0] == 1
        assert connection.execute(
            "SELECT share FROM essential_service_access WHERE territory_id = '29001' AND service = 'school' AND mode = 'walk_transit'"
        ).fetchone()[0] == pytest.approx(0.9)


@pytest.mark.parametrize("legacy_file", ["legacy_initial_schema.sql", "legacy_schema.sql"])
def test_legacy_migration_is_scoped_atomic_and_republishable(db_env, legacy_file):
    """Rehearse both known legacy layouts in disposable schemas, never public."""
    import psycopg
    from api import importer

    schema = "it_" + uuid.uuid4().hex[:20]
    legacy = _dsn_with_schema(db_env["publish_dsn"], schema)
    root = Path(__file__).resolve().parent
    api_root = root.parents[1]
    with psycopg.connect(db_env["publish_dsn"], autocommit=True) as connection:
        connection.execute(f'CREATE SCHEMA "{schema}"')
    try:
        with psycopg.connect(legacy, autocommit=True) as connection:
            connection.execute((root / legacy_file).read_text(encoding="utf-8"))
            connection.execute("CREATE TABLE unrelated_data (id integer PRIMARY KEY)")
            connection.execute("INSERT INTO unrelated_data VALUES (42)")
            connection.execute("INSERT INTO import_publication (publication_id, status) VALUES ('old', 'validated')")
            connection.execute("INSERT INTO territory_reference (publication_id, territory_id, territory_type, name) VALUES ('old','29001','commune','Old')")
            connection.execute("""INSERT INTO essential_service_access
                (publication_id, territory_id, service, mode, indicator_label, effective_direction,
                 source_id, source_name, source_version)
                VALUES ('old','29001','school','car','Old','high','old','Old','old')""")

            migration = (api_root / "migrations" / "001_replace_versioned_access.sql").read_text(encoding="utf-8")
            fresh = (api_root / "schema.sql").read_text(encoding="utf-8")
            if legacy_file == "legacy_initial_schema.sql":
                connection.execute("CREATE TABLE publication_service_registry (service text)")
                with pytest.raises(psycopg.errors.RaiseException, match="unexpected partial legacy access schema"):
                    with connection.transaction():
                        connection.execute(migration)
                        connection.execute(fresh)
                assert connection.execute("SELECT count(*) FROM essential_service_access").fetchone()[0] == 1
                connection.execute("DROP TABLE publication_service_registry")
            # Unrelated dependent objects must abort the complete transaction,
            # rather than being silently dropped by CASCADE.
            connection.execute("CREATE TABLE unrelated_dependent (publication_id text REFERENCES import_publication)")
            with pytest.raises(psycopg.errors.DependentObjectsStillExist):
                with connection.transaction():
                    connection.execute(migration)
                    connection.execute(fresh)
            assert connection.execute("SELECT count(*) FROM essential_service_access").fetchone()[0] == 1
            connection.execute("DROP TABLE unrelated_dependent")

            with connection.transaction():
                connection.execute(migration)
                connection.execute(fresh)
            assert connection.execute("SELECT id FROM unrelated_data").fetchone()[0] == 42
            assert connection.execute("SELECT count(*) FROM essential_service_access").fetchone()[0] == 0
            artifacts, metadata = db_env["artifacts"]
            published = importer.import_publication(connection, artifacts, metadata)
            assert _current(legacy) == published.publication_id
            assert connection.execute("SELECT count(*) FROM essential_service_access").fetchone()[0] == len(published.rows)
    finally:
        if os.environ.get("LUSK_TEST_ALLOW_SCHEMA_CLEANUP") == "1":
            with psycopg.connect(db_env["publish_dsn"], autocommit=True) as connection:
                connection.execute(f'DROP SCHEMA "{schema}" CASCADE')
