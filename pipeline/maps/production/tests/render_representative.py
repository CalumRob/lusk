"""Render and validate the complete 18-artifact representative map set."""
from pathlib import Path
import json
import sys

from qgis.core import QgsApplication

root = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(Path(__file__).parents[1]))
from network import NetworkAdapter, build_representative_map_set, network_recipe  # noqa: E402
from runner import run_production  # noqa: E402


app = QgsApplication([], False)
app.initQgis()
try:
    raw = root / "pipeline/data/raw"
    binding = build_representative_map_set(raw)
    result = run_production(
        network_recipe(),
        binding,
        "representative",
        ("inspection", "inline"),
        NetworkAdapter(raw),
        root / "pipeline/maps/production/output",
    )
    expected = {
        (kind, code, mode, profile)
        for kind, code in (("commune", "35238"), ("region", "53"), ("epci", "243500741"))
        for mode in ("car", "walk", "bike")
        for profile in ("inspection", "inline")
    }
    actual = {
        (item["territory"]["kind"], item["territory"]["code"], item["mode"], item["profile"])
        for item in result.outputs
    }
    assert actual == expected, (sorted(expected - actual), sorted(actual - expected))
    assert result.qa["status"] == "passed"
    assert result.qa["artifact_count"] == 18
    assert result.qa["profile_counts"] == {"inspection": 9, "inline": 9}
    output_dir = root / "pipeline/maps/production/output"
    for name, evidence in (("manifest.json", result.manifest), ("qa.json", result.qa)):
        (output_dir / name).write_text(
            json.dumps(evidence, indent=2, sort_keys=True, ensure_ascii=False), encoding="utf-8"
        )
    print(json.dumps(result.qa, indent=2), flush=True)
    print(f"[maps] verified 18 outputs; manifest and QA evidence: {output_dir}", flush=True)
finally:
    app.exitQgis()
