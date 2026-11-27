# PostgreSQL migration history

## Operator window — source nomenclature changes (issue #1151)

A new SCDL domain nomenclature (`programme_libl`) is a **metadata** change, not
an app rebuild or a database migration. Before `--programme-publish`, align the
closed domain declaration in
`pipeline/inst/extdata/theme-metadata/theme_programmes.json`:
`indicator_pages$subventions_par_domaine$list$categories` and
`detail_labels$subventions_par_domaine` must carry exactly the source's domain
set, together with the `comparison$details` axis and its `comparison$detail`
default; then regenerate the served `public/data/theme_programmes.json` through
the `publier_theme_metadata()` seam. The publisher's guard is
`project_programme_period_details()` (in `pipeline/R/publish_observed_collections.R`):
when a source detail is not declared it fails the run with
`Sparse period/detail observations differ from declared coordinates or metadata`
— read that named mismatch before touching the producer pipeline. The retained
producer snapshot is dated, so its fixture-parity tests normalise old domain
names instead of treating the snapshot as the source of truth.

## Migration 046 (#1137) — per-resource publication registry (additive, expand phase)

`046_resource_publication.sql` adds, **without changing any existing row,
marker, constraint or grant**:

- `resource_publication` — one row per Ressource sémantique de service
  (`resource_id`, `shape`, `content_version`, `reference_content_version`,
  `published_at`, `retired`). It is the single answer to "what is live".
- `resource_publication_event` — append-only receipt (resource, shape,
  operation `apply`/`retire`/`adopt`, old → new version, commit SHA, time,
  confirmed-definition flag, lineage digests). The publisher gets **INSERT and
  SELECT only** (no UPDATE/DELETE/TRUNCATE grant), and a BEFORE UPDATE/DELETE/
  TRUNCATE trigger refuses any rewrite regardless of role.
- `scalar_resource_comparison_publication` — a per-indicator comparison marker
  for scalars, keyed by `indicator_id`, alongside the existing per-indicator
  group/territory/lineage rows.

