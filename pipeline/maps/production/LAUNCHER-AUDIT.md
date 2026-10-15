# AEDAR launcher and caller audit (#773)

## Supported route

The selected five-reading production generation is `run_aedar_static_maps.py`.
Its maintained CLI supports `--plan-only`, `--check-only`, `--workers {1,2,4}`
(default 4), explicit input-path overrides, and optional `--acquire-context`.
The current README recipe uses plan/check then deliberate generation, and
packages existing bytes through `package_aedar_maps.py`. Exact package-bound
human approval belongs to #777; its reviewed API must be integrated before this
workflow can claim to be complete. `upload-maps.ps1` remains the canonical
tracked publisher and its dry-run/explicit-upload gates are unchanged.

## Retained entrypoints and source modules

This audit deliberately distinguishes historical modules from dead code:

| Path | Current tracked callers | Decision |
|---|---|---|
| `aedar_maps.py` | `aedar_car.py`, `aedar_static.py`, selected runner, module tests | Retain: shared source/core and historical recipes are imported by active production code. |
| `aedar_car.py` | `aedar_static.py`, car-refresh runner and tests | Retain: source/core adapter used in the current combined family and refresh path. |
| `run_aedar_static_maps.py` | documented selected production route and native subprocess fixture | Retain: only selected AEDAR batch launcher. |
| `run_aedar_maps.py` | `run_aedar_loss_maps.py`; tests use its contact-sheet helper and test its QGIS lifecycle | Historical compatibility entrypoint, not selected route; cannot safely delete until these tested helper/lifecycle callers are migrated. |
| `run_aedar_loss_maps.py` | no supported README route; imports legacy launcher helper | Historical exploratory launcher; retained for its helper dependency and historical evidence, not production. |
| `run_aedar_car_maps.py` | `tests/test_aedar_car.py` checks early refusal and the car workflow | Retain until those contract tests are migrated to the source owner / selected route. |
| `record_aedar_car_approval.py` | historical car tests and historical README instructions | Not an approval for selected package. Do not invoke for it; #777 supplies the replacement. |

`git grep` and tracked test imports were checked for this inventory. No tracked
implementation exists for ignored `output/upload-network-maps.ps1`; the README
no longer claims it as a compatibility alias. Historical explorations retain
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

The older command paths are intentionally identified as historical rather than
described as the selected workflow. Actual deletion is deferred until all
specific tested caller dependencies above are migrated; deleting by filename
alone would remove active tested behavior.
