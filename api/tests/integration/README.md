# Opt-in PostgreSQL integration verification

These tests are **read-only by default**: with no configuration they skip
without importing psycopg or opening a connection. They never use `DATABASE_URL`
or `PUBLISH_DATABASE_URL` and never guess that `lusk` is safe.

## Test database guard

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

`test_building_evidence_contract.py` uses that same explicit test-only database
and creates its own random `it_building_*` schema per fresh-schema and prior
shared-schema/migration-008 rehearsal. It checks valid ramp/grid fixture
publications, rejected source/level/axis/quantile/availability mutations,
deferred descriptor/source marker constraints, and rollback preservation of
the previous facts and markers after an injected mid-refresh failure. A
dedicated local database can be named `lusk_it_contract`; do not point these
tests at the live `lusk` database. The migration's `NOT VALID` source-vintage
foreign keys leave pre-migration rows readable and enforce new/updated rows;
operators must backfill/verify source vintages and run the documented
`VALIDATE CONSTRAINT` statements before claiming historical rows are validated.

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
database. `legacy_initial_schema.sql` is the frozen four-table schema actually
deployed on the Pi; `legacy_schema.sql` is the later six-table schema committed
before the single-dataset redesign. Both variants are tested. The test checks
that a partial/unknown schema or unexpected dependent object aborts the whole
migration, an unrelated table survives, and canonical Parquet can repopulate
the new tables. The live `lusk` schema is never involved.

No external database is touched during ordinary development/test runs. The
integrator must inspect the DSNs and disposable target before opting in.

## Persistent Pi test-only database and R publisher smoke

The operator-owned integration target is PostgreSQL on the Pi at
`192.168.1.120:5432`, in **`lusk_it_contract`**, not the serving database
`lusk`. Its test-only roles are `lusk_it_contract_pub` (database owner; creates
isolated schemas) and `lusk_it_contract_read` (CONNECT only until a test grants
SELECT on its own schema). These roles must not have access to serving data.
The database persists between runs; **test schemas are disposable**, uniquely
named, and never created in `public`. Do not drop the database after each run.

Credentials are **not in this repository**. On the publishing PC, libpq reads
exact-host entries for these two roles and `lusk_it_contract` from the private
`%APPDATA%\PostgreSQL\pgpass.conf`. Keep that file private to the operator;
never print, commit, or pass its contents to workers. Set `PGPASSFILE` to that
path in the test process. A password once shared in chat for the old disposable
`lusk_it_594` database must not be reused for this persistent target. Future
workers should request that the operator provision or confirm access rather
than guessing credentials or using production roles.

From the checkout root on the PC, the **focused SQL/API tests** use:

```powershell
$env:PGPASSFILE = Join-Path $env:APPDATA 'PostgreSQL\pgpass.conf'
$env:LUSK_TEST_DATABASE_PREFIX = 'lusk_it_'
$env:LUSK_TEST_DATABASE_NAME = 'lusk_it_contract'
$env:LUSK_TEST_PUBLISH_DSN = 'postgresql://lusk_it_contract_pub@192.168.1.120:5432/lusk_it_contract'
$env:LUSK_TEST_READ_DSN = 'postgresql://lusk_it_contract_read@192.168.1.120:5432/lusk_it_contract'
$env:PYTHONPATH = '.'
python -m pytest api/tests/integration/test_postgres_publication.py -k shared_scalar -q
```

Before running, verify both connections report `current_database() =
lusk_it_contract` and the expected test roles. Afterward, unset the
`LUSK_TEST_*` variables; do not export them globally. The Python harness
leaves its schemas for inspection by default; use its cleanup flag only when
you have reviewed its cleanup behavior and the test-only target.

The R publisher-to-PostgreSQL smoke is a separate opt-in path; it does not use
production configuration, product data, `data/raw`, or `data/processed`. The
operator must provision a permanent **test-only database on the Pi server**
whose name begins `lusk_it_`, plus a dedicated login role with `CONNECT` and
`CREATE` on that database only. Do not point it at `lusk`; the script refuses
names outside the `lusk_it_*` pattern and creates its own random schema. It
executes fresh `api/schema.sql` in that schema, publishes the tiny canonical
fixture through `scalar_postgres_adapter`, and drops only that schema (without
`CASCADE`) when explicit cleanup is enabled. `public` and other schemas are
never changed. Do not grant the test role access to serving objects or reuse
serving credentials. Rotate any credentials previously shared for disposable
testing before provisioning this permanent target.

Run from `pipeline/` on the trusted workstation after the database and role are
ready. Store credentials in a private libpq passfile (not the repository or
shell history) and set `PGPASSFILE` to its path; use a separate test role from
the serving publisher. The role name is the only credential passed in process
environment:

```powershell
$env:LUSK_SCALAR_TEST_HOST = "192.168.1.120"
$env:LUSK_SCALAR_TEST_PORT = "5432"
$env:LUSK_SCALAR_TEST_DATABASE = "lusk_it_contract"
$env:LUSK_SCALAR_TEST_USER = "lusk_it_contract_pub"
$env:PGPASSFILE = Join-Path $env:APPDATA 'PostgreSQL\pgpass.conf'
$env:LUSK_SCALAR_TEST_CLEANUP = "1"
Rscript scripts/smoke-scalar-postgres.R
```

The test leaves its random schema for inspection by default. After review,
remove only the printed `scalar_it_*` schema manually, or explicitly set
`LUSK_SCALAR_TEST_CLEANUP=1` to have the script drop its own schema. Assign an
operator-owned TTL (recommended: 14 days) to abandoned `scalar_it_*` schemas;
inspect ownership and contents before cleanup. Never automate database drops.
The smoke checks canonical fact/status, descriptor and versions, two source
associations (the second is explicitly synthetic smoke lineage), no-op behavior,
dependency-only marker rebinding, DB-behind-local retry, and transaction rollback
after an injected insert failure.

The shared-scalar migration/read tests are selected with
`-k shared_scalar`. Several older importer integration cases in this module
still assert the retired `dataset_publication` fixture even though the current
fresh schema uses independent `table_publication` markers and intentionally
rejects the legacy importer. Do not make the legacy importer writable again to
green those tests. Their fixture isolation/rehearsal needs a separate follow-up;
the scalar tests use the current schema and disposable namespace described
above.
