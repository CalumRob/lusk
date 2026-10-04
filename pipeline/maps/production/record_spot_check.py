"""Record an affirmative human visual spot-check separately from automated QA."""
import argparse
from hashlib import sha256
import json
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--qa", type=Path, required=True)
    parser.add_argument("--reviewer", required=True)
    parser.add_argument("--outcome", choices=("approved",), required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    qa = json.loads(args.qa.read_text(encoding="utf-8"))
    review = qa.get("human_spot_check", {})
    review_set = review.get("review_set", [])
    if qa.get("status") != "passed" or not review_set:
        raise SystemExit("spot-check requires passed automated QA and a non-empty review set")
    for item in review_set:
        path = Path(item["path"])
        if not path.is_file() or sha256(path.read_bytes()).hexdigest() != item["output_sha256"]:
            raise SystemExit(f"a proposed visual spot-check artifact is missing or changed: {path}")
    record = {"reviewer": args.reviewer, "outcome": args.outcome,
        "reviewed_artifacts": [{key: item[key] for key in
            ("territory", "mode", "profile", "effective_identity", "output_sha256")} for item in review_set]}
    args.output.write_text(json.dumps(record, indent=2, sort_keys=True), encoding="utf-8")
    qa["human_spot_check"] = {**review, "status": "approved", "outcome": record}
    qa["production_status"] = "complete"
    args.qa.write_text(json.dumps(qa, indent=2, sort_keys=True, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    main()
