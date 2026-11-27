"""Discovery declarations for addressable Cellules (Atelier prerequisite, #1075).

The seam is the public ``GET /api/resources`` payload: an app must be able to
address a Cellule from producer declarations alone, without parsing a key,
guessing a label or hardcoding a default. The contract assertions read the
producer metadata independently, so they can disagree with the catalogue.
"""

import json
from contextlib import contextmanager
from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from api import main
from api.resource_catalogue import ResourceCatalogue, validate_resource_item
from api.tests.resource_catalogue_fixtures import default_resource_catalogue, discover_indicator_resources
from api.resource_requests import ResourceReadItem
from api.semantic_resource_reader import SemanticResourceReader

METADATA = Path(__file__).parents[2] / "pipeline/inst/extdata/theme-metadata"


def _public(resource_id):
    payload = default_resource_catalogue.__wrapped__().discovery_payload()
    return next(resource for resource in payload["resources"]
                if resource["resource_id"] == resource_id)


def _metadata(theme_id):
    return json.loads((METADATA / f"theme_{theme_id}.json").read_text(encoding="utf-8"))


def _page(resource_id):
    public = _public(resource_id)
    return _metadata(public["theme_id"])["indicator_pages"][resource_id]


def _coordinate(resource_id, axis):
    return next(coordinate for coordinate in _public(resource_id)["cellule"]["coordinates"]
                if coordinate["name"] == axis)


@contextmanager
def _app_overrides(overrides):
    """Install FastAPI dependency overrides for one request, then restore them."""
    previous = {key: main.app.dependency_overrides.get(key) for key in overrides}
    main.app.dependency_overrides.update(overrides)
    try:
        yield
    finally:
        for key, value in previous.items():
            if value is None:
                main.app.dependency_overrides.pop(key, None)
            else:
                main.app.dependency_overrides[key] = value


# The canonical Atelier-eligible set with a declaration: every retained scalar
# and declared profile, plus the owned series whose axis the producer declares.
# The contract test fails if that set changes without an explicit decision.
CANONICAL_CELLULES = frozenset({
    "age_du_bati", "artif_par_habitant", "bornes_ev_par_station_service",
    "bornes_recharge", "bornes_recharge_1000", "chomage", "conso_enaf_annuel",
    "densite", "distribution_dpe", "eco_activites", "effectifs_salaries",
    "evolution_1968", "mix_logements", "offre_cyclable", "offre_tc",
    "part_passoires", "places_stationnement_velo_1000",
    "places_stationnement_voiture_1000", "prix_m2", "raccordement_tc",
    "reseaux", "reseaux_par_habitant", "stationnement_velo_par_voiture",
    "stations_service", "stations_service_1000", "statut", "structure_age",
    "surface_reseaux_routiers", "taille_menages", "type", "voitures_menage",
})

# This profile compares through its linked scalar facet, so the producer
# declares no detail default point for it (nothing is silently substituted).
SCALAR_BACKED_PROFILE = frozenset({"distribution_dpe"})

# Coordinate keys that legitimately have no separate producer wording: the
# published F/M axis label is the key itself. Everything else must carry a
# producer-declared label (years and DPE classes do, even though key == label).
KEY_IS_LABEL = frozenset({"F", "M"})


def _eligible():
    catalogue = default_resource_catalogue.__wrapped__()
    return {
        resource.resource_id: resource
        for resource in catalogue.resources
        if resource.resource_kind == "indicator"
        and {"scalar", "declared_profile", "ordered_series"}.intersection(resource.shapes)
        and "territory_cohort" in resource.target_kinds
    }


def _producer_deferred():
    """The single source for withheld declarations: producer page declarations."""
    deferred = set()
    for path in METADATA.glob("theme_*.json"):
        metadata = json.loads(path.read_text(encoding="utf-8"))
        pages = metadata.get("indicator_pages") or {}
        deferred.update(
            resource_id for resource_id, page in pages.items()
            if (page.get("cellule") or {}).get("declare") is False
        )
    return deferred


