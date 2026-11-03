"""Guarded HTTP coverage for request-time AEDAR selected comparisons (#859).

Opt-in like the other integration proofs: nothing connects unless the
documented test-only DSNs, database and roles are configured. The target is
the disposable-schema `lusk_it_contract` database, never the serving `lusk`
database.
"""

from __future__ import annotations

import json
from contextlib import contextmanager

import pytest

from api.tests.integration.test_postgres_publication import canonical_db_env

pytestmark = pytest.mark.integration

TYPEQU_META = {
    "typequ_label": "ÉQUIPEMENT FIXTURE",
    "typequ_hierarchy_label": "ÉQUIPEMENT FIXTURE",
    "typequ_description": "Description fixture",
    "typequ_domain_code": "A",
    "typequ_domain_label": "Services",
    "typequ_subdomain_code": "A1",
    "typequ_subdomain_label": "Publics",
    "typequ_gamme": None,
    "typequ_gamme_status": "absent",
    "typequ_source_order": 1,
}

MEASURES = ("count_5_walk_mean", "count_5_walk_share", "count_15_car_mean", "count_5_walk_decile1")


def _aggregate_row(territory_type, territory_id, typequ, n_addresses, n_observed, measures):
    return {
        "territory_type": territory_type,
        "territory_id": territory_id,
        "typequ": typequ,
        **TYPEQU_META,
        "identity": {"code_insee": territory_id} if territory_type == "commune" else {},
        "n_addresses": n_addresses,
        "n_observed": n_observed,
        "coverage_status": "covered",
        "measures": measures,
        "source_id": "aedar_bretagne",
        "vintage_id": "2026-v1",
        "source_url": "https://example.test/aedar",
        "licence": "ODbL",
        "attribution": "AEDAR fixture",
        "reference_date": None,
        "publication_date": "2026-09-30",
    }


