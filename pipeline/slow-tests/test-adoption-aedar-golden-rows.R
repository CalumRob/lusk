# Slow tier (#1142): the dense AEDAR persisted rows equal what origin/main's
# pre-refactor AEDAR writers persisted (publish_aedar_aggregates +
# ecrire_aedar_comparaison_rows). Building the 235-TYPEQU artefact costs ~15 s, over
# the default-suite per-test budget. The literals are in helper-golden-lignes-main.R
# (how they were captured is documented there); tables over 200 rows are pinned by row
# count, sorted columns, two literal head rows and a SHA-256 of the canonical rows.
# Subject files: pipeline/R/aedar_aggregates.R, pipeline/R/adaptateur_aedar.R, pipeline/tests/testthat/helper-golden-lignes-main.R, pipeline/tests/testthat/helper-golden-lignes-outils.R, pipeline/tests/testthat/helper-adaptateurs-formes.R, pipeline/tests/testthat/helper-aedar-fixtures.R
# Run explicitly with testthat::test_file(..., package="lusk") from pipeline/.

local({
  withr::local_dir(file.path(pkgload::pkg_path(), "tests", "testthat"))
  for (helper in list.files(file.path(pkgload::pkg_path(), "tests", "testthat"),
                            pattern = "^helper.*\\.R$", full.names = TRUE))
    source(helper, local = environment())

test_that("refactor persists the rows the old AEDAR writers persisted", {
  root <- artefacts_fixture_root()
  on.exit(unlink(root, recursive = TRUE), add = TRUE)
  artefact <- .artefacts_golden(root, "aedar")$aedar
  actual <- lignes_aedar_persistees(artefact)
  small <- golden_lignes_main$aedar
  # comparison_content_version / aedar_content_version are md5 hashes recorded in
  # the ARTEFACT (an input, not a builder output) and they are not stable across R
  # sessions (the same fixture hashes differently under testthat and under Rscript),
  # so they cannot be pinned as literals. They are pinned by relation instead: the old
  # writer copied the artefact comparison's own tokens onto every summary row.
  for (table in names(small))
    .attendre_table_golden(actual[[table]], small[[table]], table,
      if (identical(table, "aedar_density_class_summary"))
        c("comparison_content_version", "aedar_content_version") else character())
  comparaison <- artefact$contenu$comparison
  densite <- actual$aedar_density_class_summary
  expect_identical(unique(as.character(densite$comparison_content_version)),
                   as.character(comparaison$content_version))
  expect_identical(unique(as.character(densite$aedar_content_version)),
                   as.character(comparaison$aedar_content_version))
  for (table in names(golden_aedar_volumineux)) {
    pin <- golden_aedar_volumineux[[table]]
    x <- actual[[table]]
    expect_identical(nrow(x), pin$rows, info = table)
    expect_identical(sort(names(x)), pin$columns, info = table)
    expect_identical(.digest_lignes(x), pin$digest, info = table)
    # Two rows of the same table, literally, for a readable failure.
    expect_true(all(.lignes_canoniques(pin$head) %in% .lignes_canoniques(x)), info = table)
  }
  # Every table the builder returns is covered by one of the two pins.
  couvertes <- c(names(small), names(golden_aedar_volumineux))
  for (table in setdiff(names(actual), couvertes))
    expect_identical(nrow(actual[[table]]), 0L, info = paste("extra table", table))
})
})
