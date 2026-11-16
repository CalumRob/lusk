# Bretagne factual serving: code and activation boundary (#1032)

Related: #1017, #1020, ADR-0038, ADR-0040, ADR-0042 and ADR-0044.
Implementation baseline: `0a8701ea629e9c16471e864bde89e816d5050d1a`.

## Cause and authorization

The reported sections are page 2 **Se garer et se ravitailler** and page 3
**Couverture du territoire**, not comparison sections. Native live discovery and
v2 facts-only reads reproduced the rejection before implementation. The live
territory search independently identifies `{type: region, id: "53", name:
"Bretagne"}`. All sixteen newly admitted resources below returned HTTP 422,
`Territory target type is not declared for this resource`, on 2026-11-16.

Discovery used dedicated indicator-page levels for scalar facts. Those levels
serve a different purpose from `scalar_contracts.allowed_levels`, which already
owns scalar projection, database descriptors and SQL admission. The owner
approved the shared scalar correction and its explicit sixteen-resource impact,
including the eight resources outside the two immediate Mobilité sections.
Four refuelling contracts additionally omitted a level already calculated by
their producer. No new statistical policy is introduced.

## Complete discovery impact

For **each** row, before = `commune, epci, departement`; after =
`commune, epci, departement, region`. No existing level is removed.

| Resource | Theme | Serving shape | Producer contract change |
| --- | --- | --- | --- |
| `densite` | Démographie | scalar | none |
| `taille_menages` | Démographie | scalar | none |
| `effectifs_salaries` | Économie | scalar | none |
| `chomage` | Économie | scalar | none |
| `eco_activites` | Économie | scalar | none |
| `prix_m2` | Habitat | scalar + ordered series | none |
| `part_passoires` | Habitat | scalar | none |
| `surface_reseaux_routiers` | Mobilité | scalar | none |
| `offre_tc` | Mobilité | scalar | none |
| `bornes_recharge` | Mobilité | scalar | none |
| `places_stationnement_velo_1000` | Mobilité | scalar | none |
| `places_stationnement_voiture_1000` | Mobilité | scalar | none |
| `bornes_ev_par_station_service` | Mobilité | scalar | add region |
| `stations_service` | Mobilité | scalar | add region |
| `stations_service_1000` | Mobilité | scalar | add region |
| `bornes_recharge_1000` | Mobilité | scalar | add region |

The baseline/head catalogue comparison changes **only** `allowed_levels` for
these sixteen identities. Every other resource field, all non-scalar resource
levels, resource identities/count, intents, units, directions, source identities,
map eligibility and count capabilities remain unchanged. All producer
`indicator_pages` are unchanged, including their three-level display admission.
No regional indicator page or comparison eligibility is added. Région remains
facts-only in the fiche, with no comparison control, request, retry or overlay;
explicit-none and lower-level defaults retain their separate existing meaning.

`prix_m2` is not reduced to its scalar facet. Its existing owned-series route
also declares four serving levels; the native read still requires the annual
publication and adds the independent pooled scalar facet. A missing annual
publication remains a typed `ordered_series` publication absence, even if a
scalar fact exists. The guarded native HTTP proof exercises this distinction.

## Facts and publication evidence (do not conflate them)

| Resources | Existing evidence | Activation requirement |
| --- | --- | --- |
| Coverage, parking densities, charging count | Four-level producer contracts and retained canonical region/53 rows | API image rebuild/restart; then verify actual native DB-backed reads. No republication is presumed necessary. |
| Refuelling ratio | Existing four-level calculation and retained canonical region/53 row, but old serving contract excluded region | New descriptor/fact projection through registered scoped materialization, then separately reviewed normal publication if the live descriptor/fact lacks region. |
| Three refuelling count/density keys | Existing four-level calculation and fixture proof; retained historical Mobility Parquet predates these keys | Same registered scoped materialization/publication review; no historical Parquet claim of current live availability. |
| Seven other theme scalars and road footprint | Existing four-level scalar contracts; native SQL fixture proves query admission; producer fixture suite checks projection | Rebuilt API admission, then native read verification. Existing `prix_m2` annual publication is independently required. Missing/incompatible publications are not replaced with numbers. |

Historical canonical rows are **not** evidence of current live database parity.
The old live catalogue rejects admission before a regional fact lookup, so this
worker cannot establish live row presence through that endpoint. No privileged
SQL bypass, production connection, publication or deployment was used. Code
completion does not mean the live site is repaired. Existing lower-level live
`offre_tc` facts/default comparison reads returned HTTP 200 for Rennes, CC Côte
d'Émeraude and Ille-et-Vilaine; their native payloads were retained as controls,
not substituted for regional facts.

