# Production map assets

The selected-CS colour subset in `network-palette.json` records the used OCS-GE
classes and the approved map treatment. The original class-colour source is
`E:/lusk-hero/visual-class-map-paper.csv`; production ground rule expressions
are intentionally limited to those classes and the `US6.3` use filter.

`assets/texture/qgis-hub-paper-texture-cc0.jpg` is the paper texture used by
the accepted map-ground review, identified there as QGIS Hub CC0. Its source
license attribution is preserved by the review asset; this tracked copy exists
so rendering does not depend on a QGIS Hub installation path.

The font files are Mozilla Headline, Mozilla Text and Newsreader Variable Latin
faces from Fontsource. Their Fontsource license copies are next to the files.
The production plate instances the approved CSS weights from these tracked
faces; it does not depend on the main checkout's `node_modules`.

`assets/north-arrow/NorthArrow_11.svg` is the exact QGIS 3.44 LTR SVG used by
the accepted inspection prototype (`apps/qgis-ltr/svg/arrows/NorthArrow_11.svg`).
Its QGIS-provided `param(fill)` and `param(outline)` are both bound to the
approved furniture green at render time. QGIS is GPL-2.0-or-later; the source
SVG remains attributed to the QGIS project.

The inspection compositor ports the accepted vector-glyph engraving, quiet-zone
desaturation, furniture and footer. The map-ground module ports the selected-CS
renderer, official land context, profile masks and texture pipeline. Inline
exports are paper-only (no OCS-GE fills), clipped to the analytical geometry,
and carry a black Gaussian cut-out shadow (6 px radius, σ 3 px, 25% opacity,
2 px downward offset). A regional frontier remains visible on cross-border
analytical cut-outs such as Redon's. Inspection styling is unchanged. Production
code does not import or execute the prototype or review scripts.

`run_production(..., refresh=True)` deliberately bypasses persistent output reuse,
forces fresh OSM/Geovelo generations, and rebuilds derived context/ground stages. Default runs reuse an
output only when its effective feature/recipe/profile identity matches the
manifest and its bytes still match the recorded SHA-256; missing, changed, or
corrupt files are rendered again. The returned outputs record `decision` and
`effective_identity`; validated persistent ground artifacts live below
`output/.stage-cache/ground/`, keyed by map geometry, profile and visible context;
the dissolved local commune context is persisted separately under
`output/.stage-cache/context-land/` by canonical, clipped effective geometry.
The provider is reopened and scoped geometries fingerprinted on each run to validate
that cache; reports distinguish that validation from a context-union cache hit.
QA includes per-stage/profile build/reuse timings plus aggregate adapter preparation.
The adapter-preparation aggregate is a neutral `completed` event; its constituent
stage events remain the authority for build/reuse decisions. Network content
identity includes the stroke's physical width, round caps/joins, opacity and
one-pixel antialias reach. Inline network geometry is scoped to the analytical
cut-out plus that profile-scaled influence halo; inspection is scoped to the full
map frame. Influence scopes are integrity-checked in the stage cache, and exact
clipped ground derivatives are shared across the content and ground identities
for matching territory/profile inputs in a run. Rendering itself is unchanged.
The manifest approval identity names the territory/mode/profile outputs in the
requested binding and marks whether each has the complete inline+inspection pair.
Renderer cache contracts are deliberately scoped: network-family colours and
inspection furniture/citations bind at mode/profile boundaries; bump the explicit
shared-ground, inline-mask or network-render version when its rendering algorithm
changes rather than treating the all-files provenance digest as a reuse key.

Before inspection rendering, acquire context explicitly with
`python pipeline/maps/production/prepare_mainland_context.py` in a QGIS-enabled
Python environment. The command derives its EPSG:2154 bbox from the current
map-ready frames. `run_production()` and shared-ground preparation are
offline-only: they load a validated local generation and fail clearly if the
matching frame generation is absent. Inspection land context is a distinct,
frame-scoped `ADMINEXPRESS-COG.2026:commune` WFS source. A dated hits query and
one full-geometry response must agree on matched/returned/feature counts and
unique stable IDs; CRS, schema, polygon structure and requested-frame coverage
are checked before a generation is atomically promoted. Results above the
advertised one-response capacity fail rather than paging a non-transaction-safe
service. Validated local generations are consumed offline by renderers, and a
failed refresh leaves the previous generation in place. This is separate from
the analytical `communes_limites.geojson` source and does not rewrite it.
Source edition, requested EPSG:2154 frame, counts and content SHA-256 appear in
the QA stage report. Eligible network geometry is prepared into spatially indexed
FlatGeobufs under `pipeline/maps/.cache/network-sources/`: OSM car and walk are
classified during one source scan, while Geovelo protected and shared cycling
are classified during one France-wide source scan. OSM and Geovelo use
independent manifests, source signatures and preparation versions, so a change
to one family does not invalidate the other. A complete generation is
atomically selected only after all of its artifacts have been written and
validated; a failed refresh leaves the previous generation available.

