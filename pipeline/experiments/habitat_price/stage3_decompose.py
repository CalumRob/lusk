"""Stage 3: territorial price decomposition (issue #736).

The product is the observed geometric price level per territory relative to
the pooled same-cohort Brittany reference, decomposed on the log scale:

    mu_T - mu_B = sum_groups [ mean_T(phi_g) - mean_B(phi_g) ] + remainder

with ``phi_g`` the grouped attribution of block ``g`` and the remainder the
centred observed-minus-predicted residual, so the breakdown reconciles exactly.

The median EUR/m2 is reported alongside as a familiar descriptive statistic and
is never the object of the decomposition.

Attribution convention (declared once, tested in tests/test_attribution.py):
grouped Shapley values over reporting blocks, background-masking value
function, estimated by antithetic permutation sampling and validated against an
independent exact-coalition oracle plus prediction parity with the original
fitted XGBoost model.
"""
from __future__ import annotations

import json
import time
import zipfile
from pathlib import Path

import numpy as np
import pandas as pd
from xgboost import XGBRegressor

from . import attribution, config, features, resources, territories

BLOCKS = ("property", "access", "local", "timing", "space")
PERMUTATIONS = 24
BACKGROUND_SIZE = 64
EXPLAIN_PER_TERRITORY = 120
EXPLAIN_CHUNK = 4096


def _log(message: str) -> None:
    print(f"[stage3] {message}", flush=True)


def load_epci_membership(raw_dir: Path) -> pd.DataFrame:
    """Commune -> EPCI membership from the INSEE COG composition workbook."""
    archive = raw_dir / config.SOURCES["epci_membership"]
    with zipfile.ZipFile(archive) as zf:
        member = [n for n in zf.namelist() if n.lower().endswith((".xlsx", ".xls"))][0]
        target = config.EXTRACT_DIR / "epci_composition.xlsx"
        target.parent.mkdir(parents=True, exist_ok=True)
        if not target.exists():
            target.write_bytes(zf.read(member))
    raw = pd.read_excel(target, sheet_name="Composition_communale", header=None,
                        dtype=str, engine="calamine")
    header_row = raw.index[raw[0].astype(str).str.strip().eq("CODGEO")][0]
    table = raw.iloc[header_row + 1:].copy()
    table = table.rename(columns={0: "code_commune", 2: "code_epci", 3: "libelle_epci"})
    table = table[["code_commune", "code_epci", "libelle_epci"]].dropna(subset=["code_commune"])
    table["code_commune"] = table["code_commune"].astype(str).str.zfill(5)
    return table.drop_duplicates("code_commune")


def _load_model(pre_columns: list[str]) -> XGBRegressor:
    model = XGBRegressor()
    model.load_model(str(config.PRIVATE_DIR / "xgb_final.json"))
    return model


