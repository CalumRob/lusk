"""Fail-closed decision for replacing a previously published R2 artifact."""
from collections.abc import Mapping
from hashlib import sha256
import json
from pathlib import Path
import re


_SHA256 = re.compile(r"^[0-9a-f]{64}$")


def _expected_identity(item: Mapping, sha_key: str, bytes_key: str) -> tuple[str, int]:
    digest = item.get(sha_key)
    size = item.get(bytes_key)
    if not isinstance(digest, str) or not _SHA256.fullmatch(digest):
        raise ValueError(f"replacement item requires a valid {sha_key}")
    if isinstance(size, bool) or not isinstance(size, int) or size < 0:
        raise ValueError(f"replacement item requires a non-negative {bytes_key}")
    return digest, size


def _remote_identity(response: Mapping) -> tuple[str | None, int | None, str]:
    metadata = response.get("Metadata", {})
    if not isinstance(metadata, Mapping):
        metadata = {}
    digest = metadata.get("sha256")
    if not isinstance(digest, str):
        digest = None
    size = response.get("ContentLength")
    if isinstance(size, bool) or not isinstance(size, int):
        size = None
    content_type = str(response.get("ContentType", "")).split(";", 1)[0].strip().lower()
    return digest, size, content_type


def replacement_action(remote: Mapping | None, item: Mapping) -> str:
    """Return ``replace`` or ``skip``; reject missing, unknown, or drifted objects.

    An existing object is replaced only when its R2 SHA metadata, byte length,
    and media type still match the explicitly recorded previous artifact. A
    retry is idempotent when the remote object already matches the new artifact.
    """
    if not isinstance(item, Mapping):
        raise ValueError("replacement item must be an object")
    previous_sha, previous_size = _expected_identity(
        item, "expected_previous_sha256", "expected_previous_bytes")
    output_sha256 = item.get("output_sha256")
    upload_sha256 = item.get("sha256")
    if output_sha256 is not None and upload_sha256 is not None and output_sha256 != upload_sha256:
        raise ValueError("replacement item SHA-256 aliases disagree")
    new_sha, new_size = _expected_identity(
        {**item, "output_sha256": output_sha256 if output_sha256 is not None else upload_sha256},
        "output_sha256", "bytes")
    if remote is None:
        raise ValueError("expected prior R2 object is missing")
    if not isinstance(remote, Mapping):
        raise ValueError("R2 HEAD response is invalid")

    remote_sha, remote_size, remote_type = _remote_identity(remote)
    if remote_type != "image/webp":
        raise ValueError("R2 object content type is unknown or is not image/webp")
    if (remote_sha, remote_size) == (new_sha, new_size):
        return "skip"
    if (remote_sha, remote_size) == (previous_sha, previous_size):
        return "replace"
    raise ValueError("existing R2 object does not match expected previous or new artifact")


def replacement_if_match(remote: Mapping, item: Mapping) -> str:
    """Return the remote ETag for an atomic conditional PutObject replacement."""
    if replacement_action(remote, item) != "replace":
        raise ValueError("conditional replacement requires the expected previous R2 object")
    etag = remote.get("ETag")
    if not isinstance(etag, str) or not etag.strip() or etag.strip().startswith("W/"):
        raise ValueError("expected previous R2 object has no strong ETag for conditional replacement")
    return etag.strip()


def _artifact_key(item: Mapping) -> str:
    territory = item.get("territory")
    if not isinstance(territory, Mapping):
        raise ValueError("artifact is missing territory identity")
    parts = (territory.get("kind"), territory.get("code"), item.get("mode"), item.get("profile"))
    if any(not isinstance(part, str) or not part for part in parts):
        raise ValueError("artifact has an incomplete territory/mode/profile identity")
    return "/".join(parts)


def _read_json(path: Path, label: str) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"could not read {label}: {path}") from error
    if not isinstance(value, dict):
        raise ValueError(f"{label} must contain a JSON object")
    return value


def _index_outputs(manifest: Mapping, label: str) -> dict[str, Mapping]:
    outputs = manifest.get("outputs")
    if not isinstance(outputs, list) or not outputs:
        raise ValueError(f"{label} must contain a non-empty outputs list")
    indexed = {}
    for item in outputs:
        if not isinstance(item, Mapping):
            raise ValueError(f"{label} contains an invalid output")
        key = _artifact_key(item)
        if key in indexed:
            raise ValueError(f"{label} contains a duplicate artifact: {key}")
        indexed[key] = item
    return indexed


def _verified_local_identity(item: Mapping, *, digest_key: str, size_key: str, label: str) -> tuple[str, int, Path]:
    digest, size = _expected_identity(item, digest_key, size_key)
    path_value = item.get("path")
    if not isinstance(path_value, str) or not path_value:
        raise ValueError(f"{label} is missing its local path")
    path = Path(path_value)
    try:
        actual_size = path.stat().st_size
        actual_digest = sha256(path.read_bytes()).hexdigest()
    except OSError as error:
        raise ValueError(f"{label} is missing: {path}") from error
    if (actual_digest, actual_size) != (digest, size):
        raise ValueError(f"{label} no longer matches its manifest: {path}")
    return digest, size, path


