# Structural seam enforcement for ADR-0049 step 2 (#1137):
#  (a) a serving dbConnect/configuration_service_postgres outside `apply`
#      (or a documented legacy path) fails;
#  (b) a write to a serving table outside a shape adapter fails.
# The existing helper-provenance-audit.R scanner is EXTENDED, not duplicated.

racine_pipeline <- function() normalizePath(testthat::test_path("..", ".."))

test_that("real repo passes both seam audits (apply guarded, not allowlisted)", {
  racine <- racine_pipeline()
  connexions <- verifier_structure_gel(racine)
  expect_true(nrow(connexions) > 0L)
  expect_equal(nrow(connexions[!connexions$garde & !connexions$autorise, , drop = FALSE]), 0L)
  apply_sites <- connexions[grepl("apply_publication", connexions$fichier), ]
  expect_true(nrow(apply_sites) > 0L)
  # The connection site carries the lineage freeze guard itself; it is NOT
  # exempted through the allowlist.
  expect_true(all(apply_sites$garde))
  expect_false(any(apply_sites$autorise))

  ecritures <- verifier_structure_ecritures_serveur(racine)
  expect_true(nrow(ecritures) > 0L)
  expect_equal(nrow(ecritures[!ecritures$autorise, , drop = FALSE]), 0L)
  # The scalar adapter is an allowlisted writer; apply itself writes none.
  expect_true(any(grepl("adaptateur_scalaire", ecritures$fichier)))
  expect_false(any(grepl("apply_publication", ecritures$fichier)))
})

test_that("allowlists name exact files — no broad regex can admit a new file", {
  motifs <- c(vapply(AUTORISATIONS_DB, function(a) a$fichier, character(1)),
              vapply(AUTORISATIONS_ECRITURE_SERVEUR, function(a) a$fichier, character(1)))
  expect_false(any(grepl("\\.\\*", motifs)))
  # A brand-new file whose name resembles a legacy publisher must still fail.
  d <- tempfile("seam-exact-")
  dir.create(file.path(d, "R"), recursive = TRUE)
  on.exit(unlink(d, recursive = TRUE), add = TRUE)
  writeLines(c("foo <- function(con) {",
               "  con <- DBI::dbConnect(RPostgres::Postgres(), dbname='lusk')",
               "}"), file.path(d, "R", "publish_new_trick.R"))
  expect_error(verifier_structure_gel(d), "serving-DB call site")
  writeLines(c("foo <- function(con) {",
               "  DBI::dbExecute(con, 'DELETE FROM scalar_observation')",
               "}"), file.path(d, "R", "publish_new_trick.R"))
  expect_error(verifier_structure_ecritures_serveur(d), "outside a shape adapter")
})

test_that("legacy writers carry the step-4 retirement reason", {
  for (a in AUTORISATIONS_ECRITURE_SERVEUR) {
    if (grepl("publish|aggregates|scripts", a$fichier))
      expect_match(a$raison, "retire in ADR-0049 step 4", fixed = TRUE)
  }
  db_legacy <- Filter(function(a) grepl("publish|smoke|bridge", a$fichier), AUTORISATIONS_DB)
  expect_true(length(db_legacy) > 0L)
  for (a in db_legacy)
    expect_match(a$raison, "retire in ADR-0049 step 4", fixed = TRUE)
})

test_that("a new unallowlisted serving connection fails the audit (proof)", {
  d <- tempfile("seam-connect-")
  dir.create(file.path(d, "R"), recursive = TRUE)
  on.exit(unlink(d, recursive = TRUE), add = TRUE)
  writeLines(c("foo <- function() {",
               "  con <- DBI::dbConnect(RPostgres::Postgres(), dbname='lusk')",
               "}"), file.path(d, "R", "parallel_path.R"))
  expect_error(verifier_structure_gel(d), "serving-DB call site")
})

test_that("a new unallowlisted serving-table write fails the audit (proof)", {
  d <- tempfile("seam-write-")
  dir.create(file.path(d, "R"), recursive = TRUE)
  on.exit(unlink(d, recursive = TRUE), add = TRUE)
  writeLines(c("foo <- function(con) {",
               "  DBI::dbExecute(con, 'DELETE FROM scalar_observation')",
               "}"), file.path(d, "R", "parallel_path.R"))
  sites <- auditer_ecritures_serveur(d)
  expect_true(any(grepl("parallel_path\\.R", sites$fichier)))
  expect_true(any(!sites$autorise))
  expect_error(verifier_structure_ecritures_serveur(d), "outside a shape adapter")
})

