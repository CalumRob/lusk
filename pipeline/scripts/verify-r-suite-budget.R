# verify-r-suite-budget ---------------------------------------------------------
# Serial default-suite timing guard (#1172). Run from pipeline/:
#   Rscript scripts/verify-r-suite-budget.R
# Validate an existing pair of timing CSVs without rerunning the suite:
#   Rscript scripts/verify-r-suite-budget.R --from-csv-prefix=/path/r-serial
#
# The thresholds are deliberately outside testthat: this is a regression report,
# not a flaky timing assertion. Exceptions name the contract that requires the
# fixed cost (initial graph construction or execution of the smallest fixture).

BUDGET_TEST_SECONDS <- 5
BUDGET_FILE_SECONDS <- 15

EXCEPTIONS_BUDGET <- data.frame(
  fichier = c(
    "test-apply-seam.R",
    "test-apply-seam.R",
    "test-apply-seam.R",
    "test-lock-attribution.R",
    "test-targets-raccordement.R",
    "test-targets-raccordement.R",
    "test-offre-tc-bridge.R"
  ),
  test = c(
    NA_character_,
    "real repo passes both seam audits (apply guarded, not allowlisted)",
    "every DBI params list in R/ is positional (RPostgres contract)",
    NA_character_,
    "discipline de cue : un second appel SAUTE tout, une entrée touchée n'invalide que la chaîne",
    "LE CRON SAUTE LA CHAÎNE : après l'amorçage, plus JAMAIS un recalcul",
    NA_character_
  ),
  raison = c(
    "initial whole-repo parse-data seam and DBI audits; later structural audits reuse the cache",
    "first structural audit parses its connection/write candidates and proves apply is guarded",
    "first DBI-candidate parse-data audit; the positional contract covers every R source",
    "one full targets network construction for report dependency edges; later files reuse it",
    "execution is the contract: cue discipline across repeated makes; expires with #1129",
    "execution is the contract: cron never recomputes after bootstrap; expires with #1129",
    "ADR-0049 step 4 retires the offre_tc bridge; expires with ADR-0049 step 4"
  ),
  expiration = c(rep(NA_character_, 4L), "#1129", "#1129", "ADR-0049 step 4"),
  stringsAsFactors = FALSE
)

exception_budget <- function(fichier, test = NA_character_) {
  memes <- EXCEPTIONS_BUDGET$fichier == fichier
  if (!any(memes)) return(FALSE)
  if (any(memes & is.na(EXCEPTIONS_BUDGET$test))) return(TRUE)
  !is.na(test) && any(memes & !is.na(EXCEPTIONS_BUDGET$test) &
                       EXCEPTIONS_BUDGET$test == test)
}

depassements_budget <- function(par_fichier, par_test) {
  tests <- par_test[par_test$real > BUDGET_TEST_SECONDS, , drop = FALSE]
  tests <- tests[!vapply(seq_len(nrow(tests)), function(i) {
    exception_budget(tests$file[[i]], tests$test[[i]])
  }, logical(1)), , drop = FALSE]
  fichiers <- par_fichier[par_fichier$wall > BUDGET_FILE_SECONDS, , drop = FALSE]
  fichiers <- fichiers[!vapply(fichiers$file, exception_budget, logical(1)), ,
                       drop = FALSE]
  list(tests = tests, fichiers = fichiers)
}

mesurer_suite_serielle <- function(prefix) {
  Sys.setenv(TESTTHAT_PARALLEL = "FALSE")
  fichiers <- sort(list.files("tests/testthat", pattern = "^test.*\\.R$"))
  pkgload::load_all(".", quiet = TRUE, export_all = TRUE)
  lignes <- list(); tests <- list()
  debut <- Sys.time()
  for (f in fichiers) {
    t1 <- Sys.time()
    resultat <- tryCatch(
      testthat::test_file(file.path("tests/testthat", f), reporter = "silent",
                          package = "lusk", load_package = "none",
                          stop_on_failure = FALSE),
      error = function(e) NULL
    )
    duree <- as.numeric(difftime(Sys.time(), t1, units = "secs"))
    df <- if (is.null(resultat)) NULL else as.data.frame(resultat)
    lignes[[f]] <- data.frame(
      file = f, wall = duree,
      tests = if (is.null(df)) NA else nrow(df),
      expectations = if (is.null(df)) NA else sum(df$nb),
      in_tests = if (is.null(df)) NA else sum(df$real),
      failed = if (is.null(df)) NA else sum(df$failed),
      errored = is.null(resultat)
    )
    if (!is.null(df)) tests[[f]] <- df[, c("file", "test", "nb", "real")]
  }
  par_fichier <- do.call(rbind, lignes)
  par_fichier <- par_fichier[order(-par_fichier$wall), , drop = FALSE]
  par_test <- do.call(rbind, tests)
  par_test <- par_test[order(-par_test$real), , drop = FALSE]
  dir.create(dirname(prefix), recursive = TRUE, showWarnings = FALSE)
  utils::write.csv(par_fichier, paste0(prefix, "-by-file.csv"), row.names = FALSE)
  utils::write.csv(par_test, paste0(prefix, "-by-test.csv"), row.names = FALSE)
  list(par_fichier = par_fichier, par_test = par_test,
       wall = as.numeric(difftime(Sys.time(), debut, units = "secs")))
}

