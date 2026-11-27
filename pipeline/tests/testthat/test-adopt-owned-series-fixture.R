test_that("adopt OCS-GE fixture uses the production projector and registered artifact schema", {
  metadata <- lire_theme_metadata("milieux")
  metadata$indicator_pages$artif_par_habitant$series_dataset_id <- "artif_par_habitant"
  projection <- .adopt_db_series_projection(metadata)
  contract <- owned_series_artifact_fields("artif_par_habitant")
  expect_identical(sort(names(projection)),
    sort(c(contract$table_fields, contract$json_fields)))
  expect_identical(projection$descriptor$dataset_id, "artif_par_habitant")
  expect_identical(projection$descriptor$indicator_id, "artif_par_habitant")
  expect_type(projection$excluded, "list")

  root <- tempfile("adopt-owned-series-artifact-")
  on.exit(unlink(root, recursive = TRUE), add = TRUE)
  write_owned_series_artifact(projection, root, "artif_par_habitant")
  expect_identical(read_owned_series_artifact(root, "artif_par_habitant"), projection)
})
