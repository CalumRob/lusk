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
    monkeypatch.setattr(main, "_theme_comparison_contract_snapshot",
                        lambda *args, **kwargs: {"theme_id": "mobilite", "results": []})
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
    assert all(call[1] is repository.connections.connection_value for call in calls)


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


def test_batch_rejects_extra_resource_parameters_before_connecting():
    repository = BatchRepository()
    main.app.dependency_overrides[main.get_repository] = lambda: repository
    try:
        response = TestClient(main.app).post("/api/read-batch", json={"items": [
            {"id": "x", "resource": "theme_facts", "territory_type": "commune",
             "territory_id": "22001", "theme_id": "habitat", "selection": []},
        ]})
    finally:
        main.app.dependency_overrides.clear()
    assert response.status_code == 422
    assert repository.connections.connections == 0


def test_batch_rejects_extra_owned_dataset_parameters_and_invalid_fields_before_connecting():
    repository = BatchRepository()
    main.app.dependency_overrides[main.get_repository] = lambda: repository
    try:
        extra = TestClient(main.app).post("/api/read-batch", json={"items": [{
            "id": "owned", "resource": "owned_dataset", "dataset_id": "dataset_a",
            "territory_type": "commune", "territory_id": "22001",
            "indicator_id": "series_a", "sql": "not-a-query-language"}]})
        invalid = TestClient(main.app).post("/api/read-batch", json={"items": [{
            "id": "profile", "resource": "direct_profile", "territory_type": "commune",
            "territory_id": "22001", "indicator_id": "profile_a", "fields": ["median"]}]})
    finally:
        main.app.dependency_overrides.clear()
    assert extra.status_code == invalid.status_code == 422
    assert repository.connections.connections == 0


def test_batch_unknown_owned_dataset_is_404_during_metadata_preflight(monkeypatch):
    repository = BatchRepository()
    main.app.dependency_overrides[main.get_repository] = lambda: repository

    class EmptyResult:
        def fetchone(self):
            return None

    monkeypatch.setattr(repository.connections.connection_value, "execute",
                        lambda sql, params=None: EmptyResult())
    try:
        response = TestClient(main.app).post("/api/read-batch", json={"items": [{
            "id": "unknown", "resource": "owned_dataset", "dataset_id": "unknown_dataset",
            "territory_type": "commune", "territory_id": "22001", "indicator_id": "series_a"}]})
    finally:
        main.app.dependency_overrides.clear()
    assert response.status_code == 404
    assert repository.connections.connections == 1
    assert repository.connections.connection_value.transactions == 1


def test_batch_rejects_extra_nested_selection_keys_before_connecting():
    repository = BatchRepository()
    main.app.dependency_overrides[main.get_repository] = lambda: repository
    try:
        response = TestClient(main.app).post("/api/read-batch", json={"items": [
            {"id": "x", "resource": "theme_comparison", "territory_type": "commune",
             "territory_id": "22001", "theme_id": "mobilite", "selection": [
                 {"territory_type": "commune", "territory_id": "22002", "extra": "ignored?"}]},
        ]})
    finally:
        main.app.dependency_overrides.clear()
    assert response.status_code == 422
    assert repository.connections.connections == 0


def test_batch_preflights_late_resource_field_before_any_item_fact_read(monkeypatch):
    repository = BatchRepository()
    main.app.dependency_overrides[main.get_repository] = lambda: repository
    facts = []
    preflights = []

    def theme_reader(conn, territory_type, territory_id, theme_id, *args, **kwargs):
        if kwargs.get("preflight_only"):
            preflights.append(theme_id)
            if theme_id == "mobilite":
                from fastapi import HTTPException
                raise HTTPException(422, "unsupported declared field")
            return {"supported_fields": {"value", "status"}}
        facts.append(theme_id)
        return {"theme_id": theme_id}

    monkeypatch.setattr(main, "_theme_facts_snapshot", theme_reader)
    try:
        response = TestClient(main.app).post("/api/read-batch", json={"items": [
            {"id": "first", "resource": "theme_facts", "territory_type": "commune",
             "territory_id": "22001", "theme_id": "habitat", "fields": ["value"]},
            {"id": "last", "resource": "theme_facts", "territory_type": "commune",
             "territory_id": "22001", "theme_id": "mobilite", "fields": ["value"]},
        ]})
    finally:
        main.app.dependency_overrides.clear()
    assert response.status_code == 422
    assert preflights == ["habitat", "mobilite"]
    assert facts == []


