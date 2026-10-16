# Draft design: shared serving resource and constrained publication model

**Status: PROPOSED — owner acceptance required before schema or business-reader changes.**
This is the documentation deliverable for [#795](https://github.com/CalumRob/lusk/issues/795),
child of [#794](https://github.com/CalumRob/lusk/issues/794). The owner-approved
direction is one public resource/read contract, shared publication machinery,
and a few constrained storage shapes—not one universal fact table. Shared typed
single/batch reads are already decided. This document proposes specifics; it
does not amend accepted ADRs, decide catalogue membership, authorize DDL,
production work, or declare any current object safe to drop.

The design gate remains open until the owner accepts (or revises) the proposals
and the consequential choices in §6. Facts below are source-backed observations;
all target names, keys, and retirements are explicitly proposals.

## 1. Resource identity and discovery

### Recommendation (PROPOSED)

Callers name a **published semantic resource**, not a theme, route, physical
shape, publisher, or storage owner. A resource ID identifies a stable semantic
subject such as `densite`, `structure_age`, `artif_par_habitant`, or
`aedar_aggregates`; it is not a display label or a table name. This is the
discovery and authorization unit. A resource declaration owns its public fields,
eligible target kinds, coordinate/axis grammar, availability and missingness
rules, provenance requirements, and declared comparison capabilities.

Keep these concepts separate in metadata:

| Concept | Meaning / owner | Caller-visible? |
|---|---|---|
| Resource identity | Stable semantic read unit; producer descriptor declares one or more measure IDs | Yes |
| Measure identity | Stable fact key (`indicator_id` today), with its own value/descriptor/provenance; may be a member of a multi-measure resource | Returned with each observation |
| Target identity | Typed territory `{type,id}` **or** a declared non-territory identity such as a named reference | Yes; never overloaded |
| Coordinates | Closed, ordered descriptor axes (detail/sex, period, state role, TYPEQU) | Returned as typed facts, not free-form filters |
| Physical shape | One of a small set of typed storage contracts | No |
| Publication owner/token | Coherent producer-owned refresh unit and its independent version | Relevant token returned; owner is not a request selector |
| Theme/group | Product grouping for acquisition and presentation | Discovery facet, not a publication boundary |
| Operation/intent | Facts, a declared fixed comparison, or a bounded explicit selection | Typed request intent, not a resource kind chosen to reach a table |

Discovery is derived from authoritative producer descriptors and registered
domain metadata already used to validate/publish resources. **Do not add a
second hand-maintained resource registry** or duplicate field/resource lists in
the app. API discovery may project this metadata, but never exposes SQL names,
publisher function names, unrestricted JSON paths, or arbitrary axes. Theme
membership and active acquisition registration remain product-owned metadata;
this proposal does not redefine the six canonical themes or acquisition
priority/background warming/static opt-out in [`CONTEXT.md`](../../CONTEXT.md).

**Granularity recommendation:** one resource per coherent semantic read
contract, not mechanically one per scalar key, screen, theme, table, or
operation. Expose the fifteen essential-service shares as one
`mobilite.service_access` resource with a closed service×mode measure set;
preserve each underlying `share_*` `indicator_id` as the measure identity and
its own descriptor, provenance, status and comparison semantics. Do not turn
those measures into fifteen batch items or collapse them into one anonymous
value. `densite` and `structure_age` remain separate semantic resources. A
series dataset's owner clock is publication metadata, not a caller-selected
`owned_dataset` resource kind. A named reference has its own non-territory
target identity. A fixed comparison is a declared result capability of the
resource (or a separately identified published result when it has a different
grain), not a second storage-family choice. AEDAR aggregate and AEDAR comparison
remain distinct semantic resources because one is source-grain data and the
other a published derived result; their namespace alone does not establish
physical separation.

### Evidence and consequences

`api/main.py` already resolves indicator IDs through scalar/profile/series
descriptors, but `/read-batch` retains nine item kinds mixing theme operations,
fact/comparison operations, AEDAR identity, and `direct_profile` versus
`owned_dataset` adapter choice. `api/batch-read-contract.md` documents that
batch preserves single-read payloads and uses one read-only repeatable-read
transaction. `app/src/payload/themeAcquisition.ts`,
`app/src/payload/structureAgeProfile.ts`, `app/src/views/IndicateurPage.vue`,
and `app/src/fiche/content/aedarApiClient.ts` show actual consumers currently
selecting those shapes/routes. For service access,
`pipeline/inst/extdata/theme-metadata/theme_mobilite.json` declares the fifteen
`share_*` member IDs in the Mobilité subgroup, plus labels, sources, directions,
`service_share_scalar` completeness and denominator semantics. The R projector
`project_service_share_scalars()` derives the set from those declared subgroup
indicators, checks a complete 5×3 set and publishes the original IDs as scalar
facts; `service_registry` is a derived projection of that same declaration, not
a second source of truth. `api/main.py` currently reads the 15 values and their
peer facts in one transaction and adapts them into the current
`essential_service_access` response member;
`app/src/views/TerritoireView.vue` applies that complete result via
`applyAccessApiFacts()`. This is evidence for one multi-measure resource item;
no new key list or metadata registry is proposed. The static inventory is in
[`structured-consumer-inventory.md`](../structured-consumer-inventory.md), and
the route/caller map is external audit evidence, not traffic telemetry.

Consequently the target should reduce caller knowledge (no family/owner
dispatch) without claiming that every route is unused. Theme facts may remain a
product aggregation/read model; health, territory search, and bounded building
catalogue operations are not fact-resource aliases. No resource inventory or
active-catalogue survivor list is approved by this proposal.

For the live Mobility theme consumer, the service block is one member-bearing
resource read, not fifteen independent items and not a permanent
`theme_facts`/`essential-services` façade. Other required Mobilité resources
compose with that item in the same shared batch snapshot (or the same single
resource read when no composition is needed); the existing active-theme
acquisition priority, background warming/cancellation and no-fallback behavior
remain unchanged. The 12-item request ceiling is not raised to accommodate the
15 measures. Discovery expands the producer-owned declaration into the closed
member set at read time; it does not copy that set into a route model or app
list. `mobilite.service_access` is a proposed semantic resource ID, to be
declared once in the existing `service_share_scalar` descriptor block; the
member set itself continues to derive from declared subgroup indicators and
their existing per-key metadata. No second resource registry is introduced.

## 2. Typed request/result contract

### Request (PROPOSED; conceptual JSON, not a running endpoint)

Use one typed item shape, unchanged between a single read and a batch item.
`resource` is the semantic ID; `target` is a discriminated typed identity;
`fields` is the existing allowlisted logical projection; `intent` is one of the
resource's declared operations. Omission of fields means the full declared
resource result. Existing field-selection rules stay in force: identity,
coordinates/order, availability/status, units, sources, and publication/dependency
metadata are mandatory and cannot be projected away ([field-selection contract](../../api/field-selection-contract.md)).

```json
{
  "resource": "densite",
  "target": {"kind": "territory", "type": "commune", "id": "22001"},
  "fields": ["value"],
  "intent": {"kind": "facts"}
}
```

The same item in a batch is exactly the same vocabulary; only a request-local
correlation ID is added. A two-item request could be:

```json
{
  "items": [
    {"id": "density", "resource": "densite",
     "target": {"kind": "territory", "type": "commune", "id": "22001"},
     "fields": ["value"], "intent": {"kind": "facts"}},
    {"id": "age", "resource": "structure_age",
     "target": {"kind": "territory", "type": "commune", "id": "22001"},
     "fields": ["value"], "intent": {"kind": "facts"}}
  ]
}
```

For a published comparison, the item asks for a declared fixed context; an
explicit selection is a separate, bounded intent. These are not arbitrary
predicates or grouping expressions:

```json
{"resource":"densite",
 "target":{"kind":"territory","type":"commune","id":"22001"},
 "fields":["value"],
 "intent":{"kind":"fixed_comparison","context":"density_class"}}
```

```json
{"resource":"densite",
 "target":{"kind":"territory","type":"commune","id":"22001"},
 "intent":{"kind":"selected_comparison",
           "members":[{"type":"commune","id":"22002"},
                      {"type":"commune","id":"22003"}]}}
```

### Worked multi-measure service read (PROPOSED)

The exact canonical member IDs are expanded here to make the resource boundary
auditable. This matrix is an example, not a new metadata list; the source of
truth remains `theme_mobilite.json` and its existing validation/projector. The
suffixes map `t→walk_transit`, `b→bike`, and `c→car` as the current R projector
and API adapter do.

| Service coordinate | `t` | `b` | `c` |
|---|---|---|---|
| food | `share_food_t` | `share_food_b` | `share_food_c` |
| health | `share_health_t` | `share_health_b` | `share_health_c` |
| admin | `share_admin_t` | `share_admin_b` | `share_admin_c` |
| school | `share_school_t` | `share_school_b` | `share_school_c` |
| bank | `share_bank_t` | `share_bank_b` | `share_bank_c` |

One conceptual single read (not a proposed URL) requests all five triplets;
`fields` applies the same logical-field selection to every member, never names
physical columns or selects a different storage owner. `value`, `median`, and
`rank` are selectable where declared; measure ID, service/mode coordinates,
status, public `%` unit (stored values remain fractions 0–1), labels,
source/vintage, denominator semantics and publication/dependency tokens remain
mandatory. Default comparison follows current product rules: commune density
class, same-level EPCI/département, no regional peer comparison. An explicit
bounded typed member selection can replace that default without changing the
measure set.

```json
{
  "resource": "mobilite.service_access",
  "target": {"kind": "territory", "type": "commune", "id": "22001"},
  "fields": ["value", "median", "rank"],
  "intent": {"kind": "facts", "comparison": {"kind": "default"}}
}
```

The identical item, with only its batch-local correlation ID added, is a
single batch item:

```json
{
  "items": [
    {"id": "service-access", "resource": "mobilite.service_access",
     "target": {"kind": "territory", "type": "commune", "id": "22001"},
     "fields": ["value", "median", "rank"],
     "intent": {"kind": "facts", "comparison": {"kind": "default"}}}
  ]
}
```

Both forms return the same complete `data`. Shape-level result sketch (one
observation and one per-measure comparison for each listed ID; placeholders are
not fixture values):

```json
{
  "resource": "mobilite.service_access",
  "target": {"kind": "territory", "type": "commune", "id": "22001"},
  "scope": {"kind": "density_class", "member_count": "<resolved count>"},
  "observations": [
    {"measure_id":"share_food_t", "service":"food", "mode":"walk_transit", "fact":"<typed value/status/unit/source>", "comparison":"<median/rank/count>"},
    {"measure_id":"share_food_b", "service":"food", "mode":"bike", "fact":"<typed value/status/unit/source>", "comparison":"<median/rank/count>"},
    {"measure_id":"share_food_c", "service":"food", "mode":"car", "fact":"<typed value/status/unit/source>", "comparison":"<median/rank/count>"},
    {"measure_id":"share_health_t", "service":"health", "mode":"walk_transit", "fact":"<typed value/status/unit/source>", "comparison":"<median/rank/count>"},
    {"measure_id":"share_health_b", "service":"health", "mode":"bike", "fact":"<typed value/status/unit/source>", "comparison":"<median/rank/count>"},
    {"measure_id":"share_health_c", "service":"health", "mode":"car", "fact":"<typed value/status/unit/source>", "comparison":"<median/rank/count>"},
    {"measure_id":"share_admin_t", "service":"admin", "mode":"walk_transit", "fact":"<typed value/status/unit/source>", "comparison":"<median/rank/count>"},
    {"measure_id":"share_admin_b", "service":"admin", "mode":"bike", "fact":"<typed value/status/unit/source>", "comparison":"<median/rank/count>"},
    {"measure_id":"share_admin_c", "service":"admin", "mode":"car", "fact":"<typed value/status/unit/source>", "comparison":"<median/rank/count>"},
    {"measure_id":"share_school_t", "service":"school", "mode":"walk_transit", "fact":"<typed value/status/unit/source>", "comparison":"<median/rank/count>"},
    {"measure_id":"share_school_b", "service":"school", "mode":"bike", "fact":"<typed value/status/unit/source>", "comparison":"<median/rank/count>"},
    {"measure_id":"share_school_c", "service":"school", "mode":"car", "fact":"<typed value/status/unit/source>", "comparison":"<median/rank/count>"},
    {"measure_id":"share_bank_t", "service":"bank", "mode":"walk_transit", "fact":"<typed value/status/unit/source>", "comparison":"<median/rank/count>"},
    {"measure_id":"share_bank_b", "service":"bank", "mode":"bike", "fact":"<typed value/status/unit/source>", "comparison":"<median/rank/count>"},
    {"measure_id":"share_bank_c", "service":"bank", "mode":"car", "fact":"<typed value/status/unit/source>", "comparison":"<median/rank/count>"}
  ],
  "service_comparisons": [
    {"service":"food", "peer_median_car_gap":"<median of peer car−walk_transit differences>", "peer_median_bike_gain":"<median of peer bike−walk_transit differences>"},
    {"service":"health", "peer_median_car_gap":"<...>", "peer_median_bike_gain":"<...>"},
    {"service":"admin", "peer_median_car_gap":"<...>", "peer_median_bike_gain":"<...>"},
    {"service":"school", "peer_median_car_gap":"<...>", "peer_median_bike_gain":"<...>"},
    {"service":"bank", "peer_median_car_gap":"<...>", "peer_median_bike_gain":"<...>"}
  ],
  "publications": "<scalar owner and exact territory-reference dependency tokens>"
}
```

The production shape uses typed values and metadata rather than descriptive
placeholders. Single and batch use the same resource reader and snapshot; batch
returns this whole payload or an error. Unsupported resource/field/intent is
422; stale or incomplete required publication/member set fails closed (503);
request/work or serialized-response bounds reject (413), with no truncation or
partial result. No legacy item kind or bespoke route is needed.

All fifteen comparisons use the same resolved member set and scope token.
For each measure, median and direction-aware rank use that measure's measured
values only; unavailable values are excluded, never converted to zero, and a
rank is absent when the focal value is unavailable or the focal territory is
not in the selected comparison. `scope.member_count` counts resolved members;
per-measure comparable count is distinct and remains visible with the result.
Each service's car-gap and bike-gain reference is the median of member-level
paired differences among members with both measured values, **not** the
difference between the two mode medians. This preserves the existing
`compare()` semantics in `api/main.py`.

**Bound the real work, not just the item count.** This is one logical item, but
preflight charges every member row: for `M` resolved comparison members, at
least `15 × (1 + M)` scalar observation work units, plus descriptor/reference
work. Explicit `M` retains the existing 1,500-member cap; the default set is
counted from the published territory reference in the same snapshot. Also
charge the five car-gap and five bike-gain median calculations across `M`
members (10×M paired-difference operations); those calculations may reuse the
already-counted observations and must not be mistaken for ten more row fetches
per member. Field projection may reduce serialized bytes but never discounts
required input work.
Include the estimate in the existing aggregate batch-work budget without
increasing the 12-item ceiling. Return all 15 measures or fail closed; never
truncate a service/mode triplet.

Context names, permitted member territory kinds, and bounds come from the
resource's published contract. Omitted selection means the declared default;
an explicit empty list means empty. Focal inclusion/deduplication follows the
existing resource semantics, not a common invented rule. Unknown resource,
target, intent, field, incompatible combination, duplicate batch ID, or
out-of-bound request fails explicitly before fact queries where metadata
preflight permits. One invalid batch item aborts the whole batch; there is no
partial result envelope.

### Result and failure (PROPOSED)

Single response is the item `data`; batch returns the same `data` per item under
one outer envelope. The typed result contains resource/target identity,
descriptor and declared axes, observations or result rows, explicit availability
and missingness, source associations, relevant independent publication tokens,
and—when requested—the comparison scope/statistic/denominators/lineage. Example
(illustrative values, not a fixture or API commitment):

```json
{
  "resource":"densite",
  "target":{"kind":"territory","type":"commune","id":"22001"},
  "descriptor":{"unit":"hab./km²","direction":"high"},
  "fact":{"value":123.4,"status":"measured"},
  "sources":[{"dataset_id":"<declared-source>","vintage_id":"<declared-vintage>"}],
  "publications":[{"owner":"<resource-owner>","content_version":"<token>"}]
}
```

Unavailable and absent are not numbers: a suppressed value is `null` plus its
typed reason/support; an unobserved sparse coordinate is absent; a required but
missing dense coordinate invalidates publication; a failed/stale dependency
fails closed. Zero is a measured zero. Errors distinguish invalid request
(422), bounded-work rejection (existing 413 class), and unavailable/stale
publication (existing fail-closed service error); exact codes remain to be
reconciled with the live endpoint contract before implementation. Batch limits
and snapshot behavior begin from the established limits in
[`batch-read-contract.md`](../../api/batch-read-contract.md), not a fresh larger
budget. The current 12-item, selection, row-work and serialized-byte bounds are
not permission for per-item connections or HTTP fan-out.

The proposal does **not** collapse content/theme payloads into a generalized
fact read: it specifies how named resources are fetched. A product-level theme
assembly may compose declared resources and semantic evidence while preserving
active-theme-first acquisition, independent warming/cancellation, retry, and
the explicit static opt-out.

## 3. Constrained physical and publication model

### Recommended physical shapes (PROPOSED)

Favor a small typed-core model (the corrected concrete-options audit's Option
2), not today's table list copied verbatim and not one universal fact table.
The names below are logical shape proposals, not DDL or approved table names.

| Proposed shape | Candidate key and typed columns | Earned constraint / enforcement seam |
|---|---|---|
| `scalar_fact` | `(measure_id, territory_type, territory_id)`; nullable numeric value paired with constrained status/reason; support and denominator; descriptor/source associations | One fact per measure and territory; level/facet/unit/direction, status/value and source checks; zero distinct from null/omission. A single-measure resource can use its measure ID directly; a composed resource maps to multiple measure IDs through producer metadata. |
| `coordinate_fact` | `(measure_id, territory_type, territory_id, axis_key[, secondary_axis_key])`; typed numeric/categorical value, status/support/denominator, optional declared observation period | Closed descriptor-owned axes, order and dense/sparse policy. Age/DPE's detail×sex matrix can be dense; grant/top-activity evidence can be sparse. Axis FK/unique key plus publication-time completeness validation. |
| `ordered_fact` | `(publication_owner, measure_id, target_kind, target_id, axis_key)`; typed axis value/role/order, value/status, observation period; observation→one-or-more immutable source revisions | Ordered points and independently refreshed owners. Preserve absent points and multiple clocks/source revisions per point; named references use a distinct target discriminator and cannot be ranked as territories. |
| `relation_fact` | `(measure_id, territory_type, territory_id, category_or_anchor_id)`; explicit anchor identity, typed relation attributes, source association | Sparse relation semantics, anchor/source FKs, and absence ≠ false. Keep separate unless actual constrained coordinate shape proves equivalent without weakening relation integrity. |
| AEDAR source-grain projection | Existing territory×TYPEQU row, counts/coverage/snapshot and source identity; retain the registered measure-key allowlist and source identity metadata | Avoids the illustrative 312× row expansion and preserves address-grain facts. **PROPOSED V1:** keep the current constrained measure map, validated against the 312-key producer registry; no unrestricted JSON and no SQL/browser calculations. DB cannot type-check each inner value, so publisher parity/schema tests remain mandatory. |
| Comparison result projection | Shared publication/dependency protocol; result keys include measure ID, declared context/group, facet/axis and target; typed status, statistic, value, rank/ties/counts/denominators and lineage | Share result storage only where grain and statistic fit. AEDAR density-class comparison stays address-grain pooled, never an average of commune aggregates. Unsupported statistic/shape combinations fail validation. |

Do not promote table-per-indicator/theme. Do not add nullable `coord1..N`,
unrestricted JSON, EAV, client-defined joins, or physical table/column selectors.
If a future resource cannot satisfy these closed shapes, it must justify a new
shape with its actual key, invariant, source and reader—not with a different
clock alone.

### Shared publication and dependency protocol (PROPOSED)

Reuse immutable typed-artifact transport and the existing transaction/no-op/
retry/rollback guarantees; unify repeated orchestration rather than inventing a
second artifact system. Each coherent publisher owner keeps its own content
token and publication timestamp. One publication transaction stages/validates
facts, descriptor/axes, source associations, row count and meaning-affecting
metadata, then atomically replaces the owned projection and marker. Unchanged
content is a no-op; DB-behind-local is retried; validation/SQL failure leaves
the last complete publication untouched. Related dependencies can commit
together when they are owned by the same transaction. No global release token.

Derived comparisons/readings record exact input owner+token dependencies and
the territory-reference token where it affects membership. Readers use one
read-only repeatable-read snapshot; each dependency must match the declared
publication contract or the read fails closed. Different source vintages and
independent publication clocks may coexist inside that snapshot. A changed
source clock alone does not require a new table or transaction wrapper; only a
different key/completeness/ownership invariant does. Descriptor rebinds and
reference changes cannot silently mix with facts. Cross-owner publication is
not claimed atomic: preserve last-good result and fail closed until dependencies
are republished.

Candidate seams already exist in `api/schema.sql` (`table_publication`,
`series_dataset_publication`, comparison publication tables, typed source links)
and `pipeline/R/publish_series.R`'s owner-scoped changed/no-op/retry logic.
`pipeline/R/aedar_aggregates.R` and the typed artifact publishers provide other
examples. The design goal is a shared publication helper/protocol with explicit
owner-specific validation, not one mega-transaction or a global theme release.
Exact marker-table consolidation is PROPOSED and depends on review of every
current marker's owner, dependencies and retry behavior; none is deleted here.

### Concrete shape mappings

| Evidence case | Proposed target mapping and invariants |
|---|---|
| Scalar and service multi-measure resource | `densite` → `scalar_fact`, one territory key, descriptor unit/direction, null+status/support, source link. `mobilite.service_access` returns all 15 scalar observations in one item; each original `share_*` `indicator_id` remains a measure ID, not a separate resource ID, with its own descriptor/source/status. The set is generated from existing metadata, not a new list. |
| Age and DPE axes | `structure_age` → `coordinate_fact`, closed age×sex axes with declared order and dense completeness; DPE signature uses its registered category axis and exact `part_passoires` scalar dependency for comparison. Do not compare bin profiles or fabricate missing cells. |
| Ordered/mixed clocks | Annual `conso_enaf_annuel` uses ordered year points; OCS-GE `artif_par_habitant` uses named M2/M3 state roles and per-observation department-specific source revisions/periods; population and annual consumption clocks remain distinct. Missing year stays missing. |
| Sparse grants/membership | Grant facts can use sparse period/detail coordinates with amount/year/programme/source; no row is not zero. Programme membership is a relation with `sigle`, explicit ORT attribute and source; no row is not false. Merge those only if anchor/category and source-clock constraints remain enforceable. |
| Named references | `raccordement_reference` uses a reference target ID plus ordered axis/value/source; it is not a territory observation, receives no territory rank, and its source/publication token remains independent. |
| AEDAR wide/address grain | Keep one source-shaped territory×TYPEQU aggregate with 312 registered measures and address/observed counts/coverage. The corrected arithmetic for a dense 1,268×235 example is 297,980 wide rows versus 92,969,760 measure rows (312×); illustrative Cartesian arithmetic only, not live row counts, storage, or benchmark. Fixed density-class comparison pools address-grain inputs and preserves declared statistic/eligibility/weighting. |
| R-authored semantic evidence | Typed readings remain only for fields not exactly represented in canonical facts or needed as R-authored semantic evidence: classifications/story keys, selected evidence, source absence, clock roles and source/revision links are candidates. Repeated numeric projections are candidates for removal only after field-level active-caller and dependency proof. Never casually recompute a semantic decision in SQL/browser. |

## 4. Old-to-proposed disposition and deletion conditions

This matrix is a work-order map, **not** deletion approval. The references are
checked-in source paths; listed consumers establish current source use, not
production traffic. `Retain` means retain through a verified migration unless
later evidence changes the decision.

| Current object / seam | Proposed disposition | What can actually disappear; exact condition |
|---|---|---|
| `scalar_descriptor`, `scalar_observation`, scalar source links; `publish_scalar.R`; scalar routes | Retain or evolve into `scalar_fact`; route adapters resolve resource metadata | Remove duplicate routes/response normalization only after all scalar/theme/service callers use the same item and parity proves values, status, source, unit, support and scope. No blanket scalar-table deletion. |
| `share_*` scalar measure IDs, `service_share_scalar` descriptor, `service_registry`, `essential_service_access`, `publish_service_share_scalars()` and service read adapters | Keep the 15 `share_*` IDs as per-measure facts; expose the closed set as one `mobilite.service_access` resource derived from the existing Mobilité metadata | Move the actual Mobility service/theme consumer to the shared resource item and prove all 15 members, per-measure metadata, comparisons and atomic snapshot. Then remove the dedicated adapter/route and any service-only registry projection only when no remaining reader/publisher needs it; do not remove canonical measure identities or duplicate the member list. |
| `profile_descriptor/axis/observation`, profile publisher and `/profiles/{id}` | Merge/evolve into `coordinate_fact`; preserve closed axes and completeness | Remove direct-profile adapter after `structureAgeProfile.ts` and other identified callers migrate; only retire old axis/fact tables after canonical parity and all active readers, tests and publication dependencies move. |
| `ordered_series`, `series_dataset_*`, provenance revisions, named references and both series routes | Evolve to `ordered_fact` owner publications; preserve independent owner/revision clocks and reference identity | `direct_series`/`owned_dataset` batch discriminators and route path ownership can disappear after caller selection is descriptor-resolved. Delete legacy series descriptor/fallback or owner tables only after all readers and active publications are inventoried, including ENAF and raccordement; no same-vintage shortcut. |
| `period_detail_observation`, `anchored_membership`, observed collection descriptors/markers/comparison | Candidate merge numeric period/detail into `coordinate_fact`; retain relation shape for membership pending proof | Delete collection-specific tables/reader only after grants and membership have correct sparse absence, anchors, source vintages, result parity, and no consumer depends on old response. No merge on naming alone. |
| `aedar_territorial_aggregate`, AEDAR comparison tables, `/aedar/*`; `aedar_aggregates.R`; `aedarApiClient.ts` | Retain source-grain resource and distinct comparison result; use shared request/publication protocol | AEDAR route namespace/adapter may be normalized after consumer migration. Retain field-key registry; no pivot, row expansion or comparison retirement without address-grain parity and consumer audit. Current app aggregate caller is established; comparison traffic is unknown. |
| `building_ramp`, `building_grid`, evidence descriptors, building API and Variant E prototype | Retain constrained evidence shapes for now; share publication/read protocol only where it simplifies real code | Do not fold into generic indicators. Delete old shape only if target preserves ramp weighted-mean vs grid pooled-count rules, axes, sentinels/status, denominator, sources and prototype consumer parity. API route map's lack of a direct app fetch is not retirement proof; `CartographicBreakoutPrototype.vue` is a named consumer. |
| `*_typed_reading`, `selected_reading_*`, economy activity evidence, Milieux source/absence and Mobility clock/story metadata | Field-by-field: merge exactly duplicated measurements; retain unique semantic/evidence relations or replace only when equivalent canonical R facts serve all active consumers | Delete each column/table/publisher only when a checked consumer/dependency map proves the field reconstructs exactly from surviving canonical facts or is unused, including `ThemeContent`, static read models, artifact validation and R readers. A story/clock/absence field is not redundant because a numeric value overlaps. |
| `table_publication` plus owner-specific publication/selected-reading/comparison markers | Candidate shared publication/dependency protocol | Consolidate a marker only where owner, content hash inputs, retry/no-op, reference binding and failure boundary are identical. Keep independent clocks. Remove marker after all readers/publishers and schema dependencies move; never infer redundancy from duplicate timestamps. |
| Nine current `/read-batch` resource kinds and single routes | Replace with one typed item vocabulary; keep single and batch as equivalent forms | Historical `theme_facts`, `theme_comparison`, `direct_profile`, `direct_series`, `owned_dataset` are not target public vocabulary. Migrate named app callers and any public consumers; remove aliases only after consumer/traffic review, endpoint parity and deployment/recovery gate. Existing health/search/building catalogue remain separately justified. |
| Theme-grouped/static payloads, acquisition registry, legacy static paths | No change in this design; acquisition semantics remain owner-approved | Remove static artifact or loader only after every active consumer (including search, maps and `modeles_lecture.R`) migrates and the explicit opt-out contract is deliberately handled. No static fallback is added to API reads. |

Active checked-in caller evidence includes theme acquisition in
`app/src/payload/themeAcquisition.ts`; age profile in
`app/src/payload/structureAgeProfile.ts`; multiple direct/owned series paths in
`app/src/views/IndicateurPage.vue`; AEDAR aggregates in
`app/src/fiche/content/aedarApiClient.ts`; programmes in `BlocProgrammes.vue`;
and semantic theme/content/read-model consumers in
[`structured-consumer-inventory.md`](../structured-consumer-inventory.md).
`api-route-caller-map.md` and audit prose are external evidence, not canonical
repository documentation. No current route is called dead solely because a
static grep found no app fetch.

## 5. Smallest useful proof and dependency-ordered follow-ons

### First vertical proof after the design gate (PROPOSED)

Use **`mobilite.service_access`**, not a convenient single scalar. It is an
active consumer-backed, canonical multi-measure resource and directly tests
whether the proposed granularity solves the 15-measure/12-item mismatch. Take
only the minimum contract/discovery, shared item dispatch and publication
helper needed to complete this one vertical proof; there is no preliminary
framework or platform phase.

1. Derive the exact 15 measure IDs and their service/mode coordinates from
   `theme_mobilite.json` using the existing R projection rule. Preserve the
   IDs, independent per-measure descriptors and source/vintage metadata, dense
   5×3 completeness, fraction 0–1 values/public `%` unit, denominator,
   availability, comparison and gap semantics.
2. Publish the canonical facts through the minimum shared publisher seam to
   **guarded PostgreSQL**. Prove changed commit, unchanged no-op, DB-behind
   retry, injected failure/last-good, reference and publication dependencies.
3. Read all 15 measures with one typed item in the single-read form and the
   identical item in batch. Both return the full result or fail; the active
   theme batch includes all required resource items under one read-only
   repeatable-read snapshot and is contract-tested to fit within 12 items.
   Account at least `15 × (1 + M)` observation work units for `M` resolved
   peers plus the 10×M derived paired-difference operations in the existing
   work budget. Keep the 12-item ceiling; service access is one item, not
   fifteen.
4. Migrate the actual Mobility service/theme consumer to that result in a
   reversible, named transition. The acceptance fixture composes the complete
   set of resources the active consumer needs in one batch, derived from
   producer-owned metadata, and proves that set stays within 12 items; if it
   does not, revise the resource grouping before implementation rather than
   raising the cap or fanning out requests. Preserve active-theme priority,
   background warming/cancellation, retry/no-static-fallback, and the five
   service triplets, their per-measure metadata, peer medians/ranks, car-gap
   and bike-gain median semantics in the same coherent snapshot.
5. Acceptance is observable: descriptor-derived member-set parity for all 15 IDs;
   complete row set/no duplicates; value/status/unit/denominator/provenance
   parity; target and peer comparison parity; single-vs-batch payload parity;
   snapshot and stale/failure proofs; exact estimate and response-byte bounds;
   migrated caller coverage. Unsupported field/intent is rejected, partial
   service triplets never return, and the old adapter has a named removal
   condition.

Implement only the justified deep-module seams needed by this vertical slice
alongside it under #689; do not split out reusable framework work merely because
the slice reveals a seam. Extract further helpers alongside a later vertical
slice when another real shape proves the need. No parallel whole-codebase or
family-based refactor. No first schema or business-reader change before owner
acceptance. This design task itself
authorizes no PostgreSQL test, production database, deployment, R startup, or
runtime operation.

### Follow-on sequence (PROPOSED; detailed issues only after gate)

| Order | Vertical slice and observable acceptance | Required test evidence / retirement condition |
|---|---|---|
| 1 | **Scalar resource** (`densite` or evidence-selected active scalar) through a real consumer; reuse only the first slice's justified shared seams. | Canonical value/status/unit/source parity; zero/null/suppressed fixtures; snapshot and stale marker tests. Retire only the migrated caller's adapter. |
| 2 | **Coordinate and semantic evidence** (`structure_age`, DPE + scalar binding; then typed-reading field audit). Add module seams with the implementation. | Dense axis/order/completeness and unavailable-cell proofs; exact DPE dependency; field-level semantic evidence parity. Remove only duplicate columns with no active reader/dependency. |
| 3 | **Ordered clocks and named references** (ENAF, OCS M2/M3, raccordement; DVF as applicable). | Order, absent points, multi-source revision lineage, independent owner clocks, named reference identity, selected comparison semantics; remove legacy fallback/route only after all readers are accounted for. |
| 4 | **Sparse relation/collection and AEDAR** (grants/membership; AEDAR aggregate then comparison). | Absence≠zero/false; anchor/source; AEDAR registered measure set, 312× cost guard and address-grain density-class parity. Retire old adapters only after app and non-app consumers migrate. |
| 5 | **Building evidence and remaining actual resources**; implement justified #689 deep-module seams alongside these vertical slices, not as a parallel refactor. | Preserve ramp weighted mean, grid pooling, declared axes and prototype consumers. Remove obsolete monolith/adapter responsibilities only after parity and caller search. No preparatory family-based file split. |
| 6 | **Release readiness** (separate authorization): full parity, mechanically synchronized docs, representative honest timings, backup/recovery and serial production plan. | No merge of operational plan implies deployment approval; production remains paused until separately owner-authorized. |

At every slice, keep semantic regression coverage while replacing tests that
only freeze an old route/table implementation. UI-touching work must follow
[`AGENTS.md`](../../AGENTS.md)'s UI review/detector requirements. Do not create
implementation issues until owner accepts the model and dependency graph.

## 6. Owner decisions required to close the design gate

Already decided and **not reopened**: shared typed read item for single and
batch; one public resource/read contract; shared publication machinery; a few
constrained storage shapes rather than a universal fact table; production pause;
#689 follows this gate and is implemented alongside vertical slices. #689 is a
native child blocked by #795, not a preliminary family-based refactor.

The following are the only owner-level tradeoffs this draft asks to resolve;
the rest of the publication/discovery details below are engineering
recommendations, not interview questions:

1. **Service resource granularity:** accept one `mobilite.service_access`
   resource item with a closed 15-measure set derived from existing
   `theme_mobilite.json` metadata, preserving each `share_*` measure identity,
   or is there a concrete independent consumer/semantic boundary requiring a
   different resource split? This determines whether the active theme consumer
   fits the unchanged 12-item batch limit without a permanent legacy façade.
2. **Sparse membership shape:** accept a dedicated constrained relation shape
   for programme membership, or prefer the coordinate shape only if its key,
   anchor, source-clock and absence constraints can be enforced just as
   strongly. The recommendation is to retain the relation shape; the question
   is whether its extra physical shape is worth its native integrity boundary.
3. **AEDAR V1 typedness:** accept the registered 312-key measure map, validated
   by R/publisher and contract tests, to preserve source grain and avoid the
   illustrative 312× row expansion; or require a typed-column/typed-child
   design before the first AEDAR slice? The current database cannot enforce
   each inner JSON value's type. No storage/latency benchmark is available.

Engineering recommendation (not an owner tradeoff): resource discovery
projects the existing pipeline/domain descriptors and product-owned theme
metadata; no second registry or app-maintained member/field list is added.
Use one shared publication protocol with separate tokens for coherent owners;
retain owner-specific marker constraints where needed and consolidate marker
storage only after source/dependency evidence proves identical boundaries.
Implement only the minimum of that seam in the first vertical slice.

Catalogue survivors, exact table/column names and constraints, named target
encoding, individual typed-reading fields, old route/table retirement order,
migration DDL and operational rollback remain engineering proposals after these
choices and field/caller evidence are reviewed. They are not implied by
accepting the direction above. No ADR or domain definition is changed here;
after approval, draft edits to ADR-0035/0038/0039, ADR-0037 if publication
wording changes, and `CONTEXT.md` can be proposed and reviewed deliberately.

## Evidence and source map

Repository contracts read for this proposal:

- [`api/schema.sql`](../../api/schema.sql): scalar/profile/ordered/collection,
  owner-series, reading, AEDAR and comparison tables/constraints.
- [`api/batch-read-contract.md`](../../api/batch-read-contract.md),
  [`api/field-selection-contract.md`](../../api/field-selection-contract.md),
  [`api/theme-read-contract.md`](../../api/theme-read-contract.md), and
  [`api/ENDPOINTS.md`](../../api/ENDPOINTS.md): current typed reads, limits,
  required metadata, snapshot and public route contracts.
- [`docs/adr/0035-serving-grains-and-scoped-comparisons.md`](../adr/0035-serving-grains-and-scoped-comparisons.md),
  [`docs/adr/0037-publish-tables-independently-from-r.md`](../adr/0037-publish-tables-independently-from-r.md),
  [`docs/adr/0038-common-indicator-serving-contract.md`](../adr/0038-common-indicator-serving-contract.md),
  and [`docs/adr/0039-published-comparison-aggregates.md`](../adr/0039-published-comparison-aggregates.md):
  accepted invariants and boundaries, not evidence that the proposed target
  shapes or exact survivors have already been accepted.
- [`docs/structured-consumer-inventory.md`](../structured-consumer-inventory.md)
  and [`CONTEXT.md`](../../CONTEXT.md): named consumers, product acquisition
  rules and semantic ownership.
- `pipeline/R/publish_series.R`, `pipeline/R/aedar_aggregates.R`,
  `pipeline/R/publish_typed_artifact.R` (transport),
  `api/main.py`, `api/observed_collections.py`,
  `app/src/payload/themeAcquisition.ts`,
  `app/src/payload/structureAgeProfile.ts`,
  `app/src/views/IndicateurPage.vue`, and
  `app/src/fiche/content/aedarApiClient.ts` (publisher/read/caller examples).

The local evidence reports `E:\Temp\opencode\794-serving-model-audit.md`,
`794-concrete-model-options.md` (corrected AEDAR arithmetic), and
`api-route-caller-map.md` informed questions but are hypotheses, not authority.
Their local row counts/arithmetic are not production row counts, traffic,
benchmarks, or migration capacity evidence. `E:\Lusk\public\data` is the
canonical local resource location; this worktree has no real data. No absence,
freshness, or runtime claim is inferred from that fact. Production runtime and
schema remain outside this documentation proposal.
