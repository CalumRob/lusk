test_that("les comparaisons de bâtiments publient le même canon Parquet que le JSON", {
  # Le script ciblé part des comparaisons déjà calculées par R. Leur forme
  # territoire/contexte, et non la fiche JSON, est l'entrée de publication.
  projections <- list(
    distribution = tibble::tibble(
      territoire = "22001", type = "commune", comparison_mode = "epci",
      scope_kind = "communes-epci", scope_label = "communes de EPCI X",
      breadth_bucket = "0", depth_bucket = "0",
      comparison_total_buildings = 4L,
      comparison_building_count = 3L, comparison_share = 0.75
    ),
    rampe = tidyr::crossing(
      territoire = "22001", type = "commune", comparison_mode = "epci",
      scope_kind = "communes-epci", scope_label = "communes de EPCI X",
      mode = c("b", "c", "t"), quantile = RAMPE_ACCES_BATIMENTS_QUANTILES,
      comparison_total_buildings = 4L,
      comparison_accessible_types = 7
    )
  )
  cible <- tempfile("comparaisons-")
  dir.create(cible)
  on.exit(unlink(cible, recursive = TRUE), add = TRUE)

  publier_comparaisons_acces_batiments(projections, cible)

  for (kind in c("distribution", "rampe")) {
    nom <- paste0(if (kind == "distribution")
      "distribution_acces_batiments_comparaisons" else
      "rampe_acces_batiments_comparaisons")
    parquet <- nanoparquet::read_parquet(file.path(cible, paste0(nom, ".parquet")))
    json <- jsonlite::fromJSON(file.path(cible, paste0(nom, ".json")))
    expect_equal(as.list(parquet), as.list(projections[[kind]]), info = kind)
    verifier_non_derivee(parquet, json, nom)
  }

  canon <- file.path(cible, "rampe_acces_batiments_comparaisons.parquet")
  avant <- readBin(canon, "raw", n = file.info(canon)$size)
  expect_error(
    publier_comparaisons_acces_batiments(projections["distribution"], cible),
    "incomplètes"
  )
  expect_identical(readBin(canon, "raw", n = file.info(canon)$size), avant)
  projections$rampe <- projections$rampe[-1L, , drop = FALSE]
  expect_error(
    publier_comparaisons_acces_batiments(projections, cible),
    "incomplète"
  )
  expect_identical(readBin(canon, "raw", n = file.info(canon)$size), avant)
})
