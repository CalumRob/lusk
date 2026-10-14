"""Run the approved full network batch using shared bounded workers."""
from __future__ import annotations

import argparse
from dataclasses import asdict
import gc
import hashlib
import json
import os
from pathlib import Path
import secrets
import shutil
import sys
import threading
from datetime import datetime, timezone

for _thread_var in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS",
                    "NUMEXPR_NUM_THREADS", "GDAL_NUM_THREADS"):
    os.environ[_thread_var] = "1"

from qgis.core import QgsApplication, QgsProject

ROOT = Path(__file__).resolve().parents[3]
PRODUCTION = Path(__file__).resolve().parent
sys.path.insert(0, str(PRODUCTION))
from approval import read_approval
from batch_execution import prepare_worker_layout, run_workers
from network import NetworkAdapter, build_full_map_set, network_recipe
from runner import (delegate_full_batch, full_batch_admission,
    read_signed_batch_plan, run_production, verify_full_batch_shard, write_signed_batch_plan,
    _stable_identity)

LOG_LOCK = threading.RLock()
PROFILES = ("inspection", "inline")


def write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}-{os.getpid()}.tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    os.replace(temporary, path)


def log(path, message):
    line = f"{datetime.now(timezone.utc).isoformat(timespec='seconds')} {message}"
    print(line, flush=True)
    with LOG_LOCK, Path(path).open("a", encoding="utf-8") as stream:
        stream.write(line + "\n")
        stream.flush()


def build_parser():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--approval", type=Path, required=True)
    parser.add_argument("--raw-dir", type=Path)
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument("--territory-registry", type=Path)
    parser.add_argument("--context-cache-root", type=Path)
    parser.add_argument("--workers", type=int, choices=(1, 2, 4), default=4)
    parser.add_argument("--worker", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--worker-index", type=int, help=argparse.SUPPRESS)
    parser.add_argument("--plan-path", type=Path, help=argparse.SUPPRESS)
    parser.add_argument("--worker-cache", type=Path, help=argparse.SUPPRESS)
    parser.add_argument("--worker-source", type=Path, help=argparse.SUPPRESS)
    return parser


def _set_thread_limits():
    for name in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS",
                 "NUMEXPR_NUM_THREADS", "GDAL_NUM_THREADS"):
        os.environ[name] = "1"


def _all_features(binding):
    return [feature for values in binding.map_set.layers.values() for feature in values]


def _binding_subset(binding, territory_members):
    selected = {(kind, code) for kind, code, _modes in territory_members}
    features = [feature for feature in _all_features(binding)
        if (str(feature["territory"]["kind"]), str(feature["territory"]["code"])) in selected]
    return type(binding)(binding.family, type(binding.map_set)({"network-outputs": tuple(features)}))


def _run_worker(args):
    key = bytes.fromhex(os.environ.pop("LUSK_NETWORK_BATCH_KEY"))
    admission, delegations = read_signed_batch_plan(args.plan_path, key)
    if args.worker_index is None or not 0 <= args.worker_index < len(delegations):
        raise ValueError("Invalid worker index in delegated full batch")
    raw, output = args.raw_dir.resolve(), args.output_dir.resolve()
    binding = build_full_map_set(raw, territory_registry_path=args.territory_registry)
    from mainland_context import load_context_covering
    adapter = NetworkAdapter(raw, cache_root=args.worker_source,
        context_loader=load_context_covering,
        context_cache_root=args.context_cache_root, read_only_source_cache=True,
        stage_cache_root=args.worker_cache)
    approval = read_approval(args.approval)
    current = full_batch_admission(network_recipe(), binding, PROFILES, adapter, approval,
        output / f"worker-{args.worker_index}", worker_count=args.workers)
    delegation = delegations[args.worker_index]
    verify_full_batch_shard(delegation, current)
    subset = _binding_subset(binding, delegation.members)
    result = run_production(network_recipe(), subset, "full", PROFILES, adapter,
        output / f"shard-{args.worker_index}", approval=approval,
        admission=current, delegation=delegation, full_binding=binding)
    write_json(output / f"worker-{args.worker_index}.manifest.json", result.manifest)
    write_json(output / f"worker-{args.worker_index}.qa.json", result.qa)
    if result.qa["status"] != "passed":
        raise RuntimeError(f"network worker {args.worker_index} QA failed: {result.qa['failures']}")


