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


def test_shared_scalar_schema_constraints_and_bounded_read(db_env):
    import psycopg
    from fastapi.testclient import TestClient
    from psycopg_pool import ConnectionPool
    from api import main

    with psycopg.connect(db_env["publish_dsn"], autocommit=True) as connection:
        connection.execute("INSERT INTO territory_reference(territory_id,territory_type,name) VALUES ('29001','commune','Alpha')")
        connection.execute("INSERT INTO territory_reference(territory_id,territory_type,name) VALUES ('29002','commune','Beta')")
        connection.execute("INSERT INTO source_dataset(source_id,name) VALUES ('fixture','Fixture source')")
        connection.execute("INSERT INTO source_vintage(source_id,vintage_id,version) VALUES ('fixture','v2026','2026')")
        connection.execute("INSERT INTO source_dataset(source_id,name) VALUES ('fixture_secondary','Secondary source')")
        connection.execute("INSERT INTO source_vintage(source_id,vintage_id,version) VALUES ('fixture_secondary','v2025','2025')")
        with connection.transaction():
            connection.execute("INSERT INTO scalar_descriptor(indicator_id,label,unit,direction,comparison_facet,allowed_levels,denominator_semantics,completeness,descriptor_version) VALUES ('fixture_scalar','Fixture scalar','count','high',NULL,ARRAY['commune'],'buildings','sparse','d1')")
            connection.execute("INSERT INTO scalar_descriptor_source VALUES ('fixture_scalar','fixture'),('fixture_scalar','fixture_secondary')")
        with connection.transaction():
            connection.execute("INSERT INTO scalar_observation(indicator_id,territory_id,territory_type,value,status,support_count,denominator_count) VALUES ('fixture_scalar','29001','commune',0,'measured',0,0)")
            connection.execute("INSERT INTO scalar_observation_source VALUES ('fixture_scalar','29001','fixture','v2026')")
            connection.execute("INSERT INTO scalar_observation_source VALUES ('fixture_scalar','29001','fixture_secondary','v2025')")
        with pytest.raises(psycopg.errors.ForeignKeyViolation):
            with connection.transaction():
                connection.execute("DELETE FROM scalar_descriptor_source WHERE indicator_id='fixture_scalar' AND source_id='fixture'")
        with connection.transaction():
            connection.execute("INSERT INTO scalar_descriptor(indicator_id,label,unit,direction,comparison_facet,allowed_levels,denominator_semantics,completeness,descriptor_version) VALUES ('unreferenced_fixture','Unreferenced fixture','count','high',NULL,ARRAY['commune'],'buildings','sparse','d1')")
            connection.execute("INSERT INTO scalar_descriptor_source VALUES ('unreferenced_fixture','fixture'),('unreferenced_fixture','fixture_secondary')")
        # A non-last source can be removed without involving the observed
        # fixture's provenance; the remaining declared source keeps the
        # descriptor invariant satisfied.
        connection.execute("DELETE FROM scalar_descriptor_source WHERE indicator_id='unreferenced_fixture' AND source_id='fixture_secondary'")
        with pytest.raises(psycopg.errors.RaiseException, match="descriptor must declare at least one source dataset"):
            with connection.transaction():
                connection.execute("DELETE FROM scalar_descriptor_source WHERE indicator_id='unreferenced_fixture' AND source_id='fixture'")
        with connection.transaction():
            connection.execute("INSERT INTO scalar_descriptor(indicator_id,label,unit,direction,comparison_facet,allowed_levels,denominator_semantics,completeness,descriptor_version) VALUES ('cascade_fixture','Cascade fixture','count','high',NULL,ARRAY['commune'],'buildings','sparse','d1')")
            connection.execute("INSERT INTO scalar_descriptor_source VALUES ('cascade_fixture','fixture')")
        connection.execute("DELETE FROM scalar_descriptor WHERE indicator_id='cascade_fixture'")
        connection.execute("INSERT INTO table_publication(table_name,content_version,row_count) VALUES ('territory_reference','territory-v1',2)")
        connection.execute("INSERT INTO table_publication(table_name,content_version,row_count,reference_content_version) VALUES ('scalar_observation','fixture-v1',1,'territory-v1')")
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
        with psycopg.connect(db_env["read_dsn"], autocommit=True) as reader:
            reader.execute("INSERT INTO scalar_observation(indicator_id,territory_id,territory_type,value,status) VALUES ('fixture_scalar','29001','commune',1,'measured')")

    pool = ConnectionPool(conninfo=db_env["read_dsn"], min_size=0, max_size=2, open=True,
                          kwargs={"autocommit": True})
    previous = main.app.dependency_overrides.get(main.get_repository)
    main.app.dependency_overrides[main.get_repository] = lambda: main.ReadRepository(pool)
    try:
        with TestClient(main.app) as client:
            response = client.get("/api/territories/commune/29001/indicators/fixture_scalar")
            unavailable = client.get("/api/territories/epci/29001/indicators/fixture_scalar")
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["value"] == 0
        assert body["status"] == "measured"
        assert body["content_version"] == "fixture-v1"
        assert "source_id" not in body and "source_name" not in body
        assert [source["version"] for source in body["sources"]] == ["2026", "2025"]
        assert unavailable.status_code == 404
        absent_fact = client.get("/api/territories/commune/29002/indicators/fixture_scalar")
        assert absent_fact.status_code == 404
        with psycopg.connect(db_env["publish_dsn"], autocommit=True) as publisher:
            publisher.execute("UPDATE table_publication SET content_version='territory-v2' WHERE table_name='territory_reference'")
        not_rebound = client.get("/api/territories/commune/29001/indicators/fixture_scalar")
        assert not_rebound.status_code == 503
        with psycopg.connect(db_env["publish_dsn"], autocommit=True) as publisher:
            publisher.execute("UPDATE table_publication SET reference_content_version='territory-v2' WHERE table_name='scalar_observation'")
            scalar_marker = publisher.execute("SELECT content_version FROM table_publication WHERE table_name='scalar_observation'").fetchone()[0]
            assert scalar_marker == "fixture-v1"  # dependency rebind is not a scalar-content version change
        compatible_rebind = client.get("/api/territories/commune/29001/indicators/fixture_scalar")
        assert compatible_rebind.status_code == 200
        with psycopg.connect(db_env["publish_dsn"], autocommit=True) as publisher:
            publisher.execute("DELETE FROM territory_reference WHERE territory_id='29002'")
            publisher.execute("INSERT INTO territory_reference(territory_id,territory_type,name) VALUES ('29003','commune','Gamma')")
            publisher.execute("UPDATE table_publication SET content_version='territory-v3' WHERE table_name='territory_reference'")
        incompatible_reference = client.get("/api/territories/commune/29001/indicators/fixture_scalar")
        assert incompatible_reference.status_code == 503
        with psycopg.connect(db_env["publish_dsn"], autocommit=True) as publisher:
            publisher.execute("UPDATE table_publication SET reference_content_version='territory-v3',row_count=9 WHERE table_name='scalar_observation'")
        # row_count is publication metadata, not a reason to scan the full
        # observation/reference tables on this point read.
        tampered_count = client.get("/api/territories/commune/29001/indicators/fixture_scalar")
        assert tampered_count.status_code == 200
        with psycopg.connect(db_env["publish_dsn"], autocommit=True) as publisher:
            publisher.execute("UPDATE table_publication SET reference_content_version='obsolete' WHERE table_name='scalar_observation'")
        stale = client.get("/api/territories/commune/29001/indicators/fixture_scalar")
        assert stale.status_code == 503
        with psycopg.connect(db_env["publish_dsn"], autocommit=True) as publisher:
            publisher.execute("DELETE FROM table_publication WHERE table_name='territory_reference'")
        missing_reference = client.get("/api/territories/commune/29001/indicators/fixture_scalar")
        assert missing_reference.status_code == 503
        with psycopg.connect(db_env["publish_dsn"], autocommit=True) as publisher:
            publisher.execute("INSERT INTO table_publication(table_name,content_version,row_count) VALUES ('territory_reference','territory-v3',2)")
        with psycopg.connect(db_env["publish_dsn"], autocommit=True) as publisher:
            publisher.execute("DELETE FROM table_publication WHERE table_name='scalar_observation'")
        missing = client.get("/api/territories/commune/29001/indicators/fixture_scalar")
        assert missing.status_code == 503
    finally:
        if previous is None:
            main.app.dependency_overrides.pop(main.get_repository, None)
        else:
            main.app.dependency_overrides[main.get_repository] = previous
        pool.close()


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
            connection.execute((api_root / "schema.sql").read_text(encoding="utf-8"))
            # Restore the known pre-594 catalog shape while keeping the actual
            # existing serving tables and marker untouched.
            connection.execute("DROP TRIGGER scalar_observation_source_required ON scalar_observation")
            connection.execute("DROP TRIGGER scalar_observation_source_not_empty ON scalar_observation_source")
            connection.execute("DROP TRIGGER scalar_descriptor_requires_sources ON scalar_descriptor")
            connection.execute("DROP TRIGGER scalar_descriptor_source_set_not_empty ON scalar_descriptor_source")
            connection.execute("DROP TRIGGER scalar_territory_compatibility ON territory_reference")
            connection.execute("DROP TRIGGER scalar_descriptor_compatibility ON scalar_descriptor")
            connection.execute("DROP TRIGGER scalar_observation_levels ON scalar_observation")
            connection.execute("DROP TABLE scalar_observation_source, scalar_observation, scalar_descriptor_source, scalar_descriptor, source_vintage, source_dataset")
            connection.execute("DROP FUNCTION assert_scalar_observation_has_source(), assert_scalar_descriptor_sources(), assert_scalar_territory_update(), assert_scalar_descriptor_update(), assert_scalar_levels()")
            connection.execute("ALTER TABLE table_publication DROP CONSTRAINT table_publication_table_name_check")
            connection.execute("ALTER TABLE table_publication DROP CONSTRAINT scalar_publication_requires_reference")
            connection.execute("ALTER TABLE table_publication DROP COLUMN reference_content_version")
            connection.execute("ALTER TABLE table_publication ADD CONSTRAINT table_publication_table_name_check CHECK (table_name IN ('territory_reference','service_registry','essential_service_access','building_ramp','building_grid'))")
            connection.execute((api_root / "migrations/004_shared_scalar.sql").read_text(encoding="utf-8"))
            names = {row[0] for row in connection.execute("SELECT tablename FROM pg_tables WHERE schemaname=current_schema()").fetchall()}
            assert {"scalar_descriptor", "scalar_descriptor_source", "scalar_observation", "scalar_observation_source"} <= names
            assert connection.execute("SELECT count(*) FROM territory_reference").fetchone()[0] == 0
            connection.execute("INSERT INTO territory_reference(territory_id,territory_type,name) VALUES ('fixture-01','commune','Fixture')")
            connection.execute("INSERT INTO source_dataset(source_id,name) VALUES ('fixture_source','Fixture source')")
            connection.execute("INSERT INTO source_vintage(source_id,vintage_id,version) VALUES ('fixture_source','v2026','2026')")
            with connection.transaction():
                connection.execute("INSERT INTO scalar_descriptor(indicator_id,label,unit,direction,comparison_facet,allowed_levels,denominator_semantics,completeness,descriptor_version) VALUES ('fixture_scalar','Fixture scalar','count','high',NULL,ARRAY['commune'],'fixture count','sparse','fixture-descriptor-v1')")
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
        pool = ConnectionPool(conninfo=_dsn_with_schema(db_env["read_dsn"], schema),
                              min_size=0, max_size=1, open=True,
                              kwargs={"autocommit": True})
        previous = main.app.dependency_overrides.get(main.get_repository)
        main.app.dependency_overrides[main.get_repository] = lambda: main.ReadRepository(pool)
        try:
            with TestClient(main.app) as client:
                response = client.get("/api/territories/commune/fixture-01/indicators/fixture_scalar")
            assert response.status_code == 200, response.text
            assert response.json()["value"] == pytest.approx(3.5)
            assert len(response.json()["sources"]) == 1
            assert response.json()["content_version"] == "migrated-scalar-v1"
        finally:
            if previous is None:
                main.app.dependency_overrides.pop(main.get_repository, None)
            else:
                main.app.dependency_overrides[main.get_repository] = previous
            pool.close()
    finally:
        if os.environ.get("LUSK_TEST_ALLOW_SCHEMA_CLEANUP") == "1":
            with psycopg.connect(db_env["publish_dsn"], autocommit=True) as connection:
                connection.execute(f'DROP SCHEMA "{schema}" CASCADE')