def test_every_canonical_cellule_declares_labels_units_combinations_and_defaults():
    """Name the resource and the field that disagrees with its producer."""
    eligible = _eligible()
    declared = {resource_id: resource.cellule for resource_id, resource in eligible.items()
                if resource.cellule is not None}

    assert set(eligible) - set(declared) == _producer_deferred(), (
        "an eligible resource is declared or withheld contrary to its producer declaration")
    assert set(declared) == CANONICAL_CELLULES, (
        "the canonical declared Cellule set changed without updating the contract")

    for resource_id, cellule in declared.items():
        page = _page(resource_id)
        comparison = page.get("comparison") or {}
        metadata = _metadata(eligible[resource_id].theme_id)
        labels = dict(comparison.get("labels") or {})
        labels.update((metadata.get("detail_labels") or {}).get(resource_id, {}))
        detail_units = ((metadata.get("profile_contracts") or {}).get(resource_id, {})
                        .get("detail_units") or {})
        scalar_unit = page.get("unit") or ""

        assert cellule.get("coordinates") is not None, f"{resource_id}: coordinates absent"
        assert cellule.get("valid_combinations"), f"{resource_id}: valid combinations absent"
        for coordinate in cellule["coordinates"]:
            axis = coordinate.get("name")
            assert axis, f"{resource_id}: coordinate name absent"
            assert coordinate.get("values"), f"{resource_id}/{axis}: values absent"
            for value in coordinate["values"]:
                key = value.get("value")
                assert key, f"{resource_id}/{axis}: coordinate value absent"
                if key in labels:
                    assert value["label"] == labels[key], (
                        f"{resource_id}/{axis}/{key}: label disagrees with the producer declaration")
                else:
                    assert key in KEY_IS_LABEL, (
                        f"{resource_id}/{axis}/{key}: no producer label and no key-as-label exemption")
                    assert value["label"] == key, f"{resource_id}/{axis}/{key}: key-as-label changed"
                if axis == "detail":
                    # AC4: never fall back to the indicator's scalar unit.
                    expected_unit = detail_units.get(key) or comparison.get("unit") or None
                else:
                    expected_unit = comparison.get("unit") or scalar_unit or None
                assert value["unit"] == expected_unit, (
                    f"{resource_id}/{axis}/{key}: unit disagrees with the producer declaration")

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


def test_values_without_separate_wording_use_their_own_key():
    """Pin the values whose readable label is legitimately the key itself."""
    pinned = {
        "structure_age": {"sex": ["F", "M"]},
        "distribution_dpe": {"detail": list("ABCDEFG")},
        "prix_m2": {"year": [str(year) for year in range(2021, 2026)]},
        "conso_enaf_annuel": {"year": [str(year) for year in range(2011, 2025)]},
    }
    for resource_id, axes in pinned.items():
        for axis, keys in axes.items():
            labels = {value["value"]: value["label"] for value in _coordinate(resource_id, axis)["values"]}
            assert [labels[key] for key in keys] == keys, f"{resource_id}/{axis}: key-as-label changed"


def test_owned_series_coordinates_come_from_the_published_series_axis():
    """publish_series.R:233 writes the descriptor axis from comparison.details.

    ``comparison_axis_values`` (the trajectory endpoints) is a different facet,
    not the coordinate universe. A producer that withholds the declaration
    keeps its descriptor-owned axis and no Cellule coordinates.
    """
    catalogue = default_resource_catalogue.__wrapped__()
    for path in METADATA.glob("theme_*.json"):
        metadata = json.loads(path.read_text(encoding="utf-8"))
        for resource_id in (metadata.get("owned_series_routes") or {}):
            page = metadata["indicator_pages"][resource_id]
            producer_cellule = page.get("cellule") or {}
            if "declare" in producer_cellule:
                assert isinstance(producer_cellule["declare"], bool), (
                    f"{resource_id}: cellule.declare must be a plain boolean")
            resource = catalogue.resources_by_id[resource_id]
            details = (page.get("comparison") or {}).get("details") or ()
            if producer_cellule.get("declare") is False or not details:
                assert resource.cellule is None, (
                    f"{resource_id}: a withheld or undeclared series axis must defer to the descriptor")
                continue
            assert resource.cellule is not None, f"{resource_id}: declared series axis lost"
            values = [value["value"] for value in resource.cellule["coordinates"][0]["values"]]
            assert values == [str(value) for value in details], (
                f"{resource_id}: coordinates do not come from the published series axis")


def test_profile_category_units_never_inherit_the_indicator_scalar_unit():
    public = _public("offre_cyclable")
    units = {value["value"]: value["unit"] for value in _coordinate("offre_cyclable", "detail")["values"]}
    assert units == {
        "protege_longueur": "km",
        "protege_km_1000": "km / 1 000 hab",
        "partage_longueur": "km",
        "partage_km_1000": "km / 1 000 hab",
        "total_longueur": "km",
    }
    assert units["protege_km_1000"] != public["unit"]


