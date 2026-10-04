"""Human-owned approval records for the exact current representative render set."""
from hashlib import sha256
import json
from pathlib import Path

REPRESENTATIVE_PAIRS = {
    (kind, code, mode)
    for kind, code in (("commune", "35238"), ("region", "53"), ("epci", "243500741"))
    for mode in ("car", "walk", "bike")
}


def approval_payload(manifest):
    if manifest.get("scope") != "representative":
        raise ValueError("approval requires a complete representative run")
    members = manifest.get("approval_members", [])
    if not members:
        raise ValueError("approval requires representative outputs")
    pairs = {}
    for kind, code, mode, profile, identity in members:
        pairs.setdefault((kind, code, mode), set()).add(profile)
        if not isinstance(identity, str) or len(identity) != 64 or any(
                character not in "0123456789abcdef" for character in identity):
            raise ValueError("representative member has no valid effective identity")
    if any(profiles != {"inspection", "inline"} for profiles in pairs.values()):
        raise ValueError("representative approval is missing an export profile")
    if set(pairs) != REPRESENTATIVE_PAIRS or len(members) != len(REPRESENTATIVE_PAIRS) * 2:
        raise ValueError("approval requires the exact current three-territory, three-mode cohort")
    canonical = json.dumps(members, separators=(",", ":"), sort_keys=True)
    return json.loads(json.dumps({"approval_identity": sha256(canonical.encode()).hexdigest(),
            "recipe": manifest["recipe"], "recipe_version": manifest["recipe_version"],
            "foundation_version": manifest["foundation_version"],
            "renderer_identity": manifest["renderer_identity"],
            "approval_members": members, "members_sha256": sha256(canonical.encode()).hexdigest()}))


def require_approval(manifest, approval):
    if not approval:
        raise ValueError("full production requires explicit human approval")
    expected = approval_payload(manifest)
    if not isinstance(approval, dict) or any(approval.get(key) != value for key, value in expected.items()):
        raise ValueError("representative approval is stale or incomplete")
    if not approval.get("reviewer") or approval.get("visual_outcome", "").strip().lower() not in {
            "approved", "approved after visual review"}:
        raise ValueError("approval record lacks an affirmative human visual review outcome")


def read_approval(path):
    try:
        value = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise ValueError("missing or invalid human approval record") from error
    if not isinstance(value, dict) or value.get("human_approved") is not True:
        raise ValueError("approval record must explicitly record human_approved=true")
    return value


def record_human_approval(manifest, qa, reviewer, outcome, path):
    """Explicit operator action; this function never runs as part of rendering."""
    if not reviewer or not outcome or outcome.strip().lower() not in {"approved", "approved after visual review"}:
        raise ValueError("human visual outcome must be explicitly affirmative (approved)")
    if (qa.get("status") != "passed" or qa.get("artifact_count") != 18
            or qa.get("expected_artifact_count") != 18 or qa.get("failures")
            or qa.get("profile_counts") != {"inspection": 9, "inline": 9}):
        raise ValueError("human approval requires automated QA of the complete representative set")
    outputs = manifest.get("outputs", [])
    output_members = sorted((item["territory"]["kind"], item["territory"]["code"],
        item["mode"], item["profile"], item["effective_identity"]) for item in outputs)
    if output_members != sorted(manifest.get("approval_members", [])):
        raise ValueError("representative artifacts do not match the effective approval identities")
    for item in outputs:
        artifact = Path(item["path"])
        try:
            valid_hash = sha256(artifact.read_bytes()).hexdigest() == item["output_sha256"]
        except OSError:
            valid_hash = False
        if not valid_hash:
            raise ValueError(f"representative artifact is missing or changed: {artifact}")
    payload = approval_payload(manifest)
    payload.update({"human_approved": True, "reviewer": reviewer,
                    "visual_outcome": outcome})
    Path(path).write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")
