# AEDAR launcher and caller audit (#773)

## Supported route

The selected five-reading production generation is `run_aedar_static_maps.py`.
Its maintained CLI supports `--plan-only`, `--check-only`, `--workers {1,2,4}`
(default 4), explicit input-path overrides, and optional `--acquire-context`.
The current README recipe uses plan/check then deliberate generation, and
packages existing bytes through `package_aedar_maps.py`. The general README
integrates #777's exact command and AEDAR_APPROVAL.md route; PR #778 review/merge
remains a prerequisite before the approval step is live. `upload-maps.ps1`
remains the canonical tracked publisher and its dry-run/explicit-upload gates
are unchanged.

## Retained entrypoints and source modules

This audit deliberately distinguishes historical modules from dead code:

| Path | Current tracked callers | Decision |
|---|---|---|
| `aedar_maps.py` | `aedar_car.py`, `aedar_static.py`, selected runner, module tests | Retain: shared source/core and historical recipes are imported by active production code. |
| `aedar_car.py` | `aedar_static.py`, car-refresh runner and tests | Retain: source/core adapter used in the current combined family and refresh path. |
| `run_aedar_static_maps.py` | documented selected production route and native subprocess fixture | Retain: only selected AEDAR batch launcher. |
| `run_aedar_maps.py` | no production callers after retirement; two former CLI lifecycle tests now exercise `run_aedar_static_maps.main()` plan-only success/failure cleanup | Retired. Historical map calculations/rendering in `aedar_maps.py` remain because source adapters/tests use them. |
| `run_aedar_loss_maps.py` | no production/test caller; only historical README recipe | Retired; historical point/pink/p95 semantics retained in docs, output artefacts untouched. |
| `run_aedar_car_maps.py` | no production caller; a CLI-only early-refusal test was removed because live full admission is tested at `run_production()` | Retired; `aedar_car.py` adapter, recipe and full-approval contract remain. |
| `record_aedar_car_approval.py` | former car tests now import `record_car_approval()` from `aedar_car.py` | CLI retired; six-native-WebP historical approval contract is preserved and tested in source owner, not selected-package approval. |

`git grep` and tracked test imports were checked after migration. No tracked
imports of the retired launchers remain. No tracked implementation exists for
ignored `output/upload-network-maps.ps1`; the README no longer claims it as a
compatibility alias. Historical explorations retain
their original point/palette/cap meanings; none is evidence of the current
selected hex exports. Existing output, image, receipt and approval evidence is
not modified by this cleanup.

## CLI/import evidence

Verified selected launcher help in the QGIS 3.44.14 Python runtime on 2026-10-15:
`--raw-dir`, `--facts-path`, `--output-dir`, `--cache-dir`,
`--source-cache-owner`, `--context-cache-root`, `--family-config`,
`--territory-registry`, `--workers {1,2,4}`, `--plan-only`, `--check-only`,
`--acquire-context`, and `--refresh`. Packaging remains `package_aedar_maps.py`;
publisher remains tracked `upload-maps.ps1` / `upload_maps.py`. Do not run
generation, package, approval, or publication merely to validate this guide.

The QGIS process-isolated fixture sweep passed **35 modules / 233 tests**; the
complete selected CLI contract module (including its newly added `--help`
test) was rerun afterward, for 234 distinct tests verified. This includes the
native AEDAR 1/2/4-worker/resume cases, full source-gate tests, and the
self-contained public-context fixture. The full sweep log is outside the
worktree at `E:\Temp\opencode\lusk-773-fresh-suite.log`. No production raw
data, source acquisition, approved-image mutation, full atlas or publication
was involved.

The older command paths are retired and documented as historical rather than
described as the selected workflow. The package approval recorder command is
documented with the exact #777 interface; integration remains contingent on PR
#778 review/merge. The selected package approval gate is not replaced by the
historical car approval contract.
