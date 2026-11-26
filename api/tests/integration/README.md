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

## Passfiles and server access

Layout on the owner's PC since 2026-11-25:

| File | Holds | Who points `PGPASSFILE` at it |
|---|---|---|
| `%APPDATA%\PostgreSQL\pgpass.conf` (libpq default) | only `lusk_it_contract:lusk_it_contract_pub` and `lusk_it_contract:lusk_it_contract_read` | guarded test runs (orchestrator, and workers when authorised) |
| `%APPDATA%\PostgreSQL\pgpass-prod.conf` | only `lusk:lusk_publisher` | the owner, process-scoped, for owner-only operations |

Because libpq falls back to the default file when `PGPASSFILE` is unset, a mistaken
connection to `lusk` finds no password. For owner-only work on the serving database,
in that window only:

```powershell
$env:PGPASSFILE = Join-Path $env:APPDATA 'PostgreSQL\pgpass-prod.conf'
```

Never persist `PGPASSFILE` as a user or machine variable, never add a `lusk` line to
the default file, and never let an agent set `PGPASSFILE` to `pgpass-prod.conf` or read it.
Both files sit under the owner's Windows profile, so processes running as that identity
can technically read them. The split guards against mistakes; it does not isolate
the owner from agents.

Server side (PostgreSQL in Docker on the Pi): the test roles must have no `CONNECT` on
`lusk`. As the container's superuser (`sudo docker ps` to find the container, then
`sudo docker exec -it <container> psql -U postgres -d lusk`), list the roles that use `lusk`
(`SELECT DISTINCT grantee FROM information_schema.role_table_grants WHERE table_schema='public';`
and `SELECT DISTINCT usename FROM pg_stat_activity WHERE datname='lusk';`), then run
`REVOKE CONNECT ON DATABASE lusk FROM PUBLIC;` and
`GRANT CONNECT ON DATABASE lusk TO lusk_publisher, lusk_reader;`, adding any other serving role
those queries showed. Superusers are unaffected. Roll back with `GRANT CONNECT ON DATABASE lusk TO PUBLIC;`.
Verify read-only from `lusk_it_contract`:
`SELECT has_database_privilege('lusk_it_contract_pub','lusk','CONNECT')` and the same for
`lusk_it_contract_read` must both be `false`. Applied and verified 2026-11-25 (PostgreSQL 18
container `lusk-db-postgres-1`; `\l lusk` shows `=T/postgres`, `lusk_reader=c`, `lusk_publisher=c`;
both checks `false`; site unaffected).

`lusk_it_contract` is for pre-publication proofs, **not persistent storage** (owner,
2026-11-25). Any `it_*` schema in it, including ones a proof "retains for inspection", is
disposable and may be dropped at any time; never rely on one surviving between sessions. On
2026-11-25 all 78 accumulated `it_*` schemas were dropped (166 MB left).

