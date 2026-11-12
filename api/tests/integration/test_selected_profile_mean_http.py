"""Guarded HTTP proof for explicit selected-profile means (#996 / owner #979).

Runs only against the operator-owned ``lusk_it_contract`` database with the
dedicated ``lusk_it_contract_pub`` / ``lusk_it_contract_read`` roles, a private
``PGPASSFILE`` and one random disposable schema. The named process mutex
``Local\\LuskIntegrationContractDb`` is acquired before the first connection and
held through cleanup/verification, so this proof serializes with the concurrent
pipeline worker. Every schema this module creates is dropped and the database is
verified to hold zero user schemas and zero ``public`` relations before unlock.

The fixture is the real Mobilité network split: three equal-weight partitions
whose eligible communes are identical, a measured zero, missing cells, and two
network details whose eligible counts agree while their actual identities do
not. No fixed-mean publication, schema change or pipeline work is involved.
"""

from __future__ import annotations

import ctypes
import os
import uuid
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import urlsplit

import pytest

from api.tests.integration.test_postgres_publication import (
    _aedar_guarded_configuration, _dsn_with_schema)

pytestmark = pytest.mark.integration

MUTEX_NAME = r"Local\LuskIntegrationContractDb"
MUTEX_TIMEOUT_MS = 600_000

OFFRE = "offre_cyclable"
RESEAUX_HABITANT = "reseaux_par_habitant"
RESEAUX = "reseaux"
OFFRE_DETAILS = ("protege_longueur", "protege_km_1000", "partage_longueur",
                 "partage_km_1000", "total_longueur")
OFFRE_UNITS = {"protege_longueur": "km", "protege_km_1000": "km / 1 000 hab",
               "partage_longueur": "km", "partage_km_1000": "km / 1 000 hab",
               "total_longueur": "km"}


def _acquire_mutex():
    if os.name != "nt":
        pytest.skip("the guarded integration mutex is a Windows named mutex")
    kernel32 = ctypes.windll.kernel32
    handle = kernel32.CreateMutexW(None, False, MUTEX_NAME)
    if not handle:
        pytest.fail("could not create the integration database mutex")
    result = kernel32.WaitForSingleObject(handle, MUTEX_TIMEOUT_MS)
    if result not in (0, 0x80):  # WAIT_OBJECT_0 / WAIT_ABANDONED
        kernel32.CloseHandle(handle)
        pytest.fail("timed out waiting for Local\\LuskIntegrationContractDb")
    return handle


def _release_mutex(handle):
    kernel32 = ctypes.windll.kernel32
    kernel32.ReleaseMutex(handle)
    kernel32.CloseHandle(handle)


def _user_schemas(connection):
    return [row[0] for row in connection.execute("""
        SELECT nspname FROM pg_namespace
        WHERE nspname NOT IN ('pg_catalog', 'information_schema', 'public')
          AND nspname NOT LIKE 'pg_toast%' AND nspname NOT LIKE 'pg_temp%'
        ORDER BY nspname""").fetchall()]


def _public_relations(connection):
    return connection.execute("""
        SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S','f')""").fetchone()[0]


def _database_bytes(connection):
    return connection.execute("SELECT pg_database_size(current_database())").fetchone()[0]


@contextmanager
def _guarded_identity(publish_dsn, read_dsn):
    """Verify both connections before any fixture DDL or test read."""
    import psycopg
    expected_pub = urlsplit(publish_dsn).username
    expected_read = urlsplit(read_dsn).username
    with psycopg.connect(publish_dsn, autocommit=True) as publisher:
        assert publisher.execute("SELECT current_database(),current_user").fetchone() == (
            "lusk_it_contract", expected_pub)
        with psycopg.connect(read_dsn, autocommit=True) as reader:
            assert reader.execute("SELECT current_database(),current_user").fetchone() == (
                "lusk_it_contract", expected_read)
        yield publisher, reader


