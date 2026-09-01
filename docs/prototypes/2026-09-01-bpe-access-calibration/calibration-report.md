# BPE access-profile calibration report

> Throwaway evidence for issue #541. No threshold is selected by this run.

## Input

- Snapshot: `data/processed/mobilite/mobilite_snapshot.rds`
- Commune rows: 1200
- BPE types: 53
- Valid type cases: 63600
- Invalid/missing type cases: 0
- Primary measure: `has_<TYPE>_<MODE>_raw` (building-coverage proportion).
- `med_*` fields are intentionally excluded from classification.

## Mode-order diagnostics

- `b < t`: 73 cases
- `c < b`: 23 cases

These cases are retained for review; the script does not silently repair or
clamp coverage values.

## Candidate grid

- 64 floor/gap candidates evaluated.
- No automatic winner: entropy and minimum profile share are inspection aids,
  not an optimization target.

| Candidate | No. profiles | Min share | Max share | Normalized entropy |
|---|---:|---:|---:|---:|
| `floor-moderate__car-0.30__bike-0.05` | 4 | 0.087 | 0.699 | 0.677 |
| `floor-low__car-0.30__bike-0.05` | 4 | 0.086 | 0.699 | 0.677 |
| `floor-strict__car-0.30__bike-0.10` | 4 | 0.077 | 0.699 | 0.676 |
| `floor-strict__car-0.30__bike-0.05` | 4 | 0.073 | 0.699 | 0.675 |
| `floor-permissive__car-0.30__bike-0.05` | 4 | 0.072 | 0.699 | 0.675 |
| `floor-moderate__car-0.30__bike-0.10` | 4 | 0.077 | 0.699 | 0.674 |
| `floor-low__car-0.30__bike-0.10` | 4 | 0.077 | 0.699 | 0.672 |
| `floor-permissive__car-0.30__bike-0.10` | 4 | 0.072 | 0.699 | 0.666 |

## Output files

- `coverage-summary.csv` — pooled `t/b/c` distributions.
- `mode-order-anomalies.csv` — retained `b < t` and `c < b` cases.
- `candidate-summary.csv` — one row per floor/gap candidate.
- `candidate-profile-stats.csv` — count, share, mean, and median by profile.
- `candidate-exemplars.csv` — deterministic rare-profile inspection cases.
- `candidate-boundary-cases.csv` — cases within 0.01 of a floor or gap.
- `invalid-coverage-values.csv` — missing or out-of-range inputs.

The canonical universe is the 53-type universe carried by this snapshot.
Mode-order anomalies are retained as rare valid observations; they are not
silently clamped. Threshold constants still require human review before they
are frozen.
