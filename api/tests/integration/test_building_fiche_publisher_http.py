"""Canonical building evidence must flow through its R publication into fiche HTTP."""
from __future__ import annotations

import json
import math
import os
from urllib.parse import parse_qs, urlencode, urlsplit, urlunsplit

import pytest

pytestmark = pytest.mark.integration


def _assert_canonical_equal(actual, expected):
    if isinstance(actual, dict) and isinstance(expected, dict):
        assert actual.keys() == expected.keys()
        for key in expected:
            _assert_canonical_equal(actual[key], expected[key])
    elif isinstance(actual, list) and isinstance(expected, list):
        assert len(actual) == len(expected)
        for left, right in zip(actual, expected):
            _assert_canonical_equal(left, right)
    elif isinstance(actual, (int, float)) and not isinstance(actual, bool) and isinstance(expected, (int, float)):
        assert math.isclose(actual, expected, rel_tol=1e-12, abs_tol=1e-12)
    else:
        assert actual == expected


class _ConnectionProbe:
    def __init__(self, connection, statements):
        self._connection = connection
        self.statements = statements

    def execute(self, query, *args, **kwargs):
        self.statements.append(str(query))
        return self._connection.execute(query, *args, **kwargs)

    def transaction(self, *args, **kwargs):
        return self._connection.transaction(*args, **kwargs)

    def __getattr__(self, name):
        return getattr(self._connection, name)


class _ConnectionProbePool:
    def __init__(self, pool):
        self.pool = pool
        self.statements = []

    def connection(self):
        pool = self.pool
        probe_pool = self

        class Context:
            def __enter__(self):
                self.context = pool.connection()
                self.connection = self.context.__enter__()
                return _ConnectionProbe(self.connection, probe_pool.statements)

            def __exit__(self, *args):
                return self.context.__exit__(*args)

        return Context()


