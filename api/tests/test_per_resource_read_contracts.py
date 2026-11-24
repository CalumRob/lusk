"""Read contracts use the resource registry, never a sibling's global clock."""

from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from api.aedar_reads import _aedar_aggregate_publication_marker
from api.cohort_reads import _scalar_contract
from api.observed_collections import collection_marker
from api.publication_outcomes import PublicationUnavailable


class Cursor:
    def __init__(self, row=None, rows=()):
        self.row = row
        self.rows = list(rows)

    def fetchone(self):
        return self.row

    def fetchall(self):
        return self.rows if self.rows else ([] if self.row is None else [self.row])


class ScalarConnection:
    def __init__(self, registry=True):
        self.registry = registry
        self.statements = []

    def execute(self, sql, params=None):
        self.statements.append(sql)
        if "FROM resource_publication" in sql:
            return Cursor(row=("resource_a", "scalar", "a-v1", "ref-v1") if self.registry else None)
        if "FROM scalar_descriptor" in sql:
            return Cursor(row=("resource_a", "theme", "A", "count", "high", "resource_a",
                               ["commune"], "count", "sparse", "a-descriptor-v1"))
        if "table_name='territory_reference'" in sql:
            return Cursor(row=("ref-v1",))
        raise AssertionError(sql)


def test_scalar_contract_uses_requested_resource_version_and_reference():
    conn = ScalarConnection()
    cohort = SimpleNamespace(reference_content_version="ref-v1")

    descriptor, marker = _scalar_contract(conn, "resource_a", "commune", cohort)

    assert descriptor[0] == "resource_a"
    assert marker[:2] == ("a-v1", "ref-v1")
    assert not any("scalar_observation" in sql and "table_publication" in sql
                   for sql in conn.statements)


def test_scalar_without_registry_row_fails_closed_even_with_a_global_marker():
    conn = ScalarConnection(registry=False)
    cohort = SimpleNamespace(reference_content_version="ref-v1")

    with pytest.raises(PublicationUnavailable) as raised:
        _scalar_contract(conn, "resource_a", "commune", cohort)

    assert raised.value.status_code == 503
    assert raised.value.detail == "Resource publication is unavailable"


class CollectionConnection:
    def __init__(self):
        self.statements = []

    def execute(self, sql, params=None):
        self.statements.append(sql)
        if "FROM resource_publication" in sql:
            return Cursor(row=("resource_a", "observed_collection", "collection-v1", "ref-v1"))
        if "FROM observed_collection_publication" in sql:
            return Cursor(row=("collection-v1", "ref-v1", "ref-v1"))
        raise AssertionError(sql)


def test_collection_keeps_storage_marker_and_adds_live_registry_gate():
    conn = CollectionConnection()
    descriptor = {"indicator_id": "resource_a", "kind": "period_detail"}

    marker = collection_marker(conn, descriptor)

    assert marker == {"content_version": "collection-v1", "reference_content_version": "ref-v1"}
    assert any("FROM resource_publication" in sql for sql in conn.statements)
    assert any("FROM observed_collection_publication" in sql for sql in conn.statements)


class AedarConnection:
    def __init__(self):
        self.statements = []

    def execute(self, sql, params=None):
        self.statements.append(sql)
        if "FROM resource_publication" in sql:
            return Cursor(row=("aedar", "aedar", "aedar-v1", "ref-v1"))
        if "SELECT content_version" in sql and "territory_reference" in sql:
            return Cursor(row=("ref-v1", 1))
        if "FROM table_publication p" in sql and "aedar_territorial_aggregate" in sql:
            return Cursor(row=("aedar-storage-v1", 10, "ref-v1", "ref-v1"))
        raise AssertionError(sql)


def test_aedar_keeps_storage_marker_and_adds_live_registry_gate():
    conn = AedarConnection()

    marker = _aedar_aggregate_publication_marker(conn)

    assert marker[:2] == ("aedar-storage-v1", 10)
    assert any("FROM resource_publication" in sql for sql in conn.statements)


def test_aedar_registry_identity_comes_from_the_producer_contract(monkeypatch):
    from types import SimpleNamespace
    from api import aedar_reads

    class ContractConnection(AedarConnection):
        def execute(self, sql, params=None):
            if "FROM resource_publication" in sql:
                assert params == (["fixture_owner"],)
                self.statements.append(sql)
                return Cursor(row=("fixture_owner", "aedar", "aedar-v1", "ref-v1"))
            return super().execute(sql, params)

    grammar = SimpleNamespace(semantic_by_id={
        "aggregate_identity": {"kind": "aedar_source_grain",
                               "publication_resource_id": "fixture_owner"},
        "summary_identity": {"kind": "aedar_territory_summary",
                             "publication_resource_id": "fixture_owner"},
    })
    monkeypatch.setattr(aedar_reads, "default_resource_grammar", lambda: grammar)

    assert _aedar_aggregate_publication_marker(ContractConnection())[:2] == (
        "aedar-storage-v1", 10)
