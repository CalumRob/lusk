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

# DBI mock: the live reference marker the artefacts are bound to (fixtures use
# "reference-v1"). Only the marker SELECT returns a row; the advisory-lock
# SELECT and every other query return an empty frame.
fixture_dbget_reference <- function(version = "reference-v1") {
  function(con, sql, params = list()) {
    if (grepl("table_publication WHERE table_name='territory_reference'", sql,
              fixed = TRUE))
      return(data.frame(content_version = version))
    data.frame()
  }
}

test_that("apply refuses an adapter-less closure member BEFORE any connection", {
  root <- artefacts_fixture_root()
  on.exit(unlink(root, recursive = TRUE), add = TRUE)
  # part_passoires (scalar, has an adapter) declares distribution_dpe through
  # its comparison_scalar dependency; the profile shape has NO remplacer.
  scalaire <- artefacts_fixture_scalar_indicator(
    "part_passoires", "dpe_22", c(10, 10, 5, 3, NA, 100, 50, 8, 8, 30))
  handler <- REGISTRE_FORMES_RESSOURCE[["scalar"]]
  ecrire_artefact_ressource("part_passoires", "scalar",
    contenu_artefact(faits_forme(handler, scalaire), scalaire$descriptors,
                     scalaire$provenance, NULL),
    digests_lignage = digests_lignage_ressource(
      "dpe_22", artefacts_fixture_digests("dpe_22")), root = root)
  profil <- artefacts_fixture_profile_projections()[["distribution_dpe"]]
  ecrire_artefact_ressource("distribution_dpe", "declared_profile",
    contenu_artefact(profil[setdiff(names(profil),
      c("descriptor", "provenance", "comparison"))],
      profil$descriptor, profil$provenance, profil$comparison),
    digests_lignage = digests_lignage_ressource(
      "profile_source", artefacts_fixture_digests("profile_source")), root = root)

  connexions <- 0L
  local_mocked_bindings(
    dbConnect = function(...) { connexions <<- connexions + 1L; stop("no connection expected") },
    .package = "DBI")
  local_mocked_bindings(
    configuration_service_postgres = function() stop("no DB config expected"))
  err <- tryCatch(apply_publication("part_passoires", root = root,
    registre = fixture_apply_registre_lock()), error = identity)
  expect_s3_class(err, "erreur_apply")
  expect_identical(err$refus, "adaptateur_absent")
  expect_match(conditionMessage(err), "distribution_dpe", fixed = TRUE)
  expect_match(conditionMessage(err), "declared_profile", fixed = TRUE)
  expect_match(conditionMessage(err), "zéro connexion", fixed = TRUE)
  expect_identical(connexions, 0L)
})

# Two versions of one scalar artefact differing only by label (a definition
# change). `dep` optionally declares a comparison_scalar dependency so another
# resource joins the closure.
fixture_magasin_definition <- function(root, id, label_v1, label_v2, dep = NULL) {
  projection <- artefacts_fixture_scalar_indicator(id, paste0("src_", id),
    c(10, 10, 5, 3, NA, 100, 50, 8, 8, 30))
  reference <- artefacts_fixture_reference()
  handler <- REGISTRE_FORMES_RESSOURCE[["scalar"]]
  digests <- digests_lignage_ressource(paste0("src_", id),
    artefacts_fixture_digests(paste0("src_", id)))
  versions <- character()
  for (label in c(label_v1, label_v2)) {
    p <- projection
    p$descriptors$label <- label
    p$descriptors$descriptor_version <- paste0(id, "-", substr(label, 1L, 6L))
    comparaison <- comparaison_scalaire_ressource(p, id, reference)
    desc <- p$descriptors
    # Dependency is a DECLARATION carried by the artefact descriptor only;
    # the producer projection keeps its exact validated field set.
    if (!is.null(dep)) desc$comparison_scalar <- dep
    contenu <- contenu_artefact(faits_forme(handler, p), desc,
                                p$provenance, comparaison)
    versions <- c(versions, ecrire_artefact_ressource(id, "scalar", contenu,
      digests_lignage = digests, root = root)$version)
  }
  stats::setNames(versions, c("v1", "v2"))
}

