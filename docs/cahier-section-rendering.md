# Cahier section rendering (#956)

## Ownership

The Cahier is the cross-theme presentation system; Mobilité is its current
consumer, not a constraint on its shared layout or loading contracts. This
extraction does not migrate other theme tabs or add hypothetical theme APIs.

| Owner | Responsibility |
| --- | --- |
| `VarianteCahierLibre` | Page/spine/navigation, headings and comparison controls, section wrappers and anchors, lecture/fallback presentation, chapter visibility, baseline measurement, exploration footers and source register. |
| `cahierSectionRenderers` | Closed, exhaustive `ContentEvidence['kind']` lookup; focused typed bindings to existing compositions. Null evidence and disabled AEDAR explicitly select the placeholder without mounting a body. |
| `CahierAedarOverviewSection` | Car map + prose/source + scalar composition, including its acquired comparison status/retry. |
| `CahierAedarDiversityLossSection` | Existing loss-map composition, with explicit chapter activity. |
| `CahierAedarAccessSection` | Two ramps, their prose/source and shared legend; mechanical evidence-to-ramp adapter. |
| `CahierAedarProfileSection` | Equipment waffle, explanation and source. |
| `CahierAedarExplorerSection` | Existing explorer composition and explicit activity gate. |
| `aedarSectionContext` | One presentation owner per Cahier mount for selected modes, horizon and comparison visibility; reactive chapter activity and acquired overview comparison status are explicit inputs. The current territory's shared fiche comparison eligibility gates peer presentation independently of factual availability. Equipment identity stays in the existing explorer, its only consumer. |
| `CahierMobiliteSection` | Existing `{ section, unit, comparison }` delegate for the four non-AEDAR kinds, unchanged. It does not consume AEDAR context. |

The renderer interface contains the actual section, unit identity and comparison
state, not a payload, a giant prop bag or acquisition callbacks for every kind.
AEDAR compositions consume a deliberately named, typed context, required only
inside those compositions. Render functions have stable identity: new evidence
or loading status does not remount interactive children. Adding an evidence kind
requires a registry entry at type-check time; there is no runtime plugin system.

There is **one header-selected comparison group**. The existing overview and
native-resource statuses/retries remain attributed to the evidence each figure
actually consumes. The split is current acquisition plumbing, not two product
groups or an architecture future acquisition work must preserve.

## Export capture seam (#1021)

`cahierExportCapture.ts` owns the public, immutable capture of one resolved
section: identity, generation tokens, sources and their provenance identity, the
real comparison selection and its public names, the native figure models and the
effective local selections. `cahierExportVenue.ts` is the public read seam
provided by `VarianteCahierLibre` and exposed as
`captureSection`/`captureAll`; the PDF controller consumes the same venue.
`CahierExportScope.vue` is a renderless section (and figure) scope: it registers
the section and names a figure slot without adding a DOM element.

Owners publish the state they already hold, never the reverse:

| Publisher | Published state |
| --- | --- |
| `aedarSectionContext` (read by the shell) | selected modes, horizon, comparison visibility/eligibility, chapter activity |
| `AedarEquipmentExplorerCahier` | effective TYPEQU, acquired detail, comparison evidence and status |
| `CahierAedarAccessSection`, `CahierAedarOverviewSection`, `AedarEquipmentExplorerCahier` | the AEDAR reference layer actually drawn |
| `CahierMobiliteComparisonBars` / `CahierMobiliteRaccordementCurve` | their own toggle and drawn reference |
| `CahierMobiliteShareTrack` | the served share reference it draws |
| `CahierMobiliteSection` | the effective comparison state it presents |
| `CahierBlankMapSlots`, `AedarDiversityLossMapsCahier`, `CartographicBreakoutPrototype` | map and legend availability (load/failure, never a declaration) |

### Reference-surface inventory (existing owners)

Each comparison publication represents these actual reference surfaces; it is
documentation of the owners above, not another renderer registry.

