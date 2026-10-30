"""Feature assembly for the model stages (issue #736).

One row per native DVF+ mutation. Every input belongs to exactly one reporting
block, so the decomposition can group contributions without inventing groups
at reporting time.

Rules carried from the owner-approved issue body:
  * age at sale = sale year - BDNB group construction year; the source year is
    retained, missing year stays unknown, construction after sale is flagged
    and never clamped to zero;
  * house/apartment composition is represented, not used to filter;
  * the nine AEDAR flags are at-least-one-reachable at 15 minutes for
    bicycle LTS2 / transit p1 / car, with source counts kept separately;
  * RP2021 1 km density is local setting, joined on the labelled mutation
    centroid proxy;
  * identifiers (mutation, group, address, commune) are keys, never predictors.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from . import config

# block -> ordered feature list. Order is the single source of truth for the
# model matrix and for grouped attribution.
FEATURE_BLOCKS: dict[str, list[str]] = {
    "property": [
        "log_residential_surface",
        "house_surface_share",
        "house_count",
        "apartment_count",
        "activity_count",
        "mixed_house_apartment",
        "group_nb_log",
        "group_nb_niveau",
        "group_height_mean",
        "group_height_max",
        "age_at_sale",
        "age_unknown",
        "group_built_after_sale",
        "group_fictive_geometry",
    ],
    "access": [
        f"reach_{typequ}_{mode}"
        for mode in config.AEDAR_MODES
        for typequ in config.AEDAR_TYPES
    ],
    "local": [
        "log_rp1km_density",
    ],
    "timing": [
        "sale_year",
        "sale_month",
    ],
    "space": [
        "x_km",
        "y_km",
    ],
}

CATEGORICAL_BLOCKS = {
    "property": ["group_usage", "group_ffo_usage"],
}

TARGET = "log_y"


def reporting_group_of(feature: str) -> str:
    for block, names in FEATURE_BLOCKS.items():
        if feature in names:
            return block
    for block, names in CATEGORICAL_BLOCKS.items():
        if feature in names:
            return block
    raise KeyError(f"feature {feature!r} has no reporting block")


def model_estimation_subset(frame: pd.DataFrame) -> pd.DataFrame:
    """Rows usable for fitting, with the exclusion reason made explicit.

    The audited cohort is never redefined: this is a named subset whose size
    and selection are reported alongside the matched baseline.
    """
    keep = (
        frame["main_cohort"]
        & ~frame["price_sentinel"]
        & frame["log_y"].notna()
        & np.isfinite(frame["log_y"])
    )
    return frame[keep].copy()


def build_matrix(frame: pd.DataFrame) -> tuple[pd.DataFrame, pd.Series, pd.DataFrame]:
    """Return (numeric matrix, target, categorical frame) for the given rows."""
    out = pd.DataFrame(index=frame.index)
    out["log_residential_surface"] = np.log(frame["residential_surface"].clip(lower=1.0))
    out["house_surface_share"] = frame["house_surface_share"]
    out["house_count"] = frame["house_count"]
    out["apartment_count"] = frame["apartment_count"]
    out["activity_count"] = frame["activity_count"]
    out["mixed_house_apartment"] = frame["mixed_house_apartment"].astype(float)
    out["group_nb_log"] = frame["group_nb_log"]
    out["group_nb_niveau"] = frame["group_nb_niveau"]
    out["group_height_mean"] = frame["group_height_mean"]
    out["group_height_max"] = frame["group_height_max"]
    out["age_at_sale"] = frame["age_at_sale"]
    out["age_unknown"] = frame["age_at_sale"].isna().astype(float)
    out["group_built_after_sale"] = frame["group_built_after_sale"].astype(float)
    out["group_fictive_geometry"] = frame["group_fictive_geometry"].where(
        frame["group_fictive_geometry"] >= 0)
    for mode in config.AEDAR_MODES:
        for typequ in config.AEDAR_TYPES:
            column = f"reach_{typequ}_{mode}"
            out[column] = frame[column].astype("boolean").astype("Float64")
    out["log_rp1km_density"] = np.log(frame["rp1km_density"].clip(lower=1.0))
    out["sale_year"] = frame["sale_year"].astype(float)
    out["sale_month"] = frame["sale_month"].astype(float)
    # Coordinates in km keep the tree split thresholds interpretable.
    out["x_km"] = frame["geompar_x"].astype(float) / 1000.0
    out["y_km"] = frame["geompar_y"].astype(float) / 1000.0

    categorical = pd.DataFrame(index=frame.index)
    categorical["group_usage"] = frame["group_usage"].fillna("UNKNOWN").astype(str)
    categorical["group_ffo_usage"] = frame["group_ffo_usage"].fillna("UNKNOWN").astype(str)

    expected = [f for names in FEATURE_BLOCKS.values() for f in names]
    missing = [f for f in expected if f not in out.columns]
    if missing:
        raise KeyError(f"feature builder is missing declared features: {missing}")
    out = out[expected]
    target = frame[TARGET].astype(float)
    return out, target, categorical


def coverage_table(frame: pd.DataFrame) -> pd.DataFrame:
    """Per-feature availability over the estimation subset (sanitised)."""
    rows = []
    total = len(frame)
    for block, names in FEATURE_BLOCKS.items():
        for name in names:
            if name in frame.columns:
                present = frame[name].notna().sum()
            else:
                present = np.nan
            rows.append({
                "block": block,
                "feature": name,
                "n_present": int(present) if pd.notna(present) else 0,
                "share_present": round(float(present) / total, 4) if total else np.nan,
            })
    for block, names in CATEGORICAL_BLOCKS.items():
        for name in names:
            present = frame[name].notna().sum()
            rows.append({
                "block": block,
                "feature": name,
                "n_present": int(present),
                "share_present": round(float(present) / total, 4) if total else np.nan,
            })
    return pd.DataFrame(rows)