def _execute(args, binding, adapter, approval, admission):
    output = args.output_dir.resolve()
    stable_plan = json.loads(json.dumps(asdict(admission), sort_keys=True, default=str))
    plan_path = output / "full-plan.json"
    if plan_path.is_file():
        previous = json.loads(plan_path.read_text(encoding="utf-8"))
        if previous != stable_plan:
            raise ValueError("Full network plan inputs, approval, renderer, inventory or worker assignment changed; use a new output directory")
    output.mkdir(parents=True, exist_ok=True)
    write_json(plan_path, stable_plan)
    log(output / "run.log", f"Full inventory/approval admitted; preparing immutable network providers; workers={args.workers}")
    seed = output / "seed"
    seed.mkdir(parents=True, exist_ok=True)
    context_root = args.context_cache_root or output / ".stage-cache" / "official-context"
    adapter.cache_root = seed / "source"
    adapter.cache_root.mkdir(parents=True, exist_ok=True)
    adapter.stage_cache_root = seed / ".stage-cache"
    adapter.stage_cache_root.mkdir(parents=True, exist_ok=True)
    adapter.begin_production_scope("full", seed)
    prepared = False
    try:
        adapter.prepare_run(network_recipe(), binding, PROFILES, seed,
            context_cache_root=context_root)
        prepared = True
    finally:
        adapter.end_production_scope("full", seed, success=prepared)
        QgsProject.instance().clear()
        adapter._shared_ground = None
        adapter._network_layers = {}
        gc.collect()
    from batch_execution import prepare_worker_layout
    layout = prepare_worker_layout(output, args.workers, seed / ".stage-cache", seed / "source")
    partitions = [[admission.members.index(member) for member in assignment]
                  for assignment in admission.assignments]
    delegations = delegate_full_batch(admission, partitions, args.workers)
    key = secrets.token_bytes(32)
    signed_plan_path = output / "full-batch.plan"
    write_signed_batch_plan(signed_plan_path, admission, delegations, key)
    commands = []
    for index, item in enumerate(layout):
        command = [sys.executable, "-B", str(Path(__file__).resolve()),
            "--worker", "--approval", str(args.approval.resolve()),
            "--raw-dir", str(args.raw_dir.resolve()), "--output-dir", str(output),
            "--territory-registry", str(args.territory_registry.resolve()),
            "--plan-path", str(signed_plan_path), "--worker-index", str(index),
            "--workers", str(args.workers), "--worker-cache", str(item["cache"]),
            "--worker-source", str(item["source"])]
        context = args.context_cache_root or output / ".stage-cache" / "official-context"
        command += ["--context-cache-root", str(context.resolve())]
        env = dict(os.environ, LUSK_NETWORK_BATCH_KEY=key.hex(), PYTHONIOENCODING="utf-8", PYTHONUNBUFFERED="1")
        commands.append((command, env))
    expected_count = len(admission.members) * len(PROFILES) * len(admission.members[0][2])
    run_workers(commands, output, expected_count, write_json=write_json, log=log, log_lock=LOG_LOCK)
    current = adapter.input_identity()
    if _stable_identity(current) != admission.input_identity:
        raise ValueError("Network inputs changed during generation; refusing aggregate manifest")
    if _stable_identity(adapter.render_identity()) != admission.renderer_identity:
        raise ValueError("Network renderer/assets changed during generation; refusing aggregate manifest")
    if _stable_identity(read_approval(args.approval)) != admission.approval_identity:
        raise ValueError("Full production approval changed during generation; refusing aggregate manifest")
    outputs, failures, expected, stage_report = [], [], [], []
    seen_names = set()
    worker_qa = []
    for index, delegation in enumerate(delegations):
        qa = json.loads((output / f"worker-{index}.qa.json").read_text(encoding="utf-8"))
        manifest = json.loads((output / f"worker-{index}.manifest.json").read_text(encoding="utf-8"))
        if qa.get("status") != "passed":
            raise ValueError(f"Worker {index} is not QA-passed")
        worker_qa.append(qa)
        expected.extend(manifest["expected_outputs"])
        failures.extend(manifest["failures"])
        stage_report.extend(manifest.get("stage_report", []))
        for row in manifest["outputs"]:
            source = Path(row["path"])
            canonical = output / source.name
            if source.name in seen_names:
                raise ValueError(f"Duplicate worker artifact filename {canonical.name}")
            seen_names.add(source.name)
            source_digest = hashlib.sha256(source.read_bytes()).digest()
            if not canonical.is_file() or hashlib.sha256(canonical.read_bytes()).digest() != source_digest:
                staged = canonical.with_name(f".{canonical.name}-{os.getpid()}.stage")
                shutil.copy2(source, staged)
                os.replace(staged, canonical)
            outputs.append({**row, "path": str(canonical)})
    expected = [{**row, "path": str(output / Path(row["path"]).name)} for row in expected]
    expected_names = {f"{feature['territory']['code']}-{feature['mode']}-{profile}.webp"
        for feature in _all_features(binding) for profile in PROFILES}
    actual_names = {Path(row["path"]).name for row in outputs}
    if actual_names != expected_names or len(outputs) != len(expected_names) or failures:
        raise ValueError("Network batch did not produce exact full artifact coverage")
    approval_members = sorted((row["territory"]["kind"], row["territory"]["code"],
        row["mode"], row["profile"], row["effective_identity"]) for row in outputs)
    manifest = {"recipe": network_recipe().name, "recipe_version": network_recipe().version,
        "foundation_version": network_recipe().foundation.version, "family": network_recipe().family,
        "renderer_identity": adapter.render_identity(), "authoritative_inputs": current,
        "render_identity": outputs[0]["render_identity"],
        "approval_identity": hashlib.sha256(json.dumps(approval_members, separators=(",", ":")).encode()).hexdigest(),
        "approval_members": approval_members, "approval_pairs_complete": True,
        "artifact_contracts": {name: adapter.output_contract(__import__("runner").PROFILES[name]) for name in PROFILES},
        "expected_outputs": expected, "failures": failures, "stage_report": stage_report,
        "scope": "full", "outputs": outputs,
        "preflight_seconds": sum(item.get("preflight_seconds", 0) for item in worker_qa),
        "preparation_seconds": sum(item.get("preparation_seconds", 0) for item in worker_qa),
        "input_hash_seconds": sum(item.get("input_hash_seconds", 0) for item in worker_qa),
        "elapsed_seconds": sum(item.get("elapsed_seconds", 0) for item in worker_qa)}
    select_spot_check = getattr(adapter, "visual_spot_check_outputs", None)
    review_set = select_spot_check(outputs) if callable(select_spot_check) else []
    qa = {"status": "passed", "production_status": "awaiting-human-spot-check",
        "human_spot_check": {"status": "pending", "review_set": review_set, "outcome": None},
        "artifact_count": len(outputs), "expected_artifact_count": len(expected_names),
        "expected_outputs": expected, "failures": failures,
        "profile_counts": {name: sum(row["profile"] == name for row in outputs) for name in PROFILES},
        "stage_report": stage_report,
        "preflight_seconds": sum(item.get("preflight_seconds", 0) for item in worker_qa),
        "preparation_seconds": sum(item.get("preparation_seconds", 0) for item in worker_qa),
        "input_hash_seconds": sum(item.get("input_hash_seconds", 0) for item in worker_qa),
        "elapsed_seconds": sum(item.get("elapsed_seconds", 0) for item in worker_qa),
        "checks": sorted({check for item in worker_qa for check in item.get("checks", [])})}
    write_json(output / "full-manifest.json", manifest)
    write_json(output / "full-qa.json", qa)
    write_json(output / "complete.json", {"status": "passed", "territories": len(admission.members),
        "artifacts": len(outputs), "qa": "passed"})
    return qa


