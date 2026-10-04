"""Authoritative mobility-network preparation and family adapter."""
from __future__ import annotations

import json
from hashlib import sha256
import platform
import base64
import numpy as np
import os
import tempfile
from uuid import uuid4
from pathlib import Path
from typing import Mapping
from time import perf_counter

from qgis.PyQt.QtCore import PYQT_VERSION_STR, QT_VERSION_STR, Qt
from qgis.PyQt.QtGui import QColor, QImage, QPainter
from qgis.core import (
    Qgis,
    QgsCoordinateReferenceSystem,
    QgsCoordinateTransform,
    QgsFeature,
    QgsFeatureSink,
    QgsFeatureRequest,
    QgsFields,
    QgsGeometry,
    QgsLineSymbol,
    QgsPointXY,
    QgsProject,
    QgsRectangle,
    QgsSingleSymbolRenderer,
    QgsVectorFileWriter,
    QgsVectorLayer,
    QgsVectorDataProvider,
    QgsVariantUtils,
    QgsWkbTypes,
)

from network_sources import (
    FamilyPreparation,
    prepare_network_sources as prepare_network_source_families,
)
from map_ground import (
    INLINE_SHADOW_BLUR_RADIUS_PX,
    INLINE_SHADOW_OFFSET_Y_PX,
    INLINE_SHADOW_OPACITY,
    INLINE_SHADOW_SIGMA_PX,
    discover_ocsge_sources,
)
from runner import Binding, Foundation, MapSet, Recipe


NETWORK_MODES = ("car", "walk", "bike")
SAMPLE_TERRITORIES = (("commune", "35238"), ("region", "53"), ("epci", "243500741"))
MAP_CRS = QgsCoordinateReferenceSystem("EPSG:2154")
OSM_PREPARATION_VERSION = 1
GEOVELO_PREPARATION_VERSION = 1
SHARED_NETWORK_RENDER_VERSION = 1
INSPECTION_NETWORK_RENDER_VERSION = 1
INLINE_NETWORK_RENDER_VERSION = 1
NETWORK_LINE_WIDTH_MM = "0.36"
NETWORK_OPACITY = 0.98
NETWORK_LINE_CAP = "round"
NETWORK_LINE_JOIN = "round"
# QGIS antialias coverage is bounded conservatively to one output pixel beyond
# the physical round-cap/join stroke radius. This value is part of cache identity.
NETWORK_ANTIALIAS_REACH_PX = 1.0


def _canonical_geometry_wkb(geometry: QgsGeometry) -> bytes:
    canonical = QgsGeometry(geometry)
    canonical.normalize()
    return bytes(canonical.asWkb())


def _network_stroke_halo(geometry: QgsRectangle, profile) -> float:
    """Map-unit reach of the QGIS stroke plus antialias coverage for this profile."""
    dpi = 96 * profile.size[0] / 1600
    stroke_px = float(NETWORK_LINE_WIDTH_MM) * dpi / 25.4
    map_units_per_pixel = max(geometry.width(), geometry.height()) / min(profile.size)
    return (stroke_px / 2 + NETWORK_ANTIALIAS_REACH_PX) * map_units_per_pixel


def _network_stroke_contract(profile) -> Mapping:
    dpi = 96 * profile.size[0] / 1600
    return {
        "width_mm": NETWORK_LINE_WIDTH_MM,
        "opacity": NETWORK_OPACITY,
        "cap": NETWORK_LINE_CAP,
        "join": NETWORK_LINE_JOIN,
        "antialiasing": True,
        "antialias_reach_px": NETWORK_ANTIALIAS_REACH_PX,
        "output_dpi": dpi,
        "influence_halo_map_units_per_pixel": (
            float(NETWORK_LINE_WIDTH_MM) * dpi / 25.4 / 2 + NETWORK_ANTIALIAS_REACH_PX
        ),
    }


def _palette_render_contract(spec: Mapping) -> Mapping:
    return {"treatment": spec["treatment"], "approved_colour": spec["approved_colour"],
        "opacity": float(spec.get("opacity", 1.0))}


def _load_network_family_config() -> dict:
    path = Path(__file__).with_name("network-family.json")
    config = json.loads(path.read_text(encoding="utf-8"))
    departments = config.get("scope", {}).get("analytical_departments")
    if not isinstance(departments, list) or not departments:
        raise ValueError("Network family config must declare analytical departments")
    if any(not isinstance(value, str) or not value for value in departments):
        raise ValueError("Network analytical departments must be nonempty strings")
    return config
CAR_HIGHWAYS = (
    "motorway", "motorway_link", "trunk", "trunk_link", "primary", "primary_link",
    "secondary", "secondary_link", "tertiary", "tertiary_link", "unclassified",
    "residential", "service", "living_street",
)
CAR_ACCESS_EXCLUSIONS = tuple(
    f'"{key}"=>"{value}"'
    for key, values in {
        "access": ("no", "private", "customers", "restricted", "permit", "emergency", "psv"),
        "vehicle": ("no", "private", "customers", "restricted", "permit", "emergency", "service"),
        "motor_vehicle": ("no", "private", "customers", "restricted", "permit", "emergency", "agricultural", "delivery", "forestry"),
        "motorcar": ("no", "private", "customers", "restricted", "permit", "emergency"),
    }.items()
    for value in values
)
CAR_SERVICE_EXCLUSIONS = tuple(
    f'"service"=>"{value}"'
    for value in ("parking_aisle", "driveway", "drive-through", "emergency_access", "bus", "voie_de_bus")
)
CAR_BUS_ONLY_EXCLUSIONS = ('"access"=>"psv"', '"busway"=>"designated"', '"busway"=>"track"')
WALK_HIGHWAYS = ("footway", "pedestrian", "steps", "path", "living_street", "residential")
WALK_EXPLICIT_ROADS = (
    "primary", "primary_link", "secondary", "secondary_link", "tertiary", "tertiary_link",
    "unclassified", "residential", "service",
)
WALK_SIDEWALK_VALUES = ("both", "left", "right", "separate", "yes", "sep")
WALK_FOOT_VALUES = ("yes", "designated", "permissive")
WALK_ACCESS_EXCLUSIONS = (
    '"foot"=>"no"', '"foot"=>"private"', '"access"=>"no"', '"access"=>"private"',
    '"access"=>"customers"', '"access"=>"restricted"',
)
PROTECTED_CYCLING = (
    "PISTE CYCLABLE", "DOUBLE SENS CYCLABLE PISTE", "VOIE VERTE",
    "CHAUSSEE A VOIE CENTRALE BANALISEE", "AMENAGEMENT MIXTE PIETON VELO HORS VOIE VERTE",
)
SHARED_CYCLING = (
    "BANDE CYCLABLE", "DOUBLE SENS CYCLABLE BANDE", "DOUBLE SENS CYCLABLE NON MATERIALISE",
    "VELO RUE", "COULOIR BUS+VELO", "AUTRE", "ACCOTEMENT REVETU HORS CVCB", "GOULOTTE", "RAMPE",
)


def network_recipe() -> Recipe:
    return Recipe(
        name="public-space-sharing-network",
        version=2,
        foundation=Foundation(
            version="network-plate-v2",
            framing={"shape": "square-circular-frame", "margin_ratio": 0.08},
            ground={
                "inspection_surface": "ocsge-selected-cs",
                "inline_surface": "paper-only",
                "water": "sea-colour",
            },
            composition={
                "inspection": {"style": "engraved-network-plate", "desaturate_outside_land": True},
                "inline": {
                    "surface": "paper-only-transparent-cutout",
                    "shadow": {
                        "blur_radius_px": INLINE_SHADOW_BLUR_RADIUS_PX,
                        "sigma_px": INLINE_SHADOW_SIGMA_PX,
                        "offset_px": {"x": 0, "y": INLINE_SHADOW_OFFSET_Y_PX},
                        "opacity": INLINE_SHADOW_OPACITY,
                    },
                    "cross_border_frontier": "visible-on-analytical-edge",
                },
            },
        ),
        family="network",
        required_fields=("geometry", "territory", "mode", "analytical_geometry", "extent"),
    )


def _metadata_path(raw_dir: Path) -> Path:
    return raw_dir.parent.parent / "inst" / "extdata" / "epci_geo_api.json"


def _projected(geometry: QgsGeometry, source_crs, project: QgsProject) -> QgsGeometry:
    result = QgsGeometry(geometry)
    result.transform(QgsCoordinateTransform(source_crs, MAP_CRS, project.transformContext()))
    if not result.isGeosValid():
        result = result.makeValid()
    return result


def _union(geometries: list[QgsGeometry], label: str) -> QgsGeometry:
    if not geometries:
        raise ValueError(f"Authoritative commune geometry is missing for {label}")
    result = QgsGeometry.unaryUnion(geometries)
    if result.isEmpty() or not result.isGeosValid():
        raise ValueError(f"Could not build valid authoritative geometry for {label}")
    return result


def _map_extent(geometry: QgsGeometry) -> QgsRectangle:
    if geometry.isEmpty():
        raise ValueError("Cannot derive a map frame from empty analytical geometry")
    _, centre, radius = geometry.minimalEnclosingCircle(segments=96)
    radius *= 1.08
    return QgsRectangle(centre.x() - radius, centre.y() - radius, centre.x() + radius, centre.y() + radius)


