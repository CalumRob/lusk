"""Guarded HTTP proof that a declared-but-unpublished scalar fails closed with 503 (#971).

The producer catalogue declares ``bornes_recharge_1000``, ``stations_service`` and
``stations_service_1000`` for the Mobility theme while their numerical publication
is intentionally still absent. Facts already failed closed; a fixed or selected
comparison fell through to the legacy direct-read ``404``. The endpoint contract
distinguishes an unknown identity (``404``/``422``) from an absent publication
dependency (``503``), and the app isolates only the latter.

The fixture publishes one real declared scalar beside the three unpublished
declarations, so the same schema proves both sides of the boundary: the published
scalar is served unchanged, its dependencies still fail closed when dropped, and
the unpublished declarations never borrow its data.
"""

from __future__ import annotations

import pytest

from api.tests.integration.test_postgres_publication import canonical_db_env  # noqa: F401

pytestmark = pytest.mark.integration

THEME = "mobilite"
UNPUBLISHED_RESOURCES = ("bornes_recharge_1000", "stations_service", "stations_service_1000")
PUBLISHED_RESOURCE = "places_stationnement_velo_1000"
PUBLISHED_LABEL = "Places de stationnement vélo pour 1 000 hab."
PUBLISHED_UNIT = "places / 1 000 hab."
FOCAL, PEER = "29001", "29002"
DENSITY_CLASS = "D1"
PUBLICATION_UNAVAILABLE = "Declared resource publication is unavailable"


def _seed(conn):
    """Publish one declared mobility scalar; leave the three new declarations absent."""
    conn.execute("""INSERT INTO territory_reference(territory_id,territory_type,name,department_id,
        epci_id,density_class_code,density_class_label) VALUES
        (%s,'commune','Focal','29','E1',%s,'Dense'),
        (%s,'commune','Peer','29','E1',%s,'Dense')""",
        (FOCAL, DENSITY_CLASS, PEER, DENSITY_CLASS))
    conn.execute("INSERT INTO table_publication(table_name,content_version,row_count) "
                 "VALUES ('territory_reference','territory-v1',2)")
    conn.execute("INSERT INTO source_dataset(source_id,name) VALUES "
                 "('osm_stationnement','OpenStreetMap stationnement'),"
                 "('ecolab_stationnement','Ecolab stationnement')")
    conn.execute("""INSERT INTO source_vintage(source_id,vintage_id,version,reference_date,
        publication_date) VALUES
        ('osm_stationnement','2026-08','2026-08','2026-08-05','2026-08-06'),
        ('ecolab_stationnement','2022-2025','2022-2025','2025-01-01','2026-02-03')""")
    with conn.transaction():
        conn.execute("""INSERT INTO scalar_descriptor(indicator_id,theme_id,label,unit,direction,
            comparison_facet,allowed_levels,denominator_semantics,completeness,descriptor_version)
            VALUES (%s,%s,%s,%s,'high',%s,ARRAY['commune','epci','departement'],'population',
                    'dense_complete','stationnement-v1')""",
            (PUBLISHED_RESOURCE, THEME, PUBLISHED_LABEL, PUBLISHED_UNIT, PUBLISHED_RESOURCE))
        conn.execute("INSERT INTO scalar_descriptor_source VALUES (%s,'osm_stationnement'),"
                     "(%s,'ecolab_stationnement')", (PUBLISHED_RESOURCE, PUBLISHED_RESOURCE))
    with conn.transaction():
        conn.execute("""INSERT INTO scalar_observation(indicator_id,territory_id,territory_type,value,
            status,support_count,denominator_count) VALUES
            (%s,%s,'commune',12.0,'measured',12,1000),
            (%s,%s,'commune',4.0,'measured',4,1000)""",
            (PUBLISHED_RESOURCE, FOCAL, PUBLISHED_RESOURCE, PEER))
        conn.execute("""INSERT INTO scalar_observation_source(indicator_id,territory_id,source_id,
            vintage_id) VALUES
            (%s,%s,'osm_stationnement','2026-08'),(%s,%s,'ecolab_stationnement','2022-2025'),
            (%s,%s,'osm_stationnement','2026-08'),(%s,%s,'ecolab_stationnement','2022-2025')""",
            (PUBLISHED_RESOURCE, FOCAL, PUBLISHED_RESOURCE, FOCAL,
             PUBLISHED_RESOURCE, PEER, PUBLISHED_RESOURCE, PEER))
    conn.execute("""INSERT INTO table_publication(table_name,content_version,row_count,
        reference_content_version) VALUES ('scalar_observation','scalar-v1',2,'territory-v1')""")
    # The published default density-class comparison, ranking focal (12) above peer (4).
    conn.execute("""INSERT INTO scalar_comparison_group(comparison_context,group_id,territory_type,
        indicator_id,statistic,median,member_count,eligible_count,missing_count,
        lineage_source_count) VALUES ('density_class',%s,'commune',%s,'median',8.0,2,2,0,2)""",
        (DENSITY_CLASS, PUBLISHED_RESOURCE))
    conn.execute("""INSERT INTO scalar_comparison_territory(comparison_context,group_id,
        territory_type,indicator_id,territory_id,value,status,rank,tie_count,rank_size) VALUES
        ('density_class',%s,'commune',%s,%s,12.0,'measured',1,1,2),
        ('density_class',%s,'commune',%s,%s,4.0,'measured',2,1,2)""",
        (DENSITY_CLASS, PUBLISHED_RESOURCE, FOCAL,
         DENSITY_CLASS, PUBLISHED_RESOURCE, PEER))
    conn.execute("""INSERT INTO comparison_source_lineage(comparison_family,comparison_context,
        group_id,territory_type,facet_id,source_id,vintage_id,comparison_content_version) VALUES
        ('scalar','density_class',%s,'commune',%s,'osm_stationnement','2026-08','comparison-v1'),
        ('scalar','density_class',%s,'commune',%s,'ecolab_stationnement','2022-2025',
         'comparison-v1')""",
        (DENSITY_CLASS, PUBLISHED_RESOURCE, DENSITY_CLASS, PUBLISHED_RESOURCE))
    conn.execute("""INSERT INTO scalar_comparison_publication(singleton,content_version,
        scalar_content_version,reference_content_version,group_row_count,territory_row_count,
        lineage_row_count) VALUES (true,'comparison-v1','scalar-v1','territory-v1',1,2,2)""")


