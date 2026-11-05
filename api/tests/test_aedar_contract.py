import inspect
from math import fsum
from pathlib import Path

import pytest

from api import aedar_reads, semantic_resource_reader
from api.resource_catalogue import (default_resource_catalogue,
                                     discover_indicator_resources, validate_resource_item)
from api.resource_requests import ResourceReadItem


def test_aedar_semantic_dispatch_is_declared_typed_and_bounded():
    # The legacy AEDAR GET routes are retired: the producer declaration plus the
    # semantic reader is the sole read path. Coordinate and intent grammar stay
    # exactly as declared, and the shared source-grain SQL reader is reused.
    resource = default_resource_catalogue.__wrapped__().resources_by_id["aedar_territorial_aggregate"]
    assert resource.resource_kind == "aedar_source_grain"
    assert resource.axes == ("typequ", "measure", "context")
    assert resource.intents == ("facts", "fixed_comparison", "selected_comparison")
    assert resource.allowed_levels == ("commune", "epci", "departement", "region")
    assert resource.context_values == ("density_class", "epci", "bretagne", "same_level")
    dispatch_source = inspect.getsource(semantic_resource_reader.SemanticResourceReader)
    assert 'resource.resource_kind == "aedar_source_grain"' in dispatch_source
    assert dispatch_source.count("_aedar_territorial_aggregate_snapshot") >= 2
    assert dispatch_source.count("_aedar_comparison_snapshot") >= 2
    # Request-time selected comparisons are dispatched through the same seam
    # (ADR-0039's AEDAR selection-comparison amendment, #768/#859).
    assert dispatch_source.count("_aedar_selected_comparison_snapshot") >= 2
    sql = inspect.getsource(aedar_reads._aedar_territorial_aggregate_snapshot)
    assert "territory_type=%s AND territory_id=%s" in sql
    assert "LIMIT %s OFFSET %s" in sql
    assert "typequ=ANY(%s)" in sql
    assert "aedar_territorial_aggregate" in sql


def test_aedar_semantic_coordinates_and_fixed_comparison_intent_are_closed_and_bounded():
    catalogue = default_resource_catalogue.__wrapped__()
    resource = catalogue.resources_by_id["aedar_territorial_aggregate"]
    target = {"kind": "territory", "type": "commune", "id": "22001"}
    facts = ResourceReadItem.model_validate({
        "resource": "aedar_territorial_aggregate", "target": target,
        "coordinates": {"typequ": ["A104"]}, "intent": {"kind": "facts"},
    })
    assert validate_resource_item(facts, catalogue) == resource
    comparison = ResourceReadItem.model_validate({
        "resource": "aedar_territorial_aggregate", "target": target,
        "coordinates": {"typequ": ["A104"], "measure": ["count_5_walk_mean"]},
        "fields": ["group_value", "value"], "intent": {"kind": "fixed_comparison", "context": "epci"},
    })
    assert validate_resource_item(comparison, catalogue) == resource
    context_as_coordinate = ResourceReadItem.model_validate({
        "resource": "aedar_territorial_aggregate", "target": target,
        "coordinates": {"context": ["epci"]}, "intent": {"kind": "facts"},
    })
    with pytest.raises(ValueError, match="fixed_comparison intent"):
        validate_resource_item(context_as_coordinate, catalogue)
    undeclared_axis = ResourceReadItem.model_validate({
        "resource": "aedar_territorial_aggregate", "target": target,
        "coordinates": {"sql": ["anything"]}, "intent": {"kind": "facts"},
    })
    with pytest.raises(ValueError, match="coordinate axis"):
        validate_resource_item(undeclared_axis, catalogue)

    source = inspect.getsource(aedar_reads._aedar_comparison_snapshot)
    assert "aedar_content_version" in source
    assert "reference_content_version" in source
    assert "aedar_comparison_territory" not in source
    # #904's boundary for per-cell measures stays exact: the fixed intent's
    # base optional fields remain rank-free; request-time rank fields enter
    # only through the aggregate-reading branch (ADR-0039's 2026-11-04
    # amendment, #914).
    assert aedar_reads._AEDAR_COMPARISON_OPTIONAL_FIELDS == {"group_value", "value"}
    schema = (Path(__file__).resolve().parents[1] / "schema.sql").read_text(encoding="utf-8")
    migration = (Path(__file__).resolve().parents[1] / "migrations" / "032_aedar_fixed_comparisons.sql").read_text(encoding="utf-8")
    for table in ("aedar_comparison_publication", "aedar_comparison_group", "aedar_comparison_territory"):
        assert f"CREATE TABLE {table}" in schema
        assert f"CREATE TABLE IF NOT EXISTS {table}" in migration
    assert "rank_ties" not in schema
    assert "source_snapshot_id='2026-v1'" in migration
    assert "input_content_version text NOT NULL" in migration
    assert "input_identity jsonb NOT NULL" in migration
    assert "statistic IN ('median','pooled')" in schema
    assert "statistic IN ('median','direct','pooled')" in migration
    assert "statistic='pooled'" in schema and "statistic='pooled'" in migration
    assert "FOREIGN KEY(comparison_context,group_id,territory_type,typequ,measure)" in migration
    assert "REFERENCES aedar_comparison_group" in migration
    assert "FOREIGN KEY(territory_type,territory_id,typequ)" not in migration
    assert "FOREIGN KEY(territory_type,territory_id,typequ)" not in schema
    assert "source refresh retains the last complete comparison" in migration
    # The retired route's open query surface is gone: the semantic item accepts
    # only the producer-declared axes and a closed comparison field vocabulary.
    assert "sql" not in resource.axes
    assert set(resource.fields) == {"group_value", "value"}


def test_aedar_source_measure_contract_has_312_fields_and_four_level_identity():
    from pathlib import Path
    root = Path(__file__).resolve().parents[2]
    source = (root / "pipeline/R/aedar_aggregates.R").read_text(encoding="utf-8")
    for field in ("code_insee", "epci_code", "code_departement", "code_region",
                  "LIB_TYPEQU", "n_addresses", "n_observed", "coverage_status"):
        assert field in source
    assert "length(measure_columns)!=312L" in source
    assert "never derive" in source


def test_aedar_migration_updates_markers_and_grants_database_roles():
    from pathlib import Path
    root = Path(__file__).resolve().parents[2]
    migration = (root / "api/migrations/028_aedar_territorial_aggregates.sql").read_text()
    fresh = (root / "api/schema.sql").read_text()
    for sql in (migration, fresh):
        assert "aedar_territorial_aggregate" in sql
        assert "shared_fact_publication_requires_reference" in sql
        assert "lusk_reader" in sql and "GRANT SELECT" in sql
        normalized = "".join(sql.split()).upper()
        assert "LUSK_PUBLISHER" in normalized and "GRANTSELECT,INSERT,UPDATE,DELETE" in normalized
    metadata_migration = (root / "api/migrations/031_aedar_typequ_metadata.sql").read_text()
    for field in ("typequ_hierarchy_label","typequ_description","typequ_domain_code","typequ_domain_label","typequ_subdomain_code",
                  "typequ_subdomain_label","typequ_gamme","typequ_gamme_status","typequ_source_order"):
        assert field in metadata_migration and field in fresh
    assert "typequ_gamme_status='hors_gamme' AND typequ_gamme IS NOT NULL AND typequ_gamme='Hors Gamme'" in metadata_migration
    assert "typequ_gamme_status='absent' AND typequ_gamme IS NULL" in metadata_migration


def test_aedar_metadata_complete_check_fails_closed_for_partial_gamme_states():
    import re
    import sqlite3
    from pathlib import Path

    root = Path(__file__).resolve().parents[2]
    migration = (root / "api/migrations/031_aedar_typequ_metadata.sql").read_text(encoding="utf-8")
    fresh = (root / "api/schema.sql").read_text(encoding="utf-8")
    pattern = r"aedar_typequ_metadata_complete_check\s+CHECK\s*\(COALESCE\((.*?),\s*FALSE\)\)"

    def expression(sql):
        match = re.search(pattern, sql, flags=re.IGNORECASE | re.DOTALL)
        assert match, "complete metadata constraint must COALESCE unknown to FALSE"
        return match.group(1)

    migration_check = expression(migration)
    fresh_check = expression(fresh)
    assert "".join(migration_check.split()).lower() == "".join(fresh_check.split()).lower()
    assert "typequ_gammeisnotnull" in "".join(migration_check.split()).lower()

    # SQLite shares PostgreSQL's relevant CHECK rule: NULL passes unless the
    # expression explicitly collapses UNKNOWN to FALSE. This is a hermetic
    # truth-table test of the exact constraint expression used by both schemas.
    columns = ("typequ_hierarchy_label", "typequ_description", "typequ_domain_code", "typequ_domain_label",
               "typequ_subdomain_code", "typequ_subdomain_label", "typequ_gamme_status", "typequ_source_order", "typequ_gamme")
    connection = sqlite3.connect(":memory:")
    connection.execute(f"CREATE TABLE metadata ({', '.join(columns)}, CHECK ({migration_check}))")
    names = ",".join(columns)
    placeholders = ",".join("?" for _ in columns)
    connection.execute(f"INSERT INTO metadata ({names}) VALUES ({placeholders})", (None,) * len(columns))
    absent = ("label", "description", "D", "Domain", "S", "Subdomain", "absent", 1, None)
    connection.execute(f"INSERT INTO metadata ({names}) VALUES ({placeholders})", absent)
    hors_gamme_null = ("label", "description", "D", "Domain", "S", "Subdomain", "hors_gamme", 1, None)
    import pytest
    with pytest.raises(sqlite3.IntegrityError):
        connection.execute(f"INSERT INTO metadata ({names}) VALUES ({placeholders})", hors_gamme_null)


def test_aedar_typed_response_accepts_registered_projection_but_rejects_unknown_measure():
    from api.aedar_models import AEDARFactResponse
    import pytest
    payload = dict(territory_id="x", territory_type="commune", typequ="A104",
            typequ_label="GENDARMERIE",typequ_hierarchy_label="GENDARMERIE",typequ_description="Description",
            typequ_domain_code="A",typequ_domain_label="Services",
            typequ_subdomain_code="A1",typequ_subdomain_label="Publics",typequ_gamme=None,
            typequ_gamme_status="absent",typequ_source_order=1,
            identity={"code_insee":"x"}, n_addresses=1,
            n_observed=1, coverage_status="covered", measures={"count_5_walk_share":0},
            source_id="aedar_bretagne", vintage_id="2026-v1", source_url="https://example.test",
            licence="ODbL", attribution="AEDAR", reference_date=None, publication_date="2026-09-30")
    assert AEDARFactResponse(**payload).measures == {"count_5_walk_share": 0}
    with pytest.raises(Exception, match="unregistered"):
        AEDARFactResponse(**{**payload, "measures": {"not_registered": 0}})


