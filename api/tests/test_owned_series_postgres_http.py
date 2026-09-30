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
    from api.main import pool as api_pool

    endpoint = f"/api/series-datasets/{dataset}/territories/commune/{territory}/{indicator}"
    request_params = {"scope_level": scope, **({"epci_id": epci} if epci else {})}
    # Capture the complete old API representation before introducing a write.
    api_pool.cache_clear()
    with TestClient(app) as client:
        baseline_response = client.get(endpoint, params=request_params)
    assert baseline_response.status_code == 200, baseline_response.text
    old_body = baseline_response.json()

    def enaf_snapshot(connection):
        marker = connection.execute(
            """SELECT content_version,reference_content_version,row_count,published_at
               FROM series_dataset_publication WHERE dataset_id='conso_enaf_annuel'"""
        ).fetchone()
        facts = connection.execute(
            """SELECT indicator_id,territory_id,territory_type,axis_value,state_role,
                      observation_period,value,status
               FROM series_dataset_observation WHERE dataset_id='conso_enaf_annuel'
               ORDER BY indicator_id,territory_id,axis_value"""
        ).fetchall()
        lineage = connection.execute(
            """SELECT a.indicator_id,a.territory_id,a.axis_value,p.provenance_revision_id,
                      p.source_id,p.vintage_id,p.source_name,p.dataset_name,p.source_version,
                      p.reference_date,p.publication_date,p.revision_hash
               FROM series_observation_provenance a JOIN series_provenance_revision p USING(provenance_revision_id)
               WHERE a.dataset_id='conso_enaf_annuel'
               ORDER BY a.indicator_id,a.territory_id,a.axis_value,p.provenance_revision_id"""
        ).fetchall()
        return marker, facts, lineage

    def api_facts_match_database(body, connection):
        peer_ids = [group["territory"]["id"] for group in body["scope_series"]]
        rows = connection.execute(
            """SELECT o.territory_id,o.axis_value,o.state_role,o.observation_period,o.value,o.status,
                      p.provenance_revision_id,p.source_id,p.vintage_id,p.source_name,p.dataset_name,
                      p.source_version,p.reference_date,p.publication_date,p.revision_hash
               FROM series_dataset_observation o
               LEFT JOIN series_observation_provenance a USING(dataset_id,indicator_id,territory_id,axis_value)
               LEFT JOIN series_provenance_revision p USING(provenance_revision_id)
               WHERE o.dataset_id=%s AND o.indicator_id=%s AND o.territory_id=ANY(%s::text[])
               ORDER BY o.territory_id,o.axis_value,p.provenance_revision_id""",
            (dataset,indicator,peer_ids),
        ).fetchall()
        expected = {}
        for row in rows:
            peer_id,axis,role,period,value,status = row[:6]
            point = expected.setdefault(peer_id,{}).setdefault(axis,{
                "axis":axis,"state_role":role,"observation_period":period,"value":value,
                "status":status,"provenance":[]})
            if row[6] is not None:
                point["provenance"].append({
                    "revision_id":row[6],"source_id":row[7],"vintage_id":row[8],
                    "source_name":row[9],"dataset_name":row[10],"version":row[11],
                    "reference_date":row[12].isoformat(),"publication_date":row[13].isoformat(),
                    "revision_hash":row[14],
                })
        fact_fields = ("axis","state_role","observation_period","value","status","provenance")
        actual = {group["territory"]["id"]:{point["axis"]:{field:point.get(field) for field in fact_fields}
                  for point in group["points"]} for group in body["scope_series"]}
        assert actual == expected
        focal = {point["axis"]:{field:point.get(field) for field in fact_fields} for point in body["points"]}
        assert focal == actual[territory]

    with psycopg.connect(writer_dsn) as writer:
        old_marker = writer.execute(
            """SELECT content_version,reference_content_version,row_count,published_at
               FROM series_dataset_publication WHERE dataset_id=%s""",(dataset,)
        ).fetchone()
        old_descriptor = writer.execute(
            """SELECT axis_kind,axis_values,completeness,comparison_point,label,unit,direction,
                      allowed_levels,descriptor_version FROM series_dataset_descriptor
               WHERE dataset_id=%s AND indicator_id=%s""",(dataset,indicator)
        ).fetchone()
        reference_marker = writer.execute(
            "SELECT content_version,row_count FROM table_publication WHERE table_name='territory_reference'"
        ).fetchone()
        old_point = writer.execute(
            """SELECT value,status,state_role,observation_period FROM series_dataset_observation
               WHERE dataset_id=%s AND indicator_id=%s AND territory_id=%s AND axis_value=%s""",
            (dataset,indicator,territory,detail),
        ).fetchone()
        old_lineage = writer.execute(
            """SELECT p.provenance_revision_id,p.source_id,p.vintage_id,p.source_name,p.dataset_name,
                      p.source_version,p.reference_date,p.publication_date,p.revision_hash
               FROM series_observation_provenance a JOIN series_provenance_revision p USING(provenance_revision_id)
               WHERE a.dataset_id=%s AND a.indicator_id=%s AND a.territory_id=%s AND a.axis_value=%s
               ORDER BY p.provenance_revision_id""",(dataset,indicator,territory,detail)
        ).fetchall()
        assert old_marker and old_descriptor and old_point and old_lineage
        enaf_before = enaf_snapshot(writer)
    assert old_body["publication_id"] == old_marker[0]
    assert old_body["reference_content_version"] == old_marker[1] == reference_marker[0]
    assert old_body["comparison_point"] == old_descriptor[3] == detail
    assert old_body["unit"] == old_descriptor[5]
    assert old_body["points"]
    assert old_point[1] == "measured" and old_point[0] is not None

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
        changed_label = old_descriptor[4] + " (concurrent snapshot test)"
        changed_descriptor_version = old_descriptor[8] + "-concurrent"
        new_content_version = old_marker[0] + "-concurrent"
        new_reference_version = reference_marker[0] + "-concurrent"
        new_value = old_point[0] + 1.0
        old_revision = old_lineage[0]
        new_revision_id = old_revision[0] + "-concurrent-snapshot"
        new_revision_hash = "concurrent-" + new_revision_id
        with psycopg.connect(writer_dsn) as writer:
            with writer.transaction():
                # Deliberate shared-reference rebinding scenario: normal owned
                # publishers do not write territory_reference. ENAF binding is
                # intentionally stale only until this disposable test restores
                # the shared token; its own marker/facts/provenance never change.
                writer.execute(
                    "UPDATE table_publication SET content_version=%s WHERE table_name='territory_reference'",
                    (new_reference_version,))
                writer.execute(
                    "UPDATE series_dataset_publication SET content_version=%s,reference_content_version=%s,published_at=transaction_timestamp() WHERE dataset_id=%s",
                    (new_content_version,new_reference_version,dataset))
                writer.execute(
                    """UPDATE series_dataset_descriptor SET label=%s,unit=%s,descriptor_version=%s
                       WHERE dataset_id=%s AND indicator_id=%s""",
                    (changed_label,changed_unit,changed_descriptor_version,dataset,indicator))
                writer.execute(
                    """INSERT INTO series_provenance_revision(provenance_revision_id,source_id,vintage_id,
                         source_name,dataset_name,source_version,reference_date,publication_date,revision_hash)
                       VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                    (new_revision_id,*old_revision[1:8],new_revision_hash))
                writer.execute(
                    """UPDATE series_dataset_observation SET value=%s
                       WHERE dataset_id=%s AND indicator_id=%s AND territory_id=%s AND axis_value=%s""",
                    (new_value,dataset,indicator,territory,detail))
                writer.execute(
                    """DELETE FROM series_observation_provenance
                       WHERE dataset_id=%s AND indicator_id=%s AND territory_id=%s AND axis_value=%s""",
                    (dataset,indicator,territory,detail))
                writer.execute(
                    """INSERT INTO series_observation_provenance
                       (dataset_id,indicator_id,territory_id,axis_value,provenance_revision_id)
                       VALUES(%s,%s,%s,%s,%s)""",
                    (dataset,indicator,territory,detail,new_revision_id))
        release.set()
        thread.join(20)
        assert not thread.is_alive()
        response = response_box["response"]
        assert response.status_code == 200, response.text
        body = response.json()
        # The paused reader must be indistinguishable from the full old API
        # response; this rules out old facts paired with any new tokens/lineage.
        assert body == old_body
        assert body["publication_id"] == old_marker[0]
        assert body["reference_content_version"] == old_marker[1]
        assert body["unit"] == old_descriptor[5]
        with psycopg.connect(writer_dsn) as writer:
            new_marker = writer.execute(
                """SELECT content_version,reference_content_version,row_count,published_at
                   FROM series_dataset_publication WHERE dataset_id=%s""",(dataset,)
            ).fetchone()
            new_descriptor = writer.execute(
                """SELECT label,unit,descriptor_version FROM series_dataset_descriptor
                   WHERE dataset_id=%s AND indicator_id=%s""",(dataset,indicator)
            ).fetchone()
            new_reference = writer.execute(
                "SELECT content_version,row_count FROM table_publication WHERE table_name='territory_reference'"
            ).fetchone()
        assert new_marker[0:3] == (new_content_version,new_reference_version,old_marker[2])
        assert new_descriptor == (changed_label,changed_unit,changed_descriptor_version)
        assert new_reference == (new_reference_version,reference_marker[1])
        # A subsequent API request must see the complete committed new unit.
        with TestClient(app) as client:
            next_response = client.get(endpoint,params=request_params)
        assert next_response.status_code == 200,next_response.text
        new_body = next_response.json()
        assert new_body["publication_id"] == new_marker[0]
        assert new_body["reference_content_version"] == new_reference[0]
        assert new_body["unit"] == changed_unit and new_body["label"] == changed_label
        assert new_body["descriptor_version"] == changed_descriptor_version
        focal_point = next(point for point in new_body["points"] if point["axis"] == detail)
        assert focal_point["value"] == new_value
        assert focal_point["provenance"] == [{
            "revision_id":new_revision_id,"source_id":old_revision[1],"vintage_id":old_revision[2],
            "source_name":old_revision[3],"dataset_name":old_revision[4],
            "version":old_revision[5],"reference_date":old_revision[6].isoformat(),
            "publication_date":old_revision[7].isoformat(),"revision_hash":new_revision_hash,
        }]
        with psycopg.connect(writer_dsn) as writer:
            api_facts_match_database(new_body,writer)
            immutable_old = writer.execute(
                """SELECT provenance_revision_id,source_id,vintage_id,source_name,dataset_name,
                          source_version,reference_date,publication_date,revision_hash
                   FROM series_provenance_revision WHERE provenance_revision_id=%s""",
                (old_revision[0],),
            ).fetchone()
            inserted_revision = writer.execute(
                """SELECT provenance_revision_id,source_id,vintage_id,source_name,dataset_name,
                          source_version,reference_date,publication_date,revision_hash
                   FROM series_provenance_revision WHERE provenance_revision_id=%s""",
                (new_revision_id,),
            ).fetchone()
            assert immutable_old == old_revision
            assert inserted_revision == (new_revision_id,*old_revision[1:8],new_revision_hash)
            enaf_after = enaf_snapshot(writer)
            assert enaf_after == enaf_before
            # Restore every temporary shared/unit change in an owner-marker
            # transaction. Immutable provenance revision is intentionally kept.
            with writer.transaction():
                writer.execute(
                    "UPDATE table_publication SET content_version=%s WHERE table_name='territory_reference'",
                    (reference_marker[0],))
                writer.execute(
                    "UPDATE series_dataset_publication SET content_version=%s,reference_content_version=%s,published_at=transaction_timestamp() WHERE dataset_id=%s",
                    (old_marker[0],old_marker[1],dataset))
                writer.execute(
                    "UPDATE series_dataset_descriptor SET label=%s,unit=%s,descriptor_version=%s WHERE dataset_id=%s AND indicator_id=%s",
                    (old_descriptor[4],old_descriptor[5],old_descriptor[8],dataset,indicator))
                writer.execute(
                    "UPDATE series_dataset_observation SET value=%s WHERE dataset_id=%s AND indicator_id=%s AND territory_id=%s AND axis_value=%s",
                    (old_point[0],dataset,indicator,territory,detail))
                writer.execute(
                    "DELETE FROM series_observation_provenance WHERE dataset_id=%s AND indicator_id=%s AND territory_id=%s AND axis_value=%s",
                    (dataset,indicator,territory,detail))
                for lineage in old_lineage:
                    writer.execute(
                        "INSERT INTO series_observation_provenance(dataset_id,indicator_id,territory_id,axis_value,provenance_revision_id) VALUES(%s,%s,%s,%s,%s)",
                        (dataset,indicator,territory,detail,lineage[0]))
                writer.execute(
                    "UPDATE series_dataset_publication SET published_at=%s WHERE dataset_id=%s",
                    (old_marker[3],dataset))
    finally:
        release.set()
        thread.join(20)
        app.dependency_overrides.pop(get_repository, None)
        pool.cache_clear()
