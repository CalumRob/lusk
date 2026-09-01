# BPE access-profile calibration

Throwaway diagnostics for issue #541. This is not production pipeline or app
logic. It reads the current BPE24-backed snapshot and writes candidate
threshold summaries, mode-order anomalies, boundary cases, and deterministic
exemplar candidates beside the script.

Run from `pipeline/`:

```text
Rscript ../docs/prototypes/2026-09-01-bpe-access-calibration/calibrate-bpe-access.R
```

The script deliberately does not choose or freeze thresholds. It uses the
current `has_<TYPE>_<MODE>_raw` coverage proportions as the primary measure;
the `med_*` fields are not used for classification.
