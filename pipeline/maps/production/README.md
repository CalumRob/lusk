# Production map assets

## Selected AEDAR static family — durable generation and R2 staging

`batch_execution.py` owns deterministic weighted whole-territory scheduling,
worker-private `shard-N/`, `cache-N/`, and `source-N/` paths (including copies
from validated immutable preparation seeds), subprocess lifecycle, flushed
logs and progress, and failure preservation. AEDAR supplies its address-based
cost estimate, validated seed evidence, worker command, expected artifact
matrix, rendering and validation. The common executor does not replace the
existing runner checkpoints or family QA/approval/publication semantics.
Four workers remain the default; explicit overrides are 1/2/4. Worker progress
continues to use the existing runner protocol `[maps] n/n`; the aggregate
`TOTAL completed/expected validated WebPs` line is emitted at each 25-output
milestone and completion.

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

### Cartographic ownership seam

The validated `cartographic_policy.py` owns shared physical defaults such as
the square-frame margin and inspection ground. Network and AEDAR recipes and
frame construction consume that policy; family declarations retain thematic
composition. `inspection_headings.py` composes the approved three network
templates plus the selected-car template; the generic frame geometry accepts
those measured headings and owns no family title/content imports. `runner.py`
consumes map-ready inputs and adapter capabilities; it does not infer evidence
semantics from a broad family label. Selected AEDAR inline legend metadata is
declared by `AedarStaticAdapter`, whose selected facts include the scale
contract. Historical AEDAR car/exploration adapters remain valid native callers
but do not claim that capability; their evidence is not rewritten to satisfy
the selected sidecar schema. Shared map framing, profile behavior and furniture
mechanics remain foundation policy, while family recipes/adapters own thematic
marks, scales and semantic content.

### Future generation (do not rerender just to stage the completed export)

```powershell
$qgis = 'E:\Program Files\QGIS 3.44.14\bin\python-qgis-ltr.bat'
$maps = (Resolve-Path .\pipeline\maps\production).Path
# Inspect the source-derived inventory and validate a completed export; neither renders.
& $qgis -B "$maps\run_aedar_static_maps.py" --plan-only --workers 4
& $qgis -B "$maps\run_aedar_static_maps.py" --check-only --workers 4
# Deliberate new generation only, after inputs/context are ready:
& $qgis -B "$maps\run_aedar_static_maps.py" --workers 4
```

Default local output: `output/aedar-static-full/`; artifacts remain in private
`shard-N/` folders for resumable generation. `run.log`, worker logs and `progress.json`
provide flushed progress. In another PowerShell window:

```powershell
Get-Content -LiteralPath (Join-Path $maps 'output\aedar-static-full\run.log') -Encoding UTF8 -Tail 50 -Wait
```

`--raw-dir`, `--facts-path`, `--output-dir`, `--context-cache-root` and `--workers 1|2|4`
are explicit inputs. An existing validated context can be supplied instead of
`--acquire-context`; rendering is otherwise offline and fails when context is missing.
Planning/checking never acquire context or render. Private worker caches share a validated
seed, not mutable concurrent writes. Changed inputs cannot be mixed into completed outputs.
The native runner's candidate `inspection-refresh` scope is not a claim of full production
approval, and the command has no upload path.

### Package existing bytes; approval and publication

```powershell
& $qgis -B "$maps\package_aedar_maps.py" --source-dir '<completed-export-directory>'
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
The ignored local `output/upload-network-maps.ps1` is not maintained source and is
not a supported route. Use the tracked `upload-maps.ps1` only. Exact-package AEDAR
approval is recorded with the dedicated #777 interface (PR #778; integration is
contingent on its review/merge):

```powershell
python -B "$maps\record_aedar_package_approval.py" `
  --package-dir "$maps\output\aedar-static-publish" `
  --reviewer '<human reviewer>' --outcome approved
