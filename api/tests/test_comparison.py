"""The HTTP response is the comparison contract; SQL is not the test seam."""

from fastapi.testclient import TestClient

from api.main import ReadRepository, app, get_repository


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
