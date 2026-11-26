"""Shape-agnostic guarded HTTP contracts for resource publication identity.

Every registered publication shape uses the same registry, version-bound
discovery descriptor, unknown-resource admission and retirement outcome. Shape
facts stay in their own adapters and per-shape suites; this module proves only
the publication contract shared by all five shapes.
"""

from __future__ import annotations

from dataclasses import dataclass

import pytest

from api.tests.integration.resource_publication_helper import publish_resource
from api.tests.integration.test_postgres_publication import canonical_db_env
from api.tests.resource_grammar_fixtures import SHAPES, five_shape_grammar, semantic_resource_id


pytestmark = pytest.mark.integration
FOCAL = "fixture-c1"


@dataclass(frozen=True)
class ShapeCase:
    shape: str
    resource_id: str
    semantic_ids: tuple[str, ...]
    family: str
    declarations: dict


def _indicator_declaration(resource_id, shape):
    page = {
        "indicator": resource_id,
        "label": resource_id,
        "unit": "count",
        "direction": "high",
        "levels": ["commune"],
        "sources": ["fixture_source"],
    }
    metadata = {
        "theme": "fixture",
        "indicator_keys": [resource_id],
        "sources": {resource_id: "fixture_source"},
        "source_records": {"fixture_source": {
            "name": "Fixture source",
            "vintages": [{"id": "v1", "version": "2026"}],
        }},
        "indicator_pages": {resource_id: page},
    }
    if shape == "scalar":
        page["comparison"] = {"unit": "count"}
        metadata["scalar_contracts"] = {resource_id: {
            "allowed_levels": ["commune"],
            "comparison_facet": resource_id,
            "completeness": "dense_complete",
            "counts_available": True,
        }}
    elif shape == "declared_profile":
        page["unit"] = "%"
        page["comparison"] = {"unit": "%", "details": ["d1"], "detail": "d1"}
        page["pyramid"] = {"dimensions": ["detail"]}
        metadata["profile_contracts"] = {resource_id: {
            "allowed_levels": ["commune"],
            "completeness": "dense_complete",
            "detail_units": {"d1": "%"},
        }}
    elif shape == "owned_series":
        page["axis_kind"] = "year"
        page["axis_values"] = ["2025"]
        page["comparison"] = {"unit": "count", "details": ["2025"], "detail": "2025"}
        metadata["owned_series_routes"] = {resource_id: {
            "axis_kind": "year",
            "axis_values": ["2025"],
            "comparison_point": "2025",
        }}
    elif shape == "observed_collection":
        page["comparison"] = {
            "unit": "count", "details": ["d1"], "detail": "d1", "dimension": "2025",
        }
        metadata["observed_collection_contracts"] = {resource_id: {
            "kind": "period_detail", "completeness": "observed_sparse",
        }}
    else:
        raise AssertionError(shape)
    return {"kind": "indicator", "metadata": metadata}


def _shape_cases():
    from api.resource_catalogue import default_resource_grammar

    cases = []
    for shape in ("scalar", "declared_profile", "owned_series", "observed_collection"):
        resource_id = "fixture_" + shape
        declaration = _indicator_declaration(resource_id, shape)
        cases.append(pytest.param(ShapeCase(
            shape=shape,
            resource_id=resource_id,
            semantic_ids=(resource_id,),
            family={
                "scalar": "scalar",
                "declared_profile": "profile",
                "owned_series": "ordered_series",
                "observed_collection": "collection",
            }[shape],
            declarations={resource_id: declaration},
        ), id=shape))
    grammar = default_resource_grammar().semantic_by_id
    semantic_ids = ("aedar_territorial_aggregate", "aedar_territory_summary")
    cases.append(pytest.param(ShapeCase(
        shape="aedar",
        resource_id="aedar",
        semantic_ids=semantic_ids,
        family="aedar",
        declarations={
            resource_id: {"kind": grammar[resource_id]["kind"],
                          "declaration": grammar[resource_id]}
            for resource_id in semantic_ids
        },
    ), id="aedar"))
    return cases


