"""The HTTP response is the comparison contract; SQL is not the test seam."""

from fastapi.testclient import TestClient

from api.main import ReadRepository, app, compare, get_repository


class ExampleRepository:
    def read(self, territory_id, comparison):
        assert territory_id == "22001"
        assert comparison == "epci"
        return {
            "publication_id": "fixture-v1",
            "territory": {"id": "22001", "name": "Exemple", "type": "commune"},
            "scope": {"kind": "communes-epci", "label": "communes de l'EPCI exemple"},
            "rows": [
                # Three comparable peers; a fourth peer has an unavailable walking value.
                *[dict(territory_id=code, service="health", mode=mode, share=value,
                       indicator_label=f"Santé {mode}", direction=direction,
                       source_id="snapshot", source_name="Source exemple", source_version="2026-02",
                       reference_date="2026-02-28", source_publication_date="2026-08-06")
                  for code, values in {
                      "22001": {"walk_transit": .2, "bike": .6, "car": .8},
                      "22002": {"walk_transit": .4, "bike": .5, "car": .9},
                      "22003": {"walk_transit": .2, "bike": .7, "car": .95},
                      "22004": {"walk_transit": None, "bike": .6, "car": .9},
                  }.items() for mode, value in values.items() for direction in ["high"]],
                *[dict(territory_id=code, service="food", mode="car", share=value,
                       indicator_label="Alimentation voiture", direction="low",
                       source_id="snapshot", source_name="Source exemple", source_version="2026-02",
                       reference_date="2026-02-28", source_publication_date="2026-08-06")
                  for code, value in [("22001", .2), ("22002", .1), ("22003", .2), ("22004", None)]],
            ],
        }


def test_selected_scope_computes_medians_gaps_and_directional_ties():
    app.dependency_overrides[get_repository] = lambda: ExampleRepository()
    try:
        response = TestClient(app).get("/api/territories/commune/22001/essential-services?comparison=epci")
    finally:
        app.dependency_overrides.clear()
    assert response.status_code == 200
    body = response.json()
    assert body["publication_id"] == "fixture-v1"
    assert body["scope"] == {"kind": "communes-epci", "label": "communes de l'EPCI exemple", "member_count": 4}
    health = next(s for s in body["services"] if s["id"] == "health")
    assert health["modes"]["walk_transit"]["median"] == .2
    assert health["modes"]["walk_transit"]["rank"] == {"position": 2, "size": 3}
    assert health["modes"]["car"]["rank"] == {"position": 4, "size": 4}
    assert health["modes"]["car"]["source_name"] == "Source exemple"
    assert health["modes"]["car"]["source_publication_date"] == "2026-08-06"
    # Median of individual (car - walk) gaps: [.6, .5, .75], not median(car)-median(walk).
    assert health["peer_median_car_gap"] == .6
    food = next(s for s in body["services"] if s["id"] == "food")
    assert food["modes"]["car"]["direction"] == "low"
    assert food["modes"]["car"]["rank"] == {"position": 2, "size": 3}


def test_bad_comparison_mode_is_rejected_before_query():
    app.dependency_overrides[get_repository] = lambda: ExampleRepository()
    try:
        response = TestClient(app).get("/api/territories/commune/22001/essential-services?comparison=anything")
    finally:
        app.dependency_overrides.clear()
    assert response.status_code == 422


def test_health_does_not_need_database():
    assert TestClient(app).get("/api/health").json() == {"status": "ok"}


