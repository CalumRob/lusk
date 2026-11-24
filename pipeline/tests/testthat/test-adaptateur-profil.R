# Declared-profile shape adapter — ADR-0049 step 2 (#1138). `projeter` and
# `remplacer` are FIELDS of REGISTRE_FORMES_RESSOURCE$declared_profile. The
# adapter replaces ONE profile's descriptor, axes, facts, provenance and
# comparison through the shared per-table writers, and VERIFIES the dependency's
# FACTS version recorded at build time — never a silent rebind (#1138 review).

fixture_profil_unitaire <- function(root = artefacts_fixture_root(),
                                    recorded = NULL, owner = "distribution_dpe",
                                    comparison_scalar = "part_passoires",
                                    source_id = "profile_source") {
  valeurs <- c(10, 10, 5, 3, NA, 100, 50, 8, 8, 30)
  scalaire <- artefacts_fixture_scalar_indicator("part_passoires", "dpe_22", valeurs)
  handler <- REGISTRE_FORMES_RESSOURCE[["scalar"]]
  faits_attendus <- version_faits_ressource(handler, scalaire)
  fx <- artefacts_fixture_profile_artefact(root = root, owner = owner,
    comparison_scalar = comparison_scalar,
    required_scalar_version = if (is.null(recorded)) faits_attendus else recorded,
    source_id = source_id)
  artefact_dependance <- if (is.null(comparison_scalar)) NULL else list(contenu =
    contenu_artefact(faits_forme(handler, scalaire), scalaire$descriptors,
                     scalaire$provenance, NULL))
  list(root = root, scalaire = scalaire, faits_attendus = faits_attendus,
       artefact_dependance = artefact_dependance,
       version = fx$version, ressource = fx$ressource, artefact = fx$artefact,
       lock = fx$lock)
}

# Return the DBI mock FUNCTIONS (not the bindings): local_mocked_bindings must
# be called from the test frame so the mocks stay active for the whole test.
fixture_dbi_capture <- function(capture, marqueur = NULL, count = 4L) {
  list(
    dbWithTransaction = function(con, expr) force(expr),
    dbExecute = function(con, sql, params = list()) {
      capture$appels[[length(capture$appels) + 1L]] <<- list(sql = sql, params = params); 0L
    },
    dbWriteTable = function(con, name, value, ...) {
      capture$ecritures[[length(capture$ecritures) + 1L]] <<- name; nrow(value)
    },
    dbGetQuery = function(con, sql, params = list()) {
      if (grepl("scalar_resource_comparison_publication", sql, fixed = TRUE))
        return(if (is.null(marqueur)) data.frame() else
          data.frame(scalar_content_version = marqueur))
      if (grepl("count\\(\\*\\)", sql)) return(data.frame(n = as.integer(count)))
      data.frame()
    },
    dbQuoteString = function(con, x) paste0("'", gsub("'", "''", as.character(x)), "'"))
}

params_descriptor <- function(appels) {
  appels[vapply(appels, function(x)
    grepl("INSERT INTO profile_descriptor\\(", x$sql), logical(1))]
}

test_that("declared-profile adapter is a field of the shape registry", {
  handler <- REGISTRE_FORMES_RESSOURCE[["declared_profile"]]
  expect_true(is.function(handler$projeter))
  expect_true(is.function(handler$remplacer))
  expect_identical(handler$projeter, projeter_artefact_profil_declare)
  expect_identical(handler$remplacer, remplacer_profil_declare)
})

test_that("projeter keeps only this profile's grains and its recorded facts version", {
  fx <- fixture_profil_unitaire()
  on.exit(unlink(fx$root, recursive = TRUE), add = TRUE)
  rows <- projeter_artefact_profil_declare(fx$artefact)
  expect_identical(rows$ressource, "distribution_dpe")
  expect_identical(rows$forme, "declared_profile")
  expect_identical(rows$version, fx$version)
  expect_identical(rows$descriptor$comparison_scalar, "part_passoires")
  expect_identical(rows$descriptor$required_scalar_version, fx$faits_attendus)
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
  fx <- fixture_profil_unitaire()
  on.exit(unlink(fx$root, recursive = TRUE), add = TRUE)
  artefact <- fx$artefact
  artefact$forme <- "scalar"
  expect_error(projeter_artefact_profil_declare(artefact), "declared_profile")
})

