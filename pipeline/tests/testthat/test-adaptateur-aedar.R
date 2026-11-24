# AEDAR shape adapter (#1139). One resource, one transaction, comparison bound
# to the artefact — never read from the live territory_reference.

adaptateur_aedar_con <- function(fn) {
  executes <- character(); writes <- character(); queries <- character()
  local_mocked_bindings(
    dbWithTransaction = function(con, expr) force(expr),
    dbExecute = function(con, sql, params = list()) {
      executes <<- c(executes, sql); 1L
    },
    dbWriteTable = function(con, name, value, ...) {
      writes <<- c(writes, name); nrow(value)
    },
    dbGetQuery = function(con, sql, params = NULL, ...) {
      queries <<- c(queries, sql)
      if (grepl("aedar_territory_summary", sql)) return(data.frame())
      if (grepl("aedar_comparison_publication WHERE singleton", sql)) return(data.frame())
      if (grepl("aedar_territorial_aggregate", sql)) return(data.frame())
      if (grepl("FROM source_vintage WHERE", sql))
        return(data.frame(version = "2026-v1", reference_date = as.Date(NA),
                          publication_date = as.Date("2026-09-30")))
      data.frame()
    },
    .package = "DBI")
  anomalie <- tryCatch(fn(structure(list(), class = "mock")), error = identity)
  if (inherits(anomalie, "error")) stop(anomalie)
  list(result = anomalie, executes = executes, writes = writes, queries = queries)
}

test_that("AEDAR adapter is a field of the shape registry", {
  handler <- REGISTRE_FORMES_RESSOURCE[["aedar"]]
  expect_true(is.function(handler$projeter))
  expect_true(is.function(handler$remplacer))
  expect_identical(handler$projeter, projeter_artefact_aedar)
  expect_identical(handler$remplacer, remplacer_aedar)
})

test_that("remplacer binds the AEDAR aggregate marker to the artefact comparison token", {
  # publish_aedar_aggregates() writes the aedar_territorial_aggregate marker
  # (table_publication.content_version) from `version`, while
  # ecrire_aedar_comparaison_rows() writes aedar_comparison_publication.
  # aedar_content_version from the artefact comparison's own field. Both must
  # be the SAME artefact token; the whole-artefact version is a different one.
  comparaison <- list(aedar_content_version = "facts-v7",
    reference_content_version = "reference-v1", groups = data.frame(),
    density_rows = NULL, littoral_rows = NULL)
  rows <- list(ressource = "aedar", forme = "aedar", version = "artefact-v9",
    projection = list(facts = data.frame()), comparison = comparaison,
    declarations = list())
  vu_version <- NULL; vu_comparaison <- NULL
  local_mocked_bindings(
    publish_aedar_aggregates = function(projection, con, ..., version) {
      vu_version <<- version; invisible(TRUE)
    },
    ecrire_aedar_comparaison_rows = function(con, x, ...) {
      vu_comparaison <<- x; invisible(TRUE)
    },
    ecrire_registre_ressource = function(...) invisible(TRUE),
    ecrire_descripteurs_ressource = function(...) invisible(TRUE))
  capture <- adaptateur_aedar_con(function(con)
    remplacer_aedar(con, "aedar", rows, rows$version,
      reference_content_version = "reference-v1",
      reference_rows = adaptateur_reference_rows()))
  expect_identical(vu_version, comparaison$aedar_content_version)
  expect_identical(vu_comparaison$aedar_content_version, vu_version)
  expect_false(identical(vu_version, rows$version))
})

test_that("remplacer --retire removes AEDAR rows and marks the registry retired", {
  capture <- adaptateur_aedar_con(function(con)
    remplacer_aedar(con, "aedar", retire = TRUE, version = "v1"))
  expect_true(all(grepl("^DELETE", capture$executes[grepl("^DELETE", capture$executes)])))
  expect_true(any(grepl("INSERT INTO resource_publication", capture$executes)))
  expect_true(any(grepl("retired=EXCLUDED.retired", capture$executes)))
})
