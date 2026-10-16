test_that("la publication SQL ne fait jamais partie du graphe ordinaire", {
  withr::local_dir(pkgload::pkg_path())
  withr::local_envvar(LUSK_PUBLISH_DB = "", LUSK_THEMES = "",
                     LUSK_MODE = "full")
  expect_false("publie_backend_retained" %in% targets::tar_manifest()$name)
})

test_that("le leaf SQL attend les faits, la référence finale et les vintages", {
  withr::local_dir(pkgload::pkg_path())
  withr::local_envvar(LUSK_PUBLISH_DB = "1", LUSK_THEMES = "",
                     LUSK_MODE = "full")
  manifest <- targets::tar_manifest()
  command <- manifest$command[manifest$name == "publie_backend_retained"]
  expect_length(command, 1L)
  for (owner in retained_scalar_artifact_owners())
    expect_match(command, paste0("publie_", owner), fixed = TRUE)
  expect_match(command, "fusion_vintages", fixed = TRUE)
  expect_match(command, "scalar_serving_artifacts", fixed = TRUE)
  expect_match(command, "typed_reading_serving_artifacts", fixed = TRUE)
  expect_match(command, "publish_retained_backend_from_parquet", fixed = TRUE)
  expect_false(grepl("service_registry|building_ramp|essential_service_access|bpe_profile", command))
})

test_that("le grain de lecture typé est bâti par thème depuis le payload en mémoire", {
  withr::local_dir(pkgload::pkg_path())
  withr::local_envvar(LUSK_PUBLISH_DB = "", LUSK_THEMES = "", LUSK_MODE = "full")
  manifest <- targets::tar_manifest()
  command <- manifest$command[manifest$name == "typed_reading_serving_artifacts"]
  expect_length(command, 1L)
  expect_match(command, "materialize_theme_typed_reading_artifacts", fixed = TRUE)
  expect_match(command, "fusion_vintages", fixed = TRUE)
  # Une lecture est projetée UNE fois, depuis le payload publié du thème : aucun
  # Parquet de thème ne participe à cette matérialisation.
  expect_match(command, "publie_mobilite", fixed = TRUE)
  expect_match(command, "metadata_mobilite", fixed = TRUE)
  expect_false(grepl("histoires_", command, fixed = TRUE))
})

test_that("un graphe sans Démographie ou Habitat ou en mode cron refuse l'opt-in DB", {
  withr::local_dir(pkgload::pkg_path())
  withr::local_envvar(LUSK_PUBLISH_DB = "1", LUSK_THEMES = "mobilite,economie",
                     LUSK_MODE = "full")
  expect_error(targets::tar_manifest(), "couvrant tous les propriétaires scalaires déclarés")
  Sys.setenv(LUSK_THEMES = "mobilite", LUSK_MODE = "cron")
  expect_error(targets::tar_manifest(), "run local")
})

test_that("le leaf SQL refuse séparément un run sans faits canonique Mobilité", {
  withr::local_dir(pkgload::pkg_path())
  withr::local_envvar(LUSK_PUBLISH_DB = "1", LUSK_THEMES = "economie,demographie",
                     LUSK_MODE = "full")
  expect_error(targets::tar_manifest(),
    "couvrant tous les propriétaires scalaires déclarés")
})

test_that("le leaf scalaire refuse séparément un run sans Habitat", {
  withr::local_dir(pkgload::pkg_path())
  withr::local_envvar(LUSK_PUBLISH_DB="1", LUSK_THEMES="mobilite,economie,demographie",
                      LUSK_MODE="full")
  expect_error(targets::tar_manifest(), "couvrant tous les propriétaires scalaires déclarés")
})