def _seed_aedar(publisher):
    """Seed the reference, the published aggregates and the reference-only marker."""
    publisher.execute("""INSERT INTO territory_reference(
        territory_id,territory_type,name,department_id,epci_id,density_class_code,density_class_label)
        VALUES ('sel-c1','commune','Commune 1','22','sel-e1','D1','Dense'),
               ('sel-c2','commune','Commune 2','22','sel-e1','D1','Dense'),
               ('sel-c3','commune','Commune 3','22','sel-e2','D2','Peu dense'),
               ('sel-c4','commune','Commune 4','22','sel-e2','D2','Peu dense'),
               ('sel-e1','epci','EPCI 1','22',NULL,NULL,NULL),
               ('sel-e2','epci','EPCI 2','22',NULL,NULL,NULL),
               ('22','departement','Département 22',NULL,NULL,NULL,NULL),
               ('53','region','Bretagne',NULL,NULL,NULL,NULL)""")
    publisher.execute("INSERT INTO table_publication(table_name,content_version,row_count)"
                      " VALUES ('territory_reference','b' || repeat('0',63),8)")

    rows = [
        # communes: n_addresses weights 10 / 30 / 10
        _aggregate_row("commune", "sel-c1", "A104", 10, 9,
                       {"count_5_walk_mean": 5.0, "count_5_walk_share": 0.5,
                        "count_15_car_mean": 12.0, "count_5_walk_decile1": 1.0}),
        _aggregate_row("commune", "sel-c2", "A104", 30, 25,
                       {"count_5_walk_mean": 8.0, "count_5_walk_share": 0.8,
                        "count_15_car_mean": 20.0, "count_5_walk_decile1": 2.0}),
        _aggregate_row("commune", "sel-c3", "A104", 10, 8,
                       {"count_5_walk_mean": 8.0, "count_5_walk_share": 0.8,
                        "count_15_car_mean": 20.0, "count_5_walk_decile1": 4.0}),
        _aggregate_row("commune", "sel-c1", "B207", 10, 9,
                       {"count_5_walk_mean": 2.0, "count_5_walk_decile1": 0.5}),
        _aggregate_row("commune", "sel-c2", "B207", 30, 25,
                       {"count_5_walk_mean": 4.0, "count_5_walk_decile1": 1.0}),
        _aggregate_row("commune", "sel-c3", "B207", 10, 8,
                       {"count_5_walk_mean": 4.0, "count_5_walk_decile1": 3.0}),
        # A member whose published coverage is not "covered" (free text, NOT NULL
        # only) but which still carries measured values: used to prove the group
        # coverage is derived, never fabricated as "covered".
        {**_aggregate_row("commune", "sel-c4", "A104", 5, 4,
                          {"count_5_walk_mean": 2.0, "count_5_walk_decile1": 0.5}),
         "coverage_status": "pending_review"},
        # EPCI, département and région direct aggregates (fixed references).
        _aggregate_row("epci", "sel-e1", "A104", 40, 34, {"count_5_walk_mean": 7.0}),
        _aggregate_row("departement", "22", "A104", 100, 90, {"count_5_walk_mean": 9.0}),
        _aggregate_row("region", "53", "A104", 1000, 900,
                       {"count_5_walk_mean": 13.0, "count_15_car_mean": 30.0}),
    ]
    for row in rows:
        publisher.execute(
            """INSERT INTO aedar_territorial_aggregate(
                 territory_type,territory_id,typequ,typequ_label,typequ_hierarchy_label,typequ_description,
                 typequ_domain_code,typequ_domain_label,typequ_subdomain_code,typequ_subdomain_label,
                 typequ_gamme,typequ_gamme_status,typequ_source_order,identity,n_addresses,n_observed,
                 coverage_status,measures,source_id,vintage_id,source_url,licence,attribution,
                 reference_date,publication_date)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s::jsonb,%s,%s,%s,%s::jsonb,%s,%s,%s,%s,%s,%s,%s)""",
            (row["territory_type"], row["territory_id"], row["typequ"], row["typequ_label"],
             row["typequ_hierarchy_label"], row["typequ_description"], row["typequ_domain_code"],
             row["typequ_domain_label"], row["typequ_subdomain_code"], row["typequ_subdomain_label"],
             row["typequ_gamme"], row["typequ_gamme_status"], row["typequ_source_order"],
             json.dumps(row["identity"]), row["n_addresses"], row["n_observed"], row["coverage_status"],
             json.dumps(row["measures"]), row["source_id"], row["vintage_id"], row["source_url"],
             row["licence"], row["attribution"], row["reference_date"], row["publication_date"]))
    publisher.execute("""INSERT INTO table_publication(
        table_name,content_version,row_count,reference_content_version)
        VALUES ('aedar_territorial_aggregate','a' || repeat('0',63),%s,'b' || repeat('0',63))""",
        (len(rows),))
    # One pooled density-class reference row keeps the reference-only marker
    # valid (group_row_count must match and stay >= 1); no peer/rank rows exist.
    publisher.execute("""INSERT INTO aedar_comparison_group(comparison_context,group_id,territory_type,
        typequ,measure,statistic,value,n_addresses,n_observed,coverage_status)
        VALUES ('density_class','D1','commune','A104','count_5_walk_mean','pooled',7.4,50,42,'covered')""")
    publisher.execute("""INSERT INTO aedar_comparison_publication(singleton,content_version,
        source_snapshot_id,aedar_content_version,reference_content_version,input_content_version,
        input_identity,group_row_count,territory_row_count,publication_mode)
        VALUES (true,'c' || repeat('0',63),'2026-v1','a' || repeat('0',63),'b' || repeat('0',63),
        'd' || repeat('0',63),'{"address_origins":"sha256"}'::jsonb,1,0,'reference_only')""")


@pytest.fixture
def aedar_http(canonical_db_env):
    import psycopg
    from fastapi.testclient import TestClient
    from psycopg_pool import ConnectionPool
    from api import main

    with psycopg.connect(canonical_db_env["publish_dsn"], autocommit=True) as publisher:
        with publisher.transaction():
            _seed_aedar(publisher)

    pool = ConnectionPool(conninfo=canonical_db_env["read_dsn"], min_size=0, max_size=1,
                          open=True, kwargs={"autocommit": True})

    class Pool:
        @contextmanager
        def connection(self):
            with pool.connection() as connection:
                yield connection

    previous = main.app.dependency_overrides.get(main.get_repository)
    main.app.dependency_overrides[main.get_repository] = lambda: main.ReadRepository(Pool())
    try:
        with TestClient(main.app) as client:
            yield client
    finally:
        if previous is None:
            main.app.dependency_overrides.pop(main.get_repository, None)
        else:
            main.app.dependency_overrides[main.get_repository] = previous
        pool.close()


