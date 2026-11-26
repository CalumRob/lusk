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
    "test-offre-tc-bridge.R",
    "test-release-freeze.R",
    "test-publish-scalar.R"
  ),
  test = c(
    NA_character_,
    "real repo passes both seam audits (apply guarded, not allowlisted)",
    "every DBI params list in R/ is positional (RPostgres contract)",
    NA_character_,
    "discipline de cue : un second appel SAUTE tout, une entrée touchée n'invalide que la chaîne",
    "LE CRON SAUTE LA CHAÎNE : après l'amorçage, plus JAMAIS un recalcul",
    NA_character_,
    NA_character_,
    "raccordement scalar projection binds its producer metadata, source vintage, and trajectory t0090"
  ),
  raison = c(
    "initial whole-repo parse-data seam and DBI audits; later structural audits reuse the cache",
    "first structural audit parses its connection/write candidates and proves apply is guarded",
    "first DBI-candidate parse-data audit; the positional contract covers every R source",
    "one full targets network construction for report dependency edges; later files reuse it",
    "execution is the contract: cue discipline across repeated makes; expires with #1129",
    "execution is the contract: cron never recomputes after bootstrap; expires with #1129",
    "ADR-0049 step 4 retires the offre_tc bridge; expires with ADR-0049 step 4",
    "real digests_run dependency-edge assertion requires the distinct DB+profile network",
    "#1163 committed-payload raccordement refusal; assertion intentionally unchanged"
  ),
  expiration = c(rep(NA_character_, 4L), "#1129", "#1129", "ADR-0049 step 4", NA_character_, NA_character_),
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

premiere_ligne_message <- function(message) {
  if (inherits(message, "condition")) message <- conditionMessage(message)
  if (length(message) != 1L || is.na(message) || !nzchar(message))
    return("<no message>")
  strsplit(as.character(message), "\r?\n", perl = TRUE)[[1L]][[1L]]
}

premier_message_resultat <- function(resultats) {
  if (is.null(resultats) || !length(resultats)) return("<no message>")
  messages <- vapply(resultats, function(attente) {
    if (inherits(attente, "condition")) return(conditionMessage(attente))
    if (is.list(attente) && !is.null(attente$message) && length(attente$message))
      return(as.character(attente$message)[[1L]])
    ""
  }, character(1))
  messages <- messages[nzchar(messages) & !is.na(messages)]
  if (!length(messages)) return("<no message>")
  premiere_ligne_message(messages[[1L]])
}

# A testthat ERROR is not a failed expectation. Report both, plus a file that
# failed before producing a result table, so this one run can replace test_local().
echecs_suite <- function(par_fichier, par_test) {
  erreurs_test <- (!is.na(par_test$failed) & par_test$failed > 0) |
    (!is.na(par_test$error) & par_test$error > 0)
  tests <- par_test[erreurs_test, , drop = FALSE]
  lignes <- data.frame(
    file = as.character(tests$file), test = as.character(tests$test),
    kind = ifelse(!is.na(tests$error) & tests$error > 0, "ERROR", "FAIL"),
    message = vapply(tests$first_message, premiere_ligne_message, character(1)),
    stringsAsFactors = FALSE
  )
  erreurs_fichier <- if (is.null(par_fichier$errored)) rep(FALSE, nrow(par_fichier)) else
    !is.na(par_fichier$errored) & par_fichier$errored
  fichiers <- par_fichier[erreurs_fichier, , drop = FALSE]
  if (nrow(fichiers)) {
    messages <- if (is.null(fichiers$error_message)) rep(NA_character_, nrow(fichiers)) else
      fichiers$error_message
    lignes <- rbind(lignes, data.frame(
      file = as.character(fichiers$file), test = "<file load>", kind = "ERROR",
      message = vapply(messages, premiere_ligne_message, character(1)),
      stringsAsFactors = FALSE
    ))
  }
  lignes
}

formater_echecs_suite <- function(echecs) {
  if (!nrow(echecs)) return(character())
  c("R default suite failed:",
    sprintf("  %s %s :: %s: %s", echecs$kind, echecs$file, echecs$test,
            echecs$message))
}

arreter_si_echecs <- function(echecs) {
  if (nrow(echecs))
    stop("R default suite failed; see the file/test/message report above.",
         call. = FALSE)
  invisible(NULL)
}

formater_depassements_budget <- function(depassements) {
  details <- character()
  if (nrow(depassements$tests)) {
    details <- c(details, paste0("  test  ", depassements$tests$file, " :: ",
      depassements$tests$test, " (", round(depassements$tests$real, 2), " s)"))
  }
  if (nrow(depassements$fichiers)) {
    details <- c(details, paste0("  file ", depassements$fichiers$file, " (",
      round(depassements$fichiers$wall, 2), " s)"))
  }
  details
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
      error = identity
    )
    duree <- as.numeric(difftime(Sys.time(), t1, units = "secs"))
    df <- if (inherits(resultat, "error")) NULL else as.data.frame(resultat)
    message_erreur <- if (inherits(resultat, "error"))
      premiere_ligne_message(resultat) else NA_character_
    lignes[[f]] <- data.frame(
      file = f, wall = duree,
      tests = if (is.null(df)) NA else nrow(df),
      expectations = if (is.null(df)) NA else sum(df$nb),
      in_tests = if (is.null(df)) NA else sum(df$real),
      failed = if (is.null(df)) NA else sum(df$failed),
      errored = inherits(resultat, "error"), error_message = message_erreur
    )
    if (!is.null(df)) {
      resultats_tests <- if (is.null(df$result)) rep(list(NULL), nrow(df)) else df$result
      tests[[f]] <- data.frame(
        file = df$file, test = df$test, nb = df$nb, real = df$real,
        failed = df$failed, error = df$error,
        first_message = vapply(resultats_tests, premier_message_resultat, character(1)),
        stringsAsFactors = FALSE
      )
    }
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
  if (is.null(resultats$par_fichier$errored))
    resultats$par_fichier$errored <- FALSE
  if (is.null(resultats$par_fichier$error_message))
    resultats$par_fichier$error_message <- NA_character_
  if (is.null(resultats$par_test$error)) resultats$par_test$error <- 0L
  if (is.null(resultats$par_test$first_message))
    resultats$par_test$first_message <- "<no message>"
  cat(paste(formater_rapport_budget(resultats, options$top), collapse = "\n"),
      "\n", sep = "")
  echecs <- echecs_suite(resultats$par_fichier, resultats$par_test)
  if (nrow(echecs)) {
    cat(paste(formater_echecs_suite(echecs), collapse = "\n"), "\n", sep = "")
    arreter_si_echecs(echecs)
  }
  depassements <- depassements_budget(resultats$par_fichier, resultats$par_test)
  if (nrow(depassements$tests) || nrow(depassements$fichiers)) {
    stop("R suite budget exceeded; add a reasoned exception or move the contract:\n",
         paste(formater_depassements_budget(depassements), collapse = "\n"),
         call. = FALSE)
  }
  cat(sprintf("Budget OK: no unlisted test > %.0f s or file > %.0f s.\n",
              BUDGET_TEST_SECONDS, BUDGET_FILE_SECONDS))
  invisible(resultats)
}

if (sys.nframe() == 0L) {
  script <- sub("^--file=", "", grep("^--file=", commandArgs(FALSE), value = TRUE)[[1L]])
  source(file.path(dirname(script), "heavy-test-lock.R"), local = TRUE)
  executer_avec_lock_lourd(script, commandArgs(trailingOnly = TRUE))
  main_budget()
}
