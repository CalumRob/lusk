"""Render car-only AEDAR WebPs; full scope requires current human approval.

Offline production only. This command never prepares loss facts, records a
human approval, or publishes/deploys artifacts. Prepared car facts must exist.
"""
import argparse
import json
from pathlib import Path
import sys

from qgis.core import QgsApplication, QgsProject

ROOT = Path(__file__).resolve().parents[3]
PRODUCTION = Path(__file__).resolve().parent
sys.path.insert(0, str(PRODUCTION))
from aedar_car import AedarCarAdapter, aedar_car_recipe, build_aedar_car_map_set
from aedar_maps import ADDRESS_METRICS_FILENAME
from approval import read_approval, validate_approval_claim
from runner import run_production
from webp_encoding import require_webp_encoder


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scope", choices=("representative", "full"), default="representative")
    parser.add_argument("--approval", type=Path)
    parser.add_argument("--raw-dir", type=Path, default=ROOT / "pipeline/data/raw")
    parser.add_argument("--facts-path", type=Path,
                        default=ROOT / "pipeline/data/processed/aedar/maps/bretagne-frame" / ADDRESS_METRICS_FILENAME)
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument("--context-cache-root", type=Path,
                        default=PRODUCTION / "output/aedar-rennes-inspection/.stage-cache/official-context")
    parser.add_argument("--source-cache-owner", type=Path,
                        help="Existing owning output root for shared source derivatives; not map outputs")
    parser.add_argument("--refresh", action="store_true")
    args = parser.parse_args(argv)
    if args.scope == "full" and not args.approval:
        parser.error("--scope full requires --approval from review of the current six car WebPs")
    recipe = aedar_car_recipe()
    adapter = AedarCarAdapter(args.raw_dir, context_cache_root=args.context_cache_root,
                              source_cache_owner=args.source_cache_owner)
    require_webp_encoder()
    approval = read_approval(args.approval) if args.approval else None
    if args.scope == "full":
        validate_approval_claim(approval, recipe, adapter.render_identity(),
                                representative_pairs=adapter.approval_pairs())
    binding = build_aedar_car_map_set(args.raw_dir, args.facts_path, scope=args.scope)
    output = args.output_dir or PRODUCTION / "output" / f"aedar-car-{args.scope}"
    result = run_production(recipe, binding, args.scope, ("inspection", "inline"), adapter,
                            output, refresh=args.refresh, approval=approval)
    prefix = "full-" if args.scope == "full" else ""
    for name, evidence in ((f"{prefix}manifest.json", result.manifest), (f"{prefix}qa.json", result.qa)):
        (output / name).write_text(json.dumps(evidence, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"[aedar-car] {len(result.outputs)}/{result.qa['expected_artifact_count']} WebPs; "
          f"QA={result.qa['status']}; production={result.qa['production_status']}; {output}", flush=True)
    return 0 if result.qa["status"] == "passed" else 1


def run_qgis():
    app = QgsApplication([], False)
    app.initQgis()
    try:
        return main()
    finally:
        QgsProject.instance().clear()
        app.exitQgis()


if __name__ == "__main__":
    raise SystemExit(run_qgis())
