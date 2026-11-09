# AEDAR territory-summary benchmark and rollout

**Status:** guarded-fixture evidence only. This is not production latency,
production storage, deployment approval, or acceptance of a live publication.
PR #939 remains draft. The owner-approved product and publication contract is
in [ADR-0039](adr/0039-published-comparison-aggregates.md); this note records
the measured fixture evidence and the operator gates, not a new domain decision.

## Measured fixture

The reproducible receipt is external to the repository at
`E:\Temp\opencode\aedar-summary-benchmark.json`. It uses only
`lusk_it_contract`, schema `it_aedar_1bed7545b6524889`, and the dedicated
read-only role. The script pins the old API reader to `ebb737885548ce4c002bc04fadf178c8d7b0743b`
and compares it with current API source `28f198570a040ebd0ebd33f9530580de733b6a5c`.
The old source is archived into a temporary directory; neither the main checkout
nor the retained schema is modified.

Receipt SHA-256: `838c9d7b5f06c17c2d53c2469b074dfd96b0fdfa7a8f0551e5ea1fa7affac913`.

The script gets its 40 measure identities from the published summary rows and
its focal commune, EPCI and peer communes from `territory_reference`. It calls
each version's fixed-batch preparation adapter once for each workload, in a
read-only repeatable-read transaction:

| Query-level workload | Old adapter elapsed | Current adapter elapsed | Old/current peer readings loaded | Adapter projection bytes* |
| --- | ---: | ---: | ---: | ---: |
| 40 values + 2 ranks | 1,951.436 ms | 14.566 ms | 42 / 80 | 9,704 / 9,704 |
| 40 values + 40 ranks | 2,811.905 ms | 6.764 ms | 80 / 80 | 11,119 / 11,119 |

Each workload returned 40 focal values and 40 group values; both adapter
versions produced identical normalized comparison projections for each
workload. The two ranked identities in the partial case were selected
deterministically from the producer-published measure list. `adapter elapsed`
includes the version-specific database adapter calls and its Python projection,
but excludes API validation/preflight, final response construction, HTTP
serialization and transport. `adapter projection bytes` is the canonical JSON
size of that normalized projection, **not** an HTTP response size.

At this benchmark snapshot, the fixture's fixed-comparison publication marker is stale for the
typed-source clock: the comparison marker says `aedar_content_version` does not
match the current `aedar_territorial_aggregate` table marker (reference clock
matches; publication mode is `reference_only`). The API's old fixed-comparison
probe correctly returned 503. Therefore this receipt reports **no API endpoint
latency or HTTP response size**. The API failure is not counted as a benchmark
result, and no source-clock marker was edited to bypass fail-closed behavior.
The summary/source/reference clocks themselves align, so the internal query
adapters could be measured without invoking the comparison endpoint gate.

Four read-only `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` plans were captured
from the exact peer-population SELECTs used by those adapters:

| Peer SELECT | Planning | Execution | Shared hit blocks | Rows |
| --- | ---: | ---: | ---: | ---: |
| Old typed JSONB, 2 rank measures | 2.360 ms | 93.094 ms | 17,677 | 4 |
| Old typed JSONB, 40 rank measures | 0.480 ms | 1,903.313 ms | 351,086 | 80 |
| Summary projection, 40 measures (2-rank case) | 1.087 ms | 0.646 ms | 8 | 80 |
| Summary projection, 40 measures (40-rank case) | 0.340 ms | 0.592 ms | 8 | 80 |

The two current plans use the same summary SELECT and parameters because
request-time rank calculation changes in Python, not in the summary projection
query. This is one observation per path and variant, with no endpoint warm-up
and no repeated sample. Run order, cache state, fixture scale, lack of API
serialization, and the stale endpoint marker make a speed ratio or production
latency forecast inappropriate. The plans and full counters are in the
external JSON receipt.

### Physical storage snapshot

Counts are from the same schema. PostgreSQL byte figures are physical relation
sizes (heap/table, indexes and total); they are not Parquet or network payload
sizes.

