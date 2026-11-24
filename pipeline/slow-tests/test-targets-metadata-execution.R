# Slow tier (#1172): execution is the contract: canon-only invalidation and republication on the multi-theme mini-graph.
# Subject files: pipeline/_targets.R, pipeline/tests/testthat/helper-targets-fixtures.R
# Run explicitly with testthat::test_file(..., package="lusk") from pipeline/.

local({
  withr::local_dir(file.path(pkgload::pkg_path(), "tests", "testthat"))
  for (helper in list.files(file.path(pkgload::pkg_path(), "tests", "testthat"), pattern = "^helper.*\\.R$", full.names = TRUE)) source(helper, local = environment())

test_that("un changement du canon seul ne reconstruit que SA cible metadata ; sans changement tout saute (#434)", {
  projet <- installer_mini_projet_multi()
  withr::local_dir(projet)

  targets::tar_make(callr_function = NULL)

  # zéro changement : tout saute — PAS de fausse invalidation (le canon est
  # suivi PAR CONTENU, un run à l'identique ne rejoue rien)
  expect_identical(targets::tar_outdated(callr_function = NULL), character(0))

  # le CANON SEUL de toy change (le même geste que l'édition du
  # theme_economie.json de 29d5277) : exactement les DEUX cibles du mécanisme
  # deviennent périmées — le canon et la publication de SON thème. Ni toy2,
  # ni une seule étape de données de toy.
  writeLines("canon-toy-v2",
             file.path(projet, "toypkg", "inst", "extdata", "theme-metadata",
                       "theme_toy.json"))
  perimes <- sort(targets::tar_outdated(callr_function = NULL))
  expect_identical(perimes, c("fichier_metadata_toy", "metadata_toy"))

  # le run republie : le descripteur public porte le NOUVEAU canon, celui de
  # toy2 reste à l'édition 1, et le graphe redevient entièrement frais
  targets::tar_make(callr_function = NULL)
  expect_identical(readLines(file.path(projet, "out", "theme_toy.txt")),
                   "canon-toy-v2")
  expect_identical(readLines(file.path(projet, "out", "theme_toy2.txt")),
                   "canon-toy2-v1")
  expect_identical(targets::tar_outdated(callr_function = NULL), character(0))
})

})
