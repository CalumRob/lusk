# Migration 016: bounded BPE profile evidence

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

The OCS-GE publisher requires canonical `indicateurs_milieux.parquet` to carry
producer-emitted `state_role` and `source_components` columns. A stale artifact
is rejected before the smoke script opens its disposable schema; do not
reconstruct lineage by parsing `periode_artif`. Regenerate artifacts through the
normal pipeline using its own data copy, then run focused fixtures and the
documented slow byte-identical targets parity audit before treating the producer
change as campaign-ready. A worktree without `pipeline/data/raw` cannot perform
the final real-artifact/API rehearsal.

# Migration 009 operator procedure

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