def test_aedar_semantic_facts_read_bounds_results_for_all_territory_levels(monkeypatch):
    from contextlib import contextmanager
    from fastapi.testclient import TestClient
    import api.main as main
    from api.aedar_models import AEDAR_MEASURE_KEYS, AEDARTerritorialAggregateResponse

    columns = ("territory_id", "territory_type", "typequ", "typequ_label","typequ_hierarchy_label","typequ_description",
        "typequ_domain_code","typequ_domain_label","typequ_subdomain_code",
        "typequ_subdomain_label","typequ_gamme","typequ_gamme_status","typequ_source_order",
        "identity", "n_addresses", "n_observed", "coverage_status",
        "measures", "source_id", "vintage_id", "source_url", "licence", "attribution",
        "reference_date", "publication_date")
    known_typequ = {"C401", "A135", "A104", "B316"}
    full_measures = {key: (0 if key == "count_5_walk_share" else None) for key in AEDAR_MEASURE_KEYS}

    class Cursor:
        description = [type("Column", (), {"name": n}) for n in columns]
        def __init__(self, rows): self.rows = rows
        def fetchone(self): return self.rows[0] if self.rows else None
        def fetchall(self): return self.rows

    def fact_row(measures):
        return ("id", "commune", "C401",
                "STS SECTION TECHNICIEN SUPÉRIEUR, CPGE CLASSE PRÉPARATOIRE AUX GRANDES ÉCOLES",
                "STS SECTION TECHNICIEN SUPÉRIEUR, CPGE CLASSE PRÉPARATOIRE AUX GRANDES\nÉCOLES",
                "Official description line one\nline two", "C","Services","C4","Publics",
                "Hors Gamme","hors_gamme",1,{"code_insee": "id"},
                10, 8, "covered", measures, "aedar_bretagne",
                "2026-v1", "https://example.test", "ODbL",
                "© OpenStreetMap contributors; données AEDAR — licence ODbL", None, "2026-09-30")

    class Connection:
        def execute(self, sql, params=None):
            if "SELECT DISTINCT typequ" in sql:
                return Cursor([(value,) for value in (params[0] if params else ()) if value in known_typequ])
            if "SELECT p.content_version" in sql:
                return Cursor([("aedar-v1", 1, "ref-v1", "ref-v1")])
            if "SELECT count(*)" in sql:
                return Cursor([(1,)])
            if "FROM territory_reference" in sql:
                return Cursor([(1,)])
            # Source-grain projection. A measure field selection is passed as the
            # projected registry keys in the first parameter.
            selected = params[0] if params and isinstance(params[0], (list, tuple)) else None
            measures = full_measures if selected is None else {key: full_measures[key] for key in selected}
            return Cursor([fact_row(measures)])
        @contextmanager
        def transaction(self): yield self

    class FakePool:
        @contextmanager
        def connection(self): yield Connection()

    monkeypatch.setattr(main, "pool", lambda: FakePool())
    client = TestClient(main.app)
    for level in ("commune", "epci", "departement", "region"):
        response = client.post("/api/resources/read", json={
            "resource": "aedar_territorial_aggregate",
            "target": {"kind": "territory", "type": level, "id": "id"},
            "coordinates": {"typequ": ["C401"]},
            "intent": {"kind": "facts"},
        })
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["resource"] == "aedar_territorial_aggregate"
        assert body["target"] == {"kind": "territory", "type": level, "id": "id"}
        assert body["territory"] == {"territory_type": level, "territory_id": "id"}
        assert body["limit"] == 100 and body["offset"] == 0
        assert len(body["facts"]) == 1
        assert body["facts"][0]["licence"] == "ODbL"
        assert body["facts"][0]["measures"]["count_5_walk_share"] == 0
        assert body["facts"][0]["typequ_domain_code"] == "C"
        assert body["facts"][0]["typequ_label"] == "STS SECTION TECHNICIEN SUPÉRIEUR, CPGE CLASSE PRÉPARATOIRE AUX GRANDES ÉCOLES"
        assert body["facts"][0]["typequ_hierarchy_label"] == "STS SECTION TECHNICIEN SUPÉRIEUR, CPGE CLASSE PRÉPARATOIRE AUX GRANDES\nÉCOLES"
        assert body["facts"][0]["typequ_description"] == "Official description line one\nline two"
        assert body["facts"][0]["typequ_gamme"] == "Hors Gamme"
        assert body["facts"][0]["typequ_gamme_status"] == "hors_gamme"
        assert body["facts"][0]["typequ_source_order"] == 1
        assert len(body["facts"][0]["measures"]) == 312
        assert body["facts"][0]["publication_date"] == "2026-09-30"
        assert body["content_version"] == "aedar-v1"
        assert body["reference_content_version"] == "ref-v1"
        assert body["facts"][0]["attribution"] == "© OpenStreetMap contributors; données AEDAR — licence ODbL"
        # The typed AEDAR response contract still describes the semantic facts envelope.
        AEDARTerritorialAggregateResponse.model_validate(body)
        projected = client.post("/api/resources/read", json={
            "resource": "aedar_territorial_aggregate",
            "target": {"kind": "territory", "type": level, "id": "id"},
            "coordinates": {"typequ": ["C401"]},
            "fields": ["measures.count_5_walk_max"],
            "intent": {"kind": "facts"},
        })
        assert projected.status_code == 200, projected.text
        assert projected.json()["facts"][0]["measures"] == {"count_5_walk_max": None}
        assert projected.json()["facts"][0]["source_id"] == "aedar_bretagne"
    # Bounded, closed request grammar: no unbounded limit, no empty or unknown
    # projection, and no coordinate absent from the published descriptor.
    base = {"resource": "aedar_territorial_aggregate",
            "target": {"kind": "territory", "type": "region", "id": "id"},
            "coordinates": {"typequ": ["C401"]}, "intent": {"kind": "facts"}}
    for invalid in ({"limit": 101}, {"fields": []},
                    {"fields": ["measures.not_registered"]},
                    {"coordinates": {"typequ": ["ZZZZ"]}}):
        assert client.post("/api/resources/read", json={**base, **invalid}).status_code == 422


def test_retired_aedar_get_routes_return_404_and_are_absent_from_openapi():
    from fastapi.testclient import TestClient
    import api.main as main

    paths = main.app.openapi()["paths"]
    assert not any(path.startswith("/api/aedar") for path in paths)
    with TestClient(main.app) as client:
        aggregate = client.get("/api/aedar/territories/commune/22001/aggregates?typequ=C401")
        comparison = client.get(
            "/api/aedar/territories/commune/22001/comparisons"
            "?context=epci&typequ=A104&measure=count_5_walk_mean")
    assert aggregate.status_code == 404, aggregate.text
    assert comparison.status_code == 404, comparison.text


def test_aedar_malformed_request_is_422_before_any_publication_read(monkeypatch):
    # Precedence guard: request-shape validation (422) must win over the
    # absent/stale/incompatible publication preflight (503). The stub makes any
    # publication or source-grain query return an unavailable marker, so a
    # malformed request that reached the publication preflight would surface as
    # 503; the assertions below prove it never gets there and no fact row is read.
    from contextlib import contextmanager
    from fastapi.testclient import TestClient
    import api.main as main

    consulted = []

    class Cursor:
        description = [type("Column", (), {"name": "value"})]
        def __init__(self, row=None): self.row = row
        def fetchone(self): return self.row
        def fetchall(self): return []

    class Connection:
        def execute(self, sql, params=None):
            if "table_publication" in sql or "aedar_territorial_aggregate" in sql:
                consulted.append(sql)
                return Cursor(None)
            return Cursor(None)
        @contextmanager
        def transaction(self): yield self

    class FakePool:
        @contextmanager
        def connection(self): yield Connection()

    monkeypatch.setattr(main, "pool", lambda: FakePool())
    client = TestClient(main.app)
    target = {"kind": "territory", "type": "commune", "id": "22001"}
    malformed = (
        {"coordinates": {"measure": ["bogus"]}, "intent": {"kind": "facts"}},
        {"coordinates": {"typequ": ["C401"], "measure": ["bogus"]}, "intent": {"kind": "facts"}},
        {"coordinates": {"typequ": ["C401"]},
         "intent": {"kind": "fixed_comparison", "context": "epci"}},
    )
    for item in malformed:
        response = client.post("/api/resources/read", json={
            "resource": "aedar_territorial_aggregate", "target": target, **item})
        assert response.status_code == 422, response.text
    assert consulted == []


