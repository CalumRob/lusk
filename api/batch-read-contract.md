# Typed batch reads (issue #788 implementation checkpoint)

`POST /api/read-batch` composes declared serving reads under one caller-owned
PostgreSQL `READ ONLY REPEATABLE READ` transaction. A successful response is
`{"contract":"typed-read-batch-v1","results":[{"id":"...","resource":"...","data":{...}}]}`.
`data` preserves the corresponding single-read response shape and metadata; only
the outer envelope is new. An item `id` is an opaque, unique, request-local
correlation label, not a domain or publication identity. The same resource may
repeat with different parameters. Unknown resources, duplicate IDs, irrelevant
resource parameters, and invalid fields/scopes fail explicitly. Any item failure
aborts the whole request; no partial results envelope is returned.

## Supported logical resources

| Resource | Typed parameters | Shared reader / single-read contract |
| --- | --- | --- |
| `theme_facts` | `territory_type`, `territory_id`, `theme_id`, optional commune `comparison` (`densite`, `epci`, `bretagne`), optional #781 `fields` | `_theme_facts_snapshot`; same payload as `GET /api/territories/{type}/{id}/themes/{theme}/facts` |
| `theme_comparison` | territory identity, `theme_id`, optional typed `selection`, comparison `fields` | `_theme_comparison_contract_snapshot`; same adapted payload as `POST /api/territories/{type}/{id}/themes/{theme}/comparison`, including Mobility service/building metadata |
| `aedar_aggregate` | territory identity, optional `typequ[]`, #781 `fields`, `limit`, `offset` | `_aedar_territorial_aggregate_snapshot`; same payload as `GET /api/aedar/territories/{type}/{id}/aggregates` |
| `aedar_comparison` | commune/EPCI/département identity, `context`, `typequ`, `measure`, #781 `fields` | `_aedar_comparison_snapshot`; same payload as `GET /api/aedar/territories/{type}/{id}/comparisons` |
| `indicator_facts` | territory identity, `indicator_id`, shape-declared `fields` | `_indicator_facts_snapshot`; same payload as `GET /api/territories/{type}/{id}/indicators/{indicator}` |
| `indicator_comparison` | territory identity, `indicator_id`, optional typed `selection`, comparison `fields` | `_indicator_comparison_snapshot`; same payload as `POST /api/territories/{type}/{id}/indicators/{indicator}/comparison` |
| `direct_profile` | territory identity, `indicator_id`, declared `comparison_scope`/optional ID, optional `fields` | `_declared_profile_snapshot`; same direct response as `GET /api/territories/{type}/{id}/profiles/{indicator}` (not the indicator alias with `default_comparison`) |
| `direct_series` | territory identity, `indicator_id`, `scope_level`, optional `department_id` or `epci_id`, optional `fields` | `ReadRepository.read_series(connection=...)`; same response as `GET /api/territories/{type}/{id}/series/{indicator}`, including bounded raw `scope_series` cohort rows |
| `owned_dataset` | registered `dataset_id` and `indicator_id`, territory identity, `scope_level`, optional commune filters / `comparison_detail`, optional `fields` | `ReadRepository.read_owned_series(connection=...)`; same response as `GET /api/series-datasets/{dataset}/territories/{type}/{id}/{indicator}`, including bounded cohort rows |

Example mixing a focal read with a comparison:

```json
{
  "items": [
    {"id":"habitat","resource":"theme_facts","territory_type":"commune",
     "territory_id":"22001","theme_id":"habitat","fields":["value"]},
    {"id":"mobility-peers","resource":"theme_comparison","territory_type":"commune",
     "territory_id":"22001","theme_id":"mobilite","selection":[],"fields":["median"]}
  ]
}
```

Example composing both AEDAR serving shapes:

```json
{
  "items": [
    {"id":"facts","resource":"aedar_aggregate","territory_type":"commune",
     "territory_id":"22001","typequ":["A104"],"fields":["measures.count_5_walk_mean"]},
    {"id":"comparison","resource":"aedar_comparison","territory_type":"commune",
     "territory_id":"22001","context":"epci","typequ":"A104",
     "measure":"count_5_walk_mean","fields":["value","rank"]}
  ]
}
```

