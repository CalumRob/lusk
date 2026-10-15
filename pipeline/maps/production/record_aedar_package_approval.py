"""Record a human decision for one exact, already-staged AEDAR package."""
from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
from uuid import uuid4

from upload_maps import sha256
from webp_encoding import WEBP_ENCODING_CONTRACT, validate_webp

HERE = Path(__file__).resolve().parent
RECORD_NAME = "human-approval.json"
SCHEMA = "lusk.aedar.package-approval.v1"
QA_HISTORY = Path("evidence/human-approval")


def _json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def _atomic_bytes(path: Path, payload: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    staged = path.with_name(f".{path.name}-{uuid4().hex}.tmp")
    try:
        staged.write_bytes(payload)
        os.replace(staged, path)
    finally:
        staged.unlink(missing_ok=True)


def _canonical_bytes(value: dict) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def _validate_artifact(package: Path, row: dict, config: dict) -> Path:
    filename = row.get("filename", "")
    path = (package / filename).resolve(strict=True)
    if path.parent != package or path.name != filename:
        raise ValueError("AEDAR artifact path escapes selected package")
    if path.stat().st_size != row.get("bytes") or sha256(path) != row.get("output_sha256"):
        raise ValueError(f"AEDAR artifact changed: {filename}")
    profile_name = row.get("profile")
    spec = config["profiles"].get(profile_name)
    if spec is None:
        raise ValueError(f"Unknown AEDAR profile: {profile_name}")
    contract = {**WEBP_ENCODING_CONTRACT, "dimensions": spec["size"],
        "alpha": "lossless" if spec["transparent_outside"] else "opaque-rgb"}
    if row.get("artifact_contract") != contract or row.get("profile_size") != spec["size"]:
        raise ValueError(f"AEDAR native WebP contract mismatch: {filename}")
    validate_webp(path, type("Profile", (), {"name": profile_name, "size": tuple(spec["size"]),
        "transparent_outside": spec["transparent_outside"]})())
    return path


def _validate_plan_evidence(package: Path, full: dict, config: dict) -> set[tuple[str, str]]:
    evidence = package / "evidence"
    plan_path = evidence / "full-plan.json"
    if not plan_path.is_file() or sha256(plan_path) != full.get("source_plan_sha256"):
        raise ValueError("AEDAR source plan evidence is missing or changed")
    plan = _json(plan_path)
    territories = {}
    for item in plan.get("territories", []):
        territory = item.get("territory", {})
        ident = (territory.get("kind"), territory.get("code"))
        if not all(ident) or ident in territories:
            raise ValueError("AEDAR staged source plan has duplicate/invalid territories")
        territories[ident] = territory
    if (not territories or plan.get("territory_count") != len(territories)
            or plan.get("expected_webps") != len(territories) * len(config["modes"]) * len(config["profiles"])):
        raise ValueError("AEDAR source plan expected territory/artifact counts disagree")
    missing = plan.get("skipped_no_address_facts", [])
    omissions = {(item.get("kind"), item.get("code")) for item in missing}
    if (len(omissions) != len(missing) or any(not all(item) for item in omissions)
            or set(territories).intersection(omissions)):
        raise ValueError("AEDAR source plan omissions are duplicate or overlap staged territories")
    full_missing = full.get("missing_territories", [])
    if ({(item.get("kind"), item.get("code")) for item in full_missing} != omissions
            or len(full_missing) != len(missing)):
        raise ValueError("AEDAR package omissions differ from bound source plan")

    declared_workers = full.get("source_workers")
    shards = plan.get("shards")
    if not isinstance(declared_workers, list) or len(declared_workers) != len(shards):
        raise ValueError("AEDAR worker evidence does not cover the source plan shards")
    shard_indexes = [index for shard in shards for index in shard]
    if sorted(shard_indexes) != list(range(len(territories))):
        raise ValueError("AEDAR source plan shard allocation is incomplete")
    source_names = set()
    source_rows = {}
    for index, worker in enumerate(declared_workers):
        for file_field, hash_field in (("manifest", "sha256"), ("qa", "qa_sha256")):
            name = worker.get(file_field)
            path = evidence / str(name)
            if (not name or name in source_names or not path.is_file()
                    or sha256(path) != worker.get(hash_field)):
                raise ValueError("AEDAR worker evidence is missing, duplicated or changed")
            source_names.add(name)
        manifest, qa = _json(evidence / worker["manifest"]), _json(evidence / worker["qa"])
        if qa.get("status") != "passed" or qa.get("failures"):
            raise ValueError("AEDAR source worker QA is not passed")
        outputs = manifest.get("outputs", [])
        expected_territories = {tuple(plan["territories"][i]["territory"][key] for key in ("kind", "code"))
            for i in shards[index]}
        worker_identities = {(row.get("territory", {}).get("kind"), row.get("territory", {}).get("code"),
            row.get("mode"), row.get("profile")) for row in outputs}
        if (len(outputs) != qa.get("artifact_count") or len(outputs) != qa.get("expected_artifact_count")
                or len(outputs) != len(worker_identities)
                or len(outputs) != len(expected_territories) * len(config["modes"]) * len(config["profiles"])):
            raise ValueError("AEDAR worker manifest/QA coverage disagrees")
        if {(row.get("territory", {}).get("kind"), row.get("territory", {}).get("code")) for row in outputs} != expected_territories:
            raise ValueError("AEDAR worker evidence territory coverage disagrees with its shard")
        for row in outputs:
            name = Path(row.get("path", "")).name
            if name in source_rows:
                raise ValueError("Duplicate artifact in AEDAR worker evidence")
            source_rows[name] = row
    return set(territories), source_rows


def _validate_inventory(package: Path, full: dict, upload: dict, qa: dict, config: dict) -> None:
    territories, source_rows = _validate_plan_evidence(package, full, config)
    rows, selected = full.get("outputs"), upload.get("outputs")
    expected_names = {config["filename_template"].format(code=code, mode=mode, profile=profile)
        for _, code in territories for mode in config["modes"] for profile in config["profiles"]}
    if (not isinstance(rows, list) or not isinstance(selected, list)
            or len(rows) != len(expected_names) or len(selected) != len(expected_names)
            or len(rows) != qa.get("artifact_count") or len(rows) != qa.get("expected_artifact_count")
            or upload.get("upload_count") != len(expected_names)):
        raise ValueError("AEDAR manifests/QA do not cover the complete staged territory matrix")
    keys, identities, rows_by_name = set(), set(), {}
    profile_counts = Counter()
    for row in rows:
        territory = row.get("territory", {})
        ident = (territory.get("kind"), territory.get("code"))
        identity = (*ident, row.get("mode"), row.get("profile"))
        filename = row.get("filename", "")
        expected = config["filename_template"].format(code=ident[1], mode=row.get("mode"), profile=row.get("profile")) if all(ident) else ""
        key = config["prefix"] + expected
        if (ident not in territories or row.get("family") != config["family"]
                or row.get("mode") not in config["modes"] or row.get("profile") not in config["profiles"]
                or filename != expected or identity in identities or row.get("key") != key or key in keys):
            raise ValueError("Wrong, duplicate, aliased or out-of-plan AEDAR inventory member")
        identities.add(identity); keys.add(key); rows_by_name[filename] = row
        profile_counts[row["profile"]] += 1
        source = source_rows.get(filename)
        if (not source or source.get("territory") != territory or source.get("mode") != row.get("mode")
                or source.get("profile") != row.get("profile") or source.get("bytes") != row.get("bytes")
                or source.get("output_sha256") != row.get("output_sha256")):
            raise ValueError("AEDAR full manifest differs from preserved worker evidence")
        _validate_artifact(package, row, config)
    if set(rows_by_name) != expected_names or len(identities) != len(expected_names):
        raise ValueError("AEDAR mode/profile matrix is incomplete")
    if qa.get("profile_counts") != dict(profile_counts):
        raise ValueError("AEDAR QA profile counts do not match complete source-plan inventory")
    omissions = full.get("missing_territories", [])
    omission_ids = {(item.get("kind"), item.get("code")) for item in omissions}
    if ({(item.get("kind"), item.get("code")) for item in qa.get("missing_territories", [])} != omission_ids
            or {(item.get("kind"), item.get("code")) for item in upload.get("missing_territories", [])} != omission_ids):
        raise ValueError("AEDAR omission reports disagree")
    selected_keys = [entry.get("key") for entry in selected]
    if len(set(selected_keys)) != len(selected_keys) or set(selected_keys) != keys:
        raise ValueError("Upload manifest selection is partial, duplicated or unrelated")
    for entry in selected:
        row = rows_by_name.get(entry.get("filename"))
        if not row or any(entry.get(field) != row.get(field) for field in
                ("key", "bytes", "output_sha256", "content_type", "path")):
            raise ValueError("Upload manifest artifact differs from full manifest")


def _validate_package(package_dir: Path, reviewer: str, outcome: str):
    package = package_dir.resolve(strict=True)
    config = _json(HERE / "aedar-static-family.json")
    full_path, upload_path, qa_path = (package / filename for filename in
        ("full-manifest.json", "upload-manifest.json", "full-qa.json"))
    full, upload, qa = _json(full_path), _json(upload_path), _json(qa_path)
    full_hash, upload_hash, qa_hash = sha256(full_path), sha256(upload_path), sha256(qa_path)
    if full.get("family") != config["family"] or upload.get("family") != config["family"]:
        raise ValueError("Selected package is not an AEDAR package")
    if (upload.get("prefix") != config["prefix"] or upload.get("bucket") != config["bucket"]
            or upload.get("endpoint") != config.get("endpoint", upload.get("endpoint"))):
        raise ValueError("AEDAR upload namespace/bucket does not match registered contract")
    if full.get("family_config_sha256") != sha256(HERE / "aedar-static-family.json"):
        raise ValueError("AEDAR package uses a different registered family contract")
    if upload.get("source_manifest_sha256") != full_hash or qa.get("source_manifest_sha256") != full_hash:
        raise ValueError("Full manifest, upload manifest and QA bindings do not match")
    if qa.get("status") != "passed" or qa.get("failures") or not qa.get("checks"):
        raise ValueError("AEDAR technical QA must be nonempty and passed")
    _validate_inventory(package, full, upload, qa, config)

    record_path = package / RECORD_NAME
    if record_path.exists():
        record = _json(record_path)
        spot = qa.get("human_spot_check", {})
        bindings = (record.get("schema") == SCHEMA and record.get("full_manifest_sha256") == full_hash
            and record.get("upload_manifest_sha256") == upload_hash and record.get("reviewer") == reviewer
            and record.get("outcome") == outcome)
        if not bindings:
            raise ValueError("Existing record belongs to another reviewer/outcome/snapshot")
        if spot.get("status") == "pending" and qa_hash == record.get("reviewed_qa_sha256"):
            return package, full_hash, upload_hash, qa_hash, qa, record, "recover"
        if (qa_hash != record.get("final_qa_sha256") or spot.get("approval_id") != record.get("approval_id")
                or qa.get("approval_evidence", {}).get("reviewed_qa_sha256") != record.get("reviewed_qa_sha256")):
            raise ValueError("Existing record/QA binding is incomplete or stale")
        return package, full_hash, upload_hash, qa_hash, qa, record, "retry"
    if qa.get("human_spot_check", {}).get("status") != "pending":
        raise ValueError("Package QA is not pending; refusing reapproval")
    return package, full_hash, upload_hash, qa_hash, qa, None, "new"


def _final_qa(qa: dict, record: dict) -> bytes:
    final = dict(qa)
    final["production_status"] = "complete" if record["outcome"] == "approved" else "rejected"
    final["human_spot_check"] = {"status": record["outcome"], "reviewer": record["reviewer"],
        "record": RECORD_NAME, "upload_manifest_sha256": record["upload_manifest_sha256"],
        "approval_id": record["approval_id"]}
    final["approval_evidence"] = {"reviewed_qa_sha256": record["reviewed_qa_sha256"]}
    return _canonical_bytes(final)


def record_package_approval(package_dir: Path, reviewer: str, outcome: str):
    reviewer = reviewer.strip() if isinstance(reviewer, str) else ""
    if not reviewer:
        raise ValueError("Reviewer must be nonempty")
    if outcome not in ("approved", "rejected"):
        raise ValueError("Outcome must be approved or rejected")
    package, full_hash, upload_hash, qa_hash, qa, record, state = _validate_package(Path(package_dir), reviewer, outcome)
    qa_path, record_path = package / "full-qa.json", package / RECORD_NAME
    if state == "retry":
        return record
    if state == "new":
        record = {"schema": SCHEMA, "full_manifest_sha256": full_hash,
            "upload_manifest_sha256": upload_hash, "reviewed_qa_sha256": qa_hash,
            "reviewer": reviewer, "outcome": outcome,
            "recorded_at": datetime.now(timezone.utc).isoformat(timespec="seconds")}
        record["approval_id"] = hashlib.sha256(json.dumps(record, sort_keys=True).encode()).hexdigest()
        final_qa_bytes = _final_qa(qa, record)
        record["final_qa_sha256"] = hashlib.sha256(final_qa_bytes).hexdigest()
        record_bytes = _canonical_bytes(record)
    else:
        final_qa_bytes = _final_qa(qa, record)
        if hashlib.sha256(final_qa_bytes).hexdigest() != record.get("final_qa_sha256"):
            raise ValueError("Interrupted approval final QA cannot be reconstructed")
        record_bytes = _canonical_bytes(record)

    history_path = package / QA_HISTORY / f"full-qa-{qa_hash}.json"
    if history_path.exists() and sha256(history_path) != qa_hash:
        raise ValueError("Conflicting preserved original QA evidence")
    # Record-first is deliberate: QA remains pending until its preserved original
    # bytes exist and the final bound QA promotion has completed.
    if state == "new":
        _atomic_bytes(record_path, record_bytes)
    if not history_path.exists():
        _atomic_bytes(history_path, qa_path.read_bytes())
    _atomic_bytes(qa_path, final_qa_bytes)
    return record


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--package-dir", type=Path, required=True)
    parser.add_argument("--reviewer", required=True)
    parser.add_argument("--outcome", choices=("approved", "rejected"), required=True)
    args = parser.parse_args(argv)
    record = record_package_approval(args.package_dir, args.reviewer, args.outcome)
    print(f"Recorded {record['outcome']} AEDAR package decision ({record['full_manifest_sha256']})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
