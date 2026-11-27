"""Semantic resource grammar and database-backed API discovery.

The pipeline publishes producer declarations with each resource version. This
module projects those declarations and the image-owned shape grammar; it never
reads theme metadata files or maintains an API-side resource inventory.
"""

from dataclasses import asdict, dataclass, field, replace
from functools import lru_cache
import itertools
import json
import os
from pathlib import Path

from fastapi import HTTPException


# Producer-owned serving disposition (#1048): retired ids stay in the metadata
# as audit-only receipts but never enter discovery. Single source of truth for
# the literal the pipeline also declares.
SERVING_DISPOSITION_EXCLUDED_LEGACY = "excluded_legacy_accessibility"


@dataclass(frozen=True)
class IndicatorDeclaration:
    theme_id: str
    indicator_id: str
    source_id: str | None
    disposition: str
    shapes: tuple[str, ...]


@dataclass(frozen=True)
class IndicatorResource:
    resource_id: str
    theme_id: str
    indicator_id: str
    label: str
    unit: str
    direction: str
    allowed_levels: tuple[str, ...]
    sources: tuple[str, ...]
    shapes: tuple[str, ...]
    axes: tuple[str, ...]
    axis_values: tuple[tuple[str, tuple[str, ...]], ...]
    target_kinds: tuple[str, ...]
    target_ids: tuple[str, ...]
    dynamic_axes: tuple[str, ...]
    fields: tuple[str, ...]
    intents: tuple[str, ...]
    # Indicator-only discovery capabilities. `None` means a non-indicator
    # semantic resource has no declared map-layer eligibility.
    map_eligible: bool | None = None
    counts_available: bool = False
    resource_kind: str = "indicator"
    context_values: tuple[str, ...] = ()
    storage_relation: str | None = None
    publication_table: str | None = None
    side_relations: tuple[dict, ...] = ()
    # Producer-declared comparison facets (AEDAR source grain): per-cell
    # measure key or registry-wide aggregate reading key ->
    # {"facet", "direction", "ranked"}.
    measure_facets: dict[str, dict] = field(default_factory=dict)
    # Addressable Cellule declaration for the Atelier (#1075). None for
    # non-Cellule resources and for producers with page.cellule.declare=false,
    # which defer their coordinate space to the published descriptor.
    cellule: dict | None = None
    # Registry identity may differ from the semantic API identity (AEDAR's two
    # grammar resources share one publication resource). Discovery hides this
    # admission detail; reads use it for the one shared registry gate.
    publication_resource_id: str | None = None


@dataclass(frozen=True)
class ResourceCatalogue:
    declarations: tuple[IndicatorDeclaration, ...]
    resources: tuple[IndicatorResource, ...]
    excluded: tuple[IndicatorDeclaration, ...]
    # DB discovery may hide a retired/stale resource while reads must still
    # admit its known identity so the registry guard can return typed 503.
    admission_resources: tuple[IndicatorResource, ...] | None = None

    @property
    def resources_by_id(self) -> dict[str, IndicatorResource]:
        admitted = self.resources if self.admission_resources is None else self.admission_resources
        return {resource.resource_id: resource for resource in admitted}

    def discovery_payload(self) -> dict:
        """Public, bounded description of producer-declared retained resources."""
        public_resources = []
        for resource in self.resources:
            declaration = asdict(resource)
            physical_relations = declaration.pop("side_relations")
            declaration["evidence"] = [
                {"field": side["field"], "fields": side["fields"]}
                for side in physical_relations
            ]
            for key in ("storage_relation", "publication_table", "publication_resource_id"):
                declaration.pop(key, None)
            public_resources.append(declaration)
        return {
            "contract": "semantic-resource-catalogue-v1",
            "resources": public_resources,
        }


@dataclass(frozen=True)
class ResourceGrammar:
    """Image-owned shape grammar; resource identities come from the database."""

    contract_path: Path
    contract: dict

    @property
    def semantic_by_id(self):
        return {declaration["resource_id"]: declaration
                for declaration in self.contract.get("resources", ())}


@lru_cache(maxsize=1)
def default_resource_grammar() -> ResourceGrammar:
    root = Path(__file__).resolve().parents[1]
    producer = Path(os.environ.get("LUSK_PRODUCER_METADATA_DIR", root / "pipeline" / "inst" / "extdata"))
    path = producer / "semantic-resource-contracts.json"
    contract = json.loads(path.read_text(encoding="utf-8"))
    if contract.get("contract") != "producer-semantic-resources-v1":
        raise ValueError("Invalid producer semantic resource contract")
    declarations = contract.get("resources")
    if not isinstance(declarations, list):
        raise ValueError("Invalid producer semantic resource declarations")
    ids = [declaration.get("resource_id") for declaration in declarations]
    if any(not isinstance(resource_id, str) or not resource_id for resource_id in ids):
        raise ValueError("Invalid producer semantic resource identity")
    if len(ids) != len(set(ids)):
        raise ValueError("Duplicate producer semantic resource identity")
    return ResourceGrammar(path, contract)


_SHAPE_DECLARATIONS = (
    ("scalar_contracts", "scalar"),
    ("profile_contracts", "declared_profile"),
    ("owned_series_routes", "ordered_series"),
    ("distribution_contracts", "distribution"),
)
_SHAPE_ORDER = tuple(shape for _, shape in _SHAPE_DECLARATIONS) + (
    "period_detail", "anchored_membership", "named_reference",
)


def _declared_shapes(metadata, indicator_id, page, reference_aliases):
    declared = {
        shape for contract_name, shape in _SHAPE_DECLARATIONS
        if indicator_id in (metadata.get(contract_name) or {})
    }
    if page.get("series_dataset_id"):
        declared.add("ordered_series")
    if indicator_id in reference_aliases:
        declared.add("named_reference")
    if page.get("pyramid", {}).get("dimensions"):
        declared.add("declared_profile")
    collection = (metadata.get("observed_collection_contracts") or {}).get(indicator_id, {})
    if collection.get("kind") == "period_detail":
        declared.add("period_detail")
    elif collection.get("kind") == "anchored_membership":
        declared.add("anchored_membership")
    return tuple(shape for shape in _SHAPE_ORDER if shape in declared)


