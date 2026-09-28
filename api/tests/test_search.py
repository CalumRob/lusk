from fastapi.testclient import TestClient

from api.main import app, get_repository, search_territory_rows


def test_search_parity_for_accents_codes_labels_and_stable_order():
    rows = [
        {"type": "commune", "id": "35001", "name": "Saint Malo"},
        {"type": "commune", "id": "35002", "name": "Saint-Malo"},
        {"type": "epci", "id": "2001", "name": "Rennes Métropole"},
        {"type": "departement", "id": "35", "name": "Ille-et-Vilaine"},
    ]
    assert [r["id"] for r in search_territory_rows(rows, "rennes", 8)] == ["2001"]
    assert [r["id"] for r in search_territory_rows(rows, "35002", 8)] == ["35002"]
    assert [r["id"] for r in search_territory_rows(rows, "saint malo", 8)] == ["35001", "35002"]


def test_search_route_is_bounded_and_returns_reference_provenance():
    class Repository:
        def search_territories(self, query, limit):
            return {"publication_id": "territory-v1-ref-1", "query": query,
                    "results": [{"type": "commune", "id": "35001", "name": "Rennes"}]}

    app.dependency_overrides[get_repository] = Repository
    try:
        client = TestClient(app)
        response = client.get("/api/territories/search?q=rennes&limit=3")
        assert response.status_code == 200
        assert response.json()["publication_id"] == "territory-v1-ref-1"
        assert client.get("/api/territories/search?q=x").status_code == 422
        assert client.get("/api/territories/search?q=rennes&limit=51").status_code == 422
        assert client.get("/api/territories/search?q=" + "a" * 65).status_code == 422
    finally:
        app.dependency_overrides.clear()
