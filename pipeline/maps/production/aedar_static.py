"""Durable selected AEDAR static-map adapter and native preparation caches."""
from __future__ import annotations

from hashlib import sha256
import json
import inspect
from pathlib import Path
from time import perf_counter

import numpy as np
import pyarrow.parquet as pq
import pyarrow as pa
import pyproj
from qgis.PyQt.QtCore import Qt, QPointF, QRect, QVariant
from qgis.PyQt.QtGui import QColor, QImage, QPainter, QPolygonF

from aedar_car import AedarCarAdapter
from aedar_hex_preparation import HexPreparation, digest, _atomic_numpy, _check
from aedar_hex_grid import prepare_hex_grid
import aedar_maps as maps
from aedar_legend import draw_legend
from qgis.core import (QgsProject, QgsGeometry, QgsVectorLayer, QgsField,
                       QgsFeature, QgsPointXY, QgsGraduatedSymbolRenderer)


PRODUCTION = Path(__file__).resolve().parent
FAMILY_CONFIG = json.loads((PRODUCTION / "aedar-static-family.json").read_text(encoding="utf-8"))
PALETTE = tuple(FAMILY_CONFIG["palette"])
OUTSIDE_PALETTE = ("#A8AEAB", "#909895", "#78817E", "#626D69", "#4C5854")
METRIC_FIELDS = tuple(spec["value_field"] for spec in FAMILY_CONFIG["modes"].values())


class AddressFacts:
    """One validated facts snapshot with indexed commune slices and cached projection."""
    def __init__(self, path, cache_dir):
        started = perf_counter()
        self.path = Path(path).resolve()
        columns = ["code_insee", "cle_interop_adr", "lon", "lat", *METRIC_FIELDS]
        self.table = pq.read_table(self.path, columns=columns)
        if not self.table.num_rows or any(self.table[field].null_count for field in columns):
            raise ValueError("Prepared AEDAR address facts are empty or incomplete")
        codes = np.asarray(self.table["code_insee"].to_pylist(), dtype=str)
        ids = np.asarray(self.table["cle_interop_adr"].to_pylist(), dtype=str)
        lon, lat = (self.table[field].to_numpy(zero_copy_only=False).astype(np.float64) for field in ("lon", "lat"))
        self.metrics = {field: self.table[field].to_numpy(zero_copy_only=False).astype(np.float64)
                        for field in METRIC_FIELDS}
        if not all(np.isfinite(value).all() for value in (lon, lat)):
            raise ValueError("Prepared AEDAR coordinates must be finite")
        if any(not np.isfinite(value).all() or np.any(value < 0) or np.any(value != np.floor(value))
               for value in self.metrics.values()):
            raise ValueError("Prepared AEDAR values must be finite nonnegative integer counts")
        car_field = FAMILY_CONFIG["modes"]["car"]["value_field"]
        if np.any(self.metrics[car_field] > FAMILY_CONFIG["car_bounds"][1]):
            raise ValueError("Prepared car facts exceed the selected absolute scale")
        self.car_mean = float(self.metrics[car_field].mean())
        projection_contract = {"spine": digest(codes, ids, lon, lat), "crs": maps.MAP_CRS.authid(),
            "pyproj": pyproj.__version__, "proj": pyproj.proj_version_str,
            "implementation": inspect.getsource(maps._project_origins) + inspect.getsource(maps._origin_transformer)}
        identity = sha256(json.dumps(projection_contract, sort_keys=True).encode()).hexdigest()
        cache_dir = Path(cache_dir)
        cache_dir.mkdir(parents=True, exist_ok=True)
        projection_path = cache_dir / f"projected-{identity}.npz"
        if projection_path.exists():
            _check(projection_path)
            with np.load(projection_path, allow_pickle=False) as cached:
                self.x, self.y = cached["x"], cached["y"]
            self.projection_decision = "reused"
        else:
            from aedar_maps import _project_origins
            self.x, self.y = _project_origins(lon, lat)
            _atomic_numpy(projection_path, lambda stream: np.savez(stream, x=self.x, y=self.y))
            self.projection_decision = "built"
        if self.x.shape != lon.shape or self.y.shape != lat.shape or not np.isfinite(self.x).all() or not np.isfinite(self.y).all():
            raise ValueError("Projected AEDAR coordinate cache is invalid")
        unique, starts, counts = np.unique(codes, return_index=True, return_counts=True)
        if len(unique) > 1 and np.any(codes[1:] < codes[:-1]):
            raise ValueError("Prepared AEDAR facts must be sorted by authoritative commune code")
        self.slices = {code: (int(start), int(start + count)) for code, start, count in zip(unique, starts, counts)}
        self.preparation = HexPreparation(cache_dir / "hex", identity, self.x, self.y)
        self.report = {"stage": "shared-facts-and-projection", "addresses": len(self.x),
                       "projection": self.projection_decision, "seconds": round(perf_counter() - started, 3)}

    def positions(self, codes):
        spans = [np.arange(*self.slices[code], dtype=np.int64) for code in sorted(set(codes)) if code in self.slices]
        return np.concatenate(spans) if spans else np.empty(0, dtype=np.int64)


