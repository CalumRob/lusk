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

From the checkout root on the PC, focused guarded API tests use:

```powershell
$env:PGPASSFILE = Join-Path $env:APPDATA 'PostgreSQL\pgpass.conf'
$env:LUSK_TEST_DATABASE_PREFIX = 'lusk_it_'
$env:LUSK_TEST_DATABASE_NAME = 'lusk_it_contract'
$env:LUSK_TEST_PUBLISH_DSN = 'postgresql://lusk_it_contract_pub@192.168.1.120:5432/lusk_it_contract'
$env:LUSK_TEST_READ_DSN = 'postgresql://lusk_it_contract_read@192.168.1.120:5432/lusk_it_contract'
$env:PYTHONPATH = '.'
$env:TESTTHAT_PARALLEL = 'FALSE'
$env:PGCONNECT_TIMEOUT = '5'
$env:PGOPTIONS = '-c statement_timeout=45000 -c lock_timeout=5000 -c idle_in_transaction_session_timeout=60000'
python -m pytest api/tests/integration/test_postgres_publication.py -k shared_scalar -q
```

Before running, verify both connections report `current_database() =
lusk_it_contract` and the expected test roles. Afterward, unset the
`LUSK_TEST_*` variables; do not export them globally. The Python harness
leaves its schemas for inspection by default; use its cleanup flag only when
you have reviewed its cleanup behavior and the test-only target.

The R publisher-to-PostgreSQL smokes are a separate opt-in path. The operator
must provision a permanent **test-only database on the Pi server** whose name
begins `lusk_it_`, plus dedicated publisher and read roles restricted to that
database. Do not point them at `lusk`; each script verifies the database and
role, creates a random schema, runs fresh `api/schema.sql`, grants only that
schema to the read role, and cleans up only its own schema when
`LUSK_TEST_ALLOW_SCHEMA_CLEANUP=1`. `public` and other schemas are never
changed. Do not reuse serving credentials. The Habitat and Economy proofs read
canonical producer artifacts from `LUSK_TEST_CANONICAL_DATA_DIR` but copy their
required inputs to a private temporary fixture before any materializer writes.
The Milieux proof similarly copies its selected inputs, reads the canonical
CONSOENAF source and processed OCS window read-only, and writes only in its
temporary fixture. None copies `data/raw` or runs a pipeline build.

Run from `pipeline/` on the trusted workstation after the database and role are
ready. Store credentials in a private libpq passfile (not the repository or
shell history) and set `PGPASSFILE` to its path; use a separate test role from
the serving publisher. The role name is the only credential passed in process
environment. Run each focused command from `pipeline/`; the last three calls
exercise registered selected-reading publishers through semantic HTTP:

```powershell
$env:LUSK_SCALAR_TEST_HOST = "192.168.1.120"
$env:LUSK_SCALAR_TEST_PORT = "5432"
$env:LUSK_SCALAR_TEST_DATABASE = "lusk_it_contract"
$env:LUSK_SCALAR_TEST_USER = "lusk_it_contract_pub"
$env:PGPASSFILE = Join-Path $env:APPDATA 'PostgreSQL\pgpass.conf'
$env:LUSK_SCALAR_TEST_CLEANUP = "1"
Rscript scripts/smoke-scalar-postgres.R
```

For the retained Habitat, Economy, and Milieux publisher-to-HTTP proofs, set
the shared test-only connection variables from the guarded configuration above
plus `LUSK_PROFILE_TEST_HOST`, `LUSK_PROFILE_TEST_PORT`,
`LUSK_PROFILE_TEST_DATABASE`, `LUSK_PROFILE_TEST_USER`, and
`LUSK_TEST_READ_USER`. Set `LUSK_TEST_CANONICAL_DATA_DIR` to the read-only
canonical artifact directory. Milieux additionally requires
`LUSK_MILIEUX_CONSO_SOURCE` and `LUSK_MILIEUX_PROCESSED_WINDOW` pointing to the
existing source snapshot and processed OCS window; those paths are inputs only.
Use `PGPASSFILE` for the private passfile and process-scoped libpq timeouts.
The scripts create isolated writable fixture directories and random guarded
schemas; do not pass a canonical source directory as a publisher output.