def _axis_values(metadata, indicator_id, page, shapes, parent_indicator=None):
    if parent_indicator is not None:
        route = (metadata.get("owned_series_routes") or {}).get(parent_indicator, {})
        if route.get("axis_values"):
            return ((route.get("axis_kind", "axis"), tuple(str(v) for v in route["axis_values"])),)

    result = []
    comparison = page.get("comparison") or {}
    if "declared_profile" in shapes:
        details = comparison.get("details") or comparison.get("detail_values")
        if not details:
            details = list((metadata.get("detail_labels") or {}).get(indicator_id, {}))
        if details:
            result.append(("detail", tuple(str(value) for value in details)))
        sexes = comparison.get("sexes")
        if sexes:
            result.append(("sex", tuple(str(value) for value in sexes)))
    if "ordered_series" in shapes:
        route = (metadata.get("owned_series_routes") or {}).get(indicator_id, {})
        kind = page.get("axis_kind", route.get("axis_kind"))
        values = route.get("axis_values") or page.get("axis_values") or comparison.get("details")
        if kind:
            result.append((kind, tuple(str(v) for v in values or ())))
    collection = (metadata.get("observed_collection_contracts") or {}).get(indicator_id, {})
    categories = collection.get("categories")
    if categories:
        result.append(("detail", tuple(str(value) for value in categories)))
    return tuple(result)


# Shapes whose published facts are addressable as Atelier Cellules (#1075).
# AEDAR grains/summaries, typed readings and observed collections are declared
# by their own producer contracts and are out of scope for this declaration.
_CELLULE_SHAPES = frozenset({"scalar", "declared_profile", "ordered_series"})


def _cellule_labels(metadata, indicator_id, comparison):
    """Producer-owned readable labels for coordinate values.

    ``comparison.labels`` is the page's own declaration; ``detail_labels`` is
    the theme-wide producer declaration the publisher validates the descriptor
    against. A value with no declared label (a year, a DPE class, the F/M keys)
    is its own readable label — never a key parsed or invented here.
    """
    labels = dict(comparison.get("labels") or {})
    labels.update((metadata.get("detail_labels") or {}).get(indicator_id, {}))
    return {str(key): str(value) for key, value in labels.items()}


def _cellule_detail_units(metadata, indicator_id):
    contract = (metadata.get("profile_contracts") or {}).get(indicator_id) or {}
    return dict(contract.get("detail_units") or {})


def _cellule_series_axis_values(comparison):
    """The published series axis.

    ``pipeline/R/publish_series.R:233`` writes the series descriptor's
    ``axis_values`` from ``page$comparison$details`` for the annual, OCS-GE and
    price series; ``comparison_axis_values`` (``page$trajectory$endpoints``) is
    a separate comparison facet, not the coordinate axis. Reading the same
    producer declaration avoids duplicating the value list in the catalogue.
    A producer that declares no ``details`` leaves its coordinates to the
    descriptor.
    """
    return tuple(str(value) for value in (comparison.get("details") or ()))


def _cellule_values(axis, declared_values, comparison, scalar_unit, labels, detail_units):
    fallback_unit = comparison.get("unit") or scalar_unit or None
    result = []
    for value in declared_values:
        # A profile's categories never inherit the indicator's scalar unit:
        # for a detail axis only the producer's per-detail unit or the page's
        # comparison unit can declare one; otherwise the unit is unknown (null).
        if axis == "detail":
            unit = detail_units.get(value) or comparison.get("unit") or None
        else:
            unit = fallback_unit
        result.append({
            "value": value,
            "label": labels.get(value, value),
            "unit": str(unit) if unit is not None else None,
        })
    return result


def _cellule_default_point(comparison, axes):
    point = {}
    detail = comparison.get("detail")
    if detail is not None:
        axis = "detail" if "detail" in axes else (axes[0] if axes else "detail")
        point[axis] = str(detail)
    if comparison.get("sex") is not None and "sex" in axes:
        point["sex"] = str(comparison["sex"])
    if not point:
        dimension = comparison.get("dimension")
        if dimension is None and comparison.get("dimensions"):
            dimension = comparison["dimensions"][0]
        if dimension is not None and axes:
            point[axes[0]] = str(dimension)
    return point or None


def _cellule_combinations(coordinates, declared_subset):
    """Valid coordinate combinations: a producer subset or the full product.

    The declaration is explicit either way: the cross product is declared when
    every combination exists, and a producer may declare a narrower set where
    it does not. No consumer has to infer which combinations are addressable.
    """
    if declared_subset is not None:
        return [dict(combination) for combination in declared_subset]
    combinations = [{}]
    for coordinate in coordinates:
        combinations = [
            {**combination, coordinate["name"]: value["value"]}
            for combination in combinations
            for value in coordinate["values"]
        ]
    return combinations


def _cellule_declaration(metadata, indicator_id, page, axes, axis_values, unit, shapes):
    """Project producer metadata into the public Cellule addressing declaration."""
    if not _CELLULE_SHAPES.intersection(shapes):
        return None
    producer_cellule = page.get("cellule") or {}
    if producer_cellule.get("declare") is False:
        # The producer, not the API, owns the decision to defer a coordinate
        # space to the published descriptor. Reasons are documented in
        # api/ENDPOINTS.md, not shipped as prose in the browser projection.
        return None
    comparison = page.get("comparison") or {}
    labels = _cellule_labels(metadata, indicator_id, comparison)
    detail_units = _cellule_detail_units(metadata, indicator_id)
    declared_values = {axis: tuple(str(value) for value in values)
                       for axis, values in axis_values}
    if "ordered_series" in shapes:
        series_values = _cellule_series_axis_values(comparison)
        if not series_values or not axes:
            # No producer-declared series axis: declare nothing and defer to
            # the descriptor. A comparison facet is never a coordinate axis.
            return None
        declared_values[axes[0]] = series_values
    coordinates = [
        {"name": axis,
         "values": _cellule_values(axis, declared_values.get(axis, ()),
                                   comparison, unit, labels, detail_units)}
        for axis in axes
    ]
    return {
        "coordinates": coordinates,
        "valid_combinations": _cellule_combinations(
            coordinates, producer_cellule.get("valid_combinations")),
        "default_point": _cellule_default_point(comparison, tuple(axes)),
    }


# #1076: the two AEDAR families declare their Cellule address spaces here.
# The vocabulary and axis names are owned by aedar_models (one declaration),
# never repeated as app literals. `typequ` is a real coordinate of the aggregate
# Cellule; the valid-combination space is the measure space (horizon × mode ×
# statistic or kind), orthogonal to the equipment axis.
from api.aedar_models import (AEDAR_CELLULE_AXES, AEDAR_PER_CELL_FAMILY,
                              AEDAR_SUMMARY_FAMILY, AEDAR_MEASURE_HORIZONS,
                              AEDAR_MEASURE_MODES, AEDAR_MEASURE_STATISTICS,
                              AEDAR_SUMMARY_KINDS, AEDAR_AGGREGATE_MODES,
                              aedar_axes_match_registered_measures)

