"""Local setting: RP2021 1 km resident-population density.

INSEE publishes the 1 km carroyage in Lambert-93 (EPSG:2154). The join uses
the published cell *polygons*: a mutation centroid (WGS84 lon/lat from DVF+)
is reprojected to Lambert-93 and tested for containment.

The cell identifier (``FR_CRS3035RES1000mN…E…``) encodes a corner in the
grid's own axis. It is a stable identifier, not a coordinate contract, so it
is never used to reconstruct a cell from a point.

The native DVF+ mutation-centroid coordinate is an explicitly labelled proxy
for this grid join only; the exception is not extended to other sources.
"""
from __future__ import annotations

import re
import sqlite3
import struct
import zipfile
from pathlib import Path

import numpy as np
import pandas as pd
from pyproj import Transformer

from . import config

_WGS84_TO_LAMBERT93 = Transformer.from_crs("EPSG:4326", "EPSG:2154", always_xy=True)
_GRID_ID = re.compile(r"RES(\d+)mN(-?\d+)E(-?\d+)$")


def _gpkg_geometry(blob: bytes) -> tuple[tuple[float, float, float, float], list[tuple[float, float]]]:
    """Envelope and outer ring of a GeoPackage polygon geometry blob.

    Header: magic ``GP`` (2), version (1), flags (1), srs_id (4). The flags
    byte carries the envelope indicator in bits 1-3 and the empty flag in bit
    4. The envelope length depends on the indicator, so the offset is not
    fixed at 8 bytes.
    """
    if blob[:2] != b"GP":
        raise ValueError("not a GeoPackage geometry")
    flags = blob[3]
    if flags & 0x10:
        raise ValueError("empty GeoPackage geometry")
    envelope_indicator = (flags >> 1) & 0b111
    envelope_size = {0: 0, 1: 32, 2: 48, 3: 48, 4: 64}[envelope_indicator]
    offset = 8
    if envelope_indicator:
        values = struct.unpack(f"<{envelope_size // 8}d", blob[offset:offset + envelope_size])
        # GeoPackage envelope order is Xmin, Xmax, Ymin, Ymax (not
        # Xmin, Ymin, Xmax, Ymax as in WKB).
        envelope = (values[0], values[2], values[1], values[3])
        offset += envelope_size
    else:
        envelope = (np.nan, np.nan, np.nan, np.nan)
    # WKB: byte order, geometry type, ring count, then points.
    byte_order = blob[offset]
    endian = "<" if byte_order == 1 else ">"
    geometry_type = struct.unpack(f"{endian}I", blob[offset + 1:offset + 5])[0]
    if geometry_type != 3:
        raise ValueError(f"expected POLYGON, got geometry type {geometry_type}")
    ring_count = struct.unpack(f"{endian}I", blob[offset + 5:offset + 9])[0]
    if ring_count < 1:
        raise ValueError("polygon without rings")
    point_count = struct.unpack(f"{endian}I", blob[offset + 9:offset + 13])[0]
    points = []
    cursor = offset + 13
    for _ in range(point_count):
        x, y = struct.unpack(f"{endian}dd", blob[cursor:cursor + 16])
        points.append((x, y))
        cursor += 16
    if envelope_indicator == 0:
        xs = [p[0] for p in points]
        ys = [p[1] for p in points]
        envelope = (min(xs), min(ys), max(xs), max(ys))
    return envelope, points


def load_grid_cells(raw_dir: Path) -> pd.DataFrame:
    """Published 1 km cells with Lambert-93 envelope and resident population."""
    archive = raw_dir / config.SOURCES["rp_1km_grid"]
    with zipfile.ZipFile(archive) as zf:
        member = [n for n in zf.namelist() if n.lower().endswith(".gpkg")][0]
        target = config.EXTRACT_DIR / "rp2021_carreaux_1km.gpkg"
        target.parent.mkdir(parents=True, exist_ok=True)
        if not target.exists():
            target.write_bytes(zf.read(member))
    con = sqlite3.connect(target)
    try:
        srs = con.execute("select srs_id from gpkg_geometry_columns").fetchall()
        if {row[0] for row in srs} != {2154}:
            raise ValueError(f"expected Lambert-93 (2154), got {srs}")
        rows = con.execute(
            "select id_carreau_1km, pop, carreau_traite_secret, geom from carreaux"
        ).fetchall()
    finally:
        con.close()
    records = []
    for identifier, pop, secret, blob in rows:
        envelope, ring = _gpkg_geometry(blob)
        match = _GRID_ID.search(identifier)
        records.append({
            "id_carreau_1km": identifier,
            "cell_minx": envelope[0],
            "cell_miny": envelope[1],
            "cell_maxx": envelope[2],
            "cell_maxy": envelope[3],
            "rings": ring,
            "cell_pop": float(pop) if pop is not None else np.nan,
            "carreau_traite_secret": secret,
            "grid_resolution_m": int(match.group(1)) if match else np.nan,
        })
    frame = pd.DataFrame.from_records(records)
    if not frame["grid_resolution_m"].eq(1000).all():
        raise ValueError("grid contains cells that are not 1 km")
    return frame


