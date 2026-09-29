"""Opt-in end-to-end checks against an explicitly disposable PostgreSQL database.

Nothing connects unless both LUSK_TEST_* DSNs and an exact disposable database
name are supplied. Each run owns a fresh schema; public is never modified.
"""

from __future__ import annotations

import json
import concurrent.futures
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


@pytest.fixture
def canonical_db_env():
    """A separate owned schema for comparisons sourced from tracked Parquet."""
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
                pytest.fail("Read DSN must identify a simple database role name")
            quoted_role = '"' + reader_role.replace('"', '""') + '"'
            connection.execute(f'GRANT USAGE ON SCHEMA "{schema}" TO {quoted_role}')
            connection.execute(f'GRANT SELECT ON ALL TABLES IN SCHEMA "{schema}" TO {quoted_role}')
        yield {"publish_dsn": scoped_publish, "read_dsn": scoped_read, "schema": schema}
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
                ("commune", "29004", "densite"),
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
            unavailable = client.get("/api/territories/commune/29004/essential-services?comparison=densite").json()
            school = next(service for service in unavailable["services"] if service["id"] == "school")
            assert school["modes"]["bike"]["value"] is None
            legacy_school = next(service for service in legacy[("commune", "29004", "densite")]["services"]
                                 if service["id"] == "school")
            assert legacy_school["modes"]["bike"]["value"] is None

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


