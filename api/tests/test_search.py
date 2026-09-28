import json
from pathlib import Path

from fastapi import HTTPException
from fastapi.testclient import TestClient

import pytest

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
    assert {r["id"] for r in search_territory_rows(rows, "saint malo", 8)} == {"35001", "35002"}
    assert [r["id"] for r in search_territory_rows(rows, "MÉTRO", 8)] == ["2001"]
    assert [r["id"] for r in search_territory_rows(
        [{"type": "epci", "id": "1", "name": "CC de l’Oust à Brocéliande"}],
        "oust a broceliande", 8)] == ["1"]


def test_search_candidates_preserve_locale_ties_and_exact_code_is_separate():
    rows = [{"type": "commune", "id": "35002", "name": "Vannes"}]
    assert search_territory_rows(rows, "35002", 8) == []
    tied = [*rows, {"type": "commune", "id": "35003", "name": "Rennes"}]
    assert {r["id"] for r in search_territory_rows(tied, "n", 1)} == {"35002", "35003"}


def test_search_route_is_bounded_and_returns_reference_provenance():
    class Repository:
        def search_territories(self, query, limit):
            return {"publication_id": "territory-v1-ref-1", "query": query,
                    "limit": limit, "exact_code": None,
                    "candidates": [{"type": "commune", "id": "35001", "name": "Rennes"}]}

    app.dependency_overrides[get_repository] = Repository
    try:
        client = TestClient(app)
        response = client.get("/api/territories/search?q=rennes&limit=3")
        assert response.status_code == 200
        assert response.json()["publication_id"] == "territory-v1-ref-1"
        assert response.json()["candidates"][0]["name"] == "Rennes"
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
    result = ReadRepository(Connections(conn)).search_territories("rennes", 1)
    assert result["publication_id"] == "territory-v1-reference-v7"
    assert result["limit"] == 1
    assert [r["id"] for r in result["candidates"]] == ["A"]
    assert result["exact_code"] is None
    assert "REPEATABLE READ, READ ONLY" in conn.calls[0][0]
    assert "territory_id LIMIT %s" in conn.calls[2][0]
    assert conn.calls[2][1] == (1501,)

    with pytest.raises(HTTPException) as error:
        ReadRepository(Connections(Connection(missing_marker=True))).search_territories("rennes", 8)
    assert error.value.status_code == 503


def test_exact_code_is_separate_from_name_candidates():
    class Result:
        def __init__(self, rows): self.rows = rows
        def fetchone(self): return self.rows[0] if self.rows else None
        def fetchall(self): return self.rows

    class Connection:
        def transaction(self): return self
        def __enter__(self): return self
        def __exit__(self, *_): return False
        def execute(self, sql, params=None):
            if "SET TRANSACTION" in sql: return Result([])
            if "table_publication" in sql: return Result([("ref-v1",)])
            return Result([("commune", "35001", "Rennes"),
                           ("epci", "200000001", "Rennes Métropole")])

    class Connections:
        def connection(self): return Connection()

    repo = ReadRepository(Connections())
    exact = repo.search_territories(" 35001 ", 8)
    assert exact["exact_code"] == {"type": "commune", "id": "35001", "name": "Rennes"}
    assert exact["candidates"] == []
    textual = repo.search_territories("Rennes", 8)
    assert textual["exact_code"] is None
    assert [row["id"] for row in textual["candidates"]] == ["35001", "200000001"]


def test_all_published_static_names_are_retained_in_candidate_windows():
    source = Path(__file__).parents[2] / "public" / "data" / "territoires.json"
    public_rows = json.loads(source.read_text(encoding="utf-8"))
    reference = [{"id": row["territoire"], "type": row["type"], "name": row["nom"]}
                 for row in public_rows]
    assert len(reference) == 1268
    type_order = {"commune": 0, "epci": 1, "departement": 2, "region": 3}
    assert reference == sorted(reference, key=lambda row: (type_order[row["type"]], row["id"]))
    for row in reference:
        candidates = search_territory_rows(reference, row["name"], 8)
        assert any(candidate["id"] == row["id"] for candidate in candidates), row
        assert len(candidates) <= 1500