test_that("cascade verifies the dependency facts version and writes scoped rows only", {
  fx <- fixture_profil_unitaire()
  on.exit(unlink(fx$root, recursive = TRUE), add = TRUE)
  rows <- projeter_artefact_profil_declare(fx$artefact)
  capture <- new.env(parent = emptyenv())
  capture$appels <- list(); capture$ecritures <- list()
  mocks <- fixture_dbi_capture(capture, NULL)
  local_mocked_bindings(
    dbWithTransaction = mocks$dbWithTransaction,
    dbExecute = mocks$dbExecute,
    dbWriteTable = mocks$dbWriteTable,
    dbGetQuery = mocks$dbGetQuery,
    dbQuoteString = mocks$dbQuoteString,
    .package = "DBI")
  # No live marker read is permitted: the closure carries the dependency.
  remplacer_profil_declare(structure(list(), class = "mock"), "distribution_dpe",
    rows, rows$version, artefacts = list(part_passoires = fx$artefact_dependance))
  appels <- capture$appels
  executes <- vapply(appels, `[[`, character(1), "sql")
  deletes <- executes[grepl("^DELETE", executes)]
  expect_true(length(deletes) >= 7L)
  expect_true(all(grepl("\\$1", deletes)))
  expect_false(any(grepl("DELETE FROM profile_observation$", deletes)))
  desc <- params_descriptor(appels)
  expect_length(desc, 1L)
  # The recorded token is written UNCHANGED — no silent rebind.
  expect_true(fx$faits_attendus %in% unlist(desc[[1]]$params))
  expect_true(any(grepl("INSERT INTO profile_resource_comparison_publication", executes)))
  expect_true(any(grepl("INSERT INTO resource_publication", executes)))
  for (g in c("table_publication", "profile_comparison_publication"))
    expect_false(any(grepl(paste0("(DELETE FROM|INSERT INTO|UPDATE) ", g, "\\b"),
                           executes, perl = TRUE)))
  expect_true(all(c("profile_axis", "profile_observation", "profile_observation_source",
                    "profile_comparison_group", "profile_comparison_territory",
                    "comparison_source_lineage") %in% capture$ecritures))
  expect_true(all(vapply(appels, function(x) is.null(x$params) || length(x$params) == 0L ||
    is.null(names(x$params)) || all(names(x$params) == ""), logical(1))))
  # The live marker was never queried in the cascade case.
  expect_false(any(grepl("scalar_resource_comparison_publication", executes)))
})

test_that("cascade with a divergent dependency facts version refuses with zero writes", {
  fx <- fixture_profil_unitaire()
  on.exit(unlink(fx$root, recursive = TRUE), add = TRUE)
  rows <- projeter_artefact_profil_declare(fx$artefact)
  capture <- new.env(parent = emptyenv())
  capture$appels <- list(); capture$ecritures <- list()
  mocks <- fixture_dbi_capture(capture, NULL)
  local_mocked_bindings(
    dbWithTransaction = mocks$dbWithTransaction,
    dbExecute = mocks$dbExecute,
    dbWriteTable = mocks$dbWriteTable,
    dbGetQuery = mocks$dbGetQuery,
    dbQuoteString = mocks$dbQuoteString,
    .package = "DBI")
  # A different scalar descriptor produces a DIFFERENT facts version.
  diverge <- fx$scalaire
  diverge$descriptors$label <- "autre version des faits"
  diverge$descriptors$descriptor_version <- "autre"
  handler <- REGISTRE_FORMES_RESSOURCE[["scalar"]]
  artefact_divergent <- list(contenu = contenu_artefact(
    faits_forme(handler, diverge), diverge$descriptors, diverge$provenance, NULL))
  expect_false(identical(fx$faits_attendus, version_faits_artefact(artefact_divergent)))
  err <- tryCatch(remplacer_profil_declare(structure(list(), class = "mock"),
    "distribution_dpe", rows, rows$version,
    artefacts = list(part_passoires = artefact_divergent)), error = identity)
  expect_s3_class(err, "erreur_apply")
  expect_identical(err$refus, "dependance_divergente")
  expect_match(conditionMessage(err), "part_passoires built ", fixed = TRUE)
  expect_match(conditionMessage(err), fx$faits_attendus, fixed = TRUE)
  expect_length(capture$appels, 0L)
  expect_length(capture$ecritures, 0L)
})