def test_batch_composes_aedar_aggregate_and_fixed_comparison_on_same_connection(monkeypatch):
    repository = BatchRepository()
    main.app.dependency_overrides[main.get_repository] = lambda: repository
    calls = []

    def aggregate(conn, *args, **kwargs):
        calls.append(("aggregate", conn, kwargs.get("preflight_only")))
        return {"content_version": "aggregate-v1"} if kwargs.get("preflight_only") else {
            "contract": "aedar-aggregate-v1", "facts": []}

    def comparison(conn, *args, **kwargs):
        calls.append(("comparison", conn, kwargs.get("preflight_only")))
        return {"content_version": "comparison-v1"} if kwargs.get("preflight_only") else {
            "contract": "aedar-comparison-v1", "comparison": {"status": "measured"}}

    monkeypatch.setattr(main, "_aedar_territorial_aggregate_snapshot", aggregate)
    monkeypatch.setattr(main, "_aedar_comparison_snapshot", comparison)
    try:
        response = TestClient(main.app).post("/api/read-batch", json={"items": [
            {"id": "aggregate", "resource": "aedar_aggregate", "territory_type": "commune",
             "territory_id": "22001", "typequ": ["A104"], "limit": 10},
            {"id": "fixed", "resource": "aedar_comparison", "territory_type": "commune",
             "territory_id": "22001", "context": "epci", "typequ": "A104",
             "measure": "count_5_walk_mean", "fields": ["value"]},
        ]})
    finally:
        main.app.dependency_overrides.clear()
    assert response.status_code == 200
    assert [item["data"]["contract"] for item in response.json()["results"]] == [
        "aedar-aggregate-v1", "aedar-comparison-v1"]
    assert repository.connections.connections == 1
    assert repository.connections.connection_value.transactions == 1
    assert {call[1] for call in calls} == {repository.connections.connection_value}
    assert [bool(call[2]) for call in calls] == [True, True, False, False]


def test_batch_aggregate_rows_are_bounded_across_items_before_connecting():
    repository = BatchRepository()
    main.app.dependency_overrides[main.get_repository] = lambda: repository
    try:
        response = TestClient(main.app).post("/api/read-batch", json={"items": [
            {"id": f"a{i}", "resource": "aedar_aggregate", "territory_type": "commune",
             "territory_id": "22001", "limit": 100} for i in range(4)
        ]})
    finally:
        main.app.dependency_overrides.clear()
    assert response.status_code == 413
    assert repository.connections.connections == 0


def test_aedar_fixed_single_route_and_batch_share_the_same_connection_reader(monkeypatch):
    repository = BatchRepository()
    main.app.dependency_overrides[main.get_repository] = lambda: repository
    monkeypatch.setattr(main, "pool", lambda: repository.connections)
    calls = []

    def reader(conn, *args, **kwargs):
        calls.append((conn, kwargs.get("preflight_only")))
        if kwargs.get("preflight_only"):
            return {"content_version": "aedar-cmp-v1"}
        return {"territory": {"territory_type": "commune", "territory_id": "22001"},
                "content_version": "aedar-cmp-v1", "comparison": {"status": "measured"}}

    monkeypatch.setattr(main, "_aedar_comparison_snapshot", reader)
    try:
        single = TestClient(main.app).get(
            "/api/aedar/territories/commune/22001/comparisons?context=epci&typequ=A104&measure=count_5_walk_mean")
        batch = TestClient(main.app).post("/api/read-batch", json={"items": [
            {"id": "aedar", "resource": "aedar_comparison", "territory_type": "commune",
             "territory_id": "22001", "context": "epci", "typequ": "A104",
             "measure": "count_5_walk_mean"},
        ]})
    finally:
        main.app.dependency_overrides.clear()
    assert single.status_code == batch.status_code == 200
    assert batch.json()["results"][0]["data"] == single.json()
    assert repository.connections.connections == 2
    assert repository.connections.connection_value.transactions == 2
    assert len({call[0] for call in calls}) == 1


