"""Run (or retry) the approved full network batch through run_production."""
import argparse
import json
from pathlib import Path
import sys

from qgis.core import QgsApplication

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(Path(__file__).resolve().parent))
from approval import read_approval
from network import NetworkAdapter, build_full_map_set, network_recipe
from runner import run_production


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--approval", type=Path, required=True)
    args = parser.parse_args()
    app = QgsApplication([], False)
    app.initQgis()
    try:
        raw = ROOT / "pipeline" / "data" / "raw"
        output = ROOT / "pipeline" / "maps" / "production" / "output"
        binding = build_full_map_set(raw)
        result = run_production(network_recipe(), binding, "full",
            ("inspection", "inline"), NetworkAdapter(raw), output,
            approval=read_approval(args.approval))
        for name, value in (("full-manifest.json", result.manifest), ("full-qa.json", result.qa)):
            (output / name).write_text(json.dumps(value, indent=2, sort_keys=True,
                ensure_ascii=False), encoding="utf-8")
        print(json.dumps(result.qa, indent=2), flush=True)
        if result.qa["status"] != "passed":
            return 1
        return 0
    finally:
        app.exitQgis()


if __name__ == "__main__":
    raise SystemExit(main())
