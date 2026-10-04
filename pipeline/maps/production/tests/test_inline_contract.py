"""End-to-end profile contract test for paper-only, shadowed inline maps."""
import json
import gc
import shutil
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path
import sys

from qgis.core import (
    QgsApplication,
    QgsFeature,
    QgsGeometry,
    QgsLineSymbol,
    QgsPointXY,
    QgsProject,
    QgsRectangle,
    QgsSingleSymbolRenderer,
    QgsVectorFileWriter,
    QgsVectorLayer,
)
from qgis.PyQt.QtGui import QColor, QImage

sys.path.insert(0, str(Path(__file__).parents[1]))

from network import NetworkAdapter, network_recipe  # noqa: E402
from runner import Binding, MapSet, run_production  # noqa: E402


class InlineProfileContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fixture_dirs = []
        cls.app = QgsApplication([], False)
        cls.app.initQgis()

    @classmethod
    def tearDownClass(cls):
        cls.app.exitQgis()
        gc.collect()
        for directory in cls.fixture_dirs:
            shutil.rmtree(directory, ignore_errors=True)

    def test_production_run_keeps_ocsge_in_inspection_and_uses_paper_shadow_frontier_inline(self):
        root = Path(tempfile.mkdtemp(prefix="lusk-inline-contract-"))
        self.__class__.fixture_dirs.append(root)
        raw = root / "pipeline" / "data" / "raw"
        raw.mkdir(parents=True)
        metadata = root / "pipeline" / "inst" / "extdata" / "theme-metadata"
        metadata.mkdir(parents=True)
        self._write_source_metadata(metadata)
        (metadata.parent / "epci_geo_api.json").write_text(json.dumps({
            "labels": [{"code": "243500741", "nom": "CA Redon Agglomération"}]
        }), encoding="utf-8")
        self._write_osm(raw / "bretagne-latest.gpkg")
        (raw / "france-20260807.parquet").write_bytes(b"not read for a car-only fixture")
        self._write_communes(raw / "communes_limites.geojson")
        self._write_ocsge(raw / "extracted" / "ocsge")

        analytical = QgsGeometry.fromWkt("POLYGON ((0 0,80 0,80 100,0 100,0 0))")
        full_territory = QgsGeometry.fromWkt("POLYGON ((0 0,100 0,100 100,0 100,0 0))")
        regional = QgsGeometry.fromWkt("POLYGON ((-10 -10,80 -10,80 110,-10 110,-10 -10))")
        feature = {
            "territory": {"kind": "epci", "code": "fixture", "name": "Fixture EPCI"},
            "mode": "car",
            "geometry": full_territory,
            "analytical_geometry": analytical,
            "region_geometry": regional,
            "extent": QgsRectangle(-10, -10, 110, 110),
        }
        binding = Binding("network", MapSet({"network-outputs": (feature,)}))
        output = root / "outputs"
        adapter = NetworkAdapter(raw, cache_root=root / "network-cache", official_context=False)
        recipe = network_recipe()
        self.assertEqual(recipe.foundation.ground["inline_surface"], "paper-only")
        self.assertEqual(
            recipe.foundation.composition["inline"]["shadow"],
            {
                "blur_radius_px": 6,
                "sigma_px": 3.0,
                "offset_px": {"x": 0, "y": 2},
                "opacity": 0.25,
            },
        )
        try:
            result = run_production(
                recipe, binding, "representative", ("inspection", "inline"),
                adapter, output,
            )
        finally:
            QgsProject.instance().clear()
            del adapter
            gc.collect()

        self.assertEqual(result.qa["status"], "passed")
        self.assertEqual(result.qa["artifact_count"], 2)
        sources = {
            item["name"]: item
            for item in result.manifest["authoritative_inputs"]["sources"]
        }
        self.assertTrue({
            "osm-network", "analytical-commune-geometry",
            "mobility-citations", "land-citations", "ocsge-22", "ocsge-29",
            "ocsge-35", "ocsge-56",
        }.issubset(sources))
        self.assertEqual(sources["osm-network"]["layer"], "lines")
        self.assertEqual(
            set(result.manifest["renderer_identity"]["runtime"]),
            {"qgis", "qt", "pyqt", "python"},
        )
        inspection = QImage(str(output / "fixture-car-inspection.png"))
        inline = QImage(str(output / "fixture-car-inline.png"))
        self.assertFalse(inspection.isNull())
        self.assertFalse(inline.isNull())

        # The synthetic OCS-GE woodland occupies map coordinates 20..40,
        # 40..60. Its inspection pixel is tinted green, while the inline
        # profile retains the same textured paper as a nearby bare pixel.
        inspection_pixel = inspection.pixelColor(1067, 1600)
        inline_ocs_pixel = inline.pixelColor(300, 450)
        inline_bare_pixel = inline.pixelColor(450, 450)
        self.assertLess(inspection_pixel.green(), 200)
        self.assertGreater(inline_ocs_pixel.green(), 220)
        self.assertLess(
            max(abs(inline_ocs_pixel.red() - inline_bare_pixel.red()),
                abs(inline_ocs_pixel.green() - inline_bare_pixel.green()),
                abs(inline_ocs_pixel.blue() - inline_bare_pixel.blue())),
            18,
        )

        # The synthetic cross-border EPCI's regional frontier is visible at
        # the analytical cut-out edge. Its shadow stays under 25% alpha;
        # distant exterior remains fully transparent.
        frontier_pixels = [
            inline.pixelColor(x, y)
            for x in range(673, 678)
            for y in range(180, 720)
        ]
        self.assertGreater(
            sum(pixel.red() < 180 and pixel.green() < 190 for pixel in frontier_pixels),
            20,
        )
        halo = [inline.pixelColor(x, 452).alpha() for x in range(676, 685)]
        self.assertTrue(any(0 < alpha <= 64 for alpha in halo), halo)
        self.assertGreater(inline.pixelColor(680, 452).alpha(), 0)
        self.assertEqual(inline.pixelColor(682, 452).alpha(), 0)
        self.assertEqual(inline.pixelColor(750, 450).alpha(), 0)

    def test_visible_network_source_change_invalidates_only_affected_map_content(self):
        root = Path(tempfile.mkdtemp(prefix="lusk-effective-network-"))
        self.__class__.fixture_dirs.append(root)
        raw = root / "pipeline" / "data" / "raw"
        raw.mkdir(parents=True)
        metadata = root / "pipeline" / "inst" / "extdata" / "theme-metadata"
        metadata.mkdir(parents=True)
        self._write_source_metadata(metadata)
        (metadata.parent / "epci_geo_api.json").write_text(json.dumps({"labels": []}), encoding="utf-8")
        self._write_osm(raw / "bretagne-latest.gpkg")
        (raw / "france-20260807.parquet").write_bytes(b"unused bike source")
        self._write_communes(raw / "communes_limites.geojson")
        self._write_ocsge(raw / "extracted" / "ocsge")
        feature = {"territory": {"kind": "epci", "code": "fixture", "name": "Fixture"},
            "mode": "car", "geometry": QgsGeometry.fromWkt("POLYGON ((0 0,80 0,80 100,0 100,0 0))"),
            "analytical_geometry": QgsGeometry.fromWkt("POLYGON ((0 0,80 0,80 100,0 100,0 0))"),
            "region_geometry": QgsGeometry.fromWkt("POLYGON ((-10 -10,80 -10,80 110,-10 110,-10 -10))"),
            "extent": QgsRectangle(-10, -10, 110, 110)}
        binding = Binding("network", MapSet({"network-outputs": (feature,)}))
        output = root / "outputs"

        def run(source=raw, profiles=("inspection", "inline"), destination=output, recipe=None,
                geometry_variant=False):
            QgsProject.instance().clear()
            adapter = NetworkAdapter(source, cache_root=root / ("network-cache-" + source.parent.name), official_context=False)
            original_geometry = feature["analytical_geometry"]
            if geometry_variant:
                feature["analytical_geometry"] = QgsGeometry.fromWkt(
                    "POLYGON ((5 5,75 5,75 95,5 95,5 5))")
            try:
                result = run_production(recipe or network_recipe(), binding, "representative", profiles,
                    adapter, destination)
            finally:
                feature["analytical_geometry"] = original_geometry
            del adapter
            QgsProject.instance().clear()
            gc.collect()
            return result

        try:
            cold = run()
            warm = run()
            context = [item for item in warm.qa["stage_report"] if item["stage"] == "context-land-union"]
            self.assertEqual([(item["decision"], item["identity"]) for item in context],
                [("reused", next(item["identity"] for item in cold.qa["stage_report"]
                    if item["stage"] == "context-land-union"))])
            self.assertEqual({item["decision"] for item in warm.outputs}, {"reused-output"})
            self.assertEqual({item["decision"] for item in warm.qa["stage_report"]
                if item["stage"] == "territory-ground"}, {"reused"})
            context_identity = next(item["identity"] for item in warm.qa["stage_report"]
                if item["stage"] == "context-land-union")
            context_stage = output / ".stage-cache" / "context-land" / context_identity
            context_manifest = json.loads((context_stage / "manifest.json").read_text(encoding="utf-8"))
            context_artifact = context_stage / context_manifest["generation"] / "context.wkb"
            context_artifact.write_bytes(b"broken effective context")
            context_repaired = run()
            self.assertEqual({item["decision"] for item in context_repaired.outputs}, {"reused-output"},
                (warm.outputs, context_repaired.outputs))
            self.assertEqual(next(item["decision"] for item in context_repaired.qa["stage_report"]
                if item["stage"] == "context-land-union"), "built")

            inline_output = next(item for item in warm.outputs if item["profile"] == "inline")
            inline_stage = next(item["identity"] for item in warm.qa["stage_report"]
                if item["stage"] == "territory-ground" and item["profile"] == "inline")
            ground_manifest = output / ".stage-cache" / "ground" / inline_stage / "manifest.json"
            ground_manifest.write_text('{"schema":1,"files":[]}', encoding="utf-8")
            Path(inline_output["path"]).unlink()
            ground_repaired = run()
            self.assertEqual({item["profile"]: item["decision"] for item in ground_repaired.outputs},
                {"inspection": "reused-output", "inline": "rendered"})
            self.assertTrue(any(item["stage"] == "territory-ground" and item["profile"] == "inline"
                and item["decision"] == "built" for item in ground_repaired.qa["stage_report"]))
            outside_raw = self._raw_variant(root / "outside", car_y=80, base=raw, outside_extra=True)
            outside = run(outside_raw)
            self.assertEqual({item["decision"] for item in outside.outputs}, {"reused-output"})
            self.assertEqual([item["effective_identity"] for item in outside.outputs],
                [item["effective_identity"] for item in warm.outputs])

            changed_raw = self._raw_variant(root / "changed", car_y=55, base=raw)
            changed = run(changed_raw)
            self.assertEqual({item["decision"] for item in changed.outputs}, {"rendered"})
            self.assertNotEqual(changed.manifest["approval_identity"], outside.manifest["approval_identity"])

            citations_raw = self._raw_variant(root / "citations", car_y=55, base=raw)
            metadata_path = citations_raw.parent.parent / "inst" / "extdata" / "theme-metadata" / "theme_mobilite.json"
            citation_payload = json.loads(metadata_path.read_text(encoding="utf-8"))
            citation_payload["source_records"]["osm_reseaux"]["licence"] = "Données — ODbL modifiée"
            metadata_path.write_text(json.dumps(citation_payload), encoding="utf-8")
            citations = run(citations_raw)
            self.assertEqual({item["profile"]: item["decision"] for item in citations.outputs},
                {"inspection": "rendered", "inline": "reused-output"})

            unrelated_raw = self._raw_variant(root / "unrelated-metadata", car_y=55, base=citations_raw)
            unrelated_path = unrelated_raw.parent.parent / "inst" / "extdata" / "theme-metadata" / "theme_mobilite.json"
            unrelated_payload = json.loads(unrelated_path.read_text(encoding="utf-8"))
            unrelated_payload["source_records"]["unconsumed-record"] = {"publisher": "Not rendered"}
            unrelated_payload["source_records"]["amenagements_cyclables"] = {
                "publisher": "Unused in car citation", "licence": "Never drawn"
            }
            unrelated_path.write_text(json.dumps(unrelated_payload), encoding="utf-8")
            unrelated = run(unrelated_raw)
            self.assertEqual({item["decision"] for item in unrelated.outputs}, {"reused-output"})

            ocs_raw = self._raw_variant(root / "ocsge", car_y=55, base=raw)
            ocs_dir = ocs_raw / "extracted" / "ocsge"
            shutil.rmtree(ocs_dir)
            self._write_ocsge(ocs_dir, x_offset=5)
            ocs_changed = run(ocs_raw)
            self.assertEqual({item["profile"]: item["decision"] for item in ocs_changed.outputs},
                {"inspection": "rendered", "inline": "reused-output"})

            far_a = self._raw_variant(root / "ocsge-far-a", car_y=55, base=raw)
            shutil.rmtree(far_a / "extracted" / "ocsge")
            self._write_ocsge(far_a / "extracted" / "ocsge", x_max=150)
            far_a_run = run(far_a)
            far_b = self._raw_variant(root / "ocsge-far-b", car_y=55, base=raw)
            shutil.rmtree(far_b / "extracted" / "ocsge")
            self._write_ocsge(far_b / "extracted" / "ocsge", x_max=500)
            far_b_run = run(far_b)
            self.assertEqual({item["decision"] for item in far_b_run.outputs}, {"reused-output"})
            self.assertEqual([item["effective_identity"] for item in far_a_run.outputs],
                [item["effective_identity"] for item in far_b_run.outputs])

            with patch("map_ground.INLINE_MASK_RENDER_VERSION", 2):
                mask_changed = run(far_b)
            self.assertEqual({item["profile"]: item["decision"] for item in mask_changed.outputs},
                {"inspection": "reused-output", "inline": "rendered"})

            recipe_changed = run(far_b, recipe=self._recipe_with_shadow_opacity(0.30))
            self.assertEqual({item["profile"]: item["decision"] for item in recipe_changed.outputs},
                {"inspection": "reused-output", "inline": "rendered"})
            inspection_recipe = self._recipe_with_inspection_desaturation(
                False, recipe=self._recipe_with_shadow_opacity(0.30))
            inspection_changed = run(far_b, recipe=inspection_recipe)
            self.assertEqual({item["profile"]: item["decision"] for item in inspection_changed.outputs},
                {"inspection": "rendered", "inline": "reused-output"})

            inline_raw = self._raw_variant(root / "inline-no-inspection-inputs", car_y=55, base=raw)
            shutil.rmtree(inline_raw.parent.parent / "inst" / "extdata" / "theme-metadata")
            shutil.rmtree(inline_raw / "extracted" / "ocsge")
            inline_only = run(inline_raw, profiles=("inline",), destination=output / "inline-only")
            self.assertEqual(len(inline_only.outputs), 1)
            with self.assertRaises(FileNotFoundError):
                run(inline_raw, profiles=("inspection",), destination=output / "missing-inspection")
            changed_shape = run(inline_raw, profiles=("inline",), geometry_variant=True)
            self.assertEqual({item["decision"] for item in changed_shape.outputs}, {"rendered"})
            self.assertEqual(next(item["decision"] for item in changed_shape.qa["stage_report"]
                if item["stage"] == "context-frontier"), "reused")
        finally:
            QgsProject.instance().clear()

    def test_public_run_invalidates_when_network_stroke_influence_moves_at_profile_edges(self):
        root = Path(tempfile.mkdtemp(prefix="lusk-stroke-influence-"))
        self.__class__.fixture_dirs.append(root)
        output = root / "outputs"
        feature = {
            "territory": {"kind": "epci", "code": "edge", "name": "Edge"},
            "mode": "car",
            "geometry": QgsGeometry.fromWkt("POLYGON ((0 0,100 0,100 100,0 100,0 0))"),
            "region_geometry": QgsGeometry.fromWkt("POLYGON ((-10 -10,80 -10,80 110,-10 110,-10 -10))"),
            "analytical_geometry": QgsGeometry.fromWkt("POLYGON ((0 0,80 0,80 100,0 100,0 0))"),
            "extent": QgsRectangle(-10, -10, 110, 110),
        }
        binding = Binding("network", MapSet({"outputs": [feature]}))

        def source(name, exterior_x):
            raw = root / name / "pipeline" / "data" / "raw"
            raw.mkdir(parents=True)
            self._write_communes(raw / "communes_limites.geojson")
            metadata = root / name / "pipeline" / "inst" / "extdata" / "theme-metadata"
            metadata.mkdir(parents=True)
            self._write_source_metadata(metadata)
            layer = QgsVectorLayer(
                "LineString?crs=EPSG:2154&field=highway:string&field=other_tags:string",
                "stroke fixture", "memory",
            )
            for highway, wkt in (
                ("primary", "LINESTRING (20 40,60 40)"),
                ("primary", f"LINESTRING ({exterior_x} 10,{exterior_x} 90)"),
                ("footway", "LINESTRING (20 60,60 60)"),
            ):
                item = QgsFeature(layer.fields())
                item.setAttributes([highway, None])
                item.setGeometry(QgsGeometry.fromWkt(wkt))
                self.assertTrue(layer.dataProvider().addFeature(item))
            self._write_gpkg(layer, raw / "bretagne-latest.gpkg", "lines")
            self._write_ocsge(raw / "extracted" / "ocsge")
            return raw

        def run(raw, profiles, *, refresh=False):
            QgsProject.instance().clear()
            adapter = NetworkAdapter(raw, cache_root=root / ("network-cache-" + raw.parents[2].name), official_context=False)
            return run_production(network_recipe(), binding, "representative", profiles,
                adapter, output, refresh=refresh)

        first_raw = source("near-inline-edge", 80.01)
        moved_inline_raw = source("moved-inline-edge", 85)
        try:
            first = run(first_raw, ("inline",))
            measured_stages = {item["stage"] for item in first.qa["stage_report"]}
            self.assertTrue({"effective-identity-network-scan", "effective-identity-visible-ground",
                "effective-content-fingerprint-total", "profile-render-contract",
                "output-cache-verification", "territory-ground-identity-total",
                "territory-ground-cache-validation"}.issubset(measured_stages), measured_stages)
            moved = run(moved_inline_raw, ("inline",))
            first_scope = [item for item in first.qa["stage_report"]
                if item["stage"] == "effective-network-influence-scope"]
            moved_scope = [item for item in moved.qa["stage_report"]
                if item["stage"] == "effective-network-influence-scope"]
            self.assertEqual([item["decision"] for item in first_scope], ["built"])
            self.assertEqual([item["decision"] for item in moved_scope], ["reused"])
            scope_artifact = next((root / "outputs" / ".stage-cache" / "network-influence-scope")
                .glob("*/scope.wkb"))
            scope_artifact.write_bytes(b"corrupt influence scope")
            repaired_scope = run(moved_inline_raw, ("inline",))
            repaired_scope_event = next(item for item in repaired_scope.qa["stage_report"]
                if item["stage"] == "effective-network-influence-scope")
            self.assertEqual(repaired_scope_event["decision"], "built")
            self.assertEqual(repaired_scope.outputs[0]["decision"], "reused-output")
            forced = run(moved_inline_raw, ("inline",), refresh=True)
            self.assertEqual(moved.outputs[0]["decision"], "rendered")
            self.assertNotEqual(first.outputs[0]["effective_identity"], moved.outputs[0]["effective_identity"])
            self.assertNotEqual(first.outputs[0]["output_sha256"], forced.outputs[0]["output_sha256"])
            self.assertEqual(moved.outputs[0]["output_sha256"], forced.outputs[0]["output_sha256"])

            far_raw = source("far-from-inline-edge", 95)
            far = run(far_raw, ("inline",))
            self.assertEqual(far.outputs[0]["decision"], "reused-output")

            with patch("network.NETWORK_LINE_WIDTH_MM", "0.50"):
                wider_stroke = run(moved_inline_raw, ("inline",))
            self.assertEqual(wider_stroke.outputs[0]["decision"], "rendered")
            self.assertNotEqual(moved.outputs[0]["effective_identity"],
                                wider_stroke.outputs[0]["effective_identity"])

            frame_edge_raw = source("near-frame-edge", 109.99)
            moved_frame_raw = source("moved-frame-edge", 105)
            frame_edge = run(frame_edge_raw, ("inspection",))
            moved_frame = run(moved_frame_raw, ("inspection",))
            forced_frame = run(moved_frame_raw, ("inspection",), refresh=True)
            ocsge_events = [item for item in frame_edge.qa["stage_report"]
                if item["stage"] in {"territory-ground-identity-ocsge-scan", "effective-identity-ocsge-scan"}]
            self.assertTrue(ocsge_events, frame_edge.qa["stage_report"])
            self.assertTrue(any(item["decision"] == "reused-in-run" for item in ocsge_events), ocsge_events)
            self.assertEqual(moved_frame.outputs[0]["decision"], "rendered")
            self.assertNotEqual(frame_edge.outputs[0]["effective_identity"],
                                moved_frame.outputs[0]["effective_identity"])
            self.assertNotEqual(frame_edge.outputs[0]["output_sha256"],
                                forced_frame.outputs[0]["output_sha256"])
            self.assertEqual(moved_frame.outputs[0]["output_sha256"],
                             forced_frame.outputs[0]["output_sha256"])
        finally:
            QgsProject.instance().clear()

    def test_persistent_ground_stage_is_shared_by_modes_and_warm_run(self):
        root = Path(tempfile.mkdtemp(prefix="lusk-shared-ground-"))
        self.__class__.fixture_dirs.append(root)
        raw = root / "pipeline" / "data" / "raw"
        raw.mkdir(parents=True)
        self._write_osm(raw / "bretagne-latest.gpkg")
        (raw / "france-20260807.parquet").write_bytes(b"unused bike source")
        self._write_communes(raw / "communes_limites.geojson")
        base = {"territory": {"kind": "epci", "code": "shared", "name": "Shared"},
            "mode": "car", "geometry": QgsGeometry.fromWkt("POLYGON ((0 0,80 0,80 100,0 100,0 0))"),
            "analytical_geometry": QgsGeometry.fromWkt("POLYGON ((0 0,80 0,80 100,0 100,0 0))"),
            "region_geometry": QgsGeometry.fromWkt("POLYGON ((-10 -10,80 -10,80 110,-10 110,-10 -10))"),
            "extent": QgsRectangle(-10, -10, 110, 110)}
        features = []
        for mode in ("car", "walk", "bike"):
            feature = dict(base)
            feature["mode"] = mode
            features.append(feature)
        binding = Binding("network", MapSet({"outputs": features}))
        output = root / "outputs"

        def fake_prepare(project, features, raw_dir, config, cache_root, *, force=False, report=None):
            layers = {}
            for mode in ("car", "walk", "bike"):
                layer = QgsVectorLayer("LineString?crs=EPSG:2154", f"fixture {mode}", "memory")
                mark = "bike-protected" if mode == "bike" else mode
                symbol = QgsLineSymbol.createSimple({"color": config["marks"][mark], "width": "0.8"})
                layer.setRenderer(QgsSingleSymbolRenderer(symbol))
                project.addMapLayer(layer)
                feature = QgsFeature(layer.fields())
                feature.setGeometry(QgsGeometry.fromPolylineXY([QgsPointXY(5, 70), QgsPointXY(75, 70)]))
                layer.dataProvider().addFeature(feature)
                layers[mode] = [layer]
            return layers

        def run(car_colour=None, refresh=False):
            QgsProject.instance().clear()
            adapter = NetworkAdapter(raw, cache_root=root / "network-cache", official_context=False)
            if car_colour is not None:
                config_path = root / "network-family.json"
                config = json.loads(adapter.family_config_path.read_text(encoding="utf-8"))
                config["marks"]["car"] = car_colour
                config_path.write_text(json.dumps(config), encoding="utf-8")
                adapter.family_config_path = config_path
                adapter.family_config = config
            return run_production(network_recipe(), binding, "representative", ("inline",),
                adapter, output, refresh=refresh)

        try:
            with patch("network._prepare_network_layers", side_effect=fake_prepare):
                cold = run()
                ground = [item for item in cold.qa["stage_report"] if item["stage"] == "territory-ground"]
                self.assertEqual(sum(item["decision"] == "built" for item in ground), 1, ground)
                self.assertEqual(sum(item["decision"] == "shared-in-run" for item in ground), 2, ground)
                visible_derivatives = [item for item in cold.qa["stage_report"]
                    if item["stage"] == "visible-ground-derivatives"]
                self.assertEqual(sum(item["decision"] == "built" for item in visible_derivatives), 1,
                    visible_derivatives)
                self.assertTrue(any(item["decision"] == "reused-in-run" for item in visible_derivatives),
                    visible_derivatives)
                identities = {item["identity"] for item in ground}
                self.assertEqual(len(identities), 1, ground)
                warm = run()
                refreshed = run(refresh=True)
            warm_ground = [item for item in warm.qa["stage_report"] if item["stage"] == "territory-ground"]
            self.assertEqual(len(warm_ground), 3)
            self.assertEqual({item["decision"] for item in warm_ground}, {"reused"})
            self.assertEqual({item["identity"] for item in warm_ground}, identities)
            warm_derivatives = [item for item in warm.qa["stage_report"]
                if item["stage"] == "visible-ground-derivatives"]
            self.assertTrue(warm_derivatives, warm.qa["stage_report"])
            self.assertTrue(all(item["decision"] in {"reused", "reused-in-run"}
                for item in warm_derivatives), warm_derivatives)
            self.assertEqual({item["decision"] for item in refreshed.outputs}, {"rendered"})
            self.assertEqual(next(item["decision"] for item in refreshed.qa["stage_report"]
                if item["stage"] == "context-land-union"), "built")
            self.assertEqual(next(item["decision"] for item in refreshed.qa["stage_report"]
                if item["stage"] == "context-frontier"), "built")
            with patch("network._prepare_network_layers", side_effect=fake_prepare):
                recoloured = run("#123456")
            self.assertEqual({item["mode"]: item["decision"] for item in recoloured.outputs},
                {"car": "rendered", "walk": "reused-output", "bike": "reused-output"})
        finally:
            QgsProject.instance().clear()
    def _recipe_with_shadow_opacity(self, opacity):
        from dataclasses import replace
        recipe = network_recipe()
        composition = dict(recipe.foundation.composition)
        inline = dict(composition["inline"])
        shadow = dict(inline["shadow"])
        shadow["opacity"] = opacity
        inline["shadow"] = shadow
        composition["inline"] = inline
        return replace(recipe, foundation=replace(recipe.foundation, composition=composition))

    def _recipe_with_inspection_desaturation(self, enabled, recipe=None):
        from dataclasses import replace
        recipe = recipe or network_recipe()
        composition = dict(recipe.foundation.composition)
        composition["inspection"] = dict(composition["inspection"])
        composition["inspection"]["desaturate_outside_land"] = enabled
        return replace(recipe, foundation=replace(recipe.foundation, composition=composition))

    def _raw_variant(self, directory, car_y, base, outside_extra=False):
        directory = directory / "pipeline" / "data" / "raw"
        directory.mkdir(parents=True)
        self._write_osm(directory / "bretagne-latest.gpkg", car_y=car_y, outside_extra=outside_extra,
                irrelevant_attributes=outside_extra)
        shutil.copy2(base / "france-20260807.parquet", directory / "france-20260807.parquet")
        shutil.copy2(base / "communes_limites.geojson", directory / "communes_limites.geojson")
        shutil.copytree(base / "extracted", directory / "extracted")
        metadata = directory.parent.parent / "inst" / "extdata" / "theme-metadata"
        metadata.mkdir(parents=True)
        original_metadata = base.parent.parent / "inst" / "extdata"
        shutil.copy2(original_metadata / "epci_geo_api.json", metadata.parent / "epci_geo_api.json")
        shutil.copytree(original_metadata / "theme-metadata", metadata, dirs_exist_ok=True)
        return directory

    def _write_source_metadata(self, directory):
        (directory / "theme_mobilite.json").write_text(json.dumps({
            "source_records": {
                "osm_reseaux": {"publisher": "OpenStreetMap", "licence": "Données — ODbL"},
                "amenagements_cyclables": {"publisher": "Geovelo", "licence": "Données — Licence Ouverte"},
            }
        }), encoding="utf-8")
        (directory / "theme_milieux.json").write_text(json.dumps({
            "source_records": {
                "ocsge_artificialisation_fixture": {"publisher": "IGN", "licence": "Données — Licence Ouverte"}
            }
        }), encoding="utf-8")

    def _write_osm(self, path, car_y=80, outside_extra=False, irrelevant_attributes=False):
        layer = QgsVectorLayer(
            "LineString?crs=EPSG:2154&field=highway:string&field=other_tags:string",
            "OSM fixture", "memory",
        )
        features = []
        roads = [("primary", car_y), ("footway", 70)]
        if outside_extra:
            roads.append(("primary", 500))
        for highway, y in roads:
            feature = QgsFeature(layer.fields())
            feature.setAttributes([highway, "irrelevant-change" if irrelevant_attributes else None])
            points = [QgsPointXY(5, y), QgsPointXY(150 if highway == "primary" else 75, y)]
            if outside_extra and highway == "primary":
                points[-1] = QgsPointXY(500, y)
            feature.setGeometry(QgsGeometry.fromPolylineXY(points))
            features.append(feature)
        self.assertTrue(layer.dataProvider().addFeatures(features))
        self._write_gpkg(layer, path, "lines")

    def _write_communes(self, path):
        layer = QgsVectorLayer(
            "MultiPolygon?crs=EPSG:2154&field=code_insee_du_departement:string",
            "context fixture", "memory",
        )
        feature = QgsFeature(layer.fields())
        feature.setAttributes(["22"])
        geometry = QgsGeometry.fromWkt(
            "POLYGON ((-10 -10,110 -10,110 110,-10 110,-10 -10))"
        )
        geometry.convertToMultiType()
        feature.setGeometry(geometry)
        self.assertTrue(layer.dataProvider().addFeature(feature))
        options = QgsVectorFileWriter.SaveVectorOptions()
        options.driverName = "GeoJSON"
        result = QgsVectorFileWriter.writeAsVectorFormatV3(
            layer, str(path), QgsProject.instance().transformContext(), options
        )
        self.assertEqual(result[0], QgsVectorFileWriter.NoError, result)

    def _write_ocsge(self, directory, x_offset=0, x_max=40):
        directory.mkdir(parents=True)
        for department in ("22", "29", "35", "56"):
            name = f"artif_2025_{department}"
            path = directory / f"{name}.gpkg"
            if path.exists():
                path.unlink()
            layer = QgsVectorLayer(
                "MultiPolygon?crs=EPSG:2154&field=code_cs:string&field=code_us:string",
                f"OCS-GE {department}", "memory",
            )
            feature = QgsFeature(layer.fields())
            feature.setAttributes(["CS2.1.1.1", None])
            geometry = QgsGeometry.fromWkt(
                f"POLYGON (({20+x_offset} 40,{x_max+x_offset} 40,{x_max+x_offset} 60,{20+x_offset} 60,{20+x_offset} 40))"
            )
            geometry.convertToMultiType()
            feature.setGeometry(geometry)
            self.assertTrue(layer.dataProvider().addFeature(feature))
            self._write_gpkg(layer, path, name)

    def _write_gpkg(self, layer, path, layer_name):
        options = QgsVectorFileWriter.SaveVectorOptions()
        options.driverName = "GPKG"
        options.layerName = layer_name
        if path.exists():
            path.unlink()
        result = QgsVectorFileWriter.writeAsVectorFormatV3(
            layer, str(path), QgsProject.instance().transformContext(), options
        )
        self.assertEqual(result[0], QgsVectorFileWriter.NoError, result)


if __name__ == "__main__":
    unittest.main()