def test_named_indicator_focal_read_is_a_batch_resource_with_exact_reader_payload(monkeypatch):
    repository = BatchRepository()
    main.app.dependency_overrides[main.get_repository] = lambda: repository
    calls = []

    def reader(conn, territory_type, territory_id, indicator_id, fields=None, *, preflight_only=False):
        calls.append((conn, indicator_id, fields, preflight_only))
        return {"supported_fields": {"value", "status"}} if preflight_only else {
            "indicator_id": indicator_id, "value": None, "status": "suppressed",
            "sources": [{"source_id": "src", "vintage_id": "v1"}],
        }

    monkeypatch.setattr(main, "_indicator_facts_snapshot", reader, raising=False)
    try:
        response = TestClient(main.app).post("/api/read-batch", json={"items": [
            {"id": "named", "resource": "indicator_facts", "territory_type": "commune",
             "territory_id": "22001", "indicator_id": "my_scalar", "fields": ["status"]},
        ]})
    finally:
        main.app.dependency_overrides.clear()
    assert response.status_code == 200, response.text
    assert response.json()["results"][0]["data"]["status"] == "suppressed"
    assert calls[0][0] is calls[1][0]
    assert calls[0][3] is True and calls[1][3] is False


def test_named_indicator_comparison_batch_and_single_share_snapshot_reader(monkeypatch):
    repository = BatchRepository()
    main.app.dependency_overrides[main.get_repository] = lambda: repository
    calls = []

    def reader(conn, territory_type, territory_id, indicator_id, selection, fields):
        calls.append((conn, selection, fields))
        return {"contract": "indicator-comparison-v1", "indicator_id": indicator_id,
                "selection": None, "result": {"status": "unavailable", "median": None}}

    monkeypatch.setattr(main, "_indicator_comparison_preflight", lambda *args: None)
    monkeypatch.setattr(main, "_indicator_comparison_snapshot", reader)
    try:
        single = TestClient(main.app).post(
            "/api/territories/commune/22001/indicators/example/comparison", json={"selection": []})
        batch = TestClient(main.app).post("/api/read-batch", json={"items": [
            {"id": "cmp", "resource": "indicator_comparison", "territory_type": "commune",
             "territory_id": "22001", "indicator_id": "example", "selection": []},
        ]})
    finally:
        main.app.dependency_overrides.clear()
    assert single.status_code == batch.status_code == 200
    assert batch.json()["results"][0]["data"] == single.json()
    assert calls[0][0] is calls[1][0]
    assert repository.connections.connections == 2


def test_theme_comparison_route_and_batch_share_public_contract_reader(monkeypatch):
    repository = BatchRepository()
    main.app.dependency_overrides[main.get_repository] = lambda: repository
    seen = []

    def reader(conn, territory_type, territory_id, theme_id, selected, repository, fields):
        seen.append((conn, territory_type, territory_id, theme_id, selected, fields))
        return {"contract": "expected-public-shape", "results": []}

    monkeypatch.setattr(main, "_theme_comparison_contract_snapshot", reader, raising=False)
    monkeypatch.setattr(main, "_theme_comparison_snapshot", lambda *args, **kwargs: {
        "supported_fields": main._COMPARISON_RESULT_FIELDS | main._COMPARISON_MANDATORY_FIELDS
    } if kwargs.get("preflight_only") else {"unused": True})
    try:
        batch_response = TestClient(main.app).post("/api/read-batch", json={"items": [
            {"id": "cmp", "resource": "theme_comparison", "territory_type": "commune",
             "territory_id": "22001", "theme_id": "mobilite", "selection": []},
        ]})
        single_response = TestClient(main.app).post(
            "/api/territories/commune/22001/themes/mobilite/comparison",
            json={"theme_id": "mobilite", "selection": []})
    finally:
        main.app.dependency_overrides.clear()
    assert batch_response.status_code == 200
    assert single_response.status_code == 200
    assert batch_response.json()["results"][0]["data"] == single_response.json()
    assert seen[0][0] is seen[1][0]


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
    assert calls == ["habitat", "mobilite", "habitat", "mobilite"]