def test_level_routes_use_only_bounded_published_comparisons_and_region_has_null_statistics():
    class LevelsRepository:
        def read_level(self, territory_type, territory_id):
            assert (territory_type, territory_id) in {
                ("epci", "EPCI-1"), ("departement", "22"), ("region", "BRE"),
            }
            peers = {"epci": ["EPCI-1", "EPCI-2"],
                     "departement": ["22", "29", "35", "56"],
                     "region": ["BRE"]}[territory_type]
            return {
                "publication_id": "fixture-v1",
                "territory": {"id": territory_id, "name": "Territoire", "type": territory_type},
                "scope": None if territory_type == "region" else {"kind": f"{territory_type}-scope"},
                "comparison": territory_type != "region",
                "rows": [dict(territory_id=peer, service="health", mode="car", share=.5,
                              indicator_label="Santé", direction="high", source_id="source",
                              source_name="Source", source_version="v1", reference_date=None,
                              source_publication_date=None) for peer in peers],
            }

    app.dependency_overrides[get_repository] = lambda: LevelsRepository()
    try:
        client = TestClient(app)
        epci = client.get("/api/territories/epci/EPCI-1/essential-services").json()
        departement = client.get("/api/territories/departement/22/essential-services").json()
        region = client.get("/api/territories/region/BRE/essential-services").json()
    finally:
        app.dependency_overrides.clear()
    assert epci["territory"]["type"] == "epci"
    assert epci["scope"] == {"kind": "epci-scope", "member_count": 2}
    assert epci["services"][0]["modes"]["car"]["rank"]["size"] == 2
    assert departement["scope"] == {"kind": "departement-scope", "member_count": 4}
    assert departement["services"][0]["modes"]["car"]["rank"]["size"] == 4
    assert region["scope"] is None
    assert region["services"][0]["modes"]["car"]["rank"] is None
    assert region["services"][0]["modes"]["car"]["median"] is None
    assert region["services"][0]["peer_median_car_gap"] is None


def test_level_route_rejects_unbounded_territory_types():
    assert TestClient(app).get("/api/territories/pays/FR/essential-services").status_code == 404


def test_regional_scope_is_read_from_current_dataset_database_row():
    class Result:
        def __init__(self, value):
            self.value = value
        def fetchone(self):
            return self.value
        def fetchall(self):
            return []

    class Connection:
        def __init__(self):
            self.queries = []
        def transaction(self):
            class Transaction:
                def __enter__(self): return None
                def __exit__(self, *_): return False
            return Transaction()
        def execute(self, query, params=None):
            self.queries.append((query, params))
            if "SET TRANSACTION" in query:
                return Result(None)
            if "FROM table_publication" in query:
                return Result(("publication-current", "communes-bretagne-v2", "label version active"))
            if "FROM territory_reference" in query:
                return Result(("22001", "Exemple", "commune", "EPCI", "5", "Bourg"))
            if "FROM essential_service_access" in query:
                return Result(None)
            raise AssertionError(query)

    class Connections:
        def __init__(self): self.connection_value = Connection()
        def connection(self):
            class Context:
                def __enter__(inner): return self.connection_value
                def __exit__(inner, *_): return False
            return Context()

    connections = Connections()
    result = ReadRepository(connections).read("22001", "bretagne")
    assert result["scope"] == {"kind": "communes-bretagne-v2", "label": "label version active"}
    query, params = next((q, p) for q, p in connections.connection_value.queries
                          if "FROM table_publication" in q)
    assert "p.table_name = 'essential_service_access'" in query
    assert params is None
    query, params = next((q, p) for q, p in connections.connection_value.queries
                          if "FROM essential_service_access" in q)
    assert "t.territory_type = %s" in query
    assert params == ("commune", "commune")


def test_non_commune_query_uses_the_selected_territory_level_before_its_peer_scope():
    class Result:
        def __init__(self, row=None): self.row = row
        def fetchone(self): return self.row
        def fetchall(self): return []

    class Connection:
        def __init__(self): self.queries = []
        def transaction(self): return self
        def __enter__(self): return self
        def __exit__(self, *_): return False
        def execute(self, query, params=None):
            self.queries.append((query, params))
            if "FROM table_publication" in query:
                return Result(("v1", "communes-bretagne", "communes bretonnes"))
            if "FROM territory_reference" in query:
                return Result(("EPCI-1", "Example", "epci", None, None, None))
            return Result()

    class Connections:
        def __init__(self): self.current = Connection()
        def connection(self): return self.current

    connections = Connections()
    ReadRepository(connections).read_level("epci", "EPCI-1")
    query, params = next((q, p) for q, p in connections.current.queries
                          if "FROM essential_service_access" in q)
    assert "t.territory_type = %s" in query
    assert params == ("epci", "epci")
