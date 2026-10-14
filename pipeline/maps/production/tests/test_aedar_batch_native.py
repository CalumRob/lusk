"""Bounded end-to-end verification of the real repository AEDAR child path."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import urllib.parse
import unittest

import pyarrow as pa
import pyarrow.parquet as pq
from qgis.core import QgsProject

sys.path.insert(0, str(Path(__file__).parents[1]))
sys.path.insert(0, str(Path(__file__).parent))
from qgis_fixture import qgis_application


class NativeAedarBatchTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        qgis_application()

    def test_real_aedar_child_path_at_one_two_four_workers_and_resume_guards(self):
        from test_aedar_car import CarProductionTests
        from aedar_map_plan import build_aedar_static_map_set
        from aedar_static import AddressFacts, FAMILY_CONFIG
        from inspection_frame import shared_ground_extent
        from mainland_context import acquire_context
        from webp_encoding import validate_webp

        raw, facts_path, registry, _config = CarProductionTests().geography_fixture()
        # Re-home the fixture under this test's registered temporary root.
        fixture_root = facts_path.parent
        root = fixture_root
        table = pq.read_table(facts_path).to_pydict()
        specs = FAMILY_CONFIG["modes"]
        for mode_index, (mode, spec) in enumerate(specs.items()):
            if mode == "car":
                continue
            # Every loss reading has a genuine, distinct pooled range.
            table[spec["value_field"]] = [mode_index + 1, mode_index + 2, mode_index + 3]
        pq.write_table(pa.table(table), facts_path)

        network_config = Path(__file__).parents[1] / "network-family.json"
        family = json.loads(network_config.read_text(encoding="utf-8"))
        family["scope"]["analytical_departments"] = ["22"]
        family_path = root / "network-family-fixture.json"
        family_path.write_text(json.dumps(family), encoding="utf-8")
        facts = AddressFacts(facts_path, root / "fixture-facts-cache")
        binding, inventory = build_aedar_static_map_set(raw, facts_path, facts=facts,
            family_config=family, territory_registry_path=registry)
        bases = inventory["territories"]
        extent = shared_ground_extent(bases, ("inspection", "inline"))
        bbox = (extent.xMinimum(), extent.yMinimum(), extent.xMaximum(), extent.yMaximum())
        context_cache = root / "validated-context"

        def local_context_response(url):
            query = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)
            if query.get("resultType") == ["hits"]:
                return b'<FeatureCollection numberMatched="1" timeStamp="fixture"/>'
            x0, y0, x1, y1 = bbox
            ring = [[x0-100, y0-100], [x1+100, y0-100], [x1+100, y1+100],
                    [x0-100, y1+100], [x0-100, y0-100]]
            return json.dumps({"type": "FeatureCollection", "numberMatched": 1,
                "numberReturned": 1,
                "crs": {"type": "name", "properties": {"name": "urn:ogc:def:crs:EPSG::2154"}},
                "features": [{"type": "Feature", "properties": {"cleabs": "FIXTURE-LAND",
                    "code_insee": "22001", "nom_officiel": "Fixture land"},
                    "geometry": {"type": "Polygon", "coordinates": [ring]}}]}).encode()

        acquire_context(context_cache, bbox, fetch=local_context_response)
        script = Path(__file__).parents[1] / "run_aedar_static_maps.py"

        def execute(workers, output, *extra):
            command = [sys.executable, "-B", str(script), "--raw-dir", str(raw),
                "--facts-path", str(facts_path), "--territory-registry", str(registry),
                "--family-config", str(family_path), "--context-cache-root", str(context_cache),
                "--output-dir", str(output), "--workers", str(workers), *extra]
            completed = subprocess.run(command, env=dict(os.environ, PYTHONIOENCODING="utf-8",
                PYTHONUNBUFFERED="1"), text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                timeout=240)
            if completed.returncode:
                self.fail(f"native AEDAR child run ({workers} workers) failed:\n{completed.stdout}")
            return completed.stdout

        outputs = {}
        for workers in (1, 2, 4):
            destination = root / f"native-{workers}"
            execute(workers, destination)
            plan = json.loads((destination / "full-plan.json").read_text(encoding="utf-8"))
            names, caches, sources = set(), set(), set()
            for index in range(workers):
                caches.add((destination / f"cache-{index}").resolve())
                sources.add((destination / f"source-{index}").resolve())
                self.assertTrue((destination / f"cache-{index}").is_dir())
                self.assertTrue((destination / f"source-{index}").is_dir())
                manifest = json.loads((destination / f"worker-{index}.manifest.json").read_text(encoding="utf-8"))
                for row in manifest["outputs"]:
                    names.add(Path(row["path"]).name)
                    validate_webp(row["path"], __import__("runner").PROFILES[row["profile"]])
            self.assertEqual(len(names), plan["expected_webps"])
            self.assertEqual(len(caches), workers)
            self.assertEqual(len(sources), workers)
            self.assertEqual(len({path.name for path in (destination).glob("cache-*" )}), workers)
            self.assertEqual(len({path.name for path in (destination).glob("source-*" )}), workers)
            expected_names = {FAMILY_CONFIG["filename_template"].format(
                code=row["territory"]["code"], mode=mode, profile=profile)
                for row in plan["territories"] for mode in FAMILY_CONFIG["modes"]
                for profile in FAMILY_CONFIG["profiles"]}
            self.assertEqual(names, expected_names)
            outputs[workers] = destination

        # Existing immutable checkpoints/output hashes permit a clean retry.
        failed_worker = subprocess.run([sys.executable, "-B", str(script), "--worker",
            "--worker-index", "999", "--workers", "1", "--raw-dir", str(raw),
            "--facts-path", str(facts_path), "--territory-registry", str(registry),
            "--family-config", str(family_path), "--context-cache-root", str(context_cache),
            "--output-dir", str(outputs[1]), "--worker-cache", str(outputs[1] / "cache-0"),
            "--worker-source-cache", str(outputs[1] / "source-0")],
            env=dict(os.environ, PYTHONIOENCODING="utf-8", PYTHONUNBUFFERED="1"),
            text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        self.assertNotEqual(failed_worker.returncode, 0)
        self.assertIn("IndexError", failed_worker.stdout)
        execute(1, outputs[1])
        retry_manifests = [json.loads(path.read_text(encoding="utf-8"))
            for path in outputs[1].glob("worker-*.manifest.json")]
        self.assertTrue(retry_manifests)
        self.assertTrue(all(row["decision"] == "reused-output"
            for manifest in retry_manifests for row in manifest["outputs"]))
        damaged_manifest = retry_manifests[0]
        damaged_path = Path(damaged_manifest["outputs"][0]["path"])
        damaged_path.write_bytes(b"corrupt WebP")
        execute(1, outputs[1])
        repaired_manifests = [json.loads(path.read_text(encoding="utf-8"))
            for path in outputs[1].glob("worker-*.manifest.json")]
        self.assertTrue(any(row["decision"] == "rendered"
            for manifest in repaired_manifests for row in manifest["outputs"]))
        validate_webp(damaged_path, __import__("runner").PROFILES[
            "inline" if "-inline." in damaged_path.name else "inspection"])
        # A worker-plan change cannot reinterpret the existing output directory.
        refused_workers = subprocess.run([sys.executable, "-B", str(script), "--raw-dir", str(raw),
            "--facts-path", str(facts_path), "--territory-registry", str(registry),
            "--family-config", str(family_path), "--context-cache-root", str(context_cache),
            "--output-dir", str(outputs[1]), "--workers", "2", "--check-only"],
            env=os.environ, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        self.assertNotEqual(refused_workers.returncode, 0)
        self.assertIn("worker count differs", refused_workers.stdout)

        # Changed authoritative facts are refused before resuming mixed provenance.
        changed = pq.read_table(facts_path).to_pydict()
        changed["diversity_car_15"][0] = 17
        pq.write_table(pa.table(changed), facts_path)
        refused_input = subprocess.run([sys.executable, "-B", str(script), "--raw-dir", str(raw),
            "--facts-path", str(facts_path), "--territory-registry", str(registry),
            "--family-config", str(family_path), "--context-cache-root", str(context_cache),
            "--output-dir", str(outputs[1]), "--workers", "1", "--check-only"],
            env=os.environ, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        self.assertNotEqual(refused_input.returncode, 0)
        self.assertIn("Plan inputs changed", refused_input.stdout)
        QgsProject.instance().clear()


if __name__ == "__main__":
    unittest.main()
