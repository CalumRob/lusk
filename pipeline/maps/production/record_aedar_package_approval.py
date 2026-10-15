"""Record an explicit human decision for one immutable AEDAR package snapshot."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
from uuid import uuid4

from package_aedar_maps import read_json, write_json
from upload_maps import sha256
from webp_encoding import validate_webp

HERE = Path(__file__).resolve().parent
RECORD_NAME = "human-approval.json"
SCHEMA = "lusk.aedar.package-approval.v1"


def _atomic_bytes(path: Path, payload: bytes) -> None:
    staged = path.with_name(f".{path.name}-{uuid4().hex}.tmp")
    try:
        staged.write_bytes(payload)
        os.replace(staged, path)
    finally:
        staged.unlink(missing_ok=True)


def _verify_assets(package: Path, full: dict, config: dict) -> None:
    for row in full.get("outputs", []):
        path = (package / row.get("filename", "")).resolve(strict=True)
        if path.parent != package or path.name != row.get("filename"):
            raise ValueError("AEDAR artifact path escapes selected package")
        if path.stat().st_size != row.get("bytes") or sha256(path) != row.get("output_sha256"):
            raise ValueError(f"AEDAR artifact changed: {path.name}")
        spec = config["profiles"].get(row.get("profile"))
        if spec is None:
            raise ValueError("Unknown AEDAR profile in recorded package")
        validate_webp(path, type("Profile", (), {"name": row["profile"], "size": tuple(spec["size"]),
            "transparent_outside": spec["transparent_outside"]})())


def _validate_package(package: Path):
    package = package.resolve(strict=True)
    config = read_json(HERE / "aedar-static-family.json")
    full_path, upload_path, qa_path = (package / name for name in
        ("full-manifest.json", "upload-manifest.json", "full-qa.json"))
    full, upload, qa = read_json(full_path), read_json(upload_path), read_json(qa_path)
    full_hash, upload_hash = sha256(full_path), sha256(upload_path)
    if full.get("family") != config["family"] or upload.get("family") != config["family"]:
        raise ValueError("Selected package is not an AEDAR package")
    if upload.get("prefix") != config["prefix"] or upload.get("bucket") != config["bucket"]:
        raise ValueError("AEDAR upload namespace/bucket does not match registered package contract")
    if full.get("family_config_sha256") != sha256(HERE / "aedar-static-family.json"):
        raise ValueError("AEDAR package uses a different registered family contract")
    evidence = package / "evidence"
    plan_name = "full-plan.json"
    if not (evidence / plan_name).is_file() or sha256(evidence / plan_name) != full.get("source_plan_sha256"):
        raise ValueError("AEDAR source plan evidence is missing or changed")
    for worker in full.get("source_workers", []):
        for filename_key, hash_key in (("manifest", "sha256"), ("qa", "qa_sha256")):
            evidence_name = worker.get(filename_key)
            evidence_hash = worker.get(hash_key)
            if (not evidence_name or not (evidence / evidence_name).is_file()
                    or sha256(evidence / evidence_name) != evidence_hash):
                raise ValueError("AEDAR source worker evidence is missing or changed")
    if upload.get("source_manifest_sha256") != full_hash or qa.get("source_manifest_sha256") != full_hash:
        raise ValueError("Full manifest, upload manifest and QA bindings do not match")
    if qa.get("status") != "passed" or qa.get("failures") or not qa.get("checks"):
        raise ValueError("AEDAR technical QA must be nonempty and passed")
    # A first decision must be against an untouched pending QA snapshot. A retry is
    # permitted only for precisely the same record and final QA bytes.
    existing = package / RECORD_NAME
    qa_bytes = qa_path.read_bytes()
    if existing.exists():
        record = read_json(existing)
        if (record.get("schema") == SCHEMA and record.get("full_manifest_sha256") == full_hash
                and record.get("upload_manifest_sha256") == upload_hash
                and qa.get("human_spot_check", {}).get("status") == "pending"
                and sha256(qa_path) == record.get("reviewed_qa_sha256")):
            _verify_assets(package, full, config)
            # Recover the deliberate record-first interruption window: write the
            # bound QA only when its original pending bytes are still untouched.
            recovered = dict(qa)
            recovered["production_status"] = "complete" if record["outcome"] == "approved" else "rejected"
            recovered["human_spot_check"] = {"status": record["outcome"], "reviewer": record["reviewer"],
                "record": RECORD_NAME, "upload_manifest_sha256": upload_hash,
                "approval_id": record["approval_id"]}
            recovered["approval_evidence"] = {"reviewed_qa_sha256": record["reviewed_qa_sha256"]}
            recovered_bytes = (json.dumps(recovered, ensure_ascii=False, indent=2) + "\n").encode()
            if sha256_bytes(recovered_bytes) != record.get("final_qa_sha256"):
                raise ValueError("Interrupted approval cannot be safely reconstructed")
            _atomic_bytes(qa_path, recovered_bytes)
            return record
        if (record.get("schema") != SCHEMA or record.get("full_manifest_sha256") != full_hash
                or record.get("upload_manifest_sha256") != upload_hash
                or record.get("reviewed_qa_sha256") != qa.get("approval_evidence", {}).get("reviewed_qa_sha256")
                or sha256(qa_path) != record.get("final_qa_sha256")):
            raise ValueError("Existing approval is bound to a different package/QA snapshot; refusing overwrite")
        _verify_assets(package, full, config)
        if qa.get("human_spot_check", {}).get("approval_id") != record.get("approval_id"):
            raise ValueError("Existing approval record/QA binding is incomplete")
        return record
    if qa.get("human_spot_check", {}).get("status") != "pending":
        raise ValueError("Package QA is not pending; refusing reapproval or altered approval")

    rows, selected = full.get("outputs"), upload.get("outputs")
    if not isinstance(rows, list) or not rows or not isinstance(selected, list):
        raise ValueError("AEDAR package inventory is empty or malformed")
    if len(rows) != qa.get("artifact_count") or len(rows) != qa.get("expected_artifact_count"):
        raise ValueError("AEDAR QA counts do not cover the full manifest")
    if upload.get("upload_count") != len(selected) or len(selected) != len(rows):
        raise ValueError("Upload selection is partial or its expected count disagrees")
    planned = set()
    for territory in full.get("territories", []):
        for mode in config["modes"]:
            for profile in config["profiles"]:
                planned.add(config["filename_template"].format(code=territory["code"], mode=mode, profile=profile))
    # The packaged manifest's rows are authoritative; ensure complete mode/profile
    # coverage for each staged territory without assuming a territory universe.
    identities, keys = set(), set()
    expected_keys = set()
    by_name = {}
    for row in rows:
        filename = row.get("filename")
        territory = row.get("territory", {})
        identity = (territory.get("kind"), territory.get("code"), row.get("mode"), row.get("profile"))
        if identity in identities or not all(identity):
            raise ValueError("Duplicate or invalid AEDAR mode/profile inventory")
        identities.add(identity)
        if (row.get("family") != config["family"] or row.get("mode") not in config["modes"]
                or row.get("profile") not in config["profiles"] or not re.fullmatch(r"[0-9]+-[A-Za-z0-9_-]+\.webp", filename or "")):
            raise ValueError("Wrong AEDAR family, mode, profile or filename")
        name = config["filename_template"].format(code=territory["code"], mode=row["mode"], profile=row["profile"])
        key = config["prefix"] + name
        if filename != name or row.get("key") != key or key in keys:
            raise ValueError("AEDAR filename/key namespace alias or duplicate")
        keys.add(key); expected_keys.add(key); by_name[filename] = row
        path = Path(row.get("path", ""))
        if not path.is_absolute(): path = package / path
        path = path.resolve(strict=True)
        try: path.relative_to(package)
        except ValueError as error: raise ValueError("AEDAR artifact path escapes selected package") from error
        if path.parent != package or path.name != filename:
            raise ValueError("AEDAR artifact is not a flat package member")
        if path.stat().st_size != row.get("bytes") or sha256(path) != row.get("output_sha256"):
            raise ValueError(f"AEDAR artifact changed: {filename}")
        spec = config["profiles"][row["profile"]]
        contract = row.get("artifact_contract", {})
        if contract.get("dimensions") != spec["size"] or contract.get("alpha") != ("lossless" if spec["transparent_outside"] else "opaque-rgb"):
            raise ValueError(f"AEDAR native WebP contract mismatch: {filename}")
    expected_count = len({(i[0], i[1]) for i in identities}) * len(config["modes"]) * len(config["profiles"])
    if len(rows) != expected_count:
        raise ValueError("AEDAR mode/profile matrix is incomplete")
    missing = full.get("missing_territories", [])
    if qa.get("missing_territories") != missing or upload.get("missing_territories") != missing:
        raise ValueError("AEDAR omission reports disagree")
    if len({(x.get("kind"), x.get("code")) for x in missing}) != len(missing):
        raise ValueError("Duplicate missing-territory omission")
    selected_keys = [r.get("key") for r in selected]
    if len(set(selected_keys)) != len(selected_keys) or set(selected_keys) != expected_keys:
        raise ValueError("Upload manifest selection is partial, duplicated or unrelated")
    for item in selected:
        row = by_name.get(item.get("filename"))
        if not row or any(item.get(field) != row.get(field) for field in ("key", "bytes", "output_sha256", "content_type")):
            raise ValueError("Upload manifest artifact differs from exact full manifest")
    if existing.exists():
        raise ValueError("Approval record already exists")
    return (package, full_hash, upload_hash, sha256(qa_path), qa, qa_bytes)


def record_package_approval(package_dir: Path, reviewer: str, outcome: str):
    if not reviewer or not reviewer.strip(): raise ValueError("Reviewer must be nonempty")
    if outcome not in ("approved", "rejected"): raise ValueError("Outcome must be approved or rejected")
    validated = _validate_package(Path(package_dir))
    if isinstance(validated, dict):
        if validated.get("reviewer") != reviewer.strip() or validated.get("outcome") != outcome:
            raise ValueError("Existing decision belongs to another reviewer/outcome; refusing reapproval")
        return validated
    package, full_hash, upload_hash, reviewed_qa_hash, qa, _ = validated
    qa_path, record_path = package / "full-qa.json", package / RECORD_NAME
    final_qa = dict(qa)
    final_qa["production_status"] = "complete" if outcome == "approved" else "rejected"
    final_qa["human_spot_check"] = {"status": outcome, "reviewer": reviewer.strip(),
        "record": RECORD_NAME, "upload_manifest_sha256": upload_hash}
    record = {"schema": SCHEMA, "full_manifest_sha256": full_hash,
        "upload_manifest_sha256": upload_hash, "reviewed_qa_sha256": reviewed_qa_hash,
        "reviewer": reviewer.strip(),
        "outcome": outcome, "recorded_at": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    record["approval_id"] = sha256_bytes(json.dumps(record, sort_keys=True).encode())
    final_qa["human_spot_check"]["approval_id"] = record["approval_id"]
    final_qa["approval_evidence"] = {"reviewed_qa_sha256": reviewed_qa_hash}
    final_bytes = (json.dumps(final_qa, ensure_ascii=False, indent=2) + "\n").encode()
    record["final_qa_sha256"] = sha256_bytes(final_bytes)
    record_bytes = (json.dumps(record, ensure_ascii=False, indent=2) + "\n").encode()
    # Write record first. Until QA is replaced with the exact bound bytes, gates fail closed.
    _atomic_bytes(record_path, record_bytes)
    _atomic_bytes(qa_path, final_bytes)
    return record


def sha256_bytes(data: bytes) -> str:
    import hashlib
    return hashlib.sha256(data).hexdigest()


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
