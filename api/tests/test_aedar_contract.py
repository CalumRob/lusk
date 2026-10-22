import inspect
from pathlib import Path

import pytest

from api import aedar_reads, semantic_resource_reader
from api.resource_catalogue import default_resource_catalogue, validate_resource_item
from api.resource_requests import ResourceReadItem


def test_aedar_semantic_dispatch_is_declared_typed_and_bounded():
    # The legacy AEDAR GET routes are retired: the producer declaration plus the
    # semantic reader is the sole read path. Coordinate and intent grammar stay
    # exactly as declared, and the shared source-grain SQL reader is reused.
    resource = default_resource_catalogue.__wrapped__().resources_by_id["aedar_territorial_aggregate"]
    assert resource.resource_kind == "aedar_source_grain"
    assert resource.axes == ("typequ", "measure", "context")
    assert resource.intents == ("facts", "fixed_comparison")
    assert resource.allowed_levels == ("commune", "epci", "departement", "region")
    assert resource.context_values == ("density_class", "epci", "bretagne", "same_level")
    dispatch_source = inspect.getsource(semantic_resource_reader.SemanticResourceReader)
    assert 'resource.resource_kind == "aedar_source_grain"' in dispatch_source
    assert dispatch_source.count("_aedar_territorial_aggregate_snapshot") >= 2
    assert dispatch_source.count("_aedar_comparison_snapshot") >= 2
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
    assert "rank_ties" not in source
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