_AEDAR_CELLULE_FAMILY = {
    "aedar_source_grain": AEDAR_PER_CELL_FAMILY,
    "aedar_territory_summary": AEDAR_SUMMARY_FAMILY,
}
# Axes whose product is enumerated in valid_combinations. `typequ` is declared
# as a coordinate with its full 235-value universe but is orthogonal, so the
# full address is any typequ × any declared measure point.
_AEDAR_COMBINATION_AXES = {
    AEDAR_PER_CELL_FAMILY: ("horizon", "mode", "statistic"),
    AEDAR_SUMMARY_FAMILY: ("horizon", "mode", "kind"),
}


def _aedar_cellule_axis_values():
    if not aedar_axes_match_registered_measures():
        raise ValueError("AEDAR declared axes do not reconstruct the registered measures")
    return {
        "horizon": AEDAR_MEASURE_HORIZONS,
        "mode": AEDAR_MEASURE_MODES,
        "statistic": AEDAR_MEASURE_STATISTICS,
        "kind": AEDAR_SUMMARY_KINDS,
        "summary_mode": AEDAR_AGGREGATE_MODES,
    }


def _aedar_typequ_universe(contract_dir, filename):
    """Fail-closed validation of the producer Typequ universe (count is declared)."""
    if not filename:
        raise ValueError("typequ universe: declaration is missing")
    payload = json.loads((contract_dir / filename).read_text(encoding="utf-8"))
    if payload.get("contract") != "aedar-typequ-universe-v1":
        raise ValueError("typequ universe: unknown producer contract")
    count = payload.get("registry_count")
    if not isinstance(count, int) or isinstance(count, bool) or count < 1:
        raise ValueError("typequ universe: registry count is missing")
    values = payload.get("values")
    if not isinstance(values, list) or len(values) != count:
        raise ValueError(f"typequ universe: expected {count} values, found "
                         f"{len(values) if isinstance(values, list) else 0}")
    codes = set()
    orders = []
    for value in values:
        code = value.get("value")
        if not isinstance(code, str) or not code:
            raise ValueError("typequ universe: a value code is missing")
        if code in codes:
            raise ValueError(f"typequ universe: duplicate value {code}")
        codes.add(code)
        if not value.get("label"):
            raise ValueError(f"typequ universe: value {code} label is missing")
        for parent in ("domain", "subdomain"):
            group = value.get(parent)
            if not isinstance(group, dict):
                raise ValueError(f"typequ universe: value {code} {parent} is missing")
            for key in ("code", "label"):
                if not group.get(key):
                    raise ValueError(f"typequ universe: value {code} {parent} {key} is missing")
        gamme = value.get("gamme")
        if (not isinstance(gamme, dict) or set(gamme) != {"status", "label"}
                or gamme["status"] not in {"classified", "hors_gamme", "absent"}):
            raise ValueError(f"typequ universe: value {code} gamme is not declared")
        if gamme["status"] == "absent":
            if gamme["label"] is not None:
                raise ValueError(f"typequ universe: value {code} absent gamme carries a label")
        elif not isinstance(gamme["label"], str) or not gamme["label"]:
            raise ValueError(f"typequ universe: value {code} gamme label is missing")
        order = value.get("source_order")
        if not isinstance(order, int) or isinstance(order, bool) or not 1 <= order <= count:
            raise ValueError(f"typequ universe: value {code} source order is missing")
        orders.append(order)
    if sorted(orders) != list(range(1, count + 1)):
        raise ValueError(f"typequ universe: source order is not a complete 1..{count} axis")
    return payload, tuple(values)


def _aedar_cellule_declaration(resource_id, kind, declarations, contract_path):
    """Project and validate the producer's AEDAR Cellule declaration."""
    family = _AEDAR_CELLULE_FAMILY[kind]
    combination_axes = _AEDAR_COMBINATION_AXES[family]
    expected = _aedar_cellule_axis_values()
    declaration = declarations.get(resource_id)
    if not isinstance(declaration, dict) or declaration.get("family") != family:
        raise ValueError(f"{family}: declaration is missing for {resource_id}")
    declared_coordinates = declaration.get("coordinates")
    if not isinstance(declared_coordinates, list) or [
            coordinate.get("name") for coordinate in declared_coordinates] != list(combination_axes):
        raise ValueError(f"{family}: coordinate axes are missing or reordered")
    coordinate_values = {}
    coordinates = []
    for coordinate in declared_coordinates:
        axis = coordinate["name"]
        axis_values = coordinate.get("values")
        if not isinstance(axis_values, list) or not axis_values:
            raise ValueError(f"{family}: coordinate {axis} values are missing")
        expected_values = (expected["summary_mode"] if axis == "mode" and family == AEDAR_SUMMARY_FAMILY
                           else expected[axis])
        keys = []
        for value in axis_values:
            key = value.get("value")
            if not key or not value.get("label"):
                raise ValueError(f"{family}: coordinate {axis} label is missing")
            keys.append(str(key))
        if set(keys) != set(expected_values) or len(keys) != len(expected_values):
            raise ValueError(f"{family}: coordinate {axis} values are incomplete")
        coordinate_values[axis] = set(keys)
        coordinates.append({"name": axis, "values": [
            {"value": str(value["value"]), "label": value["label"],
             "unit": value.get("unit")} for value in axis_values]})
    combinations = declaration.get("valid_combinations")
    full_product = [dict(zip(combination_axes, point)) for point in itertools.product(
        *(coordinate_values[axis] for axis in combination_axes))]
    if (not isinstance(combinations, list) or len(combinations) != len(full_product)
            or {frozenset(point.items()) for point in combinations} !=
            {frozenset(point.items()) for point in full_product}):
        raise ValueError(f"{family}: valid combination set is incomplete")
    if family == AEDAR_PER_CELL_FAMILY:
        payload, universe = _aedar_typequ_universe(
            Path(contract_path).parent, declaration.get("typequ_universe"))
        # The Typequ universe is a declared coordinate of the Cellule, not a
        # side list: the aggregate is addressable as equipment × horizon ×
        # mode × statistic. Its structured fields carry label, domain,
        # subdomain, gamme and source order verbatim.
        coordinates.insert(0, {"name": "typequ", "values": [
            {"value": value["value"], "label": value["label"],
             "domain": value["domain"], "subdomain": value["subdomain"],
             "gamme": value["gamme"], "source_order": value["source_order"]}
            for value in universe]})
        projection = {"family": family, "coordinates": coordinates,
                      "valid_combinations": combinations,
                      "registry_count": payload["registry_count"],
                      "sources": payload["sources"]}
    else:
        if declaration.get("no_summary_modes") != ["transit_gain"]:
            raise ValueError(f"{family}: undeclared summary modes are missing")
        projection = {"family": family, "coordinates": coordinates,
                      "valid_combinations": combinations,
                      "no_summary_modes": list(declaration["no_summary_modes"])}
    return projection


