"""Durable, integrity-checked disk cache for address projections and hex statistics."""
from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256
import json
import inspect
import os
from pathlib import Path
from uuid import uuid4

import numpy as np

from aedar_hex_grid import HexGrid, prepare_hex_grid


def digest(*arrays):
    hasher = sha256()
    for value in arrays:
        array = np.ascontiguousarray(value)
        hasher.update(str(array.shape).encode())
        hasher.update(str(array.dtype).encode())
        hasher.update(array.tobytes())
    return hasher.hexdigest()


def _seal(path):
    path.with_suffix(path.suffix + ".sha256").write_text(sha256(path.read_bytes()).hexdigest(), encoding="ascii")


def _check(path):
    seal = path.with_suffix(path.suffix + ".sha256")
    if not seal.is_file() or seal.read_text(encoding="ascii") != sha256(path.read_bytes()).hexdigest():
        raise ValueError(f"Hex cache integrity failure: {path}")


def _atomic_numpy(path, writer):
    temporary = path.with_name(f".{path.name}-{uuid4().hex}.tmp")
    try:
        with temporary.open("wb") as stream:
            writer(stream)
        os.replace(temporary, path)
        _seal(path)
    finally:
        temporary.unlink(missing_ok=True)


@dataclass
class HexPack:
    grid: HexGrid
    medians: dict
    identity: str
    grid_decision: str
    metric_decisions: dict


class HexPreparation:
    def __init__(self, folder, address_identity, x, y):
        self.folder = Path(folder)
        self.folder.mkdir(parents=True, exist_ok=True)
        self.address_identity = str(address_identity)
        self.x, self.y = np.asarray(x, dtype=np.float64), np.asarray(y, dtype=np.float64)
        self.grid_implementation = sha256(inspect.getsource(prepare_hex_grid).encode()).hexdigest()
        self.median_implementation = sha256(inspect.getsource(HexGrid.medians).encode()).hexdigest()
        if self.x.shape != self.y.shape or self.x.ndim != 1 or not np.isfinite(self.x).all() or not np.isfinite(self.y).all():
            raise ValueError("Projected address coordinates must be finite aligned vectors")

    def prepare(self, positions, bounds, size, width, metrics):
        positions = np.asarray(positions, dtype=np.int64)
        if positions.ndim != 1 or (len(positions) and (positions.min() < 0 or positions.max() >= len(self.x))):
            raise ValueError("Hex cache address positions are invalid")
        contract = {"version": 2, "grid_implementation": self.grid_implementation, "address_identity": self.address_identity,
                    "membership": digest(positions), "bounds": tuple(map(float, bounds)),
                    "size": tuple(map(int, size)), "width_px": float(width), "crs": "EPSG:2154"}
        identity = sha256(json.dumps(contract, sort_keys=True).encode()).hexdigest()
        path = self.folder / f"grid-{identity}.npz"
        if path.exists():
            _check(path)
            with np.load(path, allow_pickle=False) as data:
                grid = HexGrid(data["keys"], data["counts"], data["vertices"], data["positions"],
                               data["membership"], len(positions))
            decision = "reused"
        else:
            grid = prepare_hex_grid(self.x[positions], self.y[positions], bounds,
                                    frame_size_px=size[0], cell_width_px=width)
            _atomic_numpy(path, lambda stream: np.savez(stream, keys=grid.cell_keys, counts=grid.counts,
                vertices=grid.vertices, positions=grid.address_positions, membership=grid.membership))
            decision = "built"
        if (grid.vertices.shape != (len(grid.cell_keys), 6, 2) or grid.counts.shape != (len(grid.cell_keys),)
                or int(grid.counts.sum()) != len(grid.address_positions)
                or len(grid.membership) != len(grid.address_positions)):
            raise ValueError("Hex cache integrity failure: invalid grid geometry or membership")
        medians, decisions = {}, {}
        for field, source_values in metrics.items():
            values = np.asarray(source_values, dtype=np.float64)[positions]
            if not np.isfinite(values).all():
                raise ValueError(f"Hex metric {field} contains non-finite values")
            metric_id = digest(values)
            # One full digest retains every identity input without exceeding
            # Windows' 255-character filename-component limit on atomic writes.
            median_contract = {"grid": identity, "implementation": self.median_implementation,
                               "field": field, "values": metric_id}
            median_id = sha256(json.dumps(median_contract, sort_keys=True).encode()).hexdigest()
            metric_path = self.folder / f"median-{median_id}.npy"
            if metric_path.exists():
                _check(metric_path)
                medians[field] = np.load(metric_path, allow_pickle=False)
                decisions[field] = "reused"
            else:
                medians[field] = grid.medians(values)
                _atomic_numpy(metric_path, lambda stream, result=medians[field]: np.save(stream, result, allow_pickle=False))
                decisions[field] = "built"
            if medians[field].shape != (len(grid.cell_keys),) or not np.isfinite(medians[field]).all():
                raise ValueError(f"Hex cache integrity failure: invalid {field} medians")
        return HexPack(grid, medians, identity, decision, decisions)