class AedarStaticAdapter(AedarCarAdapter):
    """Selected full inventory renderer; intentionally has no approval/upload behavior."""
    def __init__(self, raw_dir, facts_path, *, cache_dir, source_cache_owner=None,
                 facts=None, all_binding=None, expected_territories=None, verify_preparation=False, **kwargs):
        super().__init__(raw_dir, source_cache_owner=source_cache_owner, **kwargs)
        self.facts_path = Path(facts_path).resolve()
        self.cache_dir = Path(cache_dir).resolve()
        self.facts = facts
        self.all_binding = all_binding
        self.expected_territories = expected_territories
        self.verify_preparation = verify_preparation
        self._member_positions = None
        self._hex_packs = {}
        self._static_report = []
        self._static_render_identity = None

    def preflight_scope(self, recipe, binding, scope, profiles):
        if scope != "inspection-refresh" or set(profiles) != {"inspection", "inline"}:
            raise ValueError("Selected AEDAR generation requires inspection-refresh and both profiles")
        if len(binding.map_set.layers) != 1:
            raise ValueError("Selected AEDAR binding must have one complete family layer")
        actual = {(feature["territory"]["kind"], feature["territory"]["code"])
                  for rows in binding.map_set.layers.values() for feature in rows}
        if self.expected_territories is None or actual != self.expected_territories:
            raise ValueError("AEDAR shard does not match its source-derived territory selection")

    def preflight(self, recipe, binding):
        features = [feature for rows in binding.map_set.layers.values() for feature in rows]
        if binding.family != FAMILY_CONFIG["family"] or not features:
            raise ValueError("Selected AEDAR binding lacks fact-derived class bounds")
        grouped = {}
        for feature in features:
            spec = FAMILY_CONFIG["modes"][feature["mode"]]
            grouped.setdefault((feature["territory"]["kind"], feature["territory"]["code"]), []).append(feature["mode"])
            scale = feature["_scale"]
            expected_breaks = tuple(scale["min"] + (scale["max"] - scale["min"]) * index / FAMILY_CONFIG["class_count"]
                                    for index in range(FAMILY_CONFIG["class_count"] + 1))
            if (feature["value_field"] != spec["value_field"] or feature["measure"] != spec["measure"]
                    or feature["horizon"] != FAMILY_CONFIG["horizon_minutes"]
                    or not scale["max"] > scale["min"] or tuple(feature["scale_breaks"]) != expected_breaks
                    or tuple(feature["palette"]) != PALETTE
                    or (feature["mode"] == "car" and [scale["min"], scale["max"]] != FAMILY_CONFIG["car_bounds"])):
                raise ValueError("Selected AEDAR feature does not match its typed facts and scale contract")
        if any(len(modes) != len(FAMILY_CONFIG["modes"]) or set(modes) != set(FAMILY_CONFIG["modes"])
               for modes in grouped.values()):
            raise ValueError("Every AEDAR territory must contain exactly the five registered readings")
        columns = ["code_insee", "cle_interop_adr", "lon", "lat", *METRIC_FIELDS]
        parquet = pq.ParquetFile(self.facts_path)
        if not parquet.metadata.num_rows or set(columns) - set(parquet.schema_arrow.names):
            raise ValueError("Selected AEDAR facts are missing the authoritative address or mode fields")
        if {Path(feature["facts_path"]).resolve() for feature in features} != {self.facts_path}:
            raise ValueError("AEDAR binding does not use its declared authoritative facts snapshot")
        self._facts_hashes.clear()
        self._production_sources = None
        self._binding = binding

    def prepare_run(self, recipe, binding, profiles, output_dir, *, refresh=False):
        if self.facts is None:
            self.facts = AddressFacts(self.facts_path, self.cache_dir)
        self._static_report.append(self.facts.report)
        result = super().prepare_run(recipe, self.all_binding or binding, profiles, output_dir, refresh=refresh)
        self._binding = binding
        return result

    def begin_territory(self, feature, profiles, output_dir):
        super().begin_territory(feature, profiles, output_dir)
        self._member_positions = self.facts.positions(feature["territory_codes"])

    def _release_territory_cache(self):
        super()._release_territory_cache()
        self._member_positions = None
        self._hex_packs.clear()

    def _frame_metrics(self, feature, prepared, value_field):
        extent = prepared.extent
        key = (extent.xMinimum(), extent.yMinimum(), extent.xMaximum(), extent.yMaximum())
        if key not in self._frame_data_cache:
            codes = self._commune_frame_index.codes_in_frame(extent)
            positions = self.facts.positions(codes)
            self._frame_data_cache[key] = (self.facts.table.take(pa.array(positions)), self.facts.x[positions], self.facts.y[positions])
        return self._frame_data_cache[key]

    def _inline_hex_image(self, feature, prepared, recipe, profile):
        bounds = (prepared.extent.xMinimum(), prepared.extent.yMinimum(),
                  prepared.extent.xMaximum(), prepared.extent.yMaximum())
        positions = self._member_positions
        key = (profile.name, bounds)
        pack = self._hex_packs.get(key)
        if pack is None:
            pack = self.facts.preparation.prepare(positions, bounds, profile.size,
                FAMILY_CONFIG["cell_width_px"], self.facts.metrics)
            pack.polygons = tuple(QPolygonF([QPointF(float(x), float(y)) for x, y in vertices])
                                  for vertices in pack.grid.vertices)
            self._hex_packs[key] = pack
            if self.verify_preparation:
                fresh = prepare_hex_grid(self.facts.x[positions], self.facts.y[positions], bounds,
                    frame_size_px=profile.size[0], cell_width_px=FAMILY_CONFIG["cell_width_px"])
                for cached, expected in ((pack.grid.vertices, fresh.vertices), (pack.grid.cell_keys, fresh.cell_keys),
                         (pack.grid.counts, fresh.counts), (pack.grid.membership, fresh.membership),
                         (pack.grid.address_positions, fresh.address_positions)):
                    np.testing.assert_array_equal(cached, expected)
                for metric in METRIC_FIELDS:
                    np.testing.assert_array_equal(pack.medians[metric], fresh.medians(self.facts.metrics[metric][positions]))
        field = feature["value_field"]
        values = pack.medians[field]
        classes = np.clip(np.searchsorted(feature["scale_breaks"][1:], values, side="left"), 0, len(PALETTE) - 1)
        image = QImage(*profile.size, QImage.Format_RGBA8888)
        image.fill(Qt.transparent)
        painter = QPainter(image)
        painter.setRenderHint(QPainter.Antialiasing, True)
        painter.setPen(Qt.NoPen)
        painter.setOpacity(0.84)
        brushes = tuple(QColor(color) for color in PALETTE)
        for polygon, category in zip(pack.polygons, classes):
            painter.setBrush(brushes[int(category)])
            painter.drawPolygon(polygon)
        painter.end()
        self._static_report.append({"stage": "aedar-static-hex", "territory": feature["territory"],
            "mode": feature["mode"], "grid": pack.grid_decision, "metrics": pack.metric_decisions,
            "occupied_cells": len(pack.grid.cell_keys), "address_count": len(positions)})
        return image

    def _build_point_layers(self, project, feature, prepared, value_field):
        """Keep the selected native exterior points, without constructing unused interior points."""
        table, x, y = self._frame_metrics(feature, prepared, value_field)
        in_frame = ((x >= prepared.extent.xMinimum()) & (x <= prepared.extent.xMaximum())
                    & (y >= prepared.extent.yMinimum()) & (y <= prepared.extent.yMaximum()))
        positions = np.flatnonzero(in_frame)
        territory_mask = maps._inside_territory_mask(table["code_insee"].to_pylist(), feature["territory_codes"])
        metric_specs = self._point_metric_specs(feature)
        values = np.column_stack([
            maps._cap_scale_values(table[field].to_numpy(zero_copy_only=False), cap)
            if cap is not None else table[field].to_numpy(zero_copy_only=False)
            for field, cap in metric_specs])
        inside = QgsVectorLayer("Point?crs=EPSG:2154", "AEDAR · territoire", "memory")
        outside = QgsVectorLayer("Point?crs=EPSG:2154", "AEDAR · hors territoire", "memory")
        for layer in (inside, outside):
            layer.dataProvider().addAttributes([QgsField(field, QVariant.Double) for field, _ in metric_specs])
            layer.updateFields()
        outside_positions = positions[~territory_mask[positions]]
        provider = outside.dataProvider()
        for start in range(0, len(outside_positions), 25_000):
            batch = []
            for index in outside_positions[start:start + 25_000]:
                item = QgsFeature(outside.fields())
                item.setGeometry(QgsGeometry.fromPointXY(QgsPointXY(float(x[index]), float(y[index]))))
                item.setAttributes(values[index].tolist())
                batch.append(item)
            if batch and not provider.addFeatures(batch)[0]:
                raise RuntimeError("Could not add AEDAR exterior address points")
        outside.updateExtents()
        return inside, outside

    def _outside_image(self, feature, prepared, recipe, profile):
        from map_ground import render_layers
        key = (feature["territory"]["kind"], feature["territory"]["code"], profile.size)
        if key not in self._point_layer_cache:
            started = perf_counter()
            layers = self._build_point_layers(QgsProject.instance(), feature, prepared, feature["value_field"])
            self._point_layer_cache[key] = layers
            self._static_report.append({"stage": "outside-point-preparation", "territory": feature["territory"],
                "inside_points": layers[0].featureCount(), "outside_points": layers[1].featureCount(),
                "seconds": round(perf_counter() - started, 3)})
        _, outside = self._point_layer_cache[key]
        outside.setRenderer(QgsGraduatedSymbolRenderer(feature["value_field"],
            maps._point_ranges(feature["scale_breaks"], OUTSIDE_PALETTE, opacity=0.65, size_mm=0.58)))
        return render_layers(QgsProject.instance(), prepared.extent, [outside], QColor(0, 0, 0, 0), profile.size[0])

    def render(self, recipe, feature, profile, output_dir):
        """Selected native composition, not an executed copy of a throwaway script."""
        from map_ground import prepare_ground, apply_inline_mask, apply_inline_shadow
        if self._active_territory != str(feature["territory"]["code"]):
            self._release_territory_cache()
            self._active_territory = str(feature["territory"]["code"])
            self._member_positions = self.facts.positions(feature["territory_codes"])
        key = (feature["territory"]["code"], profile.size)
        prepared = self._ground_cache.get(key)
        if prepared is None:
            inspection = profile.name == "inspection"
            prepared = prepare_ground(QgsProject.instance(), dict(feature), profile.size[0], self._shared_ground,
                include_ocsge=inspection, ground_settings=recipe.foundation.ground, include_land_mask=inspection)
            self._ground_cache[key] = prepared
        if profile.name == "inline":
            hex_image = self._inline_hex_image(feature, prepared, recipe, profile)
            image = prepared.ground.copy().convertToFormat(QImage.Format_RGBA8888)
            painter = QPainter(image)
            painter.drawImage(0, 0, hex_image)
            painter.end()
            image = apply_inline_mask(image, prepared.territory_border,
                                      QgsGeometry(feature["analytical_geometry"]), prepared.extent)
            return self.save_output(apply_inline_shadow(image), feature, profile, output_dir)
        point_image = self._outside_image(feature, prepared, recipe, profile)
        hex_image = self._inline_hex_image(feature, prepared, recipe, profile)
        overlay = QPainter(point_image)
        overlay.drawImage(0, 0, hex_image)
        overlay.end()
        from inspection_plate import compose_inspection, prepare_inspection_context
        from network import _inspection_scale
        inspection_context = self._inspection_context_cache.get(key)
        started = perf_counter()
        decision = "reused"
        if inspection_context is None:
            decision = "built"
            inspection_context = prepare_inspection_context(prepared.ground, prepared.boundaries,
                                                           prepared.outside_land, prepared.extent)
            self._inspection_context_cache[key] = inspection_context
        self._stage_report.append({"stage": "aedar-inspection-context", "profile": "inspection",
            "territory": f"{feature['territory']['kind']}/{feature['territory']['code']}",
            "mode": feature["mode"], "decision": decision, "seconds": round(perf_counter() - started, 3)})
        legend_clearance = (QRect(48, 2104, 782, 196 if feature["mode"] == "car" else 148),)
        mode_runs = ((feature["title_prefix"], QColor("#273A37"), 0.55, False),
                     (feature["title_mode"], QColor(maps.MODE_TITLE_COLOURS[feature["source_mode"]]), 1.0, True))
        footer = ("Lecture : ", feature["helper"]) if feature.get("helper") else tuple(FAMILY_CONFIG["car_footer"])
        image = compose_inspection(prepared.ground, point_image, prepared.boundaries, prepared.outside_land,
            prepared.land_mask, prepared.extent, feature["territory"]["name"], mode_runs,
            {"mode": "aedar", "footer": footer},
            PRODUCTION / "assets", self.raw_dir.parent.parent / "inst/extdata/theme-metadata",
            _inspection_scale(prepared.extent), citation_text="AEDAR 2026-v1 · © OpenStreetMap contributors",
            annotation_clearances=legend_clearance, prepared_context=inspection_context)
        draw_legend(self, image, feature)
        return self.save_output(image, feature, profile, output_dir)

    @staticmethod
    def expected_output_path(feature, profile, output_dir):
        return Path(output_dir) / FAMILY_CONFIG["filename_template"].format(
            code=feature["territory"]["code"], mode=feature["mode"], profile=profile.name)

    def render_identity(self):
        if self._static_render_identity is not None:
            return self._static_render_identity
        identity = super().render_identity()
        tracked = [PRODUCTION / name for name in ("aedar_static.py", "aedar_hex_preparation.py",
            "aedar_legend.py", "aedar_map_plan.py", "aedar-static-family.json", "inspection_frame.py")]
        hasher = sha256()
        for path in tracked:
            hasher.update(path.name.encode())
            hasher.update(path.read_bytes())
        self._static_render_identity = {**identity, "family": "aedar-selected-static-v1",
                                      "selected_renderer_sha256": hasher.hexdigest()}
        return self._static_render_identity

    def profile_identity(self, profile, feature=None, recipe=None):
        return {**super().profile_identity(profile, feature, recipe), "outside": "points",
                "selected_scale": feature["_scale"] if feature else None,
                "regional_mean": feature["regional_mean"] if feature else None}

    def drain_stage_report(self):
        report = [*super().drain_stage_report(), *self._static_report]
        self._static_report.clear()
        return report


def decoded_webp_pixels(path):
    """Final decoded-image seam used by parity checks and artifact QA."""
    from webp_encoding import validate_webp
    from runner import PROFILES
    name = "inline" if "inline" in Path(path).stem else "inspection"
    return np.asarray(validate_webp(path, PROFILES[name]).convert("RGBA"))
