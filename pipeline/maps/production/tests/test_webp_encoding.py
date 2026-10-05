"""Production WebP encoder contract tests (QGIS Python)."""
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

sys.path.insert(0, str(Path(__file__).parents[1]))

from webp_encoding import (  # noqa: E402
    WEBP_ENCODING_CONTRACT,
    encode_qimage,
    validate_webp,
)
from runner import Profile  # noqa: E402
from qgis.PyQt.QtGui import QImage


class WebPEncodingTests(unittest.TestCase):
    def test_canonical_encoder_settings_are_explicit_and_pinned(self):
        self.assertEqual(WEBP_ENCODING_CONTRACT, {
            "format": "webp",
            "encoder": "Pillow",
            "encoder_version": "12.3.0",
            "rgb_mode": "lossy",
            "lossless": False,
            "quality": 80,
            "method": 4,
            "exact": True,
            "alpha_mode": "lossless",
            "alpha_quality": 100,
        })

    def test_webp_round_trip_preserves_exact_alpha_with_lossy_rgb(self):
        image = QImage(32, 24, QImage.Format_RGBA8888)
        for y in range(image.height()):
            for x in range(image.width()):
                image.setPixelColor(x, y, __import__("qgis.PyQt.QtGui", fromlist=["QColor"]).QColor(
                    (x * 31) % 256, (y * 47) % 256, (x * 9 + y * 3) % 256,
                    0 if x < 8 else 255 if x > 22 else (x * 11) % 256))
        with TemporaryDirectory() as directory:
            path = Path(directory) / "probe.webp"
            expected_alpha = bytes(image.pixelColor(x, y).alpha()
                for y in range(image.height()) for x in range(image.width()))
            encode_qimage(image, path, preserve_alpha=True)
            decoded = validate_webp(path, Profile("fixture", (32, 24), False, False, True))
            self.assertEqual(decoded.size, (32, 24))
            self.assertEqual(decoded.getchannel("A").tobytes(), expected_alpha)

    def test_canonical_encoder_arguments_reach_the_pinned_webp_backend(self):
        from qgis.PyQt.QtGui import QColor
        from webp_encoding import _pillow
        Image = _pillow()
        image = QImage(8, 8, QImage.Format_RGBA8888)
        image.fill(QColor(50, 80, 100, 255))
        observed = {}
        original_save = Image.Image.save

        def capture_save(source, destination, **options):
            observed.update(options)
            return original_save(source, destination, **options)

        with TemporaryDirectory() as directory:
            with __import__("unittest.mock", fromlist=["patch"]).patch.object(
                    Image.Image, "save", new=capture_save):
                encode_qimage(image, Path(directory) / "settings.webp", preserve_alpha=False)
        self.assertEqual({key: observed[key] for key in
            ("format", "quality", "method", "exact", "alpha_quality", "lossless")}, {
                "format": "WEBP", "quality": 80, "method": 4,
                "exact": True, "alpha_quality": 100, "lossless": False})

    def test_decoder_qa_rejects_corrupt_and_wrong_sized_webp(self):
        from qgis.PyQt.QtGui import QColor
        with TemporaryDirectory() as directory:
            path = Path(directory) / "broken.webp"
            path.write_bytes(b"RIFF\x04\0\0\0WEBPbroken")
            with self.assertRaisesRegex(ValueError, "WebP"):
                validate_webp(path, Profile("fixture", (2, 2), False, False, False))
            with self.assertRaisesRegex(ValueError, "missing or unreadable"):
                validate_webp(Path(directory) / "missing.webp",
                    Profile("fixture", (2, 2), False, False, False))
            image = QImage(4, 4, QImage.Format_RGBA8888)
            image.fill(QColor(10, 20, 30, 255))
            valid = Path(directory) / "valid.webp"
            encode_qimage(image, valid, preserve_alpha=False)
            with self.assertRaisesRegex(ValueError, "dimensions"):
                validate_webp(valid, Profile("fixture", (5, 4), False, False, False))

    def test_encoder_failure_does_not_leave_success_looking_file(self):
        from webp_encoding import _pillow
        Image = _pillow()
        image = QImage(2, 2, QImage.Format_RGBA8888)
        with TemporaryDirectory() as directory:
            path = Path(directory) / "failure.webp"
            with __import__("unittest.mock", fromlist=["patch"]).patch.object(
                    Image.Image, "save", side_effect=OSError("injected WebP conversion error")):
                with self.assertRaisesRegex(OSError, "injected WebP conversion error"):
                    encode_qimage(image, path, preserve_alpha=True)
            self.assertFalse(path.exists())
            self.assertEqual(list(Path(directory).glob(".*.tmp.webp")), [])


if __name__ == "__main__":
    unittest.main()