def test_database_rejects_missing_service_group(db_env):
    import psycopg

    schema = "it_" + uuid.uuid4().hex[:20]
    scoped = _dsn_with_schema(db_env["publish_dsn"], schema)
    schema_path = Path(__file__).resolve().parents[2] / "schema.sql"
    created = False
    try:
        with psycopg.connect(db_env["publish_dsn"], autocommit=True) as connection:
            connection.execute(f'CREATE SCHEMA "{schema}"')
            created = True
        with psycopg.connect(scoped, autocommit=True) as connection:
            connection.execute(schema_path.read_text(encoding="utf-8"), prepare=False)
            connection.execute("INSERT INTO territory_reference(territory_id,territory_type,name) VALUES ('fixture-29003','commune','Gamma')")
            connection.execute("INSERT INTO service_registry(service) VALUES ('school')")
            connection.execute("""INSERT INTO essential_service_access
                (territory_id,service,mode,share,indicator_label,effective_direction,
                 source_id,source_name,source_version)
                VALUES ('fixture-29003','school','walk_transit',0.2,'School access','high','fixture','Fixture source','2026-01'),
                       ('fixture-29003','school','bike',0.5,'School access','high','fixture','Fixture source','2026-01'),
                       ('fixture-29003','school','car',0.8,'School access','low','fixture','Fixture source','2026-01')""")
            connection.execute("SELECT assert_current_dataset_complete(3)")
            with pytest.raises(psycopg.errors.RaiseException, match="incomplete essential-service dataset"):
                with connection.transaction():
                    connection.execute("DELETE FROM essential_service_access WHERE territory_id = 'fixture-29003'")
                    connection.execute("SELECT assert_current_dataset_complete(0)")
            assert connection.execute("SELECT count(*) FROM essential_service_access WHERE territory_id = 'fixture-29003'").fetchone()[0] == 3
            assert {row[0] for row in connection.execute(
                "SELECT mode FROM essential_service_access WHERE territory_id = 'fixture-29003'").fetchall()} == {
                    "walk_transit", "bike", "car",
                }
    finally:
        if created and os.environ.get("LUSK_TEST_ALLOW_SCHEMA_CLEANUP") == "1":
            with psycopg.connect(db_env["publish_dsn"], autocommit=True) as connection:
                connection.execute(f'DROP SCHEMA "{schema}" CASCADE')


