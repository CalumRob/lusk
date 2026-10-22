test_that("the retained SQL publisher requires a private passfile and accepts an operator host", {
  passfile <- tempfile()
  on.exit(unlink(passfile), add=TRUE)
  withr::local_envvar(c(
    LUSK_PUBLISH_HOST="publisher.example", LUSK_PUBLISH_PORT="15432",
    LUSK_PUBLISH_DATABASE="lusk", LUSK_PUBLISH_USER="publisher",
    PGPASSFILE=passfile
  ))
  expect_error(configuration_service_postgres(), "passfile")
  writeLines("not-a-secret", passfile)
  expect_identical(configuration_service_postgres()$host, "publisher.example")
  expect_identical(configuration_service_postgres()$port, 15432L)
})

test_that("the legacy relational publisher has no normal production entrypoint", {
  root <- pkgload::pkg_path()
  source_files <- file.path(root, c("R/run_pipeline.R", "R/publish_postgres_configuration.R",
    "R/publish_retained_scalar_snapshot.R", "_targets.R"))
  source <- paste(unlist(lapply(source_files, readLines, warn=FALSE)), collapse="\n")
  expect_false(grepl("publier_tables_postgres|publier_tables_service_depuis_parquet|preparer_tables_service", source))
  expect_false(grepl("service_registry|essential_service_access|building_ramp|building_grid", source))
})
