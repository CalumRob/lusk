"""Tests for the guarded object-replacement seam used by the R2 operator tool."""
import sys
from pathlib import Path
import hashlib
import json
from tempfile import TemporaryDirectory
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from r2_replacement import (
    build_replacement_plan,
    replacement_action,
    replacement_if_match,
    select_replacement_retry_items,
    validate_replacement_plan,
)


class R2ReplacementTests(unittest.TestCase):
    def setUp(self):
        self.item = {
            "output_sha256": "b" * 64,
            "bytes": 19,
            "expected_previous_sha256": "a" * 64,
            "expected_previous_bytes": 11,
        }

    def test_replaces_only_when_remote_matches_the_recorded_previous_artifact(self):
        remote = {
            "ContentLength": 11,
            "ContentType": "image/webp",
            "ETag": '"current-object-version"',
            "Metadata": {"sha256": "a" * 64},
        }

        self.assertEqual(replacement_action(remote, self.item), "replace")
        self.assertEqual(replacement_if_match(remote, self.item), '"current-object-version"')

    def test_accepts_the_uploaders_normalized_sha256_field(self):
        remote = {
            "ContentLength": 11,
            "ContentType": "image/webp",
            "ETag": '"current-object-version"',
            "Metadata": {"sha256": "a" * 64},
        }
        transfer_item = {
            "sha256": "b" * 64,
            "bytes": 19,
            "expected_previous_sha256": "a" * 64,
            "expected_previous_bytes": 11,
        }

        self.assertEqual(replacement_action(remote, transfer_item), "replace")
        self.assertEqual(replacement_if_match(remote, transfer_item), '"current-object-version"')

    def test_replacement_requires_a_strong_etag_for_atomic_put(self):
        remote = {
            "ContentLength": 11,
            "ContentType": "image/webp",
            "Metadata": {"sha256": "a" * 64},
        }

        with self.assertRaisesRegex(ValueError, "no strong ETag"):
            replacement_if_match(remote, self.item)

    def test_conflicting_plan_and_transfer_hash_aliases_fail_closed(self):
        remote = {
            "ContentLength": 11,
            "ContentType": "image/webp",
            "Metadata": {"sha256": "a" * 64},
        }
        item = {**self.item, "sha256": "c" * 64}

        with self.assertRaisesRegex(ValueError, "SHA-256 aliases disagree"):
            replacement_action(remote, item)

    def test_retry_selection_excludes_unpublished_and_already_uploaded_artifacts(self):
        candidate_items = [
            self._candidate_item("10001-car-inspection.webp", "1"),
            self._candidate_item("10002-bike-inspection.webp", "2"),
            self._candidate_item("10003-walk-inspection.webp", "3"),
        ]
        publication_manifest = {
            "outputs": [
                self._previous_item(candidate_items[0]),
                self._previous_item(candidate_items[2]),
            ],
            "skipped": [{
                **self._previous_item(candidate_items[1]),
                "reason": "commune-cycling-total-length-exactly-zero",
            }],
        }
        with TemporaryDirectory() as directory:
            log = Path(directory) / "attempt.jsonl"
            log.write_text("\n".join(json.dumps(row) for row in (
                {
                    "key": "maps/v1/10001-car-inspection.webp", "result": "uploaded",
                    "sha256": candidate_items[0]["sha256"], "bytes": candidate_items[0]["bytes"],
                },
                {
                    "key": "maps/v1/10002-bike-inspection.webp", "result": "failed",
                    "sha256": candidate_items[1]["sha256"], "bytes": candidate_items[1]["bytes"],
                    "detail": "ValueError: expected prior R2 object is missing",
                },
            )), encoding="utf-8")

            selected, summary = select_replacement_retry_items(
                candidate_items, publication_manifest, log, prefix="maps/v1/")

        self.assertEqual([item["filename"] for item in selected], ["10003-walk-inspection.webp"])
        self.assertEqual(summary, {
            "candidate_count": 3,
            "unpublished_excluded": 1,
            "already_complete_excluded": 1,
            "expected_missing_excluded": 1,
            "remaining": 1,
        })

    def test_retry_selection_aborts_if_a_publishable_object_failed(self):
        item = self._candidate_item("10001-car-inspection.webp", "1")
        publication_manifest = {"outputs": [self._previous_item(item)], "skipped": []}
        with TemporaryDirectory() as directory:
            log = Path(directory) / "attempt.jsonl"
            log.write_text(json.dumps({
                "key": item["key"], "result": "failed", "sha256": item["sha256"],
                "bytes": item["bytes"], "detail": "ValueError: unexpected object hash",
            }), encoding="utf-8")

            with self.assertRaisesRegex(ValueError, "failed for a previously publishable object"):
                select_replacement_retry_items([item], publication_manifest, log, prefix="maps/v1/")

    @staticmethod
    def _candidate_item(filename, suffix):
        territory_code, mode, _profile = filename.removesuffix(".webp").split("-")
        territory = {"kind": "commune", "code": territory_code, "name": territory_code}
        return {
            "territory": territory, "mode": mode, "profile": "inspection",
            "filename": filename, "key": f"maps/v1/{filename}", "sha256": suffix * 64,
            "bytes": 20, "expected_previous_sha256": chr(ord(suffix) + 3) * 64,
            "expected_previous_bytes": 10,
        }

    @staticmethod
    def _previous_item(candidate):
        return {
            "territory": candidate["territory"], "mode": candidate["mode"],
            "profile": candidate["profile"], "filename": candidate["filename"],
            "output_sha256": candidate["expected_previous_sha256"],
            "bytes": candidate["expected_previous_bytes"],
        }

    def test_retry_skips_when_remote_already_matches_the_new_artifact(self):
        remote = {
            "ContentLength": 19,
            "ContentType": "image/webp",
            "Metadata": {"sha256": "b" * 64},
        }

        self.assertEqual(replacement_action(remote, self.item), "skip")

    def test_unknown_or_changed_remote_objects_fail_closed(self):
        remote = {
            "ContentLength": 17,
            "ContentType": "image/webp",
            "Metadata": {"sha256": "c" * 64},
        }

        with self.assertRaisesRegex(ValueError, "does not match expected previous or new artifact"):
            replacement_action(remote, self.item)

    def test_missing_remote_object_is_not_treated_as_a_replacement(self):
        with self.assertRaisesRegex(ValueError, "expected prior R2 object is missing"):
            replacement_action(None, self.item)

    def test_replacement_plan_binds_new_files_to_the_verified_previous_manifest(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            old_bytes, new_bytes = b"previous map", b"corrected map"
            old_artifact = root / "old" / "243500139-car-inspection.webp"
            new_artifact = root / "refresh" / old_artifact.name
            old_artifact.parent.mkdir()
            new_artifact.parent.mkdir()
            old_artifact.write_bytes(old_bytes)
            new_artifact.write_bytes(new_bytes)
            territory = {"kind": "epci", "code": "243500139", "name": "Rennes Métropole"}
            old_item = {
                "territory": territory, "mode": "car", "profile": "inspection",
                "path": str(old_artifact), "output_sha256": hashlib.sha256(old_bytes).hexdigest(),
                "bytes": len(old_bytes),
            }
            new_item = {
                "territory": territory, "mode": "car", "profile": "inspection",
                "path": str(new_artifact), "output_sha256": hashlib.sha256(new_bytes).hexdigest(),
                "bytes": len(new_bytes),
            }
            previous_path = root / "full-manifest.json"
            candidate_path = root / "refresh-manifest.json"
            qa_path = root / "refresh-qa.json"
            previous_path.write_text(json.dumps({"outputs": [old_item]}), encoding="utf-8")
            candidate_path.write_text(json.dumps({
                "family": "network", "scope": "inspection-refresh", "outputs": [new_item],
            }), encoding="utf-8")
            qa_path.write_text(json.dumps({
                "status": "passed", "artifact_count": 1, "expected_artifact_count": 1,
                "profile_counts": {"inspection": 1}, "failures": [],
                "expected_outputs": [{
                    "key": "epci/243500139/car/inspection", "territory": territory,
                    "mode": "car", "profile": "inspection",
                }],
            }), encoding="utf-8")

            plan = build_replacement_plan(previous_path, candidate_path, qa_path)
            validated = validate_replacement_plan(plan)

        self.assertEqual(plan["mode"], "replace")
        self.assertEqual(len(plan["outputs"]), 1)
        self.assertEqual(plan["outputs"][0]["expected_previous_sha256"],
                         hashlib.sha256(old_bytes).hexdigest())
        self.assertEqual(plan["outputs"][0]["expected_previous_bytes"], len(old_bytes))
        self.assertEqual(plan["outputs"][0]["output_sha256"], hashlib.sha256(new_bytes).hexdigest())
        self.assertEqual(validated[0]["filename"], "243500139-car-inspection.webp")

    def test_upload_plan_rejects_tampered_prior_identity(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            old_bytes, new_bytes = b"previous", b"corrected"
            old_artifact = root / "243500139-car-inspection.webp"
            new_artifact = root / "refresh" / "243500139-car-inspection.webp"
            new_artifact.parent.mkdir()
            old_artifact.write_bytes(old_bytes)
            new_artifact.write_bytes(new_bytes)
            territory = {"kind": "epci", "code": "243500139", "name": "Rennes Métropole"}
            previous_path, candidate_path, qa_path = (root / "previous.json", root / "candidate.json",
                                                       root / "qa.json")
            previous_path.write_text(json.dumps({"outputs": [{
                "territory": territory, "mode": "car", "profile": "inspection",
                "path": str(old_artifact), "output_sha256": hashlib.sha256(old_bytes).hexdigest(),
                "bytes": len(old_bytes),
            }]}), encoding="utf-8")
            candidate_path.write_text(json.dumps({
                "family": "network", "scope": "inspection-refresh", "outputs": [{
                    "territory": territory, "mode": "car", "profile": "inspection",
                    "path": str(new_artifact), "output_sha256": hashlib.sha256(new_bytes).hexdigest(),
                    "bytes": len(new_bytes),
                }],
            }), encoding="utf-8")
            qa_path.write_text(json.dumps({
                "status": "passed", "artifact_count": 1, "expected_artifact_count": 1,
                "profile_counts": {"inspection": 1}, "failures": [],
                "expected_outputs": [{
                    "key": "epci/243500139/car/inspection", "territory": territory,
                    "mode": "car", "profile": "inspection",
                }],
            }), encoding="utf-8")
            plan = build_replacement_plan(previous_path, candidate_path, qa_path)
            plan["outputs"][0]["expected_previous_sha256"] = "c" * 64

            with self.assertRaisesRegex(ValueError, "does not match its source manifests"):
                validate_replacement_plan(plan)

    def test_replacement_plan_rejects_a_local_old_artifact_that_disagrees_with_its_manifest(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            old_artifact = root / "old.webp"
            new_artifact = root / "new.webp"
            old_artifact.write_bytes(b"not the published bytes")
            new_artifact.write_bytes(b"new bytes")
            territory = {"kind": "epci", "code": "243500139", "name": "Rennes Métropole"}
            previous_path = root / "previous.json"
            candidate_path = root / "candidate.json"
            qa_path = root / "qa.json"
            previous_path.write_text(json.dumps({"outputs": [{
                "territory": territory, "mode": "car", "profile": "inspection",
                "path": str(old_artifact), "output_sha256": "a" * 64, "bytes": 11,
            }]}), encoding="utf-8")
            candidate_path.write_text(json.dumps({
                "family": "network", "scope": "inspection-refresh", "outputs": [{
                    "territory": territory, "mode": "car", "profile": "inspection",
                    "path": str(new_artifact), "output_sha256": hashlib.sha256(b"new bytes").hexdigest(),
                    "bytes": len(b"new bytes"),
                }],
            }), encoding="utf-8")
            qa_path.write_text(json.dumps({
                "status": "passed", "artifact_count": 1, "expected_artifact_count": 1,
                "profile_counts": {"inspection": 1}, "failures": [],
                "expected_outputs": [{
                    "key": "epci/243500139/car/inspection", "territory": territory,
                    "mode": "car", "profile": "inspection",
                }],
            }), encoding="utf-8")

            with self.assertRaisesRegex(ValueError, "no longer matches its manifest"):
                build_replacement_plan(previous_path, candidate_path, qa_path)

    def test_aedar_car_inspection_replacement_is_namespaced_and_car_only(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            old, new = root / "22001-car-inspection.webp", root / "candidate" / "22001-car-inspection.webp"
            new.parent.mkdir()
            old.write_bytes(b"old car image")
            new.write_bytes(b"new car image")
            territory = {"kind": "commune", "code": "22001", "name": "Allineuc"}
            previous, candidate, qa = root / "previous.json", root / "candidate.json", root / "qa.json"
            previous.write_text(json.dumps({"outputs": [{"territory": territory, "mode": "car",
                "profile": "inspection", "path": str(old),
                "output_sha256": hashlib.sha256(old.read_bytes()).hexdigest(), "bytes": old.stat().st_size}]}),
                encoding="utf-8")
            candidate.write_text(json.dumps({"family": "aedar", "scope": "inspection-refresh",
                "outputs": [{"territory": territory, "mode": "car", "profile": "inspection",
                "path": str(new), "output_sha256": hashlib.sha256(new.read_bytes()).hexdigest(),
                "bytes": new.stat().st_size}]}), encoding="utf-8")
            qa.write_text(json.dumps({"status": "passed", "failures": [], "artifact_count": 1,
                "expected_artifact_count": 1, "profile_counts": {"inspection": 1},
                "expected_outputs": [{"key": "commune/22001/car/inspection", "territory": territory,
                    "mode": "car", "profile": "inspection"}]}), encoding="utf-8")

            family = json.loads((Path(__file__).resolve().parents[1] / "aedar-static-family.json")
                                .read_text(encoding="utf-8"))
            plan = build_replacement_plan(previous, candidate, qa, prefix=family["prefix"],
                                          family="aedar", modes=("car",))
            outputs = validate_replacement_plan(plan)

        self.assertEqual(plan["family"], "aedar")
        self.assertEqual(plan["prefix"], family["prefix"])
        self.assertEqual(len(outputs), 1)
        self.assertEqual(outputs[0]["key"], f"{family['prefix']}22001-car-inspection.webp")
        self.assertIn(family["public_base_url"], outputs[0]["public_url"])


if __name__ == "__main__":
    unittest.main()