| Relation | Rows / territories | Heap bytes | Table incl. TOAST bytes | Index bytes | Total bytes | TOAST total bytes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `aedar_territorial_aggregate` | 1,175 / 5 | 2,121,728 | 24,952,832 | 221,184 | 25,174,016 | 22,798,336 |
| `aedar_territory_summary` | 200 / 5 | 65,536 | 106,496 | 155,648 | 262,144 | 8,192 |
| `aedar_comparison_group` | 293,280 / not applicable | 36,511,744 | 36,560,896 | 37,150,720 | 73,711,616 | 8,192 |

On this five-territory fixture, summary storage is 262,144 bytes total, or
about 1,311 total relation bytes per summary row when the small-fixture table
and index overhead is divided across 200 rows. A simple linear extrapolation
to 1,268 territories × 40 readings (50,720 rows) was about **66.5 MB / 63.4
MiB**. That tiny-fixture extrapolation is historical context only and is
superseded by the separate measured scale-up below.

### Fresh synthetic 50,720-row measurement

A separate, explicitly opted-in write harness created and retained schema
`it_aedar_size_9df5c6d8aee244df961fd86010229509` in guarded
`lusk_it_contract`, using the verified publisher test role. It cloned the
retained summary table with `LIKE ... INCLUDING ALL` (the primary-key and
lookup indexes, and table constraints), then copied one complete fixture
commune's 40 summary rows to 1,268 clearly synthetic IDs. All 40 rows per ID
were verified. The probe did not create publication markers, publish data, call
the API, or modify the retained source schema; its source row count and relation
sizes were unchanged before/after.

| Synthetic table | Rows / territories | Heap bytes | Table incl. TOAST bytes | Index bytes | Total bytes | TOAST total bytes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `aedar_territory_summary` | 50,720 / 1,268 | 17,317,888 | 17,350,656 | 13,803,520 | **31,154,176** | 8,192 |

The measured total is **31.15 MB / 29.71 MiB** (about 614 total relation
bytes per row), with no linear extrapolation. This is above the owner's initial
10–25 MiB estimate; the evidence should inform a revised owner estimate rather
than be presented as meeting that range. The old 63.4 MiB extrapolation is
roughly twice this controlled result and is no longer the primary storage
estimate.

The physical result is for a synthetic table populated by repeating one
fixture territory's values and provenance across synthetic IDs. It is not a
production storage measurement or forecast: production payload distribution,
database settings, and retained-table state may differ. The retained fixture's
stale comparison clock described above is irrelevant to this physical-size
probe; no comparison/API path was exercised. This result does not establish
production acceptance or authorize publication.

