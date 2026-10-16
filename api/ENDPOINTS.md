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
parameters, not slashes. Query arrays (notably `fields` and `typequ`) are sent
as repeated keys, e.g. `?fields=value&fields=status`. A validation failure
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

Theme/family-specific facts, direct-profile, series-dataset, building-access,
essential-services and legacy batch routes have been retired in favor of the
semantic resource contract. The registered AEDAR aggregate/comparison operations
remain separate because they expose source-grain, measure-keyed producer facts
and published comparison semantics rather than ordinary indicator reads. The
retirement changes backend API paths; no frontend migration or caller edits are
included in this backend change.

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
| `GET` | `/api/aedar/territories/{territory_type}/{territory_id}/aggregates` | Aedar Territorial Aggregates | `territory_type` (path, required: string; one of `commune`, `epci`, `departement`, `region`)<br>`territory_id` (path, required: string; min chars: `1`; max chars: `32`)<br>`typequ` (query, optional: array of string; max items: `100`)<br>`fields` (query, optional: array of string; max items: `313`)<br>`limit` (query, optional: integer; min: `1`; max: `100`; default: `50`)<br>`offset` (query, optional: integer; min: `0`; max: `10000`; default: `0`) | — |
| `GET` | `/api/aedar/territories/{territory_type}/{territory_id}/comparisons` | Aedar Fixed Comparisons | `territory_type` (path, required: string; one of `commune`, `epci`, `departement`)<br>`territory_id` (path, required: string; min chars: `1`; max chars: `32`)<br>`context` (query, required: string; one of `density_class`, `epci`, `bretagne`, `same_level`)<br>`typequ` (query, required: string; min chars: `4`; max chars: `4`)<br>`measure` (query, required: string; min chars: `1`; max chars: `64`)<br>`fields` (query, optional: array of string; max items: `32`) | — |
| `GET` | `/api/territories/search` | Search Territories | `q` (query, required: string; min chars: `1`; max chars: `64`)<br>`limit` (query, optional: integer; min: `1`; max: `50`; default: `8`) | — |
| `GET` | `/api/health` | Health | — | — |

### Request-model properties

These are the model fields reachable from request bodies, including nested and discriminated-union members. `required` is per model; array/string/numeric bounds and defaults come from OpenAPI.

| Model | Property | Required? | Schema |
| --- | --- | --- | --- |
| `ResourceReadItem` | `resource` | yes | string; pattern: `^[a-z][a-z0-9_]{0,95}$` |
| `ResourceReadItem` | `target` | yes | one of TerritoryTarget / NamedReferenceTarget |
| `ResourceReadItem` | `coordinates` | no | object |
| `ResourceReadItem` | `fields` | no | array of string; max items: `32` |
| `ResourceReadItem` | `intent` | yes | one of FactsIntent / FixedComparisonIntent / SelectedComparisonIntent |
| `ResourceBatchRequest` | `items` | yes | array of ResourceBatchItem; min items: `1`; max items: `12` |
| `TerritoryTarget` | `kind` | yes | string; const: `territory` |
| `TerritoryTarget` | `type` | yes | string; one of `commune`, `epci`, `departement`, `region` |
| `TerritoryTarget` | `id` | yes | string; min chars: `1`; max chars: `32` |
| `NamedReferenceTarget` | `kind` | yes | string; const: `named_reference` |
| `NamedReferenceTarget` | `id` | yes | string; min chars: `1`; max chars: `128` |
| `FactsIntent` | `kind` | yes | string; const: `facts` |
| `FixedComparisonIntent` | `kind` | yes | string; const: `fixed_comparison` |
| `FixedComparisonIntent` | `context` | yes | string; const: `default` |
| `SelectedComparisonIntent` | `kind` | yes | string; const: `selected_comparison` |
| `SelectedComparisonIntent` | `members` | yes | array of TerritoryMember; max items: `1500` |
| `ResourceBatchItem` | `resource` | yes | string; pattern: `^[a-z][a-z0-9_]{0,95}$` |
| `ResourceBatchItem` | `target` | yes | one of TerritoryTarget / NamedReferenceTarget |
| `ResourceBatchItem` | `coordinates` | no | object |
| `ResourceBatchItem` | `fields` | no | array of string; max items: `32` |
| `ResourceBatchItem` | `intent` | yes | one of FactsIntent / FixedComparisonIntent / SelectedComparisonIntent |
| `ResourceBatchItem` | `id` | yes | string; min chars: `1`; max chars: `64`; pattern: `^[A-Za-z0-9_-]+$` |
| `TerritoryMember` | `type` | yes | string; one of `commune`, `epci`, `departement`, `region` |
| `TerritoryMember` | `id` | yes | string; min chars: `1`; max chars: `32` |

