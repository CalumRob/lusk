"""Opt-in end-to-end checks against an explicitly disposable PostgreSQL database.

Nothing connects unless both LUSK_TEST_* DSNs and an exact disposable database
name are supplied. Each run owns a fresh schema; public is never modified.
"""

from __future__ import annotations

import json
import concurrent.futures
from contextlib import contextmanager
import os
import re
import subprocess
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
                "mobility_density_distribution_point",
            }
            assert legacy.isdisjoint(objects), sorted(legacy & objects)
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
    from api import snapshot_reads

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
                descriptors.append((indicator, "mobilite", f"{service} {mode}", "%", direction,
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
        descriptors.append(("densite", "demographie", "Densité", "hab./km²", "high",
                            "densite", ["commune"], "population/surface", "sparse", "desc-densite-v1"))
        scalar_rows.append(("densite", "29001", "commune", 123.0, "measured"))
        source_rows.append(("densite", "29001", "fixture", "v2026"))
        executemany("INSERT INTO essential_service_access(territory_id,service,mode,share,indicator_label,effective_direction,source_id,source_name,source_version,reference_date,source_publication_date) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)", legacy_rows)
        connection.execute("UPDATE table_publication SET row_count=%s WHERE table_name='essential_service_access'", (len(legacy_rows),))
        executemany("INSERT INTO scalar_descriptor(indicator_id,theme_id,label,unit,direction,comparison_facet,allowed_levels,denominator_semantics,completeness,descriptor_version) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)", descriptors)
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

            semantic_item = {
                "resource": "densite",
                "target": {"kind": "territory", "type": "commune", "id": "29001"},
                "fields": ["value"],
                "intent": {"kind": "facts"},
            }
            semantic_single = client.post("/api/resources/read", json=semantic_item)
            semantic_batch = client.post("/api/resources/read-batch", json={"items": [
                {"id": "density", **semantic_item},
            ]})
            assert semantic_single.status_code == semantic_batch.status_code == 200
            semantic_data = semantic_batch.json()["results"][0]["data"]
            assert semantic_data == semantic_single.json()
            assert semantic_data["resource"] == "densite"
            assert semantic_data["target"] == semantic_item["target"]
            assert semantic_data["value"] == 123.0
            assert semantic_data["status"] == "measured"
            assert semantic_data["sources"][0]["source_id"] == "fixture"

            # Exercise the selected-member SQL branch of each reader directly
            # against this same owned snapshot (the HTTP POST consumer lands later).
            repository = main.ReadRepository(pool)
            selected = [("commune", "29001"), ("commune", "29002")]
            selected_results = {}
            for scalar_read in (False, True):
                if scalar_read:
                    monkeypatch.setenv("LUSK_SERVICES_SCALAR_READ", "1")
                else:
                    monkeypatch.delenv("LUSK_SERVICES_SCALAR_READ", raising=False)
                with psycopg.connect(db_env["read_dsn"]) as selected_connection:
                    with selected_connection.transaction():
                        selected_connection.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
                        selected_data = repository.read_selected("commune", "29001", selected,
                                                                 connection=selected_connection)
                selected_results[scalar_read] = main.compare(selected_data)
                assert len(selected_results[scalar_read].services) == 5
                assert all(len(service.modes) == 3 for service in selected_results[scalar_read].services)
                assert selected_data["peer_member_ids"] == ["29001", "29002"]
                assert selected_results[scalar_read].scope["member_count"] == 2
            scalar_selected = selected_results[True].model_copy(
                update={"publication_id": selected_results[False].publication_id})
            assert selected_results[False] == scalar_selected
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
                "INSERT INTO scalar_descriptor(indicator_id,theme_id,label,unit,direction,comparison_facet,allowed_levels,denominator_semantics,completeness,descriptor_version) VALUES (%s,'mobilite',%s,%s,%s,%s,%s,%s,%s,%s)",
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


def test_theme_comparison_accepts_large_explicit_selection_without_peer_dump(canonical_db_env):
    import psycopg
    from fastapi.testclient import TestClient
    from psycopg_pool import ConnectionPool
    from api import main

    selected = [{"territory_type": "commune", "territory_id": f"large{i:04d}"}
                for i in range(1202)]
    # Keep one published reference member outside the explicit selection so
    # this exercises the request-scoped dynamic path, not a fixed Bretagne set.
    with psycopg.connect(canonical_db_env["publish_dsn"], autocommit=True) as conn:
        with conn.transaction():
            with conn.cursor() as cur:
                cur.executemany("INSERT INTO territory_reference(territory_id,territory_type,name,density_class_code) VALUES (%s,'commune',%s,%s)",
                                [(row["territory_id"], row["territory_id"],
                                  "fixture-density" if row["territory_id"] == "large0000" else None)
                                 for row in selected] +
                                [("outside-selection", "Outside explicit selection", "fixture-density")])
                cur.execute("INSERT INTO territory_reference(territory_id,territory_type,name) VALUES ('large-region','region','Large region')")
            conn.execute("INSERT INTO source_dataset VALUES ('large_fixture_a','Large fixture A'),('large_fixture_b','Large fixture B')")
            conn.execute("INSERT INTO source_vintage(source_id,vintage_id,version) VALUES ('large_fixture_a','v1','2026-A'),('large_fixture_b','v2','2026-B')")
            conn.execute("""INSERT INTO scalar_descriptor(indicator_id,theme_id,label,unit,direction,comparison_facet,
                allowed_levels,denominator_semantics,completeness,descriptor_version) VALUES
                ('large_scalar','demographie','Large scalar','count','high','large_scalar',
                 ARRAY['commune','region'],'fixture count','sparse','large-v1')""")
            conn.execute("INSERT INTO scalar_descriptor_source VALUES ('large_scalar','large_fixture_a'),('large_scalar','large_fixture_b')")
            conn.execute("""INSERT INTO scalar_observation(indicator_id,territory_id,territory_type,value,status) VALUES
                ('large_scalar','large0000','commune',7,'measured'),
                ('large_scalar','large0001','commune',10,'measured'),
                ('large_scalar','large0002','commune',4,'measured'),
                ('large_scalar','large-region','region',12,'measured')""")
            conn.execute("""INSERT INTO scalar_observation_source VALUES
                    ('large_scalar','large0000','large_fixture_a','v1'),
                    ('large_scalar','large0001','large_fixture_b','v2'),
                    ('large_scalar','large0002','large_fixture_a','v1'),
                    ('large_scalar','large0002','large_fixture_b','v2'),
                    ('large_scalar','large-region','large_fixture_a','v1')""")
            conn.execute("""INSERT INTO profile_descriptor(indicator_id,label,unit,allowed_levels,
                completeness,descriptor_version,comparison_detail,comparison_sex,comparison_direction)
                VALUES ('large_profile','Large profile','count',ARRAY['commune'],'dense_complete',
                        'large-profile-v1','total','all','high')""")
            conn.execute("""INSERT INTO profile_axis(indicator_id,axis_name,axis_key,label,ordinal) VALUES
                ('large_profile','detail','total','Total',0),('large_profile','sex','all','All',0)""")
            conn.execute("""INSERT INTO profile_observation(indicator_id,territory_id,territory_type,
                detail_key,sex_key,value,status) VALUES
                ('large_profile','large0000','commune','total','all',7,'measured'),
                ('large_profile','large0001','commune','total','all',10,'measured'),
                ('large_profile','large0002','commune','total','all',4,'measured')""")
            conn.execute("INSERT INTO profile_descriptor_source VALUES ('large_profile','large_fixture_a')")
            conn.execute("""INSERT INTO profile_observation_source VALUES
                ('large_profile','large0000','total','all','large_fixture_a','v1'),
                ('large_profile','large0001','total','all','large_fixture_a','v1'),
                ('large_profile','large0002','total','all','large_fixture_a','v1')""")
            conn.execute("""INSERT INTO profile_descriptor(indicator_id,label,unit,allowed_levels,
                completeness,descriptor_version,comparison_detail,comparison_sex,comparison_direction)
                VALUES ('budget_profile','Budget profile','count',ARRAY['commune'],'dense_complete',
                        'budget-profile-v1','d0','s0','high')""")
            conn.execute("""INSERT INTO profile_axis(indicator_id,axis_name,axis_key,label,ordinal)
                SELECT 'budget_profile',axis_name,axis_key,axis_key,ordinal
                FROM (SELECT 'detail'::text AS axis_name,'d'||i AS axis_key,i AS ordinal FROM generate_series(0,150) i
                      UNION ALL
                      SELECT 'sex'::text,'s'||i,i FROM generate_series(0,150) i) axes""")
            conn.execute("""INSERT INTO series_descriptor(indicator_id,axis_kind,axis_values,completeness,
                comparison_point,allowed_levels,label,unit,direction,source_id,vintage_id,descriptor_version)
                VALUES ('large_series','year',ARRAY['2020','2021'],'may_be_missing','2021',
                ARRAY['commune'],'Large series','count','high','large_fixture_a','v1','large-series-v1')""")
            conn.execute("""INSERT INTO ordered_series(indicator_id,territory_id,territory_type,
                axis_value,observation_period,value,status,source_id,vintage_id) VALUES
                ('large_series','large0000','commune','2020','2020',6,'measured','large_fixture_a','v1'),
                ('large_series','large0000','commune','2021','2021',7,'measured','large_fixture_a','v1'),
                ('large_series','large0001','commune','2020','2020',9,'measured','large_fixture_a','v1'),
                ('large_series','large0001','commune','2021','2021',10,'measured','large_fixture_a','v1'),
                ('large_series','large0002','commune','2020','2020',3,'measured','large_fixture_a','v1'),
                ('large_series','large0002','commune','2021','2021',4,'measured','large_fixture_a','v1')""")
            conn.execute("INSERT INTO table_publication(table_name,content_version,row_count) VALUES ('territory_reference','large-ref-v1',1204)")
            conn.execute("INSERT INTO table_publication(table_name,content_version,row_count,reference_content_version) VALUES ('scalar_observation','large-v1',3,'large-ref-v1')")
            conn.execute("""INSERT INTO table_publication(table_name,content_version,row_count,
                reference_content_version) VALUES ('declared_profile','large-profile-v1',3,'large-ref-v1'),
                ('ordered_series','large-series-v1',6,'large-ref-v1')""")
    read_parts = urlsplit(canonical_db_env["read_dsn"])
    read_query = parse_qs(read_parts.query, keep_blank_values=True)
    read_query["connect_timeout"] = ["8"]
    bounded_read_dsn = urlunsplit((read_parts.scheme, read_parts.netloc, read_parts.path,
                                   urlencode(read_query, doseq=True), read_parts.fragment))

    def configure_read_connection(connection):
        connection.execute("SET statement_timeout = '60000ms'")
        connection.execute("SET lock_timeout = '5000ms'")

    pool = ConnectionPool(conninfo=bounded_read_dsn, min_size=0, max_size=1, open=True,
                          kwargs={"autocommit": True}, configure=configure_read_connection)
    class TrackingConnection:
        def __init__(self, connection, counters):
            self.connection = connection
            self.counters = counters

        def __getattr__(self, name):
            return getattr(self.connection, name)

        def execute(self, sql, *args, **kwargs):
            self.counters["statements"].append(sql)
            hook = self.counters.get("before_series_fact_read")
            if hook and "FROM ordered_series s JOIN source_vintage" in sql:
                self.counters["before_series_fact_read"] = None
                hook()
            return self.connection.execute(sql, *args, **kwargs)

        @contextmanager
        def transaction(self):
            self.counters["transactions"] += 1
            with self.connection.transaction():
                yield self

    class TrackingPool:
        def __init__(self, wrapped):
            self.wrapped = wrapped
            self.counters = {"connections": 0, "transactions": 0, "statements": []}

        @contextmanager
        def connection(self):
            self.counters["connections"] += 1
            with self.wrapped.connection() as connection:
                yield TrackingConnection(connection, self.counters)

    tracked_pool = TrackingPool(pool)
    previous = main.app.dependency_overrides.get(main.get_repository)
    main.app.dependency_overrides[main.get_repository] = lambda: main.ReadRepository(tracked_pool)
    try:
        with TestClient(main.app) as client:
            response = client.post("/api/territories/commune/large0000/themes/comparison",
                                   json={"theme_id": "demographie", "selection": selected})
            median_only = client.post("/api/territories/commune/large0000/themes/comparison?fields=median",
                                      json={"theme_id": "demographie", "selection": selected})
            typed_comparison_single = client.post(
                "/api/territories/commune/large0000/themes/demographie/comparison?fields=median",
                json={"theme_id": "demographie", "selection": selected})
            rank_only = client.post("/api/territories/commune/large0000/themes/comparison?fields=rank",
                                    json={"theme_id": "demographie", "selection": selected})
            status_only = client.post("/api/territories/commune/large0000/themes/comparison?fields=status",
                                      json={"theme_id": "demographie", "selection": selected})
            focal_single = client.get(
                "/api/territories/region/large-region/themes/demographie/facts?fields=value")
            indicator_single = client.get(
                "/api/territories/region/large-region/indicators/large_scalar?fields=status")
            profile_single = client.get(
                "/api/territories/commune/large0000/profiles/large_profile")
            series_single = client.get(
                "/api/territories/commune/large0000/series/large_series?scope_level=commune")
            tracked_pool.counters.update(connections=0, transactions=0, statements=[])
            mixed_batch = client.post("/api/read-batch", json={"items": [
                {"id": "focal", "resource": "theme_facts", "territory_type": "region",
                 "territory_id": "large-region", "theme_id": "demographie", "fields": ["value"]},
                {"id": "peers", "resource": "theme_comparison", "territory_type": "commune",
                 "territory_id": "large0000", "theme_id": "demographie",
                 "selection": selected, "fields": ["median"]},
                {"id": "named-scalar", "resource": "indicator_facts", "territory_type": "region",
                 "territory_id": "large-region", "indicator_id": "large_scalar", "fields": ["status"]},
                {"id": "profile", "resource": "direct_profile", "territory_type": "commune",
                 "territory_id": "large0000", "indicator_id": "large_profile"},
                {"id": "series", "resource": "direct_series", "territory_type": "commune",
                 "territory_id": "large0000", "indicator_id": "large_series", "scope_level": "commune"},
            ]})
            batch_connection_counts = dict(tracked_pool.counters)
            tracked_pool.counters.update(connections=0, transactions=0, statements=[])
            collective_budget = client.post("/api/read-batch", json={"items": [
                {"id": f"profile-{i}", "resource": "direct_profile",
                 "territory_type": "commune", "territory_id": "large0000",
                 "indicator_id": "budget_profile"} for i in range(9)
            ]})
            budget_query_trace = dict(tracked_pool.counters)
            # First- and last-item stale marker failures happen during metadata
            # preflight, before either preceding or following facts can be read.
            with psycopg.connect(canonical_db_env["publish_dsn"], autocommit=True) as publisher:
                publisher.execute("UPDATE table_publication SET reference_content_version='stale-ref' WHERE table_name='ordered_series'")
            stale_batches = []
            for stale_position in (0, 1):
                tracked_pool.counters.update(connections=0, transactions=0, statements=[])
                profile_item = {"id":"profile","resource":"direct_profile","territory_type":"commune",
                    "territory_id":"large0000","indicator_id":"large_profile"}
                series_item = {"id":"series","resource":"direct_series","territory_type":"commune",
                    "territory_id":"large0000","indicator_id":"large_series","scope_level":"commune"}
                items = [series_item,profile_item] if stale_position == 0 else [profile_item,series_item]
                failed = client.post("/api/read-batch",json={"items":items})
                stale_batches.append((failed.status_code,dict(tracked_pool.counters),failed.json()))
            with psycopg.connect(canonical_db_env["publish_dsn"], autocommit=True) as publisher:
                publisher.execute("UPDATE table_publication SET reference_content_version='large-ref-v1' WHERE table_name='ordered_series'")
            # Force a publisher commit between two item reads. The batch's first
            # preflight query has established its repeatable-read snapshot.
            reached_fact_read, publisher_committed = threading.Event(), threading.Event()
            def pause_at_fact_read():
                reached_fact_read.set()
                if not publisher_committed.wait(10):
                    raise TimeoutError("publisher did not commit during batch read")
            tracked_pool.counters.update(connections=0,transactions=0,statements=[],
                                         before_series_fact_read=pause_at_fact_read)
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
                future = executor.submit(client.post,"/api/read-batch",json={"items":[
                    {"id":"series","resource":"direct_series","territory_type":"commune",
                     "territory_id":"large0000","indicator_id":"large_series","scope_level":"commune"},
                    {"id":"profile","resource":"direct_profile","territory_type":"commune",
                     "territory_id":"large0000","indicator_id":"large_profile"},
                    {"id":"mixed-clock","resource":"theme_comparison","territory_type":"commune",
                     "territory_id":"large0000","theme_id":"demographie",
                     "selection":[{"territory_type":"commune","territory_id":key}
                                   for key in ("large0000","large0001","large0002")] }]})
                assert reached_fact_read.wait(10), "batch never reached the first series fact read"
                with psycopg.connect(canonical_db_env["publish_dsn"]) as publisher:
                    with publisher.transaction():
                        publisher.execute("UPDATE ordered_series SET value=70 WHERE indicator_id='large_series' AND territory_id='large0000' AND axis_value='2021'")
                        publisher.execute("UPDATE table_publication SET content_version='large-series-v2' WHERE table_name='ordered_series'")
                publisher_committed.set()
                concurrent_batch = future.result(timeout=20)
            concurrent_trace = dict(tracked_pool.counters)
            concurrent_trace["statements"] = list(tracked_pool.counters["statements"])
            after_refresh = client.get("/api/territories/commune/large0000/series/large_series?scope_level=commune")
            with pool.connection() as readonly_connection:
                with readonly_connection.transaction():
                    readonly_connection.execute("SET TRANSACTION READ ONLY")
                    with pytest.raises(psycopg.errors.ReadOnlySqlTransaction):
                        readonly_connection.execute("INSERT INTO table_publication(table_name,content_version,row_count) VALUES ('forbidden-write','x',0)")
            invalid_fields = client.post("/api/territories/commune/large0000/themes/comparison?fields=raw_sql",
                                         json={"theme_id": "demographie", "selection": selected})
            excessive = client.post("/api/territories/commune/large0000/themes/comparison",
                                    json={"theme_id": "demographie", "selection": [selected[0]] * 1501})
        assert response.status_code == 200, response.text
        assert focal_single.status_code == indicator_single.status_code == profile_single.status_code == series_single.status_code == mixed_batch.status_code == 200, mixed_batch.text
        assert collective_budget.status_code == 413, collective_budget.text
        assert [status for status,_,_ in stale_batches] == [503,503]
        assert all("results" not in body and "data" not in body for _,_,body in stale_batches)
        assert all(not any("FROM profile_observation" in sql or "FROM ordered_series s JOIN" in sql
                           for sql in trace["statements"]) for _,trace,_ in stale_batches)
        assert concurrent_batch.status_code == 200, concurrent_batch.text
        concurrent_data = {row["id"]:row["data"] for row in concurrent_batch.json()["results"]}
        assert concurrent_data["series"]["publication_id"] == "large-series-v1"
        assert next(point for point in concurrent_data["series"]["points"] if point["axis"]=="2021")["value"] == 7
        assert {(source["source_id"],source["vintage_id"])
                for source in concurrent_data["mixed-clock"]["results"][0]["comparison_sources"]} == {
            ("large_fixture_a","v1"),("large_fixture_b","v2")}
        assert concurrent_data["profile"]["content_version"] == "large-profile-v1"
        assert after_refresh.status_code == 200 and after_refresh.json()["publication_id"] == "large-series-v2"
        assert next(point for point in after_refresh.json()["points"] if point["axis"]=="2021")["value"] == 70
        assert concurrent_trace["connections"] == concurrent_trace["transactions"] == 1
        assert sum("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY" in sql
                   for sql in concurrent_trace["statements"]) == 1
        assert budget_query_trace["connections"] == budget_query_trace["transactions"] == 1
        assert not any("FROM profile_observation" in sql for sql in budget_query_trace["statements"])
        batched = {item["id"]: item["data"] for item in mixed_batch.json()["results"]}
        assert batched["focal"] == focal_single.json()
        assert batched["named-scalar"] == indicator_single.json()
        assert batched["profile"] == profile_single.json()
        assert batched["series"] == series_single.json()
        assert len(batched["series"]["scope_series"]) == 3
        assert {group["territory"]["id"] for group in batched["series"]["scope_series"]} == {
            "large0000", "large0001", "large0002"}
        assert typed_comparison_single.status_code == 200, typed_comparison_single.text
        assert batched["peers"] == typed_comparison_single.json()
        batch_lineage = batched["peers"]["results"][0]["comparison_sources"]
        assert {(source["source_id"], source["vintage_id"]) for source in batch_lineage} == {
            ("large_fixture_a", "v1"), ("large_fixture_b", "v2")}
        assert batch_connection_counts["connections"] == 1
        assert batch_connection_counts["transactions"] == 1
        assert sum("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY" in sql
                   for sql in batch_connection_counts["statements"]) == 1
        body = response.json()
        result = body["results"][0]
        assert result["selected_member_count"] == 1202
        assert result["eligible_count"] == 3 and result["missing_count"] == 1199
        assert result["median"] == 7 and result["rank"] == 2 and result["rank_size"] == 3
        expected_sources = {("large_fixture_a", "v1"), ("large_fixture_b", "v2")}
        assert {(source["source_id"], source["vintage_id"]) for source in result["comparison_sources"]} == expected_sources
        assert "observations" not in response.json() and "scope_series" not in response.json()
        for projected in (median_only, rank_only, status_only):
            assert projected.status_code == 200, projected.text
            projected_body = projected.json()
            assert {key: projected_body[key] for key in
                    ("contract", "complete_theme", "theme_id", "content_version", "reference_content_version", "selection", "scope")} == {
                        key: body[key] for key in
                        ("contract", "complete_theme", "theme_id", "content_version", "reference_content_version", "selection", "scope")}
            projected_result = projected_body["results"][0]
            for key in ("indicator_id", "label", "unit", "direction", "descriptor_version", "status", "comparison_sources"):
                assert projected_result[key] == result[key]
        assert median_only.json()["results"][0]["median"] == result["median"]
        assert "rank" not in median_only.json()["results"][0]
        assert rank_only.json()["results"][0]["rank"] == result["rank"]
        assert "median" not in rank_only.json()["results"][0]
        assert status_only.json()["results"][0]["status"] == result["status"]
        assert not {"median", "rank", "eligible_count", "missing_count"} & set(status_only.json()["results"][0])
        assert invalid_fields.status_code == 422
        assert excessive.status_code == 422
        assert excessive.json()["detail"][0]["type"] == "too_long"
        assert excessive.json()["detail"][0]["ctx"]["max_length"] == 1500
    finally:
        if previous is None:
            main.app.dependency_overrides.pop(main.get_repository, None)
        else:
            main.app.dependency_overrides[main.get_repository] = previous
        pool.close()


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


@pytest.mark.parametrize("publication_schema", ["fresh", "populated_upgrade"])
def test_synthetic_r_comparison_lineage_publish_to_api_reader(canonical_db_env, tmp_path, publication_schema):
    """Exercise R publishers through the semantic single/batch API against PostgreSQL."""
    from dataclasses import replace
    import psycopg
    from fastapi.testclient import TestClient
    from psycopg_pool import ConnectionPool
    from api import main
    from api import snapshot_reads

    publish_dsn = canonical_db_env["publish_dsn"]
    read_dsn = canonical_db_env["read_dsn"]
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
    })
    pipeline = Path(__file__).resolve().parents[3] / "pipeline"
    completed = subprocess.run(
        ["Rscript", "scripts/smoke-comparison-lineage-fixture.R"],
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
        if publication_schema == "populated_upgrade":
            root = Path(__file__).resolve().parents[2]
            with psycopg.connect(publish_dsn) as publisher:
                old_rows = _restore_populated_pre_lineage_comparisons(publisher, root)
                reader = urlsplit(read_dsn).username
                assert reader and re.fullmatch(r"[A-Za-z0-9_$-]+", reader)
                publisher.execute(f'GRANT SELECT ON ALL TABLES IN SCHEMA "{canonical_db_env["schema"]}" TO "{reader}"')
            # Unapplied storage must be intentionally unavailable, not a 500.
            unavailable_singles, unavailable_batch = read_comparisons()
            assert [response.status_code for response in unavailable_singles] == [503] * len(comparison_items)
            assert unavailable_batch.status_code == 503
            with psycopg.connect(publish_dsn, autocommit=True) as publisher:
                for migration in ("033_comparison_source_lineage.sql",
                                  "034_ordered_series_comparison_lineage.sql",
                                  "035_numeric_collection_comparison_lineage.sql"):
                    publisher.execute((root / "migrations" / migration).read_text(encoding="utf-8"))
                # Migration must not rewrite or delete any previous result or marker.
                for table, (columns, expected) in old_rows.items():
                    projection = ','.join(f'"{column}"' for column in columns)
                    actual = publisher.execute(f'SELECT {projection} FROM "{table}"').fetchall()
                    assert sorted(actual, key=repr) == expected, table
                for table in ("scalar_comparison_group", "profile_comparison_group",
                              "ordered_series_comparison_group"):
                    assert publisher.execute(f'SELECT bool_and(lineage_source_count IS NULL) FROM "{table}"').fetchone()[0]
                assert publisher.execute("SELECT bool_and(NOT lineage_complete) FROM observed_collection_comparison_publication").fetchone()[0]
                # Newly created lineage tables need the dedicated test reader grant;
                # migration grants target the production role names, not this test role.
                publisher.execute(f'GRANT SELECT ON ALL TABLES IN SCHEMA "{canonical_db_env["schema"]}" TO "{reader}"')
            unavailable_singles, unavailable_batch = read_comparisons()
            assert [response.status_code for response in unavailable_singles] == [503] * len(comparison_items)
            assert unavailable_batch.status_code == 503
            republish_env = dict(env, LUSK_LINEAGE_TEST_REPUBLISH=str(bundle_path))
            # Two separate invocations prove the supported unchanged retry/no-op
            # path, not just the initial repair after an additive upgrade.
            repaired_markers = None
            for _ in range(2):
                repaired = subprocess.run(
                    ["Rscript", "scripts/smoke-comparison-lineage-fixture.R"],
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
                    markers = {table: sorted(publisher.execute(f'SELECT * FROM "{table}"').fetchall(), key=repr)
                        for table in old_rows if table.endswith("_publication")}
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