The external intent manifest and sanitized size receipt are in
`E:\Temp\opencode\aedar-summary-storage\63eee0b88dfd4bc1824580a31040202b\`.
Receipt SHA-256:
`3A5B2AA0BF3349E4BF643E5688FC9F45D4AA4822C31DAEA4986EEBAE67F98FB6`.

The read-only pre/post check found identical row counts, relation sizes and
table-publication markers for the adapter benchmark. That read-only benchmark
made no writes. The small-fixture summary relation adds about 0.26 MB beside
about 25.17 MB of typed aggregate storage; the typed table is retained for
per-TYPEQU detail reads.

### Separate producer-stage evidence

Prior successful guarded R publisher stage receipts recorded about **5.36 s**
for aggregate-plus-summary publication and **28.40 s** for comparison
publication. These are separate publisher-stage fixture timings, not read
latency or production forecasts. The whole R→API→mounted-app proof took about
129.72 s end to end; it is explicitly not substituted for either read time or
publisher-stage time. Its sanitized mounted-response artifact is
`E:\Temp\opencode\aedar-it-l7kk17p8\mounted-app-api-responses.json`,
SHA-256 `8FFAAF77EF246CC533A0FB23DF39BE252250B1E73F0C4FED97994E58B2E0183A`.

## Reproduction

### Read-only adapter benchmark

Run from the repository root on the guarded test workstation. The passfile and
credentials stay local; do not save them in the repo or the receipt. The script
refuses a different database host/database/role combination, enables
`default_transaction_read_only`, sets a transaction timeout and the explicit
schema search path, and verifies fixture clocks and relations before and after.
It does not connect with the publisher DSN.

```powershell
$env:PGPASSFILE = Join-Path $env:APPDATA 'PostgreSQL\pgpass.conf'
$env:LUSK_TEST_DATABASE_PREFIX = 'lusk_it_'
$env:LUSK_TEST_DATABASE_NAME = 'lusk_it_contract'
$env:LUSK_TEST_PUBLISH_DSN = 'postgresql://lusk_it_contract_pub@192.168.1.120:5432/lusk_it_contract'
$env:LUSK_TEST_READ_DSN = 'postgresql://lusk_it_contract_read@192.168.1.120:5432/lusk_it_contract'
$env:LUSK_TEST_READ_USER = 'lusk_it_contract_read'
Remove-Item Env:LUSK_TEST_ALLOW_SCHEMA_CLEANUP -ErrorAction SilentlyContinue
python api/tests/integration/benchmark_aedar_summary_reads.py `
  --schema it_aedar_1bed7545b6524889 `
  --publisher-aggregate-summary-seconds 5.36 `
  --publisher-comparison-seconds 28.40 `
  --whole-integration-proof-seconds 129.72