<!-- END GENERATED API REQUEST INVENTORY -->

## Shared inputs and response rules

- Use the generated inventory above for allowed territory types, identifier
  constraints and all parameter/body bounds. `fields` is resource-owned:
  omission returns the full legacy shape; unsupported/duplicate/empty
  selections are rejected as specified in the
  [field-selection contract](field-selection-contract.md). Identity,
  availability/status, units/axes/order where declared, provenance and
  publication/dependency metadata remain mandatory.
- Comparison selections are caller-chosen lists of typed territory identities,
  subject to the bounds in the generated inventory. Omitted and explicit-empty
  selections remain distinct. This does not provide a configurable SQL,
  predicate, group-query language or persisted group definition.
- Producer metadata owns indicator/theme membership, labels, units, source
  lineage, vintage and publication versions. Independent source clocks and
  publication markers may differ; no shared release version is inferred.
  Missing values are not zero. A route's existence does not mean a required
  publication is available.

## Operations

### Health and bounded discovery

#### `GET /api/health`

Basic process health response; it does not prove that any data publication is
ready. No parameters or request body. Returns a small JSON status object.

#### `GET /api/territories/search`

Search the published territory reference. See the generated inventory for its
required query inputs, bounds and defaults.

Returns matching published territory identities and labels. Example:
`GET /api/territories/search?q=Rennes&limit=5`.

#### `GET /api/building-access/territories`

Returns the bounded published territory choice catalog for building-access
comparisons. No inputs. Its successful body is an object; detailed building
resource shape and availability are described by the building-access routes
and their current producer publication.

### Building access

#### `GET /api/territories/{territory_type}/{territory_id}/building-access`

Initial building-access view for one territory, including its declared default
comparison. Exact allowed types, query values and defaults are in the generated
inventory; non-commune reads use their same-level scope.

Example: `GET /api/territories/commune/22001/building-access?comparison=epci`.
Requires compatible reference, ramp and grid publications. The published shape,
metric and completeness rules belong to the building-access read contract in
the API source/tests; no missing mode/cell should be interpreted as zero.

#### `POST /api/territories/{territory_type}/{territory_id}/building-access-comparison`

Compare an explicit set of published territories for a focal territory. JSON body is a
`BuildingSelection` with `selected`, a non-empty typed list of `{ "type": ...,
"id": ... }` members; exact bounds are in the generated request-model
inventory. Example:

```json
{"selected":[{"type":"commune","id":"22001"},{"type":"commune","id":"22002"}]}
```

Members resolve to distinct communes; overlaps are deduplicated and the server
does not implicitly add or remove the focal territory. The response carries
the selected member set and publication identity. Unknown/unbounded selections
fail closed; fewer than two available members produce a null comparison.

### Theme reads and comparisons

#### `GET /api/territories/{territory_type}/{territory_id}/themes/{theme_id}/facts`

Returns compact published focal facts/profiles for one theme; it is explicitly
not necessarily a complete theme model.

Parameters and constraints are in the generated inventory. Example:
`GET /api/territories/commune/22001/themes/habitat/facts?fields=value`.
See the [theme-read contract](theme-read-contract.md) and
[field-selection contract](field-selection-contract.md) for shapes and
availability. Unsupported/unpublished theme reads do not become empty facts.