def build_representative_map_set(
    raw_dir: str | Path,
    project: QgsProject | None = None,
    family_config: Mapping | None = None,
) -> Binding:
    """Bind authoritative territory membership, public labels and sample modes."""
    raw_dir = Path(raw_dir)
    family_config = family_config or _load_network_family_config()
    analytical_departments = frozenset(
        str(value) for value in family_config["scope"]["analytical_departments"]
    )
    commune_path = raw_dir / "communes_limites.geojson"
    if not commune_path.is_file():
        raise FileNotFoundError(f"Missing map-ready commune geometry: {commune_path}")
    epci_labels_path = _metadata_path(raw_dir)
    if not epci_labels_path.is_file():
        raise FileNotFoundError(f"Missing pinned EPCI display-name metadata: {epci_labels_path}")
    project = project or QgsProject.instance()
    project.setCrs(MAP_CRS)
    communes = QgsVectorLayer(str(commune_path), "Admin Express COG · communes", "ogr")
    if not communes.isValid():
        raise ValueError(f"Could not load authoritative commune geometry: {commune_path}")
    required = {
        "code_insee", "nom_officiel", "code_insee_du_departement",
        "code_insee_de_la_region", "codes_siren_des_epci",
    }
    missing = required - {field.name() for field in communes.fields()}
    if missing:
        raise ValueError(f"Commune map-ready source is missing fields: {sorted(missing)}")

    epci_payload = json.loads(epci_labels_path.read_text(encoding="utf-8"))
    epci_label = next(
        (item["nom"] for item in epci_payload["labels"] if item["code"] == "243500741"), None
    )
    if not epci_label:
        raise ValueError("Pinned Geo API metadata has no display name for EPCI 243500741")
    commune_geometry = None
    commune_name = None
    region_members: list[QgsGeometry] = []
    epci_breton: list[QgsGeometry] = []
    epci_external: list[QgsGeometry] = []
    for source_feature in communes.getFeatures():
        code = str(source_feature["code_insee"])
        department = str(source_feature["code_insee_du_departement"])
        epci_codes = {value for value in str(source_feature["codes_siren_des_epci"] or "").split("/") if value}
        if code != "35238" and department not in analytical_departments and "243500741" not in epci_codes:
            continue
        geometry = _projected(source_feature.geometry(), communes.crs(), project)
        if code == "35238":
            commune_geometry, commune_name = geometry, str(source_feature["nom_officiel"])
        if department in analytical_departments and str(source_feature["code_insee_de_la_region"]) == "53":
            region_members.append(geometry)
        if "243500741" in epci_codes:
            (epci_breton if department in analytical_departments else epci_external).append(geometry)
    if commune_geometry is None or not commune_name:
        raise ValueError("Authoritative commune source has no Rennes (35238) geometry and label")
    region_geometry = _union(region_members, "Bretagne (region 53)")
    epci_analytical = _union(epci_breton, "Breton member communes of EPCI 243500741")
    epci_full = _union([*epci_breton, *epci_external], "EPCI 243500741")
    territory_specs = (
        {"kind": "commune", "code": "35238", "name": commune_name,
         "geometry": commune_geometry, "analytical_geometry": commune_geometry},
        {"kind": "region", "code": "53", "name": "Bretagne",
         "geometry": region_geometry, "analytical_geometry": region_geometry},
        {"kind": "epci", "code": "243500741", "name": epci_label,
         "geometry": epci_full, "analytical_geometry": epci_analytical},
    )
    features = []
    for territory in territory_specs:
        extent = _map_extent(territory["analytical_geometry"])
        for mode in NETWORK_MODES:
            features.append({
                "territory": {key: territory[key] for key in ("kind", "code", "name")},
                "mode": mode,
                "geometry": territory["geometry"],
                "analytical_geometry": territory["analytical_geometry"],
                "region_geometry": region_geometry,
                "extent": extent,
            })
    return Binding("network", MapSet({"network-outputs": tuple(features)}))


def _sql_values(values: tuple[str, ...]) -> str:
    return ", ".join("'" + value.replace("'", "''") + "'" for value in values)


def car_filter_sql() -> str:
    """Exact way-level car eligibility rule from the approved map builder."""
    exclusions = (*CAR_ACCESS_EXCLUSIONS, *CAR_SERVICE_EXCLUSIONS, *CAR_BUS_ONLY_EXCLUSIONS)
    clauses = [f'("other_tags" IS NULL OR "other_tags" NOT LIKE \'%{marker}%\')' for marker in exclusions]
    return f'"highway" IN ({_sql_values(CAR_HIGHWAYS)}) AND ' + " AND ".join(clauses)


def _walking_filter_sql(include_speed: bool = True) -> str:
    dedicated = f'"highway" IN ({_sql_values(WALK_HIGHWAYS)})'
    sidewalk = " OR ".join(
        f'"other_tags" LIKE \'%"{key}"=>"{value}"%\''
        for key in ("sidewalk", "sidewalk:left", "sidewalk:right")
        for value in ("both", "left", "right", "separate", "yes", "sep")
    )
    foot = " OR ".join(f'"other_tags" LIKE \'%"foot"=>"{value}"%\'' for value in WALK_FOOT_VALUES)
    explicit = f'("highway" IN ({_sql_values(WALK_EXPLICIT_ROADS)}) AND ({sidewalk} OR {foot}))'
    query = f"({dedicated} OR {explicit})"
    if include_speed:
        speed_markers = " OR ".join(
            f'"other_tags" LIKE \'%"maxspeed"=>"{speed}"%\'' for speed in range(31)
        )
        query = f'({query} OR ("highway" IN ({_sql_values(WALK_EXPLICIT_ROADS)}) AND ({speed_markers}) AND ({car_filter_sql()})))'
    return query + " AND (" + " AND ".join(
        f'("other_tags" IS NULL OR "other_tags" NOT LIKE \'%{marker}%\')'
        for marker in WALK_ACCESS_EXCLUSIONS
    ) + ")"


def _ensure_memory_spatial_index(layer: QgsVectorLayer) -> None:
    provider = layer.dataProvider()
    if provider.hasSpatialIndex() == QgsVectorDataProvider.SpatialIndexPresent:
        return
    if not provider.createSpatialIndex():
        raise RuntimeError(f"Could not build in-memory spatial index for {layer.name()}")


def _source_signature(path: Path, source_layer: str | None = None) -> dict:
    """Cheap source identity; filter/preparation versions carry code changes."""
    stat = path.stat()
    identity = {
        "path": str(path.resolve()),
        "size_bytes": stat.st_size,
        "mtime_ns": stat.st_mtime_ns,
    }
    if source_layer is not None:
        identity["layer"] = source_layer
    return identity


def _cache_root(raw_dir: Path) -> Path:
    return raw_dir.parent.parent / "maps" / ".cache" / "network-sources"


def _new_flatgeobuf_writer(path: Path, transform_context):
    options = QgsVectorFileWriter.SaveVectorOptions()
    options.driverName = "FlatGeobuf"
    options.fileEncoding = "UTF-8"
    options.layerOptions = ["SPATIAL_INDEX=YES"]
    writer = QgsVectorFileWriter.create(
        str(path), QgsFields(), QgsWkbTypes.MultiLineString,
        MAP_CRS, transform_context, options,
    )
    if writer is None:
        raise RuntimeError(f"Could not create indexed FlatGeobuf writer for {path}")
    if writer.hasError() != QgsVectorFileWriter.NoError:
        message = writer.errorMessage()
        del writer
        raise RuntimeError(f"Could not create indexed FlatGeobuf {path}: {message}")
    return writer


def _readonly_source_layer(path: str | Path, name: str, project: QgsProject) -> QgsVectorLayer:
    """Open authoritative input without allowing QGIS/OGR to touch its source."""
    options = QgsVectorLayer.LayerOptions()
    options.transformContext = project.transformContext()
    options.forceReadOnly = True
    layer = QgsVectorLayer(str(path), name, "ogr", options)
    if not layer.isValid():
        raise RuntimeError(f"Could not load read-only source layer: {path}")
    return layer


def _write_geometry(writer, geometry: QgsGeometry, label: str) -> None:
    feature = QgsFeature(QgsFields())
    feature.setGeometry(QgsGeometry(geometry))
    if not writer.addFeature(feature, QgsFeatureSink.FastInsert):
        raise RuntimeError(f"Could not write {label} feature to FlatGeobuf: {writer.lastError()}")


def _validate_flatgeobuf(paths: Mapping[str, Path], family: str) -> None:
    """Reject unreadable, empty, wrongly projected, or unindexed cache layers."""
    for key, path in paths.items():
        layer = QgsVectorLayer(str(path), f"{family} · {key}", "ogr")
        if not layer.isValid():
            raise ValueError(f"Prepared {family} layer is unreadable: {path}")
        if layer.crs() != MAP_CRS:
            raise ValueError(f"Prepared {family} layer has unexpected CRS: {path}")
        if layer.wkbType() != QgsWkbTypes.MultiLineString:
            raise ValueError(f"Prepared {family} layer is not a MultiLineString: {path}")
        if layer.featureCount() <= 0:
            raise ValueError(f"Prepared {family} layer is empty: {path}")
        index_state = layer.dataProvider().hasSpatialIndex()
        if index_state != QgsVectorDataProvider.SpatialIndexPresent:
            raise ValueError(f"Prepared {family} layer does not have a readable spatial index: {path}")


