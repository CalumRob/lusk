# `apply` orchestration (ADR-0049 step 2, #1137): refusals before writes,
# registry as live source, one transaction, receipts after commit, rollback and
# retirement. No real database: the serving seam is mocked and asserted.

fixture_apply_registre_lock <- function() {
  d <- artefacts_fixture_all_digests()
  stats::setNames(lapply(d, function(x)
    list(sha256 = x$sha256, acquired_at = "2026-01-01")), names(d))
}

fixture_apply_magasin <- function(root) {
  projections <- artefacts_fixture_scalar_projections()
  digests <- artefacts_fixture_all_digests()
  ref <- artefacts_fixture_reference()
  handler <- REGISTRE_FORMES_RESSOURCE[["scalar"]]
  for (id in names(projections)) {
    p <- projections[[id]]
    cmp <- comparaison_scalaire_ressource(p, id, ref)
    contenu <- contenu_artefact(faits_forme(handler, p), p$descriptors,
                                p$provenance, cmp)
    ecrire_artefact_ressource(id, "scalar", contenu,
      digests_lignage = digests_lignage_ressource(
        sources_provenance_ressource(p$provenance), digests), root = root)
  }
  lister_artefacts_ressource(root)
}

fixture_plan_minimal <- function(lignes) {
  list(ressources = lignes)
}

test_that("analyser_ids_apply parses plain and @version ids", {
  a <- analyser_ids_apply(c("densite", "offre_tc@v1"))
  expect_identical(a$ressource, c("densite", "offre_tc"))
  expect_identical(a$version, c(NA_character_, "v1"))
  expect_error(analyser_ids_apply(character()), "at least one")
  expect_error(analyser_ids_apply(c("a", "a")), "duplicate")
  expect_error(analyser_ids_apply("Bad-Id"), "invalid")
})

test_that("verifier_refus_apply refuses freeze, regression, definition and blocked closure", {
  base <- data.frame(
    ressource = c("a", "b"),
    gel = c("ok", "ok"), gel_raison = c("", ""),
    bloque = c(FALSE, FALSE), bloque_par = c("", ""),
    check = c("none", "none"), definition = c(FALSE, FALSE),
    definition_champs = I(list(character(), character())),
    stringsAsFactors = FALSE)
  plan <- fixture_plan_minimal(base)
  expect_true(verifier_refus_apply(plan, c("a")))

  gel <- base; gel$gel[1] <- "refused"; gel$gel_raison[1] <- "derive"
  expect_error(verifier_refus_apply(fixture_plan_minimal(gel), "a"), "zéro écriture")

  reg <- base; reg$check[1] <- "regression"
  expect_error(verifier_refus_apply(fixture_plan_minimal(reg), "a"), "régression")

  blk <- base; blk$bloque[1] <- TRUE; blk$bloque_par[1] <- "b (gel: derive)"
  expect_error(verifier_refus_apply(fixture_plan_minimal(blk), "a"), "fermeture bloquée")

  definition <- base; definition$definition[1] <- TRUE
  definition$definition_champs[[1]] <- c("label", "unit")
  err <- tryCatch(verifier_refus_apply(fixture_plan_minimal(definition), "a"),
                  error = identity)
  expect_s3_class(err, "erreur_apply")
  expect_identical(err$refus, "definition")
  expect_true(verifier_refus_apply(fixture_plan_minimal(definition), "a",
                                   confirm_definition = "a"))
})

test_that("apply writes one resource, one transaction, DB + local receipts", {
  root <- artefacts_fixture_root()
  on.exit(unlink(root, recursive = TRUE), add = TRUE)
  fixture_apply_magasin(root)

  appels_remplacer <- list(); recettes_db <- list(); recettes_locales <- list()
  transactions <- 0L
  registry <- REGISTRE_FORMES_RESSOURCE
  registry$scalar$remplacer <- function(con, ressource, rows, version, ...) {
    appels_remplacer[[length(appels_remplacer) + 1L]] <<-
      list(ressource = ressource, version = version, n = nrow(rows$observations))
    invisible(NULL)
  }
  local_mocked_bindings(
    lire_listing_live_registre = function(con) data.frame(ressource = character(),
      version = character()),
    ecrire_recette_ressource = function(...) {
      recettes_db[[length(recettes_db) + 1L]] <<- list(...); invisible(TRUE) },
    ecrire_recette_locale = function(recette, dir = NULL) {
      recettes_locales[[length(recettes_locales) + 1L]] <<- recette; "x.json" },
    REGISTRE_FORMES_RESSOURCE = registry)
  local_mocked_bindings(
    dbWithTransaction = function(con, expr) { transactions <<- transactions + 1L; force(expr) },
    .package = "DBI")

  resultat <- apply_publication("densite", root = root,
    registre = fixture_apply_registre_lock(), con = structure(list(), class = "mock"))
  expect_identical(resultat$applied, "densite")
  expect_length(appels_remplacer, 1L)
  expect_identical(appels_remplacer[[1]]$ressource, "densite")
  expect_identical(transactions, 1L)
  expect_length(recettes_db, 1L)
  expect_length(recettes_locales, 1L)
  expect_identical(recettes_db[[1]]$operation, "apply")
})

