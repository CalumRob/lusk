# #1148 — a full retained publication must carry the producer CONSOENAF source
# into the Milieux publisher. These are fixture/unit proofs: no database and no
# data/raw. The env var is resolved at the documented entry points (CLI
# --publish and the publie_backend_retained target), and the publisher refuses
# BEFORE its write transaction when a live absence marker is non-empty without
# a readable source. None of this changes what the Milieux publisher validates
# once a source IS supplied.

milieux_conso_fixture_source <- function(directory, idcom = "29001") {
  dir.create(directory, recursive = TRUE, showWarnings = FALSE)
  path <- file.path(directory, "conso-com.csv")
  readr::write_csv(
    data.frame(idcom = idcom, idcomtxt = "Commune present", iddep = "29",
               epci25 = "29000", epci25txt = "EPCI", naf1125 = "100",
               stringsAsFactors = FALSE),
    path)
  path
}

# The full publication branch with DB fully stubbed. `marker_count` is the
# live milieux_reading_absence publication row_count; NULL emulates a result
# without that column (older/foreign shape), which must keep the old behaviour.
milieux_run_full_publication <- function(marker_count, env_source = "",
                                         conso_path = NULL, explicit = TRUE) {
  sortie <- tempfile("milieux-conso-sortie-")
  dir.create(file.path(sortie, "scalar-serving"), recursive = TRUE,
             showWarnings = FALSE)
  dir.create(file.path(sortie, "profile-serving", "distribution_dpe"),
             recursive = TRUE, showWarnings = FALSE)
  writeLines('{"binding":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}',
             file.path(sortie, "scalar-serving", "binding.json"))
  writeLines("profile facts", file.path(sortie, "profile-serving",
                                        "distribution_dpe", "facts.txt"))
  on.exit(unlink(sortie, recursive = TRUE), add = TRUE)
  con <- structure(list(id = "milieux-marker"), class = "fake_milieux_con")
  recorded <- list(sql = character(), writes = 0L, publish = NULL)
  withr::local_envvar(LUSK_SCALAR_SCOPE = "", LUSK_SCALAR_BASELINE_SORTIE = "",
                      LUSK_MILIEUX_CONSO_SOURCE = env_source)
  testthat::local_mocked_bindings(
    verifier_gel_release = function(...) invisible(TRUE),
    configuration_service_postgres = function() list(host = "h", port = 5432L,
      dbname = "d", user = "u", passfile = "p"),
    project_territory_reference = function(...) list(rows = data.frame(),
      content_version = "ref"),
    project_retained_scalar_snapshot = function(...) list(scalar = list()),
    scalar_content_version = function(...) "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    refresh_declared_profile_scalar_binding = function(...) invisible(character()),
    publish_retained_backend_snapshot = function(con, sortie,
        conso_source_path = NULL, atomic = FALSE, companion_profiles = FALSE) {
      recorded$publish <<- list(conso_source_path = conso_source_path,
                                atomic = atomic,
                                companion_profiles = companion_profiles)
      invisible(NULL)
    }
  )
  testthat::local_mocked_bindings(
    dbConnect = function(...) con,
    dbGetQuery = function(con, sql, ...) {
      recorded$sql <<- c(recorded$sql, sql)
      if (grepl("milieux_reading_absence", sql, fixed = TRUE)) {
        if (is.null(marker_count)) return(data.frame(v = 1L))
        return(data.frame(row_count = as.integer(marker_count)))
      }
      data.frame(v = 1L)
    },
    dbExecute = function(...) { recorded$writes <<- recorded$writes + 1L; invisible(0L) },
    dbWriteTable = function(...) { recorded$writes <<- recorded$writes + 1L; invisible(TRUE) },
    dbDisconnect = function(...) invisible(TRUE),
    .package = "DBI"
  )
  result <- tryCatch({
    if (explicit)
      publish_retained_backend_from_parquet(sortie, conso_source_path = conso_path)
    else
      publish_retained_backend_from_parquet(sortie)
  }, error = identity)
  list(result = result, recorded = recorded)
}

test_that("the operator resolver reads LUSK_MILIEUX_CONSO_SOURCE, NULL when unset", {
  fake_env <- function(value) function(name, unset) {
    if (identical(name, "LUSK_MILIEUX_CONSO_SOURCE")) value else unset
  }
  expect_identical(
    resolve_milieux_conso_source(env = fake_env("E:/lusk/pipeline/data/raw/conso-com.csv")),
    "E:/lusk/pipeline/data/raw/conso-com.csv")
  expect_null(resolve_milieux_conso_source(env = fake_env("")))
})

