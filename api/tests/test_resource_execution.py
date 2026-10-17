from contextlib import contextmanager

from fastapi.testclient import TestClient

from api import main
from api.resource_catalogue import default_resource_catalogue


class Connection:
    def __init__(self):
        self.statements = []
        self.transaction_count = 0

    @contextmanager
    def transaction(self):
        self.transaction_count += 1
        yield

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


def setup(monkeypatch, repository, reader, preflight):
    main.app.dependency_overrides[main.get_repository] = lambda: repository
    main.app.dependency_overrides[main.get_resource_catalogue] = default_resource_catalogue
    main.app.dependency_overrides[main.get_semantic_resource_reader] = lambda: type(
        "FakeSemanticResourceReader", (), {"read": staticmethod(reader),
                                           "preflight": staticmethod(preflight)})()


def test_single_and_one_item_batch_share_typed_reader_and_result(monkeypatch):
    repository = Repository()
    calls = []

    def reader(conn, item, catalogue=None):
        calls.append(("read", conn, item.resource))
        return {"resource": item.resource, "value": 0, "status": "measured"}

    def preflight(conn, item, catalogue=None):
        calls.append(("preflight", conn, item.resource))
        return 1

    setup(monkeypatch, repository, reader, preflight)
    request = {
        "resource": "densite",
        "target": {"kind": "territory", "type": "commune", "id": "22001"},
        "fields": ["value"], "intent": {"kind": "facts"},
    }
    try:
        client = TestClient(main.app)
        single = client.post("/api/resources/read", json=request)
        batch = client.post("/api/resources/read-batch", json={"items": [{"id": "density", **request}]})
    finally:
        main.app.dependency_overrides.clear()

    assert single.status_code == batch.status_code == 200
    assert batch.json()["results"][0]["data"] == single.json()
    assert [kind for kind, _, _ in calls] == ["preflight", "read", "preflight", "read"]
    assert calls[0][1] is calls[1][1]
    assert calls[2][1] is calls[3][1]
    assert repository.connections.opens == 2
    assert repository.connections.value.transaction_count == 2
    assert all("REPEATABLE READ, READ ONLY" in sql for sql in repository.connections.value.statements)


def test_batch_preflights_every_item_before_reading_and_aborts_as_a_unit(monkeypatch):
    repository = Repository()
    calls = []

    def reader(conn, item, catalogue=None):
        calls.append(("read", item.resource))
        return {"resource": item.resource}

    def preflight(conn, item, catalogue=None):
        calls.append(("preflight", item.resource))
        if item.resource == "structure_age":
            from fastapi import HTTPException
            raise HTTPException(503, "stale descriptor")
        return 1

    setup(monkeypatch, repository, reader, preflight)
    common = {"target": {"kind": "territory", "type": "commune", "id": "22001"},
              "intent": {"kind": "facts"}}
    try:
        response = TestClient(main.app).post("/api/resources/read-batch", json={"items": [
            {"id": "a", "resource": "densite", **common},
            {"id": "b", "resource": "structure_age", **common},
        ]})
    finally:
        main.app.dependency_overrides.clear()

    assert response.status_code == 503
    assert "results" not in response.json()
    assert calls == [("preflight", "densite"), ("preflight", "structure_age")]
    assert repository.connections.opens == 1
    assert repository.connections.value.transaction_count == 1


def test_batch_rejects_aggregate_actual_work_before_any_item_read(monkeypatch):
    repository = Repository()
    calls = []

    def reader(conn, item, catalogue=None):
        calls.append(("read", item.resource))
        return {"resource": item.resource}

    def preflight(conn, item, catalogue=None):
        calls.append(("preflight", item.resource))
        # Each resolved item is below the global work cap; only their aggregate exceeds it.
        return 70_001

    setup(monkeypatch, repository, reader, preflight)
    target = {"kind": "territory", "type": "commune", "id": "22001"}
    try:
        response = TestClient(main.app).post("/api/resources/read-batch", json={"items": [
            {"id": str(index), "resource": "densite", "target": target,
             "intent": {"kind": "facts"}} for index in range(3)
        ]})
    finally:
        main.app.dependency_overrides.clear()

    assert response.status_code == 413
    assert calls == [("preflight", "densite")] * 3
    assert repository.connections.opens == 1
    assert repository.connections.value.transaction_count == 1


def test_sparse_membership_facts_read_and_comparison_intents_fail_before_storage(monkeypatch):
    repository = Repository()
    reads = []

    def reader(conn, item, catalogue=None):
        reads.append(item.resource)
        return {"resource": item.resource, "facts": []}

    def preflight(conn, item, catalogue=None):
        return 1

    setup(monkeypatch, repository, reader, preflight)
    target = {"kind": "territory", "type": "commune", "id": "22001"}
    facts = {"resource": "couverture_programmes", "target": target,
             "intent": {"kind": "facts"}}
    client = TestClient(main.app)
    try:
        accepted = client.post("/api/resources/read", json=facts)
        assert accepted.status_code == 200, accepted.text
        assert accepted.json()["facts"] == []
        assert reads == ["couverture_programmes"]

        for intent in (
            {"kind": "fixed_comparison", "context": "default"},
            {"kind": "selected_comparison", "members": [
                {"type": "commune", "id": "22002"},
            ]},
        ):
            invalid = client.post("/api/resources/read", json={**facts, "intent": intent})
            assert invalid.status_code == 422, invalid.text
            mixed_batch = client.post("/api/resources/read-batch", json={"items": [
                {"id": "valid-first", "resource": "densite", "target": target,
                 "intent": {"kind": "facts"}},
                {"id": "invalid-membership", **facts, "intent": intent},
            ]})
            assert mixed_batch.status_code == 422, mixed_batch.text
        assert reads == ["couverture_programmes"]
        assert repository.connections.opens == 1
    finally:
        main.app.dependency_overrides.clear()