| Publication | Section / figure | Reference surface actually drawn |
| --- | --- | --- |
| `aedar-comparison-layer` (`comparison`) | `CahierAedarAccessSection` | both access ramps, selected modes, all horizons |
| `aedar-comparison-layer` (`comparison`) | `CahierAedarOverviewSection` | scalar reference values |
| `aedar-comparison-layer` (`comparison`) | `AedarEquipmentExplorerCahier` | volume ramp means, selected modes |
| `aedar-comparison-layer` (`distribution`) | `AedarEquipmentQuantileFigureCahier` | distribution reference bars, selected modes, current horizon |
| `mobilite-comparison-bars` | `CahierMobiliteComparisonBars` | compared category bars per column |
| `mobilite-raccordement-curve` | `CahierMobiliteRaccordementCurve` | comparison curve |
| `mobilite-share-track` | `CahierMobiliteShareTrack` | comparison share row |
| `mobilite-section` ratio fields | `CahierMobiliteSection` (`ratios` layer) | paired ratio scalar references, independent of the bars toggle |

A section's `display` aggregates these layers; no single ramp or bar speaks for
the whole explorer or paired column.

Comparison capture keeps two separate things: **selection identity** (`group`
metadata, which never implies drawn proof) and **owner-observed presentation**
(`display.state`/`reason`/`layers`). Without a publication the display is
`unobserved`, not a default-visible layer. Each layer keeps the acquired
`referenceAvailable` distinct from `visibleReferenceAvailable` (the effective
selected modes/horizon) and from `displayed` (what the owner actually draws).
`display.reason` preserves owner loading/error/unavailable separately from a
legitimate `no-served-reference` and from a reference hidden by the selected
series (`hidden-by-selection`). The direct-reference read status remains a
separate `comparison.referenceStatus`: `null` means the section does not consume
a direct reference, `unobserved` means it does but no owner status was supplied,
and the owner statuses (`ready`, `loading`, `error`, `unavailable`, `idle`) are
passed through, so a failed AEDAR reference read is never reported as a
legitimate absence. A ready direct reference can therefore be displayed while
the aggregate comparison status is idle. Per-figure labels are preserved in
`statisticLabels`; no first column label becomes section-wide truth. Map/legend
state is `unknown` until a map owner publishes, and a declared map is never a
loaded one. AEDAR sources carry the native source-record identity, licence and
clocks additively (same display copy); Mobilité generation tokens are explicitly
absent rather than invented.

`projeterRequeteExport` projects one to three offered series (or none when the
section offers no choice) into a frozen request. Capturing and projecting read
state synchronously: no acquisition, no screen mutation, no DOM parsing and no
private Vue introspection. Placeholder sections are not capturable, and the
selected members stay distinct from producer-served eligible contributors.

`cahier-export-capture.spec.ts` covers the closed nine-kind admission, the
cross-family capture, sources/provenance, effective comparison presentation and
the projection; the mounted `cahier-export-capture-mounted.spec.ts` drives the
real owners (horizon, modes, TYPEQU acquisition, independent comparison layers,
real map/legend pending/loaded/failure transitions, late group/territory changes
and screen stability).

## Export family adapters (#1022)

`cahierExportAdapters.ts` projects one frozen `CahierExportRequest` into the
numeric tables and figure projections required by the PDF composer. Dispatch is
on the eight **figure families**, never on a section key: `aedar-ramps`,
`aedar-car-overview`, `aedar-diversity-loss` (maps/legend), the
`aedar-equipment-profile` waffle, `aedar-equipment-explorer` (volume ramp +
min/deciles/max distribution), `mobilite-bars` (compared bars with segments and
raw numerators), `mobilite-share` (current two-line coverage) and
`mobilite-curve` (declared raccordement grid, marker and reference path).

The adapters reuse the owners' own resolvers and the pure readings that
mount the figures: `cahierFigureReadings.ts` (time ramps and grouped AEDAR
bars), `cahierMobiliteReadings.ts` (compared bars, coverage share and curve)
and `aedarFigureReadings.ts` (quantile/volume/waffle/scalar builders).
`aedarRampToTimeRampFigureData` is the one evidence-to-ramp conversion used by
both `CahierAedarAccessSection` and the export. A table cell keeps the exact
native value next to the native visible formatting, so zero, absent values,
small non-zero values and served ties are not recomputed.

