"""Guarded HTTP proof for the v2 shared publication-outcome batch (issue #984).

Runs only against the operator-owned ``lusk_it_contract`` database with the
dedicated ``lusk_it_contract_pub`` / ``lusk_it_contract_read`` roles, a private
``PGPASSFILE`` and a random disposable schema. A named process mutex serializes
the whole guarded run with the concurrent publisher worker. Every schema this
file creates is dropped and the database's schema/byte state is verified before
the lock is released; no proof here is a retained fixture.
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
MUTEX_TIMEOUT_MS = 180_000
REQUIRED_FAMILIES = {"scalar", "profile", "ordered_series", "named_reference",
                     "typed_reading", "collection", "aedar"}
REFUELLING_KEYS = ("bornes_recharge", "bornes_recharge_1000",
                   "bornes_ev_par_station_service")


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
    handle = _acquire_mutex()
    try:
        yield
    finally:
        _release_mutex(handle)


def _guarded_configuration_or_skip():
    """Resolve the exact guarded target and require explicit cleanup opt-in.

    Ordinary collection without test DSNs skips normally. A guarded run that
    could connect must fail before its first connection/DDL unless cleanup is
    explicitly enabled; this suite never retains fixtures.
    """
    publish_dsn, read_dsn = _aedar_guarded_configuration()
    if os.environ.get("LUSK_TEST_ALLOW_SCHEMA_CLEANUP") != "1":
        pytest.fail("guarded #984 v2 proof requires LUSK_TEST_ALLOW_SCHEMA_CLEANUP=1 "
                    "before any database connection or DDL")
    return publish_dsn, read_dsn


@pytest.fixture(scope="module")
def outcome_db(integration_db_mutex):
    psycopg = pytest.importorskip("psycopg")
    publish_dsn, read_dsn = _guarded_configuration_or_skip()
    schema = "it_outcome_" + uuid.uuid4().hex[:16]
    scoped_publish = _dsn_with_schema(publish_dsn, schema)
    scoped_read = _dsn_with_schema(read_dsn, schema)
    schema_sql = (Path(__file__).resolve().parents[2] / "schema.sql").read_text(encoding="utf-8")
    created = False
    state_before = state_after = None
    with _guarded_identity(publish_dsn, read_dsn) as (publisher, _reader):
        state_before = (_user_schemas(publisher), _public_relations(publisher),
                        _database_bytes(publisher))
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
                _seed(publisher)
        yield {"publish_dsn": scoped_publish, "read_dsn": scoped_read,
               "schema": schema, "publisher_dsn": publish_dsn,
               "read_role": urlsplit(read_dsn).username}
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
                if not set(state_after[0]) <= set(state_before[0]):
                    pytest.fail(f"guarded run introduced a user schema: "
                                f"{sorted(set(state_after[0]) - set(state_before[0]))}")
                print(f"guarded database bytes: before={state_before[2]} "
                      f"after={state_after[2]} schemas_before={state_before[0]} "
                      f"schemas_after={state_after[0]}", flush=True)


@pytest.mark.parametrize("flag", [None, "0", "true", ""])
def test_guarded_run_refuses_without_cleanup_opt_in_before_any_connection(monkeypatch, flag):
    import psycopg

    if flag is None:
        monkeypatch.delenv("LUSK_TEST_ALLOW_SCHEMA_CLEANUP", raising=False)
    else:
        monkeypatch.setenv("LUSK_TEST_ALLOW_SCHEMA_CLEANUP", flag)
    monkeypatch.setattr(psycopg, "connect",
                        lambda *args, **kwargs: pytest.fail("database connection attempted"))
    with pytest.raises(pytest.fail.Exception, match="LUSK_TEST_ALLOW_SCHEMA_CLEANUP=1"):
        next(outcome_db.__wrapped__(None))


def test_guarded_run_skips_normally_without_test_dsns(monkeypatch):
    for name in ("LUSK_TEST_PUBLISH_DSN", "LUSK_TEST_READ_DSN",
                 "LUSK_TEST_DATABASE_NAME", "LUSK_TEST_DATABASE_PREFIX",
                 "LUSK_TEST_ALLOW_SCHEMA_CLEANUP"):
        monkeypatch.delenv(name, raising=False)
    with pytest.raises(pytest.skip.Exception):
        next(outcome_db.__wrapped__(None))


def _seed(connection):
    connection.execute("""INSERT INTO territory_reference(
        territory_id,territory_type,name,department_id,epci_id,density_class_code,density_class_label)
        VALUES ('oc-c1','commune','Commune 1','29','oc-e1','D1','Dense'),
               ('oc-c2','commune','Commune 2','29','oc-e2','D2','Peu dense'),
               ('oc-c3','commune','Commune 3','22','oc-e2','D2','Peu dense'),
               ('oc-e1','epci','EPCI 1','29',NULL,NULL,NULL),
               ('oc-e2','epci','EPCI 2','22',NULL,NULL,NULL),
               ('29','departement','Finistère',NULL,NULL,NULL,NULL),
               ('53','region','Bretagne',NULL,NULL,NULL,NULL)""")
    connection.execute("""INSERT INTO table_publication(table_name,content_version,row_count)
        VALUES ('territory_reference','oc-ref-v1',7)""")
    connection.execute("""INSERT INTO source_dataset(source_id,name)
        VALUES ('oc-source','Outcome source')""")
    connection.execute("""INSERT INTO source_vintage(source_id,vintage_id,version,reference_date,publication_date)
        VALUES ('oc-source','oc-v1','2026','2026-01-01','2026-01-02')""")
    connection.execute("""INSERT INTO scalar_descriptor(indicator_id,theme_id,label,unit,direction,
        comparison_facet,allowed_levels,denominator_semantics,completeness,descriptor_version)
        VALUES ('densite','demographie','Densité de population','hab./km²','high','densite',
            ARRAY['commune','epci','departement'],'population','dense_complete','oc-descriptor-v1')""")
    connection.execute("INSERT INTO scalar_descriptor_source VALUES ('densite','oc-source')")
    for territory_id, value, support, denominator in (
            ("oc-c1", 12.5, 100, 200), ("oc-c2", 20.0, 150, 300)):
        connection.execute("""INSERT INTO scalar_observation(
            indicator_id,territory_id,territory_type,value,status,support_count,denominator_count)
            VALUES ('densite',%s,'commune',%s,'measured',%s,%s)""",
            (territory_id, value, support, denominator))
        connection.execute("""INSERT INTO scalar_observation_source
            VALUES ('densite',%s,'oc-source','oc-v1')""", (territory_id,))
    connection.execute("""INSERT INTO table_publication(
        table_name,content_version,row_count,reference_content_version)
        VALUES ('scalar_observation','oc-scalar-v1',2,'oc-ref-v1')""")


def _client(db, monkeypatch):
    import psycopg_pool
    from fastapi.testclient import TestClient
    from api import main

    pool = psycopg_pool.ConnectionPool(conninfo=db["read_dsn"], min_size=0, max_size=4,
                                       open=True, kwargs={"autocommit": True})
    repository = main.ReadRepository(pool)
    main.app.dependency_overrides[main.get_repository] = lambda: repository
    main.app.dependency_overrides[main.get_resource_catalogue] = main.default_resource_catalogue
    return TestClient(main.app), pool


def _close(db, pool):
    from api import main
    main.app.dependency_overrides.clear()
    pool.close()


def _item(item_id, resource, *, target=None, intent=None, **extra):
    return {"id": item_id, "resource": resource,
            "target": target or {"kind": "territory", "type": "commune", "id": "oc-c1"},
            "intent": intent or {"kind": "facts"}, **extra}


def _v2(items):
    return {"contract": "semantic-read-batch-v2", "items": items}


def _by_id(payload):
    return {result["id"]: result for result in payload["results"]}


def _refuelling_items():
    """Three actual refuelling scalar keys, all unpublished in this fixture."""
    items = []
    for key in REFUELLING_KEYS:
        items.extend([
            _item(f"{key}-facts", key),
            _item(f"{key}-fixed", key,
                  intent={"kind": "fixed_comparison", "context": "default"}),
            _item(f"{key}-selected", key,
                  intent={"kind": "selected_comparison", "members": [
                      {"type": "commune", "id": "oc-c1"},
                      {"type": "commune", "id": "oc-c2"}]}),
        ])
    return items


def test_v2_mixed_batch_across_all_publication_families(outcome_db, monkeypatch):
    client, pool = _client(outcome_db, monkeypatch)
    refuelling = _refuelling_items()
    items = [
        _item("scalar", "densite"),
        _item("comparison", "densite",
              intent={"kind": "selected_comparison", "members": [
                  {"type": "commune", "id": "oc-c1"}, {"type": "commune", "id": "oc-c2"}]},
              fields=["median", "rank", "rank_size"]),
        _item("cohort", "densite",
              target={"kind": "territory_cohort", "type": "commune"}),
        *refuelling,
        _item("profile", "structure_age"),
        _item("series", "prix_m2"),
        _item("named-reference", "raccordement_reference",
              target={"kind": "named_reference", "id": "bretagne_all_assessed_communes_mean"}),
        _item("aedar-summary", "aedar_territory_summary"),
        _item("aedar-source", "aedar_territorial_aggregate"),
        _item("typed-reading", "demographie_selected_reading"),
        _item("collection", "subventions_par_domaine"),
    ]
    try:
        response = client.post("/api/resources/read-batch", json=_v2(items))
    finally:
        _close(outcome_db, pool)
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["contract"] == "semantic-read-batch-v2"
    assert [result["id"] for result in payload["results"]] == [item["id"] for item in items]
    results = _by_id(payload)
    assert results["scalar"]["status"] == "available"
    scalar = results["scalar"]["data"]
    assert scalar["value"] == 12.5
    assert scalar["status"] == "measured"
    assert scalar["unit"] == "hab./km²"
    assert scalar["descriptor_version"] == "oc-descriptor-v1"
    assert scalar["content_version"] == "oc-scalar-v1"
    assert scalar["reference_content_version"] == "oc-ref-v1"
    assert scalar["sources"] == [{
        "source_id": "oc-source", "name": "Outcome source", "vintage_id": "oc-v1",
        "version": "2026", "reference_date": scalar["sources"][0]["reference_date"],
        "publication_date": scalar["sources"][0]["publication_date"]}]
    assert str(scalar["sources"][0]["reference_date"]).startswith("2026-01-01")
    assert str(scalar["sources"][0]["publication_date"]).startswith("2026-01-02")

    comparison = results["comparison"]["data"]["result"]
    assert comparison["median"] == 16.25
    assert comparison["rank"] == 2 and comparison["rank_size"] == 2
    assert comparison["unit"] == "hab./km²"

    cohort = results["cohort"]["data"]
    assert cohort["shape"] == "scalar"
    assert cohort["cohort"]["member_count"] == 3
    assert {member["id"] for member in cohort["cohort"]["members"]} == {"oc-c1", "oc-c2", "oc-c3"}
    assert {row["territory"]["id"] for row in cohort["observations"]} == {"oc-c1", "oc-c2"}
    assert results["cohort"]["status"] == "available"

    expected = {"profile": "profile", "series": "ordered_series",
                "named-reference": "named_reference", "aedar-summary": "aedar",
                "aedar-source": "aedar", "typed-reading": "typed_reading",
                "collection": "collection"}
    for item_id, family in expected.items():
        outcome = results[item_id]
        assert outcome["status"] == "publication_unavailable", item_id
        assert outcome["reason"] == "publication_absent"
        assert outcome["family"] == family, item_id
        assert "data" not in outcome
    for brick in refuelling:
        outcome = results[brick["id"]]
        assert outcome["status"] == "publication_unavailable", brick["id"]
        assert outcome["reason"] == "publication_absent"
        assert outcome["family"] == "scalar", brick["id"]
        assert "data" not in outcome
        assert "content_version" not in outcome and "reference_content_version" not in outcome


def test_v2_all_unavailable_is_a_valid_envelope_and_v1_stays_atomic(outcome_db, monkeypatch):
    client, pool = _client(outcome_db, monkeypatch)
    refuelling = _refuelling_items()
    items = [
        _item("profile", "structure_age"),
        _item("series", "prix_m2"),
        _item("comparison", "densite",
              intent={"kind": "fixed_comparison", "context": "default"}),
        *refuelling,
        _item("aedar", "aedar_territory_summary"),
        _item("typed-reading", "demographie_selected_reading"),
        _item("collection", "subventions_par_domaine"),
    ]
    try:
        v2 = client.post("/api/resources/read-batch", json=_v2(items))
        v1 = client.post("/api/resources/read-batch", json={"items": items})
    finally:
        _close(outcome_db, pool)
    assert v2.status_code == 200, v2.text
    assert all(result["status"] == "publication_unavailable"
               for result in v2.json()["results"])
    assert {result["family"] for result in v2.json()["results"]} == {
        "profile", "ordered_series", "scalar", "aedar", "typed_reading", "collection"}
    assert v1.status_code == 503
    assert "results" not in v1.json()


def test_v2_hard_request_and_global_integrity_failures_abort_the_request(outcome_db, monkeypatch):
    import psycopg
    client, pool = _client(outcome_db, monkeypatch)
    try:
        unknown = client.post("/api/resources/read-batch", json=_v2([
            _item("ok", "densite"),
            _item("unknown", "densite", target={"kind": "territory", "type": "commune",
                                                "id": "oc-missing"})]))
        wrong_level = client.post("/api/resources/read-batch", json=_v2([
            _item("wrong", "densite", target={"kind": "territory", "type": "epci",
                                              "id": "oc-c1"})]))
        missing_member = client.post("/api/resources/read-batch", json=_v2([
            _item("member", "densite", intent={"kind": "selected_comparison", "members": [
                {"type": "commune", "id": "oc-c1"}, {"type": "commune", "id": "oc-nope"}]})]))
        unpublished_unknown_target = client.post("/api/resources/read-batch", json=_v2([
            _item("healthy", "densite"),
            _item("unpublished-unknown", "bornes_recharge_1000",
                  target={"kind": "territory", "type": "commune", "id": "oc-missing"})]))
        unpublished_unknown_member = client.post("/api/resources/read-batch", json=_v2([
            _item("healthy", "densite"),
            _item("unpublished-member", "bornes_recharge_1000",
                  intent={"kind": "selected_comparison", "members": [
                      {"type": "commune", "id": "oc-c1"},
                      {"type": "commune", "id": "oc-nope"}]})]))
        unpublished_wrong_member_type = client.post("/api/resources/read-batch", json=_v2([
            _item("unpublished-member-type", "bornes_recharge_1000",
                  intent={"kind": "selected_comparison", "members": [
                      {"type": "epci", "id": "oc-c1"}]})]))
        with psycopg.connect(outcome_db["publisher_dsn"], autocommit=True) as publisher:
            publisher.execute(f'SET search_path TO "{outcome_db["schema"]}"')
            publisher.execute("""UPDATE table_publication
                SET reference_content_version='oc-old-ref'
                WHERE table_name='scalar_observation'""")
        stale = client.post("/api/resources/read-batch", json=_v2([
            _item("stale", "densite"), _item("absent", "structure_age")]))
        with psycopg.connect(outcome_db["publisher_dsn"], autocommit=True) as publisher:
            publisher.execute(f'SET search_path TO "{outcome_db["schema"]}"')
            publisher.execute("""UPDATE table_publication
                SET reference_content_version='oc-ref-v1'
                WHERE table_name='scalar_observation'""")
    finally:
        _close(outcome_db, pool)
    assert unknown.status_code == 404
    assert wrong_level.status_code == 422
    assert missing_member.status_code == 404
    assert unpublished_unknown_target.status_code == 404
    assert unpublished_unknown_target.json() == {"detail": "Focal territory not found"}
    assert unpublished_unknown_member.status_code == 404
    assert unpublished_unknown_member.json() == {"detail": "Selected comparison territory not found"}
    assert unpublished_wrong_member_type.status_code == 422
    for response in (unknown, wrong_level, missing_member, unpublished_unknown_target,
                     unpublished_unknown_member, unpublished_wrong_member_type):
        assert "results" not in response.json()
    assert stale.status_code == 503
    assert "results" not in stale.json()
    assert stale.json()["detail"] == "Scalar publication is stale or incompatible"


def test_publication_change_between_items_keeps_one_repeatable_read_snapshot(outcome_db, monkeypatch):
    import psycopg
    from api import main

    client, pool = _client(outcome_db, monkeypatch)
    real_reader = main.get_semantic_resource_reader()

    class UpdatingReader:
        def preflight(self, conn, item, catalogue=None, *, work_budget=None, snapshot_state=None):
            return real_reader.preflight(conn, item, catalogue, work_budget=work_budget,
                                         snapshot_state=snapshot_state)

        def read(self, conn, item, catalogue=None, *, snapshot_state=None):
            data = real_reader.read(conn, item, catalogue, snapshot_state=snapshot_state)
            if getattr(item, "id", None) == "first":
                with psycopg.connect(outcome_db["publisher_dsn"], autocommit=True) as publisher:
                    publisher.execute(f'SET search_path TO "{outcome_db["schema"]}"')
                    publisher.execute("""UPDATE scalar_observation SET value=99.0
                        WHERE indicator_id='densite' AND territory_id='oc-c1'""")
            return data

    main.app.dependency_overrides[main.get_semantic_resource_reader] = lambda: UpdatingReader()
    try:
        response = client.post("/api/resources/read-batch", json=_v2([
            _item("first", "densite"), _item("second", "densite", fields=["value"])]))
        fresh = client.post("/api/resources/read", json={
            "resource": "densite",
            "target": {"kind": "territory", "type": "commune", "id": "oc-c1"},
            "intent": {"kind": "facts"}, "fields": ["value"]})
    finally:
        _close(outcome_db, pool)
        with psycopg.connect(outcome_db["publisher_dsn"], autocommit=True) as publisher:
            publisher.execute(f'SET search_path TO "{outcome_db["schema"]}"')
            publisher.execute("""UPDATE scalar_observation SET value=12.5
                WHERE indicator_id='densite' AND territory_id='oc-c1'""")
    assert response.status_code == 200, response.text
    results = _by_id(response.json())
    assert results["first"]["data"]["value"] == 12.5
    assert results["second"]["data"]["value"] == 12.5
    assert fresh.status_code == 200
    assert fresh.json()["value"] == 99.0


def test_database_fault_is_never_softened_into_a_publication_outcome(outcome_db, monkeypatch):
    import psycopg
    from fastapi.testclient import TestClient
    from api import main
    import psycopg_pool

    pool = psycopg_pool.ConnectionPool(conninfo=outcome_db["read_dsn"], min_size=0, max_size=2,
                                       open=True, kwargs={"autocommit": True})
    main.app.dependency_overrides[main.get_repository] = lambda: main.ReadRepository(pool)
    main.app.dependency_overrides[main.get_resource_catalogue] = main.default_resource_catalogue
    quoted = '"' + outcome_db["read_role"].replace('"', '""') + '"'
    try:
        with psycopg.connect(outcome_db["publisher_dsn"], autocommit=True) as publisher:
            publisher.execute(f'SET search_path TO "{outcome_db["schema"]}"')
            publisher.execute(f'REVOKE SELECT ON scalar_observation FROM {quoted}')
        response = TestClient(main.app, raise_server_exceptions=False).post(
            "/api/resources/read-batch", json=_v2([
                _item("scalar", "densite"), _item("profile", "structure_age")]))
    finally:
        with psycopg.connect(outcome_db["publisher_dsn"], autocommit=True) as publisher:
            publisher.execute(f'SET search_path TO "{outcome_db["schema"]}"')
            publisher.execute(f'GRANT SELECT ON scalar_observation TO {quoted}')
        main.app.dependency_overrides.clear()
        pool.close()
    assert response.status_code >= 500
    assert b"results" not in response.content