def test_aedar_fixed_comparison_http_read_returns_direct_reference_without_peer_fields(monkeypatch):
    from contextlib import contextmanager
    from fastapi.testclient import TestClient
    import api.main as main
    state={"stale":False,"mode":"reference_only","context":"epci","queries":[],
           "density":None,"epci":"E1","territory_exists":True,
           "focal_exists":True,"focal_source_exists":True}

    class Rows:
        def __init__(self, rows): self.rows=rows
        def fetchall(self): return self.rows
    class Connection:
        def execute(self, sql, *_args, **_kwargs):
            state["queries"].append((sql,_args[0] if _args else None))
            if sql.startswith("SET TRANSACTION"):
                return None
            if "SELECT DISTINCT typequ" in sql:
                return Rows([("A104",)])
            if "aedar_comparison_publication" in sql:
                return type("Marker",(),{"fetchone":lambda self:("cmp-v1","2026-v1","aed-v1","ref-v1","inputs-v1",{"address_origins":"sha256"},4,0,state["mode"],"old-aedar" if state["stale"] else "aed-v1","ref-v1")})()
            if "SELECT territory_id,territory_type,density_class_code FROM territory_reference" in sql:
                return type("Territory",(),{"fetchone":lambda self:("22001","commune",state["density"])})()
            if "SELECT territory_id,territory_type,department_id,epci_id,density_class_code FROM territory_reference" in sql:
                return Rows([("22001","commune","22",state["epci"],state["density"]),("E1","epci","22",None,None),("53","region",None,None,None)])
            if "SELECT t.epci_id,r.territory_id" in sql:
                return type("Territory",(),{"fetchone":lambda self:(state["epci"],"53") if state["focal_exists"] else None})()
            if "SELECT 1 FROM territory_reference" in sql:
                return type("Territory",(),{"fetchone":lambda self:(1,) if state["territory_exists"] else None})()
            if "FROM aedar_territorial_aggregate" in sql:
                if "a.typequ_label" in sql:
                    return type("Focal",(),{"fetchone":lambda self:("Fixture","aedar_bretagne","2026-v1","https://example.test","ODbL","AEDAR",None,"2026-09-30",5.0,12,9,"covered") if state["focal_source_exists"] else None})()
                measure,expected_type,expected_id,typequ=_args[0]
                value={"epci":11.0,"region":13.0}[expected_type]
                assert (measure,typequ)==("count_5_walk_mean","A104")
                assert expected_id==("E1" if expected_type=="epci" else "53")
                return type("Reference",(),{"fetchone":lambda self:(value,10,8,"covered")})()
            if "FROM aedar_comparison_group" in sql:
                values=(4.0,None,None,None,"pooled") if state["context"]=="density_class" else (8.0,10,8,"covered","direct")
                return type("Reference",(),{"fetchone":lambda self:values})()
            raise AssertionError(f"Unexpected AEDAR snapshot query: {sql}")
        @contextmanager
        def transaction(self): yield self
    class FakePool:
        @contextmanager
        def connection(self): yield Connection()
    monkeypatch.setattr(main,"pool",lambda:FakePool())
    def payload(**extra):
        return {
            "resource": "aedar_territorial_aggregate",
            "target": {"kind": "territory", "type": "commune", "id": "22001"},
            "coordinates": {"typequ": ["A104"], "measure": ["count_5_walk_mean"]},
            "intent": {"kind": "fixed_comparison", "context": state["context"]},
            **extra,
        }
    response=TestClient(main.app).post("/api/resources/read", json=payload())
    assert response.status_code==200, response.text
    body=response.json()
    assert body["content_version"]=="cmp-v1"
    assert body["source_snapshot_id"]=="2026-v1"
    assert body["aedar_content_version"]=="aed-v1"
    assert body["reference_content_version"]=="ref-v1"
    assert body["input_content_version"]=="inputs-v1"
    assert body["comparison"]["group_value"]==11.0
    assert body["comparison"]["value"]==5.0
    assert body["comparison"]["statistic"]=="direct"
    assert not {"rank","rank_size","member_count","eligible_count","missing_count"} & set(body["comparison"])
    # Direct source references do not require commune density membership.
    assert not any("SELECT territory_id,territory_type,department_id,epci_id,density_class_code" in q
                   for q,_ in state["queries"])
    value_only=TestClient(main.app).post("/api/resources/read", json=payload(fields=["value"]))
    group_only=TestClient(main.app).post("/api/resources/read", json=payload(fields=["group_value"]))
    assert value_only.status_code==group_only.status_code==200
    assert value_only.json()["comparison"]["value"]==5.0
    assert "group_value" not in value_only.json()["comparison"]
    assert group_only.json()["comparison"]["group_value"]==11.0
    assert "value" not in group_only.json()["comparison"]
    state["context"]="bretagne"
    bretagne=TestClient(main.app).post("/api/resources/read",json=payload())
    assert bretagne.status_code==200, bretagne.text
    assert bretagne.json()["comparison"]["group_value"]==13.0
    state["epci"]=None
    unavailable_epci=TestClient(main.app).post("/api/resources/read",json=payload(intent={"kind":"fixed_comparison","context":"epci"}))
    assert unavailable_epci.status_code==503
    state["epci"]="E1"
    state["focal_source_exists"]=False
    missing_focal_value=TestClient(main.app).post("/api/resources/read",json=payload(intent={"kind":"fixed_comparison","context":"epci"}))
    assert missing_focal_value.status_code==404
    state["focal_source_exists"]=True
    state["focal_exists"]=False
    state["territory_exists"]=False
    missing_territory=TestClient(main.app).post("/api/resources/read",json=payload(intent={"kind":"fixed_comparison","context":"epci"}))
    assert missing_territory.status_code==404
    state["territory_exists"]=True
    state["focal_exists"]=True
    before=len(state["queries"])
    invalid=TestClient(main.app).post("/api/resources/read", json=payload(fields=["not_a_field"]))
    assert invalid.status_code==422 and len(state["queries"])==before
    state["context"]="density_class"
    state["density"]="1"
    pooled=TestClient(main.app).post("/api/resources/read", json=payload())
    assert pooled.status_code==200, pooled.text
    assert pooled.json()["comparison"]["statistic"]=="pooled"
    assert pooled.json()["comparison"]["group_id"]=="1"
    state["density"]=None
    missing_density=TestClient(main.app).post("/api/resources/read",json=payload())
    assert missing_density.status_code==503
    state["stale"]=True
    stale=TestClient(main.app).post("/api/resources/read", json=payload())
    assert stale.status_code==503
    state["stale"]=False
    state["mode"]="legacy_rank"
    legacy=TestClient(main.app).post("/api/resources/read",json=payload())
    assert legacy.status_code==503


def test_aedar_measure_facets_cover_every_registered_measure_with_declared_directions():
    from api.aedar_models import AEDAR_AGGREGATE_READINGS, AEDAR_MEASURE_KEYS
    catalogue = default_resource_catalogue.__wrapped__()
    resource = catalogue.resources_by_id["aedar_territorial_aggregate"]
    # The producer declaration is exact per measure AND per aggregate reading:
    # an in-scope comparison coordinate cannot be silently omitted from the
    # facet registry (fail-closed; #768/#859 and the 2026-11-04 aggregate-ranks
    # amendment, #914).
    expected = set(AEDAR_MEASURE_KEYS) | set(AEDAR_AGGREGATE_READINGS)
    assert set(resource.measure_facets) == expected
    for measure, facet in resource.measure_facets.items():
        assert set(facet) == {"facet", "direction", "ranked"}
        assert facet["direction"] in ("high", "low")
        assert isinstance(facet["ranked"], bool)
        # ADR-0015 conventions: diversity and volume readings are
        # higher-is-better and carry selection rank chips; per-cell curve
        # readings show their group mean and are never ranked.
        if measure in AEDAR_AGGREGATE_READINGS:
            # Registry-wide overview aggregate readings (#914): the diversity
            # and volume sums over the complete TYPEQU registry are ranked
            # high-is-better comparison facets in both intents.
            expected_facet = {"meanDiversity": "diversity", "meanVolume": "volume"}[measure]
            assert facet == {"facet": expected_facet, "direction": "high", "ranked": True}
            continue
        statistic = measure.rsplit("_", 1)[1]
        if statistic == "share":
            assert facet == {"facet": "diversity", "direction": "high", "ranked": True}
        elif statistic == "mean":
            assert facet == {"facet": "volume", "direction": "high", "ranked": True}
        else:
            assert facet == {"facet": "distribution", "direction": "high", "ranked": False}
    public = next(item for item in catalogue.discovery_payload()["resources"]
                  if item["resource_id"] == "aedar_territorial_aggregate")
    assert set(public["measure_facets"]) == expected
    assert public["measure_facets"]["meanDiversity"] == {
        "facet": "diversity", "direction": "high", "ranked": True}
    assert public["measure_facets"]["meanVolume"] == {
        "facet": "volume", "direction": "high", "ranked": True}
    assert "selected_comparison" in public["intents"]


def test_aedar_comparison_grants_rank_fields_per_intent_and_aggregate_boundary():
    catalogue = default_resource_catalogue.__wrapped__()
    target = {"kind": "territory", "type": "commune", "id": "22001"}
    members = [{"type": "commune", "id": "22001"}, {"type": "commune", "id": "22002"}]
    per_cell = {"typequ": ["A104"], "measure": ["count_5_walk_mean"]}
    aggregate = {"measure": ["meanDiversity", "meanVolume"]}
    # The selected intent keeps #904's grant: rank fields for per-cell
    # measures and for the aggregate readings alike.
    for coordinates in (per_cell, aggregate):
        selected = ResourceReadItem.model_validate({
            "resource": "aedar_territorial_aggregate", "target": target,
            "coordinates": coordinates,
            "fields": ["group_value", "value", "rank", "rank_size", "rank_ties"],
            "intent": {"kind": "selected_comparison", "members": members},
        })
        assert validate_resource_item(selected, catalogue).resource_id == "aedar_territorial_aggregate"
    # ADR-0039's 2026-11-04 amendment (#914): the fixed intent grants the rank
    # fields on the aggregate facets ONLY.
    fixed_aggregate = ResourceReadItem.model_validate({
        "resource": "aedar_territorial_aggregate", "target": target,
        "coordinates": aggregate, "fields": ["rank", "rank_size", "rank_ties"],
        "intent": {"kind": "fixed_comparison", "context": "epci"},
    })
    assert validate_resource_item(fixed_aggregate, catalogue).resource_id == "aedar_territorial_aggregate"
    # Per-cell measures keep #904's exact boundary: fixed and facts intents
    # reject rank fields for non-aggregate facets.
    for intent in ({"kind": "fixed_comparison", "context": "same_level"},
                   {"kind": "facts"}):
        item = ResourceReadItem.model_validate({
            "resource": "aedar_territorial_aggregate", "target": target,
            "coordinates": per_cell, "fields": ["rank"], "intent": intent,
        })
        with pytest.raises(ValueError, match="field is not declared"):
            validate_resource_item(item, catalogue)
    # member_ranks is not an AEDAR projection; peers/rank rows stay unpublished.
    not_granted = ResourceReadItem.model_validate({
        "resource": "aedar_territorial_aggregate", "target": target,
        "coordinates": coordinates, "fields": ["member_ranks"],
        "intent": {"kind": "selected_comparison", "members": members},
    })
    with pytest.raises(ValueError, match="field is not declared"):
        validate_resource_item(not_granted, catalogue)


def test_aedar_measure_facet_declaration_fails_closed_when_incomplete(tmp_path):
    import json
    import shutil
    root = Path(__file__).resolve().parents[2]
    metadata = root / "pipeline/inst/extdata/theme-metadata"
    contract = json.loads((root / "pipeline/inst/extdata/semantic-resource-contracts.json")
                          .read_text(encoding="utf-8"))
    shutil.copytree(metadata, tmp_path / "theme-metadata")
    base = tmp_path / "semantic-resource-contracts.json"

    def discover():
        return discover_indicator_resources(tmp_path / "theme-metadata", base)

    # A facet map missing one registered measure cannot load.
    broken = json.loads(json.dumps(contract))
    broken["resources"][0]["measure_facets"].pop("count_5_walk_mean")
    base.write_text(json.dumps(broken), encoding="utf-8")
    with pytest.raises(ValueError, match="Incomplete measure facets"):
        discover()

    # A facet map missing one aggregate reading cannot load either (#914).
    broken_aggregate = json.loads(json.dumps(contract))
    broken_aggregate["resources"][0]["measure_facets"].pop("meanDiversity")
    base.write_text(json.dumps(broken_aggregate), encoding="utf-8")
    with pytest.raises(ValueError, match="Incomplete measure facets"):
        discover()

    # selected_comparison without the complete map cannot load either.
    missing = json.loads(json.dumps(contract))
    del missing["resources"][0]["measure_facets"]
    base.write_text(json.dumps(missing), encoding="utf-8")
    with pytest.raises(ValueError, match="Incomplete measure facets"):
        discover()

    # An invalid direction or facet shape is rejected.
    invalid = json.loads(json.dumps(contract))
    invalid["resources"][0]["measure_facets"]["count_5_walk_mean"]["direction"] = "sideways"
    base.write_text(json.dumps(invalid), encoding="utf-8")
    with pytest.raises(ValueError, match="Invalid measure facet"):
        discover()

    # Aggregate readings must be declared ranked and high-is-better (#914).
    unranked = json.loads(json.dumps(contract))
    unranked["resources"][0]["measure_facets"]["meanVolume"] = {
        "facet": "volume", "direction": "high", "ranked": False}
    base.write_text(json.dumps(unranked), encoding="utf-8")
    with pytest.raises(ValueError, match="Invalid measure facet"):
        discover()
    low = json.loads(json.dumps(contract))
    low["resources"][0]["measure_facets"]["meanDiversity"]["direction"] = "low"
    base.write_text(json.dumps(low), encoding="utf-8")
    with pytest.raises(ValueError, match="Invalid measure facet"):
        discover()