def main(argv=None):
    args = build_parser().parse_args(argv)
    _set_thread_limits()
    args.raw_dir = args.raw_dir or ROOT / "pipeline" / "data" / "raw"
    args.output_dir = args.output_dir or ROOT / "pipeline" / "maps" / "production" / "output"
    args.territory_registry = args.territory_registry or ROOT / "public" / "data" / "territoires.json"
    if args.worker:
        app = QgsApplication([], False); app.initQgis()
        from qgis.PyQt.QtCore import QThreadPool
        QThreadPool.globalInstance().setMaxThreadCount(1)
        try:
            _run_worker(args)
            return 0
        finally:
            QgsProject.instance().clear(); app.exitQgis()
    app = QgsApplication([], False); app.initQgis()
    from qgis.PyQt.QtCore import QThreadPool
    QThreadPool.globalInstance().setMaxThreadCount(1)
    try:
        binding = build_full_map_set(args.raw_dir, territory_registry_path=args.territory_registry)
        recipe, approval = network_recipe(), read_approval(args.approval)
        context_root = args.context_cache_root or args.output_dir / ".stage-cache" / "official-context"
        adapter = NetworkAdapter(args.raw_dir, context_cache_root=context_root)
        if not callable(getattr(adapter, "begin_production_scope", None)):
            # Compatibility for narrow adapters used by contract-level callers;
            # the supported NetworkAdapter always takes the shared worker path.
            from runner import run_production
            result = run_production(recipe, binding, "full", PROFILES, adapter,
                args.output_dir, approval=approval)
            args.output_dir.mkdir(parents=True, exist_ok=True)
            write_json(args.output_dir / "full-manifest.json", result.manifest)
            write_json(args.output_dir / "full-qa.json", result.qa)
            return 0 if result.qa["status"] == "passed" else 1
        # Admission, including authoritative full source inventory and current
        # representative approval identity, precedes output or shared prep.
        admission = full_batch_admission(recipe, binding, PROFILES, adapter, approval,
            args.output_dir, worker_count=args.workers)
        qa = _execute(args, binding, adapter, approval, admission)
        print(json.dumps(qa, indent=2), flush=True)
        return 0 if qa["status"] == "passed" else 1
    finally:
        QgsProject.instance().clear(); app.exitQgis()


if __name__ == "__main__":
    raise SystemExit(main())
