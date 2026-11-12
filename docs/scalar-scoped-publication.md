# Scoped canonical scalar materialization (Mobility supply scalars)

Companion to [ADR-0044](adr/0044-scalar-indicator-scope-materialization.md).
This is a normal, registered pipeline capability — not a one-off script.

## What it is

Some scalar indicators are cheap to compute from their own producer sources but
live in a theme whose payload builder also computes unrelated heavy facts
(OSM/OCS-GE/GTFS). The scoped materialization produces **only** the registered
indicators of a scope, through the theme's owner functions, and **merges** them
into the current canonical per-theme scalar artifact:

```
public/data/scalar-serving/<theme>/scalar-current.json
```

Every unrelated descriptor, fact, provenance association, dataset and vintage
row is preserved verbatim. The artifact remains a complete per-theme artifact;
it is never a partial serving snapshot. The normal full-snapshot publisher
(`--check` / `--publish`) is unchanged.

Registered scope (2026-11-12):

| Theme | Indicators | Light sources |
| --- | --- | --- |
| mobilite | `stations_service`, `stations_service_1000`, `bornes_recharge_1000` | `mobilite_snapshot` (territory weights), `bpe_b316`, `bornes-recharges`, `stationnement-velo` |

## Runbook (local, no database)

From `pipeline/`:

```powershell
$env:LUSK_MODE = 'full'
$env:LUSK_CACHE = 'data/raw'
$env:LUSK_SORTIE = '../public/data'          # or an isolated scratch sortie
$env:LUSK_SCALAR_SCOPE = 'mobilite:stations_service,stations_service_1000,bornes_recharge_1000'
# publication flags stay unset: this path never connects to a database
Rscript -e "targets::tar_make(names = 'scalar_serving_scope', callr_function = NULL)"
```

or, equivalently, through the CLI:

```powershell
Rscript scripts/publish-serving-tables.R --scalar-scope        # materialize (local only)
Rscript scripts/publish-serving-tables.R --scalar-scope-check  # byte-check + full retained check
Rscript scripts/publish-serving-tables.R --check               # standard retained snapshot check
```

`--scalar-scope-check` replays the materialization into a temporary directory
and compares the generated token with the published pointer; it also runs the
standard retained snapshot/comparison checks. It is the receipt command.

### Prerequisites

- The canonical per-theme artifact exists (`scalar-current.json`). The scoped
  path preserves its rows; it does not create a generation from nothing.
- `territoires.parquet` exists in the sortie (the shared territory reference).
- The four scope sources are present in the cache. Integrity/download checks are
  the normal `download_sources` path; nothing is downloaded to main data from a
  worktree.
- Current metadata and canonical vintages. The materializer refuses a
  producer-stale base (see below); this does not prove the serving baseline.

## Producer-artifact guards (fail closed)

- Unknown theme/indicator in `LUSK_SCALAR_SCOPE` → graph/CLI error.
- Missing base artifact, missing territory reference → explicit error.
- Preserved descriptor semantically different from current metadata (label,
  unit, direction, facet, levels, sources, completeness, denominator semantics)
  → error naming the indicator; a full theme regeneration is required.
- Preserved source vintage different from the current canonical vintage → error.
- Base eligible universe different from the current territory reference at the
  retained contracts' levels → error.
- Any merged conflict in dataset/vintage identity → error.
- `--scalar-scope-check` byte mismatch against a fresh materialization → error.

A metadata edit that only moves `descriptor_version` (definition/caveat wording)
is reported as drift but does not block preservation; the published descriptor
row is kept as-is.

## Pre-publication serving baseline guard (database)

These producer checks do **not** prove the serving database holds the same
generation. The normal `--publish`/`--targets` path therefore adds a pre-write
guard when a scoped publication is requested:

```powershell
$env:LUSK_SCALAR_SCOPE = 'mobilite:stations_service,stations_service_1000,bornes_recharge_1000'
$env:LUSK_SCALAR_BASELINE_SORTIE = '<canonical generation the serving DB was published from>'
Rscript scripts/publish-serving-tables.R --publish
```

Before any write, under the existing scalar advisory lock
(`pg_advisory_lock(594,1)`), the guard reads the live markers and requires:

| Marker | Must match |
| --- | --- |
| `territory_reference` | candidate territory reference |
| `scalar_observation` | **prior baseline** scalar snapshot version |
| `scalar_comparison_publication` | **prior baseline** comparison version and scalar version |
| `declared_profile` | **prior baseline** declared-profile publication version |
| `profile_descriptor[distribution_dpe]` | baseline descriptor version and baseline `required_scalar_version` |
| `profile_comparison_publication` | **prior baseline** profile comparison version/profile/reference |
| `selected_reading_publication[habitat]` | habitat reading content/reference |
| `selected_reading_descriptor[habitat]` | descriptor version and **prior baseline** `linked_content_version` |
| `demographic_typed_reading` | candidate artifact version |
| `selected_reading` (habitat) | candidate artifact version |
| `economy_typed_reading` + `economy_activity_evidence` | candidate artifact version |
| `milieux_typed_reading` + `milieux_reading_absence` | candidate Milieux publisher version |
| `series_dataset_publication[<owned dataset>]` | candidate owned-series version |

