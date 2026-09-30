"""Optional actual HTTP-to-PostgreSQL parity check for the disposable rehearsal."""
import os
import threading

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
    department_id = os.getenv("LUSK_SERIES_HTTP_DEPARTMENT")
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
        expected_peer_ids = [row[0] for row in conn.execute(
            """SELECT t.territory_id FROM territory_reference t
               WHERE t.territory_type=%s AND (%s::text IS NULL OR t.epci_id=%s)
                 AND (%s::text IS NULL OR t.department_id=%s)
                 AND EXISTS(SELECT 1 FROM series_dataset_observation o
                   WHERE o.dataset_id=%s AND o.indicator_id=%s AND o.territory_id=t.territory_id)
               ORDER BY t.territory_id""",
            (scope_level,epci_id,epci_id,department_id,department_id,dataset,indicator),
        ).fetchall()]
        canonical_cohort = conn.execute(
            """SELECT value FROM series_dataset_observation
               WHERE dataset_id=%s AND indicator_id=%s AND territory_id=ANY(%s::text[])
                 AND axis_value=%s AND status='measured' ORDER BY territory_id""",
            (dataset,indicator,expected_peer_ids,comparison_detail),
        ).fetchall()
        canonical_values=[row[0] for row in canonical_cohort]
    assert expected
    with TestClient(app) as client:
        response = client.get(
            f"/api/series-datasets/{dataset}/territories/commune/{territory}/{indicator}",
            params={"scope_level": scope_level,
                    **({"epci_id": epci_id} if epci_id else {}),
                    **({"department_id": department_id} if department_id else {})},
        )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["dataset_id"] == dataset
    assert body["comparison"]["point"] == comparison_detail
    assert body["comparison"]["direction"] in ("low", "high")
    with TestClient(app) as client:
        alternate = client.get(
            f"/api/series-datasets/{dataset}/territories/commune/{territory}/{indicator}",
            params={"scope_level": scope_level, "comparison_detail": "2021",
                    **({"epci_id": epci_id} if epci_id else {}),
                    **({"department_id": department_id} if department_id else {})},
        )
    assert alternate.status_code == 422
    assert body["scope_series"]
    assert any(group["territory"]["id"] == territory for group in body["scope_series"])
    assert {group["territory"]["id"] for group in body["scope_series"]} == set(expected_peer_ids)
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
    cohort_values = canonical_values
    if focal_value is not None:
        direction = body["comparison"]["direction"]
        better = sum(value > focal_value if direction == "high" else value < focal_value for value in cohort_values)
        ties = sum(value == focal_value for value in cohort_values)
        assert body["comparison"]["rank"] == better + 1
        assert body["comparison"]["ties"] == ties
        assert body["comparison"]["comparable_count"] == len(cohort_values)
        ordered = sorted(cohort_values)
        middle = len(ordered) // 2
        expected_median = (ordered[middle] if len(ordered) % 2 else
                           (ordered[middle - 1] + ordered[middle]) / 2)
        assert body["comparison"]["median"] == expected_median


@pytest.mark.skipif(not os.getenv("LUSK_SERIES_HTTP_DATABASE_URL") or
                    not os.getenv("LUSK_SERIES_HTTP_WRITER_DATABASE_URL"),
                    reason="disposable concurrent publication rehearsal only")