#### `POST /api/territories/{territory_type}/{territory_id}/themes/{theme_id}/facts`

Acquires focal theme facts and the selected comparison in one snapshot. The
JSON body is `ThemeComparisonRequest`: required `theme_id` (pattern above),
optional typed `selection` of `{territory_type, territory_id}` objects;
omission selects the published default and `[]` selects nobody). See the
generated inventory for exact query/body constraints. Example:

```json
{"theme_id":"habitat","selection":[]}
```

See the [theme-read contract](theme-read-contract.md). It is a bounded subset,
not an assertion of complete six-theme coverage or consumer activation.

#### `POST /api/territories/{territory_type}/{territory_id}/themes/comparison`

Returns request-scoped theme comparison results. Body is the same
`ThemeComparisonRequest` (required theme ID; omitted selection differs from
`[]`). Exact request schema and bounds are in the generated inventory. Example:

```json
{"theme_id":"mobilite","selection":[{"territory_type":"commune","territory_id":"22001"}]}
```

Response is comparison-only; supported result statistics and status/provenance
are owned by theme comparison resources. Unsupported facets or stale markers
fail closed.

#### `POST /api/territories/{territory_type}/{territory_id}/themes/{theme_id}/comparison`

Comparison-only variant for a path-owned theme ID. JSON body is
`ThemeComparisonRequest`; its body `theme_id` identifies the comparison
resource. Typed selection and omitted-versus-empty semantics are as above; exact
request schema and bounds are in the generated inventory. The response does not include
focal fact payloads; consult the [theme-read contract](theme-read-contract.md).

### Indicator reads and comparisons

#### `GET /api/territories/{territory_type}/{territory_id}/indicators/{indicator_id}`

Stable named-indicator read. The producer descriptor chooses the published
shape; callers do not choose a storage shape or rely on an API-maintained
indicator list. Request schema and bounds are in the generated inventory. Example:
`GET /api/territories/commune/22001/indicators/subventions_annuelles`.
For a profile-shaped indicator, the response can contain the descriptor-owned
profile and default comparison. See field-selection rules and publication
availability in the OpenAPI response and resource contracts.

#### `POST /api/territories/{territory_type}/{territory_id}/indicators/{indicator_id}/comparison`

Compares one indicator identity independent of its theme or shape. Optional
body is `IndicatorComparisonRequest` with optional typed `selection`; omitted
body/selection means the published default, while `[]` means an empty selection.
See the generated inventory for exact request schemas and bounds. Example:

```json
{"selection":[{"territory_type":"commune","territory_id":"22001"}]}
```

Response contains comparison results, not focal facts. See the relevant
resource-specific response and field-selection contracts.

#### `GET /api/territories/{territory_type}/{territory_id}/profiles/{indicator_id}`

Direct declared-profile read for commune, EPCI or département (region is not
accepted). Query schemas, defaults and constraints are in the generated inventory.

Example: `GET /api/territories/commune/22001/profiles/structure_age?comparison_scope=bretagne&fields=value`.
The descriptor owns axes/order, units, source lineage and profile completeness;
the route fails closed on absent/stale/incomplete publication.

#### `GET /api/territories/{territory_type}/{territory_id}/indicator-cohorts/{indicator_id}`

Returns a focal scalar and bounded, versioned peer cohort. Query parameters,
defaults and constraints are in the generated inventory.

No `fields` projection is declared for this endpoint. The cohort is a declared
bounded serving resource, not an arbitrary group query. Use the OpenAPI schema
and scalar resource contract for response details and publication errors.

### Series reads

#### `GET /api/territories/{territory_type}/{territory_id}/series/{indicator_id}`

Read a directly declared annual series. Query parameters, defaults and
constraints are in the generated inventory.
Example: `GET /api/territories/commune/22001/series/demographic_change?scope_level=departement&department_id=22&fields=value`.
The declared axis/order, missingness, provenance and publication contract are
preserved; see field selection and the response contract.

#### `GET /api/series-datasets/{dataset_id}/territories/{territory_type}/{territory_id}/{indicator_id}`

