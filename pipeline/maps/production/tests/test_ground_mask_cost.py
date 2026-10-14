"""Byte-preserving ground shortcuts, independent of any AEDAR adapter."""
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

import numpy as np
from qgis.core import QgsGeometry, QgsProject, QgsRectangle
from qgis.PyQt.QtCore import Qt
from qgis.PyQt.QtGui import QColor, QImage, QPainter

sys.path.insert(0, str(Path(__file__).parents[1]))
import map_ground as ground
from pipeline.maps.production.tests.qgis_fixture import qgis_application


class GroundMaskCostTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        qgis_application()

    def test_fast_masks_match_the_original_rasterizer_at_edges_holes_and_overlaps(self):
        frame = QgsRectangle(0, 0, 10, 10)
        shapes = [
            QgsGeometry.fromRect(QgsRectangle(-10, -10, 20, 20)),
            QgsGeometry.fromRect(QgsRectangle(20, 20, 30, 30)),
            QgsGeometry.fromRect(QgsRectangle(-10, -10, -0.04, 20)),
            QgsGeometry.fromRect(QgsRectangle(-10, -10, 0.04, 20)),
            QgsGeometry.fromRect(QgsRectangle(-10, -10, 9.96, 20)),
            QgsGeometry.fromWkt("POLYGON ((-10 -10,20 -10,20 20,-10 20,-10 -10),"
                                "(4 4,4 6,6 6,6 4,4 4))"),
            QgsGeometry.fromWkt("MULTIPOLYGON (((-10 -10,20 -10,20 20,-10 20,-10 -10)),"
                                "((-10 -10,20 -10,20 20,-10 20,-10 -10)))"),
        ]
        for shape in shapes:
            image = QImage(100, 100, QImage.Format_RGBA8888)
            image.fill(Qt.transparent)
            painter = QPainter(image)
            painter.setRenderHint(QPainter.Antialiasing, True)
            painter.setPen(Qt.NoPen)
            painter.setBrush(QColor("white"))
            painter.drawPath(ground.geometry_pixel_path(shape, frame, 100, 100))
            painter.end()
            expected = ground.pixels(image)[:, :, 3].astype(np.float32) / 255.0
            self.assertTrue(np.array_equal(ground.geometry_mask(shape, frame, 100), expected))

    def test_uniform_masks_avoid_coastline_path_conversion(self):
        frame = QgsRectangle(-5, -5, 5, 5)
        inland = QgsGeometry.fromRect(QgsRectangle(-100, -100, 100, 100))
        offshore = QgsGeometry.fromRect(QgsRectangle(20, 20, 30, 30))
        with patch.object(ground, "geometry_pixel_path", wraps=ground.geometry_pixel_path) as paths:
            self.assertTrue(np.all(ground.geometry_mask(inland, frame, 100) == 1))
            self.assertTrue(np.all(ground.geometry_mask(offshore, frame, 100) == 0))
            self.assertEqual(paths.call_count, 0)

    def test_optional_land_mask_preserves_every_rendered_inline_layer(self):
        context = QgsGeometry.fromRect(QgsRectangle(0, 0, 100, 100))
        layer = ground.make_memory_layer("fixture context", fill=True)
        ground.replace_memory_geometry(layer, context)
        texture = QImage(16, 16, QImage.Format_RGBA8888)
        texture.fill(QColor("#EEEEEE"))
        shared = ground.SharedGround(layer, context, (), texture)
        analytical = QgsGeometry.fromRect(QgsRectangle(20, 20, 80, 80))
        feature = {"territory": {"kind": "commune"}, "geometry": analytical,
                   "analytical_geometry": analytical, "extent": QgsRectangle(0, 0, 100, 100)}
        complete = ground.prepare_ground(QgsProject.instance(), feature, 100, shared, include_ocsge=False)
        inline = ground.prepare_ground(QgsProject.instance(), feature, 100, shared,
                                       include_ocsge=False, include_land_mask=False)
        self.assertIsNotNone(complete.land_mask)
        self.assertIsNone(inline.land_mask)
        for name in ("ground", "boundaries", "territory_border"):
            self.assertTrue(np.array_equal(ground.pixels(getattr(complete, name)),
                                           ground.pixels(getattr(inline, name))), name)


if __name__ == "__main__":
    unittest.main()
