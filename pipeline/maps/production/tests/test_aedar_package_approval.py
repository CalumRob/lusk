"""Exact-package AEDAR human-decision recorder contract tests."""
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from package_aedar_maps import package_export
from record_aedar_package_approval import record_package_approval
import record_aedar_package_approval as recorder
import upload_maps
from test_aedar_package import AedarPackageTests


class AedarPackageApprovalTests(unittest.TestCase):
    def make_package(self, root):
        source, _ = AedarPackageTests().fixture(root)
        package = root / "package"
        package_export(source, package)
        return package

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
                if calls == 2:
                    raise OSError("simulated QA commit interruption")
                atomic(path, payload)
            with patch.object(recorder, "_atomic_bytes", side_effect=interrupt_qa):
                with self.assertRaisesRegex(OSError, "interruption"):
                    record_package_approval(package, "Reviewer", "approved")
            self.assertTrue((package / "human-approval.json").exists())
            self.assertEqual(json.loads((package / "full-qa.json").read_text())["human_spot_check"]["status"], "pending")
            record = record_package_approval(package, "Reviewer", "approved")
            self.assertEqual(json.loads((package / "full-qa.json").read_text())["human_spot_check"]["approval_id"], record["approval_id"])
            with self.assertRaisesRegex(ValueError, "another reviewer/outcome"):
                record_package_approval(package, "Other", "rejected")

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


if __name__ == "__main__":
    unittest.main()