Known residual risk: `lusk_it_contract_pub` owns `lusk_it_contract`, so a faulty test could
drop the database. Only test data is at stake.

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
$env:LUSK_TEST_ALLOW_SCHEMA_CLEANUP = '1'
python -m pytest api/tests/integration/test_postgres_publication.py -k shared_scalar -q
```

Before running, verify both connections report `current_database() =
lusk_it_contract` and the expected test roles. Afterward, unset the
`LUSK_TEST_*` variables; do not export them globally. Without the opt-in, most
Python fixtures retain their schemas for inspection. With
`LUSK_TEST_ALLOW_SCHEMA_CLEANUP=1`, supported fixtures drop only schemas created
by that invocation; proofs explicitly designated retained refuse the flag.
Review the selected test and exact cleanup path before enabling it.

### Shared v2 publication-outcome proof (#984)

The v2 outcome proof is a focused, non-retained guarded suite. It acquires the
Windows named mutex `Local\LuskIntegrationContractDb` before its first
connection, keeps it for the whole test process including cleanup/verification,
and releases it last. Do not point another worker at `lusk_it_contract` while it
holds the lock. The proof creates one random `it_outcome_*` schema, seeds only
its own families, and always drops that schema in `finally`; it fails before the
unlock if its own schema or any schema introduced by the run remains, or if a
`public` relation remains, and prints the database byte size/schema state before
and after. On a clean serialized target this verifies zero user schemas; a
sibling's pre-existing schema is reported but never dropped by this fixture. It
is not a retained benchmark fixture.

The suite proves mixed and all-unavailable envelopes across scalar, profile,
owned series, named reference, typed reading, collection, comparison and AEDAR;
three actual refuelling scalar keys exercise facts/fixed/selected absence;
unchanged values/ranks/units/clocks/provenance; item correlation and one
repeatable-read snapshot; v2 identity admission (unknown target/member with an
unpublished resource still rejects the whole request); hard `404`/`422`
member/malformed failures; global clock/provenance and SQL/service faults
rejecting the whole request; the v1 atomic bridge; and the executor's
work/byte bounds (ordinary unit tests). The run refuses before its first
connection/DDL unless `LUSK_TEST_ALLOW_SCHEMA_CLEANUP=1`; ordinary collection
without test DSNs skips normally. Use the documented guarded DSNs, dedicated
roles and private `PGPASSFILE`:

```powershell
$env:PGPASSFILE = Join-Path $env:APPDATA 'PostgreSQL\pgpass.conf'
$env:LUSK_TEST_DATABASE_PREFIX = 'lusk_it_'
$env:LUSK_TEST_DATABASE_NAME = 'lusk_it_contract'
$env:LUSK_TEST_PUBLISH_DSN = 'postgresql://lusk_it_contract_pub@192.168.1.120:5432/lusk_it_contract'
$env:LUSK_TEST_READ_DSN = 'postgresql://lusk_it_contract_read@192.168.1.120:5432/lusk_it_contract'
$env:PYTHONPATH = '.'
$env:PGCONNECT_TIMEOUT = '5'
$env:PGOPTIONS = '-c statement_timeout=45000 -c lock_timeout=5000 -c idle_in_transaction_session_timeout=60000'
$env:LUSK_TEST_ALLOW_SCHEMA_CLEANUP = '1'
python -m pytest api/tests/integration/test_publication_outcome_http.py -q -s
```

Before the run, verify both connections report `current_database() =
lusk_it_contract` and the expected roles; the suite does this itself before any
DDL. If the process dies before cleanup, remove only its own `it_outcome_*`
schemas under the same mutex, then verify zero user schemas and zero `public`
relations. Do not run retained #814/lineage smokes as part of this cleanup
regime.

### Selected-profile equal-weight mean proof (#996, owner #979)

The focused mean proof is a non-retained guarded suite. It acquires the same
`Local\LuskIntegrationContractDb` mutex before its first connection, waits (up to
10 minutes) for the concurrent pipeline publisher worker instead of colliding
with it, and holds the lock through cleanup and verification. Without the
guarded `LUSK_TEST_*` DSNs the whole module skips, so ordinary collection never
waits on the operator database. With the DSNs present it refuses before its
first connection/DDL unless `LUSK_TEST_ALLOW_SCHEMA_CLEANUP=1`, requires the
database to be empty before the run, creates one random `it_mean_*` schema,
seeds only its own declared profiles, and always drops that schema in `finally`.
It fails before the unlock unless zero user schemas and zero `public` relations
remain, and prints the database byte size/schema state before and after. Proofs
are never retained.

```powershell
$env:PGPASSFILE = Join-Path $env:APPDATA 'PostgreSQL\pgpass.conf'
$env:LUSK_TEST_DATABASE_PREFIX = 'lusk_it_'
$env:LUSK_TEST_DATABASE_NAME = 'lusk_it_contract'
$env:LUSK_TEST_PUBLISH_DSN = 'postgresql://lusk_it_contract_pub@192.168.1.120:5432/lusk_it_contract'
$env:LUSK_TEST_READ_DSN = 'postgresql://lusk_it_contract_read@192.168.1.120:5432/lusk_it_contract'
$env:PYTHONPATH = '.'
$env:PGCONNECT_TIMEOUT = '5'
$env:PGOPTIONS = '-c statement_timeout=45000 -c lock_timeout=5000 -c idle_in_transaction_session_timeout=60000'
$env:LUSK_TEST_ALLOW_SCHEMA_CLEANUP = '1'
python -m pytest api/tests/integration/test_selected_profile_mean_http.py -q -s
```

The suite proves the equal-weight arithmetic over actual measured peers (mean and
median differ, a measured zero stays eligible, a missing cell is never zeroed),
the identical `eligible_members` population behind an additive
total/protected/shared stack and raw/per-capita units, equal counts with
different identities (honest non-population evidence), empty/one/missing
selections and a focal outside the selection, served rank/ties,
profile/reference clocks and source lineage, single/v2 batch parity, typed
publication-absent outcomes, `422` statistic/field combinations, and the shared
work bound. It does not publish fixed mean rows, change schema, run R/pipeline
work or touch the serving database.

The R publisher-to-PostgreSQL smokes are a separate opt-in path. The operator
must provision a permanent **test-only database on the Pi server** whose name
begins `lusk_it_`, plus dedicated publisher and read roles restricted to that
database. Do not point them at `lusk`; each script verifies the database and
role, creates a random schema, runs fresh `api/schema.sql`, grants only that
schema to the read role, and cleans up only its own schema when
`LUSK_TEST_ALLOW_SCHEMA_CLEANUP=1`. `public` and other schemas are never
changed. Do not reuse serving credentials. The Habitat, Economy and Milieux
proofs read current producer-owned scalar/profile/series/typed-reading
generations from `LUSK_TEST_CANONICAL_DATA_DIR`, including the required current
pointers, manifests, provenance and dependency companions. Stage complete
validated generations in the private test fixture; the retired numerical
`indicateurs_*.json` / `histoires_*.json` browser exports are not inputs. Milieux
source-absence evidence remains a separate source-owned input. Programme proofs
use their canonical membership/grant Parquets and existing R projectors for
temporary test expectations. These paths do not copy `data/raw`, reconstruct
from browser JSON, or run a pipeline build.

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

The AEDAR producer-to-public-HTTP proof is a single-schema run and requires the
cleanup opt-in. It records a sanitized run receipt under its own
`E:\Temp\opencode\aedar-it-*` directory, then drops only its generated
`it_aedar_<uuid>` schema in `finally` (including after assertion failures). A
failed drop is recorded in the receipt; do not use a broad schema janitor.
Set `R_LIBS_USER` to the populated project library reported by `.libPaths()[1]`
when running `Rscript` from `pipeline/`, then run only this focused command:

```powershell
$env:PGPASSFILE = Join-Path $env:APPDATA 'PostgreSQL\pgpass.conf'
$env:LUSK_TEST_DATABASE_PREFIX = 'lusk_it_'
$env:LUSK_TEST_DATABASE_NAME = 'lusk_it_contract'
$env:LUSK_TEST_PUBLISH_DSN = 'postgresql://lusk_it_contract_pub@192.168.1.120:5432/lusk_it_contract'
$env:LUSK_TEST_READ_DSN = 'postgresql://lusk_it_contract_read@192.168.1.120:5432/lusk_it_contract'
$env:LUSK_TEST_READ_USER = 'lusk_it_contract_read'
$env:LUSK_TEST_ALLOW_SCHEMA_CLEANUP = '1'
$env:PYTHONPATH = '.'
$env:TESTTHAT_PARALLEL = 'FALSE'
$env:PGCONNECT_TIMEOUT = '5'
$env:PGOPTIONS = '-c statement_timeout=45000 -c lock_timeout=5000 -c idle_in_transaction_session_timeout=60000'
python -m pytest api/tests/integration/test_aedar_publisher_http.py -q -s
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
publication, stale/truncated fail-closed behavior, rollback of a changed source
label when the collection's immutable vintage clock conflicts, and rollback/retry
after an injected collection-lineage write failure. It needs no canonical artifact
directory or pipeline data:

