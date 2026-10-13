# Production map assets

## Selected AEDAR static family — durable generation and R2 staging

The owner-selected shared car/loss treatment from [#733](https://github.com/CalumRob/lusk/issues/733)
now lives in this directory, not in temporary comparison scripts. `aedar-static-family.json`
owns the mode-to-fact mapping, selected palette, profile sizes and publication namespace.
The older exploratory/car-only sections below describe their independent historical paths;
they do not override this selected shared-family contract.

- Five readings: `car` (absolute diversity), `transit` (p1 loss), `bike_lts2`,
  `bike_lts4`, `walk` (exact car-only TYPEQU losses), all at 15 minutes.
- Both q80/method-4 WebP profiles: `inspection` 2400×2400 and `inline` 900×900.
- Occupied 9 px hexes, uncapped address medians, genuine zero and unfilled empty cells.
  Inspection keeps exterior address points and native padded legend clearance.
- Car: fixed 0–218 range and address-weighted Bretagne mean. Losses: each territory's
  actual pooled min/max across all four loss readings, one fixed palette, no mean pointer.
- Equal-width legend ticks display integers when class width >1; classification keeps
  the exact unrounded boundaries. Missing-address territories are skipped and reported,
  never given fabricated zeros/ranges.

### Future generation (do not rerender just to stage the completed export)

```powershell
$qgis = 'E:\Program Files\QGIS 3.44.14\bin\python-qgis-ltr.bat'
$maps = 'E:\Lusk\pipeline\maps\production'
& $qgis -B "$maps\run_aedar_static_maps.py" --plan-only --workers 4
& $qgis -B "$maps\run_aedar_static_maps.py" --check-only --workers 4
# Only when deliberately starting a new batch; context acquisition is explicit:
& $qgis -B "$maps\run_aedar_static_maps.py" --workers 4 --acquire-context
```

Default local output: `output/aedar-static-full/`; artifacts remain in private
`shard-N/` folders for resumable generation. `run.log`, worker logs and `progress.json`
provide flushed progress. In another PowerShell window:

```powershell
Get-Content -LiteralPath 'E:\Lusk\pipeline\maps\production\output\aedar-static-full\run.log' -Encoding UTF8 -Tail 50 -Wait
```

`--raw-dir`, `--facts-path`, `--output-dir`, `--context-cache-root` and `--workers 1|2|4`
are explicit inputs. An existing validated context can be supplied instead of
`--acquire-context`; rendering is otherwise offline and fails when context is missing.
Planning/checking never acquire context or render. Private worker caches share a validated
seed, not mutable concurrent writes. Changed inputs cannot be mixed into completed outputs.
The native runner's candidate `inspection-refresh` scope is not a claim of full production
approval, and the command has no upload path.

### Stage the existing images; use the usual R2 uploader

```powershell
& $qgis -B "$maps\package_aedar_maps.py" --source-dir '<completed-export-directory>'
& "$maps\upload-maps.ps1" -OutputDir "$maps\output\aedar-static-publish"
```

The package is a **flat WebP directory**, not worker shards:
`output/aedar-static-publish/`. It contains the familiar `full-manifest.json`,
`full-qa.json` and `upload-manifest.json`, plus preserved source evidence and `package.log`.
Packaging copies existing bytes, verifies their hashes and decoded profiles, and neither
rerenders nor uploads. The two islands missing from the completed 2026-10-13 batch
(Île-de-Sein and Île-Molène) are explicit `missing_territories`, not phantom upload entries.

The existing uploader is now maintained at **`upload_maps.py`**, with the same local
`lusk-r2` credentials profile, dry-run default, SHA-256 metadata, remote HEAD checks,
conflict refusal, conditional replacement and approval gate. Its default output/prefix
remain the incumbent network workflow; `--output-dir` selects AEDAR's own manifests.
SDK pin: `r2-requirements.txt`. Dry-run does not need credentials or make network requests.
The established PowerShell launcher is now repo-owned as `upload-maps.ps1` and reuses
its existing `output/.r2-upload-runtime` (already containing boto3), independently of QGIS.
`-OutputDir` selects the AEDAR package; omit it to retain the incumbent network selection.
After the usual approval is recorded, add `-Upload` to that same command. No separate
SDK installation or QGIS launcher is needed for upload.
The old `output/upload-network-maps.ps1` path remains a compatibility alias.

Owner-approved AEDAR object contract:

```text
bucket: lusk
key: maps/aedar/v1/{code}-{mode}-{profile}.webp
URL: https://images.calumrobertson.fr/maps/aedar/v1/{code}-{mode}-{profile}.webp
example: https://images.calumrobertson.fr/maps/aedar/v1/35238-car-inline.webp
```

These are **planned URLs until uploaded**, not live endpoint claims. Existing network
`maps/v1/` keys are untouched; the uploader rejects an AEDAR prefix override to that
namespace. This change does not switch an application consumer. Upload still requires
the usual passed QA plus human visual approval; packaging does not invent that approval.
After actual approval, the same helper's `--upload` switch is the deliberate publication
step, and its JSONL event log remains under the selected package's `logs/`.

Migration evidence (2026-10-13): the completed 1,266-territory export was staged as
12,660 byte-identical WebPs (6,330 per profile); decoded QA and the usual upload dry-run
passed. The durable renderer reproduced all 40 native WebPs for Allineuc, Rennes,
Redon and Bretagne byte-for-byte against that completed export. Plan-only/check-only
validated the source-derived full inventory without a new full render or acquisition.
The staging package has a short `PACKAGE.md`; full-batch multiprocessing through the
new repo entrypoint has not been rerun as part of this migration.

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

Inspection framing is a shared exception to the analytical square frame. The
full-inventory binders measure the four registered production heading bands
once, derive each exact-name subtitle band, and store the least safe square as
`inspection_extent` when filled territory geometry contacts a padded band plus
12 px. The frame calculation includes the rendered fill's one-pixel antialias
reach so those pixels clear the band; outline-stroke-only fringes do not qualify.
The runner uses that extent only for `inspection`; the original `extent`
continues to own inline geometry, identity and output. Shared context
preparation and `prepare_mainland_context.py` use the same union of selected
profile frames, while inspection effective identity includes the selected
inspection extent. Network modes and AEDAR car inherit the same bound frame.

Before inspection rendering, acquire context explicitly with
`python pipeline/maps/production/prepare_mainland_context.py` in a QGIS-enabled
Python environment. The command derives its EPSG:2154 bbox from the current
map-ready frames, including the inspection-only frame when that profile is
selected. `run_production()` and shared-ground preparation are
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

## AEDAR building-level exploration

The AEDAR access-map exploration is an isolated map family. It uses the shared
production runner, map-ground/context preparation, and exact inspection-plate
title/branding compositor, but does not invoke the network-family renderer.
Prepare and render Allineuc (rural commune), Redon Agglomération, and Bretagne maps (car, transit
P1, and bike LTS2) in inspection and inline profiles with the QGIS Python launcher:

```powershell
& 'E:\Program Files\QGIS 3.44.14\bin\python-qgis-ltr.bat' pipeline/maps/production/run_aedar_maps.py
```

The script reads the address-origin spine from
`E:\batiments-equipements\data\matrice\full-bretagne-address-2026-09-14-current35-tobler-publication-2026v1\address-origins.parquet`,
derives each territory's independent equal-width scale across car, transit and
bike LTS2 diversity at 15 minutes, and writes only to the ignored exploratory
output directory. Inspection includes address-origin points in the full map
frame, with points outside the analytical territory desaturated; inline is a
transparent territory cut-out with median-coloured hex cells and no map furniture. Equal-width breaks are
shared by both profiles. Every territory/mode pair also has a continuous-ramp
counterpart, interpolated within that mode's established colour family; the
original stepped maps remain for comparison. Inline maps carry no embedded
legend. It is not a publication step and does not establish production defaults. It writes
`contact-sheet.png`, `manifest.json`, and `qa.json` alongside the artifacts.
The default context cache reuses the validated representative-scope official
context generation; the Allineuc frame is contained within the Bretagne frame
already covered by that generation. Override `--context-cache-root` to select
another validated generation.

For equal-width maps of car diversity and exact car-only equipment
losses by transit, bike LTS 2/LTS 4, and walking, run `run_aedar_loss_maps.py` with the same QGIS launcher. It writes to
the separate ignored `output/aedar-bretagne-equipment-loss/` directory. Car uses
the shared 0–218 diversity scale; transit, bike LTS 2/LTS 4, and walk count, per
address, BPE types reachable by car but not by the comparison mode. All four
loss maps use the same car-pink ramp, with darker colours for higher loss; title
accents retain each mode's AEDAR prototype colour. The loss ramps use five equal-width classes and a shared cap per
territory, calculated as the 95th percentile across all four loss scenarios;
higher values saturate at the darkest colour and the legend endpoint uses a
`+` (for example, `100+`). Every class boundary is labelled. Inspection titles
name the mode, the lower helper states the 15-minute car comparison, and inline
remains a furniture-free hex-grid cut-out. The 30 outputs have their own
manifest, QA report and contact sheet; this exploratory comparison does not
replace the stepped/continuous map set or define production defaults.

The owner has since selected **margin-red for loss maps**, darker for greater
loss, with the legend title **Types d'équipements BPE rendus inaccessibles**.
The green trial was rejected because its marks compete with the OCS-GE ground.
The isolated margin-red proof lives under ignored `output/aedar-red-loss-prototype/`;
the exploratory adapter above still uses its original pink/content contracts
until this decision is promoted into the production family. Car diversity
remains in the car colour family. This palette decision does not authorize
application publication or a full batch.

The combined AEDAR exploration continues to export **PNG evidence**. The separate
car-only production path below exports canonical WebPs through the shared
`webp_encoding.py` contract; it does not promote the exploratory loss family,
change its palette/content, or overwrite historical PNGs.

The owner-selected AEDAR profile contract is **points for inspection, hexes
for inline** (see « Grille hexagonale AEDAR » in `CONTEXT.md`). For each territory,
inline prepares the hex geometry and address membership ONCE for all modes,
then computes all bound metric medians on that shared grid. Subsequent modes
reuse both geometry and medians. Hexes are 9 px wide at the 900 px source size
(3 px at 300 px display size). Car colour represents median diversity; other
modes use median exact car-only TYPEQU loss. Values are aggregated before
applying each map's render cap. True zeros participate in medians and receive
the lowest colour; cells without addresses have no thematic fill. Unexpected
missing/non-finite values fail validation, never become zeros. Counts do not
determine colour or opacity; no smoothing/interpolation fills unoccupied cells.
The grid and medians are cached within the run, not persisted or prepared again
for every mode. `manifest.json` and `qa.json` expose `aedar-hex-grid` stage rows
with grid identity, occupied/address counts, all prepared metric fields, and
`built`/`reused` decisions, so preparation cost is auditable.

AEDAR rendering also shares the expensive mode-neutral work:

- Bound metric fields, territory caps and normalized facts paths are indexed
  in one binding scan. Frame/point/hex renders use lookups, not a scan over the
  complete atlas binding for each output.
- The authoritative commune source is read once into a run-owned spatial index.
  Frame queries filter bounding-box candidates by real rectangle intersection,
  preserving the OGR provider's selection for irregular polygons and source CRS.
- Inspection creates each address geometry once per territory, with all bound
  metric fields and their contract-derived caps. Each mode only selects its
  field and renderer. Inline medians still use the uncapped facts.
- Inspection background/desaturation and outside-land coverage are prepared
  once per territory and reused. Every plate paints onto an image copy; titles,
  furniture and point colours remain mode-specific.
- Inline omits the unused inspection land mask. Full-land masks shortcut only
  valid, completely covered polygonal frames; partial coverage, holes and
  overlapping/invalid polygon parts keep the exact original Qt rasterizer.
- Engraved ink and furniture desaturation process only their mask's pixel
  window, retaining the original arithmetic, rounding, alpha and edge relief.
- Territory-local rasters, coordinates, point layers and hex cells are released
  at the runner's territory boundary, including on failures. Shared providers
  and the commune index remain available for the run.

The manifest exposes `aedar-bound-contracts`, `aedar-address-points`, `aedar-inspection-context`, and
`aedar-territory-release` rows alongside hex preparation. Ignored diagnostic
scripts under `output/aedar-performance/` measure cold-frame/fresh-output cost
and require SHA-256 equality with accepted PNGs. Fresh outputs and cold source
derivatives are different measurements: include binding, shared preparation,
frontier preparation, render and QA costs when budgeting a complete run. Do
not extrapolate a representative run that reused inspection outputs into a
full-atlas ETA.

## Car-only AEDAR production (#730)

`aedar_car.py` binds the reviewed **absolute car diversity at 15 minutes**, five
equal-width classes over 0–218. Inspection retains exact address points at
2400×2400; inline retains occupied median hexes at 900×900 (9 px cells), true
zeros, unfilled empty cells and the transparent cut-out/shadow. It reads only
the prepared car metric, address identifiers, commune membership and coordinates;
no loss fields, loss preparation or per-territory loss caps are required.

Both scopes use this same contract. Full inventory and analytical commune
memberships come from the shared authoritative geography builder, configured
departments and pinned EPCI metadata. Redon's administrative outline can extend
outside Bretagne; its analytical geometry/address membership remains Breton.
Inventory counts are derived from the current sources, never from filenames or
fixed expected totals. Each territory releases its rasters, point layers, frame
data and hex cells at its boundary; full-run stage diagnostics use the shared spool.

The canonical encoder is pipeline-local Pillow 12.3.0, RGB quality 80/method 4,
`exact=True`, lossless alpha quality 100. Encoding proves exact source alpha;
decoded native dimensions/channel QA runs before atomic stage promotion. Failed
encoding or QA preserves any previous canonical artifact and discards its stage.
Retries verify identities, artifact hashes and decoded WebP contracts before reuse.
Facts, scale, content, code/assets/runtime, encoding, profiles, official context,
commune-frame source bytes and inspection OCS-GE source bytes enter effective
identities. Automated QA is not a human visual acceptance.

Prepared `address-access-metrics.parquet` must already exist. A car-only parquet
with the same required columns is also valid; use `--facts-path` to select it.
This command never rebuilds address-routing facts. First render the exact
Allineuc (`commune/22001`), Redon (`epci/243500741`) and Bretagne (`region/53`)
six-artifact review cohort in a separate output directory:

```powershell
& 'E:\Program Files\QGIS 3.44.14\bin\python-qgis-ltr.bat' `
  pipeline/maps/production/run_aedar_car_maps.py `
  --scope representative `
  --output-dir pipeline/maps/production/output/aedar-car-review `
  --source-cache-owner pipeline/maps/production/output/aedar-bretagne-equipment-loss
```

`--source-cache-owner` optionally reuses source derivatives at their existing
owning paths, not output images; copying path-bound manifests into a fresh root
is not valid reuse. Missing/stale derivatives rebuild under that owner. The
existing `output/aedar-rennes-inspection/.stage-cache/official-context` generation
remains the default official-context root. `--refresh` rebuilds outputs and
source derivatives; omit it for an unchanged verified retry. The CLI writes
manifest/QA evidence and exits nonzero for incomplete artifact coverage.

After a human has inspected the **actual decoded native WebPs**, the operator
may explicitly record that review (do not execute this step from automated rendering):

```powershell
& 'E:\Program Files\QGIS 3.44.14\bin\python-qgis-ltr.bat' `
  pipeline/maps/production/record_aedar_car_approval.py `
  --manifest pipeline/maps/production/output/aedar-car-review/manifest.json `
  --qa pipeline/maps/production/output/aedar-car-review/qa.json `
  --reviewer '<human reviewer>' --outcome approved `
  --output pipeline/maps/production/output/aedar-car-review/human-approval.json
```

The recorder requires complete six-artifact QA, the current car recipe/native
encoding, matching effective members, current artifact hashes and decoded QA.
Old PNG evidence, the network's 18-artifact approval, partial cohorts, wrong
territories/profiles and stale recipe/renderer/data cannot authorize this path.
The default shared network approval contract remains unchanged.

A separately authorized future full run uses `--scope full --approval <record>`
and a separate full output directory. It independently recomputes the current
representative identities before creating the full output directory or preparing
full-scope sources. It uses shared checkpoint/retry and exact inventory QA, and
leaves post-batch human spot checks pending. Neither command publishes/deploys
assets. **#730 authorizes the bounded proof, not the full atlas run.**

## Verification

Run the fixture suites from the repository root with QGIS-enabled Python:

```text
python -m unittest pipeline.maps.production.tests.test_contract pipeline.maps.production.tests.test_network_cache pipeline.maps.production.tests.test_network -v
python -m unittest pipeline.maps.production.tests.test_inline_contract -v
python -m unittest pipeline.maps.production.tests.test_approval -v
python -m unittest pipeline.maps.production.tests.test_checkpoint pipeline.maps.production.tests.test_webp_encoding -v
python -m unittest pipeline.maps.production.tests.test_aedar_hex_grid pipeline.maps.production.tests.test_aedar_hex_rendering -v
python -m unittest pipeline.maps.production.tests.test_aedar_commune_frames pipeline.maps.production.tests.test_inspection_pixel_cost -v
python -m unittest pipeline.maps.production.tests.test_aedar_car -v
python -m unittest pipeline.maps.production.tests.test_inspection_frame -v
```

Run QGIS-owning test modules in separate Python processes: some older fixtures
call `exitQgis()` in teardown, so one combined discovery process is not safe.

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

## Targeted network inspection refresh (#731)

`run_network_inspection_refresh.py` derives the complete live network binding,
selects only territories whose shared `inspection_extent` differs from the
analytical `extent`, and renders all three network modes in the inspection
profile. It excludes inline and AEDAR outputs. The default output is the
isolated `output/network-inspection-refresh/`; the script acquires the exact
selected-frame official context there and reads the prepared network-source
cache read-only. It does not write canonical map files or contact R2.

```powershell
& 'E:\Program Files\QGIS 3.44.14\bin\python-qgis-ltr.bat' `
  pipeline/maps/production/run_network_inspection_refresh.py
```

The run writes `manifest.json`, `qa.json`, a deterministic high-expansion
`spot-check-sheet.png`, and `replacement-plan.json`. Plan generation verifies
that each candidate's previous local WebP still matches the prior
`full-manifest.json`, binds the new hashes to the candidate manifest, and
selects only affected network inspection keys. QA remains pending until the
spot-check is explicitly recorded:

```powershell
& 'E:\Program Files\QGIS 3.44.14\bin\python-qgis-ltr.bat' `
  pipeline/maps/production/record_spot_check.py `
  --qa pipeline/maps/production/output/network-inspection-refresh/qa.json `
  --reviewer NAME --outcome approved `
  --output pipeline/maps/production/output/network-inspection-refresh/human-spot-check.json
```

The local R2 operator helper accepts that replacement plan with
`-Manifest ...\replacement-plan.json -Qa ...\qa.json`. Before any PUT it
requires remote HEAD metadata to match the plan's expected previous SHA-256,
size, and WebP content type. A retry skips an object already matching the new
hash; missing or conflicting remote objects fail closed. After replacement it
verifies the new remote size/hash metadata. The helper never discovers or
widens the selected object set, and this agent does not contact R2.