def test_detail_axis_never_inherits_the_scalar_unit_without_a_producer_declaration(tmp_path):
    """AC4: no detail_units and no comparison.unit means unit null, not scalar."""
    for metadata in METADATA.glob("theme_*.json"):
        (tmp_path / metadata.name).write_bytes(metadata.read_bytes())
    path = tmp_path / "theme_demographie.json"
    metadata = json.loads(path.read_text(encoding="utf-8"))
    metadata["indicator_pages"]["structure_age"]["comparison"].pop("unit", None)
    path.write_text(json.dumps(metadata), encoding="utf-8")

    resource = discover_indicator_resources(tmp_path).resources_by_id["structure_age"]
    detail = next(coordinate for coordinate in resource.cellule["coordinates"]
                  if coordinate["name"] == "detail")
    sex = next(coordinate for coordinate in resource.cellule["coordinates"]
               if coordinate["name"] == "sex")
    assert resource.unit == "%"  # the scalar unit exists but is not a detail unit
    assert all(value["unit"] is None for value in detail["values"])
    assert all(value["unit"] == "%" for value in sex["values"])  # non-detail keeps fallback


def test_default_points_are_declared_for_profiles_and_series():
    expected = {
        "structure_age": {"detail": "<15", "sex": "F"},
        "reseaux": {"detail": "b_longueur"},
        "statut": {"detail": "hlm"},
        "prix_m2": {"year": "2025"},
        "conso_enaf_annuel": {"year": "2024"},
        "artif_par_habitant": {"declared_detail": "2025"},
    }
    for resource_id, point in expected.items():
        assert _public(resource_id)["cellule"]["default_point"] == point


def test_valid_combinations_are_explicit_not_inferred():
    age = _public("structure_age")["cellule"]["valid_combinations"]
    assert len(age) == 14
    assert {"detail": "<15", "sex": "F"} in age
    assert {"detail": "80+", "sex": "M"} in age
    assert _public("densite")["cellule"]["valid_combinations"] == [{}]


def _restricted_catalogue(tmp_path):
    """A producer declaration where only one age/sex combination exists."""
    for metadata in METADATA.glob("theme_*.json"):
        (tmp_path / metadata.name).write_bytes(metadata.read_bytes())
    path = tmp_path / "theme_demographie.json"
    metadata = json.loads(path.read_text(encoding="utf-8"))
    metadata["indicator_pages"]["structure_age"]["cellule"] = {
        "valid_combinations": [{"detail": "<15", "sex": "F"}],
    }
    path.write_text(json.dumps(metadata), encoding="utf-8")
    return discover_indicator_resources(tmp_path)


def _age_request(detail, sex):
    return ResourceReadItem.model_validate({
        "resource": "structure_age",
        "target": {"kind": "territory", "type": "commune", "id": "22001"},
        "coordinates": {"detail": [detail], "sex": [sex]},
        "intent": {"kind": "facts"},
    })


def test_undeclared_coordinate_combination_is_rejected_by_name(tmp_path):
    catalogue = _restricted_catalogue(tmp_path)
    assert validate_resource_item(_age_request("<15", "F"), catalogue).resource_id == "structure_age"
    with pytest.raises(ValueError, match="coordinate combination is not declared"):
        validate_resource_item(_age_request("<15", "M"), catalogue)


def test_combination_enforcement_follows_the_declaration_not_the_static_axis_list():
    """A declared combination space is enforced even without static axis values."""
    base = default_resource_catalogue.__wrapped__()
    resource = replace(base.resources_by_id["structure_age"],
                       axis_values=(),
                       cellule={"coordinates": [], "valid_combinations": [
                           {"detail": "<15", "sex": "F"}], "default_point": None})
    catalogue = ResourceCatalogue(base.declarations,
        tuple(resource if other.resource_id == "structure_age" else other
              for other in base.resources), base.excluded)
    assert validate_resource_item(_age_request("<15", "F"), catalogue).resource_id == "structure_age"
    with pytest.raises(ValueError, match="coordinate combination is not declared"):
        validate_resource_item(_age_request("<15", "M"), catalogue)


def test_partial_combination_declaration_cannot_bypass_the_admission_gate():
    """A declared point that omits an axis must not silently disable the 422."""
    base = default_resource_catalogue.__wrapped__()
    resource = replace(base.resources_by_id["structure_age"],
                       cellule={"coordinates": [], "valid_combinations": [
                           {"detail": "<15"}, {"detail": "15-24"}], "default_point": None})
    catalogue = ResourceCatalogue(base.declarations,
        tuple(resource if other.resource_id == "structure_age" else other
              for other in base.resources), base.excluded)

    detail_only = ResourceReadItem.model_validate({
        "resource": "structure_age",
        "target": {"kind": "territory", "type": "commune", "id": "22001"},
        "coordinates": {"detail": ["<15"]},
        "intent": {"kind": "facts"},
    })
    assert validate_resource_item(detail_only, catalogue).resource_id == "structure_age"
    with pytest.raises(ValueError, match="coordinate combination is not declared"):
        validate_resource_item(_age_request("<15", "F"), catalogue)
    undeclared_detail = ResourceReadItem.model_validate({
        **detail_only.model_dump(), "coordinates": {"detail": ["80+"]}})
    with pytest.raises(ValueError, match="coordinate combination is not declared"):
        validate_resource_item(undeclared_detail, catalogue)


