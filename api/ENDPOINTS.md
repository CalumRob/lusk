# API endpoint reference

This reference covers business routes registered by the current FastAPI app.
The exact methods, paths, parameter schemas and request models are derived from
`app.openapi()`; [`test_public_api_docs.py`](tests/test_public_api_docs.py)
checks that every operation is represented below. The live schema at
`/api/openapi.json` is authoritative when a detail changes. Response schemas for
several read routes are intentionally generic dictionaries in OpenAPI; this
reference points to the resource contracts instead of inventing a stronger
response guarantee.

All paths below include the `/api` prefix. Path placeholders are literal
parameters, not slashes. Query arrays (notably `fields` and `typequ`) are sent
as repeated keys, e.g. `?fields=value&fields=status`. A validation failure
normally returns `422`; an unknown territory/resource/indicator is generally
`404`; an absent, stale or incompatible publication dependency fails closed
with `503`. Individual operations may have additional documented errors.

## Shared inputs and response rules

- `{territory_type}` is one of `commune`, `epci`, `departement`, `region` where
  the operation allows it. `{territory_id}` is the producer-published
  identifier (1–32 characters where constrained by the schema).
- Indicator IDs match `^[a-z][a-z0-9_]{0,95}$`; theme IDs match
  `^[a-z][a-z0-9_]{0,63}$`. Other path identifiers follow each route's
  OpenAPI schema.
- `fields` is an optional repeated query parameter, with at most 32 entries
  except AEDAR aggregates (313). Omission returns the full legacy shape. A
  supplied non-empty selection is resource-owned; unsupported/duplicate/empty
  selections are rejected as specified in the
  [field-selection contract](field-selection-contract.md). Identity,
  availability/status, units/axes/order where declared, provenance and
  publication/dependency metadata remain mandatory.
- Comparison selections are typed territory identities, not arbitrary SQL or
  caller-defined groups. Explicit selections are bounded at 1,500 territories;
  omitted and explicit-empty selections are distinct.
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

Search the published territory reference.

| Input | Required | Contract |
| --- | --- | --- |
| `q` query | yes | 1–64 characters |
| `limit` query | no | 1–50; default `8` |

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
comparison. Allowed territory types: commune, EPCI, département, région.

| Input | Required | Contract |
| --- | --- | --- |
| `comparison` query | no | `densite`, `epci`, or `bretagne`; default `densite` (commune behavior); non-commune reads use their same-level scope |

Example: `GET /api/territories/commune/22001/building-access?comparison=epci`.
Requires compatible reference, ramp and grid publications. The published shape,
metric and completeness rules belong to the building-access read contract in
the API source/tests; no missing mode/cell should be interpreted as zero.

#### `POST /api/territories/{territory_type}/{territory_id}/building-access-comparison`

Compare an explicit set of published territories for a focal territory.
Allowed territory types: commune, EPCI, département, région. JSON body is a
`BuildingSelection` with `selected`, a non-empty typed list of `{ "type": ...,
"id": ... }` members (1–1,500). Example:

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

| Input | Required | Contract |
| --- | --- | --- |
| `comparison` query | no | `densite`, `epci`, or `bretagne` when supported by that theme/territory |
| `fields` query | no | repeated, up to 32; resource-owned projection |

Example: `GET /api/territories/commune/22001/themes/habitat/facts?fields=value`.
See the [theme-read contract](theme-read-contract.md) and
[field-selection contract](field-selection-contract.md) for shapes and
availability. Unsupported/unpublished theme reads do not become empty facts.

#### `POST /api/territories/{territory_type}/{territory_id}/themes/{theme_id}/facts`

Acquires focal theme facts and the selected comparison in one snapshot. The
JSON body is `ThemeComparisonRequest`: required `theme_id` (pattern above),
optional `selection` (up to 1,500 `{territory_type, territory_id}` objects;
omission selects the published default and `[]` selects nobody). The repeated
`fields` query parameter has a maximum of 32. Example:

```json
{"theme_id":"habitat","selection":[]}
```

See the [theme-read contract](theme-read-contract.md). It is a bounded subset,
not an assertion of complete six-theme coverage or consumer activation.

#### `POST /api/territories/{territory_type}/{territory_id}/themes/comparison`

Returns request-scoped theme comparison results. Body is the same
`ThemeComparisonRequest` (required theme ID, optional typed selection up to
1,500; omitted default differs from `[]`). Optional repeated `fields` query
parameter (max 32) projects comparison output. Example:

```json
{"theme_id":"mobilite","selection":[{"territory_type":"commune","territory_id":"22001"}]}
```

Response is comparison-only; supported result statistics and status/provenance
are owned by theme comparison resources. Unsupported facets or stale markers
fail closed.

#### `POST /api/territories/{territory_type}/{territory_id}/themes/{theme_id}/comparison`

Comparison-only variant for a path-owned theme ID. JSON body is
`ThemeComparisonRequest`; its body `theme_id` identifies the comparison
resource. Optional repeated `fields` query parameter (max 32). Typed selection
and omitted-versus-empty semantics are as above. The response does not include
focal fact payloads; consult the [theme-read contract](theme-read-contract.md).