def _aedar_families_disjoint(declarations):
    """Fail if a producer declaration lets one AEDAR family answer the other's address."""
    per_cell, summary = set(), set()
    for declaration in declarations.values():
        axes = {coordinate["name"] for coordinate in declaration.get("coordinates", ())}
        if declaration.get("family") == AEDAR_PER_CELL_FAMILY:
            per_cell |= axes
        elif declaration.get("family") == AEDAR_SUMMARY_FAMILY:
            summary |= axes
    if per_cell & {"kind"} or summary & {"statistic", "typequ"}:
        raise ValueError("AEDAR families overlap: a family declares the other's distinguishing axis")


_FIELDS_BY_SHAPE = {
    # Provenance, status/availability, units, axes and descriptors are always
    # returned where the shape declares them; they are not projection fields.
    "scalar": ("value", "support_count", "denominator_count"),
    "declared_profile": ("value",),
    "ordered_series": ("value",),
    "period_detail": ("value",),
    "anchored_membership": ("detail", "label", "rider", "anchor_count", "availability"),
    "named_reference": ("value",),
    "distribution": ("value",),
}

_COMPARABLE_SHAPES = frozenset({
    "scalar", "declared_profile", "ordered_series", "period_detail", "distribution",
})
_COHORT_FACT_SHAPES = frozenset({
    "scalar", "declared_profile", "ordered_series", "period_detail", "anchored_membership",
})
# Request-time AEDAR comparison ranks (ADR-0039 amendments, #768/#859, the
# 2026-11-04 aggregate-ranks amendment #914 and the 2026-11-10 per-cell
# amendment #951): the focal rank, group size and tie count are computed per
# request from published aggregates. Both comparison intents grant them on
# every declared facet — per-cell measures and registry-wide aggregate readings
# alike — which supersedes #904's reference-only boundary for the fixed intent.
_AEDAR_COMPARISON_RANK_FIELDS = frozenset({"rank", "rank_size", "rank_ties"})
_AEDAR_SELECTED_COMPARISON_FIELDS = _AEDAR_COMPARISON_RANK_FIELDS


def _declared_source_identities(page, source_records, fallback):
    """Expose source identities that producer-declared vintages can return.

    A page may name one editorial source record whose vintages identify several
    independently sourced territorial observations (for example, one DPE
    snapshot per département). Discovery must authorize those exact native IDs
    without making the app infer them from source labels or dates.
    """
    source_keys = page.get("sources", (fallback,))
    if isinstance(source_keys, str):
        source_keys = (source_keys,)
    identities = []
    for source_key in source_keys:
        if not isinstance(source_key, str) or not source_key:
            continue
        identities.append(source_key)
        record = source_records.get(source_key) or {}
        for vintage in record.get("vintages", ()):
            vintage_id = vintage.get("id") if isinstance(vintage, dict) else None
            if isinstance(vintage_id, str) and vintage_id:
                identities.append(vintage_id)
    return tuple(dict.fromkeys(identities))


def _producer_capabilities(metadata, theme_id, indicator_ids):
    """Validate the narrow producer declarations used by runtime discovery.

    Missing `map_layers` and missing per-indicator entries retain the browser's
    established `!== false` default. Scalar count availability is meaningful
    only in `scalar_contracts`; page/editorial metadata cannot grant it.
    """
    known_indicators = set(indicator_ids)
    if "map_layers" not in metadata:
        map_layers = {}
    else:
        map_layers = metadata["map_layers"]
        if not isinstance(map_layers, dict):
            raise ValueError(f"Invalid producer map-layer capabilities: {theme_id}")
        for indicator_id, eligible in map_layers.items():
            if not isinstance(indicator_id, str) or indicator_id not in known_indicators:
                raise ValueError(
                    f"Unknown producer map layer indicator: {theme_id}/{indicator_id}")
            if type(eligible) is not bool:
                raise ValueError(
                    f"Invalid producer map-layer capability: {theme_id}/{indicator_id}")

    if "scalar_contracts" not in metadata:
        scalar_contracts = {}
    else:
        scalar_contracts = metadata["scalar_contracts"]
        if not isinstance(scalar_contracts, dict):
            raise ValueError(f"Invalid producer scalar contracts: {theme_id}")
        for indicator_id, contract in scalar_contracts.items():
            if not isinstance(indicator_id, str) or not isinstance(contract, dict):
                raise ValueError(
                    f"Unknown producer scalar contract indicator: {theme_id}/{indicator_id}")
            # #1048 slice 2 keeps the retired snapshot ids as retirement
            # receipts in scalar_contracts after removing them from
            # indicator_keys. They are audit-only declarations, never
            # discoverable resources: tolerate them here instead of failing
            # every consumer of the producer catalogue at import time.
            if indicator_id not in known_indicators:
                if contract.get("serving_disposition") == SERVING_DISPOSITION_EXCLUDED_LEGACY:
                    continue
                raise ValueError(
                    f"Unknown producer scalar contract indicator: {theme_id}/{indicator_id}")
            if ("counts_available" in contract
                    and type(contract["counts_available"]) is not bool):
                raise ValueError(
                    f"Invalid scalar counts capability: {theme_id}/{indicator_id}")
    return map_layers, scalar_contracts


def _validate_cellule_combination(resource, coordinates):
    """#1075: a declared combination set is authoritative across its axes.

    A partial declaration names only some axes; a request naming an axis the
    declaration omits has no covering point and is rejected by name.
    """
    combinations = (resource.cellule or {}).get("valid_combinations") or []
    if not combinations or not coordinates:
        return
    requested_axes = sorted(coordinates)
    covering = [point for point in combinations if set(requested_axes) <= set(point)]
    if not covering:
        raise ValueError("coordinate combination is not declared for this resource")
    allowed = {tuple(point.get(axis) for axis in requested_axes) for point in covering}
    for point in itertools.product(*(coordinates[axis] for axis in requested_axes)):
        if point not in allowed:
            raise ValueError("coordinate combination is not declared for this resource")


