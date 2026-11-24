# AEDAR shape adapter (#1139). One resource, one transaction, comparison bound
# to the artefact — never read from the live territory_reference.

test_that("AEDAR adapter is a field of the shape registry", {
  handler <- REGISTRE_FORMES_RESSOURCE[["aedar"]]
  expect_true(is.function(handler$projeter))
  expect_true(is.function(handler$remplacer))
  expect_identical(handler$projeter, projeter_artefact_aedar)
  expect_identical(handler$remplacer, remplacer_aedar)
})

test_that("projeter carries the artefact-bound comparison and its summaries", {
  root <- artefacts_fixture_root()
  on.exit(unlink(root, recursive = TRUE), add = TRUE)
  artefact <- adaptateur_aedar_artefact(root)
  rows <- projeter_artefact_aedar(artefact)
  expect_identical(rows$ressource, "aedar")
  expect_identical(rows$forme, "aedar")
  expect_true(is.data.frame(rows$projection$facts))
  expect_identical(as.character(rows$comparison$reference_content_version), "reference-v1")
  expect_true(nrow(rows$comparison$groups) > 0L)
  expect_true(nrow(rows$comparison$density_rows) > 0L)
  expect_null(rows$comparison$littoral_rows)
})

test_that("projeter refuses an artefact without an artefact-bound comparison", {
  root <- artefacts_fixture_root()
  on.exit(unlink(root, recursive = TRUE), add = TRUE)
  artefact <- adaptateur_aedar_artefact(root)
  artefact$contenu$comparison <- NULL
  expect_error(projeter_artefact_aedar(artefact), "comparison")
})

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

test_that("remplacer writes aggregate, comparison, summaries and registry in one path", {
  root <- artefacts_fixture_root()
  on.exit(unlink(root, recursive = TRUE), add = TRUE)
  artefact <- adaptateur_aedar_artefact(root)
  rows <- projeter_artefact_aedar(artefact)
  capture <- adaptateur_aedar_con(function(con) remplacer_aedar(con, "aedar", rows, rows$version))

  expect_true(any(grepl("INSERT INTO aedar_territorial_aggregate", capture$executes)))
  expect_true(any(grepl("INSERT INTO aedar_comparison_publication", capture$executes)))
  expect_true(any(grepl("INSERT INTO resource_publication", capture$executes)))
  expect_true(all(c("aedar_comparison_group", "aedar_density_class_summary") %in% capture$writes))
  expect_false(any(grepl("aedar_littoral_summary", capture$writes)))
  # No live territory_reference read anywhere on the adapter path.
  expect_false(any(grepl("FROM territory_reference", capture$queries)))
})

test_that("remplacer publishes C/NC summaries when the artefact carries them", {
  root <- artefacts_fixture_root()
  on.exit(unlink(root, recursive = TRUE), add = TRUE)
  artefact <- adaptateur_aedar_artefact(root, with_littoral = TRUE)
  rows <- projeter_artefact_aedar(artefact)
  expect_true(nrow(rows$comparison$littoral_rows) > 0L)
  capture <- adaptateur_aedar_con(function(con) remplacer_aedar(con, "aedar", rows, rows$version))
  expect_true("aedar_littoral_summary" %in% capture$writes)
  expect_false(any(grepl("FROM territory_reference", capture$queries)))
})

test_that("remplacer --retire removes AEDAR rows and marks the registry retired", {
  capture <- adaptateur_aedar_con(function(con)
    remplacer_aedar(con, "aedar", retire = TRUE, version = "v1"))
  expect_true(all(grepl("^DELETE", capture$executes[grepl("^DELETE", capture$executes)])))
  expect_true(any(grepl("INSERT INTO resource_publication", capture$executes)))
  expect_true(any(grepl("retired=EXCLUDED.retired", capture$executes)))
})
