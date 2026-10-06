import hashlib
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parents[1]))
import repair_department_titles as repair_module
from repair_department_titles import _department_inspection_binding, _verified_records
from runner import Binding, Foundation, MapSet, Recipe


class DepartmentTitleRepairTests(unittest.TestCase):
    @staticmethod
    def _key(row):
        territory = row["territory"]
        return territory["kind"], territory["code"], row["mode"], row["profile"]

    def test_selected_inventory_is_derived_and_keeps_only_departments(self):
        features = [
            {"territory": {"kind": "departement", "code": code, "name": name}, "mode": mode}
            for code, name in (("22", "Côtes-d'Armor"), ("29", "Finistère"))
            for mode in ("car", "walk", "bike")
        ] + [{"territory": {"kind": "region", "code": "53", "name": "Bretagne"},
              "mode": "car"}]
        binding, selected = _department_inspection_binding(
            Binding("network", MapSet({"all": features})))
        self.assertEqual(len(selected), 6)
        self.assertEqual(len(binding.map_set.layers["department-title-repair"]), len(selected))
        self.assertTrue(all(row["territory"]["kind"] == "departement" for row in selected))

    def test_full_manifest_hash_verification_fails_closed_before_mutation(self):
        with TemporaryDirectory() as folder:
            root = Path(folder)
            artifact = root / "map.webp"
            artifact.write_bytes(b"approved bytes")
            row = {"territory": {"kind": "departement", "code": "22"},
                "mode": "car", "profile": "inspection", "path": str(artifact),
                "output_sha256": hashlib.sha256(artifact.read_bytes()).hexdigest()}
            manifest = {"outputs": [row], "expected_outputs": [row]}
            self.assertEqual(len(_verified_records(manifest, root)), 1)
            before = json.dumps(manifest, sort_keys=True)
            artifact.write_bytes(b"corrupted bytes")
            with self.assertRaisesRegex(ValueError, "changed since approved QA"):
                _verified_records(manifest, root)
            self.assertEqual(json.dumps(manifest, sort_keys=True), before)

    def _operator_fixture(self, folder):
        root = Path(folder) / "production-output"
        root.mkdir()
        features = [{"territory": {"kind": "departement", "code": code, "name": name},
            "mode": mode, "geometry": f"geometry-{code}-{mode}"}
            for code, name in (("22", "Côtes-d'Armor"), ("29", "Finistère"))
            for mode in ("car", "walk", "bike")]
        binding = Binding("network", MapSet({"all": features}))
        records, expected = [], []
        for feature in features:
            territory = feature["territory"]
            for profile in ("inspection", "inline"):
                key = f"departement/{territory['code']}/{feature['mode']}/{profile}"
                artifact = root / f"{territory['code']}-{feature['mode']}-{profile}.webp"
                artifact.write_bytes(f"old:{key}".encode())
                row = {"territory": {**territory, "name": territory["code"]},
                    "mode": feature["mode"], "profile": profile, "path": str(artifact),
                    "effective_identity": self._identity(territory["code"], feature["mode"],
                        profile, territory["code"] if profile == "inspection" else ""),
                    "output_sha256": hashlib.sha256(artifact.read_bytes()).hexdigest(),
                    "artifact_contract": {"format": "webp"}}
                records.append(row)
                expected.append({"key": key, "territory": dict(row["territory"]),
                    "mode": feature["mode"], "profile": profile, "path": str(artifact)})
        manifest = {"scope": "full", "authoritative_inputs": {"source": "unchanged"},
            "expected_outputs": expected, "outputs": records, "renderer_identity": {"old": True}}
        qa = {"status": "passed", "production_status": "awaiting-human-spot-check",
            "artifact_count": len(records), "expected_artifact_count": len(expected),
            "expected_outputs": expected, "human_spot_check": {"status": "approved", "review_set": [],
                "outcome": {"reviewer": "prior reviewer"}}}
        (root / "full-manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
        (root / "full-qa.json").write_text(json.dumps(qa), encoding="utf-8")
        cache = {"outputs": {"/".join(self._key(row)): {"path": row["path"],
            "effective_identity": row["effective_identity"], "output_sha256": row["output_sha256"],
            "artifact_contract": {"format": "webp", "dimensions": [2400, 2400]}}
            for row in records}}
        (root / ".production-manifest.json").write_text(json.dumps(cache), encoding="utf-8")
        return root, binding, features, manifest, qa, cache

    @staticmethod
    def _identity(code, mode, profile, name):
        return hashlib.sha256(f"{code}/{mode}/{profile}/{name}".encode()).hexdigest()

    def _run_operator_fixture(self, folder, *, fail_write=None, corrupt_cache=False):
        root, binding, features, old_manifest, old_qa, old_cache = self._operator_fixture(folder)
        render_calls = []
        if corrupt_cache:
            old_cache["outputs"][next(iter(old_cache["outputs"]))]["output_sha256"] = "0" * 64
            (root / ".production-manifest.json").write_text(json.dumps(old_cache), encoding="utf-8")
        new_renderer = {"renderer": "current"}

        class Adapter:
            def input_identity(self):
                return {"source": "unchanged"}

        def fake_run(recipe, selected_binding, scope, profiles, adapter, stage_root, approval=None):
            render_calls.append(True)
            outputs = []
            for feature in features:
                key = ("departement", feature["territory"]["code"], feature["mode"], "inspection")
                staged = Path(stage_root) / f"{key[1]}-{key[2]}-inspection.webp"
                staged.write_bytes(f"new:{key}".encode())
                outputs.append({"territory": feature["territory"], "mode": feature["mode"],
                    "profile": "inspection", "path": str(staged),
                    "effective_identity": self._identity(key[1], key[2], "inspection", feature["territory"]["name"]),
                    "output_sha256": hashlib.sha256(staged.read_bytes()).hexdigest(),
                    "artifact_contract": {"format": "webp"}})
            return type("Result", (), {"outputs": outputs, "qa": {"status": "passed"}})()

        real_write = repair_module._write_json_atomic

        def write(path, value):
            if fail_write is not None and fail_write(path, value):
                raise OSError("injected durable-write failure")
            return real_write(path, value)

        patches = (
            patch.object(repair_module, "read_approval", return_value={"approval_identity": "current-approval"}),
            patch.object(repair_module, "build_full_map_set", return_value=binding),
            patch.object(repair_module, "network_recipe", return_value=Recipe("network", 1, Foundation("v1"), "network")),
            patch.object(repair_module, "NetworkAdapter", return_value=Adapter()),
            patch.object(repair_module, "_approval_gate", return_value=(new_renderer, [("rep", "member")])),
            patch.object(repair_module, "_effective_identity_for", side_effect=lambda recipe, adapter, renderer,
                feature, profile, hashes: self._identity(feature["territory"]["code"], feature["mode"],
                    profile.name, feature["territory"]["name"] if profile.name == "inspection" else "")),
            patch.object(repair_module, "run_production", side_effect=fake_run),
            patch.object(repair_module, "_write_json_atomic", side_effect=write),
        )
        with patches[0], patches[1], patches[2], patches[3], patches[4], patches[5], patches[6], patches[7]:
            try:
                repair_module.repair(root, Path(folder) / "raw", Path(folder) / "cache",
                    Path(folder) / "context", Path(folder) / "approval.json")
                error = None
            except Exception as caught:
                error = caught
        return root, old_manifest, old_qa, old_cache, error, render_calls

    def test_operator_success_reconciles_selected_outputs_and_retains_other_records(self):
        with TemporaryDirectory() as folder:
            root, old_manifest, old_qa, old_cache, error, _ = self._run_operator_fixture(folder)
            self.assertIsNone(error)
            manifest = json.loads((root / "full-manifest.json").read_text(encoding="utf-8"))
            qa = json.loads((root / "full-qa.json").read_text(encoding="utf-8"))
            self.assertEqual(len(manifest["repair_provenance"]["changed_outputs"]), 6)
            changed = {"/".join(self._key(row))
                for row in manifest["repair_provenance"]["changed_outputs"]}
            for before, after in zip(old_manifest["outputs"], manifest["outputs"]):
                if "/".join(self._key(before)) in changed:
                    self.assertNotEqual(after["territory"]["name"], after["territory"]["code"])
                else:
                    self.assertEqual(after["output_sha256"], before["output_sha256"])
            self.assertEqual(qa["status"], "passed")
            self.assertEqual(qa["production_status"], "awaiting-human-spot-check")
            self.assertEqual(qa["human_spot_check"]["status"], "pending")
            cache = json.loads((root / ".production-manifest.json").read_text())
            self.assertEqual(cache["outputs"].keys(), old_cache["outputs"].keys())
            for key in changed:
                self.assertEqual(cache["outputs"][key]["artifact_contract"],
                    old_cache["outputs"][key]["artifact_contract"])
                expected_row = next(row for row in manifest["expected_outputs"] if row["key"] == key)
                matching_output = next(row for row in manifest["outputs"]
                    if "/".join(self._key(row)) == key)
                self.assertEqual(expected_row["territory"], matching_output["territory"])
                self.assertEqual(qa["expected_outputs"], manifest["expected_outputs"])
                self.assertEqual(cache["outputs"][key]["effective_identity"],
                    next(row["effective_identity"] for row in manifest["outputs"]
                         if "/".join(self._key(row)) == key))
            self.assertEqual(json.loads((root / "department-title-repair-journal.json").read_text())["status"],
                "complete-awaiting-human-review")
            evidence = Path(manifest["repair_provenance"]["evidence_directory"])
            self.assertTrue((evidence / "full-qa.json").is_file())
            self.assertEqual(old_qa["status"], "passed")

    def test_cache_write_failure_never_leaves_full_qa_passed(self):
        with TemporaryDirectory() as folder:
            root, _, _, _, error, _ = self._run_operator_fixture(folder,
                fail_write=lambda path, value: Path(path).name == ".production-manifest.json")
            self.assertIsNotNone(error)
            qa = json.loads((root / "full-qa.json").read_text(encoding="utf-8"))
            journal = json.loads((root / "department-title-repair-journal.json").read_text(encoding="utf-8"))
            self.assertEqual(qa["status"], "incomplete")
            self.assertEqual(journal["status"], "promotion-incomplete")
            self.assertTrue(Path(journal["evidence_directory"], "full-qa.json").is_file())

    def test_journal_completion_failure_never_leaves_full_qa_passed(self):
        with TemporaryDirectory() as folder:
            root, _, _, _, error, _ = self._run_operator_fixture(folder,
                fail_write=lambda path, value: Path(path).name == "department-title-repair-journal.json"
                and value.get("status") == "complete-awaiting-human-review")
            self.assertIsNotNone(error)
            qa = json.loads((root / "full-qa.json").read_text(encoding="utf-8"))
            journal = json.loads((root / "department-title-repair-journal.json").read_text(encoding="utf-8"))
            self.assertEqual(qa["status"], "incomplete")
            self.assertEqual(journal["status"], "promotion-incomplete")

    def test_stale_cache_fails_before_render_and_leaves_approved_products_unchanged(self):
        with TemporaryDirectory() as folder:
            root, old_manifest, old_qa, _, error, render_calls = self._run_operator_fixture(
                folder, corrupt_cache=True)
            self.assertIsInstance(error, ValueError)
            self.assertIn("cache disagrees", str(error))
            self.assertEqual(render_calls, [])
            self.assertFalse((root / "repair-evidence").exists())
            self.assertEqual(json.loads((root / "full-manifest.json").read_text()), old_manifest)
            self.assertEqual(json.loads((root / "full-qa.json").read_text()), old_qa)
            for row in old_manifest["outputs"]:
                artifact = Path(row["path"])
                self.assertEqual(hashlib.sha256(artifact.read_bytes()).hexdigest(), row["output_sha256"])


if __name__ == "__main__":
    unittest.main()