def _build_osm_cache(output_dir: Path, source_path: Path, project: QgsProject) -> None:
    source = _readonly_source_layer(
        f"{source_path}|layername=lines", "OSM · network source", project
    )

    modes = ("car", "walk")
    outputs = {"car": "osm-car.fgb", "walk": "osm-walk.fgb"}
    writers = {}
    counts = {mode: 0 for mode in modes}
    to_map = QgsCoordinateTransform(source.crs(), MAP_CRS, project.transformContext())
    try:
        for mode, filename in outputs.items():
            writers[mode] = _new_flatgeobuf_writer(output_dir / filename, project.transformContext())
        for source_feature, matched in _eligible_osm_modes(source, modes):
            geometry = QgsGeometry(source_feature.geometry())
            if geometry.isEmpty():
                continue
            geometry.transform(to_map)
            geometry.convertToMultiType()
            for mode in matched:
                _write_geometry(writers[mode], geometry, f"OSM {mode}")
                counts[mode] += 1
        if any(count == 0 for count in counts.values()):
            raise RuntimeError(f"OSM source has no eligible ways for one or more modes: {counts}")
    finally:
        for writer in writers.values():
            writer.finalize()
        writers.clear()
        source = None
    print(f"[network-prep] OSM outputs: car={counts['car']:,}, walk={counts['walk']:,}", flush=True)


def _build_geovelo_cache(output_dir: Path, source_path: Path, project: QgsProject) -> None:
    source = _readonly_source_layer(source_path, "Geovelo · network source", project)
    missing = {"ame_d", "ame_g"} - {field.name() for field in source.fields()}
    if missing:
        raise ValueError(f"Geovelo source is missing classification fields: {sorted(missing)}")

    outputs = {
        "protected": "geovelo-bike-protected.fgb",
        "shared": "geovelo-bike-shared.fgb",
    }
    writers = {}
    counts = {"protected": 0, "shared": 0}
    scanned = 0
    to_map = QgsCoordinateTransform(source.crs(), MAP_CRS, project.transformContext())
    started = perf_counter()
    print("[network-prep] scanning Geovelo source once for all eligible bike features", flush=True)
    try:
        for family, filename in outputs.items():
            writers[family] = _new_flatgeobuf_writer(output_dir / filename, project.transformContext())
        for source_feature in source.getFeatures():
            scanned += 1
            if scanned % 100_000 == 0:
                print(f"[network-prep] Geovelo scan progress: {scanned:,} source features", flush=True)
            ame_d, ame_g = source_feature["ame_d"], source_feature["ame_g"]
            ame_d_is_null = QgsVariantUtils.isNull(ame_d)
            ame_g_is_null = QgsVariantUtils.isNull(ame_g)
            if ame_d_is_null and ame_g_is_null:
                continue
            winner = ame_g if ame_d_is_null or ame_d == "AUCUN" else ame_d
            family = (
                "protected" if winner in PROTECTED_CYCLING
                else "shared" if winner in SHARED_CYCLING
                else None
            )
            if family is None:
                continue
            geometry = QgsGeometry(source_feature.geometry())
            if geometry.isEmpty():
                continue
            geometry.transform(to_map)
            geometry.convertToMultiType()
            _write_geometry(writers[family], geometry, f"Geovelo {family}")
            counts[family] += 1
        if any(count == 0 for count in counts.values()):
            raise RuntimeError(f"Geovelo source is missing a required eligible family: {counts}")
    finally:
        for writer in writers.values():
            writer.finalize()
        writers.clear()
        source = None
    print(
        f"[network-prep] Geovelo outputs: protected={counts['protected']:,}, "
        f"shared={counts['shared']:,}; scanned={scanned:,} in {perf_counter()-started:.1f}s",
        flush=True,
    )


def prepare_network_cache(
    raw_dir: str | Path,
    project: QgsProject | None = None,
    cache_root: str | Path | None = None,
    families: tuple[str, ...] = ("osm", "geovelo"),
    *, force: bool = False, report: list | None = None,
) -> dict[str, dict[str, Path]]:
    """Prepare or reuse the independently versioned OSM and Geovelo families."""
    raw_dir = Path(raw_dir)
    project = project or QgsProject.instance()
    unknown = set(families) - {"osm", "geovelo"}
    if unknown:
        raise ValueError(f"Unknown prepared network family: {sorted(unknown)}")
    preparations = {}
    if "osm" in families:
        source_path = raw_dir / "bretagne-latest.gpkg"
        if not source_path.is_file():
            raise FileNotFoundError(f"Missing authoritative OSM source: {source_path}")
        preparations["osm"] = FamilyPreparation(
            signature={
                "preparation_version": OSM_PREPARATION_VERSION,
                "source": _source_signature(source_path, "lines"),
                "target_crs": MAP_CRS.authid(),
                "filters": {"car": car_filter_sql(), "walk": _walking_filter_sql(include_speed=True)},
            },
            artifacts={"car": "osm-car.fgb", "walk": "osm-walk.fgb"},
            build=lambda directory, path=source_path: _build_osm_cache(directory, path, project),
            validate=lambda paths: _validate_flatgeobuf(paths, "OSM"),
        )
    if "geovelo" in families:
        source_path = raw_dir / "france-20260807.parquet"
        if not source_path.is_file():
            raise FileNotFoundError(f"Missing authoritative Geovelo source: {source_path}")
        preparations["geovelo"] = FamilyPreparation(
            signature={
                "preparation_version": GEOVELO_PREPARATION_VERSION,
                "source": _source_signature(source_path),
                "target_crs": MAP_CRS.authid(),
                "classification": {
                    "protected": sorted(PROTECTED_CYCLING),
                    "shared": sorted(SHARED_CYCLING),
                    "priority": "ame_d unless null or AUCUN; otherwise ame_g",
                },
            },
            artifacts={
                "protected": "geovelo-bike-protected.fgb",
                "shared": "geovelo-bike-shared.fgb",
            },
            build=lambda directory, path=source_path: _build_geovelo_cache(directory, path, project),
            validate=lambda paths: _validate_flatgeobuf(paths, "Geovelo"),
        )
    root = Path(cache_root) if cache_root is not None else _cache_root(raw_dir)
    return prepare_network_source_families(root, preparations, force=force, report=report)


def _eligible_osm_modes(source, modes, request_rect: QgsRectangle | None = None):
    """Yield OSM ways classified for requested modes from one provider scan."""
    requested_modes = set(modes)
    modes = tuple(mode for mode in ("car", "walk") if mode in requested_modes)
    if not modes:
        return
    queries = {"car": car_filter_sql(), "walk": _walking_filter_sql(include_speed=True)}
    combined_query = " OR ".join(f"({queries[mode]})" for mode in modes)
    _apply_osm_subset(source, combined_query)

    request = QgsFeatureRequest()
    if request_rect is not None:
        request.setFilterRect(request_rect)
    started = perf_counter()
    print(
        f"[maps] scanning OSM once for {', '.join(modes)} "
        f"within {request_rect.toString() if request_rect is not None else 'all extents'}",
        flush=True,
    )
    scanned = 0
    counts = {mode: 0 for mode in modes}
    for source_feature in source.getFeatures(request):
        scanned += 1
        if scanned % 100_000 == 0:
            print(f"[maps] OSM scan progress: {scanned:,} candidate ways", flush=True)
        matched = _classify_osm_modes(source_feature, modes)
        for mode in matched:
            counts[mode] += 1
        if matched:
            yield source_feature, matched

    summaries = ", ".join(f"{mode}={counts[mode]}" for mode in modes)
    print(
        f"[maps] prepared OSM classifications ({summaries}; "
        f"{scanned:,} candidates) in {perf_counter()-started:.1f}s",
        flush=True,
    )


def _classify_osm_modes(feature, modes) -> tuple[str, ...]:
    """Classify OSM tags with the same marker rules as the approved SQL filters."""
    requested = set(modes)
    highway_value = feature["highway"]
    tags_value = feature["other_tags"]
    highway = "" if QgsVariantUtils.isNull(highway_value) else str(highway_value)
    tags = "" if QgsVariantUtils.isNull(tags_value) else str(tags_value)

    car_exclusions = (*CAR_ACCESS_EXCLUSIONS, *CAR_SERVICE_EXCLUSIONS, *CAR_BUS_ONLY_EXCLUSIONS)
    car_eligible = highway in CAR_HIGHWAYS and not any(marker in tags for marker in car_exclusions)
    matches = []
    if "car" in requested and car_eligible:
        matches.append("car")

    if "walk" in requested:
        walking_base = highway in WALK_HIGHWAYS
        if not walking_base and highway in WALK_EXPLICIT_ROADS:
            has_sidewalk = any(
                f'"{key}"=>"{value}"' in tags
                for key in ("sidewalk", "sidewalk:left", "sidewalk:right")
                for value in WALK_SIDEWALK_VALUES
            )
            has_foot_access = any(
                f'"foot"=>"{value}"' in tags for value in WALK_FOOT_VALUES
            )
            has_slow_speed = any(
                f'"maxspeed"=>"{speed}"' in tags for speed in range(31)
            )
            walking_base = has_sidewalk or has_foot_access or (has_slow_speed and car_eligible)
        walk_eligible = walking_base and not any(
            marker in tags for marker in WALK_ACCESS_EXCLUSIONS
        )
        if walk_eligible:
            matches.append("walk")
    return tuple(matches)


def _apply_osm_subset(source, expression: str) -> None:
    """Limit provider reads without triggering an unused full feature recount."""
    get_provider = getattr(source, "dataProvider", None)
    provider = get_provider() if callable(get_provider) else None
    set_provider_subset = getattr(provider, "setSubsetString", None)
    if callable(set_provider_subset):
        applied = set_provider_subset(expression, False)
    else:
        set_layer_subset = getattr(source, "setSubsetString", None)
        applied = callable(set_layer_subset) and set_layer_subset(expression)
    if not applied:
        raise RuntimeError("Could not apply the combined OSM eligibility filter")


