# Draft design: unified retained-resource serving and publication model

**Status: PROPOSED — owner acceptance required before backend schema, publication or API implementation.**
This is the documentation deliverable for [#795](https://github.com/CalumRob/lusk/issues/795),
child of [#794](https://github.com/CalumRob/lusk/issues/794). The owner-approved
direction is one public resource/read contract, shared publication machinery,
and a few constrained storage shapes—not one universal fact table. Shared typed
single/batch reads are already decided. This document proposes specifics; it
does not amend accepted ADRs, decide catalogue membership, authorize DDL,
production work, or declare any current object safe to drop.

The owner has superseded the former per-theme/service-first execution proposal.
This initiative is **backend only**: pipeline publication, PostgreSQL and the
serving API. Legacy BPE accessibility profiles, snapshot service shares and
their obsolete backend read models are excluded from the target. The owner
accepts breakage of the old non-AEDAR app; backend retirement is not gated on
frontend migration or a replacement for those surfaces. Document affected
caller contracts, but do not edit, migrate, remove or acceptance-test app/UI
code here. The current AEDAR prototype is intended for future production
Mobility after the database is settled; leave its UI, acquisition and data/map
contracts untouched. Earlier conflation of that prototype with retired Variant
E is superseded. AEDAR's INSEE BPE TYPEQU registry remains valid nomenclature.
The design gate remains open for the integrated backend target, not frontend
survival or all proposed candidate approvals.

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
the current AEDAR prototype reader `app/src/fiche/content/aedarApiClient.ts` and
[`structured-consumer-inventory.md`](../structured-consumer-inventory.md) give
checked-in reader evidence. The complete retained coverage and excluded legacy
surface map appears in §4. A current caller is not itself justification to
carry an excluded product into the target.
[`structured-consumer-inventory.md`](../structured-consumer-inventory.md), and
the route/caller map is external audit evidence, not traffic telemetry.

The target removes historical family/owner dispatch without claiming every old
route is unused. Excluded Mobility snapshot/service backend resources are not
preserved merely for old app compatibility. Existing app callers are recorded
only to make contract breaks and later integration impact visible; their
migration or continued operation is not a backend acceptance gate. Do not
relabel legacy values or infer AEDAR equivalents.

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
assembly may compose declared resources and semantic evidence. Existing app
acquisition priority, warming/cancellation and static opt-out are context, not
implementation or acceptance requirements for this backend-only initiative.

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
unknown. **Legacy BPE accessibility-serving resources**—access profiles,
snapshot service shares and derived accessibility read models—are excluded from
discovery and the target; their current code/readers are mapped separately
below. The owner-retained BPE25 B316 fuel-station input for
`bornes_ev_par_station_service` is distinct and explicitly retained. AEDAR's
TYPEQU nomenclature is not legacy-serving code and remains. Resource membership
is determined by producer/domain declarations and owner scope, not guessed from
themes or grep substrings.

### Retained-resource coverage matrix

The grouped matrix below is navigational, not finite proof of completeness. The
source-pinned, member-by-member inventory in
[`serving-resource-catalogue-snapshot.md`](serving-resource-catalogue-snapshot.md)
enumerates every declared theme indicator, its contract class/source,
owner-retained/proposed/excluded/unresolved classification, and the finite selected-
reading/AEDAR measure groups. It records **proposed** survivors only; the owner
gate remains open. The snapshot uses producer metadata maps plus the explicitly
named special publishers, not a second registry. Whole-catalogue acceptance
must rerun that enumeration and account for every source-declared member.

| Resource / semantic case | R producer → canonical metadata/artifact | Current DB facts/descriptor/publication | Current reader → consumer / tests | Proposed target and old-object disposition |
|---|---|---|---|---|
| Territory reference and scalar catalogue (`densite`, ordinary declared measures) | Canonical theme computations and producer descriptors → scalar-serving typed artifacts + declared theme/catalogue metadata | `scalar_descriptor`, `scalar_observation`, source links, territory reference and scalar comparison result/lineage tables; `publish_scalar.R` | `_indicator_facts_snapshot`/comparison readers; app/map/fiche references and current tests are contract-impact evidence, not migration gates | Shared typed scalar shape; resource/measure mapping generated from existing descriptors. Merge/revise scalar tables only if target enforces identical grain and mandatory evidence. Retire/revise superseded backend route adapters as part of the API replacement; no frontend migration required. Territory reference remains a separately versioned dependency also used outside facts. |
| Dense declared profiles (`structure_age`, `distribution_dpe`, other registered dense profiles) | Theme computations + closed metadata axes → `profile-serving/<indicator>/` artifact, DPE scalar binding | `profile_descriptor/axis/observation/source`, profile comparison publications; `publish_profile.R` | Declared backend profile reader/tests plus known app field references for impact documentation | Shared closed coordinate shape where key/completeness/status constraints remain equivalent. Retire superseded backend route/kind and tables when the new contract preserves required DPE dependency/provenance; no app migration gate. |
| Ordered series/states (`conso_enaf_annuel`, OCS `artif_par_habitant`, DVF, raccordement) | Canonical R and owner descriptors → `series-reading/` and `series-serving/` immutable artifacts with revision links | `ordered_series`, series owner/descriptor/revision/source tables, named-reference rows, series comparison projections/markers; `publish_series.R` | Backend series readers/tests; app references listed only for breaking-contract documentation | One ordered shape with typed axis/target and independent owner tokens; retain source revisions per observation. Replace historical API selectors/aliases within the backend workstream; do not collapse clocks or named-reference identity. |
| Sparse period/detail collections (grant facts, economy activity evidence) | `theme_programmes_faits.R`, economy producers and declared schemas → dataset-grain Parquet / typed artifacts | `period_detail_observation`, observed collection descriptor/source and fixed-comparison results; `economy_activity_evidence` where separate | `observed_collections.py`, API comparison readers; `BlocProgrammes.vue` and declared theme consumers; publisher/collection/API tests | Map compatible numeric sparse coordinates to coordinate shape; retain distinct relation/evidence only if an actual key/invariant demands it. Absence remains absence, not zero. Remove old collection-specific adapter when shared item parity holds. |
| Programme membership relation | Programme canonical producer → `programmes_membres` Parquet and source metadata | `anchored_membership`, membership descriptor/marker/source links | `observed_collections.py`; `BlocProgrammes.vue`; membership/publisher tests | Candidate constrained relation shape keyed by territory+programme/anchor, source/vintage attached; no row means no relation. Exact relation-vs-coordinate boundary is an owner tradeoff below. |
| AEDAR aggregate dataset and registered source contract | `aedar_aggregates.R` canonical aggregate + pinned INSEE TYPEQU registry and registered 312-measure metadata → AEDAR artifacts | `aedar_territorial_aggregate`, source/identity metadata and aggregate publication; current `/api/aedar/...` route | The current AEDAR prototype calls `fetchAedarAggregates` for focal/reference data through `TerritoireView.vue`; this is caller-impact evidence, not an app migration requirement. API tests establish backend behavior. | Retain valid AEDAR data, registered measures and TYPEQU contracts in the backend resource model. Future production integration of the current AEDAR prototype is a later app task; leave its UI and acquisition untouched. Document any breaking API contract; do not edit the prototype or infer additional AEDAR products. |
| Independently approved AEDAR data/map contracts | AEDAR owner decisions and domain contracts recorded in `CONTEXT.md`: registered nomenclature, address-grain data semantics and separately approved map/grid definitions | AEDAR source artifacts, map products and their own publication/validation contracts | `CONTEXT.md` sections “Registre TYPEQU BPE 2025”, “Rampe temporelle AEDAR”, “Carte de perte de diversité AEDAR”, “Carte de diversité voiture AEDAR” and “Grille hexagonale AEDAR”; producer/API tests where applicable | Preserve the valid data and backend contracts under their independent approval; do not delete or redefine them by association with legacy accessibility-serving resources. Current prototype UI/acquisition is outside this backend proposal and remains untouched. Not every map product is necessarily a serving-catalogue resource. |
| Historical Variant E label / current AEDAR prototype caller wiring (scope note, not a backend resource) | Existing app route/adapters; no distinct producer or data contract established by that UI label | Existing `TerritoireView.vue` query/watch and AEDAR client wiring have historically been described as Variant E | Caller references identify possible API impact only. The owner clarified this is the current AEDAR prototype intended for future production Mobility; conflating it with retired Variant E was incorrect. | **No app/UI action in this initiative.** Preserve the current AEDAR prototype untouched, including acquisition. Backend decisions follow retained data/resource contracts, not the UI label. Document any changed endpoint contract for later integration; old non-AEDAR frontend breakage is acceptable and not an acceptance gate. |
| AEDAR fixed comparison result | `aedar_aggregates.R` comparison projection from address-grain source facts | AEDAR comparison publication/group/territory/lineage and dependencies | AEDAR comparison reader; consumer traffic is not established by static app inventory; publisher and API tests | Keep distinct semantic result identity and exact source/territory-reference tokens; preserve declared statistic/eligibility/weighting and pooled address-level computation. Document any changed API contract; do not modify the current prototype or gate on caller migration. |
| Unique semantic evidence from retained products (non-legacy) | R-authored typed-reading/artifact producers; per-field canonical descriptor and source/revision inputs | `demographic_typed_reading`, `habitat_typed_reading`, `economy_typed_reading`, `milieux_typed_reading`, `selected_reading_*`, source absence/revision and activity evidence | Theme fact assembly and semantic content; `ThemeContent`, static `modeles_lecture.R`, app read-model selectors; typed-reading artifact/API/validation tests | Audit each field, not each table: move exact duplicate numeric value/status/support to canonical facts; retain only unique semantic selection, absence, period/source-role and lineage needed by active readers. Do not keep an old “theme facts” facade as target. |
| Independent comparison projections (all retained eligible resources) | Scalar/profile/series/collection/AEDAR comparison producers | Shape-specific result/lineage/marker tables | Fixed comparison readers and bounded selected-comparison paths; ADR-0039 tests + shape-specific comparisons | Shared constrained comparison result contract/protocol where grain/statistic fit; retain typed validators for distinct rank/median/mean/pooled/axis rules. Fixed reads select published values; selected requests remain bounded and never recompute R transformations. |
| Static acquisition/readiness metadata and non-fact operations | `publish.R`, `rapport_run.R`, reference/source metadata | Current static artifacts/bootstrap and separate territory/source operations | App acquisition/search/map references are impact inventory only | Not aliases for fact shapes. This initiative does not migrate app acquisition, static registries or UI readiness behavior. Preserve backend source/territory contracts that remain in scope; no static fallback to resource reads. |

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

These field-level source/parity and deduplication checks are engineering
unknowns, not unresolved product/catalogue membership decisions. They do not
reopen any owner's explicit retain/exclude decisions or individually approve
the other proposed catalogue candidates.

### Excluded legacy backend surfaces and caller impact

| Legacy object/field path (excluded from target) | Checked-in publisher/DB/API/reader evidence | Current consumer/dependency (impact evidence only) | Backend disposition and contract impact |
|---|---|---|---|
| `profils_acces_bpe*`, `bpe_access_profile`, `bpe_profile_evidence*` | `artefact_bpe_typequ.R`, `publish_bpe.R`; DB descriptor/class-axis/fact/source tables and marker; BPE profile API/theme projection in `api/main.py` | Existing app payload/read-model callers and `modeles_lecture.R` are impact evidence only; they do not gate backend retirement. | Retire these legacy backend resources/readers. Do not synthesize an AEDAR equivalent for the four access classes/exemplar/mode triplets. Record the removed API contract and downstream impact; old non-AEDAR app breakage is accepted, and later integration is outside this initiative. |
| Legacy Mobility snapshot shares: `share_*`, `iso_*`, `service_share_scalar`, `service_registry`, `essential_service_access`, service source/peer scope | `theme_mobilite.json`, `analytics_mobilite.R`, `publish_scalar.R::project_service_share_scalars()` and `serving_tables.R`; `publier_tables_postgres.R`; service tables/markers and comparison/route adapters in `api/main.py` | Existing app and static-layer callers are listed for contract-impact documentation only; no frontend migration or compatibility is required. | Exclude and retire these backend resources/contracts. AEDAR does not declare the same 5-service×3-mode snapshot, 20-minute building threshold, coverage cutoff or peer-gap reading; do not invent an AEDAR substitution. Record the removed API contract. Old non-AEDAR app breakage is accepted. |
| Legacy BPE/OSM/BDNB equipment ramp/grid and access-distribution read models | `distribution_acces_batiments.R` explicitly takes the legacy BPE TYPEQU snapshot plus OSM/BDNB; `serving_tables.R`, `publish_mobility_distribution.R`, building-comparison producer; DB `building_ramp/grid`, descriptors and `mobility_density_distribution*`; `api/main.py` legacy readers | Existing app payload/read-model references document breaking-contract impact only. `CartographicBreakoutPrototype.vue` is not evidence of this lineage: it receives sharing-network and cycling evidence. | Exclude and retire the legacy BPE/OSM/BDNB backend products and API contracts. AEDAR data/map contracts remain distinct; do not relabel legacy values or invent substitutes. Existing frontend references do not block backend acceptance. |
| Mobility typed-reading/story fields derived from legacy access snapshot (`div_loss_*`, `pct_iso_full_t`, density/decile distribution, access story/salience and `iso_*` mirrors) | `publish_typed_readings.R`, `publish_mobility_distribution.R`, `theme_mobilite.R`; DB `mobility_typed_reading`, story, clock and distribution tables; API theme-facts assembly | Existing theme/content/static-map references are downstream impact evidence; no app edits or consumer-parity gate. | Exclude the legacy-derived semantic backend read models. AEDAR address-grain diversity/loss ramps are distinct from the old building-level snapshot, thresholds, story classification and peer-gap narrative; do not conflate or reconstruct either product. Record affected API fields for later integration; old frontend breakage is accepted. |

These are backend scope decisions, not unresolved UI product questions. Retire
the named legacy accessibility backend resources and document the resulting API
breaks; no frontend removal, migration, replacement, caller parity, or product
disposition is a prerequisite. Do not preserve obsolete backend families merely
to freeze the old app contract. Keep valid AEDAR data, nomenclature and approved
data/map contracts distinct. The current AEDAR prototype—including its existing
UI and acquisition path—is untouched for later production integration; prior
Variant E conflation does not authorize its deletion. Do not invent AEDAR
metrics or a replacement UI.

### Resolved retained B316 dependency

The owner decided to **retain** `bornes_ev_par_station_service` and its official
fuel-station input, distinct from the excluded accessibility snapshot. Its
numerator is Etalab/data.bretagne.bzh's IRVE v2.2.0 `bornes-recharges.csv`
(`https://data.bretagne.bzh/api/explore/v2.1/catalog/datasets/bornes-recharges/exports/csv`), vintage 2026-07, reference 2026-07-28, publication
2026-08-04; it counts distinct `id_station_itinerance` per valid commune, and
rows without a commune code do not enter a communal count. Its denominator is
pinned by
`MANIFEST_MOBILITE_BPE_B316` to the INSEE geolocated detail file
`BPE25.parquet` (`https://www.insee.fr/fr/statistiques/fichier/8217525/BPE25.parquet`, `bpe_b316`), BPE vintage 2025, reference date 2025-01-01,
publication date 2026-08-04, Licence Ouverte 2.0. `lire_bpe_b316()` rejects
another filename; `selectionner_bpe_b316_2025()` uses valid Breton `DEPCOM`
rows to establish coverage before filtering `TYPEQU == B316`, inserts an
explicit zero for a covered commune with no B316 row, and leaves an uncovered
commune without a fuel count. `normaliser_bpe_b316()` sums B316 `NB_EQUIP`
counts per commune; `calculer_ratios_mobilite()` emits `bornes / fuel` only
when the numerator is available and fuel is present and greater than zero.
Thus measured zero fuel is distinct from unavailable source coverage, while
the ratio is unavailable when either input is missing or the denominator is
zero (never coerced to zero). `theme_mobilite.json` binds the ratio to both
`bpe_b316` and `bornes-recharges`.

There are checked-in provenance metadata conflicts to reconcile in the
integrated implementation: `theme_mobilite.json::source_records.bpe_b316`
still declares vintage 2024 / reference date 2024-01-01 / publication date
2026-06-30, while the source manifest and reader pin BPE25 / 2025 / 2025-01-01
/ 2026-08-04. Its `bornes-recharges` source record also declares dates
2026-07-01 / 2026-07-01, while the source manifest pins reference 2026-07-28 /
publication 2026-08-04. These are source-descriptor consistency corrections,
not unresolved product decisions. Preserve actual source provenance and
missingness; do not substitute AEDAR or retire the ratio.

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
   republished. Preserve the owner-retained B316 ratio with the exact source,
   version, coverage/missingness and zero semantics recorded above; do not
   substitute AEDAR.
4. **Complete backend read-contract migration:** route retained single reads and
   batch items through one dispatcher/snapshot executor. Preserve the approved
   API read/snapshot bounds and document breaking endpoint/field contracts for
   later callers. Do not edit or migrate app consumers, alter UI/acquisition, or
   require old-frontend parity. Retain the current AEDAR prototype untouched;
   its later integration is a separate task.
5. **Legacy backend retirement:** retire excluded legacy BPE
   accessibility-serving API, publisher, DB/table, artifacts, fields and
   obsolete read models as part of the backend replacement; frontend
   compatibility is not a prerequisite. Keep the AEDAR dataset, nomenclature,
   current prototype integration, and independently approved data/map contracts
   distinct and untouched by app edits. This retirement scope does not include the owner-retained BPE25
   B316 fuel input or `bornes_ev_par_station_service`; preserve its actual source
   clock, provenance and missingness. Update backend publisher/API contract tests
   and prove retained dependencies independently. No raw-data deletion or live destructive cleanup
   in this brief.
6. **Integrated backend acceptance and merge review:** run the complete guarded test
   suite and semantic parity across every retained resource, shared single vs
   batch outputs, bounded work/response, provenance, missingness, comparisons,
   independent owner versions, snapshot consistency and publication failure
   safety. Check source-to-DB-to-API contract coverage row by row; record known
   caller impact separately without requiring app migration or parity. Verify
   backend resource coverage and legacy backend exclusions. Run
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
| AEDAR data and independent contracts | Pinned TYPEQU registry and registered-measure validation; identity/count/coverage parity and any retained fixed result dependencies preserve address-grain semantics. Independently approved data/map contracts remain under their own validation. Leave current prototype UI/acquisition untouched; no commune-average substitution. |
| Shared request/publication | Same item and payload for single/batch; batch uses one read-only repeatable-read snapshot; all request/item/row-work/response bounds count true work; stale dependency fails closed; no-op, rebind, retry, injected rollback and last-good proofs. |
| Caller impact and API contract | Document changed/removed backend routes, fields and request/response semantics for known callers. No app edits, consumer migration, frontend parity, acquisition-registry/static-path tests, UI tests or UI acceptance gates; old non-AEDAR app breakage is accepted. Do not remove or modify the current AEDAR prototype; document any changed backend contract for its later integration. |
| Excluded legacy backend surfaces and retained B316 | Legacy accessibility profiles, shares, ramp/grid, distribution and derived semantic read models are absent from target discovery/schema/publisher/API. Their retirement is not gated on consumer removal or equivalent product selection. AEDAR data/nomenclature and independent contracts remain distinct. The B316 ratio retains true BPE25 provenance, coverage/missingness and zero semantics. |
| #689 module boundaries | `main.py` becomes a small composition root; justified deep modules own resource validation/discovery, snapshot execution, publication dependency checks and constrained storage access; pass-throughs/obsolete orchestration are removed. Complete imports/deployment package inventory and semantic tests pass in the integrated change. |

The implementation gate itself authorizes no work now: this PR remains
documentation-only. No schema/API/app/R edits, database/R/SSH/production
operations, accepted ADR, merge, issue closure or downstream implementation
issue creation is part of this correction. Detailed execution follows owner
owner acceptance of the corrected backend proposal. The table of frontend
callers is impact documentation, not a product-approval or migration gate.

## 6. Design gate boundaries and implementation recommendations

Already decided and **not reopened**: backend-only pipeline/database/API scope;
no app/UI edits, migration, deletion or acceptance gates; old non-AEDAR app
breakage is acceptable; leave the current AEDAR prototype untouched for later
production integration; shared typed read item for single and
batch; one public resource/read contract; shared publication machinery; a few
constrained storage shapes rather than a universal fact table; retire legacy BPE
accessibility-serving backend resources while retaining valid AEDAR data as a
separate contract; retain `bornes_ev_par_station_service` with its
official BPE25 B316 input, distinct from retired accessibility snapshots; one
accountable integrated implementation;
#689 belongs inside it; production pause. No per-theme resource/workstream
decision or already-resolved B316, AEDAR-prototype or legacy-backend scope is reopened.

No unresolved frontend or product disposition is a gate. The following are
backend design recommendations for the single integrated implementation, not
additional product interviews or separate workstreams:

1. **Sparse membership shape:** engineering recommendation is to retain the
   constrained relation grain unless an implementation proof shows a coordinate
   shape enforces the same key, anchor, source-clock and absence constraints.
2. **AEDAR V1 typedness:** engineering recommendation is the registered 312-key
   measure map validated by publisher and contract tests, preserving source grain
   without a 312× row expansion. Typed columns/children may be revisited only if
   required by evidence during implementation; this is not a separate product
   approval gate.
3. **Frontend impact (not a decision):** old non-AEDAR app breakage is accepted.
   Record changed legacy endpoint/field contracts; do not preserve backend
   resources for compatibility or gate acceptance on UI changes. Leave the
   current AEDAR prototype untouched. Its later production integration is
   outside this initiative. B316 retention is decided; reconcile its source
   metadata to the authoritative manifests during backend implementation.

Engineering recommendations (not reopened choices): resource discovery
projects existing producer/domain descriptors; no second registry or duplicated
app list. Share the publication protocol while retaining distinct owner tokens
and invariant validators. Consolidate marker storage only when ownership,
dependency and failure boundaries prove identical. A closed multi-measure
resource is allowed only where retained producer semantics support it—not as a
legacy-share workaround or because an old batch kind suggests grouping.

Exact table/column names and constraints, named target encoding, individual
typed-reading fields, backend route retirement order, migration DDL and
operational rollback remain engineering details for the integrated design and
review. They are not separate product decisions.
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