```

Never substitute historical six-car or network approval. The canonical publisher's
first invocation is dry-run and does not upload:

```powershell
& "$maps\upload-maps.ps1" -OutputDir "$maps\output\aedar-static-publish"
# Only after reviewing dry-run and package approval, explicitly authorize upload:
& "$maps\upload-maps.ps1" -OutputDir "$maps\output\aedar-static-publish" -Upload
```

No publication is performed as part of this documentation change.

### AEDAR inline legend metadata

Inline maps have an image-bound, readable JSON sidecar at the same registered AEDAR key prefix.
For a preserved approved package, run the metadata-only backfill in the QGIS Python runtime
(it reads Parquet metrics only; it does not load geometry, render, or rewrite package evidence):

```powershell
& $qgis -B "$maps\backfill_aedar_inline_legends.py" `
  --package-dir "$maps\output\aedar-static-publish" `
  --facts "$pipeline\data\processed\aedar\maps\bretagne-frame\address-access-metrics.parquet" `
  --output-dir '<separate-sidecar-staging-directory>'
```

The command verifies the prepared-facts and family/plan signatures, complete inline coverage,
original package approval bindings and every image digest. It writes an independent
`inline-metadata-manifest.json`; changed or unverifiable source evidence fails closed. Dry-run
publication uses the existing uploader and original package as `-OutputDir`, specifying the
sidecar manifest with `--manifest`. Only the selected JSON objects are uploaded; the original
image approval remains authoritative and unchanged.

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

## AEDAR preparation and resource contracts

The current owner-selected AEDAR profile contract is **points for inspection,
hexes for inline** (see « Grille hexagonale AEDAR » in `CONTEXT.md`). For each
territory, inline prepares hex geometry/address membership once for all modes,
then computes bound metric medians on that shared grid. Hexes are 9 px wide at
the 900 px source size (3 px at 300 px display size). Car colour represents
median diversity; comparison modes represent median exact car-only TYPEQU loss.
Values aggregate before each map's render cap. True zeros participate in
medians and receive the lowest colour; cells without addresses have no thematic
fill. Unexpected missing/non-finite values fail validation, never become zeros.
Counts do not determine colour or opacity; no smoothing/interpolation fills
unoccupied cells. The grid and medians are run-local and shared across modes.
Manifest/QA stage rows expose grid identity, occupied/address counts, prepared
metrics and built/reused decisions.

Mode-neutral preparation is bounded and shared:

- Bound metric fields, territory caps and normalized facts paths are indexed in
  one scan; frame/point/hex renders use lookups rather than rescanning the atlas.
- The authoritative commune source is read once into a run-owned spatial index;
  bounding-box candidates are filtered by exact intersection in the source CRS.
- Inspection builds each address geometry once per territory with all bound
  metrics/caps. Inline medians continue to use uncapped facts.
- Inspection background/desaturation and outside-land coverage are prepared
  once per territory. Inline omits the unused inspection land mask; only valid
  fully covered polygonal frames take the uniform-mask shortcut.
- Sparse engraving/desaturation touch only each mask's pixel window while
  retaining original arithmetic, rounding, alpha and edge relief.
- Territory-local rasters, coordinates, point layers and hex cells are released
  at the runner boundary, including failures; shared providers/index remain.

The manifest also exposes `aedar-bound-contracts`, `aedar-address-points`,
`aedar-inspection-context`, and `aedar-territory-release` alongside hex rows.
Performance diagnostics under ignored `output/aedar-performance/` are historical
measurement artefacts, not production input. Cold source derivatives and fresh
outputs are distinct measurements; a representative warm run is not a full-atlas
ETA.

## Retired AEDAR explorations and car-only launcher (historical)

The superseded command-line launchers `run_aedar_maps.py`, `run_aedar_loss_maps.py`,
`run_aedar_car_maps.py`, and `record_aedar_car_approval.py` were retired after their
tracked tests/callers were migrated. They are not runnable from this checkout.
Their source at the pre-retirement baseline is available for audit with, for example,
`git show dccc1bdd7479f748145666d18c09d4a2e49d1419:pipeline/maps/production/run_aedar_maps.py`.
Do not use these historical recipes as an operator workflow or regenerate their ignored
output directories; existing output/evidence is untouched.

