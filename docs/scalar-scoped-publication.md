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
generation. When a scoped publication is requested, the normal
`--publish`/`--targets` path derives the **registered dependency closure** and
guards only that closure:

```powershell
$env:LUSK_SCALAR_SCOPE = 'mobilite:stations_service,stations_service_1000,bornes_recharge_1000'
$env:LUSK_SCALAR_BASELINE_SORTIE = '<counterpart generation>'   # see forward/recovery below
Rscript scripts/publish-serving-tables.R --publish
```

The closure is derived from producer metadata, never a hardcoded owner list:

1. the retained **scalar snapshot + scalar comparison** (whole-table writers);
2. every declared profile carrying a `required_scalar_version` binding (the
   scalar token is global, so the DPE companion is affected);
3. every typed-reading resource whose declared `source_keys` intersect those
   profile `comparison_scalar` facets (the linked **Habitat selected reading**);
4. the **territory reference** must match but is not rewritten;
5. the `source_dataset`/`source_vintage` rows those scalar/profile projections
   will upsert. Existing rows are guarded; recovery retires only newly
   introduced rows that no owner table references.

Before any write, under the existing scalar advisory lock
(`pg_advisory_lock(594,1)`), the guard reads the live markers and requires
exactly the **current** generation of that closure:

| Marker (closure) | Must match |
| --- | --- |
| `territory_reference` | both generations' reference (unchanged, never rewritten) |
| `scalar_observation` | current scalar snapshot version |
| `scalar_comparison_publication` | current comparison + scalar + reference version |
| `declared_profile` | current declared-profile publication version |
| `profile_descriptor[distribution_dpe]` | current descriptor version and current `required_scalar_version` |
| `profile_comparison_publication` | current profile comparison version/profile/reference |
| `selected_reading` + `selected_reading_publication[habitat]` | current Habitat content/reference |
| `selected_reading_descriptor[habitat]` | current descriptor version and `linked_content_version` |

The source/vintage rows are guarded separately from the publication markers:
every target row that already exists live must match exactly, so a newer shared
`source_dataset.name` or `source_vintage.version/date` hard-refuses with
**zero writes**. Target rows absent live are recorded. Forward may insert them
through the normal scalar/profile publishers. In the same transaction, any
inserted row that remains unreferenced is retired; a referenced row is
preserved. Recovery additionally retires a row that is present only in the
candidate generation. A row is retired only when no base table in the serving
schema references its `source_id`/`vintage_id` (FK-backed or text-only,
including Milieux/series provenance). Shared or referenced rows are preserved,
so unrelated owners are never cascaded or left dangling. The result is exact
for unreferenced scope-only source rows; referenced rows are intentionally
preserved.

Demographic, economy, Milieux and owned-series rows **and markers** are outside
the plan: they are not read as expectations and not published. A newer live
version of one of them neither blocks nor changes a scoped publication.

The plan also proves target vs current differ **exactly** by the declared
scoped indicators (all other scalar facts/descriptors/provenance and the
comparison rows are identical; profile facts/descriptors identical after
removing the scalar binding; affected selected-reading content identical), and
that the target profile artifact is bound to the target scalar version. Any
closure mismatch, including a newer live affected scalar/profile/selected
reading or linked dependency, hard-refuses with **zero writes** and lists every
marker with live vs expected values, plus the instruction:

> Retrieve the exact counterpart generation; do not force, regenerate or
> overwrite the serving tables.

### Forward write

`sortie` = candidate generation, `LUSK_SCALAR_BASELINE_SORTIE` = prior baseline.
The wrapper refreshes the candidate declared-profile artifact metadata-only
(only `required_scalar_version` changes; DPE fact rows are identical) and runs
the normal registered publishers in **one outer transaction**:

```
scalar snapshot + comparison -> declared profiles + comparison -> linked Habitat selected reading
```

The existing owner transactions compose into the outer transaction
(`publication_transaction()`), which tracks the active **connection identity**:
inner publishers join only on the identical connection; a different connection
fails before SQL; nested outer calls are refused; the state is cleared on every
exit/error. A failure rolls back every owner; the pre-refresh profile artifacts
are restored and a retry after clearing the failure succeeds. The
scalar/comparison/profile tables remain wholesale replaces: unchanged
facts/provenance/descriptors are identical, while the global versions change and
the three resources are added. The same normal publishers upsert the target
`source_dataset`/`source_vintage` rows; shared rows were guarded, and target-only
rows may be inserted. No per-row write semantics are claimed.

