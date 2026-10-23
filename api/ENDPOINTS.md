# API endpoint reference

This reference covers business routes registered by the current FastAPI app.
The generated inventory below is the exact parameter and request-body reference;
it is refreshed and checked against `app.openapi()` by
[`generate_endpoint_inventory.py`](scripts/generate_endpoint_inventory.py).
The schema at `/api/openapi.json` is authoritative when a detail changes.
Response schemas for several read routes are intentionally generic dictionaries
in OpenAPI; this reference points to resource contracts rather than inventing a
stronger response guarantee.

All paths below include the `/api` prefix. Path placeholders are literal
parameters, not slashes. The only path taking query parameters is
`/api/territories/search`; semantic reads carry arrays such as `fields` and
`coordinates` in the JSON request body. A validation failure
normally returns `422`; an unknown territory/resource/indicator is generally
`404`; an absent, stale or incompatible publication dependency fails closed
with `503`. Individual operations may have additional documented errors.

`GET /api/resources` is the producer-derived retained-resource catalogue. It
does not connect to PostgreSQL; its inventory and logical shape declarations
come from the pipeline's checked-in theme producer descriptors. Excluded
legacy accessibility declarations are validated for accounting but are not
returned. This contract describes declared resources, not whether every
resource currently has a successful publication.

`POST /api/resources/read` accepts the shared semantic item (`resource`, typed
`target`, optional closed `coordinates`, `fields`, and typed `intent`). The
single-read request and each batch item have the same fields; only a batch item
adds its correlation `id`. `POST /api/resources/read-batch` validates all items
before returning results and returns no partial result if any item fails. Both
execute on one `READ ONLY REPEATABLE READ` snapshot. The batch is limited to 12
items, 200,000 preflight work units, and 8 MB serialized output. Supported intents
are `facts`, `fixed_comparison` with the closed `default` context, and bounded
`selected_comparison` with at most 1,500 unique typed territory members. Facts
coordinates and optional fields are producer-declared; status, availability,
descriptor, axis, and provenance metadata remain mandatory where declared.
Comparison fields use the closed comparison-result vocabulary.
The catalogue also includes four producer-declared `typed_reading` resources for
selected Démographie, Économie/Emploi, Habitat, and Milieux evidence. These use the
same `facts` grammar and a declared `groupe` coordinate. Ranked economy activities,
Milieux source absences, and Milieux source bindings are exposed as separate named
evidence fields, with publication/reference compatibility checked before reads.

`territory_cohort` is a facts-only target for bounded producer-declared populations;
it does not add comparison or arbitrary query semantics. The target `type` must be
declared by the resource. Optional `department_id` and `epci_id` filters are accepted
only for `commune` cohorts and intersect against the published `territory_reference`.
The response carries a shared `cohort` envelope (ordered member identities, count,
filters, and reference version) plus the resource's native fact family: scalar
`observations`, profile `profiles`, ordered-series `series`, sparse collection
`territories`, typed-reading `territories` with selected evidence, or AEDAR aggregate
`facts`. Sparse missing records are not converted into zero-valued facts. Member,
selected-axis, evidence/lineage and serialized-response work is preflighted before
reads; a failed item rejects the whole batch on its single repeatable-read snapshot.

Theme/family-specific facts, direct-profile, series-dataset, building-access,
essential-services and legacy batch routes have been retired in favor of the
semantic resource contract. `aedar_territorial_aggregate` is declared as a
semantic resource and can be read through `/api/resources/read` and
`/api/resources/read-batch`; `typequ` and
`measure` are closed coordinate selectors, `measures.<registered-id>` is a field
projection, and comparison context belongs to `fixed_comparison` intent. The two
legacy AEDAR GET operations
(`/api/aedar/territories/{type}/{id}/aggregates` and `/comparisons`) are
retired: AEDAR data is available only through the unified resource contract.
This backend change removes those compatibility paths; no frontend migration or
caller edits are included in this backend change.

<!-- BEGIN GENERATED API REQUEST INVENTORY -->
## Generated route and request-schema inventory

Generated from `api.main:app.openapi()` by
`python -m api.scripts.generate_endpoint_inventory`. This inventory is
the authoritative source for exact methods, paths, parameter schemas,
request-body requiredness, and request-model property constraints. It
intentionally does not duplicate response/business vocabularies; follow
the linked resource contracts and the operation notes below.

| Method | Path | Operation | Parameters | Request body |
| --- | --- | --- | --- | --- |
| `GET` | `/api/resources` | Discover Resources | — | — |
| `POST` | `/api/resources/read` | Read Resource | — | required request body: `ResourceReadItem` |
| `POST` | `/api/resources/read-batch` | Read Resource Batch | — | required request body: `ResourceBatchRequest` |
| `GET` | `/api/territories/search` | Search Territories | `q` (query, required: string; min chars: `1`; max chars: `64`)<br>`limit` (query, optional: integer; min: `1`; max: `50`; default: `8`) | — |
| `GET` | `/api/health` | Health | — | — |

### Request-model properties

These are the model fields reachable from request bodies, including nested and discriminated-union members. `required` is per model; array/string/numeric bounds and defaults come from OpenAPI.

