#!/usr/bin/env python3
"""Upload only the approved manifest selection of production WebP maps to Cloudflare R2."""

from __future__ import annotations

import argparse
import configparser
import getpass
import hashlib
import json
import os
import re
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

PRODUCTION = Path(__file__).resolve().parent
OUT = PRODUCTION / "output"
sys.path.insert(0, str(PRODUCTION))
from r2_replacement import (
    replacement_action,
    replacement_if_match,
    select_replacement_retry_items,
    validate_replacement_plan,
)

MANIFEST = OUT / "upload-manifest.json"
FULL_MANIFEST = OUT / "full-manifest.json"
FULL_QA = OUT / "full-qa.json"
BUCKET = "lusk"
ENDPOINT = "https://a415446644e310791560c019dc9b0fd8.r2.cloudflarestorage.com"
PUBLIC_BASE = "https://images.calumrobertson.fr"
PROFILE = "lusk-r2"
DEFAULT_PREFIX = "maps/v1/"
WORKERS = 8


def configure_output(directory: Path) -> None:
    """Select the same manifest workflow in an explicit candidate directory."""
    global OUT, MANIFEST, FULL_MANIFEST, FULL_QA
    OUT = Path(directory).resolve()
    MANIFEST = OUT / "upload-manifest.json"
    FULL_MANIFEST = OUT / "full-manifest.json"
    FULL_QA = OUT / "full-qa.json"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def load_plan(prefix: str | None, manifest_path: Path | None = None, *,
              publication_manifest_path: Path | None = None,
              completed_log_path: Path | None = None) -> tuple[dict, list[dict]]:
    manifest_path = Path(manifest_path) if manifest_path else MANIFEST
    data = json.loads(manifest_path.read_text(encoding="utf-8"))
    replacement = data.get("mode") == "replace"
    if prefix is None:
        prefix = str(data.get("prefix") or DEFAULT_PREFIX)
    if not re.fullmatch(r"[A-Za-z0-9._/-]+/?", prefix) or prefix.startswith("/") or ".." in prefix.split("/"):
        raise ValueError("Prefix must be a simple relative object-key prefix (no '..').")
    aedar = data.get("family") == "aedar"
    if aedar:
        family = json.loads((PRODUCTION / "aedar-static-family.json").read_text(encoding="utf-8"))
        if prefix != family["prefix"] or data.get("prefix") != family["prefix"]:
            raise ValueError("AEDAR publication prefix must match its registered namespace")
        if data.get("bucket") != BUCKET or data.get("endpoint") != ENDPOINT:
            raise ValueError("AEDAR bucket/endpoint does not match the existing uploader")
    if replacement:
        selected = validate_replacement_plan(data)
        publication_path = Path(publication_manifest_path) if publication_manifest_path else MANIFEST
        if not publication_path.is_file():
            raise ValueError(f"Missing publication-selection manifest: {publication_path}")
        publication = json.loads(publication_path.read_text(encoding="utf-8"))
        if publication.get("source_manifest_sha256") != data.get("previous_manifest_sha256"):
            raise ValueError("publication-selection manifest does not match the replacement plan's previous manifest")
    else:
        if not FULL_MANIFEST.is_file():
            raise ValueError(f"Missing source manifest: {FULL_MANIFEST}")
        actual_source_hash = sha256(FULL_MANIFEST)
        if actual_source_hash != data.get("source_manifest_sha256"):
            raise ValueError("full-manifest.json has changed since upload-manifest.json was prepared.")
        selected = data.get("outputs")
        if not isinstance(selected, list) or not selected:
            raise ValueError("Upload manifest has no selected outputs.")
    seen: set[str] = set()
    items = []
    for entry in selected:
        filename = entry.get("filename", "")
        if not re.fullmatch(r"[A-Za-z0-9_-]+\.webp", filename) or filename in seen:
            raise ValueError(f"Invalid or duplicate manifest filename: {filename!r}")
        seen.add(filename)
        path = Path(entry["path"]) if replacement else OUT / filename
        if not path.is_file():
            raise ValueError(f"Selected output is missing: {path}")
        if entry.get("path") and Path(entry["path"]).name != filename:
            raise ValueError(f"Manifest path/filename mismatch for {filename}")
        if entry.get("content_type") != "image/webp":
            raise ValueError(f"Unexpected content type for {filename}")
        item = {"path": path, "filename": filename, "key": prefix.rstrip("/") + "/" + filename,
                "sha256": entry["output_sha256"], "bytes": int(entry["bytes"]),
                "content_type": "image/webp"}
        if aedar:
            territory = entry.get("territory", {})
            mode, profile = entry.get("mode"), entry.get("profile")
            if mode not in family["modes"] or profile not in family["profiles"]:
                raise ValueError(f"Unknown AEDAR reading/profile: {filename}")
            expected_name = family["filename_template"].format(code=territory.get("code"), mode=mode, profile=profile)
            expected_url = f"{family['public_base_url']}/{item['key']}"
            if filename != expected_name or entry.get("key") != item["key"] or entry.get("public_url") != expected_url:
                raise ValueError(f"AEDAR filename/key/public URL mismatch: {filename}")
        if replacement:
            item["expected_previous_sha256"] = entry["expected_previous_sha256"]
            item["expected_previous_bytes"] = int(entry["expected_previous_bytes"])
        items.append(item)
    if replacement:
        items, summary = select_replacement_retry_items(
            items, publication, completed_log_path, prefix=prefix)
        if not items:
            raise ValueError("No remaining replacement outputs after publication and completion filters.")
        data["retry_selection"] = summary
    return data, items


