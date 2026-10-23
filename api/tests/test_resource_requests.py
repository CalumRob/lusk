import pytest
from pydantic import ValidationError

from api.resource_catalogue import default_resource_catalogue, validate_resource_item
from api.resource_requests import ResourceBatchRequest, ResourceReadItem
from api.semantic_resource_reader import SemanticResourceReader


def test_single_and_batch_use_the_same_typed_resource_item_vocabulary():
    item = {
        "resource": "densite",
        "target": {"kind": "territory", "type": "commune", "id": "22001"},
        "fields": ["value"],
        "intent": {"kind": "facts"},
    }

    single = ResourceReadItem.model_validate(item)
    batch = ResourceBatchRequest.model_validate({"items": [{"id": "density", **item}]})
    batch_item = batch.items[0]

    assert batch_item.model_dump(exclude={"id"}) == single.model_dump()
    assert validate_resource_item(single, default_resource_catalogue()).resource_id == "densite"


def test_resource_item_rejects_open_query_shapes_before_storage_access():
    catalogue = default_resource_catalogue()
    base = {
        "resource": "structure_age",
        "target": {"kind": "territory", "type": "commune", "id": "22001"},
        "intent": {"kind": "facts"},
    }
    unknown_axis = ResourceReadItem.model_validate({**base, "coordinates": {"sql": ["anything"]}})
    unknown_field = ResourceReadItem.model_validate({**base, "fields": ["columns.value"]})
    valid_axis = ResourceReadItem.model_validate({
        **base, "coordinates": {"detail": ["<15"], "sex": ["F"]},
        "fields": ["value"],
    })

    with pytest.raises(ValueError, match="coordinate axis"):
        validate_resource_item(unknown_axis, catalogue)
    with pytest.raises(ValueError, match="field"):
        validate_resource_item(unknown_field, catalogue)
    assert validate_resource_item(valid_axis, catalogue).resource_id == "structure_age"


def test_batch_item_ids_are_required_unique_and_extra_selectors_forbidden():
    read = {
        "resource": "densite",
        "target": {"kind": "territory", "type": "commune", "id": "22001"},
        "intent": {"kind": "facts"},
    }
    with pytest.raises(ValidationError):
        ResourceBatchRequest.model_validate({"items": [{**read}]})
    with pytest.raises(ValidationError):
        ResourceBatchRequest.model_validate({"items": [
            {"id": "x", **read}, {"id": "x", **read},
        ]})
    with pytest.raises(ValidationError):
        ResourceReadItem.model_validate({**read, "where": {"column": "value"}})


def test_named_reference_uses_its_producer_declared_non_territory_identity():
    catalogue = default_resource_catalogue()
    resource = catalogue.resources_by_id["raccordement_reference"]
    assert resource.target_kinds == ("named_reference",)
    assert resource.target_ids == ("bretagne_all_assessed_communes_mean",)
    item = ResourceReadItem.model_validate({
        "resource": "raccordement_reference",
        "target": {"kind": "named_reference", "id": resource.target_ids[0]},
        "intent": {"kind": "facts"},
    })
    assert validate_resource_item(item, catalogue) == resource

    wrong = ResourceReadItem.model_validate({
        "resource": "raccordement_reference",
        "target": {"kind": "named_reference", "id": "22001"},
        "intent": {"kind": "facts"},
    })
    with pytest.raises(ValueError, match="identity"):
        validate_resource_item(wrong, catalogue)


@pytest.mark.parametrize("intent", [
    {"kind": "fixed_comparison", "context": "default"},
    {"kind": "selected_comparison", "members": [{"type": "commune", "id": "22002"}]},
])
def test_sparse_membership_is_facts_only(intent):
    catalogue = default_resource_catalogue()
    membership = ResourceReadItem.model_validate({
        "resource": "couverture_programmes",
        "target": {"kind": "territory", "type": "commune", "id": "22001"},
        "intent": intent,
    })
    with pytest.raises(ValueError, match="intent is not declared"):
        validate_resource_item(membership, catalogue)


def test_comparison_capabilities_remain_declared_for_comparable_shapes():
    catalogue = default_resource_catalogue()
    for resource_id in ("densite", "structure_age", "subventions_annuelles",
                        "subventions_par_domaine"):
        resource = catalogue.resources_by_id[resource_id]
        assert "fixed_comparison" in resource.intents
        assert "selected_comparison" in resource.intents
    assert catalogue.resources_by_id["raccordement_reference"].intents == ("facts",)


def test_dynamic_series_coordinates_defer_value_membership_to_published_descriptor():
    catalogue = default_resource_catalogue()
    resource = catalogue.resources_by_id["subventions_annuelles"]
    assert resource.axes == ("year",)
    assert resource.dynamic_axes == ("year",)
    item = ResourceReadItem.model_validate({
        "resource": "subventions_annuelles",
        "target": {"kind": "territory", "type": "commune", "id": "22001"},
        "coordinates": {"year": ["2024"]},
        "intent": {"kind": "facts"},
    })
    assert validate_resource_item(item, catalogue) == resource


