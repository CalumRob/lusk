"""Flatten a completed AEDAR export into the existing R2 manifest workflow. Never uploads."""
from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import shutil
from types import SimpleNamespace
from uuid import uuid4

from upload_maps import ENDPOINT, sha256
from webp_encoding import WEBP_ENCODING_CONTRACT, validate_webp

PRODUCTION = Path(__file__).resolve().parent


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def write_json(path, value):
    path = Path(path)
    staged = path.with_name(f".{path.name}-{uuid4().hex}.tmp")
    try:
        staged.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        os.replace(staged, path)
    finally:
        staged.unlink(missing_ok=True)


def package_export(source_dir, output_dir):
    """Verify/copy existing bytes, then write full-manifest/full-qa/upload-manifest."""
    source, output = Path(source_dir).resolve(), Path(output_dir).resolve()
    if source == output or output.is_relative_to(source) or source.is_relative_to(output):
        raise ValueError("Export and publication package must be separate directories")
    config_path = PRODUCTION / "aedar-static-family.json"
    config = read_json(config_path)
    complete = read_json(source / "complete.json")
    plan = read_json(source / "full-plan.json")
    if complete.get("status") != "passed" or complete.get("qa") != "passed":
        raise ValueError("Source export is not complete with passed QA")
    if plan.get("q80") != WEBP_ENCODING_CONTRACT:
        raise ValueError("Source plan does not use the selected q80 encoder contract")
    territories = {}
    for row in plan["territories"]:
        territory = row["territory"]
        key = (territory["kind"], territory["code"])
        if key in territories:
            raise ValueError(f"Duplicate planned territory: {key}")
        territories[key] = territory
    expected = {}
    for territory in territories.values():
        if not re.fullmatch(r"[0-9]+", territory["code"]):
            raise ValueError("Invalid territory code in source plan")
        for mode in config["modes"]:
            for profile in config["profiles"]:
                filename = config["filename_template"].format(code=territory["code"], mode=mode, profile=profile)
                if filename in expected:
                    raise ValueError(f"Filename collision between territories: {filename}")
                expected[filename] = (territory, mode, profile)
    if (plan["territory_count"] != len(territories) or complete["territories"] != len(territories)
            or plan["expected_webps"] != len(expected) or complete["artifacts"] != len(expected)):
        raise ValueError("Source inventory/completion coverage disagrees")
    missing = plan.get("skipped_no_address_facts", [])
    if complete.get("skipped", []) != missing:
        raise ValueError("Source omission reports disagree")
    shard_indices = [index for shard in plan["shards"] for index in shard]
    if sorted(shard_indices) != list(range(len(territories))):
        raise ValueError("Source shard allocation does not partition its territory plan")

    package_log = output / "package.log"

    def log(message):
        line = f"{datetime.now(timezone.utc).isoformat(timespec='seconds')} {message}"
        print(line, flush=True)
        with package_log.open("a", encoding="utf-8") as stream:
            stream.write(line + "\n")

    evidence_paths = [source / "complete.json", source / "full-plan.json"]
    manifests, source_outputs = [], {}
    for index, indices in enumerate(plan["shards"]):
        manifest_path, qa_path = (source / f"worker-{index}.{suffix}.json" for suffix in ("manifest", "qa"))
        manifest, qa = read_json(manifest_path), read_json(qa_path)
        if qa.get("status") != "passed" or qa.get("failures"):
            raise ValueError(f"Worker {index} source QA has not passed")
        rows = manifest["outputs"]
        if len(rows) != qa["artifact_count"] or len(rows) != qa["expected_artifact_count"]:
            raise ValueError(f"Worker {index} manifest/QA coverage disagrees")
        shard_territories = {tuple(plan["territories"][i]["territory"][key] for key in ("kind", "code"))
                             for i in indices}
        actual_territories = {(row["territory"]["kind"], row["territory"]["code"]) for row in rows}
        if actual_territories != shard_territories:
            raise ValueError(f"Worker {index} territory coverage disagrees with its shard")
        for row in rows:
            path = Path(row["path"]).resolve()
            if path.parent != (source / f"shard-{index}").resolve():
                raise ValueError(f"Worker output escapes its source shard: {path}")
            if path.name in source_outputs:
                raise ValueError(f"Duplicate source artifact: {path.name}")
            source_outputs[path.name] = row
        evidence_paths.extend((manifest_path, qa_path))
        manifests.append({"manifest": manifest_path.name, "sha256": sha256(manifest_path),
                          "qa": qa_path.name, "qa_sha256": sha256(qa_path)})
    if set(source_outputs) != set(expected):
        raise ValueError("Source manifest coverage does not match the complete planned inventory")
    inline_outputs = [row for row in source_outputs.values() if row.get("profile") == "inline"]
    has_inline_metadata = any("inline_legend" in row for row in inline_outputs)
    for row in source_outputs.values():
        metadata = row.get("inline_legend")
        if row.get("profile") != "inline" and metadata is not None:
            raise ValueError("Inline legend metadata is forbidden on inspection images")
        if metadata is None:
            continue
        filename = Path(row["path"]).name
        expected_key = config["prefix"] + filename
        if not isinstance(metadata, dict):
            raise ValueError(f"Malformed inline legend metadata: {filename}")
        image = metadata.get("image", {})
        if (row.get("family") != "aedar" or metadata.get("schema") != "lusk.aedar.inline-legend.v1"
                or image.get("key") != expected_key or image.get("sha256") != row.get("output_sha256")
                or image.get("bytes") != row.get("bytes")):
            raise ValueError(f"Malformed or image-mismatched inline legend metadata: {filename}")
    if has_inline_metadata and any(not row.get("inline_legend") for row in inline_outputs):
        raise ValueError("AEDAR inline legend coverage is incomplete across source workers")
    actual_files = {path.resolve() for path in source.glob("shard-*/*.webp")}
    if actual_files != {Path(row["path"]).resolve() for row in source_outputs.values()}:
        raise ValueError("Source shard files disagree with source manifests")
    extra = {path.name for path in output.glob("*.webp")} - set(expected)
    if extra:
        raise ValueError(f"Publication directory contains unexpected WebPs: {sorted(extra)[:5]}")

    output.mkdir(parents=True, exist_ok=True)
    log(f"Checking {len(expected)} existing q80 WebPs; no rendering or upload")
    outputs = []
    inline_metadata = []
    for number, filename in enumerate(sorted(expected), 1):
        territory, mode, profile = expected[filename]
        row = source_outputs[filename]
        spec = config["profiles"][profile]
        contract = {**WEBP_ENCODING_CONTRACT, "dimensions": spec["size"],
                    "alpha": "lossless" if spec["transparent_outside"] else "opaque-rgb"}
        if (row.get("family") != config["family"] or row.get("territory") != territory
                or row.get("mode") != mode or row.get("profile") != profile
                or row.get("artifact_contract") != contract or row.get("profile_size") != spec["size"]):
            raise ValueError(f"Source artifact contract mismatch: {filename}")
        source_path = Path(row["path"])
        if source_path.stat().st_size != row["bytes"] or sha256(source_path) != row["output_sha256"]:
            raise ValueError(f"Source artifact changed: {filename}")
        destination = output / filename
        if destination.exists():
            if destination.stat().st_size != row["bytes"] or sha256(destination) != row["output_sha256"]:
                raise ValueError(f"Conflicting package artifact: {filename}; refusing overwrite")
        else:
            staged = destination.with_name(f".{filename}-{uuid4().hex}.tmp")
            try:
                shutil.copyfile(source_path, staged)
                if staged.stat().st_size != row["bytes"] or sha256(staged) != row["output_sha256"]:
                    raise ValueError(f"Copy integrity failure: {filename}")
                os.replace(staged, destination)
            finally:
                staged.unlink(missing_ok=True)
        validate_webp(destination, SimpleNamespace(name=profile, size=tuple(spec["size"]),
                                                 transparent_outside=spec["transparent_outside"]))
        key = config["prefix"] + filename
        outputs.append({**row, "path": str(destination), "filename": filename,
                        "key": key, "public_url": f"{config['public_base_url']}/{key}",
                        "content_type": "image/webp"})
        if profile == "inline" and row.get("inline_legend"):
            payload = row["inline_legend"]
            if payload.get("image", {}).get("sha256") != row["output_sha256"]:
                raise ValueError(f"Inline legend does not bind to image bytes: {filename}")
            json_name = Path(filename).stem + ".json"
            json_path = output / json_name
            write_json(json_path, payload)
            inline_metadata.append({"filename": json_name, "path": str(json_path),
                "key": config["prefix"] + json_name, "content_type": "application/json",
                "bytes": json_path.stat().st_size, "output_sha256": sha256(json_path),
                "image_sha256": row["output_sha256"]})
        if number % 250 == 0 or number == len(expected):
            log(f"PACKAGED {number}/{len(expected)} byte-identical, decoded WebPs")

    # Keep original evidence, not retroactively rewritten renderer identities.
    evidence = output / "evidence"
    evidence.mkdir(exist_ok=True)
    for path in evidence_paths:
        destination = evidence / path.name
        digest = sha256(path)
        if not destination.exists():
            shutil.copyfile(path, destination)
        if sha256(destination) != digest:
            raise ValueError(f"Source evidence changed/conflicts: {path.name}")
    if (read_json(source / "complete.json") != complete
            or any(sha256(source / row["manifest"]) != row["sha256"]
                   or sha256(source / row["qa"]) != row["qa_sha256"] for row in manifests)):
        raise ValueError("Source evidence changed while packaging")
    full_manifest = {"family": config["family"], "outputs": outputs,
        "scope": "packaged candidate export; publication approval not synthesized",
        "source_plan_sha256": sha256(evidence / "full-plan.json"), "source_workers": manifests,
        "family_config_sha256": sha256(config_path), "missing_territories": missing}
    write_json(output / "full-manifest.json", full_manifest)
    full_qa = {"status": "passed", "production_status": "awaiting-human-spot-check",
        "source_manifest_sha256": sha256(output / "full-manifest.json"),
        "human_spot_check": {"status": "pending"}, "artifact_count": len(outputs),
        "expected_artifact_count": len(expected), "profile_counts": dict(Counter(row["profile"] for row in outputs)),
        "failures": [], "checks": ["source shard/manifest/plan coverage", "byte-identical copies",
            "native decoded WebP dimensions and alpha", "unique AEDAR object keys"], "missing_territories": missing}
    write_json(output / "full-qa.json", full_qa)
    selection = {"status": "verified-local-candidate", "mode": "append", "family": config["family"],
        "bucket": config["bucket"], "endpoint": ENDPOINT, "prefix": config["prefix"],
        "public_base_url": config["public_base_url"], "source_manifest": str(output / "full-manifest.json"),
        "source_manifest_sha256": sha256(output / "full-manifest.json"),
        "upload_count": len(outputs), "upload_bytes": sum(row["bytes"] for row in outputs),
        "skipped_count": 0, "skipped_bytes": 0, "outputs": outputs, "skipped": [],
        "missing_territories": missing}
    write_json(output / "upload-manifest.json", selection)
    if inline_metadata:
        write_json(output / "inline-metadata-manifest.json", {
            "family": "aedar-inline-metadata", "prefix": config["prefix"],
            "source_manifest_sha256": sha256(output / "full-manifest.json"),
            "source_upload_manifest_sha256": sha256(output / "upload-manifest.json"),
            "source_qa_sha256": sha256(output / "full-qa.json"), "outputs": inline_metadata,
            "upload_count": len(inline_metadata)})
    log(f"COMPLETE: {len(outputs)} staged WebPs; same R2 helper; upload approval remains pending")
    return selection


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", type=Path, required=True, help="completed full export containing full-plan.json")
    parser.add_argument("--output-dir", type=Path, default=PRODUCTION / "output/aedar-static-publish")
    args = parser.parse_args(argv)
    package_export(args.source_dir, args.output_dir)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