### Indicator reads and comparisons

#### `GET /api/territories/{territory_type}/{territory_id}/indicators/{indicator_id}`

Stable named-indicator read. The producer descriptor chooses the published
shape; callers do not choose a storage shape or rely on an API-maintained
indicator list. Optional repeated `fields` query parameter (max 32). Example:
`GET /api/territories/commune/22001/indicators/subventions_annuelles`.
For a profile-shaped indicator, the response can contain the descriptor-owned
profile and default comparison. See field-selection rules and publication
availability in the OpenAPI response and resource contracts.

#### `POST /api/territories/{territory_type}/{territory_id}/indicators/{indicator_id}/comparison`

Compares one indicator identity independent of its theme or shape. Optional
body is `IndicatorComparisonRequest` with optional typed `selection` (up to
1,500); omitted body/selection means the published default, while `[]` means an
empty selection. Optional repeated `fields` query parameter (max 32). Example:

```json
{"selection":[{"territory_type":"commune","territory_id":"22001"}]}
```

Response contains comparison results, not focal facts. See the relevant
resource-specific response and field-selection contracts.

#### `GET /api/territories/{territory_type}/{territory_id}/profiles/{indicator_id}`

Direct declared-profile read for commune, EPCI or département (region is not
accepted). Optional query parameters:

| Input | Contract |
| --- | --- |
| `comparison_scope` | `bretagne`, `departement`, `epci`; default `bretagne` |
| `comparison_scope_id` | optional 1–32 character scope identity |
| `fields` | repeated, max 32; resource-owned projection |

Example: `GET /api/territories/commune/22001/profiles/structure_age?comparison_scope=bretagne&fields=value`.
The descriptor owns axes/order, units, source lineage and profile completeness;
the route fails closed on absent/stale/incomplete publication.

#### `GET /api/territories/{territory_type}/{territory_id}/indicator-cohorts/{indicator_id}`

Returns a focal scalar and bounded, versioned peer cohort. Query parameters:

| Input | Contract |
| --- | --- |
| `scope_level` | commune, EPCI, département or région; default `commune` |
| `department_id` | optional, 1–8 characters |
| `epci_id` | optional, 1–16 characters |

No `fields` projection is declared for this endpoint. The cohort is a declared
bounded serving resource, not an arbitrary group query. Use the OpenAPI schema
and scalar resource contract for response details and publication errors.

### Series reads

#### `GET /api/territories/{territory_type}/{territory_id}/series/{indicator_id}`

Read a directly declared annual series. Optional query parameters: `scope_level`
(commune/EPCI/département/région; default `commune`), `department_id` (1–8
characters), `epci_id` (1–16 characters), and repeated `fields` (max 32).
Example: `GET /api/territories/commune/22001/series/demographic_change?scope_level=departement&department_id=22&fields=value`.
The declared axis/order, missingness, provenance and publication contract are
preserved; see field selection and the response contract.

#### `GET /api/series-datasets/{dataset_id}/territories/{territory_type}/{territory_id}/{indicator_id}`

Read an owned dataset series. `dataset_id` and `indicator_id` follow the
lowercase identifier pattern. Query parameters: `scope_level` (commune/EPCI/
département/région; default `commune`), optional `department_id` (1–8 chars),
`epci_id` (1–16 chars), `comparison_detail` (1–32 chars), and repeated
`fields` (max 32). Example:
`GET /api/series-datasets/ocs_ge/territories/commune/22001/artif_m2?fields=value`.
Only registered datasets/descriptors are readable; producer lineage and
publication bounds remain mandatory.

### Typed batch reads

#### `POST /api/read-batch`

Composes 1–12 typed reads in one read-only repeatable-read database snapshot.
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

Bounded source-grain AEDAR aggregate read; territory type may be commune, EPCI,
département or région.

| Input | Contract |
| --- | --- |
| `typequ` | optional repeated code list, max 100 entries |
| `fields` | optional repeated resource-owned fields, max 313 |
| `limit` | 1–100 rows; default `50` |
| `offset` | 0–10,000; default `0` |

Example: `GET /api/aedar/territories/commune/22001/aggregates?typequ=A104&limit=20&fields=measures.count_5_walk_mean`.
The response model is `AEDARTerritorialAggregateResponse`; see
[field-selection contract](field-selection-contract.md) for mandatory
denominators, coverage, source clock and publication metadata.

#### `GET /api/aedar/territories/{territory_type}/{territory_id}/comparisons`

Read one published AEDAR fixed-context comparison. Territory type is commune,
EPCI or département. Required query parameters:

| Input | Contract |
| --- | --- |
| `context` | `density_class`, `epci`, `bretagne` or `same_level` |
| `typequ` | exactly four characters |
| `measure` | 1–64 characters |
| `fields` | optional repeated resource-owned fields, max 32 |

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

Optional `comparison` is `densite`, `epci` or `bretagne`, default `densite`.
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