The runner prepares a missing or stale family automatically. To prepare or
check both families before rendering, run
`python pipeline/maps/production/prepare_network_sources.py` from a QGIS-enabled
Python environment. Pass `--family osm` or `--family geovelo` to prepare one
family, or `--cache-dir PATH` to use a different cache location. Every map in a
run then reuses the prepared OSM/Geovelo providers. OCS-GE providers are opened
read-only each run for effective-content validation and rendering; effective
features feed profile-scoped identities and the validated ground-stage cache.
The approved paper texture is loaded once per run. Inline-only runs do not require
inspection metadata, OCS-GE, fonts or furniture assets.

Full-run diagnostics are flushed as fsynced JSONL rows
to anonymous temporary streams at territory boundaries. The existing ordered
`stage_report` fields are reconstructed for final manifest/QA evidence after
rendering; the adapter retains only the current territory's scalar diagnostics,
not prior territories' event dictionaries or QGIS geometry/raster objects.
Expected-output coverage and output records remain in their authoritative
manifest/checkpoint structures.

Authoritative network providers are opened force-read-only: QGIS's default
GeoPackage access can touch input timestamps even without editing features.
The source signature includes its resolved path, byte size and nanosecond
modification time, as well as the family's preparation/filter version.

Within a run, the exact land frontier is prepared once per region geometry and
shared by all territories and profile sizes; its rendered stage is also reused
across matching modes and later runs. Inline geometry QA uses prepared
geometry engines for the same boundary-distance and containment checks,
including polygon holes; neither optimization simplifies the geometry or
changes the approved rendering.

## Verification

Run the fixture suites from the repository root with QGIS-enabled Python:

```text
python -m unittest pipeline.maps.production.tests.test_contract pipeline.maps.production.tests.test_network_cache pipeline.maps.production.tests.test_network -v
python -m unittest pipeline.maps.production.tests.test_inline_contract -v
python -m unittest pipeline.maps.production.tests.test_approval -v
python -m unittest pipeline.maps.production.tests.test_checkpoint pipeline.maps.production.tests.test_webp_encoding -v
```

Network map products use a pipeline-local, pinned Pillow WebP encoder rather
than QGIS's bundled Pillow. Install it with the QGIS Python launcher before
running production renders:

```powershell
& .\pipeline\maps\production\install_webp_encoder.ps1
```

The setup pins Pillow 12.3.0 and installs only under
`pipeline/maps/production/.runtime/site-packages`; it does not modify QGIS,
global Python, or other pipeline runtimes. The network artifact contract is
WebP RGB quality 80, method 4, exact transparent RGB preservation, lossless
alpha quality 100, native 2400×2400 inspection and 900×900 inline. Contract
settings and dimensions participate in renderer, effective-output and approval
identities. Existing reviewed PNG artifacts are historical evidence and are
not overwritten or reused as canonical WebP outputs.

`tests/render_rennes_car.py` is the bounded car-pair visual/alpha contract check.
`tests/render_representative.py` renders all three territories, all three modes,
and both profiles through `run_production()` at the canonical native sizes. It checks the 18-output identity
set and writes `output/manifest.json` and `output/qa.json` only after the run
passes. The manifest records input fingerprints, a render identity covering the
recipe/foundation/profile contract, hashed family code/config/assets, and the
QGIS/Qt/Python runtime; it also lists authoritative source paths and file
versions plus a SHA-256 per rendered artifact. Render/QA timings and preparation
progress are printed during execution. Outputs and source caches remain ignored
local pipeline artifacts, never application publication assets. This representative
verification does not publish anything.

For a separate native WebP review run that must not touch historical PNG evidence,
pass a worktree-owned output directory and explicit read-only paths for the
existing main-checkout raw sources, source-cache generations and validated
official-context generation. `--read-only-source-cache` fails closed on any
missing/invalid source generation instead of creating or mutating one:

```powershell
& 'E:\Program Files\QGIS 3.44.14\bin\python-qgis-ltr.bat' `
  pipeline/maps/production/tests/render_representative.py `
  --output-dir pipeline/maps/production/output/webp-native-review `
  --raw-dir E:\Lusk\pipeline\data\raw `
  --network-cache-root E:\Lusk\pipeline\maps\.cache\network-sources `
  --read-only-source-cache `
  --context-cache-root E:\Lusk\pipeline\maps\production\output\.stage-cache\official-context
```

Run this proof only after scoped implementation review; then inspect its fresh
WebP artifacts and QA before recording a new human approval. The worker does
not create approval records or run a full batch.

