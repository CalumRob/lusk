"""Prepare mode-neutral occupied hexes once; summarise address metrics on them.

The grid owns address membership and cell geometry, never scales, colours or
mode selection. Coordinates are projected map metres. Vertices are expressed
in the export's pixel coordinate system for the inline renderer.
"""
from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class HexGrid:
    cell_keys: np.ndarray
    counts: np.ndarray
    vertices: np.ndarray
    address_positions: np.ndarray
    membership: np.ndarray
    address_count: int

    def medians(self, values) -> np.ndarray:
        numeric = np.asarray(values, dtype=np.float64)
        if numeric.ndim != 1 or len(numeric) != self.address_count:
            raise ValueError("Hex metric values must match the prepared address order")
        if not np.all(np.isfinite(numeric)):
            raise ValueError("Hex metric values must be finite; missing values are not zero")
        ordered = numeric[self.address_positions]
        ordered = ordered[np.lexsort((ordered, self.membership))]
        starts = np.r_[0, np.cumsum(self.counts[:-1])]
        return (ordered[starts + (self.counts - 1) // 2] +
                ordered[starts + self.counts // 2]) / 2


def prepare_hex_grid(x, y, extent, *, frame_size_px: int, cell_width_px: float) -> HexGrid:
    """Return only occupied cells; each address contributes one value to its cell."""
    x, y = np.asarray(x, dtype=float), np.asarray(y, dtype=float)
    if x.ndim != 1 or y.shape != x.shape:
        raise ValueError("Hex coordinates must be equally sized one-dimensional arrays")
    if not np.all(np.isfinite(x)) or not np.all(np.isfinite(y)):
        raise ValueError("Hex address coordinates must be finite")
    xmin, ymin, xmax, ymax = extent
    px = (x - xmin) / (xmax - xmin) * frame_size_px
    py = (ymax - y) / (ymax - ymin) * frame_size_px
    positions = np.flatnonzero((px >= 0) & (px < frame_size_px) &
                               (py >= 0) & (py < frame_size_px))
    radius = cell_width_px / np.sqrt(3)
    q = (np.sqrt(3) * px[positions] / 3 - py[positions] / 3) / radius
    r = 2 * py[positions] / (3 * radius)
    cube = np.column_stack((q, -q - r, r))
    rounded = np.rint(cube)
    biggest_error = np.argmax(np.abs(rounded - cube), axis=1)
    for axis in range(3):
        mask = biggest_error == axis
        other = [index for index in range(3) if index != axis]
        rounded[mask, axis] = -rounded[mask, other[0]] - rounded[mask, other[1]]
    keys, membership, counts = np.unique(rounded[:, (0, 2)].astype(np.int64),
                                         axis=0, return_inverse=True, return_counts=True)
    centres = np.column_stack((radius * np.sqrt(3) * (keys[:, 0] + keys[:, 1] / 2),
                               radius * 1.5 * keys[:, 1]))
    angles = np.deg2rad(np.arange(6) * 60 + 30)
    offsets = radius * np.column_stack((np.cos(angles), np.sin(angles)))
    vertices = centres[:, None, :] + offsets[None, :, :]
    return HexGrid(keys, counts, vertices, positions, membership, len(x))
