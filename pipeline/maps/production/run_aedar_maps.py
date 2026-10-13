"""Render the Rennes, Redon and Bretagne AEDAR exploration maps; never publishes them."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

from qgis.core import QgsApplication

ROOT = Path(__file__).resolve().parents[3]
PRODUCTION = Path(__file__).resolve().parent
sys.path.insert(0, str(PRODUCTION))

from aedar_maps import (AedarMapAdapter, aedar_recipe, build_aedar_map_set,
                        prepare_aedar_frame_facts)
from runner import run_production
from qgis.PyQt.QtCore import Qt
from qgis.PyQt.QtGui import QColor, QImage, QPainter


DEFAULT_SPINE = Path(
    r"E:\batiments-equipements\data\matrice\full-bretagne-address-2026-09-14-current35-tobler-publication-2026v1\address-origins.parquet"
)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--raw-dir", type=Path, default=ROOT / "pipeline" / "data" / "raw")
    parser.add_argument("--spine", type=Path, default=DEFAULT_SPINE)
    parser.add_argument("--facts-dir", type=Path,
                        default=ROOT / "pipeline" / "data" / "processed" / "aedar" / "maps" / "bretagne-frame")
    parser.add_argument("--output-dir", type=Path,
                        default=PRODUCTION / "output" / "aedar-bretagne-exploration")
    parser.add_argument("--context-cache-root", type=Path,
                        default=PRODUCTION / "output" / "aedar-rennes-inspection" / ".stage-cache" / "official-context")
    parser.add_argument("--refresh", action="store_true")
    args = parser.parse_args()

    if not args.spine.is_file():
        parser.error(f"address-origin spine does not exist: {args.spine}")

    print("[aedar] preparing complete address facts for the Bretagne map frame", flush=True)
    prepare_aedar_frame_facts(args.raw_dir, args.spine, args.facts_dir)
    binding = build_aedar_map_set(args.raw_dir, args.facts_dir, args.spine)
    print("[aedar] rendering Rennes, Redon and Bretagne; inspection and inline", flush=True)
    result = run_production(aedar_recipe(), binding, "representative", ("inspection", "inline"),
                            AedarMapAdapter(args.raw_dir, context_cache_root=args.context_cache_root), args.output_dir,
                            refresh=args.refresh)
    for name, evidence in (("manifest.json", result.manifest), ("qa.json", result.qa)):
        (args.output_dir / name).write_text(
            json.dumps(evidence, indent=2, sort_keys=True, ensure_ascii=False) + "\n",
            encoding="utf-8")
    make_contact_sheet([item for item in result.outputs if item["profile"] == "inspection"],
                       args.output_dir / "contact-sheet.png")
    print(f"[aedar] rendered/reused {len(result.outputs)} exploratory maps at {args.output_dir}", flush=True)
    return 0


def make_contact_sheet(outputs, path: Path) -> None:
    """Compare stepped and continuous maps in a stable territory/mode order."""
    territory_order = {"35238": 0, "243500741": 1, "53": 2}
    mode_order = {"car": 0, "transit": 1, "bike_lts2": 2}
    def key(output):
        mode = output["mode"]
        continuous = mode.endswith("_continuous")
        source_mode = mode.removesuffix("_continuous") if continuous else mode
        return (territory_order.get(output["territory"]["code"], 99),
                mode_order.get(source_mode, 99), int(continuous))
    ordered = sorted(outputs, key=key)
    columns, cell, gap = 3, 800, 20
    rows = (len(ordered) + columns - 1) // columns
    sheet = QImage(columns * cell + (columns + 1) * gap,
                   rows * cell + (rows + 1) * gap,
                   QImage.Format_RGB32)
    sheet.fill(QColor("#F1F4F2"))
    painter = QPainter(sheet)
    for index, output in enumerate(ordered):
        source = QImage(output["path"])
        if source.isNull():
            raise RuntimeError(f"Could not load rendered AEDAR map for contact sheet: {output['path']}")
        x = gap + (index % columns) * (cell + gap)
        y = gap + (index // columns) * (cell + gap)
        painter.drawImage(x, y, source.scaled(cell, cell, Qt.KeepAspectRatio,
                                               Qt.SmoothTransformation))
    painter.end()
    path.parent.mkdir(parents=True, exist_ok=True)
    if not sheet.save(str(path), "PNG"):
        raise RuntimeError(f"Could not save AEDAR contact sheet: {path}")


def run_qgis() -> int:
    """Run the AEDAR CLI inside an initialized headless QGIS application."""
    app = QgsApplication([], False)
    app.initQgis()
    try:
        return main()
    finally:
        app.exitQgis()


if __name__ == "__main__":
    raise SystemExit(run_qgis())
