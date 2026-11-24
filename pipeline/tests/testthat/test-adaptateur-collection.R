# Observed-collection shape adapter (#1139). Registry fields, per-collection
# projection and the real SQL-building path up to the DBI boundary.

test_that("observed-collection adapter is a field of the shape registry", {
  handler <- REGISTRE_FORMES_RESSOURCE[["observed_collection"]]
  expect_true(is.function(handler$projeter))
  expect_true(is.function(handler$remplacer))
  expect_identical(handler$projeter, projeter_artefact_collection)
  expect_identical(handler$remplacer, remplacer_collection)
})

test_that("projeter rebuilds only the resource's collection projection", {
  root <- artefacts_fixture_root()
  on.exit(unlink(root, recursive = TRUE), add = TRUE)
  artefact <- adaptateur_collection_artefact(root)
  rows <- projeter_artefact_collection(artefact)
  expect_identical(rows$ressource, "acv")
  expect_identical(rows$forme, "observed_collection")
  expect_identical(rows$version, artefact$version)
  expect_identical(rows$projection$descriptor$indicator_id, "acv")
  expect_true(all(rows$projection$facts$indicator_id == "acv"))
  expect_true(all(rows$projection$categories$indicator_id == "acv"))
  expect_identical(rows$reference_content_version, "reference-v1")
})

adaptateur_collection_con <- function(fn) {
  executes <- character(); writes <- character(); params_vus <- list()
  reference <- artefacts_fixture_reference()
  ref_rows <- cbind(reference$rows,
    littoral_code = rep(NA_character_, nrow(reference$rows)),
    littoral_classement_source = rep(NA_character_, nrow(reference$rows)),
    stringsAsFactors = FALSE)
  local_mocked_bindings(
    dbWithTransaction = function(con, expr) force(expr),
    dbExecute = function(con, sql, params = list()) {
      executes <<- c(executes, sql)
      params_vus[[length(params_vus) + 1L]] <<- params
      1L
    },
    dbWriteTable = function(con, name, value, ...) {
      writes <<- c(writes, name); nrow(value)
    },
    dbGetQuery = function(con, sql, params = NULL, ...) {
      if (grepl("table_name='territory_reference'", sql))
        return(data.frame(content_version = "reference-v1", stringsAsFactors = FALSE))
      if (grepl("FROM territory_reference", sql)) return(ref_rows)
      if (grepl("FROM source_vintage WHERE", sql))
        return(data.frame(version = "v1", reference_date = as.Date("2023-01-01"),
                          publication_date = as.Date("2024-01-01"), stringsAsFactors = FALSE))
      data.frame()
    },
    .package = "DBI")
  anomalie <- tryCatch(fn(structure(list(), class = "mock")), error = identity)
  if (inherits(anomalie, "error")) stop(anomalie)
  list(result = anomalie, executes = executes, writes = writes, params = params_vus)
}

test_that("remplacer writes only this collection and the registry row", {
  root <- artefacts_fixture_root()
  on.exit(unlink(root, recursive = TRUE), add = TRUE)
  artefact <- adaptateur_collection_artefact(root)
  rows <- projeter_artefact_collection(artefact)
  local_mocked_bindings(project_observed_collection_comparisons = function(...)
    stop("collection writer must persist the artefact comparison, not recompute it"))
  capture <- adaptateur_collection_con(function(con)
    remplacer_collection(con, "acv", rows, rows$version,
                         reference_content_version = rows$reference_content_version,
                         reference_rows = adaptateur_reference_rows()))

  executes <- capture$executes
  deletes <- executes[grepl("^DELETE", executes)]
  expect_true(length(deletes) >= 2L)
  expect_true(all(grepl("WHERE indicator_id=\\$1|WHERE publication_resource_id=\\$1", deletes)))
  # Storage marker + comparison marker + registry row, all for this collection.
  expect_true(any(grepl("INSERT INTO observed_collection_publication", executes)))
  expect_true(any(grepl("INSERT INTO observed_collection_comparison_publication", executes)))
  expect_true(any(grepl("INSERT INTO resource_publication", executes)))
  expect_true(all(c("observed_collection_category", "period_detail_observation",
                    "observed_collection_comparison_group",
                    "observed_collection_comparison_territory") %in% capture$writes))
  expect_true(all(vapply(capture$params, function(p) is.null(p) || length(p) == 0L ||
    is.null(names(p)) || all(names(p) == ""), logical(1))))
})

test_that("remplacer --retire removes only this collection and marks registry retired", {
  capture <- adaptateur_collection_con(function(con)
    remplacer_collection(con, "acv", retire = TRUE, version = "v1"))
  executes <- capture$executes
  expect_true(all(grepl("^DELETE", executes[grepl("^DELETE", executes)])))
  expect_false(any(grepl("INSERT INTO observed_collection_publication", executes)))
  expect_true(any(grepl("INSERT INTO resource_publication", executes)))
  expect_true(any(grepl("retired=EXCLUDED.retired", executes)))
})