def test_owned_series_http_keeps_one_snapshot_during_concurrent_unit_publish():
    from fastapi.testclient import TestClient
    import psycopg
    from api.main import app, get_repository, ReadRepository, pool

    reader_dsn = os.environ["LUSK_SERIES_HTTP_DATABASE_URL"]
    writer_dsn = os.environ["LUSK_SERIES_HTTP_WRITER_DATABASE_URL"]
    dataset, indicator = os.environ["LUSK_SERIES_HTTP_DATASET"], os.environ["LUSK_SERIES_HTTP_INDICATOR"]
    territory = os.environ["LUSK_SERIES_HTTP_TERRITORY"]
    detail, scope = os.environ["LUSK_SERIES_HTTP_DETAIL"], os.environ["LUSK_SERIES_HTTP_SCOPE"]
    epci = os.getenv("LUSK_SERIES_HTTP_EPCI")
    with psycopg.connect(writer_dsn) as writer:
        old = writer.execute(
            """SELECT p.content_version,p.reference_content_version,p.published_at,d.unit
               FROM series_dataset_publication p JOIN series_dataset_descriptor d USING(dataset_id)
               WHERE p.dataset_id=%s AND d.indicator_id=%s""", (dataset, indicator)
        ).fetchone()
        enaf_before = writer.execute(
            "SELECT content_version,row_count,reference_content_version FROM series_dataset_publication WHERE dataset_id='conso_enaf_annuel'"
        ).fetchone()
        provenance_before = writer.execute(
            """SELECT count(*),min(p.revision_hash),max(p.revision_hash)
               FROM series_observation_provenance a JOIN series_provenance_revision p USING(provenance_revision_id)
               WHERE a.dataset_id=%s AND a.indicator_id=%s AND a.territory_id=%s""",
            (dataset, indicator, territory),
        ).fetchone()
    assert old
    entered, release = threading.Event(), threading.Event()

    class Intercept:
        def __init__(self, connection): self.connection, self.paused = connection, False
        def execute(self, sql, params=()):
            result = self.connection.execute(sql, params)
            if "FROM series_dataset_publication WHERE dataset_id=%s" in sql and not self.paused:
                self.paused = True
                entered.set()
                if not release.wait(15): raise TimeoutError("writer did not release the snapshot barrier")
            return result
        def __getattr__(self, name): return getattr(self.connection, name)

    class Connections:
        def connection(self):
            class Context:
                def __enter__(inner):
                    inner.conn = psycopg.connect(reader_dsn, autocommit=True)
                    inner.proxy = Intercept(inner.conn)
                    return inner.proxy
                def __exit__(inner, *args): inner.conn.close()
            return Context()

    repository = ReadRepository(Connections())
    app.dependency_overrides[get_repository] = lambda: repository
    pool.cache_clear()
    response_box = {}
    def request():
        with TestClient(app) as client:
            response_box["response"] = client.get(
                f"/api/series-datasets/{dataset}/territories/commune/{territory}/{indicator}",
                params={"scope_level": scope, **({"epci_id": epci} if epci else {})},
            )
    thread = threading.Thread(target=request, daemon=True)
    try:
        thread.start()
        assert entered.wait(15), "API reader never established the publication snapshot"
        changed_unit = "concurrent-publication-test-unit"
        with psycopg.connect(writer_dsn) as writer:
            with writer.transaction():
                writer.execute("UPDATE series_dataset_publication SET content_version=%s,published_at=transaction_timestamp() WHERE dataset_id=%s",
                    (old[0]+"-concurrent",dataset))
                writer.execute("UPDATE series_dataset_descriptor SET unit=%s WHERE dataset_id=%s AND indicator_id=%s",
                    (changed_unit,dataset,indicator))
        release.set()
        thread.join(20)
        assert not thread.is_alive()
        response = response_box["response"]
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["publication_id"] == old[0]
        assert body["reference_content_version"] == old[1]
        assert body["unit"] == old[3]
        assert all(point["provenance"] for point in body["points"])
        with psycopg.connect(writer_dsn) as writer:
            enaf_after = writer.execute(
                "SELECT content_version,row_count,reference_content_version FROM series_dataset_publication WHERE dataset_id='conso_enaf_annuel'"
            ).fetchone()
            provenance_after = writer.execute(
                """SELECT count(*),min(p.revision_hash),max(p.revision_hash)
                   FROM series_observation_provenance a JOIN series_provenance_revision p USING(provenance_revision_id)
                   WHERE a.dataset_id=%s AND a.indicator_id=%s AND a.territory_id=%s""",
                (dataset, indicator, territory),
            ).fetchone()
            assert enaf_after == enaf_before
            assert provenance_after == provenance_before
            with writer.transaction():
                writer.execute("UPDATE series_dataset_publication SET content_version=%s,published_at=transaction_timestamp() WHERE dataset_id=%s",
                    (old[0],dataset))
                writer.execute("UPDATE series_dataset_descriptor SET unit=%s WHERE dataset_id=%s AND indicator_id=%s",
                    (old[3],dataset,indicator))
    finally:
        release.set()
        thread.join(20)
        app.dependency_overrides.pop(get_repository, None)
        pool.cache_clear()
