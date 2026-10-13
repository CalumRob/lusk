import json
from pathlib import Path
import sys
import tempfile
import unittest

import numpy as np

sys.path.insert(0, str(Path(__file__).parents[1]))
sys.path.insert(0, str(Path(__file__).parent))
from aedar_legend import tick_label
from aedar_hex_preparation import HexPreparation
from aedar_hex_grid import prepare_hex_grid
from aedar_static import AddressFacts, FAMILY_CONFIG


class AedarStaticTests(unittest.TestCase):
    def test_integer_tick_labels_are_compact_and_decimal_boundaries_are_preserved(self):
        self.assertEqual(tick_label(10, (0, 2, 4)), "10")
        self.assertEqual(tick_label(0.5, (0, 0.5, 1)), "0,5")

    def test_fractional_equal_width_intervals_above_one_have_integer_tick_labels(self):
        breaks = (0., 42.4, 84.8, 127.2, 169.6, 212.)
        self.assertEqual([tick_label(value, breaks) for value in breaks],
                         ["0", "42", "85", "127", "170", "212"])
        self.assertEqual(breaks, (0., 42.4, 84.8, 127.2, 169.6, 212.))

    def test_persistent_hex_grid_and_medians_reuse_and_validate_integrity(self):
        folder = Path(tempfile.mkdtemp())
        x, y = np.array([1., 2., 8.]), np.array([1., 2., 8.])
        prep = HexPreparation(folder, "addresses-v1", x, y)
        args = ((0, 0, 10, 10), (10, 10), 9., {"car": np.array([0., 2., 8.])})
        first = prep.prepare(np.arange(3), *args)
        second = prep.prepare(np.arange(3), *args)
        self.assertEqual(first.grid_decision, "built")
        self.assertEqual(second.grid_decision, "reused")
        self.assertEqual(second.metric_decisions, {"car": "reused"})
        self.assertTrue(np.array_equal(first.medians["car"], second.medians["car"]))
        cache = next(folder.glob("grid-*.npz"))
        cache.write_bytes(b"corrupt")
        with self.assertRaisesRegex(ValueError, "integrity"):
            prep.prepare(np.arange(3), *args)

    def test_occupied_hexes_keep_true_zero_and_uncapped_medians_across_metrics(self):
        with tempfile.TemporaryDirectory() as folder:
            prep = HexPreparation(folder, "fixture-address-order", np.array([5., 5., 80.]),
                                  np.array([95., 95., 20.]))
            geometry = (np.arange(3), (0., 0., 100., 100.), (100, 100), 9.)
            first = prep.prepare(*geometry, {"car": np.array([0., 2., 10.]), "loss": np.array([0., 0., 80.])})
            self.assertEqual(sorted(first.grid.counts.tolist()), [1, 2])
            self.assertEqual(sorted(first.medians["car"].tolist()), [1., 10.])
            self.assertEqual(sorted(first.medians["loss"].tolist()), [0., 80.])
            changed = prep.prepare(*geometry, {"car": np.array([0., 2., 10.]), "loss": np.array([4., 6., 120.])})
            self.assertEqual(changed.grid_decision, "reused")
            self.assertEqual(changed.metric_decisions, {"car": "reused", "loss": "built"})
            self.assertEqual(sorted(changed.medians["loss"].tolist()), [5., 120.])

    def test_family_config_is_stable_and_does_not_alias_network_prefix(self):
        config = json.loads((Path(__file__).parents[1] / "aedar-static-family.json").read_text())
        self.assertEqual(config["prefix"], "maps/aedar/v1/")
        self.assertEqual(config["modes"]["transit"]["value_field"], "loss_car_only_transit_p1_15")
        self.assertEqual(config["filename_template"], "{code}-{mode}-{profile}.webp")
        self.assertEqual(config["palette"], ["#716ca2", "#8f85b1", "#ad9ebf", "#b186a3", "#ac5b78"])

    def test_render_identity_changes_when_inspection_frame_implementation_changes(self):
        from unittest.mock import patch
        from qgis_fixture import qgis_application
        qgis_application()
        from aedar_static import AedarStaticAdapter
        with tempfile.TemporaryDirectory() as directory:
            adapter = AedarStaticAdapter(directory, Path(directory) / "facts.parquet",
                                         cache_dir=Path(directory) / "cache")
            original_read_bytes = Path.read_bytes
            frame_path = Path(__file__).parents[1] / "inspection_frame.py"
            frame_bytes = original_read_bytes(frame_path)
            before = adapter.render_identity()
            with patch.object(Path, "read_bytes", autospec=True,
                              side_effect=lambda path: frame_bytes + b"\\n# changed frame behavior\\n"
                              if path == frame_path else original_read_bytes(path)):
                adapter._static_render_identity = None
                after = adapter.render_identity()
        self.assertNotEqual(before["selected_renderer_sha256"], after["selected_renderer_sha256"])

    def test_prepared_facts_accept_negative_longitude_and_preserve_integer_metrics(self):
        import pyarrow as pa
        import pyarrow.parquet as pq
        from qgis_fixture import qgis_application
        qgis_application()
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            data = {"code_insee": ["35238", "35238"], "cle_interop_adr": ["a", "b"],
                    "lon": [-1.7, -1.6], "lat": [48.1, 48.2]}
            for spec in FAMILY_CONFIG["modes"].values():
                data[spec["value_field"]] = [0, 218 if spec["measure"] == "diversity" else 15]
            pq.write_table(pa.table(data), folder / "facts.parquet")
            facts = AddressFacts(folder / "facts.parquet", folder / "cache")
            self.assertEqual(facts.car_mean, 109.0)
            self.assertEqual(facts.positions(["35238"]).tolist(), [0, 1])
            self.assertTrue(np.isfinite(facts.x).all())


if __name__ == "__main__":
    unittest.main()
