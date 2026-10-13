"""Render only affected network inspection maps and prepare a guarded R2 plan."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

from qgis.core import QgsApplication
from qgis.PyQt.QtCore import Qt
from qgis.PyQt.QtGui import QColor, QImage, QPainter, QFont

ROOT = Path(__file__).resolve().parents[3]
PRODUCTION = Path(__file__).resolve().parent
sys.path.insert(0, str(PRODUCTION))

from inspection_frame import shared_ground_extent
from mainland_context import acquire_context
from network import NetworkAdapter, build_full_map_set, network_recipe
from network_inspection_refresh import (
    select_affected_network_inspection_binding,
    select_refresh_spot_check_outputs,
    validate_isolated_output_dir,
)
from r2_replacement import build_replacement_plan
from runner import run_production


def run_network_inspection_refresh(
    raw_dir: str | Path,
    output_dir: str | Path,
    previous_manifest: str | Path,
    *,
    network_cache_root: str | Path | None = None,
    prefix: str = "maps/v1/",
) -> dict:
    """Render the affected network inspection cohort (call inside initialized QGIS)."""
    raw_dir = Path(raw_dir).resolve()
    output_dir = validate_isolated_output_dir(
        output_dir,
        repo_root=ROOT,
        dedicated_output_dir=PRODUCTION / "output" / "network-inspection-refresh",
    )
    previous_manifest = Path(previous_manifest).resolve()
    network_cache_root = (Path(network_cache_root).resolve() if network_cache_root else
                          ROOT / "pipeline" / "maps" / ".cache" / "network-sources")
    if not previous_manifest.is_file():
        raise FileNotFoundError(f"previous full manifest does not exist: {previous_manifest}")
    if not network_cache_root.is_dir():
        raise FileNotFoundError(f"read-only prepared network cache does not exist: {network_cache_root}")

    full_binding = build_full_map_set(raw_dir)
    binding = select_affected_network_inspection_binding(full_binding)
    features = tuple(
        feature
        for layer in binding.map_set.layers.values()
        for feature in layer
    )
    affected_territories = {
        (str(feature["territory"]["kind"]), str(feature["territory"]["code"]))
        for feature in features
    }
    context_root = output_dir / ".stage-cache" / "official-context"
    extent = shared_ground_extent(features, ("inspection",))
    bbox = (extent.xMinimum(), extent.yMinimum(), extent.xMaximum(), extent.yMaximum())
    context_path, context_manifest = acquire_context(context_root, bbox)
    print(f"[network-refresh] affected territories={len(affected_territories)}; "
          f"outputs={len(features)}; exact official context={context_path}; "
          f"context features={context_manifest['returned']}", flush=True)

    adapter = NetworkAdapter(
        raw_dir,
        cache_root=network_cache_root,
        context_cache_root=context_root,
        read_only_source_cache=True,
    )
    result = run_production(
        network_recipe(), binding, "inspection-refresh", ("inspection",), adapter, output_dir
    )
    if result.qa["status"] != "passed" or len(result.outputs) != len(features):
        raise RuntimeError(f"network inspection refresh did not pass complete QA: {result.qa}")

    review_set = select_refresh_spot_check_outputs(result.outputs, binding)
    result.qa["human_spot_check"] = {
        "status": "pending", "review_set": review_set, "outcome": None,
    }
    result.qa["production_status"] = "awaiting-human-spot-check"
    result.manifest["inspection_refresh"] = {
        "affected_territories": [
            {"kind": kind, "code": code}
            for kind, code in sorted(affected_territories)
        ],
        "affected_territory_count": len(affected_territories),
        "rerendered_artifact_count": sum(item["decision"] == "rendered"
                                           for item in result.outputs),
        "reused_artifact_count": sum(item["decision"] == "reused"
                                       for item in result.outputs),
    }

    manifest_path = output_dir / "manifest.json"
    qa_path = output_dir / "qa.json"
    manifest_path.write_text(
        json.dumps(result.manifest, indent=2, sort_keys=True, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    qa_path.write_text(
        json.dumps(result.qa, indent=2, sort_keys=True, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    plan = build_replacement_plan(previous_manifest, manifest_path, qa_path, prefix=prefix)
    plan_path = output_dir / "replacement-plan.json"
    plan_path.write_text(
        json.dumps(plan, indent=2, sort_keys=True, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    review_path = output_dir / "spot-check-sheet.png"
    make_spot_check_sheet(review_set, review_path)
    return {
        "qa": result.qa["status"],
        "production_status": result.qa["production_status"],
        "territories": len(affected_territories),
        "candidate_artifacts": len(result.outputs),
        "rendered": result.manifest["inspection_refresh"]["rerendered_artifact_count"],
        "reused": result.manifest["inspection_refresh"]["reused_artifact_count"],
        "review_set": len(review_set),
        "manifest": str(manifest_path),
        "qa_report": str(qa_path),
        "replacement_plan": str(plan_path),
        "spot_check_sheet": str(review_path),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--raw-dir", type=Path, default=ROOT / "pipeline" / "data" / "raw")
    parser.add_argument("--output-dir", type=Path,
                        default=PRODUCTION / "output" / "network-inspection-refresh")
    parser.add_argument("--previous-manifest", type=Path,
                        default=PRODUCTION / "output" / "full-manifest.json")
    parser.add_argument("--network-cache-root", type=Path,
                        default=ROOT / "pipeline" / "maps" / ".cache" / "network-sources")
    parser.add_argument("--prefix", default="maps/v1/")
    args = parser.parse_args()

    app = QgsApplication([], False)
    app.initQgis()
    try:
        summary = run_network_inspection_refresh(
            args.raw_dir, args.output_dir, args.previous_manifest,
            network_cache_root=args.network_cache_root,
            prefix=args.prefix,
        )
        print(json.dumps(summary, ensure_ascii=False, indent=2), flush=True)
        return 0
    finally:
        app.exitQgis()


def make_spot_check_sheet(review_set, path: Path) -> None:
    columns, cell, label_height, gap = 3, 800, 64, 16
    rows = (len(review_set) + columns - 1) // columns
    sheet = QImage(columns * cell + (columns + 1) * gap,
                   rows * (cell + label_height) + (rows + 1) * gap,
                   QImage.Format_RGB32)
    sheet.fill(QColor("#eef1ef"))
    painter = QPainter(sheet)
    painter.setFont(QFont("Arial", 22, QFont.Bold))
    for index, item in enumerate(review_set):
        x = gap + (index % columns) * (cell + gap)
        y = gap + (index // columns) * (cell + label_height + gap)
        source = QImage(item["path"])
        if source.isNull():
            painter.end()
            raise RuntimeError(f"could not decode spot-check output: {item['path']}")
        painter.fillRect(x, y, cell, label_height, QColor("#ffffff"))
        painter.setPen(QColor("#25352f"))
        label = f"{item['territory']['name']} · {item['mode']}"
        painter.drawText(x + 12, y, cell - 24, label_height, Qt.AlignVCenter, label)
        painter.drawImage(x, y + label_height,
                          source.scaled(cell, cell, Qt.KeepAspectRatio, Qt.SmoothTransformation))
    painter.end()
    path.parent.mkdir(parents=True, exist_ok=True)
    if not sheet.save(str(path), "PNG"):
        raise RuntimeError(f"could not save spot-check sheet: {path}")


if __name__ == "__main__":
    raise SystemExit(main())
