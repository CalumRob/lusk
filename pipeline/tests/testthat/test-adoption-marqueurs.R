# DB-free proofs that adoption carries the LIVE comparison tokens over into the
# per-resource markers through the SAME writers apply uses, never inventing a token and
# never overwriting an existing marker (#1142, rounds 9-10).

scalaire_vivant <- function(jetons = c("global", "global"), existant = NULL) {
  live <- list(
    scalar_comparison_group = data.frame(g = 1:3),
    scalar_comparison_territory = data.frame(t = 1:7),
    comparison_source_lineage = data.frame(comparison_content_version = jetons))
  attr(live, "marqueur_existant") <- existant
  live
}
artefact_scalaire <- list(forme = "scalar", contenu = list(comparison = list(
  content_version = "artefact-token", scalar_content_version = "faits-v",
  groups = data.frame(g = 1))))

test_that("scalar adoption plans the marker from the live token, counts and reference", {
  vu <- NULL
  local_mocked_bindings(ecrire_marqueur_comparaison_scalaire = function(con, ressource, ...) {
    vu <<- c(list(ressource = ressource), list(...)); invisible(TRUE) })
  plan <- planifier_marqueur_adoption_scalaire("densite", artefact_scalaire, scalaire_vivant(),
    list(version = "ref-v"))
  expect_identical(plan$table, "scalar_resource_comparison_publication")
  expect_identical(plan$content_version, "global")        # the live token, never the artefact's
  expect_false(plan$identique)
  ecrire_marqueur_adoption(NULL, plan)
  expect_identical(vu[[2L]], "global")   # [[1]] is the resource id
  expect_identical(vu[[4L]], "ref-v")
  expect_identical(vu[[5L]], 3L)
  expect_false(vu$ecraser)                                  # adoption never overwrites
  # no comparison, or a rowless placeholder: no marker
  expect_null(planifier_marqueur_adoption_scalaire("x", list(contenu = list(comparison = NULL)),
    scalaire_vivant(), list(version = "r")))
})

test_that("a missing live token is refused with a typed reason, never invented", {
  live <- scalaire_vivant(jetons = character())
  err <- tryCatch(planifier_marqueur_adoption_scalaire("densite", artefact_scalaire, live,
    list(version = "r")), error = identity)
  expect_s3_class(err, "erreur_adoption")
  expect_identical(err$refus, "jeton_comparaison_absent")
  expect_false(grepl("artefact-token", conditionMessage(err), fixed = TRUE))
  live <- scalaire_vivant(jetons = c(NA, ""))
  expect_identical(tryCatch(planifier_marqueur_adoption_scalaire("densite", artefact_scalaire,
    live, list(version = "r")), error = identity)$refus, "jeton_comparaison_absent")
  # two distinct live tokens cannot be carried into ONE marker
  err <- tryCatch(planifier_marqueur_adoption_scalaire("densite", artefact_scalaire,
    scalaire_vivant(jetons = c("a", "b")), list(version = "r")), error = identity)
  expect_identical(err$refus, "jeton_comparaison_multiple")
})

