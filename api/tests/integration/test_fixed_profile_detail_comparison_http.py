"""Guarded HTTP proof for fixed declared-profile detail comparisons (#960).

The fixture is a mobility ``reseaux_par_habitant`` profile whose three declared
details carry deliberately unequal distributions: walking/car/bike medians are
distinct, one peer is unavailable, ties exist, and two further density cohorts
cover a singleton and an all-unavailable cohort. The published profile
comparison only carries the descriptor's default bike detail, so the non-default
coordinates must be computed from the same cohort's published cells.
"""

from __future__ import annotations

import uuid

import pytest

from api.tests.integration.test_postgres_publication import canonical_db_env  # noqa: F401

pytestmark = pytest.mark.integration

RESOURCE = "reseaux_par_habitant"
DETAILS = ("t_km_1000", "b_km_1000", "c_km_1000")
UNITS = "km / 1 000 hab."


def _seed(conn):
    """Insert one complete mobility profile fixture in the caller's test schema."""
    suffix = uuid.uuid4().hex[:8]
    focal = f"96{suffix}f"
    peers = [f"96{suffix}{index}" for index in range(1, 5)]
    unavailable_focal, unavailable_peer = f"96{suffix}g", f"96{suffix}h"
    singleton = f"96{suffix}k"
    epci = f"E{suffix}"

    conn.execute(
        """INSERT INTO territory_reference(territory_id,territory_type,name,department_id,epci_id,
             density_class_code,density_class_label) VALUES
           (%s,'commune','Focal','29',%s,'D960','Dense'),
           (%s,'commune','Peer 1','29',%s,'D960','Dense'),
           (%s,'commune','Peer 2','29',%s,'D960','Dense'),
           (%s,'commune','Peer 3','29',%s,'D960','Dense'),
           (%s,'commune','Peer 4 unavailable','29',%s,'D960','Dense'),
           (%s,'commune','Unavailable focal','29',%s,'D961','Sparse'),
           (%s,'commune','Unavailable peer','29',%s,'D961','Sparse'),
           (%s,'commune','Singleton focal','29',%s,'D962','Alone')""",
        (focal, epci, peers[0], epci, peers[1], epci, peers[2], epci, peers[3], epci,
         unavailable_focal, epci, unavailable_peer, epci, singleton, epci))
    conn.execute("INSERT INTO territory_reference(territory_id,territory_type,name) VALUES (%s,'epci','Fixture EPCI')",
                 (epci,))
    conn.execute("INSERT INTO table_publication(table_name,content_version,row_count) VALUES ('territory_reference','ref-v1',10)")
    conn.execute("INSERT INTO source_dataset VALUES ('osm_reseaux','OpenStreetMap reseaux')")
    conn.execute("INSERT INTO source_dataset VALUES ('stationnement-velo','Ecolab stationnement')")
    conn.execute("""INSERT INTO source_vintage(source_id,vintage_id,version,reference_date,publication_date)
        VALUES ('osm_reseaux','2026-08','2026-08','2026-08-05','2026-08-06'),
               ('stationnement-velo','2022-2025','2022-2025','2025-01-01','2026-02-03')""")
    conn.execute("""INSERT INTO profile_descriptor(indicator_id,theme_id,label,unit,allowed_levels,
        completeness,descriptor_version,comparison_detail,comparison_sex,comparison_direction,
        denominator_semantics,detail_units_required) VALUES (%s,'mobilite',
        'Longueur du reseau par habitant',%s,ARRAY['commune','epci','departement','region'],
        'dense_complete','reseaux-v1','b_km_1000',NULL,'high','population',true)""",
        (RESOURCE, UNITS))
    conn.execute("INSERT INTO profile_descriptor_source VALUES (%s,'osm_reseaux'),(%s,'stationnement-velo')",
                 (RESOURCE, RESOURCE))
    for ordinal, detail in enumerate(DETAILS):
        conn.execute("""INSERT INTO profile_axis(indicator_id,axis_name,axis_key,label,ordinal,unit)
            VALUES (%s,'detail',%s,%s,%s,%s)""", (RESOURCE, detail, detail, ordinal, UNITS))

    measured = {
        focal: {"t_km_1000": 3.0, "b_km_1000": 2.0, "c_km_1000": 1.0},
        peers[0]: {"t_km_1000": 1.0, "b_km_1000": 2.0, "c_km_1000": 5.0},
        peers[1]: {"t_km_1000": 5.0, "b_km_1000": 2.0, "c_km_1000": 1.0},
        peers[2]: {"t_km_1000": 9.0, "b_km_1000": 8.0, "c_km_1000": 7.0},
        peers[3]: {},
        unavailable_focal: {},
        unavailable_peer: {},
        singleton: {"t_km_1000": 7.0, "b_km_1000": 6.0, "c_km_1000": 5.0},
    }
    for territory, values in measured.items():
        for detail in DETAILS:
            value = values.get(detail)
            conn.execute("""INSERT INTO profile_observation(indicator_id,territory_id,territory_type,
                detail_key,sex_key,sex_axis_name,value,status) VALUES (%s,%s,'commune',%s,'',NULL,%s,%s)""",
                (RESOURCE, territory, detail, value, "measured" if value is not None else "not_available"))
            conn.execute("""INSERT INTO profile_observation_source(indicator_id,territory_id,detail_key,
                sex_key,source_id,vintage_id) VALUES (%s,%s,%s,'','osm_reseaux','2026-08')""",
                (RESOURCE, territory, detail))
            if detail == "b_km_1000":
                conn.execute("""INSERT INTO profile_observation_source(indicator_id,territory_id,
                    detail_key,sex_key,source_id,vintage_id)
                    VALUES (%s,%s,%s,'','stationnement-velo','2022-2025')""",
                    (RESOURCE, territory, detail))

    # A second real declared profile crosses units per detail: its descriptor
    # unit is km while its per-capita details are km / 1 000 hab.
    conn.execute("""INSERT INTO profile_descriptor(indicator_id,theme_id,label,unit,allowed_levels,
        completeness,descriptor_version,comparison_detail,comparison_sex,comparison_direction,
        denominator_semantics,detail_units_required) VALUES ('offre_cyclable','mobilite',
        'L''offre cyclable','km',ARRAY['commune','epci','departement','region'],
        'dense_complete','offre-v1','total_longueur',NULL,'high','length',true)""")
    conn.execute("INSERT INTO profile_descriptor_source VALUES ('offre_cyclable','osm_reseaux')")
    offre_units = {"protege_longueur": "km", "protege_km_1000": UNITS,
                   "partage_longueur": "km", "partage_km_1000": UNITS,
                   "total_longueur": "km"}
    for ordinal, (detail, unit) in enumerate(offre_units.items()):
        conn.execute("""INSERT INTO profile_axis(indicator_id,axis_name,axis_key,label,ordinal,unit)
            VALUES ('offre_cyclable','detail',%s,%s,%s,%s)""", (detail, detail, ordinal, unit))
    offre_values = {
        focal: {"protege_longueur": 1.0, "protege_km_1000": 1.0, "partage_longueur": 2.0,
                "partage_km_1000": 2.0, "total_longueur": 3.0},
        peers[0]: {"protege_longueur": 2.0, "protege_km_1000": 3.0, "partage_longueur": 2.0,
                   "partage_km_1000": 2.0, "total_longueur": 4.0},
        peers[1]: {"protege_longueur": 3.0, "protege_km_1000": 5.0, "partage_longueur": 2.0,
                   "partage_km_1000": 2.0, "total_longueur": 5.0},
        peers[2]: {"protege_longueur": 4.0, "protege_km_1000": 7.0, "partage_longueur": 2.0,
                   "partage_km_1000": 2.0, "total_longueur": 6.0},
        peers[3]: {},
    }
    for territory, values in offre_values.items():
        for detail in offre_units:
            value = values.get(detail)
            conn.execute("""INSERT INTO profile_observation(indicator_id,territory_id,territory_type,
                detail_key,sex_key,sex_axis_name,value,status)
                VALUES ('offre_cyclable',%s,'commune',%s,'',NULL,%s,%s)""",
                (territory, detail, value, "measured" if value is not None else "not_available"))
            conn.execute("""INSERT INTO profile_observation_source(indicator_id,territory_id,
                detail_key,sex_key,source_id,vintage_id)
                VALUES ('offre_cyclable',%s,%s,'','osm_reseaux','2026-08')""",
                (territory, detail))
    conn.execute("""INSERT INTO table_publication(table_name,content_version,row_count,
        reference_content_version) VALUES ('declared_profile','profiles-v1',49,'ref-v1')""")

    # Published fixed comparison for the descriptor's default bike detail only.
    density_members = [focal, *peers]
    conn.execute("""INSERT INTO profile_comparison_publication(singleton,content_version,
        profile_content_version,reference_content_version,group_row_count,territory_row_count)
        VALUES (true,'comparison-v1','profiles-v1','ref-v1',1,5)""")
    conn.execute("""INSERT INTO profile_comparison_group(comparison_context,group_id,territory_type,
        indicator_id,detail_key,sex_key,statistic,median,member_count,eligible_count,missing_count,
        lineage_source_count,profile_content_version,reference_content_version)
        VALUES ('density_class','D960','commune',%s,'b_km_1000','','median',2.0,5,4,1,2,'profiles-v1','ref-v1')""",
        (RESOURCE,))
    for territory, value, status, rank, ties, size in (
            (focal, 2.0, "measured", 2, 3, 4),
            (peers[0], 2.0, "measured", 2, 3, 4),
            (peers[1], 2.0, "measured", 2, 3, 4),
            (peers[2], 8.0, "measured", 1, 1, 4),
            (peers[3], None, "not_available", None, None, None)):
        conn.execute("""INSERT INTO profile_comparison_territory(comparison_context,group_id,
            territory_type,indicator_id,detail_key,sex_key,territory_id,value,status,rank,tie_count,
            rank_size,profile_content_version,reference_content_version)
            VALUES ('density_class','D960','commune',%s,'b_km_1000','',%s,%s,%s,%s,%s,%s,
                'profiles-v1','ref-v1')""",
            (RESOURCE, territory, value, status, rank, ties, size))
    for source_id, vintage_id in (("osm_reseaux", "2026-08"), ("stationnement-velo", "2022-2025")):
        conn.execute("""INSERT INTO comparison_source_lineage(comparison_family,comparison_context,
            group_id,territory_type,facet_id,source_id,vintage_id,comparison_content_version)
            VALUES ('profile','density_class','D960','commune',%s,%s,%s,'comparison-v1')""",
            (RESOURCE, source_id, vintage_id))
    return {
        "focal": focal, "peers": peers, "epci": epci,
        "unavailable_focal": unavailable_focal, "singleton": singleton,
    }


