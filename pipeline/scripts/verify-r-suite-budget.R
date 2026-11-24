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
    "test-lock-attribution.R",
    "test-release-freeze.R",
    "test-verification-donnees-reelles.R",
    "test-verification-donnees-reelles.R",
    "test-verification-donnees-reelles.R",
    "test-verification-donnees-reelles.R",
    "test-verification-donnees-reelles.R",
    "test-vintages-derivees.R",
    "test-vintages-derivees.R",
    "test-targets-rapport.R",
    "test-targets-rapport.R",
    "test-targets-graphe-metadata.R",
    "test-targets-raccordement.R",
    "test-targets-raccordement.R",
    "test-theme-milieux-histoire.R"
  ),
  test = c(
    "real repo passes both seam audits (apply guarded, not allowlisted)",
    "every DBI params list in R/ is positional (RPostgres contract)",
    NA_character_,
    NA_character_,
    NA_character_,
    "le verrou tourne au premier make, puis saute tant que rien ne change",
    "le fichier brut change -> le verrou rejoue (fraîcheur par contenu)",
    "le corps du lecteur change -> le verrou rejoue (suivi d'imports)",
    "un verrou cassé fait ÉCHOUER le target — un run rouge reste bruyant",
    NA_character_,
    "fixture : les octets changent entre deux tar_make et la version publiée suit",
    "le rapport de run est réestampillé à chaque run, même quand la chaîne saute",
    "le rapport de run survit à l'échec d'une étape aval (error = continue)",
    "un changement du canon seul ne reconstruit que SA cible metadata ; sans changement tout saute (#434)",
    "discipline de cue : un second appel SAUTE tout, une entrée touchée n'invalide que la chaîne",
    "LE CRON SAUTE LA CHAÎNE : après l'amorçage, plus JAMAIS un recalcul",
    NA_character_
  ),
  raison = c(
    "initial whole-repo parse-data seam audit; later structural audits reuse the cache",
    "initial DBI-candidate parse-data audit; the positional contract covers every R source",
    "first full targets network construction for the ordinary environment; later files reuse it",
    "distinct DB+profile targets network construction for the publication dependency contract",
    "four execution scenarios on the smallest toy graph prove input/code/error lock semantics",
    "executes first make and unchanged second make to prove the lock runs then skips",
    "executes a content change to prove the file-hash lock replays",
    "executes an import-body change to prove transitive code hashing replays the lock",
    "executes a broken lock to prove a red target remains loud while the report survives",
    "two incremental fixture executions prove bytes and published vintage follow changed inputs",
    "execution is the contract: two tar_make calls on the three-target vintage fixture",
    "execution is the contract: always-cue report rewrite across two makes",
    "execution is the contract: failed downstream target plus surviving report",
    "execution is the contract: canon-only invalidation and republication on the mini-graph",
    "execution is the contract: cue discipline across repeated makes; cron retirement leaves it unchanged",
    "execution is the contract: cron never recomputes after bootstrap; #1129 leaves it unchanged",
    "23 small deterministic Milieux reading-law tests; no individual test exceeds 4 s"
  ),
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
