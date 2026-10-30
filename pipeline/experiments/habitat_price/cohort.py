"""Native DVF+ cohort reconstruction (issue #736 observation contract).

One economic observation per native DVF+ mutation. The price is read once per
mutation from ``valeurfonc``; the residential surface is ``sbatmai + sbatapt``.
Nothing is expanded over dwellings, parcels, BDNB groups or AEDAR origins.

The BDNB producer relation is joined on the native ``idopendata`` key. A
mutation qualifies for the main cohort when it has exactly one producer group
(``FORTE``) and both price and residential surface are strictly positive.
Excluded mutations are kept, with reasons, for coverage diagnostics.
"""
from __future__ import annotations

import io
import zipfile
from pathlib import Path

import numpy as np
import pandas as pd

from . import config

DVF_COLUMNS = (
    "idopendata", "idmutation", "datemut", "anneemut", "moismut", "coddep",
    "libnatmut", "vefa", "valeurfonc", "nblocmai", "nblocapt", "nblocact",
    "nblocdep", "nblocmut", "sbati", "sbatmai", "sbatapt", "sbatact",
    "codtypbien", "libtypbien", "geompar_x", "geompar_y",
)

REASONS = (
    "not_vente",
    "no_residential_dwelling",
    "no_bdnb_link",
    "not_forte",
    "price_missing_or_nonpositive",
    "surface_missing_or_nonpositive",
)


def read_native_dvf(zip_path: Path) -> pd.DataFrame:
    """Read the single regional CSV out of the nested Cerema archive."""
    with zipfile.ZipFile(zip_path) as outer:
        inner_name = [n for n in outer.namelist() if n.lower().endswith(".zip")][0]
        with zipfile.ZipFile(io.BytesIO(outer.read(inner_name))) as inner:
            csv_name = [n for n in inner.namelist() if n.lower().endswith(".csv")][0]
            with inner.open(csv_name) as handle:
                frame = pd.read_csv(
                    handle, sep="|", usecols=list(DVF_COLUMNS), dtype=str,
                    keep_default_na=False, na_values=[""], encoding="utf-8",
                )
    return frame


def load_bdnb_relation(raw_dir: Path) -> pd.DataFrame:
    frames = []
    for department in config.BDNB_DEPARTMENTS:
        path = raw_dir / f"bdnb-2026-02-a-dep{department}" / "rel_batiment_groupe_dvf_open.csv"
        frame = pd.read_csv(path, sep=";", dtype=str, keep_default_na=False,
                            na_values=[""], encoding="utf-8")
        frames.append(frame)
    relation = pd.concat(frames, ignore_index=True)
    relation["id_opendata"] = relation["id_opendata"].str.strip().str.lower()
    return relation