test_that("the --publish CLI passes the resolved source into conso_source_path", {
  dir <- tempfile("milieux-cli-")
  on.exit(unlink(dir, recursive = TRUE), add = TRUE)
  source_path <- milieux_conso_fixture_source(dir)
  withr::local_envvar(LUSK_SORTIE = dir, LUSK_MILIEUX_CONSO_SOURCE = source_path)
  captured <- NULL
  publisher <- function(sortie, conso_source_path = NULL) {
    captured <<- list(sortie = sortie, conso_source_path = conso_source_path)
    list(reconciled = character())
  }
  script <- readLines(testthat::test_path("../../scripts/publish-serving-tables.R"),
                      warn = FALSE)
  # Strip the package reload so the injected publisher stub survives.
  script <- script[!grepl("pkgload::load_all", script, fixed = TRUE)]
  cli_env <- new.env(parent = environment())
  cli_env$commandArgs <- function(trailingOnly = FALSE) {
    if (isTRUE(trailingOnly)) "--publish" else character()
  }
  cli_env$publish_retained_backend_from_parquet <- publisher
  source(textConnection(script), local = cli_env, echo = FALSE)
  expect_identical(captured$sortie, dir)
  expect_identical(captured$conso_source_path, source_path)
})

test_that("a non-empty Milieux absence marker with no source refuses before any write", {
  run <- milieux_run_full_publication(marker_count = 5L, env_source = "",
                                      conso_path = NULL)
  err <- run$result
  expect_s3_class(err, "error")
  expect_match(conditionMessage(err), "LUSK_MILIEUX_CONSO_SOURCE", fixed = TRUE)
  # The refusal happens before the advisory lock, the snapshot publisher and
  # every DB write — not two minutes inside the publication transaction.
  expect_identical(run$recorded$writes, 0L)
  expect_null(run$recorded$publish)
  expect_true(any(grepl("milieux_reading_absence", run$recorded$sql, fixed = TRUE)))
  expect_false(any(grepl("pg_advisory_lock", run$recorded$sql, fixed = TRUE)))
})

test_that("an empty Milieux absence marker needs no source and behaves as today", {
  run <- milieux_run_full_publication(marker_count = 0L, env_source = "",
                                      conso_path = NULL)
  expect_null(run$result)
  expect_null(run$recorded$publish$conso_source_path)
  expect_true(isTRUE(run$recorded$publish$atomic))
  expect_true(isTRUE(run$recorded$publish$companion_profiles))
  expect_true(any(grepl("pg_advisory_lock", run$recorded$sql, fixed = TRUE)))
})

test_that("a marker without a row_count column is treated as empty", {
  run <- milieux_run_full_publication(marker_count = NULL, env_source = "",
                                      conso_path = NULL)
  expect_null(run$result)
  expect_null(run$recorded$publish$conso_source_path)
})

test_that("the backend publisher default resolves the env source for callers that omit the argument", {
  dir <- tempfile("milieux-conso-default-")
  on.exit(unlink(dir, recursive = TRUE), add = TRUE)
  source_path <- milieux_conso_fixture_source(dir)
  run <- milieux_run_full_publication(marker_count = 5L, env_source = source_path,
                                      explicit = FALSE)
  expect_null(run$result)
  expect_identical(run$recorded$publish$conso_source_path, source_path)
})

test_that("a readable source satisfies a non-empty Milieux absence marker", {
  dir <- tempfile("milieux-conso-ok-")
  on.exit(unlink(dir, recursive = TRUE), add = TRUE)
  source_path <- milieux_conso_fixture_source(dir)
  run <- milieux_run_full_publication(marker_count = 5L, env_source = "",
                                      conso_path = source_path)
  expect_null(run$result)
  expect_identical(run$recorded$publish$conso_source_path, source_path)
})

test_that("an unreadable source with a non-empty marker also refuses by name", {
  dir <- tempfile("milieux-conso-missing-")
  on.exit(unlink(dir, recursive = TRUE), add = TRUE)
  missing_path <- file.path(dir, "conso-com.csv")
  run <- milieux_run_full_publication(marker_count = 5L, env_source = "",
                                      conso_path = missing_path)
  expect_s3_class(run$result, "error")
  expect_match(conditionMessage(run$result), "LUSK_MILIEUX_CONSO_SOURCE", fixed = TRUE)
  expect_identical(run$recorded$writes, 0L)
})