## Approval-gated full network batch

The complete inventory is derived by `build_full_map_set()` from the current
map-ready commune file, configured analytical departments, and pinned EPCI
labels/membership metadata. It is not inferred from existing image files. In
the current source snapshot this resolves to 1,202 communes, 61 EPCIs, 4
departments and Bretagne (1,268 territories), 3 modes and 2 profiles; counts
are observations from that input inventory, not literals in the builder.

Before running either batch, acquire the exact coverage frame separately and
offline-render from its local validated generation:

```text
python pipeline/maps/production/prepare_mainland_context.py --scope representative
python pipeline/maps/production/tests/render_representative.py
python pipeline/maps/production/record_network_approval.py --manifest pipeline/maps/production/output/manifest.json --qa pipeline/maps/production/output/qa.json --reviewer NAME --outcome approved --output pipeline/maps/production/output/human-approval.json
python pipeline/maps/production/prepare_mainland_context.py --scope full
python pipeline/maps/production/run_full_network.py --approval pipeline/maps/production/output/human-approval.json
python pipeline/maps/production/record_spot_check.py --qa pipeline/maps/production/output/full-qa.json --reviewer NAME --outcome approved --output pipeline/maps/production/output/human-spot-check.json
```

The reviewer must open the representative pair for all three territories and
modes before recording approval. The resulting record is bound to each of the
18 current effective visible-input/profile/encoding identities and the recipe,
foundation and renderer identity. Full runs first reject malformed, wrong
recipe/renderer, partial-cohort or non-affirmative records cheaply. They then
prepare only the bounded representative footprint in a temporary stage area,
recompute all paired identities from live local inputs, and reject stale
approval before creating/mutating the full output directory or starting full
shared preparation. Only after that gate does `run_production()` prepare the
full binding and render. Do not edit or synthesize approval JSON.

The full-context hit-count feasibility probe is recorded at
`E:\Temp\opencode\issue-611-full-context-hits.json`: the actual derived frame
union matched the existing Bretagne representative frame, and the dated IGN
2026 WFS hit response was within the advertised one-response limit. This is
run-specific acquisition evidence, not a frame/count constant in code. The
full preparation still derives its bbox from the live full inventory, fetches
and validates the complete geometry response, and fails if its live count
exceeds supported single-response capacity; it never truncates or pages the
non-transaction-safe service.

Batch QA writes `full-manifest.json` and `full-qa.json` including the complete
expected matrix and per-output failures. Successful unchanged files remain
reusable on retry; missing, corrupt, changed or failed files are rebuilt and
validated. `status=passed` is automated QA only; `production_status` remains
`awaiting-human-spot-check` until the adapter-selected high-risk files have
been visually reviewed and `record_spot_check.py` records the human outcome.
The script also records a rejected outcome; rejection leaves production
incomplete so the artifacts can be corrected and rerun/reviewed.
Nothing in this workflow publishes assets to the application or Cloudflare.

### Department-title-only repair

After the display-name binding change, a full batch whose other inputs and
artifacts remain verified can be repaired without rerunning the batch. The
operator requires a **current affirmative human representative approval**;
missing, rejected, or stale approval fails before output mutation. The command
derives the department inspection cohort from the current full inventory,
checks all prior batch artifact hashes, validates current representative
identities and source versions, and requires each full-manifest record to agree
with its `.production-manifest.json` cache entry. A missing or stale cache fails
closed before rendering or promotion. It records the authoritative department-label
registry path and hash, and stages/decodes all replacements under the selected
output directory before promoting any. Full QA remains explicitly incomplete
until the reconciled manifest, output cache, and promotion journal are durable.
It preserves the prior full manifest, QA, and replaced images
under `output/repair-evidence/`. Automated QA does not approve title wording:
the reconciled QA returns to `awaiting-human-spot-check`.

Shared preparation uses the current full map binding and the existing
`output/.stage-cache` root, preserving the exact pre-acquired official-context
frame and reusable full-run ground/frontier caches. The runner still receives
only department features for staged rendering; repair scope never broadens to
the full output matrix.

Run from a QGIS-enabled Python environment only after the new approval record
exists; this command neither creates approval nor acquires inputs:

```powershell
& 'E:\Program Files\QGIS 3.44.14\bin\python-qgis-ltr.bat' `
  pipeline/maps/production/repair_department_titles.py `
  --approval pipeline/maps/production/output/human-approval.json
```

Use `--output-dir`, `--raw-dir`, `--network-cache-root`, and
`--context-cache-root` only to point at the existing production output, raw
sources, and validated local cache generations. A promotion interruption is
marked incomplete in both the repair journal and full QA; use its evidence
directory for manual recovery before retrying.
