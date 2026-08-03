test_that("vintages_demographie : une ligne par source du manifeste", {
  v <- vintages_demographie()

  expect_equal(nrow(v), nrow(MANIFEST_DEMOGRAPHIE))
  expect_named(v, c("source", "version", "licence", "date"))
  expect_true(all(v$licence == "lov2"))
  expect_setequal(v$version, c("2023", "2025"))
  expect_true(all(!is.na(v$date)))
})

test_that("la table des vintages est le seam du watchdog (ADR-0001)", {
  v <- vintages_demographie()
  # ADR-0001 : la licence est déclarée par composant — chaque source la porte
  expect_true(all(v$licence == "lov2"))
  # une source par jeu de données, jamais de doublon
  expect_equal(nrow(v), length(unique(v$source)))
})
