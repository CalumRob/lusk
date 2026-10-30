"""Commune context families and the strictly-before reference-year rule.

Implemented families (exact source contract verified in this run):
  * Sitadel housing: authorised and started housing rates per 1,000 dwellings
    (commune reference year strictly before the sale year).

Staged / not implemented in this first run (see the report's coverage matrix):
  * INSEE RP 2023 second-home, vacancy, age-65+ and one-person-household shares;
  * Filosofi median standard of living (2021/2023 methodological break);
  * migration inflow/outflow rates.
These are reported as unavailable rather than filled with placeholder values.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd

from . import config

SITADEL_SOURCES = {
    "22": "sitadel_22", "29": "sitadel_29", "35": "sitadel_35", "56": "sitadel_56",
}


def load_sitadel(raw_dir: Path) -> pd.DataFrame:
    frames = []
    for department, key in SITADEL_SOURCES.items():
        frame = pd.read_csv(raw_dir / config.SOURCES[key], sep=";", dtype=str,
                            encoding="utf-8")
        frame["source_file"] = config.SOURCES[key]
        frames.append(frame)
    sitadel = pd.concat(frames, ignore_index=True)
    sitadel = sitadel.rename(columns={"ANNEE": "reference_year", "COMM": "code_commune"})
    sitadel["reference_year"] = pd.to_numeric(sitadel["reference_year"], errors="coerce")
    sitadel["LOG_AUT"] = pd.to_numeric(sitadel["LOG_AUT"], errors="coerce")
    sitadel["LOG_COM"] = pd.to_numeric(sitadel["LOG_COM"], errors="coerce")
    sitadel["code_commune"] = sitadel["code_commune"].astype(str).str.zfill(5)
    return sitadel


def latest_before(series: pd.DataFrame, sale_year: pd.Series,
                  year_column: str = "reference_year") -> pd.DataFrame:
    """Keep the latest reference row strictly before each sale year.

    Returns one row per (sale year, key) with ``reference_year`` retained.
    """
    rows = []
    for sale in sorted(sale_year.dropna().unique()):
        eligible = series[series[year_column] < sale]
        if eligible.empty:
            continue
        latest = eligible[year_column].max()
        chunk = eligible[eligible[year_column] == latest].copy()
        chunk["sale_year"] = sale
        rows.append(chunk)
    if not rows:
        return series.iloc[0:0].assign(sale_year=[])
    return pd.concat(rows, ignore_index=True)


def sitadel_rates(raw_dir: Path, dwelling_stock: pd.Series) -> pd.DataFrame:
    """Authorised and started housing rates per 1,000 dwellings.

    ``dwelling_stock`` is indexed by commune code. A missing stock leaves the
    rate unknown; a reported zero count stays a reported zero.
    """
    sitadel = load_sitadel(raw_dir)
    totals = sitadel[sitadel["TYPE_LGT"].eq("Tous Logements")].copy()
    grouped = totals.groupby(["code_commune", "reference_year"]).agg(
        authorised=("LOG_AUT", "sum"),
        started=("LOG_COM", "sum"),
        rows=("LOG_AUT", "size"),
    ).reset_index()
    grouped["stock"] = grouped["code_commune"].map(dwelling_stock)
    grouped["sitadel_authorised_per_1000"] = 1000.0 * grouped["authorised"] / grouped["stock"]
    grouped["sitadel_started_per_1000"] = 1000.0 * grouped["started"] / grouped["stock"]
    grouped.loc[grouped["stock"].isna() | (grouped["stock"] <= 0),
                ["sitadel_authorised_per_1000", "sitadel_started_per_1000"]] = np.nan
    return grouped


def attach_sitadel(cohort: pd.DataFrame, rates: pd.DataFrame) -> pd.DataFrame:
    """Attach the latest strictly-before reference-year Sitadel rates."""
    selected = latest_before(rates, cohort["anneemut"].astype(float))
    selected = selected.rename(columns={"reference_year": "sitadel_reference_year"})
    keys = ["code_commune", "sale_year"]
    merged = cohort.merge(selected[keys + ["sitadel_reference_year", "authorised",
                                           "started", "stock",
                                           "sitadel_authorised_per_1000",
                                           "sitadel_started_per_1000"]],
                          left_on=["group_commune", "anneemut"],
                          right_on=["code_commune", "sale_year"], how="left")
    return merged.drop(columns=["code_commune", "sale_year"])