def test_public_read_reports_undeclared_combination_before_opening_a_connection(tmp_path):
    class NoConnectionPool:
        @contextmanager
        def connection(self):
            raise AssertionError("undeclared combination must fail before any connection")
            yield

    catalogue = _restricted_catalogue(tmp_path)
    with _app_overrides({main.get_resource_catalogue: lambda: catalogue,
               main.get_repository: lambda: SimpleNamespace(connections=NoConnectionPool())}):
        response = TestClient(main.app).post("/api/resources/read", json={
            "resource": "structure_age",
            "target": {"kind": "territory", "type": "commune", "id": "22001"},
            "coordinates": {"detail": ["<15"], "sex": ["M"]},
            "intent": {"kind": "facts"},
        })

    assert response.status_code == 422
    assert "coordinate combination is not declared" in response.json()["detail"]


class _Cursor:
    def __init__(self, rows):
        self.rows = list(rows)

    def fetchone(self):
        return self.rows[0] if self.rows else None

    def fetchall(self):
        return self.rows


class _ProfileConnection:
    """A descriptor-only snapshot: the default is read from producer metadata."""

    def __init__(self, default_detail, default_sex):
        page = _page("structure_age")["comparison"]
        assert (default_detail, default_sex) == (page["detail"], page["sex"])
        self.default_detail, self.default_sex = default_detail, default_sex
        self.details = ["<15", "15-24"]
        self.sexes = ["F", "M"]

    @contextmanager
    def transaction(self):
        yield

    def execute(self, sql, params=None):
        if sql.startswith("SET TRANSACTION"):
            return _Cursor([])
        if "SELECT territory_id,territory_type FROM territory_reference WHERE territory_id=ANY" in sql:
            return _Cursor([(territory_id, "commune") for territory_id in params[0]])
        if "SELECT territory_type FROM territory_reference" in sql:
            return _Cursor([("commune",)])
        if "SELECT allowed_levels FROM profile_descriptor" in sql:
            return _Cursor([(["commune"],)])
        if "FROM profile_descriptor WHERE" in sql:
            # focal_profiles' descriptor row carries the published comparison point.
            return _Cursor([("structure_age", "Structure par âge", "%", ["commune"], "v1",
                             self.default_detail, self.default_sex, "high", None, None, None, False)])
        if "FROM resource_publication" in sql:
            return _Cursor([("structure_age", "declared_profile", "profile-v1", "ref-v1")])
        if "SELECT content_version" in sql and "territory_reference" in sql:
            return _Cursor([("ref-v1",)])
        if "SELECT axis_key FROM profile_axis" in sql:
            keys = self.details if params[1] == "detail" else self.sexes
            return _Cursor([(key,) for key in keys])
        if "FROM profile_axis" in sql and "indicator_id=ANY" in sql:
            rows = [("structure_age", "detail", detail, f"label-{detail}", index, "%")
                    for index, detail in enumerate(self.details)]
            rows += [("structure_age", "sex", sex, sex, index, "%")
                     for index, sex in enumerate(self.sexes)]
            return _Cursor(rows)
        if "FROM profile_observation o WHERE" in sql:
            provenance = json.dumps([{
                "source_id": "age_detail", "vintage_id": "v1", "name": "INSEE",
                "version": "2023", "reference_date": "2023-01-01",
                "publication_date": "2026-06-30"}])
            return _Cursor([("structure_age", detail, sex, 1.0, "measured", provenance)
                            for detail in self.details for sex in self.sexes])
        raise AssertionError(sql)


def _descriptor_reader(*, comparison_preflight=None, comparison_snapshot=None):
    """A real dispatcher with descriptor-only snapshot seams."""
    return SemanticResourceReader(
        indicator_facts_snapshot=lambda *args, **kwargs: {"work_units": 3},
        indicator_comparison_preflight=comparison_preflight or (lambda *a, **k: {}),
        indicator_comparison_snapshot=comparison_snapshot or (lambda *a, **k: {}),
        owned_series_route=lambda *args, **kwargs: None,
        owned_named_reference_snapshot=lambda *args, **kwargs: {},
        comparison_field_selection=lambda fields: fields,
        max_owned_series_provenance_per_point=8,
    )