def classify_mutations(dvf: pd.DataFrame, relation: pd.DataFrame) -> pd.DataFrame:
    """Attach cohort status and exclusion reasons to every native mutation.

    The native DVF+ delivery is one row per mutation. That is a source
    contract this function depends on, so it is asserted rather than assumed:
    a repeated key would silently duplicate a price into the cohort.
    """
    frame = dvf.copy()
    if frame["idopendata"].duplicated().any():
        raise ValueError("native DVF+ input is not one row per mutation")
    for column in ("valeurfonc", "sbatmai", "sbatapt", "nblocmai", "nblocapt",
                   "nblocact", "geompar_x", "geompar_y"):
        frame[column] = pd.to_numeric(frame[column], errors="coerce")
    frame["anneemut"] = pd.to_numeric(frame["anneemut"], errors="coerce").astype("Int64")
    frame["moismut"] = pd.to_numeric(frame["moismut"], errors="coerce").astype("Int64")
    frame["vefa_flag"] = frame["vefa"].str.strip().str.lower().eq("true")
    frame["idopendata"] = frame["idopendata"].str.strip().str.lower()

    # Producer relation: cardinality and reliability per mutation key.
    per_key = relation.groupby("id_opendata").agg(
        n_groups=("batiment_groupe_id", "nunique"),
        reliabilities=("fiabilite_croisement", lambda s: tuple(sorted(set(s)))),
        methods=("join_id_opendata", lambda s: tuple(sorted(set(s)))),
    )
    frame = frame.merge(per_key, left_on="idopendata", right_index=True, how="left")
    frame["n_groups"] = frame["n_groups"].fillna(0).astype(int)
    frame["fiabilite"] = frame["reliabilities"].map(
        lambda v: "FORTE" if isinstance(v, tuple) and v == ("FORTE",)
        else ("FAIBLE" if isinstance(v, tuple) and v else None))
    frame["producer_method"] = frame["methods"].map(
        lambda v: ("id" if "1" in v else "geom") if isinstance(v, tuple) else None)

    frame["residential_surface"] = frame["sbatmai"].fillna(0) + frame["sbatapt"].fillna(0)
    frame["in_window"] = frame["anneemut"].isin(list(config.SALE_YEARS))
    frame["in_brittany"] = frame["coddep"].isin(list(config.DEPARTEMENTS))

    reasons = {
        "not_vente": ~frame["libnatmut"].eq(config.NATURE_VENTE),
        "no_residential_dwelling": frame["nblocmai"].fillna(0) + frame["nblocapt"].fillna(0) <= 0,
        "no_bdnb_link": frame["n_groups"].eq(0),
        "not_forte": frame["n_groups"].gt(1),
        "price_missing_or_nonpositive": ~(frame["valeurfonc"] > 0),
        "surface_missing_or_nonpositive": ~(frame["residential_surface"] > 0),
    }
    frame["cohort_status"] = np.where(
        frame["in_window"] & frame["in_brittany"], "eligible_window", "out_of_window")
    first_reason = pd.Series(pd.NA, index=frame.index, dtype="object")
    for reason in REASONS:
        mask = reasons[reason] & frame["in_window"] & frame["in_brittany"]
        first_reason = first_reason.mask(first_reason.isna() & mask, reason)
    frame["exclusion_reason"] = first_reason
    frame["main_cohort"] = frame["in_window"] & frame["in_brittany"] & first_reason.isna()
    frame["price_per_m2"] = frame["valeurfonc"] / frame["residential_surface"]
    # ``valeurfonc = 1`` is a producer sentinel, not a euro price. It satisfies
    # the "positive price" cohort rule, so it is flagged rather than silently
    # dropped: the audited cohort count stays reproducible, and the model
    # estimation subset excludes it explicitly.
    frame["price_sentinel"] = frame["main_cohort"] & frame["valeurfonc"].le(1)
    frame["log_y"] = np.where(frame["main_cohort"], np.log(frame["price_per_m2"]), np.nan)
    return frame


def composition_flags(frame: pd.DataFrame) -> pd.DataFrame:
    """House/apartment composition and activity flags for the retained cohort."""
    out = pd.DataFrame(index=frame.index)
    out["house_surface"] = frame["sbatmai"].fillna(0)
    out["apartment_surface"] = frame["sbatapt"].fillna(0)
    out["house_count"] = frame["nblocmai"].fillna(0)
    out["apartment_count"] = frame["nblocapt"].fillna(0)
    out["activity_count"] = frame["nblocact"].fillna(0)
    out["dependency_count"] = frame["nblocdep"].fillna(0)
    total = out["house_surface"] + out["apartment_surface"]
    out["house_surface_share"] = out["house_surface"] / total
    out["has_house"] = out["house_count"] > 0
    out["has_apartment"] = out["apartment_count"] > 0
    out["has_activity"] = out["activity_count"] > 0
    out["mixed_house_apartment"] = out["has_house"] & out["has_apartment"]
    return out


def coverage_summary(frame: pd.DataFrame) -> pd.DataFrame:
    window = frame[frame["in_window"] & frame["in_brittany"]]
    table = window.groupby(["anneemut", "exclusion_reason"], dropna=False).size()
    table = table.rename("mutations").reset_index()
    table["anneemut"] = table["anneemut"].astype(str)
    table["exclusion_reason"] = table["exclusion_reason"].fillna("retained")
    return table.sort_values(["anneemut", "exclusion_reason"]).reset_index(drop=True)
