fake_postgres <- function(markers = list(), fail = FALSE) {
  e <- new.env(parent = emptyenv())
  e$markers <- markers
  e$log <- character()
  record <- function(x) e$log <- c(e$log, x)
  list(
    state = e,
    db = list(
      transaction = function(expr) {
        before <- e$log; old <- e$markers
        tryCatch(force(expr), error = function(err) {
          e$log <- before; e$markers <- old; stop(err)
        })
      },
      marker = function(n) e$markers[[n]] %||% data.frame(),
      delete_table = function(n) record(paste("delete", n)),
      insert_table = function(n, d) {
        record(paste("insert", n))
        if (fail) stop("injected failure")
      },
      upsert_shared = function(n, d) record(paste("upsert", n)),
      delete_stale = function(n, d) record(paste("prune", n)),
      save_marker = function(n, v, count) {
        record(paste("marker", n))
        e$markers[[n]] <- data.frame(content_version = v, row_count = count)
      },
      save_scope = function(s) record("scope"),
      assert_current = function(n) record("assert-current"),
      assert_buildings = function(r, g) record("assert-buildings")
    )
  )
}

`%||%` <- function(x, y) if (is.null(x)) y else x
fake_tables <- function() setNames(rep(list(data.frame(x = 1L)), 5L),
  .tables_postgres_autorisees)
fake_versions <- function() setNames(rep("v1", 5L), .tables_postgres_autorisees)
fake_scope <- list(kind = "communes-bretagne", label = "Communes bretonnes")
all_markers <- function(version = "v1") setNames(lapply(.tables_postgres_autorisees,
  function(n) data.frame(content_version = version, row_count = 1L)),
  .tables_postgres_autorisees)

test_that("aucune écriture quand les sept versions sont à jour", {
  f <- fake_postgres(all_markers())
  .publier_tables_postgres_impl(fake_tables(), fake_versions(), fake_scope, f$db)
  expect_length(f$state$log, 0L)
})

test_that("une rampe seule est remplacée", {
  markers <- all_markers(); markers$building_ramp$content_version <- "v0"
  f <- fake_postgres(markers)
  .publier_tables_postgres_impl(fake_tables(), fake_versions(), fake_scope, f$db)
  expect_true("delete building_ramp" %in% f$state$log)
  expect_true("insert building_ramp" %in% f$state$log)
  expect_false(any(grepl("delete (territory_reference|service_registry|building_grid)", f$state$log)))
  expect_identical(f$state$log[grepl("^marker ", f$state$log)], "marker building_ramp")
})

test_that("un marqueur en retard republie même si le fichier est inchangé", {
  markers <- all_markers(); markers$building_grid$content_version <- "old-db"
  f <- fake_postgres(markers)
  .publier_tables_postgres_impl(fake_tables(), fake_versions(), fake_scope, f$db)
  expect_true("insert building_grid" %in% f$state$log)
})

test_that("une erreur annule la transaction et les marqueurs", {
  markers <- all_markers(); markers$building_ramp$content_version <- "v0"
  f <- fake_postgres(markers, fail = TRUE)
  expect_error(.publier_tables_postgres_impl(fake_tables(), fake_versions(), fake_scope, f$db),
               "injected failure")
  expect_identical(f$state$log, character())
  expect_identical(f$state$markers$building_ramp$content_version, "v0")
})

test_that("une référence seule est upsertée sans supprimer les faits inchangés", {
  markers <- all_markers(); markers$territory_reference$content_version <- "v0"
  f <- fake_postgres(markers)
  .publier_tables_postgres_impl(fake_tables(), fake_versions(), fake_scope, f$db)
  expect_true("upsert territory_reference" %in% f$state$log)
  expect_true("prune territory_reference" %in% f$state$log)
  expect_false(any(grepl("^delete (essential_service_access|building_ramp|building_grid)$",
                         f$state$log)))
  expect_true("assert-current" %in% f$state$log)
  expect_true("assert-buildings" %in% f$state$log)
})

test_that("l'interface publique exige les cinq projections et le scope", {
  expect_error(publier_tables_postgres(NULL, list(unknown = data.frame()), character(), list()),
               "cinq projections")
})

test_that("le leaf SQL exige un passfile privé mais accepte l'hôte distant", {
  withr::local_envvar(
    LUSK_PUBLISH_HOST = "pi.example", LUSK_PUBLISH_PORT = "15432",
    LUSK_PUBLISH_DATABASE = "test", LUSK_PUBLISH_USER = "publisher",
    PGPASSFILE = tempfile()
  )
  expect_error(configuration_service_postgres(), "passfile")
  passfile <- tempfile()
  writeLines("not-a-secret", passfile)
  Sys.setenv(PGPASSFILE = passfile)
  expect_identical(configuration_service_postgres()$host, "pi.example")
})
