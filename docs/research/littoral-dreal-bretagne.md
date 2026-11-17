# Littoral communal — DREAL Bretagne source and classification (#1041)

**Status:** foundation slice only (classification + canonical territory
reference). Comparison presets, UI controls, ranks and deployment are later
slices. A code merge is not permission to publish the reference.

## Owner decision (supersedes the parent issue's first proposal)

The parent issue #1040 initially proposed the Cerema land-consumption
`littoral` field plus an explicit two-island imputation. The owner superseded
that:

- the source is the **DREAL Bretagne positive list** of communes littorales,
  not the dated Cerema/ANCT field;
- **no island imputation**: both islands are in the official list;
- future comparison/rank behavior must follow the existing `densite` preset
  behavior exactly (same-status peers, producer-computed ordinals), not the
  parent's "comparisons only, no ranks" first recommendation.

This slice implements only the producer-owned C/NC classification and its
territory-reference contract. It adds no preset, no control and no UI surface.

## Registered source

| Fact | Value |
| --- | --- |
| Dataset | Communes littorales en Bretagne au titre de la loi |
| Publisher | DREAL Bretagne / SCEAL |
| Dataset page | https://www.data.gouv.fr/datasets/communes-littorales-en-bretagne-au-titre-de-la-loi |
| Acquisition | WFS `dreal_b:l_communes_littorales`, CSV UTF-8, properties `Code_insee,Commune,Dpt,Classement`, `SRSNAME=EPSG:4326` |
| Licence | `lov2` — Licence Ouverte 2.0 (`licence` field and DCAT rights on data.gouv.fr) |
| Declared vintage | **2023-04-21** — `last_modified` (`2023-04-21T00:00:00+00:00`) and the harvest `modified_at` both report it |
| File SHA-256 | `d68f20e7ea2928ac36e104201fdd81327b610a384c1a3a6d6c33521fe61153cc` |
| File shape | 264 physical lines (header + 263 communes), CRLF, UTF-8 without BOM, comma-separated, 13 611 bytes |
| Source columns | `FID`, `Code_insee`, `Commune`, `Dpt`, `Classement` |
| `Classement` domain | `Mer` (250 rows) and `Estuaire` (13 rows) |

The pipeline manifest (`pipeline/R/classes_littoral.R`) pins the exact URL,
SHA-256, licence and dates. The digest is verified at the actual read/admission
seam — `lire_classes_littoral()` checks the pinned bytes by default on EVERY
path (`run_pipeline`, `_targets`, and any pre-existing cache), so a truncated
or altered cache can never generate a complement that silently reclassifies the
dropped communes as NC. `construire_crosswalk_littoral()` additionally refuses
a source without that admission proof; bounded synthetic tests must opt out
explicitly (`sha256 = NULL` / `exiger_identite = FALSE`), never by weakening
the production default. The same bytes are committed as a small test fixture
(`pipeline/tests/testthat/fixtures/littoral-dreal-bretagne-2023-04-21.csv`) so
the reader, the crosswalk and the count regression are proven without a
network call.

**Served date semantics.** The source publishes a declared distribution /
last-modification date (2023-04-21), not a surveyed legal-perimeter reference
date. The manifest and the served source vintage therefore carry
`datePublication = 2023-04-21` and an honestly absent `dateReference` (JSON
`null`), consumed by the app's nullable `SourceVintageRecord.dateReference`.
No observation date is invented.

**Vintage caveat.** 2023-04-21 is the dataset record's declared
last-modification date, not a surveyed legal-perimeter date. The source does
not publish a perimeter observation date. The date is therefore recorded as
dated evidence and must not be presented as a live legal guarantee.

## Geographic reconciliation

The inspected canonical commune universe is the pinned COG 2025 Breton table
`pipeline/inst/extdata/population_communes_2023.csv` (1 202 communes). The
projection was inspected against it:

| Check | Result |
| --- | --- |
| Source rows | 263 |
| Unique INSEE codes | 263 |
| Source codes absent from the canonical universe | 0 |
| Canonical communes classified C | **263** |
| Canonical communes classified NC (validated complement) | **939** |
| Île-de-Sein (29083) | C, `Mer` |
| Île-Molène (29084) | C, `Mer` |
| Plouvien (29209) | **NC** (absent from the DREAL list) |

These counts are **pinned-snapshot regression evidence**, not application
policy. No runtime rule asserts 263 or 939; the producer asserts only the
domain, uniqueness, canonical coverage and non-commune nullability that make
the crosswalk meaningful.

## Why DREAL differs from Cerema/ANCT

Cerema's `conso-com.csv` `littoral` field (the older entry in the parent
issue) reports **262 C** for the communes it covers, omits both islands, and
still classifies **Plouvien (29209)** as littoral. Adding the two islands
would give 264. The DREAL Bretagne perimeter has 263: it includes both
islands and excludes Plouvien after the 2015 commune-boundary change
(indexed in the Finistère RAA 2/2015). The effective-date clause of that
scanned act was not directly extracted during research; the boundary change
is documented as the reported cause, not re-litigated here.

The source choice therefore changes both membership (Plouvien) and any future
rank denominator (263 vs 264). The owner chose DREAL; the older Cerema field
must not be used as a fallback or supplementation.

## How completeness is established, and where it fails closed

The official dataset describes itself as the communes defined by the 1986 loi
Littoral and the 2004-311 decree — a positive statutory list. The producer:

1. parses the actual WFS CSV (UTF-8, quoted fields accepted) and validates the
   INSEE identity, uniqueness and `Classement` domain;
2. builds ONE complete crosswalk: listed codes → `C`, the validated complement
   of the canonical commune universe → `NC`; a source code outside that
   universe fails;
3. requires the crosswalk to cover **exactly** the canonical communes; a
   missing entry, duplicate, unknown code, `NC` carrying a source classement,
   or a classification on a non-commune fails publication;
4. never turns an arbitrary absent crosswalk row into `NC`. Only the validated
   exhaustive projection produces `NC`.

This is a documented completeness argument over the pinned source and the
pinned canonical universe, not a geometric proof that the DREAL layer covers
every future commune. A new commune, a boundary change or a changed source
list must be reconciled and the snapshot re-pinned deliberately.

## Contract and rollout

- The two fields travel on the canonical territory reference:
  `littoral_code` (`C`/`NC`; `NULL` on non-communes) and
  `littoral_classement_source` (`Mer`/`Estuaire` for `C`, `NULL` for `NC`).
- `project_territory_reference()` adds them to the retained reference rows;
  `territory_reference` gains them through additive migration 043. Existing
  rows, publication markers and old references survive with `NULL`/`NULL`.
- The compact browser reference (`territoires.json`) carries them, and the
  app validates the domain and the provenance record. It does not derive a
  preset or a rank from them in this slice.
- **The projected reference content version (a digest of the reference rows)
  changes when the enriched reference is published.** Every comparison
  publication bound to `territory_reference` is invalidated until republished;
  rollout must republish the reference and the dependent comparison families
  together, deliberately. Code merge alone changes no served data.
- This slice performs no live DDL, no production publication and no service
  deployment. Migration 043 is a code artifact for an operator-managed
  rollout.
- The real nine-parameter PostgreSQL adapter is exercised by a bounded guarded
  roundtrip (`test_littoral_reference_publisher.py` +
  `scripts/smoke-littoral-reference.R`): valid classified publish, marker,
  no-op, ON CONFLICT update, and rollback of an invalid classification. It
  needs no scalar/profile serving artifact.