```powershell
$env:PGPASSFILE = Join-Path $env:APPDATA 'PostgreSQL\pgpass.conf'
$env:LUSK_TEST_DATABASE_PREFIX = 'lusk_it_'
$env:LUSK_TEST_DATABASE_NAME = 'lusk_it_contract'
$env:LUSK_TEST_PUBLISH_DSN = 'postgresql://lusk_it_contract_pub@192.168.1.120:5432/lusk_it_contract'
$env:LUSK_TEST_READ_DSN = 'postgresql://lusk_it_contract_read@192.168.1.120:5432/lusk_it_contract'
# Set this to an existing, populated R library provisioned for this machine.
# No renv restore/install is performed by the guarded proof.
$env:R_LIBS_USER = $env:LUSK_TEST_R_LIBS_USER
if (-not $env:R_LIBS_USER -or -not (Test-Path $env:R_LIBS_USER -PathType Container)) {
  throw 'Set LUSK_TEST_R_LIBS_USER to an existing populated R library before running the proof.'
}
Remove-Item Env:LUSK_TEST_ALLOW_SCHEMA_CLEANUP -ErrorAction SilentlyContinue
$env:PYTHONPATH = '.'
python -m pytest api/tests/integration/test_postgres_publication.py -k synthetic_r_comparison_lineage_publish_to_api_reader -q
```

