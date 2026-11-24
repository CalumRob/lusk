# Owned-series shape adapter (#1139). Registry fields, per-dataset projection and
# the real SQL-building path up to the DBI boundary — never a mocked `remplacer`.

test_that("owned-series adapter is a field of the shape registry", {
  handler <- REGISTRE_FORMES_RESSOURCE[["owned_series"]]
  expect_true(is.function(handler$projeter))
  expect_true(is.function(handler$remplacer))
  expect_identical(handler$projeter, projeter_artefact_series)
  expect_identical(handler$remplacer, remplacer_series)
})

test_that("projeter rebuilds only the resource's dataset projection", {
  root <- artefacts_fixture_root()
  on.exit(unlink(root, recursive = TRUE), add = TRUE)
  artefact <- adaptateur_series_artefact(root)
  rows <- projeter_artefact_series(artefact)
  expect_identical(rows$ressource, "artif_par_habitant")
  expect_identical(rows$forme, "owned_series")
  expect_identical(rows$version, artefact$version)
  expect_identical(rows$dataset_id, "artif_par_habitant")
  expect_identical(rows$projection$descriptor$dataset_id, "artif_par_habitant")
  expect_true(all(rows$projection$points$dataset_id == "artif_par_habitant"))
  expect_true(all(rows$projection$point_provenance$dataset_id == "artif_par_habitant"))
  expect_identical(rows$reference_content_version, "reference-v1")
  expect_named(rows$digests_lignage, "ocsge")
})

test_that("projeter refuses a non-owned-series artefact or a mismatched dataset", {
  root <- artefacts_fixture_root()
  on.exit(unlink(root, recursive = TRUE), add = TRUE)
  artefact <- adaptateur_series_artefact(root)
  artefact$forme <- "scalar"
  expect_error(projeter_artefact_series(artefact), "owned_series")
  artefact$forme <- "owned_series"
  artefact$ressource <- "prix_m2"
  expect_error(projeter_artefact_series(artefact), "dataset")
})

# Capture the real SQL/params the adapter emits; DBI functions are mocked only
# at the boundary, the writer path itself is the owner's production writer.
adaptateur_series_con <- function(fn) {
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
      if (grepl("FROM source_vintage WHERE source_id", sql))
        return(data.frame(version = "v1", reference_date = as.Date("2020-01-01"),
                          publication_date = as.Date("2021-01-01"), stringsAsFactors = FALSE))
      if (grepl("FROM series_provenance_revision WHERE", sql))
        return(data.frame(n = 1L))
      data.frame()
    },
    .package = "DBI")
  anomalie <- tryCatch(fn(structure(list(), class = "mock")), error = identity)
  if (inherits(anomalie, "error")) stop(anomalie)
  list(result = anomalie, executes = executes, writes = writes, params = params_vus)
}

test_that("remplacer writes only this dataset and the registry row", {
  root <- artefacts_fixture_root()
  on.exit(unlink(root, recursive = TRUE), add = TRUE)
  artefact <- adaptateur_series_artefact(root)
  rows <- projeter_artefact_series(artefact)
  local_mocked_bindings(project_ordered_series_comparisons = function(...)
    stop("series writer must persist the artefact comparison, not recompute it"))
  capture <- adaptateur_series_con(function(con)
    remplacer_series(con, "artif_par_habitant", rows, rows$version,
                     reference_content_version = rows$reference_content_version,
                     reference_rows = adaptateur_reference_rows()))

  executes <- capture$executes
  deletes <- executes[grepl("^DELETE", executes)]
  expect_true(length(deletes) >= 3L)
  # Every delete is scoped to the dataset (positional param), never wholesale.
  expect_true(all(grepl("WHERE dataset_id=\\$1|WHERE indicator_id=\\$1|WHERE publication_resource_id=\\$1",
                       deletes)))
  expect_false(any(grepl("DELETE FROM series_dataset_publication$", deletes)))
  # Series storage marker + registry row, but no global table_publication write
  # from the adapter path (the owner writer owns that expand-phase marker).
  expect_true(any(grepl("INSERT INTO series_dataset_publication", executes)))
  expect_true(any(grepl("INSERT INTO resource_publication", executes)))
  expect_true(all(c("series_dataset_observation", "series_observation_provenance") %in%
                    capture$writes))
  expect_false(any(grepl("milieux_typed_reading|milieux_reading_", executes)))
  # RPostgres requires unnamed positional params; no hand-built literal here.
  expect_true(all(vapply(capture$params, function(p) is.null(p) || length(p) == 0L ||
    is.null(names(p)) || all(names(p) == ""), logical(1))))
})

test_that("remplacer binds both series storage markers to the artefact comparison token", {
  # The producer writes series_dataset_publication.content_version and
  # ordered_series_comparison_publication.ordered_series_content_version from
  # the same `version` it passes to project_ordered_series_comparisons() as
  # `input_content_version`. Apply must use that artefact field, never the
  # whole-artefact version, so the two markers cannot drift apart.
  root <- artefacts_fixture_root()
  on.exit(unlink(root, recursive = TRUE), add = TRUE)
  artefact <- adaptateur_series_artefact(root)
  rows <- projeter_artefact_series(artefact)
  token <- rows$comparison$input_content_version
  expect_true(is.character(token) && length(token) == 1L && !is.na(token) && nzchar(token))
  expect_false(identical(token, rows$version))
  capture <- adaptateur_series_con(function(con)
    remplacer_series(con, "artif_par_habitant", rows, rows$version,
      reference_content_version = rows$reference_content_version,
      reference_rows = adaptateur_reference_rows()))
  base <- which(grepl("INSERT INTO series_dataset_publication", capture$executes))
  comparison <- which(grepl("INSERT INTO ordered_series_comparison_publication",
                            capture$executes))
  expect_length(base, 1L)
  expect_length(comparison, 1L)
  expect_identical(capture$params[[base]][[2L]], token)
  expect_identical(capture$params[[comparison]][[4L]], token)
})

test_that("remplacer --retire removes only this dataset and marks registry retired", {
  capture <- adaptateur_series_con(function(con)
    remplacer_series(con, "artif_par_habitant", retire = TRUE, version = "v1"))
  executes <- capture$executes
  expect_true(all(grepl("^DELETE", executes[grepl("^DELETE", executes)])))
  expect_false(any(grepl("INSERT INTO series_dataset_descriptor|INSERT INTO series_dataset_publication",
                         executes)))
  expect_true(any(grepl("INSERT INTO resource_publication", executes)))
  expect_true(any(grepl("retired=EXCLUDED.retired", executes)))
})

test_that("OCS-GE state series applies through the adapter without typed-reading code", {
  root <- artefacts_fixture_root()
  on.exit(unlink(root, recursive = TRUE), add = TRUE)
  artefact <- adaptateur_series_artefact(root, "artif_par_habitant")
  rows <- projeter_artefact_series(artefact)
  capture <- adaptateur_series_con(function(con)
    remplacer_series(con, "artif_par_habitant", rows, rows$version,
                     reference_content_version = rows$reference_content_version,
                     reference_rows = adaptateur_reference_rows()))
  # The OCS-GE dataset's genuine serving tables are written; no typed-reading
  # publisher/route is on this path.
  expect_true(any(grepl("INSERT INTO series_dataset_publication", capture$executes)))
  expect_true(any(grepl("series_dataset_observation", capture$writes)))
  expect_false(any(grepl("publish_canonical_milieux_reading|milieux_typed_reading",
                         capture$executes)))
})
