# Slow tier (#1172): builds the full adopt fixture once (payload profiles and
# AEDAR canonical manifest, ~22 s) and proves every resource artefact has an
# attested lineage whose source ids are all present in the lock.
# Subject files: pipeline/R/splitter_ressources.R, pipeline/R/adoption_publication.R,
# pipeline/tests/testthat/test-adopt-db.R, pipeline/tests/testthat/helper-adopt-db-fixture.R
# Run explicitly with testthat::test_file(..., package="lusk") from pipeline/.

local({
  withr::local_dir(file.path(pkgload::pkg_path(), "tests", "testthat"))
  for (helper in list.files(file.path(pkgload::pkg_path(), "tests", "testthat"),
                            pattern = "^helper.*\\.R$", full.names = TRUE))
    source(helper, local = environment())

test_that("adopt fixture gives every resource an attested lineage present in the lock", {
  fixture <- .adopt_db_fixture()
  on.exit(unlink(c(fixture$sortie, fixture$root, fixture$aedar_dir,
    fixture$metadata_directory), recursive = TRUE), add = TRUE)
  builds <- splitter_sortie(fixture$sortie, root = fixture$root,
    projections = fixture$projections, reference = fixture$reference,
    metadata_directory = fixture$metadata_directory)
  artefacts <- charger_artefacts_construits(builds, fixture$root)
  expect_true(nrow(builds) >= 8L)
  expect_setequal(names(artefacts), as.character(builds$ressource))
  for (id in names(artefacts)) {
    lignage <- artefacts[[id]]$digests_lignage
    expect_true(is.list(lignage) && length(lignage) > 0L, info = id)
    for (source in names(lignage)) {
      entree <- lignage[[source]]
      expect_identical(as.character(entree$source_id), source, info = paste(id, source))
      expect_false(isTRUE(entree$absent), info = paste(id, source))
      expect_true(is.character(entree$sha256) && length(entree$sha256) == 1L &&
                    !is.na(entree$sha256) && nzchar(entree$sha256),
                  info = paste(id, source))
      expect_true(source %in% names(fixture$lock), info = paste(id, source))
    }
    acceptable <- tryCatch({
      verifier_gel_lignage_ressource(artefacts[[id]], registre = fixture$lock)
      TRUE
    }, error = function(e) FALSE)
    expect_true(acceptable, info = id)
  }
})
})
