# Structural audits share one source-aware parse cache per R process (#1172).

test_that("every structural audit reuses one parse and parse-data walk per source file", {
  d <- tempfile("audit-parse-cache-")
  dir.create(file.path(d, "R"), recursive = TRUE)
  on.exit(unlink(d, recursive = TRUE), add = TRUE)
  chemin <- file.path(d, "R", "audit.R")
  writeLines(c(
    "f <- function(con, reponse) {",
    "  DBI::dbExecute(con, 'DELETE FROM scalar_observation', params = list(name = 1))",
    "  verifier_gel_release()",
    "  httr2::req_perform(httr2::request('https://example.test'))",
    "  openssl::sha256(charToRaw(jsonlite::toJSON(reponse)))",
    "}"
  ), chemin)

  parse_original <- base::parse
  parse_data_original <- utils::getParseData
  parse_calls <- 0L
  parse_data_calls <- 0L
  local_mocked_bindings(
    parse = function(...) {
      parse_calls <<- parse_calls + 1L
      parse_original(...)
    },
    .package = "base"
  )
  local_mocked_bindings(
    getParseData = function(...) {
      parse_data_calls <<- parse_data_calls + 1L
      parse_data_original(...)
    },
    .package = "utils"
  )

  for (i in seq_len(2L)) {
    auditer_appels_db(d)
    auditer_appels_garde(d)
    auditer_appels_reseau(d)
    auditer_hachages_wfs(d)
    auditer_params_dbi(d)
    auditer_ecritures_serveur(d)
  }

  expect_identical(parse_calls, 1L)
  expect_identical(parse_data_calls, 1L)
})

test_that("the shared parse cache refreshes when a planted source changes", {
  d <- tempfile("audit-parse-refresh-")
  dir.create(file.path(d, "R"), recursive = TRUE)
  on.exit(unlink(d, recursive = TRUE), add = TRUE)
  chemin <- file.path(d, "R", "audit.R")
  writeLines("f <- function() NULL", chemin)
  expect_length(auditer_appels_db(d)$fichier, 0L)

  writeLines(c(
    "f <- function() {",
    "  DBI::dbConnect(RPostgres::Postgres())",
    "}"
  ), chemin)
  sites <- auditer_appels_db(d)
  expect_identical(nrow(sites), 1L)
  expect_false(sites$garde[[1L]])
})

test_that("parse-data audits see multiline WFS hashes and serving writes", {
  d <- tempfile("audit-parse-multiline-")
  dir.create(file.path(d, "R"), recursive = TRUE)
  on.exit(unlink(d, recursive = TRUE), add = TRUE)
  writeLines(c(
    "f <- function(con, reponse) {",
    "  DBI::dbExecute(",
    "    con,",
    "    'DELETE FROM scalar_observation'",
    "  )",
    "  openssl::sha256(",
    "    charToRaw(jsonlite::toJSON(",
    "      reponse",
    "    ))",
    "  )",
    "}"
  ), file.path(d, "R", "multiline.R"))

  ecritures <- auditer_ecritures_serveur(d)
  expect_identical(nrow(ecritures), 1L)
  expect_false(ecritures$autorise[[1L]])
  expect_error(verifier_structure_ecritures_serveur(d), "outside a shape adapter")

  hachages <- auditer_hachages_wfs(d)
  expect_identical(nrow(hachages), 1L)
  expect_true(hachages$enveloppe[[1L]])
  expect_error(verifier_structure_hachages_wfs(d), "raw GetFeature envelope")
})