def test_scalar_services_reader_preserves_legacy_rows_and_fails_closed(monkeypatch):
    import pytest
    from fastapi import HTTPException

    keys = [f"share_{service}_{mode}" for service in
            ("food", "health", "admin", "school", "bank") for mode in ("t", "b", "c")]
    source_rows = []
    for territory_id, value in (("22001", .5), ("22002", .5), ("22003", .8)):
        for indicator in keys:
            service, code = indicator.removeprefix("share_").rsplit("_", 1)
            source_rows.append((indicator, territory_id, value, "measured", indicator,
                "high", "snapshot", "Snapshot", "2024", None, None))
    # The shared scalar table also contains non-service members of the batch.
    source_rows.extend((indicator, "22001", value, "measured", indicator, "low",
        "economy", "Economy source", "2023", None, None)
        for indicator, value in (("effectifs_salaries", 123.0), ("chomage", .07)))

    class Result:
        def __init__(self, row=None, rows=None): self.row, self.rows = row, rows or []
        def fetchone(self): return self.row
        def fetchall(self): return self.rows

    class Connection:
        def __init__(self, current=True): self.current, self.queries = current, []
        def transaction(self): return self
        def __enter__(self): return self
        def __exit__(self, *_): return False
        def execute(self, query, params=None):
            self.queries.append(query)
            if "SET TRANSACTION" in query: return Result()
            if "FROM table_publication p CROSS JOIN access_publication_metadata" in query:
                return Result(("legacy-v1", "communes-bretagne", "communes bretonnes"))
            if "FROM territory_reference" in query:
                return Result(("22001", "Example", "commune", "EPCI-1", "D", "Dense"))
            if "scalar.reference_content_version" in query:
                return Result(("scalar-v1", "territory-v1", "territory-v1") if self.current else None)
            if "FROM scalar_observation o" in query:
                # Model the registered service-id subquery in the SQL above.
                allowed = set(keys)
                return Result(rows=[row for row in source_rows if row[0] in allowed])
            raise AssertionError(query)

    class Connections:
        def __init__(self, current=True): self.conn = Connection(current)
        def connection(self): return self.conn

    monkeypatch.setenv("LUSK_SERVICES_SCALAR_READ", "1")
    new_repo = ReadRepository(Connections())
    scalar_response = compare(new_repo.read("22001", "bretagne"))
    scalar_sql = next(query for query in new_repo.connections.conn.queries
                      if "FROM scalar_observation o" in query)
    # Only metadata-registered service indicator IDs are parsed as service/mode.
    assert "'share_' || service || '_' || mode" in scalar_sql
    assert "FROM service_registry" in scalar_sql
    assert "ON os.indicator_id=o.indicator_id AND os.territory_id=o.territory_id" in scalar_sql
    legacy_rows = []
    for row in source_rows:
        if row[0] not in keys:
            continue
        service, mode_code = row[0].removeprefix("share_").rsplit("_", 1)
        legacy_rows.append({"territory_id": row[1], "service": service,
            "mode": {"t": "walk_transit", "b": "bike", "c": "car"}[mode_code],
            "share": row[2], "indicator_label": row[4], "direction": row[5],
            "source_id": row[6], "source_name": row[7], "source_version": row[8],
            "reference_date": None, "source_publication_date": None})
    old_response = compare({"publication_id": "legacy-v1",
        "territory": {"id": "22001", "name": "Example", "type": "commune"},
        "scope": {"kind": "communes-bretagne", "label": "communes bretonnes"},
        "comparison": True, "rows": legacy_rows})
    assert scalar_response.model_copy(update={"publication_id": old_response.publication_id}) == old_response

    with pytest.raises(HTTPException) as error:
        ReadRepository(Connections(current=False)).read("22001", "bretagne")
    assert error.value.status_code == 503
