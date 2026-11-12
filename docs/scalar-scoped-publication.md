# Scoped canonical scalar materialization (Mobility supply scalars)

Companion to [ADR-0043](adr/0043-scalar-indicator-scope-materialization.md).
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
- Current metadata and canonical vintages. The materializer refuses a stale
  base (see below).

## Guards (fail closed)

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
4. `Rscript scripts/publish-serving-tables.R --publish` (or the normal targets
   publication) with the existing advisory locks and private libpq passfile;
5. post-publication: facts, fixed/custom comparisons and batch reads return
   actual data for all three resources; parity to the generated facts,
   descriptors, provenance, ranks and publication tokens; no fabricated zero.

Until that operator step verifies, the status is **build/check complete**, not
**published/live**.
