"""Render affected AEDAR car inspection maps and prepare a guarded R2 plan."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

from qgis.core import QgsApplication

ROOT = Path(__file__).resolve().parents[3]
PRODUCTION = Path(__file__).resolve().parent
sys.path.insert(0, str(PRODUCTION))

from aedar_map_plan import build_aedar_static_map_set, selected_aedar_recipe
from aedar_static import AddressFacts, AedarStaticAdapter, FAMILY_CONFIG
from aedar_car_inspection_refresh import (acquire_aedar_car_inspection_context,
                                          select_affected_aedar_car_inspection_binding)
from runner import Binding, MapSet
from aedar_maps import ADDRESS_METRICS_FILENAME
from network_inspection_refresh import validate_isolated_output_dir
from r2_replacement import build_replacement_plan
from runner import run_production
from webp_encoding import require_webp_encoder


def run_aedar_car_inspection_refresh(raw_dir, facts_path, output_dir, previous_manifest, *,
                                     source_cache_owner=None):
    raw_dir, facts_path = Path(raw_dir).resolve(), Path(facts_path).resolve()
    output_dir = validate_isolated_output_dir(
        output_dir, repo_root=ROOT,
        dedicated_output_dir=PRODUCTION / "output" / "aedar-car-inspection-refresh")
    previous_manifest = Path(previous_manifest).resolve()
    if not previous_manifest.is_file():
        raise FileNotFoundError(f"previous selected AEDAR manifest does not exist: {previous_manifest}")
    require_webp_encoder()

    cache_root = output_dir / ".shared-cache"
    cache_root.mkdir(parents=True, exist_ok=True)
    facts = AddressFacts(facts_path, cache_root)
    complete_binding, _inventory = build_aedar_static_map_set(
        raw_dir, facts_path, facts=facts)
    all_car = Binding("aedar", MapSet({"aedar-static-selected": tuple(
        feature for rows in complete_binding.map_set.layers.values() for feature in rows
        if feature["mode"] == "car")}))
    binding = select_affected_aedar_car_inspection_binding(all_car)
    features = tuple(row for rows in binding.map_set.layers.values() for row in rows)
    territories = {(str(row["territory"]["kind"]), str(row["territory"]["code"]))
                   for row in features}
    context_root = output_dir / ".stage-cache" / "official-context"
    context_path, context_manifest = acquire_aedar_car_inspection_context(features, context_root)
    print(f"[aedar-car-refresh] affected territories={len(territories)}; outputs={len(features)}; "
          f"exact official context={context_path}; context features={context_manifest['returned']}",
          flush=True)
    recipe = selected_aedar_recipe()
    adapter = AedarStaticAdapter(raw_dir, facts_path, cache_dir=cache_root,
        facts=facts, all_binding=binding, expected_territories=territories,
        context_cache_root=context_root, source_cache_owner=source_cache_owner)
    result = run_production(recipe, binding, "inspection-refresh", ("inspection",), adapter,
                            output_dir)
    if result.qa["status"] != "passed" or len(result.outputs) != len(features):
        raise RuntimeError(f"AEDAR car inspection refresh did not pass complete QA: {result.qa}")

    result.qa["human_spot_check"] = {"status": "pending", "outcome": None,
                                     "review_set": _review_set(result.outputs, features)}
    result.qa["production_status"] = "awaiting-human-spot-check"
    result.manifest["inspection_refresh"] = {
        "affected_territories": [{"kind": kind, "code": code} for kind, code in sorted(territories)],
        "affected_territory_count": len(territories),
        "rerendered_artifact_count": sum(row["decision"] == "rendered" for row in result.outputs),
        "reused_artifact_count": sum(row["decision"] == "reused" for row in result.outputs),
    }
    manifest_path, qa_path = output_dir / "manifest.json", output_dir / "qa.json"
    manifest_path.write_text(json.dumps(result.manifest, indent=2, sort_keys=True,
                                        ensure_ascii=False) + "\n", encoding="utf-8")
    qa_path.write_text(json.dumps(result.qa, indent=2, sort_keys=True,
                                  ensure_ascii=False) + "\n", encoding="utf-8")
    _make_spot_check_sheet(result.qa["human_spot_check"]["review_set"],
                           output_dir / "spot-check-sheet.png")
    family_config = json.loads((PRODUCTION / "aedar-static-family.json").read_text(encoding="utf-8"))
    plan = build_replacement_plan(previous_manifest, manifest_path, qa_path,
                                  prefix=family_config["prefix"], family="aedar", modes=("car",))
    plan_path = output_dir / "replacement-plan.json"
    plan_path.write_text(json.dumps(plan, indent=2, sort_keys=True,
                                    ensure_ascii=False) + "\n", encoding="utf-8")
    return {"qa": result.qa["status"], "production_status": result.qa["production_status"],
            "territories": len(territories), "candidate_artifacts": len(result.outputs),
            "rendered": result.manifest["inspection_refresh"]["rerendered_artifact_count"],
            "reused": result.manifest["inspection_refresh"]["reused_artifact_count"],
            "manifest": str(manifest_path), "qa_report": str(qa_path),
            "replacement_plan": str(plan_path)}


def _review_set(outputs, features):
    expansion = {}
    for feature in features:
        territory = feature["territory"]
        kind, code = str(territory["kind"]), str(territory["code"])
        base = feature["extent"]
        inspection = feature["inspection_extent"]
        factor = ((inspection.xMaximum() - inspection.xMinimum()) /
                  (base.xMaximum() - base.xMinimum()) if hasattr(base, "xMaximum") else
                  (inspection[2] - inspection[0]) / (base[2] - base[0]))
        key = (kind, code)
        expansion[key] = (factor, territory)
    selected = {}
    for kind in sorted({key[0] for key in expansion}):
        key = min((key for key in expansion if key[0] == kind),
                  key=lambda item: (-expansion[item][0], item[1]))
        selected[key] = expansion[key][1]
    output_index = {(str(row["territory"]["kind"]), str(row["territory"]["code"])): row
                    for row in outputs}
    return [{field: output_index[key][field] for field in
             ("territory", "mode", "profile", "path", "effective_identity", "output_sha256")}
            for key in sorted(selected) if key in output_index]


def _make_spot_check_sheet(review_set, path):
    from qgis.PyQt.QtCore import Qt
    from qgis.PyQt.QtGui import QColor, QFont, QImage, QPainter
    columns, cell, label_height, gap = 3, 800, 64, 16
    rows = (len(review_set) + columns - 1) // columns
    sheet = QImage(columns * cell + (columns + 1) * gap,
                   rows * (cell + label_height) + (rows + 1) * gap, QImage.Format_RGB32)
    sheet.fill(QColor("#eef1ef"))
    painter = QPainter(sheet)
    painter.setFont(QFont("Arial", 22, QFont.Bold))
    for index, item in enumerate(review_set):
        x, y = gap + (index % columns) * (cell + gap), gap + (index // columns) * (cell + label_height + gap)
        image = QImage(item["path"])
        if image.isNull():
            painter.end()
            raise RuntimeError(f"could not decode AEDAR car spot-check output: {item['path']}")
        painter.fillRect(x, y, cell, label_height, QColor("#ffffff"))
        painter.setPen(QColor("#25352f"))
        painter.drawText(x + 12, y, cell - 24, label_height, Qt.AlignVCenter,
                         item["territory"]["name"])
        painter.drawImage(x, y + label_height,
                          image.scaled(cell, cell, Qt.KeepAspectRatio, Qt.SmoothTransformation))
    painter.end()
    if not sheet.save(str(path), "PNG"):
        raise RuntimeError(f"could not save AEDAR car spot-check sheet: {path}")


def build_parser():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--raw-dir", type=Path, default=ROOT / "pipeline/data/raw")
    parser.add_argument("--facts-path", type=Path,
                        default=ROOT / "pipeline/data/processed/aedar/maps/bretagne-frame" /
                        ADDRESS_METRICS_FILENAME)
    parser.add_argument("--output-dir", type=Path,
                        default=PRODUCTION / "output" / "aedar-car-inspection-refresh")
    parser.add_argument("--previous-manifest", type=Path,
                        default=PRODUCTION / "output/aedar-static-publish/full-manifest.json")
    parser.add_argument("--source-cache-owner", type=Path)
    return parser


def main(argv=None):
    args = build_parser().parse_args(argv)
    qgis_prefix = Path(sys.executable).resolve().parents[1] / "qgis-ltr"
    if qgis_prefix.is_dir():
        QgsApplication.setPrefixPath(str(qgis_prefix), True)
    app = QgsApplication([], False)
    app.initQgis()
    try:
        summary = run_aedar_car_inspection_refresh(
            args.raw_dir, args.facts_path, args.output_dir, args.previous_manifest,
            source_cache_owner=args.source_cache_owner)
        print(json.dumps(summary, ensure_ascii=False, indent=2), flush=True)
        return 0
    finally:
        app.exitQgis()


if __name__ == "__main__":
    raise SystemExit(main())