The combined building-level exploration used address-origin **points** in inspection,
median-coloured inline hexes, an equal-width stepped scale shared across profiles, and
optional continuous-ramp comparison outputs. Its exploratory loss trial used car
absolute diversity plus car-only TYPEQU losses, the pink ramp, five equal-width classes,
and a per-territory shared 95th-percentile cap with a `+` endpoint. Those trial contracts
are historical, not selected hex-map treatment or evidence of current output.

The separate historical car-only contract remains source-owned in `aedar_car.py` and its
focused tests: absolute 15-minute car diversity (0?218), six native WebPs for the
Allineuc/Redon/Bretagne review cohort, exact decoded WebP checks, and human approval bound
to those six outputs. `record_car_approval()` is retained there as a tested historical
car-only contract; it is not selected-package approval and does not authorize the selected
family or any existing package. Full inventory, explicit approval admission, stale-input
refusal, and human spot-check requirements remain enforced at `run_production()` and its
source adapters. The selected family route above is independent and never changes the
network uploader's defaults or publication namespace.

The retired #730 car-only command accepted prepared
`address-access-metrics.parquet` (or a car-only parquet via `--facts-path`),
representative/full scope, and explicit output/cache/context overrides. Its
approval recorder required the complete six-WebP cohort, current car recipe and
native Q80/method-4 encoding, matching effective members, current hashes and
decoded QA; it could not accept historical PNGs, the network's 18-artifact
approval, partial cohorts, or stale sources. Full scope independently
recomputed representative identities before output mutation and left post-batch
spot checks pending. The CLI is retired, but those source-owned contract
semantics remain; no full run or approval is performed here.

## Verification

Run the fixture suites from the repository root with QGIS-enabled Python:

```text
python -m unittest pipeline.maps.production.tests.test_contract pipeline.maps.production.tests.test_network_cache pipeline.maps.production.tests.test_network -v
python -m unittest pipeline.maps.production.tests.test_inline_contract -v
python -m unittest pipeline.maps.production.tests.test_approval -v
python -m unittest pipeline.maps.production.tests.test_checkpoint pipeline.maps.production.tests.test_webp_encoding -v
python -m unittest pipeline.maps.production.tests.test_aedar_hex_grid -v
python -m unittest pipeline.maps.production.tests.test_aedar_hex_rendering -v
python -m unittest pipeline.maps.production.tests.test_aedar_commune_frames pipeline.maps.production.tests.test_inspection_pixel_cost -v
python -m unittest pipeline.maps.production.tests.test_aedar_car -v
python -m unittest pipeline.maps.production.tests.test_inspection_frame -v
python -m unittest pipeline.maps.production.tests.test_batch_execution pipeline.maps.production.tests.test_aedar_map_plan -v
python -m unittest pipeline.maps.production.tests.test_aedar_batch_native -v
```

For the repository worker proof, `test_aedar_batch_native` creates its own
authoritative EPSG:2154 communes, official-land/context fixture, OCS-GE fixture
sources, and Parquet metrics. It invokes the real `run_aedar_static_maps.py`
entrypoint and its QGIS subprocess workers at 1, 2, and 4; checks exact selected
five-mode × two-profile WebP coverage and private worker directories; then
checks worker failure/retry, verified reuse, corrupt-output repair, and refusal
of changed worker plans and input facts. It acquires no production context and
does not read production data. This generated fixture evidence is distinct from
the retained 1,266-territory/12,660-WebP export and the historical 40/40 byte
parity; neither retained record is rewritten by this test.

