# DB-free proofs that adoption carries the LIVE comparison token over into the
# per-resource markers through the SAME writers apply uses (#1142, round 9).

test_that("scalar adoption writes the marker with the live token, counts and reference", {
  vu <- NULL
  local_mocked_bindings(ecrire_marqueur_comparaison_scalaire = function(con, ressource, ...) {
    vu <<- c(list(ressource = ressource), list(...)); invisible(TRUE) })
  artefact <- list(contenu = list(comparison = list(content_version = "artefact-token",
    scalar_content_version = "faits-v")))
  live <- list(
    scalar_comparison_group = data.frame(g = 1:3), scalar_comparison_territory = data.frame(t = 1:7),
    comparison_source_lineage = data.frame(comparison_content_version = c("global", "global")))
  res <- marqueur_adoption_scalaire(NULL, "densite", artefact, live, list(version = "ref-v"))
  expect_identical(res, list(table = "scalar_resource_comparison_publication",
                             content_version = "global"))
  expect_identical(vu$ressource, "densite")
  expect_identical(vu$content_version, "global")           # the live token, not the artefact's
  expect_identical(vu$scalar_content_version, "faits-v")
  expect_identical(vu$reference_content_version, "ref-v")
  expect_identical(c(vu$groupes, vu$territoires, vu$lignage), c(3L, 7L, 2L))

  # no live lineage rows: nothing to carry, the artefact's own token is used
  live$comparison_source_lineage <- live$comparison_source_lineage[0L, , drop = FALSE]
  expect_identical(marqueur_adoption_scalaire(NULL, "densite", artefact, live,
    list(version = "ref-v"))$content_version, "artefact-token")
  # no comparison in the artefact: no marker at all
  expect_null(marqueur_adoption_scalaire(NULL, "x", list(contenu = list(comparison = NULL)),
    live, list(version = "r")))
  # two distinct live tokens cannot be carried into ONE marker
  live$comparison_source_lineage <- data.frame(comparison_content_version = c("a", "b"))
  err <- tryCatch(marqueur_adoption_scalaire(NULL, "densite", artefact, live,
    list(version = "r")), error = identity)
  expect_s3_class(err, "erreur_adoption")
  expect_identical(err$refus, "jeton_comparaison_multiple")
})

test_that("profile adoption carries both live tokens through the shared writer", {
  vu <- NULL
  local_mocked_bindings(ecrire_marqueur_comparaison_profil = function(con, ressource, ...) {
    vu <<- c(list(ressource = ressource), list(...)); invisible(TRUE) })
  artefact <- list(contenu = list(comparison = list(content_version = "cv-art",
    profile_content_version = "pv-art")))
  live <- list(
    profile_comparison_group = data.frame(profile_content_version = "pv-live"),
    profile_comparison_territory = data.frame(profile_content_version = rep("pv-live", 4)),
    comparison_source_lineage = data.frame(comparison_content_version = "cv-live"))
  res <- marqueur_adoption_profil(NULL, "structure_age", artefact, live, list(version = "ref"))
  expect_identical(res$table, "profile_resource_comparison_publication")
  expect_identical(vu$content_version, "cv-live")
  expect_identical(vu$profile_content_version, "pv-live")
  expect_identical(c(vu$groupes, vu$territoires, vu$lignage), c(1L, 4L, 1L))
  # group and territory rows disagreeing on the profile token: refusal
  live$profile_comparison_territory$profile_content_version[[1L]] <- "autre"
  expect_error(marqueur_adoption_profil(NULL, "structure_age", artefact, live,
    list(version = "ref")), "jeton_comparaison_multiple")
  # declared scalar-backed placeholder (no live rows): the artefact's minted tokens
  vide <- list(profile_comparison_group = data.frame(profile_content_version = character()),
    profile_comparison_territory = data.frame(profile_content_version = character()),
    comparison_source_lineage = data.frame(comparison_content_version = character()))
  res <- marqueur_adoption_profil(NULL, "distribution_dpe", artefact, vide, list(version = "ref"))
  expect_identical(c(res$content_version, vu$profile_content_version), c("cv-art", "pv-art"))
})

test_that("the marker writers are shared with apply and adoption writes through the registry hook", {
  for (f in c("remplacer_scalaire", "remplacer_profil_declare")) {
    corps <- paste(deparse(get(f)), collapse = "\n")
    expect_false(grepl("INSERT INTO (scalar|profile)_resource_comparison_publication", corps), info = f)
    expect_true(grepl("ecrire_marqueur_comparaison_", corps), info = f)
  }
  expect_identical(REGISTRE_FORMES_RESSOURCE$scalar$marqueur_adoption, marqueur_adoption_scalaire)
  expect_identical(REGISTRE_FORMES_RESSOURCE$declared_profile$marqueur_adoption,
                   marqueur_adoption_profil)
  # adoption itself contains no SQL for them: it only calls the hook.
  adopt <- paste(deparse(adopter_artefacts), collapse = "\n")
  expect_false(grepl("resource_comparison_publication", adopt))
  expect_true(grepl("marqueur_adoption", adopt, fixed = TRUE))
  # the two writers are the single definition of each INSERT in all of pipeline/R
  for (tabla in c("scalar", "profile")) {
    n <- sum(vapply(list.files(testthat::test_path("..", "..", "R"), full.names = TRUE,
      pattern = "\\.R$"), function(f) sum(grepl(
        paste0("INSERT INTO ", tabla, "_resource_comparison_publication"),
        readLines(f, warn = FALSE))), numeric(1)))
    expect_equal(n, 1, info = tabla)
  }
})

test_that("the adoption receipt records which comparison token was adopted", {
  recettes <- NULL
  artefacts <- list(a = list(version = "va", forme = "scalar", digests_lignage = list(),
    rows = list(facts = data.frame(territory_id = "c1", value = 1))))
  builds <- data.frame(ressource = "a", forme = "scalar", version = "va", stringsAsFactors = FALSE)
  handler <- list(projeter = function(a) a$rows, lignes_persistees = function(a) a$rows,
    lire_live = function(...) list(facts = data.frame(territory_id = "c1", value = 1)),
    colonnes_stockage = list(),
    marqueur_adoption = function(con, id, artefact, live, reference)
      list(table = "scalar_resource_comparison_publication", content_version = "global-token"))
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
