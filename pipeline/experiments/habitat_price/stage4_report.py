"""Stage 4: sanitised territorial table and a concise report.

Everything written here is safe to commit: no mutation identifiers, no
addresses, no coordinates, no model artefacts. Territory codes are public
geography; every other column is an aggregate.
"""
from __future__ import annotations

import json
import time

import numpy as np
import pandas as pd

from . import config


def _log(message: str) -> None:
    print(f"[stage4] {message}", flush=True)


def _read_json(path):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


def _commune_names() -> dict[str, str]:
    """Public commune labels (INSEE codes and official names are geography)."""
    import json

    path = config.RAW_DIR / config.SOURCES["communes_limites"]
    if not path.is_file():
        return {}
    with open(path, encoding="utf-8") as handle:
        data = json.load(handle)
    names = {}
    for feature in data.get("features", []):
        properties = feature.get("properties", {})
        code = properties.get("code_insee")
        name = properties.get("nom_officiel")
        if code and name:
            names[str(code).zfill(5)] = name
    return names


def _headline_examples(table: pd.DataFrame) -> pd.DataFrame:
    """A few contrasting, well-supported territories for the report."""
    communes = table[(table["level"] == "commune") & (table["n_mutations"] >= 500)].copy()
    high = communes.nlargest(3, "log_gap")
    low = communes.nsmallest(3, "log_gap")
    examples = pd.concat([high, low]).drop_duplicates("territory")
    names = _commune_names()
    examples = examples.assign(
        label=examples["territory"].map(lambda code: names.get(code, code)))
    return examples


def _markdown(report: dict) -> str:
    lines = []
    add = lines.append
    add("# Habitat price prototype — first territorial decomposition (issue #736)")
    add("")
    add("**Offline research prototype.** Not a production indicator, not a valuation")
    add("service, and not a causal decomposition. The incumbent published median")
    add("`prix_m2` is unchanged and is not the object of this analysis.")
    add("")
    add("## Cohort")
    add("")
    cohort = report["cohort"]
    add(f"- Native DVF+ rows read: {cohort['native_rows']:,}")
    add(f"- Main cohort (Vente, residential, FORTE link, positive price and surface): "
        f"**{cohort['main_cohort']:,}**")
    add(f"- By year: {cohort['by_year']}")
    add(f"- Model estimation subset: {report['model']['estimation_subset']:,} "
        f"(excluded producer sentinel price = 1: "
        f"{report['model']['excluded_sentinel_or_undefined']:,})")
    add(f"- BDNB group matched: {cohort['group_matched']:,}; "
        f"AEDAR origin matched: {cohort['origin_matched']:,}; "
        f"RP2021 1 km cell matched: {cohort['rp_cell_matched']:,}")
    add("")
    add("## Model validation (held out, not in-sample)")
    add("")
    model = report["model"]
    add("| Model | Scheme | n | RMSE (log) | MAE (log) | R² | median abs % error |")
    add("| --- | --- | ---: | ---: | ---: | ---: | ---: |")
    for name, key in (("Ridge benchmark", "ridge"), ("XGBoost", "xgboost")):
        hold = model["temporal_holdout"][key]
        add(f"| {name} | 2024 temporal holdout | {hold['n']:,} | {hold['rmse_log']:.4f} | "
            f"{hold['mae_log']:.4f} | {hold['r2']:.4f} | {hold['median_abs_pct_error']:.1f}% |")
    for name, key in (("Ridge benchmark", "ridge"), ("XGBoost", "xgboost")):
        spatial = model["spatial_cv_2022_2023"][key]
        if spatial:
            add(f"| {name} | 5-fold spatial CV (2022–2023) | {spatial['folds']} folds | "
                f"{spatial['mean_rmse_log']:.4f} | {spatial['mean_mae_log']:.4f} | "
                f"{spatial['mean_r2']:.4f} | {spatial['mean_median_abs_pct_error']:.1f}% |")
    add("")
    add("The final model's in-sample fit is reported separately and is **not** a")
    add("validation result; it is the model used for the explanatory decomposition.")
    add("")
    add("## Decomposition")
    add("")
    add(f"- Reference: pooled explained Breton sales, Brittany = 100 "
        f"(mu_B = {report['decomposition']['mu_B']:.4f} in natural logs).")
    add(f"- Explained mutations: {report['decomposition']['explained_rows']:,}.")
    add(f"- Max additivity error (attribution vs original model prediction): "
        f"{report['decomposition']['max_additivity_error']:.2e}")
    add("")
    add("Contributions are in log points. They are not percentages and do not add")
    add("as euro amounts. The remainder is the centred observed-minus-predicted")
    add("residual, so each territory's breakdown reconciles to its gap by")
    add("construction; the **quality** of that split is bounded by the model's")
    add("held-out accuracy above.")
    add("")
    add("**Read the `space` column with care.** The joint spatial component carries")
    add("most of the territorial gap, because coordinates are the strongest")
    add("predictor of local price in this model: dropping them costs about 0.18 of")
    add("held-out R² (0.47 → 0.30 on the 2024 holdout). That is a useful honest")
    add("finding — location dominates the measured characteristics — but it is not")
    add("a land premium, a coastal effect or a causal geography. It is the part of")
    add("the gap the model attributes to *where* the sale is, after the measured")
    add("property, access, local-setting and timing inputs have had their say. The")
    add("measured blocks are correspondingly small, and the AEDAR access block is")
    add("itself partly a proxy for settlement pattern.")
    add("")
    add("### Contrasting well-supported communes")
    add("")
    add("| Territory | n | median €/m² | index vs Brittany | property | access | "
        "local | timing | space | remainder |")
    add("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |")
    for _, row in report["examples"].iterrows():
        add(f"| {row['label']} ({row['territory']}) | {int(row['n_mutations']):,} | "
            f"{row['median_price_m2']:.0f} | {row['observed_index_vs_brittany']:.1f} | "
            f"{row['contrib_property']:+.3f} | {row['contrib_access']:+.3f} | "
            f"{row['contrib_local']:+.3f} | {row['contrib_timing']:+.3f} | "
            f"{row['contrib_space']:+.3f} | {row['contrib_remainder']:+.3f} |")
    add("")
    add("## What is staged, gated or unavailable")
    add("")
    for item in report["gaps"]:
        add(f"- {item}")
    add("")
    add("## Attribution convention")
    add("")
    add(report["attribution_note"])
    add("")
    add("## Reproduction")
    add("")
    add("```")
    add("python -m pipeline.experiments.habitat_price.run")
    add("```")
    add("")
    add(f"Wall time {report['timings'].get('total_wall_seconds', 'n/a')} s.")
    return "\n".join(lines) + "\n"


