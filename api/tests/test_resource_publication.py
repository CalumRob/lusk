"""Per-resource publication is the live authority for every semantic read."""

import pytest
from fastapi import HTTPException

from api.publication_outcomes import PublicationUnavailable
from api.resource_publication import live_resource_publication, live_resource_publications


class Cursor:
    def __init__(self, rows=()):
        self.rows = list(rows)

    def fetchall(self):
        return self.rows


class Connection:
    def __init__(self, rows=()):
        self.rows = list(rows)
        self.statements = []

    def execute(self, sql, params=None):
        self.statements.append((sql, params))
        assert "FROM resource_publication" in sql
        assert "retired=false" in sql
        return Cursor(self.rows)


def test_live_registry_row_is_returned_without_a_global_marker():
    conn = Connection([("resource_a", "scalar", "a-v1", "ref-v1")])

    publication = live_resource_publication(conn, "resource_a", "scalar")

    assert publication.resource_id == "resource_a"
    assert publication.content_version == "a-v1"
    assert publication.reference_content_version == "ref-v1"
    assert conn.statements[0][1] == (["resource_a"],)


@pytest.mark.parametrize("rows", [(), (("resource_a", "scalar", "a-v1", "ref-v1"),)])
def test_missing_or_retired_registry_row_is_a_typed_publication_gap(rows):
    # The SQL predicate excludes retired rows, so both cases arrive here empty.
    with pytest.raises(PublicationUnavailable) as raised:
        live_resource_publication(Connection(rows[:0]), "resource_a", "scalar")

    assert raised.value.status_code == 503
    assert raised.value.family == "scalar"
    assert raised.value.detail == "Resource publication is unavailable"


def test_reference_mismatch_is_a_hard_stale_publication_error():
    conn = Connection([("resource_a", "scalar", "a-v1", "ref-v1")])

    with pytest.raises(HTTPException) as raised:
        live_resource_publications(conn, ["resource_a"], "scalar",
                                   reference_content_version="ref-v2")

    assert raised.value.status_code == 503
    assert raised.value.detail == "Resource publication is stale or incompatible"


def test_batch_lookup_uses_one_registry_query_for_all_requested_resources():
    conn = Connection([
        ("resource_a", "scalar", "a-v1", "ref-v1"),
        ("resource_b", "scalar", "b-v2", "ref-v1"),
    ])

    publications = live_resource_publications(conn, ["resource_b", "resource_a"], "scalar",
                                              reference_content_version="ref-v1")

    assert set(publications) == {"resource_a", "resource_b"}
    assert len(conn.statements) == 1
