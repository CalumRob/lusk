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
the aggregate comparison status is idle. Each figure keeps its owner-published
`comparisonLabel`; no first column label becomes section-wide truth. Map/legend
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

**Shared native-body path (wired).** `captureSection` freezes the native inputs
for every Cahier section kind. `composerCahierPdf` — and therefore the
`CahierPdfGenerator` seam — now routes exclusively through
`composerCahierPdfNatif`: it mounts the existing section shell in an inert
offscreen host from those frozen inputs, and paints browser layout into
selectable text, vector SVG and clipped raster. The map owner freezes the
bytes of the image it already displays into `CahierCaptureMapItem.bytes`; the
default reader uses only those bytes (no `fetch`, no `readAsset` injection),
so a retry cannot re-contact the owner. The mount never acquires. The painter
receives no section or figure kind and there is no
per-section PDF figure template or fallback painter. `rendreCorpsNatifPdf`
remains the body-only witness used by the browser proofs.

The document grammar is unchanged: the composer still owns the value tables
(from the shared projections), the repeating identity, sources/links, the
page-local comparison note, the header/footer and the measured A4 continuation.
Tables break only between complete measured rows with repeated headers; paired
figure rows are atomic. A mounted native body is split into break blocks at
native layout rows (children sharing a rendered top stay together, so paired
figures remain atomic) and paginated at fixed reading scale — no global shrink,
no dead second page. A `figure` is never cut across pages: it moves whole to the
next page or, if it genuinely exceeds a whole page, is rejected with
`unbreakable-native-figure` (mapped to a layout error). No figure is silently
split. One frozen selection (`capture.nativeSelection`, mirrored into
`request.modeIds`) drives both the native figure and the B tables, so they
cannot disagree; the equipment typequ and horizon are frozen there too. The
comparison footnote is page-local: each body that actually carries proof gets
its own `¹ Groupe comparé` note. The break budget is derived from the real
per-page useful space, not the raw content box. The mounted browser checks use
a labelled technical raster and do not establish a production map or visual
approval.