### Recovery

The **same** normal wrapper, plan and publishers restore the frozen prior
baseline after a successful candidate commit:

```powershell
$env:LUSK_SCALAR_SCOPE = 'mobilite:stations_service,stations_service_1000,bornes_recharge_1000'
$env:LUSK_SORTIE = '<writable copy of the frozen prior baseline>'   # target
$env:LUSK_SCALAR_BASELINE_SORTIE = '<candidate-current>'            # current live state
Rscript scripts/publish-serving-tables.R --publish
```

The direction is derived from the artifacts (exactly one generation carries the
scoped indicators), so there is no separate recovery flag. The guard expects
the live **candidate** markers of the closure; the scalar publisher's normal
explicit retirement policy omits the three scoped indicators from the restored
generation (`retired_indicator_ids`), then the same atomic transaction restores
the baseline declared-profile and linked Habitat reading. The three remain
declared by metadata but unpublished (the pre-#989 state). After those writes,
the same transaction retires the forward-introduced `source_dataset`/
`source_vintage` rows that no owner table references; shared or referenced rows
are preserved. The affected scalar/profile/selected state and unreferenced
scope-only source rows are restored exactly; shared/referenced source rows are
intentionally untouched. Newer unrelated Milieux/economy/series rows and
markers are untouched, so no full baseline hunt is needed for them. Recovery
must run on a **writable copy** of the frozen baseline (the canonical set is
read-only; the plan identity is proven by its manifest).

The scalar `pg_advisory_lock(594,1)` serializes scalar publishers; it does not
cover the other owners' locks. **The operator must still ensure no concurrent
publication of any other owner** (maintenance window); this prerequisite is
explicit and not hidden by the guard. Leaving `LUSK_SCALAR_SCOPE` unset keeps
the previous full-backend publication path unchanged.

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
prior-snapshot reconstruction, and exact marker matching/refusal for the
full-backend path (pure, no database).

`pipeline/tests/testthat/test-scoped-publication-plan.R` (#995): dependency
closure derivation (linked Habitat owner from DPE `part_passoires`), target vs
current delta in both directions, refusal of a difference outside the scope or
of indicators present on both/neither side, and the scoped guard accepting the
affected current markers while ignoring a newer unrelated owner marker.

`pipeline/tests/testthat/test-publication-transaction.R`: single-connection
outer contract — inner publishers join only the identical connection, a
different connection fails before SQL, nested outer calls are refused, state is
cleared after errors, and direct calls still open their own transaction.

Guarded test-only database proof (never the serving DB; holds
`Local\LuskIntegrationContractDb`, creates one random `serving_it_*` schema,
cleanup always on, zero residual schemas):

```powershell
$env:PGPASSFILE = Join-Path $env:APPDATA 'PostgreSQL\pgpass.conf'
$env:LUSK_SCALAR_TEST_DATABASE = 'lusk_it_contract'
$env:LUSK_SCALAR_TEST_USER = 'lusk_it_contract_pub'
$env:LUSK_RETAINED_BASELINE_RECEIPT = 'E:\Temp\opencode\lusk-989-publication-preparation\83-source-policy-receipt.txt'
pipeline\scripts\run-retained-baseline-smoke.ps1 `
  -CandidateDir <candidate sortie> -BaselineDir <prior baseline sortie>
```

Receipt status PASS on 2026-11-13 (#995 source-policy run): baseline 20 286
facts / 16 descriptors, candidate 24 087 / 19 (exact +3, +3 801 facts;
comparisons 1 136→1 349 groups, 58 688→69 692 territory results). Unrelated
demographic, economy, Milieux and owned-series markers were advanced to
**newer** values before the forward call; the scoped publication still
succeeded, kept those markers and their table rows byte-identical, and changed
only the closure. Newer affected scalar/profile/Habitat/linked markers all
refused with a whole-schema digest unchanged. The source-policy proof uses two
test-only `source_dataset`/`source_vintage` rows on a private candidate copy:
one unreferenced and one referenced by a `series_provenance_revision`. Newer
live shared source/vintage rows refused with zero writes; forward inserted both
test rows through the normal scalar publisher; recovery retired the
unreferenced row, preserved the referenced row (the series reference stayed
intact), and left every shared source/vintage row byte-identical; republish
reinserted both. A forced failure after the scalar/profile stage rolled back
the entire schema and restored the pre-refresh profile artifact. Then the
**same normal wrapper/plan** recovered the frozen baseline from the committed
candidate (scalar `10cfd…`, comparison `1b7c…`, profile `d97f…`, profile
comparison `2c97…`, linked `-d97f…-10cfd…-6fd9…`, DPE required scalar
`10cfd…`, three scoped facts absent) while the newer unrelated markers/rows
stayed untouched; the candidate was then republished through the same wrapper.
HTTP before/after: DPE + habitat read 200 with descriptor/source; after, the
three scalar facts and fixed comparisons (ranks) read 200. Schema cleaned; zero
residual `serving_it_*`; `public` tables unchanged. DB bytes before/after in the
receipt. Receipt:
`E:\Temp\opencode\lusk-989-publication-preparation\83-source-policy-receipt.txt`;
focused serial log:
`E:\Temp\opencode\lusk-1000-focused-R-serial-995-source.log` (125 PASS,
0 FAIL/WARN/SKIP).

Run:

```powershell
$env:TESTTHAT_PARALLEL = 'FALSE'
Rscript -e "testthat::test_local(filter = 'scoped-publication-plan|publication-transaction|retained-baseline-guard|scalar-scope', stop_on_failure = TRUE)"
Rscript -e "testthat::test_local(stop_on_failure = TRUE)"   # before handoff
```

## Production handoff (operator, separately gated)

The scoped step only prepares the canonical artifacts; it does not connect to
the serving database. The owner-approved recovery path is the **verified frozen
affected baseline** plus its manifest and the normal restore proof, not a
mandatory SQL dump:

- `baseline-current-demog` (218 files / 52.15 MB, read-only,
  `baseline-current-demog.manifest.json`) is the accepted recovery copy for the
  affected closure. Its actual scalar/comparison/profile/DPE/Habitat/reference
  versions match the affected live clocks the guard checks. It intentionally
  does not cover the unrelated Milieux/economy/series owners, which are neither
  required nor written by this path.
- An operator `pg_dump` is optional, not a precondition; the normal registered
  wrapper can restore the affected baseline from a writable copy (see
  **Recovery**). The guarded test-DB proof recorded in this document is the
  executable restore proof for that copy.

Publication is the **scoped atomic registered closure only** (scalar snapshot
and comparison, scalar-bound declared profile and comparison, linked Habitat
selected reading), never the previous full-backend step:

1. serving database/role/schema/current marker identity confirmed read-only;
2. no concurrent publisher (maintenance window);
3. set `LUSK_SCALAR_SCOPE`, `LUSK_SORTIE` (the candidate generation) and
   `LUSK_SCALAR_BASELINE_SORTIE` (the canonical generation the serving DB was
   published from) and run the normal
   `Rscript scripts/publish-serving-tables.R --publish` (or the normal targets
   publication) with the existing advisory locks and private libpq passfile. The
   closure guard refuses before any write on a newer affected
   scalar/profile/Habitat/linked marker; unrelated owner markers may be newer
   and are not touched;
4. post-publication: facts, fixed/custom comparisons and batch reads return
   actual data for all three resources; parity to the generated facts,
   descriptors, provenance, ranks and publication tokens; no fabricated zero.

Until that operator step verifies, the status is **build/check complete**, not
**published/live**; no serving publication has been performed yet.

## Current readiness note (2026-11-13, #995)

The scoped path reads only the registered closure. It therefore does **not**
require the local demographic typed reading, the Milieux typed reading, the
economy reading or the owned-series marker to match the newer live serving
state; the earlier all-owner mismatch is no longer a blocker for the three
Mobility scalars. The guarded DB proof rematerializes the demographic reading
**on private test copies only** because it seeds a complete baseline through the
full backend for comparison; the scoped forward/recovery path itself never
reads or publishes that owner.

The frozen prior baseline `baseline-current-demog` (218 files / 52.15 MB,
manifest `baseline-current-demog.manifest.json`, read-only) plus
`candidate-current` are the ready artifact plan for the tested closure. Its
scalar `10cfd…`, comparison `1b7c…`, profile `d97f…`, profile comparison
`2c97…`, Habitat `2d64…` and reference `6fd9…` match the affected live clocks
the guard checks. It intentionally does not cover the newer unrelated
Milieux/economy/series owners, which this path neither reads as expectations nor
writes. A data-only recovery uses the same normal wrapper/plan from a writable
copy; no SQL data dump is mandatory (an operator `pg_dump` is optional). The
18 GB raw cache is not part of this plan.

The production candidate remains `candidate-current` (scalar `f4e9…`,
comparison `fc2d…`); the guarded source-policy proof modifies only a private
copy with two test-only source rows and does not alter the ready artifacts.

The scalar-bound DPE profile companion is **not** a fixture repair: the wrapper
refreshes it metadata-only through the normal owner and publishes it inside the
atomic transaction. The operator still needs the private publisher role, the
maintenance window, and the guard; the verified canonical recovery copy above
is the approved backup path. This document does not perform the production
publication.

## One-off offre_tc serving bridge (#1071, epic #1048)

The normal scoped path above is unchanged and remains the first choice: it
requires `LUSK_SCALAR_BASELINE_SORTIE`, the exact generation the serving DB was
published from. For the one-off publication of the **address-based `offre_tc`**
and the **29 owner-retired legacy accessibility ids**, that counterpart
generation no longer exists (the live markers are from a generation whose
artifacts were not kept). Rebuilding it would mean regenerating or overwriting
the serving tables, which the guard deliberately forbids.

For **that one publication only**, `pipeline/R/publish_serving_bridge.R` builds a
new scalar snapshot in R from the **live serving rows** plus the freshly built
`offre_tc` facts (`produire_offre_tc_mobilite()`), removes the 29 retirements,
and writes rows + markers through the **existing registered publishers and
adapters** in **one publication transaction**. The Hash chain is not
reimplemented in SQL: the new scalar token is `scalar_content_version()`
(`md5(saveRDS(projection, version = 3))`), the comparison token comes from
`project_scalar_comparisons()`, and the chained declared-profile binding
(`required_scalar_version`) and Habitat `linked_content_version` are rebound
from the verified live tokens.

### Guards (all refuse with zero writes)

1. **Round-trip proof** â€” every indicator other than `offre_tc` and the 29
   retired ids must be identical as data (facts, descriptors, provenance)
   between the live rows read back and the new projection.
2. **Live markers** â€” the five tokens supplied by the operator
   (`LUSK_BRIDGE_EXPECT_SCALAR`, `_COMPARISON`, `_PROFILE`, `_HABITAT`,
   `_REFERENCE`) must equal the live marker inventory, including the chained
   input fields.
3. **`--dry-run`** prints the new tokens and the per-indicator diff and writes
   nothing.
4. **Dump acknowledgement** â€” the write command refuses unless
   `LUSK_BRIDGE_DUMP_CONFIRMED=<path-or-id>` confirms a verified `pg_dump` of the
   affected tables. The tool does not take or restore the dump.
5. **Scope and identity** — `LUSK_SCALAR_SCOPE` must select exactly the registered
   `offre_tc` scope, and `SELECT current_database(), current_user` on the live
   connection must equal `LUSK_PUBLISH_DATABASE` / `LUSK_PUBLISH_USER`. Checked
   before any read or write, including dry-run.
6. **Credentials** â€” host/database/role come from `LUSK_PUBLISH_HOST`,
   `LUSK_PUBLISH_DATABASE`, `LUSK_PUBLISH_USER` (optional `_PORT`); the password
   comes only from the private libpq passfile (`PGPASSFILE`, never inside the
   repository).

The fresh facts are supplied as a private RDS/CSV path in
`LUSK_BRIDGE_OFFRE_TC_FACTS` (the producer row shape: territory, indicator,
value, unit and source/vintage stamps). The retirement policy is derived from
the canonical metadata contracts, not copied into the tool.

### Operator sequence

```powershell
# From pipeline/, after a verified dump and the maintenance window:
$env:LUSK_BRIDGE_EXPECT_SCALAR = '<live scalar token>'
$env:LUSK_BRIDGE_EXPECT_COMPARISON = '<live comparison token>'
$env:LUSK_BRIDGE_EXPECT_PROFILE = '<live declared-profile token>'
$env:LUSK_BRIDGE_EXPECT_HABITAT = '<live Habitat selected-reading token>'
$env:LUSK_BRIDGE_EXPECT_REFERENCE = '<live territory-reference token>'
$env:LUSK_BRIDGE_OFFRE_TC_FACTS = '<private path to fresh offre_tc producer rows>'
$env:LUSK_PUBLISH_HOST = '<serving host>'; $env:LUSK_PUBLISH_DATABASE = 'lusk'
$env:LUSK_PUBLISH_USER = 'lusk_publisher'; $env:PGPASSFILE = '<private pgpass>'

Rscript scripts/publish-serving-tables.R --offre-tc-bridge-dry-run
# review: changes only to offre_tc values + the 29 retirements
$env:LUSK_BRIDGE_DUMP_CONFIRMED = '<dump path or id>'
$env:LUSK_PUBLISH_OFFRE_TC_BRIDGE = '1'   # explicit write opt-in, like --series-publish
Rscript scripts/publish-serving-tables.R --offre-tc-bridge
```

The guarded disposable-DB proof is run through
`pipeline/scripts/run-offre-tc-bridge-db.ps1 -PgPassFile <private pgpass>`; it
holds the shared `Local\LuskIntegrationContractDb` mutex for the whole R process
and the R test verifies the mutex is held before it connects.

### Limits â€” what this is NOT

- It is **not** a new publication path and does **not** change the #1068 scoped
  guard or `#publish` semantics. `publish_scoped_retained_backend()` still
  requires `LUSK_SCALAR_BASELINE_SORTIE`; this bridge is a separate, guarded,
  one-off command for the lost-baseline case only.
- It does **not** repair or recreate the lost artifacts, and does **not** add
  per-indicator/per-theme versioning to the serving tables (the underlying
  design problem, left for a follow-up). The scalar tables remain whole-table
  snapshots.
- It rewrites the scalar snapshot/comparison and, through the **normal registered
  profile publisher**, the whole declared-profile snapshot (descriptor, axes,
  facts, provenance and comparison). Those profile rows are rewritten with
  **identical data**: the reconstructed projections are proved equal to the live
  rows before the write and re-read and compared again inside the transaction;
  only `required_scalar_version` and the hashes derived from it change.
  Demographic, economy, Milieux, owned-series rows and the Habitat selected-reading
  rows are neither expectations nor written; their markers stay as they were.
- **Known limitation:** the fresh-recompute tests establish parity with the
  producer *functions* applied to the bridge's own live-row reconstruction. They
  are **not** parity against a canonical artifact — those generation artifacts
  are the lost baseline. Equality of unrelated indicators is therefore proved
  against the live serving rows read back at run time, not against a frozen
  golden copy.
- It has **no built-in rollback**: recovery is the operator's verified dump.
  A failure mid-write rolls the whole transaction back.
- Tests never touch the serving database. The pure fixtures run by default;
  the write proof is a separate guarded test that skips unless
  `LUSK_BRIDGE_TEST_*` names the disposable `lusk_it_contract` target and the
  shared mutex is held (see `api/tests/integration/README.md`). The operator
  performs the real publication and captures the retirement receipt.


### Explicit, temporary exception to ADR-0044 decision 8

ADR-0044 decision 8 says only the registered owners write the serving tables.
The bridge is a **documented, one-off exception** to that rule: for this single
publication the owner artifacts for the affected declared-profile generation
(the `LUSK_SCALAR_BASELINE_SORTIE` counterpart) are lost, so the normal scoped
owner path cannot run. It is not a precedent for routine publication and must
be **retired as soon as a real baseline exists**. What compensates for bypassing
the owner-artifact path: the round-trip data proof, the five-token live guard,
the verified-dump acknowledgement, the explicit write opt-in, the single
transaction with fail-closed (exactly-one-row) marker updates, the advisory lock
held across check and write, and the re-derivation of every dependent profile
hash through the registered producer functions from live-read rows. Unrelated
owners are neither read as expectations nor written. The ADR itself is unchanged.