## Normal registered preparation and separately reviewed activation

**Not executed and not authorized by this change.** An operator must review the
actual inventory, backups, input availability and planned owner closure first.

1. Stage a private **copy** of the complete current canonical serving generations
   and manifests/current pointers, `territoires.parquet` and source vintages.
   No junctions, writes to another checkout, missing-owner substitutions or
   reconstruction from browser JSON. Inventory the existing scalar/reference,
   fixed-comparison and independently versioned downstream markers first.
2. Confirm the existing, pinned source files for `mobilite_snapshot`, `bpe_b316`,
   `bornes-recharges`, `stationnement-velo`, plus
   `extracted/EPCI_au_01-01-2025.xlsx` and the shared territorial-reference inputs.
   Use the registered manifest filenames and current vintage records. **If an
   input is absent or stale, stop with its exact identity; this authorization
   does not permit downloads or new source acquisition.** No OSM, OCS-GE, GTFS
   routing or whole-theme rebuild is required or permitted here.
3. Select the complete changed-descriptor scope, not only the three densities:

   ```powershell
   # From pipeline/, in an independently provisioned/copy-backed environment.
   # LUSK_SORTIE and LUSK_CACHE must point to the reviewed private copies.
   $env:LUSK_THEMES = 'mobilite'
   $env:LUSK_SCALAR_SCOPE = 'mobilite:stations_service,stations_service_1000,bornes_recharge_1000,bornes_ev_par_station_service'
   Rscript scripts/publish-serving-tables.R --scalar-scope
   Rscript scripts/publish-serving-tables.R --scalar-scope-check
   Rscript scripts/publish-serving-tables.R --check
   ```

   These commands prepare/check local artifacts; they are not permission to
   run them on production assets. Review the target dependency plan first,
   including freshness targets that could otherwise download missing sources.
   Do not run `tar_make()` without the registered target selection. Preserve
   every unaffected descriptor/fact/provenance row. The base guards must reject
   stale preserved contracts/vintages or a changed territory universe; do not
   relax them or fall back to a full Mobility rebuild.
4. The registered producer now includes the ratio using the same
   `calculer_ratios_mobilite` rule as complete production. It divides aggregate
   charging/station counts, retains zero-denominator unavailability and missing
   BPE propagation, and preserves both source associations. Density denominators
   remain the existing population hub. Source observation/reference/publication
   dates are inputs, not the date this code or API is built.
5. Compare projected old/new facts, statuses, units and exact source/vintage
   associations at all four levels. The scoped artifact is a **complete theme
   artifact**, not a partial database replacement. Normal shared scalar
   publication still replaces a coherent full retained snapshot. Review the
   normal retained publisher's dependency closure: full scalar snapshot and
   scalar comparisons, all scalar-bound declared-profile companions and the
   linked Habitat selected reading. The reference, other selected readings and
   owned series remain outside that scoped closure. Preserve no-op behavior.
   Do not manually insert the four regional rows, mutate markers, use an
   alternate publisher or publish all themes blindly.

   **Current activation blocker:** `scoped_snapshot_delta()` in
   `pipeline/R/publish_scoped_publication.R` requires the scoped descriptors to
   be present in exactly one generation (missing-only forward/recovery). It
   deliberately rejects replacement when both baseline and candidate already
   contain an indicator. Regional descriptor/fact expansion is a replacement,
   not the original #989 addition. The ratio is present in historical retained
   generations; the three newer keys may also be present in the live baseline.
   `scoped_publication_plan()` must therefore refuse this activation if they
   are present on both sides. This PR does **not** relax that guard. Retrieve
   and inspect the exact published baseline, report that refusal, and obtain
   separate review of a normal registered replacement-publication capability
   before attempting activation. Do not remove descriptors from the baseline,
   unset the scope to invoke a broader writer, or bypass the plan. Local
   materialization readiness is not publication readiness.
6. Obtain **separate publication approval** with that concrete projected closure,
   backup/recovery inventory and exact input clocks. Only then may the operator
   execute the normal publication path. No production publication command or
   credentials are supplied here.
7. Separately obtain API activation approval. The API image copies producer
   metadata at build time and caches discovery, so a code/metadata-aware image
   rebuild and restart is required; merely changing R artifacts does not fix
   discovery. Coordinate admission and refuelling publication: an old deployed
   descriptor that excludes region can still reject a newly admitted target.
   A restart alone cannot create absent facts or annual series publications.
