"""Run bounded, source-derived native outputs for issue 772 (no approval/writeback)."""
import json
import os
from hashlib import sha256
from pathlib import Path
import sys

PRODUCTION = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PRODUCTION))

ROOT = PRODUCTION.parents[2]
TERRITORY = ("commune", "35060")
RAW = ROOT / "pipeline/data/raw"
FACTS_PATH = ROOT / "pipeline/data/processed/aedar/maps/bretagne-frame/address-access-metrics.parquet"
OWNED = PRODUCTION / "output/issue772-native"
CONTEXTS = PRODUCTION / "output/parity-inputs"


def _bounded_context(cache_root, bbox):
    from mainland_context import load_context_covering
    errors = []
    for name in ("context-original", "context-refresh"):
        try:
            return load_context_covering(CONTEXTS / name, bbox)
        except Exception as error:
            errors.append(f"{name}: {error}")
    raise RuntimeError("No copied validated context covers required extent: " + "; ".join(errors))


def main():
    for key in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS", "NUMEXPR_NUM_THREADS", "GDAL_NUM_THREADS"):
        os.environ[key] = "1"
    from qgis.core import QgsApplication, QgsProject
    from qgis.PyQt.QtCore import QThreadPool
    app = QgsApplication([], False)
    app.initQgis()
    QThreadPool.globalInstance().setMaxThreadCount(1)
    try:
        from network import build_full_map_set, network_recipe, NetworkAdapter
        from runner import Binding, MapSet, run_production

        OWNED.mkdir(parents=True, exist_ok=True)
        # Source-derived complete territory/mode facts; only the exact reviewed
        # territory/mode is handed to the bounded renderer.
        full_network = build_full_map_set(RAW)
        network_rows = [f for rows in full_network.map_set.layers.values() for f in rows
                        if (f["territory"]["kind"], f["territory"]["code"]) == TERRITORY]
        if {f["mode"] for f in network_rows} != {"car", "walk", "bike"}:
            raise ValueError(f"Expected the authoritative three network readings, got {[f['mode'] for f in network_rows]}")
        network_binding = Binding("network", MapSet({"bounded-source-member": tuple(network_rows)}))
        nout = OWNED / "network-35060"
        na = NetworkAdapter(RAW, cache_root=nout / "cache", context_loader=_bounded_context,
                            context_cache_root=CONTEXTS / "context-original")
        nr = run_production(network_recipe(), network_binding, "representative",
                            ("inspection", "inline"), na, nout, refresh=False)

        from aedar_map_plan import build_aedar_static_map_set, binding_for, selected_aedar_recipe
        from aedar_static import AddressFacts, AedarStaticAdapter
        afacts = AddressFacts(FACTS_PATH, OWNED / "aedar-cache")
        full_aedar, _summary = build_aedar_static_map_set(RAW, FACTS_PATH, facts=afacts)
        all_bases = [f for rows in full_aedar.map_set.layers.values() for f in rows if f["mode"] == "car"]
        bases = [f for f in all_bases if (f["territory"]["kind"], f["territory"]["code"]) == TERRITORY]
        if len(bases) != 1:
            raise ValueError(f"Expected one source-derived AEDAR territory base, got {len(bases)}")
        selected = binding_for(bases, afacts, FACTS_PATH)
        # For the deliberately bounded inspection-refresh candidate, prepare
        # exactly the represented territory rather than claiming full scope.
        selected_all = selected
        aout = OWNED / "aedar-35060"
        aa = AedarStaticAdapter(RAW, FACTS_PATH, cache_dir=OWNED / "aedar-cache",
            facts=afacts, all_binding=selected_all, expected_territories={TERRITORY},
            context_loader=_bounded_context, context_cache_root=CONTEXTS / "context-refresh")
        ar = run_production(selected_aedar_recipe(), selected, "inspection-refresh",
            ("inspection", "inline"), aa, aout, refresh=False)

        records = []
        expected = {
            "35060-car-inspection.webp": "84c9c6c6ba7d9f48e5b21da551bfe8a99f190107057c6d5fe5ece3b645c35048",
            "35060-car-inline.webp": "5e9f84e7610f62dd3e5bf47136cf91291f64676b5dd9edc04080f6e85acde11c",
            "35060-car-inspection.webp#aedar": "1b53ecc9565438f885b7a03dbd7f94c55d7ec4213e1d882e220ead2be5efe479",
            "35060-car-inline.webp#aedar": "bde976cc7db47e8d7ca129463f28ead8137f8e64aabd991a1f7b093e9ecc6fb7",
            "35060-transit-inspection.webp": "5c99373e1028a7ace25e18db203671966892c7f373adb162b107b87356a9cc0a",
            "35060-transit-inline.webp": "7d8b4ebf36f6d8b6de3494302ead403d8e27561244c3fcd2fbe29e7ed38de607",
        }
        results = (("network", nr), ("aedar", ar))
        for family, result in results:
            for row in result.outputs:
                path = Path(row["path"])
                actual = sha256(path.read_bytes()).hexdigest()
                key = path.name + ("#aedar" if family == "aedar" and "car" in path.name else "")
                records.append({"family": family, "profile": row["profile"], "mode": row["mode"],
                    "file": path.name, "sha256": actual, "reference_sha256": expected.get(key),
                    "byte_identical": (actual == expected[key]) if key in expected else None})
        report = {"network_qa": nr.qa["status"], "aedar_qa": ar.qa["status"],
                  "network_input_identity": na.input_identity(),
                  "aedar_input_identity": aa.input_identity(),
                  "facts_sha256": sha256(FACTS_PATH.read_bytes()).hexdigest(),
                  "outputs": records, "scope": "one source-derived territory; not an atlas"}
        (OWNED / "network-manifest.json").write_text(json.dumps(nr.manifest, indent=2), encoding="utf-8")
        (OWNED / "network-qa.json").write_text(json.dumps(nr.qa, indent=2), encoding="utf-8")
        (OWNED / "aedar-manifest.json").write_text(json.dumps(ar.manifest, indent=2), encoding="utf-8")
        (OWNED / "aedar-qa.json").write_text(json.dumps(ar.qa, indent=2), encoding="utf-8")
        (OWNED / "native-parity.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(report, indent=2), flush=True)
        if nr.qa["status"] != "passed" or ar.qa["status"] != "passed":
            raise RuntimeError("bounded native renderer QA did not pass")
    finally:
        QgsProject.instance().clear()
        app.exitQgis()


if __name__ == "__main__":
    main()
