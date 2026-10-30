"""Contract tests for the RP2021 1 km density join (issue #736).

The grid is INSEE's published 1 km carroyage in Lambert-93. The join must use
the cell *polygons*, not a reconstruction from the identifier string: the
identifier encodes a corner in the grid's own axis, which is not a coordinate
contract for arbitrary points.

These tests are the done-when check for the density family: they fail while
the join is wrong and must pass before the feature is used.
"""
from __future__ import annotations

import sqlite3
import zipfile

import pandas as pd
import pytest

from habitat_price import config, local_setting

# Well-known Breton city hall coordinates (WGS84 lon/lat). Each must fall
# inside exactly one published cell, and that cell must be the one whose
# polygon contains the point.
LOCALITIES = {
    "Rennes": (-1.6778, 48.1173),
    "Brest": (-4.4861, 48.3904),
    "Vannes": (-2.7608, 47.6582),
    "Saint-Brieuc": (-2.7608, 48.5136),
    "Quimper": (-4.1024, 47.9960),
}


@pytest.fixture(scope="module")
def grid_gpkg(tmp_path_factory) -> str:
    archive = config.RAW_DIR / config.SOURCES["rp_1km_grid"]
    if not archive.is_file():
        pytest.skip("RP2021 1 km grid archive is not present")
    target = tmp_path_factory.mktemp("rp1km") / "grid.gpkg"
    with zipfile.ZipFile(archive) as zf:
        member = [n for n in zf.namelist() if n.lower().endswith(".gpkg")][0]
        target.write_bytes(zf.read(member))
    return str(target)


def test_grid_declares_lambert_93(grid_gpkg):
    """The published grid is Lambert-93 (EPSG:2154), not EPSG:3035."""
    con = sqlite3.connect(grid_gpkg)
    try:
        rows = con.execute(
            "select table_name, column_name, srs_id from gpkg_geometry_columns"
        ).fetchall()
    finally:
        con.close()
    assert rows, "no geometry columns declared"
    srs_ids = {row[2] for row in rows}
    assert srs_ids == {2154}, f"expected Lambert-93 (2154), got {srs_ids}"


def test_cell_geometry_parses(grid_gpkg):
    """Geometry blobs parse to polygons with a plausible Lambert-93 envelope."""
    cells = local_setting.load_grid_cells(config.RAW_DIR)
    assert len(cells) > 300_000
    # Brittany lies roughly within these Lambert-93 bounds.
    assert cells["cell_minx"].min() > 0
    assert cells["cell_miny"].min() > 6_000_000
    assert cells["cell_maxx"].max() < 1_400_000
    assert cells["cell_maxy"].max() < 7_200_000


@pytest.mark.parametrize("name", sorted(LOCALITIES))
def test_locality_lands_in_one_cell(grid_gpkg, name):
    """Each known locality is contained by one cell, or two on a shared edge.

    A point exactly on a cell boundary is shared by two adjacent cells; the
    join resolves that deterministically to the smaller identifier. Anything
    other than 1 or 2 matches means the geometry or projection is wrong.
    """
    lon, lat = LOCALITIES[name]
    cells = local_setting.load_grid_cells(config.RAW_DIR)
    matches = local_setting.cells_containing(cells, lon, lat)
    assert 1 <= len(matches) <= 2, f"{name}: got {len(matches)} containing cells"
    from pyproj import Transformer
    x, y = Transformer.from_crs("EPSG:4326", "EPSG:2154", always_xy=True).transform(lon, lat)
    resolved = local_setting.assign_cells(pd.DataFrame({"x": [x], "y": [y]}), cells)
    assert resolved.iloc[0] == min(matches)


def test_locality_cells_are_distinct(grid_gpkg):
    """The five localities do not collapse into one cell (guards a bad index)."""
    cells = local_setting.load_grid_cells(config.RAW_DIR)
    found = {name: local_setting.cells_containing(cells, lon, lat)[0]
             for name, (lon, lat) in LOCALITIES.items()}
    assert len(set(found.values())) == len(LOCALITIES), found
