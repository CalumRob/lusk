"""Public production-run proof of shared AEDAR inline grid preparation."""
import gc
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

import pyarrow as pa
import pyarrow.parquet as pq
from pyproj import Transformer
from qgis.core import (QgsApplication, QgsFeature, QgsGeometry, QgsProject,
                       QgsRectangle, QgsVectorFileWriter, QgsVectorLayer)
from qgis.PyQt.QtGui import QColor, QImage

sys.path.insert(0, str(Path(__file__).parents[1]))
from aedar_map_content import loss_map_content
from aedar_maps import AedarMapAdapter, LOSS_MODES, TERRITORIES, aedar_loss_recipe
from inspection_plate import _font, _load_static_face
from runner import Binding, MapSet, PROFILES, run_production
from pipeline.maps.production.tests.qgis_fixture import fixture_folder, qgis_application


class AedarHexRenderingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = qgis_application()

    @classmethod
    def tearDownClass(cls):
        QgsProject.instance().clear()
        gc.collect()

    def test_registered_inspection_font_remains_available_after_scratch_exits(self):
        assets = Path(__file__).parents[1] / "assets"
        with tempfile.TemporaryDirectory(prefix="lusk-font-lifetime-") as temporary:
            family = _load_static_face("mozilla-headline", 400, assets, Path(temporary))
            self.assertEqual(family, "Mozilla Headline")
        self.assertEqual(_font("Mozilla Headline", 30).family(), "Mozilla Headline")

    def fixture(self):
        root = fixture_folder(tempfile.mkdtemp(prefix="lusk-aedar-hex-render-"))
        raw = root / "pipeline/data/raw"
        raw.mkdir(parents=True)
        extent = QgsRectangle(350000, 6789000, 350900, 6789900)
        geometry = QgsGeometry.fromRect(QgsRectangle(350050, 6789050, 350850, 6789850))
        communes = QgsVectorLayer("MultiPolygon?crs=EPSG:2154&field=code_insee:string", "communes", "memory")
        for code in ("22001", "35238"):
            feature = QgsFeature(communes.fields())
            shape = QgsGeometry.fromRect(extent)
            shape.convertToMultiType()
            feature.setGeometry(shape)
            feature.setAttributes([code])
            self.assertTrue(communes.dataProvider().addFeature(feature))
        self.write_layer(communes, raw / "communes_limites.geojson", "GeoJSON")
        ocsge = raw / "extracted/ocsge"
        ocsge.mkdir(parents=True)
        for department in ("22", "29", "35", "56"):
            layer = QgsVectorLayer("MultiPolygon?crs=EPSG:2154&field=code_cs:string&field=code_us:string", "ocsge", "memory")
            self.write_layer(layer, ocsge / f"artif_2025_{department}.gpkg", "GPKG")
        lon, lat = Transformer.from_crs(2154, 4326, always_xy=True).transform(
            [350134.8, 350135, 350135.2, 350225, 350450],
            [6789822.1, 6789822.1, 6789822.1, 6789822.1, 6789500])
        fields = {"car": "diversity_car_15", "transit": "loss_car_only_transit_p1_15",
                  "bike_lts2": "loss_car_only_bike_lts2_15",
                  "bike_lts4": "loss_car_only_bike_lts4_15", "walk": "loss_car_only_walk_15"}
        facts = root / "metrics.parquet"
        pq.write_table(pa.table({"code_insee": ["22001"] * 4 + ["35238"],
                                 "cle_interop_adr": ["A", "B", "C", "D", "E"],
                                 "lon": lon, "lat": lat,
                                 fields["car"]: [0, 0, 20, 40, 218],
                                 fields["transit"]: [0, 0, 20, 40, 218],
                                 fields["bike_lts2"]: [10, 10, 10, 60, 150],
                                 fields["bike_lts4"]: [20, 40, 60, 80, 100],
                                 fields["walk"]: [100, 100, 200, 150, 218]}), facts)
        features = []
        for kind, code in TERRITORIES:
            for mode in LOSS_MODES:
                content = loss_map_content(mode)
                cap = 218.0 if mode == "car" else 100.0
                features.append({"territory": {"kind": kind, "code": code, "name": "Fixture"},
                                 "geometry": geometry, "analytical_geometry": geometry,
                                 "extent": extent, "mode": mode, "source_mode": mode,
                                 "facts_path": str(facts), "value_field": fields[mode],
                                 "territory_codes": ("22001",) if kind == "commune" else ("22001", "35238"),
                                 "measure": "diversity" if mode == "car" else "equipment_loss",
                                 "horizon": 15, "comparison": "car-only-typequ", "scale_type": "equal-width",
                                 "scale_cap": cap, "scale_breaks": tuple(cap * i / 5 for i in range(6)),
                                 "scale_overflow": mode != "car", **content})
        adapter = AedarMapAdapter(raw, context_loader=lambda _cache, _bbox: (raw / "communes_limites.geojson", None))
        return root, Binding("aedar", MapSet({"fixture": tuple(features)})), adapter

    def write_layer(self, layer, path, driver):
        options = QgsVectorFileWriter.SaveVectorOptions()
        options.driverName = driver
        if driver == "GPKG":
            options.layerName = path.stem
        result = QgsVectorFileWriter.writeAsVectorFormatV3(
            layer, str(path), QgsProject.instance().transformContext(), options)
        self.assertEqual(result[0], QgsVectorFileWriter.NoError, result)

    def test_five_inline_modes_reuse_one_grid_per_territory_and_keep_zero_distinct_from_empty(self):
        root, binding, adapter = self.fixture()
        result = run_production(aedar_loss_recipe(), binding, "representative",
                                ("inline",), adapter, root / "outputs")
        self.assertEqual(result.qa["status"], "passed", result.qa["failures"])
        preparations = [row for row in result.manifest["stage_report"]
                        if row["stage"] == "aedar-hex-grid" and row["decision"] == "built"]
        self.assertEqual(len(preparations), 3)
        self.assertEqual({row["territory"]: row["occupied_cells"] for row in preparations},
                          {"commune/22001": 2, "epci/243500741": 3, "region/53": 3})
        self.assertTrue(all(len(row["metric_fields"]) == 5 for row in preparations))
        reuse = [row for row in result.manifest["stage_report"]
                 if row["stage"] == "aedar-hex-grid" and row["decision"] == "reused"]
        self.assertEqual(len(reuse), 12)
        image = QImage(str(root / "outputs/22001-transit-inline.png"))
        zero, empty = image.pixelColor(135, 78), image.pixelColor(165, 78)
        self.assertGreater(zero.red() - zero.green(), 25)
        self.assertLess(abs(empty.red() - empty.green()), 15)
        self.assertEqual(image.pixelColor(1, 1).alpha(), 0)
        QgsProject.instance().clear()

    def test_both_profiles_prepare_address_geometry_once_and_release_each_territory(self):
        root, binding, adapter = self.fixture()
        result = run_production(aedar_loss_recipe(), binding, "representative",
                                ("inspection", "inline"), adapter, root / "both-profiles")
        self.assertEqual(result.qa["status"], "passed", result.qa["failures"])
        self.assertEqual(len(result.outputs), 30)
        points = [row for row in result.manifest["stage_report"] if row["stage"] == "aedar-address-points"]
        built = [row for row in points if row["decision"] == "built"]
        reused = [row for row in points if row["decision"] == "reused"]
        self.assertEqual(len(built), 3)
        self.assertEqual(len(reused), 12)
        self.assertEqual({row["territory"]: row["address_rows"] for row in built},
                         {"commune/22001": 5, "epci/243500741": 5, "region/53": 5})
        self.assertTrue(all(len(row["metric_fields"]) == 5 for row in built))
        context = [row for row in result.manifest["stage_report"]
                   if row["stage"] == "aedar-inspection-context"]
        self.assertEqual(sum(row["decision"] == "built" for row in context), 3)
        self.assertEqual(sum(row["decision"] == "reused" for row in context), 12)
        released = [row for row in result.manifest["stage_report"]
                    if row["stage"] == "aedar-territory-release"]
        self.assertEqual(len(released), 3)
        self.assertTrue(all(row["retained_territory_entries"] == 0 for row in released))
        self.assertFalse(adapter._ground_cache)
        self.assertFalse(adapter._point_layer_cache)
        self.assertFalse(adapter._frame_projected_cache)
        self.assertFalse(adapter._hex_cache)

    def test_inspection_keeps_exact_point_marks_and_does_not_prepare_a_hex_grid(self):
        root, binding, adapter = self.fixture()
        feature = binding.map_set.layers["fixture"][0]
        facts = Path(feature["facts_path"])
        table = pq.read_table(facts)
        lon, lat = Transformer.from_crs(2154, 4326, always_xy=True).transform(350400, 6789450)
        longitudes, latitudes = table["lon"].to_pylist(), table["lat"].to_pylist()
        longitudes[0], latitudes[0] = lon, lat
        table = table.set_column(table.schema.get_field_index("lon"), "lon", pa.array(longitudes))
        table = table.set_column(table.schema.get_field_index("lat"), "lat", pa.array(latitudes))
        pq.write_table(table, facts)
        output = root / "inspection"
        adapter.begin_production_scope("representative", output)
        try:
            adapter.prepare_run(aedar_loss_recipe(), binding, ("inspection",), output)
            path = adapter.render(aedar_loss_recipe(), feature, PROFILES["inspection"], output)
            adapter.validate(path, feature, PROFILES["inspection"])
        finally:
            adapter.end_production_scope("representative", output, success=True)
        image = QImage(str(path))
        point, beside = image.pixelColor(1067, 1200), image.pixelColor(1074, 1200)
        self.assertGreater(point.red() - point.green(), 25)
        self.assertLess(abs(beside.red() - beside.green()), 15)
        self.assertFalse(any(row["stage"] == "aedar-hex-grid" for row in adapter.stage_report()))
        QgsProject.instance().clear()

    def test_bound_metric_contracts_are_snapshotted_once_not_resolved_again_for_every_map(self):
        root, binding, adapter = self.fixture()
        output = root / "bound-contracts"
        adapter.begin_production_scope("representative", output)
        try:
            adapter.prepare_run(aedar_loss_recipe(), binding, ("inspection", "inline"), output)
            with patch.object(Path, "resolve", side_effect=AssertionError("Repeated bound-contract path resolution")):
                for feature in binding.map_set.layers["fixture"]:
                    specs = dict(adapter._point_metric_specs(feature))
                    self.assertEqual(len(specs), 5)
                    self.assertEqual(specs["diversity_car_15"], 218.0)
                    self.assertEqual(specs["loss_car_only_walk_15"], 100.0)
        finally:
            adapter.end_production_scope("representative", output, success=True)

    def test_inline_ground_can_omit_the_unused_land_mask_without_changing_any_rendered_layer(self):
        from map_ground import (SharedGround, make_memory_layer, pixels,
                                prepare_ground, replace_memory_geometry)
        import numpy as np
        project = QgsProject.instance()
        context = QgsGeometry.fromRect(QgsRectangle(0, 0, 100, 100))
        layer = make_memory_layer("fixture context", fill=True)
        replace_memory_geometry(layer, context)
        texture = QImage(16, 16, QImage.Format_RGBA8888)
        texture.fill(QColor("#EEEEEE"))
        shared = SharedGround(layer, context, (), texture)
        analytical = QgsGeometry.fromRect(QgsRectangle(20, 20, 80, 80))
        feature = {"territory": {"kind": "commune"}, "geometry": analytical,
                   "analytical_geometry": analytical, "extent": QgsRectangle(0, 0, 100, 100)}
        complete = prepare_ground(project, feature, 100, shared, include_ocsge=False)
        inline = prepare_ground(project, feature, 100, shared, include_ocsge=False,
                                include_land_mask=False)
        self.assertIsNotNone(complete.land_mask)
        self.assertIsNone(inline.land_mask)
        for name in ("ground", "boundaries", "territory_border"):
            self.assertTrue(np.array_equal(pixels(getattr(complete, name)), pixels(getattr(inline, name))), name)

    def test_land_mask_coverage_checks_preserve_holes_and_partial_frames(self):
        from map_ground import geometry_mask
        import numpy as np
        full_land = QgsGeometry.fromWkt("POLYGON ((-100 -100,100 -100,100 100,-100 100,-100 -100))")
        frame = QgsRectangle(-5, -5, 5, 5)
        self.assertTrue(np.all(geometry_mask(full_land, frame, 100) == 1))
        with_hole = QgsGeometry.fromWkt("POLYGON ((-100 -100,100 -100,100 100,-100 100,-100 -100),"
                                      "(-10 -10,-10 10,10 10,10 -10,-10 -10))")
        self.assertTrue(np.all(geometry_mask(with_hole, frame, 100) == 0))
        half_land = QgsGeometry.fromRect(QgsRectangle(-5, -5, 0, 5))
        mask = geometry_mask(half_land, frame, 100)
        self.assertEqual(float(mask[50, 25]), 1.0)
        self.assertEqual(float(mask[50, 75]), 0.0)

    def test_uniform_land_masks_do_not_walk_all_polygon_vertices(self):
        import map_ground
        import numpy as np
        frame = QgsRectangle(-5, -5, 5, 5)
        inland = QgsGeometry.fromRect(QgsRectangle(-100, -100, 100, 100))
        offshore = QgsGeometry.fromRect(QgsRectangle(20, 20, 30, 30))
        with patch.object(map_ground, "geometry_pixel_path", wraps=map_ground.geometry_pixel_path) as paths:
            self.assertTrue(np.all(map_ground.geometry_mask(inland, frame, 100) == 1))
            self.assertTrue(np.all(map_ground.geometry_mask(offshore, frame, 100) == 0))
            self.assertEqual(paths.call_count, 0, "Uniform masks must not convert the full coastline to pixels")

    def test_land_mask_fast_paths_preserve_antialiasing_near_frame_edges(self):
        from qgis.PyQt.QtCore import Qt
        from qgis.PyQt.QtGui import QPainter
        from map_ground import geometry_mask, geometry_pixel_path, pixels
        import numpy as np
        frame = QgsRectangle(0, 0, 10, 10)
        # Keep the exact old Qt rasterizer as an oracle, including a land edge
        # within one pixel of the frame and a hole cutting across its interior.
        geometries = [
            QgsGeometry.fromRect(QgsRectangle(-10, -10, 20, 20)),
            QgsGeometry.fromRect(QgsRectangle(-10, -10, -0.04, 20)),
            QgsGeometry.fromRect(QgsRectangle(-10, -10, 0.04, 20)),
            QgsGeometry.fromRect(QgsRectangle(-10, -10, 9.96, 20)),
            QgsGeometry.fromWkt("POLYGON ((-10 -10,20 -10,20 20,-10 20,-10 -10),"
                                "(4 4,4 6,6 6,6 4,4 4))"),
            # Overlapping polygon parts are invalid for GEOS but the original
            # Qt odd-even rasterizer still has a defined cancellation result.
            QgsGeometry.fromWkt("MULTIPOLYGON (((-10 -10,20 -10,20 20,-10 20,-10 -10)),"
                                "((-10 -10,20 -10,20 20,-10 20,-10 -10)))"),
        ]
        for geometry in geometries:
            image = QImage(100, 100, QImage.Format_RGBA8888)
            image.fill(Qt.transparent)
            painter = QPainter(image)
            painter.setRenderHint(QPainter.Antialiasing, True)
            painter.setPen(Qt.NoPen)
            painter.setBrush(QColor("white"))
            painter.drawPath(geometry_pixel_path(geometry, frame, 100, 100))
            painter.end()
            expected = pixels(image)[:, :, 3].astype(np.float32) / 255.0
            self.assertTrue(np.array_equal(geometry_mask(geometry, frame, 100), expected), geometry.asWkt())

    def test_prepared_inspection_context_is_byte_equivalent_and_not_mutated_by_modes(self):
        from qgis.PyQt.QtCore import Qt
        from qgis.PyQt.QtGui import QPainter
        from inspection_plate import compose_inspection, prepare_inspection_context
        from map_ground import pixels
        from network import _inspection_scale
        import numpy as np
        frame = QgsRectangle(-10, -10, 10, 10)
        outside = QgsGeometry.fromWkt("POLYGON ((-10 -10,0 -10,0 10,-10 10,-10 -10),"
                                     "(-8 -2,-8 2,-6 2,-6 -2,-8 -2))")
        ground = QImage(2400, 2400, QImage.Format_RGBA8888)
        ground.fill(QColor("#92B0A2"))
        boundaries = QImage(2400, 2400, QImage.Format_RGBA8888)
        boundaries.fill(Qt.transparent)
        marks = boundaries.copy()
        painter = QPainter(marks)
        painter.fillRect(120, 90, 1800, 400, QColor("#BC3278"))
        painter.end()
        prepared = prepare_inspection_context(ground, boundaries, outside, frame)
        untouched_image = pixels(prepared.image).copy()
        untouched_mask = prepared.outside_land_mask.copy()
        for label, colour in (("Mode A", "#BC3278"), ("Mode B", "#2590A3")):
            args = (ground, marks, boundaries, outside, np.ones((2400, 2400), dtype=np.float32),
                    frame, "Fixture", ((label, QColor(colour), 1.0, True),),
                    {"mode": "aedar"}, Path(__file__).parents[1] / "assets", Path(), _inspection_scale(frame))
            baseline = compose_inspection(*args, citation_text="Fixture")
            cached = compose_inspection(*args, citation_text="Fixture", prepared_context=prepared)
            self.assertTrue(np.array_equal(pixels(baseline), pixels(cached)), label)
        self.assertTrue(np.array_equal(pixels(prepared.image), untouched_image))
        self.assertTrue(np.array_equal(prepared.outside_land_mask, untouched_mask))


if __name__ == "__main__":
    unittest.main()
