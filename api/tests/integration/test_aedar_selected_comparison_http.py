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
               ('sel-c5','commune','Commune 5','22','sel-e1','D1','Dense'),
               ('sel-c6','commune','Commune 6','22','sel-e1','D1','Dense'),
               ('sel-c7','commune','Commune 7','22','sel-e2','D2','Peu dense'),
               ('sel-c8','commune','Commune 8','22','sel-e2','D3','Dense'),
               ('sel-e1','epci','EPCI 1','22',NULL,NULL,NULL),
               ('sel-e2','epci','EPCI 2','22',NULL,NULL,NULL),
               ('22','departement','Département 22',NULL,NULL,NULL,NULL),
               ('53','region','Bretagne',NULL,NULL,NULL,NULL)""")
    publisher.execute("INSERT INTO table_publication(table_name,content_version,row_count)"
                      " VALUES ('territory_reference','b' || repeat('0',63),12)")

    rows = [
        # communes: n_addresses weights 10 / 30 / 10. The TYPEQU registry of the
        # fixture is {A104, B207}; the 15-minute car share/mean columns drive the
        # registry-wide aggregate readings (#914): meanDiversity/meanVolume per
        # commune are sel-c1 -> 0.75 / 18.0, sel-c2 and sel-c3 -> 1.2 / 30.0.
        _aggregate_row("commune", "sel-c1", "A104", 10, 9,
                       {"count_5_walk_mean": 5.0, "count_5_walk_share": 0.5,
                        "count_15_car_mean": 12.0, "count_15_car_share": 0.5,
                        "count_5_walk_decile1": 1.0}),
        _aggregate_row("commune", "sel-c2", "A104", 30, 25,
                       {"count_5_walk_mean": 8.0, "count_5_walk_share": 0.8,
                        "count_15_car_mean": 20.0, "count_15_car_share": 0.8,
                        "count_5_walk_decile1": 2.0}),
        _aggregate_row("commune", "sel-c3", "A104", 10, 8,
                       {"count_5_walk_mean": 8.0, "count_5_walk_share": 0.8,
                        "count_15_car_mean": 20.0, "count_15_car_share": 0.8,
                        "count_5_walk_decile1": 4.0}),
        _aggregate_row("commune", "sel-c1", "B207", 10, 9,
                       {"count_5_walk_mean": 2.0, "count_5_walk_decile1": 0.5,
                        "count_15_car_mean": 6.0, "count_15_car_share": 0.25}),
        _aggregate_row("commune", "sel-c2", "B207", 30, 25,
                       {"count_5_walk_mean": 4.0, "count_5_walk_decile1": 1.0,
                        "count_15_car_mean": 10.0, "count_15_car_share": 0.4}),
        _aggregate_row("commune", "sel-c3", "B207", 10, 8,
                       {"count_5_walk_mean": 4.0, "count_5_walk_decile1": 3.0,
                        "count_15_car_mean": 10.0, "count_15_car_share": 0.4}),
        # A member whose published coverage is not "covered" (free text, NOT NULL
        # only) but which still carries measured values: used to prove the group
        # coverage is derived, never fabricated as "covered". It also has an
        # incomplete TYPEQU registry (no B207 row), so its aggregate reading is
        # unknown and it fails closed as a selected aggregate member.
        {**_aggregate_row("commune", "sel-c4", "A104", 5, 4,
                          {"count_5_walk_mean": 2.0, "count_5_walk_decile1": 0.5,
                           "count_15_car_mean": 4.0, "count_15_car_share": 0.1}),
         "coverage_status": "pending_review"},
        # EPCI, département and région direct aggregates (fixed references).
        # Registry-wide readings: sel-e1 -> 0.9 / 23.0, sel-e2 -> 1.05 / 27.0,
        # 22 -> 1.15 / 33.0, 53 -> 1.4 / 45.0.
        _aggregate_row("epci", "sel-e1", "A104", 40, 34,
                       {"count_5_walk_mean": 7.0, "count_15_car_mean": 15.0,
                        "count_15_car_share": 0.6}),
        _aggregate_row("epci", "sel-e1", "B207", 40, 30,
                       {"count_15_car_mean": 8.0, "count_15_car_share": 0.3}),
        _aggregate_row("epci", "sel-e2", "A104", 200, 150,
                       {"count_15_car_mean": 18.0, "count_15_car_share": 0.7}),
        _aggregate_row("epci", "sel-e2", "B207", 200, 140,
                       {"count_15_car_mean": 9.0, "count_15_car_share": 0.35}),
        _aggregate_row("departement", "22", "A104", 100, 90,
                       {"count_5_walk_mean": 9.0, "count_15_car_mean": 22.0,
                        "count_15_car_share": 0.75}),
        _aggregate_row("departement", "22", "B207", 100, 80,
                       {"count_15_car_mean": 11.0, "count_15_car_share": 0.4}),
        _aggregate_row("region", "53", "A104", 1000, 900,
                       {"count_5_walk_mean": 13.0, "count_15_car_mean": 30.0,
                        "count_15_car_share": 0.9}),
        _aggregate_row("region", "53", "B207", 1000, 800,
                       {"count_15_car_mean": 15.0, "count_15_car_share": 0.5}),
        # Availability-law anomalies (#914 follow-up): each of these communes
        # has a complete {A104, B207} registry but fails one fiche condition,
        # so its registry-wide aggregate reading is honestly unavailable.
        # sel-c5: mixed coverage (B207 not "covered") -> ineligible.
        _aggregate_row("commune", "sel-c5", "A104", 20, 18,
                       {"count_15_car_mean": 9.0, "count_15_car_share": 0.3}),
        {**_aggregate_row("commune", "sel-c5", "B207", 20, 17,
                          {"count_15_car_mean": 5.0, "count_15_car_share": 0.2}),
         "coverage_status": "pending_review"},
        # sel-c6: divergent provenance (B207 on another vintage) -> ineligible.
        _aggregate_row("commune", "sel-c6", "A104", 20, 18,
                       {"count_15_car_mean": 10.0, "count_15_car_share": 0.35}),
        {**_aggregate_row("commune", "sel-c6", "B207", 20, 16,
                          {"count_15_car_mean": 5.0, "count_15_car_share": 0.25}),
         "vintage_id": "2026-v2"},
        # sel-c7: a share above 1 (volume rows stay valid) -> ineligible for
        # meanDiversity only; meanVolume 30.0 remains available.
        _aggregate_row("commune", "sel-c7", "A104", 10, 8,
                       {"count_15_car_mean": 20.0, "count_15_car_share": 1.5}),
        _aggregate_row("commune", "sel-c7", "B207", 10, 8,
                       {"count_15_car_mean": 10.0, "count_15_car_share": 0.4}),
        # sel-c8 (density class D3): complete registry but mixed coverage, so
        # its own reading is honestly unavailable and it stays an ineligible
        # peer in the epci/bretagne rank populations (#914 amendment fixture).
        _aggregate_row("commune", "sel-c8", "A104", 20, 18,
                       {"count_15_car_mean": 12.0, "count_15_car_share": 0.35}),
        {**_aggregate_row("commune", "sel-c8", "B207", 20, 16,
                          {"count_15_car_mean": 6.0, "count_15_car_share": 0.25}),
         "coverage_status": "pending_review"},
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
    # Pooled density-class reference rows keep the reference-only marker valid
    # (group_row_count must match and stay >= 1); no peer/rank rows exist. The
    # count_15_car_* rows back the registry-wide aggregate readings (#914):
    # pooled meanDiversity = 0.65 + 0.3 = 0.95, pooled meanVolume = 16 + 8 = 24.
    group_rows = [
        ("D1", "A104", "count_5_walk_mean", 7.4, 50, 42),
        ("D1", "A104", "count_15_car_mean", 16.0, 40, 34),
        ("D1", "B207", "count_15_car_mean", 8.0, 40, 33),
        ("D1", "A104", "count_15_car_share", 0.65, 40, 34),
        ("D1", "B207", "count_15_car_share", 0.3, 40, 33),
        # D3 (the density class of sel-c8) carries a pooled row with NULL
        # n_observed on B207: the schema CHECK admits it, but the unified
        # aggregate law counts it as bad, so D3's pooled registry-wide reading
        # is honestly unavailable (#914 amendment, 2026-11-05).
        ("D3", "A104", "count_15_car_mean", 16.0, 15, 14),
        ("D3", "B207", "count_15_car_mean", 8.0, 15, None),
    ]
    for group_id, typequ, measure, value, n_addresses, n_observed in group_rows:
        publisher.execute("""INSERT INTO aedar_comparison_group(comparison_context,group_id,territory_type,
            typequ,measure,statistic,value,n_addresses,n_observed,coverage_status)
            VALUES ('density_class',%s,'commune',%s,%s,'pooled',%s,%s,%s,'covered')""",
            (group_id, typequ, measure, value, n_addresses, n_observed))
    publisher.execute("""INSERT INTO aedar_comparison_publication(singleton,content_version,
        source_snapshot_id,aedar_content_version,reference_content_version,input_content_version,
        input_identity,group_row_count,territory_row_count,publication_mode)
        VALUES (true,'c' || repeat('0',63),'2026-v1','a' || repeat('0',63),'b' || repeat('0',63),
        'd' || repeat('0',63),'{"address_origins":"sha256"}'::jsonb,%s,0,'reference_only')""",
        (len(group_rows),))


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


def test_rank_fields_follow_the_aggregate_fixed_boundary(aedar_http):
    # Per-cell measures keep #904's exact boundary: the fixed intent rejects
    # rank fields for non-aggregate facets, and facts rejects them outright.
    fixed_rank = aedar_http.post("/api/resources/read", json={
        "resource": "aedar_territorial_aggregate",
        "target": {"kind": "territory", "type": "epci", "id": "sel-e1"},
        "coordinates": {"typequ": ["A104"], "measure": ["count_5_walk_mean"]},
        "fields": ["rank"],
        "intent": {"kind": "fixed_comparison", "context": "same_level"},
    })
    assert fixed_rank.status_code == 422
    facts_rank = aedar_http.post("/api/resources/read", json={
        "resource": "aedar_territorial_aggregate",
        "target": {"kind": "territory", "type": "commune", "id": "sel-c1"},
        "coordinates": {"typequ": ["A104"], "measure": ["count_5_walk_mean"]},
        "fields": ["rank"],
        "intent": {"kind": "facts"},
    })
    assert facts_rank.status_code == 422
    member_ranks = aedar_http.post("/api/resources/read", json=_selected_item(fields=["member_ranks"]))
    assert member_ranks.status_code == 422
    # ADR-0039's 2026-11-04 amendment (#914): the fixed intent grants the rank
    # fields on the aggregate facets ONLY, so this request is served.
    fixed_aggregate_rank = aedar_http.post("/api/resources/read", json={
        "resource": "aedar_territorial_aggregate",
        "target": {"kind": "territory", "type": "commune", "id": "sel-c1"},
        "coordinates": {"measure": ["meanVolume"]},
        "fields": ["group_value", "value", "rank", "rank_size", "rank_ties"],
        "intent": {"kind": "fixed_comparison", "context": "epci"},
    })
    assert fixed_aggregate_rank.status_code == 200, fixed_aggregate_rank.text
    assert fixed_aggregate_rank.json()["comparison"]["rank"] == 2
    # Aggregate readings are comparison facets, not facts; they take no typequ
    # coordinate and never mix with per-cell measures in one request.
    facts_aggregate = aedar_http.post("/api/resources/read", json={
        "resource": "aedar_territorial_aggregate",
        "target": {"kind": "territory", "type": "commune", "id": "sel-c1"},
        "coordinates": {"measure": ["meanDiversity"]},
        "intent": {"kind": "facts"},
    })
    assert facts_aggregate.status_code == 422
    aggregate_with_typequ = aedar_http.post("/api/resources/read", json={
        "resource": "aedar_territorial_aggregate",
        "target": {"kind": "territory", "type": "commune", "id": "sel-c1"},
        "coordinates": {"typequ": ["A104"], "measure": ["meanVolume"]},
        "intent": {"kind": "fixed_comparison", "context": "epci"},
    })
    assert aggregate_with_typequ.status_code == 422
    mixed = aedar_http.post("/api/resources/read", json=_selected_item(
        measures=("meanVolume", "count_5_walk_mean")))
    assert mixed.status_code == 422


def _aggregate_item(target_type="commune", target_id="sel-c1", measures=("meanVolume",),
                    members=None, fields=None, context=None):
    item = {
        "resource": "aedar_territorial_aggregate",
        "target": {"kind": "territory", "type": target_type, "id": target_id},
        "coordinates": {"measure": list(measures)},
    }
    if members is not None:
        item["intent"] = {"kind": "selected_comparison", "members": members}
    else:
        item["intent"] = {"kind": "fixed_comparison", "context": context or "epci"}
    if fields is not None:
        item["fields"] = fields
    return item


def test_fixed_aggregate_reading_returns_direct_reference_peer_rank_and_ties(aedar_http):
    # Ambient EPCI context on sel-c1: the group statistic is the EPCI's own
    # direct published aggregate summed over the registry (15 + 8 = 23.0);
    # the rank reads over the EPCI's communes (sel-c1 18.0, sel-c2 30.0).
    response = aedar_http.post("/api/resources/read", json=_aggregate_item(
        measures=("meanVolume",),
        fields=["group_value", "value", "rank", "rank_size", "rank_ties"], context="epci"))
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["content_version"] == "c" + "0" * 63
    assert body["source_snapshot_id"] == "2026-v1"
    comparison = body["comparison"]
    assert comparison["comparison_context"] == "epci"
    assert comparison["measure"] == "meanVolume"
    assert comparison["typequ"] is None and comparison["typequ_label"] is None
    assert comparison["statistic"] == "direct"
    assert comparison["group_id"] == "sel-e1" and comparison["territory_type"] == "epci"
    assert comparison["group_value"] == pytest.approx(23.0)
    assert comparison["group_n_addresses"] == 40
    assert comparison["group_n_observed"] == 64
    assert comparison["group_coverage_status"] == "covered"
    assert comparison["value"] == pytest.approx(18.0) and comparison["status"] == "measured"
    assert (comparison["rank"], comparison["rank_size"], comparison["rank_ties"]) == (2, 2, 1)
    # Bretagne context: the rank reads over all Breton communes whose rows
    # satisfy the compatibility law (sel-c4 incomplete, sel-c5/sel-c6
    # incompatible stay out; sel-c7's volume rows are valid); the reference is
    # the Région's direct aggregate (30 + 15 = 45.0).
    bretagne = aedar_http.post("/api/resources/read", json=_aggregate_item(
        measures=("meanVolume",), fields=["group_value", "value", "rank", "rank_size", "rank_ties"],
        context="bretagne"))
    assert bretagne.status_code == 200, bretagne.text
    comparison = bretagne.json()["comparison"]
    assert comparison["group_id"] == "53" and comparison["territory_type"] == "region"
    assert comparison["statistic"] == "direct" and comparison["group_value"] == pytest.approx(45.0)
    assert comparison["value"] == pytest.approx(18.0)
    # Eligible volume peers: sel-c1 18.0, sel-c2/sel-c3/sel-c7 30.0 -> 4e/4.
    assert (comparison["rank"], comparison["rank_size"], comparison["rank_ties"]) == (4, 4, 1)
    # For the diversity reading sel-c7 is ineligible (share 1.5 > 1) -> 3e/3.
    bretagne_diversity = aedar_http.post("/api/resources/read", json=_aggregate_item(
        measures=("meanDiversity",), fields=["value", "rank", "rank_size", "rank_ties"],
        context="bretagne"))
    assert bretagne_diversity.status_code == 200, bretagne_diversity.text
    comparison = bretagne_diversity.json()["comparison"]
    assert (comparison["rank"], comparison["rank_size"], comparison["rank_ties"]) == (3, 3, 1)
    # The diversity reading reads the same machinery over count_15_car_share.
    diversity = aedar_http.post("/api/resources/read", json=_aggregate_item(
        measures=("meanDiversity",), fields=["group_value", "value", "rank"], context="epci"))
    assert diversity.status_code == 200, diversity.text
    comparison = diversity.json()["comparison"]
    assert comparison["value"] == pytest.approx(0.75)
    assert comparison["group_value"] == pytest.approx(0.9)
    assert comparison["rank"] == 2
    assert "rank_size" not in comparison  # unselected optional field is projected out


def test_fixed_aggregate_same_level_and_density_contexts(aedar_http):
    # EPCI same-level: reference is the Région's direct aggregate; the rank
    # reads over all Breton EPCIs (sel-e1 23.0, sel-e2 27.0 -> 2e/2).
    same_level = aedar_http.post("/api/resources/read", json=_aggregate_item(
        target_type="epci", target_id="sel-e1", measures=("meanVolume",),
        fields=["group_value", "value", "rank", "rank_size", "rank_ties"], context="same_level"))
    assert same_level.status_code == 200, same_level.text
    comparison = same_level.json()["comparison"]
    assert comparison["comparison_context"] == "same_level"
    assert comparison["group_id"] == "53" and comparison["territory_type"] == "region"
    assert comparison["statistic"] == "direct" and comparison["group_value"] == pytest.approx(45.0)
    assert comparison["value"] == pytest.approx(23.0)
    assert (comparison["rank"], comparison["rank_size"], comparison["rank_ties"]) == (2, 2, 1)
    # Density class: the reference is the pooled address artifact summed over
    # the registry (16 + 8 = 24.0); peers are the density class communes.
    density = aedar_http.post("/api/resources/read", json=_aggregate_item(
        measures=("meanVolume",),
        fields=["group_value", "value", "rank", "rank_size", "rank_ties"], context="density_class"))
    assert density.status_code == 200, density.text
    comparison = density.json()["comparison"]
    assert comparison["comparison_context"] == "density_class"
    assert comparison["statistic"] == "pooled"
    assert comparison["group_id"] == "D1" and comparison["territory_type"] == "commune"
    assert comparison["group_value"] == pytest.approx(24.0)
    assert comparison["group_n_addresses"] == 40 and comparison["group_n_observed"] == 67
    assert comparison["value"] == pytest.approx(18.0)
    assert (comparison["rank"], comparison["rank_size"], comparison["rank_ties"]) == (2, 2, 1)
    density_diversity = aedar_http.post("/api/resources/read", json=_aggregate_item(
        measures=("meanDiversity",), fields=["group_value", "value"], context="density_class"))
    assert density_diversity.status_code == 200, density_diversity.text
    comparison = density_diversity.json()["comparison"]
    assert comparison["group_value"] == pytest.approx(0.95)  # 0.65 + 0.3 pooled shares
    assert comparison["value"] == pytest.approx(0.75)


def test_fixed_aggregate_density_pooled_null_observed_row_is_unavailable(aedar_http):
    """A pooled density row with NULL n_observed is honestly bad (#914 amendment).

    The schema CHECK on `aedar_comparison_group` admits a NULL n_observed, but
    the unified aggregate mechanism computes n_bad_observed in SQL exactly
    like the territorial path, so the pooled registry-wide reading of D3 is
    honestly unavailable (group_value null) — never silently served as a sum.
    """
    response = aedar_http.post("/api/resources/read", json=_aggregate_item(
        target_id="sel-c8", measures=("meanVolume",),
        fields=["group_value", "value", "status", "rank", "rank_size", "rank_ties"],
        context="density_class"))
    assert response.status_code == 200, response.text
    comparison = response.json()["comparison"]
    assert comparison["comparison_context"] == "density_class"
    assert comparison["group_id"] == "D3" and comparison["statistic"] == "pooled"
    # The D3 pooled artifact's B207 row has NULL n_observed -> n_bad_observed=1
    # -> the pooled reading fails the law: honestly unavailable, not 24.0.
    assert comparison["group_value"] is None
    assert comparison["group_n_addresses"] == 15 and comparison["group_n_observed"] == 14
    # The focal's own territorial rows also fail the law (mixed coverage).
    assert comparison["value"] is None and comparison["status"] == "not_available"
    assert comparison["rank"] is None and comparison["rank_size"] is None
    assert comparison["rank_ties"] is None
    # Control: the D1 pooled artifact (all observed counts valid) still serves.
    control = aedar_http.post("/api/resources/read", json=_aggregate_item(
        measures=("meanVolume",), fields=["group_value"], context="density_class"))
    assert control.status_code == 200, control.text
    assert control.json()["comparison"]["group_value"] == pytest.approx(24.0)


def test_selected_aggregate_returns_pooled_weighted_readings_and_ranks(aedar_http):
    members = [{"type": "commune", "id": "sel-c1"},
               {"type": "commune", "id": "sel-c2"},
               {"type": "commune", "id": "sel-c3"}]
    response = aedar_http.post("/api/resources/read", json=_aggregate_item(
        measures=("meanDiversity", "meanVolume"), members=members,
        fields=["group_value", "value", "rank", "rank_size", "rank_ties"]))
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["scope"] == {"kind": "explicit_selection", "member_count": 3,
                             "territory_type": "commune"}
    by_measure = {entry["measure"]: entry for entry in body["comparisons"]}
    assert set(by_measure) == {"meanDiversity", "meanVolume"}
    diversity = by_measure["meanDiversity"]
    # Registry-wide readings 0.75 / 1.2 / 1.2 with weights 10 / 30 / 10: the
    # group statistic keeps #859's address-weighted pooled semantics.
    assert diversity["typequ"] is None and diversity["typequ_label"] is None
    assert diversity["statistic"] == "pooled"
    assert diversity["direction"] == "high" and diversity["comparison_facet"] == "diversity"
    assert diversity["group_value"] == pytest.approx((0.75 * 10 + 1.2 * 30 + 1.2 * 10) / 50)
    assert diversity["group_n_addresses"] == 50 and diversity["group_n_observed"] == 84
    assert diversity["group_coverage_status"] == "covered"
    assert diversity["value"] == pytest.approx(0.75) and diversity["status"] == "measured"
    assert (diversity["rank"], diversity["rank_size"], diversity["rank_ties"]) == (3, 3, 1)
    volume = by_measure["meanVolume"]
    assert volume["comparison_facet"] == "volume"
    assert volume["group_value"] == pytest.approx((18.0 * 10 + 30.0 * 30 + 30.0 * 10) / 50)
    assert volume["value"] == pytest.approx(18.0)
    assert (volume["rank"], volume["rank_size"], volume["rank_ties"]) == (3, 3, 1)
    # The focal must be a member to receive a rank; sel-c4's incomplete
    # registry makes it honestly unavailable: ineligible, never ranked, and
    # excluded from the pooled statistic (which reads over sel-c1 only).
    with_c4 = aedar_http.post("/api/resources/read", json=_aggregate_item(
        measures=("meanVolume",),
        members=[{"type": "commune", "id": "sel-c1"}, {"type": "commune", "id": "sel-c4"}],
        fields=["group_value", "value", "rank", "rank_size", "rank_ties"]))
    assert with_c4.status_code == 200, with_c4.text
    entry = with_c4.json()["comparisons"][0]
    assert entry["group_value"] == pytest.approx(18.0)  # eligible member only
    assert entry["group_n_addresses"] == 10
    assert (entry["rank"], entry["rank_size"], entry["rank_ties"]) == (1, 1, 1)
    without_focal = aedar_http.post("/api/resources/read", json=_aggregate_item(
        measures=("meanDiversity",),
        members=[{"type": "commune", "id": "sel-c2"}, {"type": "commune", "id": "sel-c3"}],
        fields=["group_value", "value", "rank", "rank_size", "rank_ties"]))
    assert without_focal.status_code == 200, without_focal.text
    entry = without_focal.json()["comparisons"][0]
    assert entry["group_value"] == pytest.approx(1.2)
    assert entry["value"] == pytest.approx(0.75)  # the focal's own published reading
    assert entry["rank"] is None and entry["rank_size"] is None and entry["rank_ties"] is None


def test_aggregate_availability_law_marks_incompatible_rows_unavailable(aedar_http):
    """Fiche-law availability for aggregate readings, both intents (#914).

    Mixed coverage (sel-c5), divergent provenance (sel-c6) and a share above 1
    (sel-c7, diversity only) make the registry-wide reading honestly
    unavailable: ineligible members/peers are skipped by the rank (rank_size
    = eligible population) and never zeroed or ranked; an incompatible focal
    returns not_available with null rank fields.
    """
    # status is mandatory and always present; the rest are the selectable fields.
    fields = ["group_value", "value", "rank", "rank_size", "rank_ties"]
    # Fixed intent, incompatible focal (sel-c5 mixed coverage), bretagne
    # context: the reading is unavailable, the Région reference still reads.
    response = aedar_http.post("/api/resources/read", json=_aggregate_item(
        target_id="sel-c5", measures=("meanVolume",), fields=fields, context="bretagne"))
    assert response.status_code == 200, response.text
    comparison = response.json()["comparison"]
    assert comparison["value"] is None and comparison["status"] == "not_available"
    assert comparison["rank"] is None and comparison["rank_size"] is None and comparison["rank_ties"] is None
    assert comparison["group_value"] == pytest.approx(45.0)
    # Fixed intent, eligible focal: incompatible peers are skipped (epci
    # context peers of sel-e1 are sel-c1/c2 eligible, sel-c5/c6 not).
    response = aedar_http.post("/api/resources/read", json=_aggregate_item(
        target_id="sel-c1", measures=("meanVolume",), fields=fields, context="epci"))
    assert response.status_code == 200, response.text
    comparison = response.json()["comparison"]
    assert comparison["value"] == pytest.approx(18.0)
    assert (comparison["rank"], comparison["rank_size"], comparison["rank_ties"]) == (2, 2, 1)
    # Selected intent over members including the incompatible ones: the pooled
    # statistic and rank read over the eligible members only.
    members = [{"type": "commune", "id": "sel-c1"}, {"type": "commune", "id": "sel-c2"},
               {"type": "commune", "id": "sel-c5"}, {"type": "commune", "id": "sel-c6"}]
    response = aedar_http.post("/api/resources/read", json=_aggregate_item(
        measures=("meanVolume",), members=members, fields=fields))
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["scope"]["member_count"] == 4  # requested membership stays truthful
    entry = body["comparisons"][0]
    # Eligible: sel-c1 18.0 (w10), sel-c2 30.0 (w30) -> pooled 27.0, rank 2e/2.
    assert entry["group_value"] == pytest.approx((18.0 * 10 + 30.0 * 30) / 40)
    assert entry["group_n_addresses"] == 40
    assert (entry["rank"], entry["rank_size"], entry["rank_ties"]) == (2, 2, 1)
    # Divergent provenance (sel-c6) as the focal: unavailable, no rank.
    response = aedar_http.post("/api/resources/read", json=_aggregate_item(
        target_id="sel-c6", measures=("meanVolume",), members=members, fields=fields))
    assert response.status_code == 200, response.text
    entry = response.json()["comparisons"][0]
    assert entry["value"] is None and entry["status"] == "not_available"
    assert entry["rank"] is None and entry["rank_size"] is None
    # Share above 1 (sel-c7): diversity unavailable, volume still available.
    response = aedar_http.post("/api/resources/read", json=_aggregate_item(
        target_id="sel-c7", measures=("meanDiversity", "meanVolume"),
        members=[{"type": "commune", "id": "sel-c7"}, {"type": "commune", "id": "sel-c2"}],
        fields=fields))
    assert response.status_code == 200, response.text
    by_measure = {entry["measure"]: entry for entry in response.json()["comparisons"]}
    assert by_measure["meanDiversity"]["value"] is None
    assert by_measure["meanDiversity"]["status"] == "not_available"
    assert by_measure["meanDiversity"]["rank"] is None
    assert by_measure["meanVolume"]["value"] == pytest.approx(30.0)
    assert by_measure["meanVolume"]["status"] == "measured"
    # Both members are volume-eligible (30.0, 30.0): the focal shares rank 1.
    assert (by_measure["meanVolume"]["rank"], by_measure["meanVolume"]["rank_size"],
            by_measure["meanVolume"]["rank_ties"]) == (1, 2, 2)


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
