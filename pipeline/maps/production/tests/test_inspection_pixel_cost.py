"""Exact compositor arithmetic need only process the pixels a mask touches."""
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

import numpy as np
from qgis.PyQt.QtGui import QColor, QImage

sys.path.insert(0, str(Path(__file__).parents[1]))
import inspection_plate as plate
from pipeline.maps.production.tests.qgis_fixture import qgis_application


def full_frame_ink(image, texture, mask, colour, opacity, treatment):
    """The pre-optimisation full-frame algorithm, retained as a pixel oracle."""
    image = image.copy().convertToFormat(QImage.Format_RGBA8888)
    rgba = plate._pixels(image)
    rgb = rgba[:, :, :3].astype(np.float32)
    grain = 1.0 - plate.TEXTURE_OPACITY * (1.0 - texture)
    pigment = np.array([colour.red(), colour.green(), colour.blue()], dtype=np.float32)
    coverage = mask * opacity
    rgb = rgb * (1.0 - coverage[:, :, None]) + pigment[None, None, :] * grain[:, :, None] * coverage[:, :, None]
    if treatment is not None:
        offset = treatment.edge_offset
        light_edge = np.clip(mask - plate._shift(mask, -offset, -offset), 0, 1)
        dark_edge = np.clip(mask - plate._shift(mask, offset, offset), 0, 1)
        relief_grain = 0.78 + 0.44 * texture
        light = light_edge * treatment.highlight_strength * relief_grain
        shadow = dark_edge * treatment.shadow_strength * relief_grain
        rgb += (255.0 - rgb) * light[:, :, None]
        rgb *= 1.0 - shadow[:, :, None]
    rgba[:, :, :3] = np.clip(np.rint(rgb), 0, 255).astype(np.uint8)
    return image


def full_frame_desaturation(image, mask, land):
    image = image.copy().convertToFormat(QImage.Format_RGBA8888)
    rgba = plate._pixels(image)
    rgb = rgba[:, :, :3].astype(np.float32)
    gray = np.sum(rgb * np.array([0.2126, 0.7152, 0.0722]), axis=2)
    coverage = (np.clip(mask, 0, 1) * np.clip(land, 0, 1))[:, :, None]
    rgba[:, :, :3] = np.clip(np.rint(rgb * (1 - coverage) + gray[:, :, None] * coverage), 0, 255).astype(np.uint8)
    return image


class InspectionPixelCostTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        qgis_application()

    def fixture(self):
        rng = np.random.default_rng(748)
        image = QImage(96, 64, QImage.Format_RGBA8888)
        plate._pixels(image)[:] = rng.integers(0, 256, (64, 96, 4), dtype=np.uint8)
        texture = rng.random((64, 96), dtype=np.float32)
        return image, texture

    def masks(self):
        empty = np.zeros((64, 96), dtype=np.float32)
        yield empty
        for rows, columns in ((slice(10, 14), slice(12, 19)), (slice(0, 1), slice(0, 1)),
                              (slice(63, 64), slice(90, 96)), (slice(0, 64), slice(0, 96))):
            mask = empty.copy()
            mask[rows, columns] = 0.7
            yield mask
        disconnected = empty.copy()
        disconnected[3:6, 10:15] = 0.1
        disconnected[59:61, 90:94] = 1
        yield disconnected

    def test_ink_matches_the_original_for_empty_sparse_full_and_edge_glyphs(self):
        image, texture = self.fixture()
        original = plate._pixels(image).copy()
        for mask in self.masks():
            for treatment in (None, plate.TITLE_RELIEF):
                for opacity in (0, 0.55, 1):
                    args = image, texture, mask, QColor("#57726F"), opacity, treatment
                    expected = full_frame_ink(*args)
                    actual = plate.apply_engraved_ink(*args)
                    self.assertTrue(np.array_equal(plate._pixels(expected), plate._pixels(actual)))
        self.assertTrue(np.array_equal(plate._pixels(image), original), "Input image must stay reusable")

    def test_sparse_ink_arithmetic_is_bounded_to_its_glyph_not_the_entire_frame(self):
        image, texture = self.fixture()
        mask = np.zeros((64, 96), dtype=np.float32)
        mask[10:14, 12:19] = 0.7
        with patch.object(plate.np, "rint", wraps=np.rint) as rounded:
            plate.apply_engraved_ink(image, texture, mask, QColor("#57726F"), 0.55, plate.TITLE_RELIEF)
            self.assertLess(rounded.call_args.args[0].shape[0] * rounded.call_args.args[0].shape[1], 100)

    def test_desaturation_matches_the_original_without_changing_alpha_or_source(self):
        image, land = self.fixture()
        original = plate._pixels(image).copy()
        for mask in self.masks():
            expected = full_frame_desaturation(image, mask, land)
            actual = plate._desaturate_masked_area(image, mask, land)
            self.assertTrue(np.array_equal(plate._pixels(expected), plate._pixels(actual)))
        self.assertTrue(np.array_equal(plate._pixels(image), original))

    def test_sparse_desaturation_does_not_process_the_entire_frame(self):
        image, land = self.fixture()
        mask = np.zeros((64, 96), dtype=np.float32)
        mask[10:14, 12:19] = 0.7
        with patch.object(plate.np, "rint", wraps=np.rint) as rounded:
            plate._desaturate_masked_area(image, mask, land)
            self.assertLess(rounded.call_args.args[0].shape[0] * rounded.call_args.args[0].shape[1], 100)


if __name__ == "__main__":
    unittest.main()