def run() -> dict:
    started = time.time()
    table = pd.read_csv(config.EVIDENCE_DIR / "territory-decomposition.csv")
    stage1 = _read_json(config.EVIDENCE_DIR / "stage1-summary.json")
    stage2 = _read_json(config.EVIDENCE_DIR / "stage2-metrics.json")
    stage3 = _read_json(config.EVIDENCE_DIR / "stage3-summary.json")

    # Public, sanitised: drop internal reconciliation helper columns from the
    # committed table but keep the error so reviewers can audit it.
    keep = ["level", "territory", "n_mutations", "n_explained", "median_price_m2",
            "observed_index_vs_brittany", "observed_index_explained_subset", "log_gap",
            "contrib_property", "contrib_access", "contrib_local", "contrib_timing",
            "contrib_space", "contrib_remainder", "reconciled_gap",
            "reconciliation_error", "share_house", "share_apartment", "share_activity",
            "share_2024", "support_flag"]
    table[keep].to_csv(config.EVIDENCE_DIR / "territory-decomposition.csv", index=False)

    examples = _headline_examples(table)

    gaps = [
        "OCS-GE 500 m neighbourhood composition: not implemented. The selected "
        "pre-2022 vintages (22/29 2021, 35 2020) are cached, but the D56 2019 "
        "baseline is absent (only the 2022 file exists, which is not a permitted "
        "substitute), and the selected-parcel anchors needed for a 500 m join "
        "are not reconstructible for every multi-parcel mutation. No placeholder "
        "values were invented.",
        "INSEE commune context (second-home share, vacancy, age-65+, one-person "
        "households, median standard of living) and migration inflow/outflow "
        "rates: not implemented in this pass. The RP2023 and Filosofi sources "
        "need their reference-year and 2021/2023 break handling verified before "
        "inclusion; they are absent from the model rather than zero-filled.",
        "Sitadel stock-normalised authorised/started rates: loader written, not "
        "wired into the model because the dwelling-stock denominator needs the "
        "same reference-year verification as the other commune context.",
        "Tourism capacity, coastal distance, heat, roof material, DPE and wall "
        "material are excluded by owner decision and are not in this model.",
        "Spatial attribution is a grouped-Shapley convention validated against an "
        "independent exact-coalition oracle and prediction parity, not a "
        "replication of upstream GeoShapley's raw GEO terms. The upstream tree "
        "explainer's NaN routing defect and the raw-GEO interaction artefact are "
        "documented in the experiment tests and avoided.",
    ]

    attribution_note = (
        "Grouped Shapley values over five reporting blocks (property, AEDAR "
        "access, local setting, sale timing, joint spatial component) with a "
        "background-masking value function, estimated by antithetic permutation "
        "sampling over a 64-row background and validated by (a) an independent "
        "exact-coalition oracle over all subsets on small games, (b) an "
        "additivity check against the original fitted XGBoost prediction "
        "including missing values, and (c) a coordinate-free-model test that "
        "must return exactly zero spatial contribution. The last two target the "
        "documented upstream defects. The permutation estimator's sampling error "
        "is the dominant uncertainty in the contributions, not the model itself."
    )

    # Full-pipeline wall time: stage 4 is fast, but stages 1-3 are not; sum
    # the recorded per-stage wall times so the report does not understate the
    # reproduction cost by three orders of magnitude.
    pipeline_seconds = round(sum(
        float(stage.get("wall_seconds", 0.0)) for stage in (stage1, stage2, stage3)
    ) + (time.time() - started), 1)
    report = {
        "cohort": stage1,
        "model": stage2,
        "decomposition": stage3,
        "examples": examples,
        "gaps": gaps,
        "attribution_note": attribution_note,
        "timings": {"total_wall_seconds": pipeline_seconds,
                    "report_stage_seconds": round(time.time() - started, 1)},
    }
    (config.EVIDENCE_DIR / "report.json").write_text(
        json.dumps({k: v for k, v in report.items() if k != "examples"},
                   indent=2, default=float), encoding="utf-8")
    examples.to_csv(config.EVIDENCE_DIR / "report-examples.csv", index=False)
    (config.EVIDENCE_DIR / "REPORT.md").write_text(_markdown(report), encoding="utf-8")
    _log("report written")
    return {"report": str(config.EVIDENCE_DIR / "REPORT.md"),
            "wall_seconds": round(time.time() - started, 1)}