test_that("the scalar marker's scalar_content_version is the token the live dependents carry", {
  vu <- NULL
  local_mocked_bindings(ecrire_marqueur_comparaison_scalaire = function(con, ressource, ...) {
    vu <<- list(...); invisible(TRUE) })
  dependants <- function(...) {
    live <- scalaire_vivant()
    attr(live, "dependants_vivants") <- data.frame(
      indicator_id = paste0("p", seq_along(c(...))), required_scalar_version = c(...),
      stringsAsFactors = FALSE)
    live
  }
  plan <- planifier_marqueur_adoption_scalaire("part_passoires", artefact_scalaire,
    dependants("token-global-scalaire"), list(version = "r"))
  ecrire_marqueur_adoption(NULL, plan)
  expect_identical(vu[[2L]], "token-global-scalaire")
  # SUBSET HOLE: the dependents come from the live descriptor of the same session, so an
  # adopt run that holds NEITHER the dependent's artefact NOR its reading (empty
  # `artefacts` / `lectures`) still carries the dependent's token, not the fallback.
  plan <- planifier_marqueur_adoption_scalaire("part_passoires", artefact_scalaire,
    dependants("token-global-scalaire"), list(version = "r"), lectures = list(),
    artefacts = list())
  ecrire_marqueur_adoption(NULL, plan)
  expect_identical(vu[[2L]], "token-global-scalaire")
  expect_false(identical(vu[[2L]], "faits-v"))
  # no live dependent: the artefact's own facts version (nobody reads it)
  plan <- planifier_marqueur_adoption_scalaire("densite", artefact_scalaire, scalaire_vivant(),
    list(version = "r"))
  ecrire_marqueur_adoption(NULL, plan)
  expect_identical(vu[[2L]], "faits-v")
  # live dependents carrying two different tokens: refused
  err <- tryCatch(planifier_marqueur_adoption_scalaire("part_passoires", artefact_scalaire,
    dependants("a", "b"), list(version = "r")), error = identity)
  expect_identical(err$refus, "jeton_comparaison_multiple")
  # the live reader asks the database for them (one positional query, keyed by scalar)
  sql <- NULL; params <- NULL
  local_mocked_bindings(.adoption_query = function(con, sql_, params_ = NULL) {
    sql <<- sql_; params <<- params_; data.frame() })
  .adoption_dependants_vivants(NULL, "part_passoires")
  expect_match(sql, "FROM profile_descriptor WHERE comparison_scalar=$1", fixed = TRUE)
  expect_identical(params, list("part_passoires"))
})

test_that("profile adoption carries both live tokens; a rowless placeholder writes nothing", {
  vu <- NULL
  local_mocked_bindings(ecrire_marqueur_comparaison_profil = function(con, ressource, ...) {
    vu <<- list(...); invisible(TRUE) })
  artefact <- list(contenu = list(comparison = list(content_version = "cv-art",
    profile_content_version = "pv-art", groups = data.frame(g = 1))))
  live <- list(
    profile_comparison_group = data.frame(profile_content_version = "pv-live"),
    profile_comparison_territory = data.frame(profile_content_version = rep("pv-live", 4)),
    comparison_source_lineage = data.frame(comparison_content_version = "cv-live"))
  plan <- planifier_marqueur_adoption_profil("structure_age", artefact, live, list(version = "ref"))
  expect_identical(plan$table, "profile_resource_comparison_publication")
  expect_identical(plan$content_version, "cv-live")
  ecrire_marqueur_adoption(NULL, plan)
  expect_identical(vu[[2L]], "pv-live")
  expect_identical(c(vu[[4L]], vu[[5L]], vu[[6L]]), c(1L, 4L, 1L))
  # group and territory rows disagreeing on the profile token: refusal
  live$profile_comparison_territory$profile_content_version[[1L]] <- "autre"
  expect_error(planifier_marqueur_adoption_profil("structure_age", artefact, live,
    list(version = "ref")), "jeton_comparaison_multiple")
  # no live profile token at all while the comparison has rows: refusal, not the artefact's
  live$profile_comparison_group <- live$profile_comparison_group[0L, , drop = FALSE]
  live$profile_comparison_territory <- live$profile_comparison_territory[0L, , drop = FALSE]
  expect_identical(tryCatch(planifier_marqueur_adoption_profil("structure_age", artefact, live,
    list(version = "ref")), error = identity)$refus, "jeton_comparaison_absent")
  # declared scalar-backed placeholder: rowless comparison, nothing to carry, no marker
  placeholder <- list(contenu = list(comparison = list(content_version = "cv",
    profile_content_version = "pv")))
  expect_null(planifier_marqueur_adoption_profil("distribution_dpe", placeholder, live,
    list(version = "ref")))
})

