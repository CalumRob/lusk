"""Producer-derived semantic resource metadata for API discovery.

The theme metadata files are the pipeline's producer declarations.  This module
projects their declared serving shapes; it does not maintain an API-side list of
indicator IDs or physical table names.
"""

from dataclasses import asdict, dataclass
from functools import lru_cache
import json
import os
from pathlib import Path


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
    resource_kind: str = "indicator"
    context_values: tuple[str, ...] = ()
    storage_relation: str | None = None
    publication_table: str | None = None
    side_relations: tuple[dict, ...] = ()


@dataclass(frozen=True)
class ResourceCatalogue:
    declarations: tuple[IndicatorDeclaration, ...]
    resources: tuple[IndicatorResource, ...]
    excluded: tuple[IndicatorDeclaration, ...]

    @property
    def resources_by_id(self) -> dict[str, IndicatorResource]:
        return {resource.resource_id: resource for resource in self.resources}

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
            for key in ("storage_relation", "publication_table"):
                declaration.pop(key, None)
            public_resources.append(declaration)
        return {
            "contract": "semantic-resource-catalogue-v1",
            "resources": public_resources,
        }


@lru_cache(maxsize=1)
def default_resource_catalogue() -> ResourceCatalogue:
    root = Path(__file__).resolve().parents[1]
    producer = Path(os.environ.get("LUSK_PRODUCER_METADATA_DIR", root / "pipeline" / "inst" / "extdata"))
    metadata = producer / "theme-metadata"
    return discover_indicator_resources(metadata, producer / "semantic-resource-contracts.json")


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


def validate_resource_item(item, catalogue: ResourceCatalogue) -> IndicatorResource:
    """Apply producer-declared resource, target, field, axis and intent rules."""
    resources = {resource.resource_id: resource for resource in catalogue.resources}
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
        else:
            supported = (set(resource.fields) if resource.resource_kind != "indicator" else {
            "focal_value", "median", "rank", "rank_size", "rank_ties",
            "selected_member_count", "eligible_count", "missing_count", "mean", "mean_curve",
        } if item.intent.kind in {"fixed_comparison", "selected_comparison"} else
            {field for shape in resource.shapes for field in _FIELDS_BY_SHAPE.get(shape, ())})
        if len(item.fields) != len(set(item.fields)) or not set(item.fields) <= supported:
            raise ValueError("field is not declared for this resource")
    if item.intent.kind != "facts" and item.target.kind != "territory":
        raise ValueError("comparison intents require a territory target")
    if item.coordinates is not None:
        axes = dict(resource.axis_values)
        # `resource.axes` are the producer-declared public coordinate axis names.
        # Storage axis keys in `axis_values` may differ (e.g. anchored
        # membership exposes `membership` over the `detail` storage key) and
        # dynamic domains (AEDAR `typequ`/`measure`) have no static values, so
        # declaration, not storage shape, decides which axes exist.
        allowed_axes = set(resource.axes) | set(axes)
        if set(item.coordinates) - allowed_axes:
            raise ValueError("coordinate axis is not declared for this resource")
        if any(axis in axes and axes[axis] and not set(values) <= set(axes[axis])
               for axis, values in item.coordinates.items()):
            raise ValueError("coordinate value is not declared for this resource")
        if resource.resource_kind == "aedar_source_grain" and "context" in item.coordinates:
            raise ValueError("AEDAR comparison context belongs in fixed_comparison intent")
    if (resource.resource_kind == "aedar_source_grain" and
            item.intent.kind == "fixed_comparison" and
            item.intent.context not in resource.context_values):
        raise ValueError("comparison context is not declared for this resource")
    if (resource.resource_kind == "indicator" and item.intent.kind == "fixed_comparison"
            and item.intent.context != "default"):
        raise ValueError("comparison context is not declared for this resource")
    if item.intent.kind not in resource.intents:
        raise ValueError("intent is not declared for this resource")
    return resource