def _validate_aedar_address(resource, coordinates, intent_kind):
    """Validate a declared AEDAR address; the deprecated alias keeps legacy rules.

    One resolver (`aedar_resolve`) owns family separation, intent shape and the
    alias semantics, so admission cannot disagree with preflight or read.
    """
    from api.aedar_models import AEDARAddressError, aedar_resolve
    try:
        _typequ, _measures, _family, is_alias = aedar_resolve(
            resource.resource_kind, coordinates, intent_kind)
    except AEDARAddressError as exc:
        raise ValueError(str(exc)) from exc
    if is_alias:
        # Frozen pre-#1076 path: value/combination declarations did not exist.
        return
    cellule = resource.cellule or {}
    combination_axes = set().union(*(set(point) for point in cellule.get("valid_combinations", ())))
    declared_values = {coordinate["name"]: {value["value"] for value in coordinate["values"]}
                       for coordinate in cellule.get("coordinates", ())}
    # `typequ` is orthogonal to the measure combination space: its values are
    # checked against the declared universe and the gate runs on measure axes.
    constrained = {}
    for axis, values in (coordinates or {}).items():
        if axis in declared_values and not set(values) <= declared_values[axis]:
            raise ValueError("coordinate value is not declared for this resource")
        if axis in combination_axes:
            constrained[axis] = values
    _validate_cellule_combination(resource, constrained)


def validate_resource_item(item, catalogue: ResourceCatalogue) -> IndicatorResource:
    """Apply producer-declared resource, target, field, axis and intent rules."""
    resources = catalogue.resources_by_id
    resource = resources.get(item.resource)
    if resource is None:
        raise ValueError("unknown semantic resource")
    if item.target.kind not in resource.target_kinds:
        raise ValueError("target kind is not declared for this resource")
    if item.target.kind == "territory_cohort":
        if item.intent.kind != "facts":
            raise ValueError("territory cohort targets are facts-only")
        if item.target.type not in resource.allowed_levels:
            raise ValueError("resource is not declared for this cohort level")
    if item.target.kind == "named_reference" and item.target.id not in resource.target_ids:
        raise ValueError("named reference identity is not declared for this resource")
    if item.fields is not None:
        if resource.resource_kind == "aedar_source_grain" and item.intent.kind == "facts":
            from api.aedar_models import AEDAR_MEASURE_KEYS
            supported = {"measures." + key for key in AEDAR_MEASURE_KEYS}
        elif (resource.resource_kind == "aedar_territory_summary"
              and item.intent.kind == "facts"):
            supported = set(resource.fields)
        elif (resource.resource_kind == "aedar_territory_summary"
              and item.intent.kind in {"fixed_comparison", "selected_comparison"}):
            supported = set(resource.fields) | set(_AEDAR_COMPARISON_RANK_FIELDS) | {"group_value", "value"}
        elif (resource.resource_kind == "aedar_source_grain"
                and item.intent.kind == "selected_comparison"):
            supported = set(resource.fields) | set(_AEDAR_SELECTED_COMPARISON_FIELDS)
        elif (resource.resource_kind == "aedar_source_grain"
                and item.intent.kind == "fixed_comparison"):
            # ADR-0039's 2026-11-10 amendment (#951): the fixed intent serves
            # the request-time rank fields on every declared facet, per-cell
            # measures included, over the context's own resolved peer group.
            supported = set(resource.fields) | set(_AEDAR_COMPARISON_RANK_FIELDS)
        else:
            supported = (set(resource.fields) if resource.resource_kind != "indicator" else {
            "focal_value", "median", "rank", "rank_size", "rank_ties",
            "selected_member_count", "eligible_count", "missing_count", "mean", "mean_curve",
            } if item.intent.kind in {"fixed_comparison", "selected_comparison"} else
                {field for shape in resource.shapes for field in _FIELDS_BY_SHAPE.get(shape, ())})
            single_shape = set(resource.shapes) if len(resource.shapes) == 1 else set()
            if (resource.resource_kind == "indicator" and "ordered_series" in resource.shapes
                    and item.intent.kind in {"fixed_comparison", "selected_comparison"}):
                supported.add("axis_comparisons")
                if "scalar" in resource.shapes:
                    supported.add("scalar_facet")
                    if ("axis_comparisons" in item.fields and "scalar_facet" in item.fields):
                        # Peer ranks are requested only for the explicitly
                        # projected pooled scalar facet, never for ordinary
                        # ordered-series comparisons.
                        supported.add("member_ranks")
            if (resource.resource_kind == "indicator" and item.intent.kind == "facts" and
                    item.target.kind == "territory_cohort" and "scalar" in resource.shapes and
                    "ordered_series" in resource.shapes):
                supported.add("scalar_facet")
            if (resource.resource_kind == "indicator" and
                    ((item.intent.kind == "selected_comparison" and
                      single_shape in ({"scalar"}, {"declared_profile"})) or
                     (item.intent.kind == "fixed_comparison" and single_shape == {"scalar"}))):
                supported.add("member_ranks")
        if len(item.fields) != len(set(item.fields)) or not set(item.fields) <= supported:
            raise ValueError("field is not declared for this resource")
    if item.intent.kind != "facts" and item.target.kind != "territory":
        raise ValueError("comparison intents require a territory target")
    if resource.resource_kind in AEDAR_CELLULE_AXES:
        # The AEDAR resolver owns axis names (declared coordinates only, plus
        # the deprecated measure alias), family separation and intent shape —
        # including the 422 for a comparison that omits its coordinates.
        if item.target.kind == "territory_cohort":
            # #1078: one shared cohort-address guard; no rule duplicated here.
            from api.aedar_models import AEDARAddressError, aedar_cohort_cellule
            try:
                aedar_cohort_cellule(resource.resource_kind, item.coordinates, item.intent.kind)
            except AEDARAddressError as exc:
                raise ValueError(str(exc)) from exc
        _validate_aedar_address(resource, item.coordinates, item.intent.kind)
    elif item.coordinates is not None:
        axes = dict(resource.axis_values)
        # `resource.axes` are the producer-declared public coordinate axis names.
        # Storage axis keys in `axis_values` may differ (e.g. anchored
        # membership exposes `membership` over the `detail` storage key);
        # declaration, not storage shape, decides which axes exist.
        allowed_axes = set(resource.axes) | set(axes)
        if set(item.coordinates) - allowed_axes:
            raise ValueError("coordinate axis is not declared for this resource")
        if any(axis in axes and axes[axis] and not set(values) <= set(axes[axis])
               for axis, values in item.coordinates.items()):
            raise ValueError("coordinate value is not declared for this resource")
        _validate_cellule_combination(resource, item.coordinates)
    if (resource.resource_kind in AEDAR_CELLULE_AXES and
            item.intent.kind == "fixed_comparison" and
            item.intent.context not in resource.context_values):
        raise ValueError("comparison context is not declared for this resource")
    if (resource.resource_kind == "indicator" and item.intent.kind == "fixed_comparison"
            and item.intent.context != "default"):
        raise ValueError("comparison context is not declared for this resource")
    if (item.intent.kind == "selected_comparison"
            and item.intent.statistic is not None
            and "declared_profile" not in resource.shapes):
        # Equal-weight means are defined over declared-profile member cells.
        # Scalar, series, collection and AEDAR selections keep their own
        # declared statistic and never infer a mean from a request flag.
        raise ValueError("comparison statistic is not declared for this resource")
    if item.intent.kind not in resource.intents:
        raise ValueError("intent is not declared for this resource")
    return resource


