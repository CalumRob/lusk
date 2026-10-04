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

At run preparation, context communes are selected from the local
`communes_limites.geojson` (Admin Express COG) source; rendering does not call the
Geo API. Eligible network geometry is prepared into spatially indexed
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
```

`tests/render_rennes_car.py` is the bounded car-pair visual/alpha contract check.
`tests/render_representative.py` renders all three territories, all three modes,
and both profiles through `run_production()`. It checks the 18-output identity
set and writes `output/manifest.json` and `output/qa.json` only after the run
passes. The manifest records input fingerprints, a render identity covering the
recipe/foundation/profile contract, hashed family code/config/assets, and the
QGIS/Qt/Python runtime; it also lists authoritative source paths and file
versions plus a SHA-256 per rendered artifact. Render/QA timings and preparation
progress are printed during execution. Outputs and source caches remain ignored
local pipeline artifacts, never application publication assets. This representative
check does not implement #611's approval-gated full batch or retries.
