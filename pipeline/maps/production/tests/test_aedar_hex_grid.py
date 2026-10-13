"""Address-median and occupied-cell contracts for the reusable AEDAR grid."""
from pathlib import Path
import sys
import unittest

import numpy as np

sys.path.insert(0, str(Path(__file__).parents[1]))
from aedar_hex_grid import prepare_hex_grid


class AedarHexGridTests(unittest.TestCase):
    def test_real_zero_values_colour_an_occupied_cell_without_creating_empty_cells(self):
        # Two known hex centres in a 900 m square, with three addresses in the
        # first cell and one in the second. The rest of the grid is unoccupied.
        grid = prepare_hex_grid(
            [134.8, 135.0, 135.2, 225.0], [822.0, 822.1, 822.2, 822.1],
            (0, 0, 900, 900), frame_size_px=900, cell_width_px=9,
        )
        self.assertEqual(grid.cell_keys.tolist(), [[10, 10], [20, 10]])
        self.assertEqual(grid.counts.tolist(), [3, 1])
        self.assertEqual(grid.medians([0, 0, 20, 40]).tolist(), [0.0, 40.0])
        self.assertEqual(len(grid.vertices), 2)

    def test_the_same_prepared_cells_summarise_mode_values_in_original_address_order(self):
        grid = prepare_hex_grid(
            [225.0, 134.8, 135.0, 135.2, 135.1], [822.1] * 5,
            (0, 0, 900, 900), frame_size_px=900, cell_width_px=9,
        )
        self.assertEqual(grid.medians([200, 0, 10, 20, 100]).tolist(), [15.0, 200.0])
        self.assertEqual(grid.medians([0, 50, 10, 70, 90]).tolist(), [60.0, 0.0])

    def test_missing_mode_values_are_not_silently_converted_to_zero(self):
        grid = prepare_hex_grid([135.0], [822.1], (0, 0, 900, 900),
                                frame_size_px=900, cell_width_px=9)
        with self.assertRaisesRegex(ValueError, "finite"):
            grid.medians([np.nan])

    def test_empty_address_universe_has_no_cells_or_values(self):
        grid = prepare_hex_grid([], [], (0, 0, 900, 900),
                                frame_size_px=900, cell_width_px=9)
        self.assertEqual(grid.cell_keys.shape, (0, 2))
        self.assertEqual(grid.medians([]).tolist(), [])

    def test_invalid_coordinates_are_not_silently_treated_as_empty_cells(self):
        with self.assertRaisesRegex(ValueError, "finite"):
            prepare_hex_grid([np.nan], [822.1], (0, 0, 900, 900),
                              frame_size_px=900, cell_width_px=9)


if __name__ == "__main__":
    unittest.main()
