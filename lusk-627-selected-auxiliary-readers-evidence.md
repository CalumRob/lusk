# #627 selected auxiliary readers evidence

## Scope

Completed the SQL-backed proof for the selected essential-service reader and
the selected initial building-access reader, and closed the selected-comparison
partial-peer gap. No route/refactor or deployment behavior was added.

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
