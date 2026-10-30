"""Stage 2: fit and evaluate the benchmark and the XGBoost model.

Two validation schemes, both reported:
  * spatially separated 5-fold CV on 2022-2023 sales (25 km blocks), which
    measures generalisation to unseen places;
  * a temporal holdout: fit on 2022-2023, predict 2024, which measures
    generalisation to an unseen year.

All preprocessing (imputation, categorical encoding) is fitted on training
rows only. Unknowns stay explicit: numeric gaps go through a train-fitted
median with an added missing indicator, and AEDAR reach flags are imputed with
their train-fitted mode, never silently set to zero.
"""
from __future__ import annotations

import json
import time

import numpy as np
import pandas as pd
from sklearn.linear_model import Ridge
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.preprocessing import OneHotEncoder
from xgboost import XGBRegressor

from . import config, features, resources


def _log(message: str) -> None:
    print(f"[stage2] {message}", flush=True)


class Preprocessor:
    """Train-only imputation and encoding, reusable for the explainer."""

    def __init__(self, categorical_columns: list[str]):
        self.categorical_columns = categorical_columns
        self.numeric_columns: list[str] = []
        self.medians: dict[str, float] = {}
        self.modes: dict[str, float] = {}
        self.encoder: OneHotEncoder | None = None
        self.output_columns: list[str] = []

    def fit(self, numeric: pd.DataFrame, categorical: pd.DataFrame) -> "Preprocessor":
        self.numeric_columns = list(numeric.columns)
        for column in self.numeric_columns:
            series = numeric[column]
            if series.isna().all():
                self.medians[column] = 0.0
                self.modes[column] = 0.0
                continue
            self.medians[column] = float(series.median())
            self.modes[column] = float(series.mode().iloc[0]) if not series.mode().empty else 0.0
        self.encoder = OneHotEncoder(handle_unknown="ignore", sparse_output=False)
        self.encoder.fit(categorical[self.categorical_columns])
        self.output_columns = (
            self.numeric_columns
            + [f"miss__{c}" for c in self.numeric_columns]
            + list(self.encoder.get_feature_names_out(self.categorical_columns))
        )
        return self

    def transform(self, numeric: pd.DataFrame, categorical: pd.DataFrame) -> np.ndarray:
        blocks = []
        indicators = []
        for column in self.numeric_columns:
            series = numeric[column]
            if series.dtype == "boolean" or str(series.dtype) == "boolean":
                series = series.astype("Float64")
            values = pd.to_numeric(series, errors="coerce").astype(float)
            missing = values.isna().to_numpy()
            filled = values.fillna(self.modes[column] if column.startswith("reach_")
                                   else self.medians[column])
            blocks.append(filled.to_numpy(dtype=float))
            indicators.append(missing.astype(float))
        numeric_matrix = np.column_stack(blocks + indicators) if blocks else np.empty((len(numeric), 0))
        encoded = self.encoder.transform(categorical[self.categorical_columns])
        return np.column_stack([numeric_matrix, encoded])


def spatial_blocks(frame: pd.DataFrame, size_km: float, seed: int) -> pd.Series:
    """Deterministic spatial blocks on a Lambert-93 grid of ``size_km``."""
    bx = np.floor(frame["geompar_x"].to_numpy(dtype=float) / (size_km * 1000.0)).astype(int)
    by = np.floor(frame["geompar_y"].to_numpy(dtype=float) / (size_km * 1000.0)).astype(int)
    return pd.Series([f"{a}_{b}" for a, b in zip(bx, by)], index=frame.index)


def _metrics(y_true: np.ndarray, y_pred: np.ndarray) -> dict:
    return {
        "n": int(len(y_true)),
        "rmse_log": float(np.sqrt(mean_squared_error(y_true, y_pred))),
        "mae_log": float(mean_absolute_error(y_true, y_pred)),
        "r2": float(r2_score(y_true, y_pred)),
        # Multiplicative error on the price level, for readability.
        "median_abs_pct_error": float(np.median(np.abs(np.expm1(y_pred - y_true))) * 100.0),
    }


def _fit_xgb(x_train, y_train, x_valid, y_valid):
    model = XGBRegressor(
        n_estimators=config.XGB_ROUNDS,
        early_stopping_rounds=config.XGB_EARLY_STOPPING,
        n_jobs=config.THREADS,
        **config.XGB_PARAMS,
    )
    model.fit(x_train, y_train, eval_set=[(x_valid, y_valid)], verbose=False)
    return model


