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
| Resource identity | Stable semantic subject; pipeline descriptor or domain-owned canonical metadata | Yes |
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

**Granularity recommendation:** one resource per semantic fact/result contract,
not one per screen, theme response, table, or operation. A scalar indicator and
each of the fifteen service/mode `share_*` facts remain distinct resource IDs;
the current service response can compose them. A series dataset's owner clock
is publication metadata, not a caller-selected `owned_dataset` resource kind.
A named reference has its own non-territory target identity. A fixed comparison
is a declared result capability of the resource (or a separately identified
published comparison resource where it has a different grain), not a second
storage-family choice. AEDAR aggregate and AEDAR comparison remain distinct
semantic resources because one is source-grain data and the other a published
derived result; their namespace alone does not establish physical separation.

### Evidence and consequences

`api/main.py` already resolves indicator IDs through scalar/profile/series
descriptors, but `/read-batch` retains nine item kinds mixing theme operations,
fact/comparison operations, AEDAR identity, and `direct_profile` versus
`owned_dataset` adapter choice. `api/batch-read-contract.md` documents that
batch preserves single-read payloads and uses one read-only repeatable-read
transaction. `app/src/payload/themeAcquisition.ts`,
`app/src/payload/structureAgeProfile.ts`, `app/src/views/IndicateurPage.vue`,
and `app/src/fiche/content/aedarApiClient.ts` show actual consumers currently
selecting those shapes/routes. The static inventory is in
[`structured-consumer-inventory.md`](../structured-consumer-inventory.md), and
the route/caller map is external audit evidence, not traffic telemetry.

Consequently the target should reduce caller knowledge (no family/owner
dispatch) without claiming that every route is unused. Theme facts may remain a
product aggregation/read model; health, territory search, and bounded building
catalogue operations are not fact-resource aliases. No resource inventory or
active-catalogue survivor list is approved by this proposal.

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
| `scalar_fact` | `(resource_id, territory_type, territory_id)`; nullable numeric value paired with constrained status/reason; support and denominator; descriptor/source associations | One fact per territory; level/facet/unit/direction, status/value and source checks; zero distinct from null/omission. |
| `coordinate_fact` | `(resource_id, territory_type, territory_id, axis_key[, secondary_axis_key])`; typed numeric/categorical value, status/support/denominator, optional declared observation period | Closed descriptor-owned axes, order and dense/sparse policy. Age/DPE's detail×sex matrix can be dense; grant/top-activity evidence can be sparse. Axis FK/unique key plus publication-time completeness validation. |
| `ordered_fact` | `(publication_owner, resource_id, target_kind, target_id, axis_key)`; typed axis value/role/order, value/status, observation period; observation→one-or-more immutable source revisions | Ordered points and independently refreshed owners. Preserve absent points and multiple clocks/source revisions per point; named references use a distinct target discriminator and cannot be ranked as territories. |
| `relation_fact` | `(resource_id, territory_type, territory_id, category_or_anchor_id)`; explicit anchor identity, typed relation attributes, source association | Sparse relation semantics, anchor/source FKs, and absence ≠ false. Keep separate unless actual constrained coordinate shape proves equivalent without weakening relation integrity. |
| AEDAR source-grain projection | Existing territory×TYPEQU row, counts/coverage/snapshot and source identity; retain the registered measure-key allowlist and source identity metadata | Avoids the illustrative 312× row expansion and preserves address-grain facts. **PROPOSED V1:** keep the current constrained measure map, validated against the 312-key producer registry; no unrestricted JSON and no SQL/browser calculations. DB cannot type-check each inner value, so publisher parity/schema tests remain mandatory. |
| Comparison result projection | Shared publication/dependency protocol; result keys include resource, declared context/group, facet/axis and target; typed status, statistic, value, rank/ties/counts/denominators and lineage | Share result storage only where grain and statistic fit. AEDAR density-class comparison stays address-grain pooled, never an average of commune aggregates. Unsupported statistic/shape combinations fail validation. |

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
| Scalar | `densite` → `scalar_fact`, one territory key, descriptor unit/direction, null+status/support, source link. Fifteen service/mode shares remain fifteen scalar resource identities; API composition may preserve the existing `essential_service_access` response. |
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

### First vertical proof (PROPOSED)

Choose one **active scalar resource** with canonical projection, required
provenance and a real app consumer—recommend `densite` after verifying the
current fixture/canonical metadata and consumer path. It minimizes shape
variables while proving resource identity, shared publication and typed read;
selection is evidence-driven, not an implementation commitment. Prove in one
vertical slice:

