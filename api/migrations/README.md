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
4. Rehearse on a disposable PostgreSQL database restored from a recent backup.
Verify 009 succeeds on the expected clean target; separately attach a dependent
view/object and verify it fails atomically without removing the table. While
rehearsing, query active per-table readers and verify a representative
publication still updates/reads `table_publication` normally. Preserve those
reader roles and grants; never test by dropping/recreating their active tables.
5. Obtain explicit operator approval after recording rehearsal output, backup
verification, dependency inventory, and maintenance window. Run once with
`psql -X --set ON_ERROR_STOP=on --single-transaction` against the approved
database. 009 also owns its transaction and has a five-second lock timeout; use
the script as written and abort on any error.

There is intentionally no down migration. Reversal means restore the verified
backup (or explicitly recreate the relation from that backup), then restore
owner/grants and validate the active per-table publication path. The removed
historical row is not a reversible marker. No live Pi DDL is authorized by this
change; API Compose deployment remains a separate owner-controlled action.