test_that("plan and apply share ONE closure-verdict function", {
  racine <- racine_pipeline()
  lignes_apply <- readLines(file.path(racine, "R", "apply_publication.R"), warn = FALSE)
  lignes_plan <- readLines(file.path(racine, "R", "plan_publication.R"), warn = FALSE)
  src_apply <- paste(lignes_apply, collapse = "\n")
  src_plan <- paste(lignes_plan, collapse = "\n")
  # Defined once, in plan_publication.R, and called by BOTH.
  expect_equal(sum(grepl("^verdict_fermetures\\s*<-", lignes_plan)), 1L)
  expect_equal(sum(grepl("^verdict_fermetures\\s*<-", lignes_apply)), 0L)
  expect_true(grepl("verdict_fermetures\\(", src_apply))
  expect_true(grepl("verdict_fermetures\\(", src_plan))
  # apply no longer constructs causes or propagates closure components itself.
  expect_false(grepl("cause_ligne\\s*<-", src_apply))
  expect_false(grepl("composantes_cascade\\(", src_apply))
})

test_that("every DBI params list in R/ is positional (RPostgres contract)", {
  racine <- racine_pipeline()
  expect_equal(nrow(auditer_params_dbi(racine)), 0L)
  expect_silent(verifier_params_dbi_positionnels(racine))
})

test_that("the DBI named-params audit fails on both named forms (proof)", {
  d <- tempfile("seam-params-")
  dir.create(file.path(d, "R"), recursive = TRUE)
  on.exit(unlink(d, recursive = TRUE), add = TRUE)
  writeLines(c(
    "f <- function(con) {",
    "  DBI::dbExecute(con, 'SELECT 1', params = list(name = 1))",
    "  DBI::dbGetQuery(con, 'SELECT 2', params = as.list(c('a', 'b')))",
    "}" ), file.path(d, "R", "named.R"))
  fautes <- auditer_params_dbi(d)
  expect_equal(nrow(fautes), 2L)
  expect_error(verifier_params_dbi_positionnels(d), "named `params`")
})

test_that("one neutral writer owns source_dataset/source_vintage SQL (#1138 review)", {
  racine <- racine_pipeline()
  fichiers <- list.files(file.path(racine, "R"), pattern = "\\.R$", full.names = TRUE)
  definitions <- function(motif) {
    unlist(lapply(fichiers, function(f) {
      l <- readLines(f, warn = FALSE)
      trouvees <- l[grepl(motif, l)]
      if (length(trouvees)) paste0(basename(f), ": ", trimws(trouvees)) else character()
    }), use.names = FALSE)
  }
  ecritures <- definitions("^\\.ecrire_sources[A-Za-z_]*\\s*<-")
  expect_length(ecritures, 1L)
  expect_match(ecritures, "\\.ecrire_sources_serveur")
  expect_match(ecritures, "ecriture_sources_serveur\\.R")
  citations <- definitions("^\\.quoter_sql[A-Za-z_]*\\s*<-")
  expect_length(citations, 1L)
  expect_match(citations, "\\.quoter_sql_serveur")
  expect_match(citations, "ecriture_sources_serveur\\.R")
})

test_that("apply delegates every serving write to the shape adapter", {
  racine <- racine_pipeline()
  lignes <- readLines(file.path(racine, "R", "apply_publication.R"), warn = FALSE)
  source <- paste(lignes, collapse = "\n")
  # No direct serving-table SQL and no shape switch in apply: dispatch goes
  # through REGISTRE_FORMES_RESSOURCE[[forme]]$remplacer only.
  expect_false(any(grepl(MOTIF_ECRITURE_SERVEUR, lignes, ignore.case = TRUE)))
  expect_true(any(grepl("REGISTRE_FORMES_RESSOURCE\\[\\[", lignes)))
  expect_false(any(grepl("switch\\s*\\(\\s*forme|if\\s*\\(\\s*(identical\\s*\\(\\s*)?forme\\s*(==|!=)",
                         lignes)))
})