def _territory(target_id=FOCAL):
    return {"kind": "territory", "type": "commune", "id": target_id}


def _facts(resource, target_id=FOCAL):
    return {"resource": resource, "target": _territory(target_id), "intent": {"kind": "facts"}}


def _fixed(resource, target_id=FOCAL):
    return {"resource": resource, "target": _territory(target_id),
            "intent": {"kind": "fixed_comparison", "context": "default"}}


def _selected(resource, target_id=FOCAL, members=(FOCAL, PEER)):
    return {"resource": resource, "target": _territory(target_id),
            "intent": {"kind": "selected_comparison",
                       "members": [{"type": "commune", "id": member} for member in members]}}


def test_declared_unpublished_scalar_comparisons_fail_closed_http(canonical_db_env):
    import psycopg
    from fastapi.testclient import TestClient
    from psycopg_pool import ConnectionPool

    from api import main

    with psycopg.connect(canonical_db_env["publish_dsn"], autocommit=True) as conn:
        _seed(conn)

    pool = ConnectionPool(conninfo=canonical_db_env["read_dsn"], min_size=0, max_size=1,
                          open=True, kwargs={"autocommit": True})
    previous = main.app.dependency_overrides.get(main.get_repository)
    main.app.dependency_overrides[main.get_repository] = lambda: main.ReadRepository(pool)
    try:
        with TestClient(main.app) as client:
            def read(payload):
                return client.post("/api/resources/read", json=payload)

            def read_batch(items):
                return client.post("/api/resources/read-batch", json={"items": items})

            def assert_publication_unavailable(response, label):
                assert response.status_code == 503, f"{label}: {response.status_code} {response.text}"
                assert response.json()["detail"] == PUBLICATION_UNAVAILABLE, label

            # (1) A producer-declared scalar with no publication fails closed for
            # facts, fixed and selected comparison — single and batch alike.
            for resource in UNPUBLISHED_RESOURCES:
                assert_publication_unavailable(read(_facts(resource)), f"{resource} facts")
                assert_publication_unavailable(read(_fixed(resource)), f"{resource} fixed")
                assert_publication_unavailable(read(_selected(resource)), f"{resource} selected")
                batch = read_batch([
                    {"id": "facts", **_facts(resource)},
                    {"id": "fixed", **_fixed(resource)},
                    {"id": "selected", **_selected(resource)},
                ])
                assert_publication_unavailable(batch, f"{resource} batch")
                assert "results" not in batch.json()

            # (2) A mixed batch is rejected atomically: the published member is not
            # salvaged as a successful prefix.
            mixed = read_batch([
                {"id": "published", **_facts(PUBLISHED_RESOURCE)},
                {"id": "unpublished", **_facts(UNPUBLISHED_RESOURCES[0])},
            ])
            assert_publication_unavailable(mixed, "mixed batch")
            assert "results" not in mixed.json()

            # (3) The published declared scalar is unchanged: exact facts,
            # descriptor, sources and versions, computed independently of the
            # unpublished declarations.
            published = read(_facts(PUBLISHED_RESOURCE))
            assert published.status_code == 200, published.text
            published_facts = published.json()
            assert published_facts["indicator_id"] == PUBLISHED_RESOURCE
            assert published_facts["label"] == PUBLISHED_LABEL
            assert published_facts["unit"] == PUBLISHED_UNIT
            assert published_facts["direction"] == "high"
            assert published_facts["descriptor_version"] == "stationnement-v1"
            assert published_facts["value"] == pytest.approx(12.0)
            assert published_facts["status"] == "measured"
            assert published_facts["support_count"] == 12
            assert published_facts["denominator_count"] == 1000
            assert published_facts["content_version"] == "scalar-v1"
            assert published_facts["reference_content_version"] == "territory-v1"
            assert {(source["source_id"], source["vintage_id"])
                    for source in published_facts["sources"]} == {
                ("osm_stationnement", "2026-08"), ("ecolab_stationnement", "2022-2025")}
            peer_facts = read(_facts(PUBLISHED_RESOURCE, PEER))
            assert peer_facts.status_code == 200, peer_facts.text
            assert peer_facts.json()["value"] == pytest.approx(4.0)

            # Fixed comparison: the published median, direction-aware rank, tie,
            # cohort scope, lineage and version clocks are served unchanged.
            fixed = read(_fixed(PUBLISHED_RESOURCE))
            assert fixed.status_code == 200, fixed.text
            fixed_body = fixed.json()
            assert fixed_body["shape"] == "scalar"
            assert fixed_body["selection"] is None
            assert fixed_body["scope"] == {"kind": "density_class",
                                           "density_class_code": DENSITY_CLASS,
                                           "territory_type": "commune",
                                           "member_count": 2}
            assert fixed_body["content_version"] == "scalar-v1"
            assert fixed_body["reference_content_version"] == "territory-v1"
            fixed_result = fixed_body["result"]
            assert fixed_result["source_facet"] == PUBLISHED_RESOURCE
            assert fixed_result["unit"] == PUBLISHED_UNIT
            assert fixed_result["label"] == PUBLISHED_LABEL
            assert fixed_result["direction"] == "high"
            assert fixed_result["status"] == "available"
            assert fixed_result["median"] == pytest.approx(8.0)
            assert (fixed_result["rank"], fixed_result["rank_size"]) == (1, 2)
            assert "rank_ties" not in fixed_result
            assert (fixed_result["selected_member_count"], fixed_result["eligible_count"],
                    fixed_result["missing_count"]) == (2, 2, 0)
            assert {(source["source_id"], source["vintage_id"])
                    for source in fixed_result["comparison_sources"]} == {
                ("osm_stationnement", "2026-08"), ("ecolab_stationnement", "2022-2025")}
            assert "focal_value" not in fixed_result
            tied = read({**_fixed(PUBLISHED_RESOURCE),
                         "fields": ["median", "rank", "rank_ties", "rank_size"]})
            assert tied.status_code == 200, tied.text
            assert tied.json()["result"]["rank_ties"] == 1

            # Request-scoped selection stays computed from the published cells:
            # a single-member selection is not a published group, and it is never
            # zero-filled or borrowed from an unpublished declaration.
            selected = read(_selected(PUBLISHED_RESOURCE, members=(FOCAL,)))
            assert selected.status_code == 200, selected.text
            selected_body = selected.json()
            assert selected_body["scope"] == {"kind": "explicit_selection", "member_count": 1}
            selected_result = selected_body["result"]
            assert selected_result["median"] == pytest.approx(12.0)
            assert (selected_result["eligible_count"], selected_result["missing_count"]) == (1, 0)
            assert "focal_value" not in selected_result
            assert (selected_result["rank"], selected_result["rank_size"]) == (1, 1)
            assert "rank_ties" not in selected_result
            # A full commune selection resolves the EPCI context before the
            # density class; that group is not published in this fixture, so the
            # read fails closed instead of borrowing the density publication.
            epci_context = read(_selected(PUBLISHED_RESOURCE))
            assert epci_context.status_code == 503, epci_context.text

            # (4) Genuine identity, coordinate and request-shape failures keep
            # their existing semantics and are never disguised as publication
            # absence — even on an unpublished declaration.
            unknown_resource = read(_facts("no_such_semantic_resource"))
            assert unknown_resource.status_code == 422, unknown_resource.text
            unknown_member = read(_selected(PUBLISHED_RESOURCE, members=(FOCAL, "99999")))
            assert unknown_member.status_code == 404, unknown_member.text
            unknown_member_unpublished = read(
                _selected(UNPUBLISHED_RESOURCES[0], members=(FOCAL, "99999")))
            assert unknown_member_unpublished.status_code == 404, unknown_member_unpublished.text
            unknown_focal = read(_fixed(PUBLISHED_RESOURCE, "99999"))
            assert unknown_focal.status_code == 404, unknown_focal.text
            unknown_focal_unpublished = read(_fixed(UNPUBLISHED_RESOURCES[0], "99999"))
            assert unknown_focal_unpublished.status_code == 404, unknown_focal_unpublished.text
            malformed_context = read({**_fixed(PUBLISHED_RESOURCE),
                                      "intent": {"kind": "fixed_comparison", "context": "epci"}})
            assert malformed_context.status_code == 422, malformed_context.text
            undeclared_coordinate = read({**_fixed(PUBLISHED_RESOURCE),
                                          "coordinates": {"detail": ["nope"]}})
            assert undeclared_coordinate.status_code == 422, undeclared_coordinate.text
            member_type_mismatch = read({
                "resource": PUBLISHED_RESOURCE,
                "target": _territory(),
                "intent": {"kind": "selected_comparison",
                           "members": [{"type": "region", "id": PEER}]},
            })
            assert member_type_mismatch.status_code == 422, member_type_mismatch.text

            # Single reads are the same payloads as the independently read parts
            # of a successful batch.
            published_batch = read_batch([
                {"id": "facts", **_facts(PUBLISHED_RESOURCE)},
                {"id": "fixed", **_fixed(PUBLISHED_RESOURCE)},
            ])
            assert published_batch.status_code == 200, published_batch.text
            by_id = {row["id"]: row["data"] for row in published_batch.json()["results"]}
            assert by_id["facts"] == published_facts
            assert by_id["fixed"] == fixed_body

            # (5) Dropping or staling the published scalar's own dependencies
            # still fails closed. Comparison provenance is part of the read, not
            # a fallback to the facts table.
            with psycopg.connect(canonical_db_env["publish_dsn"], autocommit=True) as writer:
                writer.execute("DELETE FROM comparison_source_lineage WHERE facet_id=%s",
                               (PUBLISHED_RESOURCE,))
            try:
                assert read(_fixed(PUBLISHED_RESOURCE)).status_code == 503
            finally:
                with psycopg.connect(canonical_db_env["publish_dsn"], autocommit=True) as writer:
                    writer.execute("""INSERT INTO comparison_source_lineage(comparison_family,
                        comparison_context,group_id,territory_type,facet_id,source_id,vintage_id,
                        comparison_content_version) VALUES
                        ('scalar','density_class',%s,'commune',%s,'osm_stationnement','2026-08',
                         'comparison-v1'),
                        ('scalar','density_class',%s,'commune',%s,'ecolab_stationnement','2022-2025',
                         'comparison-v1')""",
                        (DENSITY_CLASS, PUBLISHED_RESOURCE, DENSITY_CLASS, PUBLISHED_RESOURCE))
            assert read(_fixed(PUBLISHED_RESOURCE)).status_code == 200

            with psycopg.connect(canonical_db_env["publish_dsn"], autocommit=True) as writer:
                writer.execute("UPDATE table_publication SET content_version='reference-v2' "
                               "WHERE table_name='territory_reference'")
            try:
                assert read(_facts(PUBLISHED_RESOURCE)).status_code == 503
                assert read(_fixed(PUBLISHED_RESOURCE)).status_code == 503
                assert read(_selected(PUBLISHED_RESOURCE, members=(FOCAL,))).status_code == 503
                stale_batch = read_batch([{"id": "facts", **_facts(PUBLISHED_RESOURCE)}])
                assert stale_batch.status_code == 503, stale_batch.text
                # The unpublished declarations keep the same publication-gap
                # status under a stale reference clock.
                assert_publication_unavailable(read(_fixed(UNPUBLISHED_RESOURCES[0])),
                                               "unpublished under stale reference")
            finally:
                with psycopg.connect(canonical_db_env["publish_dsn"], autocommit=True) as writer:
                    writer.execute("UPDATE table_publication SET content_version='territory-v1' "
                                   "WHERE table_name='territory_reference'")
            assert read(_facts(PUBLISHED_RESOURCE)).status_code == 200
    finally:
        if previous is None:
            main.app.dependency_overrides.pop(main.get_repository, None)
        else:
            main.app.dependency_overrides[main.get_repository] = previous
        pool.close()
