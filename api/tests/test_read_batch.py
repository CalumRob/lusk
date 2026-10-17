"""The retained batch API uses the same typed semantic request as single reads."""

from contextlib import contextmanager

from fastapi import HTTPException
from fastapi.testclient import TestClient

from api import main
from api.resource_catalogue import default_resource_catalogue


class Connection:
    def __init__(self):
        self.statements = []
        self.transactions = 0

    @contextmanager
    def transaction(self):
        self.transactions += 1
        yield self

    def execute(self, sql, params=None):
        self.statements.append(sql)


class Pool:
    def __init__(self):
        self.value = Connection()
        self.opens = 0

    @contextmanager
    def connection(self):
        self.opens += 1
        yield self.value


class Repository:
    def __init__(self):
        self.connections = Pool()


def install(monkeypatch, repository, reader, preflight):
    main.app.dependency_overrides[main.get_repository] = lambda: repository
    main.app.dependency_overrides[main.get_resource_catalogue] = default_resource_catalogue
    main.app.dependency_overrides[main.get_semantic_resource_reader] = lambda: type(
        "InjectedReader", (), {"read": staticmethod(reader), "preflight": staticmethod(preflight)})()


def test_legacy_batch_url_is_retired_and_semantic_batch_route_is_registered():
    paths = set(main.app.openapi()["paths"])
    assert "/api/read-batch" not in paths
    assert "/api/resources/read-batch" in paths


def test_duplicate_batch_ids_are_rejected_before_opening_a_snapshot(monkeypatch):
    repository = Repository()
    install(monkeypatch, repository, lambda *_: {}, lambda *_: 1)
    request_item = {"resource": "densite",
        "target": {"kind": "territory", "type": "commune", "id": "22001"},
        "intent": {"kind": "facts"}}
    try:
        response = TestClient(main.app).post("/api/resources/read-batch", json={"items": [
            {"id": "duplicate", **request_item}, {"id": "duplicate", **request_item}]})
    finally:
        main.app.dependency_overrides.clear()
    assert response.status_code == 422
    assert repository.connections.opens == 0


def test_batch_uses_one_connection_snapshot_and_preflights_all_before_reads(monkeypatch):
    repository = Repository()
    events = []
    def preflight(conn, item, catalogue=None, *, work_budget=None):
        events.append(("preflight", item.id, conn))
        return 1
    def read(conn, item, catalogue=None):
        events.append(("read", item.id, conn))
        return {"value": 0 if item.resource == "densite" else None, "status": "measured"}
    install(monkeypatch, repository, read, preflight)
    common = {"target": {"kind": "territory", "type": "commune", "id": "22001"},
              "intent": {"kind": "facts"}}
    try:
        response = TestClient(main.app).post("/api/resources/read-batch", json={"items": [
            {"id": "density", "resource": "densite", **common},
            {"id": "age", "resource": "structure_age", **common},
        ]})
    finally:
        main.app.dependency_overrides.clear()
    assert response.status_code == 200, response.text
    assert [event[0:2] for event in events] == [
        ("preflight", "density"), ("preflight", "age"), ("read", "density"), ("read", "age")]
    assert len({id(event[2]) for event in events}) == 1
    assert repository.connections.opens == repository.connections.value.transactions == 1
    assert "REPEATABLE READ, READ ONLY" in repository.connections.value.statements[0]
    assert [entry["id"] for entry in response.json()["results"]] == ["density", "age"]


def test_batch_failure_returns_no_partial_envelope_and_rolls_back(monkeypatch):
    repository = Repository()
    reads = []
    def preflight(*_args, **_kwargs): return 1
    def read(_conn, item, catalogue=None):
        reads.append(item.id)
        if item.id == "last":
            raise HTTPException(503, "publication became unavailable")
        return {"value": 3}
    install(monkeypatch, repository, read, preflight)
    common = {"target": {"kind": "territory", "type": "commune", "id": "22001"},
              "intent": {"kind": "facts"}}
    try:
        response = TestClient(main.app).post("/api/resources/read-batch", json={"items": [
            {"id": "first", "resource": "densite", **common},
            {"id": "last", "resource": "structure_age", **common},
        ]})
    finally:
        main.app.dependency_overrides.clear()
    assert response.status_code == 503
    assert response.json() == {"detail": "publication became unavailable"}
    assert "results" not in response.json()
    assert reads == ["first", "last"]
    assert repository.connections.opens == repository.connections.value.transactions == 1
