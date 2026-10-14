"""Owned, native-QGIS subprocess coverage for the supported network batch route."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

from qgis.core import (QgsApplication, QgsFeature, QgsGeometry, QgsPointXY,
    QgsProject, QgsVectorFileWriter, QgsVectorLayer)

PRODUCTION = Path(__file__).parents[1]
QGIS = Path(r"E:\Program Files\QGIS 3.44.14\bin\python-qgis-ltr.bat")
sys.path.insert(0, str(PRODUCTION))
from approval import approval_payload
from mainland_context import acquire_context
from network import (NetworkAdapter, build_full_map_set, build_representative_map_set,
    network_recipe)
from runner import PROFILES
from inspection_frame import shared_ground_extent


class NetworkBatchNativeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = QgsApplication([], False)
        cls.app.initQgis()
        cls.root = Path(tempfile.mkdtemp(prefix="lusk-network-batch-native-"))
        cls._build_fixture()

    @classmethod
    def tearDownClass(cls):
        QgsProject.instance().clear()
        cls.app.exitQgis()
        shutil.rmtree(cls.root, ignore_errors=True)

    @classmethod
    def _write_vector(cls, layer, path, driver, layer_name=None):
        options = QgsVectorFileWriter.SaveVectorOptions()
        options.driverName = driver
        if layer_name:
            options.layerName = layer_name
        result = QgsVectorFileWriter.writeAsVectorFormatV3(layer, str(path),
            QgsProject.instance().transformContext(), options)
        if result[0] != QgsVectorFileWriter.NoError:
            raise AssertionError(result)

    @classmethod
    def _build_fixture(cls):
        import pyarrow as pa
        import pyarrow.parquet as pq
        import urllib.parse
        root = cls.root / "pipeline"
        cls.raw = root / "data" / "raw"
        cls.raw.mkdir(parents=True)
        ext = root / "inst" / "extdata"
        metadata = ext / "theme-metadata"
        metadata.mkdir(parents=True)
        (ext / "epci_geo_api.json").write_text(json.dumps({"labels": [
            {"code": "243500741", "nom": "Fixture EPCI"}]}), encoding="utf-8")
        (metadata / "theme_mobilite.json").write_text(json.dumps({"source_records": {
            "osm_reseaux": {"publisher": "Fixture", "licence": "Données — Fixture licence"},
            "amenagements_cyclables": {"publisher": "Fixture", "licence": "Données — Fixture licence"}}}), encoding="utf-8")
        (metadata / "theme_milieux.json").write_text(json.dumps({"source_records": {
            "ocsge_artificialisation_fixture": {"publisher": "Fixture", "licence": "Données — Fixture licence"}}}), encoding="utf-8")
        cls.registry = cls.root / "territoires.json"
        cls.registry.write_text(json.dumps([{"territoire": code, "type": "departement", "nom": f"Fixture {code}"}
            for code in ("22", "29", "35", "56")]), encoding="utf-8")

        communes = QgsVectorLayer("MultiPolygon?crs=EPSG:2154"
            "&field=code_insee:string&field=nom_officiel:string"
            "&field=code_insee_du_departement:string&field=code_insee_de_la_region:string"
            "&field=codes_siren_des_epci:string", "tiny authoritative communes", "memory")
        rows = [("35238", "Rennes Fixture", "35", 0),
                ("22001", "Cotes Fixture", "22", 30000),
                ("29001", "Finistere Fixture", "29", 60000),
                ("56001", "Morbihan Fixture", "56", 90000)]
        for code, name, department, x in rows:
            feature = QgsFeature(communes.fields())
            feature.setAttributes([code, name, department, "53", "243500741"])
            geometry = QgsGeometry.fromWkt(
                f"POLYGON (({x} 0,{x+20000} 0,{x+20000} 20000,{x} 20000,{x} 0))")
            geometry.convertToMultiType()
            feature.setGeometry(geometry)
            communes.dataProvider().addFeature(feature)
        cls._write_vector(communes, cls.raw / "communes_limites.geojson", "GeoJSON")

        roads = QgsVectorLayer("LineString?crs=EPSG:2154&field=highway:string&field=other_tags:string",
            "tiny OSM network", "memory")
        for index, y in enumerate((5000, 10000)):
            feature = QgsFeature(roads.fields())
            feature.setAttributes(["primary", None if index == 0 else '"sidewalk"=>"yes"'])
            feature.setGeometry(QgsGeometry.fromPolylineXY([QgsPointXY(0, y), QgsPointXY(110000, y)]))
            roads.dataProvider().addFeature(feature)
        cls._write_vector(roads, cls.raw / "bretagne-latest.gpkg", "GPKG", "lines")

        parquet_path = cls.raw / "france-20260807.parquet"
        line_geom = QgsGeometry.fromPolylineXY([QgsPointXY(0, 6000), QgsPointXY(110000, 6000)])
        shared_geom = QgsGeometry.fromPolylineXY([QgsPointXY(0, 12000), QgsPointXY(110000, 12000)])
        geo_meta = {"version": "1.0.0", "primary_column": "geometry", "columns": {
            "geometry": {"encoding": "WKB", "geometry_types": ["LineString"],
                "crs": {"id": {"authority": "EPSG", "code": 2154}}}}}
        table = pa.table({"geometry": [bytes(line_geom.asWkb()), bytes(shared_geom.asWkb())],
            "ame_d": ["PISTE CYCLABLE", "BANDE CYCLABLE"], "ame_g": ["AUCUN", "AUCUN"]})
        table = table.replace_schema_metadata({b"geo": json.dumps(geo_meta).encode()})
        pq.write_table(table, parquet_path)

        ocsge_root = cls.raw / "extracted" / "ocsge"
        ocsge_root.mkdir(parents=True)
        for department in ("22", "29", "35", "56"):
            name = f"artif_2025_{department}"
            layer = QgsVectorLayer("MultiPolygon?crs=EPSG:2154&field=code_cs:string&field=code_us:string",
                name, "memory")
            feature = QgsFeature(layer.fields())
            feature.setAttributes(["CS2.1.1.1", None])
            geom = QgsGeometry.fromWkt("POLYGON ((1000 1000,50000 1000,50000 18000,1000 18000,1000 1000))")
            geom.convertToMultiType(); feature.setGeometry(geom); layer.dataProvider().addFeature(feature)
            cls._write_vector(layer, ocsge_root / f"{name}.gpkg", "GPKG", name)

        cls.context_root = cls.root / "validated-context"
        binding = build_full_map_set(cls.raw, territory_registry_path=cls.registry)
        cls.expected_artifact_members = {
            (feature["territory"]["kind"], feature["territory"]["code"], feature["mode"], profile)
            for features in binding.map_set.layers.values() for feature in features for profile in PROFILES}
        representatives = build_representative_map_set(cls.raw)
        for selected in (binding, representatives):
            extent = shared_ground_extent([f for rows in selected.map_set.layers.values() for f in rows],
                ("inspection", "inline"))
            bbox = (extent.xMinimum(), extent.yMinimum(), extent.xMaximum(), extent.yMaximum())
            def fetch(url, bbox=bbox):
                query = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)
                if query.get("resultType") == ["hits"]:
                    return b'<FeatureCollection numberMatched="1"/>'
                x0, y0, x1, y1 = bbox
                pad = max(x1-x0, y1-y0) * 2
                polygon = [[x0-pad,y0-pad],[x1+pad,y0-pad],[x1+pad,y1+pad],[x0-pad,y1+pad],[x0-pad,y0-pad]]
                return json.dumps({"type":"FeatureCollection", "numberMatched":1, "numberReturned":1,
                    "crs":{"type":"name","properties":{"name":"urn:ogc:def:crs:EPSG::2154"}},
                    "features":[{"type":"Feature","properties":{"cleabs":"FIXTURE-LAND",
                        "code_insee":"35238","nom_officiel":"Fixture land"},
                        "geometry":{"type":"Polygon","coordinates":[polygon]}}]}).encode()
            acquire_context(cls.context_root, bbox, fetch=fetch)

        adapter = NetworkAdapter(cls.raw, context_cache_root=cls.context_root)
        recipe = network_recipe()
        current = adapter.prepare_current_approval_members(recipe, binding, PROFILES,
            adapter.render_identity(), cls.root / "approval-current")
        manifest = {"scope": "representative", "approval_members": current,
            "recipe": recipe.name, "recipe_version": recipe.version,
            "foundation_version": recipe.foundation.version,
            "renderer_identity": adapter.render_identity()}
        approval = approval_payload(manifest)
        approval.update({"human_approved": True, "reviewer": "fixture owner",
            "visual_outcome": "approved"})
        cls.approval_path = cls.root / "fixture-approval.json"
        cls.approval_path.write_text(json.dumps(approval), encoding="utf-8")

    def _run(self, workers, output, driver=False, *, raw=None, approval=None):
        args = ["--approval", str(approval or self.approval_path), "--raw-dir", str(raw or self.raw),
            "--output-dir", str(output), "--territory-registry", str(self.registry),
            "--context-cache-root", str(self.context_root), "--workers", str(workers)]
        if driver:
            script = self.root / "fail-worker-driver.py"
            script.write_text("\n".join([
                "import sys",
                f"sys.path.insert(0, {str(PRODUCTION)!r})",
                "import batch_execution",
                "real = batch_execution.run_workers",
                "def fail_first(commands, *args, **kwargs):",
                "    commands = list(commands); command, env = commands[0]",
                "    command = list(command); command[command.index('--worker-index') + 1] = '999'",
                "    commands[0] = (command, env); return real(commands, *args, **kwargs)",
                "batch_execution.run_workers = fail_first",
                "import run_full_network",
                f"sys.argv = [{str(PRODUCTION / 'run_full_network.py')!r}, *{args!r}]",
                "run_full_network.main()"]), encoding="utf-8")
            cmd = [str(QGIS), "-B", str(script)]
        else:
            cmd = [str(QGIS), "-B", str(PRODUCTION / "run_full_network.py"), *args]
        result = subprocess.run(cmd, cwd=self.root, text=True, stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT, timeout=900, check=False)
        if result.returncode:
            (self.root.parent / "lusk-network-child-failure.log").write_text(result.stdout, encoding="utf-8")
            if output.exists():
                for log in output.glob("worker-*.log"):
                    shutil.copy2(log, self.root.parent / f"lusk-{output.name}-{log.name}")
        return result

    def test_supported_entrypoint_runs_native_full_network_at_1_2_4_and_resumes(self):
        for workers in (1, 2, 4):
            output = self.root / f"network-{workers}"
            result = self._run(workers, output)
            self.assertEqual(result.returncode, 0, result.stdout[-6000:])
            manifest = json.loads((output / "full-manifest.json").read_text(encoding="utf-8"))
            qa = json.loads((output / "full-qa.json").read_text(encoding="utf-8"))
            self.assertEqual(qa["status"], "passed")
            self.assertEqual(len(manifest["outputs"]), len(manifest["expected_outputs"]))
            actual_members = {(row["territory"]["kind"], row["territory"]["code"],
                row["mode"], row["profile"]) for row in manifest["outputs"]}
            self.assertEqual(actual_members, self.expected_artifact_members)
            self.assertEqual(len(actual_members), len(manifest["outputs"]))
            for index in range(workers):
                self.assertTrue((output / f"cache-{index}").is_dir())
                self.assertTrue((output / f"source-{index}").is_dir())
                worker_manifest = json.loads((output / f"worker-{index}.manifest.json").read_text(encoding="utf-8"))
                self.assertTrue(all(Path(row["path"]).parent == output / f"shard-{index}"
                    for row in worker_manifest["outputs"]))
        partial = self.root / "network-partial-4"
        failed = self._run(4, partial, driver=True)
        self.assertNotEqual(failed.returncode, 0)
        self.assertIn("Worker failure codes", failed.stdout)
        preserved = {}
        partial_members = set()
        for manifest_path in partial.glob("worker-*.manifest.json"):
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            for row in manifest["outputs"]:
                path = Path(row["path"])
                partial_members.add((row["territory"]["kind"], row["territory"]["code"],
                    row["mode"], row["profile"]))
                preserved[path] = (hashlib.sha256(path.read_bytes()).hexdigest(), path.stat().st_mtime_ns)
        self.assertTrue(preserved)
        missing_before = self.expected_artifact_members - partial_members
        self.assertGreater(len(missing_before), 0)
        self.assertEqual(len(partial_members) + len(missing_before), len(self.expected_artifact_members))
        resumed = self._run(4, partial)
        self.assertEqual(resumed.returncode, 0, resumed.stdout[-6000:])
        for path, record in preserved.items():
            self.assertEqual((hashlib.sha256(path.read_bytes()).hexdigest(), path.stat().st_mtime_ns), record)
        final = json.loads((partial / "full-manifest.json").read_text(encoding="utf-8"))
        self.assertEqual(len(final["outputs"]), len(final["expected_outputs"]))
        self.assertEqual({(row["territory"]["kind"], row["territory"]["code"],
            row["mode"], row["profile"]) for row in final["outputs"]}, self.expected_artifact_members)
        decisions = [row["decision"] for row in final["outputs"]]
        self.assertEqual(decisions.count("reused-output"), len(preserved))
        self.assertEqual(decisions.count("rendered"), len(missing_before))

        # Full inventory admission refuses before output creation or children.
        incomplete_root = self.root / "incomplete"
        shutil.copytree(self.raw, incomplete_root / "pipeline" / "data" / "raw")
        shutil.copytree(self.root / "pipeline" / "inst", incomplete_root / "pipeline" / "inst")
        incomplete_raw = incomplete_root / "pipeline" / "data" / "raw"
        inventory_path = incomplete_raw / "communes_limites.geojson"
        inventory = json.loads(inventory_path.read_text(encoding="utf-8"))
        inventory["features"] = [row for row in inventory["features"]
            if row["properties"]["code_insee_du_departement"] != "56"]
        inventory_path.write_text(json.dumps(inventory), encoding="utf-8")
        rejected_output = self.root / "rejected-inventory"
        rejected = self._run(4, rejected_output, raw=incomplete_raw)
        self.assertNotEqual(rejected.returncode, 0)
        self.assertRegex(rejected.stdout,
            "Full territory inventory mismatch|Authoritative commune geometry is missing|supported department 56 has no communes")
        self.assertFalse(rejected_output.exists())

        # A source mutation invalidates the current representative approval and
        # is refused before the existing plan can schedule any worker.
        drift_root = self.root / "drift"
        shutil.copytree(self.raw, drift_root / "pipeline" / "data" / "raw")
        shutil.copytree(self.root / "pipeline" / "inst", drift_root / "pipeline" / "inst")
        drift_raw = drift_root / "pipeline" / "data" / "raw"
        os.utime(drift_raw / "bretagne-latest.gpkg", None)
        drift_output = partial
        log_times = {path: path.stat().st_mtime_ns for path in drift_output.glob("worker-*.log")}
        drift = self._run(4, drift_output, raw=drift_raw)
        self.assertNotEqual(drift.returncode, 0)
        self.assertIn("Full network plan inputs", drift.stdout)
        self.assertEqual({path: path.stat().st_mtime_ns for path in log_times}, log_times)

        unapproved = json.loads(self.approval_path.read_text(encoding="utf-8"))
        unapproved["human_approved"] = False
        unapproved_path = self.root / "unapproved.json"
        unapproved_path.write_text(json.dumps(unapproved), encoding="utf-8")
        no_approval_output = self.root / "rejected-approval"
        no_approval = self._run(4, no_approval_output, approval=unapproved_path)
        self.assertNotEqual(no_approval.returncode, 0)
        self.assertIn("human_approved=true", no_approval.stdout)
        self.assertFalse(no_approval_output.exists())


if __name__ == "__main__":
    unittest.main()
