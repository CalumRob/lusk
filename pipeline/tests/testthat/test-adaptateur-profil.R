# Declared-profile shape adapter — ADR-0049 step 2 (#1138). `projeter` and
# `remplacer` are FIELDS of REGISTRE_FORMES_RESSOURCE$declared_profile. The
# adapter replaces ONE profile's descriptor, axes, facts, provenance and
# comparison using the SHARED per-table writers of publish_profile.R, and binds
# required_scalar_version to the dependency's RESOURCE version at apply time.

test_that("declared-profile adapter is a field of the shape registry", {
  handler <- REGISTRE_FORMES_RESSOURCE[["declared_profile"]]
  expect_true(is.function(handler$projeter))
  expect_true(is.function(handler$remplacer))
  expect_identical(handler$projeter, projeter_artefact_profil_declare)
  expect_identical(handler$remplacer, remplacer_profil_declare)
})

test_that("projeter keeps only this profile's grains and its declared dependency", {
  fx <- artefacts_fixture_profile_artefact()
  on.exit(unlink(fx$root, recursive = TRUE), add = TRUE)
  rows <- projeter_artefact_profil_declare(fx$artefact)
  expect_identical(rows$ressource, "distribution_dpe")
  expect_identical(rows$forme, "declared_profile")
  expect_identical(rows$version, fx$version)
  expect_identical(rows$descriptor$comparison_scalar, "part_passoires")
  expect_identical(rows$descriptor$required_scalar_version, "part-passoires-v1")
  expect_true(all(as.character(rows$facts$territory_id) %in% c("c1", "c2")))
  expect_true(all(as.character(rows$provenance$indicator_id) == "distribution_dpe"))
  expect_true(all(as.character(rows$comparison$groups$indicator_id) == "distribution_dpe"))
  for (col in c("indicator_id", "theme_id", "label", "unit", "levels",
                "completeness", "descriptor_version", "comparison_scalar",
                "required_scalar_version", "source"))
    expect_true(col %in% names(rows$descriptor), info = col)
  for (col in c("source_id", "vintage_id", "version", "reference_date", "publication_date"))
    expect_true(col %in% names(rows$vintages), info = col)
})

test_that("projeter refuses a non-profile artefact", {
  fx <- artefacts_fixture_profile_artefact()
  on.exit(unlink(fx$root, recursive = TRUE), add = TRUE)
  artefact <- fx$artefact
  artefact$forme <- "scalar"
  expect_error(projeter_artefact_profil_declare(artefact), "declared_profile")
})

test_that("remplacer scopes writes to one profile, rebinds the scalar version and spares global markers", {
  fx <- artefacts_fixture_profile_artefact()
  on.exit(unlink(fx$root, recursive = TRUE), add = TRUE)
  rows <- projeter_artefact_profil_declare(fx$artefact)
  executes <- character(); writes <- character(); params_vus <- list()
  appels <- list()
  local_mocked_bindings(
    dbWithTransaction = function(con, expr) force(expr),
    dbExecute = function(con, sql, params = list()) {
      executes <<- c(executes, sql)
      params_vus[[length(params_vus) + 1L]] <<- params
      appels[[length(appels) + 1L]] <<- list(sql = sql, params = params)
      0L
    },
    dbWriteTable = function(con, name, value, ...) {
      writes <<- c(writes, name); nrow(value)
    },
    dbGetQuery = function(con, sql, params = list()) {
      if (grepl("FROM resource_publication WHERE resource_id", sql, fixed = TRUE))
        return(data.frame(content_version = "part-passoires-v7"))
      if (grepl("count\\(\\*\\) AS n FROM profile_observation", sql)) return(data.frame(n = 4L))
      data.frame()
    },
    dbQuoteString = function(con, x) paste0("'", gsub("'", "''", as.character(x)), "'"),
    .package = "DBI")
  remplacer_profil_declare(structure(list(), class = "mock"), "distribution_dpe",
    rows, rows$version, artefacts = NULL)

  deletes <- executes[grepl("^DELETE", executes)]
  expect_true(length(deletes) >= 7L)
  expect_true(all(grepl("\\$1", deletes)))
  expect_false(any(grepl("DELETE FROM profile_observation$", deletes)))
  # The descriptor carries the REBOUND resource version, not the build-time
  # global scalar token.
  desc <- appels[vapply(appels, function(x)
    grepl("INSERT INTO profile_descriptor\\(", x$sql), logical(1))]
  expect_length(desc, 1L)
  expect_true("part-passoires-v7" %in% unlist(desc[[1]]$params))
  expect_false("part-passoires-v1" %in% unlist(desc[[1]]$params))
  # Per-resource comparison marker + registry row written; no global marker.
  expect_true(any(grepl("INSERT INTO profile_resource_comparison_publication", executes)))
  expect_true(any(grepl("INSERT INTO resource_publication", executes)))
  global <- c("table_publication", "profile_comparison_publication")
  for (g in global)
    expect_false(any(grepl(paste0("(DELETE FROM|INSERT INTO|UPDATE) ", g, "\\b"),
                           executes, perl = TRUE)))
  expect_true(all(c("profile_axis", "profile_observation",
                    "profile_observation_source", "profile_comparison_group",
                    "profile_comparison_territory", "comparison_source_lineage") %in% writes))
  # Real SQL-building path: only UNNAMED positional DBI params.
  expect_true(all(vapply(params_vus, function(p) is.null(p) || length(p) == 0L ||
    is.null(names(p)) || all(names(p) == ""), logical(1))))
})

