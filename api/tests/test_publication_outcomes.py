"""Typed publication outcomes for the shared semantic batch contract (issue #984).

The v2 batch contract is the only place an absent publication becomes a result
instead of a request failure. These tests pin the boundary: only the explicit
``PublicationUnavailable`` guard type is downgraded, everything else keeps the
v1 atomic failure semantics.
"""

from contextlib import contextmanager
from dataclasses import replace
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from api import main
from api.publication_outcomes import (PublicationUnavailable, family_for_resource,
                                      publication_unavailable)
from api.resource_catalogue import default_resource_catalogue
from api.resource_requests import ResourceReadItem


COMMON = {"target": {"kind": "territory", "type": "commune", "id": "22001"},
          "intent": {"kind": "facts"}}


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


def install(monkeypatch, repository, reader, preflight, admit=None, catalogue=None):
    def read_with_state(conn, item, catalogue=None, *, snapshot_state=None):
        return reader(conn, item, catalogue)

    def preflight_with_state(conn, item, catalogue=None, *, work_budget=None, snapshot_state=None):
        return preflight(conn, item, catalogue, work_budget=work_budget)

    injected = type("InjectedReader", (), {"read": staticmethod(read_with_state),
                                           "preflight": staticmethod(preflight_with_state)})()
    if admit is not None:
        injected.admit = staticmethod(admit)
    main.app.dependency_overrides[main.get_repository] = lambda: repository
    main.app.dependency_overrides[main.get_resource_catalogue] = (
        lambda: catalogue if catalogue is not None else default_resource_catalogue())
    main.app.dependency_overrides[main.get_semantic_resource_reader] = lambda: injected


def post(items, *, contract=None):
    payload = {"items": items}
    if contract is not None:
        payload["contract"] = contract
    return TestClient(main.app).post("/api/resources/read-batch", json=payload)


def item(item_id, resource, **extra):
    return {"id": item_id, "resource": resource, **COMMON, **extra}


def test_v2_mixed_batch_returns_one_correlated_outcome_per_item(monkeypatch):
    repository = Repository()
    unavailable_resource = "structure_age"

    def preflight(conn, resource_item, catalogue=None, *, work_budget=None):
        if resource_item.resource == unavailable_resource:
            publication_unavailable("profile", "Declared profile publication is absent")
        return 2

    def read(conn, resource_item, catalogue=None):
        return {"value": 12.5, "status": "measured"}

    install(monkeypatch, repository, read, preflight)
    try:
        response = post([item("density", "densite"),
                         item("age", unavailable_resource),
                         item("density-2", "densite", fields=["value"])],
                        contract="semantic-read-batch-v2")
    finally:
        main.app.dependency_overrides.clear()

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["contract"] == "semantic-read-batch-v2"
    assert [result["id"] for result in payload["results"]] == ["density", "age", "density-2"]
    assert payload["results"][0] == {"id": "density", "resource": "densite",
                                     "status": "available",
                                     "data": {"value": 12.5, "status": "measured"}}
    assert payload["results"][1] == {
        "id": "age", "resource": "structure_age",
        "status": "publication_unavailable",
        "reason": "publication_absent", "family": "profile"}
    assert "data" not in payload["results"][1]
    assert payload["results"][2]["data"] == {"value": 12.5, "status": "measured"}


def test_v2_all_unavailable_is_a_valid_envelope(monkeypatch):
    repository = Repository()
    install(monkeypatch, repository, lambda *_: pytest.fail("unavailable items are not read"),
            lambda *_, **__: publication_unavailable("ordered_series", "No active route"))
    try:
        response = post([item("a", "prix_m2"), item("b", "prix_m2")],
                        contract="semantic-read-batch-v2")
    finally:
        main.app.dependency_overrides.clear()

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["contract"] == "semantic-read-batch-v2"
    assert [(result["id"], result["status"], result["family"]) for result in payload["results"]] == [
        ("a", "publication_unavailable", "ordered_series"),
        ("b", "publication_unavailable", "ordered_series")]
    assert repository.connections.value.transactions == 1


