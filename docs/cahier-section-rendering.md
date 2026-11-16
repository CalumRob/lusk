# Cahier section rendering (#956)

## Ownership

The Cahier is the cross-theme presentation system; Mobilité is its current
consumer, not a constraint on its shared layout or loading contracts. This
extraction does not migrate other theme tabs or add hypothetical theme APIs.

| Owner | Responsibility |
| --- | --- |
| `VarianteCahierLibre` | Page/spine/navigation, headings and comparison controls, the shared section PDF action, section wrappers and anchors, lecture/fallback presentation, chapter visibility, baseline measurement, exploration footers and source register. |
| `cahierSectionRenderers` | Closed, exhaustive `ContentEvidence['kind']` lookup; focused typed bindings to existing compositions. Null evidence and disabled AEDAR explicitly select the placeholder without mounting a body. |
| `CahierPdfAction` / `cahierPdfExportController` | Shared PDF interaction state and dialog: capture, mode choice projection, generation, delivery, retry and cleanup. `cahierPdfExport` owns only the completeness/activation policy over the #1021 capture. |
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

## Shared PDF controls (#1023)

`CahierPdfAction.vue` is the one action/dialog mounted by
`VarianteCahierLibre` inside each `.concept-group-heading` whose renderer has a
body. It is not copied into an AEDAR composition or the Mobilité delegate, and
there is no section-key list: the nine native sections receive the same action
because they share the heading loop.

The action owns only interaction state through `cahierPdfExportController`:
capture at activation, the direct route for zero/one-to-three offered series,
the PDF-only chooser above three, an immutable `CahierExportRequest`, real
browser delivery, retry of the same failed request, new capture after success,
double-click suppression, late-result fencing and clone/object-URL cleanup.
Capture and generation are injected at the public seam; the controller owns no
factual value or PDF template.

`cahierPdfExport.ts` is the activation policy over #1021's capture. The owner's
2026-11-16 decision is **wait for completeness**: a pending/failed section,
source clock, required map or legend, acquired equipment detail, requested
comparison, direct reference, or declared resource failure blocks the export.
The policy reads the closed owner states rather than a broad `status !== ready`:
a source-contract map that is not declared, an explicitly empty or ineligible
comparison, a comparison hidden by the reader or by the selected series, a
served `no-served-reference`, and explicit unavailable cells remain exportable.
`referenceStatus` stays distinct from the aggregate comparison status, so an
unobserved/loading/error/unavailable direct reference is never treated as
`no-served-reference`.