The test creates a random `it_*` schema and always retains that schema and its
evidence; `LUSK_TEST_ALLOW_SCHEMA_CLEANUP=1` is rejected before connection or
DDL. It does not modify the retained benchmark schema or publish to the serving
database. Evidence is written under `LUSK_TEST_EVIDENCE_DIR` when configured;
otherwise it uses a pytest temporary directory.

This retention rule is scoped to the #814 proof's `retained_canonical_db_env`.
Unrelated tests using the generic `canonical_db_env` keep the documented
cleanup opt-in: their schemas are retained by default and dropped only when
`LUSK_TEST_ALLOW_SCHEMA_CLEANUP=1` is explicitly set.

The focused vintage-clock rollback regression can be run without replaying the
full publisher proof by setting `LUSK_LINEAGE_TEST_SCHEMA` to an existing,
populated retained `it_*` schema, then selecting only:

```powershell
python -m pytest api/tests/integration/test_postgres_publication.py -k test_collection_vintage_conflict_rolls_back_label_and_full_schema_snapshot -q
```

It attempts a changed collection label and facts with an incompatible vintage
version/date, expects the exact immutable-vintage conflict, and compares every
base-table row in the retained schema before and after. The failed publication
must leave the full SQL snapshot unchanged.

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

### Littoral reference migration proof (#1041)

The focused, non-retained migration rehearsal upgrades a populated pre-043
`territory_reference` and compares it with a fresh `api/schema.sql` install. It
holds `Local\LuskIntegrationContractDb` for the whole process, requires the
documented cleanup opt-in, creates only its own random schemas, and always
drops them in `finally`. Without the guarded `LUSK_TEST_*` DSNs the module
skips. It proves existing rows/markers survive, old rows keep NULL/NULL, both
column sets and the closed CHECK agree, and invalid classifications fail.

The companion real-adapter proof is
`test_littoral_reference_publisher.py`: it applies a fresh `api/schema.sql` in
one random schema, runs `pipeline/scripts/smoke-littoral-reference.R` against a
small synthetic classified reference (valid publish, marker, no-op,
ON CONFLICT update, rollback of an invalid classification), verifies values
externally, and drops only its own schema. It does not need any
scalar/profile serving artifact.

```powershell
$env:PGPASSFILE = Join-Path $env:APPDATA 'PostgreSQL\pgpass.conf'
$env:LUSK_TEST_DATABASE_PREFIX = 'lusk_it_'
$env:LUSK_TEST_DATABASE_NAME = 'lusk_it_contract'
$env:LUSK_TEST_PUBLISH_DSN = 'postgresql://lusk_it_contract_pub@192.168.1.120:5432/lusk_it_contract'
$env:LUSK_TEST_READ_DSN = 'postgresql://lusk_it_contract_read@192.168.1.120:5432/lusk_it_contract'
$env:PYTHONPATH = '.'
$env:PGCONNECT_TIMEOUT = '5'
$env:PGOPTIONS = '-c statement_timeout=45000 -c lock_timeout=5000 -c idle_in_transaction_session_timeout=60000'
$env:LUSK_TEST_ALLOW_SCHEMA_CLEANUP = '1'
python -m pytest api/tests/integration/test_littoral_reference_migration.py -q
python -m pytest api/tests/integration/test_littoral_reference_publisher.py -q
```