def test_v2_preflights_every_item_before_reading_any_of_them(monkeypatch):
    repository = Repository()
    events = []

    def preflight(conn, resource_item, catalogue=None, *, work_budget=None):
        events.append(("preflight", resource_item.id))
        if resource_item.id == "b":
            publication_unavailable("scalar", "Scalar publication is absent")
        return 1

    def read(conn, resource_item, catalogue=None):
        events.append(("read", resource_item.id))
        return {"value": 1}

    install(monkeypatch, repository, read, preflight)
    try:
        response = post([item("a", "densite"), item("b", "densite"),
                         item("c", "densite")], contract="semantic-read-batch-v2")
    finally:
        main.app.dependency_overrides.clear()

    assert response.status_code == 200, response.text
    assert events == [("preflight", "a"), ("preflight", "b"), ("preflight", "c"),
                      ("read", "a"), ("read", "c")]


def test_v2_does_not_downgrade_an_untyped_503_by_message(monkeypatch):
    repository = Repository()
    install(monkeypatch, repository, lambda *_: {},
            lambda *_, **__: (_ for _ in ()).throw(
                HTTPException(503, "publication absent but unclassified")))
    try:
        response = post([item("a", "densite")], contract="semantic-read-batch-v2")
    finally:
        main.app.dependency_overrides.clear()

    assert response.status_code == 503
    assert response.json() == {"detail": "publication absent but unclassified"}


def test_v2_hard_request_failures_reject_the_whole_request(monkeypatch):
    repository = Repository()

    def preflight(conn, resource_item, catalogue=None, *, work_budget=None):
        if resource_item.id == "missing-member":
            raise HTTPException(404, "Selected comparison territory not found")
        return 1

    install(monkeypatch, repository, lambda *_: {"value": 1}, preflight)
    try:
        response = post([item("ok", "densite"), item("missing-member", "densite")],
                        contract="semantic-read-batch-v2")
    finally:
        main.app.dependency_overrides.clear()

    assert response.status_code == 404
    assert response.json() == {"detail": "Selected comparison territory not found"}
    assert "results" not in response.json()


def test_v2_read_time_unavailable_is_correlated_and_never_partial_data(monkeypatch):
    repository = Repository()

    def read(conn, resource_item, catalogue=None):
        if resource_item.id == "late":
            publication_unavailable("named_reference", "Named reference publication is absent")
        return {"value": 7}

    install(monkeypatch, repository, read, lambda *_, **__: 1)
    try:
        response = post([item("first", "densite"),
                         {"id": "late", "resource": "raccordement_reference",
                          "target": {"kind": "named_reference", "id": "bretagne_all_assessed_communes_mean"},
                          "intent": {"kind": "facts"}}],
                        contract="semantic-read-batch-v2")
    finally:
        main.app.dependency_overrides.clear()

    assert response.status_code == 200, response.text
    payload = response.json()
    assert [result["status"] for result in payload["results"]] == [
        "available", "publication_unavailable"]
    assert payload["results"][1]["family"] == "named_reference"


def test_v1_remains_atomic_for_the_same_typed_guard(monkeypatch):
    repository = Repository()
    install(monkeypatch, repository, lambda *_: {},
            lambda *_, **__: publication_unavailable("scalar", "Scalar publication is absent"))
    try:
        response = post([item("a", "densite")])
    finally:
        main.app.dependency_overrides.clear()

    assert response.status_code == 503
    assert response.json() == {"detail": "Scalar publication is absent"}
    assert "results" not in response.json()


def test_unknown_outcome_contract_is_rejected_before_a_connection(monkeypatch):
    repository = Repository()
    install(monkeypatch, repository, lambda *_: {}, lambda *_, **__: 1)
    try:
        response = post([item("a", "densite")], contract="semantic-read-batch-v3")
    finally:
        main.app.dependency_overrides.clear()

    assert response.status_code == 422
    assert repository.connections.opens == 0