formater_rapport_budget <- function(resultats, top = 20L) {
  pf <- resultats$par_fichier
  pt <- resultats$par_test
  lignes <- c(
    sprintf("Serial default suite: %.0f s wall | %d files | %.0f s in tests",
            resultats$wall, nrow(pf), sum(pf$in_tests, na.rm = TRUE)),
    "",
    sprintf("Top %d files:", top)
  )
  for (i in seq_len(min(top, nrow(pf)))) {
    lignes <- c(lignes, sprintf("  %7.2f s  %s", pf$wall[[i]], pf$file[[i]]))
  }
  lignes <- c(lignes, "", sprintf("Top %d tests:", top))
  for (i in seq_len(min(top, nrow(pt)))) {
    lignes <- c(lignes, sprintf("  %7.2f s  %s :: %s", pt$real[[i]],
                                pt$file[[i]], pt$test[[i]]))
  }
  lignes
}

arguments_budget <- function(args) {
  prefix <- file.path(tempdir(), "r-suite-budget")
  depuis <- NULL
  top <- 20L
  for (arg in args) {
    if (startsWith(arg, "--csv-prefix=")) {
      prefix <- sub("^--csv-prefix=", "", arg)
    } else if (startsWith(arg, "--from-csv-prefix=")) {
      depuis <- sub("^--from-csv-prefix=", "", arg)
    } else if (startsWith(arg, "--top=")) {
      top <- as.integer(sub("^--top=", "", arg))
    } else {
      stop("Unknown budget argument: ", arg, call. = FALSE)
    }
  }
  if (is.na(top) || top < 1L) stop("--top must be a positive integer", call. = FALSE)
  list(prefix = prefix, depuis = depuis, top = top)
}

main_budget <- function() {
  options <- arguments_budget(commandArgs(trailingOnly = TRUE))
  if (!file.exists("DESCRIPTION") || !file.exists("_targets.R")) {
    stop("Run this command from the pipeline/ directory.", call. = FALSE)
  }
  if (is.null(options$depuis)) {
    resultats <- mesurer_suite_serielle(options$prefix)
  } else {
    par_fichier <- utils::read.csv(paste0(options$depuis, "-by-file.csv"),
                                   stringsAsFactors = FALSE)
    par_test <- utils::read.csv(paste0(options$depuis, "-by-test.csv"),
                                stringsAsFactors = FALSE)
    resultats <- list(par_fichier = par_fichier, par_test = par_test,
                      wall = sum(par_fichier$wall))
  }
  cat(paste(formater_rapport_budget(resultats, options$top), collapse = "\n"),
      "\n", sep = "")
  depassements <- depassements_budget(resultats$par_fichier, resultats$par_test)
  if (nrow(depassements$tests) || nrow(depassements$fichiers)) {
    details <- c(
      paste0("  test  ", depassements$tests$file, " :: ",
             depassements$tests$test, " (", round(depassements$tests$real, 2), " s)"),
      paste0("  file ", depassements$fichiers$file, " (",
             round(depassements$fichiers$wall, 2), " s)")
    )
    stop("R suite budget exceeded; add a reasoned exception or move the contract:\n",
         paste(details, collapse = "\n"), call. = FALSE)
  }
  cat(sprintf("Budget OK: no unlisted test > %.0f s or file > %.0f s.\n",
              BUDGET_TEST_SECONDS, BUDGET_FILE_SECONDS))
  invisible(resultats)
}

if (sys.nframe() == 0L) main_budget()