def _pool_for_default():
    producer_default = _page("structure_age")["comparison"]

    class Pool:
        @contextmanager
        def connection(self):
            yield _ProfileConnection(producer_default["detail"], producer_default["sex"])

    return Pool()


def test_no_coordinate_profile_read_exposes_the_descriptors_comparison_point():
    """A no-coordinate read surfaces the descriptor's published comparison point.

    The local fixture is seeded from the producer declaration and checks that
    agreement on construction, then verifies the read wires that point through
    to the response. Whether the real published descriptor agrees with the
    producer declaration is the publisher's contract, not provable DB-free.
    """
    with _app_overrides({main.get_resource_catalogue: lambda: default_resource_catalogue.__wrapped__(),
               main.get_repository: lambda: SimpleNamespace(connections=_pool_for_default()),
               main.get_semantic_resource_reader: lambda: _descriptor_reader()}):
        response = TestClient(main.app).post("/api/resources/read", json={
            "resource": "structure_age",
            "target": {"kind": "territory", "type": "commune", "id": "22001"},
            "intent": {"kind": "facts"},
        })

    assert response.status_code == 200, response.text
    descriptor_point = response.json()["descriptor"]["comparison_point"]
    assert (descriptor_point["detail"], descriptor_point["sex"]) == ("<15", "F")

    dpe = _public("distribution_dpe")["cellule"]
    assert dpe["default_point"] is None
    assert _page("distribution_dpe")["comparison"]["indicator"] == "part_passoires"


def test_no_coordinate_comparison_passes_no_point_to_the_snapshot_seams():
    """With no coordinates named, both comparison seams receive None; the
    published descriptor is left to resolve the facet. The SQL that selects
    that facet is not exercised by this DB-free test.
    """
    calls = []

    def capture(label, result):
        def spy(*args, **kwargs):
            calls.append((label, kwargs.get("profile_coordinates")))
            return result
        return spy

    reader = _descriptor_reader(
        comparison_preflight=capture("preflight", {
            "members": ["22001"], "fixed_context": ("default", "D1", "commune")}),
        comparison_snapshot=capture("snapshot", {"result": {"status": "available"}}))
    with _app_overrides({main.get_resource_catalogue: lambda: default_resource_catalogue.__wrapped__(),
               main.get_repository: lambda: SimpleNamespace(connections=_pool_for_default()),
               main.get_semantic_resource_reader: lambda: reader}):
        response = TestClient(main.app).post("/api/resources/read", json={
            "resource": "structure_age",
            "target": {"kind": "territory", "type": "commune", "id": "22001"},
            "intent": {"kind": "fixed_comparison", "context": "default"},
        })

    assert response.status_code == 200, response.text
    assert calls == [("preflight", None), ("snapshot", None)]


def test_declared_values_match_pinned_expected_literals():
    """Independent pins: a shared bug in projection and re-derivation cannot pass."""
    assert [value["label"] for value in _coordinate("structure_age", "detail")["values"]] == [
        "Moins de 15 ans", "15 à 24 ans", "25 à 39 ans", "40 à 54 ans",
        "55 à 64 ans", "65 à 79 ans", "80 ans et plus",
    ]
    assert [value["label"] for value in _coordinate("structure_age", "sex")["values"]] == [
        "F", "M",
    ]
    assert _public("structure_age")["cellule"]["default_point"] == {"detail": "<15", "sex": "F"}

    years = [value["value"] for value in _coordinate("prix_m2", "year")["values"]]
    assert years == ["2021", "2022", "2023", "2024", "2025"]
    assert [value["label"] for value in _coordinate("prix_m2", "year")["values"]] == years
    assert _public("prix_m2")["cellule"]["default_point"] == {"year": "2025"}

    scalar = _public("densite")["cellule"]
    assert scalar == {"coordinates": [], "valid_combinations": [{}], "default_point": None}


def test_cellule_declaration_names_every_coordinate_value_with_a_readable_label():
    """The age/sex profile declares its two coordinates and every value label."""
    cellule = _public("structure_age")["cellule"]

    detail = _coordinate("structure_age", "detail")
    assert [value["value"] for value in detail["values"]] == [
        "<15", "15-24", "25-39", "40-54", "55-64", "65-79", "80+",
    ]
    assert detail["values"][0] == {"value": "<15", "label": "Moins de 15 ans", "unit": "%"}
    assert detail["values"][-1]["label"] == "80 ans et plus"

    sex = _coordinate("structure_age", "sex")
    assert [value["value"] for value in sex["values"]] == ["F", "M"]
    assert all(value["label"] for value in sex["values"])