test_that("an existing marker is a no-op when identical and a typed refusal when it differs", {
  vu <- 0L
  local_mocked_bindings(ecrire_marqueur_comparaison_scalaire = function(...) {
    vu <<- vu + 1L; invisible(TRUE) })
  existant <- data.frame(indicator_id = "densite", content_version = "global",
    scalar_content_version = "faits-v", reference_content_version = "ref-v",
    group_row_count = 3L, territory_row_count = 7L, lineage_row_count = 2L)
  plan <- planifier_marqueur_adoption_scalaire("densite", artefact_scalaire,
    scalaire_vivant(existant = existant), list(version = "ref-v"))
  expect_true(plan$identique)
  ecrire_marqueur_adoption(NULL, plan)
  expect_identical(vu, 0L)                                  # nothing written
  existant$content_version <- "autre-jeton"
  err <- tryCatch(planifier_marqueur_adoption_scalaire("densite", artefact_scalaire,
    scalaire_vivant(existant = existant), list(version = "ref-v")), error = identity)
  expect_s3_class(err, "erreur_adoption")
  expect_identical(err$refus, "marqueur_existant_divergent")
  expect_match(conditionMessage(err), "content_version", fixed = TRUE)
  expect_identical(vu, 0L)
})

test_that("a divergent existing marker refuses the whole adoption before any write, dry-run included", {
  artefacts <- list(a = list(version = "va", forme = "scalar", digests_lignage = list(),
    rows = list(facts = data.frame(territory_id = "c1", value = 1))))
  builds <- data.frame(ressource = "a", forme = "scalar", version = "va", stringsAsFactors = FALSE)
  handler <- list(projeter = function(a) a$rows, lignes_persistees = function(a) a$rows,
    lire_live = function(...) list(facts = data.frame(territory_id = "c1", value = 1)),
    colonnes_stockage = list(),
    planifier_marqueur_adoption = function(...)
      stop(erreur_adoption("marqueur_existant_divergent", "marqueur_existant_divergent: x")))
  ecritures <- 0L
  local_mocked_bindings(
    REGISTRE_FORMES_RESSOURCE = list(scalar = handler),
    verifier_gel_lignage_ressource = function(...) TRUE,
    lire_reference_live_apply = function(con) list(version = "r", rows = data.frame()),
    verifier_reference_live_apply = function(...) TRUE,
    ecrire_registre_ressource = function(...) { ecritures <<- ecritures + 1L },
    ecrire_descripteurs_ressource = function(...) { ecritures <<- ecritures + 1L },
    ecrire_recette_ressource = function(...) { ecritures <<- ecritures + 1L },
    ecrire_recette_locale = function(...) { ecritures <<- ecritures + 1L })
  local_mocked_bindings(dbWithTransaction = function(con, expr) force(expr),
    dbExecute = function(...) 1L, dbGetQuery = function(...) data.frame(), .package = "DBI")
  for (sec in c(FALSE, TRUE)) {
    err <- tryCatch(adopter_artefacts(builds, artefacts, dry_run = sec,
      con = structure(list(), class = "mock")), error = identity)
    if (!sec) expect_identical(err$refus, "ressource_divergente")
    else expect_false(inherits(err, "error"))        # dry-run reports, never raises
  }
  res <- comparer_adoption_artefacts(artefacts, list(a = handler$lire_live()), list(),
    list(version = "r"))
  expect_false(res$identique)
  expect_identical(res$motif, "marqueur_existant_divergent")
  expect_identical(ecritures, 0L)
})

