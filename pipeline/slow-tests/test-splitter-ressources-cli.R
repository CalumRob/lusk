# Slow tier (#1172): the local splitter command reads a real generated sortie; protects resource/shape/version/status CLI output.
# Run explicitly with testthat::test_file(..., package="lusk") from pipeline/.

local({
  withr::local_dir(file.path(pkgload::pkg_path(), "tests", "testthat"))
  for (helper in list.files(file.path(pkgload::pkg_path(), "tests", "testthat"), pattern = "^helper.*\\.R$", full.names = TRUE)) source(helper, local = environment())

test_that("la commande locale split lit une vraie sortie et imprime resource, shape, version, statut", {
  sortie <- artefacts_fixture_sortie_scalaire()
  root <- artefacts_fixture_root()
  on.exit(unlink(c(sortie, root), recursive = TRUE), add = TRUE)
  script <- testthat::test_path("..", "..", "scripts", "publication.R")
  precedent <- Sys.getenv("LUSK_ARTEFACTS", unset = NA_character_)
  Sys.setenv(LUSK_ARTEFACTS = root)
  on.exit(if (is.na(precedent)) Sys.unsetenv("LUSK_ARTEFACTS") else
    Sys.setenv(LUSK_ARTEFACTS = precedent), add = TRUE)
  commande <- function() system2("Rscript", c(shQuote(script), "split", shQuote(sortie)),
    stdout = TRUE, stderr = TRUE)

  premier <- commande()
  expect_true(any(grepl("^densite, scalar, [a-f0-9]{32}, new$", premier)))
  second <- commande()
  expect_true(any(grepl("^densite, scalar, [a-f0-9]{32}, unchanged$", second)))
  version <- function(lignes) sub("^densite, scalar, ([a-f0-9]{32}), .*$", "\\1",
    grep("^densite, scalar,", lignes, value = TRUE))
  expect_identical(version(premier), version(second))
})

})