def prepare_osm_layers(project: QgsProject, source, modes, marks,
                       request_rect: QgsRectangle | None = None) -> dict[str, QgsVectorLayer]:
    """Select and classify requested OSM modes in one provider scan."""
    modes = tuple(mode for mode in ("car", "walk") if mode in set(modes))
    if not modes:
        return {}

    targets = {}
    batches = {mode: [] for mode in modes}
    for mode in modes:
        layer = QgsVectorLayer("MultiLineString?crs=EPSG:2154", f"OSM · {mode}", "memory")
        symbol = QgsLineSymbol.createSimple({
            "color": marks[mode], "width": NETWORK_LINE_WIDTH_MM,
            "capstyle": NETWORK_LINE_CAP, "joinstyle": NETWORK_LINE_JOIN,
        })
        symbol.setOpacity(NETWORK_OPACITY)
        layer.setRenderer(QgsSingleSymbolRenderer(symbol))
        project.addMapLayer(layer)
        targets[mode] = layer

    to_map = QgsCoordinateTransform(source.crs(), MAP_CRS, project.transformContext())
    started = perf_counter()
    scanned = 0
    for source_feature, matched in _eligible_osm_modes(source, modes, request_rect):
        scanned += 1
        geometry = QgsGeometry(source_feature.geometry())
        geometry.transform(to_map)
        if geometry.isEmpty():
            continue
        geometry.convertToMultiType()
        for mode in matched:
            copied = QgsFeature(targets[mode].fields())
            copied.setGeometry(QgsGeometry(geometry))
            batches[mode].append(copied)

    for mode, layer in targets.items():
        if not batches[mode]:
            raise RuntimeError(f"No eligible {mode} network features intersect the selected map extent")
        layer.dataProvider().addFeatures(batches[mode])
        layer.updateExtents()
        _ensure_memory_spatial_index(layer)
    counts = ", ".join(f"{mode}={len(batches[mode])}" for mode in modes)
    print(
        f"[maps] prepared one OSM source pass ({counts}; "
        f"{scanned:,} candidates) in {perf_counter()-started:.1f}s",
        flush=True,
    )
    return targets


def _prepare_network_layers(project: QgsProject, features, raw_dir: Path,
                            family_config: Mapping,
                            cache_root: Path | None = None, *, force: bool = False,
                            report: list | None = None) -> dict[str, list[QgsVectorLayer]]:
    """Load cached, indexed source layers once for all outputs in this run."""
    features = tuple(features)
    if not features:
        raise ValueError("Cannot prepare network sources for an empty run")
    modes = {feature["mode"] for feature in features}
    families = tuple(
        family for family, needed in (
            ("osm", bool(modes & {"car", "walk"})),
            ("geovelo", "bike" in modes),
        ) if needed
    )
    prepared = prepare_network_cache(raw_dir, project, cache_root, families, force=force, report=report)

    def indexed_layer(path: Path, name: str, colour: str) -> QgsVectorLayer:
        layer = QgsVectorLayer(str(path), name, "ogr")
        if not layer.isValid():
            raise RuntimeError(f"Could not load prepared network layer: {path}")
        symbol = QgsLineSymbol.createSimple({
            "color": colour, "width": NETWORK_LINE_WIDTH_MM,
            "capstyle": NETWORK_LINE_CAP, "joinstyle": NETWORK_LINE_JOIN,
        })
        symbol.setOpacity(NETWORK_OPACITY)
        layer.setRenderer(QgsSingleSymbolRenderer(symbol))
        project.addMapLayer(layer)
        return layer

    marks = family_config["marks"]
    osm_layers = {}
    for mode in ("car", "walk"):
        if mode in modes:
            layer = indexed_layer(
                prepared["osm"][mode], f"OSM · {mode}", marks[mode]
            )
            osm_layers[mode] = [layer]

    if "bike" in modes:
        protected = indexed_layer(
            prepared["geovelo"]["protected"], "Géovélo · protégé", marks["bike-protected"]
        )
        shared = indexed_layer(
            prepared["geovelo"]["shared"], "Géovélo · partagé", marks["bike-shared"]
        )
        osm_layers["bike"] = [protected, shared]
    return osm_layers


def _title_and_content(mode: str, family_config: Mapping):
    spec = family_config["inspection"][mode]
    marks = family_config["marks"]
    runs = tuple(
        (item["text"], QColor(item.get("colour", marks.get(item.get("mark"), ""))),
         float(item["opacity"]), bool(item["solid"]))
        for item in spec["title_runs"]
    )
    footer = tuple(spec["footer"]) if spec["footer"] is not None else None
    return runs, {"mode": mode, "footer": footer}


