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


# The canonical Atelier-eligible set: every retained scalar, declared profile
# and owned series with a cohort read. The contract test below fails if a
# resource is added or removed without an explicit decision here.
CANONICAL_CELLULES = frozenset({
    "age_du_bati", "artif_par_habitant", "bornes_ev_par_station_service",
    "bornes_recharge", "bornes_recharge_1000", "chomage", "conso_enaf_annuel",
    "densite", "distribution_dpe", "eco_activites", "effectifs_salaries",
    "evolution_1968", "mix_logements", "offre_cyclable", "offre_tc",
    "part_passoires", "places_stationnement_velo_1000",
    "places_stationnement_voiture_1000", "prix_m2", "raccordement_tc",
    "reseaux", "reseaux_par_habitant", "stationnement_velo_par_voiture",
    "stations_service", "stations_service_1000", "statut", "structure_age",
    "subventions_annuelles", "surface_reseaux_routiers", "taille_menages",
    "type", "voitures_menage",
})

# The duration resources publish their axis in t-code space while discovery
# still declares minutes. Excluded by decision, not by omission; see the
# producer constant in api/resource_catalogue.py.
PENDING_COORDINATE_SPACE = frozenset({"raccordement_courbe"})

# This profile compares through its linked scalar facet, so the producer
# declares no detail default point for it (nothing is silently substituted).
SCALAR_BACKED_PROFILE = frozenset({"distribution_dpe"})


def _eligible():
    catalogue = default_resource_catalogue.__wrapped__()
    return {
        resource.resource_id: resource
        for resource in catalogue.resources
        if resource.resource_kind == "indicator"
        and {"scalar", "declared_profile", "ordered_series"}.intersection(resource.shapes)
        and "territory_cohort" in resource.target_kinds
    }


def test_every_canonical_cellule_declares_labels_units_combinations_and_defaults():
    """Name the resource and the missing field — never fail generically."""
    eligible = _eligible()
    declared = {resource_id: resource.cellule for resource_id, resource in eligible.items()
                if resource.cellule is not None}

    assert set(eligible) - set(declared) == PENDING_COORDINATE_SPACE, (
        "undeclared Atelier-eligible resource(s) need a decision in #1075")
    assert set(declared) == CANONICAL_CELLULES, (
        "the canonical Atelier-eligible set changed without updating the contract")

    for resource_id, cellule in declared.items():
        assert cellule.get("coordinates") is not None, f"{resource_id}: coordinates absent"
        assert cellule.get("valid_combinations"), f"{resource_id}: valid combinations absent"
        for coordinate in cellule["coordinates"]:
            axis = coordinate.get("name")
            assert axis, f"{resource_id}: coordinate name absent"
            assert coordinate.get("values"), f"{resource_id}/{axis}: values absent"
            for value in coordinate["values"]:
                key = value.get("value")
                assert key, f"{resource_id}/{axis}: coordinate value absent"
                assert value.get("label"), f"{resource_id}/{axis}/{key}: readable label absent"
                assert "unit" in value, f"{resource_id}/{axis}/{key}: unit declaration absent"
        is_scalar = "scalar" in eligible[resource_id].shapes and len(eligible[resource_id].shapes) == 1
        if not is_scalar and resource_id not in SCALAR_BACKED_PROFILE:
            point = cellule.get("default_point")
            assert point, f"{resource_id}: default point absent"
            declared_axes = {coordinate["name"] for coordinate in cellule["coordinates"]}
            assert set(point) <= declared_axes, f"{resource_id}: default point names an undeclared coordinate"
            assert all(any(value["value"] == selected for value in next(
                coordinate["values"] for coordinate in cellule["coordinates"]
                if coordinate["name"] == axis))
                for axis, selected in point.items()), (
                f"{resource_id}: default point is not one of the declared values")


def test_profile_category_units_never_inherit_the_indicator_scalar_unit():
    public = _public("offre_cyclable")
    detail = next(coordinate for coordinate in public["cellule"]["coordinates"]
                  if coordinate["name"] == "detail")
    units = {value["value"]: value["unit"] for value in detail["values"]}
    assert units == {
        "protege_longueur": "km",
        "protege_km_1000": "km / 1 000 hab",
        "partage_longueur": "km",
        "partage_km_1000": "km / 1 000 hab",
        "total_longueur": "km",
    }
    assert units["protege_km_1000"] != public["unit"]


def test_default_points_are_declared_for_profiles_and_series():
    expected = {
        "structure_age": {"detail": "<15", "sex": "F"},
        "reseaux": {"detail": "b_longueur"},
        "statut": {"detail": "hlm"},
        "prix_m2": {"year": "2025"},
        "conso_enaf_annuel": {"year": "2024"},
        "artif_par_habitant": {"declared_detail": "2025"},
        "subventions_annuelles": {"year": "2025"},
    }
    for resource_id, point in expected.items():
        assert _public(resource_id)["cellule"]["default_point"] == point


def test_valid_combinations_are_explicit_not_inferred():
    age = _public("structure_age")["cellule"]["valid_combinations"]
    assert len(age) == 14
    assert {"detail": "<15", "sex": "F"} in age
    assert {"detail": "80+", "sex": "M"} in age
    assert _public("densite")["cellule"]["valid_combinations"] == [{}]


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