class _AedarSelectedRows:
    """Cursor double: tuple rows plus a matching column description."""
    def __init__(self, columns, rows):
        self.columns = columns
        self.rows = rows
        self.description = [type("Column", (), {"name": name}) for name in columns]
    def fetchone(self):
        return self.rows[0] if self.rows else None
    def fetchall(self):
        return self.rows


class _AedarSelectedConnection:
    """Route the exact AEDAR snapshot queries to fixture rows."""
    def __init__(self, state):
        self.state = state
        self.queries = []

    def _territory_records(self, territory_type, territory_id):
        """All published aggregate records of one territory in the fixture."""
        out = {}
        for key, records in self.state["aggregates"].items():
            if key[0] in ("focal", "member") and key[1] == territory_id \
                    and self.state["reference"].get(territory_id) == territory_type:
                out.update(records)
            elif key[0] == "direct" and len(key) == 3 and key[1] == territory_type \
                    and key[2] == territory_id:
                out.update(records)
        return out

    def _registry_size(self):
        return len({typequ for records in self.state["aggregates"].values()
                    for typequ in records})

    @staticmethod
    def _provenance(record):
        # Per-record provenance override support (divergent-vintage tests).
        return (record.get("source_id", "aedar_bretagne"),
                record.get("vintage_id", "2026-v1"),
                record.get("source_url", "https://example.test"),
                record.get("licence", "ODbL"),
                record.get("attribution", "AEDAR"),
                record.get("reference_date", None),
                record.get("publication_date", "2026-09-30"))

    def execute(self, sql, params=None):
        self.queries.append(sql)
        s = sql
        if "aedar_comparison_publication" in s:
            return _AedarSelectedRows(["marker"], [(

                "cmp-v1", "2026-v1", "aed-v1", "ref-v1", "inputs-v1", {"address_origins": "sha"},
                1, 0, "reference_only", "aed-v1", "ref-v1")])
        if "count(DISTINCT typequ)" in s:
            return _AedarSelectedRows(["n"], [(self._registry_size(),)])
        if "GROUP BY territory_id" in s and "aedar_territorial_aggregate" in s:
            # Registry-wide aggregate records (one set-wise SQL aggregate).
            underlying = params[0]
            territory_type, ids = params[4], params[5]
            rows = []
            for territory_id in ids:
                records = self._territory_records(territory_type, territory_id)
                if not records:
                    continue
                values = [record["measures"].get(underlying) for record in records.values()]
                addresses = [record["n_addresses"] for record in records.values()]
                observed = [record["n_observed"] for record in records.values()]
                coverages = [record["coverage"] for record in records.values()]
                provenances = [self._provenance(record) for record in records.values()]
                measured = sum(1 for value in values if value is not None)
                present = [value for value in values if value is not None]
                total = fsum(present) if present else None
                n_bad = sum(1 for obs, na in zip(observed, addresses)
                            if obs is None or obs < 0 or obs > na)
                if "n_statistic" in s:
                    # Unified normalized law-input tuple (#914 amendment): the
                    # territorial shape's statistic is structurally "direct".
                    rows.append((territory_id, len(records), measured, total,
                                 min(present) if present else None,
                                 max(present) if present else None,
                                 min(addresses), max(addresses), sum(observed),
                                 len(set(provenances)),
                                 sum(1 for coverage in coverages if coverage != "covered"),
                                 n_bad, 1, "direct", min(coverages), len(set(coverages))))
                else:
                    rows.append((territory_id, len(records), measured, total,
                                 min(present) if present else None,
                                 max(present) if present else None,
                                 min(addresses), max(addresses), sum(observed),
                                 len(set(coverages)), min(coverages),
                                 len(set(provenances)),
                                 sum(1 for coverage in coverages if coverage != "covered"),
                                 n_bad))
            if "n_statistic" in s:
                columns = ["territory_id", "n_rows", "n_measured", "total", "v_min",
                           "v_max", "na_min", "na_max", "observed_sum", "n_provenance",
                           "n_uncovered", "n_bad_observed", "n_statistic", "statistic",
                           "coverage", "n_coverage"]
            else:
                columns = ["territory_id", "n_rows", "n_measured", "total",
                           "v_min", "v_max", "na_min", "na_max", "observed_sum", "n_coverage",
                           "coverage_status", "n_provenance", "n_uncovered", "n_bad_observed"]
            return _AedarSelectedRows(columns, rows)
        if "LIMIT 1" in s and "aedar_territorial_aggregate" in s:
            territory_type, territory_id = params
            records = self._territory_records(territory_type, territory_id)
            columns = ["source_id", "vintage_id", "source_url", "licence", "attribution",
                       "reference_date", "publication_date"]
            if not records:
                return _AedarSelectedRows(columns, [])
            return _AedarSelectedRows(columns,
                [("aedar_bretagne", "2026-v1", "https://example.test", "ODbL", "AEDAR",
                  None, "2026-09-30")])
        if "FROM aedar_comparison_group" in s and "count(*)" in s:
            group_id, underlying = params
            rows = [row for row in self.state.get("group_rows", ())
                    if row["group_id"] == group_id and row["measure"] == underlying]
            unified = "n_bad_observed" in s
            if unified:
                # Unified normalized law-input tuple (#914 amendment): the
                # pooled artifact's provenance is a publication-level tie and
                # its statistic is schema-CHECKed to "pooled"; n_bad_observed
                # is computed honestly (a NULL n_observed counts as bad,
                # exactly like the territorial path).
                columns = ["n_rows", "n_measured", "total", "v_min", "v_max", "na_min",
                           "na_max", "observed_sum", "n_provenance", "n_uncovered",
                           "n_bad_observed", "n_statistic", "statistic", "coverage",
                           "n_coverage"]
            else:
                columns = ["n_rows", "n_measured", "total", "v_min", "v_max", "na_min", "na_max",
                           "observed_sum", "n_statistic", "statistic", "n_coverage",
                           "coverage_status", "n_uncovered"]
            if not rows:
                return _AedarSelectedRows(columns, [])
            values = [row["value"] for row in rows]
            present = [value for value in values if value is not None]
            measured = len(present)
            total = fsum(present) if present else None
            coverages = [row["coverage_status"] for row in rows]
            addresses = [row["n_addresses"] for row in rows]
            observed = [row["n_observed"] for row in rows]
            # SQL sum() ignores NULLs.
            observed_sum = sum(obs for obs in observed if obs is not None)
            n_uncovered = sum(1 for coverage in coverages if coverage != "covered")
            if unified:
                n_bad = sum(1 for obs, na in zip(observed, addresses)
                            if obs is None or obs < 0 or obs > na)
                return _AedarSelectedRows(columns, [(
                    len(rows), measured, total,
                    min(present) if present else None, max(present) if present else None,
                    min(addresses), max(addresses), observed_sum,
                    1, n_uncovered, n_bad, 1, "pooled", min(coverages),
                    len(set(coverages)))])
            return _AedarSelectedRows(columns, [(
                len(rows), measured, total,
                min(present) if present else None, max(present) if present else None,
                min(addresses), max(addresses), observed_sum,
                len({row["statistic"] for row in rows}), min(row["statistic"] for row in rows),
                len(set(coverages)), min(coverages), n_uncovered)])
        if "SELECT territory_id,territory_type,density_class_code FROM territory_reference WHERE territory_id=%s" in s:
            row = next((r for r in self.state["ref_rows"] if r[0] == params[0]), None)
            return _AedarSelectedRows(["territory_id", "territory_type", "density_class_code"],
                [(row[0], row[1], row[4])] if row else [])
        if "SELECT territory_id,territory_type,department_id,epci_id,density_class_code FROM territory_reference" in s:
            return _AedarSelectedRows(["territory_id", "territory_type", "department_id",
                "epci_id", "density_class_code"], [tuple(row) for row in self.state["ref_rows"]])
        if "SELECT territory_id,territory_type FROM territory_reference WHERE territory_id=ANY" in s:
            ids = params[0]
            return _AedarSelectedRows(["territory_id", "territory_type"],
                [(code, self.state["reference"][code]) for code in ids if code in self.state["reference"]])
        if "SELECT epci_id,density_class_code FROM territory_reference" in s:
            row = next((r for r in self.state["ref_rows"]
                        if r[0] == params[1] and r[1] == params[0]), None)
            return _AedarSelectedRows(["epci_id", "density_class_code"],
                [(row[3], row[4])] if row else [])
        if "SELECT territory_id FROM territory_reference WHERE" in s:
            if "epci_id=%s" in s:
                rows = [r for r in self.state["ref_rows"] if r[1] == "commune" and r[3] == params[0]]
            elif "density_class_code=%s" in s:
                rows = [r for r in self.state["ref_rows"] if r[1] == "commune" and r[4] == params[0]]
            elif s.rstrip().endswith("territory_type=%s"):
                rows = [r for r in self.state["ref_rows"] if r[1] == params[0]]
            else:
                rows = [r for r in self.state["ref_rows"] if r[1] == "commune"]
            return _AedarSelectedRows(["territory_id"], [(row[0],) for row in rows])
        if "SELECT 1 FROM territory_reference" in s:
            return _AedarSelectedRows(["one"], [(1,)])
        if "SELECT t.epci_id,r.territory_id" in s:
            return _AedarSelectedRows(["focal"], [(self.state.get("epci"), "53")])
        if "a.typequ=ANY" in s:
            # Focal aggregate rows projected over the requested measures.
            measures, _ttype, tid, typequs = params
            rows = []
            for typequ, record in self.state["aggregates"][("focal", tid)].items():
                if typequ in typequs:
                    rows.append((typequ, record["label"], "aedar_bretagne", "2026-v1",
                        "https://example.test", "ODbL", "AEDAR", None, "2026-09-30",
                        record["n_addresses"], record["n_observed"], record["coverage"],
                        {m: record["measures"].get(m) for m in measures}))
            return _AedarSelectedRows(["typequ", "typequ_label", "source_id", "vintage_id", "source_url",
                "licence", "attribution", "reference_date", "publication_date", "n_addresses",
                "n_observed", "coverage_status", "measures"], rows)
        if "territory_id=ANY(%s::text[]) AND typequ=ANY" in s:
            # Member aggregate rows projected over the requested measures.
            measures, _ttype, ids, typequs = params
            rows = []
            for code in ids:
                for typequ, record in self.state["aggregates"].get(("member", code), {}).items():
                    if typequ in typequs:
                        rows.append((code, typequ, record["n_addresses"], record["n_observed"],
                            record["coverage"], {m: record["measures"].get(m) for m in measures}))
            return _AedarSelectedRows(["territory_id", "typequ", "n_addresses", "n_observed",
                "coverage_status", "measures"], rows)
        if "FROM aedar_territorial_aggregate WHERE territory_type=%s" in s:
            # Direct fixed reference read (fixed_comparison contexts).
            measure, rtype, rid, typequ = params
            record = self.state["aggregates"].get(("direct", rtype, rid), {}).get(typequ)
            if record is None:
                return _AedarSelectedRows(["value", "n_addresses", "n_observed", "coverage_status"], [])
            return _AedarSelectedRows(["value", "n_addresses", "n_observed", "coverage_status"],
                [(record["measures"].get(measure), record["n_addresses"], record["n_observed"],
                  record["coverage"])])
        if "FROM aedar_territorial_aggregate a" in s:
            # Focal row of a fixed comparison (single typequ).
            measure, ttype, tid, typequ = params
            record = self.state["aggregates"][("focal", tid)][typequ]
            return _AedarSelectedRows(["typequ_label", "source_id", "vintage_id", "source_url", "licence",
                "attribution", "reference_date", "publication_date", "value", "n_addresses",
                "n_observed", "coverage_status"],
                (record["label"], "aedar_bretagne", "2026-v1", "https://example.test", "ODbL", "AEDAR",
                 None, "2026-09-30", record["measures"].get(measure), record["n_addresses"],
                 record["n_observed"], record["coverage"]))
        if "FROM aedar_comparison_group" in s:
            return _AedarSelectedRows(["value", "n_addresses", "n_observed", "coverage_status", "statistic"],
                [(4.0, None, None, None, "pooled")])
        raise AssertionError(f"Unexpected AEDAR query: {s}")


