"""Optional actual HTTP-to-PostgreSQL parity check for the disposable rehearsal."""
import os

import pytest


@pytest.mark.skipif(not os.getenv("LUSK_SERIES_HTTP_DATABASE_URL"), reason="disposable rehearsal only")
def test_owned_series_http_reads_canonical_peer_facts_and_lineage_from_snapshot():
    from fastapi.testclient import TestClient
    import psycopg
    from api.main import app, pool

    dsn = os.environ["LUSK_SERIES_HTTP_DATABASE_URL"]
    dataset = os.environ["LUSK_SERIES_HTTP_DATASET"]
    indicator = os.environ["LUSK_SERIES_HTTP_INDICATOR"]
    territory = os.environ["LUSK_SERIES_HTTP_TERRITORY"]
    comparison_detail = os.environ["LUSK_SERIES_HTTP_DETAIL"]
    scope_level = os.environ["LUSK_SERIES_HTTP_SCOPE"]
    epci_id = os.getenv("LUSK_SERIES_HTTP_EPCI")
    pool.cache_clear()
    with psycopg.connect(dsn) as conn:
        expected = conn.execute(
            """SELECT o.axis_value,o.value,o.status,array_agg(p.source_id ORDER BY p.source_id)
               FROM series_dataset_observation o
               JOIN series_observation_provenance a USING(dataset_id,indicator_id,territory_id,axis_value)
               JOIN series_provenance_revision p USING(provenance_revision_id)
               WHERE o.dataset_id=%s AND o.indicator_id=%s AND o.territory_id=%s
               GROUP BY o.axis_value,o.value,o.status
               ORDER BY o.axis_value""", (dataset, indicator, territory)
        ).fetchall()
    assert expected
    with TestClient(app) as client:
        response = client.get(
            f"/api/series-datasets/{dataset}/territories/commune/{territory}/{indicator}",
            params={"scope_level": scope_level, "comparison_detail": comparison_detail,
                **({"epci_id": epci_id} if epci_id else {})},
        )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["dataset_id"] == dataset
    assert body["comparison"]["point"] == comparison_detail
    assert body["comparison"]["direction"] in ("low", "high")
    assert body["scope_series"]
    assert any(group["territory"]["id"] == territory for group in body["scope_series"])
    actual = {p["axis"]: p for p in body["points"]}
    for axis, value, status, sources in expected:
        point = actual[axis]
        assert point["value"] == value
        assert point["status"] == status
        assert sorted({lineage["source_id"] for lineage in point["provenance"]}) == sorted(sources)
    peer_ids=[group["territory"]["id"] for group in body["scope_series"]]
    with psycopg.connect(dsn) as conn:
        expected_scope=conn.execute(
            """SELECT o.territory_id,o.axis_value,o.value,o.status,array_agg(p.source_id ORDER BY p.source_id)
               FROM series_dataset_observation o
               JOIN series_observation_provenance a USING(dataset_id,indicator_id,territory_id,axis_value)
               JOIN series_provenance_revision p USING(provenance_revision_id)
               WHERE o.dataset_id=%s AND o.indicator_id=%s AND o.territory_id=ANY(%s::text[])
               GROUP BY o.territory_id,o.axis_value,o.value,o.status""",
            (dataset,indicator,peer_ids),
        ).fetchall()
    expected_by_peer={(row[0],row[1]):row[2:] for row in expected_scope}
    for group in body["scope_series"]:
        peer_id=group["territory"]["id"]
        for point in group["points"]:
            value,status,sources=expected_by_peer[(peer_id,point["axis"])]
            assert point["value"] == value
            assert point["status"] == status
            assert sorted({lineage["source_id"] for lineage in point["provenance"]}) == sorted(sources)
    detail = body["comparison"]["point"]
    focal_value = actual[detail]["value"] if actual[detail]["status"] == "measured" else None
    cohort_values = [next((p["value"] for p in group["points"] if p["axis"] == detail and p["status"] == "measured"), None)
        for group in body["scope_series"]]
    cohort_values = [value for value in cohort_values if value is not None]
    if focal_value is not None:
        direction = body["comparison"]["direction"]
        better = sum(value > focal_value if direction == "high" else value < focal_value for value in cohort_values)
        ties = sum(value == focal_value for value in cohort_values)
        assert body["comparison"]["rank"] == better + 1
        assert body["comparison"]["ties"] == ties
        assert body["comparison"]["comparable_count"] == len(cohort_values)
