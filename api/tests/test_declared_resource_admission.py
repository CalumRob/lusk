"""A declared resource's absent publication is a service gap, not an unknown identity.

The semantic grammar admits only producer-declared resources, so the catalogue
membership is the boundary at which a missing descriptor/publication dependency
must fail closed with ``503`` instead of the retired direct-read ``404``. The
lookup helpers keep their legacy default for non-semantic callers; the semantic
reader opts into the declared-resource admission contract explicitly.
"""

import pytest
from fastapi import HTTPException

from api import snapshot_reads
from api.resource_catalogue import default_resource_catalogue
from api.resource_requests import ResourceReadItem
from api.semantic_resource_reader import SemanticResourceReader

# Producer-declared mobility scalars whose numeric publication is intentionally
# absent at the time of this contract (parent #952).
UNPUBLISHED_RESOURCES = ("bornes_recharge_1000", "stations_service", "stations_service_1000")


class Cursor:
    def __init__(self, row=None, rows=None):
        self.row = row
        self.rows = rows or []

    def fetchone(self):
        return self.row

    def fetchall(self):
        return self.rows


class UnpublishedConnection:
    """Publication storage with no descriptor table and no comparison rows."""

    def __init__(self):
        self.statements = []

    def execute(self, sql, params=None):
        self.statements.append(sql)
        if "to_regclass" in sql:
            return Cursor(row=(None,))
        if "FROM territory_reference" in sql:
            return Cursor(row=("commune",))
        raise AssertionError(sql)


def _fixed_item(resource_id, target_id="29001"):
    return ResourceReadItem(resource=resource_id,
        target={"kind": "territory", "type": "commune", "id": target_id},
        intent={"kind": "fixed_comparison", "context": "default"})


def _selected_item(resource_id, target_id="29001", members=("29001", "29002")):
    return ResourceReadItem(resource=resource_id,
        target={"kind": "territory", "type": "commune", "id": target_id},
        intent={"kind": "selected_comparison",
                "members": [{"type": "commune", "id": member} for member in members]})


@pytest.mark.parametrize("resource_id", UNPUBLISHED_RESOURCES)
@pytest.mark.parametrize("reader", [
    snapshot_reads._indicator_comparison_preflight,
    snapshot_reads._indicator_comparison_snapshot,
])
def test_declared_resource_without_publication_fails_closed(resource_id, reader):
    with pytest.raises(HTTPException) as raised:
        reader(UnpublishedConnection(), "commune", "29001", resource_id, None, None,
               require_declared_resource=True)
    assert raised.value.status_code == 503
    assert raised.value.detail == "Declared resource publication is unavailable"


@pytest.mark.parametrize("reader", [
    snapshot_reads._indicator_comparison_preflight,
    snapshot_reads._indicator_comparison_snapshot,
])
def test_undeclared_lookup_keeps_its_existing_unknown_identity_404(reader):
    with pytest.raises(HTTPException) as raised:
        reader(UnpublishedConnection(), "commune", "29001", "no_such_indicator", None, None)
    assert raised.value.status_code == 404
    assert raised.value.detail == "Indicator descriptor is unavailable"


class ReaderConnection:
    """Resolution queries the semantic reader performs before the snapshot adapter."""

    def execute(self, sql, params=None):
        if "FROM scalar_observation" in sql:
            return Cursor(row=(0,))
        if "territory_id=ANY" in sql:
            return Cursor(rows=[(territory_id, "commune") for territory_id in params[0]])
        if "FROM territory_reference" in sql:
            return Cursor(row=("commune",))
        raise AssertionError(sql)


def _comparison_reader(calls):
    def preflight(conn, territory_type, territory_id, indicator_id, selection, fields, **kwargs):
        calls.append(("preflight", indicator_id, kwargs))
        return {}

    def snapshot(conn, territory_type, territory_id, indicator_id, selection, fields, **kwargs):
        calls.append(("snapshot", indicator_id, kwargs))
        return {}

    return SemanticResourceReader(
        indicator_facts_snapshot=lambda *args, **kwargs: pytest.fail("facts adapter is not used"),
        indicator_comparison_preflight=preflight,
        indicator_comparison_snapshot=snapshot,
        owned_series_route=lambda conn, indicator_id: None,
        owned_named_reference_snapshot=lambda *args, **kwargs: pytest.fail(
            "named-reference adapter is not used"),
        comparison_field_selection=snapshot_reads._comparison_field_selection,
        max_owned_series_provenance_per_point=8,
    )


@pytest.mark.parametrize("item_factory,stage", [
    (_fixed_item, "preflight"), (_fixed_item, "snapshot"),
    (_selected_item, "preflight"), (_selected_item, "snapshot"),
])
def test_semantic_reader_admits_the_declared_resource_on_comparison_intents(item_factory, stage):
    calls = []
    reader = _comparison_reader(calls)
    item = item_factory(UNPUBLISHED_RESOURCES[0])
    connection = ReaderConnection()

    if stage == "preflight":
        reader.preflight(connection, item, default_resource_catalogue())
    else:
        reader.read(connection, item, default_resource_catalogue())

    assert len(calls) == 1, calls
    called_stage, indicator_id, kwargs = calls[0]
    assert (called_stage, indicator_id) == (stage, UNPUBLISHED_RESOURCES[0])
    assert kwargs["require_declared_resource"] is True
    assert kwargs["intent_kind"] == item.intent.kind
