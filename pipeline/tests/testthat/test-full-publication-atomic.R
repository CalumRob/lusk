# #1126 — the full (unscoped) retained publication must behave exactly like the
# scoped path: metadata-only refresh of the DPE binding, an advisory lock, then
# reference -> scalar -> declared profiles -> OCS-GE state series in ONE outer
# transaction, restoring the profile artifacts on failure. The guarded
# PostgreSQL proof lives in the guarded adoption suite; these
# mocked tests lock the contract into the ordinary fixture suite.

full_publication_sortie <- function() {
  sortie <- tempfile("full-publication-")
  dir.create(file.path(sortie, "scalar-serving"), recursive = TRUE,
             showWarnings = FALSE)
  dir.create(file.path(sortie, "profile-serving", "distribution_dpe"),
             recursive = TRUE, showWarnings = FALSE)
  writeLines('{"binding":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}',
             file.path(sortie, "scalar-serving", "binding.json"))
  writeLines("profile facts", file.path(sortie, "profile-serving",
                                        "distribution_dpe", "facts.txt"))
  sortie
}

# Both sides of the cross-reference: the full branch CALLS the snapshot
# publisher with the atomic/companion flags, and that publisher DECLARES and
# HONOURS them. A future refactor that drops either side fails this test.
test_that("full-path flags are declared and honoured by the snapshot publisher", {
  root <- normalizePath(testthat::test_path("..", ".."))
  cfg <- paste(readLines(file.path(root, "R", "publish_postgres_configuration.R"),
                         warn = FALSE), collapse = "\n")
  snap <- paste(readLines(file.path(root, "R", "publish_retained_scalar_snapshot.R"),
                          warn = FALSE), collapse = "\n")
  branch <- sub("^.*\\} else \\{", "", cfg)
  expect_match(branch, "atomic=TRUE", fixed = TRUE)
  expect_match(branch, "companion_profiles=TRUE", fixed = TRUE)
  expect_match(branch, "refresh_declared_profile_scalar_binding", fixed = TRUE)
  expect_match(branch, "pg_advisory_lock\\(594, 1\\)")
  expect_match(snap, "atomic = FALSE", fixed = TRUE)
  expect_match(snap, "companion_profiles = FALSE", fixed = TRUE)
  expect_match(snap, "if \\(isTRUE\\(atomic\\)\\) with_publication_transaction")
  expect_match(snap, "if \\(isTRUE\\(companion_profiles\\)\\)")
})

test_that("the full path refreshes the binding and publishes atomically", {
  sortie <- full_publication_sortie()
  withr::defer(unlink(sortie, recursive = TRUE))
  new_binding <- "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
  recorded <- list(sql = character(), refresh = NULL, publish = NULL)
  con <- structure(list(id = "full"), class = "fake_full_pub_con")
  withr::local_envvar(LUSK_SCALAR_SCOPE = "", LUSK_SCALAR_BASELINE_SORTIE = "")
  testthat::local_mocked_bindings(
    verifier_gel_release = function(...) invisible(TRUE),
    configuration_service_postgres = function() list(host = "h", port = 5432L,
      dbname = "d", user = "u", passfile = "p"),
    project_territory_reference = function(...) list(rows = data.frame(),
      content_version = "ref"),
    project_retained_scalar_snapshot = function(...) list(scalar = list()),
    scalar_content_version = function(...) new_binding,
    refresh_declared_profile_scalar_binding = function(directory, owners, scalar_binding) {
      recorded$refresh <<- list(directory = directory, owners = owners,
                                scalar_binding = scalar_binding)
      # The real refresh rewrites the binding metadata; emulate it so the
      # finally-restoration can be observed on the failure case below.
      writeLines(sprintf('{"binding":"%s"}', scalar_binding),
                 file.path(directory, "scalar-serving", "binding.json"))
      invisible(character())
    },
    publish_retained_backend_snapshot = function(con, sortie,
                                                  atomic = FALSE, companion_profiles = FALSE) {
      recorded$publish <<- list(con = con, sortie = sortie,
                                atomic = atomic, companion_profiles = companion_profiles)
      invisible(NULL)
    }
  )
  testthat::local_mocked_bindings(
    dbConnect = function(...) con,
    dbGetQuery = function(con, sql, ...) {
      recorded$sql <<- c(recorded$sql, sql)
      if (grepl("to_regclass", sql, fixed = TRUE))
        return(data.frame(scalaire = TRUE, profil = TRUE))
      data.frame(v = 1L)
    },
    dbDisconnect = function(...) invisible(TRUE),
    .package = "DBI"
  )
  result <- publish_retained_backend_from_parquet(sortie)
  expect_null(result)
  expect_identical(recorded$refresh$directory, sortie)
  expect_identical(recorded$refresh$owners, declared_profile_owners())
  expect_identical(recorded$refresh$scalar_binding, new_binding)
  expect_identical(recorded$publish$sortie, sortie)
  expect_true(isTRUE(recorded$publish$atomic))
  expect_true(isTRUE(recorded$publish$companion_profiles))
  expect_true(any(grepl("pg_advisory_lock\\(594, 1\\)", recorded$sql)))
  expect_true(any(grepl("pg_advisory_unlock\\(594, 1\\)", recorded$sql)))
  # Success keeps the refreshed metadata.
  expect_identical(read_profile_scalar_binding(sortie), new_binding)
})

test_that("a failure mid-publication restores the pre-refresh profile artifact", {
  sortie <- full_publication_sortie()
  withr::defer(unlink(sortie, recursive = TRUE))
  original <- read_profile_scalar_binding(sortie)
  new_binding <- "cccccccccccccccccccccccccccccccc"
  con <- structure(list(id = "full-fail"), class = "fake_full_pub_con")
  withr::local_envvar(LUSK_SCALAR_SCOPE = "", LUSK_SCALAR_BASELINE_SORTIE = "")
  testthat::local_mocked_bindings(
    verifier_gel_release = function(...) invisible(TRUE),
    configuration_service_postgres = function() list(host = "h", port = 5432L,
      dbname = "d", user = "u", passfile = "p"),
    project_territory_reference = function(...) list(rows = data.frame(),
      content_version = "ref"),
    project_retained_scalar_snapshot = function(...) list(scalar = list()),
    scalar_content_version = function(...) new_binding,
    refresh_declared_profile_scalar_binding = function(directory, owners, scalar_binding) {
      writeLines(sprintf('{"binding":"%s"}', scalar_binding),
                 file.path(directory, "scalar-serving", "binding.json"))
      invisible(character())
    },
    publish_retained_backend_snapshot = function(...) stop("injected owner failure")
  )
  testthat::local_mocked_bindings(
    dbConnect = function(...) con,
    dbGetQuery = function(con, sql, ...) {
      if (grepl("to_regclass", sql, fixed = TRUE))
        return(data.frame(scalaire = TRUE, profil = TRUE))
      data.frame(v = 1L)
    },
    dbDisconnect = function(...) invisible(TRUE),
    .package = "DBI"
  )
  expect_error(publish_retained_backend_from_parquet(sortie), "injected owner failure")
  expect_identical(read_profile_scalar_binding(sortie), original)
})