def upload_is_approved(qa_path: Path | None = None) -> tuple[bool, str]:
    qa_path = Path(qa_path) if qa_path else FULL_QA
    if not qa_path.is_file():
        return False, f"QA report is missing: {qa_path}"
    qa = json.loads(qa_path.read_text(encoding="utf-8"))
    if qa.get("status") != "passed":
        return False, f"full QA status is {qa.get('status')!r}, not 'passed'"
    spot = qa.get("human_spot_check", {})
    if spot.get("status") != "approved" or qa.get("production_status") != "complete":
        return False, (f"final visual approval is pending (human_spot_check.status={spot.get('status')!r}, "
                       f"production_status={qa.get('production_status')!r})")
    return True, "full QA passed and final visual spot-check is approved"


def plan_qa_path(data: dict, override: Path | None = None) -> Path:
    """Keep replacement approval tied to the QA report named by the plan."""
    if data.get("family") == "aedar":
        declared = FULL_QA.resolve()
        if override is not None and Path(override).resolve() != declared:
            raise ValueError("AEDAR approval must use the package's bound QA report")
        qa = json.loads(declared.read_text(encoding="utf-8"))
        if qa.get("source_manifest_sha256") != data.get("source_manifest_sha256"):
            raise ValueError("AEDAR bound QA does not match its package manifest")
        return declared
    if data.get("mode") != "replace":
        return Path(override) if override else FULL_QA
    declared = Path(data["qa_path"]).resolve()
    if override is not None and Path(override).resolve() != declared:
        raise ValueError("replacement plan approval must use its bound QA report")
    return declared


def setup_credentials() -> None:
    import boto3
    access = input("R2 access key ID (input is visible): ").strip()
    secret = getpass.getpass("R2 secret access key (hidden): ").strip()
    if not access or not secret:
        raise ValueError("Both access key ID and secret are required.")
    session = boto3.Session(aws_access_key_id=access, aws_secret_access_key=secret,
                           region_name="auto")
    client = session.client("s3", endpoint_url=ENDPOINT,
                            config=__import__("botocore.config", fromlist=["Config"]).Config(
                                connect_timeout=10, read_timeout=20, retries={"mode": "standard", "max_attempts": 2},
                                request_checksum_calculation="when_required", response_checksum_validation="when_required"))
    client.list_objects_v2(Bucket=BUCKET, MaxKeys=1)
    credentials = Path.home() / ".aws" / "credentials"
    credentials.parent.mkdir(parents=True, exist_ok=True)
    config = configparser.RawConfigParser()
    if credentials.exists():
        config.read(credentials)
    if not config.has_section(PROFILE):
        config.add_section(PROFILE)
    config.set(PROFILE, "aws_access_key_id", access)
    config.set(PROFILE, "aws_secret_access_key", secret)
    config.remove_option(PROFILE, "aws_session_token")
    with credentials.open("w", encoding="utf-8") as stream:
        config.write(stream)
    try:
        os.chmod(credentials, 0o600)
    except OSError:
        pass
    print(f"Credentials validated and saved to {credentials} under profile [{PROFILE}].")


