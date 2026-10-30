"""BDNB 2026-02.a group descriptors for the FORTE-linked mutations.

Group-level enrichment only: these describe the producer group associated with
the mutation, not a verified exact dwelling. Construction year is kept as the
source field; the model input is approximate age at sale.
"""
from __future__ import annotations

import re
from pathlib import Path

import numpy as np
import pandas as pd

from . import config

_PARSE_INT = re.compile(r"-?\d+")


def _first_int(value) -> float:
    if value is None or (isinstance(value, float) and np.isnan(value)):
        return np.nan
    match = _PARSE_INT.search(str(value))
    return float(match.group()) if match else np.nan


def _first_float(value) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return np.nan


def load_group_descriptors(raw_dir: Path) -> pd.DataFrame:
    frames = []
    for department in config.BDNB_DEPARTMENTS:
        folder = raw_dir / f"bdnb-2026-02-a-dep{department}"
        groupes = pd.read_csv(folder / "batiment_groupe.csv", sep=";", dtype=str,
                              usecols=["batiment_groupe_id", "code_commune_insee",
                                       "code_epci_insee", "contient_fictive_geom_groupe"],
                              keep_default_na=False, na_values=[""], encoding="utf-8")
        ffo = pd.read_csv(folder / "batiment_groupe_ffo_bat.csv", sep=";", dtype=str,
                          keep_default_na=False, na_values=[""], encoding="utf-8")
        bdtopo = pd.read_csv(folder / "batiment_groupe_bdtopo_bat.csv", sep=";", dtype=str,
                             usecols=["batiment_groupe_id", "hauteur_mean", "max_hauteur"],
                             keep_default_na=False, na_values=[""], encoding="utf-8")
        usage = pd.read_csv(folder / "batiment_groupe_synthese_propriete_usage.csv", sep=";",
                            dtype=str, keep_default_na=False, na_values=[""], encoding="utf-8")
        frame = groupes.merge(ffo, on="batiment_groupe_id", how="left", suffixes=("", "_ffo"))
        frame = frame.merge(bdtopo, on="batiment_groupe_id", how="left")
        frame = frame.merge(usage, on="batiment_groupe_id", how="left")
        frame["department"] = department
        frames.append(frame)
    return pd.concat(frames, ignore_index=True)


def descriptor_frame(groups: pd.DataFrame) -> pd.DataFrame:
    """Normalise the group descriptors used by the model."""
    out = pd.DataFrame({"batiment_groupe_id": groups["batiment_groupe_id"]})
    out["group_construction_year"] = groups["annee_construction"].map(_first_int)
    out["group_nb_niveau"] = groups["nb_niveau"].map(_first_float)
    out["group_nb_log"] = groups["nb_log"].map(_first_float)
    out["group_height_mean"] = groups["hauteur_mean"].map(_first_float)
    out["group_height_max"] = groups["max_hauteur"].map(_first_float)
    out["group_usage"] = groups["usage_principal_bdnb_open"].fillna("UNKNOWN").astype(str)
    out["group_ffo_usage"] = groups["usage_niveau_1_txt"].fillna("UNKNOWN").astype(str)
    out["group_fictive_geometry"] = pd.to_numeric(
        groups["contient_fictive_geom_groupe"], errors="coerce").fillna(-1).astype(int)
    out["group_commune"] = groups["code_commune_insee"].astype(str).str.zfill(5)
    out["group_epci"] = groups["code_epci_insee"].astype(str)
    return out.drop_duplicates("batiment_groupe_id")


def attach_group_context(cohort: pd.DataFrame, relation: pd.DataFrame,
                         descriptors: pd.DataFrame) -> pd.DataFrame:
    """Attach the single FORTE group of each mutation and its descriptors."""
    forte = relation[relation["fiabilite_croisement"].eq("FORTE")][
        ["id_opendata", "batiment_groupe_id"]].drop_duplicates()
    forte = forte.rename(columns={"batiment_groupe_id": "group_id"})
    merged = cohort.merge(forte, left_on="idopendata", right_on="id_opendata", how="left")
    # The descriptor frame is keyed by group id; keep the cohort's own key and
    # read the construction year from the descriptor row.
    descriptor_columns = [c for c in descriptors.columns if c != "batiment_groupe_id"]
    merged = merged.merge(descriptors[["batiment_groupe_id"] + descriptor_columns],
                          left_on="group_id", right_on="batiment_groupe_id",
                          how="left", suffixes=("", "_descriptor"))
    merged["group_matched"] = merged["group_id"].notna() & merged["batiment_groupe_id"].notna()
    merged["age_at_sale"] = merged["anneemut"].astype("float") - merged["group_construction_year"]
    merged["group_built_after_sale"] = merged["age_at_sale"] < 0
    merged.loc[~merged["group_matched"], "age_at_sale"] = np.nan
    merged.loc[~merged["group_matched"], "group_built_after_sale"] = False
    return merged