### AEDAR littoral sibling migration proof (#1043)

The focused, non-retained migration rehearsal
`api/tests/integration/test_aedar_littoral_migration.py` applies a fresh
`api/schema.sql` in an own random `it_littoral_aedar_*` schema and proves: an
existing complete pre-extension AEDAR generation (zero littoral groups and
counters) still commits; an incomplete littoral generation is rejected with a
named reason; a complete C/NC generation commits in the SIBLING summary table
with density counters still correct and no C/NC inserted into the density
summary; and replaying migration 045 on a current schema leaves the AEDAR
catalog structurally unchanged with both widened CHECKs present. It holds the
shared mutex for the whole process, verifies both dedicated roles and the exact
`lusk_it_contract` database before any DDL, and drops only its own schemas in
`finally`. Without the guarded `LUSK_TEST_*` DSNs it skips.

```powershell
$env:PGPASSFILE = Join-Path $env:APPDATA 'PostgreSQL\pgpass.conf'
$env:LUSK_TEST_DATABASE_PREFIX = 'lusk_it_'
$env:LUSK_TEST_DATABASE_NAME = 'lusk_it_contract'
$env:LUSK_TEST_PUBLISH_DSN = 'postgresql://lusk_it_contract_pub@192.168.1.120:5432/lusk_it_contract'
$env:LUSK_TEST_READ_DSN = 'postgresql://lusk_it_contract_read@192.168.1.120:5432/lusk_it_contract'
$env:PYTHONPATH = '.'
$env:PGCONNECT_TIMEOUT = '5'
$env:PGOPTIONS = '-c statement_timeout=45000 -c lock_timeout=5000 -c idle_in_transaction_session_timeout=60000'
$env:LUSK_TEST_ALLOW_SCHEMA_CLEANUP = '1'
python -m pytest api/tests/integration/test_aedar_littoral_migration.py -q
```

### Per-resource publication (migration 046 and scalar apply, #1137)

Two focused, non-retained proofs cover ADR-0049 step 2. Both require the exact
documented `lusk_it_contract` DSNs, dedicated roles, private `PGPASSFILE`,
`Local\LuskIntegrationContractDb` mutex, cleanup opt-in and runtime identity
checks; both skip before any connection without the `LUSK_TEST_*` variables.

`test_resource_publication_migration.py` upgrades a populated pre-046 schema,
checks every pre-existing row and both global scalar/comparison markers survive,
verifies the three new relations and their fresh-`schema.sql` parity, replays 046
as a no-op, and proves the receipt is append-only (UPDATE/DELETE refused).

```powershell
python -m pytest api/tests/integration/test_resource_publication_migration.py -q
```

The end-to-end `apply` proof lives with the R code
(`pipeline/tests/testthat/test-apply-scalar-db.R`). It uses the
`LUSK_SCALAR_TEST_*` variables from the R smoke section above plus
`LUSK_SCALAR_TEST_CLEANUP=1`, one random schema and fresh `api/schema.sql`. It
proves applying scalar A leaves every other scalar's facts, descriptors,
provenance and comparison byte-identical; a forced failure mid-apply rolls back
everything (registry and receipts unchanged); applying the previous version
restores A exactly; retirement removes A's rows and leaves a receipt; and a
definition change refuses with zero writes unless confirmed. It never connects
to the serving database `lusk`.

```powershell
$env:TESTTHAT_PARALLEL = 'FALSE'
Rscript -e "testthat::test_local(filter='apply-scalar-db', stop_on_failure=TRUE)"
```

