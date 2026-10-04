"""Acquire the dated official mainland context before running map rendering."""
from __future__ import annotations

import argparse
from pathlib import Path
import sys

from qgis.core import QgsApplication, QgsProject, QgsRectangle

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(Path(__file__).parent))
from mainland_context import acquire_context  # noqa: E402
from network import build_full_map_set, build_representative_map_set  # noqa: E402


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--raw-dir", type=Path, default=ROOT / "pipeline/data/raw")
    parser.add_argument("--output-dir", type=Path, default=ROOT / "pipeline/maps/production/output")
    parser.add_argument("--refresh", action="store_true", help="acquire and validate a new generation")
    parser.add_argument("--scope", choices=("representative", "full"), default="representative",
                        help="derive frame coverage from the requested run scope")
    args = parser.parse_args()

    app = QgsApplication([], False)
    app.initQgis()
    try:
        builder = build_full_map_set if args.scope == "full" else build_representative_map_set
        binding = builder(args.raw_dir, QgsProject.instance())
        frames = [feature["extent"] for values in binding.map_set.layers.values() for feature in values]
        if not frames:
            raise RuntimeError("Cannot acquire mainland context without map-ready frames")
        extent = QgsRectangle(frames[0])
        for frame in frames[1:]:
            extent.combineExtentWith(QgsRectangle(frame))
        bbox = (extent.xMinimum(), extent.yMinimum(), extent.xMaximum(), extent.yMaximum())
        cache = args.output_dir / ".stage-cache" / "official-context"
        path, manifest = acquire_context(cache, bbox, refresh=args.refresh)
        print({"path": str(path), "edition": manifest["edition"], "bbox": manifest["bbox"],
               "matched": manifest["matched"], "returned": manifest["returned"],
               "unique_ids": manifest["unique_ids"], "sha256": manifest["sha256"]})
    finally:
        app.exitQgis()


if __name__ == "__main__":
    main()
