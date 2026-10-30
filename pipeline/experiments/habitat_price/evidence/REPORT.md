# Habitat price prototype — first territorial decomposition (issue #736)

**Offline research prototype.** Not a production indicator, not a valuation
service, and not a causal decomposition. The incumbent published median
`prix_m2` is unchanged and is not the object of this analysis.

## Cohort

- Native DVF+ rows read: 1,019,658
- Main cohort (Vente, residential, FORTE link, positive price and surface): **145,185**
- By year: {'2022': 58431, '2023': 46888, '2024': 39866}
- Model estimation subset: 145,099 (excluded producer sentinel price = 1: 86)
- BDNB group matched: 145,185; AEDAR origin matched: 145,185; RP2021 1 km cell matched: 145,092

## Model validation (held out, not in-sample)

| Model | Scheme | n | RMSE (log) | MAE (log) | R² | median abs % error |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Ridge benchmark | 2024 temporal holdout | 39,835 | 0.5788 | 0.3971 | 0.1877 | 28.2% |
| XGBoost | 2024 temporal holdout | 39,835 | 0.4665 | 0.2866 | 0.4724 | 18.3% |
| Ridge benchmark | 5-fold spatial CV (2022–2023) | 5 folds | 0.5952 | 0.4127 | 0.1422 | 29.7% |
| XGBoost | 5-fold spatial CV (2022–2023) | 5 folds | 0.5147 | 0.3398 | 0.3555 | 23.1% |

The final model's in-sample fit is reported separately and is **not** a
validation result; it is the model used for the explanatory decomposition.

## Decomposition

- Reference: pooled explained Breton sales, Brittany = 100 (mu_B = 7.5424 in natural logs).
- Explained mutations: 76,965.
- Max additivity error (attribution vs original model prediction): 9.54e-07

Contributions are in log points. They are not percentages and do not add
as euro amounts. The remainder is the centred observed-minus-predicted
residual, so each territory's breakdown reconciles to its gap by
construction; the **quality** of that split is bounded by the model's
held-out accuracy above.

**Read the `space` column with care.** The joint spatial component carries
most of the territorial gap, because coordinates are the strongest
predictor of local price in this model: dropping them costs about 0.18 of
held-out R² (0.47 → 0.30 on the 2024 holdout). That is a useful honest
finding — location dominates the measured characteristics — but it is not
a land premium, a coastal effect or a causal geography. It is the part of
the gap the model attributes to *where* the sale is, after the measured
property, access, local-setting and timing inputs have had their say. The
measured blocks are correspondingly small, and the AEDAR access block is
itself partly a proxy for settlement pattern.

### Contrasting well-supported communes

| Territory | n | median €/m² | index vs Brittany | property | access | local | timing | space | remainder |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Dinard (35093) | 877 | 5469 | 284.3 | -0.018 | +0.188 | +0.027 | -0.000 | +0.826 | +0.036 |
| Carnac (56034) | 528 | 5780 | 297.4 | +0.000 | +0.105 | +0.042 | -0.001 | +0.899 | +0.014 |
| Quiberon (56186) | 541 | 5302 | 268.1 | +0.042 | +0.098 | +0.021 | -0.000 | +0.818 | +0.039 |
| Morlaix (29151) | 912 | 1556 | 77.1 | -0.090 | +0.082 | +0.007 | -0.001 | -0.271 | +0.108 |
| Pontivy (56178) | 658 | 1696 | 85.2 | +0.000 | +0.099 | +0.021 | +0.000 | -0.287 | +0.022 |
| Saint-Brieuc (22278) | 2,860 | 1794 | 90.9 | -0.061 | +0.102 | +0.020 | -0.003 | -0.135 | -0.053 |

## What is staged, gated or unavailable

- OCS-GE 500 m neighbourhood composition: not implemented. The selected pre-2022 vintages (22/29 2021, 35 2020) are cached, but the D56 2019 baseline is absent (only the 2022 file exists, which is not a permitted substitute), and the selected-parcel anchors needed for a 500 m join are not reconstructible for every multi-parcel mutation. No placeholder values were invented.
- INSEE commune context (second-home share, vacancy, age-65+, one-person households, median standard of living) and migration inflow/outflow rates: not implemented in this pass. The RP2023 and Filosofi sources need their reference-year and 2021/2023 break handling verified before inclusion; they are absent from the model rather than zero-filled.
- Sitadel stock-normalised authorised/started rates: loader written, not wired into the model because the dwelling-stock denominator needs the same reference-year verification as the other commune context.
- Tourism capacity, coastal distance, heat, roof material, DPE and wall material are excluded by owner decision and are not in this model.
- Spatial attribution is a grouped-Shapley convention validated against an independent exact-coalition oracle and prediction parity, not a replication of upstream GeoShapley's raw GEO terms. The upstream tree explainer's NaN routing defect and the raw-GEO interaction artefact are documented in the experiment tests and avoided.

## Attribution convention

Grouped Shapley values over five reporting blocks (property, AEDAR access, local setting, sale timing, joint spatial component) with a background-masking value function, estimated by antithetic permutation sampling over a 64-row background and validated by (a) an independent exact-coalition oracle over all subsets on small games, (b) an additivity check against the original fitted XGBoost prediction including missing values, and (c) a coordinate-free-model test that must return exactly zero spatial contribution. The last two target the documented upstream defects. The permutation estimator's sampling error is the dominant uncertainty in the contributions, not the model itself.

## Reproduction

```
python -m pipeline.experiments.habitat_price.run
```

Wall time 2864.6 s.
