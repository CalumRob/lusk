"""Exploratory AEDAR address maps on the shared production map ground.

This family is deliberately isolated from ``network.py`` and its renderers. It
uses the generic production runner and existing map-ground preparation, while
owning its address symbols, legend, title and artifacts here.
"""
from __future__ import annotations

from hashlib import sha256
import json
import os
from pathlib import Path
import platform
import tempfile
from functools import lru_cache
from time import perf_counter
from typing import Mapping

import pyarrow.parquet as pq
import pyarrow.dataset as ds
import pyarrow.compute as pc
import pyarrow as pa
import numpy as np
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from qgis.PyQt.QtCore import QPointF, QRect, QVariant, Qt
from qgis.PyQt.QtGui import QColor, QFont, QFontDatabase, QImage, QPainter, QPolygonF
from qgis.core import (
    Qgis, QgsCoordinateReferenceSystem, QgsCoordinateTransform, QgsFeature,
    QgsFeatureRequest, QgsField, QgsGeometry, QgsMarkerSymbol, QgsPointXY, QgsProject, QgsRectangle,
    QgsRendererRange, QgsGraduatedSymbolRenderer, QgsVectorLayer,
)

from runner import Binding, Foundation, MapSet, Recipe
from aedar_hex_grid import prepare_hex_grid
from aedar_commune_frames import CommuneFrameIndex


MODES = ("car", "transit", "bike_lts2")
LOSS_MODES = ("car", "transit", "bike_lts2", "bike_lts4", "walk")
CONTINUOUS_MODE = {mode: f"{mode}_continuous" for mode in MODES}
LOSS_SCALE_MAX = 218.0
ADDRESS_METRICS_FILENAME = "address-access-metrics.parquet"
ADDRESS_SCENARIOS = {
    "car": ("address-car-53-2026v1.parquet", "car"),
    "transit_p1": ("address-transit-53-2026v1.parquet", "transit"),
    "transit_gain_p1": ("address-transit-gain-53-2026v1.parquet", "transit_gain"),
    "bike_lts4": ("address-bike-lts4-53-2026v1.parquet", "bike_lts4"),
    "bike_lts2": ("address-bike-lts2-53-2026v1.parquet", "bike_lts2"),
    "walk": ("address-walk-53-2026v1.parquet", "walk"),
}
CAR_LOSS_SCENARIOS = ("transit_p1", "transit_gain_p1", "bike_lts2", "bike_lts4", "walk")
MEASURE = "diversity"
HORIZON = 15
# Rural commune sample for the sparse-address rendering trial.
TERRITORIES = (("commune", "22001"), ("epci", "243500741"), ("region", "53"))
MAP_CRS = QgsCoordinateReferenceSystem("EPSG:2154")
MODE_PALETTES = {
    # Value ramps retain each mode's established hue while stepping from clear
    # mid-light colors to a darker high class without turning the map inky.
    "car": ("#E9B2BE", "#D78A9C", "#C4667E", "#AD4562", "#87334E"),
    "transit": ("#A8D6DE", "#7EBBC7", "#579EAE", "#387F91", "#285F70"),
    "bike_lts2": ("#A8C8CD", "#7CAAB2", "#588C97", "#3C7180", "#2E6171"),
    "bike_lts4": ("#A8C8CD", "#7CAAB2", "#588C97", "#3C7180", "#2E6171"),
    "walk": ("#B7D4BF", "#8FBE9B", "#6BA47A", "#4E8A62", "#356D49"),
}
MODE_TITLE_COLOURS = {
    "car": "#A94562",
    "transit": "#448FA6",
    "bike_lts2": "#86A2A8",
    "bike_lts4": "#2E6171",
    "walk": "#92BCC6",
}
MODE_LABELS = {"car": "en voiture", "transit": "en transports",
               "bike_lts2": "à vélo", "bike_lts4": "à vélo (LTS 4)",
               "walk": "à pied"}


def aedar_recipe() -> Recipe:
    return Recipe(
        name="aedar-address-access-exploration",
        version=19,
        family="aedar",
        foundation=Foundation(
            version="shared-network-map-ground-v2",
            framing={"shape": "square-circular-frame", "margin_ratio": 0.08},
            geography={"territory": "Admin Express COG 2025"},
            ground={"inspection_surface": "ocsge-selected-cs", "water": "sea-colour"},
            composition={"inspection": {"style": "aedar-address-dot-map", "version": 20},
                         "inline": {"style": "aedar-median-hex-grid", "version": 1,
                                    "cell_width_px": 9}},
        ),
        required_fields=("geometry", "territory", "mode", "analytical_geometry",
                         "extent", "facts_path", "value_field", "measure", "horizon", "scale_breaks"),
    )


def aedar_loss_recipe() -> Recipe:
    """Recipe for continuous car-diversity and exact TYPEQU-loss maps."""
    return Recipe(
        name="aedar-address-equipment-loss-exploration",
        version=1,
        family="aedar",
        foundation=Foundation(
            version="shared-network-map-ground-v2",
            framing={"shape": "square-circular-frame", "margin_ratio": 0.08},
            geography={"territory": "Admin Express COG 2025"},
            ground={"inspection_surface": "ocsge-selected-cs", "water": "sea-colour"},
            composition={"inspection": {"style": "aedar-address-equipment-loss", "version": 1},
                         "inline": {"style": "aedar-median-hex-grid", "version": 1,
                                    "cell_width_px": 9}},
        ),
        required_fields=("geometry", "territory", "mode", "analytical_geometry",
                         "extent", "facts_path", "value_field", "measure", "horizon", "scale_breaks",
                         "comparison", "title_prefix", "title_mode", "legend_label"),
    )


def _aedar_representative_bases(raw_dir: str | Path) -> dict[tuple[str, str], dict]:
    """Reuse standard territory frames and derive the exploratory commune if needed."""
    from network import _load_network_family_config, _map_extent, _projected, build_representative_map_set

    representative = build_representative_map_set(raw_dir)
    bases = {(feature["territory"]["kind"], feature["territory"]["code"]): feature
             for features in representative.map_set.layers.values() for feature in features
             if (feature["territory"]["kind"], feature["territory"]["code"]) in TERRITORIES}
    commune_key = next(key for key in TERRITORIES if key[0] == "commune")
    if commune_key in bases:
        return bases

    layer = QgsVectorLayer(str(Path(raw_dir) / "communes_limites.geojson"), "map-ready communes", "ogr")
    if not layer.isValid():
        raise ValueError("Could not open authoritative commune geometry for the AEDAR sample")
    project = QgsProject.instance()
    region = bases[("region", "53")]
    from inspection_frame import InspectionFramePolicy
    frame_policy = InspectionFramePolicy(_load_network_family_config())
    for source_feature in layer.getFeatures():
        if str(source_feature["code_insee"]) != commune_key[1]:
            continue
        geometry = _projected(source_feature.geometry(), layer.crs(), project)
        name = str(source_feature["nom_officiel"])
        extent = _map_extent(geometry)
        bases[commune_key] = {
            "territory": {"kind": "commune", "code": commune_key[1],
                          "name": name},
            "mode": "car", "geometry": geometry,
            "analytical_geometry": geometry,
            "region_geometry": region.get("region_geometry", region["geometry"]),
            "extent": extent,
            "inspection_extent": frame_policy.extent_for(geometry, extent, name),
        }
        break
    if commune_key not in bases:
        raise ValueError(f"Authoritative commune source has no geometry for {commune_key[1]}")
    return bases


