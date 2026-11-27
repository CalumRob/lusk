"""DB-free contracts for producer-declaration publication fixtures."""

from __future__ import annotations

import pytest

from api.tests.integration.resource_publication_fixtures import (
    indicator_declaration, publish_aedar, publish_indicator,
)


class RecordingConnection:
    def __init__(self):
        self.calls = []

    def execute(self, sql, params=None):
        self.calls.append((sql, params))


def test_indicator_declaration_is_one_self_contained_producer_resource():
    declaration, owner = indicator_declaration("distribution_dpe")

    assert owner == "distribution_dpe"
    assert declaration["kind"] == "indicator"
    metadata = declaration["metadata"]
    assert metadata["indicator_keys"] == ["distribution_dpe"]
    assert set(metadata["sources"]) == {"distribution_dpe"}
    assert "dpe_22" in metadata["source_records"]
    assert "distribution_dpe" in metadata["profile_contracts"]
    assert set(metadata["detail_labels"]["distribution_dpe"]) == set("ABCDEFG")


def test_owned_series_publication_uses_dataset_identity_and_dual_scalar_gate():
    connection = RecordingConnection()

    publication_id = publish_indicator(
        connection, "prix_m2", "owned_series", "prix-v1",
        reference_content_version="ref-v1",
    )

    assert publication_id == "dvf_prix_m2"
    assert connection.calls[0][1][:3] == ("dvf_prix_m2", "owned_series", "prix-v1")
    descriptor_params = connection.calls[2][1]
    assert descriptor_params[:3] == ("prix_m2", "dvf_prix_m2", "prix-v1")
    # The pooled scalar facet has its own registry gate and no second descriptor.
    assert connection.calls[3][1][:3] == ("prix_m2", "scalar", "prix-v1")
    assert len(connection.calls) == 5


def test_named_reference_alias_shares_its_owner_publication_descriptor():
    connection = RecordingConnection()

    publication_id = publish_indicator(
        connection, "raccordement_courbe", "owned_series", "raccordement-v1",
        reference_content_version="ref-v1",
    )

    assert publication_id == "raccordement_courbe"
    registry_ids = [call[1][0] for call in connection.calls if "INSERT INTO resource_publication(" in call[0]]
    descriptor_ids = [call[1][0] for call in connection.calls
                      if "INSERT INTO resource_publication_descriptor(" in call[0]]
    assert len(registry_ids) == 1
    assert {"raccordement_courbe", "raccordement_reference"} <= set(descriptor_ids)
    assert all(call[1][1] == registry_ids[0] for call in connection.calls
               if "INSERT INTO resource_publication_descriptor(" in call[0])


def test_aedar_publication_carries_both_grammar_identities():
    connection = RecordingConnection()

    publish_aedar(connection, "aedar-v1", reference_content_version="ref-v1")

    assert connection.calls[0][1][:3] == ("aedar", "aedar", "aedar-v1")
    descriptor_ids = {call[1][0] for call in connection.calls
                      if "INSERT INTO resource_publication_descriptor(" in call[0]}
    assert descriptor_ids == {"aedar_territorial_aggregate", "aedar_territory_summary"}


@pytest.mark.parametrize("resource_id", ["not_a_resource", "Bad", "a" * 97])
def test_missing_or_invalid_producer_declaration_fails_before_writing(resource_id):
    connection = RecordingConnection()

    with pytest.raises(ValueError):
        indicator_declaration(resource_id)

    assert connection.calls == []