def discover_indicator_resources(metadata_directory: str | Path,
                                 semantic_contract_path: str | Path | None = None) -> ResourceCatalogue:
    """Validate and project all theme-scoped indicator declarations.

    A retained indicator must be covered by at least one producer-declared
    serving shape and a page descriptor. Explicitly excluded legacy source
    declarations stay visible in the audit result but never enter discovery.
    """
    declarations = []
    resources = []
    by_key = {}
    metadata_files = sorted(Path(metadata_directory).glob("theme_*.json"))
    if not metadata_files:
        raise ValueError("No producer theme metadata files found")

    for path in metadata_files:
        metadata = json.loads(path.read_text(encoding="utf-8"))
        theme_id = metadata.get("theme")
        if not isinstance(theme_id, str) or not theme_id:
            raise ValueError(f"{path.name}: missing producer theme identity")
        source_records = metadata.get("source_records") or {}
        source_map = metadata.get("sources") or {}
        pages = metadata.get("indicator_pages") or {}
        reference_aliases = {
            route.get("reference_indicator"): indicator_id
            for indicator_id, route in (metadata.get("owned_series_routes") or {}).items()
            if route.get("reference_read_route") and route.get("reference_indicator")
        }
        for indicator_id in metadata.get("indicator_keys", []):
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

            if disposition == "excluded_legacy_accessibility":
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
                allowed_levels=tuple(page_descriptor.get(
                    "levels", page_descriptor.get("serving_levels", collection.get("levels", ())))),
                sources=tuple(page_descriptor.get("sources", (source_id,))),
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
            ))

    # A source-declared key cannot silently disappear because another map was
    # edited independently. The inventory is exact at (theme, indicator) grain.
    for path in metadata_files:
        metadata = json.loads(path.read_text(encoding="utf-8"))
        for indicator_id in metadata.get("sources", {}):
            if (metadata["theme"], indicator_id) not in by_key:
                raise ValueError(f"unaccounted producer indicator source: {metadata['theme']}/{indicator_id}")

    declarations.sort(key=lambda item: (item.theme_id, item.indicator_id))
    if semantic_contract_path is not None:
        contract = json.loads(Path(semantic_contract_path).read_text(encoding="utf-8"))
        if contract.get("contract") != "producer-semantic-resources-v1":
            raise ValueError("Invalid producer semantic resource contract")
        semantic_declarations = list(contract.get("resources", []))
        metadata_by_theme = {}
        for path in metadata_files:
            theme_metadata = json.loads(path.read_text(encoding="utf-8"))
            metadata_by_theme[theme_metadata["theme"]] = theme_metadata
            for declaration in theme_metadata.get("semantic_resources", []):
                semantic_declarations.append({**declaration, "theme_id": theme_metadata["theme"]})
        for declaration in semantic_declarations:
            resource_id = declaration["resource_id"]
            kind = declaration["kind"]
            axes = tuple(declaration.get("axes", ()))
            theme_id = declaration.get("theme_id", "")
            theme_metadata = metadata_by_theme.get(theme_id, {})
            groups = tuple(declaration.get("groups", ()))
            if kind == "typed_reading":
                axes = ("groupe",)
                declared_groups = {group.get("key") for group in theme_metadata.get("subgroups", [])
                                   if group.get("reading")}
                if not groups:
                    groups = tuple(group.get("key") for group in theme_metadata.get("subgroups", [])
                                   if group.get("reading"))
                if not groups or not set(groups) <= declared_groups:
                    raise ValueError(f"Invalid typed-reading groups for producer resource: {resource_id}")
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
            resources.append(IndicatorResource(
                resource_id=resource_id, theme_id=theme_id, indicator_id=resource_id,
                label=declaration.get("label", theme_metadata.get("label", resource_id)),
                unit="", direction="none",
                allowed_levels=tuple(declaration.get("allowed_levels", ("commune", "epci", "departement", "region"))),
                sources=sources, shapes=(kind,),
                axes=axes, axis_values=(("groupe", groups),) if kind == "typed_reading" else (),
                target_kinds=("territory", "territory_cohort") if kind == "typed_reading" else ("territory",),
                target_ids=(),
                dynamic_axes=(), fields=tuple(dict.fromkeys([
                    *declaration["fields"],
                    *(side["field"] for side in declaration.get("side_relations", ())),
                ])),
                intents=tuple(declaration.get("intents", ("facts",))), resource_kind=kind,
                context_values=tuple(declaration.get("axes", {}).get("context", ())),
                storage_relation=declaration.get("storage_relation"),
                publication_table=declaration.get("publication_table"),
                side_relations=tuple(declaration.get("side_relations", ()))))
    resources.sort(key=lambda item: (item.theme_id, item.indicator_id))
    excluded = tuple(item for item in declarations
                     if item.disposition == "excluded_legacy_accessibility")
    return ResourceCatalogue(tuple(declarations), tuple(resources), excluded)