def test_scalar_services_reads_match_tracked_canonical_parquet_facts(canonical_db_env, monkeypatch):
    """Compare both PostgreSQL readers to R-published, tracked canonical facts."""
    import pyarrow.parquet as pq
    import psycopg
    from fastapi.testclient import TestClient
    from psycopg_pool import ConnectionPool
    from api import main

    root = Path(__file__).resolve().parents[3]
    data = root / "public" / "data"
    metadata_path = root / "pipeline" / "inst" / "extdata" / "theme-metadata" / "theme_mobilite.json"
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    territories = pq.read_table(data / "territoires.parquet").to_pylist()
    indicator_ids = sorted(key for key in metadata["sources"] if key.startswith("share_"))
    service_ids = sorted({key.removeprefix("share_").rsplit("_", 1)[0]
                          for key in indicator_ids})
    all_rows = [row for row in pq.read_table(data / "indicateurs_mobilite.parquet").to_pylist()
                if row["theme"] == "mobilite" and row["key"] in indicator_ids]
    vintages = {row["id"]: row for row in pq.read_table(data / "vintages.parquet").to_pylist()}
    assert len(indicator_ids) == 15

    territory_by_id = {row["territoire"]: row for row in territories}
    rows_by_territory = {}
    for row in all_rows:
        if row["type"] == "commune":
            rows_by_territory.setdefault(row["territoire"], set()).add(row["key"])
    target_id = next(code for code in sorted(rows_by_territory)
                     if rows_by_territory[code] == set(indicator_ids)
                     and territory_by_id[code].get("epci"))
    target = territory_by_id[target_id]
    epci_id = target["epci"]
    member_ids = sorted(row["territoire"] for row in territories
                        if row["type"] == "commune" and row.get("epci") == epci_id
                        and rows_by_territory.get(row["territoire"]) == set(indicator_ids))
    assert target_id in member_ids and len(member_ids) > 1
    canonical_rows = [row for row in all_rows if row["type"] == "commune"
                      and row["territoire"] in member_ids]
    canonical_by_key = {(row["territoire"], row["key"]): row for row in canonical_rows}
    assert len(canonical_rows) == len(member_ids) * len(indicator_ids)

    reference_rows = [territory_by_id[code] for code in member_ids]
    epci_ref = next(row for row in territories if row["type"] == "epci" and row["territoire"] == epci_id)
    reference_rows.append(epci_ref)
    source_ids = sorted({metadata["sources"][key] for key in indicator_ids})
    vintage_rows = {source_id: vintages[source_id] for source_id in source_ids}

    with psycopg.connect(canonical_db_env["publish_dsn"]) as connection:
        with connection.cursor() as cur:
            cur.executemany(
                "INSERT INTO territory_reference(territory_id,name,territory_type,department_id,epci_id,density_class_code,density_class_label) VALUES (%s,%s,%s,%s,%s,%s,%s)",
                [(row["territoire"], row["nom"], row["type"], row.get("departement"),
                  row.get("epci"), row.get("classe_densite_code"),
                  row.get("classe_densite_libelle_public")) for row in reference_rows])
            cur.executemany("INSERT INTO service_registry(service) VALUES (%s)",
                            [(service,) for service in service_ids])
            cur.executemany("INSERT INTO source_dataset(source_id,name) VALUES (%s,%s)",
                            [(source_id, vintage_rows[source_id]["source"]) for source_id in source_ids])
            cur.executemany(
                "INSERT INTO source_vintage(source_id,vintage_id,version,reference_date,publication_date) VALUES (%s,%s,%s,%s,%s)",
                [(source_id,
                  f"{vintage_rows[source_id]['version']}/{vintage_rows[source_id]['date_reference']}",
                  vintage_rows[source_id]["version"], vintage_rows[source_id]["date_reference"],
                  vintage_rows[source_id]["date_publication"]) for source_id in source_ids])
        bretagne = metadata["comparison_scopes"]["bretagne"]
        connection.execute("INSERT INTO access_publication_metadata(singleton,bretagne_kind,bretagne_label) VALUES (true,%s,%s)",
                           (bretagne["kind"], bretagne["label"]))
        connection.execute(
            "INSERT INTO table_publication(table_name,content_version,row_count) VALUES ('territory_reference','canonical-ref-v1',%s),('essential_service_access','canonical-legacy-v1',%s)",
            (len(reference_rows), len(canonical_rows)))

        legacy_rows = []
        scalar_facts = []
        provenance = []
        descriptor_rows = []
        descriptor_sources = []
        for indicator in indicator_ids:
            source_id = metadata["sources"][indicator]
            direction = metadata["indicator_directions"][indicator]
            label = metadata["indicator_labels"][indicator]
            service, mode_code = indicator.removeprefix("share_").rsplit("_", 1)
            mode = {"t": "walk_transit", "b": "bike", "c": "car"}[mode_code]
            descriptor_rows.append((indicator, label, "%", direction, indicator, ["commune"],
                metadata["service_share_scalar"]["denominator_semantics"],
                metadata["service_share_scalar"]["completeness"], "canonical-test-v1"))
            descriptor_sources.append((indicator, source_id))
            for territory_id in member_ids:
                row = canonical_by_key[(territory_id, indicator)]
                vintage = vintage_rows[source_id]
                vintage_id = f"{row['vintage_version']}/{row['vintage_date_reference']}"
                legacy_rows.append((territory_id, service, mode, row["value"], label, direction,
                    source_id, row["vintage_source"], row["vintage_version"],
                    row["vintage_date_reference"], row["vintage_date_publication"]))
                scalar_facts.append((indicator, territory_id, "commune", row["value"],
                    "not_available" if row["value"] is None else "measured"))
                provenance.append((indicator, territory_id, source_id, vintage_id))
        with connection.cursor() as cur:
            cur.executemany(
                "INSERT INTO essential_service_access(territory_id,service,mode,share,indicator_label,effective_direction,source_id,source_name,source_version,reference_date,source_publication_date) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                legacy_rows)
            cur.executemany(
                "INSERT INTO scalar_descriptor(indicator_id,label,unit,direction,comparison_facet,allowed_levels,denominator_semantics,completeness,descriptor_version) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                descriptor_rows)
            cur.executemany("INSERT INTO scalar_descriptor_source(indicator_id,source_id) VALUES (%s,%s)",
                            descriptor_sources)
            cur.executemany(
                "INSERT INTO scalar_observation(indicator_id,territory_id,territory_type,value,status) VALUES (%s,%s,%s,%s,%s)",
                scalar_facts)
            cur.executemany(
                "INSERT INTO scalar_observation_source(indicator_id,territory_id,source_id,vintage_id) VALUES (%s,%s,%s,%s)",
                provenance)
        connection.execute(
            "INSERT INTO table_publication(table_name,content_version,row_count,reference_content_version) VALUES ('scalar_observation','canonical-scalar-v1',%s,'canonical-ref-v1')",
            (len(scalar_facts),))

    pool = ConnectionPool(conninfo=canonical_db_env["read_dsn"], min_size=0, max_size=2,
                          open=True, kwargs={"autocommit": True})
    previous_override = main.app.dependency_overrides.get(main.get_repository)
    main.app.dependency_overrides[main.get_repository] = lambda: main.ReadRepository(pool)
    try:
        path = f"/api/territories/commune/{target_id}/essential-services?comparison=epci"
        with TestClient(main.app) as client:
            monkeypatch.delenv("LUSK_SERVICES_SCALAR_READ", raising=False)
            legacy = client.get(path)
            assert legacy.status_code == 200, legacy.text
            monkeypatch.setenv("LUSK_SERVICES_SCALAR_READ", "1")
            scalar = client.get(path)
            assert scalar.status_code == 200, scalar.text
        old_body, new_body = legacy.json(), scalar.json()
        assert new_body["territory"] == old_body["territory"]
        assert new_body["scope"] == old_body["scope"]
        assert new_body["services"] == old_body["services"]

        service_by_id = {service["id"]: service for service in new_body["services"]}
        for indicator in indicator_ids:
            canonical = canonical_by_key[(target_id, indicator)]
            service, mode_code = indicator.removeprefix("share_").rsplit("_", 1)
            mode = {"t": "walk_transit", "b": "bike", "c": "car"}[mode_code]
            actual = service_by_id[service]["modes"][mode]
            source_id = metadata["sources"][indicator]
            assert actual["value"] == canonical["value"]
            assert actual["indicator_label"] == metadata["indicator_labels"][indicator]
            assert actual["direction"] == metadata["indicator_directions"][indicator]
            assert actual["source_id"] == source_id
            assert actual["source_name"] == canonical["vintage_source"]
            assert actual["source_version"] == canonical["vintage_version"]
            assert actual["reference_date"] == canonical["vintage_date_reference"]
            assert actual["source_publication_date"] == canonical["vintage_date_publication"]
    finally:
        if previous_override is None:
            main.app.dependency_overrides.pop(main.get_repository, None)
        else:
            main.app.dependency_overrides[main.get_repository] = previous_override
        pool.close()


def test_shared_scalar_schema_constraints_and_bounded_read(canonical_db_env):
    import psycopg
    from fastapi.testclient import TestClient
    from psycopg_pool import ConnectionPool
    from api import main

    with psycopg.connect(canonical_db_env["publish_dsn"], autocommit=True) as connection:
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
        with psycopg.connect(canonical_db_env["read_dsn"], autocommit=True) as reader:
            reader.execute("INSERT INTO scalar_observation(indicator_id,territory_id,territory_type,value,status) VALUES ('fixture_scalar','29001','commune',1,'measured')")

    pool = ConnectionPool(conninfo=canonical_db_env["read_dsn"], min_size=0, max_size=2, open=True,
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
        with psycopg.connect(canonical_db_env["publish_dsn"], autocommit=True) as publisher:
            publisher.execute("UPDATE table_publication SET content_version='territory-v2' WHERE table_name='territory_reference'")
        not_rebound = client.get("/api/territories/commune/29001/indicators/fixture_scalar")
        assert not_rebound.status_code == 503
        with psycopg.connect(canonical_db_env["publish_dsn"], autocommit=True) as publisher:
            publisher.execute("UPDATE table_publication SET reference_content_version='territory-v2' WHERE table_name='scalar_observation'")
            scalar_marker = publisher.execute("SELECT content_version FROM table_publication WHERE table_name='scalar_observation'").fetchone()[0]
            assert scalar_marker == "fixture-v1"  # dependency rebind is not a scalar-content version change
        compatible_rebind = client.get("/api/territories/commune/29001/indicators/fixture_scalar")
        assert compatible_rebind.status_code == 200
        with psycopg.connect(canonical_db_env["publish_dsn"], autocommit=True) as publisher:
            publisher.execute("DELETE FROM territory_reference WHERE territory_id='29002'")
            publisher.execute("INSERT INTO territory_reference(territory_id,territory_type,name) VALUES ('29003','commune','Gamma')")
            publisher.execute("UPDATE table_publication SET content_version='territory-v3' WHERE table_name='territory_reference'")
        incompatible_reference = client.get("/api/territories/commune/29001/indicators/fixture_scalar")
        assert incompatible_reference.status_code == 503
        with psycopg.connect(canonical_db_env["publish_dsn"], autocommit=True) as publisher:
            publisher.execute("UPDATE table_publication SET reference_content_version='territory-v3',row_count=9 WHERE table_name='scalar_observation'")
        # row_count is publication metadata, not a reason to scan the full
        # observation/reference tables on this point read.
        tampered_count = client.get("/api/territories/commune/29001/indicators/fixture_scalar")
        assert tampered_count.status_code == 200
        with psycopg.connect(canonical_db_env["publish_dsn"], autocommit=True) as publisher:
            publisher.execute("UPDATE table_publication SET reference_content_version='obsolete' WHERE table_name='scalar_observation'")
        stale = client.get("/api/territories/commune/29001/indicators/fixture_scalar")
        assert stale.status_code == 503
        with psycopg.connect(canonical_db_env["publish_dsn"], autocommit=True) as publisher:
            publisher.execute("DELETE FROM table_publication WHERE table_name='territory_reference'")
        missing_reference = client.get("/api/territories/commune/29001/indicators/fixture_scalar")
        assert missing_reference.status_code == 503
        with psycopg.connect(canonical_db_env["publish_dsn"], autocommit=True) as publisher:
            publisher.execute("INSERT INTO table_publication(table_name,content_version,row_count) VALUES ('territory_reference','territory-v3',2)")
        with psycopg.connect(canonical_db_env["publish_dsn"], autocommit=True) as publisher:
            publisher.execute("DELETE FROM table_publication WHERE table_name='scalar_observation'")
        missing = client.get("/api/territories/commune/29001/indicators/fixture_scalar")
        assert missing.status_code == 503
    finally:
        if previous is None:
            main.app.dependency_overrides.pop(main.get_repository, None)
        else:
            main.app.dependency_overrides[main.get_repository] = previous
        pool.close()


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
            publisher.execute("INSERT INTO territory_reference(territory_id,territory_type,name,department_id,epci_id) VALUES ('59701','commune','Series focal','22','e1'),('59702','commune','Series peer','22','e1'),('59703','commune','Series tie','22','e2'),('53','region','Series region',NULL,NULL)")
            publisher.execute("INSERT INTO source_dataset(source_id,name) VALUES ('series_fixture','Series fixture')")
            publisher.execute("INSERT INTO source_vintage(source_id,vintage_id,version,reference_date,publication_date) VALUES ('series_fixture','v1','2026-01','2025-01-01','2026-02-01')")
            publisher.execute("""INSERT INTO series_descriptor(indicator_id,axis_kind,axis_values,completeness,comparison_point,allowed_levels,label,unit,direction,source_id,vintage_id,descriptor_version)
                VALUES ('fixture_annual','year',ARRAY['2022','2023','2024'],'may_be_missing','2024',ARRAY['commune','region'],'Fixture annual','ha','low','series_fixture','v1','d1')""")
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
            with pytest.raises(psycopg.errors.CheckViolation):
                with publisher.transaction():
                    publisher.execute("UPDATE ordered_series SET value=99 WHERE territory_id='59701' AND axis_value='2024'")
                    publisher.execute("UPDATE table_publication SET content_version='partial' WHERE table_name='ordered_series'")
                    publisher.execute("INSERT INTO ordered_series(indicator_id,territory_id,territory_type,axis_value,observation_period,value,status,source_id,vintage_id) VALUES ('fixture_annual','59701','commune','2023','2023',NULL,'measured','series_fixture','v1')")
            assert publisher.execute("SELECT value FROM ordered_series WHERE territory_id='59701' AND axis_value='2024'").fetchone()[0] == 2
            assert publisher.execute("SELECT content_version FROM table_publication WHERE table_name='ordered_series'").fetchone()[0] == 'series-v1'

        pool = ConnectionPool(conninfo=scoped_read, min_size=0, max_size=2, open=True,
                          kwargs={"autocommit": True})
        previous = main.app.dependency_overrides.get(main.get_repository)
        main.app.dependency_overrides[main.get_repository] = lambda: main.ReadRepository(pool)
        try:
            with TestClient(main.app) as client:
                response = client.get('/api/territories/commune/59701/series/fixture_annual')
                department_response = client.get('/api/territories/commune/59701/series/fixture_annual?scope_level=commune&department_id=22')
                epci_response = client.get('/api/territories/commune/59701/series/fixture_annual?scope_level=commune&epci_id=e1')
                region_response = client.get('/api/territories/region/53/series/fixture_annual?scope_level=region')
                invalid_department = client.get('/api/territories/commune/59701/series/fixture_annual?scope_level=commune&department_id=99')
                invalid_epci = client.get('/api/territories/commune/59701/series/fixture_annual?scope_level=commune&epci_id=missing')
                mismatched_epci = client.get('/api/territories/commune/59701/series/fixture_annual?scope_level=commune&epci_id=e2')
            assert response.status_code == 200, response.text
            body = response.json()
            assert [point['axis'] for point in body['points']] == ['2022', '2023', '2024']
            assert body['points'][0]['value'] == 0
            assert body['points'][1]['status'] == 'missing' and body['points'][1]['value'] is None
            assert body['comparison'] == {
                'point': '2024', 'value': 2.0, 'median': 2.0, 'rank': 2,
                'ties': 2, 'comparable_count': 3,
                'scope': {'kind': 'level', 'territory_type': 'commune', 'department_id': None, 'epci_id': None},
            }
            assert body['points'][2]['source_version'] == '2026-01'
            assert body['availability'] == 'incomplete'
            assert department_response.status_code == 200, department_response.text
            assert department_response.json()['comparison']['scope']['department_id'] == '22'
            assert epci_response.status_code == 200, epci_response.text
            assert epci_response.json()['comparison']['scope']['epci_id'] == 'e1'
            assert epci_response.json()['comparison']['comparable_count'] == 2
            assert region_response.status_code == 200, region_response.text
            assert region_response.json()['comparison']['scope']['territory_type'] == 'region'
            assert region_response.json()['comparison']['rank'] == 1
            assert invalid_department.status_code == 422
            assert invalid_epci.status_code == 422
            assert mismatched_epci.status_code == 422
        finally:
            if previous is None:
                main.app.dependency_overrides.pop(main.get_repository, None)
            else:
                main.app.dependency_overrides[main.get_repository] = previous
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
        main.app.dependency_overrides[main.get_repository] = lambda: main.ReadRepository(PausingPool())
        try:
            with TestClient(main.app) as client:
                with concurrent.futures.ThreadPoolExecutor(max_workers=1) as requests:
                    pending = requests.submit(client.get,
                        "/api/territories/commune/59791/series/snapshot_annual")
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
                current = client.get("/api/territories/commune/59791/series/snapshot_annual")
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
                assert marker_contract(chain) == marker_contract(fresh)
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
            # Schema-level simulation of the supported per-table publication
            # contract (not execution of the R publisher): replace a reference
            # fact and its marker together, then verify the read-only role sees
            # only the committed new version and fact.
            with connection.transaction():
                connection.execute("UPDATE territory_reference SET territory_id='fixture-v2' WHERE territory_id='fixture'")
                connection.execute("UPDATE table_publication SET content_version='active-v2' WHERE table_name='territory_reference'")
            with psycopg.connect(reader_dsn, autocommit=True) as reader:
                published = reader.execute("""SELECT p.content_version, t.territory_id
                    FROM table_publication p JOIN territory_reference t ON true
                    WHERE p.table_name='territory_reference'""").fetchone()
                assert published == ("active-v2", "fixture-v2")
                with pytest.raises(psycopg.errors.InsufficientPrivilege):
                    reader.execute("UPDATE table_publication SET content_version='forbidden'")
            with pytest.raises(psycopg.errors.RaiseException, match="expected .*dataset_publication"):
                run(connection)
        finally:
            connection.execute("RESET search_path")
            connection.execute(f'DROP SCHEMA "{schema}" CASCADE')
