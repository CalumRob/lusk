"""Safely repair only department inspection titles in an approved full batch.

This command never acquires source data and never records human approval. It
stages and decodes every replacement before preserving/promoting any product.
"""
import argparse
from datetime import datetime, timezone
from hashlib import sha256
import json
import os
from pathlib import Path
import shutil
import sys
from tempfile import TemporaryDirectory
from uuid import uuid4

from qgis.core import QgsApplication

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(Path(__file__).resolve().parent))
from approval import read_approval, require_approval, validate_approval_claim
from network import NetworkAdapter, build_full_map_set, network_recipe
from runner import Binding, MapSet, PROFILES, _effective_identity_for, run_production


class DepartmentTitleRepairAdapter(NetworkAdapter):
    """Prepare full-run shared inputs while rendering through a narrow binding."""

    def __init__(self, raw_dir, *, preparation_binding, shared_output_dir,
                 cache_root=None, context_cache_root=None, read_only_source_cache=True):
        super().__init__(raw_dir, cache_root=cache_root,
            context_cache_root=context_cache_root,
            read_only_source_cache=read_only_source_cache)
        self._preparation_binding = preparation_binding
        self._shared_output_dir = Path(shared_output_dir)

    def prepare_run(self, recipe, binding, profiles, output_dir, *, refresh=False,
                    context_cache_root=None):
        """Use the full production frame/cache, not the subset's different bbox."""
        return super().prepare_run(recipe, self._preparation_binding, profiles,
            self._shared_output_dir, refresh=refresh,
            context_cache_root=context_cache_root)

    def begin_production_scope(self, scope, output_dir):
        # Keep bounded per-territory lifecycle while disabling subset-specific
        # on-disk stage writes into the shared full-run cache.
        return super().begin_production_scope("full", output_dir)


def _read_json(path):
    value = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"expected JSON object: {path}")
    return value


def _file_sha256(path):
    digest = sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _record_key(item):
    territory = item.get("territory", {})
    return (str(territory.get("kind")), str(territory.get("code")),
            str(item.get("mode")), str(item.get("profile")))


def _verified_records(manifest, output_root):
    rows = manifest.get("outputs")
    if not isinstance(rows, list) or not rows:
        raise ValueError("full manifest has no complete output records")
    verified = {}
    for row in rows:
        key = _record_key(row)
        path = Path(row.get("path", ""))
        if key in verified or not path.is_file() or len(row.get("output_sha256", "")) != 64:
            raise ValueError(f"full-batch artifact record is missing, duplicated, or invalid: {key}")
        try:
            path.resolve().relative_to(output_root.resolve())
        except ValueError as error:
            raise ValueError(f"full-batch artifact escapes output directory: {path}") from error
        if _file_sha256(path) != row["output_sha256"]:
            raise ValueError(f"full-batch artifact changed since approved QA: {path}")
        verified[key] = row
    expected = manifest.get("expected_outputs", [])
    if (not expected or len(expected) != len(verified)
            or {_record_key(row) for row in expected} != set(verified)):
        raise ValueError("full manifest output records do not cover its complete expected inventory")
    return verified


def _verified_output_cache(cache, records):
    outputs = cache.get("outputs") if isinstance(cache, dict) else None
    if not isinstance(outputs, dict):
        raise ValueError("production output cache is missing a valid outputs table")
    for key, row in records.items():
        cache_key = "/".join(key)
        entry = outputs.get(cache_key)
        if not isinstance(entry, dict):
            raise ValueError(f"production output cache is missing full-batch record: {cache_key}")
        if (entry.get("effective_identity") != row.get("effective_identity")
                or entry.get("output_sha256") != row.get("output_sha256")
                or not entry.get("path")
                or Path(entry["path"]).resolve() != Path(row["path"]).resolve()):
            raise ValueError(f"production output cache disagrees with full manifest: {cache_key}")
    return outputs


def _department_inspection_binding(binding):
    selected = tuple(feature for layer in binding.map_set.layers.values() for feature in layer
                     if feature["territory"]["kind"] == "departement")
    if not selected or any(not feature["territory"].get("name") or
                           feature["territory"]["name"] == feature["territory"]["code"]
                           for feature in selected):
        raise ValueError("current full inventory has missing department display names")
    return Binding(binding.family, MapSet({"department-title-repair": selected})), selected