class NetworkAdapter:
    """Network-family adapter; shared map and plate modules own presentation."""

    def __init__(self, raw_dir: str | Path, cache_root: str | Path | None = None, *,
                 context_loader=None):
        self.raw_dir = Path(raw_dir)
        self.cache_root = Path(cache_root) if cache_root is not None else None
        self.context_loader = context_loader
        self.family_config_path = Path(__file__).with_name("network-family.json")
        self.family_config = _load_network_family_config()
        self._ground_cache = {}
        self._identity_cache = {}
        self._ocsge_identity_cache = {}
        self._network_scope_cache = {}
        self._visible_ground_parts_cache = {}
        self._context_scope_cache = {}
        self._visible_ground_parts_cache_root = None
        self._network_scope_cache_root = None
        self._scope_cache_refresh = False
        self._shared_ground = None
        self._network_layers = {}
        self._stage_events = []
        self._stage_validity = {}
        self._refresh = False

    def render_identity(self) -> Mapping:
        """Identify runtime code/assets and the versions that affect rendering."""
        root = Path(__file__).parent
        files = [
            path for path in root.iterdir()
            if path.is_file() and path.suffix in {".py", ".json"}
        ]
        assets = root / "assets"
        files.extend(path for path in assets.rglob("*") if path.is_file())
        identity = sha256()
        for path in sorted(files, key=lambda item: item.relative_to(root).as_posix()):
            identity.update(path.relative_to(root).as_posix().encode("utf-8"))
            identity.update(b"\0")
            identity.update(path.read_bytes())
            identity.update(b"\0")
        return {
            "code_assets_sha256": identity.hexdigest(),
            "runtime": {
                "qgis": Qgis.QGIS_VERSION,
                "qt": QT_VERSION_STR,
                "pyqt": PYQT_VERSION_STR,
                "python": platform.python_version(),
            },
        }

    def profile_identity(self, profile, feature: Mapping | None = None, recipe: Recipe | None = None) -> Mapping:
        """Fine-grained contract identity, separate from broad provenance."""
        root = Path(__file__).parent
        from map_ground import INLINE_MASK_RENDER_VERSION, SHARED_GROUND_RENDER_VERSION
        shared = [root / "assets" / "texture" / "qgis-hub-paper-texture-cc0.jpg"]
        config = json.loads(self.family_config_path.read_text(encoding="utf-8"))
        recipe = recipe or network_recipe()
        mode = feature.get("mode") if feature else None
        mark_names = ({"bike": ("bike-protected", "bike-shared"),
                       "car": ("car",), "walk": ("walk",)}.get(mode)
                      if mode else tuple(config["marks"]))
        scoped = {"marks": {key: config["marks"][key] for key in mark_names},
                  "shared_ground_version": SHARED_GROUND_RENDER_VERSION,
                  "shared_network_render_version": SHARED_NETWORK_RENDER_VERSION,
                  "network_stroke": _network_stroke_contract(profile)}
        if profile.name == "inspection":
            shared.extend([root / "inspection_plate.py", root / "assets" / "north-arrow" / "NorthArrow_11.svg"])
            shared.extend((root / "assets" / "fonts").glob("*.woff2"))
            scoped["inspection_network_render_version"] = INSPECTION_NETWORK_RENDER_VERSION
            scoped["inspection"] = config["inspection"].get(mode, config["inspection"])
        else:
            scoped["inline_mask_version"] = INLINE_MASK_RENDER_VERSION
            scoped["inline_network_render_version"] = INLINE_NETWORK_RENDER_VERSION
            scoped["inline"] = recipe.foundation.composition.get("inline", {})
            scoped["inline_ground"] = {key: recipe.foundation.ground[key]
                for key in ("inline_surface", "water") if key in recipe.foundation.ground}
        if profile.name == "inspection":
            scoped["inspection_ground"] = {key: recipe.foundation.ground[key]
                for key in ("inspection_surface", "water") if key in recipe.foundation.ground}
            scoped["inspection_composition"] = recipe.foundation.composition.get("inspection")
        digest = sha256(json.dumps(scoped, sort_keys=True, separators=(",", ":")).encode())
        for path in sorted(shared):
            digest.update(path.relative_to(root).as_posix().encode())
            digest.update(path.read_bytes())
        return {"profile_contract_sha256": digest.hexdigest(), "runtime": {
            "qgis": Qgis.QGIS_VERSION, "qt": QT_VERSION_STR,
            "pyqt": PYQT_VERSION_STR, "python": platform.python_version()}}

    def input_identity(self) -> Mapping:
        """Record source-file versions used for context, ground, and network marks."""
        source_root = self.raw_dir.parent.parent.resolve()

        def record(name: str, path: Path, *, hash_content: bool = False, **details) -> dict:
            path = path.resolve()
            stat = path.stat()
            identity = {
                "name": name,
                "path": path.relative_to(source_root).as_posix(),
                "size_bytes": stat.st_size,
                "mtime_ns": stat.st_mtime_ns,
                **details,
            }
            if hash_content:
                identity["content_sha256"] = sha256(path.read_bytes()).hexdigest()
            return identity

        metadata_root = source_root / "inst" / "extdata"
        modes = getattr(self, "_requested_modes", set(NETWORK_MODES))
        sources = [record("analytical-commune-geometry", self.raw_dir / "communes_limites.geojson")]
        if modes & {"car", "walk"}:
            sources.append(record("osm-network", self.raw_dir / "bretagne-latest.gpkg",
                layer="lines", preparation_version=OSM_PREPARATION_VERSION))
        if "bike" in modes:
            sources.append(record("geovelo-network", self.raw_dir / "france-20260807.parquet",
                preparation_version=GEOVELO_PREPARATION_VERSION))
        if "inspection" in getattr(self, "_requested_profiles", ("inspection", "inline")):
            sources.extend((
                record("mobility-citations", metadata_root / "theme-metadata" / "theme_mobilite.json", hash_content=True),
                record("land-citations", metadata_root / "theme-metadata" / "theme_milieux.json", hash_content=True),
            ))
            sources.extend(record(f"ocsge-{department}", path, layer=layer_name)
                for department, path, layer_name in discover_ocsge_sources(self.raw_dir))
        return {"sources": sorted(sources, key=lambda item: item["name"])}

    def preflight_profiles(self, recipe: Recipe, binding: Binding, profiles) -> None:
        self._requested_profiles = tuple(profiles)
        self._requested_modes = {feature["mode"] for layer in binding.map_set.layers.values() for feature in layer}
        self.preflight(recipe, binding)

    def preflight(self, recipe: Recipe, binding: Binding) -> None:
        profiles = getattr(self, "_requested_profiles", ("inspection", "inline"))
        modes = getattr(self, "_requested_modes", set(NETWORK_MODES))
        required = [self.raw_dir / "communes_limites.geojson", self.family_config_path,
            Path(__file__).with_name("assets") / "texture" / "qgis-hub-paper-texture-cc0.jpg",
        ]
        if modes & {"car", "walk"}:
            required.append(self.raw_dir / "bretagne-latest.gpkg")
        if "bike" in modes:
            required.append(self.raw_dir / "france-20260807.parquet")
        if "inspection" in profiles:
            required += (
                self.raw_dir.parent.parent / "inst" / "extdata" / "theme-metadata" / "theme_mobilite.json",
                self.raw_dir.parent.parent / "inst" / "extdata" / "theme-metadata" / "theme_milieux.json",
                Path(__file__).with_name("network-palette.json"),
                Path(__file__).with_name("assets") / "north-arrow" / "NorthArrow_11.svg",
                *(Path(__file__).with_name("assets") / "fonts" / f"{slug}-latin-wght-normal.woff2"
                  for slug in ("mozilla-headline", "mozilla-text", "newsreader")),
            )
        missing = [path for path in required if not path.is_file()]
        if missing:
            raise FileNotFoundError("Missing authoritative network map input(s): " + ", ".join(map(str, missing)))
        if self.family_config.get("family") != recipe.family:
            raise ValueError("Network family style does not match the requested family recipe")
        if "inspection" in profiles and set(self.family_config.get("inspection", {})) != set(NETWORK_MODES):
            raise ValueError("Network family style is missing a mode inspection profile")
        required_marks = set()
        if modes & {"car", "walk"}:
            required_marks.update({"car", "walk"} & modes)
        if "bike" in modes:
            required_marks.update(("bike-protected", "bike-shared"))
        if not required_marks.issubset(self.family_config.get("marks", {})):
            raise ValueError("Network family style is missing authoritative family marks")
        if "inspection" in profiles:
            from map_ground import discover_ocsge_sources
            discover_ocsge_sources(self.raw_dir)

    def prepare_run(self, recipe: Recipe, binding: Binding, profiles, output_dir: Path, *, refresh: bool = False) -> None:
        """Load source providers and reusable family layers once for this run."""
        from map_ground import prepare_shared_ground

        project = QgsProject.instance()
        self._stage_events = []
        self._stage_validity = {}
        self._identity_cache = {}
        self._context_scope_cache = {}
        self._ocsge_identity_cache = {}
        self._ground_cache = {}
        self._network_scope_cache = {}
        self._visible_ground_parts_cache = {}
        self._visible_ground_parts_cache_root = Path(output_dir) / ".stage-cache" / "visible-ground-derivatives"
        self._network_scope_cache_root = Path(output_dir) / ".stage-cache" / "network-influence-scope"
        self._scope_cache_refresh = refresh
        project.clear()
        project.setCrs(MAP_CRS)
        features = tuple(
            feature
            for layer_features in binding.map_set.layers.values()
            for feature in layer_features
        )
        if not features:
            raise ValueError("Cannot prepare an empty network map set")
        combined_extent = QgsRectangle(features[0]["extent"])
        for feature in features[1:]:
            combined_extent.combineExtentWith(QgsRectangle(feature["extent"]))
        assets = Path(__file__).with_name("assets")
        context_started = perf_counter()
        self._shared_ground = prepare_shared_ground(
            project, self.raw_dir, combined_extent, assets,
            include_ocsge="inspection" in profiles,
            cache_root=output_dir / ".stage-cache" / "context-land",
            refresh=refresh, stage_report=self._stage_events,
            context_loader=self.context_loader,
        )
        self._stage_events.append({"stage": "context-and-provider-load", "profile": "shared",
            "decision": "validated", "seconds": round(perf_counter() - context_started, 3)})
        self._network_layers = _prepare_network_layers(
            project, features, self.raw_dir, self.family_config, self.cache_root,
            force=refresh, report=self._stage_events
        )
        self._ground_cache.clear()
        self._refresh = refresh

    def stage_report(self):
        return list(self._stage_events)

    def record_reused_output(self, feature, profile, output_dir, recipe=None):
        started = perf_counter()
        identity = self._ground_id(feature, profile, recipe)
        if identity in self._stage_validity:
            self._stage_events.append({"stage": "territory-ground", "profile": profile.name,
                "identity": identity, "decision": "reused" if self._stage_validity[identity] else "missing-cache",
                "seconds": 0.0})
            self._stage_events.append({"stage": "territory-ground-cache-validation", "profile": profile.name,
                "identity": identity, "decision": "shared-validation", "seconds": 0.0})
            return
        stage = Path(output_dir) / ".stage-cache" / "ground" / identity
        read_started = perf_counter()
        prepared = self._read_ground_stage(stage, profile.size, feature["extent"])
        read_seconds = perf_counter() - read_started
        self._stage_validity[identity] = prepared is not None
        self._stage_events.append({"stage": "territory-ground", "profile": profile.name,
            "identity": identity, "decision": "reused" if prepared else "missing-cache",
            "seconds": 0.0})
        self._stage_events.append({"stage": "territory-ground-cache-validation", "profile": profile.name,
            "identity": identity, "decision": "validated" if prepared else "missing-cache",
            "seconds": round(read_seconds, 6)})
        self._stage_events.append({"stage": "reused-output-ground-preparation-total", "profile": profile.name,
            "identity": identity, "decision": "completed", "seconds": round(perf_counter() - started, 6)})

    def effective_input_identity(self, feature: Mapping, profile) -> Mapping:
        """Fingerprint only source facts that intersect this map and profile."""
        total_started = perf_counter()
        digest = sha256()
        extent = QgsRectangle(feature["extent"])
        network_scope, network_engine, scope_decision, scope_seconds = self._network_influence_scope(
            feature, profile)
        self._stage_events.append({"stage": "effective-network-influence-scope", "profile": profile.name,
            "territory": f"{feature['territory']['kind']}/{feature['territory']['code']}",
            "mode": feature["mode"], "decision": scope_decision, "seconds": round(scope_seconds, 6)})
        scope_rect = network_scope.boundingBox()
        network_request = QgsFeatureRequest().setFilterRect(scope_rect)
        network_started = perf_counter()
        network_features = 0
        intersecting_features = 0
        overlay_features = 0
        for layer in self._network_layers.get(feature["mode"], ()):
            records = []
            for item in layer.getFeatures(network_request):
                network_features += 1
                source_geometry = item.geometry()
                if not network_engine.intersects(source_geometry.constGet()):
                    continue
                intersecting_features += 1
                if network_engine.contains(source_geometry.constGet()):
                    geometry = source_geometry
                else:
                    overlay_features += 1
                    geometry = source_geometry.intersection(network_scope)
                if geometry.isEmpty():
                    continue
                records.append(_canonical_geometry_wkb(geometry))
            layer_identity = layer.name().encode("utf-8") + b"\0"
            digest.update(layer_identity)
            for record in sorted(records):
                digest.update(len(record).to_bytes(8, "big"))
                digest.update(record)
        self._stage_events.append({"stage": "effective-identity-network-scan", "profile": profile.name,
            "territory": f"{feature['territory']['kind']}/{feature['territory']['code']}",
            "mode": feature["mode"], "decision": "validated", "features": network_features,
            "intersecting_features": intersecting_features, "overlay_features": overlay_features,
            "seconds": round(perf_counter() - network_started, 6)})
        ground = self._shared_ground
        geometry_started = perf_counter()
        visible_parts, parts_decision, parts_seconds = self._visible_ground_parts(feature, profile)
        for part in visible_parts:
            digest.update(part)
        self._stage_events.append({"stage": "visible-ground-derivatives", "profile": profile.name,
            "territory": f"{feature['territory']['kind']}/{feature['territory']['code']}",
            "mode": feature["mode"], "decision": parts_decision, "seconds": round(parts_seconds, 6)})
        self._stage_events.append({"stage": "effective-identity-visible-ground", "profile": profile.name,
            "territory": f"{feature['territory']['kind']}/{feature['territory']['code']}",
            "mode": feature["mode"], "decision": "validated",
            "seconds": round(perf_counter() - geometry_started, 6)})
        if profile.name == "inspection":
            ocs_started = perf_counter()
            ocs_digest, ocs_features, ocs_decision = self._ocsge_render_identity(
                ground.ocsge_layers, extent, profile)
            digest.update(ocs_digest)
            self._stage_events.append({"stage": "effective-identity-ocsge-scan", "profile": profile.name,
                "territory": f"{feature['territory']['kind']}/{feature['territory']['code']}",
                "mode": feature["mode"], "decision": ocs_decision, "features": ocs_features,
                "seconds": round(perf_counter() - ocs_started, 6)})
            metadata = self.raw_dir.parent.parent / "inst" / "extdata" / "theme-metadata"
            from inspection_plate import _source_citation
            digest.update(_source_citation(metadata, feature["mode"]).encode("utf-8"))
        identity = digest.hexdigest()
        self._stage_events.append({"stage": "effective-content-fingerprint-total", "profile": profile.name,
            "territory": f"{feature['territory']['kind']}/{feature['territory']['code']}",
            "mode": feature["mode"], "decision": "completed",
            "seconds": round(perf_counter() - total_started, 6)})
        return {"visible_content_sha256": identity}

    def _network_influence_scope(self, feature, profile):
        extent = QgsRectangle(feature["extent"])
        extent_key = (extent.xMinimum(), extent.yMinimum(), extent.xMaximum(), extent.yMaximum())
        analytical = feature.get("analytical_geometry")
        scope_key = (profile.name, profile.size, extent_key,
            bytes(analytical.asWkb()) if profile.name == "inline" and analytical is not None else b"",
            json.dumps(_network_stroke_contract(profile), sort_keys=True))
        cached = self._network_scope_cache.get(scope_key)
        if cached is not None:
            return cached[0], cached[1], "reused-in-run", 0.0
        identity = sha256(json.dumps({"profile": profile.name, "size": profile.size,
            "extent": extent_key, "analytical_wkb_sha256": sha256(scope_key[3]).hexdigest(),
            "stroke": scope_key[4], "scope_version": 1}, sort_keys=True).encode()).hexdigest()
        stage = self._network_scope_cache_root / identity
        started = perf_counter()
        if not self._scope_cache_refresh:
            try:
                manifest = json.loads((stage / "manifest.json").read_text(encoding="utf-8"))
                data = (stage / "scope.wkb").read_bytes()
                if (manifest.get("schema") == 1 and manifest.get("identity") == identity
                        and manifest.get("sha256") == sha256(data).hexdigest()):
                    geometry = QgsGeometry()
                    geometry.fromWkb(data)
                    if not geometry.isNull() and geometry.type() == QgsWkbTypes.PolygonGeometry:
                        engine = QgsGeometry.createGeometryEngine(geometry.constGet())
                        engine.prepareGeometry()
                        self._network_scope_cache[scope_key] = (geometry, engine)
                        return geometry, engine, "reused", perf_counter() - started
            except (OSError, ValueError, TypeError, AttributeError):
                pass
        frame_geometry = QgsGeometry.fromRect(extent)
        if profile.name == "inline":
            halo = _network_stroke_halo(extent, profile)
            network_scope = QgsGeometry(analytical).buffer(halo, 8)
            network_scope = network_scope.intersection(frame_geometry.buffer(halo, 8))
        else:
            # Inspection renders a rectangular raster: QGIS clips stroke paint
            # to the frame, so centerlines outside it cannot influence pixels.
            network_scope = frame_geometry
        engine = QgsGeometry.createGeometryEngine(network_scope.constGet())
        engine.prepareGeometry()
        self._network_scope_cache[scope_key] = (network_scope, engine)
        stage.mkdir(parents=True, exist_ok=True)
        data = bytes(network_scope.asWkb())
        temporary_data = stage / f".scope-{uuid4().hex}.tmp"
        temporary_manifest = stage / f".manifest-{uuid4().hex}.tmp"
        try:
            temporary_data.write_bytes(data)
            os.replace(temporary_data, stage / "scope.wkb")
            temporary_manifest.write_text(json.dumps({"schema": 1, "identity": identity,
                "sha256": sha256(data).hexdigest()}, sort_keys=True), encoding="utf-8")
            os.replace(temporary_manifest, stage / "manifest.json")
        finally:
            temporary_data.unlink(missing_ok=True)
            temporary_manifest.unlink(missing_ok=True)
        return network_scope, engine, "built", perf_counter() - started

    def _visible_ground_parts(self, feature, profile):
        """Share exact clipped ground derivatives between content and ground identities."""
        extent = QgsRectangle(feature["extent"])
        geometry = feature.get("geometry")
        region = feature.get("region_geometry")
        analysis = feature.get("analytical_geometry")
        analysis_wkb = bytes(analysis.asWkb()) if analysis is not None else b""
        territory_wkb = bytes(geometry.asWkb()) if geometry is not None else b""
        region_wkb = bytes(region.asWkb()) if region is not None else b""
        frame = QgsGeometry.fromRect(extent)
        scope = frame if profile.name == "inspection" else frame.intersection(analysis)
        context_wkb = self._visible_context_scope_wkb(feature, profile, scope)
        identity_payload = {"schema": 2, "kind": feature["territory"]["kind"],
            "profile": profile.name, "size": profile.size,
            "extent": [extent.xMinimum(), extent.yMinimum(), extent.xMaximum(), extent.yMaximum()],
            "analysis_sha256": sha256(analysis_wkb).hexdigest(),
            "territory_sha256": sha256(territory_wkb).hexdigest(),
            "region_sha256": sha256(region_wkb).hexdigest(),
            "context_sha256": sha256(context_wkb).hexdigest()}
        identity = sha256(json.dumps(identity_payload, sort_keys=True).encode()).hexdigest()
        key = identity
        cached = self._visible_ground_parts_cache.get(key)
        if cached is not None:
            return cached, "reused-in-run", 0.0
        started = perf_counter()
        stage = self._visible_ground_parts_cache_root / identity
        if not self._scope_cache_refresh:
            try:
                manifest = json.loads((stage / "manifest.json").read_text(encoding="utf-8"))
                if manifest.get("schema") == 1 and manifest.get("identity") == identity:
                    parts = tuple((stage / f"{name}.wkb").read_bytes()
                        for name in ("context", "territory", "frontier"))
                    hashes = {name: sha256(data).hexdigest()
                        for name, data in zip(("context", "territory", "frontier"), parts)}
                    if hashes == manifest.get("files"):
                        self._visible_ground_parts_cache[key] = parts
                        return parts, "reused", perf_counter() - started
            except (OSError, ValueError, TypeError, AttributeError):
                pass
        context_part = _canonical_geometry_wkb(self._shared_ground.context_geometry.intersection(scope))
        territory_part = _canonical_geometry_wkb(geometry.intersection(scope)) if geometry is not None else b""
        frontier_part = b""
        if region is not None:
            frontier_part = _canonical_geometry_wkb(self._shared_ground.frontier_for(region).intersection(scope))
        parts = (context_part, territory_part, frontier_part)
        self._visible_ground_parts_cache[key] = parts
        stage.mkdir(parents=True, exist_ok=True)
        names = ("context", "territory", "frontier")
        files = {name: sha256(data).hexdigest() for name, data in zip(names, parts)}
        temporaries = []
        try:
            for name, data in zip(names, parts):
                temporary = stage / f".{name}-{uuid4().hex}.tmp"
                temporary.write_bytes(data)
                temporaries.append(temporary)
                os.replace(temporary, stage / f"{name}.wkb")
            temporary_manifest = stage / f".manifest-{uuid4().hex}.tmp"
            temporaries.append(temporary_manifest)
            temporary_manifest.write_text(json.dumps({"schema": 1, "identity": identity,
                "files": files}, sort_keys=True), encoding="utf-8")
            os.replace(temporary_manifest, stage / "manifest.json")
        finally:
            for temporary in temporaries:
                temporary.unlink(missing_ok=True)
        return parts, "built", perf_counter() - started

    def _visible_context_scope_wkb(self, feature, profile, scope):
        """Memoize exact visible-context content for a scope within this prepared run."""
        extent = QgsRectangle(feature["extent"])
        analysis = feature.get("analytical_geometry")
        analysis_key = (_canonical_geometry_wkb(analysis)
            if profile.name == "inline" and analysis is not None else b"")
        key = ((extent.xMinimum(), extent.yMinimum(), extent.xMaximum(), extent.yMaximum()),
            profile.name, profile.size, analysis_key)
        cached = self._context_scope_cache.get(key)
        if cached is not None:
            return cached
        bounds = scope.boundingBox()
        candidates = [geometry for geometry in self._shared_ground.context_geometries
            if geometry.boundingBox().intersects(bounds)]
        context_scope = (QgsGeometry.unaryUnion(candidates).intersection(scope)
            if candidates else QgsGeometry())
        value = _canonical_geometry_wkb(context_scope)
        self._context_scope_cache[key] = value
        return value

    def _ocsge_render_identity(self, layers, extent, profile):
        """Cache a deterministic fingerprint of styled OCS-GE geometry per run."""
        if profile.name != "inspection":
            return b"", 0, "not-required"
        palette_path = Path(__file__).with_name("network-palette.json")
        palette_bytes = palette_path.read_bytes()
        key = (sha256(palette_bytes).digest(),
            (extent.xMinimum(), extent.yMinimum(), extent.xMaximum(), extent.yMaximum()),
            tuple((layer.source(), layer.name()) for layer in layers))
        if key in self._ocsge_identity_cache:
            digest, count = self._ocsge_identity_cache[key]
            return digest, count, "reused-in-run"
        classes = json.loads(palette_bytes)["classes"]
        rendered = {code for code, spec in classes.items()
            if spec["treatment"] in {"woodland", "only-where-US6.3", "neutral-water"}}
        records = []
        count = 0
        scope = QgsGeometry.fromRect(extent)
        for layer in layers:
            for item in layer.getFeatures(QgsFeatureRequest().setFilterRect(extent)):
                count += 1
                code_cs = item["code_cs"]
                if code_cs not in rendered:
                    continue
                style = classes[code_cs]
                if style["treatment"] == "only-where-US6.3" and item["code_us"] != "US6.3":
                    continue
                geometry = item.geometry().intersection(scope)
                if geometry.isEmpty():
                    continue
                code_us = str(item["code_us"]) if style["treatment"] == "only-where-US6.3" else None
                records.append((_canonical_geometry_wkb(geometry), str(code_cs), code_us,
                    _palette_render_contract(style)))
        result = sha256()
        for geometry, code_cs, code_us, style in sorted(records,
                key=lambda row: (row[0], row[1], row[2] or "", json.dumps(row[3], sort_keys=True))):
            result.update(geometry)
            result.update(json.dumps([code_cs, code_us, style], sort_keys=True).encode())
        value = result.digest()
        self._ocsge_identity_cache[key] = (value, count)
        return value, count, "validated"

    def _ground_identity_cache_key(self, feature, profile, recipe=None):
        extent = feature["extent"]
        territory = feature.get("geometry")
        region = feature.get("region_geometry")
        foundation = recipe.foundation if recipe is not None else network_recipe().foundation
        return (feature["territory"]["kind"],
            _canonical_geometry_wkb(feature["analytical_geometry"]),
            _canonical_geometry_wkb(territory) if territory is not None else b"",
            _canonical_geometry_wkb(region) if region is not None else b"",
            (extent.xMinimum(), extent.yMinimum(), extent.xMaximum(), extent.yMaximum()),
            profile.name, profile.size,
            json.dumps({"ground": foundation.ground, "framing": foundation.framing,
                "geography": foundation.geography}, sort_keys=True, default=str))

    def render(self, recipe: Recipe, feature: Mapping, profile, output_dir: Path) -> Path:
        from inspection_plate import compose_inspection
        from map_ground import apply_inline_mask, apply_inline_shadow, prepare_ground, render_layers

        output_dir.mkdir(parents=True, exist_ok=True)
        project = QgsProject.instance()
        assets = Path(__file__).with_name("assets")
        if self._shared_ground is None or not self._network_layers:
            raise RuntimeError("NetworkAdapter.prepare_run must complete before rendering outputs")
        territory = feature["territory"]
        inline_settings = recipe.foundation.composition.get("inline", {}).get("shadow", {})
        ground_identity_started = perf_counter()
        ground_id = self._ground_id(feature, profile, recipe)
        self._stage_events.append({"stage": "territory-ground-identity-total", "profile": profile.name,
            "territory": f"{feature['territory']['kind']}/{feature['territory']['code']}",
            "mode": feature["mode"], "identity": ground_id, "decision": "completed",
            "seconds": round(perf_counter() - ground_identity_started, 6)})
        cache_key = ground_id
        prepared = self._ground_cache.get(cache_key)
        if prepared is None:
            stage = output_dir / ".stage-cache" / "ground" / ground_id
            cache_validation_started = perf_counter()
            prepared = None if self._refresh else self._read_ground_stage(stage, profile.size, feature["extent"])
            cache_validation_seconds = perf_counter() - cache_validation_started
            self._stage_events.append({"stage": "territory-ground-cache-validation", "profile": profile.name,
                "territory": f"{feature['territory']['kind']}/{feature['territory']['code']}",
                "mode": feature["mode"], "identity": ground_id,
                "decision": "validated" if prepared is not None else "missing-cache",
                "seconds": round(cache_validation_seconds, 6)})
            if prepared is None:
                started = perf_counter()
                prepared = prepare_ground(project, feature, profile.size[0], self._shared_ground,
                    include_ocsge=profile.name == "inspection",
                    ground_settings=recipe.foundation.ground)
                self._write_ground_stage(stage, prepared)
                decision = "built"
                seconds = round(perf_counter() - started, 3)
            else:
                decision, seconds = "reused", 0.0
            self._stage_events.append({"stage": "territory-ground", "profile": profile.name,
                "identity": ground_id, "decision": decision, "seconds": seconds})
            self._ground_cache[cache_key] = prepared
        else:
            self._stage_events.append({"stage": "territory-ground", "profile": profile.name,
                "identity": ground_id, "decision": "shared-in-run", "seconds": 0.0})
        network_layers = self._network_layers[feature["mode"]]
        networks = render_layers(
            project, prepared.extent, network_layers, QColor(0, 0, 0, 0), profile.size[0]
        )
        if profile.name == "inline":
            image = prepared.ground.copy().convertToFormat(QImage.Format_RGBA8888)
            painter = QPainter(image)
            painter.drawImage(0, 0, networks)
            painter.end()
            image = apply_inline_mask(image, prepared.territory_border,
                                      feature["analytical_geometry"], prepared.extent)
            image = apply_inline_shadow(image, inline_settings or None)
        else:
            if profile.name != "inspection":
                raise ValueError(f"Unsupported map profile: {profile.name}")
            mode_runs, content = _title_and_content(feature["mode"], self.family_config)
            metadata = self.raw_dir.parent.parent / "inst" / "extdata" / "theme-metadata"
            inspection_settings = recipe.foundation.composition.get("inspection", {})
            desaturate_outside_land = (inspection_settings.get("desaturate_outside_land", True)
                if isinstance(inspection_settings, Mapping) else True)
            image = compose_inspection(
                prepared.ground, networks, prepared.boundaries, prepared.outside_land,
                prepared.land_mask, prepared.extent, feature["territory"]["name"],
                mode_runs, content, assets, metadata, _inspection_scale(prepared.extent),
                desaturate_outside_land,
            )
        path = output_dir / f"{feature['territory']['code']}-{feature['mode']}-{profile.name}.png"
        if not image.save(str(path), "PNG"):
            raise RuntimeError(f"Could not save production map: {path}")
        return path

    @staticmethod
    def expected_output_path(feature: Mapping, profile, output_dir: Path) -> Path:
        return output_dir / f"{feature['territory']['code']}-{feature['mode']}-{profile.name}.png"

    def _ground_id(self, feature, profile, recipe=None):
        cache_key = self._ground_identity_cache_key(feature, profile, recipe)
        cached_identity = self._identity_cache.get(cache_key)
        if cached_identity is not None:
            self._stage_events.append({"stage": "territory-ground-identity-ocsge-scan",
                "profile": profile.name,
                "territory": f"{feature['territory']['kind']}/{feature['territory']['code']}",
                "mode": feature["mode"], "decision": "reused-in-run", "features": 0,
                "seconds": 0.0})
            self._stage_events.append({"stage": "territory-ground-identity-total", "profile": profile.name,
                "territory": f"{feature['territory']['kind']}/{feature['territory']['code']}",
                "mode": feature["mode"], "identity": cached_identity, "decision": "reused-in-run",
                "seconds": 0.0})
            return cached_identity
        started = perf_counter()
        from map_ground import SHARED_GROUND_RENDER_VERSION
        digest = sha256()
        # Ground raster/frontier consumes territory shape and extent, not mode,
        # network marks, furniture, citations, or inline shadow/mask composition.
        extent = feature["extent"]
        digest.update(str(feature["territory"]["kind"]).encode())
        digest.update(_canonical_geometry_wkb(feature["analytical_geometry"]))
        visible_parts, parts_decision, parts_seconds = self._visible_ground_parts(feature, profile)
        for part in visible_parts:
            digest.update(part)
        self._stage_events.append({"stage": "visible-ground-derivatives", "profile": profile.name,
            "territory": f"{feature['territory']['kind']}/{feature['territory']['code']}",
            "mode": feature["mode"], "decision": parts_decision, "seconds": round(parts_seconds, 6)})
        digest.update(json.dumps([[extent.xMinimum(), extent.yMinimum(), extent.xMaximum(), extent.yMaximum()],
            profile.name, profile.size], default=str).encode())
        ground_rules = recipe.foundation.ground if recipe is not None else network_recipe().foundation.ground
        digest.update(json.dumps({"version": SHARED_GROUND_RENDER_VERSION,
            "rules": ground_rules.get("inspection_surface" if profile.name == "inspection" else "inline_surface"),
            "water": ground_rules.get("water")}, sort_keys=True).encode())
        digest.update(f"qgis={Qgis.QGIS_VERSION}|qt={QT_VERSION_STR}".encode())
        texture_path = Path(__file__).with_name("assets") / "texture" / "qgis-hub-paper-texture-cc0.jpg"
        digest.update(sha256(texture_path.read_bytes()).digest())
        ocs_started = perf_counter()
        ocs_features = 0
        if profile.name == "inspection":
            ocs_digest, ocs_features, ocs_decision = self._ocsge_render_identity(
                self._shared_ground.ocsge_layers, extent, profile)
            digest.update(ocs_digest)
        identity = digest.hexdigest()
        self._identity_cache[cache_key] = identity
        self._stage_events.append({"stage": "territory-ground-identity-ocsge-scan", "profile": profile.name,
            "territory": f"{feature['territory']['kind']}/{feature['territory']['code']}",
            "mode": feature["mode"], "decision": ocs_decision if profile.name == "inspection" else "not-required",
            "features": ocs_features,
            "seconds": round(perf_counter() - ocs_started, 6)})
        self._stage_events.append({"stage": "territory-ground-identity-total", "profile": profile.name,
            "territory": f"{feature['territory']['kind']}/{feature['territory']['code']}",
            "mode": feature["mode"], "identity": identity, "decision": "completed",
            "seconds": round(perf_counter() - started, 6)})
        return identity

    def _write_ground_stage(self, directory, prepared):
        directory.mkdir(parents=True, exist_ok=True)
        generation = uuid4().hex
        staging = Path(tempfile.mkdtemp(prefix=".stage-", dir=directory))
        files = {}
        try:
            for name in ("ground", "boundaries", "territory_border"):
                path = staging / f"{name}.png"
                if not getattr(prepared, name).save(str(path), "PNG"):
                    raise RuntimeError(f"Could not persist ground stage: {path}")
                files[path.name] = sha256(path.read_bytes()).hexdigest()
            mask = staging / "land-mask.npy"
            np.save(mask, prepared.land_mask)
            files[mask.name] = sha256(mask.read_bytes()).hexdigest()
            manifest = {"schema": 1, "identity": directory.name, "generation": generation, "files": files,
                "outside": base64.b64encode(bytes(prepared.outside_land.asWkb())).decode(),
                "extent": [prepared.extent.xMinimum(), prepared.extent.yMinimum(),
                           prepared.extent.xMaximum(), prepared.extent.yMaximum()]}
            generation_path = directory / generation
            os.replace(staging, generation_path)
            manifest_fd, manifest_tmp = tempfile.mkstemp(prefix=".manifest-", suffix=".tmp", dir=directory)
            try:
                with os.fdopen(manifest_fd, "w", encoding="utf-8") as stream:
                    json.dump(manifest, stream, sort_keys=True)
                    stream.flush()
                    os.fsync(stream.fileno())
                os.replace(manifest_tmp, directory / "manifest.json")
            finally:
                if os.path.exists(manifest_tmp):
                    os.unlink(manifest_tmp)
        finally:
            if staging.exists():
                import shutil
                shutil.rmtree(staging, ignore_errors=True)

    def _read_ground_stage(self, directory, size, expected_extent=None):
        from map_ground import PreparedGround
        try:
            output_root = directory.parents[2].resolve()
            if not directory.parent.resolve().is_relative_to(output_root):
                return None
            if directory.resolve().parent != directory.parent.resolve():
                return None
            manifest = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
            expected = {"ground.png", "boundaries.png", "territory_border.png", "land-mask.npy"}
            if (not isinstance(manifest, dict) or manifest.get("schema") != 1
                    or manifest.get("identity") != directory.name
                    or not isinstance(manifest.get("generation"), str)
                    or len(manifest["generation"]) != 32
                    or any(ch not in "0123456789abcdef" for ch in manifest["generation"])
                    or not isinstance(manifest.get("files"), dict)
                    or set(manifest["files"]) != expected
                    or not isinstance(manifest.get("extent"), list) or len(manifest["extent"]) != 4):
                return None
            generation = directory / manifest["generation"]
            if generation.resolve().parent != directory.resolve():
                return None
            paths = {name: generation / name for name in manifest["files"]}
            if any(path.resolve().parent != generation.resolve() for path in paths.values()):
                return None
            if any(not path.is_file() or sha256(path.read_bytes()).hexdigest() != manifest["files"][name]
                   for name, path in paths.items()):
                return None
            images = {name[:-4]: QImage(str(path)) for name, path in paths.items() if name.endswith(".png")}
            if any(image.isNull() or image.width() != size[0] or image.height() != size[1]
                   for image in images.values()):
                return None
            mask = np.load(paths["land-mask.npy"], allow_pickle=False)
            if (mask.shape != (size[1], size[0]) or mask.dtype != np.float32
                    or not np.isfinite(mask).all() or mask.min() < 0 or mask.max() > 1):
                return None
            raw_extent = manifest["extent"]
            if any(not isinstance(value, (int, float)) for value in raw_extent):
                return None
            extent = QgsRectangle(*raw_extent)
            if extent.isEmpty():
                return None
            if expected_extent is not None:
                expected_extent = QgsRectangle(expected_extent)
                actual = (extent.xMinimum(), extent.yMinimum(), extent.xMaximum(), extent.yMaximum())
                expected = (expected_extent.xMinimum(), expected_extent.yMinimum(),
                            expected_extent.xMaximum(), expected_extent.yMaximum())
                if actual != expected:
                    return None
            geom = QgsGeometry()
            geom.fromWkb(base64.b64decode(manifest["outside"], validate=True))
            if geom.isNull() or (not geom.isEmpty() and geom.type() != QgsWkbTypes.PolygonGeometry):
                return None
            if not geom.isEmpty() and not extent.contains(geom.boundingBox()):
                return None
            return PreparedGround(images["ground"], images["boundaries"], images["territory_border"],
                geom, mask, extent)
        except (OSError, ValueError, KeyError, TypeError, AttributeError, json.JSONDecodeError):
            return None

    def validate(self, path: Path, feature: Mapping, profile) -> None:
        image = QImage(str(path))
        if image.isNull() or (image.width(), image.height()) != profile.size:
            raise ValueError(f"Invalid {profile.name} image dimensions or decode: {path}")
        if profile.name == "inspection":
            if image.pixelColor(0, 0).alpha() != 255 or image.pixelColor(100, 170).alpha() != 255:
                raise ValueError("Inspection plate must have an opaque ground and title region")
            return
        if image.format() not in (QImage.Format_RGBA8888, QImage.Format_ARGB32,
                                  QImage.Format_ARGB32_Premultiplied):
            raise ValueError("Inline profile must retain RGBA alpha")
        geometry = feature["analytical_geometry"]
        extent = QgsRectangle(feature["extent"])
        pixel_size = extent.width() / image.width()
        polygons = geometry.asMultiPolygon() if geometry.isMultipart() else [geometry.asPolygon()]
        boundary_rings = [ring for polygon in polygons for ring in polygon]
        boundary = QgsGeometry.fromMultiPolylineXY(boundary_rings)
        geometry_engine = QgsGeometry.createGeometryEngine(geometry.constGet())
        geometry_engine.prepareGeometry()
        boundary_engine = QgsGeometry.createGeometryEngine(boundary.constGet())
        boundary_engine.prepareGeometry()
        maximum_shadow_alpha = round(INLINE_SHADOW_OPACITY * 255)
        shadow_reach = (
            INLINE_SHADOW_BLUR_RADIUS_PX + INLINE_SHADOW_OFFSET_Y_PX + 1
        ) * pixel_size
        inside_samples = outside_samples = hole_samples = 0
        for row in range(1, 50):
            for column in range(1, 50):
                x = round(column * image.width() / 50)
                y = round(row * image.height() / 50)
                if x >= image.width() or y >= image.height():
                    continue
                map_point = QgsPointXY(
                    extent.xMinimum() + (x + 0.5) / image.width() * extent.width(),
                    extent.yMaximum() - (y + 0.5) / image.height() * extent.height(),
                )
                point = QgsGeometry.fromPointXY(map_point)
                boundary_distance = boundary_engine.distance(point.constGet())
                if boundary_distance < pixel_size * 2.0:
                    continue
                inside = geometry_engine.contains(point.constGet())
                alpha = image.pixelColor(x, y).alpha()
                if inside:
                    inside_samples += 1
                    if alpha != 255:
                        raise ValueError(f"Inline interior should be opaque away from boundary at pixel {(x, y)}")
                else:
                    outside_samples += 1
                    if alpha > maximum_shadow_alpha:
                        raise ValueError(f"Inline shadow exceeds its opacity contract at pixel {(x, y)}")
                    if boundary_distance > shadow_reach and alpha != 0:
                        raise ValueError(f"Inline shadow extends beyond its halo at pixel {(x, y)}")
                    if not inside and geometry_engine.distance(point.constGet()) > pixel_size * 2:
                        hole_samples += 1
        if not inside_samples or not outside_samples:
            raise ValueError("Inline geometry QA did not sample both interior and exterior pixels")
        for polygon in polygons:
            for ring in polygon[1:]:
                hole = QgsGeometry.fromPolygonXY([ring]).pointOnSurface()
                if hole.isEmpty():
                    continue
                point = hole.asPoint()
                hole_point = QgsGeometry.fromPointXY(point)
                boundary_distance = boundary_engine.distance(hole_point.constGet())
                if boundary_distance < pixel_size * 2:
                    continue
                x = round((point.x() - extent.xMinimum()) / extent.width() * image.width())
                y = round((extent.yMaximum() - point.y()) / extent.height() * image.height())
                if 0 <= x < image.width() and 0 <= y < image.height():
                    hole_samples += 1
                    alpha = image.pixelColor(x, y).alpha()
                    if alpha > maximum_shadow_alpha:
                        raise ValueError(f"Inline polygon hole exceeds the shadow opacity at pixel {(x, y)}")
                    if boundary_distance > shadow_reach and alpha != 0:
                        raise ValueError(f"Inline polygon hole shadow extends beyond its halo at pixel {(x, y)}")
        if image.pixelColor(0, 0).alpha() != 0:
            raise ValueError("Inline map frame exterior must be transparent")


def _inspection_scale(extent: QgsRectangle) -> tuple[str, float]:
    """The prototype's two-segment, roughly 20%-of-frame scale step."""
    target_step = extent.width() * 0.10
    unit = "km" if target_step >= 1000 else "m"
    value = target_step / 1000 if unit == "km" else target_step
    magnitude = 10 ** int(__import__("math").floor(__import__("math").log10(value)))
    step = max((factor * magnitude for factor in (1, 2, 5, 10) if factor * magnitude <= value), default=magnitude)
    return unit, step
