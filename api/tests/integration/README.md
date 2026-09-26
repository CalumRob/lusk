# Opt-in PostgreSQL integration verification

These tests are **read-only by default**: with no configuration they skip
without importing psycopg or opening a connection. They never use `DATABASE_URL`
or `PUBLISH_DATABASE_URL` and never guess that `lusk` is safe.

## Disposable database guard

Provide both explicit DSNs plus the exact database name and prefix `lusk_it_`.
Both DSNs must name that same explicitly specified host/port and database; role
names must differ. The exact database name must begin with `lusk_it_`; production
and PostgreSQL template database names are explicitly refused. Use a dedicated disposable database,
not a schema in a live application database. Example PowerShell values (replace
the local-only credentials and names; do not save credentials in the repo):

```powershell
$env:LUSK_TEST_DATABASE_PREFIX = "lusk_it_"
$env:LUSK_TEST_DATABASE_NAME = "lusk_it_local"
$env:LUSK_TEST_PUBLISH_DSN = "postgresql://lusk_it_publisher:...@localhost:5432/lusk_it_local"
$env:LUSK_TEST_READ_DSN = "postgresql://lusk_it_reader:...@localhost:5432/lusk_it_local"
```

The publisher role must be allowed to create a schema in that disposable
database. Each invocation creates a random, private schema and applies the
current `api/schema.sql` there. It grants only `USAGE` on that schema and `SELECT`
on its tables to the configured read role. The read-role test verifies an
`INSERT` is denied. Do not grant the test roles access to production data.

```powershell
python -m pytest api/tests/integration -m integration
```

By default the uniquely named schema is retained for inspection. To explicitly
allow cleanup of only that run's schema, set
`LUSK_TEST_ALLOW_SCHEMA_CLEANUP=1`. Cleanup never targets `public`, tables, or
another schema. Unset all `LUSK_TEST_*` variables after verification.

The fixture writes tiny canonical Parquet artifacts and a matching
pipeline-shaped metadata descriptor locally in pytest's temporary directory;
it does not read production artifacts. Checks run the importer and public HTTP
API seam against PostgreSQL, including rank, median, scope and provenance. Any
query timing (if added later) is strictly local to this explicitly provided test
database and is not a Pi or deployment performance claim.

The migration rehearsal uses a *second* unique test schema in the same disposable
database. `legacy_schema.sql` is a frozen copy of the schema deployed before the
single-dataset redesign. The test checks that an unexpected dependent object
aborts the whole migration, an unrelated table survives, and canonical Parquet
can repopulate the new tables. The live `lusk` schema is never involved.

No external database is touched during ordinary development/test runs. The
integrator must inspect the DSNs and disposable target before opting in.