@pytest.fixture(scope="module", autouse=True)
def integration_db_mutex():
    if not all(os.environ.get(name) for name in (
            "LUSK_TEST_PUBLISH_DSN", "LUSK_TEST_READ_DSN",
            "LUSK_TEST_DATABASE_NAME", "LUSK_TEST_DATABASE_PREFIX")):
        # Ordinary collection must not wait on the operator's guarded database.
        pytest.skip("guarded integration database is not configured")
    handle = _acquire_mutex()
    try:
        yield
    finally:
        _release_mutex(handle)


def _guarded_configuration_or_skip():
    """Resolve the exact guarded target and require explicit cleanup opt-in.

    Ordinary collection without test DSNs skips normally. A guarded run that
    could connect must fail before its first connection/DDL unless cleanup is
    explicitly enabled; this module never retains fixtures.
    """
    publish_dsn, read_dsn = _aedar_guarded_configuration()
    if os.environ.get("LUSK_TEST_ALLOW_SCHEMA_CLEANUP") != "1":
        pytest.fail("guarded #996 mean proof requires LUSK_TEST_ALLOW_SCHEMA_CLEANUP=1 "
                    "before any database connection or DDL")
    return publish_dsn, read_dsn


@pytest.fixture(scope="module")
def mean_db(integration_db_mutex):
    psycopg = pytest.importorskip("psycopg")
    publish_dsn, read_dsn = _guarded_configuration_or_skip()
    schema = "it_mean_" + uuid.uuid4().hex[:16]
    scoped_publish = _dsn_with_schema(publish_dsn, schema)
    scoped_read = _dsn_with_schema(read_dsn, schema)
    schema_sql = (Path(__file__).resolve().parents[2] / "schema.sql").read_text(encoding="utf-8")
    created = False
    state_before = state_after = None
    with _guarded_identity(publish_dsn, read_dsn) as (publisher, _reader):
        state_before = (_user_schemas(publisher), _public_relations(publisher),
                        _database_bytes(publisher))
        if state_before[0]:
            pytest.fail(f"guarded target is not empty before the run: {state_before[0]}")
    try:
        with psycopg.connect(publish_dsn, autocommit=True) as publisher:
            publisher.execute(f'CREATE SCHEMA "{schema}"')
            created = True
            publisher.execute(f'SET search_path TO "{schema}"')
            publisher.execute(schema_sql)
            reader_role = urlsplit(read_dsn).username
            quoted = '"' + reader_role.replace('"', '""') + '"'
            publisher.execute(f'GRANT USAGE ON SCHEMA "{schema}" TO {quoted}')
            publisher.execute(f'GRANT SELECT ON ALL TABLES IN SCHEMA "{schema}" TO {quoted}')
            with publisher.transaction():
                seeded = _seed(publisher)
        yield {"publish_dsn": scoped_publish, "read_dsn": scoped_read,
               "schema": schema, "publisher_dsn": publish_dsn,
               "read_role": urlsplit(read_dsn).username, **seeded}
    finally:
        if created:
            with psycopg.connect(publish_dsn, autocommit=True) as publisher:
                publisher.execute(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE')
                state_after = (_user_schemas(publisher), _public_relations(publisher),
                               _database_bytes(publisher))
                if schema in state_after[0]:
                    pytest.fail("own guarded schema could not be removed before unlock")
                if state_after[1] != 0:
                    pytest.fail("public relations exist after guarded cleanup")
                if state_after[0]:
                    pytest.fail(f"guarded target must be empty after the run: {state_after[0]}")
                print(f"guarded database bytes: before={state_before[2]} "
                      f"after={state_after[2]} schemas_before={state_before[0]} "
                      f"schemas_after={state_after[0]}", flush=True)


def _seed(conn):
    """Insert the complete Mobilité fixture in the caller's test schema."""
    suffix = uuid.uuid4().hex[:8]
    focal = f"96{suffix}f"
    peers = [f"96{suffix}{index}" for index in range(1, 6)]
    p1, p2, p3, p4, p5 = peers
    epci = f"E{suffix}"
    conn.execute(
        """INSERT INTO territory_reference(territory_id,territory_type,name,department_id,epci_id,
             density_class_code,density_class_label) VALUES
           (%s,'commune','Focal','29',%s,'D996','Dense'),
           (%s,'commune','Peer 1','29',%s,'D996','Dense'),
           (%s,'commune','Peer 2','29',%s,'D996','Dense'),
           (%s,'commune','Peer 3','29',%s,'D996','Dense'),
           (%s,'commune','Peer 4 missing','29',%s,'D996','Dense'),
           (%s,'commune','Peer 5 partial','29',%s,'D996','Dense')""",
        (focal, epci, p1, epci, p2, epci, p3, epci, p4, epci, p5, epci))
    conn.execute("INSERT INTO territory_reference(territory_id,territory_type,name) "
                 "VALUES (%s,'epci','Fixture EPCI')", (epci,))
    conn.execute("""INSERT INTO table_publication(table_name,content_version,row_count)
        VALUES ('territory_reference','ref-v1',7)""")
    conn.execute("INSERT INTO source_dataset VALUES ('osm_reseaux','OpenStreetMap reseaux')")
    conn.execute("""INSERT INTO source_vintage(source_id,vintage_id,version,reference_date,
        publication_date) VALUES ('osm_reseaux','2026-08','2026-08','2026-08-05','2026-08-06')""")

    offre_values = {
        # The complete partitions are identical populations; the zero partage is
        # a real measurement and the two missing peers are never zeroed.
        focal: {"protege_longueur": 2.0, "partage_longueur": 6.0, "total_longueur": 8.0,
                "protege_km_1000": 4.0, "partage_km_1000": 12.0},
        p1: {"protege_longueur": 0.0, "partage_longueur": 3.0, "total_longueur": 3.0,
             "protege_km_1000": 0.0, "partage_km_1000": 6.0},
        p2: {"protege_longueur": 5.0, "partage_longueur": 5.0, "total_longueur": 10.0,
             "protege_km_1000": 10.0, "partage_km_1000": 10.0},
        p3: {},
        p4: {},
    }
    reseaux_habitant_values = {
        focal: {"t_km_1000": 1.0, "b_km_1000": 2.0, "c_km_1000": 3.0},
        p1: {"t_km_1000": 2.0, "b_km_1000": 4.0, "c_km_1000": 6.0},
        p2: {"t_km_1000": 3.0, "b_km_1000": 6.0, "c_km_1000": 9.0},
        p3: {"t_km_1000": 40.0, "b_km_1000": None, "c_km_1000": 12.0},
        p4: {"t_km_1000": None, "b_km_1000": 20.0, "c_km_1000": 16.0},
    }
    reseaux_values = {
        focal: {"t_longueur": 1.0, "b_longueur": 0.0, "c_longueur": 4.0},
        p1: {"t_longueur": 2.0, "b_longueur": 1.0, "c_longueur": 5.0},
        p2: {"t_longueur": 3.0, "b_longueur": 7.0, "c_longueur": 6.0},
        p3: {"t_longueur": None, "b_longueur": None, "c_longueur": None},
        p4: {"t_longueur": None, "b_longueur": None, "c_longueur": None},
    }

    def profile(indicator, label, unit, default_detail, direction, details, units, values):
        conn.execute("""INSERT INTO profile_descriptor(indicator_id,theme_id,label,unit,
            allowed_levels,completeness,descriptor_version,comparison_detail,comparison_sex,
            comparison_direction,denominator_semantics,detail_units_required)
            VALUES (%s,'mobilite',%s,%s,ARRAY['commune','epci','departement','region'],
            'dense_complete',%s,%s,NULL,%s,%s,true)""",
            (indicator, label, unit, f"{indicator}-v1", default_detail, direction,
             "population" if indicator == RESEAUX_HABITANT else "length"))
        conn.execute("INSERT INTO profile_descriptor_source VALUES (%s,'osm_reseaux')",
                     (indicator,))
        for ordinal, detail in enumerate(details):
            conn.execute("""INSERT INTO profile_axis(indicator_id,axis_name,axis_key,label,
                ordinal,unit) VALUES (%s,'detail',%s,%s,%s,%s)""",
                (indicator, detail, detail, ordinal, units[detail]))
        for territory, detail_values in values.items():
            for detail in details:
                value = detail_values.get(detail)
                conn.execute("""INSERT INTO profile_observation(indicator_id,territory_id,
                    territory_type,detail_key,sex_key,sex_axis_name,value,status)
                    VALUES (%s,%s,'commune',%s,'',NULL,%s,%s)""",
                    (indicator, territory, detail, value,
                     "measured" if value is not None else "not_available"))
                conn.execute("""INSERT INTO profile_observation_source(indicator_id,
                    territory_id,detail_key,sex_key,source_id,vintage_id)
                    VALUES (%s,%s,%s,'','osm_reseaux','2026-08')""",
                    (indicator, territory, detail))

    profile(OFFRE, "L'offre cyclable", "km", "total_longueur", "high",
            OFFRE_DETAILS, OFFRE_UNITS, offre_values)
    profile(RESEAUX_HABITANT, "Longueur du reseau par habitant", "km / 1 000 hab.",
            "b_km_1000", "high", ("t_km_1000", "b_km_1000", "c_km_1000"),
            {"t_km_1000": "km / 1 000 hab.", "b_km_1000": "km / 1 000 hab.",
             "c_km_1000": "km / 1 000 hab."}, reseaux_habitant_values)
    profile(RESEAUX, "Reseaux a pied / velo / voiture", "km", "b_longueur", "high",
            ("t_longueur", "b_longueur", "c_longueur"),
            {"t_longueur": "km", "b_longueur": "km", "c_longueur": "km"}, reseaux_values)
    conn.execute("""INSERT INTO table_publication(table_name,content_version,row_count,
        reference_content_version) VALUES ('declared_profile','profiles-v1',120,'ref-v1')""")
    return {"focal": focal, "peers": peers}


def _client(db):
    import psycopg_pool
    from fastapi.testclient import TestClient
    from api import main

    pool = psycopg_pool.ConnectionPool(conninfo=db["read_dsn"], min_size=0, max_size=4,
                                       open=True, kwargs={"autocommit": True})
    repository = main.ReadRepository(pool)
    main.app.dependency_overrides[main.get_repository] = lambda: repository
    main.app.dependency_overrides[main.get_resource_catalogue] = main.default_resource_catalogue
    return TestClient(main.app), pool


def _close(pool):
    from api import main
    main.app.dependency_overrides.clear()
    pool.close()


def _selected(resource, focal, members, *, statistic="mean", coordinates=None, fields=None):
    item = {
        "resource": resource,
        "target": {"kind": "territory", "type": "commune", "id": focal},
        "intent": {"kind": "selected_comparison",
                   "members": [{"type": "commune", "id": member} for member in members],
                   **({} if statistic is None else {"statistic": statistic})},
    }
    if coordinates is not None:
        item["coordinates"] = coordinates
    if fields is not None:
        item["fields"] = fields
    return item


def _mean(client, db, resource, *, detail=None, members=None, focal=None):
    members = members if members is not None else [db["focal"], *db["peers"][:4]]
    response = client.post("/api/resources/read", json=_selected(
        resource, focal or db["focal"], members,
        coordinates=None if detail is None else {"detail": [detail]}))
    assert response.status_code == 200, response.text
    return response.json()


def test_guarded_run_refuses_without_cleanup_opt_in_before_any_connection(monkeypatch):
    import psycopg

    monkeypatch.delenv("LUSK_TEST_ALLOW_SCHEMA_CLEANUP", raising=False)
    monkeypatch.setattr(psycopg, "connect",
                        lambda *args, **kwargs: pytest.fail("database connection attempted"))
    with pytest.raises(pytest.fail.Exception, match="LUSK_TEST_ALLOW_SCHEMA_CLEANUP=1"):
        next(mean_db.__wrapped__(None))


def test_guarded_run_skips_normally_without_test_dsns(monkeypatch):
    for name in ("LUSK_TEST_PUBLISH_DSN", "LUSK_TEST_READ_DSN",
                 "LUSK_TEST_DATABASE_NAME", "LUSK_TEST_DATABASE_PREFIX",
                 "LUSK_TEST_ALLOW_SCHEMA_CLEANUP"):
        monkeypatch.delenv(name, raising=False)
    with pytest.raises(pytest.skip.Exception):
        next(mean_db.__wrapped__(None))


def test_network_partition_means_share_one_measured_population_and_add_up(mean_db):
    client, pool = _client(mean_db)
    try:
        total = _mean(client, mean_db, OFFRE, detail="total_longueur")
        protege = _mean(client, mean_db, OFFRE, detail="protege_longueur")
        partage = _mean(client, mean_db, OFFRE, detail="partage_longueur")
    finally:
        _close(pool)

    total_result = total["result"]
    expected_population = sorted([mean_db["focal"], *mean_db["peers"][:2]])
    for body, value, unit, detail in (
            (total, 7.0, "km", "total_longueur"),
            (protege, 7 / 3, "km", "protege_longueur"),
            (partage, 14 / 3, "km", "partage_longueur")):
        result = body["result"]
        assert result["statistic"] == "mean"
        assert result["mean"] == pytest.approx(value)
        assert "median" not in result
        assert result["eligible_members"] == expected_population
        assert result["eligible_count"] == 3 and result["missing_count"] == 2
        assert result["selected_member_count"] == 5
        assert result["unit"] == unit
        assert result["status"] == "available" and result["reason"] is None
        assert result["source_facet"] == {"detail": detail, "sex": None}
        assert [source["source_id"] for source in result["comparison_sources"]] == [
            "osm_reseaux"]
        assert body["profile_content_version"] == "profiles-v1"
        assert body["reference_content_version"] == "ref-v1"
        assert body["scope"] == {"kind": "explicit_selection", "member_count": 5}
        assert body["selection"] == [
            {"territory_type": "commune", "territory_id": member}
            for member in [mean_db["focal"], *mean_db["peers"][:4]]]

    # The compared total is the sum of its two equally-populated partitions.
    assert total_result["mean"] == pytest.approx(
        protege["result"]["mean"] + partage["result"]["mean"])
    # Focal is second of three: 10.0 beats its 8.0 under high-is-better.
    assert (total_result["rank"], total_result["rank_size"],
            total_result["rank_ties"]) == (2, 3, 1)


def test_normalized_network_partition_means_use_the_same_population(mean_db):
    client, pool = _client(mean_db)
    try:
        protege = _mean(client, mean_db, OFFRE, detail="protege_km_1000")
        partage = _mean(client, mean_db, OFFRE, detail="partage_km_1000")
    finally:
        _close(pool)
    population = sorted([mean_db["focal"], *mean_db["peers"][:2]])
    for body, value in ((protege, 14 / 3), (partage, 28 / 3)):
        result = body["result"]
        assert result["statistic"] == "mean"
        assert result["mean"] == pytest.approx(value)
        assert result["eligible_members"] == population
        assert result["unit"] == "km / 1 000 hab"


def test_routes_and_details_expose_mean_while_default_median_is_unchanged(mean_db):
    client, pool = _client(mean_db)
    try:
        default = _mean(client, mean_db, RESEAUX_HABITANT)
        median = client.post("/api/resources/read", json=_selected(
            RESEAUX_HABITANT, mean_db["focal"],
            [mean_db["focal"], *mean_db["peers"][:4]], statistic=None))
        assert median.status_code == 200, median.text
        reseaux = _mean(client, mean_db, RESEAUX)
    finally:
        _close(pool)

    result = default["result"]
    # Bike detail: (2,4,6,20) over four communes; mean differs from the median.
    assert result["statistic"] == "mean"
    assert result["mean"] == pytest.approx(8.0)
    assert result["eligible_members"] == sorted(
        [mean_db["focal"], *mean_db["peers"][:2], mean_db["peers"][3]])
    assert result["unit"] == "km / 1 000 hab."
    assert (result["rank"], result["rank_size"], result["rank_ties"]) == (4, 4, 1)

    median_result = median.json()["result"]
    assert median_result["statistic"] == "median"
    assert median_result["median"] == pytest.approx(5.0)
    assert "mean" not in median_result and "eligible_members" not in median_result
    assert median_result["eligible_count"] == 4 and median_result["missing_count"] == 1

    reseaux_result = reseaux["result"]
    assert reseaux_result["statistic"] == "mean"
    assert reseaux_result["mean"] == pytest.approx(8 / 3)
    assert reseaux_result["eligible_members"] == sorted(
        [mean_db["focal"], *mean_db["peers"][:2]])
    # Peer 1's measured zero is eligible; the focal is last under high-better.
    assert (reseaux_result["rank"], reseaux_result["rank_size"],
            reseaux_result["rank_ties"]) == (3, 3, 1)


def test_equal_eligible_counts_with_different_identities_are_exposed_truthfully(mean_db):
    client, pool = _client(mean_db)
    try:
        walk = _mean(client, mean_db, RESEAUX_HABITANT, detail="t_km_1000")
        bike = _mean(client, mean_db, RESEAUX_HABITANT, detail="b_km_1000")
    finally:
        _close(pool)
    walk_result, bike_result = walk["result"], bike["result"]
    assert walk_result["eligible_count"] == bike_result["eligible_count"] == 4
    assert walk_result["eligible_members"] == sorted(
        [mean_db["focal"], *mean_db["peers"][:3]])
    assert bike_result["eligible_members"] == sorted(
        [mean_db["focal"], *mean_db["peers"][:2], mean_db["peers"][3]])
    # Equal counts alone never prove a shared population.
    assert set(walk_result["eligible_members"]) != set(bike_result["eligible_members"])


def test_measured_zero_is_eligible_and_missing_is_never_a_zero(mean_db):
    client, pool = _client(mean_db)
    try:
        protege = _mean(client, mean_db, OFFRE, detail="protege_longueur")
        missing_only = _mean(client, mean_db, OFFRE, detail="total_longueur",
                             members=[mean_db["peers"][3]])
    finally:
        _close(pool)
    # Peer 1's zero is a real measurement and stays in the population.
    assert mean_db["peers"][0] in protege["result"]["eligible_members"]
    assert protege["result"]["mean"] == pytest.approx(7 / 3)
    empty_result = missing_only["result"]
    assert empty_result["status"] == "unavailable"
    assert empty_result["mean"] is None
    assert empty_result["eligible_members"] == []
    assert empty_result["reason"] == "no_selected_comparable_values"
    assert empty_result["missing_count"] == 1


def test_empty_selection_has_no_fallback_population(mean_db):
    client, pool = _client(mean_db)
    try:
        body = _mean(client, mean_db, OFFRE, detail="total_longueur", members=[])
    finally:
        _close(pool)
    result = body["result"]
    assert body["scope"] == {"kind": "explicit_selection", "member_count": 0}
    assert body["selection"] == []
    assert result["status"] == "unavailable"
    assert result["mean"] is None and result["eligible_members"] == []
    assert result["selected_member_count"] == 0


def test_mean_outside_the_focal_population_keeps_the_focal_semantics(mean_db):
    client, pool = _client(mean_db)
    try:
        body = _mean(client, mean_db, OFFRE, detail="total_longueur",
                     members=mean_db["peers"][:3])
    finally:
        _close(pool)
    result = body["result"]
    # Peers 1 and 2 are measured (3 and 10); peer 3 is missing. The focal is
    # outside the requested population, so it keeps no served rank.
    assert result["mean"] == pytest.approx((3.0 + 10.0) / 2)
    assert result["eligible_members"] == sorted(mean_db["peers"][:2])
    assert result["focal_in_selection"] is False
    assert (result["rank"], result["rank_size"], result["rank_ties"]) == (None, None, None)


def test_v2_batch_serves_all_network_means_from_one_envelope(mean_db):
    client, pool = _client(mean_db)
    members = [mean_db["focal"], *mean_db["peers"][:4]]
    items = [
        {"id": "total", **_selected(OFFRE, mean_db["focal"], members,
                                    coordinates={"detail": ["total_longueur"]})},
        {"id": "protege", **_selected(OFFRE, mean_db["focal"], members,
                                      coordinates={"detail": ["protege_longueur"]})},
        {"id": "partage", **_selected(OFFRE, mean_db["focal"], members,
                                      coordinates={"detail": ["partage_longueur"]})},
        {"id": "bike", **_selected(RESEAUX_HABITANT, mean_db["focal"], members)},
        {"id": "reseaux", **_selected(RESEAUX, mean_db["focal"], members)},
    ]
    try:
        response = client.post("/api/resources/read-batch", json={
            "contract": "semantic-read-batch-v2", "items": items})
        single_item = {key: value for key, value in items[0].items() if key != "id"}
        single = client.post("/api/resources/read", json=single_item)
    finally:
        _close(pool)
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["contract"] == "semantic-read-batch-v2"
    assert [result["id"] for result in payload["results"]] == [
        "total", "protege", "partage", "bike", "reseaux"]
    by_id = {result["id"]: result for result in payload["results"]}
    assert all(result["status"] == "available" for result in by_id.values())
    assert by_id["total"]["data"]["result"]["mean"] == pytest.approx(7.0)
    assert by_id["total"]["data"]["result"]["eligible_members"] == sorted(
        [mean_db["focal"], *mean_db["peers"][:2]])
    assert by_id["bike"]["data"]["result"]["mean"] == pytest.approx(8.0)
    assert by_id["total"]["data"] == single.json()
    assert by_id["total"]["data"]["profile_content_version"] == "profiles-v1"


def test_v2_absent_profile_publication_is_a_typed_outcome_not_a_zero(mean_db):
    client, pool = _client(mean_db)
    items = [
        {"id": "healthy", **_selected(OFFRE, mean_db["focal"],
                                      [mean_db["focal"], *mean_db["peers"][:4]],
                                      coordinates={"detail": ["total_longueur"]})},
        {"id": "absent", "resource": "structure_age",
         "target": {"kind": "territory", "type": "commune", "id": mean_db["focal"]},
         "intent": {"kind": "selected_comparison", "statistic": "mean",
                    "members": [{"type": "commune", "id": mean_db["focal"]},
                                {"type": "commune", "id": mean_db["peers"][0]}]}},
    ]
    try:
        response = client.post("/api/resources/read-batch", json={
            "contract": "semantic-read-batch-v2", "items": items})
    finally:
        _close(pool)
    assert response.status_code == 200, response.text
    results = {result["id"]: result for result in response.json()["results"]}
    assert results["healthy"]["status"] == "available"
    absent = results["absent"]
    assert absent["status"] == "publication_unavailable"
    assert absent["reason"] == "publication_absent"
    assert absent["family"] == "profile"
    assert "data" not in absent and "mean" not in absent


def test_invalid_or_unsupported_statistic_combinations_are_rejected(mean_db):
    client, pool = _client(mean_db)
    members = [mean_db["focal"], mean_db["peers"][0]]
    try:
        mean_field_without_statistic = client.post("/api/resources/read", json=_selected(
            OFFRE, mean_db["focal"], members, statistic=None,
            coordinates={"detail": ["total_longueur"]}, fields=["mean"]))
        median_field_with_mean = client.post("/api/resources/read", json=_selected(
            OFFRE, mean_db["focal"], members, fields=["median"],
            coordinates={"detail": ["total_longueur"]}))
        scalar_statistic = client.post("/api/resources/read", json=_selected(
            "densite", mean_db["focal"], members))
        fixed_statistic = client.post("/api/resources/read", json={
            "resource": OFFRE,
            "target": {"kind": "territory", "type": "commune", "id": mean_db["focal"]},
            "intent": {"kind": "fixed_comparison", "context": "default",
                       "statistic": "mean"}})
        unknown_statistic = client.post("/api/resources/read", json=_selected(
            OFFRE, mean_db["focal"], members, statistic="mode",
            coordinates={"detail": ["total_longueur"]}))
        unknown_detail = client.post("/api/resources/read", json=_selected(
            OFFRE, mean_db["focal"], members, coordinates={"detail": ["nope"]}))
        requested_mean_field = client.post("/api/resources/read", json=_selected(
            OFFRE, mean_db["focal"], members, fields=["mean"],
            coordinates={"detail": ["total_longueur"]}))
    finally:
        _close(pool)
    for response in (mean_field_without_statistic, median_field_with_mean,
                     scalar_statistic, fixed_statistic, unknown_statistic, unknown_detail):
        assert response.status_code == 422, response.text
    assert requested_mean_field.status_code == 200, requested_mean_field.text
    projected = requested_mean_field.json()["result"]
    assert projected["statistic"] == "mean"
    assert projected["mean"] == pytest.approx((8.0 + 3.0) / 2)
    # Mandatory identity evidence survives an explicit field projection.
    assert projected["eligible_members"] == sorted(members)
    assert "median" not in projected


def test_reference_mismatch_fails_closed_while_mean_reads_commit_snapshot(mean_db):
    import psycopg

    client, pool = _client(mean_db)
    try:
        with psycopg.connect(mean_db["publisher_dsn"], autocommit=True) as writer:
            writer.execute(f'SET search_path TO "{mean_db["schema"]}"')
            writer.execute("""UPDATE table_publication SET reference_content_version='ref-v2'
                WHERE table_name='declared_profile'""")
        try:
            stale = client.post("/api/resources/read", json=_selected(
                OFFRE, mean_db["focal"], [mean_db["focal"], mean_db["peers"][0]],
                coordinates={"detail": ["total_longueur"]}))
        finally:
            with psycopg.connect(mean_db["publisher_dsn"], autocommit=True) as writer:
                writer.execute(f'SET search_path TO "{mean_db["schema"]}"')
                writer.execute("""UPDATE table_publication
                    SET reference_content_version='ref-v1'
                    WHERE table_name='declared_profile'""")
        restored = _mean(client, mean_db, OFFRE, detail="total_longueur")
    finally:
        _close(pool)
    assert stale.status_code == 503
    assert "results" not in stale.json()
    assert restored["result"]["mean"] == pytest.approx(7.0)


def test_mean_request_respects_the_shared_work_limit(mean_db, monkeypatch):
    from api import resource_execution

    client, pool = _client(mean_db)
    members = [mean_db["focal"], *mean_db["peers"][:4]]
    items = [{"id": f"mean-{index}", **_selected(
        OFFRE, mean_db["focal"], members, coordinates={"detail": [detail]})}
        for index, detail in enumerate(("total_longueur", "protege_longueur",
                                        "partage_longueur"))]
    try:
        assert client.post("/api/resources/read-batch",
                           json={"items": items}).status_code == 200
        single_item = {key: value for key, value in items[0].items() if key != "id"}
        monkeypatch.setattr(resource_execution, "MAX_WORK_UNITS", 10)
        over_budget = client.post("/api/resources/read", json=single_item)
        over_budget_batch = client.post("/api/resources/read-batch",
                                        json={"items": items})
    finally:
        monkeypatch.undo()
        _close(pool)
    assert over_budget.status_code == 413, over_budget.text
    assert over_budget_batch.status_code == 413, over_budget_batch.text