def _declared_measure_facets(declaration, resource_id) -> dict[str, dict]:
    """Validate and project producer per-measure comparison facets.

    A declared facet map must cover exactly the registered AEDAR comparison
    vocabulary — the 312 per-cell measures plus the registry-wide aggregate
    readings — so a selected-comparison coordinate cannot be silently omitted;
    an `aedar_source_grain` resource that declares `selected_comparison` must
    declare the complete map (ADR-0039's AEDAR selection-comparison amendment,
    #768/#859, and the 2026-11-04 aggregate-ranks amendment, #914). Directions
    follow the ADR-0015 vocabulary (`high`/`low`); the aggregate readings are
    ranked high-is-better facets.
    """
    declared = declaration.get("measure_facets")
    intents = tuple(declaration.get("intents", ("facts",)))
    if declared is None:
        if declaration.get("kind") == "aedar_source_grain" and "selected_comparison" in intents:
            raise ValueError(f"Incomplete measure facets for producer resource: {resource_id}")
        return {}
    if declaration.get("kind") != "aedar_source_grain" or not isinstance(declared, dict):
        raise ValueError(f"Invalid measure facets for producer resource: {resource_id}")
    from api.aedar_models import AEDAR_AGGREGATE_READINGS, AEDAR_MEASURE_KEYS
    if set(declared) != set(AEDAR_MEASURE_KEYS) | set(AEDAR_AGGREGATE_READINGS):
        raise ValueError(f"Incomplete measure facets for producer resource: {resource_id}")
    facets = {}
    for measure, facet in declared.items():
        if (not isinstance(facet, dict) or set(facet) != {"facet", "direction", "ranked"}
                or not isinstance(facet["facet"], str) or not facet["facet"]
                or not facet["facet"].replace("_", "").isalnum()
                or facet["direction"] not in ("high", "low")
                or not isinstance(facet["ranked"], bool)):
            raise ValueError(f"Invalid measure facet declaration for producer resource: {resource_id}")
        if measure in AEDAR_AGGREGATE_READINGS and (facet["direction"] != "high"
                                                    or not facet["ranked"]):
            # Registry-wide overview aggregate readings are ranked
            # high-is-better comparison facets (ADR-0039, 2026-11-04, #914).
            raise ValueError(f"Invalid measure facet declaration for producer resource: {resource_id}")
        facets[measure] = dict(facet)
    return facets