def test_v2_still_enforces_the_work_and_byte_bounds(monkeypatch):
    repository = Repository()
    install(monkeypatch, repository, lambda *_: {"blob": "x" * (8 * 1024 * 1024)},
            lambda *_, **__: 1)
    try:
        oversized = post([item("a", "densite")], contract="semantic-read-batch-v2")
    finally:
        main.app.dependency_overrides.clear()
    assert oversized.status_code == 413

    repository = Repository()
    install(monkeypatch, repository, lambda *_: {}, lambda *_, **__: 200_001)
    try:
        overwork = post([item("a", "densite"), item("b", "densite")],
                        contract="semantic-read-batch-v2")
    finally:
        main.app.dependency_overrides.clear()
    assert overwork.status_code == 413


def test_publication_unavailable_rejects_unknown_families():
    with pytest.raises(ValueError):
        PublicationUnavailable("not_a_family", "detail")
    with pytest.raises(ValueError):
        publication_unavailable("not_a_family", "detail")


def test_family_is_derived_from_the_producer_declaration_not_the_lookup():
    catalogue = default_resource_catalogue()
    expected = {
        "densite": "scalar",
        "bornes_recharge_1000": "scalar",
        "structure_age": "profile",
        "prix_m2": "ordered_series",
        "raccordement_reference": "named_reference",
        "demographie_selected_reading": "typed_reading",
        "subventions_par_domaine": "collection",
        "aedar_territorial_aggregate": "aedar",
        "aedar_territory_summary": "aedar",
    }
    assert {resource_id: family_for_resource(catalogue.resources_by_id[resource_id])
            for resource_id in expected} == expected


def test_v2_identity_admission_runs_before_any_item_preflight(monkeypatch):
    repository = Repository()
    events = []

    def admit(conn, items, catalogue=None, *, snapshot_state=None, work_budget=None):
        events.append(("admit", tuple(item.id for item in items)))
        return 0

    def preflight(conn, resource_item, catalogue=None, *, work_budget=None):
        events.append(("preflight", resource_item.id))
        return 1

    install(monkeypatch, repository, lambda *_: {"value": 1}, preflight, admit=admit)
    try:
        v2 = post([item("a", "densite"), item("b", "structure_age")],
                  contract="semantic-read-batch-v2")
    finally:
        main.app.dependency_overrides.clear()
    assert v2.status_code == 200, v2.text
    assert events == [("admit", ("a", "b")), ("preflight", "a"), ("preflight", "b")]

    events.clear()
    install(monkeypatch, repository, lambda *_: {"value": 1}, preflight, admit=admit)
    try:
        v1 = post([item("a", "densite")])
    finally:
        main.app.dependency_overrides.clear()
    assert v1.status_code == 200, v1.text
    assert events == [("preflight", "a")]


def test_v2_identity_admission_failure_has_no_publication_outcomes(monkeypatch):
    repository = Repository()
    events = []

    def admit(conn, items, catalogue=None, *, snapshot_state=None, work_budget=None):
        raise HTTPException(404, "Focal territory not found")

    def preflight(conn, resource_item, catalogue=None, *, work_budget=None):
        events.append(resource_item.id)
        return 1

    install(monkeypatch, repository, lambda *_: pytest.fail("no read"), preflight, admit=admit)
    try:
        response = post([item("healthy", "densite"),
                         item("unpublished", "bornes_recharge_1000"),
                         item("unknown", "structure_age",
                              target={"kind": "territory", "type": "commune", "id": "nope"})],
                        contract="semantic-read-batch-v2")
    finally:
        main.app.dependency_overrides.clear()
    assert response.status_code == 404
    assert response.json() == {"detail": "Focal territory not found"}
    assert "results" not in response.json()
    assert events == []


