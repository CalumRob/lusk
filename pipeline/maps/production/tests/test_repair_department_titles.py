import hashlib
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import unittest

sys.path.insert(0, str(Path(__file__).parents[1]))
from repair_department_titles import _department_inspection_binding, _verified_records
from runner import Binding, MapSet


class DepartmentTitleRepairTests(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
