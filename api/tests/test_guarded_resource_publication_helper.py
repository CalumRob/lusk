"""DB-free contract for the one guarded resource-publication seed writer."""

from __future__ import annotations

import pytest
from psycopg.types.json import Jsonb

from api.tests.integration.resource_publication_helper import publish_resource


class RecordingConnection:
    def __init__(self):
        self.calls = []

    def execute(self, sql, params=None):
        self.calls.append((sql, params))


@pytest.mark.parametrize("shape", [
    "scalar", "declared_profile", "owned_series", "observed_collection", "aedar",
])
def test_publish_resource_mirrors_the_r_registry_and_descriptor_writers(shape):
    connection = RecordingConnection()
    descriptor = {
        "kind": "indicator",
        "metadata": {
            "theme": "fixture",
            "label": "Bretagne",
            "missing": None,
            "values": [0.1, 2],
        },
    }

    result = publish_resource(
        connection,
        "fixture_resource",
        shape,
        "fixture-v1",
        reference_content_version="ref-v1",
        declarations={
            "fixture_resource": descriptor,
            "fixture_alias": {"kind": "indicator", "metadata": {"theme": "fixture"}},
        },
    )

    assert result is None
    assert len(connection.calls) == 4
    registry_sql, registry_params = connection.calls[0]
    assert "".join(registry_sql.split()) == "".join((
        "INSERT INTO resource_publication(resource_id,shape,content_version,"
        "reference_content_version,published_at,retired) VALUES(%s,%s,%s,%s,now(),%s) "
        "ON CONFLICT(resource_id) DO UPDATE SET shape=EXCLUDED.shape, "
        "content_version=EXCLUDED.content_version, "
        "reference_content_version=EXCLUDED.reference_content_version, "
        "published_at=EXCLUDED.published_at, retired=EXCLUDED.retired"
    ).split())
    assert registry_params == ("fixture_resource", shape, "fixture-v1", "ref-v1", False)
    assert connection.calls[1] == (
        "DELETE FROM resource_publication_descriptor WHERE publication_resource_id=%s",
        ("fixture_resource",),
    )
    for (sql, params), resource_id, expected in zip(
            connection.calls[2:],
            ("fixture_resource", "fixture_alias"),
            (descriptor, {"kind": "indicator", "metadata": {"theme": "fixture"}})):
        assert "".join(sql.split()) == "".join((
            "INSERT INTO resource_publication_descriptor(resource_id,"
            "publication_resource_id,content_version,descriptor) "
            "VALUES(%s,%s,%s,%s::jsonb)"
        ).split())
        assert params[:3] == (resource_id, "fixture_resource", "fixture-v1")
        assert isinstance(params[3], Jsonb)
        assert params[3].obj == expected


def test_publish_resource_without_declarations_removes_previous_descriptors():
    connection = RecordingConnection()

    publish_resource(connection, "fixture_resource", "scalar", "fixture-v2", retired=True)

    assert connection.calls[1] == (
        "DELETE FROM resource_publication_descriptor WHERE publication_resource_id=%s",
        ("fixture_resource",),
    )
    assert len(connection.calls) == 2
    assert connection.calls[0][1] == (
        "fixture_resource", "scalar", "fixture-v2", None, True,
    )


@pytest.mark.parametrize("overrides", [
    pytest.param({"resource_id": ""}, id="empty-resource-id"),
    pytest.param({"resource_id": "Bad"}, id="invalid-resource-id"),
    pytest.param({"resource_id": "a" * 97}, id="long-resource-id"),
    pytest.param({"shape": "typed_reading"}, id="unregistered-shape"),
    pytest.param({"content_version": ""}, id="empty-version"),
    pytest.param({"content_version": None}, id="missing-version"),
    pytest.param({"reference_content_version": 7}, id="invalid-reference-version"),
    pytest.param({"retired": "true"}, id="non-boolean-retirement"),
    pytest.param({"declarations": []}, id="unordered-declarations"),
    pytest.param({"declarations": {"Bad": {}}}, id="invalid-semantic-id"),
    pytest.param({"declarations": {"fixture_alias": []}}, id="non-object-descriptor"),
])
def test_publish_resource_validates_every_input_before_writing(overrides):
    connection = RecordingConnection()
    arguments = {
        "resource_id": "fixture_resource",
        "shape": "scalar",
        "content_version": "fixture-v1",
    }
    arguments.update(overrides)

    with pytest.raises(ValueError):
        publish_resource(connection, **arguments)

    assert connection.calls == []
