"""The HTTP response is the comparison contract; SQL is not the test seam."""

from fastapi.testclient import TestClient

from api.importer import load_publication
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
            if "FROM dataset_publication" in query:
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
                         if "FROM dataset_publication" in q)
    assert "dataset_key = 'essential_service_access'" in query
    assert params is None


def test_published_epci_rank_parity_for_allineuc():
    """The R-published EPCI rank is an independent oracle for this specific scope."""
    from pathlib import Path

    publication = load_publication(Path(__file__).resolve().parents[2] / "public" / "data")
    territories = {row["territoire"]: row for row in publication.territories}
    members = {code for code, row in territories.items()
               if row["type"] == "commune" and row.get("epci") == territories["22001"]["epci"]}

    class PublishedRepository:
        def read(self, territory_id, comparison):
            assert (territory_id, comparison) == ("22001", "epci")
            return {
                "publication_id": publication.publication_id,
                "territory": {"id": "22001", "name": territories["22001"]["nom"], "type": "commune"},
                "scope": {"kind": "communes-epci", "label": "communes de l'EPCI"},
                "rows": [dict(territory_id=r.territory_id, service=r.service, mode=r.mode,
                              share=r.share, indicator_label=r.indicator_label,
                              direction=r.effective_direction, source_id=r.source_id,
                              source_name=r.source_name, source_version=r.source_version,
                              reference_date=r.reference_date,
                              source_publication_date=r.source_publication_date)
                         for r in publication.rows if r.territory_id in members],
            }

    app.dependency_overrides[get_repository] = lambda: PublishedRepository()
    try:
        body = TestClient(app).get(
            "/api/territories/commune/22001/essential-services?comparison=epci"
        ).json()
    finally:
        app.dependency_overrides.clear()
    health = next(s for s in body["services"] if s["id"] == "health")
    assert health["modes"]["walk_transit"]["rank"] == {"position": 19, "size": 38}
    assert health["modes"]["walk_transit"]["value"] == 0