def build_replacement_plan(previous_manifest_path, candidate_manifest_path, qa_path, *,
                           prefix: str = "maps/v1/") -> dict:
    """Bind a QA-passed inspection refresh to its exact previous published files.

    This prepares a replacement-only upload plan; it does not contact R2 and it
    does not authorize an upload. The upload operator must still record an
    affirmative human spot check against the candidate QA report.
    """
    if (not isinstance(prefix, str) or not re.fullmatch(r"[A-Za-z0-9._/-]+/?", prefix)
            or prefix.startswith("/") or ".." in prefix.split("/")):
        raise ValueError("replacement prefix must be a simple relative object-key prefix")
    previous_path = Path(previous_manifest_path).resolve()
    candidate_path = Path(candidate_manifest_path).resolve()
    qa_file = Path(qa_path).resolve()
    previous_manifest = _read_json(previous_path, "previous full manifest")
    candidate_manifest = _read_json(candidate_path, "inspection-refresh manifest")
    qa = _read_json(qa_file, "inspection-refresh QA report")
    if candidate_manifest.get("family") != "network" or candidate_manifest.get("scope") != "inspection-refresh":
        raise ValueError("candidate manifest must be a network inspection-refresh run")
    if qa.get("status") != "passed" or qa.get("failures"):
        raise ValueError("replacement plan requires passed artifact QA with no failures")

    previous = _index_outputs(previous_manifest, "previous manifest")
    candidates = _index_outputs(candidate_manifest, "candidate manifest")
    if any(item.get("profile") != "inspection" for item in candidates.values()):
        raise ValueError("candidate manifest may contain only inspection artifacts")
    candidate_keys = set(candidates)
    if any(key not in previous for key in candidate_keys):
        raise ValueError("a candidate artifact has no corresponding previous published artifact")

    expected_count = len(candidates)
    if (qa.get("artifact_count") != expected_count
            or qa.get("expected_artifact_count") != expected_count
            or qa.get("profile_counts") != {"inspection": expected_count}):
        raise ValueError("candidate QA coverage does not match the replacement artifact set")
    qa_outputs = qa.get("expected_outputs")
    if not isinstance(qa_outputs, list):
        raise ValueError("candidate QA report is missing expected-output coverage")
    qa_keys = set()
    for item in qa_outputs:
        if not isinstance(item, Mapping):
            raise ValueError("candidate QA expected-output row is invalid")
        key = _artifact_key(item)
        if key in qa_keys:
            raise ValueError(f"candidate QA contains a duplicate expected output: {key}")
        qa_keys.add(key)
    if qa_keys != candidate_keys:
        raise ValueError("candidate QA expected outputs do not match the manifest")

    entries = []
    for key in sorted(candidate_keys):
        candidate = candidates[key]
        previous_item = previous[key]
        if (candidate.get("family") not in (None, "network")
                or candidate.get("mode") not in {"car", "walk", "bike"}):
            raise ValueError(f"candidate is not a network map: {key}")
        new_sha, new_size, new_path = _verified_local_identity(
            candidate, digest_key="output_sha256", size_key="bytes", label=f"candidate artifact {key}")
        old_sha, old_size, _old_path = _verified_local_identity(
            previous_item, digest_key="output_sha256", size_key="bytes", label=f"previous artifact {key}")
        filename = new_path.name
        expected_filename = f"{candidate['territory']['code']}-{candidate['mode']}-inspection.webp"
        if filename != expected_filename:
            raise ValueError(f"candidate path does not match its canonical object name: {key}")
        entries.append({
            "territory": candidate["territory"],
            "mode": candidate["mode"],
            "profile": "inspection",
            "path": str(new_path),
            "filename": filename,
            "output_sha256": new_sha,
            "bytes": new_size,
            "expected_previous_sha256": old_sha,
            "expected_previous_bytes": old_size,
            "content_type": "image/webp",
        })

    return {
        "schema": 1,
        "mode": "replace",
        "status": "pending-human-spot-check",
        "prefix": prefix,
        "previous_manifest": str(previous_path),
        "previous_manifest_sha256": sha256(previous_path.read_bytes()).hexdigest(),
        "candidate_manifest": str(candidate_path),
        "candidate_manifest_sha256": sha256(candidate_path.read_bytes()).hexdigest(),
        "qa_path": str(qa_file),
        "outputs": entries,
    }


def validate_replacement_plan(plan: Mapping) -> list[dict]:
    """Rebuild and compare a saved plan before the uploader makes any request."""
    if not isinstance(plan, Mapping) or plan.get("schema") != 1 or plan.get("mode") != "replace":
        raise ValueError("replacement plan has an unsupported schema or mode")
    try:
        rebuilt = build_replacement_plan(
            plan["previous_manifest"], plan["candidate_manifest"], plan["qa_path"],
            prefix=plan["prefix"],
        )
    except (KeyError, TypeError) as error:
        raise ValueError("replacement plan is missing source provenance") from error
    if dict(plan) != rebuilt:
        raise ValueError("replacement plan does not match its source manifests")
    return rebuilt["outputs"]