It also proves candidate vs baseline differ **exactly** by the declared scoped
indicators (all other scalar facts/descriptors/provenance and the comparison
rows are identical; typed/series/reference/**profile facts** are identical),
and that the candidate profile artifact is bound to the **candidate** scalar
version. Any mismatch, including an invalid/unreadable baseline artifact or a
newer live profile/linked reading, hard-refuses with **zero writes** and lists
every marker with live vs expected values, plus the instruction:

> Retrieve the latest canonical generation that matches serving; do not force,
> regenerate or overwrite the serving tables.

The wrapper then executes the normal owner publications in one **outer
transaction**: territory reference → scalar → refreshed declared profile →
demographic/habitat selected reading → economy → Milieux/series. The profile
companion is refreshed metadata-only from its existing facts (only the
`required_scalar_version` descriptor token changes; DPE fact rows are identical)
through `refresh_declared_profile_scalar_binding()`, then published by the normal
registered profile owner. The existing owner transactions compose into the outer
transaction (`publication_transaction()`), so a failure after any stage rolls
back every owner; the pre-refresh profile artifacts are restored and a retry
after clearing the failure succeeds. The scalar/comparison tables remain
wholesale replaces: unchanged facts/provenance/descriptors are identical, while
the table version changes and the three resources are added.

The scalar `pg_advisory_lock(594,1)` serializes scalar publishers; it does not
cover the other owners' locks. **The operator must still ensure no concurrent
publication of any other owner** (maintenance window); this prerequisite is
explicit and not hidden by the guard.

## Tests

`pipeline/tests/testthat/test-scalar-scope.R`:

- registered scope parsing/validation (closed set);
- extracted supply aggregation equals the full `agreger_offre_territoires()` on a
  mixed multi-territory fixture (zero observed vs NA absent included);
- shared indicator assembly keeps the full row contract (unit, type, ranks,
  vintage stamps);
- merge preserves unrelated facts/provenance/descriptors/eligible universe and
  refuses a stale descriptor, vintage or reference;
- graph wiring: the scoped target depends only on the scope sources, EPCI
  extract, vintages table, base pointer and `territoires.parquet` — no
  `brut_*`, `publie_*`, `raccordement_*`, OSM or OCS-GE target.

`pipeline/tests/testthat/test-retained-baseline-guard.R`: scope parsing,
prior-snapshot reconstruction, and exact marker matching/refusal for scalar,
territory, typed, comparison, series, reference-binding and missing-marker
cases (pure, no database).

Guarded test-only database proof (never the serving DB; holds
`Local\LuskIntegrationContractDb`, creates one random `serving_it_*` schema,
cleanup always on, zero residual schemas):

```powershell
$env:PGPASSFILE = Join-Path $env:APPDATA 'PostgreSQL\pgpass.conf'
$env:LUSK_SCALAR_TEST_DATABASE = 'lusk_it_contract'
$env:LUSK_SCALAR_TEST_USER = 'lusk_it_contract_pub'
$env:LUSK_RETAINED_BASELINE_RECEIPT = 'E:\Temp\opencode\lusk-989-publication-preparation\49-atomic-smoke-receipt.txt'
pipeline\scripts\run-retained-baseline-smoke.ps1 `
  -CandidateDir <candidate sortie> -BaselineDir <prior baseline sortie>
```

Receipt status PASS on 2026-11-12 (one actual wrapper call): baseline 20 286
facts / 16 descriptors, candidate 24 087 / 19 (exact +3, +3 801 facts;
comparisons 1 136→1 349 groups, 58 688→69 692 territory results). Live scalar,
habitat, declared-profile, profile-comparison, DPE required-scalar and
selected-linked mismatches all refused with a whole-schema digest unchanged.
A forced failure after the scalar/profile stage rolled back the entire schema
(digest unchanged) and restored the pre-refresh profile artifact; retry
succeeded. Unchanged owner markers/versions and unchanged scalar/profile facts
are identical; DPE profile facts are byte/row identical, only the normal binding
token and selected linked version advance. HTTP before/after: DPE + habitat
read 200 with descriptor/source; after, the three scalar facts and fixed
comparisons (ranks) read 200. Schema cleaned; zero residual `serving_it_*`;
`public` tables unchanged. DB bytes before/after in the receipt.

Run:

```powershell
Rscript -e "testthat::test_local(filter = 'scalar-scope', stop_on_failure = TRUE)"
Rscript -e "testthat::test_local(stop_on_failure = TRUE)"   # before handoff
```

## Production handoff (operator, separately gated)

The scoped step only prepares canonical artifacts. Publication remains the
normal full-snapshot operator step:

1. operator-verified `pg_dump` backup with recorded location;
2. serving database/role/schema/current marker identity confirmed;
3. no concurrent publisher;
4. set `LUSK_SCALAR_SCOPE` and `LUSK_SCALAR_BASELINE_SORTIE` (the canonical
   generation the serving DB was published from) and run the normal
   `Rscript scripts/publish-serving-tables.R --publish` (or the normal targets
   publication) with the existing advisory locks and private libpq passfile. A
   baseline mismatch refuses before any write;
5. post-publication: facts, fixed/custom comparisons and batch reads return
   actual data for all three resources; parity to the generated facts,
   descriptors, provenance, ranks and publication tokens; no fabricated zero.

Until that operator step verifies, the status is **build/check complete**, not
**published/live**.

## Current readiness note (2026-11-12)

The available prior canonical generation on this workstation is **not
publication-ready under current producer contracts**:

- its demographic typed-reading artifact is rejected (`invalid persisted source
  clock; rematerialize it`), so neither the candidate nor the baseline can pass
  the typed-reading reader.

The guarded DB proof therefore rematerializes that ONE demographic reading
**on private test copies only**; that is test fixture repair, not production
evidence. The scalar-bound DPE profile companion is **not** a test fixture
repair: the wrapper refreshes it metadata-only through the normal owner and
publishes it inside the atomic transaction. A real publication still requires
the operator/orchestrator to retrieve or generate the **current canonical
generation** that serving holds (all owners), then rerun the light scoped
materialization on top of it. Do not force, regenerate or overwrite serving to
work around the demographic artifact blocker.