The bounded recovery case uses a test-only entrypoint driver to fail one
four-worker command at dispatch; three other real QGIS workers finish with a
partial matrix. The observed fixture run preserved 40 validated WebPs, resumed
the 10 missing WebPs, and completed the exact 50-output matrix. Previously
successful paths retained their hashes and modification times and were marked
`reused-output` on resume.

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
$repo = (Resolve-Path .).Path
$raw = Join-Path $repo 'pipeline\data\raw'
$networkCache = Join-Path $repo 'pipeline\maps\.cache\network-sources'
$contextCache = Join-Path $repo 'pipeline\maps\production\output\.stage-cache\official-context'
& 'E:\Program Files\QGIS 3.44.14\bin\python-qgis-ltr.bat' `
  pipeline/maps/production/tests/render_representative.py `
  --output-dir pipeline/maps/production/output/webp-native-review `
  --raw-dir $raw `
  --network-cache-root $networkCache `
  --read-only-source-cache `
  --context-cache-root $contextCache
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
# Optional bounded overrides; the supported default is four workers.
python pipeline/maps/production/run_full_network.py --approval pipeline/maps/production/output/human-approval.json --workers 1
python pipeline/maps/production/run_full_network.py --approval pipeline/maps/production/output/human-approval.json --workers 2
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
shared preparation. Only after that gate does the parent prepare validated
immutable network providers and sign the exact weighted whole-territory shard
plan. Each child independently rebuilds and re-admits the complete authoritative
inventory, current representative approval identities, source/renderer contract
and artifact matrix before rendering its assigned territories with both modes
and profiles. The signed worker plan cannot be changed between admission and
execution. The shared `batch_execution.py` module owns 1/2/4 process scheduling,
private shard/source-cache paths, logs, progress, failure preservation and
resume; network owns its geometry-complexity workload estimate and rendering.
No candidate/inspection-refresh scope is used for full workers. The usual
`full-manifest.json` / `full-qa.json` names and flat full WebP output selection
remain unchanged. Do not edit or synthesize approval JSON.

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
validated. A changed full plan/source/approval/renderer or worker assignment is
refused; use a new output directory rather than mixing provenance. `status=passed`
is automated QA only; `production_status` remains
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

## Targeted AEDAR car inspection refresh (#731)

`run_aedar_car_inspection_refresh.py` builds the current authoritative full car-diversity
binding, then selects only territories whose shared inspection frame differs from the
analytical frame. It renders one 2400×2400 **car-diversity inspection** WebP per affected
territory. It does not render inline maps or AEDAR loss maps, and does not alter the prior
full manifest or contact R2. Before rendering, it acquires the exact validated official
mainland context for the union of the selected inspection frames into the refresh's own
cache; it does not assume the older car-full cache covers the enlarged frames. Output is
isolated at `output/aedar-car-inspection-refresh/` by default.

```powershell
& 'E:\Program Files\QGIS 3.44.14\bin\python-qgis-ltr.bat' `
  pipeline/maps/production/run_aedar_car_inspection_refresh.py
```

The command writes a complete candidate `manifest.json`, `qa.json`, deterministic
`spot-check-sheet.png`, and an AEDAR-namespace `replacement-plan.json` bound to the previous
`aedar-car-full/full-manifest.json`. The plan
contains only changed-frame car inspection keys and verifies both old and new local artifact
hashes. QA stays pending until a human reviews the generated `qa.json` review-set artifacts:

```powershell
& 'E:\Program Files\QGIS 3.44.14\bin\python-qgis-ltr.bat' `
  pipeline/maps/production/record_spot_check.py `
  --qa pipeline/maps/production/output/aedar-car-inspection-refresh/qa.json `
  --reviewer NAME --outcome approved `
  --output pipeline/maps/production/output/aedar-car-inspection-refresh/human-spot-check.json
```

Only after approval, the usual R2 helper can dry-run and then explicitly upload the exact
replacement plan, using the old car publication manifest as its precondition:

```powershell
& .\pipeline\maps\production\upload-maps.ps1 `
  -OutputDir .\pipeline\maps\production\output\aedar-car-full `
  -Manifest .\pipeline\maps\production\output\aedar-car-inspection-refresh\replacement-plan.json `
  -Qa .\pipeline\maps\production\output\aedar-car-inspection-refresh\qa.json `
  -PublicationManifest .\pipeline\maps\production\output\aedar-car-full\upload-manifest.json
# Add -Upload only after reviewing the dry-run and authorizing the replacement.
```

The uploader still checks remote prior-object hashes/sizes and confirms replacement hashes
after upload. The partial renderer never records visual approval or publishes assets.
