from api.main import app


def test_aedar_reader_is_named_typed_and_bounded():
    route = next(r for r in app.routes if r.path ==
        "/api/aedar/territories/{territory_type}/{territory_id}/aggregates")
    assert route.endpoint.__name__ == "aedar_territorial_aggregates"
    assert route.methods == {"GET"}
    sql = " ".join(c for c in route.endpoint.__code__.co_consts if isinstance(c, str))
    assert "territory_type=%s AND territory_id=%s" in sql
    assert "LIMIT %s OFFSET %s" in sql
    assert "typequ=ANY(%s)" in sql
    assert "aedar_territorial_aggregate" in sql
    assert "sql" not in route.endpoint.__annotations__


def test_aedar_source_measure_contract_has_312_fields_and_four_level_identity():
    from pathlib import Path
    root = Path(__file__).resolve().parents[2]
    source = (root / "pipeline/R/aedar_aggregates.R").read_text(encoding="utf-8")
    for field in ("code_insee", "epci_code", "code_departement", "code_region",
                  "LIB_TYPEQU", "n_addresses", "n_observed", "coverage_status"):
        assert field in source
    assert "length(measure_columns)!=312L" in source
    assert "never derive" in source


def test_aedar_http_read_bounds_results_for_all_territory_levels(monkeypatch):
    from contextlib import contextmanager
    from fastapi.testclient import TestClient
    import api.main as main

    class Cursor:
        description = [type("Column", (), {"name": n}) for n in
                       ("territory_id", "territory_type", "typequ", "typequ_label",
                        "identity", "n_addresses", "n_observed", "coverage_status",
                        "measures", "source_id", "vintage_id", "source_url", "licence", "attribution")]
        def fetchone(self): return ("aedar_territorial_aggregate",)
        def fetchall(self):
            return [("id", "commune", "A104", "GENDARMERIE", {"code_insee": "id"},
                     10, 8, "covered", {"count_5_walk_share": 0}, "aedar_bretagne",
                     "2026-v1", "https://example.test", "ODbL", "AEDAR")]
    class Connection:
        def execute(self, *_args, **_kwargs): return Cursor()
    class FakePool:
        @contextmanager
        def connection(self): yield Connection()
    monkeypatch.setattr(main, "pool", lambda: FakePool())
    client = TestClient(main.app)
    for level in ("commune", "epci", "departement", "region"):
        response = client.get(f"/api/aedar/territories/{level}/id/aggregates?limit=1&typequ=A104")
        assert response.status_code == 200
        body = response.json()
        assert body["territory"] == {"type": level, "id": "id"}
        assert len(body["facts"]) == 1
        assert body["facts"][0]["licence"] == "ODbL"
        assert body["facts"][0]["measures"]["count_5_walk_share"] == 0
