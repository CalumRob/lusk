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
tables, or `table_publication`; the ENAF legacy reader remains the compatibility
path until a separate serial operator-approved API cutover. `schema.sql` carries
the same objects for fresh installs. Apply/test order is after 007/008/010; 009
is unrelated and must not be applied to this worktree/database by the worker.

The focused `pipeline/scripts/smoke-series-postgres.R` rehearses both fresh-schema
parity and migration 011 in a random owned schema in `lusk_it_contract` (the
script splits the fresh schema at the owned-series boundary, applies 011, then
publishes canonical ENAF and OCS-GE projections). It checks independent markers,
facts, descriptors and provenance across updates, immutable provenance revision
corrections, rollback, no-op, and reader write denial. It never touches `public`
or a serving database. Production migration,
API deployment and either Vite flag are separate serial operator gates.

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
