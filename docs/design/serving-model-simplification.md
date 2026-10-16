# Draft design: unified retained-resource serving and publication model

**Status: PROPOSED — owner acceptance required before schema or business-reader changes.**
This is the documentation deliverable for [#795](https://github.com/CalumRob/lusk/issues/795),
child of [#794](https://github.com/CalumRob/lusk/issues/794). The owner-approved
direction is one public resource/read contract, shared publication machinery,
and a few constrained storage shapes—not one universal fact table. Shared typed
single/batch reads are already decided. This document proposes specifics; it
does not amend accepted ADRs, decide catalogue membership, authorize DDL,
production work, or declare any current object safe to drop.

The owner has superseded the former per-theme/service-first execution proposal.
Legacy BPE profiles, snapshot service shares and obsolete read models are
excluded from the target. They may be mapped only to an already-declared
capability with the same product semantics; AEDAR's existing address-grain
aggregates and readings are retained but are not presumed equivalents for the
legacy products. AEDAR's INSEE BPE TYPEQU registry is valid source nomenclature
and remains. The design gate remains open: all target identities, keys,
retirements and replacement mappings below are **PROPOSED**, not approved.

## 1. Resource identity and discovery

### Recommendation (PROPOSED)

Callers name a **published semantic resource**, not a theme, route, physical
shape, publisher, or storage owner. A resource ID identifies a stable retained
subject such as `densite`, `structure_age`, `conso_enaf_annuel`, or AEDAR's
territory×TYPEQU aggregate; it is not a display label or a table name. A resource
may expose a closed declared set of compatible measures when retained producer
metadata establishes that semantic boundary. Discovery is authoritative from
producer descriptors/domain metadata; no per-screen registry is introduced.

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

**Granularity recommendation (PROPOSED):** resource boundaries follow
retained semantic reads and producer-owned declarations. Scalar resources may
remain one measure each where catalogue semantics are independent; genuinely
coherent producer-declared multi-measure resources may return a closed set.
Never infer grouping from a theme, old batch kind, table, or caller convenience.
A series dataset's owner clock is publication metadata, not a caller-selected
`owned_dataset` kind. A named reference has a non-territory target identity.
Fixed comparisons are declared intents/results with exact dependency tokens,
not a storage-family selector. AEDAR aggregates and its pooled/fixed comparison
result have different grains and remain distinct result identities even if
storage shares a constrained result shape. Legacy BPE service-share/profile
identities do not enter discovery or the target catalogue.

### Evidence and consequences

`api/main.py` resolves current facts through scalar/profile/series descriptors,
but `/read-batch` retains nine item kinds mixing operations, resource identity
and historical adapter choice. `api/batch-read-contract.md` documents one
read-only repeatable-read batch snapshot. `app/src/payload/themeAcquisition.ts`,
`app/src/payload/structureAgeProfile.ts`, `app/src/views/IndicateurPage.vue`,
`app/src/fiche/content/aedarApiClient.ts` and
[`structured-consumer-inventory.md`](../structured-consumer-inventory.md) give
checked-in reader evidence. The complete retained coverage and excluded legacy
surface map appears in §4. A current caller is not itself justification to
carry an excluded product into the target.
[`structured-consumer-inventory.md`](../structured-consumer-inventory.md), and
the route/caller map is external audit evidence, not traffic telemetry.

The target removes historical family/owner dispatch without claiming every old
route is unused. Retained acquisition preserves active-theme priority,
independent warming/cancellation and the registered static opt-out; it does not
force all-theme dependencies or add static fallback to API reads. Excluded
Mobility snapshot/service readers are not preserved as target resources. Any
consumer lacking an actual AEDAR equivalent is identified in §4 for owner
product disposition; values are not relabeled or inferred.

## 2. Typed request/result contract

### Request (PROPOSED; conceptual JSON, not a running endpoint)

Use one typed item shape, unchanged between a single read and a batch item.
`resource` is the semantic ID; `target` is a discriminated typed identity;
`fields` is the existing allowlisted logical projection; `intent` is one of the
resource's declared operations. Omission of fields means the full declared
resource result. Existing field-selection rules stay in force: identity,
coordinates/order, availability/status, units, sources, and publication/dependency
metadata are mandatory and cannot be projected away ([field-selection contract](../../api/field-selection-contract.md)).

`coordinates` is an optional, closed, descriptor-controlled selector, not a
second field projection. Each resource descriptor fixes each allowed axis's
value type and finite enum or range, order, cardinality, and default. Omission
selects the full declared axis domain in descriptor order; an explicit
selection selects only listed declared coordinates. A descriptor may declare
an axis required, making omission invalid. Unknown axes/values, wrong types,
empty selections, and incompatible axis combinations are rejected. Coordinates
only select declared fact coordinates; they cannot express SQL predicates,
arbitrary JSON paths, or physical columns. `fields` projects allowlisted value
and descriptive fields; it does not select axis members. Mandatory identity,
selected coordinates/order, status, units, source/provenance, and
publication/dependency tokens are always returned. For AEDAR, `TYPEQU` is a
registered coordinate; measure IDs are allowlisted value fields
(`measures.<id>`), not coordinates. This descriptor rule is identical for all
resources; AEDAR introduces no endpoint-specific grammar.

Examples of the closed descriptor rules (not caller-supplied schemas):

| Resource | Coordinate selector and allowed values | Omission/default and invalid combinations | Identity versus projection |
|---|---|---|---|
| `structure_age` | Optional `detail` from the declared ordered codes `Y_LT15`, `Y15T24`, `Y25T39`, `Y40T54`, `Y55T64`, `Y65T79`, `Y_GE80`; `sex` is `F` or `M`. | Omission returns all 14 cells in descriptor order; either axis may be selected from its closed values. Unknown code/sex, wrong scalar/list type, empty list, or unsupported axis combination rejects. | Resource and territory are identity; selected detail/sex coordinates remain in each returned observation and cannot be omitted with `fields`. Value/status/provenance fields may be projected only as allowed. |
| `aedar_territorial_aggregate` | Optional `typequ`, a string drawn from the pinned 235-code INSEE TYPEQU registry. | Omission returns the full registered TYPEQU domain; explicit selection is a non-empty subset, at most 100 codes under the current API bound. Unknown code or an empty/ill-typed selection rejects. No client-defined mode/horizon axis is accepted: measure IDs encode those producer-registered variants. | Resource, territory and TYPEQU are identity; `fields` selects allowlisted `measures.<registered-id>` values. Counts, coverage, source snapshot and mandatory provenance remain. |
| `aedar_comparison` | Optional `typequ` from that same registry; comparison `context` is an `intent` member, not a coordinate. | Omission uses the declared comparison TYPEQU domain; context must be a declared fixed context. An unregistered context or incompatible coordinate/result selection rejects. | Resource, territory, context and TYPEQU identify the result. Measure is a projected registered result field, never a coordinate; rank/status/count/lineage remain mandatory where declared. |

For all other resources the same descriptor table owns axis type, values,
ordering, default, requiredness, and compatible combinations. Open-ended
selection, where a producer truly declares an ordered series, means selection
from the published axis values—not arbitrary predicates or fabricated missing
coordinates.

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

### Retained-resource examples (PROPOSED)

The same item grammar resolves shape and declared metadata; callers never name
`direct_profile`, `owned_dataset`, or a physical table. For example, scalar
`densite`, dense `structure_age`, ordered `conso_enaf_annuel`, named
`raccordement_reference`, and AEDAR aggregates all use this request form:

```json
{"resource":"densite",
 "target":{"kind":"territory","type":"commune","id":"22001"},
 "fields":["value","status","sources"],
 "intent":{"kind":"facts"}}
```

```json
{"items":[
  {"id":"density","resource":"densite",
   "target":{"kind":"territory","type":"commune","id":"22001"},
   "fields":["value","status","sources"],"intent":{"kind":"facts"}},
  {"id":"age","resource":"structure_age",
   "target":{"kind":"territory","type":"commune","id":"22001"},
   "fields":["observations","axes","sources"],"intent":{"kind":"facts"}},
  {"id":"enaf","resource":"conso_enaf_annuel",
   "target":{"kind":"territory","type":"commune","id":"22001"},
   "fields":["observations","axis","sources"],"intent":{"kind":"facts"}}
]}
```

The identical item may be sent alone or as one batch member. One read returns
its `data`; batch returns equivalent per-item `data` under one read-only
repeatable-read snapshot. `fields` selects only declared optional presentation
fields; identity, coordinates/order, availability/status, units, source/vintage,
observation periods, and relevant independent publication/dependency tokens
remain mandatory. Target, axes, fields and intent are descriptor-bound, not
arbitrary predicates.

Shape examples constrain the model rather than define new routes:

```json
{"resource":"structure_age","target":{"kind":"territory","type":"commune","id":"22001"},"intent":{"kind":"facts"}}
```
returns every declared `detail×sex` coordinate in descriptor order, including
explicit unavailable cells; missing required dense coordinates fail closed.

```json
{"resource":"artif_par_habitant","target":{"kind":"territory","type":"commune","id":"22001"},"intent":{"kind":"facts"}}
```
returns declared M2/M3 state roles with per-observation periods and source
revisions; it does not force one vintage across departments or infer ratio
semantics in SQL. `conso_enaf_annuel` preserves absent years as absent.

```json
{"resource":"raccordement_reference","target":{"kind":"named_reference","id":"<declared-reference-id>"},"intent":{"kind":"facts"}}
```
uses a non-territory identity and cannot be ranked as a territory. A bounded
selection is represented by typed `{type,id}` members and a declared statistic;
the existing 1,500-member ceiling, per-item row-work ceiling, aggregate batch
work and response-byte limits all apply to true resolved work, even when output
fields are projected. Over-bounds reject (413); unsupported resource/field/axis/
intent rejects (422); missing/stale dependencies or incomplete required
publication fails closed (503). Invalid batch member means no partial batch.

AEDAR's example uses its established source grain without promoting TYPEQU to a
free-form axis or treating the BPE registry string as retired serving logic:

```json
{"resource":"aedar_territorial_aggregate",
 "target":{"kind":"territory","type":"commune","id":"22001"},
 "coordinates":{"typequ":"<registered-TYPEQU>"},
 "fields":["measures.<registered-measure>"],"intent":{"kind":"facts"}}
```
The result retains registered measure keys, `n_addresses`, `n_observed`,
coverage and source snapshot identity. AEDAR fixed density-class comparison is
a separate declared result identity/intent at address grain, preserving its
published statistic, eligibility and weighting; it is never an average of
commune aggregates. The illustrative 312-key map is not a license for
unrestricted JSON or SQL-side calculation.

The fixed AEDAR comparison is another item under the same read contract, not a
second physical-family selector. The fixed comparison context is part of
`intent`, consistently with the generic comparison grammar; `coordinates`
selects only registered AEDAR fact axes. The measure is a projected value
field, not an axis:

```json
{"resource":"aedar_comparison",
 "target":{"kind":"territory","type":"commune","id":"22001"},
 "coordinates":{"typequ":"<registered-TYPEQU>"},
 "fields":["measures.<registered-measure>","rank","member_count","eligible_count","missing_count"],
 "intent":{"kind":"fixed_comparison","context":"density_class"}}
```
Its result identifies the resolved group/context and statistic, focal value and
status, rank/rank_size when available, address/observed counts and coverage,
source snapshot, and aggregate/reference/comparison publication tokens. These
values are read from the published address-grain comparison, not recomputed from
territorial aggregates.

Sparse programme membership uses its actual relation semantics:

```json
{"resource":"programme_membership",
 "target":{"kind":"territory","type":"commune","id":"22001"},
 "fields":["relations","sources"],"intent":{"kind":"facts"}}
```
The response is the declared set of membership rows (`sigle`/programme key,
anchor level, `convention_valant_ort`, source and vintage); an empty set means
no recorded relation, not `false`. This resource is non-comparable under the
current contract. Single and batch return the same complete relation set; no
independent membership endpoint or partial result is proposed.

For fixed and selected comparisons, result metadata carries resolved scope,
statistic, denominators/comparable count, ties/rank when declared, exact source
lineage and input owner/reference tokens. Unavailable values are never coerced
to zero; focal unavailable facts have no rank. Each resource retains its own
published comparison semantics; no service-share/car-gap behavior is carried
forward from the excluded legacy product.

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

### Model comparison (PROPOSED)

| Model | What it means | Assessment |
|---|---|---|
| **A — constrained typed cores + shared owner protocol (recommended)** | Scalar, coordinate, ordered and relation shapes only where their keys/enforcement differ; AEDAR source-grain projection; typed published comparison results; one resource discovery/read spec and one publication/dependency protocol. | Best fit to observed retained grains while reducing route, dispatcher and publisher duplication. It permits table consolidation when constraints match; it does not require one table per family. Keeps closed producer metadata and PostgreSQL-enforced keys/completeness where practical. |
| **B — owner package per resource family** | Each owner ships its own artifact/descriptor/facts and bespoke schema/read module, with common HTTP envelope. | Rejected as target: risks reproducing current parallel mechanisms and theme/family ownership in a nicer wrapper; adds registries and consistency work. Keep independently versioned owner tokens, not independently invented read/publication systems. |
| **C — universal nullable/EAV/JSON fact store** | One key/value table or open JSON payload with runtime interpretation. | Rejected: weakens declared axes, relation anchors, completeness, source links, comparison denominators and DB integrity; pushes validation/query joins into callers. AEDAR's closed 312-key source-shaped representation is a bounded exception, not precedent for arbitrary JSON. |

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

| Retained evidence | Proposed constrained target | Key invariant to keep |
|---|---|---|
| Scalar indicator (`densite`, `chomage`, and retained non-legacy Mobility measures) | Typed scalar fact keyed by measure+territory with producer descriptor and per-observation source links | Unit/direction/facet/eligibility; measured zero distinct from null/suppression; support/denominator and provenance. Excludes legacy `share_*`/`iso_*` snapshots. |
| Dense age and DPE axes | Closed coordinate fact with descriptor-owned axis keys/order and completeness | `structure_age` detail×sex cells are complete; DPE distribution cells do not become cross-territory comparisons; `part_passoires` dependency binds by exact scalar version. |
| Ordered/independent clocks | Ordered fact with explicit year/state-role/duration axis and observation-level source revision links | ENAF missing year stays absent; OCS M2/M3 departmental source windows coexist; population, source vintage, observation period and publication time remain distinct. |
| Sparse grants and membership | Sparse coordinate facts for grants; constrained relation fact for anchored programme membership | Missing grant is not €0; missing membership is not false; preserve programme anchor, per-row source/vintage and relation key. |
| Named references | Same ordered fact coordinates with target discriminator `named_reference` | Never confuse with territory fact or assign territory rank; independent publication token. |
| AEDAR aggregate and comparison | Keep source-shaped territory×registered TYPEQU aggregate plus typed comparison-result shape | Preserve INSEE BPE TYPEQU registry, registered measure keys, identity, counts/coverage and address-grain pooling/statistic. Dense illustrative arithmetic: 1,268×235=297,980 rows wide vs 92,969,760 measure rows; not live counts or benchmark. |
| Retained R-authored semantic evidence | Typed semantic/evidence attributes only where not exactly represented by retained facts | Preserve source absence, source/revision role, selected evidence/classification and exact dependency; do not recalculate in SQL/browser. Field-level proof determines duplicates. |

## 4. Complete retained-resource coverage and legacy disposition (PROPOSED)

This is the integrated work order inventory, not approval to drop anything now.
Rows describe source-backed checked-in paths; production traffic/runtime are
unknown. **Legacy BPE is excluded from discovery and the target**; its current
code/readers are mapped separately below. AEDAR's TYPEQU nomenclature is not
legacy-serving code and remains. Resource membership is determined by retained
producer/domain declarations, not guessed from themes or grep substrings.

### Retained-resource coverage matrix

The grouped matrix below is navigational, not finite proof of completeness. The
source-pinned, member-by-member inventory in
[`serving-resource-catalogue-snapshot.md`](serving-resource-catalogue-snapshot.md)
enumerates every declared theme indicator, its contract class/source,
proposed-retained/excluded/unresolved classification, and the finite selected-
reading/AEDAR measure groups. It records **proposed** survivors only; the owner
gate remains open. The snapshot uses producer metadata maps plus the explicitly
named special publishers, not a second registry. Whole-catalogue acceptance
must rerun that enumeration and account for every source-declared member.

| Resource / semantic case | R producer → canonical metadata/artifact | Current DB facts/descriptor/publication | Current reader → consumer / tests | Proposed target and old-object disposition |
|---|---|---|---|---|
| Territory reference and scalar catalogue (`densite`, ordinary declared measures) | Canonical theme computations and producer descriptors → scalar-serving typed artifacts + declared theme/catalogue metadata | `scalar_descriptor`, `scalar_observation`, source links, territory reference and scalar comparison result/lineage tables; `publish_scalar.R` | `_indicator_facts_snapshot`/comparison readers; `themeAcquisition.ts`, `IndicateurPage.vue`, map and fiche readers; `test-publish-scalar.R`, API scalar/comparison contracts and consumer parity | Shared typed scalar shape; resource/measure mapping generated from existing descriptors. Merge/revise scalar tables only if target enforces identical grain and mandatory evidence. Remove duplicate route adapters after all retained callers migrate. Territory reference remains a separately versioned dependency also used outside facts. |
| Dense declared profiles (`structure_age`, `distribution_dpe`, other registered dense profiles) | Theme computations + closed metadata axes → `profile-serving/<indicator>/` artifact, DPE scalar binding | `profile_descriptor/axis/observation/source`, profile comparison publications; `publish_profile.R` | Declared profile reader, profile comparison; `structureAgeProfile.ts`, theme composition; `test-publish-profile*`, API profile/binding tests | Shared closed coordinate shape where key/completeness/status constraints remain equivalent. Retire direct-profile route/kind and old tables only after migrated readers and exact DPE dependency/provenance parity. |
| Ordered series/states (`conso_enaf_annuel`, OCS `artif_par_habitant`, DVF, raccordement) | Canonical R and owner descriptors → `series-reading/` and `series-serving/` immutable artifacts with revision links | `ordered_series`, series owner/descriptor/revision/source tables, named-reference rows, series comparison projections/markers; `publish_series.R` | owned/focal series readers; `IndicateurPage.vue`, Milieux content; series/artifact/comparison tests | One ordered shape with typed axis/target and independent owner tokens; retain source revisions per observation. Remove `direct_series`/`owned_dataset` selectors and route aliases after caller migration; do not collapse clocks or named-reference identity. |
| Sparse period/detail collections (grant facts, economy activity evidence) | `theme_programmes_faits.R`, economy producers and declared schemas → dataset-grain Parquet / typed artifacts | `period_detail_observation`, observed collection descriptor/source and fixed-comparison results; `economy_activity_evidence` where separate | `observed_collections.py`, API comparison readers; `BlocProgrammes.vue` and declared theme consumers; publisher/collection/API tests | Map compatible numeric sparse coordinates to coordinate shape; retain distinct relation/evidence only if an actual key/invariant demands it. Absence remains absence, not zero. Remove old collection-specific adapter when shared item parity holds. |
| Programme membership relation | Programme canonical producer → `programmes_membres` Parquet and source metadata | `anchored_membership`, membership descriptor/marker/source links | `observed_collections.py`; `BlocProgrammes.vue`; membership/publisher tests | Candidate constrained relation shape keyed by territory+programme/anchor, source/vintage attached; no row means no relation. Exact relation-vs-coordinate boundary is an owner tradeoff below. |
| AEDAR aggregates, comparisons, ramp and map resources | `aedar_aggregates.R` canonical aggregate + pinned INSEE TYPEQU registry and registered 312-measure metadata → AEDAR artifacts; `CONTEXT.md` AEDAR ramp/loss/diversity map/grid contracts | `/api/aedar/...`; `TerritoireView.vue` `aedarPrototypeActive` watch / `fetchAedarAggregates`; `VarianteCahierLibreAedar.vue`; `aedarAccessSection.ts::aedarAccessSection`; `aedarTimeRampFacts.ts::aedarTimeRampEvidence`; `VarianteCahierLibre.vue::rampToTimeRampFigureData` → `AccessRampFigureCahier.vue`; map/grid owner contracts in `CONTEXT.md`; publisher/API tests | Retain current AEDAR aggregation, fixed comparison, ramp and owner-approved map/grid semantics, with the active owner acquisition path, under the shared read/publication contract. Preserve TYPEQU and 312 registered measure IDs. These do not replace legacy BPE service profiles/shares or the old mixed-source distribution outputs. |
| AEDAR fixed comparison result | `aedar_aggregates.R` comparison projection from address-grain source facts | AEDAR comparison publication/group/territory/lineage and dependencies | AEDAR comparison reader; consumer traffic is not established by static app inventory; publisher and API tests | Keep distinct semantic result identity and exact source/territory-reference tokens; preserve declared statistic/eligibility/weighting and pooled address-level computation. Audit active callers before adapter deletion. |
| Unique semantic evidence from retained products (non-legacy) | R-authored typed-reading/artifact producers; per-field canonical descriptor and source/revision inputs | `demographic_typed_reading`, `habitat_typed_reading`, `economy_typed_reading`, `milieux_typed_reading`, `selected_reading_*`, source absence/revision and activity evidence | Theme fact assembly and semantic content; `ThemeContent`, static `modeles_lecture.R`, app read-model selectors; typed-reading artifact/API/validation tests | Audit each field, not each table: move exact duplicate numeric value/status/support to canonical facts; retain only unique semantic selection, absence, period/source-role and lineage needed by active readers. Do not keep an old “theme facts” facade as target. |
| Independent comparison projections (all retained eligible resources) | Scalar/profile/series/collection/AEDAR comparison producers | Shape-specific result/lineage/marker tables | Fixed comparison readers and bounded selected-comparison paths; ADR-0039 tests + shape-specific comparisons | Shared constrained comparison result contract/protocol where grain/statistic fit; retain typed validators for distinct rank/median/mean/pooled/axis rules. Fixed reads select published values; selected requests remain bounded and never recompute R transformations. |
| Static acquisition/readiness metadata and non-fact operations | `publish.R`, `rapport_run.R`, reference/source metadata | Current static artifacts/bootstrap and separate territory/source operations | `themeAcquisition.ts`, loader/search/maps, `sources.ts`, header/footer freshness; inventory tests | Not aliases for fact shapes. Migrate retained acquisition callers coherently while preserving theme priority/warming/cancellation/static opt-out. Keep search/readiness separately justified until own contracts and consumers migrate. No static fallback to resource reads. |

Concrete test anchors for the retained rows: scalar—
`pipeline/tests/testthat/test-publish-scalar.R`,
`api/tests/test_scalar_contract.py` and `test_scalar_published_comparison.py`;
profiles—`test-publish-profile.R`,
`api/tests/test_profile_published_comparison.py` and
`api/tests/integration/test_declared_profile_api.py`; series/reference—
`test-publish-series.R`, `api/tests/test_owned_series_contract.py`,
`test_owned_series_published_comparison.py` and
`api/tests/integration/test_fiche_series_routes_http.py`; sparse facts and
membership—`test-publish-observed-collections.R`,
`test-publish-programmes.R`, `api/tests/test_observed_collection_comparison.py`
and `api/tests/integration/test_programme_publisher_http.py`; AEDAR—
`test-aedar-aggregates.R`, `api/tests/test_aedar_contract.py` and
`api/tests/integration/test_aedar_publisher_http.py`; shared comparison/snapshot
and publication safety—`api/tests/test_comparison_provenance_batch.py` and
`api/tests/integration/test_postgres_publication.py`. These are baseline test
anchors to migrate/replace in the integrated change, not a promise to preserve
old route assertions unchanged.

Typed-reading field audit boundary (all are current-schema observations, not
automatic survivors): demographic `periode`, natural/migratory balances and
rates, and `classification` are compared field-by-field with canonical scalar
facts; `groupe/story_key/salience_reason` are producer-selected semantic
evidence, not numeric facts. Habitat `part_passoires` duplicates the scalar
comparison input and must bind to that scalar's exact version rather than be
re-published as an independent value; `part_abc`, `n_dpe`, `classification`,
status and group/story/salience each require exact source/caller comparison.
Economy reading rows carry group/story/status, while `economy_activity_evidence`
is a distinct ranked sparse list (`rank`, `activity_code/label`, `lq`,
`establishment_count`, optional `park_share`) and is not a scalar duplicate.
Milieux rows carry `periode_pop`, `periode_artif`, population delta/rate,
`artif_m2_par_habitant`, `artif_m3_par_habitant`, trajectory and classification;
compare the numeric fields to canonical population/series observations, but
preserve the distinct population revision, M2/M3 per-observation revisions,
periods and `milieux_reading_absence` declarations. `selected_reading_descriptor`
and publication `linked_content_version` is selection/dependency metadata, not a
measurement. The Mobility typed-reading/story fields are legacy-excluded as
listed above, not candidates to retain in a generic semantic resource. Exact
reader field references must be rechecked in code/tests during the integrated
implementation before any column is removed.

### Excluded legacy BPE surface and unresolved product dependencies

| Legacy object/field path (excluded from target) | Checked-in publisher/DB/API/reader evidence | Current consumer/dependency | Disposition and exact unresolved product question |
|---|---|---|---|
| `profils_acces_bpe*`, `bpe_access_profile`, `bpe_profile_evidence*` | `artefact_bpe_typequ.R`, `publish_bpe.R`; DB descriptor/class-axis/fact/source tables and marker; BPE profile API/theme projection in `api/main.py` | `app/src/payload/loader.ts`, `territoryReadModel.ts`, `mobilityThemeApiFacts.ts`; pipeline `modeles_lecture.R` reads `profils_acces_bpe.json`; fixtures/tests | Retire from target. No AEDAR equivalent for the four access classes/exemplar/mode triplets is evidenced; do not synthesize one. Owner decides whether to remove each current product surface or name a specifically evidenced, already-authoritative contract with those exact semantics; the distinct AEDAR product is not presumed a replacement. |
| Legacy Mobility snapshot shares: `share_*`, `iso_*`, `service_share_scalar`, `service_registry`, `essential_service_access`, service source/peer scope | `theme_mobilite.json`, `analytics_mobilite.R`, `publish_scalar.R::project_service_share_scalars()` and `serving_tables.R`; `publier_tables_postgres.R`; service tables/markers and comparison/route adapters in `api/main.py` | `TerritoireView.vue` + `accessApiFacts.ts`, `themeContent.ts`, method indicators/fiche and legacy static JSON/map layers; `modeles_lecture.R` may consume snapshot-derived material | Exclude the share resource and do not preserve/re-publish these IDs as target facts. AEDAR does not declare the same 5-service×3-mode snapshot, 20-minute building threshold, coverage cutoff or peer-gap reading. Owner decides removal of the affected blocks/fields or names a specifically evidenced, already-authoritative contract for their exact semantics; AEDAR's distinct address-grain product is not a presumed substitution. |
| Legacy BPE/OSM/BDNB equipment ramp/grid and access-distribution read models | `distribution_acces_batiments.R` explicitly takes the legacy BPE TYPEQU snapshot plus OSM/BDNB; `serving_tables.R`, `publish_mobility_distribution.R`, building-comparison producer; DB `building_ramp/grid`, descriptors and `mobility_density_distribution*`; `api/main.py` legacy readers | Legacy payload IDs are loaded/validated by `app/src/payload/loader.ts`, `usePayload.ts`, and `territoryReadModel.ts`; API building presentation is adapted in `app/src/fiche/content/mobilityThemeApiFacts.ts`. `CartographicBreakoutPrototype.vue` is **not** evidence of this lineage: `VarianteCahierLibre.vue` calls it with `SharingNetworksEvidence` and `CyclingOfferEvidence` for an exploratory cartographic breakout. Separately, `VarianteCahierLibreAedar.vue` is an active AEDAR owner path, selected by `TerritoireView.vue` via `aedar-proto=1`, and fetches the existing AEDAR endpoint. | Exclude only the legacy BPE/OSM/BDNB ramp/grid/distribution products and their old consumer fields. Keep the active AEDAR aggregate, ramp, fixed-comparison and owner-approved loss/diversity map/hex-grid path in retained coverage; it is not a guessed replacement for the distinct legacy metrics. The actual unresolved question is product disposition of each checked legacy consumer: remove that legacy surface, or name an already-authoritative product contract that covers its specific semantics. Do not ask whether Variant E exists, relabel legacy values, or silently delete a consumer. |
| Mobility typed-reading/story fields derived from legacy access snapshot (`div_loss_*`, `pct_iso_full_t`, density/decile distribution, access story/salience and `iso_*` mirrors) | `publish_typed_readings.R`, `publish_mobility_distribution.R`, `theme_mobilite.R`; DB `mobility_typed_reading`, story, clock and distribution tables; API theme-facts assembly | `ThemeContent`, `OngletTheme.vue`, `themeFactsAdapter.ts`, `modeles_lecture.R`, static map/read-model generation | Exclude those legacy-derived semantic read models from target; field-level retirement inventory must identify all copy/figures/content. AEDAR separately declares address-grain diversity/loss ramps and map readings, but not the same legacy building-level snapshot, thresholds, story classification or peer-gap narrative; do not conflate or reconstruct either product. Owner disposition is removal or a specifically evidenced contract for the exact legacy semantics. |
| Fuel-station count dependency, `stations_service` / official BPE B316, feeding `bornes_ev_par_station_service` | `manifest_mobilite.R::MANIFEST_MOBILITE_BPE_B316` declares official `BPE25.parquet`, vintage 2025, reference date 2025-01-01; `normaliser_mobilite.R::calculer_fuel_communes()` counts valid communal B316 rows; `analytics_mobilite.R::calculer_ratios_mobilite()` derives the ratio; `theme_mobilite.json` registers source `bpe_b316` and scalar ID | `app/src/views/IndicateurPage.vue` / theme acquisition and Mobility indicator/fiche consumers; this is an official input fact and distinct from the excluded access-profile/snapshot products | **UNRESOLVED product disposition only:** retire the ratio/product or approve a specifically evidenced replacement source for that ratio. The BPE25 source fact is already traced and readable; do not ask whether its filename contains BPE, delete it by substring, or silently substitute AEDAR. No AEDAR equivalent for B316 counts/ratio is declared. |

These dependencies are **not** owner questions about whether legacy BPE remains:
legacy serving is excluded. They are precise product decisions caused by
checked callers whose exact legacy semantics have no evidenced AEDAR
equivalent. AEDAR itself already exists and remains in scope, including its
distinct address-grain ramp and mapping products; that does not establish
equivalence. The implementation must not carry old resources forward just to
pass parity tests; tests for those paths must be retired or rewritten only
after the product disposition is recorded. AEDAR's pinned BPE TYPEQU registry
and aggregate measures remain because they are AEDAR's own source nomenclature
and data.

## 5. One integrated implementation brief (PROPOSED; after owner gate)

After approval of this complete target, one accountable Luna writer implements
one coherent API + database + publication replacement across the retained
catalogue and the explicit legacy retirement map. This is one integrated
workstream and one replacement PR—not independent theme campaigns, autonomous
workers, new per-theme contracts, a preliminary family-based split, or a single
unreviewed code dump. Internal tested commits/checkpoints and independent
correctness/standards reviews are required before merge. #689 deep modules are
extracted only where they implement the shared approved responsibilities, in
the same workstream and PR.

### Integrated checkpoints (internal review sequence, not separate issues)

1. **Contract and catalogue freeze:** implement discovery from authoritative
   producer descriptors/domain metadata; typed target/fields/intent/result;
   single and batch invoke the same item reader; all retained resources in the
   coverage matrix are classified once. Pin excluded legacy IDs so they cannot
   accidentally re-enter discovery. No second resource registry, arbitrary
   query language, per-theme endpoint family or physical selectors.
2. **Constrained schema and shared publisher protocol:** implement the smallest
   approved scalar, coordinate, ordered, sparse relation (if approved), AEDAR
   source-grain and comparison result shapes. One shared protocol handles
   descriptor/source validation, exact owner tokens/dependencies, changed/no-op,
   DB-behind retry, rollback/last-good and repeatable-read checks; owner-specific
   completeness/weighting validators remain explicit. Preserve immutable typed
   artifact transport and independent clocks. No global release token or
   mega-transaction.
3. **Complete canonical publisher migration:** update every retained R producer
   and artifact projection to publish through those same approved shapes and
   metadata contracts. Cover all rows in the retained matrix, including unique
   semantic evidence, per-observation source revisions, named references and
   AEDAR registered measures. No legacy BPE profiles/shares/read models are
   republished. Resolve the B316 fuel dependency by recorded owner disposition;
   do not substitute silently.
4. **Complete read and consumer migration:** route all retained single reads and
   batch items through one dispatcher/snapshot executor and migrate all retained
   consumers coherently. Preserve theme acquisition priority, independent
   warming/cancellation, registered static opt-out and no-fallback behavior.
   Remove obsolete aliases/adapters only where the matrix names their consumers
   and removal condition; no permanent compatibility façade.
5. **Legacy retirement / product resolution:** retire excluded legacy BPE API,
   publisher, DB/table, artifacts, fields and obsolete read models only after
   the exact consumer list has a recorded product disposition (remove or a
   specifically evidenced authoritative contract for the same semantics; do
   not presume the distinct AEDAR product is a replacement), tests are updated
   to the approved product result, and all retained dependencies are proven
   independent. No raw-data deletion or live destructive cleanup in this brief.
6. **Integrated acceptance and merge review:** run the complete guarded test
   suite and semantic parity across every retained resource, shared single vs
   batch outputs, bounded work/response, provenance, missingness, comparisons,
   independent owner versions, snapshot consistency and publication failure
   safety. Check source-to-DB-to-reader-to-consumer coverage matrix row by row;
   verify legacy exclusions and unresolved product decisions are closed. Run
   independent Standards/Spec review of the whole integrated diff. Merge only
   after all checkpoints pass and owner approves; production remains separately
   paused/authorized, with backup/recovery and honest real-data performance
   evidence in a later operational gate.

### Integrated acceptance matrix

| Coverage | Required observable proof before integrated PR merge |
|---|---|
| Scalar/profile/coordinate | Canonical value/unit/direction/support/status/provenance parity; zero/null/suppression distinctions; complete ordered axes; DPE exact scalar version binding; comparison facets not fabricated. |
| Ordered/mixed clocks/named references | Correct axis order/roles and absent points; per-observation source revisions/windows; independent publication versions; named reference is non-territory and unranked. |
| Sparse grants/membership/semantic evidence | Omission remains absence; anchors and per-row sources preserved; each retained semantic field exact-source audited; no duplicated values with divergent status/clock. |
| AEDAR aggregate/comparison/ramp/maps | Pinned TYPEQU registry and measure-key validation; identity/count/coverage parity; fixed result dependencies and address-grain pooling/statistic; two time ramps, owner-approved loss/diversity map and occupied-cell grid preserve their own definitions; no commune-average substitution. |
| Shared request/publication | Same item and payload for single/batch; batch uses one read-only repeatable-read snapshot; all request/item/row-work/response bounds count true work; stale dependency fails closed; no-op, rebind, retry, injected rollback and last-good proofs. |
| Acquisition and active callers | All retained consumer inventory rows migrated; active-theme-first, cancellation/warming and static opt-out tests remain; no API static fallback. UI work meets detector/accessibility/design review gates. |
| Excluded legacy BPE | No legacy profiles, shares, ramp/grid snapshot, distribution or derived mobility semantic read model appears in target discovery/schema/publisher. Every named consumer is removed or mapped only to a specifically evidenced authoritative contract with the same semantics; AEDAR's separate active products are retained but are not an implied replacement. The B316 ratio disposition is explicit. AEDAR TYPEQU remains. |
| #689 module boundaries | `main.py` becomes a small composition root; justified deep modules own resource validation/discovery, snapshot execution, publication dependency checks and constrained storage access; pass-throughs/obsolete orchestration are removed. Complete imports/deployment package inventory and semantic tests pass in the integrated change. |

The implementation gate itself authorizes no work now: this PR remains
documentation-only. No schema/API/app/R edits, database/R/SSH/production
operations, accepted ADR, merge, issue closure or downstream implementation
issue creation is part of this correction. Detailed execution follows owner
acceptance of the corrected proposal and closure of the product questions below.

## 6. Owner decisions required to close the design gate

Already decided and **not reopened**: shared typed read item for single and
batch; one public resource/read contract; shared publication machinery; a few
constrained storage shapes rather than a universal fact table; legacy BPE
exclusion in favour of AEDAR; one accountable integrated implementation; #689
belongs inside it; production pause. No per-theme resource/workstream decision
or legacy-retention question is reopened.

The following are the only owner-level tradeoffs this draft asks to resolve;
the rest of the publication/discovery details below are engineering
recommendations, not interview questions:

1. **Sparse membership shape:** accept a dedicated constrained relation shape
   for programme membership, or prefer a declared coordinate shape only if key,
   anchor, source-clock and absence constraints can be enforced equally strongly.
   Engineering recommendation: retain relation grain unless proof demonstrates
   equivalent enforcement with fewer physical shapes.
2. **AEDAR V1 typedness:** accept the registered 312-key measure map, validated
   by R/publisher and contract tests, to preserve source grain and avoid the
   illustrative 312× row expansion; or require a typed-column/typed-child
   design in the integrated target? The current database cannot enforce each
   inner JSON value's type. No storage/latency benchmark is available.
3. **Unmatched product dependencies:** decide product disposition for the
   specifically inventoried legacy service/share/story, legacy BPE profile, and
   legacy BPE/OSM/BDNB ramp/grid/distribution consumer surfaces: remove each
   surface, or name an already-authoritative contract that covers its exact
   semantics. The active AEDAR Variant E and its owner-approved aggregation,
   ramp, comparison, loss/diversity map and grid are already evidenced and
   retained; they are not being proposed as equivalents for the legacy
   products. Separately decide only the unresolved B316 ratio product: retire
   the ratio or approve a traced replacement source. No old semantics or
   invented AEDAR measure may be carried forward.

Engineering recommendations (not reopened choices): resource discovery
projects existing producer/domain descriptors; no second registry or duplicated
app list. Share the publication protocol while retaining distinct owner tokens
and invariant validators. Consolidate marker storage only when ownership,
dependency and failure boundaries prove identical. A closed multi-measure
resource is allowed only where retained producer semantics support it—not as a
legacy-share workaround or because an old batch kind suggests grouping.

Exact table/column names and constraints, named target encoding, individual
typed-reading fields, public legacy-route retirement order, migration DDL and
operational rollback remain engineering proposals after these tradeoffs and
product dispositions are reviewed. They are not implied by accepting direction.
No ADR or domain definition is changed here;
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