def build_aedar_map_set(raw_dir: str | Path, facts_dir: str | Path,
                        address_origin_spine: str | Path) -> Binding:
    """Bind each territory/mode map to its own exploratory equal-width scale."""
    bases = _aedar_representative_bases(raw_dir)
    facts_dir = Path(facts_dir)
    spine_path = Path(address_origin_spine)
    if not spine_path.is_file():
        raise FileNotFoundError(f"Missing authoritative address-origin spine: {spine_path}")
    territory_codes = _territory_commune_codes(Path(raw_dir))
    path = facts_dir / ADDRESS_METRICS_FILENAME
    if not path.is_file():
        raise FileNotFoundError(f"Missing consolidated AEDAR address metrics: {path}")
    dataset = ds.dataset(str(path), format="parquet")
    scenario_by_mode = {"car": "car", "transit": "transit_p1", "bike_lts2": "bike_lts2"}
    features = []
    for kind, code in TERRITORIES:
        base = bases[(kind, code)]
        codes = territory_codes[(kind, code)]
        scales = {}
        continuous_scales = {}
        for mode in MODES:
            value_field = f"diversity_{scenario_by_mode[mode]}_{HORIZON}"
            selected = dataset.scanner(
                columns=["code_insee", value_field],
                filter=ds.field("code_insee").isin(codes), use_threads=True,
            ).to_table()
            values = selected[value_field].to_numpy(zero_copy_only=False)
            scales[mode] = _equal_width_breaks(values)
            continuous_scales[mode] = _equal_width_breaks(values, 256)
        for mode in MODES:
            scale_breaks = scales[mode]
            value_field = f"diversity_{scenario_by_mode[mode]}_{HORIZON}"
            feature = {**base, "mode": mode,
                "facts_path": str(path.resolve()), "value_field": value_field,
                "measure": MEASURE, "horizon": HORIZON,
                "scale_breaks": scale_breaks,
                "territory_codes": codes}
            features.append(feature)
            features.append({**feature, "mode": CONTINUOUS_MODE[mode], "source_mode": mode,
                             "scale_type": "continuous",
                             "scale_breaks": continuous_scales[mode]})
    return Binding("aedar", MapSet({"aedar-address-variants": tuple(features)}))


def build_aedar_loss_map_set(raw_dir: str | Path, facts_dir: str | Path,
                             address_origin_spine: str | Path) -> Binding:
    """Bind car diversity and four exact car-only TYPEQU loss maps."""
    from aedar_map_content import loss_map_content
    bases = _aedar_representative_bases(raw_dir)
    facts_dir = Path(facts_dir)
    spine_path = Path(address_origin_spine)
    if not spine_path.is_file():
        raise FileNotFoundError(f"Missing authoritative address-origin spine: {spine_path}")
    territory_codes = _territory_commune_codes(Path(raw_dir))
    path = facts_dir / ADDRESS_METRICS_FILENAME
    if not path.is_file():
        raise FileNotFoundError(f"Missing consolidated AEDAR address metrics: {path}")
    dataset = ds.dataset(str(path), format="parquet")
    loss_fields = {
        "transit": f"loss_car_only_transit_p1_{HORIZON}",
        "bike_lts2": f"loss_car_only_bike_lts2_{HORIZON}",
        "bike_lts4": f"loss_car_only_bike_lts4_{HORIZON}",
        "walk": f"loss_car_only_walk_{HORIZON}",
    }
    features = []
    for kind, code in TERRITORIES:
        base = bases[(kind, code)]
        codes = territory_codes[(kind, code)]
        car_field = f"diversity_car_{HORIZON}"
        selected = dataset.scanner(
            columns=["code_insee", car_field, *loss_fields.values()],
            filter=ds.field("code_insee").isin(codes), use_threads=True,
        ).to_table()
        loss_arrays = []
        observed_maxima = {}
        for mode, value_field in loss_fields.items():
            values = selected[value_field]
            if pc.any(pc.is_null(values)).as_py() or (len(values) and
                    (pc.min(values).as_py() < 0 or pc.max(values).as_py() > LOSS_SCALE_MAX)):
                raise ValueError(f"AEDAR {mode} loss values exceed 0–{LOSS_SCALE_MAX:g}")
            array = values.to_numpy(zero_copy_only=False)
            loss_arrays.append(array)
            observed_maxima[mode] = float(np.max(array)) if len(array) else 0.0
        shared_loss_cap = _percentile_scale_cap(np.concatenate(loss_arrays))

        for mode in LOSS_MODES:
            value_field = car_field if mode == "car" else loss_fields[mode]
            values = selected[value_field]
            if mode == "car" and (pc.any(pc.is_null(values)).as_py() or (len(values) and
                    (pc.min(values).as_py() < 0 or pc.max(values).as_py() > LOSS_SCALE_MAX))):
                raise ValueError(f"AEDAR car values exceed 0–{LOSS_SCALE_MAX:g}")
            scale_cap = LOSS_SCALE_MAX if mode == "car" else shared_loss_cap
            mode_breaks = _equal_width_breaks((0.0, scale_cap), classes=5)
            content = loss_map_content(mode)
            features.append({
                **base, "mode": mode, "source_mode": mode,
                "facts_path": str(path.resolve()), "value_field": value_field,
                "measure": "diversity" if mode == "car" else "equipment_loss",
                "horizon": HORIZON,
                "scale_breaks": mode_breaks, "scale_type": "equal-width",
                "scale_cap": scale_cap,
                "scale_overflow": mode != "car" and observed_maxima[mode] > scale_cap,
                "comparison": "car-only-typequ", "territory_codes": codes,
                "title_prefix": content["title_prefix"], "title_mode": content["title_mode"],
                "helper": content["helper"], "legend_label": content["legend_label"],
            })
    return Binding("aedar", MapSet({"aedar-equipment-loss": tuple(features)}))