1. canonical R/Parquet projection + pipeline-owned descriptor/discovery metadata;
2. guarded PostgreSQL publication with validated grain/source/token and
   transactional changed/no-op, DB-behind retry, injected failure/last-good;
3. identical one-item and batch-item fact payloads in one read-only
   repeatable-read snapshot, bounded fields and fail-closed stale dependency;
4. migrate one actual consumer behind an explicit reversible seam, preserving
   active-theme priority/cache/cancellation and no static fallback; and
5. parity for value, zero/null/status, unit/direction, provenance and relevant
   publication versions, with before/after caller coverage.

No first DDL should begin until owner accepts the shape/contract. No production
database, deployment or test-only DB action is authorized in this design task.

### Follow-on sequence (PROPOSED; issues only after gate)

| Order | Vertical slice and observable acceptance | Required test evidence / retirement condition |
|---|---|---|
| 0 | **Contract foundation:** discovery from authoritative metadata; shared typed item parser/read dispatcher; common publication/dependency helper. | Contract tests reject unknown resource/field/axes/intent, physical selectors and over-bounds; transaction tests prove no-op/retry/rollback, fail-closed dependencies and same item result in single/batch. Only redundant dispatcher/publication wrappers retire after their callers use the helper. |
| 1 | **Scalar proof** (`densite` or evidence-selected active scalar) through real consumer. | Canonical value/status/unit/source parity; zero/null/suppressed fixtures; snapshot and stale marker tests. Retire only the migrated caller's adapter. |
| 2 | **Coordinate and semantic evidence** (`structure_age`, DPE + scalar binding; then typed-reading field audit). | Dense axis/order/completeness and unavailable-cell proofs; exact DPE dependency; field-level semantic evidence parity. Remove only duplicate columns with no active reader/dependency. |
| 3 | **Ordered clocks and named references** (ENAF, OCS M2/M3, raccordement; DVF as applicable). | Order, absent points, multi-source revision lineage, independent owner clocks, named reference identity, selected comparison semantics; remove legacy fallback/route only after all readers are accounted for. |
| 4 | **Sparse relation/collection and AEDAR** (grants/membership; AEDAR aggregate then comparison). | Absence≠zero/false; anchor/source; AEDAR registered measure set, 312× cost guard and address-grain density-class parity. Retire old adapters only after app and non-app consumers migrate. |
| 5 | **Building evidence and remaining actual resources**; #689 deep-module boundaries implemented alongside these vertical slices. | Preserve ramp weighted mean, grid pooling, declared axes and prototype consumers. Remove obsolete monolith/adapter responsibilities only after parity and caller search. No preparatory family-based file split. |
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

The following choices are genuinely consequential and remain **PROPOSED**:

1. **Physical core boundary:** accept the small typed-core recommendation
   (`scalar`, closed `coordinate`, owner-scoped `ordered`, sparse `relation`,
   AEDAR source-grain exception, plus comparison results), or require a
   different evidence-backed boundary? In particular, is membership a
   permanent relation shape or can its current anchor/source contract be
   expressed in a closed coordinate shape without weakening constraints?
2. **AEDAR V1 typedness:** accept the registered 312-key measure map, validated
   by R/publisher and contract tests, to preserve source grain and avoid the
   illustrative 312× row expansion; or require a typed-column/typed-child
   design before the first AEDAR slice? The current database cannot enforce
   each inner JSON value's type. No storage/latency benchmark is available.
3. **Shared publication ownership:** accept one reusable marker/dependency
   protocol with separate tokens per coherent owner, consolidating marker
   storage only after proof of identical ownership/failure boundaries; or
   retain the current marker tables as distinct typed projections while
   sharing only publisher logic? Either choice preserves no-op, retry,
   last-good, snapshot and fail-closed behavior.
4. **Resource discovery owner:** accept projection from current pipeline/domain
   descriptors without a second registry, including product-owned theme
   grouping and availability/comparison metadata; or identify a specific
   metadata field that lacks an authoritative owner and needs an explicit
   owner decision. Do not duplicate a per-screen list.

Catalogue survivors, exact table/column names and constraints, named target
encoding, individual typed-reading fields, old route/table retirement order,
migration DDL and operational rollback remain implementation-level proposals
after these choices and field/caller evidence are reviewed. They are not implied
by accepting the direction above. No ADR or domain definition is changed here;
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