Read an owned dataset series. The generated inventory specifies path identifier
patterns, query parameters/defaults and constraints. Example:
`GET /api/series-datasets/ocs_ge/territories/commune/22001/artif_m2?fields=value`.
Only registered datasets/descriptors are readable; producer lineage and
publication bounds remain mandatory.

### Typed batch reads

#### `POST /api/read-batch`

Composes bounded typed reads in one read-only repeatable-read database snapshot;
the generated inventory gives the request-model item-count bounds.
The body is `BatchReadRequest` with an `items` array. Each item has a unique
request-local `id`, a declared `resource` discriminator and only that resource's
typed parameters. The result envelope is `{"contract":"typed-read-batch-v1",
"results":[{"id":"...","resource":"...","data":{...}}]}`; `data`
retains its single-read shape. Example:

```json
{"items":[
  {"id":"facts","resource":"theme_facts","territory_type":"commune","territory_id":"22001","theme_id":"habitat","fields":["value"]},
  {"id":"peers","resource":"theme_comparison","territory_type":"commune","territory_id":"22001","theme_id":"mobilite","selection":[]}
]}
```

Supported discriminators, detailed per-resource fields, and aggregate limits
are authoritative in the [batch-read contract](batch-read-contract.md). Unknown
resources, duplicate IDs, irrelevant parameters and invalid fields/scopes fail
explicitly; any item failure aborts the entire batch, with no partial result.
The route returns `413` when the combined estimated work or serialized response
exceeds its declared bound. It does not promise lower latency or share one
publication version across different resources.

### AEDAR reads

#### `GET /api/aedar/territories/{territory_type}/{territory_id}/aggregates`

Bounded source-grain AEDAR aggregate read. Query values/defaults and constraints
are in the generated inventory.

Example: `GET /api/aedar/territories/commune/22001/aggregates?typequ=A104&limit=20&fields=measures.count_5_walk_mean`.
The response model is `AEDARTerritorialAggregateResponse`; see
[field-selection contract](field-selection-contract.md) for mandatory
denominators, coverage, source clock and publication metadata.

#### `GET /api/aedar/territories/{territory_type}/{territory_id}/comparisons`

Read one published AEDAR fixed-context comparison. Required query parameters,
allowed values and constraints are in the generated inventory.

Example: `GET /api/aedar/territories/commune/22001/comparisons?context=epci&typequ=A104&measure=count_5_walk_mean&fields=value&fields=rank`.
The route returns the declared fixed comparison, preserving address/coverage
denominators, status, units, source vintage and publication metadata. Unsupported
context/measure combinations or missing/incompatible publication fail closed.

### Compatibility routes

The following four `essential-services` paths are retained compatibility reads
(including the legacy compatibility surface tracked around #619). They are
documented, not deprecated or retired by this change. New field-selection
vocabulary is not added to them; the [field-selection contract](field-selection-contract.md)
records their compatibility status.

#### `GET /api/territories/commune/{territory_id}/essential-services`

The generated inventory specifies the optional comparison query schema.
Returns the existing comparison response for the commune's published
essential-service observations. Peer scope, ranking direction, null handling
and counts follow the existing contract; the scope-member count is distinct
from each metric's comparable count.

#### `GET /api/territories/epci/{territory_id}/essential-services`

No query or body. Compares the EPCI against Breton EPCIs using the retained
compatibility response shape.

#### `GET /api/territories/departement/{territory_id}/essential-services`

No query or body. Compares the département against the four Breton
départements using the retained compatibility response shape.

#### `GET /api/territories/region/{territory_id}/essential-services`

No query or body. Returns the region's own shares; scope, medians and ranks are
null because there is no peer universe. All four paths require the compatible
published access dataset and return the existing typed `ComparisonResponse`.

## Interactive documentation and schema

The public Swagger UI is `/api/docs`; it fetches the same-origin schema from
`/api/openapi.json`. The schema lists registered code contracts, not a guarantee
that a live environment has matching routes or ready publications. No OAuth
flow, database credential or private connection detail is part of this
documentation surface.