def _aedar_selected_state():
    # TYPEQU registry of the fixture: A104 + B207 (the published registry size
    # the aggregate readings sum over). The 15-minute car share/mean columns
    # drive the registry-wide aggregate readings meanDiversity / meanVolume.
    communes = {
        # Original per-cell fixture values plus the 15-minute car share/mean
        # columns that drive the registry-wide aggregate readings.
        "22001": {"A104": {"count_5_walk_mean": 5.0, "count_5_walk_decile1": 1.0,
                           "count_15_car_share": 0.5, "count_15_car_mean": 12.0},
                  "B207": {"count_5_walk_mean": 2.0, "count_5_walk_decile1": 0.5,
                           "count_15_car_share": 0.25, "count_15_car_mean": 6.0},
                  "n_addresses": 10, "n_observed": {"A104": 9, "B207": 9}},
        "22002": {"A104": {"count_5_walk_mean": 8.0, "count_5_walk_decile1": 2.0,
                           "count_15_car_share": 0.8, "count_15_car_mean": 20.0},
                  "B207": {"count_5_walk_mean": 4.0, "count_5_walk_decile1": 1.0,
                           "count_15_car_share": 0.4, "count_15_car_mean": 10.0},
                  "n_addresses": 30, "n_observed": {"A104": 25, "B207": 25}},
        "22003": {"A104": {"count_5_walk_mean": 8.0, "count_5_walk_decile1": 4.0,
                           "count_15_car_share": 0.8, "count_15_car_mean": 20.0},
                  "B207": {"count_5_walk_mean": 4.0, "count_5_walk_decile1": 3.0,
                           "count_15_car_share": 0.4, "count_15_car_mean": 10.0},
                  "n_addresses": 10, "n_observed": {"A104": 8, "B207": 8}},
    }
    # meanDiversity / meanVolume per commune: 22001 -> 0.75 / 18.0,
    # 22002 and 22003 -> 1.2 / 30.0 (a tie behind the focal).
    aggregates = {}
    for code, spec in communes.items():
        records = {}
        for typequ in ("A104", "B207"):
            records[typequ] = {
                "label": "Alimentation" if typequ == "A104" else "Santé",
                "n_addresses": spec["n_addresses"],
                "n_observed": spec["n_observed"][typequ],
                "coverage": "covered",
                "measures": dict(spec[typequ]),
            }
        aggregates[("focal", code)] = records
        aggregates[("member", code)] = {key: dict(value) for key, value in records.items()}
    aggregates[("focal", "E1")] = aggregates[("member", "E1")] = {
        "A104": {"label": "Alimentation", "n_addresses": 500, "n_observed": 400,
                 "coverage": "covered",
                 "measures": {"count_5_walk_mean": 6.0, "count_15_car_share": 0.6,
                              "count_15_car_mean": 15.0}},
        "B207": {"label": "Santé", "n_addresses": 500, "n_observed": 380,
                 "coverage": "covered",
                 "measures": {"count_15_car_share": 0.3, "count_15_car_mean": 8.0}},
    }
    # EPCI E1 registry-wide readings: diversity 0.9, volume 23.0.
    aggregates[("focal", "E2")] = aggregates[("member", "E2")] = {
        "A104": {"label": "Alimentation", "n_addresses": 200, "n_observed": 150,
                 "coverage": "covered",
                 "measures": {"count_15_car_share": 0.7, "count_15_car_mean": 18.0}},
        "B207": {"label": "Santé", "n_addresses": 200, "n_observed": 140,
                 "coverage": "covered",
                 "measures": {"count_15_car_share": 0.35, "count_15_car_mean": 9.0}},
    }
    # EPCI E2 registry-wide readings: diversity 1.05, volume 27.0.
    aggregates[("direct", "region", "53")] = {
        "A104": {"label": "Alimentation", "n_addresses": 1000, "n_observed": 900,
                 "coverage": "covered",
                 "measures": {"count_5_walk_mean": 13.0, "count_15_car_share": 0.9,
                              "count_15_car_mean": 30.0}},
        "B207": {"label": "Santé", "n_addresses": 1000, "n_observed": 800,
                 "coverage": "covered",
                 "measures": {"count_15_car_share": 0.5, "count_15_car_mean": 15.0}},
    }
    # Région registry-wide readings: diversity 1.4, volume 45.0.
    return {
        "reference": {"22001": "commune", "22002": "commune", "22003": "commune",
                      "E1": "epci", "E2": "epci", "22": "departement", "53": "region"},
        "epci": "E1",
        # (territory_id, territory_type, department_id, epci_id, density_class_code)
        "ref_rows": [
            ("22001", "commune", "22", "E1", "D1"),
            ("22002", "commune", "22", "E1", "D1"),
            ("22003", "commune", "22", "E2", "D2"),
            ("E1", "epci", "22", None, None),
            ("E2", "epci", "22", None, None),
            ("22", "departement", None, None, None),
            ("53", "region", None, None, None),
        ],
        "aggregates": aggregates,
        # Pooled density-class artifact rows for the registry-wide sums.
        "group_rows": [
            {"group_id": "D1", "typequ": "A104", "measure": "count_15_car_mean",
             "value": 16.0, "n_addresses": 40, "n_observed": 34,
             "coverage_status": "covered", "statistic": "pooled"},
            {"group_id": "D1", "typequ": "B207", "measure": "count_15_car_mean",
             "value": 8.0, "n_addresses": 40, "n_observed": 33,
             "coverage_status": "covered", "statistic": "pooled"},
            {"group_id": "D1", "typequ": "A104", "measure": "count_15_car_share",
             "value": 0.65, "n_addresses": 40, "n_observed": 34,
             "coverage_status": "covered", "statistic": "pooled"},
            {"group_id": "D1", "typequ": "B207", "measure": "count_15_car_share",
             "value": 0.3, "n_addresses": 40, "n_observed": 33,
             "coverage_status": "covered", "statistic": "pooled"},
            # D2 (the density class of commune 22003) carries a pooled row with
            # NULL n_observed: the schema CHECK admits it, but the unified law
            # computes n_bad_observed honestly, so D2's pooled reading is
            # honestly unavailable (#914 amendment, 2026-11-05).
            {"group_id": "D2", "typequ": "A104", "measure": "count_15_car_mean",
             "value": 16.0, "n_addresses": 40, "n_observed": 34,
             "coverage_status": "covered", "statistic": "pooled"},
            {"group_id": "D2", "typequ": "B207", "measure": "count_15_car_mean",
             "value": 8.0, "n_addresses": 40, "n_observed": None,
             "coverage_status": "covered", "statistic": "pooled"},
        ],
    }


def _aedar_facets():
    # Mirror the declared producer taxonomy exactly: share -> diversity,
    # mean -> volume (both ranked, higher-is-better); min/max/deciles ->
    # distribution curve readings, never ranked; the registry-wide aggregate
    # readings (#914) are ranked high-is-better diversity/volume facets.
    from api.aedar_models import AEDAR_AGGREGATE_READINGS, AEDAR_MEASURE_KEYS
    facets = {}
    for measure in AEDAR_MEASURE_KEYS:
        statistic = measure.rsplit("_", 1)[1]
        if statistic == "share":
            facets[measure] = {"facet": "diversity", "direction": "high", "ranked": True}
        elif statistic == "mean":
            facets[measure] = {"facet": "volume", "direction": "high", "ranked": True}
        else:
            facets[measure] = {"facet": "distribution", "direction": "high", "ranked": False}
    for reading in AEDAR_AGGREGATE_READINGS:
        facets[reading] = {
            "facet": "diversity" if reading == "meanDiversity" else "volume",
            "direction": "high", "ranked": True}
    return facets