def test_v2_admission_rejects_a_missing_required_relation_as_schema_fatal():
    class MissingRelationConnection:
        def execute(self, sql, params=None):
            assert "to_regclass" in sql
            return type("Cursor", (), {"fetchone": lambda self: (None,)})()

    reader = main.get_semantic_resource_reader()
    with pytest.raises(HTTPException) as error:
        reader.admit(MissingRelationConnection(),
                     [ResourceReadItem.model_validate(
                         {"resource": "densite", **COMMON})],
                     default_resource_catalogue())
    assert error.value.status_code == 503
    assert error.value.detail == "Required publication storage relation is unavailable"


def test_v2_admission_budget_aggregates_distinct_cohorts_before_sql():
    catalogue = default_resource_catalogue()
    target = SimpleNamespace(kind="territory_cohort", type="commune",
                             department_id="29", epci_id=None)
    intent = SimpleNamespace(kind="facts", members=[])
    # 100,001 distinct filtered cohorts: per-item + per-filter admission costs
    # exceed 200,000 before any SQL is issued.
    items = [SimpleNamespace(resource="densite", target=SimpleNamespace(
                 kind="territory_cohort", type="commune", department_id="29",
                 epci_id=f"e{index}"), intent=intent)
             for index in range(100_001)]
    class NoSqlConnection:
        def execute(self, *args, **kwargs):
            pytest.fail("admission issued SQL before enforcing its work budget")
    reader = main.get_semantic_resource_reader()
    with pytest.raises(HTTPException) as error:
        reader.admit(NoSqlConnection(), items, catalogue, work_budget=200_000)
    assert error.value.status_code == 413
    assert error.value.detail == "Resource request exceeds the bounded work limit"


def test_v2_executor_charges_admission_to_the_same_work_budget(monkeypatch):
    repository = Repository()
    events = []

    def admit(conn, items, catalogue=None, *, snapshot_state=None, work_budget=None):
        events.append(("admit", work_budget))
        return 200_000

    def preflight(conn, resource_item, catalogue=None, *, work_budget=None):
        events.append(("preflight", work_budget))
        return 1

    install(monkeypatch, repository, lambda *_: {"value": 1}, preflight, admit=admit)
    try:
        response = post([item("a", "densite")], contract="semantic-read-batch-v2")
    finally:
        main.app.dependency_overrides.clear()
    assert response.status_code == 413
    assert events == [("admit", 200_000), ("preflight", 0)]


def test_v2_admission_receives_the_route_catalogue(monkeypatch):
    repository = Repository()
    seen = {}
    base = default_resource_catalogue()
    injected_resource = replace(base.resources_by_id["densite"],
                                resource_id="injected_scalar")
    injected = replace(base, resources=(*base.resources, injected_resource))

    def admit(conn, items, catalogue=None, *, snapshot_state=None, work_budget=None):
        seen["catalogue"] = catalogue
        return 0

    install(monkeypatch, repository, lambda *_: {"value": 1},
            lambda *_, **__: 1, admit=admit, catalogue=injected)
    try:
        response = post([{"id": "a", "resource": "injected_scalar", **COMMON}],
                        contract="semantic-read-batch-v2")
    finally:
        main.app.dependency_overrides.clear()
    assert response.status_code == 200, response.text
    assert seen["catalogue"] is injected
    assert response.json()["results"][0]["resource"] == "injected_scalar"