**Centring decision (#1014 vs prototype).** `desktop.js:606` centres each page's
content with `top + max(0, (capacity - used) / 2)`, but it also computes one
global `scale` to fit the tallest section (`desktop.js:587`). #1014/#1024
require real overflow continuation and forbid shrinking the whole document, so
the export keeps the fixed scale and the prototype's per-page centring, with
one deliberate divergence: the inset is capped at the approved 48 CSS px band.
The owner rejected a large empty band above a short section, so a tall inset is
not "approved centring" even though the prototype produces it. The export shell
also hides the screen card and drops explanatory prose; the result is a small,
consistent top band, not a second column or a dead quarter-page.

`cahierPdfComposer.ts` is the narrow public generation seam:
`(request: CahierExportRequest, { signal }) => Promise<{ blob, fileName }>`.
It lazy-imports jsPDF and svg2pdf only when a file is requested and knows no
action, dialog, route or section key. It consumes the frozen #1021 request and
the #1022 projections; the *screen's live* DOM is never read and no acquisition
is started. The only mount is the inert, offscreen export host created inside
`composerCahierPdfNatif` from the frozen snapshot.

**Export surface contract.** `cahierExportSurface.ts` is the single app-owned
list of screen chrome hidden in that host: section footer, tooltips, the screen
rank chip, screen-only interactive CTAs/controls (`.cahier-action-button`,
retries, carousels). Prose is hidden by the **same single owned list**
(`CAHIER_EXPORT_SURFACE.proseSelector`) that the reflow pass uses to remove it;
`cahierExportHiddenSelectors()` is the mount's only hide list. That list is
`.argument-copy, .page-subtitle, .cahier-evidence-source:not(.cahier-map-legend__note)`
— it deliberately excludes `.cahier-prose` (an implementation class carried by
figure titles too) and preserves the map-legend note. Figure titles, captions,
axis and legend labels, scalar labels and figure-attached reading notes keep
their own roles and are not hidden. A drift test fails if a listed producer
selector disappears. The screen router owns the shared route identities
(`CAHIER_EXPORT_ROUTES` is exported from `src/router/index.ts`), and the
standard figure width and desktop viewport constants come from their figure
owners.

**Export layout contract (#1025).** The section *layout* container — the one
that holds prose beside its figure(s) — declares
`data-cahier-export-layout="spread"`. It is declared by the owning component,
never on an internal figure grid (a waffle's tile grid, a plot's own grid, or
the diversity-loss comparison row). The export shell's single reflow pass
visits only containers carrying that attribute and acts only when a visible
prose child is actually removed — with no prose to drop the container is left
completely untouched. It identifies prose by the same shared prose-role
selector used to hide it in the mount, removes it regardless of any remaining
source stamp, then collapses the authored tracks to the figure children while
pinning every figure's pre-pass width, height and mutual gap. Only the block's
position changes; no figure is stretched or shrunk. No layout class name
participates and there is one mechanism only.

The same pass also centres the figure's *bands* — the title/caption, any
subtitle or unit line, and the legend/scale band — on the body axis. The sole
guard is the reflow plan: a container where prose was actually removed. Bands
are recognised generically as the non-figure, text-bearing children of the
figure block and the layout; each is moved by a pure horizontal translation,
clamped to the body so it cannot overrun the page. Authored alignment and
wrapping are never rewritten — no `text-align` is imposed by the shell — and a
band already on the axis, or wider than the body, is left untouched. A
container that was not reflowed is never visited, so unreflowed sections keep
their exact rendering.

Declarations: the five AEDAR section bodies and the Mobilité
`mobilite-section-spread` wrappers; the diversity-loss layout and the access
evidence grid declare it on their inner container. Legitimate non-declarations:
the stacked `mobilite-section-stack` (curve) has no side-by-side prose column;
the stationnement `mobilite-paired` row has two figures and no prose; the
diversity-loss comparison row and every figure's internal grid are figure
layouts, not prose-plus-figure layouts.

**Public strings come from the owner, not the runtime host.** `cahierExportUrls.ts`
owns the canonical public site (`CAHIER_EXPORT_PUBLIC_URL`); the footer invitation
and the public link are built from it (or from an explicitly supplied test-only
override), never from `location` or from a capture. A preview or test hostname
can therefore never leak into an exported PDF, and no query string is forwarded.
The harness passes explicit `urlAccueil`/`urlPublique` overrides; production does
not.

**Map failure is explicit.** Every declared map is read from bytes frozen in
the capture and bound to a settled object URL; a declared-but-unloaded or
undecodable asset fails with a typed `CahierNativePdfError` whose reason maps to
a controller-compatible `CahierPdfCompositionError.code` (`asset` for maps,
`incomplete-capture` for unsettled observations, `layout` for unbreakable
content, `serialization` for a missing rendered section). A retry uses the same
frozen bytes and never re-contacts the owner.

**Retired painter — removed.** `cahierPdfFigures.ts` and its painter-geometry
specs have been deleted; no hand-built figure painter remains in the repo. The
shared primitives in `cahierFigureNativeGeometry.ts` are consumed by the mounted
Vue figures and by the native DOM-paint seam, which is the only figure input to
the PDF. Live table, fact and footer assertions were kept or re-targeted at that
native seam; the retained source-contract tests assert the mounted SFCs.

- `cahierPdfComparaison.ts` owns the approved comparison subtitle: exact EPCI
  name, the three Bretagne presets, French sort, measured two-line complete
  names, largest complete prefix + `ET N AUTRES …`, total-count fallback, and
  singular/plural agreement. It appears only when the page contains served
  comparative proof.
- `cahierPdfTableau.ts` builds tables only from the B models. Columns are
  measured with the embedded face; focal/comparison pairs stay together; a
  **one table per figure panel** — never one per x-axis value and never the
  transposed model. The approved generator has two shapes, and the adapter must
  choose the one its family ships (`desktop.js:appendTimeRampTables` /
  `appendSandboxTables`):
  * **flat (A)**: `aedar-ramps` and the equipment profile. For the ramps, rows
    are `cut × mode`; with a displayed comparison the columns are
    `Temps | Mode | territory | Groupe comparé ¹ | Rang`, and without one the
    reachable three-column state is `Temps | Mode | territory`. The approved
    generator's fixed `colgroup` (`desktop.js:215`) is therefore
    `18 / 46 / 36 %` without comparison and `14 / 32 / 18 / 18 / 18 %` with it.
    The mode is a row dimension, so a flat access table always has that same
    fixed column set and never column-splits. The approved generator lays the
    two access panels in one grid —
    `grid-template-columns: repeat(2, minmax(0,1fr)); gap: 24px`
    (`desktop.js:197`) — so the composer pairs both tables on the same baseline
    at the measured page scale (two equal half-columns and the 24 px gap). Only
    a table whose measured minimum width cannot fit a half-column keeps the
    full content width: that is an honest measured layout decision, never a
    clipped number or an unconditional stack. The profile plate keeps one
    legend key per value column, so its flat header has no legend row but keeps
    a vertical rule at each legend-key boundary (#1014 §5).
  * **grouped (B)**: any figure with a legend-key axis (`aedar-equipment-explorer`
    volume ramp and distribution). Rows are the panel's x-axis categories
    (`Temps` or `Statistique` row-dimension header); columns are grouped by the
    visible legend key, each group carrying `[territory | Groupe¹ | Rang]` and
    its series colour. A grouped table splits only at complete group boundaries
    and a too-tall table only at complete rows, with repeated title/header.
    The tallied-bars plate is flat too: its row dimension is the producer's own
    x-axis title (the actual category dimension, e.g. `Type de stationnement`),
    painted above the row labels, while the value column names the focal
    territory. The axis title never becomes the value-column header.
  The caption/header box has **one owner** (`ESPACE_TABLEAU` in
  `cahierPdfTableau.ts`, consumed by both the composer's pagination and the
  painter). A flat table's legend-key band is exactly zero — never an empty
  mode line folded into `headerHeight`; the measured R1 gap from the last
  header baseline to the first row is 16.24 pt (the native body's equivalent is
  16.2 pt).
  The `¹` footnote marks the compared **`Groupe`** cell once per served cell
  (the flat shape prints the full `Groupe comparé ¹`, the grouped shape its
  approved `Groupe¹`), never `Rang` and never once per wrapped line. The mark
  and its in-document footer link follow the served proof only: a table with
  no row dimension (coverage share, scalar overview, compared bars) still
  carries its one mark per compared cell. It is an actual in-document link to
  the page footer (`comparisonReference()` destination), not a decorative
  glyph. The rank value stays the producer-served display and is
  never recomputed. The coverage-share table (no row dimension, e.g. `Part des
  bâtiments près d’un arrêt`) carries the same `Groupe comparé ¹ | Rang`
  presentation: its `Rang` cell is the producer-served ordinal and its scope
  (e.g. `1er/38` among the EPCI communes), never a value inferred from the
  percentage or the median; the footer names the same group. The share **table** is the rank surface: the user asked for its `Rang` column to be populated, not for a rank badge on the share figure, so the figure keeps the screen's two tracks without one (a populated track keeps its 1 px solid border; only an empty track is dashed, with `Indisponible` centred inside it). The mounted share figure and the native body measurement consume one
  layout, including wrapped state/notes; there is no fixed 40 mm reserve. Numbers are
  never truncated
  (`CahierPdfTableLayoutError` rejects an impossible cell). Only a narrow
  territory table header may wrap twice then ellipsize; group names never are
  (they wrap at their measured `colSpan` width and the group header height
  grows). `Indisponible` becomes `Indisp.` only when measured width requires it,
  and the explanation is emitted once under the tables. The PDF paints the
  approved caption clone only: no `Unité :` line and no figure-description note
  (the unit stays on the figure's own axis title and the description in the
  figure's accessible reading). A comparison column is an
  explicit owner-published slot: when it carries no served value/rank it stays
  visible as unavailable, but no subtitle, footer, legend entry or `¹` marker
  claims comparative proof.
- `cahierFigureNativeGeometry.ts` is the shared owner seam: axis domains,
  integer/rounded graduation, curve fixed percent ticks and viewport tick
  selection, ramp paths, compared-bar geometry and stacked comparison segments,
  grouped-bar geometry, waffle five-row column flow and share unit/percent
  handling. The mounted figure components import the same functions; the PDF
  only paints the resulting primitives. The curve functions consume the
  captured model's narrow `CahierMobiliteCurveInput` shape (axis, points,
  trajectory, comparison, marker), not a widened full screen evidence.
- The native DOM-paint seam paints the mounted figures (SVG marks + selectable
  text) from the frozen #1022 projections/native models; there is no second
  axis/geometry/colour policy and no hand-built painter. The native AEDAR frame
  is declared once in `cahierFigureNativeGeometry.ts`
  (`CAHIER_AEDAR_FIGURE_GEOMETRY`, the 640×300 viewBox with margins top 22 /
  right 68 / bottom 62 / left 64) and is imported by
  `AccessRampFigureCahier.vue` and `CahierGroupedVerticalBarChart.vue`. The left
  rail is **measured**, not fixed: `deriveCahierFigureGeometry` receives the
  panel's actual rendered CSS-pixel width and the embedded face's real label
  width, exactly like `useMeasuredCahierFigureGeometry` (16 px title lane +
  longest rendered y label + 8 px gap, capped by the native minimum plot width).
  The lane and gap are therefore converted by `640 / renderedWidth`, not left as
  640-unit numbers; the derived user-unit rail is then scaled with the panel.
  The compared bars use the same rule, and their y labels sit on that rail.
  Access-ramp ticks stay bare (`0`, `5`, …) as in R1: the unit is painted once
  on the axis title, and the compact x labels start at the shared
  `xLabelOffsetAccess` that clears the y tick's line box. SVG strokes stay in native
  units
  (`CAHIER_FIGURE_STROKE` 2.5 / 1.5 / 1 px) and the local figure transform
  scales them once. Axis titles take the `.type-figure-label` uppercase role,
  the ramp paints paths only (no invented point markers), grouped bars carry the
  native `fill-opacity: .78` as a real shape alpha (so the grid beneath shows
  through, never a paper-composited opaque colour), and the explorer panel
  titles carry the figcaption's second line (`typequLabel`). The equipment
  explorer also paints its **captured** selected horizon under the identity
  (`Temps de trajet` + `${horizonMinutes} min`), independently of the x-axis
  ticks and never recomputed from them; the label comes from the mounted
  `CahierTravelTimeLabel` wording (`cahierFigureWording.ts`). Native titles,
  units, legends, ranks and owner-observed comparison layers are preserved; no
  title parsing and no PDF-only significant-figure/rounding policy.
- `cahierPdfComposer.ts` owns the A4 document: paper/ground, brand home link,
  centered page title, focal territory link, red rule, comparison subtitle,
  figures, value tables, notes, `Source(s) :` bottom-right, page-local
  comparison footer, page numbers and metadata. The footer note is measured and
  wrapped once: the last line keeps the approved H-35 alphabetic baseline,
  extra lines stack upward at the footer's 12 pt pitch, and that measured zone
  is removed from the content bottom before pagination. It reserves
  sources/footer space, measures real block heights, keeps the value heading
  with its first table and starts a continuation only at a measured overflow.
  No global document shrink is applied. A captured `figure.row` (the stationnement /
  ravitaillement pair) is painted as one atomic side-by-side figure row: the
  capture records the native row grammar and the desktop viewport
  (`CAHIER_FIGURE_ROW` in `cahierFigureNativeGeometry.ts`), and the composer
  resolves the source `CahierMobiliteSection.vue` clause
  `column-gap: clamp(24px, 4vw, 56px)` at that viewport, then converts it with
  the figure's own page scaling (the `figureRowGeometry` test helper). `56 px` is therefore the
  clamp's **ceiling at the approved 1440 px desktop width**, not the live gap and
  not a transplanted physical distance; each figure is measured at its own half
  width and keeps the native 640x300 aspect. Only a genuinely taller-than-page
  row falls back to the measured full-width sequence. This is figure
  composition, not a per-section template. Compared-bars plots keep the shared
  `CAHIER_MOBILITE_BARS_GEOMETRY` 640x300 aspect instead of a fixed PDF height,
  and their y rail is measured with the same shared rule as the mounted
  component instead of a fixed margin. The two stationnement value tables do
  **not** inherit that side-by-side figure grid: each measures ~97.5 mm against
  an ~87.9 mm half-column, so pairing them would shrink numbers below their
  measured content. They stay stacked and centred in the body — a recorded
  measured-layout decision, not an oversight or a per-section template.
- `cahierPdfFonts.ts` embeds the app's actual families. The binaries are
  derived from the installed `@fontsource-variable` packages by
  `scripts/derive-pdf-fonts.py`; `src/assets/fonts/pdf/manifest.json` records the
  source package/file, byte size and SHA-256, and each face has its OFL licence
  copy. The **wordmark** is the face the browser actually displays: `main.ts`
  loads only the `normal` Newsreader CSS and `LuskBrand.vue` asks for italic, so
  the browser synthesises the oblique. The derived face is therefore the upright
  `wght=600` instance skewed by `(1,0,.25,1,0,0)` with `post.italicAngle = -14`
  (advance `lusk` = 1.855 em, 33-point `k`), exactly as the approved generator
  did; the packaged real italic cut is not embedded. **Post-skew bearings:** the
  derivation sets `hmtx` lsb to the new `glyf.xMin` and refreshes the `hhea`
  extrema. Keeping the upright lsb displaced `u` by 0.086 em inside its advance
  even though pen origins matched; the real header's visible ink is the test
  reference (`cahier-pdf-wordmark-ink.spec.ts`). The lockup uses the measured
  0.792 em header box offset (not the old 0.847 em), and the PDF page header
  keeps the global header's `-0.01em`; the landing hero's `-0.02em` is a
  separate surface variant, not the document value. A missing/truncated face
  rejects generation. There is no system-font substitution, runtime font
  download or reader-side Python.
- `cahierColorRoles.ts` owns the Cahier-scoped colour aliases used by the real
  shell and the document painter, including the cycle-shared hue that DESIGN.md's
  mode scale does not tokenise. `cahierPdfPalette.ts` resolves the canonical
  `:root` block of the bundled `styles/tokens.css?raw` source (including
  editorial paper/deep, ink, muted, margin, brand, theme and mode roles); it
  contains no copied palette hexes. The share track's 18/22/40 % paper mixes
  live in `CAHIER_SHARE_COLOUR` and are consumed by both
  `CahierMobiliteShareTrack.vue` (inline custom properties) and the PDF palette;
  no SFC/palette duplicate remains. Media/theme-scoped overrides are not part of
  the print document and are never consumed silently.
  The existing app OKLab mix primitive is reused. Supported aliases, sRGB/OKLab
  mixes and the owner's alpha RGB are resolved explicitly; unsupported colours
  reject rather than silently become ink. Transparency is composited onto the
  actual editorial paper. No live screen or computed-style introspection is used
  by production generation.
- `components/luskBrandMark.ts` owns the locked ermine geometry and its two
  canonical brand fills (`ink`, `accent`). Its geometry reaches every runtime
  consumer: `LuskBrand.vue`, the fiche watermark (`FiligraneFiche.vue`) and the
  PDF painter; no consumer carries a path copy. The canonical fills are the
  fills of the lockup and of the PDF painter. The watermark shares that geometry
  and the canonical `ink`, but deliberately draws the `accent` role through the
  active theme anchor (`--filigrane-accent`): a canonical accent edit therefore
  does not recolour the watermark, which is its documented variant rather than
  an unconverted consumer. `app/public/favicon.svg` is a separately tracked
  head-crop derivative checked by `favicon.spec.ts`, not a runtime consumer and
  not generated here.

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

### Approved document grammar (owner rejection correction)

`cahierPdfGrammaire.ts` is the one owner of the document's reading scale and role
metrics. It separates the **source grammar** (colour/family/weight/tracking and
the 24 / 20 / 12 / 10 / 8 px rhythm of the approved generator) from the
**physical reading scale** of the approved A4 projection: the 32 pt page insets
give a 531.28 pt content box for the desktop column, i.e. 0.5258083073 pt per
CSS px (page heading 38.4 px → 20.19 pt, figure title 15 px → 7.89 pt, table
value 13 px → 6.84 pt, tick 11 px → 5.78 pt, source 10 px → 5.26 pt; the footer
is the generator's explicit 7 pt). The comparison names are the owner-fixed
exception: PRD #1014 approved **18 px CSS = 13.5 pt**, and the composer never
derives them from the uniform reading scale (the prototype's 0.5258 render
emitted 9.46 pt, which the owner rejected as shrinking).

The same correction binds the other owner roles: focal identity and comparison
names use `--editorial-muted` at weight 400 and the `0.08em` overline tracking;
the header territory uses `--accent-primary`; the wordmark is the real
`LuskBrand` role (600 italic, 1.375 rem, −0.01em, `--text-primary`) with the
ermine at `1.18em` of the word (no fixed millimetre mark); legends are one
centred row per figure in `--text-caption` (metadata face, muted) with the owner
mark geometry (18 × 3 px line, 8 × 8 px square/dot, 2 px dash, 14 px tick),
never one pack per panel; figures use the native surface/grid grammar (theme
24 % surface edge, theme 17 % grid on both axes where the native figure draws
them, `--cahier-theme-strong` axis); table captions use `--brand-700`; the
approved page box is 32 / 72 / 46 pt with the header rule at 51 pt (the live
`.page-heading` border), and the rejected full-height red notebook rule is not
painted. **The export has no section card:** the `cahier--sans-grille
.concept-group` border/padding/shadow is a screen-only surface and is
neutralised in the export shell. The approved page furniture is the header rule
at 51 pt, the repeated identity (and its comparison subtitle) at the top of
each continuation page, the page-local footnote and the sources — not a
four-edge frame around the section. This supersedes the earlier statement that
the surface was repeated on continuations; the owner's observed no-card output
and the fidelity test are authoritative.

A compared-group column now carries an explicit **`Rang`** column with the
producer-served display (`formatServedRank`, `=1er/43` for ties) or the approved
em dash when the producer served none; the rank is never a second micro-line
under the value and is never recomputed. Column groups keep focal, comparison
and rank adjacent, including when a wide grouped table is split at complete
legend-key boundaries. The 24 px heading / 20 px stacked-table / 12 px and 8 px caption rhythm
is emitted as measured block gaps, so a continuation is chosen instead of
shrinking the document.

The screen rank-chip grammar is untouched: DESIGN.md/CONTEXT.md still own the
indicator chip (new line after the reference value, `--brand-200`, tie/singleton
rules). The correction above applies only to the exported value table, which
follows the approved desktop generator (`desktop.js` prints a `Rang` column and
ink table text); it does not restyle or move any on-screen chip.

### Second owner rejection (2026-11-17): face, table orientation, figure geometry

The owner rejected the exported PDF a second time. The three complaints were
source-level, not cosmetic, and the earlier "faithful" report was not evidence:

- **Wordmark face.** The composer embedded the packaged *real* italic
  (`italicAngle −17`, advance 1.777 em, 55-point `k`) while the screen and R1–R3
  use the browser's synthetic oblique of the upright 600 face (`−14`, 1.855 em,
  33-point `k`). The derived asset, manifest `derivation.matrix` and the painted
  `lusk` advance are now pinned by `cahier-pdf-approved-grammar.spec.ts`.
- **Table orientation.** The distribution table was the exact transpose:
  columns = deciles, rows = modes, one table repeated per decile group.
  `projectExplorer` now reads rows from `distFigure.categories` (published
  labels), columns from the visible legend series, and the painter renders the
  two-level header. `projectRamps` keeps the approved flat shape A. The gate
  reads the literal matrix from the PDF, not only `Rang` text.
- **Figure geometry.** The AEDAR painters used their own 96 dpi millimetre box
  (`{top:2,right:2,bottom:2,left:9}`), invented point markers, sentence-case
  axis titles, opaque bars and a one-line panel title. They now consume the
  native 640×300 viewBox/margins and stroke grammar, paint no marker, uppercase
  the axis-title role, composite `.78`, and print the figcaption's second line.

`cahierPdfFixtures.captureExplorerRangs` was also degenerate (no focal
distribution measure, constant group value), so an otherwise correct table
looked unavailable. It now serves a varied synthetic matrix with scope-correct
ranks; the values are fixture literals, never production data.

`cahier-pdf-fidelity.spec.ts` asserts this contract on real PDFs: the embedded
role metrics and tracking advance of the focal identity, the wordmark/page-title
ratio, the shared comparison baseline and 13.5 pt owner size, the one-line
centred legend and its 18 × 3 px mark, the absence of a four-edge section card
and of a full-height red margin rule, the source table gaps, the explicit served rank
column, and compact vs measured-continuation documents. Fixtures
`captureRampeRangs` / `captureExplorerRangs` / `captureExplorerRangsDense` are
synthetic producer-shaped contracts (values, ranks and source clocks are fixed
in the fixture), not production data.

The reference gate (`E:/Temp/opencode/1024-parent-review/prototype-rejection/`)
runs against the owner-approved ARTIFACTS R1–R3, never against a previous
composer output; its owner colours are resolved from today's `tokens.css`. Three
assumptions are tightened/documented in the evidence copy rather than hidden:
the full-height-rule check targets the red margin role (a neutral section
surface is not that chrome), the continuation table gap is compared within one
page, and the frame/legend ranges cover the approved 723.9 pt content box and
the curve's native two-label legend. The owner-approved references still report
49 checks, 0 failed. Residual gate gaps are the families absent from R1–R3: the
share track has no plotted axes by owner design (its two grid checks cannot
apply), and the curve legend is not named after travel modes.

`cahier-pdf-native-paint.spec.ts` checks the emitted SVG at the public native
painter/serialization seam: literal null-gap subpath counts on both curves,
hidden bar-slot centering, unequal ramp-panel maxima, transitive `comparisonFor`
visibility, measured/mobile-anchor tick labels, the shared figure stroke
grammar, and explicit unknown-colour rejection. The `CAHIER_FIGURE_STROKE`
owner is injected on each affected SFC's own `<svg>` (access ramp, Mobilité
curve, compared bars, grouped bars) under the `--cahier-figure-stroke-*`
namespace, and each painted CSS property — grid/axis width, series width,
comparison width/dash/opacity, cap, join, marker width/dash — is asserted to
consume its own variable, with a negative corruption/removal test proving the
contract fails. The namespace is distinct from the legacy 1 CSS px
`--cahier-figure-axis-width` axis-geometry grammar (`CahierFigureAxes.vue`,
`cahierFigure.css`), so the two scopes cannot collide when nested; the native
1.5 px axis stroke is not aliased to the 1 px geometry width. The PDF painter
converts the identical object to mm.
The curve axis, ticks and marker come from the native curve projection; there is
no parallel scale fallback. It uses real embedded font metrics and selectable
PDF text, not an alternative geometry calculation. `cahier-pdf-source-colours.spec.ts`
changes the actual CSS-source input and asserts changed colours in a generated
PDF; `cahier-pdf-composer.spec.ts` does the same mutation for the brand owner's
fills. Node and browser dense scenes use the same fixture builders.

`scripts/verify-cahier-pdf-browser.mjs` builds only
`scripts/cahier-pdf-browser-probe.html` into an external directory, serves it on
a private strict port, uses the local Playwright Chromium to generate real
desktop and mobile-host PDFs with the production font/asset loader, and closes
the server. It is evidence tooling, not an application build and not the
stopped preview/prototype server. Its output is outside the repository.
The browser's independent CSS engine is compared with the PDF colour resolver,
and the same page mounts the four native stroke consumers to read the computed
stroke properties, to prove they follow a mutated injected property, and to
prove the legacy axis-geometry variable does not reach them; these are rendered
receipts, while the source contract above is the suite gate. PDF operator
streams verify full text alpha on every page and decoded raster
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



### Third bounded correction (2026-11-17): measured closure, real header ink

Independent review of `2c7833fb` and the actual running-header diagnosis (`E:/Temp/opencode/1024-parent-review/actual-app-logo/MEASUREMENTS.md`) produced six bounded corrections, each with a real-PDF check:

- **Rail units.** The measured rail rule is evaluated entirely in rendered CSS px (actual panel width and embedded-face label width), then returned as native user units. Feeding the 640-unit viewBox as the rendered width left the 16/8 px lane/gap unscaled; at half width the wide stationnement rail moved from 123.48 pt to its literal expected 126.95 pt, and the full-width case from 133.74 pt to 126.95 pt.
- **Footer.** The comparison footer now stacks a wrapped group note upwards from the approved H-35 alphabetic baseline (12 pt pitch), and the measured zone is reserved before pagination. On 02/04/06/07 the note moved from 805.91–815.09 (3.13 pt overlap with the 811.96–821.14 invitation) to 799.96–809.14 (clear).
- **Share height.** one shared body layout drives native measurement and paint (rows, wrapped state and notes). The 07 gap before « Valeurs du graphique » fell from 85.57 pt to 23.21 pt, the source 24 px heading margin plus the row's unused pitch; the reservation equals the painted height.
- **Ramp origin.** The unit stays once on the axis title, as in R1; graduations are bare (`0`, `5`, …) and the compact x labels use `xLabelOffsetAccess` (14 px) to clear the zero tick's line box. On 02, the zero label is `0` at 59.89–63.87 instead of `0 types` reaching 72.81 into `5 min`.
- **Share colours.** `CAHIER_SHARE_COLOUR` owns the 18/22/40 % mixes consumed by the share SFC and the PDF palette; the source-token mutation test now also covers `--editorial-paper-deep` and resolves both the SFC role object and the PDF palette.
- **Curve type.** `curveGeometry`/`curveSeriesPath` and the native figure geometry accept `CahierMobiliteCurveInput`; the native render context passes the captured model directly, with no `as unknown as MobiliteRaccordementEvidence` widening.

**Wordmark root cause acknowledged.** The old “origins match, so the face is canonical” claim was false: pen origins are immune to the bearing bug. The derivation now refreshes `hmtx.lsb` to the post-skew `glyf.xMin` (manifest `derivation.bearing = "glyf.xMin"`), the embedded program carries the same bearings, and the lockup top uses the measured header offset `0.792 em`. The real running header remains the reference: its `-0.01 em` header tracking is the PDF value; the landing `-0.02 em` is a separate surface. No owner choice is recorded, and A–D remain withdrawn/invalid.

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

`npm --prefix app run verify:detector` pins `impeccable@4.9.2` and reports exactly
**11 anti-patterns**, the documented baseline (same file/rule/line findings in the
eight untouched files). These 11 are **known design debt** for the DESIGN.md v2
campaign (#511), not a clean result and not an acceptance waiver; a scan is clean
only when it reports exactly these 11 and no new finding, and the debt stays open
until an owner resolves it. `4.10.0` retired the `[side-tab]` rule and reports
zero, so it is not the baseline engine. The regex pass does not exercise rendered
element rules; it is not an accessibility audit. No ignores or suppressions were
added.

### Skip audit

All formerly skipped `it.skip` cases in the Cahier PDF suite were audited against
the live native path. Six described live behaviour and now run unskipped; the
remaining cases asserted stale painter-calibrated geometry or wording that no
longer describes the native seam, so they were deleted rather than left as dead
skips. The facts they named remain covered by active native-seam tests (tables,
footnotes, failure mapping, figure geometry) and by the independent risk-claim
receipts. The only skip left in the focused suite is the opt-in review-PDF
generator (`LUSK_WRITE_REVIEW_PDFS=1`), which writes artifacts only on request.