def project_resource_catalogue(metadata_by_theme: dict,
                               semantic_contract_path: str | Path | None = None) -> ResourceCatalogue:
    """Project already-published producer declarations; never read metadata files."""
    declarations = []
    resources = []
    by_key = {}
    loaded_metadata = [(f"{theme}.json", metadata)
                       for theme, metadata in metadata_by_theme.items()]
    if not loaded_metadata and semantic_contract_path is None:
        raise ValueError("No producer resource descriptors found")

    for name, metadata in loaded_metadata:
        theme_id = metadata.get("theme")
        if not isinstance(theme_id, str) or not theme_id:
            raise ValueError(f"{name}: missing producer theme identity")
        source_records = metadata.get("source_records") or {}
        source_map = metadata.get("sources") or {}
        pages = metadata.get("indicator_pages") or {}
        indicator_ids = metadata.get("indicator_keys", [])
        map_layers, scalar_contracts = _producer_capabilities(
            metadata, theme_id, indicator_ids)
        reference_aliases = {
            route.get("reference_indicator"): indicator_id
            for indicator_id, route in (metadata.get("owned_series_routes") or {}).items()
            if route.get("reference_read_route") and route.get("reference_indicator")
        }
        for indicator_id in indicator_ids:
            source_id = source_map.get(indicator_id)
            source = source_records.get(source_id) if source_id is not None else None
            disposition = (source or {}).get("serving_disposition", "retained")
            shapes = _declared_shapes(metadata, indicator_id, pages.get(indicator_id, {}), reference_aliases)
            declaration = IndicatorDeclaration(
                theme_id, indicator_id, source_id, disposition, shapes)
            key = (theme_id, indicator_id)
            if key in by_key:
                raise ValueError(f"duplicate producer indicator declaration: {theme_id}/{indicator_id}")
            by_key[key] = declaration
            declarations.append(declaration)

            if disposition == SERVING_DISPOSITION_EXCLUDED_LEGACY:
                continue
            if disposition != "retained":
                raise ValueError(f"unknown producer serving disposition: {disposition}")
            parent_indicator = reference_aliases.get(indicator_id)
            collection = (metadata.get("observed_collection_contracts") or {}).get(indicator_id, {})
            page_descriptor = pages.get(indicator_id) or pages.get(parent_indicator) or collection
            if not source_id or source is None or not page_descriptor or not shapes:
                raise ValueError(f"unclassified producer indicator: {theme_id}/{indicator_id}")
            if parent_indicator is None and page_descriptor.get("indicator", indicator_id) != indicator_id:
                raise ValueError(f"producer indicator identity mismatch: {theme_id}/{indicator_id}")

            profile_dimensions = page_descriptor.get("pyramid", {}).get("dimensions", [])
            axes = tuple(profile_dimensions)
            if parent_indicator is not None:
                route = (metadata.get("owned_series_routes") or {}).get(parent_indicator, {})
                axes = (route["axis_kind"],) if route.get("axis_kind") else ()
            elif "ordered_series" in shapes:
                route = (metadata.get("owned_series_routes") or {}).get(indicator_id, {})
                axis_kind = page_descriptor.get("axis_kind", route.get("axis_kind"))
                if axis_kind:
                    axes = (axis_kind,)
            if collection.get("kind") == "period_detail":
                axes = ("period", "detail")
            elif collection.get("kind") == "anchored_membership":
                axes = ("membership",)
            axis_values = _axis_values(metadata, indicator_id, page_descriptor, shapes, parent_indicator)
            if "declared_profile" in shapes:
                # Declared profile axes come from the published profile contract
                # (or the pyramid dimensions), not only from the optional
                # pyramid-specific page decoration.
                axes = tuple(dict.fromkeys((*axes, *(axis for axis, _values in axis_values))))
            comparison_declared = (
                bool(page_descriptor.get("comparison"))
                or bool((metadata.get("scalar_contracts") or {}).get(indicator_id, {}).get(
                    "comparison_facet"))
            )
            intents = ("facts",)
            if (parent_indicator is None and comparison_declared
                    and _COMPARABLE_SHAPES.intersection(shapes)):
                intents += ("fixed_comparison", "selected_comparison")
            target_kinds = []
            if "named_reference" in shapes:
                target_kinds.append("named_reference")
            if any(shape != "named_reference" for shape in shapes):
                target_kinds.append("territory")
            if _COHORT_FACT_SHAPES.intersection(shapes):
                target_kinds.append("territory_cohort")
            resources.append(IndicatorResource(
                resource_id=indicator_id,
                theme_id=theme_id,
                indicator_id=indicator_id,
                label=page_descriptor.get("label", metadata.get("indicator_labels", {}).get(indicator_id, indicator_id)),
                unit=page_descriptor.get("unit", ""),
                direction=page_descriptor.get("direction", "none"),
                # Scalar facts have their own producer-serving eligibility.
                # Dedicated indicator-page admission is presentation, not a
                # restriction on factual territory reads (including a dual
                # scalar/series resource such as prix_m2).
                allowed_levels=(tuple(scalar_contracts[indicator_id]["allowed_levels"])
                    if "scalar" in shapes else tuple(page_descriptor.get(
                        "levels", page_descriptor.get("serving_levels", collection.get("levels", ()))))),
                sources=_declared_source_identities(page_descriptor, source_records, source_id),
                shapes=shapes,
                axes=axes,
                axis_values=axis_values,
                target_kinds=tuple(target_kinds),
                target_ids=((str((metadata.get("owned_series_routes") or {})
                                 .get(parent_indicator, {}).get("reference_id")),)
                            if parent_indicator is not None else ()),
                dynamic_axes=tuple(axis for axis, values in axis_values
                    if not values or "ordered_series" in shapes or "declared_profile" in shapes),
                fields=tuple(dict.fromkeys(
                    field for shape in shapes for field in _FIELDS_BY_SHAPE.get(shape, ()))),
                intents=intents,
                map_eligible=map_layers.get(indicator_id, True),
                counts_available=(
                    "scalar" in shapes
                    and scalar_contracts.get(indicator_id, {}).get("counts_available", False)
                ),
                cellule=_cellule_declaration(
                    metadata, indicator_id, page_descriptor, axes, axis_values,
                    page_descriptor.get("unit", ""), shapes),
            ))

    # A source-declared key cannot silently disappear because another map was
    # edited independently. The inventory is exact at (theme, indicator) grain.
    for _name, metadata in loaded_metadata:
        for indicator_id in metadata.get("sources", {}):
            if (metadata["theme"], indicator_id) not in by_key:
                raise ValueError(f"unaccounted producer indicator source: {metadata['theme']}/{indicator_id}")

    declarations.sort(key=lambda item: (item.theme_id, item.indicator_id))
    if semantic_contract_path is not None:
        contract_path = Path(semantic_contract_path)
        contract = json.loads(contract_path.read_text(encoding="utf-8"))
        if contract.get("contract") != "producer-semantic-resources-v1":
            raise ValueError("Invalid producer semantic resource contract")
        cellule_declarations = contract.get("cellule_declarations") or {}
        _aedar_families_disjoint(cellule_declarations)
        semantic_declarations = list(contract.get("resources", []))
        semantic_metadata = {}
        for _name, theme_metadata in loaded_metadata:
            semantic_metadata[theme_metadata["theme"]] = theme_metadata
            for declaration in theme_metadata.get("semantic_resources", []):
                semantic_declarations.append({**declaration, "theme_id": theme_metadata["theme"]})
        for declaration in semantic_declarations:
            resource_id = declaration["resource_id"]
            kind = declaration["kind"]
            axes = tuple(declaration.get("axes", ()))
            theme_id = declaration.get("theme_id", "")
            theme_metadata = semantic_metadata.get(theme_id, {})
            groups = tuple(declaration.get("groups", ()))
            identifiers = [declaration.get("storage_relation"), declaration.get("publication_table")]
            identifiers.extend(side.get(key) for side in declaration.get("side_relations", [])
                               for key in ("storage_relation", "publication_table"))
            identifiers.extend(declaration.get("fields", ()))
            identifiers.extend(field for side in declaration.get("side_relations", [])
                               for field in side.get("fields", ()))
            if any(side.get("same_content_version_as") not in (None, "resource")
                   for side in declaration.get("side_relations", [])):
                raise ValueError(f"Invalid semantic evidence dependency for resource: {resource_id}")
            if any(value is not None and (not isinstance(value, str) or
                    not value.replace("_", "").isalnum()) for value in identifiers):
                raise ValueError(f"Invalid storage identifier for producer resource: {resource_id}")
            sources = tuple(declaration.get("sources", ()))
            source_keys = tuple(declaration.get("source_keys", ()))
            producer_sources = theme_metadata.get("sources", {}) or {}
            sources += tuple(producer_sources.get(key, key) for key in source_keys)
            declared_sources = set((theme_metadata.get("source_records") or {}).keys())
            declared_sources.update(producer_sources.values())
            if any(source not in declared_sources for source in sources):
                raise ValueError(f"Unknown producer source identity for semantic resource: {resource_id}")
            measure_facets = _declared_measure_facets(declaration, resource_id)
            if kind == "aedar_territory_summary":
                from api.aedar_models import AEDAR_AGGREGATE_READINGS
                aggregate = next((resource for resource in resources
                                  if resource.resource_id == "aedar_territorial_aggregate"), None)
                if (aggregate is None or set(AEDAR_AGGREGATE_READINGS) - set(aggregate.measure_facets)):
                    raise ValueError("AEDAR summary facets must match producer-declared aggregate readings")
                measure_facets = {measure: aggregate.measure_facets[measure]
                                  for measure in AEDAR_AGGREGATE_READINGS}
            aedar_cellule = (_aedar_cellule_declaration(resource_id, kind, cellule_declarations,
                                                         contract_path)
                             if kind in AEDAR_CELLULE_AXES else None)
            if aedar_cellule is not None:
                # Discovery exposes the declared Cellule coordinates as both the
                # resource's axes and its coordinate values. `context` is an
                # intent facet, never a coordinate — the contract's declared
                # context values remain available through `context_values`.
                public_axes = tuple(coordinate["name"] for coordinate in aedar_cellule["coordinates"])
                public_axis_values = ()
            else:
                public_axes = axes
                public_axis_values = ()
            resources.append(IndicatorResource(
                resource_id=resource_id, theme_id=theme_id, indicator_id=resource_id,
                label=declaration.get("label", theme_metadata.get("label", resource_id)),
                unit="", direction="none",
                allowed_levels=tuple(declaration.get("allowed_levels", ("commune", "epci", "departement", "region"))),
                sources=sources, shapes=(kind,),
                axes=public_axes, axis_values=public_axis_values,
                target_kinds=(("territory", "territory_cohort")
                              if kind in AEDAR_CELLULE_AXES else ("territory",)),
                target_ids=(),
                dynamic_axes=tuple(declaration.get("dynamic_axes", ())), fields=tuple(dict.fromkeys([
                    *declaration["fields"],
                    *(side["field"] for side in declaration.get("side_relations", ())),
                ])),
                intents=tuple(declaration.get("intents", ("facts",))), resource_kind=kind,
                context_values=tuple(declaration.get("axes", {}).get("context", ())),
                storage_relation=declaration.get("storage_relation"),
                publication_table=declaration.get("publication_table"),
                side_relations=tuple(declaration.get("side_relations", ())),
                measure_facets=measure_facets,
                cellule=aedar_cellule,
                publication_resource_id=declaration.get("publication_resource_id", resource_id)))
    resources.sort(key=lambda item: (item.theme_id, item.indicator_id))
    excluded = tuple(item for item in declarations
                     if item.disposition == SERVING_DISPOSITION_EXCLUDED_LEGACY)
    return ResourceCatalogue(tuple(declarations), tuple(resources), excluded)


