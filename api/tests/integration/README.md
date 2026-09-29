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

The current PostgreSQL integration tests exercise database-backed serving,
publication contracts, and guarded migration rehearsals against an explicitly
provided disposable database. They do not invoke the retired Python importer or
read production artifacts. The `legacy_*.sql` files below are historical schema
references; the current suite does not rehearse those importer-era layouts.

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

The building publisher path has a separate RPostgres smoke so it exercises the
real `.adapter_postgres` and `publier_tables_postgres` code rather than a fake
adapter. It uses only synthetic canonical-like rows, accepts only explicit
`LUSK_BUILDING_TEST_*` connection variables naming a `lusk_it_*` database, and
uses a private passfile outside the checkout. It creates a random schema, runs
the final `api/schema.sql`, then dependency-orders table/function drops and
`DROP SCHEMA ... RESTRICT` for cleanup; it never uses `CASCADE` or touches
`public`.

```powershell
$env:LUSK_BUILDING_TEST_HOST = "192.168.1.120"
$env:LUSK_BUILDING_TEST_PORT = "5432"
$env:LUSK_BUILDING_TEST_DATABASE = "lusk_it_contract"
$env:LUSK_BUILDING_TEST_USER = "lusk_it_contract_pub"
$env:LUSK_BUILDING_TEST_PGPASSFILE = Join-Path $env:APPDATA 'PostgreSQL\pgpass.conf'
Rscript scripts/smoke-building-postgres.R  # run from pipeline/
```

This verifies actual R/DBI parameter and JSON serialization, descriptor/source
lineage and independent markers, grid ordinal mapping, no-op republish,
DB-behind retry, and rollback of facts/descriptors/markers after injected
replacement failure. It uses no pipeline raw/processed data.

The shared-scalar migration/read tests are selected with `-k shared_scalar`.
Run the guarded migration rehearsal with `-k migration_009`; the configured
publisher and reader DSNs must both target `lusk_it_contract`. The test creates
and cleans up a random `it_*` schema only. After the actual retirement script,
it simulates a supported per-table fact/marker transaction in that schema and
checks the read-only role sees its committed update; this is schema-level
contract evidence, not a run of the R publisher. The operator must still perform
the separate restored-database rehearsal and approval in
`api/migrations/README.md` before any live migration.
