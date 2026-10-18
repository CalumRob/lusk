# Semantic resource batch reads (issues #689 and #797)

`GET /api/resources` exposes the producer-derived retained-resource catalogue.
`POST /api/resources/read` reads one declared item; `POST /api/resources/read-batch`
composes up to 12 such items under one PostgreSQL `READ ONLY REPEATABLE READ`
transaction. A batch response is
`{"contract":"semantic-read-batch-v1","results":[{"id":"...","data":{...}}]}`.
Each item has a unique request-local `id` plus the same `resource`, typed `target`,
optional declared coordinates/fields, and typed intent as the single-read route.
`data` preserves the single-read payload. Unknown resources, invalid targets,
coordinates, fields, or intents reject before reads; any item failure aborts the
whole request. Batches are bounded by 200,000 preflight work units and 8 MB output.

## Resource shapes and intents

| Resource shape | Target / coordinates | Intent |
| --- | --- | --- |
| `scalar`, `declared_profile`, `ordered_series`, `distribution`, `period_detail`, `anchored_membership`, `named_reference` | Producer-declared target kind and coordinates; optional declared output fields | `facts` |
| `typed_reading` | A territory target and producer-declared reading group (`groupe`) | `facts` |
| Comparable retained shapes | A declared territory target and a producer-declared comparison context or explicit bounded member selection | `fixed_comparison` or `selected_comparison` |

The catalogue is the source of truth for identifiers, capabilities, field
projection, coordinate values and target levels. AEDAR is a producer-declared
source-grain resource in the same single/batch grammar: `typequ` and `measure`
are coordinates and fixed comparisons use the declared comparison context.
The four selected-reading resources for Démographie, Économie/Emploi, Habitat,
and Milieux expose the already-published reading facts. Producer-declared ranked
activity evidence, Milieux source absences, and Milieux source bindings are separate
named evidence fields; they do not copy or recompute scalar/series measurements.
Publication markers and territory-reference versions are checked during batch
preflight, and typed rows/evidence are read on the shared repeatable-read snapshot.
The AEDAR territorial aggregates and fixed comparisons are read only through
the unified semantic resource contract (`/api/resources/read` and
`/api/resources/read-batch`); the legacy GET routes are retired and return 404.
Legacy
service/building accessibility and Mobility snapshot-derived reading resources
are retired; they are not represented as semantic resources.

## Example

```json
{
  "items": [
    {
      "id": "density",
      "resource": "densite",
      "target": {"kind": "territory", "type": "commune", "id": "22001"},
      "intent": {"kind": "facts"},
      "fields": ["value"]
    }
  ]
}
```

`api/ENDPOINTS.md` documents route retirement and points to the semantic
resource contract; `api/resource_requests.py` and the generated OpenAPI schema
are authoritative for the exact request grammar.
