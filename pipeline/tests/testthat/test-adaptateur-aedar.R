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

test_that("remplacer --retire removes AEDAR rows and marks the registry retired", {
  capture <- adaptateur_aedar_con(function(con)
    remplacer_aedar(con, "aedar", retire = TRUE, version = "v1"))
  expect_true(all(grepl("^DELETE", capture$executes[grepl("^DELETE", capture$executes)])))
  expect_true(any(grepl("INSERT INTO resource_publication", capture$executes)))
  expect_true(any(grepl("retired=EXCLUDED.retired", capture$executes)))
})