```

The publisher timing arguments preserve prior stage receipts; they do not run a
publisher. The command emits the sanitized JSON receipt to
`E:\Temp\opencode\aedar-summary-benchmark.json`. It runs only two adapter calls
per API version and at most four `EXPLAIN ANALYZE BUFFERS` SELECTs. It does not
run R, a full integration suite, a migration, publication, or deployment.

### Explicit synthetic storage probe

This is a different, write-enabled harness; it does not change the read-only
adapter benchmark. Each invocation records an external intent manifest before
DDL, creates one fresh random schema, and retains it. Run only with explicit
approval on the guarded test workstation. The harness requires both the CLI
flag and confirmation token below, verifies the documented test host/database
and publisher role, applies 5-second connection/lock and 45-second statement
timeouts, and omits credentials from its receipt. Do not point it at another
database or use production credentials.

```powershell
$env:PGPASSFILE = Join-Path $env:APPDATA 'PostgreSQL\pgpass.conf'
$env:LUSK_TEST_DATABASE_PREFIX = 'lusk_it_'
$env:LUSK_TEST_DATABASE_NAME = 'lusk_it_contract'
$env:LUSK_TEST_PUBLISH_DSN = 'postgresql://lusk_it_contract_pub@192.168.1.120:5432/lusk_it_contract'
$env:LUSK_TEST_READ_DSN = 'postgresql://lusk_it_contract_read@192.168.1.120:5432/lusk_it_contract'
$env:AEDAR_STORAGE_PROBE_CONFIRM = 'CREATE_SYNTHETIC_SCHEMA_IN_LUSK_IT_CONTRACT'
$env:PYTHONPATH = '.'
Remove-Item Env:LUSK_TEST_ALLOW_SCHEMA_CLEANUP -ErrorAction SilentlyContinue
python api/tests/integration/benchmark_aedar_summary_storage.py --create-synthetic-schema
```

The command prints its pre-DDL intent path and, on success, writes
`intent.json` and `receipt.json` beneath
`E:\Temp\opencode\aedar-summary-storage\<run-id>\`. The retained schema name
is also in the receipt. Each invocation creates a new schema; do not rerun to
refresh an existing measurement or clean up the retained namespace as part of
this benchmark.

## Producer-to-app inventory

| Layer | Owner and contract | Runtime/storage path |
| --- | --- | --- |
| Producer identities | `pipeline/R/aedar_aggregates.R` and `pipeline/inst/extdata/semantic-resource-contracts.json`: the 312 source-grain columns and 40 registry-wide reading identities/bindings are producer-owned. | `aedar_aggregate_reading_bindings()` maps each summary identity to its source column; `project_aedar_territory_summary()` validates complete TYPEQU coverage, support, provenance and availability. |
| Canonical build/publication | `pipeline/scripts/publish-aedar-aggregates.R` (`--check`, `--publish`, `--full-vintage` only). `--publish` reads already materialized canonical Parquets; it requires `LUSK_PUBLISH_AEDAR=1` and refuses cron. | `publish_aedar_aggregates()` atomically publishes source-grain facts and the 40-value summary with independent content clocks; then the script calls `publish_aedar_comparisons()` for the reference-only comparison marker. The comparison publication is a separate transaction and must also succeed before a reader cutover. |
| Schema | `api/migrations/041_aedar_territory_summaries.sql`, mirrored in fresh-install `api/schema.sql`. | Adds `aedar_territory_summary`, its lookup index, and a source-clock field/constraint on `table_publication`. Typed `aedar_territorial_aggregate` remains intact. |
| API contract and reads | `api/resource_catalogue.py`, `api/semantic_resource_reader.py`, and `api/aedar_reads.py`; integration contracts in `api/tests/integration/test_aedar_publisher_http.py` and `test_aedar_selected_comparison_http.py`. | `aedar_territory_summary` is an independent facts read. Fixed aggregate comparison reads use summary values and request-time ranks, while the publisher-derived reference/source/summary clocks fail closed. Per-TYPEQU reads continue using typed facts. |
| App acquisition and presentation | `app/src/views/TerritoireView.vue`; `app/src/fiche/content/aedarApiClient.ts`, `aedarTimeRampFacts.ts`, `aedarComparisonClient.ts`, and `aedarAccessSection.ts`; `app/src/fiche/mobilite/ProductionMobiliteAedar.vue`; `app/src/fiche/prototype/AedarEquipmentExplorerCahier.vue`. | The view orchestrates focal/reference summary and detail acquisitions; the API client reads and validates the registered complete summary; time-ramp and section adapters retain the existing presentation; comparison reads bind to content/reference/summary clocks. Mobility's per-TYPEQU detail and the prototype's selected equipment detail remain separate. App wording/display facts remain app-owned; numerical semantics and measure identities come from producer/API declarations. |

## Rollout and rollback gates

No step below is authorized by this benchmark. Each production action requires
the owning operator's explicit approval; there is no automatic publication,
migration, deployment, or readiness transition.

1. **Database owner:** review and approve migration 041 after the existing 040
   state. Confirm backup and migration state. Do not apply this migration to a
   serving database from a code-change workflow.
2. **AEDAR pipeline owner:** approve the exact source/canonical artifacts and
   run the guarded producer flow. `--check` prepares and validates artifacts;
   `--publish` requires an explicit production publish decision and the guarded
   flag. Confirm aggregate, summary, and comparison publication clocks and
   counts after both publisher transactions. If comparison publication fails
   after aggregate+summary commit, do not activate readers; repair/retry the
   canonical publication and confirm all clocks before proceeding.
3. **API owner:** approve and deploy the API reader only after the compatibility
   markers align. Verify a read-only focal summary and fixed comparison through
   the serving API; a stale marker must remain a 503, not be patched around.
4. **App/product owner:** approve and deploy the app only after the API checks
   pass. Verify summary and comparison clocks bind to the same published source
   and reference. Keep typed detail reads and their owner path operational.
5. **Stop/rollback:** on any failed gate, stop before the next layer. Roll back
   to the previous app/API/publisher release as appropriate and verify the old
   typed-read path. Leave migration 041 and its data in place; do not drop the
   summary relation or add a second browser-side numeric runtime. Retry only
   after the failed owner gate is resolved.

This evidence does not claim a production migration, publication, deployment,
or production acceptance. PR #939 stays draft pending the separate owner review
and production operating decision.
