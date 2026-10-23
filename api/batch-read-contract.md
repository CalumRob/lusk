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
| `scalar`, `declared_profile`, `ordered_series`, `period_detail`, `anchored_membership` | A declared territory or `territory_cohort` target; producer-declared coordinates and optional output fields | `facts` |
| `distribution` | A declared territory target; producer-declared coordinates and optional output fields | `facts` |
| `typed_reading` | A territory or `territory_cohort` target and producer-declared reading group (`groupe`) | `facts` |
| `named_reference` | Producer-declared named-reference target and coordinates | `facts` |
| Comparable retained shapes | A declared territory target and a producer-declared comparison context or explicit bounded member selection | `fixed_comparison` or `selected_comparison` |

The catalogue is the source of truth for identifiers, capabilities, field
projection, coordinate values and target levels. AEDAR is a producer-declared
source-grain resource in the same single/batch grammar: `typequ` and `measure`
are coordinates and fixed comparisons use the declared comparison context.
AEDAR reference reads use the canonical territory-reference scope: commune EPCI
and Bretagne values are direct source aggregates, density-class values come from
the pooled producer artifact, and EPCI/departement same-level presets use
published medians. AEDAR does not serve peer rows or ranks.
The four selected-reading resources for Démographie, Économie/Emploi, Habitat,
and Milieux expose the already-published reading facts. Producer-declared ranked
activity evidence, Milieux source absences, and Milieux source bindings are separate
named evidence fields; they do not copy or recompute scalar/series measurements.
Publication markers and territory-reference versions are checked during batch
preflight, and typed rows/evidence are read on the shared repeatable-read snapshot.
Focal scalar, profile, and typed-reading responses expose their publication's
`reference_content_version`; scalar facts also expose the existing
`scalar_descriptor.descriptor_version`. Typed-reading responses include that
publication token, and each returned fact and selected evidence row carries its own
`source` object (`source_id`, name, `vintage_id`, version, reference date, publication date).
Clocks are resolved from that exact source/vintage pair or the row's published
Milieux provenance binding; nullable dates remain `null`. Démographie also returns
its published descriptor version, rate unit, and declared source clock. Habitat
returns its existing selected-reading descriptor and linked publication version.
Missing or incompatible required lineage fails closed with `503`.

For a focal territory, when the producer catalogue declares the same indicator
as both `scalar` and `ordered_series`, `facts` and comparison intents retain the
existing ordered-series response and add a separate `scalar_facet`. Its
`source_facet` is the original indicator identity; it carries the native scalar
descriptor/observation (or comparison result), source evidence, and its own
`content_version`, `reference_content_version`, and `descriptor_version`. A
comparison facet also carries its resolved `selection` and `scope`; fixed
published scalar comparisons include their own `comparison_content_version`.
Annual points and their series publication/descriptor versions remain unchanged,
and no ambiguous top-level scalar `value` is added. Explicit `fields` are
projected independently within each facet while mandatory status, descriptor,
provenance, and publication metadata remain. This additive facet applies to
focal territory reads only; cohort responses and series-only resources keep their
existing contracts.

## Bounded territory cohorts

`territory_cohort` is a closed, facts-only target, not a comparison scope or a
general query language. Its `type` must be declared by the resource. Optional
`department_id` and `epci_id` filters apply only to commune cohorts and intersect
against the published territory reference. The response adds a shared `cohort`
envelope containing the resolved, ordered members and the exact reference version;
facts retain their native family payloads and source/status semantics. Scalar
observations and profile cells keep their actual support, denominator, suppression,
and provenance. Ordered series preserve declared axes and producer missing-record
semantics. Period/detail collections and anchored memberships remain sparse; no
synthetic zero, membership, or rank is added. Typed-reading side evidence is fetched
set-wise for the same cohort. AEDAR source-grain resources and named references do not
accept cohort targets; comparisons remain territory-targeted.

Before any data read, preflight bounds the actual selected members, axes, facts, and
evidence/lineage work within the shared 200,000-unit limit. A single read and every
item in a batch use one read-only repeatable-read snapshot. The existing 12-item
batch and 8 MB serialized-response limits still apply; the output cap is enforced after
native response serialization, and any invalid or stale dependency rejects the whole
batch without partial results.
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