def _selected_item(target_type="commune", target_id="sel-c1", members=None,
                   typequ=("A104",), measures=("count_5_walk_mean",), fields=None):
    if members is None:
        members = [{"type": "commune", "id": "sel-c1"},
                   {"type": "commune", "id": "sel-c2"},
                   {"type": "commune", "id": "sel-c3"}]
    item = {
        "resource": "aedar_territorial_aggregate",
        "target": {"kind": "territory", "type": target_type, "id": target_id},
        "coordinates": {"typequ": list(typequ), "measure": list(measures)},
        "intent": {"kind": "selected_comparison",
                   "members": members},
    }
    if fields is not None:
        item["fields"] = fields
    return item


def test_selected_comparison_returns_weighted_mean_ranks_and_group_size(aedar_http):
    response = aedar_http.post("/api/resources/read", json=_selected_item(
        fields=["group_value", "value", "rank", "rank_size", "rank_ties"]))
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["resource"] == "aedar_territorial_aggregate"
    assert body["content_version"] == "c" + "0" * 63
    assert body["source_snapshot_id"] == "2026-v1"
    assert body["aedar_content_version"] == "a" + "0" * 63
    assert body["reference_content_version"] == "b" + "0" * 63
    assert body["selection"] == [
        {"territory_type": "commune", "territory_id": "sel-c1"},
        {"territory_type": "commune", "territory_id": "sel-c2"},
        {"territory_type": "commune", "territory_id": "sel-c3"},
    ]
    assert body["scope"] == {"kind": "explicit_selection", "member_count": 3,
                             "territory_type": "commune"}
    assert len(body["comparisons"]) == 1
    entry = body["comparisons"][0]
    assert entry["comparison_context"] == "selected_comparison"
    assert entry["group_id"] is None
    assert entry["territory_type"] == "commune"
    assert entry["typequ"] == "A104" and entry["measure"] == "count_5_walk_mean"
    # Address-weighted mean of members' published values: (5*10 + 8*30 + 8*10) / 50.
    assert entry["statistic"] == "pooled"
    assert entry["group_value"] == pytest.approx(7.4)
    assert entry["group_n_addresses"] == 50
    assert entry["group_n_observed"] == 42
    assert entry["group_coverage_status"] == "covered"
    assert entry["direction"] == "high" and entry["comparison_facet"] == "volume"
    assert entry["value"] == 5.0 and entry["status"] == "measured"
    # Direction-aware focal rank with ties sharing the rank: values 5, 8, 8 -> 3e/3.
    assert entry["rank"] == 3 and entry["rank_size"] == 3 and entry["rank_ties"] == 1
    assert entry["source_id"] == "aedar_bretagne" and entry["vintage_id"] == "2026-v1"


def test_selected_comparison_projects_per_cell_weighted_means_for_curve_readings(aedar_http):
    response = aedar_http.post("/api/resources/read", json=_selected_item(
        typequ=("A104", "B207"), measures=("count_5_walk_mean", "count_5_walk_decile1"),
        fields=["group_value", "rank", "rank_size", "rank_ties"]))
    assert response.status_code == 200, response.text
    entries = {(e["typequ"], e["measure"]): e for e in response.json()["comparisons"]}
    assert len(entries) == 4
    # Per-cell curve reading: weighted mean over the same address weights, no rank.
    curve = entries[("A104", "count_5_walk_decile1")]
    assert curve["group_value"] == pytest.approx((1.0 * 10 + 2.0 * 30 + 4.0 * 10) / 50)
    assert curve["rank"] is None and curve["rank_size"] is None and curve["rank_ties"] is None
    assert curve["comparison_facet"] == "distribution"
    assert entries[("B207", "count_5_walk_mean")]["group_value"] == pytest.approx(
        (2.0 * 10 + 4.0 * 30 + 4.0 * 10) / 50)
    assert entries[("B207", "count_5_walk_mean")]["rank"] == 3


