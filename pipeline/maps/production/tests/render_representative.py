"""Render and validate the complete 18-artifact representative map set."""
from pathlib import Path
import argparse
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
    parser = argparse.ArgumentParser()
    parser.add_argument("--refresh", action="store_true", help="bypass output and derived-stage caches")
    parser.add_argument("--raw-dir", type=Path, default=root / "pipeline/data/raw",
        help="authoritative existing raw-data directory; this command never copies inputs")
    parser.add_argument("--network-cache-root", type=Path,
        help="existing OSM/Geovelo source-cache root (use with --read-only-source-cache)")
    parser.add_argument("--read-only-source-cache", action="store_true",
        help="reuse validated source generations only; fail closed rather than build or mutate caches")
    parser.add_argument("--output-dir", type=Path, default=root / "pipeline/maps/production/output",
        help="isolated product/evidence directory; does not replace historical reviewed PNG evidence")
    parser.add_argument("--context-cache-root", type=Path,
        help="explicit read-only root of an already validated official-context cache generation")
    args = parser.parse_args()
    raw = args.raw_dir
    binding = build_representative_map_set(raw)
    result = run_production(
        network_recipe(),
        binding,
        "representative",
        ("inspection", "inline"),
        NetworkAdapter(raw, cache_root=args.network_cache_root,
            context_cache_root=args.context_cache_root,
            read_only_source_cache=args.read_only_source_cache),
        args.output_dir,
        refresh=args.refresh,
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
    assert result.manifest["approval_pairs_complete"] is True
    assert len(result.manifest["approval_members"]) == 18
    output_dir = args.output_dir
    for name, evidence in (("manifest.json", result.manifest), ("qa.json", result.qa)):
        (output_dir / name).write_text(
            json.dumps(evidence, indent=2, sort_keys=True, ensure_ascii=False), encoding="utf-8"
        )
    print(json.dumps(result.qa, indent=2), flush=True)
    print(f"[maps] verified 18 outputs; manifest and QA evidence: {output_dir}", flush=True)
finally:
    app.exitQgis()
