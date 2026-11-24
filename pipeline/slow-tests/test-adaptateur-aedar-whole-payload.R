# Slow tier (#1172): full 235-TYPEQU AEDAR artefact projection, DB-write and two-split version contracts.
# Subject files: pipeline/R/adaptateur_aedar.R, pipeline/R/aedar_aggregates.R, pipeline/tests/testthat/helper-adaptateurs-formes.R
# Run explicitly with testthat::test_file(..., package="lusk") from pipeline/.

local({
  withr::local_dir(file.path(pkgload::pkg_path(), "tests", "testthat"))
  for (helper in list.files(file.path(pkgload::pkg_path(), "tests", "testthat"), pattern = "^helper.*\\.R$", full.names = TRUE)) source(helper, local = environment())

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
  capture <- adaptateur_aedar_con(function(con) remplacer_aedar(con, "aedar", rows, rows$version,
    reference_content_version = "reference-v1",
    reference_rows = adaptateur_aedar_reference_rows(FALSE)))

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
  capture <- adaptateur_aedar_con(function(con) remplacer_aedar(con, "aedar", rows, rows$version,
    reference_content_version = "reference-v1",
    reference_rows = adaptateur_aedar_reference_rows(TRUE)))
  expect_true("aedar_littoral_summary" %in% capture$writes)
  expect_false(any(grepl("FROM territory_reference", capture$queries)))
})

test_that("two splits of identical AEDAR inputs give one artefact version despite generation paths", {
  dir1 <- tempfile("aedar-split-a-"); dir2 <- tempfile("aedar-split-b-")
  on.exit(unlink(c(dir1, dir2), recursive = TRUE), add = TRUE)
  projection <- adaptateur_aedar_projection()
  source <- adaptateur_aedar_density_source()
  refs <- adaptateur_aedar_reference_rows(FALSE)
  reference <- list(rows = refs, content_version = "reference-v1")
  m1 <- project_aedar_comparison_publication(projection, source, refs,
    reference_content_version = "reference-v1", directory = dir1)
  m2 <- project_aedar_comparison_publication(projection, source, refs,
    reference_content_version = "reference-v1", directory = dir2)
  # The realistic manifest carries tempfile() generation paths, and they differ
  # between two independent splits of the SAME inputs.
  manifeste1 <- read_aedar_comparison_canonical(dir1, verify_parts = FALSE)
  manifeste2 <- read_aedar_comparison_canonical(dir2, verify_parts = FALSE)
  expect_true(grepl("generations/", manifeste1$density_class_summaries$path))
  expect_false(identical(manifeste1$density_class_summaries$path,
                         manifeste2$density_class_summaries$path))
  # The paths are read to find the Parquets but never stored in the artefact.
  c1 <- comparaison_aedar_pour_artefact(dir1, reference)
  c2 <- comparaison_aedar_pour_artefact(dir2, reference)
  expect_false("path" %in% names(c1$density_class_summaries))
  expect_false("path" %in% names(c1$littoral_summaries %||% list()))
  contenu <- function(comparaison) contenu_artefact(
    faits_forme(REGISTRE_FORMES_RESSOURCE[["aedar"]], projection),
    list(indicator_id = "aedar", theme_id = "mobilite"), projection$source, comparaison)
  expect_identical(version_artefact(contenu(c1)), version_artefact(contenu(c2)))
})

})