| Model | Property | Required? | Schema |
| --- | --- | --- | --- |
| `ResourceReadItem` | `resource` | yes | string; pattern: `^[a-z][a-z0-9_]{0,95}$` |
| `ResourceReadItem` | `target` | yes | one of TerritoryTarget / TerritoryCohortTarget / NamedReferenceTarget |
| `ResourceReadItem` | `coordinates` | no | object |
| `ResourceReadItem` | `fields` | no | array of string; max items: `32` |
| `ResourceReadItem` | `intent` | yes | one of FactsIntent / FixedComparisonIntent / SelectedComparisonIntent |
| `ResourceBatchRequest` | `items` | yes | array of ResourceBatchItem; min items: `1`; max items: `12` |
| `TerritoryTarget` | `kind` | yes | string; const: `territory` |
| `TerritoryTarget` | `type` | yes | string; one of `commune`, `epci`, `departement`, `region` |
| `TerritoryTarget` | `id` | yes | string; min chars: `1`; max chars: `32` |
| `TerritoryCohortTarget` | `kind` | yes | string; const: `territory_cohort` |
| `TerritoryCohortTarget` | `type` | yes | string; one of `commune`, `epci`, `departement`, `region` |
| `TerritoryCohortTarget` | `department_id` | no | string; min chars: `1`; max chars: `32` |
| `TerritoryCohortTarget` | `epci_id` | no | string; min chars: `1`; max chars: `32` |
| `NamedReferenceTarget` | `kind` | yes | string; const: `named_reference` |
| `NamedReferenceTarget` | `id` | yes | string; min chars: `1`; max chars: `128` |
| `FactsIntent` | `kind` | yes | string; const: `facts` |
| `FixedComparisonIntent` | `kind` | yes | string; const: `fixed_comparison` |
| `FixedComparisonIntent` | `context` | yes | string; min chars: `1`; max chars: `64` |
| `SelectedComparisonIntent` | `kind` | yes | string; const: `selected_comparison` |
| `SelectedComparisonIntent` | `members` | yes | array of TerritoryMember; max items: `1500` |
| `ResourceBatchItem` | `resource` | yes | string; pattern: `^[a-z][a-z0-9_]{0,95}$` |
| `ResourceBatchItem` | `target` | yes | one of TerritoryTarget / TerritoryCohortTarget / NamedReferenceTarget |
| `ResourceBatchItem` | `coordinates` | no | object |
| `ResourceBatchItem` | `fields` | no | array of string; max items: `32` |
| `ResourceBatchItem` | `intent` | yes | one of FactsIntent / FixedComparisonIntent / SelectedComparisonIntent |
| `ResourceBatchItem` | `id` | yes | string; min chars: `1`; max chars: `64`; pattern: `^[A-Za-z0-9_-]+$` |
| `TerritoryMember` | `type` | yes | string; one of `commune`, `epci`, `departement`, `region` |
| `TerritoryMember` | `id` | yes | string; min chars: `1`; max chars: `32` |

<!-- END GENERATED API REQUEST INVENTORY -->

## Shared inputs and response rules

### `GET /api/health`

Reports process health only; it does not certify publication readiness.

### `GET /api/resources`

Returns the producer-derived catalogue without opening a database connection.

### `POST /api/resources/read`

Reads one producer-declared resource item. The request grammar is shared with
each item in the batch contract below.

### `POST /api/resources/read-batch`

Executes bounded semantic resource items on one read-only repeatable-read
snapshot; failures reject the request without partial results.

### `GET /api/territories/search`

Searches the retained published territory reference with bounded query inputs.

- The generated inventory above is authoritative for paths, request schemas and
  bounds. `GET /api/resources` returns the producer-derived retained catalogue;
  it does not connect to PostgreSQL.
- `POST /api/resources/read` and `/api/resources/read-batch` use the same typed
  item grammar. Resource identity, target, coordinates, fields and intent are
  validated against producer declarations. Comparisons preflight the complete
  request before any data read. Batch reads share one read-only repeatable-read
  snapshot and return no partial results.
- Producer metadata owns membership, labels, units, axes, source lineage,
  vintages and publication versions. Missing values are not zero; absent, stale
  or incompatible publication dependencies fail closed.
- AEDAR aggregate and fixed-comparison reads are available only through the
  semantic single/batch grammar; the retired source-grain GET routes were
  adapters over the same caller-owned snapshot readers.
  AEDAR comparisons return focal values and their selected reference only:
  direct EPCI/Bretagne aggregates, pooled density-class references, or the
  existing same-level medians. AEDAR peer/rank fields are not selectable.

## Retired route families

Theme/family-specific facts and comparisons, direct indicator/profile/series
reads, owned-dataset reads, legacy scalar-specific cohorts, building-access, essential-services,
the legacy AEDAR GET compatibility routes, and the legacy `/api/read-batch`
request grammar have been retired. Use the producer-derived catalogue and
semantic single/batch read routes for retained resources. Legacy
building/service accessibility and Mobility snapshot-derived read models are
excluded, not aliases for AEDAR resources. This backend change records the
contract boundary; it does not include frontend migration.

## Resource contracts

`api/batch-read-contract.md` documents semantic resource intent and batch
semantics. `api/field-selection-contract.md` documents projection rules, and
`api/resource_catalogue.py` plus generated OpenAPI define the accepted request
shapes. AEDAR source-grain fields and coordinate selectors are declared in
`pipeline/inst/extdata/semantic-resource-contracts.json` (measure registry in
`api/aedar_models.py`) and enforced by the semantic read grammar.
