test_that("la publication SQL ne fait jamais partie du graphe ordinaire", {
  withr::local_dir(pkgload::pkg_path())
  withr::local_envvar(LUSK_PUBLISH_DB = "", LUSK_THEMES = "",
                     LUSK_MODE = "full")
  expect_false("publie_tables_service" %in% targets::tar_manifest()$name)
})

test_that("le leaf SQL attend les faits, la référence finale et les vintages", {
  withr::local_dir(pkgload::pkg_path())
  withr::local_envvar(LUSK_PUBLISH_DB = "1", LUSK_THEMES = "",
                     LUSK_MODE = "full")
  manifest <- targets::tar_manifest()
  command <- manifest$command[manifest$name == "publie_tables_service"]
  expect_length(command, 1L)
  expect_match(command, "publie_milieux", fixed = TRUE)
  expect_match(command, "publie_demographie", fixed = TRUE)
  expect_match(command, "publie_economie", fixed = TRUE)
  expect_match(command, "metadata_mobilite", fixed = TRUE)
  expect_match(command, "fusion_vintages", fixed = TRUE)
  expect_match(command, "publier_tables_service_depuis_parquet", fixed = TRUE)
})

test_that("un graphe sans Démographie ou en mode cron refuse l'opt-in DB", {
  withr::local_dir(pkgload::pkg_path())
  withr::local_envvar(LUSK_PUBLISH_DB = "1", LUSK_THEMES = "mobilite,economie",
                     LUSK_MODE = "full")
  expect_error(targets::tar_manifest(), "incluant les thèmes Mobilité, Économie/Emploi et Démographie")
  Sys.setenv(LUSK_THEMES = "mobilite", LUSK_MODE = "cron")
  expect_error(targets::tar_manifest(), "run local")
})