def run() -> dict:
    started = time.time()
    cohort = pd.read_parquet(config.PRIVATE_DIR / "cohort_mutations.parquet")
    subset = features.model_estimation_subset(cohort)
    numeric, target, categorical = features.build_matrix(subset)

    # Rebuild the exact train-only preprocessing used for the final model.
    from .stage2_model import Preprocessor
    cat_columns = [c for names in features.CATEGORICAL_BLOCKS.values() for c in names]
    pre = Preprocessor(cat_columns).fit(numeric, categorical)
    matrix = pre.transform(numeric, categorical)
    model = _load_model(pre.output_columns)
    predictions = model.predict(matrix)

    block_of_column = {}
    for block, names in features.FEATURE_BLOCKS.items():
        for name in names:
            block_of_column[name] = block
            block_of_column[f"miss__{name}"] = block
    for block, names in features.CATEGORICAL_BLOCKS.items():
        for name in names:
            for column in pre.output_columns:
                if column.startswith(f"{name}_"):
                    block_of_column[column] = block
    missing = [c for c in pre.output_columns if c not in block_of_column]
    if missing:
        raise KeyError(f"columns without a reporting block: {missing[:5]}")
    masks = attribution.block_masks_from_columns(pre.output_columns, block_of_column)

    rng = np.random.default_rng(config.SEED)
    background_idx = rng.choice(len(matrix), size=min(BACKGROUND_SIZE, len(matrix)),
                                replace=False)
    background = matrix[background_idx]

    subset = subset.reset_index(drop=True)
    subset["prediction"] = predictions
    subset["residual"] = subset["log_y"].to_numpy() - predictions

    # ---- explain a bounded, deterministic sample per territory ----------
    epci = load_epci_membership(config.RAW_DIR)
    subset = subset.merge(epci, left_on="group_commune", right_on="code_commune",
                          how="left")
    subset["territory_commune"] = subset["group_commune"]
    subset["territory_epci"] = subset["code_epci"]
    subset["territory_departement"] = subset["departement"]

    explain_rows = []
    for _, group in subset.groupby("territory_commune"):
        take = group.sample(n=min(EXPLAIN_PER_TERRITORY, len(group)),
                            random_state=config.SEED)
        explain_rows.append(take.index.to_numpy())
    explain_index = np.concatenate(explain_rows) if explain_rows else np.array([], dtype=int)
    _log(f"explaining {len(explain_index)} mutations across "
         f"{subset['territory_commune'].nunique()} communes")

    # The explainer is the slow step (~45 min). Cache its output keyed by the
    # explained row set so a re-run after an interruption does not recompute it.
    import hashlib

    cache_path = config.PRIVATE_DIR / "attribution_cache.npz"
    digest = hashlib.sha256(
        np.ascontiguousarray(explain_index).tobytes()
        + np.ascontiguousarray(background).tobytes()
        + str(PERMUTATIONS).encode() + str(config.SEED).encode()
    ).hexdigest()
    base = float(model.predict(background).mean())
    values = None
    if cache_path.exists():
        cached = np.load(cache_path, allow_pickle=False)
        if str(cached["digest"]) == digest:
            values = cached["values"]
            _log("reused cached attribution matrix")
    if values is None:
        values = attribution.grouped_shapley_batch(
            model.predict, matrix[explain_index], background, masks, list(BLOCKS),
            permutations=PERMUTATIONS, seed=config.SEED, chunk=EXPLAIN_CHUNK)
        np.savez(cache_path, values=values, digest=np.array(digest))
    reconstructed = base + values.sum(axis=1)
    parity_error = float(np.max(np.abs(reconstructed - predictions[explain_index])))
    _log(f"max additivity error over explained rows: {parity_error:.3e}")

    explained = subset.loc[explain_index].copy()
    for position, block in enumerate(BLOCKS):
        explained[f"phi_{block}"] = values[:, position]
    explained["phi_base"] = base

    # ---- territory statistics -----------------------------------------
    # The reference is the pooled explained subset, so the baseline and every
    # territory are described by the same rows and the same model convention.
    mu_B = float(explained["log_y"].mean())
    phi_B = {block: float(explained[f"phi_{block}"].mean()) for block in BLOCKS}
    residual_B = float(explained["residual"].mean())

    rows = []
    for level, key in (("commune", "territory_commune"),
                       ("epci", "territory_epci"),
                       ("departement", "territory_departement")):
        for territory, group in subset.groupby(key):
            if not isinstance(territory, str) or not territory:
                continue
            mu_T = float(group["log_y"].mean())
            gap = mu_T - mu_B
            matching = explained[explained[key] == territory]
            # The decomposition is only defined on the explained subset: the
            # predicted level must be the same rows the attributions describe,
            # otherwise the remainder absorbs a sampling difference rather than
            # an unexplained one.
            if len(matching) == 0:
                continue
            mu_T_explained = float(matching["log_y"].mean())
            gap = mu_T_explained - mu_B
            contributions = {
                block: float(matching[f"phi_{block}"].mean()) - phi_B[block]
                for block in BLOCKS
            }
            residual_T = float(matching["residual"].mean())
            remainder = residual_T - residual_B
            explained_sum = sum(contributions.values())
            rows.append({
                "level": level,
                "territory": territory,
                "n_mutations": int(len(group)),
                "n_explained": int(len(matching)),
                "median_price_m2": float(group["price_per_m2"].median()),
                "observed_index_vs_brittany": float(100.0 * np.exp(mu_T - mu_B)),
                "observed_index_explained_subset": float(100.0 * np.exp(gap)),
                "log_gap": gap,
                **{f"contrib_{block}": v for block, v in contributions.items()},
                "contrib_remainder": remainder,
                "reconciled_gap": explained_sum + remainder,
                "reconciliation_error": abs(explained_sum + remainder - gap),
                "share_house": float(group["has_house"].mean()),
                "share_apartment": float(group["has_apartment"].mean()),
                "share_activity": float(group["has_activity"].mean()),
                "share_2024": float((group["sale_year"] == 2024).mean()),
            })
    table = pd.DataFrame(rows)
    table["support_flag"] = np.where(table["n_mutations"] >= 200, "supported",
                                     np.where(table["n_mutations"] >= 50, "weak", "insufficient"))
    table = table.sort_values(["level", "n_mutations"], ascending=[True, False])
    table.to_csv(config.EVIDENCE_DIR / "territory-decomposition.csv", index=False)

    # ---- reconciliation audit -----------------------------------------
    audit = {}
    for level in ("commune", "epci", "departement"):
        part = table[table["level"] == level]
        audit[level] = {
            "territories": int(len(part)),
            "max_abs_reconciliation_error": float(part["reconciliation_error"].max()),
            "weighted_index_check": float(
                np.exp((part["log_gap"] * part["n_explained"]).sum()
                       / part["n_explained"].sum()) * 100.0),
        }

    summary = {
        "explained_rows": int(len(explained)),
        "mutations_with_prediction": int(len(subset)),
        "mu_B": mu_B,
        "brittany_index": 100.0,
        "max_additivity_error": parity_error,
        "baseline_mean_phi": phi_B,
        "baseline_residual": residual_B,
        "audit": audit,
        "wall_seconds": round(time.time() - started, 1),
        "peak_rss_gb": round(resources.rss_gb(), 2),
    }
    (config.EVIDENCE_DIR / "stage3-summary.json").write_text(
        json.dumps(summary, indent=2, default=float), encoding="utf-8")
    _log(json.dumps(audit, indent=2))
    return summary
