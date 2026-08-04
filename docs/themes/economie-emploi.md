# Theme contract — Économie/Emploi

> The economist's theme: standard activity figures plus the analytical signature (Location quotient). Four standard indicators, two Stories. The only theme where the standard block and the analytical depth are both first-class.

**Status:** ✅ source-table phase **built 2026-08-04** (three manifests + three normalizers + profiler + mocked end-to-end run test) · ✅ indicator/story design retained · 🔶 SDES NAF list to pin · ⏸️ analytical derivations deferred to the post-profiling analytical phase

## Scope (v1)

- **In:** the four standard indicators + the two-Story pool. The point of the theme is the **analytical depth**: LQ is the signature (`CONTEXT.md` → Location quotient).
- **Out:** ~~Établissements par activité (A10)~~ — **dropped 2026-08-03**: A10 *is* LQ's input; as a standard figure it duplicates the LQ story and adds only absolute size (already carried by emploi/créations).
- **Deferred (reservoir, `docs/scope.md`):** relatedness / jumeaux économiques (method locked in `docs/research/relatedness.md`; heaviest computation in the product; natural 2nd story when it lands). "L'agriculture qui nourrit la baie" (algues/UGB — new source, decennial vintage, needs nitrogen-load design).

## Initial source-table phase (built 2026-08-04)

The first Économie/Emploi pipeline phase is deliberately **source ingestion and profiling**, not indicator computation. It exists to make the observed data's coverage, sparsity, suppression, and statistical meaning visible before choosing matrix representations or analytical thresholds. **It is built** : one manifest fragment per source family (each pinning its own vintage, reference and publication dates), three normalizers persisting the four tables under `pipeline/data/processed/economie/`, the profiler `pipeline/R/profil_economie.R` (one `<id>-profil.json` per table under `data/processed/economie/profil/`), and the mocked end-to-end source-run test (`test-run-economie-contracts.R`) that proves all four tables and the profiling evidence are produced, that **no fiche artifact is written** (publish is never called), and that re-running **never duplicates rows**.

All source tables are **commune-first**, long, and sparse. Higher territorial levels are derived later; they are never mixed into the base source tables. Each source keeps its own vintage and purpose — there is **no forced common date, no cross-source join beyond the commune reference, and no NAF ↔ A38/A88 crosswalk** in this phase.

### Source tables

| Table | Grain and measure | Purpose | Explicit non-purpose |
|---|---|---|---|
| `sirene_snapshot` | Commune × NAF 5-digit → active establishment count | Fine-grain establishment structure; future LQ/relatedness input | Not employee mass; no employee estimate from size bands |
| `flores_a38` | Commune × A38, with employment, establishments, and native size dimensions | Workplace employment and sector structure at a robust aggregate grain | Not SIRENE; no NAF crosswalk in this phase |
| `flores_a88` | Commune × A88, with employment, establishments, and native size dimensions | Finer workplace employment/sector structure for noise inspection | Not SIRENE; no primary-grain decision in this phase |
| `rp_emploi` | Commune × native RP sector → resident employment | Independent labour-market perspective and validation source | Not Flores workplace employment; no merged economic indicator |

**Per-source vintages (locked in the manifests, 2026-08-04):** the SIRENE snapshot pins the monthly stock — image of the directory at 2026-07-31, published 2026-08-01 (ZIP ~2,7 Go, mode « manuel », ADR-0004) ; Flores A38/A88 pin the 2024 product — fin 2024, published 2026-03-31 (~21 Mo / 8 Mo, mode « cron ») ; RP Emploi pins the 2023 ACT4/ACT5 dossier complet — published 2026-06-30 (~79 MB, mode « cron »). No date is aligned across sources : each table carries **its own** vintage stamp, by contract.

### Shared table envelope

Every normalized table carries, where available:

```text
commune | activity_code | activity_label | value | measure | source | vintage
```

Source-specific columns remain alongside it. SIRENE retains active status, diffusion status, size band, and NAF version; Flores retains native classification, employment/establishment measures, size bands, and suppression/missingness markers; RP retains its resident-employment concept and native sector classification.

### SIRENE snapshot rules

- Use the latest available **monthly stock** as the current snapshot and record its exact reference/extraction date.
- Keep active establishments only.
- Retain partially non-diffusible establishments when their commune and activity code are usable.
- Exclude and report records without a usable Brittany commune or activity code.
- Do not ingest `stocketablissementshistorique` in this phase. Historical SIRENE is a separate future source family for churn and temporal views.

### Deliberate deferrals → the post-profiling analytical phase

This phase does **not** create dense or binary matrices, choose a presence threshold, add an NAF ↔ A38/A88 crosswalk, align source dates, compute LQ/RCA, relatedness, green activity scores, nitrogen/emissions measures, ranks, or Stories, and does not publish fiche facts. **The later LQ/relatedness intent is NOT erased** : it is explicitly the **post-profiling analytical phase**, which starts once the real-data profiling evidence has been reviewed — LQ and the relatedness M matrix remain the theme's signature (see the standard indicators and the Story pool below, and `docs/research/relatedness.md`). Historical SIRENE (`stocketablissementshistorique`) is likewise deferred — a separate future source family for churn and temporal views.

