test_that("profile publication requires both opt-ins and the complete canonical theme set", {
  withr::local_dir(pkgload::pkg_path())
  withr::local_envvar(LUSK_PUBLISH_PROFILE = "", LUSK_PUBLISH_DB = "", LUSK_THEMES = "", LUSK_MODE = "full")
  expect_false("publie_profiles_declares" %in% targets::tar_manifest()$name)
  Sys.setenv(LUSK_PUBLISH_PROFILE = "1", LUSK_THEMES = "mobilite,economie,demographie,habitat")
  expect_error(targets::tar_manifest(), "LUSK_PUBLISH_DB=1")
  Sys.setenv(LUSK_PUBLISH_DB = "1")
  manifest <- targets::tar_manifest()
  command <- manifest$command[manifest$name == "publie_profiles_declares"]
  expect_length(command, 1L)
  expect_match(command, "publie_demographie", fixed = TRUE)
  expect_match(command, "publie_habitat", fixed = TRUE)
  expect_match(command, "publie_mobilite", fixed = TRUE)
  expect_match(command, "publie_tables_service", fixed = TRUE)
  expect_match(command, "profile_serving_artifacts", fixed = TRUE)
  expect_match(command, "publier_declared_profiles_postgres", fixed = TRUE)
})

test_that("profile publication target remains explicit in a complete local database run", {
  withr::local_dir(pkgload::pkg_path())
  withr::local_envvar(LUSK_PUBLISH_PROFILE = "1", LUSK_PUBLISH_DB="1", LUSK_THEMES = "mobilite,economie,demographie,habitat", LUSK_MODE = "full")
  manifest <- targets::tar_manifest()
  expect_true("publie_profiles_declares" %in% manifest$name)
})
