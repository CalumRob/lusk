test_that("données réelles : le snapshot Geovelo réel passe le lecteur + normaliseur + porte (LUSK_RUN_REAL=1)", {
  skip_sans_donnees_reelles(
    file.exists(testthat::test_path("..", "..", "data", "raw", "france-20260807.parquet")),
    "le snapshot Geovelo n'est pas dans le cache (data/raw — gitignoré)"
  )

  # la source COG (pour le mapping 2022→2025) doit être dans le cache
  zip <- testthat::test_path("..", "..", "data", "raw", "table_passage_annuelle_2025.zip")
  skip_sans_donnees_reelles(file.exists(zip),
                            "la source COG n'est pas dans le cache (data/raw)")

  # la table de passage COG 2022→2025 (depuis le fichier réel, filtrée Bretagne)
  extrait <- tempfile("cog-")
  dir.create(extrait)
  suppressWarnings(utils::unzip(zip, exdir = extrait, overwrite = TRUE))
  brut_cog <- lire_table_passage(file.path(extrait, "table_passage_annuelle_2025.xlsx"))
  bretagne_cog <- brut_cog[grepl("^(22|29|35|56)", brut_cog$CODGEO_2025), ]
  mappe <- construire_passage_cog(bretagne_cog)

  # le lecteur réel du parquet Geovelo
  parquet <- testthat::test_path("..", "..", "data", "raw", "france-20260807.parquet")
  frais <- lire_amenagements_cyclables(parquet)
  expect_s3_class(frais, "sf")
  expect_equal(nrow(frais), 412681L)  # le compte réel verrouillé (research note §4)

  # la porte de qualité passe sur le fichier réel
  expect_true(verifier_qualite_amenagements(frais))

  # la normalisation réelle : bretonne, COG 2025, triée
  table <- normaliser_amenagements_cyclables(frais, mappe)
  expect_equal(nrow(table), 27797L)  # la tranche bretonne réelle (research note §7.10bis)
  expect_true(all(grepl("^(22|29|35|56)", table$code_com_d)))
  expect_equal(sf::st_crs(table)$input, "EPSG:4326")

  # le compte réel des fusions : aucun code 2022 breton ne survit non mappé
  expect_false(any(table$code_com_d %in% c("22027", "22043", "22309", "35112")))
})