**Expand-phase coexistence.** `table_publication['scalar_observation']` and the
`scalar_comparison_publication` singleton are deliberately LEFT IN PLACE and
are **not** written by `apply`. The #1140 API reads the registry and per-resource
markers instead; the later contract migration (#1141) removes the global
markers and typed-reading tables in a separate owner-approved window.
`schema.sql` carries the same contract for fresh installs; the fast DB-free
contract is `api/tests/test_resource_publication_migration_contract.py`, and the
guarded, non-retained populated-upgrade rehearsal is
`api/tests/integration/test_resource_publication_migration.py` (own random
schemas, mutex, runtime identity checks, cleanup opt-in; skips without the
`lusk_it_contract` DSNs). Applying this DDL alone publishes nothing; no worker
applies it to a serving database.

## Migration 047 (#1138) — per-resource declared-profile comparison marker (additive)

`047_profile_resource_comparison.sql` adds, **without changing any existing row,
marker, constraint or grant**, `profile_resource_comparison_publication`: a
per-indicator comparison clock for declared profiles, the exact counterpart of
046's `scalar_resource_comparison_publication`. The group/territory/lineage rows
remain keyed by `indicator_id`; only the global clock gains a per-resource form.

**Expand-phase coexistence.** `table_publication['declared_profile']` and the
`profile_comparison_publication` singleton are deliberately LEFT IN PLACE and
are **not** written by the declared-profile shape adapter. The #1140 API reads
the registry and per-resource markers instead.
`schema.sql` carries the same contract for fresh installs; the fast DB-free
contract is
`api/tests/test_profile_resource_comparison_migration_contract.py`, and the
guarded, non-retained populated-upgrade rehearsal is
`api/tests/integration/test_profile_resource_comparison_migration.py` (own random
schemas, mutex, runtime identity checks, cleanup opt-in; skips without the
`lusk_it_contract` DSNs). Applying this DDL alone publishes nothing; no worker
applies it to a serving database. The later contract migration (#1141) takes the
next free number after 048.

## Migration 048 (#1140) — version-bound resource discovery descriptors (additive)

`048_resource_publication_descriptor.sql` adds
`resource_publication_descriptor(resource_id, publication_resource_id,
content_version, descriptor, published_at)`. Shape adapters write the producer
declaration in the same transaction as the registry row. `resource_id` is the
semantic API identity; `publication_resource_id` binds it to the storage
resource (the two AEDAR grammar identities share the aggregate's publication).
The API joins on both publication identity and content version and excludes
retired rows, so a stale descriptor cannot advertise a newer resource version.

The migration changes no existing row, global marker, serving descriptor,
constraint or grant. `schema.sql` carries the fresh-install contract. The fast
DB-free parity contract is
`api/tests/test_resource_descriptor_migration_contract.py`; the guarded
non-retained rehearsal is
`api/tests/integration/test_resource_descriptor_migration.py` (own random
schemas, mutex, exact test database/role checks, cleanup opt-in; skips without
the guarded DSNs). Applying this DDL alone publishes no descriptor. No worker
applies it to a serving database.

## Migration 049 (#1141) — retire typed readings and global markers (contract)

`049_retire_typed_readings.sql` is the destructive contract step for ADR-0049.
It drops the Démographie, Habitat, Économie and Milieux typed-reading tables and
source associations, the global `scalar_comparison_publication` and
`profile_comparison_publication` singletons, and the retired typed-reading rows
from `table_publication`. Scalar/profile **fact** tables, every retained resource
row, the per-resource registry/descriptors/comparison markers, owned series,
collections and AEDAR survive. The retained `table_publication` allow-list is
exactly `territory_reference`, `ordered_series`, `aedar_territorial_aggregate`
and `aedar_territory_summary`.

The migration owns one `BEGIN`/`COMMIT`, sets a five-second lock timeout and
uses `current_schema() || ',pg_catalog'` as its search path. It never uses
`CASCADE`: any unexpected view, rule, foreign key or other dependency aborts the
whole transaction for review. There is no down migration; recovery is the
verified backup plus the matching release.

**Operator gate (#1143).** Apply 049 only after 046–048, successful `adopt`, the
new per-resource API deployment and a green HTTP sweep. Before the window:

1. Take and restore-test a fresh `pg_dump -Fc`; record the exact database,
   schema, roles/grants, timestamp and backup location.
2. On the restored copy, run the guarded populated rehearsal
   `api/tests/integration/test_typed_reading_retirement_migration.py`. It proves
   every registry/resource row survives, retained reads succeed, replay is a
   no-op, and an unexpected dependent view aborts with zero changes.
3. Inspect dependencies read-only. This query must return **zero rows** before
   approval (run with the target schema first in `search_path`):

   ```sql
   SELECT pg_describe_object(d.classid,d.objid,d.objsubid) AS dependent_object,
          d.deptype
   FROM pg_depend d
   JOIN pg_class v ON d.refclassid='pg_class'::regclass AND v.oid=d.refobjid
   JOIN pg_namespace n ON n.oid=v.relnamespace
   WHERE n.nspname=current_schema()
     AND v.relname IN (
       'demographic_reading_descriptor','demographic_typed_reading',
       'selected_reading_publication','selected_reading_descriptor',
       'habitat_typed_reading','economy_activity_evidence','economy_typed_reading',
       'milieux_reading_source','milieux_reading_absence','milieux_typed_reading',
       'milieux_population_provenance_revision',
       'scalar_comparison_publication','profile_comparison_publication')
     AND d.deptype IN ('n','i','a')
   ORDER BY 1;
   ```

4. Save the retained registry inventory for comparison:

   ```sql
   SELECT resource_id,shape,content_version,reference_content_version,retired
   FROM resource_publication ORDER BY resource_id;
   ```

Apply once with the owner-approved DSN:

```powershell
psql -X --set ON_ERROR_STOP=on --file api/migrations/049_retire_typed_readings.sql "$APPROVED_DSN"
```

Do **not** add `--single-transaction`: 049 owns its transaction. On any error,
stop and investigate; disconnect rolls back the open transaction. After commit,
verify that the dropped relations are absent, the registry inventory is
unchanged, only the four retained `table_publication` markers remain, and the
HTTP sweep still succeeds. Do not run `adopt` after 049: it refuses with the
typed reason `adoption_globale_retiree` before reading any dropped marker.

## Migration 045 (#1043) — AEDAR littoral sibling summaries (additive)

`045_aedar_littoral_summary.sql` extends the AEDAR reference-only publication
with the third fixed context `littoral` (`group_id` `'C'`/`'NC'`,
`territory_type` `commune`, `statistic` `pooled`). It widens
`aedar_reference_context_check` and `aedar_reference_scope_check` in place,
adds three `littoral_summary_*` counters to `aedar_comparison_publication`,
and creates the SIBLING relation `aedar_littoral_summary`. No density-only
PK/count contract, density descriptor, grant on the density table, or
`aedar_comparison_territory` row is changed: C/NC summaries live in their own
table and can never collide with the density summary keys. The deferred
publication validator now accepts an existing complete **pre-extension**
generation (zero littoral groups and counters) and rejects an incomplete
littoral generation with a named reason. Replaying 045 on a current schema is
a structural no-op; fresh installs carry the same contract in `api/schema.sql`.
Fast contract: `api/tests/test_aedar_littoral_migration_contract.py`.
The guarded, non-retained rehearsal
`api/tests/integration/test_aedar_littoral_migration.py` proves on the
dedicated test database (own random schemas, mutex, runtime identity checks,
cleanup opt-in) that a pre-extension generation commits, an incomplete
littoral generation is rejected, a complete C/NC sibling generation commits
with density counters still correct, and replaying 045 leaves the AEDAR catalog
unchanged.

**Coordinated operator window (#1043 / #1044).** A code merge publishes
nothing. In ONE operator window the owner must apply migrations 043, 044 and
045 (in that order after the earlier pack), republish the enriched
`territory_reference` with the complete C/NC crosswalk, republish ALL
comparison families (scalar, declared profile, ordered series, observed
collections), regenerate AEDAR references and BOTH the density and littoral
sibling summaries via `scripts/publish-aedar-aggregates.R --check` then the
gated `--publish` flow, rebuild the API service, and deploy the app (#1044).
A partial rollout leaves comparison/AEDAR markers stale; the API fails closed
with a named reason rather than borrowing a density or Bretagne cohort. No
worker applied serving DDL, publication or deployment.

**AEDAR pooled artifacts first (#1150).** The `publish-aedar-aggregates.R
--check` step above *reads* the two already-pooled Parquet artifacts; it never
builds them. In the same operator window, with the pinned DREAL and density
sources present in the raw cache, rebuild both from `pipeline/` in this order:

```powershell
Rscript scripts/build-aedar-density-aggregate.R
Rscript scripts/build-aedar-littoral-aggregate.R
Rscript scripts/publish-aedar-aggregates.R --check
```

The littoral builder obtains its crosswalk through
`read_aedar_littoral_reference()`, which binds to the
`code_commune / littoral_code / littoral_classement_source` output contract of
`construire_crosswalk_littoral()` and derives the served C/NC membership from
it. A stale or renamed crosswalk fails closed; the publisher never invents an
NC classification for a commune absent from the pinned DREAL positive list.

### Measured operator sequence (#1156)

Rehearsed end to end on 2026-11-23 against a template copy of `lusk`. Each
command commits independently, so the outage runs from the first data commit
until the last dependent one; **measured 22 minutes** for steps 1–6 with the
AEDAR aggregates pre-built, or about 60 minutes if steps 0a/0b run inside the
window.

Environment, once per window (all from `pipeline/`, private libpq passfile):

```text
LUSK_PUBLISH_HOST / LUSK_PUBLISH_DATABASE / LUSK_PUBLISH_USER
LUSK_SORTIE=<run directory whose source-digests.json equals sources.lock.json>
PGPASSFILE=<private passfile>
LUSK_MILIEUX_CONSO_SOURCE=<path to conso-com.csv>     # required when the Milieux absence marker is non-empty
LUSK_AEDAR_RAW_DIR=<raw cache>
```

| # | Command | Opt-in | Measured |
|---|---|---|---|
| 0a | `scripts/build-aedar-density-aggregate.R` | — | 18m00 |
| 0b | `scripts/build-aedar-littoral-aggregate.R` | — | 19m44 |
| 1 | `scripts/publish-serving-tables.R --publish` | — | 2m18 |
| 2 | `scripts/publish-serving-tables.R --owned-series-publish --all` | `LUSK_PUBLISH_OWNED_SERIES=1` | 4m44 |
| 3 | `scripts/publish-serving-tables.R --series-publish` | `LUSK_PUBLISH_SERIES=1` | 11s |
| 4 | `scripts/publish-serving-tables.R --programme-publish` | `LUSK_PUBLISH_PROGRAMMES=1` | 13s |
| 5 | `scripts/publish-aedar-aggregates.R --check` | — | 1m45 |
| 6 | `scripts/publish-aedar-aggregates.R --publish` | `LUSK_PUBLISH_AEDAR=1` | 13m23 |

Steps 2 and 3 are **both** required and own different things: `--publish` covers
the reference, scalar snapshot, comparisons, declared profiles and the retained
OCS-GE state series; `--owned-series-publish` writes the owned datasets
(`series_dataset_publication`); `--series-publish` writes the ordered-series
family and is the only writer of the `ordered_series` table marker. Skipping it
leaves that marker bound to the previous reference and the API refuses the
family. Typed readings were part of the pre-049 measured sequence only; migration
049 retires them and the legacy whole-snapshot entry points refuse post-049.

After the window, verify: the four `offre_tc` anchors (Rennes 0.9967512,
Brest 0.9260954, Finistère 0.6486402, Bretagne 0.5663383), the "adresses"
descriptor, zero retired ids, zero `table_publication` rows whose
`reference_content_version` differs from the live reference, and the littoral
C/NC counts against the DREAL positive list.

**Full retained publication is atomic (#1126).** The full backend publication
(`publish-serving-tables.R --publish` / the `publie_backend_retained` target,
i.e. `publish_retained_backend_from_parquet`) now refreshes the declared-profile
scalar binding metadata-only, then publishes the territory reference, scalar
snapshot and comparison, declared profiles and their comparison, and the retained
OCS-GE state series in ONE outer transaction. The four typed readings were part
of the pre-049 sequence only. Any failure rolls the whole publication
back and restores the profile artifacts, so a release that moves both the
reference and scalar versions can no longer leave a partial database (Habitat
used to refuse against the stale DPE binding after earlier owners had committed).
Consequently `LUSK_PUBLISH_PROFILE=1` is **no longer required** for a complete
release: profiles are published by the full path itself. The separate
`publie_profiles_declares` target is deliberately **kept** as an explicit
standalone republish lever; in the normal sequence it is a harmless no-op
because the artifacts and binding already match the published generation.

**Milieux CONSOENAF source for the pre-049 full publication (#1148, historical).**
The `milieux_reading_absence` marker named below is dropped by migration 049; this
source requirement belongs to the measured pre-049 sequence only. In that
coordinated operator window, publish the full backend with the producer source
snapshot at hand; a database that already holds Milieux absence declarations
(production) cannot replace them without re-deriving source coverage. Set
`LUSK_MILIEUX_CONSO_SOURCE` next to `LUSK_SORTIE`, for example:

```powershell
$env:LUSK_SORTIE = 'E:\Lusk\public\data'
$env:LUSK_MILIEUX_CONSO_SOURCE = 'E:\Lusk\pipeline\data\raw\conso-com.csv'
Rscript scripts/publish-serving-tables.R --publish
```

Both documented full-publication entry points — the `--publish` branch and the
`publie_backend_retained` target — resolve this variable through the same
resolver into `conso_source_path`. When the live `milieux_reading_absence`
marker is non-empty and the source is missing or unreadable, the publisher
refuses **before** the advisory lock and the outer write transaction, naming
`LUSK_MILIEUX_CONSO_SOURCE`; an empty marker needs no source and behaves as
before. Supplying the source does not weaken Milieux validation: a wrong
basename, missing commune identity or unregistered vintage still fails with its
named error, and an all-NA/partial crosswalk never becomes an invented fact.
No worker applies this publication to a serving database.

## Migration 044 (#1042) — littoral comparison contexts (additive)

`044_littoral_comparison_contexts.sql` widens the closed `comparison_context`
domain of the four published comparison families and their shared
`comparison_source_lineage` table from
`('density_class','epci','bretagne','same_level')` to
`('density_class','epci','bretagne','same_level','littoral')`. `group_id` is
`'C'`/`'NC'` and `territory_type` is `'commune'` for that context. The DDL only
replaces the existing context CHECK on each of the five tables (located through
`pg_constraint`/`pg_get_constraintdef`, so it works on named or auto-named
constraints); no row, column, table, trigger or grant changes. Existing
density/EPCI/Bretagne/same_level generations stay readable and writable, and a
replay of the migration is a no-op. `api/schema.sql` carries the widened domain
for fresh installs.

**Operator ordering:** apply 044 **after** the pack
`030 -> 039 -> 033 -> 034 -> 035`. The driver is the upgrade-gap case: on an
upgrade the comparison base relations do not exist until 039 creates them (and
the lineage relations until 033/034/035), so 044 has no target to widen if it
runs earlier; running it after the pack also widens each relation exactly once
in its final shape. This is NOT about 039's exact-definition replay: its
documented `m039_normalize_context` accepts both the four-value and the widened
CHECK, so a widened fresh/current schema replays 039 cleanly (guarded proof:
`-k test_migration_039`). Fresh installs take the widened domain from schema.sql.
Fast contract: `api/tests/test_littoral_comparison_migration_contract.py`.
The non-retained guarded rehearsal
`api/tests/integration/test_littoral_comparison_migration.py` upgrades a
synthetic pre-044 install, proves old generations survive, accepts both
littoral cohorts, and compares the migrated structure with a fresh schema; it
needs the documented `lusk_it_contract` DSNs, dedicated roles, private passfile,
mutex and cleanup opt-in, and skips without them.

**Coordinated-refresh rollout dependency (#1044 runbook).** The enriched
territory-reference publication (migration 043) changes the projected reference
content version, which invalidates every comparison generation bound to
`territory_reference`. Code merges authorize no serving DDL, publication or
deployment. In ONE operator window the owner must: apply the additive
migrations; republish the reference with the complete C/NC crosswalk; republish
ALL comparison families (scalar, declared profile, ordered series, observed
collections) so their markers bind to the new reference and carry the littoral
context; regenerate AEDAR references/ranks (#1043); rebuild the API and redeploy
the app (#1044). A partial rollout leaves comparison markers stale and the API
fails closed with a named reason rather than borrowing a density/Bretagne
cohort. No worker applied any serving migration or publication.

Migration 043 (#1041) is purely additive: it adds `littoral_code` and
`littoral_classement_source` to `territory_reference`, with a closed CHECK
(commune-only, C ⇒ Mer/Estuaire, NC ⇒ no source classement, NULL allowed for
existing/transition rows). Apply it before running a publisher that writes the
enriched reference. Applying it alone changes no data and publishes nothing.
**Rollout caveat:** the projected reference content version changes once the
enriched reference is published, so every comparison publication bound to
`territory_reference` is invalidated until republished; do not publish the
reference or the dependent comparison markers early. Existing rows and markers
survive the DDL. See `docs/research/littoral-dreal-bretagne.md`.

The guarded rehearsals are
`api/tests/integration/test_littoral_reference_migration.py` (schema/migration
upgrade) and `test_littoral_reference_publisher.py` (the real nine-column R
adapter roundtrip), both non-retained, requiring the documented cleanup opt-in
and the shared database mutex. Both verify the dedicated publisher/read roles
and exact test database before any DDL.

Migration 041 adds `aedar_territory_summary` and its independent publication
marker. Apply it after 040 before running the producer's existing guarded
AEDAR `--publish` operation. The producer atomically publishes source facts,
all territory-grain summaries, and their reference-bound markers in one
repeatable-read transaction; rollback is ordinary transaction rollback. The
legacy API continues reading `aedar_territorial_aggregate` until a later reader
cutover is explicitly deployed. Rollback of this producer slice means
reverting to the previous publisher/API release; do not drop the new relation
while its marker or later readers exist.

> **Historical chronology, not a current runbook.** Sections for migrations
> 001–035 describe their original change and verification context; many legacy
> paths cited there have since been retired. The current retained schema is
> `api/schema.sql`; the latest guarded upgrade proofs are migrations 036 through
> 039 as described in [`api/tests/integration/README.md`](../tests/integration/README.md).
> For the scalar and ordered-series comparison repair, the dependency order is
> **030 -> 039 -> 033 -> 034**; 039 itself creates no lineage columns.
> Do not execute old commands in this chronology as current operating guidance.

# Migration 016: bounded BPE profile evidence (historical)

Migration 016 adds a dedicated, registered `bpe_profile_evidence` publication;
it does not put BPE class counts into the median-only declared-profile shape.
The descriptor records the projection version, four-class closed axis, actual
TYPEQU registry file identity/hash, a hash of the producer-emitted source
`(territory, type, TYPEQU)` membership artifact, complete-universe count, and the existing
`mobilite_snapshot` source/vintage. The publisher verifies each eligible territory's
actual source membership against the registered TYPEQU identities; a count-only
partition is not sufficient evidence for zero classes. Facts are dense by territory across the four
declared classes, partition the registered universe exactly, and carry at most
one producer-selected exemplar per nonzero class. Zero classes require all
exemplar fields to be NULL. The publication marker is reference-versioned to
`territory_reference` and all writes are one publisher transaction. Fresh
installs carry the same tables and deferred validation trigger in `schema.sql`.
(**#873 correction, 2026-11-02:** superseded by migration 036 — fresh installs
no longer carry these tables; the historical statement above described the
pre-retirement era and is kept as dated evidence. The guarded
`test_bpe_deferred_validation_work.py` rehearsal now builds the 016 stage by
applying migration 016 itself, then rehearses 026 and does not touch the
current `schema.sql` contract.)
The ordinary `connexion_service` flow does not publish BPE. A pipeline caller
must separately pass `publier_bpe = TRUE`; the registered publisher still checks
the BPE artifacts, shared reference marker and vintage before writing.

The migration is additive: it preserves current marker rows and adds one
allow-listed marker. Rehearse it after the current building/profile/series
schema migrations (including 008 and 015) against both a fresh schema and a
populated disposable rehearsal schema. Do not apply it to the serving database
as part of a code change; production rollout remains operator-managed.

# Migration 028: AEDAR territorial aggregates

Migration 028 adds the source-shaped AEDAR `territory × TYPEQU` aggregate table
for the four pinned Bretagne 2026-v1 Parquets. It stores the producer's complete
312-measure map as JSONB together with source identity, denominators, coverage,
ODbL attribution, and publication dates; the measure map is not an indicator
catalogue. The table has its own `table_publication` content version and is
reference-versioned to `territory_reference`. Apply 028 after 027. It updates
the marker allow-list/reference constraint and grants reader SELECT plus
publisher DML. The named API route bounds each read to a territory, optional
TYPEQU selection, and at most 100 rows. Fresh installs contain the same schema
and grants. No production migration or publication is performed by this change.

# Migration 010: building ramp floating-point correction

The original 008 trigger compared the R-published `double precision` quantile
exactly with its JSON descriptor. R can publish `0.30000000000000004` for the
declared `0.3` axis; the first live publication failed and rolled back without
changing building markers. Migration 010 replaces only the trigger function,
allowing representation noise of at most `1e-12` while rejecting real off-axis
values. It does not change rows, markers, grants or reader flags. Fresh installs
and future 008 applications use the same corrected predicate. On 2026-09-29,
010 was applied to `lusk.public` before a successful building/scalar publication;
the two building source-vintage FKs were then validated. Migration 009 was not
applied.

# Migration 011: dataset-owned ordered-series publications

Migration 011 is additive and limited to the ordered-series/state slice. It
creates owner-scoped series markers, descriptors, observations, immutable
provenance revisions and observation-to-revision associations. It does not alter
or backfill the legacy `ordered_series`, `series_descriptor`, shared source
tables, or `table_publication`; the ENAF legacy reader remains unchanged. All
series readers use the default-off `VITE_OWNED_SERIES_API=1` build gate; the
older `VITE_CONSO_ENAF_SERIES_API` and `VITE_OCSGE_STATE_SERIES_API` names remain
backward-compatible aliases for their respective existing consumers. `schema.sql` carries
the same objects for fresh installs. Apply/test order is after 007/008/010; 009
is unrelated and must not be applied to this worktree/database by the worker.

The focused `pipeline/scripts/smoke-series-postgres.R` rehearses both fresh-schema
parity and migration 011 in a random owned schema in `lusk_it_contract` (the
script splits the fresh schema at the owned-series boundary, applies 011, then
publishes canonical ENAF and OCS-GE projections). It checks independent markers,
facts, descriptors and provenance across updates, immutable provenance revision
corrections, rollback, no-op, and reader write denial. It never touches `public`
or a serving database. Production migration and OCS-GE API deployment/flag are
separate serial operator gates; never disable the live ENAF flag as part of this
slice.

# Migration 012: scalar theme identity

Migration 012 adds nullable `scalar_descriptor.theme_id` for compatibility with
existing snapshots. It intentionally does not infer/backfill theme membership;
the next normal scalar publication writes the value from each canonical
`theme_<theme>.json` descriptor and includes it in descriptor/table content
identity. Selected-theme scalar reads exclude legacy NULL identities. Fresh
`schema.sql` requires a valid theme key. This additive migration does not activate
a fiche consumer or authorize any live database application.

The OCS-GE publisher requires the canonical Milieux series artifact
(`series-serving/artif_par_habitant/`, materialized from the theme payload)
to carry producer-emitted `state_role` and `source_components` lineage. A
stale artifact is rejected before the smoke script opens its disposable
schema; do not reconstruct lineage by parsing `periode_artif`. Regenerate
artifacts through the normal pipeline using its own data copy, then run
focused fixtures and the documented slow byte-identical targets parity audit
before treating the producer change as campaign-ready. A worktree without
`pipeline/data/raw` cannot perform the final real-artifact/API rehearsal.
(#757 retired the theme-grouped `indicateurs_milieux.parquet`; the typed
serving artifacts under `public/data/` are the canonical inputs now.)

# Migration 009 operator procedure (historical; superseded)

This procedure is retained as historical evidence only. It is not a current
migration selector or supported operator instruction; consult the current
036/037 guarded procedures and obtain owner/operator approval for any future
production change.

Migration 009 is reserved for issue #600 and is **not** part of fresh-install
`schema.sql`. It removes only the retired `public.dataset_publication` relation.
Never replay historical migrations 001/002 to create it. The active API reads
publication identity from `table_publication`; R publishes each table and its
marker atomically. The retired Python database-write importer and its historical
writer tests have been removed. The old importer-oriented integration fixtures
are historical evidence only and are not a supported publishing path.

## Required gated procedure (orchestrator/operator only)

Do not apply this migration in worker/CI against a live Pi. Before scheduling a
reviewed, serial maintenance window:

1. Confirm the database is `lusk`, the target schema is `public`, and the exact
relation/column contract in 009 matches. Stop if any assertion fails.
2. Take a verified, restorable full database backup (`pg_dump -Fc`) and record
the backup location, timestamp, database owner, relation owner, ACLs/grants,
and relevant role memberships. Do not assume a table-only dump captures grants
or operational dependencies.
3. Inspect catalog foreign keys, views/materialized views, rules, triggers,
functions, ownership/grants, and search-path/dynamic-SQL consumers. Also ask the
operator to verify external scripts, dashboards, scheduled jobs, and other
out-of-database references. `DROP ... RESTRICT` makes catalog dependencies fail
closed; it cannot discover external consumers.
4. Rehearse on the explicitly named disposable database `lusk_it_contract`.
The opt-in test `test_migration_009_rehearses_guarded_retirement_in_owned_random_schema`
executes the actual migration file in a random, test-role-owned `it_<20 hex>`
schema only. It checks the unexpected-column guard, dependent-FK atomic failure,
successful removal, then a schema-level simulated per-table fact/marker update
and read-after-commit through the active read-only role (this is not execution
of the R publisher). It also verifies denied writes for that role. The script
has no path to `public` in this database; do not weaken the
production `lusk.public` guard to make a rehearsal pass. Current
`table_publication` and `territory_reference` data must survive. For operational
rehearsal, restore recent data to a disposable database and verify publication
and reads before proceeding.
5. Obtain explicit operator approval after recording rehearsal output, backup
   verification, dependency inventory, and maintenance window. Run once with
   `psql -X --set ON_ERROR_STOP=on --file api/migrations/009_retire_dataset_publication.sql "$APPROVED_DSN"`.
   Do **not** add `--single-transaction`: migration 009 owns the transaction
   with its in-file `BEGIN`/`COMMIT` and five-second lock timeout. On any SQL
   error, `ON_ERROR_STOP` terminates psql; disconnect rolls back the still-open
   transaction, so the drop cannot partially commit. Investigate and abort on
   any error rather than retrying blindly.

There is intentionally no down migration. Reversal means restore the verified
backup (or explicitly recreate the relation from that backup), then restore
owner/grants and validate the active per-table publication path. The removed
historical row is not a reversible marker. No live Pi DDL is authorized by this
change; API Compose deployment remains a separate owner-controlled action.
# Migration 013 — profile optional second axis and scalar dependency

Apply only after migration 012 and separate operator approval. This expand-only
DDL leaves existing profile facts, axes, provenance and publication markers
untouched. It adds producer-owned theme identity and an optional scalar-facet
dependency token, relaxes the mandatory sex-axis reference for genuine one-axis
profiles, and strengthens the coordinate trigger. NULL `theme_id` on legacy
descriptors keeps them out of theme reads until a canonical republish; the old
structure-age reader remains available.

Rehearse against a disposable populated profile snapshot before applying live:
`test_declared_profile_postgres_api_contract[upgrade]` uses the schema at
298831504f1a755d0f83fe919e9999616c98e8ce, inserts age facts and its marker, applies
013, then proves the original HTTP response and stale-reference refusal. Fresh
install uses `schema.sql`. Do not deploy the new API ahead of this migration.
Back up profile tables/marker before a live operation; rollback after publishing
one-axis data requires restoring that backup and the prior API, not dropping
columns over newly published coordinates. No live application is authorized by
the implementation PR.

# Migration 015 — owned duration series and named analytical references

Migration 015 adds an explicitly producer-declared active indicator route, a
numeric duration axis paired with ordered public detail keys, and a typed named
reference family under the existing owned-series publication marker. Named
reference points have no territory foreign key and reuse immutable series
provenance revisions. The row-count marker includes territorial and named
reference facts. Existing owned descriptors default to an inactive route and
remain available through their explicit dataset URLs. Fresh installs carry the
same schema in `schema.sql`. The guarded integration test exercises migration
015 over a populated pre-015 schema as well as the fresh schema; it does not
apply the migration to a serving database.

# Migration 020 — selected demographic reading facts

Migration 020 adds one constrained typed table for the already-selected
Démographie history rows, an independently versioned descriptor/provenance pin,
and the reference dependency on its publication marker. It does not store the
history row as JSON, recalculate rates in SQL, or publish a candidate pool.
`smoke-demographic-reading-postgres.R` applies the actual migration over a
populated territory-reference marker in its guarded disposable schema, then
published all 1,268 canonical Parquet rows and verified commune/EPCI HTTP output
against the then-incumbent `histoires_demographie.json` in the original rehearsal.
Since the 2026-11-06 numerical-export retirement, the smoke consumes the validated
producer-owned typed-reading generation directly; the retired browser JSON is
not an input. No serving database is modified by this migration rehearsal.

# Migration 021 — selected Economy reading and ordered activity evidence

Migration 021 adds typed Economy reading identity/status rows and a separate
sparse, rank-keyed activity evidence table. The registered R projection consumes
the canonical selected history and preserves populated top-five producer order;
it does not derive a new top-five or turn absent slots into zeroes. Each table
has a compatible marker, and the Economy theme facts reader fails closed for
missing/stale publication dependencies. Region territories with no canonical
reading row report `unsupported`; the reader does not invent a region reading.
Fresh installs carry the additive tables/markers in `schema.sql`.

# Migration 022 — selected Milieux reading and field-level source windows

Migration 022 adds typed selected Milieux reading facts plus constrained field
source associations. The R publisher consumes the canonical selected history,
population vintage manifest, and the registered OCS-GE M2/M3 role/component
projection. Each state association carries its immutable source revision,
state role, observation window, and owned-series content token; population keeps
its independent history clock. The bounded theme facts reader checks these
associations against the selected reading and current owned-series publication
and returns 503 for stale or inconsistent dependencies. No indicator is
recomputed in SQL, and unrelated publications remain untouched. `schema.sql`
contains the matching fresh-install contract. The guarded fiche-series HTTP
rehearsal publishes the canonical facts and validates every fact and source
association against incumbent JSON, Parquet, and source manifest expectations.

# Migration 023 — selected Mobility reading

Migration 023 adds a constrained, source-bound selected-reading projection for
Mobilité (`story_key`, `groupe`, producer salience/classification, and the two
published loss values). It reuses the registered `mobilite_snapshot` source
vintage and territory-reference publication tokens; it does not publish the
building distribution bins or quantiles, which have separate figure contracts.
The registered publisher replaces only this family atomically and the theme
facts reader returns 503 for a missing/stale marker or unavailable source clock.
Fresh installs carry the same table and marker allow-list in `schema.sql`.

# Migration 024 — focal Mobilité density distribution

Migration 024 adds an independently versioned, shape-specific publication for
the focal `dens_min`/`dens_max` range and paired ordered `dens_N`/`dec_N`
coordinates. It is not a median profile and contains no peer cloud. Its
descriptor declares focal eligibility from producer metadata (independent of
the narrower figure-comparison levels) and each fact row binds to the already registered immutable
`mobilite_snapshot` vintage and the territory-reference publication. The
publisher validates closed axes, territory identity, source-clock compatibility,
inserted counts, retry/no-op and transaction rollback; it does not alter legacy
source or vintage records. The Mobilité theme-facts reader returns this focal
distribution only when its marker, descriptor, reference, source clock and
requested territory coordinates are compatible. Fresh installs carry the same
tables, validation triggers, grants and marker allow-list in `schema.sql`.

`pipeline/scripts/smoke-mobility-density-distribution-postgres.R` rehearses 024
over prior reading facts/markers in a random owned schema in `lusk_it_contract`,
then invokes the registered publisher with a three-territory fixture and checks
the focal HTTP payload, unchanged retry, and failed-refresh rollback. It does
not read or publish the canonical full set and is not production deployment or
canonical parity evidence.
# Migration 017 — declared source absence for owned series

Migration 017 adds a constrained `absence_semantics` declaration to the shared
owned-series descriptor. Existing publications default to `unavailable` and keep
their fail-closed response when focal observations are absent. Only a producer
declaring `no_record` with `may_be_missing` completeness permits a successful
empty focal acquisition; no zero or false observation is fabricated. A stale,
missing or row-count-inconsistent publication still fails closed.

The canonical programme HTTP acceptance test rehearses the migration over
populated descriptors/facts and confirms unchanged markers, row counts and
legacy absence behavior. Fresh schema carries the same constraints. Migration
017 also adds optional `comparison_levels`, constrained to a nonempty subset
of focal `allowed_levels`. The annual-grant producer preserves region focal
facts without authorizing region comparisons. Legacy descriptors fall back to
their original allowed-level comparison behavior; readers tolerate a pre-017
descriptor until the separately approved migration/publication occurs.
Migration 017 also adds the owned-series `series_context_parent_policy` relation.
Only producer-declared commune→EPCI and EPCI/département→region parent links
are supported. The reader returns bounded parent points with the focal period,
never a substitute year or the whole parent dataset. Region has no parent;
comparison-only reads omit this unchanged context. Pre-017 acquisitions do not
claim the new context contract.
Migration 016 is reserved independently for the BPE batch; 017 has no BPE dependency.
Apply each reviewed migration only after its serving backup/upgrade rehearsal
and separate approval. This source change applies no serving DDL.

The programme annual-grant publisher has explicit `--programme-series-check`
and `--programme-series-publish` modes in `publish-serving-tables.R`. Check
does not connect to PostgreSQL; publish retains the existing owned-series
opt-in and cron exclusion. These modes remain annual-only compatibility entrypoints.

# Migration 018 — typed sparse observed collections

Dense profiles cannot express observed commune/year/domain grants without
inventing zero cells; annual series cannot express the categorical domain
coordinate. Programme membership has no year coordinate and must preserve its
anchor, label rider and per-row nullable publication clock. Migration 018 therefore
adds two constrained grains, `period_detail_observation` and `anchored_membership`,
with a shared registered descriptor/category/publication relation. There is no
generic EAV/JSON fact store or one table per indicator. FKs, coordinate/anchor
checks and deferred publication validation bind facts to their own typed family,
source and territory reference. Replacements and markers commit per collection;
all registered projections validate before the first write and retries are no-ops.

`--programme-check` reads stable canonical Parquets, invokes the existing
programme producer and validates all three registered keys without a DB
connection. `--programme-publish` requires `LUSK_PUBLISH_PROGRAMMES=1`, rejects
cron, and publishes annual totals plus both observed collections. Each owner
commits independently; retry reconciles a partial failed command without
replacing unrelated families. This does not wire publication into an ordinary
pipeline run, activate full-theme coverage or authorize serving DDL/deployment.

The guarded canonical publisher-to-HTTP test independently compares all **791
annual totals, 2,378 domain grants and 253 membership anchors** with the incumbent
producer projection, including source stamps/riders. It checks four focal levels,
named relationships/counts, row-specific ORT clocks, matching-year parents,
selected/empty/singleton/mixed overlapping comparisons, no-record states,
no-op retries and rollback. It rehearses migration 018 over populated annual
series/reference owners and republishes collections through the registered R path.
Apply 017 then 018 only after the separately reviewed serving rehearsal/backup.

# Migration 029 — national raccordement mean curve

`029_raccordement_mean_curve.sql` extends the owned-series comparison contract
from the historical default-group median to the explicitly declared national
`raccordement_courbe` selected-group mean. Its complete duration grid is
0, 5, …, 360 minutes; neither other indicators' median contracts nor their
published facts are changed. The exact numeric grid is validated on descriptor
writes as well as the existing axis and publication-transaction guards.

The earlier working filename `017_raccordement_mean_curve.sql` was unpublished
and conflicted with the existing `017_series_source_absence.sql`; it is now 029.
Do not replace, skip, or rename the historical source-absence migration.

`api/tests/integration/test_raccordement_owned_series_http.py` rehearses 015 and
029 over a populated pre-015 schema, preserves ENAF and M2/M3 observations, accepts
a complete national declaration and verifies that an invalid-grid publication
rolls back. The separate `test_raccordement_national_candidate_http.py` exercises
the pinned national artifact, R curve and ordinary scalar publishers, and HTTP
reads in an isolated `lusk_it_contract` schema. These are guarded local proofs,
not approval to migrate, publish or activate production. Follow the gated operator
procedure above before any live operation.

# Migration 030 — fixed-context profile and collection comparisons

`030_fixed_context_profile_collection_comparisons.sql` adds the published
comparison projections for detail-backed declared profiles and sparse numeric
period/detail collections. It does not duplicate scalar comparisons, change
categorical membership semantics, or rewrite existing facts. Profile and
collection markers pin the source content and territory-reference versions;
collection publication validation also checks group membership, missingness,
and rank-size consistency. Fresh installs carry the same tables and grants in
`schema.sql`. The explicit programme publisher also writes immutable
`observed-collection-comparison-<indicator>-<content-version>` generations
under its configured sortie directory (`groups.parquet` and
`territories.parquet`); retries verify and reuse an existing generation rather
than replacing it.

The guarded canonical programme publisher-to-HTTP rehearsal applies migration
030 after recreating migration 018, then republishes through the registered R
publisher. Apply only after the separate restored-database upgrade rehearsal,
backup, and operator approval. This source change does not apply serving DDL or
publish production data.

# Migration 031 — fixed-context AEDAR comparisons

`032_aedar_fixed_comparisons.sql` adds source-shaped group and territory result
tables plus an independently versioned publication marker. The marker pins the
exact AEDAR aggregate and territory-reference publication versions; its deferred
constraint validates row counts and eligible/missing membership before commit.
The API rejects mismatched dependency markers. Fresh installs carry matching
tables, constraints and grants in `schema.sql`. The migration is additive and
does not publish production data.

# Migration 031 — AEDAR TYPEQU metadata

`031_aedar_typequ_metadata.sql` adds the official BPE 2025 domain/subdomain
codes and labels, source order, and individual gamme value/status to the
existing AEDAR territorial facts. Existing rows are left readable but carry
all metadata columns as NULL until the canonical AEDAR publisher replaces the
complete fact set; the bounded AEDAR API fails closed on such rows. New rows
must carry a complete hierarchy and a consistent `classified` / `hors_gamme` /
`absent` state. Fresh installs enforce the same contract in `schema.sql`.
Metadata is versioned coherently with the AEDAR aggregate publication; this
migration does not publish data or imply production rollout.
# Migration 034: ordered-series comparison provenance

`034_ordered_series_comparison_lineage.sql` publishes ordered-series comparison
axis metadata and immutable revision associations at resolved group/axis grain,
plus Raccordement model-zero reason counts. The API fixed-context path reads
these rows alongside the existing group/focal result; it no longer scans peer
observations to rediscover declared axes, support or lineage. Existing marker
rows retain NULL lineage counts, distinguishing an unrepublished legacy
snapshot from a publisher-declared zero-lineage axis; fixed reads fail closed
until the registered R publisher republishes the owned series. Arbitrary selections and raw series
observations keep their existing request-time behavior. Fresh installs carry
the same constrained relations and publication metadata in `schema.sql`.
This migration is additive and does not publish data or authorize deployment.

# Migration 033 — scalar/profile comparison provenance

`033_comparison_source_lineage.sql` adds group/facet source-vintage associations
for scalar and profile comparisons. Existing rows deliberately receive NULL
lineage counts (rather than zero), so an old publication cannot be mistaken for
a newly published, legitimately empty lineage. Fixed comparison reads fail
closed until the normal R publisher replaces those comparison projections.
Fresh installs carry the constrained lineage relation and non-null count
contracts in `schema.sql`.

# Migration 035 — numeric collection comparison provenance

`035_numeric_collection_comparison_lineage.sql` adds collection source-vintage
associations, support-shape checks, and deferred completeness validation.
Existing publication rows start `lineage_complete=false`, so they remain
unavailable until normal publisher replacement. A genuinely empty new
comparison remains valid when the publisher declares zero eligible support and
zero lineage. The migration is additive and does not publish data or authorize
deployment.

# Migration 036 — retire legacy accessibility serving objects

`036_retire_legacy_accessibility_serving.sql` removes the BPE evidence, building
access, service-access, and mobility-density distribution serving tables and
their owned validation functions. It removes their obsolete publication tokens
and narrows the shared publication-token constraints to retained owners. It
does not use `CASCADE`: an unexpected dependent object aborts the transaction
for explicit operator review. Retained canonical source records, scalar/profile/
series/collection/AEDAR facts, provenance, and publication versions are preserved.
The guarded integration proof applies this migration to a populated schema
created from the pinned pre-retirement schema, verifies retained values and
tokens, and checks that excluded tables/functions are absent. This migration
only changes the serving schema; it does not authorize deployment.

# Migration 038 — set-based owned-series provenance validation

`038_owned_series_provenance_set_validation.sql` replaces only the
`validate_series_dataset_publication()` trigger function. The focal
observation-to-provenance check becomes one `EXCEPT` set difference over the
exact `(dataset_id,indicator_id,territory_id,axis_value)` key instead of a
correlated `NOT EXISTS`. The correlated form can plan as a nested loop that
rescans a dataset's provenance rows once per observation row: on a freshly
written, unanalyzed schema the guarded 4,745-row publication spent 11,264,631
index-tuple fetches and 13.2 s in COMMIT; after the rewrite it spends 14,235
fetches and 0.94 s, and a 28,105-row publication commits in 5.8 s. The two
sets of figures are separate runs with different counter scopes: the
real-publisher numbers count `idx_tup_fetch` on
`series_observation_provenance` alone, while the guarded 4,744-observation
regression counts `seq_tup_read + idx_tup_fetch` over both focal relations
(37,952 visits). Counters are PostgreSQL 18.6 cumulative statistics read
through `pg_stat_force_next_flush()` and `pg_stat_user_tables`; they record
work, not a guaranteed physical plan. Every other
check, error message, marker `row_count` contract, per-row provenance trigger
and the `NEW.dataset_id` scope are unchanged, so per-owner atomic replacement
and direct SQL rejection guarantees are preserved. The migration is additive:
no table, column, index, trigger or data change, and it does not analyze shared
tables. Fresh installs carry the same function body in `schema.sql`. The guarded
integration proof installs migration 015's validator, applies 038, and compares
the migrated function and its accepted/rejected outcomes with a fresh schema;
the work regression is pinned by PostgreSQL tuple-visit counters rather than a
wall-clock threshold. This migration does not publish data or authorize
deployment.

# Migration 039 — restore scalar and ordered-series comparison bases

**#1042 compatibility note (replay-proven, not a silent rewrite):** 039's exact
constraint validator keeps its four-value `comparison_context` definitions and
accepts the post-044 five-value form through one documented normaliser
(`m039_normalize_context`) that strips only the `littoral` element from context
CHECKs before comparison. Every other constraint is still validated byte for
byte. This lets an already-widened fresh/current schema replay 039 as a no-op
while an old four-value relation remains valid. The guarded proof
`api/tests/integration/test_postgres_publication.py -k test_migration_039`
passes with the widened `schema.sql` (4 passed).

`039_comparison_base_objects.sql` repairs the retained upgrade gap behind #806:
fresh installs receive the six scalar and ordered-series comparison base
relations from `schema.sql`, but no retained migration creates them. Apply it
in this dependency order:

    030 -> 039 -> 033 -> 034

Apply each step with `search_path` set to the target schema only; 039 uses
`current_schema()` and unqualified relation names. Current 030 owns the profile
and numeric-collection comparison bases that 033 also alters; the scalar base
DDL instead comes from the deleted historical
`030_scalar_comparison_aggregates.sql` (commit c6d29805), and the ordered-series
base DDL from commit 7535ce9b. 039 owns only
`scalar_comparison_{publication,group,territory}` and
`ordered_series_comparison_{publication,group,territory}`. It deliberately
creates the exact **pre-lineage** shapes; do not create the current lineage
columns and then run 033/034 again.

039 classifies each family independently and validates the full catalog contract
for every existing `present` or `current` relation before target DDL: columns,
types and nullability; defaults; all PK/FK/CHECK definitions and FK actions;
constraint validation state; required valid backing indexes; user-trigger
absence; and reader/publisher privileges. A missing required grant on an
existing family is a hard failure, not a repair. Grants are issued only as
part of creating an absent family.
Extra valid non-unique independent indexes and grants to other roles are
preserved; unexpected unique/invalid independent indexes, reader write access,
reader grant options, and user triggers are rejected. Extra publisher privileges
are preserved. No unrelated object is rewritten.

039 classifies each family independently:

- `absent`: no base relations. 039 creates the pre-lineage contract. Run the
  corresponding lineage migration next (033 for scalar, 034 for ordered series).
- `present`: all three base relations with the exact pre-lineage contract. 039
  is a validated structural no-op. Run the corresponding lineage migration next.
- `current`: all three base relations plus the exact 033/034 lineage columns.
  039 is a structural no-op. Do **not** run that family's lineage migration
  again.
- Any other shape — one or two base relations, mixed lineage columns, lineage
  relations without their base family, a non-table relation, or an unexpected
  column/type/nullability — aborts inside the migration transaction before the
  target schema is mutated.

The migration preserves all existing facts, descriptors, sources, publication
markers, roles and unrelated objects; it creates no producer data and no
lineage relations. It reproduces the base primary keys, foreign keys, checks
and grants from the pinned pre-lineage contract. The retained 034
`ordered_series_comparison_zero_reason` foreign key differs from fresh
`schema.sql` (034 uses `ON DELETE CASCADE` and is not deferrable; fresh is
deferrable and does not cascade). That pre-existing shape is deliberately not
changed here; the R publisher deletes comparison groups directly before
rewriting them, so 034's cascade is load-bearing on the upgrade path. The
guarded proof records the difference rather than hiding it.

For a read-only before/after operator inventory (not a migration command), use
[`039_operator_state_inventory.sql`](039_operator_state_inventory.sql) with an
explicit target schema and a read-only connection. Run it before and after the
approved pack, retaining both outputs:

```powershell
psql "$READ_ONLY_DSN" -X -v ON_ERROR_STOP=1 -v target_schema=public `
  -f api/migrations/039_operator_state_inventory.sql
```

The inventory reports each family's **shape only**, all columns/defaults,
constraints and FK actions, index validity/uniqueness, user triggers, effective
reader/publisher grants, and exact row counts for comparison storage plus the
protected fact/marker tables. Its owner-migration presence list separately
reports the six 039 bases, the 034/035 lineage tables, the 030 profile and
collection foundations, the 032 AEDAR foundations, and the 033 shared lineage
table; 039 does not create or validate those separately owned families.
The inventory performs exact `count(*)` scans (including scalar observations
and ordered-series facts) for protected relations that exist. These are not
catalog-only estimates and may be resource-intensive on a large serving schema.
The read-only transaction sets a 15-second statement timeout and 3-second lock
timeout; if a timeout aborts the transaction, treat that run as incomplete and
retain no partial output as a valid pre/post inventory. Keep `ON_ERROR_STOP=1`
so psql stops at the error. Do not raise the limits without an operator-approved
read-only execution plan.
Its `observed_shape_only_state` labels (`ABSENT_SHAPE_ONLY`,
`PRESENT_SHAPE_ONLY`, `CURRENT_SHAPE_ONLY`, or
`INCOMPATIBLE_SHAPE_ONLY / INVESTIGATE`) are presence/column-shape hints only;
`structural_validation_performed` is always `false`. A shape classified as
present or current is **never by itself evidence of structural validity, safe
application, or a no-op**. This inventory is not a parallel contract validator.
Before *any target-schema change*, migration 039's full pre-DDL structural
contract validator remains required and authoritative for its two families;
only a successful validator run is approval of those families' contract.
Do not use this inventory's shape label alone to decide apply/skip/no-op, and do
not apply on any incompatible shape. The separately owned 030/032/033/034/035
objects still require their owners' full prechecks. After the approved pack,
count and compare protected rows; do not infer safety from the report's shape
labels. After the pack, every 039 family must be
`current`; protected fact, descriptor, source, and publication-marker row
counts must match the pre-run output, while only expected comparison/lineage
rows may change through the separately authorized publisher operation. The
two exact zero-reason FK definitions (fresh deferred/no cascade or retained
034 cascade/non-deferrable) are the only allowed divergence. This inventory is
not a production action and was not run against a production database.

# Migration 040 — publish AEDAR reference aggregates only

`040_aedar_reference_only_publication.sql` is an additive forward contract
after 039. It marks existing AEDAR rank generations `legacy_rank` so API reads
fail closed, removes group-level peer-eligibility columns, and changes the
deferred publication invariant to require the reference-only mode, current
AEDAR/reference bindings, exact group count, and zero rows in the retained
unserved `aedar_comparison_territory` table. It performs no data publication or
cleanup and uses no `CASCADE`. Fresh `schema.sql` expresses the same serving
contract. Apply only in the separate owner-operated phase after review; this
implementation does not run the migration against any database.
In the already-approved rollout sequence it follows the committed migrations:

    030 -> 039 -> 032 -> 033 -> 034 -> 035 -> 037 -> 038 -> 040

Canonical AEDAR regeneration is performed by the existing pipeline entry point
from `pipeline/` after the approved code/schema rollout:

```powershell
Rscript scripts/publish-aedar-aggregates.R --check
```

Before that check, rebuild both pooled artifacts from `pipeline/`
(`Rscript scripts/build-aedar-density-aggregate.R` and
`Rscript scripts/build-aedar-littoral-aggregate.R`): `--check` reads their
Parquets and does not build them (#1150).

This reacquires/validates the official source aggregates and producer-owned
pooled-density artifact, then atomically writes a versioned reference-only
comparison manifest. A stale legacy manifest is not upgraded in place; rebuild
it with `--check`. Database publication remains the separately gated explicit
`--publish` operation and is not authorized by this migration or issue #810.

The retained projection is one `aedar_comparison_group` row per
`(comparison_context, group_id, territory_type, typequ, measure)` with ten
columns: those five key columns plus `statistic`, `value`, `n_addresses`,
`n_observed`, and `coverage_status`. The existing `aedar_territorial_aggregate`
remains the complete source of commune/EPCI/département/Région facts. The old
`aedar_comparison_territory` relation is retained for upgrade compatibility, is
not reader-granted, and must contain zero rows in a current publication. The
publication marker adds `publication_mode='reference_only'` and requires a zero
territory-row count. This is 7 density-class groups + 2 same-level groups, each
crossed with the registered TYPEQU and measure axes (currently 235 × 312), or
659,880 summary rows; EPCI/Bretagne direct references are not duplicated.

The guarded migration/fresh-schema integration proof reports a representative
`pg_column_size` tuple estimate multiplied by that reference cardinality. It is
explicitly a heap-row estimate (not a benchmark or production measurement) and
excludes indexes, page fill and catalog overhead; it does not load a full
reference cube.

The operator has separately supplied a live read-only inventory reporting
`current_database=lusk`, `current_user=postgres`, and `transaction_read_only=on`,
with the 18 listed public relations
absent: the six 039 bases, ordered-series lineage, three 030 profile bases,
three 030 observed-collection bases plus its 035 lineage, three 032 AEDAR
bases, and the 033 shared `comparison_source_lineage`. This is owner-provided
evidence, not a connection or verification performed by this migration work.
It confirms the production starting shape is the absent-base path and that the
030 foundations (and the separately owned 032/035 foundations) must also be
accounted for in an approved operator plan. It does not prove their functions,
triggers, grants, or partial states; those remain mandatory read-only
preconditions in each owner's pack. The 039 order remains **030 -> 039 -> 033
-> 034**. No production connection or migration was made here.

The guarded upgrade proof starts from the pinned pre-lineage schema with real
synthetic facts and markers, removes only the comparison storage, applies
039 -> 033 -> 034, verifies facts/markers survive, exercises the R publisher and
API readback, checks missing publications return 503 rather than 500 or stale
data, and compares the resulting structural contract with a fresh `schema.sql`
install. It also covers the current-state no-op, absent/present shapes, and
transactional rejection of incompatible partial states. Fresh installs continue
to use `schema.sql`. This migration does not publish data or authorize
deployment.

## Operator flow -- adopting an existing database, then planning (#1142, rollout #1143)

Run from `pipeline/`, with the serving credential set process-scoped by the owner
(never in a shared shell). **Rehearse the whole sequence first on a restored copy of
production (never `lusk`)**, record timings and receipts, then repeat live. Order:
fresh `pg_dump` (restore-tested) -> 046 -> 047 -> 048 -> `adopt --dry-run` -> `adopt` ->
verify -> deploy the new API -> HTTP sweep -> contract migration (#1141) -> **sweep again**.

1. `Rscript scripts/publication.R adopt <sortie> --dry-run` -- opens the same
   session as `apply` (snapshot + reference lock), proves every resource's live rows
   equal its artefact (every persisted column, every row of the resource, vintage
   clocks and comparison tokens) and writes **nothing**. A refusal names each
   diverging resource and table. Typed refusals: `aedar_canonique_absent` /
   `aedar_manifeste_absent` (sortie without the AEDAR canonical files or
   `aedar_comparison_manifest.json`), `dependance_divergente`,
   `jeton_comparaison_non_atteste`, `jeton_comparaison_absent`,
   `jeton_comparaison_multiple`, `marqueur_existant_divergent`.
2. `Rscript scripts/publication.R adopt <sortie>` -- same proof, then ONE transaction
   writes only: the registry rows, the version-bound descriptors (048), the
   per-resource comparison markers (046/047) and the `adopt` receipts. **No existing
   serving or comparison row is updated or deleted.** A per-resource marker is written
   only for a resource whose comparison has rows (a rowless scalar-backed profile such
   as `distribution_dpe` gets none until its next `apply`; the API never reads it). The
   marker carries over the GLOBAL comparison token the live comparison rows already
   carry (the API's identity key: lineage token == marker token; the scalar marker's
   `scalar_content_version` is the `required_scalar_version` of the profiles that depend
   on it), recorded in the local receipt as `comparison_token`. Adopt never invents a
   token and never overwrites a marker: an existing marker identical to what adopt
   would write is left as is, a different one refuses the adoption.
3. Verify (run as the owner, expected counts for the full catalogue of the kept sortie;
   `N` = number of adopted resources, `C` = adopted scalar resources with a comparison,
   `P` = adopted computed profiles with a comparison):
   ```sql
   SELECT count(*) FROM resource_publication WHERE NOT retired;            -- = N
   SELECT count(*) FROM resource_publication_event WHERE operation='adopt';-- = N
   SELECT count(*) FROM resource_publication_descriptor d JOIN resource_publication p
     ON d.publication_resource_id=p.resource_id AND d.content_version=p.content_version
     WHERE NOT p.retired;                                                   -- = D (derived, see below)
   SELECT count(*) FROM resource_publication_descriptor
     WHERE resource_id IN ('aedar_territorial_aggregate','aedar_territory_summary'); -- = 2
   SELECT count(*) FROM scalar_resource_comparison_publication;           -- = C
   SELECT count(*) FROM profile_resource_comparison_publication;          -- = P
   SELECT count(*) FROM scalar_resource_comparison_publication m
     JOIN profile_descriptor d ON d.comparison_scalar=m.indicator_id
     WHERE m.scalar_content_version<>d.required_scalar_version;           -- = 0
   ```
   **`D` is derived from the declarations, never a hard-coded offset.** Rule: one
   descriptor per declared discovery identity of each adopted resource, i.e. one per
   resource that declares itself as an indicator, **plus one per named reference alias**
   its owned-series route publishes (`reference_read_route` in the theme metadata, e.g.
   `raccordement_courbe` -> `raccordement_reference`), **plus one per extra grammar
   identity** of a storage resource declared in `semantic-resource-contracts.json`
   (`aedar` -> `aedar_territorial_aggregate`, `aedar_territory_summary`). The producer
   computes exactly that; print it from the same kept sortie and metadata:
   ```powershell
   Rscript -e "pkgload::load_all('.',quiet=TRUE); ids <- <the N adopted resource ids>; sum(vapply(ids, function(i) length(declarations_decouverte_ressource(i)), 1L))"
   ```
   (the guarded proof `test-adopt-db.R` asserts `nrow(descriptors) == sum(declarations)` the same way).
4. Deploy the new API, then run the HTTP sweep over every resource in `/api/resources`.
5. Apply the contract migration (#1141) using the pre-checks, guarded rehearsal,
   backup and verification queries above, then **sweep again**. Adoption after
   049 is refused (`adoption_globale_retiree`); never reorder 049 before `adopt`.
6. `Rscript scripts/publication.R listing > live.json` -- prints the live registry as
   JSON, read-only, through the shared serving-session seam.
7. `$env:LUSK_LIVE_LISTING = "live.json"; Rscript scripts/publication.R plan <sortie>`
   -- `plan` never connects to a database (#1136); it reads that listing file and must
   report every resource `status=unchanged`.

`apply` takes the same `lock` / `registre` / connection options as `adopt`; a later
`apply` of an adopted resource replaces its comparison marker normally, and an `apply`
of a scalar cascades to its dependent profile so the scalar marker and the profile
binding move together.
