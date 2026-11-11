# Semantic resource batch reads (issues #689 and #797)

`GET /api/resources` exposes the producer-derived retained-resource catalogue.
`POST /api/resources/read` reads one declared item; `POST /api/resources/read-batch`
composes a nonempty collection of such items under one PostgreSQL `READ ONLY REPEATABLE READ`
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
the pooled producer artifact, and EPCI/departement same-level presets read the
Région's own direct published aggregate (« Moyenne de Bretagne »); the retired
same-level median summaries are no longer served. AEDAR publishes no peer or
rank rows: every request-time statistic — including the aggregate-reading ranks
below — is computed per request from published facts in one committed snapshot.
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
focal territory reads and, when explicitly selected, dual-resource `territory_cohort`
facts. The pooled scalar projection and annual ordered-series facts/comparisons are
independent: each keeps its own statistic/value, descriptor, provenance and
publication/reference clocks. For comparison intents, request `axis_comparisons` to
project published series-axis comparisons. On a dual resource, explicitly include
`scalar_facet` to request the pooled comparison and include `member_ranks` only when
both fields are selected; those peer ranks belong to the nested pooled scalar result.
`member_ranks` is not accepted for an ordinary owned-series comparison. The pooled
projection returns the producer-published statistic/value and comparison counts/ranks;
when its available result omits a requested numeric statistic, count or exact peer
rank evidence, or any identity/version/provenance binding is inconsistent, strict
admission fails closed rather than manufacturing or borrowing annual-series values.
Omitting these optional selectors preserves the incumbent dual-shape response and
common-field projection behavior; no fields are silently added to the default response.

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
item in a batch use one read-only repeatable-read snapshot. The
8 MB serialized-response limit still applies; the output cap is enforced after
native response serialization, and any invalid or stale dependency rejects the whole
batch without partial results. There is no independent item-count ceiling:
preflight charges at least one work unit per item in addition to estimated
selected work, and the whole request remains bounded by 200,000 work units.
The AEDAR territorial aggregates and fixed comparisons are read only through
the unified semantic resource contract (`/api/resources/read` and
`/api/resources/read-batch`); the legacy GET routes are retired and return 404.
Legacy
service/building accessibility and Mobility snapshot-derived reading resources
are retired; they are not represented as semantic resources.

## AEDAR selected comparisons