def prepare_aedar_frame_facts(raw_dir: str | Path, address_origin_spine: str | Path,
                              facts_dir: str | Path, *, refresh: bool = False) -> Path:
    """Write one sorted address-grain Parquet containing all AEDAR map metrics."""
    from aedar_buildings import count_lost_equipment_type_keys, prepare_aedar_building_facts

    spine_path, raw_dir, facts_dir = Path(address_origin_spine), Path(raw_dir), Path(facts_dir)
    spine_dataset = ds.dataset(str(spine_path), format="parquet")
    commune_codes = spine_dataset.to_table(columns=["code_insee"])["code_insee"].unique().to_pylist()
    bretagne_codes = tuple(code for code in commune_codes
                           if str(code)[:2] in {"22", "29", "35", "56"})
    if not bretagne_codes:
        raise ValueError("Address-origin spine contains no Bretagne commune codes")
    facts_dir.mkdir(parents=True, exist_ok=True)
    sources = {scenario: raw_dir / filename
               for scenario, (filename, _builder_mode) in ADDRESS_SCENARIOS.items()}
    sources["spine"] = spine_path
    signatures = {key: {"path": str(path.resolve()), "size_bytes": path.stat().st_size,
                        "mtime_ns": path.stat().st_mtime_ns}
                  for key, path in sources.items()}
    manifest_path = facts_dir / "preparation.json"
    output_path = facts_dir / ADDRESS_METRICS_FILENAME
    manifest = (json.loads(manifest_path.read_text(encoding="utf-8"))
                if manifest_path.is_file() else {})
    inputs_match = manifest.get("inputs") == signatures
    if (not refresh and manifest.get("version") == 4 and inputs_match
            and output_path.is_file()):
        print("[aedar] reusing consolidated address-access metrics", flush=True)
        return output_path

    spine_columns = ("address_id", "code_insee", "lon", "lat")
    spine = _filtered_address_spine(spine_dataset, spine_columns, bretagne_codes)
    metrics = spine
    car_type_keys = None
    bike_lts4_type_keys = None

    def add_sparse_metric(current: pa.Table, sparse: pa.Table, column: str) -> pa.Table:
        sparse = sparse.rename_columns(["code_insee", "cle_interop_adr", column])
        joined = current.join(sparse, keys=["code_insee", "cle_interop_adr"],
                              join_type="left outer")
        values = pc.cast(pc.fill_null(joined[column], 0), pa.int64())
        return joined.set_column(joined.schema.get_field_index(column), column, values)

    for scenario, (_filename, builder_mode) in ADDRESS_SCENARIOS.items():
        facts, type_keys = prepare_aedar_building_facts(
            sources[scenario], spine, code_insee=bretagne_codes,
            mode=builder_mode, horizons=(HORIZON,), include_type_access=True,
            spine_is_validated=True,
        )
        diversity_column = f"diversity_{scenario}_{HORIZON}"
        diversity = facts.select(["code_insee", "cle_interop_adr", "diversity_15"])
        diversity = diversity.rename_columns(["code_insee", "cle_interop_adr", diversity_column])
        metrics = metrics.join(diversity, keys=["code_insee", "cle_interop_adr"],
                               join_type="left outer")

        if scenario == "car":
            car_type_keys = type_keys
            continue
        if car_type_keys is None:
            raise RuntimeError("Car TYPEQU keys must be prepared before comparison scenarios")
        lost_vs_car = count_lost_equipment_type_keys(car_type_keys, type_keys)
        metrics = add_sparse_metric(metrics, lost_vs_car,
                                    f"loss_car_only_{scenario}_{HORIZON}")
        if scenario == "bike_lts4":
            bike_lts4_type_keys = type_keys
        elif scenario == "bike_lts2":
            if bike_lts4_type_keys is None:
                raise RuntimeError("Bike LTS4 TYPEQU keys must precede the LTS2 comparison")
            lost_vs_lts4 = count_lost_equipment_type_keys(bike_lts4_type_keys, type_keys)
            metrics = add_sparse_metric(metrics, lost_vs_lts4,
                                        f"loss_bike_lts2_vs_lts4_{HORIZON}")

    if metrics.num_rows != spine.num_rows:
        raise ValueError("Consolidated AEDAR metric table lost or duplicated address rows")
    order = pc.sort_indices(metrics, sort_keys=[("code_insee", "ascending"),
                                                ("cle_interop_adr", "ascending")])
    metrics = metrics.take(order)
    metadata = dict(metrics.schema.metadata or {})
    metadata.update({b"dataset": b"AEDAR 2026-v1 consolidated address-access metrics",
                     b"scenario_order": ",".join(ADDRESS_SCENARIOS).encode("utf-8"),
                     b"loss_policy": b"exact TYPEQU set difference; car-accessible but unavailable by scenario"})
    metrics = metrics.replace_schema_metadata(metadata)

    staged_path = facts_dir / f".{ADDRESS_METRICS_FILENAME}.tmp"
    try:
        pq.write_table(metrics, staged_path, compression="zstd", row_group_size=65_536)
        os.replace(staged_path, output_path)
    finally:
        staged_path.unlink(missing_ok=True)
    manifest_path.write_text(json.dumps({"version": 4, "inputs": signatures,
                                         "output": output_path.name,
                                         "rows": metrics.num_rows},
                                        indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"[aedar] prepared one sorted address-metrics table: {metrics.num_rows:,} rows", flush=True)
    return output_path


def _filtered_address_spine(spine_dataset, columns, commune_codes) -> pa.Table:
    """Read and validate the Brittany address universe once for all scenarios."""
    from aedar_buildings import _filtered_scanner

    _require_dataset_fields = set(spine_dataset.schema.names)
    missing = sorted(set(columns) - _require_dataset_fields)
    if missing:
        raise ValueError(f"Address-origin spine is missing required fields: {missing}")
    scanner = _filtered_scanner(spine_dataset, columns,
                                ds.field("code_insee").isin(commune_codes),
                                "address-origin spine")
    spine = scanner.to_table().rename_columns([
        "cle_interop_adr" if name == "address_id" else name for name in columns
    ])
    if not spine.num_rows:
        raise ValueError("Address-origin spine contains no Bretagne addresses")
    for coordinate in ("lon", "lat"):
        values = spine[coordinate]
        if (pc.any(pc.is_null(values)).as_py()
                or pc.any(pc.invert(pc.is_finite(values))).as_py()):
            raise ValueError(f"Address-origin spine {coordinate} contains null or non-finite values")
    duplicate_keys = spine.select(["code_insee", "cle_interop_adr"]).group_by(
        ["code_insee", "cle_interop_adr"], use_threads=True
    ).aggregate([("code_insee", "count")])
    if pc.max(duplicate_keys["code_insee_count"]).as_py() > 1:
        raise ValueError("Address-origin spine has duplicate (code_insee, cle_interop_adr) rows")
    order = pc.sort_indices(spine, sort_keys=[("code_insee", "ascending"),
                                              ("cle_interop_adr", "ascending")])
    return spine.take(order)


def _territory_commune_codes(raw_dir: Path) -> dict[tuple[str, str], tuple[str, ...]]:
    """Derive territory address code sets from the authoritative map-ready spine."""
    from qgis.core import QgsVectorLayer

    layer = QgsVectorLayer(str(raw_dir / "communes_limites.geojson"), "communes", "ogr")
    if not layer.isValid():
        raise ValueError("Could not open authoritative commune map-ready geography")
    selected = {key: [] for key in TERRITORIES}
    commune_key = next(key for key in TERRITORIES if key[0] == "commune")
    epci_key = next(key for key in TERRITORIES if key[0] == "epci")
    region_key = next(key for key in TERRITORIES if key[0] == "region")
    for feature in layer.getFeatures():
        code = str(feature["code_insee"])
        department = str(feature["code_insee_du_departement"])
        epcis = {item for item in str(feature["codes_siren_des_epci"] or "").split("/") if item}
        if code == commune_key[1]:
            selected[commune_key].append(code)
        if epci_key[1] in epcis and department in {"22", "29", "35", "56"}:
            selected[epci_key].append(code)
        if department in {"22", "29", "35", "56"}:
            selected[region_key].append(code)
    if any(not codes for codes in selected.values()):
        raise ValueError("Authoritative commune geography is missing a requested territory membership")
    return {key: tuple(codes) for key, codes in selected.items()}


def _frame_commune_codes(raw_dir: Path, extent: QgsRectangle) -> tuple[str, ...]:
    """Find only commune codes whose polygons intersect the rendered map frame."""
    from qgis.core import QgsVectorLayer

    layer = QgsVectorLayer(str(raw_dir / "communes_limites.geojson"), "communes", "ogr")
    if not layer.isValid():
        raise ValueError("Could not open authoritative commune map-ready geography")
    transform = QgsCoordinateTransform(MAP_CRS, layer.crs(), QgsProject.instance())
    layer_extent = transform.transformBoundingBox(extent)
    request = QgsFeatureRequest().setFilterRect(layer_extent)
    codes = tuple(sorted({str(feature["code_insee"]) for feature in layer.getFeatures(request)}))
    if not codes:
        raise ValueError("No authoritative commune intersects the AEDAR map frame")
    return codes


def _rgb(hex_colour: str) -> QColor:
    return QColor(hex_colour)


def _equal_width_breaks(values, classes: int = 5) -> tuple[float, ...]:
    """Mode-local equal-width ranges; zero belongs to the first range."""
    values = np.asarray(values, dtype=np.float64)
    values = values[np.isfinite(values)]
    maximum = max(1.0, float(values.max()) if len(values) else 0.0)
    return tuple(round(float(value), 8)
                 for value in np.linspace(0.0, maximum, classes + 1))


def _inside_territory_mask(commune_codes, territory_codes: tuple[str, ...]) -> np.ndarray:
    """Classify address origins from their authoritative commune membership."""
    return np.isin(np.asarray(commune_codes, dtype=str), np.asarray(territory_codes, dtype=str))


@lru_cache(maxsize=1)
def _origin_transformer():
    from pyproj import Transformer
    return Transformer.from_crs("EPSG:4326", MAP_CRS.authid(), always_xy=True)


def _project_origins(longitudes, latitudes) -> tuple[np.ndarray, np.ndarray]:
    """Project origin coordinates in one vectorized PROJ call."""
    x, y = _origin_transformer().transform(
        np.asarray(longitudes, dtype=np.float64), np.asarray(latitudes, dtype=np.float64),
    )
    return np.asarray(x, dtype=np.float64), np.asarray(y, dtype=np.float64)


def _range_colours(break_count: int, palette: tuple[str, ...]) -> tuple[str, ...]:
    interval_count = break_count - 1
    return tuple(palette[round(index * (len(palette) - 1) / max(1, interval_count - 1))]
                 for index in range(interval_count))


def _continuous_palette(palette: tuple[str, ...], steps: int = 256) -> tuple[str, ...]:
    stops = [QColor(value) for value in palette]
    result = []
    for index in range(steps):
        position = index / max(1, steps - 1) * (len(stops) - 1)
        lower = min(int(position), len(stops) - 2)
        fraction = position - lower
        result.append(QColor(
            round(stops[lower].red() * (1 - fraction) + stops[lower + 1].red() * fraction),
            round(stops[lower].green() * (1 - fraction) + stops[lower + 1].green() * fraction),
            round(stops[lower].blue() * (1 - fraction) + stops[lower + 1].blue() * fraction),
        ).name())
    return tuple(result)


def _percentile_scale_cap(values, percentile: float = 0.95) -> float:
    """Return the nearest-rank percentile cap, keeping a usable scale for zeros."""
    numeric = np.asarray(values, dtype=np.float64)
    if not numeric.size:
        return 1.0
    cap = float(np.quantile(numeric, percentile, method="higher"))
    if cap == 0 and np.max(numeric) > 0:
        cap = float(np.min(numeric[numeric > 0]))
    return cap if cap > 0 else 1.0


def _cap_scale_values(values, cap: float) -> np.ndarray:
    """Clamp only rendered values; the source facts remain unchanged."""
    return np.minimum(np.asarray(values, dtype=np.float64), cap)


def _scale_endpoint_label(feature: Mapping, cap: float) -> str:
    """Name an overflow-capped legend endpoint with a plus sign."""
    return _format_number(cap) + ("+" if feature.get("scale_overflow") else "")


def _legend_tick_labels(feature: Mapping, breaks: tuple[float, ...]) -> tuple[tuple[int, str], ...]:
    """Label every equal-width boundary and mark a clipped loss endpoint."""
    labels = [_format_number(value) for value in breaks]
    if feature.get("comparison") == "car-only-typequ":
        labels[-1] = _scale_endpoint_label(feature, breaks[-1])
    return tuple(enumerate(labels))


def _feature_palette(feature: Mapping, palette: tuple[str, ...], steps: int) -> tuple[str, ...]:
    """Interpolate modes; exact loss uses the same car ramp as its comparator."""
    if feature.get("comparison") == "car-only-typequ" and feature.get("mode") != "car":
        palette = MODE_PALETTES["car"]
    return _continuous_palette(palette, steps)


def _point_ranges(breaks: tuple[float, ...], palette: tuple[str, ...], *, opacity: float,
                  size_mm: float = 0.48):
    """Build graduated point ranges from an already selected mode-local scale."""
    ranges = []
    colours = _range_colours(len(breaks), palette)
    for index, (lower, upper) in enumerate(zip(breaks, breaks[1:])):
        colour = colours[index]
        symbol = QgsMarkerSymbol.createSimple({"name": "circle", "size": str(size_mm),
            "color": colour, "outline_style": "no", "outline_width": "0"})
        symbol.setOpacity(opacity)
        ranges.append(QgsRendererRange(lower, upper, symbol,
                                       f"{_format_number(lower)}–{_format_number(upper)}"))
    return ranges


class AedarMapAdapter:
    """AEDAR-only renderer consuming shared context and ground preparation."""

    def __init__(self, raw_dir: str | Path, *, context_loader=None,
                 context_cache_root: str | Path | None = None):
        self.raw_dir = Path(raw_dir)
        self.context_loader = context_loader
        self.context_cache_root = (Path(context_cache_root)
                                   if context_cache_root is not None else None)
        self._shared_ground = None
        self._ground_cache = {}
        self._inspection_context_cache = {}
        self._point_layer_cache = {}
        self._frame_commune_codes = {}
        self._frame_data_cache = {}
        self._frame_projected_cache = {}
        self._active_territory = None
        self._font_temp = None
        self._font_id = -1
        self._font_family = None
        self._facts_hashes = {}
        self._hex_cache = {}
        self._stage_report = []
        self._commune_frame_index = None
        self._resolved_fact_paths = {}
        self._metric_fields_by_path = {}
        self._point_specs_by_territory = {}

    def begin_production_scope(self, scope, output_dir):
        self._font_temp = tempfile.TemporaryDirectory(prefix="lusk-aedar-font-")
        self._stage_report.clear()

    def end_production_scope(self, scope, output_dir, *, success):
        self._release_territory_cache()
        self._commune_frame_index = None
        self._resolved_fact_paths.clear()
        self._metric_fields_by_path.clear()
        self._point_specs_by_territory.clear()
        if self._font_id >= 0:
            QFontDatabase.removeApplicationFont(self._font_id)
            self._font_id = -1
        if self._font_temp is not None:
            self._font_temp.cleanup()
            self._font_temp = None

    def _release_territory_cache(self):
        """Keep frame rasters, coordinates and geometry bounded to one territory."""
        project = QgsProject.instance()
        for layers in self._point_layer_cache.values():
            for layer in layers:
                if project.mapLayer(layer.id()) is not None:
                    project.removeMapLayer(layer.id())
        self._point_layer_cache.clear()
        self._ground_cache.clear()
        self._inspection_context_cache.clear()
        self._frame_commune_codes.clear()
        self._frame_data_cache.clear()
        self._frame_projected_cache.clear()
        self._hex_cache.clear()
        self._active_territory = None

    def begin_territory(self, feature, profiles, output_dir):
        self._release_territory_cache()
        self._active_territory = str(feature["territory"]["code"])

    def end_territory(self, feature, output_dir, *, success):
        self._release_territory_cache()
        self._stage_report.append({"stage": "aedar-territory-release", "profile": "shared",
            "territory": f"{feature['territory']['kind']}/{feature['territory']['code']}",
            "decision": "released", "retained_territory_entries": sum(map(len, (
                self._ground_cache, self._point_layer_cache, self._frame_data_cache,
                self._frame_projected_cache, self._hex_cache,
                self._inspection_context_cache))), "success": success})

    def stage_report(self):
        """Expose grid preparation/reuse in the public run's manifest and QA."""
        return list(self._stage_report)

    def _frame_metrics(self, feature, prepared, value_field):
        """Read and project the frame's complete metric table once per territory."""
        path = self._fact_path(feature)
        territory = str(feature["territory"]["code"])
        if self._active_territory != territory:
            self._frame_data_cache.clear()
            self._active_territory = territory
        frame_codes = self._frame_commune_codes.get(territory)
        if frame_codes is None:
            frame_codes = self._commune_frame_index.codes_in_frame(prepared.extent)
            self._frame_commune_codes[territory] = frame_codes
        frame_key = (path, territory)
        table = self._frame_data_cache.get(frame_key)
        if table is None:
            value_fields = list(self._metric_fields_by_path[path])
            if value_field not in value_fields:
                value_fields.append(value_field)
            dataset = ds.dataset(path, format="parquet")
            table = dataset.scanner(
                columns=["code_insee", "cle_interop_adr", "lon", "lat", *value_fields],
                filter=ds.field("code_insee").isin(frame_codes), use_threads=True,
            ).to_table()
            self._frame_data_cache[frame_key] = table
        projected = self._frame_projected_cache.get(frame_key)
        if projected is None:
            projected = _project_origins(table["lon"].to_numpy(zero_copy_only=False),
                                         table["lat"].to_numpy(zero_copy_only=False))
            self._frame_projected_cache[frame_key] = projected
        x, y = projected
        return table, x, y

    def _fact_path(self, feature):
        return self._resolved_fact_paths[str(feature["facts_path"])]

    def _prepare_bound_contracts(self):
        """One binding scan, not an atlas-sized contract scan for every map."""
        started = perf_counter()
        self._resolved_fact_paths.clear()
        fields_by_path = {}
        specs_by_territory = {}
        for rows in self._binding.map_set.layers.values():
            for item in rows:
                raw_path = str(item["facts_path"])
                if raw_path not in self._resolved_fact_paths:
                    self._resolved_fact_paths[raw_path] = str(Path(raw_path).resolve())
                path = self._resolved_fact_paths[raw_path]
                field = item["value_field"]
                fields_by_path.setdefault(path, set()).add(field)
                key = (path, item["territory"]["kind"], item["territory"]["code"])
                specs = specs_by_territory.setdefault(key, {})
                cap = float(item["scale_cap"]) if "scale_cap" in item else None
                if field in specs and specs[field] != cap:
                    raise ValueError(f"Conflicting bound inspection caps for {field}")
                specs[field] = cap
        self._metric_fields_by_path = {path: tuple(sorted(fields)) for path, fields in fields_by_path.items()}
        self._point_specs_by_territory = {key: tuple(sorted(specs.items())) for key, specs in specs_by_territory.items()}
        self._stage_report.append({"stage": "aedar-bound-contracts", "profile": "shared",
            "decision": "built", "source_count": len(fields_by_path),
            "territory_count": len(specs_by_territory),
            "seconds": round(perf_counter() - started, 3)})

    def _point_metric_specs(self, feature):
        return self._point_specs_by_territory[(self._fact_path(feature),
            feature["territory"]["kind"], feature["territory"]["code"])]

    def _build_point_layers(self, project, feature, prepared, value_field):
        """One exact address geometry carries all bound inspection mode values."""
        table, x, y = self._frame_metrics(feature, prepared, value_field)
        in_frame = ((x >= prepared.extent.xMinimum()) & (x <= prepared.extent.xMaximum())
                    & (y >= prepared.extent.yMinimum()) & (y <= prepared.extent.yMaximum()))
        positions = np.flatnonzero(in_frame)
        commune_codes = table["code_insee"].to_pylist()
        territory_mask = _inside_territory_mask(commune_codes, feature["territory_codes"])
        metric_specs = self._point_metric_specs(feature)
        values = np.column_stack([
            _cap_scale_values(table[field].to_numpy(zero_copy_only=False), cap)
            if cap is not None else table[field].to_numpy(zero_copy_only=False)
            for field, cap in metric_specs])

        inside = QgsVectorLayer("Point?crs=EPSG:2154", "AEDAR · territoire", "memory")
        outside = QgsVectorLayer("Point?crs=EPSG:2154", "AEDAR · hors territoire", "memory")
        for layer in (inside, outside):
            layer.dataProvider().addAttributes([QgsField(field, QVariant.Double) for field, _ in metric_specs])
            layer.updateFields()

        def add_points(layer, point_positions):
            provider = layer.dataProvider()
            for start in range(0, len(point_positions), 25_000):
                batch = []
                for index in point_positions[start:start + 25_000]:
                    item = QgsFeature(layer.fields())
                    item.setGeometry(QgsGeometry.fromPointXY(QgsPointXY(float(x[index]), float(y[index]))))
                    item.setAttributes(values[index].tolist())
                    batch.append(item)
                if batch and not provider.addFeatures(batch)[0]:
                    raise RuntimeError("Could not add AEDAR address points to the map layer")
            layer.updateExtents()

        add_points(inside, positions[territory_mask[positions]])
        add_points(outside, positions[~territory_mask[positions]])
        return inside, outside

    def _inline_hex_image(self, feature, prepared, recipe, profile):
        """One shared cell geometry/membership and all metric medians per territory."""
        value_field = feature["value_field"]
        table, x, y = self._frame_metrics(feature, prepared, value_field)
        path = self._fact_path(feature)
        metric_fields = self._metric_fields_by_path[path]
        extent = prepared.extent
        bounds = (extent.xMinimum(), extent.yMinimum(), extent.xMaximum(), extent.yMaximum())
        cell_width = float(recipe.foundation.composition["inline"]["cell_width_px"])
        cache_key = (path,
                     feature["territory"]["kind"], feature["territory"]["code"],
                     tuple(sorted(feature["territory_codes"])), bounds,
                     profile.size, cell_width, metric_fields)
        cached = self._hex_cache.get(cache_key)
        started = perf_counter()
        decision = "reused"
        if cached is None:
            decision = "built"
            inside = _inside_territory_mask(table["code_insee"].to_pylist(), feature["territory_codes"])
            grid = prepare_hex_grid(x[inside], y[inside], bounds,
                                    frame_size_px=profile.size[0], cell_width_px=cell_width)
            polygons = tuple(QPolygonF([QPointF(float(vx), float(vy)) for vx, vy in vertices])
                             for vertices in grid.vertices)
            # Aggregate uncapped facts for EVERY bound mode now. Following modes
            # reuse these medians and polygons, not another spatial preparation.
            medians = {field: grid.medians(table[field].to_numpy(zero_copy_only=False)[inside])
                       for field in metric_fields}
            grid_id = sha256(grid.vertices.tobytes()).hexdigest()
            cached = (polygons, medians, grid_id, len(grid.address_positions))
            self._hex_cache[cache_key] = cached
        polygons, medians, grid_id, address_rows = cached
        self._stage_report.append({"stage": "aedar-hex-grid", "profile": "inline",
            "territory": f"{feature['territory']['kind']}/{feature['territory']['code']}",
            "mode": feature["mode"], "decision": decision, "grid_id": grid_id,
            "occupied_cells": len(polygons), "address_rows": address_rows,
            "metric_fields": list(metric_fields), "cell_width_px": cell_width,
            "statistic": "median", "seconds": round(perf_counter() - started, 3)})
        if decision == "built":
            print(f"[aedar] prepared shared hex grid {feature['territory']['code']}: "
                  f"{address_rows:,} addresses, {len(polygons):,} cells, "
                  f"{len(metric_fields)} metric fields", flush=True)
        values = medians[value_field]
        if "scale_cap" in feature:
            values = _cap_scale_values(values, float(feature["scale_cap"]))
        breaks = tuple(float(value) for value in feature["scale_breaks"])
        source_mode = feature.get("source_mode", feature["mode"])
        palette = _feature_palette(feature, MODE_PALETTES[source_mode], len(breaks) - 1)
        colours = _range_colours(len(breaks), palette)
        classes = np.clip(np.searchsorted(breaks[1:], values, side="left"), 0, len(colours) - 1)
        image = QImage(*profile.size, QImage.Format_RGBA8888)
        image.fill(Qt.transparent)
        painter = QPainter(image)
        painter.setRenderHint(QPainter.Antialiasing, True)
        painter.setPen(Qt.NoPen)
        painter.setOpacity(0.84)
        for polygon, colour in zip(polygons, classes):
            painter.setBrush(QColor(colours[int(colour)]))
            painter.drawPolygon(polygon)
        painter.end()
        return image

    def preflight(self, recipe: Recipe, binding: Binding) -> None:
        if binding.family != "aedar":
            raise ValueError("AEDAR adapter received another map family")
        self._binding = binding
        features = [feature for rows in binding.map_set.layers.values() for feature in rows]
        loss_maps = any(feature.get("comparison") == "car-only-typequ" for feature in features)
        expected_modes = LOSS_MODES if loss_maps else MODES
        expected = len(TERRITORIES) * len(expected_modes) * (1 if loss_maps else 2)
        if len(features) != expected:
            raise ValueError(f"Expected {expected} AEDAR map variants, found {len(features)}")
        if loss_maps and not all(feature.get("scale_type") == "equal-width" for feature in features):
            raise ValueError("AEDAR equipment-loss maps must use equal-width scales")
        for facts_path in sorted({feature["facts_path"] for feature in features}):
            parquet = pq.ParquetFile(facts_path)
            if not parquet.metadata.num_rows:
                raise ValueError(f"AEDAR map facts contain no address origins: {facts_path}")

    def render_identity(self) -> Mapping:
        root = Path(__file__).parent
        files = [root / "aedar_maps.py", root / "aedar_hex_grid.py", root / "aedar_commune_frames.py",
                 root / "aedar_buildings.py", root / "aedar_map_content.py",
                 root / "map_ground.py",
                 root / "inspection_plate.py",
                 root / "network-palette.json",
                 root / "assets" / "texture" / "qgis-hub-paper-texture-cc0.jpg",
                 root / "assets" / "fonts" / "mozilla-text-latin-wght-normal.woff2"]
        return {"family": "aedar-exploration", "code_sha256": _files_sha256(root, files),
                "runtime": {"qgis": Qgis.QGIS_VERSION,
                            "python": platform.python_version()}}

    def input_identity(self) -> Mapping:
        result = []
        for path in sorted(set(Path(feature["facts_path"]).resolve()
                               for features in self._binding.map_set.layers.values()
                               for feature in features)):
            key = str(path)
            if key not in self._facts_hashes:
                self._facts_hashes[key] = _file_sha256(path)
            result.append({"path": str(path), "size_bytes": path.stat().st_size,
                           "sha256": self._facts_hashes[key]})
        from map_ground import discover_ocsge_sources
        ground_sources = []
        for department, path, layer_name in discover_ocsge_sources(self.raw_dir):
            path = path.resolve()
            stat = path.stat()
            ground_sources.append({"department": department, "layer": layer_name,
                "path": str(path), "size_bytes": stat.st_size,
                "mtime_ns": stat.st_mtime_ns})
        return {"address_facts": result, "ocsge_ground_sources": ground_sources}

    def prepare_run(self, recipe, binding, profiles, output_dir, *, refresh=False):
        from map_ground import prepare_shared_ground

        self._binding = binding
        self._prepare_bound_contracts()
        # build_aedar_map_set already derived these authoritative frames from
        # the representative map set; don't reload and union the geography.
        context_features = [feature for rows in binding.map_set.layers.values()
                            for feature in rows]
        project = QgsProject.instance()
        project.clear()
        project.setCrs(MAP_CRS)
        self._load_font()
        index_started = perf_counter()
        self._commune_frame_index = CommuneFrameIndex(self.raw_dir / "communes_limites.geojson", project)
        self._stage_report.append({"stage": "aedar-commune-index", "profile": "shared",
            "decision": "built", "source_feature_count": self._commune_frame_index.feature_count,
            "seconds": round(perf_counter() - index_started, 3)})
        from inspection_frame import shared_ground_extent
        extent = shared_ground_extent(context_features, profiles)
        assets = Path(__file__).with_name("assets")
        self._shared_ground = prepare_shared_ground(
            project, self.raw_dir, extent, assets, include_ocsge=True,
             cache_root=Path(output_dir) / ".stage-cache" / "context-land",
            refresh=refresh, context_loader=self.context_loader, stage_report=self._stage_report,
            context_cache_root=(self.context_cache_root or
                                Path(output_dir) / ".stage-cache" / "official-context"))

    def render(self, recipe: Recipe, feature: Mapping, profile, output_dir: Path) -> Path:
        from map_ground import prepare_ground, render_layers

        if self._active_territory != str(feature["territory"]["code"]):
            self._release_territory_cache()
            self._active_territory = str(feature["territory"]["code"])
        key = (feature["territory"]["code"], profile.size)
        prepared = self._ground_cache.get(key)
        project = QgsProject.instance()
        if prepared is None:
            inspection = profile.name == "inspection"
            prepared = prepare_ground(project, dict(feature), profile.size[0], self._shared_ground,
                                      include_ocsge=inspection,
                                      ground_settings=recipe.foundation.ground,
                                      include_land_mask=inspection)
            self._ground_cache[key] = prepared

        value_field = feature.get("value_field", f"{feature['measure']}_{feature['horizon']}")
        source_mode = feature.get("source_mode", feature["mode"])
        if profile.name == "inline":
            from map_ground import apply_inline_mask, apply_inline_shadow
            hex_image = self._inline_hex_image(feature, prepared, recipe, profile)
            image = prepared.ground.copy().convertToFormat(QImage.Format_RGBA8888)
            painter = QPainter(image)
            painter.drawImage(0, 0, hex_image)
            painter.end()
            image = apply_inline_mask(image, prepared.territory_border,
                                      QgsGeometry(feature["analytical_geometry"]), prepared.extent)
            image = apply_inline_shadow(image)
            return self.save_output(image, feature, profile, output_dir)
        metric_specs = self._point_metric_specs(feature)
        extent = prepared.extent
        point_key = (self._fact_path(feature),
                     feature["territory"]["kind"], feature["territory"]["code"],
                     tuple(sorted(feature["territory_codes"])), metric_specs,
                     (extent.xMinimum(), extent.yMinimum(), extent.xMaximum(), extent.yMaximum()))
        point_layers = self._point_layer_cache.get(point_key)
        point_started = perf_counter()
        point_decision = "reused"
        if point_layers is None:
            point_decision = "built"
            point_layers = self._build_point_layers(project, feature, prepared, value_field)
            self._point_layer_cache[point_key] = point_layers
        inside, outside = point_layers
        self._stage_report.append({"stage": "aedar-address-points", "profile": "inspection",
            "territory": f"{feature['territory']['kind']}/{feature['territory']['code']}",
            "mode": feature["mode"], "decision": point_decision,
            "address_rows": inside.featureCount() + outside.featureCount(),
            "metric_fields": [field for field, _ in metric_specs],
            "seconds": round(perf_counter() - point_started, 3)})
        breaks = tuple(float(value) for value in feature["scale_breaks"])
        mode_key = source_mode
        palette = MODE_PALETTES[mode_key]
        palette = _feature_palette(feature, palette, len(breaks) - 1)
        inside.setRenderer(QgsGraduatedSymbolRenderer(value_field,
            _point_ranges(breaks, palette, opacity=0.84, size_mm=0.72)))
        outside_palette = ("#A8AEAB", "#909895", "#78817E", "#626D69", "#4C5854")
        if feature.get("comparison") == "car-only-typequ" and feature["mode"] != "car":
            outside_palette = _continuous_palette(outside_palette, len(breaks) - 1)
        else:
            outside_palette = _feature_palette(feature, outside_palette, len(breaks) - 1)
        outside.setRenderer(QgsGraduatedSymbolRenderer(value_field,
            _point_ranges(breaks, outside_palette, opacity=0.65, size_mm=0.58)))
        point_image = render_layers(project, prepared.extent, [outside, inside], QColor(0, 0, 0, 0),
                                    profile.size[0])
        title_name = feature["territory"]["name"]
        from inspection_plate import MAP_FURNITURE_GREEN, compose_inspection, prepare_inspection_context
        from network import _inspection_scale
        inspection_context = self._inspection_context_cache.get(key)
        context_started = perf_counter()
        context_decision = "reused"
        if inspection_context is None:
            context_decision = "built"
            inspection_context = prepare_inspection_context(
                prepared.ground, prepared.boundaries, prepared.outside_land, prepared.extent)
            self._inspection_context_cache[key] = inspection_context
        self._stage_report.append({"stage": "aedar-inspection-context", "profile": "inspection",
            "territory": f"{feature['territory']['kind']}/{feature['territory']['code']}",
            "mode": feature["mode"], "decision": context_decision,
            "seconds": round(perf_counter() - context_started, 3)})
        # One contiguous map-furniture clearance surrounds the complete legend,
        # using the same shared mask treatment as the title and wordmark.
        legend_clearance = (QRect(48, 2148, 782, 122),)

        mode_runs = (
            (feature["title_prefix"], QColor("#273A37"), 0.55, False),
            (feature["title_mode"], QColor(MODE_TITLE_COLOURS[mode_key]), 1.0, True),
        ) if feature.get("comparison") == "car-only-typequ" else (
            ("Diversité d’accès ", QColor("#273A37"), 0.55, False),
            (MODE_LABELS[mode_key], QColor(MODE_TITLE_COLOURS[mode_key]), 1.0, True),
        )
        footer = (("Lecture : ", feature["helper"]) if feature.get("helper")
                  else ("* ", "Sur 235 catégories d’équipements BPE"))
        image = compose_inspection(
            prepared.ground, point_image, prepared.boundaries, prepared.outside_land,
            prepared.land_mask, prepared.extent, title_name, mode_runs,
            {"mode": "aedar", "footer": footer},
            Path(__file__).with_name("assets"),
            self.raw_dir.parent.parent / "inst" / "extdata" / "theme-metadata",
            _inspection_scale(prepared.extent), citation_text="AEDAR 2026-v1 · © OpenStreetMap contributors",
            annotation_clearances=legend_clearance,
            prepared_context=inspection_context,
        )
        palette = MODE_PALETTES[mode_key]
        palette = _feature_palette(feature, palette, len(breaks) - 1)
        painter = QPainter(image)
        painter.setPen(MAP_FURNITURE_GREEN)
        painter.setFont(self._map_font(14, QFont.DemiBold))
        painter.drawText(84, 2200, feature.get(
            "legend_label", "Types d’équipements* accessibles en 15 minutes"))
        bar_left, bar_top, bar_width, bar_height = 84, 2218, 680, 20
        colours = _range_colours(len(breaks), palette)
        segment_width = bar_width / len(colours)
        for index, colour in enumerate(colours):
            painter.fillRect(round(bar_left + index * segment_width), bar_top,
                             round(segment_width + 1), bar_height, QColor(colour))
        # Tick labels sit immediately above the white source strip.
        painter.setPen(MAP_FURNITURE_GREEN)
        painter.setFont(self._map_font(12, QFont.DemiBold))
        metrics = painter.fontMetrics()
        if feature.get("comparison") == "car-only-typequ":
            tick_values = _legend_tick_labels(feature, breaks)
        elif feature.get("scale_type") != "continuous":
            tick_values = _legend_tick_labels(feature, breaks)
        else:
            tick_values = ()
        for index, value in tick_values:
            x = round(bar_left + index * segment_width)
            label = value if isinstance(value, str) else _format_number(value)
            label_width = metrics.horizontalAdvance(label)
            label_x = x - label_width // 2
            if index == 0:
                label_x = bar_left
            elif index == len(colours):
                label_x = bar_left + bar_width - label_width
            painter.drawText(label_x, 2266, label)
        painter.end()
        return self.save_output(image, feature, profile, output_dir)

    def save_output(self, image, feature, profile, output_dir):
        """Exploration keeps PNG evidence; production families choose their encoder."""
        output_dir.mkdir(parents=True, exist_ok=True)
        path = self.expected_output_path(feature, profile, output_dir)
        if not image.save(str(path), "PNG"):
            raise RuntimeError(f"Could not save AEDAR inspection render: {path}")
        return path

    def validate(self, path: Path, feature: Mapping, profile) -> None:
        image = QImage(str(path))
        if image.isNull() or (image.width(), image.height()) != profile.size:
            raise ValueError(f"Invalid AEDAR inspection artifact: {path}")

    @staticmethod
    def output_contract(profile=None) -> Mapping:
        return {"format": "png", "dimensions": list(profile.size) if profile else [2400, 2400],
                "alpha": "rgba-transparent-outside" if profile and profile.transparent_outside else "opaque-rgb",
                "profile": f"exploratory-{profile.name}" if profile else "exploratory-inspection"}

    @staticmethod
    def expected_output_path(feature, profile, output_dir) -> Path:
        return Path(output_dir) / f"{feature['territory']['code']}-{feature['mode']}-{profile.name}.png"

    def effective_input_identity(self, feature, profile):
        path = Path(feature["facts_path"])
        key = str(path.resolve())
        if key not in self._facts_hashes:
            self._facts_hashes[key] = _file_sha256(path)
        digest = self._facts_hashes[key]
        return {"facts_sha256": digest, "measure": feature["measure"],
                "value_field": feature.get("value_field"),
                "horizon": feature["horizon"], "scale_breaks": feature["scale_breaks"],
                "scale_cap": feature.get("scale_cap"),
                "scale_overflow": feature.get("scale_overflow"),
                "territory_codes": feature["territory_codes"]}

    def profile_identity(self, profile, feature=None, recipe=None):
        provenance = (self._shared_ground.context_provenance
                      if self._shared_ground is not None else {})
        if profile.name == "inline":
            return {"family": "aedar-inline-median-hex-v1", "profile": profile.name,
                    "code_sha256": self.render_identity()["code_sha256"],
                    "official_context": provenance, "qgis": Qgis.QGIS_VERSION,
                    "python": platform.python_version()}
        return {"family": "aedar-map-render-v26", "profile": profile.name,
                "official_context": provenance,
                "qgis": Qgis.QGIS_VERSION,
                "python": platform.python_version()}

    def _load_font(self):
        if self._font_family:
            return
        if self._font_temp is None:
            raise RuntimeError("AEDAR map fonts require an active production scope")
        path = Path(__file__).with_name("assets") / "fonts" / "mozilla-text-latin-wght-normal.woff2"
        font = TTFont(str(path))
        if "fvar" in font:
            axes = {axis.axisTag: axis.defaultValue for axis in font["fvar"].axes}
            if "wght" in axes:
                axes["wght"] = 600
                font = instantiateVariableFont(font, axes, inplace=False)
        font.flavor = None
        names = {1: "Mozilla Text", 2: "SemiBold",
                 3: "Mozilla Text SemiBold AEDAR", 4: "Mozilla Text SemiBold",
                 6: "MozillaText-SemiBold", 16: "Mozilla Text", 17: "SemiBold"}
        name_table = font["name"]
        name_table.names = [record for record in name_table.names
                            if record.nameID not in names]
        for platform_id, encoding_id, language_id in ((3, 1, 0x409), (1, 0, 0)):
            for name_id, value in names.items():
                name_table.setName(value, name_id, platform_id, encoding_id, language_id)
        font["OS/2"].usWeightClass = 600
        output = Path(self._font_temp.name) / "mozilla-text-semibold.ttf"
        font.save(str(output))
        self._font_id = QFontDatabase.addApplicationFont(str(output))
        families = (QFontDatabase.applicationFontFamilies(self._font_id)
                    if self._font_id >= 0 else [])
        if not families:
            raise RuntimeError(f"Could not load AEDAR inspection font from {path}")
        self._font_family = families[0]

    def _map_font(self, size: int, weight: int) -> QFont:
        if not self._font_family:
            raise RuntimeError("AEDAR map font is not loaded")
        font = QFont(self._font_family)
        font.setPointSize(size)
        font.setWeight(weight)
        return font


def _file_sha256(path: Path) -> str:
    digest = sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _format_number(value: float | int) -> str:
    """Use French grouping in inspection legends and scale bounds."""
    return f"{round(value):,}".replace(",", "\u202f")


def _files_sha256(root: Path, files) -> str:
    digest = sha256()
    for path in sorted(files):
        digest.update(path.relative_to(root).as_posix().encode())
        digest.update(path.read_bytes())
    return digest.hexdigest()