Comparison columns come only from an owner-published layer for the figure's
slot; `comparison.capable` is never evidence. A hidden reference (including the
`hiddenSeriesKeys` of the grouped AEDAR bars) is removed from tables, tooltips
and accessible labels. The paired ratio layer stays independent from the bars'
toggle. The distribution capture carries the native explanatory copy additively
(`distributionDescription`, `distributionUnavailableDescription`) so the
projection can preserve the figure's own reading.

Map owners publish the actual **inline** figure asset and, when drawn, the real
legend content (`inlineUrl`, `legendDetail`) through the same availability
seam; inspection-gallery assets are not export content and no pixel-derived
numbers are produced. Missing owner observations stay `unknown`/`pending`/
`unavailable`, never promoted to loaded. The grouped-bar projection returns the
frozen native `CahierGroupedVerticalBarFigureData` plus `hiddenSeriesKeys`
(axis titles, formatters, colours, icons and served ranks included), not a
second reduced drawing shape. Share projections carry typed owner unavailability
and the native status message instead of parsing display copy. Ratio scalar and
overview scalar presentation consume the same shared formatters/ARIA owners as
the mounted scalars (`—` for an absent value, bare number plus separate unit).
The raccordement projection consumes the same grid, reading, status-copy,
tooltip and accessible-label builders as the mounted curve. Declared ticks keep
their producer order and `numericValue`; when ticks are omitted, the declared
numeric axis (or published point `axisValue`) supplies identity/coordinates
without an array-index policy.

`cahier-export-adapters.spec.ts` covers the nine-section admission and literal
family expectations; `cahier-export-capture-mounted.spec.ts` projects every
mounted capture and checks a real ramp tooltip against its exported readings.

## Preserved boundaries

- Content builders own prose, labels, evidence, availability and provenance;
  the extraction does not repair stale rank prose or eligibility.
- Existing acquisition owners, caches, late-response fences, retries and demand
  scheduler remain unchanged. Context is not an acquisition owner.
- Map/explorer activity remains reactive and independent of enablement. An
  off-screen renderer cannot admit its map assets or detail reads merely by
  mounting. Shared Cahier loading remains with `useCahierLoading` and its callers.
- The shell has no kind-specific body-template dispatch. Its remaining named
  AEDAR checks are explicit orchestration exceptions: access-unit loading copy,
  the access section's lecture-state suppression, and the existing exploration
  footer/source fallback rules. Layout modifiers are ordinary spread/paired/
  stack/flip concerns; historical DOM class names remain on the wrappers.
- No DOM wrapper was added by the lookup or context. `figure-stack` direct
  children, `section-*` anchors, `data-section`/`data-figure`, order, ARIA,
  headings, sources and footers stay in place.
- AEDAR-specific CSS moves with its composition. Shared shell selectors reach
  only the layout classes across the child boundary via `:deep()`. Indexed
  prose alignment is scoped locally to the newly moved prose, **not** nested
  map/explorer prose that the old shell scope never styled. Responsive scalar
  and ramp rules move unchanged, including their ancestor conditions.

## Verification seams

`cahier-section-renderers.spec.ts` covers exhaustive admission and explicit
null/disabled fallback. `cahier-section-ownership.spec.ts` mounts the public
Cahier with real figures to cover synchronized controls, retained child DOM,
off-screen activity, differing acquired statuses/retry attribution under one
selection, and pending anchored fallback. Existing production/demand/loading/
layout suites continue to cover actual reads, late fencing and transitions.

The optional `CAHIER_SECTION_RECEIPTS=1` mode in the existing mobile-overflow
browser verifier records every AEDAR section at 390px and 1440px, then exercises
both directions of horizon/mode synchronization, comparison visibility and the
explorer's explicit retry. `CAHIER_RECEIPT_BASELINE_REF=5c44e092` loads that
historical shell **in memory** for the same fixture run; no checkout is changed.
`CAHIER_EVIDENCE_DIR` keeps screenshots outside tracked generated assets.
Fixtures prove consumer rendering and interactions, not live numerical parity.