```powershell
$env:LUSK_PROFILE_TEST_HOST = '192.168.1.120'
$env:LUSK_PROFILE_TEST_PORT = '5432'
$env:LUSK_PROFILE_TEST_DATABASE = 'lusk_it_contract'
$env:LUSK_PROFILE_TEST_USER = 'lusk_it_contract_pub'
$env:LUSK_TEST_READ_USER = 'lusk_it_contract_read'
$env:LUSK_TEST_CANONICAL_DATA_DIR = 'E:\Lusk\public\data'
$env:LUSK_MILIEUX_CONSO_SOURCE = 'E:\Lusk\pipeline\data\raw\conso-com.csv'
$env:LUSK_MILIEUX_PROCESSED_WINDOW = 'E:\Lusk\pipeline\data\processed\milieux\ocsge_communes.rds'
$env:PGPASSFILE = Join-Path $env:APPDATA 'PostgreSQL\pgpass.conf'
$env:PGCONNECT_TIMEOUT = '5'
$env:PGOPTIONS = '-c statement_timeout=45000 -c lock_timeout=5000 -c idle_in_transaction_session_timeout=60000'
$env:TESTTHAT_PARALLEL = 'FALSE'
$env:LUSK_TEST_ALLOW_SCHEMA_CLEANUP = '1'
Rscript scripts/smoke-habitat-reading-postgres.R
Rscript scripts/smoke-housing-economy-postgres.R
Rscript scripts/smoke-milieux-reading-postgres.R
```

These proofs compare semantic HTTP payloads to canonical producer records,
assert owner/source bindings and sparse Milieux absence evidence, and exercise
no-op, rollback, and fail-closed publication behavior. They do not call retired
theme/comparison routes or seed expected typed-reading rows directly in SQL.

The scalar smoke retains its random schema by default. It drops only its own
schema when `LUSK_SCALAR_TEST_CLEANUP=1`; inspect ownership before manual cleanup.
It checks canonical fact/status, descriptor and versions, source associations,
no-op behavior, dependency-only marker rebinding, DB-behind-local retry, and
transaction rollback after an injected insert failure.

The comparison-lineage checkpoint has a synthetic publisher-to-API-reader
test. It invokes the real R publishers and PostgreSQL adapters for scalar,
declared-profile, ordered-series, and numeric period/detail collection
comparisons, then reads them through the API using the dedicated read role.
It checks source/vintage parity (including mixed collection vintages), no-op
publication, stale/truncated fail-closed behavior, and rollback/retry after an
injected collection-lineage write failure. It needs no canonical artifact
directory or pipeline data:

```powershell
$env:PGPASSFILE = Join-Path $env:APPDATA 'PostgreSQL\pgpass.conf'
$env:LUSK_TEST_DATABASE_PREFIX = 'lusk_it_'
$env:LUSK_TEST_DATABASE_NAME = 'lusk_it_contract'
$env:LUSK_TEST_PUBLISH_DSN = 'postgresql://lusk_it_contract_pub@192.168.1.120:5432/lusk_it_contract'
$env:LUSK_TEST_READ_DSN = 'postgresql://lusk_it_contract_read@192.168.1.120:5432/lusk_it_contract'
$env:LUSK_TEST_ALLOW_SCHEMA_CLEANUP = '1'
$env:PYTHONPATH = '.'
python -m pytest api/tests/integration/test_postgres_publication.py -k synthetic_r_comparison_lineage_publish_to_api_reader -q
```

The test creates and cleans up only its own random `it_*` schema. It does not
modify the retained benchmark schema or publish to the serving database.

The same selector runs `fresh`, `populated_upgrade`, and `bases_absent_upgrade`
cases. `populated_upgrade` reconstructs all twelve comparison result/marker
tables and the old collection publication contracts from the pinned
pre-lineage Git schema at `d5832fca`, preserving the real synthetic publisher's
numerical rows. It then executes 033, 034 and 035 in order, checks that the old
rows survive but each family fails closed until republished, and invokes all
four real R adapters with the same saved synthetic inputs. Responses must match
the fresh publication exactly; a second unchanged invocation must preserve
publication markers, including their timestamps.