8. After approved activation, rerun native discovery and facts-only v2 reads for
   **all sixteen** resources, exact region/53. Verify real values/statuses and
   native scalar/reference/descriptor and owned-series clocks/provenance;
   preserve genuine publication failures rather than aggregating in the app.
   Repeat lower-level default comparison controls and explicit-none checks,
   mount both affected Bretagne sections, and confirm zero regional comparison
   requests/controls/errors/retries. Keep before/after receipts distinct from
   synthetic fixtures. Any unsupported semantics or needed new source is a stop,
   not authority to invent a statistic or widen another resource family.

## Test evidence boundaries

- Parameterized discovery/native validation tests enumerate all sixteen changes;
  non-scalar levels and scalar units/directions stay producer-derived.
- Guarded SQL-to-HTTP integration fixtures use only `lusk_it_contract` dedicated
  roles under the existing process mutex and a disposable schema. They exercise
  fifteen native regional scalar reads, single/v2 parity, measured zero, source
  identities/clocks and the honest missing annual-publication outcome for
  `prix_m2`. Synthetic values/clocks are labelled as fixtures, not live facts.
- R fixtures exercise complete/scoped aggregation parity, registered ratio
  selection, regional scalar projection, source bindings, missing BPE and zero
  denominator behavior. No real-data cache, download or production publication
  is part of this proof.
- The mounted regional fiche tests consume the real generated catalogue and
  native regional fixtures, render coverage/parking/refuelling facts without
  comparisons and retain a genuine injected factual-publication failure. The
  maintained lower-level/default and explicit-none regressions remain in place.

### Verification receipt (2026-11-16)

- API catalogue suite: 36 passed (the sixteen new regional admission cases and
  the scalar/non-scalar contract guard included).
- Guarded native HTTP proof: 16 passed; all runs began/ended with zero user
  schemas and zero public relations. The exact test database and dedicated roles
  were checked before fixture DDL; only the run's schema was removed.
  Reinstating only the baseline catalogue admission rule against the **same**
  seeded fixture makes all sixteen native reads fail with the reproduced 422;
  restoring the serving-contract rule makes all sixteen pass again. This
  isolates admission from data presence and is not a live-activation claim.
- Full ordinary API suite: **393 passed, 181 skipped, 1 failed**. The failure is
  the unchanged `test_snapshot_derived_mobility_reading_has_no_pipeline_publisher_or_artifact_owner`:
  its substring assertion prohibits `"mobilite"` anywhere in
  `publish_retained_scalar_snapshot.R`, including the already-existing retained
  profile owner registration. The test and inspected publisher are unchanged
  from the pinned baseline; executing the same assertion against the baseline
  Git blob fails too. No assertion was weakened and no full-green API claim is
  made. This unrelated baseline test needs separate maintenance.
- Python compilation and generated endpoint/OpenAPI inventory check passed;
  there is no configured Python static type-check command in the API README.
- Focused R projection/scoped suites: 8,066 assertions passed; the broader
  Mobility parity/missingness run passed 932 assertions with five existing
  spatial warnings. Full default R fixtures: **18,942 passed, 6 warnings,
  5 skips, 0 failures**. Skips identify absent optional Arrow, an explicitly
  selected Milieux test schema and real routing/cache inputs; this is not
  real-data parity. No raw-data cache was copied, linked, downloaded or deleted.
  Initial project startup auto-bootstrapped renv via the tracked `.Rprofile`;
  no explicit `renv::` operation was invoked. The empty worktree library was
  populated by copying the existing main hashed library into this worktree's
  hashed library, then `dplyr`, `testthat` and `pkgload` were verified available.
- Own `npm ci`: 0 vulnerabilities. Full app suite: **201 files, 2,693 passed,
  1 skipped**. TypeScript/Vite production build passed (existing chunk-size
  warning). No production app source or public presentation metadata changed.
- Maintained `verify:aedar-demand`, `verify:aedar-layout-stability`,
  `verify:rank-circles`, `verify:network-means` and
  `verify:mobile-cahier-overflow` passed. Demand remains page 2 **33 items / 3
  requests**, page 3 **7 / 1**, with zero duplicate identities; existing guards,
  TYPEQU universe, tolerances and budgets were not changed.
- Actual regex detector scans of current source and a private extraction of
  baseline `0a8701ea` both report **11 findings in the same eight byte-unchanged
  files** (all `[side-tab]`, same lines); zero new findings. **The clean full-scan
  gate is still unsatisfied**, exit 2. No baseline waiver or rendered
  accessibility acceptance is implied.

Local raw receipts are under this worktree's `.scratch/bretagne/` (not a
production artifact or credential store). The missing-only publication-plan
blocker above and unverified live regional row availability remain explicit
handoff requirements, not hidden successful gates.
