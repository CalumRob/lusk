"""Render AEDAR car-diversity and exact equipment-loss maps."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

from qgis.core import QgsApplication

ROOT = Path(__file__).resolve().parents[3]
PRODUCTION = Path(__file__).resolve().parent
sys.path.insert(0, str(PRODUCTION))

from aedar_maps import (AedarMapAdapter, aedar_loss_recipe, build_aedar_loss_map_set,
                        prepare_aedar_frame_facts)
from run_aedar_maps import DEFAULT_SPINE, make_contact_sheet
from runner import run_production


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--raw-dir", type=Path, default=ROOT / "pipeline" / "data" / "raw")
    parser.add_argument("--spine", type=Path, default=DEFAULT_SPINE)
    parser.add_argument("--facts-dir", type=Path,
                        default=ROOT / "pipeline" / "data" / "processed" / "aedar" / "maps" / "bretagne-frame")
    parser.add_argument("--output-dir", type=Path,
                        default=PRODUCTION / "output" / "aedar-bretagne-equipment-loss")
    parser.add_argument("--context-cache-root", type=Path,
                        default=PRODUCTION / "output" / "aedar-rennes-inspection" / ".stage-cache" / "official-context")
    parser.add_argument("--refresh", action="store_true")
    args = parser.parse_args()
    if not args.spine.is_file():
        parser.error(f"address-origin spine does not exist: {args.spine}")

    print("[aedar-loss] preparing complete address facts and exact car-only TYPEQU counts", flush=True)
    prepare_aedar_frame_facts(args.raw_dir, args.spine, args.facts_dir)
    binding = build_aedar_loss_map_set(args.raw_dir, args.facts_dir, args.spine)
    print("[aedar-loss] rendering car diversity plus transit, bike LTS2/LTS4 and walk losses; "
          "inspection and inline", flush=True)
    result = run_production(
        aedar_loss_recipe(), binding, "representative", ("inspection", "inline"),
        AedarMapAdapter(args.raw_dir, context_cache_root=args.context_cache_root),
        args.output_dir, refresh=args.refresh,
    )
    for name, evidence in (("manifest.json", result.manifest), ("qa.json", result.qa)):
        (args.output_dir / name).write_text(
            json.dumps(evidence, indent=2, sort_keys=True, ensure_ascii=False) + "\n",
            encoding="utf-8")
    make_contact_sheet([item for item in result.outputs if item["profile"] == "inspection"],
                       args.output_dir / "contact-sheet.png")
    print(f"[aedar-loss] rendered/reused {len(result.outputs)} exploratory maps at {args.output_dir}",
          flush=True)
    return 0


def run_qgis() -> int:
    app = QgsApplication([], False)
    app.initQgis()
    try:
        return main()
    finally:
        app.exitQgis()


if __name__ == "__main__":
    raise SystemExit(run_qgis())