## Extraction receipt — 2026-11-16

Base: `5c44e092` (including #1013/#1015 loading, #1016 layout stability and
chapter-anchor fixes). First before screenshots were captured **before** shell
markup changes. A second baseline/control run used the in-memory historical
shell described above; all other production figure/acquisition files are
unchanged by this extraction.

- Focused acceptance run: **29 files / 309 tests passed**.
- Full app run: **194 files / 2,572 tests passed, one skipped**. Five tests added
  in two specs; no behavioral expectation in an existing spec was changed.
- Production TypeScript/Vite build passed; only the existing large-chunk warning.
  Generated `app/dist` and payload-copy changes are not part of the PR.
- `verify:aedar-demand`, `verify:aedar-layout-stability` and
  `verify:mobile-cahier-overflow` passed. The overflow verifier exercised
  320, 360, 390, 601, 760, 761, 1440 and 1800px; all original assertions remain.
- At **390 × 844** and **1440 × 844**, five section screenshots plus the
  post-interaction/retry explorer capture are **byte-identical in all 12
  before/after pairs** (SHA-256 comparison). Visual inspection covered the
  actual rendered screenshots, including mobile prose/stacking, desktop ramps,
  profile and retry/error state, not just unit-test output. Sticky header
  overlays in tall element captures are present identically in the baseline.
- Real-browser button interactions in both baseline and final runs: profile
  horizon → explorer (10 min), explorer → profile (20 min), restore 15 min;
  ramp walk mode → explorer and reverse; ramp comparison visibility off/on;
  explorer error remains honestly an error explanation, not a pressed toggle;
  explicit explorer retry makes **20 comparison POSTs** in each fixture run
  at each review width, retaining focal figures and the retryable error. This
  is fixture consumer evidence, not a claim of live publication parity or a
  separate human acceptance sign-off.
- A broad `:deep(.argument-copy)` was rejected during screenshot review because
  it changed nested prose alignment. Local scoped rules restored equivalence;
  all final section screenshots match the pre-change baseline exactly.

Local evidence (outside tracked generated assets; not uploaded to GitHub):

```text
E:/Temp/opencode/956-evidence/before-sections/     # first pre-markup capture
E:/Temp/opencode/956-evidence/baseline-controls/   # 5c44e092, full interactions
E:/Temp/opencode/956-evidence/final-controls/      # extracted, full interactions
E:/Temp/opencode/956-evidence/screenshot-comparison.json
E:/Temp/opencode/956-focused-final.log
E:/Temp/opencode/956-full-tests-handoff.log
E:/Temp/opencode/956-build-handoff.log
E:/Temp/opencode/956-demand-handoff.log
E:/Temp/opencode/956-layout-handoff.log
E:/Temp/opencode/956-baseline-controls2.log
E:/Temp/opencode/956-final-controls2.log
```

### Mechanical test adaptations (complete list)

1. `cahier-typography.spec.ts`: read `.aedar-access-evidence` from
   `CahierAedarAccessSection.vue` instead of the shell; identical declarations
   and unchanged full-width expectations. The same desktop/mobile ramp captures
   are byte-identical.
2. `editorial-foundation.spec.ts`: follow the shell → renderer lookup → existing
   Mobilité delegate import chain rather than expecting its old direct import.
   The map plate remains production-wired without a prototype query gate.

`variante-cahier-libre.spec.ts`, `production-mobilite-*`, existing `aedar-*` and
`mobilite-aedar-contract-guard.spec.ts` remain unmodified.

### Detector / merge gate

`npx impeccable detect app/src` reports **11 before / 11 after**, identical
file/rule/line findings in the same eight untouched files; only scanned-file
count changes (394 → 403). A diff-scoped scan of the 12 changed/new app source
files reports **zero findings**. The regex scan does not exercise rendered
element rules; it is not an accessibility audit. No ignores, suppressions or
unrelated restyling were added. **The clean full-scan gate remains unsatisfied;
the owner must explicitly resolve the documented baseline exception before
merge.** No approval or waiver is inferred by this report.
