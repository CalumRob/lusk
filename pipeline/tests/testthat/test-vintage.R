test_that("vintages_demographie : une ligne par source du manifeste", {
  v <- vintages_demographie()

  expect_equal(nrow(v), nrow(MANIFEST_DEMOGRAPHIE))
  expect_named(v, c("id", "source", "version", "licence",
                    "date_reference", "date_publication"))
  expect_true(all(v$licence == "lov2"))
  expect_setequal(v$version, c("2023", "2025"))
  expect_true(all(!is.na(v$date_reference)))
})

test_that("les vintages portent les deux dates : référence et publication (point 5)", {
  v <- vintages_demographie()

  # date_reference : la date de la donnée (« RP 2023 » = au 1er janvier 2023)
  expect_equal(v$date_reference[v$id == "serie_historique"], "2023-01-01")
  expect_equal(v$date_reference[v$id == "epci"], "2025-01-01")

  # date_publication : la mise en ligne réelle — vérifiée sur data.gouv
  # (created_at des ressources 2023 = 2026-06-30). La base des EPCI vit sur
  # insee.fr, qui n'expose pas de date de fichier : NA, à compléter par le
  # watchdog.
  expect_equal(v$date_publication[v$id == "serie_historique"], "2026-06-30")
  expect_equal(v$date_publication[v$id == "menages"], "2026-06-30")
  expect_equal(v$date_publication[v$id == "age_detail"], "2026-06-30")
  expect_true(is.na(v$date_publication[v$id == "epci"]))
})

test_that("la table des vintages est le seam du watchdog (ADR-0001)", {
  v <- vintages_demographie()
  # ADR-0001 : la licence est déclarée par composant — chaque source la porte
  expect_true(all(v$licence == "lov2"))
  # une source par jeu de données, jamais de doublon
  expect_equal(nrow(v), length(unique(v$id)))
})
