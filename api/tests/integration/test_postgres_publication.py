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
    assert published.changed is True
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


def test_reader_role_cannot_insert_or_create(db_env):
    import psycopg
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        with psycopg.connect(db_env["read_dsn"], autocommit=True) as connection:
            connection.execute("INSERT INTO dataset_publication(dataset_key,publication_id,row_count,bretagne_kind,bretagne_label) VALUES ('forbidden','x',1,'x','x')")
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        with psycopg.connect(db_env["read_dsn"], autocommit=True) as connection:
            connection.execute("CREATE TABLE forbidden_reader_write (id integer)")
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        with psycopg.connect(db_env["read_dsn"], autocommit=True) as connection:
            connection.execute("CREATE SCHEMA forbidden_reader_schema")


def test_scalar_services_database_reader_matches_legacy_for_level_and_scope_matrix(db_env, monkeypatch):
    """Exercise both SQL readers against the same disposable PostgreSQL snapshot.

    The deliberately small fixture has all fifteen public indicators, ties,
    unavailable values, multiple peer scopes, and a singleton regional scope.
    The fast API tests cover exact comparison statistics; this verifies that
    the actual scalar joins/status mapping feed that same comparison contract.
    """
    import psycopg
    from fastapi.testclient import TestClient
    from psycopg_pool import ConnectionPool
    from api import main

    territories = [
        ("29001", "Alpha", "commune", "29", "200000001", "D1", "Dense"),
        ("29002", "Beta", "commune", "29", "200000001", "D1", "Dense"),
        ("29003", "Gamma", "commune", "29", "200000002", "D2", "Rural"),
        ("29004", "Delta", "commune", "29", "200000002", "D2", "Rural"),
        ("200000001", "EPCI One", "epci", "29", None, None, None),
        ("200000002", "EPCI Two", "epci", "29", None, None, None),
        ("29", "Department", "departement", "29", None, None, None),
        ("BRE", "Brittany", "region", None, None, None, None),
    ]
    services = ("food", "health", "admin", "school", "bank")
    mode_codes = {"t": "walk_transit", "b": "bike", "c": "car"}
    levels = {"commune": ["29001", "29002", "29003", "29004"],
              "epci": ["200000001", "200000002"],
              "departement": ["29"], "region": ["BRE"]}
    with psycopg.connect(db_env["publish_dsn"]) as connection:
        def executemany(query, rows):
            with connection.cursor() as cur:
                cur.executemany(query, rows)

        executemany(
            "INSERT INTO territory_reference(territory_id,name,territory_type,department_id,epci_id,density_class_code,density_class_label) VALUES (%s,%s,%s,%s,%s,%s,%s)",
            territories)
        executemany("INSERT INTO service_registry(service) VALUES (%s)", [(s,) for s in services])
        connection.execute("INSERT INTO access_publication_metadata(singleton,bretagne_kind,bretagne_label) VALUES (true,'communes-bretagne','communes bretonnes')")
        connection.execute("INSERT INTO table_publication(table_name,content_version,row_count) VALUES ('territory_reference','ref-fixture-v1',8),('essential_service_access','legacy-fixture-v1',0)")
        connection.execute("INSERT INTO source_dataset(source_id,name) VALUES ('fixture','Fixture source')")
        connection.execute("INSERT INTO source_vintage(source_id,vintage_id,version,reference_date,publication_date) VALUES ('fixture','v2026','2026','2025-01-01','2026-02-01')")
        descriptors = []
        legacy_rows = []
        scalar_rows = []
        source_rows = []
        for service_index, service in enumerate(services):
            for mode_index, (mode_code, mode) in enumerate(mode_codes.items()):
                indicator = f"share_{service}_{mode_code}"
                direction = "low" if service == "food" and mode_code == "c" else "high"
                descriptors.append((indicator, f"{service} {mode}", "%", direction,
                    indicator, ["commune", "epci", "departement", "region"],
                    "fixture service access share", "dense_complete", "desc-v1"))
                for territory_type, ids in levels.items():
                    for index, territory_id in enumerate(ids):
                        # Produce equal values for rank ties, a direction-low
                        # case, and one explicit unavailable commune fact.
                        value = round(.2 + ((index + service_index + mode_index) % 3) * .1, 2)
                        missing = territory_id == "29004" and service == "school" and mode_code == "b"
                        share = None if missing else value
                        legacy_rows.append((territory_id, service, mode, share,
                            f"{service} {mode}", direction, "fixture", "Fixture source",
                            "2026", "2025-01-01", "2026-02-01"))
                        scalar_rows.append((indicator, territory_id, territory_type,
                            share, "not_available" if missing else "measured"))
                        source_rows.append((indicator, territory_id, "fixture", "v2026"))
        executemany("INSERT INTO essential_service_access(territory_id,service,mode,share,indicator_label,effective_direction,source_id,source_name,source_version,reference_date,source_publication_date) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)", legacy_rows)
        connection.execute("UPDATE table_publication SET row_count=%s WHERE table_name='essential_service_access'", (len(legacy_rows),))
        executemany("INSERT INTO scalar_descriptor(indicator_id,label,unit,direction,comparison_facet,allowed_levels,denominator_semantics,completeness,descriptor_version) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)", descriptors)
        executemany("INSERT INTO scalar_descriptor_source(indicator_id,source_id) VALUES (%s,'fixture')", [(d[0],) for d in descriptors])
        executemany("INSERT INTO scalar_observation(indicator_id,territory_id,territory_type,value,status) VALUES (%s,%s,%s,%s,%s)", scalar_rows)
        executemany("INSERT INTO scalar_observation_source(indicator_id,territory_id,source_id,vintage_id) VALUES (%s,%s,%s,%s)", source_rows)
        connection.execute("INSERT INTO table_publication(table_name,content_version,row_count,reference_content_version) VALUES ('scalar_observation','scalar-fixture-v1',%s,'ref-fixture-v1')", (len(scalar_rows),))

    pool = ConnectionPool(conninfo=db_env["read_dsn"], min_size=0, max_size=2, open=True,
                          kwargs={"autocommit": True})
    previous_override = main.app.dependency_overrides.get(main.get_repository)
    main.app.dependency_overrides[main.get_repository] = lambda: main.ReadRepository(pool)
    monkeypatch.delenv("LUSK_SERVICES_SCALAR_READ", raising=False)
    try:
        with TestClient(main.app) as client:
            cases = [
                ("commune", "29001", "bretagne"),
                ("commune", "29001", "densite"),
                ("commune", "29001", "epci"),
                ("epci", "200000001", None),
                ("departement", "29", None),
                ("region", "BRE", None),
            ]
            legacy = {}
            for territory_type, code, comparison in cases:
                suffix = f"?comparison={comparison}" if comparison else ""
                path = f"/api/territories/{territory_type}/{code}/essential-services{suffix}"
                response = client.get(path)
                assert response.status_code == 200, response.text
                legacy[(territory_type, code, comparison)] = response.json()

            monkeypatch.setenv("LUSK_SERVICES_SCALAR_READ", "1")
            for territory_type, code, comparison in cases:
                suffix = f"?comparison={comparison}" if comparison else ""
                path = f"/api/territories/{territory_type}/{code}/essential-services{suffix}"
                response = client.get(path)
                assert response.status_code == 200, response.text
                scalar = response.json()
                old = legacy[(territory_type, code, comparison)]
                assert scalar["territory"] == old["territory"]
                assert scalar["scope"] == old["scope"]
                assert scalar["services"] == old["services"]
            # Region is deliberately a singleton: comparison stats are absent.
            regional = client.get("/api/territories/region/BRE/essential-services").json()
            assert regional["scope"] is None
            assert all(mode["rank"] is None and mode["median"] is None
                       for service in regional["services"] for mode in service["modes"].values())
            assert any(mode["value"] is None for service in regional["services"]
                       for mode in service["modes"].values())

            # An unavailable scalar publication must fail closed while legacy
            # rows still exist; the handler may not quietly fall back to them.
            with psycopg.connect(db_env["publish_dsn"], autocommit=True) as connection:
                connection.execute("DELETE FROM table_publication WHERE table_name='scalar_observation'")
            failed = client.get("/api/territories/commune/29001/essential-services?comparison=bretagne")
            assert failed.status_code == 503
    finally:
        if previous_override is None:
            main.app.dependency_overrides.pop(main.get_repository, None)
        else:
            main.app.dependency_overrides[main.get_repository] = previous_override
        pool.close()


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
        connection.execute("CREATE TABLE unrelated_fixture (id integer PRIMARY KEY)")
        connection.execute("INSERT INTO unrelated_fixture VALUES (42)")
        original_imported_at = connection.execute("SELECT imported_at FROM dataset_publication").fetchone()[0]
        unchanged = importer.import_publication(connection, root, metadata)
        assert unchanged.changed is False
        assert unchanged.publication_id == original.publication_id
        assert connection.execute("SELECT imported_at FROM dataset_publication").fetchone()[0] == original_imported_at
        assert connection.execute("SELECT count(*) FROM essential_service_access").fetchone()[0] == len(original.rows)
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
        assert updated.changed is True
        assert updated.publication_id != original.publication_id
        assert _current(db_env["publish_dsn"]) == updated.publication_id
        assert connection.execute("SELECT count(*) FROM essential_service_access").fetchone()[0] == len(updated.rows)
        assert connection.execute("SELECT count(*) FROM dataset_publication").fetchone()[0] == 1
        assert connection.execute(
            "SELECT share FROM essential_service_access WHERE territory_id = '29001' AND service = 'school' AND mode = 'walk_transit'"
        ).fetchone()[0] == pytest.approx(0.9)
        assert connection.execute("SELECT id FROM unrelated_fixture").fetchone()[0] == 42

    from fastapi.testclient import TestClient
    from psycopg_pool import ConnectionPool
    from api import main

    pool = ConnectionPool(conninfo=db_env["read_dsn"], min_size=0, max_size=2, open=True,
                          kwargs={"autocommit": True})
    previous_override = main.app.dependency_overrides.get(main.get_repository)
    main.app.dependency_overrides[main.get_repository] = lambda: main.ReadRepository(pool)
    try:
        with TestClient(main.app) as client:
            response = client.get("/api/territories/commune/29001/essential-services?comparison=densite")
        assert response.status_code == 200, response.text
        assert response.json()["publication_id"] == updated.publication_id
        school = next(service for service in response.json()["services"] if service["id"] == "school")
        assert school["modes"]["walk_transit"]["value"] == pytest.approx(0.9)
        assert school["modes"]["walk_transit"]["median"] == pytest.approx(0.7)
        assert school["modes"]["walk_transit"]["rank"] == {"position": 1, "size": 2}
        assert school["modes"]["walk_transit"]["source_version"] == "2026-01"
    finally:
        if previous_override is None:
            main.app.dependency_overrides.pop(main.get_repository, None)
        else:
            main.app.dependency_overrides[main.get_repository] = previous_override
        pool.close()


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
