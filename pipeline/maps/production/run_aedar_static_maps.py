"""Generate the selected AEDAR static family into a private resumable export."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import threading
import traceback

PRODUCTION = Path(__file__).resolve().parent
ROOT = Path(__file__).resolve().parents[3]
LOG_LOCK = threading.RLock()


def build_parser():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--raw-dir", type=Path, default=ROOT / "pipeline/data/raw")
    parser.add_argument("--facts-path", type=Path, default=ROOT / "pipeline/data/processed/aedar/maps/bretagne-frame/address-access-metrics.parquet")
    parser.add_argument("--output-dir", type=Path, default=PRODUCTION / "output/aedar-static-full")
    parser.add_argument("--cache-dir", type=Path, help="shared preparation seed (default: selected output's .shared-cache)")
    parser.add_argument("--source-cache-owner", type=Path)
    parser.add_argument("--context-cache-root", type=Path)
    parser.add_argument("--family-config", type=Path, default=PRODUCTION / "network-family.json")
    parser.add_argument("--territory-registry", type=Path, default=ROOT / "public/data/territoires.json")
    parser.add_argument("--workers", type=int, choices=(1, 2, 4), default=4)
    parser.add_argument("--plan-only", action="store_true")
    parser.add_argument("--check-only", action="store_true")
    parser.add_argument("--acquire-context", action="store_true", help="Permit official context acquisition during rendering")
    parser.add_argument("--refresh", action="store_true")
    parser.add_argument("--worker", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--worker-index", type=int, default=0, help=argparse.SUPPRESS)
    parser.add_argument("--worker-cache", type=Path, help=argparse.SUPPRESS)
    parser.add_argument("--worker-source-cache", type=Path, help=argparse.SUPPRESS)
    return parser


def write_json(path, value):
    path = Path(path)
    temporary = path.with_name(f".{path.name}-{os.getpid()}-{threading.get_ident()}.tmp")
    try:
        temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def log(path, message):
    line = f"{datetime.now(timezone.utc).isoformat(timespec='seconds')} {message}"
    print(line, flush=True)
    with LOG_LOCK, Path(path).open("a", encoding="utf-8") as stream:
        stream.write(line + "\n")
        stream.flush()


def signatures(args):
    from aedar_maps import _file_sha256
    from network import _metadata_path

    paths = [args.facts_path, args.raw_dir / "communes_limites.geojson", args.family_config,
             args.territory_registry, _metadata_path(args.raw_dir),
             PRODUCTION / "aedar-static-family.json"]
    paths.extend(PRODUCTION / name for name in ("aedar_map_plan.py", "run_aedar_static_maps.py",
        "batch_execution.py",
        "aedar_static.py", "aedar_legend.py", "aedar_hex_preparation.py", "aedar_hex_grid.py",
        "aedar_car.py", "aedar_maps.py", "aedar_map_content.py", "runner.py", "network.py",
        "map_ground.py", "inspection_plate.py", "inspection_frame.py", "webp_encoding.py"))
    paths.extend((PRODUCTION / "network-palette.json",
        PRODUCTION / "assets/texture/qgis-hub-paper-texture-cc0.jpg",
        PRODUCTION / "assets/fonts/mozilla-text-latin-wght-normal.woff2"))
    absent = [str(path) for path in paths if not Path(path).is_file()]
    if absent:
        raise FileNotFoundError(f"Plan signature inputs are missing: {absent}")
    return {str(Path(path).resolve()): _file_sha256(path) for path in sorted(set(paths))}


def _set_thread_limits():
    for key in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS", "NUMEXPR_NUM_THREADS", "GDAL_NUM_THREADS"):
        os.environ[key] = "1"


def _qgis_app():
    from qgis.core import QgsApplication
    app = QgsApplication([], False)
    app.initQgis()
    from qgis.PyQt.QtCore import QThreadPool
    QThreadPool.globalInstance().setMaxThreadCount(1)
    import pyarrow as pa
    pa.set_cpu_count(1)
    pa.set_io_thread_count(1)
    return app


def _context_for_render(args, output, bases):
    from inspection_frame import shared_ground_extent
    from mainland_context import acquire_context, load_context

    extent = shared_ground_extent(bases, ("inspection", "inline"))
    bbox = (extent.xMinimum(), extent.yMinimum(), extent.xMaximum(), extent.yMaximum())
    cache = args.context_cache_root or output / "official-context"
    try:
        return load_context(cache, bbox), cache
    except (FileNotFoundError, ValueError, RuntimeError):
        if not args.acquire_context:
            raise ValueError("No validated owned official-context cache matches the full frame; no network was attempted")
        return acquire_context(cache, bbox), cache


def _worker(args, output, plan, config, all_bases, app):
    from aedar_map_plan import binding_for, decode_plan, selected_aedar_recipe
    from aedar_static import AddressFacts, AedarStaticAdapter
    from runner import PROFILES, run_production
    from webp_encoding import WEBP_ENCODING_CONTRACT

    if WEBP_ENCODING_CONTRACT["quality"] != 80 or WEBP_ENCODING_CONTRACT["method"] != 4:
        raise ValueError("Selected AEDAR static export requires the Q80/method-4 encoder contract")
    if plan["input_signatures"] != signatures(args):
        raise ValueError("Inputs changed since full-plan creation")
    facts = AddressFacts(args.facts_path, args.worker_cache)
    bases = decode_plan(plan)[0:]
    shard_rows = [bases[index] for index in plan["shards"][args.worker_index]]
    binding = binding_for(shard_rows, facts, args.facts_path, config)
    all_binding = binding_for(bases, facts, args.facts_path, config)
    expected = {(row["territory"]["kind"], row["territory"]["code"]) for row in shard_rows}
    network_config = json.loads(args.family_config.read_text(encoding="utf-8"))
    adapter = AedarStaticAdapter(args.raw_dir, args.facts_path, cache_dir=args.worker_cache,
        source_cache_owner=args.worker_source_cache, context_cache_root=args.context_cache_root,
        facts=facts, all_binding=all_binding, expected_territories=expected,
        family_config=network_config)
    shard = output / f"shard-{args.worker_index}"
    result = run_production(selected_aedar_recipe(), binding, "inspection-refresh",
        ("inspection", "inline"), adapter, shard, refresh=args.refresh)
    write_json(output / f"worker-{args.worker_index}.manifest.json", result.manifest)
    write_json(output / f"worker-{args.worker_index}.qa.json", result.qa)
    if result.qa["status"] != "passed":
        raise RuntimeError(f"worker {args.worker_index} QA failed: {result.qa['failures']}")
    write_json(output / f"worker-{args.worker_index}.progress.json",
        {"status": "complete", "territories": len(shard_rows), "artifacts": len(result.outputs)})


def _run_workers(args, output, plan, config, layout):
    commands = []
    for index in range(args.workers):
        command = [sys.executable, "-B", str(Path(__file__).resolve()), "--worker",
            "--output-dir", str(output), "--workers", str(args.workers),
            "--worker-index", str(index), "--raw-dir", str(args.raw_dir),
            "--facts-path", str(args.facts_path), "--family-config", str(args.family_config),
            "--territory-registry", str(args.territory_registry),
            "--worker-cache", str(layout[index]["cache"]),
            "--worker-source-cache", str(layout[index]["source"]),
            "--context-cache-root", str(args.context_cache_root or output / "official-context")]
        if args.refresh:
            command.append("--refresh")
        env = dict(os.environ, PYTHONIOENCODING="utf-8", PYTHONUNBUFFERED="1")
        commands.append((command, env))
    from batch_execution import run_workers
    run_workers(commands, output, plan["expected_webps"],
                write_json=write_json, log=log, log_lock=LOG_LOCK)


def _validate_complete(output, plan, args):
    from runner import PROFILES
    from webp_encoding import validate_webp

    names = set()
    for index in range(args.workers):
        qa = json.loads((output / f"worker-{index}.qa.json").read_text(encoding="utf-8"))
        if qa.get("status") != "passed":
            raise ValueError(f"worker {index} QA is not passed")
        expected_indices = set(plan["shards"][index])
        manifest = json.loads((output / f"worker-{index}.manifest.json").read_text(encoding="utf-8"))
        actual_pairs = {(row["territory"]["kind"], row["territory"]["code"]) for row in manifest["outputs"]}
        planned_pairs = {(plan["territories"][item]["territory"]["kind"],
                          plan["territories"][item]["territory"]["code"]) for item in expected_indices}
        if actual_pairs != planned_pairs:
            raise ValueError(f"worker {index} output territory coverage differs from its plan")
        for path in (output / f"shard-{index}").glob("*.webp"):
            if path.name in names:
                raise ValueError(f"Duplicate artifact filename: {path.name}")
            names.add(path.name)
            validate_webp(path, PROFILES["inline" if "-inline." in path.name else "inspection"])
    family = json.loads((PRODUCTION / "aedar-static-family.json").read_text(encoding="utf-8"))
    modes = tuple(family["modes"])
    profiles = tuple(family["profiles"])
    expected = {family["filename_template"].format(code=row["territory"]["code"], mode=mode, profile=profile)
                for row in plan["territories"] for mode in modes for profile in profiles}
    if names != expected or len(names) != plan["expected_webps"]:
        raise ValueError(f"Artifact coverage mismatch: {len(names)} actual / {len(expected)} expected")
    if plan["input_signatures"] != signatures(args):
        raise ValueError("Inputs changed during generation; refusing mixed-provenance completion")
    write_json(output / "complete.json", {"status": "passed", "territories": plan["territory_count"],
        "artifacts": len(names), "qa": "passed", "canonical_outputs": "untouched",
        "production_approval": "not claimed", "skipped": plan["skipped_no_address_facts"]})
    write_json(output / "progress.json", {"status": "complete", "completed_webps": len(names),
        "expected_webps": plan["expected_webps"]})


def main(argv=None):
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.worker:
        args.output_dir = args.output_dir.resolve()
    for label, path in (("raw data", args.raw_dir), ("facts", args.facts_path),
                        ("network family config", args.family_config),
                        ("territory registry", args.territory_registry)):
        if not path.exists():
            parser.error(f"{label} does not exist: {path}")
    if args.workers not in (1, 2, 4):
        parser.error("--workers must be 1, 2 or 4")
    _set_thread_limits()
    output = args.output_dir.resolve()
    if args.check_only:
        plan_path = output / "full-plan.json"
        if not plan_path.is_file():
            raise FileNotFoundError(f"No full plan exists at {plan_path}; run --plan-only first")
        plan = json.loads(plan_path.read_text(encoding="utf-8"))
        if plan["input_signatures"] != signatures(args):
            raise ValueError("Plan inputs changed; refusing to resume mixed export")
        if len(plan["shards"]) != args.workers:
            raise ValueError("Plan worker count differs; use a new output directory")
        print(json.dumps({"plan": str(plan_path), "territories": plan["territory_count"],
                          "expected_webps": plan["expected_webps"], "status": "inputs-current"}, indent=2))
        return 0

    from qgis.core import QgsProject
    from aedar_map_plan import build_aedar_static_map_set, encode_plan, selected_aedar_recipe
    from aedar_static import AddressFacts, AedarStaticAdapter, FAMILY_CONFIG
    from runner import PROFILES
    from webp_encoding import WEBP_ENCODING_CONTRACT, require_webp_encoder

    app = _qgis_app()
    try:
        from qgis.core import QgsProject
        if args.worker:
            plan = json.loads((output / "full-plan.json").read_text(encoding="utf-8"))
            _worker(args, output, plan, FAMILY_CONFIG, None, app)
            return 0
        output.mkdir(parents=True, exist_ok=True)
        main_log = output / "run.log"
        plan_path = output / "full-plan.json"
        log(main_log, "Planning/validating indexed facts and the authoritative territory inventory; no maps yet")
        source_signatures = signatures(args)
        existing = json.loads(plan_path.read_text(encoding="utf-8")) if plan_path.exists() else None
        if existing and (existing["input_signatures"] != source_signatures or len(existing["shards"]) != args.workers):
            if any(output.glob("shard-*/*.webp")):
                raise ValueError("Plan inputs or worker count changed; use a new output directory")
            log(main_log, "Plan changed before artifacts exist; rebuilding plan safely")
            existing = None
        cache_root = (args.cache_dir or output / ".shared-cache").resolve()
        cache_root.mkdir(parents=True, exist_ok=True)
        facts = AddressFacts(args.facts_path, cache_root)
        network_config = json.loads(args.family_config.read_text(encoding="utf-8"))
        binding, inventory = build_aedar_static_map_set(args.raw_dir, args.facts_path,
            facts=facts, family_config=network_config, territory_registry_path=args.territory_registry)
        bases = inventory["territories"]
        if args.plan_only:
            log(main_log, "plan-only: deriving authoritative territory and address-fact inventory; no context/render")
        plan = encode_plan(bases, facts, source_signatures, FAMILY_CONFIG, args.workers)
        plan.update({"skipped_no_address_facts": inventory["skipped_no_address_facts"],
            "empty_address_policy": "Skipped explicitly; no zero value or class range is fabricated.",
            "scope": "inspection-refresh; no production approval claimed", "q80": dict(WEBP_ENCODING_CONTRACT),
            "profiles": list(PROFILES), "worker_count": args.workers})
        write_json(plan_path, plan)
        if args.plan_only:
            log(main_log, f"Plan ready: {plan['territory_count']} territories; {plan['expected_webps']} WebPs; skipped {len(plan['skipped_no_address_facts'])} empty territories")
            return 0
        if plan["input_signatures"] != signatures(args):
            raise ValueError("Input signatures changed while plan was built")
        require_webp_encoder()
        if WEBP_ENCODING_CONTRACT["quality"] != 80:
            raise ValueError("Selected AEDAR static generation requires Q80 WebP")

        log(main_log, "Checking official full-frame context; acquisition only if explicitly enabled")
        context_result, context_root = _context_for_render(args, output, bases)
        log(main_log, f"Validated common official context at {context_result[0]}")
        from inspection_frame import shared_ground_extent
        extent = shared_ground_extent(bases, ("inspection", "inline"))
        from aedar_map_plan import binding_for
        all_binding = binding_for(bases, facts, args.facts_path, FAMILY_CONFIG)
        source_seed = (args.source_cache_owner.resolve() if args.source_cache_owner
                       else output / "seed" / "source")
        source_seed.mkdir(parents=True, exist_ok=True)
        common = AedarStaticAdapter(args.raw_dir, args.facts_path, cache_dir=cache_root,
            source_cache_owner=source_seed, context_cache_root=context_root,
            facts=facts, all_binding=all_binding,
            expected_territories={(f["territory"]["kind"], f["territory"]["code"]) for f in bases},
            family_config=network_config)
        log(main_log, "Preparing shared ground/frontier once against the complete inventory")
        common.begin_production_scope("inspection-refresh", output / "seed")
        try:
            common.prepare_run(selected_aedar_recipe(), binding, ("inspection", "inline"), output / "seed")
            common._shared_ground.frontier_for(bases[0]["region_geometry"])
        finally:
            common.end_production_scope("inspection-refresh", output / "seed", success=True)
        from batch_execution import prepare_worker_layout
        layout = prepare_worker_layout(output, args.workers, cache_root, source_seed)
        log(main_log, f"Starting resumable render: {plan['territory_count']} territories; workers={args.workers}")
        _run_workers(args, output, plan, FAMILY_CONFIG, layout)
        _validate_complete(output, plan, args)
        log(main_log, f"COMPLETE: {plan['territory_count']} territories, {plan['expected_webps']} decoded WebPs; no upload/approval")
        return 0
    finally:
        QgsProject.instance().clear()
        app.exitQgis()


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except SystemExit:
        raise
    except BaseException:
        try:
            parser = build_parser()
            parsed, _ = parser.parse_known_args()
            output = parsed.output_dir.resolve()
            if output.is_dir() and not parsed.worker:
                log(output / "run.log", "FAILED / INTERRUPTED: " + traceback.format_exc())
        finally:
            raise
