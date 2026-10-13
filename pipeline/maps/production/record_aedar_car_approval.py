"""Explicit operator recording of visual review of the six native car WebPs."""
import argparse
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from aedar_car import AedarCarAdapter, aedar_car_recipe
from approval import record_human_approval
from runner import PROFILES
from webp_encoding import validate_webp


def record_car_approval(manifest, qa, reviewer, outcome, path):
    recipe = aedar_car_recipe()
    if (manifest.get("recipe") != recipe.name or manifest.get("recipe_version") != recipe.version or
            manifest.get("foundation_version") != recipe.foundation.version):
        raise ValueError("Car approval requires the current car-diversity recipe")
    for name, profile in PROFILES.items():
        if manifest.get("artifact_contracts", {}).get(name) != AedarCarAdapter.output_contract(profile):
            raise ValueError("Car approval requires native production WebP encoding, not PNG evidence")
    for row in manifest.get("outputs", []):
        profile = PROFILES[row["profile"]]
        if Path(row["path"]).suffix.lower() != ".webp" or row.get("artifact_contract") != AedarCarAdapter.output_contract(profile):
            raise ValueError("Car approval artifacts must match their native WebP contracts")
        validate_webp(row["path"], profile)
    record_human_approval(manifest, qa, reviewer, outcome, path,
                          representative_pairs=AedarCarAdapter.approval_pairs())


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--qa", type=Path, required=True)
    parser.add_argument("--reviewer", required=True)
    parser.add_argument("--outcome", choices=("approved",), required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv)
    record_car_approval(json.loads(args.manifest.read_text(encoding="utf-8")),
        json.loads(args.qa.read_text(encoding="utf-8")), args.reviewer, args.outcome, args.output)
    print(f"Recorded explicit human car WebP review: {args.output}")


if __name__ == "__main__":
    main()