def test_selected_comparison_field_projection_and_focal_not_a_member(aedar_http):
    projected = aedar_http.post("/api/resources/read", json=_selected_item(
        fields=["group_value", "rank"]))
    assert projected.status_code == 200, projected.text
    entry = projected.json()["comparisons"][0]
    assert entry["group_value"] == pytest.approx(7.4) and entry["rank"] == 3
    assert "value" not in entry and "rank_size" not in entry and "rank_ties" not in entry

    # The focal must be a member to receive a rank; the group stat still reads
    # over exactly the requested membership.
    without_focal = aedar_http.post("/api/resources/read", json=_selected_item(
        members=[{"type": "commune", "id": "sel-c2"}, {"type": "commune", "id": "sel-c3"}],
        fields=["group_value", "value", "rank", "rank_size", "rank_ties"]))
    assert without_focal.status_code == 200, without_focal.text
    body = without_focal.json()
    assert body["scope"]["member_count"] == 2
    entry = body["comparisons"][0]
    assert entry["group_value"] == pytest.approx(8.0)
    assert entry["rank"] is None and entry["rank_size"] is None and entry["rank_ties"] is None
    assert entry["value"] == 5.0  # the focal's own published value is still returned


def test_selected_comparison_fails_closed_naming_the_failed_member(aedar_http):
    unknown = aedar_http.post("/api/resources/read", json=_selected_item(
        members=[{"type": "commune", "id": "sel-c1"}, {"type": "commune", "id": "nope"}]))
    assert unknown.status_code == 404
    assert "commune/nope" in unknown.json()["detail"]

    mixed = aedar_http.post("/api/resources/read", json=_selected_item(
        members=[{"type": "commune", "id": "sel-c1"}, {"type": "epci", "id": "sel-e1"}]))
    assert mixed.status_code == 422
    assert "epci/sel-e1" in mixed.json()["detail"]

    wrong_type = aedar_http.post("/api/resources/read", json=_selected_item(
        members=[{"type": "epci", "id": "sel-c1"}]))
    assert wrong_type.status_code == 422
    assert "epci/sel-c1" in wrong_type.json()["detail"]

    empty = aedar_http.post("/api/resources/read", json=_selected_item(members=[]))
    assert empty.status_code == 422

    # Partial member: sel-e2 has no published aggregate row at all.
    epci_focal = aedar_http.post("/api/resources/read", json=_selected_item(
        target_type="epci", target_id="sel-e1",
        members=[{"type": "epci", "id": "sel-e1"}, {"type": "epci", "id": "sel-e2"}],
        typequ=("A104",), measures=("count_5_walk_mean",)))
    # sel-e2 has no published aggregate row: fail closed naming the member.
    assert epci_focal.status_code == 422
    assert "epci/sel-e2" in epci_focal.json()["detail"]

    bad_measure = aedar_http.post("/api/resources/read", json=_selected_item(
        measures=("count_5_walk_bogus",)))
    assert bad_measure.status_code == 422
    unknown_typequ = aedar_http.post("/api/resources/read", json=_selected_item(typequ=("ZZZZ",)))
    assert unknown_typequ.status_code == 422


def test_selected_comparison_rank_fields_are_rejected_for_fixed_and_facts(aedar_http):
    fixed_rank = aedar_http.post("/api/resources/read", json={
        "resource": "aedar_territorial_aggregate",
        "target": {"kind": "territory", "type": "epci", "id": "sel-e1"},
        "coordinates": {"typequ": ["A104"], "measure": ["count_5_walk_mean"]},
        "fields": ["rank"],
        "intent": {"kind": "fixed_comparison", "context": "same_level"},
    })
    assert fixed_rank.status_code == 422
    member_ranks = aedar_http.post("/api/resources/read", json=_selected_item(fields=["member_ranks"]))
    assert member_ranks.status_code == 422


