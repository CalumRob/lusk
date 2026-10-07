"""Record an operator's visual review of a successful current 18-artifact sample."""
import argparse
from hashlib import sha256
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from approval import canonical_approval_members, record_human_approval


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--qa", type=Path, required=True)
    parser.add_argument("--reviewer", required=True)
    parser.add_argument("--outcome", choices=("approved",), required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    qa = json.loads(args.qa.read_text(encoding="utf-8"))
    if (qa.get("status") != "passed" or qa.get("artifact_count") != 18
            or qa.get("expected_artifact_count") != 18 or qa.get("failures")
            or qa.get("profile_counts") != {"inspection": 9, "inline": 9}):
        raise SystemExit("approval can only follow automated QA of the complete representative set")
    if manifest.get("scope") != "representative" or not manifest.get("approval_pairs_complete"):
        raise SystemExit("manifest is not a complete representative run")
    if len(manifest.get("approval_members", [])) != 18:
        raise SystemExit("representative manifest does not contain all 18 paired identities")
    outputs = manifest.get("outputs", [])
    output_members = canonical_approval_members((item["territory"]["kind"], item["territory"]["code"],
        item["mode"], item["profile"], item["effective_identity"]) for item in outputs)
    if output_members != canonical_approval_members(manifest["approval_members"]):
        raise SystemExit("representative outputs do not match the approval identity set")
    for item in outputs:
        artifact = Path(item["path"])
        if not artifact.is_file() or sha256(artifact.read_bytes()).hexdigest() != item["output_sha256"]:
            raise SystemExit(f"representative artifact is missing or changed: {artifact}")
    record_human_approval(manifest, qa, args.reviewer, args.outcome, args.output)
    print(f"Recorded human visual approval: {args.output}")


if __name__ == "__main__":
    main()