fixture_apply_definition_run <- function(root, ids, builds, live, registre,
                                         confirm = character()) {
  ecritures <- 0L; recettes <- 0L
  registry <- REGISTRE_FORMES_RESSOURCE
  registry$scalar$remplacer <- function(...) { ecritures <<- ecritures + 1L; invisible(NULL) }
  local_mocked_bindings(
    construites_depuis_magasin = function(root = NULL) builds,
    lire_listing_live_registre = function(con) live,
    ecrire_recette_ressource = function(...) { recettes <<- recettes + 1L; invisible(TRUE) },
    ecrire_recette_locale = function(...) "x.json",
    REGISTRE_FORMES_RESSOURCE = registry)
  local_mocked_bindings(
    dbWithTransaction = function(con, expr) force(expr),
    dbGetQuery = fixture_dbget_reference(),
    .package = "DBI")
  err <- NULL
  tryCatch(apply_publication(ids, confirm_definition = confirm, root = root,
    registre = registre, con = structure(list(), class = "mock")),
    error = function(e) err <<- e)
  list(err = err, ecritures = ecritures, recettes = recettes)
}

test_that("confirmed definition change: unconfirmed refuses, confirmed proceeds", {
  root <- artefacts_fixture_root()
  on.exit(unlink(root, recursive = TRUE), add = TRUE)
  v <- fixture_magasin_definition(root, "a", "Anchor", "Redefined Anchor")
  builds <- data.frame(ressource = "a", forme = "scalar", version = v[["v2"]])
  live <- data.frame(ressource = "a", version = v[["v1"]])
  lock <- stats::setNames(list(list(sha256 = "sha256-src_a",
                                    acquired_at = "2026-01-01")), "src_a")

  # (a) unconfirmed -> refused, zero writes.
  a <- fixture_apply_definition_run(root, "a", builds, live, lock)
  expect_s3_class(a$err, "erreur_apply")
  expect_identical(a$err$refus, "definition")
  expect_match(conditionMessage(a$err), "--confirm-definition <id>", fixed = TRUE)
  expect_identical(a$ecritures, 0L)
  expect_identical(a$recettes, 0L)

  # (b) confirmed -> proceeds.
  b <- fixture_apply_definition_run(root, "a", builds, live, lock, confirm = "a")
  expect_null(b$err)
  expect_identical(b$ecritures, 1L)
  expect_identical(b$recettes, 1L)
})

test_that("confirming one resource does not lift another's definition block", {
  root <- artefacts_fixture_root()
  on.exit(unlink(root, recursive = TRUE), add = TRUE)
  va <- fixture_magasin_definition(root, "a", "Anchor", "Redefined Anchor")
  vb <- fixture_magasin_definition(root, "b", "Anchor B", "Redefined B", dep = "a")
  builds <- data.frame(ressource = c("a", "b"), forme = c("scalar", "scalar"),
                       version = c(va[["v2"]], vb[["v2"]]))
  live <- data.frame(ressource = c("a", "b"), version = c(va[["v1"]], vb[["v1"]]))
  lock <- stats::setNames(lapply(c("src_a", "src_b"), function(s)
    list(sha256 = paste0("sha256-", s), acquired_at = "2026-01-01")),
    c("src_a", "src_b"))

  r <- fixture_apply_definition_run(root, "a", builds, live, lock, confirm = "a")
  expect_s3_class(r$err, "erreur_apply")
  expect_identical(r$err$refus, "definition")
  expect_match(conditionMessage(r$err), "b \\(definition: label\\)")
  expect_identical(r$ecritures, 0L)
})