Field names and per-resource support come from the existing typed readers and
#781 field-selection normalizer; the batch endpoint does not define a second
projection vocabulary. Mandatory identity, status/availability, axes, units,
lineage, source-vintage, and independent publication versions remain owned by
each item's existing response. Different source vintages are valid in one
database snapshot; no shared release/version is inferred.

## Validation order and limits

The batch first validates every discriminated resource model and duplicate ID,
then normalizes all field lists and aggregate limits without connecting. In one
read-only repeatable-read transaction it runs the typed readers' metadata-only
preflight for every item (territory/resource metadata, selection scope and
resource-owned field support), before invoking any fact/result reader. A bad
last item's unsupported theme field therefore cannot follow earlier item fact
queries. Each full reader still performs its existing fail-closed publication,
completeness and data-shape checks; those checks are not duplicated or relaxed.

- 1–12 subrequests.
- At most 1,500 explicitly selected territories across all theme-comparison
  items; individual typed selections retain their existing 1,500-member cap.
- At most 300 requested AEDAR aggregate rows across the batch (sum of item
  limits); each reader still caps one page at 100 rows.
- At most 200,000 estimated profile/series raw-row and cell work units across
  the batch. Direct profile estimates use the existing 1,500-territory scan
  ceiling plus descriptor-axis detail × sex cells. Series estimates use the
  descriptor axis count times the bounded count of reference territories at
  the requested level/scope (plus one focal curve); owned series additionally
  multiplies logical points by the reader's existing maximum of eight lineage
  revisions per point. This is conservative metadata-based estimation, not a
  cohort-fact `COUNT(*)` audit; eligible peer rows can be fewer. Reject with
  413 before any fact/result reader when the sum exceeds the cap. No truncation.
- At most 8,000,000 serialized response bytes. The endpoint counts each item as
  it is produced and aborts rather than assembling an oversized envelope.
- Existing per-reader cohort, point, cell, and publication bounds remain in
  force. A 1,202-member fixed comparison result is not charged as 1,202 fetched
  raw peer facts: published group/focal work remains distinct from direct
  series resources that actually return cohort fact rows. Explicit dynamic
  selections retain their established semantics.

There is one acquired connection and one outer transaction. Existing
connection-taking readers reuse that connection; no route/HTTP fan-out,
per-item connection, or nested transaction is used.

## Dependency-preflight and snapshot checkpoint

This checkpoint is not a rollout authorization. The inventory above now covers
the named focal/comparison resources, the direct profile response, the direct
annual-series response, and owned dataset series (including actual bounded
cohort rows), plus named-reference indicator aliases. These are explicit logical contracts, not a
generic territory-table/group-query API. In particular, `scope_series` is the
existing typed reader's declared series cohort, never a caller-defined group.
Named-reference indicator aliases remain `indicator_facts` items and use the
existing active owned-reference dispatch and response identity; they are not
folded into the direct dataset series URL, whose public response does not carry
the separately routed named-reference resource.

The metadata preflight resolves the current resource-family dependencies before
any item fact/result reader: BPE publication/descriptor clocks; owned dataset
and named-reference publication, reference clock and route identity; observed
collection publication/reference clock and fixed-comparison lineage marker;
scalar/profile and fixed scalar/profile/series/collection comparison markers;
AEDAR aggregate/comparison markers; and direct profile/series markers and
descriptor/scope limits. The existing publication guards are reused. Preflight
does not count peer facts or validate raw fact completeness; those remain the
bounded reader/publisher contract. A failed later item returns an HTTP error,
never a partial `results` envelope.

Guarded PostgreSQL first/last-item stale-marker tests record SQL executed by the
reader connection and prove no earlier profile, series, observed-collection, or
scalar-comparison fact/result query occurred. Unknown named comparisons are
also rejected in metadata preflight before earlier fact reads. A
barrier-controlled publisher commit between the first and second batch reads
proves one connection and one outer `READ ONLY REPEATABLE READ` transaction see
the old facts/clock together; a subsequent single read sees the new clock/value.
An explicit write attempt in a
read-only transaction is rejected. The independent profile clock in that batch
also remains unchanged. The source-pinned paired batch-vs-single rehearsal and
broader review/rollout authorization remain outside this checkpoint.

Resource-local bounds, the 12-item cap, the 200,000-unit aggregate
profile/series estimate and serialized envelope limit continue to bound
supported work; they do not imply a publisher performance benchmark.