The action keeps its visible focus while blocked or preparing: it is not natively
`disabled`, it exposes `aria-disabled`/`aria-busy`, the controller refuses a
duplicate activation, and the blocked reason is associated through
`aria-describedby` to a visually hidden text. The trigger therefore remains the
focus destination after direct activation and after the chooser closes, through
preparing, success and error. The PDF chooser is the only dialog lazily created
by this seam; the shared `CahierDialog` keeps closed slot content mounted so
existing owners (notably the waffle table's mount-time `ResizeObserver`) retain
their refs and lifecycle.

Until integration lot E wires the real composer, `VarianteCahierLibre`'s
`pdfGenerator` prop is null. Every action remains mounted but inert, visibly
labelled `PDF`, focusable with `aria-disabled` and an accessible reason; it does
not simulate a download or a success. The action also accepts a later
`definirGenerateur` update at the same public seam (latest prop wins; a change
while a generation is in flight is queued) so E may supply the composer
asynchronously without remounting; no production stub is shipped.
`cahier-pdf-export-activation.spec.ts`, `cahier-pdf-export-controller.spec.ts`,
`cahier-pdf-action.spec.ts` and the mounted `cahier-pdf-shell.spec.ts` exercise
the policy matrix, controller machine, desktop/mobile/keyboard action and the
real nine-section mount with an injected generator. Production generation
remains E's acceptance work.

The production Mobilité path is `layoutVariant: 'indexed-sections'`, whose
common section heading has no section number. Its mobile header keeps the title
column and the top-right label/44px action; other layout variants retain their
existing numbered heading composition. On the fixture's long title at 320px the
action widening to `Préparation…` narrows the title column from two to three
lines without overlap. That is the reported trade-off; no dedicated action row
or numbered-heading redesign is introduced.

### Identity and delivery fences

Each action receives the shell's `{ territoryType, territoryCode, unitKey,
sectionKey }`. The controller fences that scope, not the selected modes,
horizon, equipment or comparison group: a same-route territory change resets
`idle`/`done`/`error`/preparing state, aborts the old generation and rejects a
late completion even when the injected generator ignored the abort. Ordinary
edits under the same identity keep the exact failed request retryable.

Browser delivery hands the generated Blob URL to an anchor click, then releases
it on the next task. Disposal leaves an already-handed-off URL to that next-task
release; an unhanded URL (no queued release) is revoked immediately. A URL is
never retained indefinitely. The success state means the browser download handoff
occurred, not that a file was written to disk; the cleanup task is not a
generation timer and never fabricates success.

## Shared PDF composition (#1024)

`cahierPdfComposer.ts` is the narrow public generation seam:
`(request: CahierExportRequest, { signal }) => Promise<{ blob, fileName }>`.
It lazy-imports jsPDF and svg2pdf only when a file is requested and knows no
action, dialog, route or section key. It consumes the frozen #1021 request and
the #1022 projections; it never remounts a screen component, reads the live DOM
or starts an acquisition.

- `cahierPdfComparaison.ts` owns the approved comparison subtitle: exact EPCI
  name, the three Bretagne presets, French sort, measured two-line complete
  names, largest complete prefix + `ET N AUTRES …`, total-count fallback, and
  singular/plural agreement. It appears only when the page contains served
  comparative proof.
- `cahierPdfTableau.ts` builds tables only from the B models. Columns are
  measured with the embedded face; focal/comparison pairs stay together; a
  too-wide table is split into coherent column groups and a too-tall table into
  row groups with repeated title/header. Numbers are never truncated
  (`CahierPdfTableLayoutError` rejects an impossible cell). Only a narrow
  territory table header may wrap twice then ellipsize; group names never are.
  `Indisponible` becomes `Indisp.` only when measured width requires it, and the
  explanation is emitted once under the tables. A comparison column is an
  explicit owner-published slot: when it carries no served value/rank it stays
  visible as unavailable, but no subtitle, footer, legend entry or `¹` marker
  claims comparative proof.
- `cahierFigureNativeGeometry.ts` is the shared owner seam: axis domains,
  integer/rounded graduation, curve fixed percent ticks and viewport tick
  selection, ramp paths, compared-bar geometry and stacked comparison segments,
  grouped-bar geometry, waffle five-row column flow and share unit/percent
  handling. The mounted figure components import the same functions; the PDF
  only paints the resulting primitives.
- `cahierPdfFigures.ts` paints those shared primitives (SVG marks + selectable
  jsPDF text) from the frozen #1022 projections/native models. It does not own
  a second axis/geometry/colour policy. Native titles, x/y axis titles, units,
  legends, ranks and owner-observed comparison layers are preserved; no
  title parsing and no PDF-only significant-figure/rounding policy.
- `cahierPdfComposer.ts` owns the A4 document: paper/ground, brand home link,
  centered page title, focal territory link, red rule, comparison subtitle,
  figures, value tables, notes, `Source(s) :` bottom-right, page-local
  comparison footer, page numbers and metadata. It reserves sources/footer
  space, measures real block heights, keeps the value heading with its first
  table and starts a continuation only at a measured overflow. No global
  document shrink is applied.
- `cahierPdfFonts.ts` embeds the app's actual families. The binaries are
  derived from the installed `@fontsource-variable` packages by
  `scripts/derive-pdf-fonts.py`; `src/assets/fonts/pdf/manifest.json` records the
  source package/file, byte size and SHA-256, and each face has its OFL licence
  copy. A missing/truncated face rejects generation. There is no system-font
  substitution, runtime font download or reader-side Python.
- `cahierColorRoles.ts` owns the Cahier-scoped colour aliases used by the real
  shell and the document painter, including the cycle-shared hue that DESIGN.md's
  mode scale does not tokenise. `cahierPdfPalette.ts` resolves the canonical
  `:root` block of the bundled `styles/tokens.css?raw` source (including
  editorial paper/deep, ink, muted, margin, brand, theme and mode roles); it
  contains no copied palette hexes. Media/theme-scoped overrides are not part of
  the print document and are never consumed silently.
  The existing app OKLab mix primitive is reused. Supported aliases, sRGB/OKLab
  mixes and the owner's alpha RGB are resolved explicitly; unsupported colours
  reject rather than silently become ink. Transparency is composited onto the
  actual editorial paper. No live screen or computed-style introspection is used
  by production generation.
- `components/luskBrandMark.ts` is the single owner of the locked ermine paths
  and fills. `LuskBrand.vue` and the PDF painter both consume it, so a brand-owner
  fill edit reaches the generated document instead of diverging from a copy.

`cahier-pdf-composer.spec.ts` drives real blobs and parses them with pdfjs/pdf-lib:
the nine-section admission matrix, A4/page/formats/metadata/font embedding,
literal table cells and ranks, French accents, `Indisp.` with one explanation,
comparison subtitle cases, one-page and measured multi-page continuation,
repeated identity/headers/sources, page-local comparison proof, explicit asset/
font/abort/unsupported-family failures, a corrupted-input fidelity case and an
independent negative audit that fails on a corrupted number/column/group.
Populated native scenes cover a 73-point curve, a 0,9957355 share, a 1,4 ramp,
split compared bars and a twelve-type waffle. A rendered-collision guard checks
the actual text boxes, not only page edges; a PDF operator-state guard proves
body/table/source text is emitted at full opacity. Node probes inject fonts and
map images; the browser harness serves a bounded same-origin raster fixture and
exercises the default fetch/createImageBitmap/canvas path, including typed asset
failure (missing and undecodable bytes) and abort. No fixture script ships in
production.

`cahier-pdf-native-paint.spec.ts` checks the emitted SVG at the public native
painter/serialization seam: literal null-gap subpath counts on both curves,
hidden bar-slot centering, unequal ramp-panel maxima, transitive `comparisonFor`
visibility, measured/mobile-anchor tick labels, the shared series stroke
grammar (width/dash/opacity declared by the native SFCs and converted to mm,
marker metrics) and explicit unknown-colour rejection. The curve axis, ticks
and marker come from the native curve projection; there is no parallel scale
fallback. It uses real embedded font metrics and selectable PDF
text, not an alternative geometry calculation. `cahier-pdf-source-colours.spec.ts`
changes the actual CSS-source input and asserts changed colours in a generated
PDF; `cahier-pdf-composer.spec.ts` does the same mutation for the brand owner's
fills. Node and browser dense scenes use the same fixture builders.

`scripts/verify-cahier-pdf-browser.mjs` builds only
`scripts/cahier-pdf-browser-probe.html` into an external directory, serves it on
a private strict port, uses the local Playwright Chromium to generate real
desktop and mobile-host PDFs with the production font/asset loader, and closes
the server. It is evidence tooling, not an application build and not the
stopped preview/prototype server. Its output is outside the repository.
The browser's independent CSS engine is compared with the PDF colour resolver;
PDF operator streams verify full text alpha on every page and decoded raster
dimensions. The bounded raster is a synthetic 2×2 PNG, not live map/data parity.
Missing URL/invalid bytes return typed `asset` errors; pre-abort and abort after
decode return `AbortError`, with every created bitmap closed. Desktop/mobile-host
PDFs prove document grammar is host-width independent, not product integration.
Actual PDF examples still require the owner's visual approval before merge;
these fixture receipts do not grant it or unblock integration lot E.

Visual evidence is generated outside tracked assets via
`CAHIER_PDF_EVIDENCE_DIR` and `CAHIER_PDF_REPORT=1` while running the spec.
Documented limits: no tagged-PDF claim, no Pi/mobile performance promise, and
the measured transfer/generation numbers are development-machine observations,
not a new SLA.



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