def head_matches(response: dict, item: dict) -> bool:
    metadata = {key.lower(): value for key, value in response.get("Metadata", {}).items()}
    return (response.get("ContentLength") == item["bytes"] and
            metadata.get("sha256") == item["sha256"] and
            response.get("ContentType", "").split(";")[0].lower() == "image/webp")


def run_upload(prefix: str, event_log: Path, items: list[dict], qa_path: Path) -> int:
    approved, reason = upload_is_approved(qa_path)
    if not approved:
        print(f"UPLOAD BLOCKED: {reason}. No R2 requests were made.", file=sys.stderr)
        return 2
    from botocore.config import Config
    import boto3
    session = boto3.Session(profile_name=PROFILE, region_name="auto")
    client = session.client("s3", endpoint_url=ENDPOINT,
                            config=Config(connect_timeout=10, read_timeout=60,
                                          retries={"mode": "standard", "max_attempts": 5},
                                          request_checksum_calculation="when_required", response_checksum_validation="when_required"))
    event_log.parent.mkdir(parents=True, exist_ok=True)
    event_log.touch(exist_ok=True)
    counts = {"uploaded": 0, "skipped": 0, "failed": 0}

    def record(item: dict, result: str, detail: str = "") -> None:
        row = {"time": datetime.now(timezone.utc).isoformat(), "key": item["key"],
               "result": result, "bytes": item["bytes"], "sha256": item["sha256"]}
        if detail:
            row["detail"] = detail[:500]
        with event_log.open("a", encoding="utf-8") as stream:
            stream.write(json.dumps(row, ensure_ascii=False) + "\n")
            stream.flush()
            os.fsync(stream.fileno())
        counts[result] += 1

    def transfer(item: dict) -> tuple[dict, str, str]:
        try:
            actual_hash = sha256(item["path"])
            if actual_hash != item["sha256"] or item["path"].stat().st_size != item["bytes"]:
                raise ValueError("local file no longer matches manifest SHA-256/size")
            try:
                remote = client.head_object(Bucket=BUCKET, Key=item["key"])
            except Exception as exc:
                response = getattr(exc, "response", {})
                code = str(response.get("Error", {}).get("Code", ""))
                status = response.get("ResponseMetadata", {}).get("HTTPStatusCode")
                if code not in {"404", "NoSuchKey", "NotFound"} and status != 404:
                    raise
                if "expected_previous_sha256" in item:
                    replacement_action(None, item)
            else:
                if "expected_previous_sha256" in item:
                    action = replacement_action(remote, item)
                    if action == "skip":
                        return item, "skipped", "existing object already matches the new artifact"
                    item["_replace_if_match"] = replacement_if_match(remote, item)
                else:
                    if head_matches(remote, item):
                        return item, "skipped", "existing object matched size/SHA metadata/content type"
                    return item, "failed", "existing object conflicts; refusing to overwrite"
            body = item["path"].read_bytes()
            if hashlib.sha256(body).hexdigest() != item["sha256"]:
                raise ValueError("local file changed while preparing upload")
            put_options = {
                "Bucket": BUCKET, "Key": item["key"], "Body": body,
                "ContentType": "image/webp", "CacheControl": "public, max-age=3600",
                "Metadata": {"sha256": item["sha256"]},
                "ContentMD5": __import__("base64").b64encode(
                    hashlib.md5(body, usedforsecurity=False).digest()).decode("ascii"),
            }
            if "_replace_if_match" in item:
                put_options["IfMatch"] = item["_replace_if_match"]
            client.put_object(**put_options)
            remote = client.head_object(Bucket=BUCKET, Key=item["key"])
            if not head_matches(remote, item):
                raise ValueError("post-upload HEAD metadata/size verification failed")
            return item, "uploaded", "uploaded and verified by remote HEAD metadata/size"
        except Exception as exc:
            return item, "failed", f"{type(exc).__name__}: {exc}"

    print(f"Uploading {len(items):,} selected objects ({sum(x['bytes'] for x in items):,} bytes) "
          f"to s3://{BUCKET}/{prefix} using {WORKERS} workers.")
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        futures = [pool.submit(transfer, item) for item in items]
        for future in as_completed(futures):
            item, result, detail = future.result()
            record(item, result, detail)
            print(f"{result.upper():8} {item['filename']} — {detail}", flush=True)
    print("Summary: " + ", ".join(f"{key}={value}" for key, value in counts.items()))
    print(f"Event log: {event_log}")
    return 1 if counts["failed"] else 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--setup", action="store_true", help="validate R2 credentials and save local profile")
    mode.add_argument("--upload", action="store_true", help="upload (requires final QA and human approval)")
    parser.add_argument("--prefix")
    parser.add_argument("--output-dir", type=Path, default=OUT,
                        help="directory containing the usual full/upload manifests and WebPs")
    parser.add_argument("--manifest", type=Path,
                        help="upload selection or guarded replacement plan (default: upload-manifest.json)")
    parser.add_argument("--qa", type=Path,
                        help="QA report for this selection (default: plan QA or full-qa.json)")
    parser.add_argument("--publication-manifest", type=Path,
                        help="prior upload-manifest.json defining intentionally unpublished artifacts")
    parser.add_argument("--completed-log", type=Path,
                        help="interrupted replacement-upload JSONL log; verified successes are excluded")
    args = parser.parse_args()
    try:
        configure_output(args.output_dir)
        if args.setup:
            setup_credentials()
            return 0
        data, items = load_plan(
            args.prefix, args.manifest,
            publication_manifest_path=args.publication_manifest,
            completed_log_path=args.completed_log,
        )
        qa_path = plan_qa_path(data, args.qa)
        total_bytes = sum(item["bytes"] for item in items)
        print(f"Manifest status: {data.get('status')}")
        print(f"Selected: {len(items):,} files / {total_bytes:,} bytes; excluded: "
              f"{len(data.get('skipped', [])):,} files / {data.get('skipped_bytes', 0):,} bytes")
        if data.get("retry_selection"):
            retry = data["retry_selection"]
            print("Replacement filters: "
                  f"unpublished={retry['unpublished_excluded']:,}; "
                  f"already complete={retry['already_complete_excluded']:,}; "
                  f"expected missing={retry['expected_missing_excluded']:,}; "
                  f"remaining={retry['remaining']:,}")
        if not args.upload:
            for item in items:
                actual = sha256(item["path"])
                if actual != item["sha256"] or item["path"].stat().st_size != item["bytes"]:
                    raise ValueError(f"Dry-run local verification failed: {item['filename']}")
            print(f"DRY RUN OK: all {len(items):,} selected local files match manifest SHA-256 and size.")
            approved, reason = upload_is_approved(qa_path)
            print(f"Upload approval: {'READY' if approved else 'PENDING'} — {reason}")
            prefix = args.prefix or str(data.get("prefix") or DEFAULT_PREFIX)
            print(f"Sample URL: {PUBLIC_BASE}/{prefix.rstrip('/')}/{items[0]['filename']}")
            print("No credentials, SDK, or network access used.")
            return 0
        log = OUT / "logs" / f"r2-upload-{datetime.now().strftime('%Y%m%d-%H%M%S')}.jsonl"
        prefix = args.prefix or str(data.get("prefix") or DEFAULT_PREFIX)
        return run_upload(prefix, log, items, qa_path)
    except Exception as exc:
        print(f"ERROR: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