### Declared-profile cascade and migration 047 (#1138)

`test_profile_resource_comparison_migration.py` is the guarded, non-retained
populated-upgrade rehearsal of migration 047 (per-resource profile comparison
marker). It uses the same documented `lusk_it_contract` DSNs, dedicated roles,
private `PGPASSFILE`, mutex, cleanup opt-in and runtime identity checks, owns
only its two random schemas, and drops them in `finally`. It proves the global
`table_publication['declared_profile']` marker and the
`profile_comparison_publication` singleton survive, the new relation matches a
fresh `schema.sql`, and its CHECK/PK behaviour rejects a negative count and a
duplicate indicator. Without the `LUSK_TEST_*` variables it skips before any
connection.

```powershell
python -m pytest api/tests/integration/test_profile_resource_comparison_migration.py -q
```

**Coexistence with the legacy full path (expand phase).** Once a per-resource
apply has rebound the DPE profile's `required_scalar_version` to
`part_passoires`'s **facts** version (the `scalar_content_version` of
`scalar_resource_comparison_publication`), the legacy full publication path
refuses atomically at the Habitat typed reading:
`publish_typed_readings.R:356` compares that column against the **global**
`table_publication['scalar_observation'].content_version`, which is a different
token. The legacy path stays green until #1141 retires typed readings.
Consequently **per-resource apply must not be used on the serving database
before the #1143 rollout**; no worker applies it to `lusk`.

The end-to-end cascade proof lives with the R code
(`pipeline/tests/testthat/test-apply-profile-db.R`). It uses the
`LUSK_SCALAR_TEST_*` variables plus `LUSK_SCALAR_TEST_CLEANUP=1`, one random
schema and fresh `api/schema.sql` (migrations 046/047 parity). It proves
`apply part_passoires` republishes `part_passoires` and `distribution_dpe` in
one transaction while every other resource stays byte-identical; that the DPE
profile's `required_scalar_version` is rebound to the scalar's RESOURCE version
and the global markers remain untouched (expand phase); that a forced failure
while publishing the profile rolls the scalar back; and that applying an
unrelated scalar or a profile with no scalar dependency does not touch the DPE
profile. It never connects to `lusk` and skips without the guarded variables.

```powershell
$env:TESTTHAT_PARALLEL = 'FALSE'
Rscript -e "testthat::test_local(filter='apply-profile-db', stop_on_failure=TRUE)"
```

### Per-resource API readers and database discovery (#1140)

`test_resource_descriptor_migration.py` rehearses additive migration 048 on a
populated registry, proves the old registry/global marker rows survive, checks
descriptor object/FK behaviour and replay, and compares the new relation and
index with a fresh `schema.sql`. `test_per_resource_publication_http.py` uses a
fresh random schema and documented SQL fixtures to exercise the real read-role
SQL/HTTP path: scalar and profile reads use their resource versions while old
global markers remain; publishing B does not stale A; retirement disappears
from `/api/resources` and returns typed `503` (including a v2 item outcome); a
new registry descriptor appears without an image change; and a grammar-known
resource with no registry row fails closed rather than being reported unknown.
Both proofs hold `Local\LuskIntegrationContractDb`, verify the exact documented
database/roles before DDL, require the cleanup opt-in, create only their own
schemas and drop them in `finally`. Without guarded DSNs they skip before any
connection.

```powershell
python -m pytest api/tests/integration/test_resource_descriptor_migration.py -q
python -m pytest api/tests/integration/test_per_resource_publication_http.py -q
```

### Owned series, observed collection and AEDAR adapters (#1139)

