# Encodage des fichiers sources (#1131) ----------------------------------------
# Un BOM UTF-8 en tête d'un script d'exploitation rend `Rscript` incapable de le
# parser : « unexpected invalid token ». C'est arrivé à
# `scripts/publish-serving-tables.R` (PR #1107), ce qui a cassé TOUTE la voie de
# publication opérateur sans qu'aucun test ne s'en aperçoive — aucun test
# n'exécutait ni ne parsait ce script. Ces deux gardes ferment la classe.

racine_paquet <- function(depart = getwd()) {
  d <- normalizePath(depart, winslash = "/", mustWork = TRUE)
  repeat {
    if (file.exists(file.path(d, "DESCRIPTION")) &&
        file.exists(file.path(d, "_targets.R"))) {
      return(d)
    }
    parent <- dirname(d)
    if (identical(parent, d)) stop("racine du paquet introuvable", call. = FALSE)
    d <- parent
  }
}

commence_par_bom <- function(chemin) {
  con <- file(chemin, open = "rb")
  on.exit(close(con), add = TRUE)
  octets <- readBin(con, what = "raw", n = 3L)
  length(octets) == 3L && identical(as.integer(octets), c(0xEF, 0xBB, 0xBF))
}

test_that("aucun fichier source ne commence par un BOM", {
  racine <- racine_paquet()
  fichiers <- list.files(
    file.path(racine, c("R", "scripts")),
    pattern = "[.](R|ps1|Rmd)$",
    recursive = TRUE, full.names = TRUE)
  expect_gt(length(fichiers), 20L)
  fautifs <- fichiers[vapply(fichiers, commence_par_bom, logical(1))]
  expect_identical(fautifs, character(0))
})

test_that("chaque script d'exploitation se parse", {
  racine <- racine_paquet()
  scripts <- list.files(
    file.path(racine, "scripts"), pattern = "[.]R$", full.names = TRUE)
  expect_gt(length(scripts), 5L)
  for (script in scripts) {
    message_erreur <- tryCatch({
      parse(file = script)
      NULL
    }, error = function(e) conditionMessage(e))
    expect_null(message_erreur, info = basename(script))
  }
})

test_that("le garde de release lui-même se parse", {
  # release_freeze.R est chargé par pkgload : un BOM y passait inaperçu, mais il
  # rend le fichier illisible pour tout outil qui l'exécute directement.
  racine <- racine_paquet()
  expect_false(commence_par_bom(file.path(racine, "R", "release_freeze.R")))
})