The executable work plan is maintained separately at `.omo/plans/economie-pipeline-contracts.md`.

## Standard indicators (4)

| # | Indicator | Source | Access | Vintage | Notes |
|---|---|---|---|---|---|
| 1 | Créations d'établissements | INSEE SIDE/REE | CSV ~50 MB | annual | dynamique |
| 2 | Emploi au lieu de résidence | INSEE RP — dossier complet, tables ACT4/ACT5 (`DS_RP_TD_ACTIVITE_PCSACTIVITY_COMP`, resident) | CSV ~79 MB | 2023 | taille — the resident perspective feeds "Le matin, la commune se vide"; the workplace file (`DS_RP_EMPLOI_LT_PRINC`, ~16,8 MB) is a **separate source, not used in the source-table phase** |
| 3 | Chômage (population active) | INSEE RP | same | annual | santé |
| 4 | **Part des établissements dans les éco-activités** (green score) | **computed**: SDES "périmètre des activités de l'économie verte" (2020, NAF-based) × **SIRENE** commune establishment counts | pipeline | SIRENE monthly stock | ✅ decided 2026-08-03 — replaces A10; reuses the same SIRENE M matrix as relatedness; 🔶 *research item: pin the exact SDES NAF code list to SIRENE* (`docs/data-source-map.md` §Économie) |

**Ranks:** all four ranked in-context, computed in the pipeline.

**Optional creative (❓):** prix des locaux commerciaux (DVF `type_local 4`) — not decided, not priority.

## Story pool (2 candidates)

| Role | Story | Computation | Salience |
|---|---|---|---|
| ✅ default | **Location quotient (LQ)** — "ce que la commune sait faire" | sectoral specialisation vs moyenne bretonne (Balassa LQ from SIRENE/SIDE-REE) | always-on — universal (every commune has a sectoral mix), mildest when average |
| 🔶 salience-fired | **"Le matin, la commune se vide"** | emploi lieu de travail vs résidence (dormitory ratio) | fires when the jobs/homes balance is extreme — communes that empty by day, or fill |

- LQ is both the Story **and** the input matrix for relatedness (deferred) — one pipeline step, M (`docs/research/relatedness.md` §5).
- 🔶 Salience thresholds to be fixed during pipeline build.

## Pipeline notes

1. **download — built** — source-specific manifests for the SIRENE monthly snapshot (2026-08, ZIP ~2,7 Go, mode « manuel »), Flores A38/A88 (2024, ~21 Mo / 8 Mo, mode « cron »), and RP Emploi (2023, ACT4/ACT5 ~79 MB, mode « cron ») ; each source keeps its own vintage, reference and publication dates
2. **filter and normalize — built** — Brittany communes; source-native classifications; separate long sparse tables; no cross-source join beyond the commune reference
3. **profile — built** — `profil_economie.R` : coverage, row counts, activity coverage, omitted/zero cells, missingness, suppression, SIRENE eligibility exclusions, and basic sparsity/reliability evidence; one `<id>-profil.json` per table under `data/processed/economie/profil/`
4. **later compute — deferred (post-profiling analytical phase)** — the four indicators, ranks, LQ, green score, dormitory ratio, and Stories only after the source-table phase is reviewed; relatedness remains a later analytical layer
5. **vintage and publish — deferred** — each source keeps its own vintage; fiche publication is not part of the initial source-table phase

**Testing:** the initial source-table phase uses source-specific fixtures for SIRENE, Flores A38/A88, and RP employment; it asserts commune filtering, active/partial-diffusion handling, native measures, suppression/missingness, sparse-table shape, and deterministic profiling. The mocked end-to-end source-run test (`test-run-economie-contracts.R`) additionally proves the whole chain — download (mocked) → extract → normalize → profile — produces all four tables and the profiling evidence **without any fiche artifact** (publish is never called), and that a **second run never duplicates rows**. Indicator, LQ, green-score, rank, and Story fixtures belong to the later analytical phase. Suppression and small-n behavior remain prime profiling targets.

## Open items

- 🔶 SDES éco-activités NAF list — pin to SIRENE in a research pass.
- 🔶 Story salience thresholds.
- ❓ Prix des locaux commerciaux (DVF type 4) — v1 or not.

## Related

- Source map: `docs/data-source-map.md` §Économie/Emploi
- Research: `docs/research/relatedness.md` (LQ + relatedness method, SIRENE/Flores feasibility, suppression rules, tooling)
- Glossary: `CONTEXT.md` → Location quotient, Relatedness, Story
- Decisions: `docs/adr/0002-story-selection.md`
