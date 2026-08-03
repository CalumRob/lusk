test_that("le manifeste liste les sources démographiques avec leurs métadonnées", {
  expect_s3_class(MANIFEST_DEMOGRAPHIE, "tbl_df")
  expect_true(all(c("id", "source", "url", "fichier", "vintage", "licence", "note") %in%
                    names(MANIFEST_DEMOGRAPHIE)))
  expect_true(all(!duplicated(MANIFEST_DEMOGRAPHIE$id)))
  expect_true(all(startsWith(MANIFEST_DEMOGRAPHIE$url, "https://")))
  expect_true(all(MANIFEST_DEMOGRAPHIE$licence == "lov2"))
  expect_true(all(!is.na(MANIFEST_DEMOGRAPHIE$note)))

  # 4 sources : série historique (pop/superficie/soldes), ménages,
  # détail par âge (PRINC), base des EPCI.
  expect_equal(nrow(MANIFEST_DEMOGRAPHIE), 4)
  expect_setequal(
    MANIFEST_DEMOGRAPHIE$vintage,
    c(serie_historique = "2023", menages = "2023", age_detail = "2023",
      epci = "2025")
  )
})

test_that("download_sources est idempotent : ne touche pas ce qui existe", {
  cache <- tempfile("cache-")
  dir.create(cache)
  on.exit(unlink(cache, recursive = TRUE))

  # un manifeste factice dont l'URL échouerait si elle était touchée
  factice <- tibble::tibble(
    id = "test", source = "test", url = "https://example.invalid/x",
    fichier = "fichier-test.zip", vintage = "2023", licence = "lov2",
    note = "test"
  )
  cible <- file.path(cache, "fichier-test.zip")
  writeLines("deja telecharge", cible)

  expect_no_error(download_sources(factice, cache))
  expect_equal(readLines(cible), "deja telecharge")
})