def test_registered_canonical_building_publisher_reaches_fiche_http():
    schema = os.getenv("LUSK_BUILDING_FICHE_HTTP_SCHEMA")
    territory = os.getenv("LUSK_BUILDING_FICHE_HTTP_TERRITORY", "35238")
    manifest_path = os.getenv("LUSK_BUILDING_FICHE_HTTP_MANIFEST")
    read_dsn = os.getenv("LUSK_TEST_READ_DSN")
    if not all((schema, manifest_path, read_dsn)):
        pytest.skip("invoked by canonical building fiche PostgreSQL smoke")

    import psycopg
    from fastapi.testclient import TestClient
    from psycopg_pool import ConnectionPool
    from api import main

    with open(manifest_path, encoding="utf-8") as manifest_file:
        expected = json.load(manifest_file)
    parts = urlsplit(read_dsn)
    query = parse_qs(parts.query, keep_blank_values=True)
    query["options"] = [f"-csearch_path={schema}"]
    scoped_dsn = urlunsplit((parts.scheme, parts.netloc, parts.path,
                             urlencode(query, doseq=True), parts.fragment))
    pool = ConnectionPool(conninfo=scoped_dsn, min_size=1, max_size=1, open=True,
                          kwargs={"autocommit": True})
    probe_pool = _ConnectionProbePool(pool)
    previous = main.app.dependency_overrides.get(main.get_repository)
    main.app.dependency_overrides[main.get_repository] = lambda: main.ReadRepository(probe_pool)
    try:
        with TestClient(main.app) as client:
            start = len(probe_pool.statements)
            focal_response = client.get(
                f"/api/territories/commune/{territory}/themes/mobilite/facts")
            fact_statements = probe_pool.statements[start:]
            assert sum(statement.startswith("SET TRANSACTION") for statement in fact_statements) == 1
            assert focal_response.status_code == 200, focal_response.text
            focal = focal_response.json()
            assert "building_access" in focal, "theme facts omit the registered building publication"
            building = focal["building_access"]
            assert building["territory"]["id"] == territory
            assert building["availability"] == "complete"
            with pool.connection() as conn:
                markers = conn.execute("""SELECT table_name,content_version,row_count
                    FROM table_publication WHERE table_name=ANY(%s)""",
                    (["territory_reference", "building_ramp", "building_grid"],)).fetchall()
                sql_counts = {name: count for name, count in conn.execute("""
                    SELECT table_name,count(*) FROM (
                      SELECT 'territory_reference' AS table_name FROM territory_reference
                      UNION ALL SELECT 'building_ramp' FROM building_ramp
                      UNION ALL SELECT 'building_grid' FROM building_grid) rows GROUP BY table_name""").fetchall()}
            assert {row[0] for row in markers} == {"territory_reference", "building_ramp", "building_grid"}
            assert building["publication_id"] == main._building_publication(
                [(row[0],row[1]) for row in markers])
            assert sql_counts == {"territory_reference": expected["canonical_row_counts"]["reference"],
                                  "building_ramp": expected["canonical_row_counts"]["ramp"],
                                  "building_grid": expected["canonical_row_counts"]["grid"]}
            assert {name: count for name, _version, count in markers} == sql_counts
            _assert_canonical_equal(building["ramp"], expected["focal_ramp"])
            _assert_canonical_equal(building["distribution"], expected["focal_grid"])
            _assert_canonical_equal(building["peer_ramp"], expected["peer_ramp"])
            _assert_canonical_equal(building["peer_distribution"], expected["peer_grid"])
            nb_response = client.get(
                f"/api/territories/commune/{territory}/indicators/nb_buildings")
            assert nb_response.status_code == 200, nb_response.text
            nb = nb_response.json()
            for key in ("value", "unit", "label"):
                _assert_canonical_equal(nb[key], expected["nb_buildings"][key])
            assert nb["value"] == expected["nb_buildings"]["value"]
            assert nb["unit"] == expected["nb_buildings"]["unit"]
            assert nb["label"] == expected["nb_buildings"]["label"]
            assert nb["sources"][0]["source_id"] == expected["nb_buildings"]["source_id"]
            assert nb["sources"][0]["version"] == expected["nb_buildings"]["source_version"]
            assert nb["sources"][0]["reference_date"] == expected["nb_buildings"]["reference_date"]
            assert nb["sources"][0]["publication_date"] == expected["nb_buildings"]["publication_date"]
            service_reference = focal["service_reference"]
            assert service_reference["territory"] == {
                "territory_id": expected["service_reference"]["territory_id"],
                "territory_type": expected["service_reference"]["territory_type"],
                "name": expected["service_reference"]["name"],
            }
            for key in ("indicator_id", "label", "unit", "value", "status"):
                _assert_canonical_equal(service_reference[key], expected["service_reference"][key])
            assert service_reference["sources"] == [{
                "source_id": expected["service_reference"]["source_id"],
                "name": expected["service_reference"]["source_name"],
                "vintage_id": f"{expected['service_reference']['version']}/{expected['service_reference']['reference_date']}",
                "version": expected["service_reference"]["version"],
                "reference_date": expected["service_reference"]["reference_date"],
                "publication_date": expected["service_reference"]["publication_date"],
            }]
            share_facts = [fact for fact in focal["facts"] if fact["indicator_id"].startswith("share_")]
            assert share_facts and all(
                fact["denominator_count"] == nb["value"]
                for fact in share_facts if fact["status"] == "measured"
            ), [(fact["indicator_id"], fact["status"], fact["denominator_count"], nb["value"])
                for fact in share_facts]
            assert expected["building_count_parity"]["ramp"] == expected["building_count_parity"]["grid"]
            assert expected["building_count_parity"]["snapshot"] == nb["value"]
            assert expected["building_count_parity"]["snapshot"] != expected["building_count_parity"]["ramp"]

            comparison_start = len(probe_pool.statements)
            comparison_response = client.post(
                f"/api/territories/commune/{territory}/themes/mobilite/comparison",
                json={"theme_id": "mobilite"})
            comparison_statements = probe_pool.statements[comparison_start:]
            assert sum(statement.startswith("SET TRANSACTION") for statement in comparison_statements) == 1
            assert comparison_response.status_code == 200, comparison_response.text
            comparison = comparison_response.json()
            assert "building_access" in comparison, "theme comparison omits building evidence"
            peer = comparison["building_access"]
            assert "service_reference" not in comparison
            assert peer["scope"] == building["scope"]
            _assert_canonical_equal(peer["ramp"], expected["peer_ramp"])
            _assert_canonical_equal(peer["distribution"]["cells"], expected["peer_grid"]["cells"])
            assert peer["distribution"]["statistic"] == expected["peer_grid"]["statistic"]
            assert peer["distribution"]["member_count"] == expected["peer_grid"]["member_count"]
            assert peer["distribution"]["total_buildings"] == expected["peer_grid"]["total_buildings"]
            assert not any(k in peer for k in ("focal_value", "focal_ramp", "focal_grid", "fixed_reference"))
            empty_response = client.post(
                f"/api/territories/commune/{territory}/themes/mobilite/comparison",
                json={"theme_id": "mobilite", "selection": []})
            assert empty_response.status_code == 200, empty_response.text
            empty_building = empty_response.json()["building_access"]
            assert empty_building["scope"]["member_count"] == 0
            assert empty_building["ramp"] is None and empty_building["distribution"] is None
            singleton_response = client.post(
                f"/api/territories/commune/{territory}/themes/mobilite/comparison",
                json={"theme_id": "mobilite", "selection": [
                    {"territory_type": "commune", "territory_id": territory}]})
            assert singleton_response.status_code == 200, singleton_response.text
            singleton = singleton_response.json()["building_access"]
            assert singleton["ramp"] is None and singleton["distribution"] is None
            with pool.connection() as conn:
                region_id = conn.execute("SELECT territory_id FROM territory_reference WHERE territory_type='region'").fetchone()[0]
                commune_count = conn.execute("SELECT count(*) FROM territory_reference WHERE territory_type='commune'").fetchone()[0]
            overlapping_response = client.post(
                f"/api/territories/commune/{territory}/themes/mobilite/comparison",
                json={"theme_id": "mobilite", "selection": [
                    {"territory_type": "region", "territory_id": region_id},
                    {"territory_type": "commune", "territory_id": territory}]})
            assert overlapping_response.status_code == 200, overlapping_response.text
            overlapping = overlapping_response.json()
            assert overlapping["scope"]["member_count"] == commune_count
            assert overlapping["building_access"]["scope"]["member_count"] == commune_count
            _assert_canonical_equal(overlapping["building_access"]["ramp"], expected["region_peer_ramp"])
            _assert_canonical_equal(overlapping["building_access"]["distribution"]["cells"],
                                    expected["region_peer_grid"]["cells"])
            assert overlapping["building_access"]["distribution"]["total_buildings"] == expected["region_peer_grid"]["total_buildings"]
            assert not any("focal_value" in result for result in overlapping["results"])
    finally:
        if previous is None:
            main.app.dependency_overrides.pop(main.get_repository, None)
        else:
            main.app.dependency_overrides[main.get_repository] = previous
        pool.close()
