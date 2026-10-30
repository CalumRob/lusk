# Habitat price prototype (issue #736)

An **offline research prototype** that fits a residential price model on native
DVF+ mutations and decomposes each Breton territory's observed price level into
grouped contributions.

It is not a production indicator, not a valuation service and not a causal
analysis. The incumbent published median `prix_m2` is untouched.

## Run

From the repository root, with an isolated environment:

```bash
python -m venv .venv
.venv/Scripts/python -m pip install -r pipeline/experiments/habitat_price/requirements.txt
.venv/Scripts/python -m pipeline.experiments.habitat_price.run
```

Stages can be run alone with `--stage cohort|model|decompose|report`.

Inputs are read from `pipeline/data/raw` and hashed into
`evidence/source-manifest.json`. Private per-mutation tables and the fitted
model stay under `pipeline/data/processed/habitat-price/` (gitignored); only
aggregates and the report are committed.

## What it produces

| File | Content |
| --- | --- |
| `evidence/REPORT.md` | the readable report |
| `evidence/territory-decomposition.csv` | per-territory support, median, index, grouped contributions, remainder |
| `evidence/stage2-metrics.json` | held-out validation metrics |
| `evidence/stage3-summary.json` | decomposition audit and reconciliation |
| `evidence/cohort-coverage.csv` | exclusions by year and reason |
| `evidence/feature-coverage.csv` | per-feature availability |

## Method in one paragraph

One row per native DVF+ mutation, `y = ln(price / (sbatmai + sbatapt))`.
Features are grouped into five reporting blocks: property and BDNB group
context, AEDAR accessibility, local setting, sale timing, and a joint spatial
component. A ridge benchmark and a seeded XGBoost model are evaluated by
spatially separated 5-fold CV and by a 2024 temporal holdout, with all
preprocessing fitted on training rows only. The territorial product reports the
observed geometric price index against pooled Brittany = 100, decomposed by
grouped Shapley values over the reporting blocks plus a centred unexplained
remainder, so each territory's breakdown reconciles exactly.

## Tests

```bash
cd pipeline/experiments/habitat_price
../../.venv/Scripts/python -m pytest
```

The attribution tests include an independent exact-coalition oracle, an
additivity check against the original fitted model with missing values, and a
coordinate-free-model test that must return zero spatial contribution. These
target two documented defects in upstream GeoShapley at commit
`0de43d22eec1642dd36a5cd72509164c15f90122`: raw GEO/feature×GEO projection
terms that are nonzero even for coordinate-free models, and a NaN-routing
early return in the tree explainer's `_Split.matches`.

## Scope limits

See the "staged, gated or unavailable" section of `evidence/REPORT.md`. In
short: OCS-GE 500 m composition, INSEE commune context, migration rates and
Sitadel rates are not in this pass, and the reasons are recorded rather than
filled with placeholders.