test_that("apply refuses a definition change with ZERO writes and transaction", {
  root <- artefacts_fixture_root()
  on.exit(unlink(root, recursive = TRUE), add = TRUE)
  fixture_apply_magasin(root)

  ecritures <- 0L; transactions <- 0L
  registry <- REGISTRE_FORMES_RESSOURCE
  registry$scalar$remplacer <- function(...) { ecritures <<- ecritures + 1L }
  local_mocked_bindings(
    lire_listing_live_registre = function(con) data.frame(ressource = character(),
      version = character()),
    # Simulate a definition-change refusal at the decision seam.
    verifier_refus_apply = function(plan, cibles, confirm_definition = character()) {
      stop(erreur_apply("definition", "définition non confirmée — zéro écriture"))
    },
    REGISTRE_FORMES_RESSOURCE = registry)
  local_mocked_bindings(
    dbWithTransaction = function(con, expr) { transactions <<- transactions + 1L; force(expr) },
    .package = "DBI")
  err <- tryCatch(apply_publication("densite", root = root,
    registre = fixture_apply_registre_lock(), con = structure(list(), class = "mock")),
    error = identity)
  expect_s3_class(err, "erreur_apply")
  expect_match(conditionMessage(err), "zéro écriture", fixed = TRUE)
  expect_identical(ecritures, 0L)
  expect_identical(transactions, 0L)
})

test_that("apply --retire removes rows via the adapter and leaves a receipt", {
  root <- artefacts_fixture_root()
  on.exit(unlink(root, recursive = TRUE), add = TRUE)
  fixture_apply_magasin(root)
  retires <- character(); recettes_db <- list()
  registry <- REGISTRE_FORMES_RESSOURCE
  registry$scalar$remplacer <- function(con, ressource, rows, version, retire = FALSE, ...) {
    if (isTRUE(retire)) retires <<- c(retires, ressource)
    invisible(NULL)
  }
  local_mocked_bindings(
    lire_listing_live_registre = function(con) data.frame(ressource = "densite",
      version = lister_artefacts_ressource(root)$version[[1L]]),
    ecrire_recette_ressource = function(...) {
      recettes_db[[length(recettes_db) + 1L]] <<- list(...); invisible(TRUE) },
    ecrire_recette_locale = function(...) "x.json",
    REGISTRE_FORMES_RESSOURCE = registry)
  local_mocked_bindings(
    dbWithTransaction = function(con, expr) force(expr),
    .package = "DBI")
  resultat <- apply_publication("densite", retire = TRUE, root = root,
    registre = fixture_apply_registre_lock(), con = structure(list(), class = "mock"))
  expect_identical(retires, "densite")
  expect_identical(recettes_db[[1]]$operation, "retire")
})

test_that("apply @version selects that artefact for rollback", {
  root <- artefacts_fixture_root()
  on.exit(unlink(root, recursive = TRUE), add = TRUE)
  listing <- fixture_apply_magasin(root)
  version0 <- listing$version[[1L]]  # densite v1
  versions_utilisees <- character()
  registry <- REGISTRE_FORMES_RESSOURCE
  registry$scalar$remplacer <- function(con, ressource, rows, version, ...) {
    versions_utilisees <<- c(versions_utilisees, version); invisible(NULL) }
  local_mocked_bindings(
    lire_listing_live_registre = function(con) data.frame(ressource = character(),
      version = character()),
    ecrire_recette_ressource = function(...) invisible(TRUE),
    ecrire_recette_locale = function(...) "x.json",
    REGISTRE_FORMES_RESSOURCE = registry)
  local_mocked_bindings(
    dbWithTransaction = function(con, expr) force(expr),
    .package = "DBI")
  apply_publication(paste0("densite@", version0), root = root,
    registre = fixture_apply_registre_lock(), con = structure(list(), class = "mock"))
  expect_identical(versions_utilisees, version0)
})