test_that("remplacer prefers the closure artefact version over the live registry", {
  fx <- artefacts_fixture_profile_artefact()
  on.exit(unlink(fx$root, recursive = TRUE), add = TRUE)
  rows <- projeter_artefact_profil_declare(fx$artefact)
  appels <- list()
  local_mocked_bindings(
    dbWithTransaction = function(con, expr) force(expr),
    dbExecute = function(con, sql, params = list()) {
      appels[[length(appels) + 1L]] <<- list(sql = sql, params = params); 0L
    },
    dbWriteTable = function(con, name, ...) 0L,
    dbGetQuery = function(con, sql, params = list()) {
      if (grepl("FROM resource_publication WHERE resource_id", sql, fixed = TRUE))
        stop("the live registry must NOT be read when the closure carries the version")
      if (grepl("count\\(\\*\\)", sql)) return(data.frame(n = 4L))
      data.frame()
    },
    dbQuoteString = function(con, x) paste0("'", as.character(x), "'"),
    .package = "DBI")
  artefacts <- list(part_passoires = list(version = "part-passoires-v9"))
  remplacer_profil_declare(structure(list(), class = "mock"), "distribution_dpe",
    rows, rows$version, artefacts = artefacts)
  desc <- appels[vapply(appels, function(x)
    grepl("INSERT INTO profile_descriptor\\(", x$sql), logical(1))]
  expect_true("part-passoires-v9" %in% unlist(desc[[1]]$params))
})

test_that("remplacer refuses a missing scalar dependency with a named reason", {
  fx <- artefacts_fixture_profile_artefact()
  on.exit(unlink(fx$root, recursive = TRUE), add = TRUE)
  rows <- projeter_artefact_profil_declare(fx$artefact)
  writes <- 0L
  local_mocked_bindings(
    dbWithTransaction = function(con, expr) force(expr),
    dbExecute = function(con, sql, params = list()) { writes <<- writes + 1L; 0L },
    dbWriteTable = function(con, name, ...) 0L,
    dbGetQuery = function(con, sql, params = list()) data.frame(),
    dbQuoteString = function(con, x) paste0("'", as.character(x), "'"),
    .package = "DBI")
  err <- tryCatch(remplacer_profil_declare(structure(list(), class = "mock"),
    "distribution_dpe", rows, rows$version), error = identity)
  expect_s3_class(err, "error")
  expect_match(conditionMessage(err), "scalar dependency")
  expect_identical(writes, 0L)
})

test_that("remplacer --retire removes only this profile and keeps the registry receipt", {
  executes <- character()
  local_mocked_bindings(
    dbWithTransaction = function(con, expr) force(expr),
    dbExecute = function(con, sql, params = list()) { executes <<- c(executes, sql); 0L },
    dbWriteTable = function(con, name, ...) 0L,
    dbGetQuery = function(con, sql, params = list()) data.frame(),
    .package = "DBI")
  remplacer_profil_declare(structure(list(), class = "mock"), "distribution_dpe",
    retire = TRUE, version = "v1")
  expect_true(all(grepl("^DELETE", executes[grepl("^DELETE", executes)])))
  expect_false(any(grepl("INSERT INTO profile_descriptor|INSERT INTO profile_observation",
                         executes)))
  expect_true(any(grepl("INSERT INTO resource_publication", executes)))
  expect_true(any(grepl("retired=EXCLUDED.retired", executes)))
})