`aedar_territorial_aggregate` also accepts `selected_comparison` on a territory
target with `typequ`/`measure` coordinates. The selection must be same-level as
the focal territory: every member is resolved against the published territory
reference in the same snapshot, and unknown, mistyped, mixed-level or partial
members fail closed (404/422) naming the failed member. For each requested
TYPEQU × measure cell the response returns the group statistic computed per
request: the address-weighted mean of the members' published aggregate values
(weights = published `n_addresses`) — exactly the pooled address aggregate of
the selection, reported as `statistic: "pooled"` with the summed source counts —
for scalar readings and per-cell curve readings alike. The group coverage is
derived from the members' published coverage statuses, never fabricated:
`covered` only when every member is covered; a lesser status is reflected as
published when the members agree on it, and a disagreement has no single
derivable coverage and stays unknown (`null`) rather than being upgraded.
The focal receives
`rank`, `rank_size` and `rank_ties` (opt-in via `fields`) only when it is itself
a member and the measure's producer-declared facet is ranked: a direction-aware
flat ordinal within the selection, ties sharing the rank, using the declared
per-measure facets/directions (`measure_facets` in the catalogue). Unranked
curve readings (min/max) return their group mean with null rank fields; decile
curve readings are ranked since the 2026-11-10 owner decision (#948). One
request reads one committed repeatable-read snapshot; no peer/rank rows are
published (#810 stance intact).

## AEDAR aggregate-reading comparisons (#914)

The 40 registry-wide aggregate readings are the cross-product of the five
displayed modes (`walk`, `transit`, `bike_lts2`, `bike_lts4`, `car`), four
horizons (5, 10, 15, 20 minutes), and diversity/share plus volume/mean. The
separate signed `transit_gain` measure family is not part of this display
inventory. Names are `<mode><horizon>Diversity` or `<mode><horizon>Volume`,
except the existing car/15-minute names `meanDiversity` and `meanVolume`,
which remain compatible. The producer contract declares all 40 as ranked
high-is-better facets alongside the 312 per-cell measures. They use the
existing `measure` coordinate without `typequ`. Direct territorial readings
come from `aedar_territorial_aggregate`, while aggregate peer ranks read the
`aedar_territory_summary` projection (#938); fixed density-class reference
readings are projected from the already-pooled density artifact and published
with the comparison generation. Fixed density requests do not aggregate
TYPEQU rows (#940; the no-peer/rank-row stance in #810 remains intact):

An aggregate reading is available only when the territory's published rows
satisfy the same compatibility law as the fiche's displayed sums (CONTEXT.md
« Moyennes d'accès en voiture AEDAR »): the complete TYPEQU registry is
present, all rows share one source vintage/provenance (`source_id`,
`vintage_id`, `source_url`, `licence`, `attribution`, reference/publication
dates), every row is `covered`, the address population agrees and is positive,
every observed count is valid (`0 ≤ n_observed ≤ n_addresses`, NULL counts as
bad), and every per-type value is a finite number ≥ 0 (≤ 1 for share
readings). Incomplete, uncovered or unknown evidence never becomes a partial
sum or a fabricated zero: the reading is honestly unavailable (null value,
`status: "not_available"`).

The same availability law is applied by the producer to territorial rows and
to the already-pooled density facts before publication. Density summaries bind
to the comparison, AEDAR source, territory-reference, and density-input
identities; missing or stale rows fail closed. `n_observed` is summed over
TYPEQU coordinates and may therefore exceed `n_addresses`; each contributing
TYPEQU observation still has to satisfy `0 ≤ n_observed ≤ n_addresses`.

- `fixed_comparison` keeps each declared context's reference semantics (the
  direct EPCI/Bretagne/Région aggregate, or the published pooled density-class
  summary) and adds the opt-in `rank`/`rank_size`/`rank_ties`: a
  direction-aware flat ordinal of the focal's registry-wide reading within the
  context's resolved peer group (the EPCI's communes, all Breton communes, the
  density class, or the same-level territories), ties sharing the rank. Peers
  whose rows fail the law are ineligible: never converted to zero or ranked,
  and `rank_size` reflects the eligible population.
- `selected_comparison` keeps #859's address-weighted pooled semantics over
  each member's registry-wide reading (weights = published `n_addresses`) —
  exactly the pooled address aggregate of the selection — with the focal rank
  when it is a member and available. Members failing the law contribute no
  comparable value: they are excluded from the pooled statistic and the rank
  (`rank_size` counts the eligible members) while the requested membership
  stays truthful in `scope.member_count`.

### Fixed per-cell comparison ranks (#951)

The same fixed intent serves the three rank fields for **per-cell** measures
(a `typequ` + `measure` request). Owner decision 2026-11-10 supersedes #904's
reference-only boundary for this intent; the aggregate-reading boundary is
unchanged and the selected intent keeps its existing grant. For each requested
`(typequ, measure)`:

- the focal's published value for that cell is read from
  `aedar_territorial_aggregate` in the same snapshot, alongside the declared
  reference (unchanged `group_value`, statistic and versions);
- the peer group is resolved by `_aedar_fixed_peer_ids_cached`, exactly as the
  aggregate ranks resolve it — the focal EPCI's communes, all Breton communes,
  the density class, or the same-level territories — so `epci`,
  `density_class`, `same_level` and `bretagne` share one peer **group** across
  both shapes. The eligible population is not shared, because the two readings
  have different availability laws: a peer's per-cell reading is eligible when
  the producer publishes a finite value for that cell (below), whereas a peer's
  aggregate reading is eligible only when its `aedar_territory_summary` row is
  `available` (complete TYPEQU registry, one provenance, agreeing positive
  address population, valid observed counts — #914/#938);
- one set-wise read of the peer group per comparison item supplies every peer's
  published value for that `(typequ, measure)` — never a per-peer round trip,
  and the preflight work estimate is `1 + |peers|` like the aggregate reading;
- a peer is eligible when the producer publishes a finite value for that cell.
  This is the selected comparison's law: the producer publishes no value for an
  uncovered row (`uncovered_no_address_origins` with no address origin), while a
  genuine `0` is a real reading and stays rankable. Peers without a published
  value are excluded from the rank population — never zeroed, never ranked — and
  `rank_size` counts the eligible peers including the focal; ties share the
  focal's rank (competition ranking);
- an unranked facet (e.g. min/max curve readings; decile curve readings are ranked since #948) or an unavailable focal returns
  `200` with `null` rank fields. The focal's existing `value`/`status`
  semantics are untouched.

Requesting no rank field returns the previous per-cell response exactly: no new
fields are injected into the default projection. Mixing aggregate readings with
per-cell measures in one request, or adding a `typequ` coordinate to an
aggregate reading, is still rejected with `422`.

## Declared-profile comparisons

Indicator comparisons use the existing `fixed_comparison` or
`selected_comparison` intent on a declared profile's territory target.
`fixed_comparison` accepts only the closed `default` context. Coordinates may be
omitted; when explicitly supplied for a detail-backed profile, they must name
every declared axis exactly once (for example, both `detail` and `sex` for an age
pyramid). Omitted coordinates, and coordinates naming the descriptor's published
default detail/sex point, read that published comparison facet unchanged.
Another declared point resolves the same fixed context's canonical cohort and is
computed on request from that cohort's committed published profile cells, with
the same median, direction-aware rank/ties, missingness, per-detail unit,
denominator semantics and source lineage as an identical explicit selection; it
never reinterprets the published default point and creates no publication rows.
The published default keeps its published-comparison version checks; a declared
non-default point keeps the declared-profile and territory-reference checks and
fails closed on missing or stale profile cells (no zero-filled or fabricated
value). An explicitly empty `coordinates` object means no coordinate selection,
just like omission. Unknown axes/values, partial axes and multi-value profile
comparison coordinates are rejected with `422`. A scalar-backed profile such as
the DPE distribution keeps its linked scalar comparison facet: `fixed_comparison`
rejects profile coordinates with `422` because that facet is the linked scalar,
while `selected_comparison` retains its existing coordinate semantics — the
declared profile coordinates are accepted but never reinterpret the DPE bins as
the linked scalar. The fixed-profile result stays compact: `member_ranks` remains
a selected-comparison projection and is rejected with `422` for fixed profile
comparisons, the published default and alternate declared points alike.

`selected_comparison.intent.members` is an ordered, unique list of up to 1,500 typed
`{type,id}` territory identities. The response `selection` echoes those requested
typed identities; the `scope` reports `kind: "explicit_selection"` and
`member_count`, not an invented `scope.territory_type`. The API resolves supported
commune/EPCI/département/région targets through the same published reference to a
bounded set of unique communes. Overlapping parent and commune selections are
deduplicated for calculation; result counts and optional peer rows describe that
resolved population, while the typed selection echo remains the caller's original
selection. The focal `target` remains its own typed identity and may be outside
that population; it is not silently replaced by a selected peer. An explicit
selection may also name exactly one catalogue-owned value for every declared
profile axis (for example, both `detail` and `sex` for an age pyramid) to compare
that declared point over the selected population.

For a selected declared-profile comparison, callers may request
`fields: ["member_ranks"]`. This potentially cohort-sized projection is absent
unless explicitly requested and is not a general field for unrelated resources or
intents. It contains one row per resolved member identity, with API-owned
`rank`, `rank_size`, and `rank_ties` for comparable members, or null rank fields
when that member is not comparable. Those peer ranks come from the selected profile
facet's native comparison or, for a scalar-backed profile, its separately declared
scalar facet—not from client-derived/static ranks. An exact published comparison
scope may reuse its validated published ranks; otherwise the API computes ranks
from the selected facet's native observations. The result's `unit`, direction,
facet, denominator semantics, and comparison-source provenance follow that actual
facet; DPE uses the linked scalar's own unit and source identity, not a DPE-bin
rank. This projection remains subject to the semantic read's existing preflight
work-unit and response-size bounds; it does not create an unbounded peer-list API.

Scalar fixed and selected comparisons also accept the opt-in
`fields: ["member_ranks"]` projection. Each row describes one exact member of the
published fixed group or requested selected population and contains the API-owned
`rank`, `rank_size`, and `rank_ties`; non-measured members have all three fields
null. The API reconciles row identities and measured/missing totals against the
group result and fails closed on incomplete or malformed published evidence.
Fixed comparisons reuse the validated same-level or density-class publication;
selected comparisons use the existing bounded scalar selection calculation.
`member_ranks` does not request or expose `focal_value`, alter the selected
population, or create a new comparison policy. All rows remain subject to the
existing work-unit and output bounds. The catalogue's `sources` list is likewise
producer-derived: it includes exact vintage source IDs where a declared source
record covers multiple distinct territorial snapshots, so app provenance
validation need not infer IDs from names, dates, or page metadata.

The group median is served whenever at least one member is comparable: with
exactly one comparable member the median IS that member's value (singleton median,
#917, owner decision 2026-11-04), exactly like scalar comparisons. Rank fields
(`rank`/`rank_size`/`rank_ties` and peer `member_ranks`) still require at least
two comparable values and stay null below that threshold; with zero comparable
values the comparison is `unavailable` with `fewer_than_two_comparable_values` and
a null median, while selected/eligible/missing counts and typed member identities
remain truthful when requested. The same amended rule applies to numeric
period/detail collection comparisons. Suppressed, unsupported, unavailable, and
unpublished cells are not converted to zero or ranked. Published peer status totals
must reconcile with the group's eligible/missing counts; malformed, incomplete,
stale, or impossible publication evidence, or impossible rank/tie spans fail
closed with `503`.

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
