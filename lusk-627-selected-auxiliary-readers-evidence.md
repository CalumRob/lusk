# #627 selected auxiliary readers evidence

## Scope

Completed SQL-backed proof for selected essential-service and initial
building-access readers, closed the selected-comparison partial-peer gap, and
added a PostgreSQL-to-FastAPI regression for the Mobilité comparison route.
No deployment behavior was changed.

## RED → GREEN

- Added a comparison regression case declaring `peer-a` and `peer-b` while
  providing only `peer-a` facts. RED run failed with `DID NOT RAISE` before the
  guard; after the fix, selected comparisons fail closed with HTTP 503. The
  guard is conditional on explicit `peer_member_ids`, preserving the legacy
  path where that declaration is absent.
- Against an owned temporary schema in the guarded `lusk_it_contract`
  disposable database, exercised `ReadRepository.read_selected()` with both
  `LUSK_SERVICES_SCALAR_READ` off (frozen legacy table) and on (scalar facts).
  Both actual SQL branches supplied five services × three modes for selected
  commune IDs `29001` and `29002`; the converted comparison contracts matched
  except for the intentionally distinct publication ID.
- The existing small building fixture now calls the selected initial-building
  reader with an explicit empty selection. Its actual selected SQL predicates
  execute; the 33 focal ramp facts and 30 grid facts remain unchanged while
  both peer summaries are null and selection scope reports zero peers.

## Verification

- RED probe: `api/tests/test_comparison.py` failed as expected (initially test
  setup import corrections were needed); after implementation the comparison
  unit suite passed.
- Guarded SQL-backed focused run: 13 passed in 6.00s; zero skips. It included
  the scalar/frozen selected read proof and initial-building selected read.
- Full `api/tests` without the guarded DB config: 80 passed, 41 skipped, 1
  failed. The sole failure is the existing canonical mobility-density HTTP
  test requiring `LUSK_DENSITY_CANONICAL_SCHEMA`; that canonical
  manifest/config was not supplied.
- Full API suite with the approved DB env: 102 passed, 12 skipped, 7 failed.
  The failures are unrelated environment/baseline gates: canonical fiche test
  configuration, migration rehearsal `fresh_names` out of sync with newer
  schema registrations, mounted frontend test missing worktree
  `app/node_modules`, and four R publication tests missing `pkgload`/`jsonlite`
  in this worktree's renv library. Per repository instructions, no renv
  restore/install was attempted. The targeted SQL-backed tests above passed.
- One pre-existing Starlette/httpx deprecation warning appeared.

All temporary schemas are uniquely named and only the owned schema is dropped
under `LUSK_TEST_ALLOW_SCHEMA_CLEANUP=1`; the disposable-database identity
guard verified both configured roles before SQL tests ran.

## Comparison-route acceptance and review corrections

- The actual PostgreSQL→FastAPI `POST /api/territories/epci/E1/themes/mobilite/comparison`
  now proves mixed EPCI+commune overlap deduplicates to two commune peers, with
  independent SQL-backed medians and deltas for all five services × three modes.
  The response retains the original typed selection, includes selected peer
  source evidence (and excludes the focal-only source), contains no `value` in
  service modes and no recursive `focal_value`, and returns selected building
  summaries in the same snapshot.
- The same route test checks explicit `[]` (zero peers, no medians/source
  evidence, empty building summaries) against omitted selection (declared
  same-level default). It counts exactly one checked-out DB connection and one
  `REPEATABLE READ, READ ONLY` setup per request.
- `/themes/{theme}/comparison` now returns bounded snapshot tokens: scalar,
  profile, reading, collections, per-dataset owned-series content/reference,
  BPE content/reference, territory reference, and Mobilité service/building
  publication IDs. Selected facts nests corresponding tokens. The selected
  facts POST now also handles omitted selection as the default; the GET facts
  response remains unchanged. BPE token values come from the same comparison
  snapshot rather than a fabricated release marker.
- Focal essential-service measurement and provenance fields are stripped from
  comparison-only modes; selected `comparison_sources` are built only from the
  resolved peer IDs. This closes the earlier nested-value and focal-source
  leaks found in review.
- TDD evidence: with the comparison source-field stripping temporarily removed,
  the PostgreSQL→FastAPI route regression failed because `focal-only` appeared
  in the comparison response; restoring the stripping made it pass.
- The route regression also seeds an active owned-series dataset
  (`mobility_owned`, theme mobilite) with two selected commune observations: it
  asserts the forwarded per-dataset content/reference tokens and the
  selected-peer median without any focal value. Explicit-empty selection
  returns zero-member scalar results (median None), and the omitted-selection
  default returns the same-level cohort medians (car median 0.875 across
  E1/E2) — each still stripped of focal mode values and focal-only sources.
  All five services' medians and car/bike deltas are asserted, not just food.
- Final focused guarded run:
  `. 'E:/Temp/opencode/lusk-approved-test-env.ps1'; $env:LUSK_TEST_ALLOW_SCHEMA_CLEANUP='1'; python -m pytest api/tests/integration/test_selected_building_readers.py api/tests/integration/test_milieux_cloud_http.py -q`
  => **2 passed, 0 skipped** in 12.34s (one existing Starlette/httpx
  deprecation warning). This covers the selected Mobilité comparison route,
  selected facts default/empty/mixed Milieux behavior (including nested
  non-applicable service/building tokens declared null), GET regression, and
  the original selected building reader. `py_compile`, `git diff --check`, and
  the focused comparison/building unit tests passed (22 tests). No push, PR
  update, live activation or deployment was performed.