def test_aedar_selected_comparison_returns_weighted_mean_ranks_and_curve_cells():
    from fastapi import HTTPException
    conn = _AedarSelectedConnection(_aedar_selected_state())
    members = [("commune", "22001"), ("commune", "22002"), ("commune", "22003")]
    result = aedar_reads._aedar_selected_comparison_snapshot(
        conn, "commune", "22001", members, ["A104", "B207"],
        ["count_5_walk_mean", "count_5_walk_decile1"],
        ["group_value", "value", "rank", "rank_size", "rank_ties"], _aedar_facets())
    assert result["selection"] == [{"territory_type": "commune", "territory_id": code}
                                    for _, code in members]
    assert result["scope"] == {"kind": "explicit_selection", "member_count": 3,
                               "territory_type": "commune"}
    assert result["content_version"] == "cmp-v1" and result["source_snapshot_id"] == "2026-v1"
    assert result["aedar_content_version"] == "aed-v1" and result["reference_content_version"] == "ref-v1"
    by_cell = {(entry["typequ"], entry["measure"]): entry for entry in result["comparisons"]}
    assert len(result["comparisons"]) == 4
    scalar = by_cell[("A104", "count_5_walk_mean")]
    # Address-weighted mean: (5*10 + 8*30 + 8*10) / 50 = 7.4 - exactly the pooled
    # address aggregate of the selection, with the summed source counts.
    assert scalar["statistic"] == "pooled"
    assert scalar["group_value"] == pytest.approx(7.4)
    assert scalar["group_n_addresses"] == 50 and scalar["group_n_observed"] == 42
    assert scalar["group_coverage_status"] == "covered"
    assert scalar["direction"] == "high" and scalar["comparison_facet"] == "volume"
    assert scalar["value"] == 5.0 and scalar["status"] == "measured"
    # Direction-aware focal rank, ties share the rank: values 5, 8, 8 -> 3e/3.
    assert (scalar["rank"], scalar["rank_size"], scalar["rank_ties"]) == (3, 3, 1)
    # Per-cell curve readings get the same weighted mean but no rank chips.
    curve = by_cell[("A104", "count_5_walk_decile1")]
    assert curve["group_value"] == pytest.approx(2.2)
    assert curve["comparison_facet"] == "distribution"
    assert curve["rank"] is None and curve["rank_size"] is None and curve["rank_ties"] is None
    assert by_cell[("B207", "count_5_walk_mean")]["group_value"] == pytest.approx(
        (2*10 + 4*30 + 4*10) / 50)
    # Field projection drops the unselected optional fields.
    projected = aedar_reads._aedar_selected_comparison_snapshot(
        _AedarSelectedConnection(_aedar_selected_state()), "commune", "22001", members,
        ["A104"], ["count_5_walk_mean"], ["group_value", "rank"], _aedar_facets())
    entry = projected["comparisons"][0]
    assert entry["group_value"] == pytest.approx(7.4) and entry["rank"] == 3
    assert "value" not in entry and "rank_size" not in entry and "rank_ties" not in entry
    # Preflight only validates marker, focal and members without reading facts.
    pre = aedar_reads._aedar_selected_comparison_snapshot(
        _AedarSelectedConnection(_aedar_selected_state()), "commune", "22001", members,
        ["A104"], ["count_5_walk_mean"], None, _aedar_facets(), preflight_only=True)
    assert pre == {"content_version": "cmp-v1", "reference_content_version": "ref-v1"}


def test_aedar_selected_comparison_rank_is_direction_aware_and_needs_a_member_focal():
    from fastapi import HTTPException
    facets = _aedar_facets()
    facets["count_5_walk_mean"] = {"facet": "volume", "direction": "low", "ranked": True}
    members = [("commune", "22001"), ("commune", "22002"), ("commune", "22003")]
    # lower-is-better: values 5, 8, 8 -> focal 5 is best -> 1er/3.
    result = aedar_reads._aedar_selected_comparison_snapshot(
        _AedarSelectedConnection(_aedar_selected_state()), "commune", "22001", members,
        ["A104"], ["count_5_walk_mean"], ["rank", "rank_size", "rank_ties"], facets)
    entry = result["comparisons"][0]
    assert (entry["rank"], entry["rank_size"], entry["rank_ties"]) == (1, 3, 1)
    # The focal must be a member to receive a rank; the group stat still reads
    # over exactly the requested membership.
    without_focal = aedar_reads._aedar_selected_comparison_snapshot(
        _AedarSelectedConnection(_aedar_selected_state()), "commune", "22001",
        [("commune", "22002"), ("commune", "22003")], ["A104"], ["count_5_walk_mean"],
        ["group_value", "rank", "rank_size", "rank_ties"], _aedar_facets())
    entry = without_focal["comparisons"][0]
    assert entry["group_value"] == pytest.approx(8.0)
    assert entry["rank"] is None and entry["rank_size"] is None and entry["rank_ties"] is None
    assert without_focal["scope"]["member_count"] == 2


def test_aedar_selected_comparison_fails_closed_naming_the_failed_member():
    from fastapi import HTTPException
    members = [("commune", "22001"), ("commune", "22002"), ("commune", "22003")]
    # Unknown member identity.
    with pytest.raises(HTTPException) as err:
        aedar_reads._aedar_selected_comparison_snapshot(
            _AedarSelectedConnection(_aedar_selected_state()), "commune", "22001",
            members + [("commune", "99999")], ["A104"], ["count_5_walk_mean"], None, _aedar_facets())
    assert err.value.status_code == 404 and "commune/99999" in err.value.detail
    # Member type does not match its reference identity.
    with pytest.raises(HTTPException) as err:
        aedar_reads._aedar_selected_comparison_snapshot(
            _AedarSelectedConnection(_aedar_selected_state()), "commune", "22001",
            [("epci", "22001")], ["A104"], ["count_5_walk_mean"], None, _aedar_facets())
    assert err.value.status_code == 422 and "epci/22001" in err.value.detail
    # Mixed-level selection: members must share the focal level.
    with pytest.raises(HTTPException) as err:
        aedar_reads._aedar_selected_comparison_snapshot(
            _AedarSelectedConnection(_aedar_selected_state()), "commune", "22001",
            [("commune", "22002"), ("epci", "E1")], ["A104"], ["count_5_walk_mean"], None, _aedar_facets())
    assert err.value.status_code == 422 and "epci/E1" in err.value.detail
    # Empty selection has no pooled aggregate.
    with pytest.raises(HTTPException) as err:
        aedar_reads._aedar_selected_comparison_snapshot(
            _AedarSelectedConnection(_aedar_selected_state()), "commune", "22001",
            [], ["A104"], ["count_5_walk_mean"], None, _aedar_facets())
    assert err.value.status_code == 422
    # Partial member: no published aggregate row for the requested typequ.
    state = _aedar_selected_state()
    del state["aggregates"][("member", "22003")]["A104"]
    with pytest.raises(HTTPException) as err:
        aedar_reads._aedar_selected_comparison_snapshot(
            _AedarSelectedConnection(state), "commune", "22001", members,
            ["A104"], ["count_5_walk_mean"], None, _aedar_facets())
    assert err.value.status_code == 422 and "commune/22003" in err.value.detail
    # Partial member: published row exists but the measure value is null.
    state = _aedar_selected_state()
    state["aggregates"][("member", "22003")]["A104"]["measures"]["count_5_walk_mean"] = None
    with pytest.raises(HTTPException) as err:
        aedar_reads._aedar_selected_comparison_snapshot(
            _AedarSelectedConnection(state), "commune", "22001", members,
            ["A104"], ["count_5_walk_mean"], None, _aedar_facets())
    assert err.value.status_code == 422 and "commune/22003" in err.value.detail
    # Unknown measure coordinate and missing coordinates are 422.
    for typequ, measures in ((["A104"], ["bogus"]), (None, ["count_5_walk_mean"])):
        with pytest.raises(HTTPException) as err:
            aedar_reads._aedar_selected_comparison_snapshot(
                _AedarSelectedConnection(_aedar_selected_state()), "commune", "22001", members,
                typequ, measures, None, _aedar_facets())
        assert err.value.status_code == 422


def test_aedar_fixed_same_level_reference_reads_the_region_direct_aggregate():
    from fastapi import HTTPException
    conn = _AedarSelectedConnection(_aedar_selected_state())
    # EPCI same-level reference: the Région's own direct published aggregate
    # ("Moyenne de Bretagne"), never the retired same-level median summaries.
    result = aedar_reads._aedar_comparison_snapshot(conn, "epci", "E1", "same_level",
                                                   "A104", "count_5_walk_mean")
    comparison = result["comparison"]
    assert comparison["comparison_context"] == "same_level"
    assert comparison["group_id"] == "53" and comparison["territory_type"] == "region"
    assert comparison["statistic"] == "direct"
    assert comparison["group_value"] == 13.0
    assert comparison["group_n_addresses"] == 1000
    assert not any("aedar_comparison_group" in q and "same_level" in q for q in conn.queries)
    # Same-level stays scoped to EPCI/département fiches.
    with pytest.raises(HTTPException) as err:
        aedar_reads._aedar_comparison_snapshot(
            _AedarSelectedConnection(_aedar_selected_state()), "commune", "22001", "same_level",
            "A104", "count_5_walk_mean")
    assert err.value.status_code == 422



def test_aedar_selected_comparison_derives_group_coverage_honestly():
    members = [("commune", "22001"), ("commune", "22002"), ("commune", "22003")]
    # All members covered -> the group coverage is derived as covered.
    result = aedar_reads._aedar_selected_comparison_snapshot(
        _AedarSelectedConnection(_aedar_selected_state()), "commune", "22001", members,
        ["A104"], ["count_5_walk_mean"], None, _aedar_facets())
    assert result["comparisons"][0]["group_coverage_status"] == "covered"
    # Mixed member statuses: no single derivable coverage, so it stays
    # unknown (null) - never upgraded to covered.
    state = _aedar_selected_state()
    state["aggregates"][("member", "22003")]["A104"]["coverage"] = "pending_review"
    result = aedar_reads._aedar_selected_comparison_snapshot(
        _AedarSelectedConnection(state), "commune", "22001", members,
        ["A104"], ["count_5_walk_mean"], None, _aedar_facets())
    assert result["comparisons"][0]["group_coverage_status"] is None
    # A uniform lesser status is reflected as published, not upgraded.
    state = _aedar_selected_state()
    for code in ("22001", "22002", "22003"):
        state["aggregates"][("member", code)]["A104"]["coverage"] = "uncovered_no_address_origins"
    result = aedar_reads._aedar_selected_comparison_snapshot(
        _AedarSelectedConnection(state), "commune", "22001", members,
        ["A104"], ["count_5_walk_mean"], None, _aedar_facets())
    assert result["comparisons"][0]["group_coverage_status"] == "uncovered_no_address_origins"