def test_batch_rolls_back_envelope_when_last_reader_fails(monkeypatch):
    repository = BatchRepository()
    main.app.dependency_overrides[main.get_repository] = lambda: repository
    calls = []

    def reader(conn, *args, **kwargs):
        calls.append(args[2])
        if args[2] == "mobilite" and not kwargs.get("preflight_only"):
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
    assert calls == ["habitat", "mobilite", "habitat", "mobilite"]


def test_profile_and_series_resources_share_batch_snapshot_and_readers(monkeypatch):
    repository = BatchRepository()
    main.app.dependency_overrides[main.get_repository] = lambda: repository
    preflight = []
    reads = []
    monkeypatch.setattr(main, "_declared_profile_snapshot", lambda conn, *args, **kwargs:
        preflight.append(("profile", conn, kwargs.get("preflight_only"))) or
        ({"supported_fields": {"value", "status"}, "work_units": 10}
         if kwargs.get("preflight_only") else {"profile": "exact"}))
    monkeypatch.setattr(main, "_preflight_series_batch_item", lambda conn, item, *, owned:
        preflight.append(("owned" if owned else "series", conn, True)) or 4)
    monkeypatch.setattr(main.ReadRepository, "read_series", lambda self, *args, **kwargs:
        reads.append(("series", kwargs["connection"])) or {"series": "exact"})
    monkeypatch.setattr(main.ReadRepository, "read_owned_series", lambda self, *args, **kwargs:
        reads.append(("owned", kwargs["connection"])) or {"owned": "exact"})
    repository.read_series = lambda *args, **kwargs: reads.append(
        ("series", kwargs["connection"])) or {"series": "exact"}
    repository.read_owned_series = lambda *args, **kwargs: reads.append(
        ("owned", kwargs["connection"])) or {"owned": "exact"}
    try:
        response = TestClient(main.app).post("/api/read-batch", json={"items": [
            {"id": "profile", "resource": "direct_profile", "territory_type": "commune",
             "territory_id": "22001", "indicator_id": "profile_x"},
            {"id": "series", "resource": "direct_series", "territory_type": "commune",
             "territory_id": "22001", "indicator_id": "series_x", "fields": ["status"]},
            {"id": "owned", "resource": "owned_dataset", "dataset_id": "dataset_x",
             "territory_type": "commune", "territory_id": "22001", "indicator_id": "owned_x",
             "comparison_detail": "annual"},
        ]})
    finally:
        main.app.dependency_overrides.clear()
    assert response.status_code == 200, response.text
    assert [entry["data"] for entry in response.json()["results"]] == [
        {"profile": "exact"}, {"series": "exact"}, {"owned": "exact"}]
    assert repository.connections.connections == 1
    assert repository.connections.connection_value.transactions == 1
    assert all(call[1] is repository.connections.connection_value for call in preflight + reads)
    assert [call[0] for call in reads] == ["series", "owned"]


def test_series_scope_work_limit_is_aggregate_and_precedes_fact_reads(monkeypatch):
    repository = BatchRepository()
    main.app.dependency_overrides[main.get_repository] = lambda: repository
    facts = []
    monkeypatch.setattr(main, "_preflight_series_batch_item", lambda *args, **kwargs: 100_001)
    repository.read_series = lambda *args, **kwargs: facts.append("series") or {}
    try:
        response = TestClient(main.app).post("/api/read-batch", json={"items": [
            {"id": f"s{i}", "resource": "direct_series", "territory_type": "commune",
             "territory_id": "22001", "indicator_id": "series_x"} for i in range(2)
        ]})
    finally:
        main.app.dependency_overrides.clear()
    assert response.status_code == 413
    assert facts == []
    assert repository.connections.connection_value.transactions == 1
