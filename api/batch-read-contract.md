# Typed batch reads (issue #788 checkpoint)

`POST /api/read-batch` composes published reads under one caller-owned PostgreSQL
`READ ONLY REPEATABLE READ` transaction. A successful response has the shape
`{"contract":"typed-read-batch-v1","results":[{"id":"...","resource":"...","data":{...}}]}`.
Each `data` member is a typed reader payload, not a new flattened shape. The
`id` is a unique request-local opaque correlation label; it is not a territory,
publication, or business identity. Duplicate IDs and unknown resource kinds
are rejected. Repeating a resource with different parameters is valid.

Example:

```json
{
  "items": [
    {"id":"habitat","resource":"theme_facts","territory_type":"commune",
     "territory_id":"22001","theme_id":"habitat","fields":["value"]},
    {"id":"mobility-peers","resource":"theme_comparison","territory_type":"commune",
     "territory_id":"22001","theme_id":"mobilite","selection":[]}
  ]
}
```

## Resource coverage in this checkpoint

| Resource | Typed parameters | Existing reader |
| --- | --- | --- |
| `theme_facts` | territory type/id, theme ID, optional #781 `fields` | `_theme_facts_snapshot` |
| `theme_comparison` | territory type/id, theme ID, optional typed territory `selection`, optional comparison `fields` | `_theme_comparison_snapshot` |

These are published theme fact reads and request-scoped theme comparisons, not
an arbitrary table/query API. `fields` uses the existing field-selection
normalizer; omission preserves the reader default. Item results are all-or-none:
any validation, publication, or read error aborts the transaction and returns
the normal error response without a results envelope. Source vintages are not
compared across items; each reader retains its own publication and lineage
metadata.

## Bounds

- 1–12 items per request.
- At most 1,500 explicitly selected territory entries across comparison items;
  each selection is already individually capped at 1,500 by its typed model.
- 8 MB serialized response limit; excess is rejected, never truncated.
- Existing readers retain their own scope, cohort, and publication bounds.

## Not yet exposed by this checkpoint

This is deliberately not the final #788 resource inventory. The API's current
public surface also contains standalone focal indicator/profile reads, ordered
and owned series, numeric collections, named-reference reads, and AEDAR
aggregate/fixed-comparison reads. They are not currently accepted by this batch
endpoint. In particular, the batch comparison path currently calls the shared
snapshot function but does not yet apply every route-specific response adaptation
(including comparison-only Mobility service metadata); parity for these
resources remains a required implementation/test step. The complete coverage,
whole-request metadata/field preflight, guarded real-Postgres concurrent-refresh
proof, and source-pinned paired batch-vs-single benchmark are outstanding. Do
not describe this checkpoint as the completed #788 contract or roll consumers
over to it.
