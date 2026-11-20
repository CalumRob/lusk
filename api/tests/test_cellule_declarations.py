"""Discovery declarations for addressable Cellules (Atelier prerequisite, #1075).

The seam is the public ``GET /api/resources`` payload: an app must be able to
address a Cellule from producer declarations alone, without parsing a key,
guessing a label or hardcoding a default.
"""

from api.resource_catalogue import default_resource_catalogue


def _public(resource_id):
    payload = default_resource_catalogue.__wrapped__().discovery_payload()
    return next(resource for resource in payload["resources"]
                if resource["resource_id"] == resource_id)


def test_cellule_declaration_names_every_coordinate_value_with_a_readable_label():
    """The age/sex profile declares its two coordinates and every value label."""
    cellule = _public("structure_age")["cellule"]

    detail = next(coordinate for coordinate in cellule["coordinates"]
                  if coordinate["name"] == "detail")
    assert [value["value"] for value in detail["values"]] == [
        "<15", "15-24", "25-39", "40-54", "55-64", "65-79", "80+",
    ]
    assert detail["values"][0] == {
        "value": "<15", "label": "Moins de 15 ans", "unit": "%",
    }
    assert detail["values"][-1]["label"] == "80 ans et plus"

    sex = next(coordinate for coordinate in cellule["coordinates"]
               if coordinate["name"] == "sex")
    assert [value["value"] for value in sex["values"]] == ["F", "M"]
    assert all(value["label"] for value in sex["values"])
