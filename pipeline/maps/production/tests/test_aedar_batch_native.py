"""Bounded end-to-end verification of the real repository AEDAR child path."""
import json
from hashlib import sha256
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
from qgis_fixture import fixture_folder, qgis_application


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
        # Register the reused source builder's owned root with this module's
        # QGIS teardown so cleanup follows this process's application shutdown.
        root = fixture_folder(facts_path.parent)
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

        def arguments(workers, output, *extra):
            command = [sys.executable, "-B", str(script), "--raw-dir", str(raw),
                "--facts-path", str(facts_path), "--territory-registry", str(registry),
                "--family-config", str(family_path), "--context-cache-root", str(context_cache),
                "--output-dir", str(output), "--workers", str(workers), *extra]
            return command

        def run(command, timeout=300):
            return subprocess.run(command, env=dict(os.environ, PYTHONIOENCODING="utf-8",
                PYTHONUNBUFFERED="1"), text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                timeout=timeout)

        def execute(workers, output, *extra):
            completed = run(arguments(workers, output, *extra))
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

        # Fail one actual worker during a fresh four-worker entrypoint run.
        # The other three remain real QGIS AEDAR workers and persist validated
        # artifacts/checkpoints, leaving a partial output matrix for recovery.
        partial = root / "native-partial-4"
        driver = root / "fail-one-worker-driver.py"
        driver.write_text("\n".join([
            "import sys",
            "from pathlib import Path",
            "production = Path(sys.argv[1])",
            "sys.path.insert(0, str(production))",
            "import batch_execution",
            "real_run_workers = batch_execution.run_workers",
            "def fail_worker_zero(commands, *args, **kwargs):",
            "    commands = list(commands)",
            "    command, env = commands[0]",
            "    command = list(command)",
            "    command[command.index('--worker-index') + 1] = '999'",
            "    commands[0] = (command, env)",
            "    return real_run_workers(commands, *args, **kwargs)",
            "batch_execution.run_workers = fail_worker_zero",
            "import run_aedar_static_maps",
            "sys.argv = [str(production / 'run_aedar_static_maps.py'), *sys.argv[2:]]",
            "run_aedar_static_maps.main()",
        ]) + "\n", encoding="utf-8")
        failed_attempt = run([sys.executable, "-B", str(driver), str(script.parent),
            *arguments(4, partial)[3:]], timeout=360)
        self.assertNotEqual(failed_attempt.returncode, 0)
        self.assertIn("Worker failure codes", failed_attempt.stdout)
        self.assertIn("IndexError", failed_attempt.stdout)
        partial_plan = json.loads((partial / "full-plan.json").read_text(encoding="utf-8"))
        partial_expected = {FAMILY_CONFIG["filename_template"].format(
            code=row["territory"]["code"], mode=mode, profile=profile)
            for row in partial_plan["territories"] for mode in FAMILY_CONFIG["modes"]
            for profile in FAMILY_CONFIG["profiles"]}
        partial_records = []
        for manifest_path in partial.glob("worker-*.manifest.json"):
            worker_index = manifest_path.name.removeprefix("worker-").removesuffix(".manifest.json")
            qa = json.loads((partial / f"worker-{worker_index}.qa.json").read_text(encoding="utf-8"))
            self.assertEqual(qa["status"], "passed")
            partial_records.extend(json.loads(manifest_path.read_text(encoding="utf-8"))["outputs"])
        partial_names = [Path(row["path"]).name for row in partial_records]
        self.assertGreater(len(partial_names), 0)
        self.assertEqual(len(partial_names), len(set(partial_names)))
        self.assertLess(len(partial_names), len(partial_expected))
        partial_state = {Path(row["path"]):
            (sha256(Path(row["path"]).read_bytes()).hexdigest(), Path(row["path"]).stat().st_mtime_ns)
            for row in partial_records}
        missing_before = partial_expected - set(partial_names)
        self.assertGreater(len(missing_before), 0)

        # Resume the same signed plan normally. Successful workers' native bytes
        # must remain untouched/reused while the failed shard fills the gap.
        execute(4, partial)
        final_manifests = [json.loads(path.read_text(encoding="utf-8"))
            for path in partial.glob("worker-*.manifest.json")]
        final_records = [row for manifest in final_manifests for row in manifest["outputs"]]
        final_names = [Path(row["path"]).name for row in final_records]
        self.assertEqual(len(final_names), len(set(final_names)))
        self.assertEqual(set(final_names), partial_expected)
        self.assertEqual(json.loads((partial / "complete.json").read_text(encoding="utf-8"))["status"], "passed")
        final_by_path = {Path(row["path"]): row for row in final_records}
        self.assertTrue(all(final_by_path[path]["decision"] == "reused-output"
            for path in partial_state))
        self.assertTrue(all(sha256(path.read_bytes()).hexdigest() == digest
            and path.stat().st_mtime_ns == mtime
            for path, (digest, mtime) in partial_state.items()))
        resumed_missing = [row for row in final_records
            if Path(row["path"]).name in missing_before]
        self.assertEqual(len(resumed_missing), len(missing_before))
        self.assertTrue(all(row["decision"] == "rendered" for row in resumed_missing))
        print("native partial recovery: "
            f"expected={len(partial_expected)} completed_before={len(partial_names)} "
            f"reused={len(partial_state)} missing_before={len(missing_before)} "
            f"rendered_on_resume={len(resumed_missing)} final={len(final_names)}")

        # Existing immutable checkpoints/output hashes permit a clean retry.
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
