from fastapi.testclient import TestClient

import pytest
from fastapi import HTTPException

from api.main import ReadRepository, app, get_repository, search_territory_rows


def test_search_preserves_one_character_name_queries_and_accent_hyphen_matching():
    rows = [
        {"type": "commune", "id": "35001", "name": "Saint Malo"},
        {"type": "commune", "id": "35002", "name": "Saint-Malo"},
        {"type": "epci", "id": "2001", "name": "Rennes Métropole"},
        {"type": "departement", "id": "35", "name": "Ille-et-Vilaine"},
    ]
    assert [r["id"] for r in search_territory_rows(rows, "r", 8)] == ["2001"]
    assert [r["id"] for r in search_territory_rows(rows, "rennes", 8)] == ["2001"]
    with pytest.raises(ValueError, match="French locale tie"):
        search_territory_rows(rows, "saint malo", 8)
    assert [r["id"] for r in search_territory_rows(rows, "MÉTRO", 8)] == ["2001"]
    assert [r["id"] for r in search_territory_rows(
        [{"type": "epci", "id": "1", "name": "CC de l’Oust à Brocéliande"}],
        "oust a broceliande", 8)] == ["1"]


def test_search_does_not_match_codes_and_fails_closed_on_locale_tie():
    rows = [{"type": "commune", "id": "35002", "name": "Vannes"}]
    assert search_territory_rows(rows, "35002", 8) == []
    tied = [*rows, {"type": "commune", "id": "35003", "name": "Rennes"}]
    with pytest.raises(ValueError, match="French locale tie"):
        search_territory_rows(tied, "n", 8)


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
        assert client.get("/api/territories/search?q=x").status_code == 200
        assert client.get("/api/territories/search?q=rennes&limit=51").status_code == 422
        assert client.get("/api/territories/search?q=" + "a" * 65).status_code == 422
    finally:
        app.dependency_overrides.clear()


def test_repository_uses_read_only_snapshot_reference_marker_and_bounded_projection():
    class Result:
        def __init__(self, rows): self.rows = rows
        def fetchone(self): return self.rows[0] if self.rows else None
        def fetchall(self): return self.rows

    class Connection:
        def __init__(self, missing_marker=False): self.calls = []; self.missing_marker = missing_marker
        def transaction(self): return self
        def __enter__(self): return self
        def __exit__(self, *_): return False
        def execute(self, sql, params=None):
            self.calls.append((sql, params))
            if "SET TRANSACTION" in sql: return Result([])
            if "table_publication" in sql:
                return Result([] if self.missing_marker else [("reference-v7",)])
            if "territory_reference" in sql:
                return Result([("commune", "A", "Rennes"), ("epci", "E", "Rennes Métropole")])
            raise AssertionError(sql)

    class Connections:
        def __init__(self, connection): self.current = connection
        def connection(self): return self.current

    conn = Connection()
    result = ReadRepository(Connections(conn)).search_territories("rennes", 8)
    assert result["publication_id"] == "territory-v1-reference-v7"
    assert [r["id"] for r in result["results"]] == ["A", "E"]
    assert "REPEATABLE READ, READ ONLY" in conn.calls[0][0]
    assert "SELECT territory_type, territory_id, name FROM territory_reference" in conn.calls[2][0]

    with pytest.raises(HTTPException) as error:
        ReadRepository(Connections(Connection(missing_marker=True))).search_territories("rennes", 8)
    assert error.value.status_code == 503
