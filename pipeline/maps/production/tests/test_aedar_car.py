"""Car-only AEDAR production behaviour through bindings, runner and operators."""
from pathlib import Path
import json
import os
import sqlite3
from hashlib import sha256
import sys
import tempfile
import unittest
from unittest.mock import patch
import pyarrow as pa
import pyarrow.parquet as pq

sys.path.insert(0, str(Path(__file__).parents[1]))
from qgis.core import QgsProject, QgsVectorLayer
from pyproj import Transformer
from runner import Binding, MapSet, PROFILES, run_production
from webp_encoding import validate_webp
from pipeline.maps.production.tests.qgis_fixture import qgis_application
from pipeline.maps.production.tests.qgis_fixture import fixture_folder
from pipeline.maps.production.tests import test_aedar_hex_rendering as hex_fixture


class CarProductionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        qgis_application()

    def fixture(self):
        root, combined, old_adapter = hex_fixture.AedarHexRenderingTests().fixture()
        features = tuple({**f, "region_geometry": f["geometry"]}
                         for rows in combined.map_set.layers.values() for f in rows if f["mode"] == "car")
        return root, Binding("aedar", MapSet({"car": features})), old_adapter

    def test_runner_exports_native_car_webp_without_loss_metrics_or_overwriting_png_evidence(self):
        from aedar_car import AedarCarAdapter, aedar_car_recipe
        root, binding, old_adapter = self.fixture()
        output = root / "car-webp"
        output.mkdir()
        reference = output / "22001-car-inline.png"
        reference.write_bytes(b"historical PNG evidence")
        adapter = AedarCarAdapter(old_adapter.raw_dir, context_loader=old_adapter.context_loader)
        result = run_production(aedar_car_recipe(), binding, "representative", ("inline",), adapter, output)
        self.assertEqual(result.qa["status"], "passed", result.qa["failures"])
        self.assertEqual(len(result.outputs), 3)
        self.assertEqual({row["mode"] for row in result.outputs}, {"car"})
        for row in result.outputs:
            self.assertEqual(Path(row["path"]).suffix, ".webp")
            self.assertEqual(row["artifact_contract"]["quality"], 80)
            self.assertEqual(row["artifact_contract"]["method"], 4)
            self.assertEqual(row["artifact_contract"]["alpha_quality"], 100)
            image = validate_webp(row["path"], PROFILES["inline"])
            self.assertEqual(image.size, (900, 900))
            self.assertEqual(image.getpixel((1, 1))[3], 0)
        preparations = [row for row in result.manifest["stage_report"] if row["stage"] == "aedar-hex-grid"]
        self.assertTrue(all(row["metric_fields"] == ["diversity_car_15"] for row in preparations))
        self.assertEqual(sum(row["stage"] == "context-frontier" for row in result.manifest["stage_report"]), 1)
        self.assertTrue(any(row["stage"] == "context-land-union" for row in result.manifest["stage_report"]))
        self.assertEqual(reference.read_bytes(), b"historical PNG evidence")
        self.assertFalse(list(output.glob(".*.stage.webp")))
        QgsProject.instance().clear()

    def geography_fixture(self):
        root = fixture_folder(tempfile.mkdtemp(prefix="lusk-car-inventory-"))
        raw = root / "pipeline/data/raw"
        raw.mkdir(parents=True)
        metadata = root / "pipeline/inst/extdata"
        metadata.mkdir(parents=True)
        (metadata / "epci_geo_api.json").write_text(json.dumps({"labels": [
            {"code": "243500741", "nom": "CA Redon Agglomération"}]}), encoding="utf-8")
        registry = root / "territoires.json"
        registry.write_text(json.dumps([
            {"type": "departement", "territoire": "22", "nom": "Côtes-d'Armor"},
            {"type": "departement", "territoire": "35", "nom": "Ille-et-Vilaine"}]), encoding="utf-8")
        rows = []
        for index, (code, department, epci) in enumerate((
                ("22001", "22", ""), ("22002", "22", "243500741"),
                ("35238", "35", "243500741"), ("44123", "44", "243500741"))):
            x, y = 350000 + index * 100, 6789000
            rows.append({"type": "Feature", "properties": {"code_insee": code,
                "nom_officiel": code, "code_insee_du_departement": department,
                "code_insee_de_la_region": "53" if department in {"22", "35"} else "52",
                "codes_siren_des_epci": epci}, "geometry": {"type": "Polygon",
                "coordinates": [[[x, y], [x+10, y], [x+10, y+10], [x, y+10], [x, y]]]}})
        (raw / "communes_limites.geojson").write_text(json.dumps({"type": "FeatureCollection",
            "crs": {"type": "name", "properties": {"name": "EPSG:2154"}}, "features": rows}), encoding="utf-8")
        # The official context is a separate, wider land source, as in real
        # production; don't use zero-area intersections of identical boundaries.
        (raw / "official-land.geojson").write_text(json.dumps({"type": "FeatureCollection",
            "crs": {"type": "name", "properties": {"name": "EPSG:2154"}}, "features": [
                {"type": "Feature", "properties": {"code_insee": "context"}, "geometry": {
                    "type": "Polygon", "coordinates": [[[349500, 6788500], [351000, 6788500],
                    [351000, 6790000], [349500, 6790000], [349500, 6788500]]]}}]}), encoding="utf-8")
        ocsge = raw / "extracted/ocsge"
        ocsge.mkdir(parents=True)
        for department in ("22", "29", "35", "56"):
            layer = QgsVectorLayer("MultiPolygon?crs=EPSG:2154&field=code_cs:string&field=code_us:string", "ocsge", "memory")
            hex_fixture.AedarHexRenderingTests().write_layer(layer, ocsge / f"artif_2025_{department}.gpkg", "GPKG")
        lon, lat = Transformer.from_crs(2154, 4326, always_xy=True).transform(
            [350005, 350105, 350205], [6789005] * 3)
        facts = root / "car-only.parquet"
        pq.write_table(pa.table({"code_insee": ["22001", "22002", "35238"],
            "cle_interop_adr": ["A", "B", "C"], "lon": lon, "lat": lat,
            "diversity_car_15": [0, 100, 218]}), facts)
        return raw, facts, registry, {"scope": {"analytical_departments": ["22", "35"]}}

    def test_full_car_binding_uses_authoritative_inventory_and_breton_cross_border_membership(self):
        from aedar_car import build_aedar_car_map_set
        raw, facts, registry, config = self.geography_fixture()
        binding = build_aedar_car_map_set(raw, facts, scope="full", family_config=config,
                                         territory_registry_path=registry)
        features = [f for rows in binding.map_set.layers.values() for f in rows]
        self.assertEqual(len(features), 7)  # 3 communes + EPCI + 2 departments + region.
        self.assertEqual({f["mode"] for f in features}, {"car"})
        self.assertEqual({f["value_field"] for f in features}, {"diversity_car_15"})
        by_key = {(f["territory"]["kind"], f["territory"]["code"]): f for f in features}
        self.assertEqual(by_key[("departement", "22")]["territory"]["name"], "Côtes-d'Armor")
        self.assertEqual(by_key[("departement", "22")]["territory_codes"], ("22001", "22002"))
        self.assertEqual(by_key[("region", "53")]["territory_codes"], ("22001", "22002", "35238"))
        epci = by_key[("epci", "243500741")]
        self.assertEqual(epci["territory_codes"], ("22002", "35238"))
        self.assertAlmostEqual(epci["geometry"].area(), 300.0)
        self.assertAlmostEqual(epci["analytical_geometry"].area(), 200.0)
        self.assertTrue(all(f["scale_breaks"] == (0., 43.6, 87.2, 130.8, 174.4, 218.) for f in features))
        self.assertEqual(by_key[("commune", "22001")]["legend_label"],
                         "Types d’équipements accessibles en 15 minutes")

    def test_retry_reuses_only_verified_webp_and_failed_encoding_preserves_canonical_outputs(self):
        from aedar_car import AedarCarAdapter, aedar_car_recipe
        from webp_encoding import _pillow
        root, binding, old_adapter = self.fixture()
        output = root / "retry"
        def run(**kwargs):
            return run_production(aedar_car_recipe(), binding, "representative", ("inline",),
                AedarCarAdapter(old_adapter.raw_dir, context_loader=old_adapter.context_loader), output, **kwargs)
        first = run()
        hashes = {Path(row["path"]): row["output_sha256"] for row in first.outputs}
        with patch.object(_pillow().Image, "save", side_effect=OSError("injected encoder failure")):
            with self.assertRaisesRegex(RuntimeError, "systemic production failure"):
                run(refresh=True)
        self.assertTrue(all(sha256(path.read_bytes()).hexdigest() == digest for path, digest in hashes.items()))
        self.assertFalse(list(output.glob(".*.webp")), "Failed stages must not remain")
        retry = run()
        self.assertEqual(retry.qa["status"], "passed")
        self.assertTrue(all(row["decision"] == "reused-output" for row in retry.outputs))
        corrupt = next(iter(hashes))
        corrupt.write_bytes(b"broken WebP")
        repaired = run()
        self.assertEqual(repaired.qa["status"], "passed")
        self.assertEqual(sum(row["decision"] == "rendered" for row in repaired.outputs), 1)
        self.assertEqual(sum(row["decision"] == "reused-output" for row in repaired.outputs), 2)
        self.assertEqual(sha256(corrupt.read_bytes()).hexdigest(), hashes[corrupt])

    def test_six_webp_car_outputs_have_their_own_exact_human_approval_cohort(self):
        from aedar_car import AedarCarAdapter, aedar_car_recipe
        from approval import record_human_approval, read_approval, require_approval
        root, binding, old_adapter = self.fixture()
        adapter = AedarCarAdapter(old_adapter.raw_dir, context_loader=old_adapter.context_loader)
        result = run_production(aedar_car_recipe(), binding, "representative",
                                ("inspection", "inline"), adapter, root / "six-webp")
        self.assertEqual(result.qa["status"], "passed", result.qa["failures"])
        self.assertEqual(len(result.outputs), 6)
        proof = root / "human-car-approval.json"
        record_human_approval(result.manifest, result.qa, "fixture reviewer", "approved", proof,
                              representative_pairs=adapter.approval_pairs())
        require_approval(result.manifest, read_approval(proof), representative_pairs=adapter.approval_pairs())
        with self.assertRaisesRegex(ValueError, "exact current"):
            require_approval(result.manifest, read_approval(proof))  # Default remains network's 18.
        partial = {**result.manifest, "approval_members": result.manifest["approval_members"][:-1]}
        with self.assertRaisesRegex(ValueError, "missing an export profile"):
            require_approval(partial, read_approval(proof), representative_pairs=adapter.approval_pairs())

    def test_operator_full_run_requires_approval_before_building_inputs_or_creating_outputs(self):
        import run_aedar_car_maps
        root = fixture_folder(tempfile.mkdtemp(prefix="lusk-car-cli-no-approval-"))
        output = root / "must-not-exist"
        with self.assertRaises(SystemExit) as rejected:
            run_aedar_car_maps.main(["--scope", "full", "--raw-dir", str(root / "absent-raw"),
                                     "--output-dir", str(output)])
        self.assertEqual(rejected.exception.code, 2)
        self.assertFalse(output.exists())

    def test_full_gate_checks_live_car_evidence_before_mutating_the_full_output_directory(self):
        from aedar_car import AedarCarAdapter, aedar_car_recipe, build_aedar_car_map_set
        from record_aedar_car_approval import record_car_approval
        from approval import read_approval
        raw, facts, registry, config = self.geography_fixture()
        # Real OGR source order is not code order. Membership is a set, so
        # representative and full approval identities must not depend on it.
        geography = raw / "communes_limites.geojson"
        payload = json.loads(geography.read_text(encoding="utf-8"))
        payload["features"].reverse()
        geography.write_text(json.dumps(payload), encoding="utf-8")
        root = raw.parents[2]
        loader = lambda _cache, _bbox: (raw / "official-land.geojson", None)
        def adapter():
            return AedarCarAdapter(raw, context_loader=loader, family_config=config)
        representative = build_aedar_car_map_set(raw, facts)
        result = run_production(aedar_car_recipe(), representative, "representative",
                                ("inspection", "inline"), adapter(), root / "review")
        self.assertEqual(result.qa["status"], "passed", result.qa["failures"])
        proof = root / "approval.json"
        record_car_approval(result.manifest, result.qa, "fixture reviewer", "approved", proof)
        full = build_aedar_car_map_set(raw, facts, scope="full", family_config=config,
                                      territory_registry_path=registry)
        original = facts.read_bytes()
        table = pq.read_table(facts)
        table = table.set_column(table.schema.get_field_index("diversity_car_15"),
                                  "diversity_car_15", pa.array([0, 100, 217]))
        pq.write_table(table, facts)
        with self.assertRaisesRegex(ValueError, "stale or incomplete"):
            run_production(aedar_car_recipe(), full, "full", ("inspection", "inline"),
                           adapter(), root / "stale-must-not-exist", approval=read_approval(proof))
        self.assertFalse((root / "stale-must-not-exist").exists())
        facts.write_bytes(original)
        complete = run_production(aedar_car_recipe(), full, "full", ("inspection", "inline"),
                                  adapter(), root / "full-fixture", approval=read_approval(proof))
        self.assertEqual(complete.qa["status"], "passed", complete.qa["failures"])
        self.assertEqual(len(complete.outputs), 14)
        self.assertEqual(complete.qa["production_status"], "awaiting-human-spot-check")
        self.assertTrue(complete.qa["human_spot_check"]["review_set"])

    def test_invalid_car_facts_fail_before_output_or_shared_source_preparation(self):
        from aedar_car import AedarCarAdapter, aedar_car_recipe
        root, binding, old_adapter = self.fixture()
        facts = Path(binding.map_set.layers["car"][0]["facts_path"])
        table = pq.read_table(facts)
        for index, invalid in enumerate((None, float("nan"), -1, 219)):
            with self.subTest(invalid=invalid):
                broken = table.set_column(table.schema.get_field_index("diversity_car_15"),
                    "diversity_car_15", pa.array([invalid, 0, 20, 40, 218], type=pa.float64()))
                pq.write_table(broken, facts)
                output = root / f"invalid-{index}"
                with self.assertRaisesRegex(ValueError, "car facts"):
                    run_production(aedar_car_recipe(), binding, "representative", ("inline",),
                        AedarCarAdapter(old_adapter.raw_dir, context_loader=old_adapter.context_loader), output)
                self.assertFalse(output.exists())

    def test_car_binding_cannot_silently_clip_or_relabel_the_reviewed_absolute_scale(self):
        from aedar_car import AedarCarAdapter, aedar_car_recipe
        root, binding, old_adapter = self.fixture()
        for index, update in enumerate(({"scale_cap": 100.0}, {"scale_type": "continuous"},
                                         {"scale_overflow": True}, {"comparison": "equipment-loss"})):
            with self.subTest(update=update):
                altered = Binding("aedar", MapSet({"car": tuple({**feature, **update}
                    for feature in binding.map_set.layers["car"])}))
                with self.assertRaisesRegex(ValueError, "absolute-diversity scale"):
                    run_production(aedar_car_recipe(), altered, "representative", ("inline",),
                        AedarCarAdapter(old_adapter.raw_dir, context_loader=old_adapter.context_loader), root / f"scale-{index}")
                self.assertFalse((root / f"scale-{index}").exists())

    def test_changed_ground_bytes_with_same_size_and_timestamp_invalidate_inspection_evidence(self):
        from aedar_car import AedarCarAdapter, aedar_car_recipe
        from record_aedar_car_approval import record_car_approval
        from approval import read_approval, require_approval
        root, binding, old_adapter = self.fixture()
        def run():
            return run_production(aedar_car_recipe(), binding, "representative", ("inspection", "inline"),
                AedarCarAdapter(old_adapter.raw_dir, context_loader=old_adapter.context_loader), root / "ground-change")
        first = run()
        proof = root / "ground-approval.json"
        record_car_approval(first.manifest, first.qa, "fixture reviewer", "approved", proof)
        source = old_adapter.raw_dir / "extracted/ocsge/artif_2025_22.gpkg"
        before = source.stat()
        QgsProject.instance().clear()
        with sqlite3.connect(source) as database:
            database.execute("PRAGMA user_version=1")
        os.utime(source, ns=(before.st_atime_ns, before.st_mtime_ns))
        self.assertEqual(source.stat().st_size, before.st_size)
        self.assertEqual(source.stat().st_mtime_ns, before.st_mtime_ns)
        changed = run()
        self.assertEqual(changed.qa["status"], "passed", changed.qa["failures"])
        self.assertTrue(all(row["decision"] == "rendered" for row in changed.outputs if row["profile"] == "inspection"))
        with self.assertRaisesRegex(ValueError, "stale or incomplete"):
            require_approval(changed.manifest, read_approval(proof), representative_pairs=AedarCarAdapter.approval_pairs())

    def test_failed_staged_qa_preserves_canonical_outputs_and_marks_incomplete_coverage(self):
        from aedar_car import AedarCarAdapter, aedar_car_recipe
        root, binding, old_adapter = self.fixture()
        output = root / "staged-qa"
        class RejectOneArtifact(AedarCarAdapter):
            def validate(self, path, feature, profile):
                super().validate(path, feature, profile)
                if feature["territory"]["code"] == "22001":
                    raise ValueError("injected staged QA rejection")
        def run(adapter_type, **kwargs):
            return run_production(aedar_car_recipe(), binding, "representative", ("inline",),
                adapter_type(old_adapter.raw_dir, context_loader=old_adapter.context_loader), output, **kwargs)
        first = run(AedarCarAdapter)
        before = {Path(row["path"]): row["output_sha256"] for row in first.outputs}
        rejected = run(RejectOneArtifact, refresh=True)
        self.assertEqual(rejected.qa["status"], "incomplete")
        self.assertEqual(rejected.qa["artifact_count"], 2)
        self.assertEqual(rejected.qa["expected_artifact_count"], 3)
        self.assertTrue(all(sha256(path.read_bytes()).hexdigest() == value for path, value in before.items()))
        self.assertFalse(list(output.glob(".*.webp")))
        releases = [row for row in rejected.manifest["stage_report"] if row["stage"] == "aedar-territory-release"]
        self.assertEqual(len(releases), 3)
        self.assertTrue(all(row["retained_territory_entries"] == 0 for row in releases))
        self.assertFalse(releases[0]["success"])
        repaired = run(AedarCarAdapter)
        self.assertEqual(repaired.qa["status"], "passed")
        # A rejected refresh did not replace the earlier verified canonical
        # bytes. The checkpoint can safely recover them after fresh decoded QA.
        self.assertTrue(all(row["decision"] == "reused-output" for row in repaired.outputs))

    def test_inspection_copy_changes_invalidate_only_the_affected_profile(self):
        from aedar_car import AedarCarAdapter, aedar_car_recipe
        root, binding, old_adapter = self.fixture()
        def run(current):
            return run_production(aedar_car_recipe(), current, "representative", ("inspection", "inline"),
                AedarCarAdapter(old_adapter.raw_dir, context_loader=old_adapter.context_loader), root / "copy-change")
        first = run(binding)
        self.assertEqual(first.qa["status"], "passed")
        changed = Binding("aedar", MapSet({"car": tuple({**feature, "helper": "Updated helper"}
            if feature["territory"]["code"] == "22001" else feature for feature in binding.map_set.layers["car"])}))
        second = run(changed)
        self.assertEqual(second.qa["status"], "passed")
        rebuilt = [(row["territory"]["code"], row["profile"]) for row in second.outputs if row["decision"] == "rendered"]
        self.assertEqual(rebuilt, [("22001", "inspection")])

    def test_full_scope_rejects_incomplete_authoritative_inventory_before_output_mutation(self):
        from aedar_car import AedarCarAdapter, aedar_car_recipe, build_aedar_car_map_set
        raw, facts, registry, config = self.geography_fixture()
        complete = build_aedar_car_map_set(raw, facts, scope="full", family_config=config,
                                          territory_registry_path=registry)
        incomplete = Binding("aedar", MapSet({"car": tuple(feature for rows in complete.map_set.layers.values()
            for feature in rows if feature["territory"]["kind"] != "departement")}))
        output = raw.parents[2] / "incomplete-must-not-exist"
        with self.assertRaisesRegex(ValueError, "inventory mismatch"):
            run_production(aedar_car_recipe(), incomplete, "full", ("inspection", "inline"),
                AedarCarAdapter(raw, family_config=config), output)
        self.assertFalse(output.exists())


if __name__ == "__main__":
    unittest.main()