@pytest.mark.parametrize("case", _shape_cases())
def test_unknown_and_retired_resource_classification(canonical_db_env, case):
    import psycopg
    from fastapi.testclient import TestClient
    from psycopg_pool import ConnectionPool
    from api import main

    with psycopg.connect(canonical_db_env["publish_dsn"]) as connection:
        connection.execute(
            "INSERT INTO territory_reference(territory_id,territory_type,name) VALUES (%s,'commune','Focal')",
            (FOCAL,),
        )
        connection.execute(
            "INSERT INTO table_publication(table_name,content_version,row_count) VALUES ('territory_reference','ref-v1',1)",
        )

    pool = ConnectionPool(conninfo=canonical_db_env["read_dsn"], min_size=0, max_size=1,
                          open=True, kwargs={"autocommit": True})
    previous = main.app.dependency_overrides.get(main.get_repository)
    main.app.dependency_overrides[main.get_repository] = lambda: main.ReadRepository(pool)
    try:
        with TestClient(main.app) as client:
            def item(resource_id):
                return {
                    "resource": resource_id,
                    "target": {"kind": "territory", "type": "commune", "id": FOCAL},
                    "intent": {"kind": "facts"},
                }

            def discovered():
                response = client.get("/api/resources")
                assert response.status_code == 200, response.text
                return {row["resource_id"] for row in response.json()["resources"]}

            unknown_id = "missing_" + case.shape
            unknown = client.post("/api/resources/read", json=item(unknown_id))
            assert unknown.status_code == 422, unknown.text
            assert unknown.json()["detail"] == "unknown semantic resource"
            assert unknown_id not in discovered()

            for version in ("fixture-v1", "fixture-v2"):
                with psycopg.connect(canonical_db_env["publish_dsn"]) as connection:
                    with connection.transaction():
                        publish_resource(
                            connection, case.resource_id, case.shape, version,
                            reference_content_version="ref-v1",
                            declarations=case.declarations,
                        )
                assert set(case.semantic_ids) <= discovered()
                with psycopg.connect(canonical_db_env["read_dsn"]) as connection:
                    rows = connection.execute(
                        """SELECT resource_id,content_version FROM resource_publication_descriptor
                           WHERE publication_resource_id=%s""", (case.resource_id,),
                    ).fetchall()
                assert set(rows) == {(resource_id, version) for resource_id in case.semantic_ids}

            with psycopg.connect(canonical_db_env["publish_dsn"]) as connection:
                with connection.transaction():
                    publish_resource(
                        connection, case.resource_id, case.shape, "fixture-v2",
                        reference_content_version="ref-v1", retired=True,
                        declarations=case.declarations,
                    )
            assert not set(case.semantic_ids) & discovered()
            retired = client.post("/api/resources/read", json=item(case.semantic_ids[0]))
            assert retired.status_code == 503, retired.text
            batch = client.post("/api/resources/read-batch", json={
                "contract": "semantic-read-batch-v2",
                "items": [{"id": "retired", **item(case.semantic_ids[0])}],
            })
            assert batch.status_code == 200, batch.text
            assert batch.json()["results"] == [{
                "id": "retired",
                "resource": case.semantic_ids[0],
                "status": "publication_unavailable",
                "reason": "publication_absent",
                "family": case.family,
            }]
    finally:
        if previous is None:
            main.app.dependency_overrides.pop(main.get_repository, None)
        else:
            main.app.dependency_overrides[main.get_repository] = previous
        pool.close()


@pytest.mark.parametrize(("kind", "family", "relation"), SHAPES)
def test_declared_but_unpublished_resource_is_an_item_outcome_over_real_http(
        canonical_db_env, tmp_path, kind, family, relation):
    """Grammar identity is admission; the registry alone decides availability."""
    import psycopg
    from fastapi.testclient import TestClient
    from psycopg_pool import ConnectionPool
    from api import main

    grammar = five_shape_grammar(tmp_path)
    resource_id = semantic_resource_id(kind)
    with psycopg.connect(canonical_db_env["publish_dsn"]) as connection:
        connection.execute(
            "INSERT INTO territory_reference(territory_id,territory_type,name) VALUES (%s,'commune','Focal')",
            (FOCAL,),
        )
        connection.execute(
            "INSERT INTO table_publication(table_name,content_version,row_count) VALUES ('territory_reference','ref-v1',1)",
        )

    pool = ConnectionPool(conninfo=canonical_db_env["read_dsn"], min_size=0, max_size=1,
                          open=True, kwargs={"autocommit": True})
    previous_repository = main.app.dependency_overrides.get(main.get_repository)
    previous_grammar = main.app.dependency_overrides.get(main.get_resource_grammar)
    main.app.dependency_overrides[main.get_repository] = lambda: main.ReadRepository(pool)
    main.app.dependency_overrides[main.get_resource_grammar] = lambda: grammar
    try:
        with TestClient(main.app) as client:
            item = {
                "resource": resource_id,
                "target": {"kind": "territory", "type": "commune", "id": FOCAL},
                "intent": {"kind": "facts"},
            }
            single = client.post("/api/resources/read", json=item)
            assert single.status_code == 503, single.text
            assert single.json()["detail"] == "Resource publication is unavailable"

            batch = client.post("/api/resources/read-batch", json={
                "contract": "semantic-read-batch-v2",
                "items": [{"id": "unpublished", **item}],
            })
            assert batch.status_code == 200, batch.text
            assert batch.json()["results"] == [{
                "id": "unpublished", "resource": resource_id,
                "status": "publication_unavailable", "reason": "publication_absent",
                "family": family,
            }]
            discovery = client.get("/api/resources")
            assert discovery.status_code == 200, discovery.text
            assert discovery.json()["resources"] == []
    finally:
        if previous_repository is None:
            main.app.dependency_overrides.pop(main.get_repository, None)
        else:
            main.app.dependency_overrides[main.get_repository] = previous_repository
        if previous_grammar is None:
            main.app.dependency_overrides.pop(main.get_resource_grammar, None)
        else:
            main.app.dependency_overrides[main.get_resource_grammar] = previous_grammar
        pool.close()
