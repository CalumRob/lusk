"""Stage 1: reconstruct the native cohort, attach group/access/local context.

Writes private per-mutation tables under ``pipeline/data/processed/
habitat-price/private`` and sanitised coverage tables under ``evidence/``.
"""
from __future__ import annotations

import json
import time
from pathlib import Path

import numpy as np
import pandas as pd

from . import aedar, bdnb, cohort, config, local_setting, sources


def _log(message: str) -> None:
    print(f"[stage1] {message}", flush=True)


def load_points(frame: pd.DataFrame) -> pd.DataFrame:
    """Mutation-centroid proxy coordinates.

    DVF+ native ``geompar_x``/``geompar_y`` are already Lambert-93 (EPSG:2154)
    metres, not lon/lat. They are an explicitly labelled proxy: approved for
    the RP2021 1 km grid join and for the nearest-observed-AEDAR-origin match.
    """
    points = pd.DataFrame({
        "x": pd.to_numeric(frame["geompar_x"], errors="coerce"),
        "y": pd.to_numeric(frame["geompar_y"], errors="coerce"),
    }, index=frame.index)
    return points


def run(raw_dir: Path = config.RAW_DIR, force: bool = False) -> dict:
    started = time.time()
    config.PRIVATE_DIR.mkdir(parents=True, exist_ok=True)
    config.EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
    manifest_path = config.EVIDENCE_DIR / "source-manifest.json"
    manifest = sources.write_manifest(manifest_path)
    _log(f"manifest written ({len(manifest['files'])} files)")

    dvf = cohort.read_native_dvf(raw_dir / config.SOURCES["dvf_plus_native"])
    _log(f"native DVF+ rows: {len(dvf)}")
    relation = cohort.load_bdnb_relation(raw_dir)
    _log(f"BDNB relation rows: {len(relation)}")
    classified = cohort.classify_mutations(dvf, relation)
    coverage = cohort.coverage_summary(classified)
    coverage.to_csv(config.EVIDENCE_DIR / "cohort-coverage.csv", index=False)

    main = classified[classified["main_cohort"]].copy()
    _log(f"main cohort mutations: {len(main)}")
    flags = cohort.composition_flags(main)
    main = pd.concat([main, flags], axis=1)

    groups = bdnb.descriptor_frame(bdnb.load_group_descriptors(raw_dir))
    main = bdnb.attach_group_context(main, relation, groups)
    _log(f"group matched: {int(main['group_matched'].sum())}")

    points = load_points(main)
    valid = points["x"].notna() & points["y"].notna()
    access = pd.DataFrame(index=main.index)
    access["origin_key"] = pd.Series(pd.NA, index=main.index, dtype="object")
    access["origin_distance_km"] = np.nan
    for mode in config.AEDAR_MODES:
        for typequ in config.AEDAR_TYPES:
            access[f"count_{typequ}_{mode}"] = np.nan
            access[f"reach_{typequ}_{mode}"] = pd.array([None] * len(main), dtype="boolean")
    if valid.any():
        built = aedar.build_access_features(raw_dir, points[valid])
        built.index = points.index[valid]
        for column in built.columns:
            access.loc[built.index, column] = built[column]
    access["origin_matched"] = access["origin_key"].notna()
    main = pd.concat([main, access], axis=1)
    _log(f"origin matched: {int(main['origin_matched'].sum())}")

    local = pd.DataFrame(index=main.index)
    local["rp_cell_id"] = pd.Series(pd.NA, index=main.index, dtype="object")
    local["rp1km_pop"] = np.nan
    local["rp1km_density"] = np.nan
    local["rp_cell_secret"] = np.nan
    local["rp_cell_matched"] = False
    if valid.any():
        density = local_setting.density_features(raw_dir, points[valid])
        density.index = points.index[valid]
        for column in ("rp_cell_id", "rp1km_pop", "rp1km_density",
                       "rp_cell_secret", "rp_cell_matched"):
            local.loc[density.index, column] = density[column]
    main = pd.concat([main, local], axis=1)
    _log(f"RP cell matched: {int(main['rp_cell_matched'].sum())}")

    main["sale_year"] = main["anneemut"].astype(int)
    main["sale_month"] = main["moismut"].astype("Int64")
    main["departement"] = main["coddep"].astype(str).str.zfill(2)
    private_path = config.PRIVATE_DIR / "cohort_mutations.parquet"
    main.to_parquet(private_path, index=False)
    _log(f"private cohort written: {private_path}")

    by_year = main.groupby("sale_year").size().to_dict()
    summary = {
        "native_rows": int(len(dvf)),
        "main_cohort": int(len(main)),
        "by_year": {str(k): int(v) for k, v in by_year.items()},
        "group_matched": int(main["group_matched"].sum()),
        "origin_matched": int(main["origin_matched"].sum()),
        "rp_cell_matched": int(main["rp_cell_matched"].sum()),
        "wall_seconds": round(time.time() - started, 1),
    }
    (config.EVIDENCE_DIR / "stage1-summary.json").write_text(
        json.dumps(summary, indent=2), encoding="utf-8")
    _log(json.dumps(summary))
    return summary