The companion shape-adapter proof (`pipeline/tests/testthat/test-apply-shapes-db.R`,
#1139) uses the same `LUSK_SCALAR_TEST_*` variables, cleanup opt-in, mutex and
random schema. Each snapshot is scoped to one resource (never a whole table):

- applying one owned series leaves the other series byte-identical, and a
  cross-shape proof seeds scalar, collection and AEDAR first and shows their
  rows and markers byte-identical after applying another series;
- applying one observed collection leaves the other collections byte-identical,
  with the symmetric cross-shape proof against scalar, series and AEDAR;
- AEDAR `apply` passes the deferred `check_aedar_comparison_publication`
  validator both with and without littoral summaries, and leaves seeded scalar,
  series and collection rows byte-identical.

AEDAR reads the live `territory_reference` rows ONCE inside apply's transaction
(shared with the series and collection adapters) and validates dense territory ×
TYPEQU coverage with them; its comparison facts come from the artefact. Without
the opt-in the module skips before any connection.

```powershell
$env:TESTTHAT_PARALLEL = 'FALSE'
Rscript -e "testthat::test_local(filter='apply-shapes-db', stop_on_failure=TRUE)"
```

### Registry adoption (#1142)

`pipeline/tests/testthat/test-adopt-db.R` is the guarded, non-retained adoption
proof. It uses the same `LUSK_SCALAR_TEST_*` variables, exact
`lusk_it_contract` target and publisher role, private `PGPASSFILE`, cleanup
opt-in and runtime identity checks as the shape proofs. It skips before any connection without
that configuration and drops only its own random `it_adopt_*` schema.

The fixture calls the normal `publish_retained_backend_snapshot(atomic=TRUE,
companion_profiles=TRUE)` entry point for territory reference, scalar and declared
profiles (including a DPE-like `comparison_scalar` binding). Owned series use
`publish_owned_series_projection`, period-detail and anchored collections use
`publish_observed_collection`, and AEDAR uses `publish_aedar_aggregates` plus
`publish_aedar_comparisons`. At fixture scale the four typed-reading families are
namespace-bound no-op stubs because adoption explicitly ignores them and complete
canonical typed-reading fixtures are unavailable; the proof asserts every stub was
hit. No expected serving rows are SQL-seeded. The proof adopts all eight resources,
requires the whole-schema data digest to stay byte-identical apart from
registry/receipt/descriptor rows, asserts one version-bound discovery descriptor per
resource, refuses one altered live row in each shape with zero writes and the
resource/table named, checks `plan` reports every resource unchanged, and forces a
receipt failure to prove transaction rollback.

```powershell
$env:TESTTHAT_PARALLEL = 'FALSE'
Rscript -e "testthat::test_local(filter='adopt-db', stop_on_failure=TRUE)"
```

The default-suite persisted-row comparison/orchestration contracts live in
`test-adoption.R`. The real-writer proof is the guarded DB tier above, not an
artefact-vs-itself comparison. A skip is not a guarded pass: the orchestrator runs
the proof on the PR's final head.

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

The AEDAR semantic phase also writes sanitized public `read-batch` responses
(focal/reference summaries, fixed comparison evidence including ranks, and one
typed fact) under `E:\Temp\opencode`, then invokes the focused mounted Vue route
test with that artifact. The route replays captured fixture responses through
the real app clients while an independent typed-detail request returns 503;
the test checks the summary remains visible and the typed consumer accepts its
captured response when retried directly. This is synthetic guarded fixture
replay, not a production-browser benchmark. The Vitest child receives only the
artifact path, not PostgreSQL environment or credentials.

The current retained publisher proofs are the Habitat, Economy, and Milieux
scripts above, each using a private copied writable fixture and a guarded random schema.
The ordinary suite and focused R test counts do not substitute for those
publisher-to-database-to-HTTP proofs. Do not run the full AEDAR proof while
iterating on unrelated harnesses; cite its pinned run and duration when reporting
acceptance.

The separate AEDAR summary-storage/read-path benchmark is strictly read-only;
it requires an explicitly selected current-compatible retained schema and the
current API marker gate (including migration-042 metadata) to pass before adapter
timing. It uses the dedicated read role, does not run the publisher, and measures
adapter preparation rather than HTTP endpoint latency. It has no default schema;
the historical fixture referenced by its old receipt was deleted. See
[`docs/aedar-territory-summary-benchmark.md`](../../../docs/aedar-territory-summary-benchmark.md)
and `benchmark_aedar_summary_reads.py` for the bounded workload and external
receipt format.
