from contextlib import contextmanager

from fastapi.testclient import TestClient

from api import main


class BatchConnection:
    def __init__(self):
        self.set_statements = []
        self.transactions = 0

    @contextmanager
    def transaction(self):
        self.transactions += 1
        yield

    def execute(self, sql, params=None):
        self.set_statements.append(sql)


class BatchPool:
    def __init__(self):
        self.connection_value = BatchConnection()
        self.connections = 0

    @contextmanager
    def connection(self):
        self.connections += 1
        yield self.connection_value


class BatchRepository:
    def __init__(self):
        self.connections = BatchPool()


def test_batch_reuses_one_snapshot_for_different_typed_resources(monkeypatch):
    repository = BatchRepository()
    main.app.dependency_overrides[main.get_repository] = lambda: repository
    calls = []
    monkeypatch.setattr(main, "_theme_facts_snapshot", lambda conn, *args, **kwargs: (
        calls.append(("facts", conn, args, kwargs)) or {"theme_id": args[2], "facts": []}))
    monkeypatch.setattr(main, "_theme_comparison_snapshot", lambda conn, *args, **kwargs: (
        calls.append(("comparison", conn, args, kwargs)) or {"theme_id": args[2], "results": []}))
    try:
        response = TestClient(main.app).post("/api/read-batch", json={"items": [
            {"id": "a", "resource": "theme_facts", "territory_type": "commune",
             "territory_id": "22001", "theme_id": "habitat", "fields": ["value"]},
            {"id": "b", "resource": "theme_comparison", "territory_type": "commune",
             "territory_id": "22001", "theme_id": "mobilite", "selection": []},
        ]})
    finally:
        main.app.dependency_overrides.clear()
    assert response.status_code == 200
    assert [item["id"] for item in response.json()["results"]] == ["a", "b"]
    assert repository.connections.connections == 1
    assert repository.connections.connection_value.transactions == 1
    assert "REPEATABLE READ, READ ONLY" in repository.connections.connection_value.set_statements[0]
    assert calls[0][1] is calls[1][1]


def test_batch_rejects_duplicate_ids_before_connecting():
    repository = BatchRepository()
    main.app.dependency_overrides[main.get_repository] = lambda: repository
    try:
        response = TestClient(main.app).post("/api/read-batch", json={"items": [
            {"id": "same", "resource": "theme_facts", "territory_type": "commune",
             "territory_id": "22001", "theme_id": "habitat"},
            {"id": "same", "resource": "theme_facts", "territory_type": "commune",
             "territory_id": "22001", "theme_id": "habitat"},
        ]})
    finally:
        main.app.dependency_overrides.clear()
    assert response.status_code == 422
    assert repository.connections.connections == 0


def test_batch_allows_repeated_resource_with_distinct_parameters(monkeypatch):
    repository = BatchRepository()
    main.app.dependency_overrides[main.get_repository] = lambda: repository
    calls = []
    monkeypatch.setattr(main, "_theme_facts_snapshot", lambda conn, *args, **kwargs: (
        calls.append(args[2]) or {"theme_id": args[2]}))
    try:
        response = TestClient(main.app).post("/api/read-batch", json={"items": [
            {"id": "one", "resource": "theme_facts", "territory_type": "commune",
             "territory_id": "22001", "theme_id": "habitat"},
            {"id": "two", "resource": "theme_facts", "territory_type": "commune",
             "territory_id": "22001", "theme_id": "mobilite"},
        ]})
    finally:
        main.app.dependency_overrides.clear()
    assert response.status_code == 200
    assert calls == ["habitat", "mobilite"]


def test_batch_rolls_back_envelope_when_last_reader_fails(monkeypatch):
    repository = BatchRepository()
    main.app.dependency_overrides[main.get_repository] = lambda: repository
    calls = []

    def reader(conn, *args, **kwargs):
        calls.append(args[2])
        if args[2] == "mobilite":
            from fastapi import HTTPException
            raise HTTPException(503, "unavailable")
        return {"theme_id": args[2]}

    monkeypatch.setattr(main, "_theme_facts_snapshot", reader)
    try:
        response = TestClient(main.app).post("/api/read-batch", json={"items": [
            {"id": "first", "resource": "theme_facts", "territory_type": "commune",
             "territory_id": "22001", "theme_id": "habitat"},
            {"id": "last", "resource": "theme_facts", "territory_type": "commune",
             "territory_id": "22001", "theme_id": "mobilite"},
        ]})
    finally:
        main.app.dependency_overrides.clear()
    assert response.status_code == 503
    assert "results" not in response.json()
    assert calls == ["habitat", "mobilite"]
