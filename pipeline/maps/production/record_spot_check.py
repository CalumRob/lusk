"""Record an affirmative human visual spot-check separately from automated QA."""
import argparse
from hashlib import sha256
import json
from pathlib import Path


def record_spot_check(qa, reviewer, outcome):
    if outcome not in {"approved", "rejected"} or not reviewer:
        raise ValueError("visual spot-check requires a reviewer and approved/rejected outcome")
    review = qa.get("human_spot_check", {})
    review_set = review.get("review_set", [])
    if qa.get("status") != "passed" or not review_set:
        raise ValueError("spot-check requires passed automated QA and a non-empty review set")
    for item in review_set:
        path = Path(item["path"])
        if not path.is_file() or sha256(path.read_bytes()).hexdigest() != item["output_sha256"]:
            raise ValueError(f"a proposed visual spot-check artifact is missing or changed: {path}")
    record = {"reviewer": reviewer, "outcome": outcome,
        "reviewed_artifacts": [{key: item[key] for key in
            ("territory", "mode", "profile", "effective_identity", "output_sha256")} for item in review_set]}
    return {**qa, "human_spot_check": {**review, "status": outcome, "outcome": record},
        "production_status": "complete" if outcome == "approved" else "incomplete-human-review"}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--qa", type=Path, required=True)
    parser.add_argument("--reviewer", required=True)
    parser.add_argument("--outcome", choices=("approved", "rejected"), required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    qa = json.loads(args.qa.read_text(encoding="utf-8"))
    updated = record_spot_check(qa, args.reviewer, args.outcome)
    record = updated["human_spot_check"]["outcome"]
    args.output.write_text(json.dumps(record, indent=2, sort_keys=True), encoding="utf-8")
    args.qa.write_text(json.dumps(updated, indent=2, sort_keys=True, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    main()
