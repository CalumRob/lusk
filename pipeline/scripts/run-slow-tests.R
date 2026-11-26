# run-slow-tests -----------------------------------------------------------------
# Orchestrator-owned slow tier (#1172 review). Run from pipeline/:
#   Rscript scripts/run-slow-tests.R
#   Rscript scripts/run-slow-tests.R --for pipeline/R/foo.R tests/testthat/bar.R
#
# Every slow test declares `# Subject files: ...` in its header. A changed path
# selects a test when it equals a subject, is inside a declared subject directory,
# or contains a declared subject file (useful for directory-level diffs).

racine_projet <- function() {
  if (file.exists("DESCRIPTION")) {
    racine <- normalizePath("..", winslash = "/", mustWork = TRUE)
  } else if (file.exists("../DESCRIPTION")) {
    racine <- normalizePath("../..", winslash = "/", mustWork = TRUE)
  } else {
    racine <- normalizePath(file.path(pkgload::pkg_path(), ".."),
                            winslash = "/", mustWork = TRUE)
  }
  racine
}

normaliser_chemin_sujet <- function(chemin) {
  racine <- racine_projet()
  if (startsWith(chemin, "pipeline/") || startsWith(chemin, "public/")) {
    retour <- normalizePath(file.path(racine, chemin), winslash = "/",
                            mustWork = FALSE)
  } else if (file.exists(chemin)) {
    retour <- normalizePath(chemin, winslash = "/", mustWork = TRUE)
  } else if (file.exists(file.path("..", chemin))) {
    retour <- normalizePath(file.path("..", chemin), winslash = "/", mustWork = TRUE)
  } else {
    retour <- normalizePath(file.path(racine, "pipeline", chemin),
                            winslash = "/", mustWork = FALSE)
  }
  tolower(sub("/+$", "", retour))
}

sujets_test_lent <- function(fichier) {
  lignes <- readLines(fichier, warn = FALSE, encoding = "UTF-8")
  lignes <- lignes[grepl("^#\\s*Subject files:", lignes)]
  if (!length(lignes)) {
    stop("Slow test has no '# Subject files:' declaration: ", fichier,
         call. = FALSE)
  }
  declare <- sub("^#\\s*Subject files:\\s*", "", lignes[[1L]])
  unlist(strsplit(declare, ",", fixed = TRUE), use.names = FALSE) |>
    trimws() |>
    Filter(nzchar, x = _)
}

sujet_intersecte <- function(change, sujet) {
  identical(change, sujet) ||
    startsWith(change, paste0(sujet, "/")) ||
    startsWith(sujet, paste0(change, "/"))
}

arguments_tests_lents <- function(args) {
  if (!length(args)) return(list(changes = character(), tous = TRUE))
  if (args[[1L]] != "--for" || length(args) < 2L) {
    stop("Usage: Rscript scripts/run-slow-tests.R [--for <changed files...>]",
         call. = FALSE)
  }
  list(changes = args[-1L], tous = FALSE)
}

selectionner_tests_lents <- function(changes = character(), tous = FALSE,
                                     repertoire = "slow-tests") {
  fichiers <- sort(list.files(repertoire, pattern = "^test.*\\.R$",
                              full.names = TRUE))
  if (tous || !length(changes)) return(fichiers)
  changes_normalises <- vapply(changes, normaliser_chemin_sujet, character(1))
  fichiers[vapply(fichiers, function(fichier) {
    sujets <- vapply(sujets_test_lent(fichier), normaliser_chemin_sujet,
                     character(1))
    any(vapply(changes_normalises, function(change) {
      any(vapply(sujets, sujet_intersecte, logical(1), change = change))
    }, logical(1)))
  }, logical(1))]
}

executer_tests_lents <- function(fichiers) {
  if (!length(fichiers)) {
    cat("No slow tests declare the changed paths.\n")
    return(invisible(NULL))
  }
  cat(sprintf("Running %d slow test file(s):\n", length(fichiers)),
      paste(" ", fichiers, collapse = "\n"), "\n", sep = "")
  resultats <- lapply(fichiers, function(fichier) {
    tryCatch(
      testthat::test_file(fichier, package = "lusk", stop_on_failure = FALSE),
      error = function(e) e
    )
  })
  erreurs <- vapply(resultats, inherits, logical(1), "error")
  if (any(erreurs)) {
    stop("Slow test execution errors:\n",
         paste(vapply(resultats[erreurs], conditionMessage, character(1)),
               collapse = "\n"), call. = FALSE)
  }
  bilan <- compter_resultats_tests_lents(lapply(resultats, as.data.frame))
  cat(sprintf("Slow tier: %d expectations | %d failures | %d errors\n",
              bilan$attentes, bilan$echecs, bilan$erreurs))
  if (bilan$echecs > 0L || bilan$erreurs > 0L)
    stop("Slow tier has failing or erroring tests.", call. = FALSE)
  invisible(resultats)
}

# A testthat ERROR (an exception inside a test) is NOT a failed expectation: it sets
# the per-test `error` flag and leaves `failed` at 0. Count both, or an erroring slow
# test reads as green.
compter_resultats_tests_lents <- function(tableaux) {
  somme <- function(colonne) sum(vapply(tableaux, function(df)
    if (colonne %in% names(df)) sum(as.numeric(df[[colonne]]), na.rm = TRUE) else 0,
    numeric(1)))
  list(attentes = somme("nb"), echecs = somme("failed"), erreurs = somme("error"))
}

main_tests_lents <- function() {
  if (!file.exists("DESCRIPTION") || !file.exists("_targets.R")) {
    stop("Run this command from the pipeline/ directory.", call. = FALSE)
  }
  options <- arguments_tests_lents(commandArgs(trailingOnly = TRUE))
  pkgload::load_all(".", quiet = TRUE, export_all = TRUE)
  fichiers <- selectionner_tests_lents(options$changes, options$tous)
  executer_tests_lents(fichiers)
}

if (sys.nframe() == 0L) {
  script <- sub("^--file=", "", grep("^--file=", commandArgs(FALSE), value = TRUE)[[1L]])
  source(file.path(dirname(script), "heavy-test-lock.R"), local = TRUE)
  executer_avec_lock_lourd(script, commandArgs(trailingOnly = TRUE))
  main_tests_lents()
}
