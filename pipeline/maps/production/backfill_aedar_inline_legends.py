"""Create JSON-only AEDAR inline legends from a preserved approved package."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import pyarrow.parquet as pq

from upload_maps import sha256
from aedar_map_plan import binding_for, family_config
from aedar_legend import inline_legend


class MetricsFacts:
    """Metrics-only indexed view; deliberately does not load geometry or coordinates."""
    def __init__(self, path, config):
        table = pq.read_table(path, columns=["code_insee", *[x["value_field"] for x in config["modes"].values()]])
        codes = np.asarray(table["code_insee"].to_pylist(), dtype=str)
        if len(codes) == 0 or np.any(codes[1:] < codes[:-1]):
            raise ValueError("Prepared AEDAR metrics must be nonempty and sorted by commune")
        self.codes = codes
        self.metrics = {name: table[name].to_numpy(zero_copy_only=False).astype(float)
                        for name in [x["value_field"] for x in config["modes"].values()]}
        if any(not np.isfinite(x).all() for x in self.metrics.values()):
            raise ValueError("Prepared AEDAR metrics contain non-finite values")
        self.car_mean = float(self.metrics[config["modes"]["car"]["value_field"]].mean())
        starts = np.searchsorted(codes, codes, side="left")
        ends = np.searchsorted(codes, codes, side="right")
        self.slices = {code: (int(start), int(end)) for code, start, end in zip(codes[starts], starts, ends)}

    def positions(self, territory_codes):
        spans = [np.arange(*self.slices[code]) for code in sorted(set(territory_codes)) if code in self.slices]
        return np.concatenate(spans) if spans else np.empty(0, dtype=np.int64)


def backfill(package_dir, facts_path, output_dir):
    package, facts_path, output = Path(package_dir).resolve(), Path(facts_path).resolve(), Path(output_dir).resolve()
    config_path = Path(__file__).resolve().parent / "aedar-static-family.json"
    config = family_config()
    full, upload, qa = (package / name for name in ("full-manifest.json", "upload-manifest.json", "full-qa.json"))
    plan_path = package / "evidence" / "full-plan.json"
    if not all(p.is_file() for p in (full, upload, qa, plan_path, facts_path)):
        raise ValueError("Backfill requires original manifests, QA, preserved plan and prepared facts")
    manifest, selection, report, plan = (json.loads(p.read_text(encoding="utf-8")) for p in (full, upload, qa, plan_path))
    if report.get("status") != "passed" or report.get("production_status") != "complete" or report.get("human_spot_check", {}).get("status") != "approved":
        raise ValueError("Original approved package QA is required")
    if report.get("source_manifest_sha256") != sha256(full) or selection.get("source_manifest_sha256") != sha256(full):
        raise ValueError("Package manifest/QA association changed")
    if report["human_spot_check"].get("upload_manifest_sha256") != sha256(upload):
        raise ValueError("Original approval is not bound to this upload manifest")
    approval_path = package / report["human_spot_check"].get("approval_record", "")
    if not approval_path.is_file():
        raise ValueError("Original human approval receipt is missing")
    approval = json.loads(approval_path.read_text(encoding="utf-8"))
    if (approval.get("source_manifest_sha256") != sha256(full)
            or approval.get("upload_manifest_sha256") != sha256(upload)):
        raise ValueError("Original human approval receipt does not bind to package manifests")
    if manifest.get("family_config_sha256") != sha256(config_path) or manifest.get("source_plan_sha256") != sha256(plan_path):
        raise ValueError("Family config or preserved source plan changed")
    signatures = plan.get("input_signatures", {})
    if sha256(facts_path) not in signatures.values():
        raise ValueError("Prepared facts do not match the preserved plan signature")
    full_outputs = {row["filename"]: row for row in manifest["outputs"]}
    selected = {row["filename"]: row for row in selection["outputs"]}
    if set(full_outputs) != set(selected):
        raise ValueError("Original full/upload manifest association is incomplete")
    territory_rows = plan["territories"]
    if len(territory_rows) != plan["territory_count"]:
        raise ValueError("Preserved plan territory coverage is inconsistent")
    facts = MetricsFacts(facts_path, config)
    bases = [{"territory": row["territory"], "territory_codes": tuple(row["territory_codes"])} for row in territory_rows]
    features = binding_for(bases, facts, facts_path, config).map_set.layers["aedar-static-selected"]
    feature_by = {(f["territory"]["code"], f["mode"]): f for f in features}
    inline_rows = [row for row in selected.values() if row.get("family") == "aedar" and row.get("profile") == "inline"]
    expected = len(bases) * len(config["modes"])
    if len(inline_rows) != expected:
        raise ValueError(f"Inline image coverage incomplete: expected {expected}, found {len(inline_rows)}")
    output.mkdir(parents=True, exist_ok=True)
    items = []
    for image in inline_rows:
        path = Path(image["path"])
        if path.stat().st_size != image["bytes"] or sha256(path) != image["output_sha256"]:
            raise ValueError(f"Approved source image changed: {path.name}")
        territory, mode = image["territory"]["code"], image["mode"]
        feature = feature_by[(territory, mode)]
        json_name = path.stem + ".json"
        key = config["prefix"] + json_name
        payload = inline_legend(feature, image["key"], image["output_sha256"], image["bytes"])
        destination = output / json_name
        destination.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        items.append({"filename": json_name, "path": str(destination), "key": key,
                      "content_type": "application/json", "bytes": destination.stat().st_size,
                      "output_sha256": sha256(destination), "image_sha256": image["output_sha256"]})
    selection_path = output / "inline-metadata-manifest.json"
    selection_path.write_text(json.dumps({"family": "aedar-inline-metadata", "prefix": config["prefix"],
        "source_manifest_sha256": sha256(full), "source_upload_manifest_sha256": sha256(upload),
        "source_qa_sha256": sha256(qa), "source_plan_sha256": sha256(plan_path),
        "facts_sha256": sha256(facts_path), "family_config_sha256": sha256(config_path),
        "upload_count": len(items), "outputs": items}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return selection_path, len(items)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--package-dir", type=Path, required=True)
    parser.add_argument("--facts", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args(argv)
    path, count = backfill(args.package_dir, args.facts, args.output_dir)
    print(f"Generated {count} image-bound JSON sidecars; no image or approval evidence changed. Selection: {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