test_that("a readable source still fails the named Milieux source validations", {
  dir <- tempfile("milieux-conso-invalid-")
  dir.create(dir, recursive = TRUE, showWarnings = FALSE)
  on.exit(unlink(dir, recursive = TRUE), add = TRUE)
  territories <- data.frame(territoire = c("29001", "29083"), type = "commune")
  vintages <- data.frame(id = "consoenaf", version = "2025",
                         date_reference = "2025-01-01")
  metadata <- list(files = list(consoenaf = "conso-com.csv"),
                   sources = list(conso_enaf_annuel = "consoenaf"))

  # Partial crosswalk: the commune identity column is missing from a readable
  # CSV — the publisher's named error must still fire once a source is supplied.
  partial <- file.path(dir, "conso-com.csv")
  readr::write_csv(data.frame(iddep = "29", naf1125 = "100"), partial)
  expect_error(milieux_source_absence_declarations(partial, territories, vintages, metadata),
               "CONSOENAF source snapshot lacks commune identity", fixed = TRUE)

  # A readable but wrongly named file is still rejected by producer metadata.
  other <- file.path(dir, "not-the-manifest.csv")
  readr::write_csv(data.frame(idcom = "29001", iddep = "29"), other)
  expect_error(milieux_source_absence_declarations(other, territories, vintages, metadata),
               "differs from producer metadata", fixed = TRUE)

  # A readable source whose identity has no pinned vintage still fails closed.
  all_na <- file.path(dir, "conso-com.csv")
  readr::write_csv(data.frame(idcom = NA_character_, iddep = NA_character_), all_na)
  no_vintage <- list(files = metadata$files,
                     sources = list(conso_enaf_annuel = "unknown-source"))
  expect_error(milieux_source_absence_declarations(all_na, territories, vintages, no_vintage),
               "CONSOENAF source vintage is missing or ambiguous", fixed = TRUE)
})

test_that("an all-NA readable crosswalk still fails the named reading validation", {
  dir <- tempfile("milieux-conso-all-na-")
  dir.create(dir, recursive = TRUE, showWarnings = FALSE)
  on.exit(unlink(dir, recursive = TRUE), add = TRUE)
  source_path <- file.path(dir, "conso-com.csv")
  readr::write_csv(data.frame(idcom = NA_character_, idcomtxt = NA_character_,
                              iddep = NA_character_, epci25 = NA_character_,
                              epci25txt = NA_character_, naf1125 = "100"),
                   source_path)
  territories <- data.frame(territoire = c("29001", "29083"), type = "commune")
  vintages <- data.frame(id = c("consoenaf", "serie_historique"),
    source = c("C", "S"), version = c("2025", "2023"),
    date_reference = c("2025-01-01", "2023-01-01"),
    date_publication = c(NA_character_, NA_character_), stringsAsFactors = FALSE)
  metadata <- list(sources = list(conso_enaf_annuel = "consoenaf"),
    subgroups = list(list(key = "artificialisation")),
    story_keys = list("artif-par-habitant"),
    classification_labels = list("pression-moderee" = 1L),
    source_records = list(serie_historique = list(dataset = "DS")))
  absences <- milieux_source_absence_declarations(source_path, territories,
                                                  vintages, metadata)
  histories <- data.frame(territoire = "29001", type = "commune", theme = "milieux",
    groupe = "artificialisation", story_key = "artif-par-habitant",
    salience_reason = "declared", periode_pop = "2017-2023",
    periode_artif = "2021-2025", delta_population = 125,
    taux_variation_population = 4.7, artif_m2_par_habitant = 321.5,
    artif_m3_par_habitant = 101.2, trajectoire_artif_par_habitant = "stable",
    classification = "pression-moderee", stringsAsFactors = FALSE)
  canonical <- list(source_absences = absences, territoires = territories)
  # The all-NA snapshot derives absences for every commune, including the one
  # with a selected reading: supplying the source must not turn a broken
  # crosswalk into an accepted publication.
  expect_error(project_milieux_reading(histories, vintages, metadata, canonical),
               "Milieux canonical reading universe differs from CONSOENAF source coverage",
               fixed = TRUE)
})
