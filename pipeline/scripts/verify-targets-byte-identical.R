# verify-targets-byte-identical -------------------------------------------------
# Slow, explicit audit: cold targets outputs must remain byte-identical to the
# run_pipeline() oracle for every theme and for the complete graph.
# Run from pipeline/: Rscript scripts/verify-targets-byte-identical.R

if (!file.exists("DESCRIPTION") || !file.exists("_targets.R")) {
  stop("Run this command from the pipeline/ directory.", call. = FALSE)
}

pkgload::load_all(".", quiet = TRUE)
testthat::test_file(
  "slow-tests/test-targets-byte-identical.R",
  package = "lusk"
)