def test_migration_009_rehearses_guarded_retirement_in_owned_random_schema():
    """Run the actual script only in the explicitly named disposable contract DB."""
    configured = os.environ.get("LUSK_TEST_PUBLISH_DSN")
    read_dsn = os.environ.get("LUSK_TEST_READ_DSN")
    if not configured or not read_dsn:
        pytest.skip("requires explicit publish/read disposable PostgreSQL DSNs")
    parts = urlsplit(configured)
    if parts.path.lstrip("/") != "lusk_it_contract":
        pytest.skip("migration 009 rehearsal is restricted to lusk_it_contract")
    read_parts = urlsplit(read_dsn)
    if (read_parts.path.lstrip("/") != "lusk_it_contract"
            or parts.hostname != read_parts.hostname or parts.port != read_parts.port
            or parts.username == read_parts.username):
        pytest.fail("migration rehearsal requires distinct publisher/reader roles on the same lusk_it_contract server")
    psycopg = pytest.importorskip("psycopg")
    migration = (Path(__file__).resolve().parents[2] / "migrations" /
                 "009_retire_dataset_publication.sql").read_text(encoding="utf-8")
    schema = "it_" + uuid.uuid4().hex[:20]
    reader_dsn = _dsn_with_schema(read_dsn, schema)

    def seed(connection, *, extra_column=False, dependent=False):
        columns = "dataset_key text PRIMARY KEY, publication_id text NOT NULL, row_count integer NOT NULL, bretagne_kind text NOT NULL, bretagne_label text NOT NULL, imported_at timestamptz NOT NULL"
        if extra_column:
            columns += ", unexpected text"
        connection.execute(f"CREATE TABLE dataset_publication ({columns})")
        connection.execute("INSERT INTO dataset_publication VALUES ('legacy','old',1,'kind','label',now()" + (",'unknown'" if extra_column else "") + ")")
        connection.execute("CREATE TABLE table_publication (table_name text PRIMARY KEY, content_version text NOT NULL)")
        connection.execute("INSERT INTO table_publication VALUES ('territory_reference','active-v1')")
        connection.execute("CREATE TABLE territory_reference (territory_id text PRIMARY KEY)")
        connection.execute("INSERT INTO territory_reference VALUES ('fixture')")
        if dependent:
            connection.execute("CREATE TABLE legacy_dependent (dataset_key text REFERENCES dataset_publication(dataset_key))")
            connection.execute("INSERT INTO legacy_dependent VALUES ('legacy')")

    def run(connection):
        connection.execute("SELECT set_config('lusk.migration_009_rehearsal_schema', %s, false)", (schema,))
        try:
            connection.execute(migration, prepare=False)
        except Exception:
            connection.execute("ROLLBACK")
            raise

    with psycopg.connect(configured, autocommit=True) as connection:
        connection.execute(f'CREATE SCHEMA "{schema}" AUTHORIZATION CURRENT_USER')
        try:
            connection.execute(f'SET search_path TO "{schema}"')
            read_role = urlsplit(read_dsn).username
            if not read_role or not re.fullmatch(r"[A-Za-z0-9_$-]+", read_role):
                pytest.fail("Read DSN must identify a simple PostgreSQL role name")
            connection.execute(f'GRANT USAGE ON SCHEMA "{schema}" TO "{read_role}"')
            seed(connection, extra_column=True)
            with pytest.raises(psycopg.errors.RaiseException, match="unexpected dataset_publication columns"):
                run(connection)
            assert connection.execute("SELECT publication_id FROM dataset_publication").fetchone()[0] == "old"
            connection.execute("DROP TABLE dataset_publication, table_publication, territory_reference")

            seed(connection, dependent=True)
            connection.execute(f'GRANT SELECT ON table_publication, territory_reference TO "{read_role}"')
            with pytest.raises(psycopg.errors.DependentObjectsStillExist):
                run(connection)
            assert connection.execute("SELECT publication_id FROM dataset_publication").fetchone()[0] == "old"
            assert connection.execute("SELECT content_version FROM table_publication").fetchone()[0] == "active-v1"
            assert connection.execute("SELECT territory_id FROM territory_reference").fetchone()[0] == "fixture"
            with psycopg.connect(reader_dsn, autocommit=True) as reader:
                assert reader.execute("SELECT content_version FROM table_publication").fetchone()[0] == "active-v1"
                with pytest.raises(psycopg.errors.InsufficientPrivilege):
                    reader.execute("UPDATE table_publication SET content_version='forbidden'")
            connection.execute("DROP TABLE legacy_dependent")

            run(connection)
            assert connection.execute("SELECT to_regclass('dataset_publication')").fetchone()[0] is None
            assert connection.execute("SELECT content_version FROM table_publication").fetchone()[0] == "active-v1"
            assert connection.execute("SELECT territory_id FROM territory_reference").fetchone()[0] == "fixture"
            with pytest.raises(psycopg.errors.RaiseException, match="expected .*dataset_publication"):
                run(connection)
        finally:
            connection.execute("RESET search_path")
            connection.execute(f'DROP SCHEMA "{schema}" CASCADE')
