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

## Declared-profile comparisons

Indicator comparisons use the existing `fixed_comparison` or
`selected_comparison` intent on a declared profile's territory target.
`fixed_comparison` accepts only the closed `default` context and reads the
profile descriptor's published default comparison facet. Coordinates may be
omitted; when explicitly supplied for a detail-backed profile, they must name
every declared axis exactly once and match that same default detail/sex point.
They are a consistency filter, not an override. An alternate profile facet is
requested with `selected_comparison`; omit `coordinates` to use the declared
default, or provide exactly one catalogue-owned value for every declared profile
axis (for example, both `detail` and `sex` for an age pyramid). Unknown
axes/values, partial axes, and multi-value profile comparison coordinates are
rejected with `422`. A scalar-backed profile such as the DPE distribution keeps
its linked scalar comparison facet: DPE bins remain profile facts and are never
reinterpreted as the linked scalar.

`selected_comparison.intent.members` is an ordered, unique list of up to 1,500 typed
`{type,id}` territory identities. The response `selection` echoes those requested
typed identities; the `scope` reports `kind: "explicit_selection"` and
`member_count`, not an invented `scope.territory_type`. The API resolves supported
commune/EPCI/département/région targets through the same published reference to a
bounded set of unique communes. Overlapping parent and commune selections are
deduplicated for calculation; result counts and optional peer rows describe that
resolved population, while the typed selection echo remains the caller's original
selection. The focal `target` remains its own typed identity and may be outside
that population; it is not silently replaced by a selected peer.

For a selected declared-profile comparison, callers may request
`fields: ["member_ranks"]`. This potentially cohort-sized projection is absent
unless explicitly requested and is not a general field for unrelated resources or
intents. It contains one row per resolved member identity, with native published
`rank`, `rank_size`, and `rank_ties` for comparable members, or null rank fields
when that member is not comparable. Those peer ranks come from the selected profile
facet's native comparison or, for a scalar-backed profile, its separately declared
scalar facet—not from client-derived/static ranks. The result's `unit`, direction,
facet, denominator semantics, and comparison-source provenance follow that actual
facet; DPE uses the linked scalar's own unit and source identity, not a DPE-bin
rank. This projection remains subject to the semantic read's existing preflight
work-unit and response-size bounds; it does not create an unbounded peer-list API.

At least two measured/eligible values are required for a declared-profile median
and rank. Below that threshold the comparison is `unavailable` with
`fewer_than_two_comparable_values`; median and focal/peer ranks are null, while
selected/eligible/missing counts and typed member identities remain truthful when
requested. Suppressed, unsupported, unavailable, and unpublished cells are not
converted to zero or ranked. Published peer status totals must reconcile with the
group's eligible/missing counts; malformed, incomplete, stale, or impossible
publication evidence, or impossible rank/tie spans fail closed with `503`.

Profile, scalar, and territory-reference publications have independent clocks.
Profile comparison responses bind `profile_content_version` and
`reference_content_version`; scalar-backed comparisons additionally bind the
linked scalar's required/content version. The legacy-shaped global
`content_version` may be null or unrelated and is not a substitute for those
dependencies. Do not synthesize a global release token or a territory type on an
explicit-selection scope. These comparison reads remain inside the existing
bounded, read-only repeatable-read grammar; they add no endpoint, query language,
publication mutation, or schema.

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