def database_resource_catalogue(conn, grammar: ResourceGrammar) -> ResourceCatalogue:
    """Intersect image grammar, live registry rows and version-bound descriptors.

    One storage resource may project more than one grammar identity (AEDAR's
    aggregate and summary); that mapping is declared by the grammar, never by an
    API literal. Retirement and descriptor-version mismatch disappear on the
    next request without rebuilding the image.
    """
    try:
        rows = conn.execute(
            """SELECT p.resource_id,p.content_version,d.resource_id,d.descriptor,
                      COALESCE(p.content_version=d.content_version AND NOT p.retired,false) AS live
               FROM resource_publication_descriptor d
               LEFT JOIN resource_publication p
                 ON d.publication_resource_id=p.resource_id
                AND d.content_version=p.content_version
               ORDER BY p.resource_id,d.resource_id"""
        ).fetchall()
    except Exception as error:
        if getattr(error, "sqlstate", None) in ("42P01", "42703"):
            raise HTTPException(503, "Resource publication catalogue is unavailable") from error
        raise

    semantic_by_id = grammar.semantic_by_id
    resources = []
    declarations = []
    admission = []
    seen_live = set()
    seen_admission = set()
    semantic_projection = None
    try:
        # Grammar identities remain admissible even when their registry row is
        # absent, so a named read reaches the typed registry 503. They are not
        # discovered until a live version-bound descriptor exists.
        semantic_projection = project_resource_catalogue({}, grammar.contract_path)
        admission.extend(semantic_projection.resources)
        seen_admission.update(resource.resource_id for resource in admission)
        for publication_id, content_version, resource_id, raw_descriptor, live in rows:
            descriptor = (json.loads(raw_descriptor)
                          if isinstance(raw_descriptor, str) else raw_descriptor)
            if not isinstance(descriptor, dict):
                raise ValueError("published resource descriptor must be an object")
            kind = descriptor.get("kind")
            if resource_id in semantic_by_id:
                expected = semantic_by_id[resource_id]
                if (kind != expected.get("kind") or
                        expected.get("publication_resource_id", resource_id) != publication_id):
                    raise ValueError(f"published semantic descriptor disagrees with grammar: {resource_id}")
                matches = [resource for resource in semantic_projection.resources
                           if resource.resource_id == resource_id]
                if len(matches) != 1:
                    raise ValueError(f"published semantic descriptor is not projectable: {resource_id}")
                resource = matches[0]
            elif kind == "indicator":
                metadata = descriptor.get("metadata")
                if not isinstance(metadata, dict):
                    raise ValueError("indicator discovery metadata is missing")
                projected = project_resource_catalogue({metadata["theme"]: metadata})
                matches = [item for item in projected.resources
                           if item.resource_id == resource_id]
                if len(matches) != 1:
                    raise ValueError(f"published indicator descriptor is not projectable: {resource_id}")
                if resource_id != publication_id:
                    routes = metadata.get("owned_series_routes") or {}
                    route = routes.get(resource_id) or routes.get(publication_id)
                    is_alias = (isinstance(route, dict)
                                and routes.get(publication_id) is route
                                and route.get("reference_read_route")
                                and route.get("reference_indicator") == resource_id)
                    page = (metadata.get("indicator_pages") or {}).get(resource_id) or {}
                    is_dataset = (isinstance(route, dict)
                                  and routes.get(resource_id) is route
                                  and (route.get("dataset_id")
                                       or page.get("series_dataset_id")) == publication_id)
                    if not (is_alias or is_dataset):
                        raise ValueError(f"published indicator descriptor disagrees with registry: {resource_id}")
                resource = matches[0]
                if resource_id != publication_id:
                    resource = replace(resource, publication_resource_id=publication_id)
                declarations.extend(projected.declarations)
            else:
                raise ValueError(f"published resource shape is not registered: {resource_id}")
            if not content_version:
                raise ValueError("published resource descriptor has no content version")
            if resource_id not in seen_admission:
                admission.append(resource)
                seen_admission.add(resource_id)
            if live and resource_id not in seen_live:
                resources.append(resource)
                seen_live.add(resource_id)
    except (KeyError, TypeError, ValueError) as error:
        raise HTTPException(503, "Published resource descriptor is invalid") from error

    resources.sort(key=lambda item: (item.theme_id, item.indicator_id))
    admission.sort(key=lambda item: (item.theme_id, item.indicator_id))
    return ResourceCatalogue(tuple(declarations), tuple(resources), (),
                             admission_resources=tuple(admission))