test_that("apply alone verifies the LIVE facts version and refuses when it diverges", {
  fx <- fixture_profil_unitaire()
  on.exit(unlink(fx$root, recursive = TRUE), add = TRUE)
  rows <- projeter_artefact_profil_declare(fx$artefact)
  # (a) live marker equals the recorded facts version: the token is unchanged.
  capture <- new.env(parent = emptyenv())
  capture$appels <- list(); capture$ecritures <- list()
  mocks <- fixture_dbi_capture(capture, fx$faits_attendus)
  local_mocked_bindings(
    dbWithTransaction = mocks$dbWithTransaction,
    dbExecute = mocks$dbExecute,
    dbWriteTable = mocks$dbWriteTable,
    dbGetQuery = mocks$dbGetQuery,
    dbQuoteString = mocks$dbQuoteString,
    .package = "DBI")
  remplacer_profil_declare(structure(list(), class = "mock"), "distribution_dpe",
    rows, rows$version)
  expect_true(fx$faits_attendus %in% unlist(params_descriptor(capture$appels)[[1]]$params))
  # (b) a different live facts version refuses by NAME, with zero writes.
  capture2 <- new.env(parent = emptyenv())
  capture2$appels <- list(); capture2$ecritures <- list()
  mocks <- fixture_dbi_capture(capture2, "version-des-faits-vivante-autre")
  local_mocked_bindings(
    dbWithTransaction = mocks$dbWithTransaction,
    dbExecute = mocks$dbExecute,
    dbWriteTable = mocks$dbWriteTable,
    dbGetQuery = mocks$dbGetQuery,
    dbQuoteString = mocks$dbQuoteString,
    .package = "DBI")
  err <- tryCatch(remplacer_profil_declare(structure(list(), class = "mock"),
    "distribution_dpe", rows, rows$version), error = identity)
  expect_s3_class(err, "erreur_apply")
  expect_identical(err$refus, "dependance_divergente")
  expect_match(conditionMessage(err), "live version-des-faits-vivante-autre", fixed = TRUE)
  expect_length(capture2$appels, 0L)
})

test_that("apply alone refuses an absent dependency with zero writes", {
  fx <- fixture_profil_unitaire()
  on.exit(unlink(fx$root, recursive = TRUE), add = TRUE)
  rows <- projeter_artefact_profil_declare(fx$artefact)
  capture <- new.env(parent = emptyenv())
  capture$appels <- list(); capture$ecritures <- list()
  mocks <- fixture_dbi_capture(capture, NULL)
  local_mocked_bindings(
    dbWithTransaction = mocks$dbWithTransaction,
    dbExecute = mocks$dbExecute,
    dbWriteTable = mocks$dbWriteTable,
    dbGetQuery = mocks$dbGetQuery,
    dbQuoteString = mocks$dbQuoteString,
    .package = "DBI")
  err <- tryCatch(remplacer_profil_declare(structure(list(), class = "mock"),
    "distribution_dpe", rows, rows$version), error = identity)
  expect_s3_class(err, "erreur_apply")
  expect_identical(err$refus, "dependance_absente")
  expect_match(conditionMessage(err), "part_passoires", fixed = TRUE)
  expect_length(capture$appels, 0L)

  # A profile without a recorded token also refuses by name.
  sans <- fixture_profil_unitaire(recorded = NA_character_)
  rows2 <- projeter_artefact_profil_declare(sans$artefact)
  err2 <- tryCatch(remplacer_profil_declare(structure(list(), class = "mock"),
    "distribution_dpe", rows2, rows2$version), error = identity)
  expect_identical(err2$refus, "dependance_absente")
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