test_that("confirming a definition does not lift a freeze drift in the closure", {
  # Preflight freeze first; confirmation cannot lift an empreinte dérivée.
  root <- artefacts_fixture_root()
  on.exit(unlink(root, recursive = TRUE), add = TRUE)
  v <- fixture_magasin_definition(root, "a", "Anchor", "Redefined Anchor")
  builds <- data.frame(ressource = "a", forme = "scalar", version = v[["v2"]])
  live <- data.frame(ressource = "a", version = v[["v1"]])
  lock_derive <- stats::setNames(list(list(sha256 = "sha256-DERIVE",
                                           acquired_at = "2026-01-01")), "src_a")
  r <- fixture_apply_definition_run(root, "a", builds, live, lock_derive, confirm = "a")
  expect_true(inherits(r$err, "error"))
  expect_true(grepl("dérive|gel", conditionMessage(r$err)))
  expect_identical(r$ecritures, 0L)
  expect_identical(r$recettes, 0L)

  # Direct verdict level: a gel cause survives confirmation of the definition.
  plan <- fixture_plan_minimal(data.frame(
    ressource = "a", gel = "refused", gel_raison = "derive", gel_detail = "",
    bloque = TRUE, bloque_par = "a", check = "none", definition = TRUE,
    definition_champs = I(list("label")), stringsAsFactors = FALSE))
  err <- tryCatch(verifier_refus_apply(plan, "a", confirm_definition = "a"),
                  error = identity)
  expect_s3_class(err, "erreur_apply")
  expect_identical(err$refus, "gel")
})

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

  # A blocker on another member of the closure blocks a too.
  blk <- base; blk$gel[2] <- "refused"; blk$gel_raison[2] <- "derive"
  err_blk <- tryCatch(verifier_refus_apply(fixture_plan_minimal(blk), c("a", "b")),
                      error = identity)
  expect_s3_class(err_blk, "erreur_apply")
  expect_match(conditionMessage(err_blk), "b \\(derive\\)")
  expect_match(conditionMessage(err_blk), "zéro écriture", fixed = TRUE)

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
    dbGetQuery = fixture_dbget_reference(),
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
    dbGetQuery = fixture_dbget_reference(),
    .package = "DBI")
  err <- tryCatch(apply_publication("densite", root = root,
    registre = fixture_apply_registre_lock(), con = structure(list(), class = "mock")),
    error = identity)
  expect_s3_class(err, "erreur_apply")
  expect_match(conditionMessage(err), "zéro écriture", fixed = TRUE)
  expect_identical(ecritures, 0L)
  expect_identical(transactions, 0L)
})

test_that("apply refuses an absent live reference with zero writes", {
  root <- artefacts_fixture_root()
  on.exit(unlink(root, recursive = TRUE), add = TRUE)
  fixture_apply_magasin(root)
  ecritures <- 0L; recettes <- 0L
  registry <- REGISTRE_FORMES_RESSOURCE
  registry$scalar$remplacer <- function(...) { ecritures <<- ecritures + 1L }
  local_mocked_bindings(
    lire_listing_live_registre = function(con) data.frame(ressource = character(),
      version = character()),
    ecrire_recette_ressource = function(...) { recettes <<- recettes + 1L; invisible(TRUE) },
    ecrire_recette_locale = function(...) "x.json",
    REGISTRE_FORMES_RESSOURCE = registry)
  local_mocked_bindings(
    dbWithTransaction = function(con, expr) force(expr),
    dbGetQuery = function(con, sql, params = list()) {
      if (grepl("table_publication WHERE table_name='territory_reference'", sql,
                fixed = TRUE)) return(data.frame(content_version = character()))
      data.frame()
    },
    .package = "DBI")
  err <- tryCatch(apply_publication("densite", root = root,
    registre = fixture_apply_registre_lock(), con = structure(list(), class = "mock")),
    error = identity)
  expect_s3_class(err, "erreur_apply")
  expect_identical(err$refus, "reference_absente")
  expect_match(conditionMessage(err), "reference_absente", fixed = TRUE)
  expect_identical(ecritures, 0L)
  expect_identical(recettes, 0L)
})

test_that("apply refuses a divergent live reference with zero writes", {
  root <- artefacts_fixture_root()
  on.exit(unlink(root, recursive = TRUE), add = TRUE)
  fixture_apply_magasin(root)
  ecritures <- 0L; recettes <- 0L
  registry <- REGISTRE_FORMES_RESSOURCE
  registry$scalar$remplacer <- function(...) { ecritures <<- ecritures + 1L }
  local_mocked_bindings(
    lire_listing_live_registre = function(con) data.frame(ressource = character(),
      version = character()),
    ecrire_recette_ressource = function(...) { recettes <<- recettes + 1L; invisible(TRUE) },
    ecrire_recette_locale = function(...) "x.json",
    REGISTRE_FORMES_RESSOURCE = registry)
  local_mocked_bindings(
    dbWithTransaction = function(con, expr) force(expr),
    dbGetQuery = function(con, sql, params = list()) {
      if (grepl("table_publication WHERE table_name='territory_reference'", sql,
                fixed = TRUE)) return(data.frame(content_version = "other-reference"))
      data.frame()
    },
    .package = "DBI")
  err <- tryCatch(apply_publication("densite", root = root,
    registre = fixture_apply_registre_lock(), con = structure(list(), class = "mock")),
    error = identity)
  expect_s3_class(err, "erreur_apply")
  expect_identical(err$refus, "reference_divergente")
  expect_match(conditionMessage(err),
    "reference_divergente: live other-reference, artefact reference-v1", fixed = TRUE)
  expect_identical(ecritures, 0L)
  expect_identical(recettes, 0L)
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
    dbGetQuery = fixture_dbget_reference(),
    .package = "DBI")
  resultat <- apply_publication("densite", retire = TRUE, root = root,
    registre = fixture_apply_registre_lock(), con = structure(list(), class = "mock"))
  expect_identical(retires, "densite")
  expect_identical(recettes_db[[1]]$operation, "retire")
})