`bases_absent_upgrade` models the #806 serving shape: after the same synthetic
publication it removes only the scalar and ordered-series base relations,
their 033/034 lineage relations, and the profile lineage column. It verifies
that the missing scalar/ordered families return 503 (not 500 or stale data)
while the untouched numeric-collection publication still returns 200, applies
**039 -> 033 -> 034**, confirms facts, descriptors, sources and unrelated
markers survive, and then republishes through the real R adapters twice.
039 must run before 033/034 because it creates the pre-lineage bases those
migrations alter; 033/034 must not be run again for a family 039 reports as
current.

The focused `test_migration_039_comparison_base_upgrade_states_and_fresh_equivalence`
covers the per-family absent/present/current/partial states directly. It
rehearses populated pre-lineage facts, exact pre-lineage and current no-ops,
transactional rejection of mixed/partial shapes, and compares the
039 -> 033 -> 034 structural contract (columns, constraints, indexes, grants,
triggers and owned functions) with a fresh `schema.sql` install. The only
normalized differences are the documented nullable lineage-count sentinel and
the retained 034 zero-reason foreign-key shape described in
[`migrations/README.md`](../../migrations/README.md#migration-039--restore-scalar-and-ordered-series-comparison-bases).
`test_migration_039_rejects_broken_contract_without_mutation` separately breaks
present/current PKs, FK targets/actions, CHECKs, defaults, a unique index,
triggers, lineage constraints, and required grants. Each case asserts that 039
fails and leaves both fact/marker rows and the complete relation catalog
unchanged. Run the focused migration tests serially with:

```powershell
python -m pytest api/tests/integration/test_postgres_publication.py -k test_migration_039 -q
```

The read-only pre/post operator inventory and its required state checks are
documented in [`migrations/README.md`](../../migrations/README.md#migration-039--restore-scalar-and-ordered-series-comparison-bases).
This is a populated comparison-storage upgrade rehearsal, not a
restored production-database or deployed-API rehearsal. The pinned Git object
must be available locally; no network fetch or pipeline data is needed.

## Current retained model and migration selectors

Migration 036 is the guarded populated-schema retirement rehearsal. Migration
039 is the scalar/ordered-series comparison base repair and follows the
dependency order **030 -> 039 -> 033 -> 034**. Migration 037 is applied and
exercised by the exhaustive AEDAR publisher-to-HTTP proof; it has no standalone
fast selector. Do not confuse these current selectors with the historical
migration 009 procedure retained in
[`migrations/README.md`](../../migrations/README.md).

```powershell
# From repository root; use the guarded DSNs above.
python -m pytest api/tests/integration/test_postgres_publication.py -k test_migration_036 -q
python -m pytest api/tests/integration/test_postgres_publication.py -k test_migration_039 -q
python -m pytest "api/tests/integration/test_postgres_publication.py::test_synthetic_r_comparison_lineage_publish_to_api_reader[bases_absent_upgrade]" -q

# Migration 037 is part of this comprehensive AEDAR proof (about 8 minutes).
# Do not run it as part of quick harness iteration.
python -m pytest api/tests/integration/test_aedar_publisher_http.py -k test_aedar_r_publication_is_read_through_bounded_http -q

# Ordinary API suite is not DB proof; report its guarded skips separately.
python -m pytest api/tests -q

# From pipeline/; serial default fixture suite, or the focused latest typed readers.
$env:TESTTHAT_PARALLEL = 'FALSE'
Rscript -e "testthat::test_local(filter='publish-series|publish-typed-reading-artifact', stop_on_failure=TRUE)"
Rscript -e "testthat::test_local(stop_on_failure=TRUE)"
```

The current retained publisher proofs are the Habitat, Economy, and Milieux
scripts above, each using a private copied writable fixture and a guarded random schema.
The ordinary suite and focused R test counts do not substitute for those
publisher-to-database-to-HTTP proofs. Do not run the full AEDAR proof while
iterating on unrelated harnesses; cite its pinned run and duration when reporting
acceptance.