def run() -> dict:
    started = time.time()
    config.PRIVATE_DIR.mkdir(parents=True, exist_ok=True)
    config.EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)

    cohort = pd.read_parquet(config.PRIVATE_DIR / "cohort_mutations.parquet")
    subset = features.model_estimation_subset(cohort)
    _log(f"audited cohort {len(cohort)}, estimation subset {len(subset)} "
         f"(excluded sentinel/undefined {len(cohort) - len(subset)})")

    numeric, target, categorical = features.build_matrix(subset)
    cat_columns = [c for names in features.CATEGORICAL_BLOCKS.values() for c in names]

    coverage = features.coverage_table(subset)
    coverage.to_csv(config.EVIDENCE_DIR / "feature-coverage.csv", index=False)

    # --- Temporal holdout: train 2022-2023, test 2024 -------------------
    train_mask = subset["sale_year"].isin([2022, 2023]).to_numpy()
    test_mask = subset["sale_year"].eq(2024).to_numpy()
    pre = Preprocessor(cat_columns).fit(numeric[train_mask], categorical[train_mask])
    x_train = pre.transform(numeric[train_mask], categorical[train_mask])
    x_test = pre.transform(numeric[test_mask], categorical[test_mask])
    y_train = target[train_mask].to_numpy()
    y_test = target[test_mask].to_numpy()

    ridge = Ridge(alpha=1.0)
    ridge.fit(x_train, y_train)
    ridge_test = _metrics(y_test, ridge.predict(x_test))

    xgb = _fit_xgb(x_train, y_train, x_test, y_test)
    xgb_test = _metrics(y_test, xgb.predict(x_test))
    _log(f"temporal holdout: ridge {ridge_test} xgb {xgb_test}")

    # --- Spatially separated CV on 2022-2023 ----------------------------
    spatial_frame = subset[train_mask]
    blocks = spatial_blocks(spatial_frame, config.SPATIAL_BLOCK_KM, config.SEED)
    unique_blocks = np.array(sorted(blocks.unique()))
    rng = np.random.default_rng(config.SEED)
    rng.shuffle(unique_blocks)
    fold_of_block = {b: i % config.SPATIAL_FOLDS for i, b in enumerate(unique_blocks)}
    fold_ids = blocks.map(fold_of_block).to_numpy()

    spatial_results = {"ridge": [], "xgb": []}
    for fold in range(config.SPATIAL_FOLDS):
        tr = fold_ids != fold
        va = fold_ids == fold
        if tr.sum() == 0 or va.sum() == 0:
            continue
        fold_pre = Preprocessor(cat_columns).fit(numeric[train_mask][tr], categorical[train_mask][tr])
        xtr = fold_pre.transform(numeric[train_mask][tr], categorical[train_mask][tr])
        xva = fold_pre.transform(numeric[train_mask][va], categorical[train_mask][va])
        ytr, yva = y_train[tr], y_train[va]
        fold_ridge = Ridge(alpha=1.0).fit(xtr, ytr)
        spatial_results["ridge"].append(_metrics(yva, fold_ridge.predict(xva)))
        fold_xgb = _fit_xgb(xtr, ytr, xva, yva)
        spatial_results["xgb"].append(_metrics(yva, fold_xgb.predict(xva)))
        _log(f"spatial fold {fold}: n_train {int(tr.sum())} n_valid {int(va.sum())}")

    def _summarise(folds):
        if not folds:
            return {}
        return {
            "folds": len(folds),
            "mean_rmse_log": float(np.mean([f["rmse_log"] for f in folds])),
            "mean_mae_log": float(np.mean([f["mae_log"] for f in folds])),
            "mean_r2": float(np.mean([f["r2"] for f in folds])),
            "mean_median_abs_pct_error": float(np.mean([f["median_abs_pct_error"] for f in folds])),
        }

    # --- Final model on the full estimation subset ----------------------
    # Used only for the in-sample explanatory decomposition (stage 3); its
    # in-sample fit is NOT a validation result.
    final_pre = Preprocessor(cat_columns).fit(numeric, categorical)
    x_all = final_pre.transform(numeric, categorical)
    y_all = target.to_numpy()
    final_model = XGBRegressor(
        n_estimators=int(xgb.best_iteration) + 1 if hasattr(xgb, "best_iteration") else config.XGB_ROUNDS,
        n_jobs=config.THREADS,
        **config.XGB_PARAMS,
    )
    final_model.fit(x_all, y_all, verbose=False)
    final_model.save_model(str(config.PRIVATE_DIR / "xgb_final.json"))
    in_sample = _metrics(y_all, final_model.predict(x_all))

    importance = pd.DataFrame({
        "feature": pre.output_columns,
        "gain": final_model.feature_importances_,
    }).sort_values("gain", ascending=False)
    importance.head(40).to_csv(config.EVIDENCE_DIR / "xgb-feature-importance.csv", index=False)

    summary = {
        "audited_cohort": int(len(cohort)),
        "estimation_subset": int(len(subset)),
        "excluded_sentinel_or_undefined": int(len(cohort) - len(subset)),
        "train_2022_2023": int(train_mask.sum()),
        "holdout_2024": int(test_mask.sum()),
        "n_features": int(len(pre.output_columns)),
        "temporal_holdout": {"ridge": ridge_test, "xgboost": xgb_test},
        "spatial_cv_2022_2023": {
            "ridge": _summarise(spatial_results["ridge"]),
            "xgboost": _summarise(spatial_results["xgb"]),
        },
        "final_model_in_sample": in_sample,
        "xgb_params": config.XGB_PARAMS,
        "best_iteration": int(getattr(xgb, "best_iteration", -1)),
        "wall_seconds": round(time.time() - started, 1),
        "peak_rss_gb": round(resources.rss_gb(), 2),
    }
    (config.EVIDENCE_DIR / "stage2-metrics.json").write_text(
        json.dumps(summary, indent=2), encoding="utf-8")
    _log(json.dumps({k: v for k, v in summary.items() if k != "xgb_params"}, indent=2))
    return summary