def test_aedar_fixed_aggregate_reading_serves_direct_reference_and_peer_rank():
    from fastapi import HTTPException
    conn = _AedarSelectedConnection(_aedar_selected_state())
    facets = _aedar_facets()
    # Commune 22001, ambient EPCI context, registry-wide volume reading:
    # meanVolume = count_15_car_mean summed over the complete registry (18.0).
    result = aedar_reads._aedar_comparison_snapshot(
        conn, "commune", "22001", "epci", None, "meanVolume",
        ["group_value", "value", "rank", "rank_size", "rank_ties"], facets)
    comparison = result["comparison"]
    assert comparison["comparison_context"] == "epci"
    assert comparison["measure"] == "meanVolume" and comparison["typequ"] is None
    assert comparison["typequ_label"] is None
    # The reference keeps its declared semantics: the EPCI's own direct
    # published aggregate summed over the registry (15 + 8 = 23.0).
    assert comparison["statistic"] == "direct"
    assert comparison["group_id"] == "E1" and comparison["territory_type"] == "epci"
    assert comparison["group_value"] == pytest.approx(23.0)
    assert comparison["group_n_addresses"] == 500
    assert comparison["group_n_observed"] == 780
    assert comparison["group_coverage_status"] == "covered"
    assert comparison["value"] == pytest.approx(18.0) and comparison["status"] == "measured"
    # Request-time rank over the context's resolved peer group (the EPCI's
    # communes 22001/22002 -> 18.0, 30.0): 2e/2, one tie at the focal value.
    assert (comparison["rank"], comparison["rank_size"], comparison["rank_ties"]) == (2, 2, 1)
    assert result["content_version"] == "cmp-v1" and result["source_snapshot_id"] == "2026-v1"
    # Bretagne context: peers are all Breton communes (18, 30, 30 -> 3e/3),
    # the reference is the Région's direct aggregate (30 + 15 = 45.0).
    bretagne = aedar_reads._aedar_comparison_snapshot(
        _AedarSelectedConnection(_aedar_selected_state()), "commune", "22001", "bretagne",
        None, "meanVolume", None, facets)["comparison"]
    assert bretagne["group_value"] == pytest.approx(45.0)
    assert bretagne["group_id"] == "53" and bretagne["territory_type"] == "region"
    assert (bretagne["rank"], bretagne["rank_size"], bretagne["rank_ties"]) == (3, 3, 1)
    assert bretagne["value"] == pytest.approx(18.0)
    # The diversity reading reads the same machinery over count_15_car_share.
    diversity = aedar_reads._aedar_comparison_snapshot(
        _AedarSelectedConnection(_aedar_selected_state()), "commune", "22001", "epci",
        None, "meanDiversity", None, facets)["comparison"]
    assert diversity["value"] == pytest.approx(0.75)
    assert diversity["group_value"] == pytest.approx(0.9)
    assert (diversity["rank"], diversity["rank_size"], diversity["rank_ties"]) == (2, 2, 1)
    # Field projection drops the unselected optional rank/value fields.
    projected = aedar_reads._aedar_comparison_snapshot(
        _AedarSelectedConnection(_aedar_selected_state()), "commune", "22001", "epci",
        None, "meanVolume", ["group_value", "rank"], facets)["comparison"]
    assert projected["group_value"] == pytest.approx(23.0) and projected["rank"] == 2
    assert "value" not in projected and "rank_size" not in projected and "rank_ties" not in projected
    # Preflight validates marker and territory without reading facts.
    pre = aedar_reads._aedar_comparison_snapshot(
        _AedarSelectedConnection(_aedar_selected_state()), "commune", "22001", "epci",
        None, "meanVolume", None, facets, preflight_only=True)
    assert pre == {"content_version": "cmp-v1", "reference_content_version": "ref-v1"}


def test_aedar_fixed_aggregate_same_level_and_density_contexts():
    facets = _aedar_facets()
    # EPCI same-level: the reference is the Région's direct aggregate; the
    # rank reads over all Breton EPCIs (E1 23.0, E2 27.0 -> 2e/2).
    same_level = aedar_reads._aedar_comparison_snapshot(
        _AedarSelectedConnection(_aedar_selected_state()), "epci", "E1", "same_level",
        None, "meanVolume", None, facets)["comparison"]
    assert same_level["statistic"] == "direct"
    assert same_level["group_id"] == "53" and same_level["territory_type"] == "region"
    assert same_level["group_value"] == pytest.approx(45.0)
    assert same_level["value"] == pytest.approx(23.0)
    assert (same_level["rank"], same_level["rank_size"], same_level["rank_ties"]) == (2, 2, 1)
    # Density class: the reference is the pooled address artifact summed over
    # the registry (16 + 8 = 24.0); peers are the density class communes.
    density = aedar_reads._aedar_comparison_snapshot(
        _AedarSelectedConnection(_aedar_selected_state()), "commune", "22001", "density_class",
        None, "meanVolume", None, facets)["comparison"]
    assert density["statistic"] == "pooled"
    assert density["group_id"] == "D1" and density["territory_type"] == "commune"
    assert density["group_value"] == pytest.approx(24.0)
    assert density["group_n_addresses"] == 40 and density["group_n_observed"] == 67
    assert (density["rank"], density["rank_size"], density["rank_ties"]) == (2, 2, 1)
    diversity = aedar_reads._aedar_comparison_snapshot(
        _AedarSelectedConnection(_aedar_selected_state()), "commune", "22001", "density_class",
        None, "meanDiversity", None, facets)["comparison"]
    assert diversity["group_value"] == pytest.approx(0.95)
    assert diversity["value"] == pytest.approx(0.75)


def test_aedar_fixed_aggregate_rejects_malformed_coordinate_shapes():
    from fastapi import HTTPException
    conn = _AedarSelectedConnection(_aedar_selected_state())
    facets = _aedar_facets()
    # An aggregate reading takes no typequ coordinate.
    with pytest.raises(HTTPException) as err:
        aedar_reads._aedar_comparison_snapshot(
            conn, "commune", "22001", "epci", "A104", "meanVolume", None, facets)
    assert err.value.status_code == 422 and "typequ" in err.value.detail
    # A per-cell measure still requires its TYPEQU coordinate.
    with pytest.raises(HTTPException) as err:
        aedar_reads._aedar_comparison_snapshot(
            conn, "commune", "22001", "epci", None, "count_5_walk_mean", None, facets)
    assert err.value.status_code == 422
    # Unknown measures stay rejected; a missing facet declaration fails closed.
    with pytest.raises(HTTPException) as err:
        aedar_reads._aedar_comparison_snapshot(
            conn, "commune", "22001", "epci", None, "bogus", None, facets)
    assert err.value.status_code == 422
    with pytest.raises(HTTPException) as err:
        aedar_reads._aedar_comparison_snapshot(
            conn, "commune", "22001", "epci", None, "meanVolume", None, {})
    assert err.value.status_code == 503
    # Per-cell measures keep #904's boundary: rank fields are not selectable.
    with pytest.raises(HTTPException) as err:
        aedar_reads._aedar_comparison_snapshot(
            conn, "commune", "22001", "epci", "A104", "count_5_walk_mean", ["rank"], facets)
    assert err.value.status_code == 422


def test_aedar_selected_aggregate_returns_pooled_weighted_readings_and_ranks():
    from fastapi import HTTPException
    members = [("commune", "22001"), ("commune", "22002"), ("commune", "22003")]
    conn = _AedarSelectedConnection(_aedar_selected_state())
    result = aedar_reads._aedar_selected_comparison_snapshot(
        conn, "commune", "22001", members, None, ["meanDiversity", "meanVolume"],
        ["group_value", "value", "rank", "rank_size", "rank_ties"], _aedar_facets())
    assert result["scope"] == {"kind": "explicit_selection", "member_count": 3,
                               "territory_type": "commune"}
    by_measure = {entry["measure"]: entry for entry in result["comparisons"]}
    assert set(by_measure) == {"meanDiversity", "meanVolume"}
    diversity = by_measure["meanDiversity"]
    # Each member's reading is the registry-wide sum: 0.75 / 1.2 / 1.2; the
    # group statistic keeps #859's address-weighted pooled semantics.
    assert diversity["typequ"] is None and diversity["typequ_label"] is None
    assert diversity["statistic"] == "pooled"
    assert diversity["direction"] == "high" and diversity["comparison_facet"] == "diversity"
    assert diversity["group_value"] == pytest.approx((0.75 * 10 + 1.2 * 30 + 1.2 * 10) / 50)
    assert diversity["group_n_addresses"] == 50 and diversity["group_n_observed"] == 84
    assert diversity["group_coverage_status"] == "covered"
    assert diversity["value"] == pytest.approx(0.75) and diversity["status"] == "measured"
    # Direction-aware focal rank within the selection: 0.75 < 1.2 = 1.2 -> 3e/3.
    assert (diversity["rank"], diversity["rank_size"], diversity["rank_ties"]) == (3, 3, 1)
    volume = by_measure["meanVolume"]
    assert volume["comparison_facet"] == "volume"
    assert volume["group_value"] == pytest.approx((18.0 * 10 + 30.0 * 30 + 30.0 * 10) / 50)
    assert volume["value"] == pytest.approx(18.0)
    assert (volume["rank"], volume["rank_size"], volume["rank_ties"]) == (3, 3, 1)
    # Field projection drops the unselected optional fields.
    projected = aedar_reads._aedar_selected_comparison_snapshot(
        _AedarSelectedConnection(_aedar_selected_state()), "commune", "22001", members,
        None, ["meanVolume"], ["group_value", "rank"], _aedar_facets())
    entry = projected["comparisons"][0]
    assert entry["group_value"] == pytest.approx(27.6) and entry["rank"] == 3
    assert "value" not in entry and "rank_size" not in entry and "rank_ties" not in entry
    # The focal must be a member to receive a rank; the group stat still reads
    # over exactly the requested membership (weights 30 + 10).
    without_focal = aedar_reads._aedar_selected_comparison_snapshot(
        _AedarSelectedConnection(_aedar_selected_state()), "commune", "22001",
        [("commune", "22002"), ("commune", "22003")], None, ["meanDiversity"],
        ["group_value", "value", "rank", "rank_size", "rank_ties"], _aedar_facets())
    entry = without_focal["comparisons"][0]
    assert entry["group_value"] == pytest.approx(1.2)
    assert entry["value"] == pytest.approx(0.75)
    assert entry["rank"] is None and entry["rank_size"] is None and entry["rank_ties"] is None
    # Preflight only validates marker, focal and members without reading facts.
    pre = aedar_reads._aedar_selected_comparison_snapshot(
        _AedarSelectedConnection(_aedar_selected_state()), "commune", "22001", members,
        None, ["meanDiversity"], None, _aedar_facets(), preflight_only=True)
    assert pre == {"content_version": "cmp-v1", "reference_content_version": "ref-v1"}


