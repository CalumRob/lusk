"""AEDAR 2026-v1 accessibility starter: three BPE 2025 equipment types.

Owner-approved replacement for the gamme scores: A129 MAIRIE, B105
SUPERMARCHÉ ET MAGASIN MULTI-COMMERCE, B302 MAGASIN DE VÊTEMENTS, at the
15-minute horizon, for bicycle LTS2 / transit p1 / car.

Source contract (``address-<mode>-53-2026v1.parquet``): one sparse row per
(address, TYPEQU). The observed-origin universe is therefore the set of
addresses present in the all-TYPEQU address-mode file, never an index
prefiltered to the three selected types.

Memory shape: the origin files hold 1.5-1.6 M addresses and 73-233 M sparse
rows. They are scanned one row group at a time (the files are laid out by
commune); only the distinct origin keys with coordinates are retained, and the
selected-type rows are reduced to the origins actually needed.
"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.parquet as pq
from pyproj import Transformer
from scipy.spatial import cKDTree

from . import config

_WGS84_TO_LAMBERT93 = Transformer.from_crs("EPSG:4326", "EPSG:2154", always_xy=True)

MODE_FILES = {
    "bike_lts2": "address-bike-lts2-53-2026v1.parquet",
    "transit_p1": "address-transit-53-2026v1.parquet",
    "car": "address-car-53-2026v1.parquet",
}
COUNT_FIELD = {
    "bike_lts2": "count_15_bike_lts2",
    "transit_p1": "count_15_transit_p1",
    "car": "count_15_car",
}
SELECTED = tuple(config.AEDAR_TYPES)


def address_key(code_insee, cle_interop):
    return np.char.add(np.char.add(np.asarray(code_insee, dtype=str), "-"),
                       np.asarray(cle_interop, dtype=str))


def _row_groups(table: pq.ParquetFile):
    for group in range(table.metadata.num_row_groups):
        yield table.read_row_group(group)


@lru_cache(maxsize=1)
def observed_origins(raw_dir: Path, mode: str = "car") -> pd.DataFrame:
    """All observed residential origins (all-TYPEQU) with coordinates.

    The car-mode file is the widest all-TYPEQU address universe in the 2026-v1
    snapshot (1,612,032 origins), so it is the origin spine.
    """
    table = pq.ParquetFile(raw_dir / MODE_FILES[mode])
    seen: dict[str, int] = {}
    keys, lons, lats = [], [], []
    for group in _row_groups(table):
        joined = pc.binary_join_element_wise(
            group.column("code_insee"), group.column("cle_interop_adr"), "-")
        lon = group.column("lon").to_numpy(zero_copy_only=False)
        lat = group.column("lat").to_numpy(zero_copy_only=False)
        for index, key in enumerate(joined.to_pylist()):
            if key not in seen:
                seen[key] = len(keys)
                keys.append(key)
                lons.append(lon[index])
                lats.append(lat[index])
    return pd.DataFrame({"origin_key": keys, "lon": lons, "lat": lats})


def selected_type_reachability(raw_dir: Path, mode: str,
                               wanted_keys: set[str]) -> pd.DataFrame:
    """At-least-one-reachable flags and source counts for the three types."""
    table = pq.ParquetFile(raw_dir / MODE_FILES[mode])
    count = COUNT_FIELD[mode]
    wanted = set(wanted_keys)
    frames = []
    for group in _row_groups(table):
        mask = pc.is_in(group.column("TYPEQU"), value_set=pa.array(SELECTED))
        selected = group.filter(mask)
        if selected.num_rows == 0:
            continue
        keys = pc.binary_join_element_wise(
            selected.column("code_insee"), selected.column("cle_interop_adr"), "-")
        key_array = keys.to_numpy(zero_copy_only=False)
        keep = np.fromiter((k in wanted for k in key_array.tolist()),
                           dtype=bool, count=len(key_array))
        if not keep.any():
            continue
        frames.append(pd.DataFrame({
            "origin_key": key_array[keep],
            "typequ": selected.column("TYPEQU").to_numpy(zero_copy_only=False)[keep],
            "count": selected.column(count).to_numpy(zero_copy_only=False)[keep],
        }))
    if not frames:
        empty = pd.DataFrame({"origin_key": sorted(wanted)})
        for typequ in SELECTED:
            empty[f"count_{typequ}_{mode}"] = 0.0
            empty[f"reach_{typequ}_{mode}"] = False
        return empty
    frame = pd.concat(frames, ignore_index=True)
    wide = frame.pivot_table(index="origin_key", columns="typequ", values="count",
                             aggfunc="sum").fillna(0)
    out = pd.DataFrame(index=wide.index)
    for typequ in SELECTED:
        column = wide[typequ] if typequ in wide.columns else 0
        out[f"count_{typequ}_{mode}"] = pd.Series(column, index=wide.index).astype(float)
        out[f"reach_{typequ}_{mode}"] = out[f"count_{typequ}_{mode}"] > 0
    return out.reset_index()


def nearest_origin(points: pd.DataFrame, origins: pd.DataFrame) -> pd.DataFrame:
    """Nearest observed origin via a KD-tree in Lambert-93 metres.

    Both sides are EPSG:2154: the AEDAR address origins ship as lon/lat and are
    reprojected once, while the DVF+ mutation centroid is already Lambert-93.
    The distance is used only to pick the nearest origin and is kept for
    provenance, not as a model feature.
    """
    ox, oy = _WGS84_TO_LAMBERT93.transform(
        origins["lon"].to_numpy(dtype=float), origins["lat"].to_numpy(dtype=float))
    tree = cKDTree(np.column_stack([ox, oy]))
    px = points["x"].to_numpy(dtype=float)
    py = points["y"].to_numpy(dtype=float)
    distance, index = tree.query(np.column_stack([px, py]), k=1, workers=-1)
    return pd.DataFrame({
        "origin_key": origins["origin_key"].to_numpy()[index],
        "origin_distance_km": distance / 1000.0,
    })


def build_access_features(raw_dir: Path, points: pd.DataFrame) -> pd.DataFrame:
    """Match each point to its nearest observed origin and read the nine flags."""
    origins = observed_origins(raw_dir)
    matched = nearest_origin(points.reset_index(drop=True), origins)
    out = points.reset_index(drop=True).copy().reset_index(drop=True)
    out["origin_key"] = matched["origin_key"].to_numpy()
    out["origin_distance_km"] = matched["origin_distance_km"].to_numpy()
    out["origin_matched"] = out["origin_key"].notna()
    wanted = set(out.loc[out["origin_matched"], "origin_key"])
    del origins
    for mode in config.AEDAR_MODES:
        reach = selected_type_reachability(raw_dir, mode, wanted)
        out = out.merge(reach, on="origin_key", how="left")
        for typequ in SELECTED:
            count_col = f"count_{typequ}_{mode}"
            flag_col = f"reach_{typequ}_{mode}"
            # Known origin + absent sparse selected-type row = zero under the
            # source contract. Unmatched origin evidence stays unknown.
            known = out["origin_matched"]
            counts = out[count_col].where(known, np.nan).fillna(0.0)
            out[count_col] = counts.where(known, np.nan)
            flags = out[flag_col].astype("boolean").fillna(False).astype(bool)
            out[flag_col] = pd.array(np.where(known, flags, None), dtype="boolean")
    return out