test_that("apply of a NEW scalar emits the full insert set; existing is scoped", {
  root <- artefacts_fixture_root()
  on.exit(unlink(root, recursive = TRUE), add = TRUE)
  fixture_apply_magasin(root)
  listing <- lister_artefacts_ressource(root)
  version_densite <- listing$version[listing$ressource == "densite"]
  version_offre <- listing$version[listing$ressource == "offre_tc"]
  live <- data.frame(ressource = character(), version = character())  # changed per case
  appels <- list()
  enregistrer <- function(sql, params = list()) {
    appels[[length(appels) + 1L]] <<- list(sql = sql, params = params)
  }
  local_mocked_bindings(
    lire_listing_live_registre = function(con) live,
    ecrire_recette_locale = function(...) "x.json")
  local_mocked_bindings(
    dbWithTransaction = function(con, expr) force(expr),
    dbExecute = function(con, sql, params = list()) { enregistrer(sql, params); 0L },
    dbGetQuery = fixture_dbget_reference(),
    dbWriteTable = function(con, name, value, ...) {
      enregistrer(paste0("WRITETABLE ", name)); nrow(value)
    },
    dbQuoteString = function(con, x) paste0("'", gsub("'", "''", as.character(x)), "'"),
    .package = "DBI")

  sqls <- function() vapply(appels, `[[`, character(1), "sql")

  # Case A — resource absent live: full insert set, no reliance on a prior row.
  appels <<- list()
  apply_publication("densite", root = root, registre = fixture_apply_registre_lock(),
                    con = structure(list(), class = "mock"))
  for (attendu in c("INSERT INTO source_dataset", "INSERT INTO source_vintage",
                    "INSERT INTO scalar_descriptor\\(", "INSERT INTO scalar_descriptor_source",
                    "WRITETABLE scalar_observation$", "WRITETABLE scalar_observation_source",
                    "WRITETABLE scalar_comparison_group", "WRITETABLE scalar_comparison_territory",
                    "WRITETABLE comparison_source_lineage",
                    "INSERT INTO scalar_resource_comparison_publication",
                    "INSERT INTO resource_publication\\(", "INSERT INTO resource_publication_event"))
    expect_true(any(grepl(attendu, sqls())), attendu)

  # Case B — both resources live: every delete/param is scoped to densite and
  # offre_tc is never named in any SQL or bound parameter.
  appels <<- list()
  live <- data.frame(ressource = c("densite", "offre_tc"),
                     version = c(version_densite, version_offre))
  apply_publication("densite", root = root, registre = fixture_apply_registre_lock(),
                    con = structure(list(), class = "mock"))
  deletes <- appels[grepl("^DELETE", vapply(appels, `[[`, character(1), "sql"))]
  expect_true(length(deletes) >= 6L)
  expect_true(all(vapply(deletes, function(a)
    identical(as.character(a$params), "densite"), logical(1))))
  expect_false(any(grepl("offre_tc", sqls(), fixed = TRUE)))
  expect_false(any(vapply(appels, function(a)
    any(grepl("offre_tc", as.character(a$params), fixed = TRUE)), logical(1))))
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
    dbGetQuery = fixture_dbget_reference(),
    .package = "DBI")
  apply_publication(paste0("densite@", version0), root = root,
    registre = fixture_apply_registre_lock(), con = structure(list(), class = "mock"))
  expect_identical(versions_utilisees, version0)
})