def _approval_gate(approval, recipe, adapter, binding, output_dir):
    renderer = adapter.render_identity()
    validate_approval_claim(approval, recipe, renderer)
    members = adapter.prepare_current_approval_members(
        recipe, binding, ("inspection", "inline"), renderer, output_dir)
    require_approval({"scope": "representative", "approval_pairs_complete": True,
        "recipe": recipe.name, "recipe_version": recipe.version,
        "foundation_version": recipe.foundation.version,
        "renderer_identity": renderer, "approval_members": members}, approval)
    return renderer, members


def _write_json_atomic(path, value):
    path = Path(path)
    temporary = path.with_name(f".{path.name}.repair.tmp")
    with temporary.open("w", encoding="utf-8", newline="\n") as stream:
        json.dump(value, stream, indent=2, sort_keys=True, ensure_ascii=False)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)


def _department_label_provenance():
    source = ROOT / "public" / "data" / "territoires.json"
    return {"path": str(source.resolve()), "sha256": _file_sha256(source)}


def repair(output_dir, raw_dir, network_cache_root, context_cache_root, approval_path):
    output_dir = Path(output_dir).resolve()
    raw_dir = Path(raw_dir).resolve()
    approval = read_approval(approval_path)
    print("[repair] loading current full inventory and validating approval", flush=True)
    binding = build_full_map_set(raw_dir)
    department_label_source = _department_label_provenance()
    recipe = network_recipe()
    approval_adapter = NetworkAdapter(raw_dir, cache_root=network_cache_root,
        context_cache_root=context_cache_root, read_only_source_cache=True)
    renderer, current_members = _approval_gate(approval, recipe, approval_adapter, binding, output_dir)

    manifest_path, qa_path = output_dir / "full-manifest.json", output_dir / "full-qa.json"
    old_manifest, old_qa = _read_json(manifest_path), _read_json(qa_path)
    if old_manifest.get("scope") != "full":
        raise ValueError("existing manifest is not a full production batch")
    if old_qa.get("status") != "passed" or old_qa.get("production_status") not in {
            "awaiting-human-spot-check", "complete"}:
        raise ValueError("existing full batch must have passed automated QA before repair")
    if old_manifest.get("authoritative_inputs") != approval_adapter.input_identity():
        raise ValueError("authoritative production inputs differ from the existing full batch")
    old_records = _verified_records(old_manifest, output_dir)
    cache_path = output_dir / ".production-manifest.json"
    if not cache_path.is_file():
        raise ValueError("production output cache is missing; refusing title repair without its full-batch records")
    old_cache = _read_json(cache_path)
    cached_outputs = _verified_output_cache(old_cache, old_records)
    current_expected = {
        (feature["territory"]["kind"], feature["territory"]["code"], feature["mode"], profile)
        for features in binding.map_set.layers.values() for feature in features
        for profile in ("inspection", "inline")
    }
    if set(old_records) != current_expected:
        raise ValueError("existing artifact matrix differs from the current full inventory")
    subset, selected = _department_inspection_binding(binding)
    target_keys = {(feature["territory"]["kind"], feature["territory"]["code"],
                    feature["mode"], "inspection") for feature in selected}
    changes = sorted(key for key in target_keys if key in old_records and
        old_records[key].get("territory", {}).get("name") != next(
            feature["territory"]["name"] for feature in selected
            if (feature["territory"]["kind"], feature["territory"]["code"], feature["mode"], "inspection") == key))
    if not changes or len(changes) != len(target_keys) or any(key not in old_records for key in target_keys):
        raise ValueError("existing batch does not contain the complete department-inspection title-only repair set")
    if any(key[3] != "inspection" for key in changes):
        raise AssertionError("repair selection escaped inspection profile")

    # Build fresh renderer-owned identities against current live inputs, and
    # prove every changed key is exactly the title identity delta.
    department_count = len({(feature["territory"]["kind"], feature["territory"]["code"])
        for feature in selected})
    print(f"[repair] current approval verified; {department_count} departments, "
          f"{len(changes)} title artifacts selected", flush=True)
    with TemporaryDirectory(prefix=".department-title-repair-", dir=output_dir) as scratch:
        stage_root = Path(scratch)
        stage_binding = Binding(subset.family, MapSet(subset.map_set.layers))
        adapter = DepartmentTitleRepairAdapter(raw_dir,
            preparation_binding=binding, shared_output_dir=output_dir,
            cache_root=network_cache_root, context_cache_root=context_cache_root,
            read_only_source_cache=True)
        if adapter.render_identity() != renderer:
            raise ValueError("repair renderer identity differs from the current approval gate")
        result = run_production(recipe, stage_binding, "representative", ("inspection",),
            adapter, stage_root, approval=None)
        rendered = {_record_key(item): item for item in result.outputs}
        if result.qa["status"] != "passed" or set(rendered) != target_keys:
            raise ValueError("staged department title render did not pass complete automated QA")
        geometry_hashes = {}
        for feature in selected:
            key = (feature["territory"]["kind"], feature["territory"]["code"],
                   feature["mode"], "inspection")
            prior_name = old_records[key].get("territory", {}).get("name")
            previous_feature = {**feature, "territory": {**feature["territory"], "name": prior_name}}
            previous_identity = _effective_identity_for(recipe, adapter, renderer,
                previous_feature, PROFILES["inspection"], geometry_hashes)
            inline_key = (*key[:3], "inline")
            current_inline = _effective_identity_for(recipe, adapter, renderer,
                feature, PROFILES["inline"], geometry_hashes)
            if old_records[key].get("effective_identity") != previous_identity:
                raise ValueError(f"prior department inspection identity is not title-only: {key}")
            if old_records[inline_key].get("effective_identity") != current_inline:
                raise ValueError(f"inline identity unexpectedly differs from current inventory: {inline_key}")
            if rendered[key]["effective_identity"] == previous_identity:
                raise ValueError(f"department inspection identity did not change as expected: {key}")
        for key in changes:
            if rendered[key]["effective_identity"] == old_records[key]["effective_identity"]:
                raise ValueError(f"staged title identity does not differ from prior output: {key}")

        # Put verified promotion candidates beside their final files so the
        # eventual os.replace is atomic even when the system temp volume differs.
        candidates = {}
        try:
            for key in changes:
                final = Path(old_records[key]["path"])
                candidate = final.with_name(f".{final.stem}-{uuid4().hex}.repair.stage{final.suffix}")
                shutil.copy2(rendered[key]["path"], candidate)
                if _file_sha256(candidate) != rendered[key]["output_sha256"]:
                    raise ValueError(f"same-volume staged copy hash mismatch: {key}")
                candidates[key] = candidate
        except Exception:
            for candidate in candidates.values():
                candidate.unlink(missing_ok=True)
            raise

        # Preserve original full evidence before any canonical artifact changes.
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        evidence_dir = output_dir / "repair-evidence" / f"department-titles-{stamp}"
        evidence_dir.mkdir(parents=True, exist_ok=False)
        shutil.copy2(manifest_path, evidence_dir / "full-manifest.json")
        shutil.copy2(qa_path, evidence_dir / "full-qa.json")
        for key in changes:
            shutil.copy2(old_records[key]["path"], evidence_dir / Path(old_records[key]["path"]).name)

        journal = {"status": "promotion-incomplete", "targets": [list(key) for key in changes],
            "evidence_directory": str(evidence_dir), "started_at": stamp}
        journal_path = output_dir / "department-title-repair-journal.json"
        _write_json_atomic(journal_path, journal)
        incomplete_qa = dict(old_qa)
        incomplete_qa["status"] = "incomplete"
        incomplete_qa["production_status"] = "incomplete-repair-in-progress"
        incomplete_qa["repair"] = {"status": "promotion-incomplete",
            "changed_artifact_count": len(changes), "evidence_directory": str(evidence_dir)}
        _write_json_atomic(qa_path, incomplete_qa)
        promoted = []
        try:
            for key in changes:
                prior = old_records[key]
                final = Path(prior["path"])
                final.parent.mkdir(parents=True, exist_ok=True)
                os.replace(candidates[key], final)
                promoted.append((key, final))
                row = dict(rendered[key])
                row["path"] = str(final)
                row["repair_provenance"] = {"approval_file": str(Path(approval_path).resolve()),
                    "approval_identity": approval.get("approval_identity"),
                    "current_renderer_identity": renderer,
                    "current_representative_members": current_members,
                    "prior_output_sha256": prior["output_sha256"],
                    "evidence_directory": str(evidence_dir)}
                old_records[key] = row

            full_manifest = dict(old_manifest)
            full_manifest["outputs"] = [old_records[_record_key(row)] for row in old_manifest["outputs"]]
            current_expected_rows = {row["key"]: row for row in old_manifest["expected_outputs"]}
            for key in changes:
                cache_key = "/".join(key)
                expected_row = dict(current_expected_rows[cache_key])
                expected_row["territory"] = old_records[key]["territory"]
                current_expected_rows[cache_key] = expected_row
            full_manifest["expected_outputs"] = [
                current_expected_rows[row["key"]] for row in old_manifest["expected_outputs"]]
            approval_members = sorted((row["territory"]["kind"], row["territory"]["code"],
                row["mode"], row["profile"], row["effective_identity"])
                for row in full_manifest["outputs"])
            full_manifest["approval_members"] = approval_members
            full_manifest["approval_identity"] = sha256(json.dumps(
                approval_members, separators=(",", ":")).encode()).hexdigest()
            full_manifest["repair_provenance"] = {"type": "department-inspection-title-only",
                "approval_file": str(Path(approval_path).resolve()),
                "approval_identity": approval.get("approval_identity"),
                "current_renderer_identity": renderer,
                "current_representative_members": current_members,
                "department_label_source": department_label_source,
                "changed_outputs": [old_records[key] for key in changes],
                "evidence_directory": str(evidence_dir), "timestamp": stamp}
            full_qa = dict(old_qa)
            full_qa["artifact_count"] = len(full_manifest["outputs"])
            full_qa["expected_artifact_count"] = len(full_manifest["expected_outputs"])
            full_qa["repair"] = {"status": "automated-passed-human-review-pending",
                "changed_artifact_count": len(changes), "changed_artifacts": [old_records[key] for key in changes],
                "evidence_directory": str(evidence_dir), "approval_identity": approval.get("approval_identity"),
                "department_label_source": department_label_source}
            full_qa["production_status"] = "awaiting-human-spot-check"
            full_qa["human_spot_check"] = {"status": "pending", "review_set": [old_records[key] for key in changes], "outcome": None}
            if "expected_outputs" in old_qa:
                full_qa["expected_outputs"] = full_manifest["expected_outputs"]
            _write_json_atomic(manifest_path, full_manifest)
            for key in changes:
                row = old_records[key]
                cache_key = "/".join(key)
                prior_cache_row = cached_outputs[cache_key]
                cached_outputs[cache_key] = {**prior_cache_row, "path": row["path"],
                    "effective_identity": row["effective_identity"],
                    "output_sha256": row["output_sha256"]}
            _write_json_atomic(cache_path, old_cache)
            journal.update({"status": "complete-awaiting-human-review",
                "completed_at": datetime.now(timezone.utc).isoformat()})
            _write_json_atomic(journal_path, journal)
            # This is the final success transition. Until manifest, cache, and
            # journal are durable, full QA remains explicitly incomplete.
            _write_json_atomic(qa_path, full_qa)
        except Exception as error:
            for candidate in candidates.values():
                candidate.unlink(missing_ok=True)
            incomplete_qa["status"] = "incomplete"
            incomplete_qa["production_status"] = "incomplete-repair-promotion"
            incomplete_qa["repair"] = {"status": "promotion-incomplete",
                "changed_artifact_count": len(changes), "evidence_directory": str(evidence_dir),
                "error": f"{type(error).__name__}: {error}"}
            try:
                _write_json_atomic(qa_path, incomplete_qa)
            except Exception as qa_error:
                error = RuntimeError(f"could not persist incomplete QA status: {qa_error}; original failure: {error}")
            journal.update({"status": "promotion-incomplete", "error": f"{type(error).__name__}: {error}",
                "promoted": [str(path) for _, path in promoted],
                "recovery": "Do not treat full batch as passed. Restore originals from evidence_directory or rerun this operator after inspection."})
            _write_json_atomic(journal_path, journal)
            raise RuntimeError(f"department-title repair promotion incomplete; recovery evidence: {evidence_dir}") from error
    print(f"[repair] staged QA passed; promoted {len(changes)} outputs. Human title spot-check remains pending.", flush=True)
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--approval", type=Path, required=True,
        help="current affirmative human approval JSON; never created by this command")
    parser.add_argument("--output-dir", type=Path, default=ROOT / "pipeline/maps/production/output")
    parser.add_argument("--raw-dir", type=Path, default=ROOT / "pipeline/data/raw")
    parser.add_argument("--network-cache-root", type=Path,
        default=ROOT / "pipeline/maps/.cache/network-sources")
    parser.add_argument("--context-cache-root", type=Path,
        default=ROOT / "pipeline/maps/production/output/.stage-cache/official-context")
    args = parser.parse_args()
    app = QgsApplication([], False)
    app.initQgis()
    try:
        return repair(args.output_dir, args.raw_dir, args.network_cache_root,
                      args.context_cache_root, args.approval)
    finally:
        app.exitQgis()


if __name__ == "__main__":
    raise SystemExit(main())
