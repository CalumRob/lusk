"""Territorial aggregation and the observed geometric price index.

The index is computed from observed transactions only, one weight per
mutation: ``mu_T = mean(ln price/m2 in T)`` and ``100 * exp(mu_T - mu_B)``.
The median euro/m2 is kept as a descriptive statistic and is never the object
of the decomposition.
"""
from __future__ import annotations

import numpy as np
import pandas as pd


def observed_territory_stats(frame: pd.DataFrame, key: str) -> pd.DataFrame:
    """Observed geometric price index and descriptive statistics per territory."""
    grouped = frame.groupby(key)
    stats = grouped.agg(
        n=("log_y", "size"),
        mean_log_y=("log_y", "mean"),
        sd_log_y=("log_y", "std"),
        median_price_m2=("price_per_m2", "median"),
        mean_price_m2=("price_per_m2", "mean"),
        n_house=("has_house", "sum"),
        n_apartment=("has_apartment", "sum"),
        n_activity=("has_activity", "sum"),
        n_mixed=("mixed_house_apartment", "sum"),
    )
    reference = float(frame["log_y"].mean())
    stats["mu_B"] = reference
    stats["log_gap"] = stats["mean_log_y"] - reference
    stats["index_vs_brittany"] = 100.0 * np.exp(stats["log_gap"])
    stats["se_mean_log_y"] = stats["sd_log_y"] / np.sqrt(stats["n"])
    return stats.reset_index()


def year_support(frame: pd.DataFrame, key: str) -> pd.DataFrame:
    """Mutations per (territory, sale year) for stability reporting."""
    table = frame.groupby([key, "anneemut"]).size().unstack(fill_value=0)
    table.columns = [f"n_{int(c)}" for c in table.columns]
    return table.reset_index()