def select_replacement_retry_items(items, publication_manifest: Mapping, upload_log_path, *,
                                   prefix: str) -> tuple[list[dict], dict]:
    """Keep only previously published, not-yet-completed replacement candidates.

    The old publication manifest is the source of truth for intentionally
    omitted objects. The interrupted upload log is trusted only for entries
    whose destination key, new hash, and size still match this plan. A failure
    on a publishable object aborts selection rather than being silently retried.
    """
    if not isinstance(publication_manifest, Mapping):
        raise ValueError("publication manifest must be an object")
    selected_rows = publication_manifest.get("outputs")
    skipped_rows = publication_manifest.get("skipped")
    if not isinstance(selected_rows, list) or not isinstance(skipped_rows, list):
        raise ValueError("publication manifest must declare outputs and skipped lists")

    def index_rows(rows, label):
        indexed = {}
        for row in rows:
            if not isinstance(row, Mapping):
                raise ValueError(f"publication manifest {label} contains an invalid item")
            filename = row.get("filename")
            if not isinstance(filename, str) or not filename:
                raise ValueError(f"publication manifest {label} item is missing its filename")
            if filename in indexed:
                raise ValueError(f"publication manifest {label} contains duplicate filename {filename}")
            indexed[filename] = row
        return indexed

    publishable = index_rows(selected_rows, "outputs")
    intentionally_skipped = index_rows(skipped_rows, "skipped")
    overlap = set(publishable) & set(intentionally_skipped)
    if overlap:
        raise ValueError(f"publication manifest both selects and skips {sorted(overlap)}")

    by_filename = {}
    for item in items:
        if not isinstance(item, Mapping):
            raise ValueError("replacement selection contains an invalid upload item")
        filename = item.get("filename")
        if not isinstance(filename, str) or not filename or filename in by_filename:
            raise ValueError(f"replacement selection has a missing or duplicate filename: {filename!r}")
        if item.get("key") != f"{prefix.rstrip('/')}/{filename}":
            raise ValueError(f"replacement key does not match its filename/prefix: {filename}")
        if filename not in publishable and filename not in intentionally_skipped:
            raise ValueError(f"replacement candidate has no publication-selection record: {filename}")

        prior = publishable.get(filename, intentionally_skipped.get(filename))
        expected_sha, expected_size = _expected_identity(
            item, "expected_previous_sha256", "expected_previous_bytes")
        prior_sha, prior_size = _expected_identity(prior, "output_sha256", "bytes")
        if (prior_sha, prior_size) != (expected_sha, expected_size):
            raise ValueError(f"publication selection's previous identity differs for {filename}")
        by_filename[filename] = item

    unpublished = set(by_filename) & set(intentionally_skipped)
    publishable_candidates = set(by_filename) & set(publishable)
    completed = set()
    expected_missing = set()
    seen_log_keys = set()
    if upload_log_path is None:
        lines = []
    else:
        log_path = Path(upload_log_path)
        try:
            lines = log_path.read_text(encoding="utf-8").splitlines()
        except OSError as error:
            raise ValueError(f"could not read interrupted upload log: {log_path}") from error

    for line_number, line in enumerate(lines, start=1):
        if not line.strip():
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError as error:
            raise ValueError(f"invalid JSON in upload log at line {line_number}") from error
        if not isinstance(event, Mapping):
            raise ValueError(f"invalid upload event at line {line_number}")
        key = event.get("key")
        if not isinstance(key, str) or not key.startswith(prefix.rstrip("/") + "/"):
            raise ValueError(f"upload log contains an unexpected object key at line {line_number}")
        filename = key.rsplit("/", 1)[-1]
        item = by_filename.get(filename)
        if item is None or item.get("key") != key:
            raise ValueError(f"upload log key is outside this replacement set: {key}")
        if key in seen_log_keys:
            raise ValueError(f"upload log has more than one result for {key}")
        seen_log_keys.add(key)
        if (event.get("sha256") != item.get("sha256")
                or event.get("bytes") != item.get("bytes")):
            raise ValueError(f"upload log identity differs from the current candidate: {key}")

        result = event.get("result")
        if result in {"uploaded", "skipped"}:
            if filename in unpublished:
                raise ValueError(f"intentionally excluded object was uploaded: {key}")
            completed.add(filename)
        elif result == "failed":
            if (filename not in unpublished
                    or event.get("detail") != "ValueError: expected prior R2 object is missing"):
                raise ValueError(f"upload failed for a previously publishable object: {key}")
            expected_missing.add(filename)
        else:
            raise ValueError(f"upload log has an unknown result for {key}: {result!r}")

    retry_items = [by_filename[name] for name in sorted(publishable_candidates - completed)]
    summary = {
        "candidate_count": len(by_filename),
        "unpublished_excluded": len(unpublished),
        "already_complete_excluded": len(completed),
        "expected_missing_excluded": len(expected_missing),
        "remaining": len(retry_items),
    }
    return retry_items, summary