test_that("the marker writers are shared with apply; adoption only calls the plan hook", {
  for (f in c("remplacer_scalaire", "remplacer_profil_declare")) {
    corps <- paste(deparse(get(f)), collapse = "\n")
    expect_false(grepl("INSERT INTO (scalar|profile)_resource_comparison_publication", corps), info = f)
    expect_true(grepl("ecrire_marqueur_comparaison_", corps), info = f)
    expect_false(grepl("ecraser", corps), info = f)         # apply keeps the upsert default
  }
  expect_true(formals(ecrire_marqueur_comparaison_scalaire)$ecraser)
  expect_true(formals(ecrire_marqueur_comparaison_profil)$ecraser)
  expect_identical(REGISTRE_FORMES_RESSOURCE$scalar$planifier_marqueur_adoption,
                   planifier_marqueur_adoption_scalaire)
  expect_identical(REGISTRE_FORMES_RESSOURCE$declared_profile$planifier_marqueur_adoption,
                   planifier_marqueur_adoption_profil)
  adopt <- paste(deparse(adopter_artefacts), collapse = "\n")
  expect_false(grepl("resource_comparison_publication", adopt))
  expect_true(grepl("planifier_marqueur_adoption", adopt, fixed = TRUE))
  for (tabla in c("scalar", "profile")) {
    n <- sum(vapply(list.files(testthat::test_path("..", "..", "R"), full.names = TRUE,
      pattern = "\\.R$"), function(f) sum(grepl(
        paste0("INSERT INTO ", tabla, "_resource_comparison_publication"),
        readLines(f, warn = FALSE))), numeric(1)))
    expect_equal(n, 1, info = tabla)
  }
  # the plain-INSERT form (adoption) has no ON CONFLICT clause at all
  sql <- NULL
  local_mocked_bindings(dbExecute = function(con, statement, params = NULL, ...) {
    sql <<- c(sql, statement); 1L }, .package = "DBI")
  ecrire_marqueur_comparaison_scalaire(NULL, "x", "c", "s", "r", 1, 1, 1, ecraser = FALSE)
  ecrire_marqueur_comparaison_scalaire(NULL, "x", "c", "s", "r", 1, 1, 1)
  expect_false(grepl("ON CONFLICT", sql[[1L]], fixed = TRUE))
  expect_true(grepl("ON CONFLICT", sql[[2L]], fixed = TRUE))
})

test_that("the adoption receipt records which comparison token was adopted", {
  recettes <- NULL
  artefacts <- list(a = list(version = "va", forme = "scalar", digests_lignage = list(),
    rows = list(facts = data.frame(territory_id = "c1", value = 1))))
  builds <- data.frame(ressource = "a", forme = "scalar", version = "va", stringsAsFactors = FALSE)
  handler <- list(projeter = function(a) a$rows, lignes_persistees = function(a) a$rows,
    lire_live = function(...) list(facts = data.frame(territory_id = "c1", value = 1)),
    colonnes_stockage = list(),
    planifier_marqueur_adoption = function(...)
      list(table = "scalar_resource_comparison_publication", content_version = "global-token",
           identique = TRUE, ecrire = function(con) stop("must not write")))
  local_mocked_bindings(
    REGISTRE_FORMES_RESSOURCE = list(scalar = handler),
    verifier_gel_lignage_ressource = function(...) TRUE,
    lire_reference_live_apply = function(con) list(version = "r", rows = data.frame()),
    verifier_reference_live_apply = function(...) TRUE,
    ecrire_registre_ressource = function(...) TRUE,
    ecrire_descripteurs_ressource = function(...) TRUE,
    ecrire_recette_ressource = function(...) TRUE,
    ecrire_recette_locale = function(recette, ...) { recettes <<- recette })
  local_mocked_bindings(dbWithTransaction = function(con, expr) force(expr),
    dbExecute = function(...) 1L, dbGetQuery = function(...) data.frame(), .package = "DBI")
  adopter_artefacts(builds, artefacts, con = structure(list(), class = "mock"))
  expect_identical(recettes$comparison_token, "global-token")
  expect_identical(recettes$comparison_marker, "scalar_resource_comparison_publication")
})