def test_fixed_same_level_returns_the_region_direct_aggregate(aedar_http):
    for level, territory_id in (("epci", "sel-e1"), ("departement", "22")):
        response = aedar_http.post("/api/resources/read", json={
            "resource": "aedar_territorial_aggregate",
            "target": {"kind": "territory", "type": level, "id": territory_id},
            "coordinates": {"typequ": ["A104"], "measure": ["count_5_walk_mean"]},
            "fields": ["group_value", "value"],
            "intent": {"kind": "fixed_comparison", "context": "same_level"},
        })
        assert response.status_code == 200, response.text
        comparison = response.json()["comparison"]
        assert comparison["comparison_context"] == "same_level"
        assert comparison["group_id"] == "53"
        assert comparison["territory_type"] == "region"
        assert comparison["statistic"] == "direct"
        # The Région's own direct published aggregate (« Moyenne de Bretagne »).
        assert comparison["group_value"] == 13.0
        assert comparison["group_n_addresses"] == 1000
    # Same-level stays scoped to EPCI/département fiches.
    commune = aedar_http.post("/api/resources/read", json={
        "resource": "aedar_territorial_aggregate",
        "target": {"kind": "territory", "type": "commune", "id": "sel-c1"},
        "coordinates": {"typequ": ["A104"], "measure": ["count_5_walk_mean"]},
        "intent": {"kind": "fixed_comparison", "context": "same_level"},
    })
    assert commune.status_code == 422


def test_selected_comparison_derives_group_coverage_from_member_statuses(aedar_http):
    members = [{"type": "commune", "id": "sel-c1"}, {"type": "commune", "id": "sel-c2"},
               {"type": "commune", "id": "sel-c3"}]
    # All members covered -> derived group coverage is "covered".
    response = aedar_http.post("/api/resources/read", json=_selected_item(members=members))
    assert response.status_code == 200, response.text
    assert response.json()["comparisons"][0]["group_coverage_status"] == "covered"

    # Mixed statuses (sel-c4 publishes "pending_review" with measured values):
    # no single derivable coverage, so it stays unknown (null), never upgraded.
    mixed = [{"type": "commune", "id": "sel-c1"}, {"type": "commune", "id": "sel-c2"},
             {"type": "commune", "id": "sel-c4"}]
    response = aedar_http.post("/api/resources/read", json=_selected_item(members=mixed))
    assert response.status_code == 200, response.text
    entry = response.json()["comparisons"][0]
    assert entry["group_coverage_status"] is None
    # The group statistic itself is still the address-weighted mean over the
    # members' published values: (5*10 + 8*30 + 2*5) / 45.
    assert entry["group_value"] == pytest.approx(300 / 45)
    assert entry["group_n_addresses"] == 45

    # A uniform lesser status is reflected as published, not upgraded.
    response = aedar_http.post("/api/resources/read", json=_selected_item(
        members=[{"type": "commune", "id": "sel-c4"}]))
    assert response.status_code == 200, response.text
    entry = response.json()["comparisons"][0]
    assert entry["group_coverage_status"] == "pending_review"
    assert entry["group_value"] == pytest.approx(2.0)
    assert entry["rank"] is None  # the focal (sel-c1) is not a member


def test_batch_reads_selected_comparison_and_facts_on_one_committed_snapshot(aedar_http):
    facts_item = {
        "id": "facts",
        "resource": "aedar_territorial_aggregate",
        "target": {"kind": "territory", "type": "commune", "id": "sel-c1"},
        "coordinates": {"typequ": ["A104"]},
        "fields": ["measures.count_5_walk_mean"],
        "intent": {"kind": "facts"},
    }
    selected_item = {"id": "selected", **_selected_item(
        fields=["group_value", "rank", "rank_size", "rank_ties"])}
    response = aedar_http.post("/api/resources/read-batch", json={"items": [facts_item, selected_item]})
    assert response.status_code == 200, response.text
    results = {result["id"]: result["data"] for result in response.json()["results"]}
    facts = results["facts"]
    assert facts["content_version"] == "a" + "0" * 63
    assert facts["facts"][0]["measures"] == {"count_5_walk_mean": 5.0}
    selected = results["selected"]
    assert selected["aedar_content_version"] == facts["content_version"]
    assert selected["reference_content_version"] == facts["reference_content_version"]
    entry = selected["comparisons"][0]
    assert entry["group_value"] == pytest.approx(7.4)
    assert (entry["rank"], entry["rank_size"], entry["rank_ties"]) == (3, 3, 1)
