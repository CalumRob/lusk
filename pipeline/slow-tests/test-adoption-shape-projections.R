# Slow tier (#1172): real adapter projections for every adoption shape,
# including the full 235-TYPEQU AEDAR fixture.
# Subject files: pipeline/R/adoption_ressource.R, pipeline/R/splitter_ressources.R,
#   pipeline/R/adaptateur_scalaire.R, pipeline/R/adaptateur_profil_declare.R,
#   pipeline/R/adaptateur_series.R, pipeline/R/adaptateur_collection.R,
#   pipeline/R/adaptateur_aedar.R, pipeline/tests/testthat/helper-adaptateurs-formes.R
# Run explicitly with testthat::test_file(..., package="lusk") from pipeline/.

local({
  withr::local_dir(file.path(pkgload::pkg_path(), "tests", "testthat"))
  for (helper in list.files(file.path(pkgload::pkg_path(), "tests", "testthat"),
                            pattern = "^helper.*\\.R$", full.names = TRUE))
    source(helper, local = environment())

  test_that("every shape's adoption reader contract compares its real adapter projection", {
    root <- artefacts_fixture_root()
    on.exit(unlink(root, recursive = TRUE), add = TRUE)
    artefacts <- list(
      declared_profile = artefacts_fixture_profile_artefact(root = root)$artefact,
      owned_series = adaptateur_series_artefact(root),
      observed_collection = adaptateur_collection_artefact(root),
      aedar = adaptateur_aedar_artefact(root))
    for (forme in names(artefacts)) {
      handler <- REGISTRE_FORMES_RESSOURCE[[forme]]
      attendu <- handler$projeter(artefacts[[forme]])
      expect_true(comparer_ressource_adoptation(attendu, attendu, handler)$identique,
                  info = forme)
      live <- attendu
      if (!is.null(live$comparison$groups) && nrow(live$comparison$groups))
        live$comparison$groups[1L, 1L] <- "changed"
      else if (!is.null(live$projection$points) && nrow(live$projection$points))
        live$projection$points$value[1L] <- live$projection$points$value[1L] + 1
      else if (!is.null(live$projection$facts) && nrow(live$projection$facts))
        live$projection$facts$value[1L] <- live$projection$facts$value[1L] + 1
      else live$descriptor$label[1L] <- "changed"
      expect_false(comparer_ressource_adoptation(attendu, live, handler)$identique,
                   info = forme)
    }
  })
})