def test_real_admission_uses_the_injected_catalogue_without_private_metadata():
    base = default_resource_catalogue()
    injected_resource = replace(base.resources_by_id["densite"],
                                resource_id="injected_scalar")
    injected = replace(base, resources=(*base.resources, injected_resource))

    class Cursor:
        def __init__(self, rows):
            self.rows = rows
        def fetchone(self):
            return self.rows[0] if self.rows else None
        def fetchall(self):
            return self.rows

    class Connection:
        def execute(self, sql, params=None):
            if "to_regclass" in sql:
                return Cursor([(True,)])
            if "table_name='territory_reference'" in sql:
                return Cursor([("ref-v1", 1)])
            if "territory_id=ANY" in sql:
                return Cursor([("c1", "commune")])
            raise AssertionError(sql)

    reader = main.get_semantic_resource_reader()
    injected_item = ResourceReadItem.model_validate({
        "resource": "injected_scalar",
        "target": {"kind": "territory", "type": "commune", "id": "c1"},
        "intent": {"kind": "facts"}})
    assert reader.admit(Connection(), [injected_item], injected, work_budget=1000) > 0

    without = replace(base, resources=tuple(
        resource for resource in base.resources if resource.resource_id != "densite"))
    default_only_item = ResourceReadItem.model_validate({
        "resource": "densite",
        "target": {"kind": "territory", "type": "commune", "id": "c1"},
        "intent": {"kind": "facts"}})
    with pytest.raises(HTTPException) as error:
        reader.admit(Connection(), [default_only_item], without, work_budget=1000)
    assert error.value.status_code == 422
    assert error.value.detail == "unknown semantic resource"


def test_v2_admission_cost_aggregates_before_preflight_remaining_budget():
    class Cursor:
        def __init__(self, rows):
            self.rows = rows
        def fetchone(self):
            return self.rows[0] if self.rows else None
        def fetchall(self):
            return self.rows

    class Connection:
        def execute(self, sql, params=None):
            if "to_regclass" in sql:
                return Cursor([(True,)])
            if "table_name='territory_reference'" in sql:
                return Cursor([("ref-v1", 1)])
            if "territory_type='departement'" in sql or "territory_type='epci'" in sql:
                return Cursor([(1,)])
            raise AssertionError(sql)

    target = lambda department: SimpleNamespace(
        kind="territory_cohort", type="commune", department_id=department, epci_id=None)
    intent = SimpleNamespace(kind="facts", members=[])
    items = [SimpleNamespace(resource="densite", target=target("29"), intent=intent),
             SimpleNamespace(resource="densite", target=target("22"), intent=intent)]
    reader = main.get_semantic_resource_reader()
    cost = reader.admit(Connection(), items, default_resource_catalogue(), work_budget=1000)
    # 2 items + 1 relation group + 1 reference marker + 2 distinct filters.
    assert cost == 6


def test_v2_same_cohort_is_resolved_once_within_the_request(monkeypatch):
    import api.semantic_resource_reader as module

    calls = []
    sentinel = object()

    def fake_resolve(conn, target, *, work_budget):
        calls.append((target.type, target.department_id, target.epci_id))
        return sentinel

    monkeypatch.setattr(module, "resolve_territory_cohort", fake_resolve)
    reader = main.get_semantic_resource_reader()
    state = {"v2_admission": True}
    target = SimpleNamespace(type="commune", department_id="29", epci_id=None)
    assert reader._cohort_for_request(None, target, 1000, state) is sentinel
    assert reader._cohort_for_request(None, target, 1000, state) is sentinel
    assert len(calls) == 1
    other = SimpleNamespace(type="commune", department_id="22", epci_id=None)
    assert reader._cohort_for_request(None, other, 1000, state) is sentinel
    assert len(calls) == 2


def test_family_mapping_is_central_for_a_declared_multi_shape_resource():
    resource = SimpleNamespace(resource_kind="indicator",
                               shapes=("named_reference", "ordered_series"))
    assert family_for_resource(resource) == "ordered_series"
    assert main.get_semantic_resource_reader()._publication_family(resource) == "ordered_series"


def test_v1_missing_dual_series_facet_keeps_the_base_detail(monkeypatch):
    reader = main.get_semantic_resource_reader()
    monkeypatch.setattr(reader, "_owned_series_route",
                        lambda *args, **kwargs: None)
    resource = default_resource_catalogue().resources_by_id["prix_m2"]
    with pytest.raises(PublicationUnavailable) as error:
        reader._require_dual_series_route(None, resource)
    assert error.value.detail == \
        "Declared ordered-series facet publication is unavailable or incompatible"
    assert error.value.family == "ordered_series"
