"""Bounded native-WebP parity against a completed export; never runs an atlas or uploads."""
import argparse
import json
from pathlib import Path
import shutil
import sys

PRODUCTION = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PRODUCTION))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reference-dir", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--territory", action="append", required=True, help="kind/code; at most four")
    args = parser.parse_args()
    if not 1 <= len(args.territory) <= 4 or len(set(args.territory)) != len(args.territory):
        parser.error("Choose one to four distinct reviewed territories, not a full inventory")
    import os
    for name in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS", "NUMEXPR_NUM_THREADS", "GDAL_NUM_THREADS"):
        os.environ[name] = "1"
    from qgis.core import QgsApplication, QgsProject
    from qgis.PyQt.QtCore import QThreadPool
    app = QgsApplication([], False)
    app.initQgis()
    QThreadPool.globalInstance().setMaxThreadCount(1)
    from aedar_map_plan import decode_plan, binding_for, selected_aedar_recipe
    from aedar_static import AddressFacts, AedarStaticAdapter
    from runner import run_production, PROFILES
    from upload_maps import sha256
    from webp_encoding import validate_webp
    root = PRODUCTION.parents[2]
    reference, output = args.reference_dir.resolve(), args.output_dir.resolve()
    if reference == output or output.is_relative_to(reference):
        parser.error("Parity output must not change the reference export")
    output.mkdir(parents=True, exist_ok=True)
    try:
        plan = json.loads((reference / "full-plan.json").read_text(encoding="utf-8"))
        all_bases = decode_plan(plan)
        wanted = set(args.territory)
        bases = [base for base in all_bases if "/".join(base["territory"][key] for key in ("kind", "code")) in wanted]
        if len(bases) != len(wanted):
            raise ValueError("Requested review territory is missing from the completed plan")
        facts_path = root / "pipeline/data/processed/aedar/maps/bretagne-frame/address-access-metrics.parquet"
        facts = AddressFacts(facts_path, output / "cache")
        binding = binding_for(bases, facts, facts_path)
        all_binding = binding_for(all_bases, facts, facts_path)
        source = output / "source"
        if not source.exists():
            shutil.copytree(reference / "seed/source", source)
        adapter = AedarStaticAdapter(root / "pipeline/data/raw", facts_path, cache_dir=output / "cache",
            facts=facts, all_binding=all_binding, source_cache_owner=source,
            context_cache_root=reference / "official-context", verify_preparation=True,
            expected_territories={(base["territory"]["kind"], base["territory"]["code"]) for base in bases})
        result = run_production(selected_aedar_recipe(), binding, "inspection-refresh",
                                ("inspection", "inline"), adapter, output, refresh=False)
        if result.qa["status"] != "passed":
            raise ValueError(f"Bounded renderer QA failed: {result.qa['failures']}")
        differences = []
        for row in result.outputs:
            path = Path(row["path"])
            matches = list(reference.glob(f"shard-*/{path.name}"))
            if len(matches) != 1:
                raise ValueError(f"Missing/duplicate reference: {path.name}")
            validate_webp(path, PROFILES[row["profile"]])
            if sha256(path) != sha256(matches[0]):
                differences.append(path.name)
        report = {"status": "passed" if not differences else "failed", "artifacts": len(result.outputs),
            "byte_identical": len(result.outputs) - len(differences), "differences": differences,
            "territories": args.territory, "qa": result.qa["status"], "reference": str(reference)}
        (output / "parity.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        (output / "manifest.json").write_text(json.dumps(result.manifest, indent=2), encoding="utf-8")
        (output / "qa.json").write_text(json.dumps(result.qa, indent=2), encoding="utf-8")
        print(json.dumps(report, indent=2), flush=True)
        if differences:
            raise AssertionError("Native WebP parity failed; see parity.json")
    finally:
        QgsProject.instance().clear()
        app.exitQgis()


if __name__ == "__main__":
    main()