def _single(item):
    return {"resource": RESOURCE, "target": {"kind": "territory", "type": "commune", "id": item},
            "intent": {"kind": "fixed_comparison", "context": "default"}}


def test_fixed_declared_profile_detail_comparisons_http(canonical_db_env, monkeypatch):
    import psycopg
    from fastapi.testclient import TestClient
    from psycopg_pool import ConnectionPool

    from api import main, resource_execution

    with psycopg.connect(canonical_db_env["publish_dsn"], autocommit=True) as conn:
        seed = _seed(conn)
        versions = dict(conn.execute("""SELECT table_name,content_version FROM table_publication
            WHERE table_name IN ('declared_profile','territory_reference')""").fetchall())
    focal = seed["focal"]

    pool = ConnectionPool(conninfo=canonical_db_env["read_dsn"], min_size=0, max_size=1,
                          open=True, kwargs={"autocommit": True})
    previous = main.app.dependency_overrides.get(main.get_repository)
    main.app.dependency_overrides[main.get_repository] = lambda: main.ReadRepository(pool)
    try:
        with TestClient(main.app) as client:
            def read(payload):
                return client.post("/api/resources/read", json=payload)

            def fixed(detail=None, item=focal, **overrides):
                request = _single(item)
                request.update(overrides)
                if detail is not None:
                    request["coordinates"] = {"detail": [detail]}
                return request

            default = read(fixed())
            assert default.status_code == 200, default.text
            default_body = default.json()
            default_result = default_body["result"]
            # The descriptor's published default bike facet is still served from
            # the published comparison publication.
            assert default_result["source_facet"] == {"detail": "b_km_1000", "sex": None}
            assert default_result["median"] == pytest.approx(2.0)
            assert default_result["unit"] == UNITS
            assert default_result["direction"] == "high"
            assert default_result["denominator_semantics"] == "population"
            assert (default_result["rank"], default_result["rank_ties"],
                    default_result["rank_size"]) == (2, 3, 4)
            assert (default_result["selected_member_count"], default_result["eligible_count"],
                    default_result["missing_count"]) == (5, 4, 1)
            assert {source["source_id"] for source in default_result["comparison_sources"]} == {
                "osm_reseaux", "stationnement-velo"}
            assert "focal_value" not in default_result
            assert "member_ranks" not in default_result
            assert default_body["scope"] == {"kind": "density_class",
                                             "density_class_code": "D960",
                                             "territory_type": "commune",
                                             "member_count": 5}
            assert default_body["selection"] is None
            assert default_body["profile_content_version"] == versions["declared_profile"]
            assert default_body["reference_content_version"] == versions["territory_reference"]

            matching_default = read(fixed("b_km_1000"))
            assert matching_default.status_code == 200, matching_default.text
            assert matching_default.json() == default.json()

            results = {}
            for detail, median, rank, ties, sources in (
                    ("t_km_1000", 4.0, 3, 1, {"osm_reseaux"}),
                    ("c_km_1000", 3.0, 3, 2, {"osm_reseaux"})):
                response = read(fixed(detail))
                assert response.status_code == 200, response.text
                body = response.json()
                result = body["result"]
                results[detail] = result
                assert body["scope"] == default_body["scope"]
                assert body["selection"] is None
                assert body["profile_content_version"] == versions["declared_profile"]
                assert body["reference_content_version"] == versions["territory_reference"]
                assert result["source_facet"] == {"detail": detail, "sex": None}
                assert result["median"] == pytest.approx(median)
                assert result["median"] != pytest.approx(default_result["median"])
                assert result["unit"] == UNITS
                assert result["direction"] == "high"
                assert (result["rank"], result["rank_ties"], result["rank_size"]) == (rank, ties, 4)
                assert (result["selected_member_count"], result["eligible_count"],
                        result["missing_count"]) == (5, 4, 1)
                assert {source["source_id"] for source in result["comparison_sources"]} == sources
                assert "focal_value" not in result
            results["b_km_1000"] = default_result

            # Fixed and an identical explicit cohort resolve the same members and
            # the same request-scoped semantics, coordinate for coordinate.
            density_members = [{"type": "commune", "id": territory}
                               for territory in [focal, *seed["peers"]]]
            for detail in DETAILS:
                selected = read({
                    "resource": RESOURCE,
                    "target": {"kind": "territory", "type": "commune", "id": focal},
                    "coordinates": {"detail": [detail]},
                    "intent": {"kind": "selected_comparison", "members": density_members},
                })
                assert selected.status_code == 200, selected.text
                assert selected.json()["result"] == results[detail]
                assert selected.json()["selection"] == [
                    {"territory_type": member["type"], "territory_id": member["id"]}
                    for member in density_members]
                assert selected.json()["scope"] == {"kind": "explicit_selection",
                                                    "member_count": 5}
                assert selected.json()["profile_content_version"] == versions["declared_profile"]
                assert selected.json()["reference_content_version"] == versions["territory_reference"]
            selected_default = read({
                "resource": RESOURCE,
                "target": {"kind": "territory", "type": "commune", "id": focal},
                "intent": {"kind": "selected_comparison", "members": density_members},
            })
            assert selected_default.status_code == 200, selected_default.text
            assert selected_default.json()["result"] == default_result
            assert selected_default.json()["scope"] == {"kind": "explicit_selection",
                                                         "member_count": 5}

            # The compact fixed-profile result never carries the cohort-sized
            # peer projection. Only a selected comparison may request it.
            for request in (fixed(), fixed("t_km_1000")):
                rejected = read({**request, "fields": ["median", "member_ranks"]})
                assert rejected.status_code == 422, rejected.text
            assert all("member_ranks" not in results[detail] for detail in DETAILS)
            selected_ranks = read({
                "resource": RESOURCE,
                "target": {"kind": "territory", "type": "commune", "id": focal},
                "coordinates": {"detail": ["t_km_1000"]},
                "fields": ["median", "member_ranks"],
                "intent": {"kind": "selected_comparison", "members": density_members},
            })
            assert selected_ranks.status_code == 200, selected_ranks.text
            assert {row["territory_id"]: (row["rank"], row["rank_size"], row["rank_ties"])
                    for row in selected_ranks.json()["result"]["member_ranks"]} == {
                focal: (3, 4, 1),
                seed["peers"][0]: (4, 4, 1),
                seed["peers"][1]: (2, 4, 1),
                seed["peers"][2]: (1, 4, 1),
                seed["peers"][3]: (None, None, None),
            }
            published_ranks = read({
                "resource": RESOURCE,
                "target": {"kind": "territory", "type": "commune", "id": focal},
                "fields": ["median", "member_ranks"],
                "intent": {"kind": "selected_comparison", "members": density_members},
            })
            assert published_ranks.status_code == 200, published_ranks.text
            assert {row["territory_id"]: (row["rank"], row["rank_size"], row["rank_ties"])
                    for row in published_ranks.json()["result"]["member_ranks"]} == {
                focal: (2, 4, 3),
                seed["peers"][0]: (2, 4, 3),
                seed["peers"][1]: (2, 4, 3),
                seed["peers"][2]: (1, 4, 1),
                seed["peers"][3]: (None, None, None),
            }

            # The result unit follows the declared detail axis, not the
            # descriptor unit: offre_cyclable publishes km and km / 1 000 hab.
            offre = read({
                "resource": "offre_cyclable",
                "target": {"kind": "territory", "type": "commune", "id": focal},
                "coordinates": {"detail": ["protege_km_1000"]},
                "fields": ["median", "eligible_count", "missing_count"],
                "intent": {"kind": "fixed_comparison", "context": "default"},
            })
            assert offre.status_code == 200, offre.text
            offre_result = offre.json()["result"]
            assert offre_result["unit"] == UNITS
            assert offre_result["median"] == pytest.approx(4.0)
            assert (offre_result["eligible_count"], offre_result["missing_count"]) == (4, 1)
            offre_length = read({
                "resource": "offre_cyclable",
                "target": {"kind": "territory", "type": "commune", "id": focal},
                "coordinates": {"detail": ["protege_longueur"]},
                "fields": ["median", "eligible_count"],
                "intent": {"kind": "fixed_comparison", "context": "default"},
            })
            assert offre_length.status_code == 200, offre_length.text
            assert offre_length.json()["result"]["unit"] == "km"
            assert offre_length.json()["result"]["median"] == pytest.approx(2.5)

            # A focal outside the requested population receives no rank.
            outside = read({
                "resource": RESOURCE,
                "target": {"kind": "territory", "type": "commune", "id": focal},
                "coordinates": {"detail": ["t_km_1000"]},
                "intent": {"kind": "selected_comparison",
                           "members": [{"type": "commune", "id": seed["peers"][0]}]},
            })
            assert outside.status_code == 200, outside.text
            assert outside.json()["result"]["focal_in_selection"] is False
            assert outside.json()["result"]["rank"] is None

            unavailable = read(fixed("t_km_1000", seed["unavailable_focal"]))
            assert unavailable.status_code == 200, unavailable.text
            unavailable_result = unavailable.json()["result"]
            assert unavailable_result["status"] == "unavailable"
            assert unavailable_result["reason"] == "fewer_than_two_comparable_values"
            assert unavailable_result["median"] is None
            assert (unavailable_result["selected_member_count"],
                    unavailable_result["eligible_count"],
                    unavailable_result["missing_count"]) == (2, 0, 2)
            assert unavailable_result["rank"] is None

            singleton = read(fixed("t_km_1000", seed["singleton"]))
            assert singleton.status_code == 200, singleton.text
            singleton_result = singleton.json()["result"]
            assert singleton_result["status"] == "available"
            assert singleton_result["median"] == pytest.approx(7.0)
            assert (singleton_result["selected_member_count"], singleton_result["eligible_count"],
                    singleton_result["missing_count"]) == (1, 1, 0)
            assert (singleton_result["rank"], singleton_result["rank_size"],
                    singleton_result["rank_ties"]) == (None, None, None)

            undefined = read(fixed("nope"))
            assert undefined.status_code == 422, undefined.text
            multi = read(fixed(**{"coordinates": {"detail": ["t_km_1000", "c_km_1000"]}}))
            assert multi.status_code == 422, multi.text
            assert read(fixed(context="epci")).status_code == 422
            cohort_target = read({
                "resource": RESOURCE,
                "target": {"kind": "territory_cohort", "type": "commune"},
                "coordinates": {"detail": ["t_km_1000"]},
                "intent": {"kind": "fixed_comparison", "context": "default"},
            })
            assert cohort_target.status_code == 422, cohort_target.text

            # Single and batch are the same payload on the same snapshot.
            items = [{"id": detail, **fixed(detail)} for detail in DETAILS]
            batch = client.post("/api/resources/read-batch", json={"items": items})
            assert batch.status_code == 200, batch.text
            batch_by_id = {row["id"]: row["data"] for row in batch.json()["results"]}
            for detail in DETAILS:
                assert batch_by_id[detail] == read(fixed(detail)).json()
                assert batch_by_id[detail]["result"]["median"] == results[detail]["median"]
            assert len({batch_by_id[detail]["result"]["median"] for detail in DETAILS}) == 3

            # Preflight charges the resolved cohort's set-wise cell read: the
            # published default stays a keyed lookup, a declared coordinate does
            # not fit a work budget that only covers the focal row.
            monkeypatch.setattr(resource_execution, "MAX_WORK_UNITS", 10)
            assert read(fixed()).status_code == 200
            over_budget = read(fixed("t_km_1000"))
            assert over_budget.status_code == 413, over_budget.text
            over_budget_batch = client.post("/api/resources/read-batch", json={"items": items})
            assert over_budget_batch.status_code == 413, over_budget_batch.text
            monkeypatch.setattr(resource_execution, "MAX_WORK_UNITS", 200_000)

            # A stale declared-profile generation fails the published default
            # closed; the request-scoped coordinate read still uses the same
            # committed cells, exactly like an explicit selection.
            with psycopg.connect(canonical_db_env["publish_dsn"], autocommit=True) as writer:
                writer.execute("UPDATE table_publication SET content_version='profiles-v2' WHERE table_name='declared_profile'")
            try:
                assert read(fixed()).status_code == 503
                still_served = read(fixed("t_km_1000"))
                assert still_served.status_code == 200, still_served.text
                assert still_served.json()["result"]["median"] == pytest.approx(4.0)
            finally:
                with psycopg.connect(canonical_db_env["publish_dsn"], autocommit=True) as writer:
                    writer.execute("UPDATE table_publication SET content_version='profiles-v1' WHERE table_name='declared_profile'")

            # A missing published comparison generation fails the default closed
            # and leaves the cell-derived coordinate read intact.
            with psycopg.connect(canonical_db_env["publish_dsn"], autocommit=True) as writer:
                writer.execute("DELETE FROM profile_comparison_publication")
            try:
                assert read(fixed()).status_code == 503
                assert read(fixed("c_km_1000")).status_code == 200
            finally:
                with psycopg.connect(canonical_db_env["publish_dsn"], autocommit=True) as writer:
                    writer.execute("""INSERT INTO profile_comparison_publication(singleton,content_version,
                        profile_content_version,reference_content_version,group_row_count,
                        territory_row_count) VALUES (true,'comparison-v1','profiles-v1','ref-v1',1,5)""")

            # Missing cell provenance is never fabricated or zero-filled.
            with psycopg.connect(canonical_db_env["publish_dsn"], autocommit=True) as writer:
                writer.execute("""DELETE FROM profile_observation_source WHERE territory_id=%s
                    AND detail_key='t_km_1000'""", (focal,))
            try:
                assert read(fixed("t_km_1000")).status_code == 503
                assert read(fixed("c_km_1000")).status_code == 503
            finally:
                with psycopg.connect(canonical_db_env["publish_dsn"], autocommit=True) as writer:
                    writer.execute("""INSERT INTO profile_observation_source(indicator_id,territory_id,
                        detail_key,sex_key,source_id,vintage_id)
                        VALUES (%s,%s,'t_km_1000','','osm_reseaux','2026-08')""", (RESOURCE, focal))
            assert read(fixed("t_km_1000")).status_code == 200
    finally:
        if previous is None:
            main.app.dependency_overrides.pop(main.get_repository, None)
        else:
            main.app.dependency_overrides[main.get_repository] = previous
        pool.close()
