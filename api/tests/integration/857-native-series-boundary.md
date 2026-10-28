# #857 — native OCS-GE calendar comparison boundary (blocked RED)

This is **not** an API-only page implementation or acceptance report. No product
code, API reader, publisher, schema, page layout, switch, or serving policy changed.
The five-page migration remains pending. The native first gate found a boundary
requiring parent/owner resolution before expanding implementation.

## Reproduction

`api/tests/integration/test_native_series_page_boundary.py` uses the existing
guarded `canonical_db_env`: the approved test-only database and distinct roles,
random retained schema, current fresh schema, no R, no production database/API.
Both roles' database/user identities were independently verified before running.
It seeds typed EPCI and commune facts with deliberately different values and two
OCS-GE windows, then captures the public `/api/resources` and `/read-batch` replies.
No repository implementation is mocked; only FastAPI's repository dependency is
bound to the dedicated test reader, following the existing integration harness.

`app/src/__tests__/native-series-page-boundary.spec.ts` consumes the resulting JSON
unchanged through `chargerCatalogueRessources` and `lireRessourcesBatch`. The focal
reply also crosses `orderedSeriesFacts`, `dispatchIndicatorFamily`, and
`modeleTrajectoire`, preserving its actual calendar value/unit/observation window.
Browser-derived trajectory medians are explicitly **not** used as native evidence.
The captured cohort crosses the real transport; no new series cohort adapter or
full page acquisition is claimed. `LUSK_NATIVE_SERIES_CAPTURE` optionally points
this test at a freshly captured envelope; the default is the tracked native file.
This variable exists only in the test, not product serving or page selection.

Run the guarded Python module as documented in the integration README, then:

```powershell
# app/, normal timeouts. Optional: use the fresh capture from that Python run.
$env:LUSK_NATIVE_SERIES_CAPTURE = '<native-state-calendar-boundary.json>'
npx vitest run src/__tests__/native-series-page-boundary.spec.ts --maxWorkers=1 --no-file-parallelism
```

Expected checkpoint: Python capture passes; app has **2 passed / 1 failed**.
The failure is intentional, not skipped, marked expected-failure, or disabled.
The default app suite therefore remains RED at this checkpoint; do not merge.

## Concrete mismatch

The current normalized `artif_par_habitant` page retains calendar details and
M2/M3 steps at commune, EPCI and département levels. Its selected calendar-year
control drives median/extrema/table/rank sorting/map; the trajectory also displays
per-step medians and counts. This is existing surface, not a proposed new UI.

The current producer `project_ocsge_owned_series` in `pipeline/R/publish_series.R`
sets `comparison_axis_values` to the page's **trajectory endpoints M2/M3**.
`project_owned_series_comparisons` publishes those comparison axes rather than all
calendar `axis_values`. The fixture retains exactly this distinction. Calendar
facts retain typed state roles and their territory-specific observation windows.

Worked independent example (m²/hab):

| EPCI | Window | M2 | M3 | Calendar 2023 |
| --- | --- | ---: | ---: | ---: |
| state-e1 | 2020–2023 | 100 | 120 | 120 |
| state-e2 | 2021–2025 | 300 | 360 | absent |
| state-e3 | 2020–2023 | 150 | 180 | 180 |

The published same-level **M3 median is 180, with 3 eligible**. The existing
calendar-2023 surface needs **150, with 2 eligible and 1 missing**. This example
does not rely on the one-member/minimum-support ambiguity.

The public fixed request for `coordinates: {declared_detail: ['2023']}` returns
HTTP 200 but `status: unavailable`,
`reason: selected_coordinate_has_no_comparison_result`, no median, and the
unchanged descriptor-selected `source_facet: '2025'`. Omitting coordinates returns
the M3-derived median 180 (the current reader's declared-detail fallback), not
calendar 2023 evidence. Relabelling this as calendar 2023 would be false.

An explicit typed selection of the same three EPCIs echoes those EPCI identities
but resolves the three **communes**. Their facts are deliberately one tenth of
the parent values. It is not a same-level EPCI comparison and cannot be presented
as such. This is the retained selection policy, not an API bug to silently change.

## Decision needed

A requested-only reader projection can expose existing M2/M3 group/member rows.
It cannot project a calendar-year group row that the current producer does not
publish. Producing calendar-2023 medians/counts/ranks from all peer facts or by
filtering/reaggregating role member rows would reconstruct the fixed comparison;
the brief explicitly prohibits that workaround. Changing parent selection to
same-level peers would introduce a new comparison population policy.

The parent/owner must resolve which boundary may change:

1. authorize a producer/publication expansion for calendar comparisons (currently
   outside this consumer/reader-only batch), with explicit calendar support rules;
2. authorize bounded fixed-calendar reconstruction and its support/population policy
   (currently explicitly forbidden); or
3. explicitly revise the retained page's calendar comparison surface (currently
   no hidden support reduction is authorized).

No option was chosen here. No endpoint/field vocabulary was added merely to mask
this gap. This finding is about the OCS-GE calendar surface; it does **not** claim
that the other four pages are impossible or prove all their contracts.

## Scope and honest limits

| Scope | Checkpoint |
| --- | --- |
| habitat/prix_m2 | Not migrated; pooled scalar and annual dual shape unchanged |
| milieux/artif_par_habitant | Real SQL/HTTP→app focal/transport proof; calendar comparison RED retained |
| milieux/conso_enaf_annuel | Not migrated; native gaps/annual flow unchanged |
| mobilite/raccordement_courbe | Not migrated; current mean/reference/region behavior unchanged |
| programmes/subventions_annuelles | Not migrated; scalar presentation and native annual ownership unchanged |
| #732 native combined source record / exact-ID link / no-match / unavailable / native clocks and hash | Not implemented or accepted; all criteria pending |

No API projection/default change occurred. All 15 scalar pages, ten profile
pages, fiche consumers, standalone map, AEDAR, B316, scalar raccordement_tc,
legacy flags/readers and recovery assets remain untouched. No full browser,
build, full app suite, publication parity, production availability or final
five-page acceptance is claimed by this minimized blocker proof. CONTEXT and
app README serving-policy paragraphs are deliberately unchanged because the
five-page policy has **not** been implemented. #627/#587/#827/#619 remain open.

Final exact-head logs/captures/guard and preservation JSON are stored externally
under `E:/Temp/opencode/857-series-evidence/<fullSHA>/`. The source remains in the
dedicated worktree for parent review; no cleanup or worktree removal is authorized.