def test_mandatory_field_projection_does_not_accidentally_restore_optional_values():
    catalogue = default_resource_catalogue()
    for resource_id, target in (
        ("densite", {"kind": "territory", "type": "commune", "id": "22001"}),
        ("structure_age", {"kind": "territory", "type": "commune", "id": "22001"}),
    ):
        item = ResourceReadItem.model_validate({
            "resource": resource_id,
            "target": target,
            "fields": ["sources"],
            "intent": {"kind": "facts"},
        })
        assert SemanticResourceReader._legacy_fields(item, catalogue) == ["status"]

    membership = ResourceReadItem.model_validate({
        "resource": "couverture_programmes",
        "target": {"kind": "territory", "type": "commune", "id": "22001"},
        "fields": ["sources"],
        "intent": {"kind": "facts"},
    })
    assert SemanticResourceReader._legacy_fields(membership, catalogue) == ["availability"]


def test_provenance_and_status_are_mandatory_not_selectable_fields():
    catalogue = default_resource_catalogue()
    scalar = ResourceReadItem.model_validate({
        "resource": "densite",
        "target": {"kind": "territory", "type": "commune", "id": "22001"},
        "fields": ["sources"],
        "intent": {"kind": "facts"},
    })
    with pytest.raises(ValueError, match="field"):
        validate_resource_item(scalar, catalogue)

    series = ResourceReadItem.model_validate({
        "resource": "conso_enaf_annuel",
        "target": {"kind": "territory", "type": "commune", "id": "22001"},
        "fields": ["status"],
        "intent": {"kind": "facts"},
    })
    with pytest.raises(ValueError, match="field"):
        validate_resource_item(series, catalogue)


def test_comparison_intents_are_closed_and_share_item_grammar():
    catalogue = default_resource_catalogue()
    target = {"kind": "territory", "type": "commune", "id": "22001"}
    fixed = ResourceReadItem.model_validate({
        "resource": "densite", "target": target,
        "fields": ["median", "eligible_count"],
        "intent": {"kind": "fixed_comparison", "context": "default"},
    })
    selected = ResourceReadItem.model_validate({
        "resource": "densite", "target": target,
        "intent": {"kind": "selected_comparison", "members": [
            {"type": "commune", "id": "22002"},
            {"type": "commune", "id": "22003"},
        ]},
    })
    assert validate_resource_item(fixed, catalogue).resource_id == "densite"
    assert validate_resource_item(selected, catalogue).resource_id == "densite"
    with pytest.raises(ValueError, match="comparison context"):
        validate_resource_item(ResourceReadItem.model_validate({
            "resource": "densite", "target": target,
            "intent": {"kind": "fixed_comparison", "context": "arbitrary-sql"},
        }), catalogue)
    with pytest.raises(ValidationError, match="unique"):
        ResourceReadItem.model_validate({
            "resource": "densite", "target": target,
            "intent": {"kind": "selected_comparison", "members": [
                {"type": "commune", "id": "22002"},
                {"type": "commune", "id": "22002"},
            ]},
        })


def test_cohort_target_is_closed_and_facts_only():
    catalogue = default_resource_catalogue()
    item = ResourceReadItem.model_validate({
        "resource": "densite",
        "target": {"kind": "territory_cohort", "type": "commune",
                   "department_id": "29", "epci_id": "E29"},
        "fields": ["value"],
        "intent": {"kind": "facts"},
    })
    assert validate_resource_item(item, catalogue).resource_id == "densite"

    with pytest.raises(ValidationError):
        ResourceReadItem.model_validate({
            "resource": "densite",
            "target": {"kind": "territory_cohort", "type": "epci", "department_id": "29"},
            "intent": {"kind": "facts"},
        })
    with pytest.raises(ValidationError):
        ResourceReadItem.model_validate({
            "resource": "densite",
            "target": {"kind": "territory_cohort", "type": "commune", "ids": ["22001"]},
            "intent": {"kind": "facts"},
        })
    for intent in (
        {"kind": "fixed_comparison", "context": "default"},
        {"kind": "selected_comparison", "members": []},
    ):
        request = ResourceReadItem.model_validate({
            "resource": "densite",
            "target": {"kind": "territory_cohort", "type": "commune"},
            "intent": intent,
        })
        with pytest.raises(ValueError, match="facts-only"):
            validate_resource_item(request, catalogue)


def test_cohort_capabilities_follow_declared_native_shapes_not_a_scalar_allowlist():
    catalogue = default_resource_catalogue()
    for resource_id in (
        "densite", "structure_age", "conso_enaf_annuel", "subventions_par_domaine",
        "couverture_programmes", "demographie_selected_reading", "aedar_territorial_aggregate",
    ):
        resource = catalogue.resources_by_id[resource_id]
        assert "territory_cohort" in resource.target_kinds
        request = ResourceReadItem.model_validate({
            "resource": resource_id,
            "target": {"kind": "territory_cohort", "type": "commune"},
            "intent": {"kind": "facts"},
        })
        assert validate_resource_item(request, catalogue) == resource

    reference = catalogue.resources_by_id["raccordement_reference"]
    assert "territory_cohort" not in reference.target_kinds
