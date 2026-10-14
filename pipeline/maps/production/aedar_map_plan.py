"""Prepare source-derived territory plans and bindings for selected AEDAR maps."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

from aedar_map_content import loss_map_content
from runner import Binding, Foundation, MapSet, Recipe


PRODUCTION = Path(__file__).resolve().parent


def family_config():
    return json.loads((PRODUCTION / "aedar-static-family.json").read_text(encoding="utf-8"))


def build_aedar_static_map_set(raw_dir, facts_path, *, facts, family_config=None,
                               aedar_family_config=None, territory_registry_path=None):
    """Build all source-derived territory bases, omitting only empty fact memberships."""
    from network import build_full_map_set
    from cartographic_policy import family_policy

    config = aedar_family_config or globals()["family_config"]()
    policy = family_policy(config.get("cartographic_policy", {}))
    source = build_full_map_set(raw_dir, family_config=family_config,
        territory_registry_path=territory_registry_path, resolved_cartographic_policy=policy)
    bases = [feature for rows in source.map_set.layers.values() for feature in rows if feature["mode"] == "car"]
    supported, skipped = [], []
    for base in bases:
        positions = facts.positions(base["territory_codes"])
        if len(positions):
            supported.append(base)
        else:
            skipped.append(dict(base["territory"]))
    if not supported:
        raise ValueError("Authoritative territory inventory has no prepared AEDAR address facts")
    binding = binding_for(supported, facts, facts_path, config)
    return binding, {"territories": supported, "territory_count": len(supported),
                     "skipped_no_address_facts": skipped,
                     "expected_webps": len(supported) * len(config["modes"]) * len(config["profiles"])}


def binding_for(bases, facts, facts_path, config=None):
    """Derive exact mode class boundaries from indexed address facts."""
    config = config or globals()["family_config"]()
    modes = config["modes"]
    car_low, car_high = map(float, config["car_bounds"])
    classes = int(config["class_count"])
    loss_modes = [mode for mode in modes if mode != "car"]
    features = []
    for base in bases:
        positions = facts.positions(base["territory_codes"])
        if not len(positions):
            raise ValueError(f"Territory has no prepared address facts: {base['territory']}")
        pooled = [facts.metrics[modes[mode]["value_field"]][positions] for mode in loss_modes]
        loss_min = min(float(values.min()) for values in pooled)
        loss_max = max(float(values.max()) for values in pooled)
        if not loss_max > loss_min:
            raise ValueError(f"Territory has no varying pooled loss range: {base['territory']}")
        for mode, spec in modes.items():
            low, high = (car_low, car_high) if mode == "car" else (loss_min, loss_max)
            boundaries = tuple(low + (high - low) * index / classes for index in range(classes + 1))
            content = loss_map_content(mode)
            features.append({**base, "mode": mode, "source_mode": mode,
                "facts_path": str(Path(facts_path).resolve()), "value_field": spec["value_field"],
                "measure": spec["measure"], "horizon": int(config["horizon_minutes"]),
                "comparison": "car-only-typequ", "scale_type": "equal-width", "scale_cap": high,
                "scale_scope": "absolute" if mode == "car" else "territory-local-pooled-loss",
                "scale_overflow": False, "scale_breaks": boundaries,
                "_scale": {"min": low, "max": high, "breaks": boundaries},
                "palette": tuple(config["palette"]),
                "regional_mean": facts.car_mean if mode == "car" else None,
                **content})
    return Binding("aedar", MapSet({"aedar-static-selected": tuple(features)}))


def encode_plan(bases, facts, input_signatures, config=None, workers=4):
    """Encode QGIS geometry once; worker plans carry verified WKB digests."""
    config = config or globals()["family_config"]()
    geometries, rows = {}, []
    for feature in bases:
        row = {"territory": dict(feature["territory"]),
               "territory_codes": list(feature["territory_codes"]),
               "addresses": int(len(facts.positions(feature["territory_codes"]))) }
        for field in ("geometry", "analytical_geometry", "region_geometry"):
            data = bytes(feature[field].asWkb())
            key = hashlib.sha256(data).hexdigest()
            geometries[key] = data.hex()
            row[field] = key
        for field in ("extent", "inspection_extent"):
            extent = feature[field]
            row[field] = [extent.xMinimum(), extent.yMinimum(), extent.xMaximum(), extent.yMaximum()]
        rows.append(row)
    from cartographic_policy import family_policy
    result = {"version": 1, "input_signatures": input_signatures, "territories": rows,
        "territory_count": len(rows), "geometries": geometries,
        "cartographic_policy": family_policy(config.get("cartographic_policy", {})).contract(),
        "expected_webps": len(rows) * len(config["modes"]) * len(config["profiles"]),
        "q80": None, "shards": partition({"territories": rows}, workers)}
    return result


def decode_plan(plan):
    from qgis.core import QgsGeometry, QgsRectangle

    geometries = {}
    for key, value in plan["geometries"].items():
        data = bytes.fromhex(value)
        if hashlib.sha256(data).hexdigest() != key:
            raise ValueError("AEDAR plan geometry integrity failure")
        geometry = QgsGeometry()
        geometry.fromWkb(data)
        if geometry.isNull() or geometry.isEmpty():
            raise ValueError("AEDAR plan contains invalid geometry WKB")
        geometries[key] = geometry
    decoded = []
    policy = plan.get("cartographic_policy")
    for row in plan["territories"]:
        feature = {"territory": dict(row["territory"]),
                   "territory_codes": tuple(row["territory_codes"]),
                   "cartographic_policy": policy} if policy is not None else {
                       "territory": dict(row["territory"]),
                       "territory_codes": tuple(row["territory_codes"])}
        feature.update({field: QgsGeometry(geometries[row[field]])
                        for field in ("geometry", "analytical_geometry", "region_geometry")})
        feature.update({field: QgsRectangle(*row[field]) for field in ("extent", "inspection_extent")})
        decoded.append(feature)
    return decoded


def partition(plan, workers):
    """AEDAR's family cost estimate supplied to common whole-territory scheduling."""
    from batch_execution import partition_territories
    return partition_territories(plan["territories"], workers,
                                 lambda row: 1 + row["addresses"] ** 0.5 / 300)


def selected_aedar_recipe(config=None):
    from cartographic_policy import family_policy
    config = config or family_config()
    policy = family_policy(config.get("cartographic_policy", {}))
    return Recipe(name="aedar-selected-static", version=1, family=config["family"],
        foundation=Foundation(version="aedar-selected-foundation-v1",
            framing=policy.framing(),
            geography={"territory": config["geography_contract"]},
            ground=policy.ground(inline=False),
            composition=config["cartography"], cartographic_policy=policy),
        required_fields=("geometry", "territory", "mode", "analytical_geometry", "extent",
            "facts_path", "value_field", "measure", "horizon", "scale_breaks",
            "comparison", "title_prefix", "title_mode", "legend_label"))
