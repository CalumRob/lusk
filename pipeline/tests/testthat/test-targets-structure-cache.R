# The targets graph is a structural fixture, not a per-test rebuild (#1172).

test_that("one memoised manifest serves each effective graph environment", {
  projet <- tempfile("graphe-cache-manifeste-")
  dir.create(projet)
  on.exit(unlink(projet, recursive = TRUE), add = TRUE)
  writeLines("list()", file.path(projet, "_targets.R"))
  withr::local_dir(projet)
  withr::local_envvar(
    LUSK_THEMES = "", LUSK_MODE = "full", LUSK_PUBLISH_DB = "",
    LUSK_PUBLISH_PROFILE = "", LUSK_SCALAR_SCOPE = "",
    LUSK_CACHE = tempfile("cache-appelant-"),
    LUSK_SORTIE = tempfile("sortie-appelant-")
  )

  appels <- 0L
  local_mocked_bindings(
    tar_manifest = function(callr_function = NULL, ...) {
      expect_null(callr_function)
      appels <<- appels + 1L
      data.frame(name = c("a", "b"), command = c("a()", "b()"),
                 stringsAsFactors = FALSE)
    },
    .package = "targets"
  )

  premier <- manifeste_graphe()
  second <- manifeste_graphe(noms = "a")
  expect_identical(second$name, "a")
  expect_identical(appels, 1L)

  # Caller-owned temporary paths do not change dependency structure. The
  # helper owns isolated paths, while a real selection change is a new key.
  withr::local_envvar(
    LUSK_CACHE = tempfile("autre-cache-"),
    LUSK_SORTIE = tempfile("autre-sortie-")
  )
  expect_identical(manifeste_graphe()$name, premier$name)
  expect_identical(appels, 1L)

  withr::local_envvar(LUSK_THEMES = "economie")
  expect_identical(manifeste_graphe()$name, premier$name)
  expect_identical(appels, 2L)
})

test_that("a structural read restores targets options changed by _targets.R", {
  projet <- tempfile("graphe-cache-options-")
  dir.create(projet)
  on.exit(unlink(projet, recursive = TRUE), add = TRUE)
  writeLines("list()", file.path(projet, "_targets.R"))
  withr::local_dir(projet)
  withr::local_envvar(
    LUSK_THEMES = "", LUSK_MODE = "full", LUSK_PUBLISH_DB = "",
    LUSK_PUBLISH_PROFILE = "", LUSK_SCALAR_SCOPE = ""
  )
  targets::tar_option_with({
    targets::tar_option_set(imports = "before_structural_read")
    local_mocked_bindings(
      tar_manifest = function(callr_function = NULL, ...) {
        targets::tar_option_set(imports = "changed_by_targets_script")
        data.frame(name = "a", command = "a()", stringsAsFactors = FALSE)
      },
      .package = "targets"
    )
    manifeste_graphe()
    expect_identical(targets::tar_option_get("imports"), "before_structural_read")
  })
})

test_that("one memoised network uses an isolated store and reuses it", {
  projet <- tempfile("graphe-cache-reseau-")
  dir.create(projet)
  on.exit(unlink(projet, recursive = TRUE), add = TRUE)
  writeLines("list()", file.path(projet, "_targets.R"))
  withr::local_dir(projet)
  withr::local_envvar(
    LUSK_THEMES = "", LUSK_MODE = "full", LUSK_PUBLISH_DB = "",
    LUSK_PUBLISH_PROFILE = "", LUSK_SCALAR_SCOPE = ""
  )

  appels <- 0L
  local_mocked_bindings(
    tar_network = function(store, callr_function = NULL, ...) {
      expect_null(callr_function)
      appels <<- appels + 1L
      expect_false(identical(normalizePath(store, mustWork = FALSE),
                             normalizePath(file.path(projet, "_targets"),
                                           mustWork = FALSE)))
      list(vertices = data.frame(name = "a", type = "stem"),
           edges = data.frame(from = "a", to = "b"))
    },
    .package = "targets"
  )

  premier <- reseau_graphe()
  second <- reseau_graphe()
  expect_identical(second, premier)
  expect_identical(appels, 1L)
  expect_match(attr(premier, "store_structure"), "graphe-structure-")
})
