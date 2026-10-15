"""Exact-package AEDAR human-decision recorder contract tests."""
import json
import contextlib
import io
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from package_aedar_maps import package_export
from webp_encoding import _pillow
from record_aedar_package_approval import record_package_approval
import record_aedar_package_approval as recorder
import upload_maps
import test_aedar_package as package_fixtures


class AedarPackageApprovalTests(unittest.TestCase):
    def make_package(self, root):
        source, _ = package_fixtures.AedarPackageTests().fixture(root)
        package = root / "package"
        package_export(source, package)
        return package

    @staticmethod
    def write_json(path, value):
        path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    def rebind_full_and_upload(self, package, full, upload, qa):
        self.write_json(package / "full-manifest.json", full)
        digest = upload_maps.sha256(package / "full-manifest.json")
        upload["source_manifest_sha256"] = digest
        self.write_json(package / "upload-manifest.json", upload)
        qa["source_manifest_sha256"] = digest
        self.write_json(package / "full-qa.json", qa)

    def test_explicit_approval_records_exact_snapshot_and_is_idempotent(self):
        with TemporaryDirectory() as directory:
            package = self.make_package(Path(directory))
            record = record_package_approval(package, "Reviewer", "approved")
            self.assertEqual(record["schema"], "lusk.aedar.package-approval.v1")
            self.assertEqual(record["full_manifest_sha256"], upload_maps.sha256(package / "full-manifest.json"))
            self.assertEqual(record["upload_manifest_sha256"], upload_maps.sha256(package / "upload-manifest.json"))
            self.assertEqual(record["reviewed_qa_sha256"], json.loads((package / "full-qa.json").read_text())["approval_evidence"]["reviewed_qa_sha256"])
            previous = upload_maps.OUT
            try:
                upload_maps.configure_output(package)
                plan, items = upload_maps.load_plan(None)
                qa = upload_maps.plan_qa_path(plan)
                self.assertEqual(len(items), 10)
                self.assertTrue(upload_maps.upload_is_approved(qa)[0])
                output = io.StringIO()
                with patch.object(sys, "argv", ["upload_maps.py", "--output-dir", str(package)]), contextlib.redirect_stdout(output):
                    self.assertEqual(upload_maps.main(), 0)
                self.assertIn("DRY RUN OK", output.getvalue())
            finally:
                upload_maps.configure_output(previous)
            self.assertEqual(record_package_approval(package, "Reviewer", "approved"), record)
            with self.assertRaisesRegex(ValueError, "another reviewer/outcome"):
                record_package_approval(package, "Different", "rejected")

    def test_rejection_never_passes_uploader_approval_gate(self):
        with TemporaryDirectory() as directory:
            package = self.make_package(Path(directory))
            record_package_approval(package, "Reviewer", "rejected")
            allowed, _ = upload_maps.upload_is_approved(package / "full-qa.json")
            self.assertFalse(allowed)

    def test_record_first_interruption_retries_only_same_decision(self):
        with TemporaryDirectory() as directory:
            package = self.make_package(Path(directory))
            atomic = recorder._atomic_bytes
            calls = 0
            def interrupt_qa(path, payload):
                nonlocal calls
                calls += 1
                if calls == 3:
                    raise OSError("simulated QA commit interruption")
                atomic(path, payload)
            with patch.object(recorder, "_atomic_bytes", side_effect=interrupt_qa):
                with self.assertRaisesRegex(OSError, "interruption"):
                    record_package_approval(package, "Reviewer", "approved")
            self.assertTrue((package / "human-approval.json").exists())
            self.assertEqual(json.loads((package / "full-qa.json").read_text())["human_spot_check"]["status"], "pending")
            record_before, qa_before = tuple((package / name).read_bytes()
                for name in ("human-approval.json", "full-qa.json"))
            with self.assertRaisesRegex(ValueError, "reviewer/outcome/snapshot"):
                record_package_approval(package, "Other", "rejected")
            self.assertEqual((package / "human-approval.json").read_bytes(), record_before)
            self.assertEqual((package / "full-qa.json").read_bytes(), qa_before)
            self.assertFalse(upload_maps.upload_is_approved(package / "full-qa.json")[0])
            record = record_package_approval(package, "Reviewer", "approved")
            self.assertEqual(json.loads((package / "full-qa.json").read_text())["human_spot_check"]["approval_id"], record["approval_id"])
            with self.assertRaisesRegex(ValueError, "another reviewer/outcome"):
                record_package_approval(package, "Other", "rejected")

    def test_failure_preserving_original_qa_is_retryable_with_qa_still_pending(self):
        with TemporaryDirectory() as directory:
            package = self.make_package(Path(directory))
            qa_path = package / "full-qa.json"
            original = qa_path.read_bytes()
            atomic, calls = recorder._atomic_bytes, [0]
            def fail_history(path, payload):
                calls[0] += 1
                if calls[0] == 2:
                    raise OSError("history write interrupted")
                return atomic(path, payload)
            with patch.object(recorder, "_atomic_bytes", side_effect=fail_history):
                with self.assertRaisesRegex(OSError, "history write"):
                    record_package_approval(package, "Reviewer", "approved")
            self.assertEqual(qa_path.read_bytes(), original)
            self.assertTrue((package / "human-approval.json").exists())
            self.assertFalse((package / "evidence" / "human-approval" /
                f"full-qa-{upload_maps.sha256(qa_path)}.json").exists())
            record_package_approval(package, "Reviewer", "approved")
            record = json.loads((package / "human-approval.json").read_text())
            history = package / "evidence" / "human-approval" / f"full-qa-{record['reviewed_qa_sha256']}.json"
            self.assertEqual(upload_maps.sha256(history), record["reviewed_qa_sha256"])

    def test_changed_manifest_or_artifact_refuses_write(self):
        for target in ("manifest", "artifact"):
            with self.subTest(target=target), TemporaryDirectory() as directory:
                package = self.make_package(Path(directory))
                if target == "manifest":
                    full = json.loads((package / "full-manifest.json").read_text())
                    full["scope"] += " changed"
                    (package / "full-manifest.json").write_text(json.dumps(full))
                else:
                    image = next(package.glob("*.webp"))
                    image.write_bytes(b"changed")
                with self.assertRaises(ValueError):
                    record_package_approval(package, "Reviewer", "approved")
                self.assertFalse((package / "human-approval.json").exists())

    def test_invalid_container_dimensions_and_alpha_with_rebound_hashes_refuse_write(self):
        for case in ("container", "dimensions", "alpha"):
            with self.subTest(case=case), TemporaryDirectory() as directory:
                package = self.make_package(Path(directory))
                full = json.loads((package / "full-manifest.json").read_text())
                upload = json.loads((package / "upload-manifest.json").read_text())
                qa = json.loads((package / "full-qa.json").read_text())
                row = next(item for item in full["outputs"] if
                    (case == "alpha" and item["profile"] == "inline") or
                    (case != "alpha" and item["profile"] == "inspection"))
                artifact = package / row["filename"]
                if case == "container":
                    artifact.write_bytes(b"not a native WebP")
                elif case == "dimensions":
                    _pillow().new("RGB", (16, 16), (20, 40, 60)).save(artifact, "WEBP")
                else:
                    _pillow().new("RGBA", (900, 900), (20, 40, 60, 255)).save(artifact, "WEBP", lossless=True)
                row["bytes"], row["output_sha256"] = artifact.stat().st_size, upload_maps.sha256(artifact)
                worker_path = package / "evidence" / full["source_workers"][0]["manifest"]
                worker = json.loads(worker_path.read_text())
                source_row = next(item for item in worker["outputs"] if Path(item["path"]).name == row["filename"])
                source_row["bytes"], source_row["output_sha256"] = row["bytes"], row["output_sha256"]
                self.write_json(worker_path, worker)
                full["source_workers"][0]["sha256"] = upload_maps.sha256(worker_path)
                selected = next(item for item in upload["outputs"] if item["filename"] == row["filename"])
                selected["bytes"], selected["output_sha256"] = row["bytes"], row["output_sha256"]
                self.rebind_full_and_upload(package, full, upload, qa)
                original_qa = (package / "full-qa.json").read_bytes()
                with self.assertRaisesRegex(ValueError, "WebP|webp|dimensions|alpha"):
                    record_package_approval(package, "Reviewer", "approved")
                self.assertEqual((package / "full-qa.json").read_bytes(), original_qa)
                self.assertFalse((package / "human-approval.json").exists())

    def test_plan_inventory_blocks_rebound_package_missing_a_whole_staged_territory(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            source, outputs = package_fixtures.AedarPackageTests().fixture(root)
            first = outputs[0]["territory"]
            second = {"kind": first["kind"], "code": "99999", "name": "Fixture Two"}
            for row in list(outputs):
                original = Path(row["path"])
                clone = dict(row); clone["territory"] = second
                clone["path"] = str(original.with_name(original.name.replace(first["code"], second["code"])))
                Path(clone["path"]).write_bytes(original.read_bytes()); outputs.append(clone)
            self.write_json(source / "worker-0.manifest.json", {"family": "aedar", "outputs": outputs})
            self.write_json(source / "worker-0.qa.json", {"status": "passed", "failures": [],
                "artifact_count": 20, "expected_artifact_count": 20, "human_spot_check": {"status": "pending"}})
            plan = json.loads((source / "full-plan.json").read_text())
            plan["territory_count"], plan["expected_webps"] = 2, 20
            plan["territories"].append({"territory": second}); plan["shards"] = [[0, 1]]
            self.write_json(source / "full-plan.json", plan)
            complete = json.loads((source / "complete.json").read_text())
            complete["territories"], complete["artifacts"] = 2, 20
            self.write_json(source / "complete.json", complete)
            package = root / "package"; package_export(source, package)
            full = json.loads((package / "full-manifest.json").read_text())
            upload = json.loads((package / "upload-manifest.json").read_text())
            qa = json.loads((package / "full-qa.json").read_text())
            full["outputs"] = [row for row in full["outputs"] if row["territory"]["code"] != second["code"]]
            upload["outputs"] = [row for row in upload["outputs"] if row["territory"]["code"] != second["code"]]
            upload["upload_count"] = len(upload["outputs"])
            qa["artifact_count"] = qa["expected_artifact_count"] = len(full["outputs"])
            self.rebind_full_and_upload(package, full, upload, qa)
            with self.assertRaisesRegex(ValueError, "complete staged territory matrix"):
                record_package_approval(package, "Reviewer", "approved")
            self.assertFalse((package / "human-approval.json").exists())

    def test_bound_plan_expected_count_and_missing_overlap_are_rejected(self):
        for case in ("count", "overlap"):
            with self.subTest(case=case), TemporaryDirectory() as directory:
                package = self.make_package(Path(directory))
                plan_path = package / "evidence" / "full-plan.json"
                plan = json.loads(plan_path.read_text())
                full = json.loads((package / "full-manifest.json").read_text())
                upload = json.loads((package / "upload-manifest.json").read_text())
                qa = json.loads((package / "full-qa.json").read_text())
                if case == "count":
                    plan["expected_webps"] -= 1
                else:
                    plan["skipped_no_address_facts"].append(plan["territories"][0]["territory"])
                self.write_json(plan_path, plan)
                full["source_plan_sha256"] = upload_maps.sha256(plan_path)
                if case == "overlap":
                    full["missing_territories"] = plan["skipped_no_address_facts"]
                    upload["missing_territories"] = full["missing_territories"]
                    qa["missing_territories"] = full["missing_territories"]
                self.rebind_full_and_upload(package, full, upload, qa)
                with self.assertRaises(ValueError):
                    record_package_approval(package, "Reviewer", "approved")
                self.assertFalse((package / "human-approval.json").exists())

    def test_partial_selection_and_duplicate_matrix_refuse_write(self):
        for mutate in ("selection", "duplicate"):
            with self.subTest(mutate=mutate), TemporaryDirectory() as directory:
                package = self.make_package(Path(directory))
                path = package / ("upload-manifest.json" if mutate == "selection" else "full-manifest.json")
                data = json.loads(path.read_text())
                if mutate == "selection":
                    data["outputs"].pop()
                    data["upload_count"] -= 1
                else:
                    data["outputs"].append(data["outputs"][0])
                path.write_text(json.dumps(data))
                with self.assertRaises(ValueError):
                    record_package_approval(package, "Reviewer", "approved")

    def test_wrong_namespace_and_stale_qa_binding_refuse_write(self):
        for target in ("namespace", "qa"):
            with self.subTest(target=target), TemporaryDirectory() as directory:
                package = self.make_package(Path(directory))
                name = "upload-manifest.json" if target == "namespace" else "full-qa.json"
                path = package / name
                data = json.loads(path.read_text())
                if target == "namespace":
                    data["prefix"] = "maps/v1/"
                else:
                    data["source_manifest_sha256"] = "0" * 64
                path.write_text(json.dumps(data))
                with self.assertRaises(ValueError):
                    record_package_approval(package, "Reviewer", "approved")
                self.assertFalse((package / "human-approval.json").exists())

    def test_uploader_rejects_changed_aedar_artifact_even_with_manifest_claim(self):
        with TemporaryDirectory() as directory:
            package = self.make_package(Path(directory))
            record_package_approval(package, "Reviewer", "approved")
            image = next(package.glob("*.webp"))
            image.write_bytes(b"drift")
            previous = upload_maps.OUT
            try:
                upload_maps.configure_output(package)
                with self.assertRaisesRegex(ValueError, "artifact changed"):
                    upload_maps.load_plan(None)
            finally:
                upload_maps.configure_output(previous)

    def test_package_gate_refuses_missing_new_record_reference_or_file(self):
        with TemporaryDirectory() as directory:
            package = self.make_package(Path(directory))
            record_package_approval(package, "Reviewer", "approved")
            qa_path = package / "full-qa.json"
            self.assertTrue(upload_maps.upload_is_approved(qa_path)[0])
            qa = json.loads(qa_path.read_text()); qa["human_spot_check"].pop("record")
            self.write_json(qa_path, qa)
            self.assertFalse(upload_maps.upload_is_approved(qa_path)[0])
            qa["human_spot_check"]["record"] = "human-approval.json"
            self.write_json(qa_path, qa)
            self.assertFalse(upload_maps.upload_is_approved(qa_path)[0])
            # Restore exact bound QA, then remove only the record file.
            record = json.loads((package / "human-approval.json").read_text())
            from record_aedar_package_approval import _final_qa
            original_qa = json.loads((package / "evidence" / "human-approval" /
                f"full-qa-{record['reviewed_qa_sha256']}.json").read_text())
            qa_path.write_bytes(_final_qa(original_qa, record))
            (package / "human-approval.json").unlink()
            self.assertFalse(upload_maps.upload_is_approved(qa_path)[0])

    def test_package_gate_refuses_status_or_manifest_drift(self):
        for target in ("status", "manifest"):
            with self.subTest(target=target), TemporaryDirectory() as directory:
                package = self.make_package(Path(directory))
                record_package_approval(package, "Reviewer", "approved")
                qa_path = package / "full-qa.json"
                if target == "status":
                    qa = json.loads(qa_path.read_text()); qa["status"] = "failed"
                    self.write_json(qa_path, qa)
                else:
                    full_path = package / "full-manifest.json"
                    full = json.loads(full_path.read_text()); full["scope"] += " drift"
                    self.write_json(full_path, full)
                self.assertFalse(upload_maps.upload_is_approved(qa_path)[0])

    def test_coherent_legacy_static_record_remains_supported_and_immutable(self):
        with TemporaryDirectory() as directory:
            package = self.make_package(Path(directory))
            full_path, upload_path, qa_path = (package / name for name in
                ("full-manifest.json", "upload-manifest.json", "full-qa.json"))
            upload, qa = json.loads(upload_path.read_text()), json.loads(qa_path.read_text())
            full_hash, upload_hash = upload_maps.sha256(full_path), upload_maps.sha256(upload_path)
            qa["production_status"] = "complete"
            qa["human_spot_check"] = {"status": "approved", "approval_record": "human-spot-check.json",
                "source_manifest_sha256": full_hash, "source_upload_manifest_sha256": upload_hash}
            self.write_json(qa_path, qa)
            legacy = package / "human-spot-check.json"
            self.write_json(legacy, {"outcome": "approved", "approved_by": "Legacy reviewer",
                "recorded_at": "2026-01-01T00:00:00Z", "source_manifest_sha256": full_hash,
                "upload_manifest_sha256": upload_hash, "bucket": upload["bucket"], "prefix": upload["prefix"],
                "artifact_count": qa["artifact_count"], "profile_counts": qa["profile_counts"]})
            before = legacy.read_bytes()
            self.assertTrue(upload_maps.upload_is_approved(qa_path)[0])
            self.assertEqual(legacy.read_bytes(), before)


if __name__ == "__main__":
    unittest.main()
