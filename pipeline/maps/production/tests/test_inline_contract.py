"""End-to-end profile contract test for paper-only, shadowed inline maps."""
import json
import gc
import shutil
import tempfile
import unittest
from pathlib import Path
import sys

from qgis.core import (
    QgsApplication,
    QgsFeature,
    QgsGeometry,
    QgsPointXY,
    QgsProject,
    QgsRectangle,
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
        adapter = NetworkAdapter(raw, cache_root=root / "network-cache")
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
            "osm-network", "geovelo-network", "commune-context", "epci-labels",
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

    def _write_osm(self, path):
        layer = QgsVectorLayer(
            "LineString?crs=EPSG:2154&field=highway:string&field=other_tags:string",
            "OSM fixture", "memory",
        )
        features = []
        for highway, y in (("primary", 80), ("footway", 70)):
            feature = QgsFeature(layer.fields())
            feature.setAttributes([highway, None])
            feature.setGeometry(QgsGeometry.fromPolylineXY([QgsPointXY(5, y), QgsPointXY(75, y)]))
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

    def _write_ocsge(self, directory):
        directory.mkdir(parents=True)
        for department in ("22", "29", "35", "56"):
            name = f"artif_2025_{department}"
            path = directory / f"{name}.gpkg"
            layer = QgsVectorLayer(
                "MultiPolygon?crs=EPSG:2154&field=code_cs:string&field=code_us:string",
                f"OCS-GE {department}", "memory",
            )
            feature = QgsFeature(layer.fields())
            feature.setAttributes(["CS2.1.1.1", None])
            geometry = QgsGeometry.fromWkt(
                "POLYGON ((20 40,40 40,40 60,20 60,20 40))"
            )
            geometry.convertToMultiType()
            feature.setGeometry(geometry)
            self.assertTrue(layer.dataProvider().addFeature(feature))
            self._write_gpkg(layer, path, name)

    def _write_gpkg(self, layer, path, layer_name):
        options = QgsVectorFileWriter.SaveVectorOptions()
        options.driverName = "GPKG"
        options.layerName = layer_name
        result = QgsVectorFileWriter.writeAsVectorFormatV3(
            layer, str(path), QgsProject.instance().transformContext(), options
        )
        self.assertEqual(result[0], QgsVectorFileWriter.NoError, result)


if __name__ == "__main__":
    unittest.main()