def cells_containing(cells: pd.DataFrame, lon: float, lat: float) -> list[str]:
    """Identifiers of the published cells whose polygon contains a WGS84 point.

    Convenience for tests and spot checks: the caller passes lon/lat and the
    point is reprojected to Lambert-93 before the polygon test.
    """
    x, y = _WGS84_TO_LAMBERT93.transform(lon, lat)
    inside = cells[(cells["cell_minx"] <= x) & (x <= cells["cell_maxx"])
                   & (cells["cell_miny"] <= y) & (y <= cells["cell_maxy"])]
    return [cid for cid, ring in zip(inside["id_carreau_1km"], inside["rings"])
            if _ring_contains(ring, x, y)]


def assign_cells(points: pd.DataFrame, cells: pd.DataFrame) -> pd.Series:
    """Containing cell for each point, by point-in-polygon on the published cells.

    ``points`` carries Lambert-93 ``x``/``y`` (the native DVF+ mutation
    centroid is already projected, not lon/lat). The grid is a 1 km lattice
    defined in the grid's own axis; reprojected into Lambert-93 the cells are
    ~1,086 m wide and slightly rotated, so a lattice lookup is wrong.
    Containment is tested against the real polygons, with an envelope
    prefilter and a winding-number test on each candidate.

    A point on a shared edge is claimed by two cells; the smaller identifier
    wins, matching ``cells_containing``.
    """
    if cells.empty or points.empty:
        return pd.Series(pd.NA, index=points.index, dtype="object")
    x = points["x"].to_numpy(dtype=float)
    y = points["y"].to_numpy(dtype=float)
    rings = {cid: ring for cid, ring in zip(cells["id_carreau_1km"], cells["rings"])}
    minx = cells["cell_minx"].to_numpy()
    maxx = cells["cell_maxx"].to_numpy()
    miny = cells["cell_miny"].to_numpy()
    maxy = cells["cell_maxy"].to_numpy()
    ids = cells["id_carreau_1km"].to_numpy()
    result = np.full(len(x), None, dtype=object)
    # Envelope prefilter: candidate cells per point, then exact ring test.
    for row in range(len(x)):
        px, py = x[row], y[row]
        candidates = np.nonzero((minx <= px) & (px <= maxx)
                                & (miny <= py) & (py <= maxy))[0]
        if candidates.size == 0:
            continue
        hits = [ids[c] for c in candidates if _ring_contains(rings[ids[c]], px, py)]
        if hits:
            result[row] = min(hits)
    return pd.Series(result, index=points.index, dtype="object")


def _ring_contains(ring, px: float, py: float) -> bool:
    """Winding-number point-in-polygon test for a closed ring."""
    inside = False
    n = len(ring)
    for i in range(n - 1):
        x1, y1 = ring[i]
        x2, y2 = ring[i + 1]
        if (y1 > py) != (y2 > py):
            x_cross = x1 + (py - y1) * (x2 - x1) / (y2 - y1)
            if px < x_cross:
                inside = not inside
    return inside


def density_features(raw_dir: Path, points: pd.DataFrame) -> pd.DataFrame:
    """People per full nominal km2 of the containing RP2021 cell.

    A missing cell is unknown, never zero. The nominal cell area is exactly
    1 km2, so the population of the containing cell is the density.
    """
    cells = load_grid_cells(raw_dir)
    out = points.copy()
    out["rp_cell_id"] = assign_cells(points, cells)
    population = cells.set_index("id_carreau_1km")["cell_pop"]
    secret = cells.set_index("id_carreau_1km")["carreau_traite_secret"]
    out["rp1km_pop"] = out["rp_cell_id"].map(population)
    out["rp1km_density"] = out["rp1km_pop"]
    out["rp_cell_secret"] = out["rp_cell_id"].map(secret)
    out["rp_cell_matched"] = out["rp_cell_id"].notna()
    return out