def test_aedar_selected_aggregate_skips_ineligible_members_instead_of_ranking_them():
    from fastapi import HTTPException
    members = [("commune", "22001"), ("commune", "22002"), ("commune", "22003")]
    facets = _aedar_facets()
    # A member whose registry is incomplete contributes no partial sum: it is
    # honestly unavailable and ineligible — the pooled statistic and the rank
    # read over the eligible members only (22001, 22002 -> weights 10, 30).
    state = _aedar_selected_state()
    del state["aggregates"][("member", "22003")]["B207"]
    del state["aggregates"][("focal", "22003")]["B207"]
    result = aedar_reads._aedar_selected_comparison_snapshot(
        _AedarSelectedConnection(state), "commune", "22001", members, None,
        ["meanVolume"], ["group_value", "value", "rank", "rank_size", "rank_ties"], facets)
    entry = result["comparisons"][0]
    assert entry["group_value"] == pytest.approx((18.0 * 10 + 30.0 * 30) / 40)
    assert entry["group_n_addresses"] == 40 and entry["group_n_observed"] == 68
    assert entry["group_coverage_status"] == "covered"
    assert entry["value"] == pytest.approx(18.0)
    # rank_size reflects the eligible population: 22003 is not ranked.
    assert (entry["rank"], entry["rank_size"], entry["rank_ties"]) == (2, 2, 1)
    assert result["scope"]["member_count"] == 3  # requested membership stays truthful
    # A member with an unmeasured (null) per-type value is equally ineligible.
    state = _aedar_selected_state()
    state["aggregates"][("member", "22003")]["B207"]["measures"]["count_15_car_mean"] = None
    state["aggregates"][("focal", "22003")]["B207"]["measures"]["count_15_car_mean"] = None
    result = aedar_reads._aedar_selected_comparison_snapshot(
        _AedarSelectedConnection(state), "commune", "22001", members, None,
        ["meanVolume"], ["group_value", "rank", "rank_size"], facets)
    entry = result["comparisons"][0]
    assert entry["group_value"] == pytest.approx(27.0)
    assert (entry["rank"], entry["rank_size"]) == (2, 2)
    # Coordinate-shape rejections: mixed, unknown, missing or conflicting axes.
    for typequ, measures in ((["A104"], ["meanVolume", "count_5_walk_mean"]),
                             (None, ["bogus"]),
                             (None, []),
                             (["A104"], ["meanDiversity"]),
                             (None, ["count_5_walk_mean"])):
        with pytest.raises(HTTPException) as err:
            aedar_reads._aedar_selected_comparison_snapshot(
                _AedarSelectedConnection(_aedar_selected_state()), "commune", "22001",
                members, typequ, measures, None, facets)
        assert err.value.status_code == 422


def test_aedar_aggregate_availability_law_matches_the_fiche_conditions():
    """The aggregate sums exist only under the fiche's full compatibility law.

    Mirrors carAccessMeans (app/src/fiche/content/aedarAccessSection.ts) and
    CONTEXT.md « Moyennes d'accès en voiture AEDAR »: complete registry, one
    shared source vintage, every row covered, agreeing positive address
    population, valid observed counts, finite non-negative values (<= 1 for
    shares). Rows failing any condition make the reading honestly unavailable
    for BOTH intents; ineligible members/peers are skipped by the rank.
    """
    facets = _aedar_facets()
    members = [("commune", "22001"), ("commune", "22002"), ("commune", "22003")]

    def selected_volume(state):
        result = aedar_reads._aedar_selected_comparison_snapshot(
            _AedarSelectedConnection(state), "commune", "22001", members, None,
            ["meanVolume"], ["group_value", "value", "rank", "rank_size", "rank_ties"], facets)
        return result["comparisons"][0]

    def break_22003(state, key, value):
        for scope in ("member", "focal"):
            state["aggregates"][(scope, "22003")]["B207"][key] = value

    # Mixed coverage: one row not "covered" -> 22003 ineligible.
    state = _aedar_selected_state()
    break_22003(state, "coverage", "pending_review")
    entry = selected_volume(state)
    assert (entry["rank"], entry["rank_size"], entry["rank_ties"]) == (2, 2, 1)
    assert entry["group_value"] == pytest.approx(27.0)

    # Divergent provenance: one row on another vintage -> 22003 ineligible.
    state = _aedar_selected_state()
    break_22003(state, "vintage_id", "2026-v2")
    entry = selected_volume(state)
    assert (entry["rank"], entry["rank_size"]) == (2, 2)

    # Observed-count anomaly: n_observed beyond n_addresses -> ineligible.
    state = _aedar_selected_state()
    break_22003(state, "n_observed", 999)
    entry = selected_volume(state)
    assert (entry["rank"], entry["rank_size"]) == (2, 2)

    # Divergent address population -> ineligible.
    state = _aedar_selected_state()
    break_22003(state, "n_addresses", 99)
    entry = selected_volume(state)
    assert (entry["rank"], entry["rank_size"]) == (2, 2)

    # A share above 1 invalidates only the diversity reading, not the volume.
    state = _aedar_selected_state()
    for scope in ("member", "focal"):
        state["aggregates"][(scope, "22002")]["A104"]["measures"]["count_15_car_share"] = 1.5
    result = aedar_reads._aedar_selected_comparison_snapshot(
        _AedarSelectedConnection(state), "commune", "22001", members, None,
        ["meanDiversity", "meanVolume"], ["group_value", "rank", "rank_size"], facets)
    by_measure = {entry["measure"]: entry for entry in result["comparisons"]}
    assert (by_measure["meanDiversity"]["rank"], by_measure["meanDiversity"]["rank_size"]) == (2, 2)
    assert by_measure["meanDiversity"]["group_value"] == pytest.approx(
        (0.75 * 10 + 1.2 * 10) / 20)  # 22002 ineligible for the share sum
    assert (by_measure["meanVolume"]["rank"], by_measure["meanVolume"]["rank_size"]) == (3, 3)

    # Fixed intent: an incompatible focal is honestly unavailable (no rank),
    # while the reference group statistic still reads; eligible peers only.
    state = _aedar_selected_state()
    break_22003(state, "coverage", "uncovered_no_address_origins")
    result = aedar_reads._aedar_comparison_snapshot(
        _AedarSelectedConnection(state), "commune", "22003", "bretagne", None,
        "meanVolume", ["group_value", "value", "status", "rank", "rank_size", "rank_ties"], facets)
    comparison = result["comparison"]
    assert comparison["value"] is None and comparison["status"] == "not_available"
    assert comparison["rank"] is None and comparison["rank_size"] is None
    assert comparison["group_value"] == pytest.approx(45.0)  # Région reference
    # The same incompatible rows as a peer: skipped by the rank of an eligible
    # focal (bretagne peers 22001/22002 eligible, 22003 ineligible -> 2e/2).
    result = aedar_reads._aedar_comparison_snapshot(
        _AedarSelectedConnection(state), "commune", "22001", "bretagne", None,
        "meanVolume", ["value", "rank", "rank_size", "rank_ties"], facets)
    comparison = result["comparison"]
    assert comparison["value"] == pytest.approx(18.0)
    assert (comparison["rank"], comparison["rank_size"], comparison["rank_ties"]) == (2, 2, 1)


def test_aedar_aggregate_law_reads_one_normalized_record_for_both_shapes():
    """One law over one normalized law-input record, for both SQL shapes (#914).

    The two aggregate adapters — territorial per-territory rows and the pooled
    density group — emit the same normalized tuple, and the availability law
    is applied once over it. Every condition fails closed: incomplete
    registry, split provenance, mixed statistic, uncovered rows, disagreeing
    or non-positive address population, bad observed counts, unmeasured
    values, non-finite or negative values, and shares above 1.
    """
    law_inputs = aedar_reads._AEDARAggregateLawInputs
    law = aedar_reads._aedar_aggregate_available
    base = dict(n_rows=2, n_measured=2, total=24.0, v_min=8.0, v_max=16.0,
                na_min=40, na_max=40, observed_sum=67, n_provenance=1,
                n_uncovered=0, n_bad_observed=0, n_statistic=1,
                statistic="pooled", coverage="covered", n_coverage=1)
    # The pooled shape and the territorial shape (statistic "direct") flow
    # through the very same law over the same normalized record type.
    assert law(law_inputs(**base), 2, "count_15_car_mean") is True
    assert law(law_inputs(**{**base, "statistic": "direct"}), 2, "count_15_car_mean") is True
    # Each law input fails closed on its own.
    for field, value in (("n_rows", 1), ("n_measured", 1), ("n_provenance", 2),
                         ("n_statistic", 2), ("n_uncovered", 1), ("n_bad_observed", 1),
                         ("na_min", 41), ("na_max", None), ("v_min", None),
                         ("v_min", -0.5), ("v_max", float("inf"))):
        assert law(law_inputs(**{**base, field: value}), 2, "count_15_car_mean") is False
    # Share readings cap the per-type values at 1; the volume reading does not.
    assert law(law_inputs(**{**base, "v_max": 1.5}), 2, "count_15_car_share") is False
    assert law(law_inputs(**{**base, "v_max": 1.0}), 2, "count_15_car_share") is True
    assert law(law_inputs(**{**base, "v_max": 1.5}), 2, "count_15_car_mean") is True


def test_aedar_pooled_group_null_observed_row_is_honestly_unavailable():
    """A pooled density row with NULL n_observed is honestly bad (#914 amendment).

    The schema CHECK admits a NULL n_observed on `aedar_comparison_group`, but
    the unified aggregate mechanism computes n_bad_observed in SQL exactly
    like the territorial path, so the pooled registry-wide reading is honestly
    unavailable (value null) — never silently served as a sum.
    """
    state = _aedar_selected_state()  # D2 carries a NULL n_observed pooled row
    conn = _AedarSelectedConnection(state)
    record = aedar_reads._aedar_pooled_group_aggregate(conn, "D2", "count_15_car_mean", 2)
    assert record["value"] is None and record["available"] is False
    assert record["statistic"] == "pooled"
    # End to end: the fixed density_class reference reads honestly unavailable
    # (group_value null) while the territorial focal (22003, in D2) still
    # reads its own registry-wide sum and ranks within its peer group.
    result = aedar_reads._aedar_comparison_snapshot(
        conn, "commune", "22003", "density_class", None, "meanVolume",
        ["group_value", "value", "status", "rank", "rank_size", "rank_ties"],
        _aedar_facets())
    comparison = result["comparison"]
    assert comparison["comparison_context"] == "density_class"
    assert comparison["group_id"] == "D2" and comparison["statistic"] == "pooled"
    assert comparison["group_value"] is None
    assert comparison["value"] == pytest.approx(30.0)
    assert comparison["status"] == "measured"
    assert (comparison["rank"], comparison["rank_size"], comparison["rank_ties"]) == (1, 1, 1)

