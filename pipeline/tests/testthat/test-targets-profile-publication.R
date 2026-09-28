test_that("profile publication is opt-in and registered after canonical demography", {
  withr::local_dir(pkgload::pkg_path())
  withr::local_envvar(LUSK_PUBLISH_PROFILE = "", LUSK_THEMES = "", LUSK_MODE = "full")
  expect_false("publie_profile_structure_age" %in% targets::tar_manifest()$name)
  Sys.setenv(LUSK_PUBLISH_PROFILE = "1", LUSK_THEMES = "demographie")
  manifest <- targets::tar_manifest()
  command <- manifest$command[manifest$name == "publie_profile_structure_age"]
  expect_length(command, 1L)
  expect_match(command, "publie_demographie", fixed = TRUE)
  expect_match(command, "metadata_demographie", fixed = TRUE)
  expect_match(command, "publier_structure_age_profile_postgres", fixed = TRUE)
})

test_that("profile publication refuses cron and runs without the canonical theme", {
  withr::local_dir(pkgload::pkg_path())
  withr::local_envvar(LUSK_PUBLISH_PROFILE = "1", LUSK_THEMES = "habitat", LUSK_MODE = "full")
  expect_error(targets::tar_manifest(), "incluant Démographie")
  Sys.setenv(LUSK_THEMES = "demographie", LUSK_MODE = "cron")
  expect_error(targets::tar_manifest(), "incluant Démographie")
})
