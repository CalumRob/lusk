# PostgreSQL migration history

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
publishes all 1,268 canonical Parquet rows and verifies commune/EPCI HTTP output
against the incumbent `histoires_demographie.json`. No serving database is
 modified by this worker migration rehearsal.

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

039 classifies each family independently:

- `absent`: no base relations. 039 creates the pre-lineage contract. Run the
  corresponding lineage migration next (033 for scalar, 034 for ordered series).
- `present`: all three base relations with the exact pre-lineage columns. 039
  is a structural no-op and grants the contract privileges. Run the
  corresponding lineage migration next.
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

The guarded upgrade proof starts from the pinned pre-lineage schema with real
synthetic facts and markers, removes only the comparison storage, applies
039 -> 033 -> 034, verifies facts/markers survive, exercises the R publisher and
API readback, checks missing publications return 503 rather than 500 or stale
data, and compares the resulting structural contract with a fresh `schema.sql`
install. It also covers the current-state no-op, absent/present shapes, and
transactional rejection of incompatible partial states. Fresh installs continue
to use `schema.sql`. This migration does not publish data or authorize
deployment.
