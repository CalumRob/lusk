"""Tests for the local R2 upload helper's selected-QA boundary."""
import importlib.util
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest


HELPER = Path(__file__).resolve().parents[1] / "upload_maps.py"
SPEC = importlib.util.spec_from_file_location("upload_maps", HELPER)
upload_maps = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(upload_maps)


class UploadHelperTests(unittest.TestCase):
    def test_replacement_plan_uses_its_bound_qa_report(self):
        with TemporaryDirectory() as directory:
            qa_path = Path(directory) / "qa.json"
            plan = {"mode": "replace", "qa_path": str(qa_path)}

            self.assertEqual(upload_maps.plan_qa_path(plan), qa_path.resolve())
            self.assertEqual(upload_maps.plan_qa_path(plan, qa_path), qa_path.resolve())

    def test_replacement_plan_rejects_an_unrelated_qa_override(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            plan = {"mode": "replace", "qa_path": str(root / "bound-qa.json")}

            with self.assertRaisesRegex(ValueError, "must use its bound QA report"):
                upload_maps.plan_qa_path(plan, root / "other-approved-qa.json")

    def test_legacy_uploads_keep_their_existing_qa_default_and_override(self):
        with TemporaryDirectory() as directory:
            override = Path(directory) / "full-qa.json"

            self.assertEqual(upload_maps.plan_qa_path({"mode": "append"}), upload_maps.FULL_QA)
            self.assertEqual(upload_maps.plan_qa_path({"mode": "append"}, override), override)


if __name__ == "__main__":
    unittest.main()
