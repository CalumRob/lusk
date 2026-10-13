"""A run-owned source snapshot serves frame queries without reopening GeoJSON."""
import json
from pathlib import Path
import sys
import tempfile
import unittest
import gc
from unittest.mock import patch

from qgis.core import QgsCoordinateReferenceSystem, QgsCoordinateTransform, QgsFeatureRequest, QgsProject, QgsRectangle, QgsVectorLayer

sys.path.insert(0, str(Path(__file__).parents[1]))
from aedar_commune_frames import CommuneFrameIndex
from pipeline.maps.production.tests.qgis_fixture import fixture_folder, qgis_application


class CommuneFrameIndexTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = qgis_application()

    @classmethod
    def tearDownClass(cls):
        QgsProject.instance().clear()
        gc.collect()

    def test_indexed_queries_reuse_the_source_snapshot_for_different_frames(self):
        # OGR keeps a pooled Windows read handle until QGIS exits, so defer
        # fixture deletion rather than trying to rename a still-open GeoJSON.
        folder = fixture_folder(tempfile.mkdtemp(prefix="lusk-frame-index-"))
        source = Path(folder) / "communes.geojson"
        source.write_text(json.dumps({"type": "FeatureCollection",
            "crs": {"type": "name", "properties": {"name": "EPSG:2154"}},
            "features": [
                {"type": "Feature", "properties": {"code_insee": "A"},
                 "geometry": {"type": "Polygon", "coordinates": [
                     [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]]}},
                {"type": "Feature", "properties": {"code_insee": "B"},
                 "geometry": {"type": "Polygon", "coordinates": [
                     [[20, 20], [30, 20], [30, 30], [20, 30], [20, 20]]]}}
            ]}), encoding="utf-8")
        index = CommuneFrameIndex(source, QgsProject.instance())
        # Mock only the external QGIS/file-provider boundary after the
        # real source preparation, never our indexing/query algorithm.
        with patch("aedar_commune_frames.QgsVectorLayer", side_effect=AssertionError("reopened GeoJSON")):
            self.assertEqual(index.codes_in_frame(QgsRectangle(1, 1, 9, 9)), ("A",))
            self.assertEqual(index.codes_in_frame(QgsRectangle(21, 21, 29, 29)), ("B",))
            self.assertEqual(index.codes_in_frame(QgsRectangle(0, 0, 30, 30)), ("A", "B"))

    def test_index_keeps_native_frame_membership_for_irregular_geographic_communes(self):
        source = fixture_folder(tempfile.mkdtemp(prefix="lusk-frame-crs-")) / "communes.geojson"
        source.write_text(json.dumps({"type": "FeatureCollection", "features": [
            {"type": "Feature", "properties": {"code_insee": "A"},
             "geometry": {"type": "Polygon", "coordinates": [
                 [[-2, 48], [-1, 48], [-2, 49], [-2, 48]]]}},
            {"type": "Feature", "properties": {"code_insee": "B"},
             "geometry": {"type": "Polygon", "coordinates": [
                 [[-2, 48], [-1, 48], [-1, 49], [-2, 49], [-2, 48]]]}}
        ]}), encoding="utf-8")
        project = QgsProject.instance()
        source_layer = QgsVectorLayer(str(source), "native frame oracle", "ogr")
        to_map = QgsCoordinateTransform(source_layer.crs(), QgsCoordinateReferenceSystem("EPSG:2154"), project)
        to_source = QgsCoordinateTransform(QgsCoordinateReferenceSystem("EPSG:2154"), source_layer.crs(), project)
        index = CommuneFrameIndex(source, project)
        # The second frame lies within A's bounding box but outside its actual
        # triangle. Keep the provider's real behaviour, not an assumed flag.
        for bounds in (QgsRectangle(-1.95, 48.02, -1.9, 48.07),
                       QgsRectangle(-1.1, 48.85, -1.05, 48.9)):
            frame = to_map.transformBoundingBox(bounds)
            query = QgsFeatureRequest().setFilterRect(to_source.transformBoundingBox(frame))
            expected = tuple(sorted({str(feature["code_insee"]) for feature in source_layer.getFeatures(query)}))
            self.assertEqual(index.codes_in_frame(frame), expected)


if __name__ == "__main__":
    unittest.main()
