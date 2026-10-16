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
- At most 8,000,000 serialized response bytes. The endpoint counts each item as
  it is produced and aborts rather than assembling an oversized envelope.
- Existing per-reader cohort, point, cell, and publication bounds remain in
  force. The 1,202-member published fixed comparison is not counted as 1,202
  raw fact rows; explicit dynamic selections retain their established semantics.

There is one acquired connection and one outer transaction. Existing
connection-taking readers reuse that connection; no route/HTTP fan-out,
per-item connection, or nested transaction is used.

## Remaining #788 coverage

This checkpoint is not the final resource inventory or a rollout authorization.
The following standalone logical reads remain to be shared/exposed and tested:

- named-indicator focal dispatch (`/indicators/{indicator_id}`), including its
  scalar, declared-profile, legacy-series alias, owned series/reference, and
  numeric-collection response contracts;
- named-indicator fixed/dynamic comparison (`/indicators/{indicator_id}/comparison`);
- direct profile and series aliases where their public response differs from a
  theme payload; do not treat `theme_facts` as parity for those URLs;
- bounded territory/group-row read contracts required by the app inventory.

The whole-list preflight now proves identities, field support, scopes, and
request bounds before fact/result readers. It does not yet resolve every
family-specific publication dependency marker for every item in that preflight
phase; each item's established reader validates those dependencies before that
item returns. A bad later publication can therefore follow earlier internal
read work, though the transaction still returns no partial response. Complete
dependency-marker preflight, first/last-item stale/missing tests, concurrent
publisher-refresh proof, and source-pinned paired batch-vs-single rehearsal
remain required before #788 is complete.
