test_that("adoption compares the real projected artefact rows and names each differing part", {
  root <- artefacts_fixture_root()
  on.exit(unlink(root, recursive = TRUE), add = TRUE)
  projection <- artefacts_fixture_scalar_indicator("a", "src_a", c(10, 10, 5, 3, NA))
  reference <- artefacts_fixture_reference()
  comparison <- comparaison_scalaire_ressource(projection, "a", reference)
  contenu <- contenu_artefact(
    faits_forme(REGISTRE_FORMES_RESSOURCE[["scalar"]], projection),
    projection$descriptors, projection$provenance, comparison)
  ecrit <- ecrire_artefact_ressource("a", "scalar", contenu,
    digests_lignage = digests_lignage_ressource("src_a", artefacts_fixture_digests("src_a")),
    root = root)
  artefact <- lire_artefact_ressource("a", ecrit$version, root = root)
  handler <- REGISTRE_FORMES_RESSOURCE[["scalar"]]
  attendu <- handler$projeter(artefact)

  equal <- comparer_ressource_adoptation(attendu, attendu, handler)
  expect_true(equal$identique)
  expect_length(equal$parties, 0L)

  # PostgreSQL storage clocks are not Artefact de ressource content.
  live <- attendu
  live$observations$published_at <- as.POSIXct("2026-01-01", tz = "UTC")
  expect_true(comparer_ressource_adoptation(attendu, live, handler)$identique)

  live <- attendu
  live$observations$value[1L] <- live$observations$value[1L] + 1
  live$descriptor$label[1L] <- "Changed"
  live$comparison$territories$rank[1L] <- 999L
  different <- comparer_ressource_adoptation(attendu, live, handler)
  expect_false(different$identique)
  expect_setequal(different$parties, c("observations", "descriptor",
                                      "comparison.territories"))
})

fixture_adoption_run <- function(values_a = 1, values_b = 2, live_b = 2,
                                 dry_run = FALSE) {
  artefacts <- list(
    a = list(version = "va", forme = "scalar", digests_lignage = list(),
             rows = list(facts = data.frame(territory_id = "c1", value = values_a))),
    b = list(version = "vb", forme = "scalar", digests_lignage = list(),
             rows = list(facts = data.frame(territory_id = "c1", value = values_b))))
  builds <- data.frame(ressource = c("a", "b"), forme = "scalar",
                       version = c("va", "vb"), stringsAsFactors = FALSE)
  handler <- list(projeter = function(a) a$rows,
    lire_live = function(con, ressource, reference)
      list(facts = data.frame(territory_id = "c1",
                              value = if (ressource == "a") values_a else live_b)),
    champs_live = "facts", colonnes_stockage = list(), champs_comparaison = character(),
    remplacer = function(...) stop("adoption must never replace serving rows"))
  ecritures <- 0L; recettes <- 0L; locales <- 0L
  local_mocked_bindings(
    REGISTRE_FORMES_RESSOURCE = list(scalar = handler),
    verifier_gel_lignage_ressource = function(...) TRUE,
    lire_reference_live_apply = function(con)
      list(version = "reference-v1", rows = data.frame()),
    verifier_reference_live_apply = function(...) TRUE,
    ecrire_registre_ressource = function(...) { ecritures <<- ecritures + 1L },
    ecrire_recette_ressource = function(...) { recettes <<- recettes + 1L },
    ecrire_recette_locale = function(...) { locales <<- locales + 1L })
  local_mocked_bindings(
    dbWithTransaction = function(con, expr) force(expr),
    dbExecute = function(...) 1L,
    dbGetQuery = function(...) data.frame(), .package = "DBI")
  resultat <- tryCatch(adopter_artefacts(builds, artefacts, dry_run = dry_run,
    con = structure(list(), class = "mock")), error = identity)
  list(resultat = resultat, ecritures = ecritures, recettes = recettes,
       locales = locales)
}

test_that("adoption refuses every mismatching resource before any registry or receipt write", {
  run <- fixture_adoption_run(live_b = 99)
  expect_s3_class(run$resultat, "erreur_adoption")
  expect_identical(run$resultat$refus, "ressource_divergente")
  expect_match(conditionMessage(run$resultat), "b", fixed = TRUE)
  expect_match(conditionMessage(run$resultat), "facts", fixed = TRUE)
  expect_identical(run$ecritures, 0L)
  expect_identical(run$recettes, 0L)
  expect_identical(run$locales, 0L)
})

test_that("adoption writes only registry rows and adopted receipts, and dry-run writes nothing", {
  run <- fixture_adoption_run()
  expect_identical(run$resultat$adopted, c("a", "b"))
  expect_identical(run$ecritures, 2L)
  expect_identical(run$recettes, 2L)
  expect_identical(run$locales, 2L)
  expect_identical(vapply(run$resultat$receipts, `[[`, character(1), "operation"),
                   c("adopted", "adopted"))

  sec <- fixture_adoption_run(dry_run = TRUE)
  expect_identical(sec$resultat$adopted, character())
  expect_identical(sec$ecritures, 0L)
  expect_identical(sec$recettes, 0L)
  expect_identical(sec$locales, 0L)
})

test_that("splitter binds profile, series and collection comparisons to their resource facts", {
  reference <- artefacts_fixture_reference()
  profile <- artefacts_fixture_profile_artefact()$artefact$contenu
  projection <- list(descriptor = profile$descriptor, facts = profile$faits$facts,
    axes = profile$faits$axes, provenance = profile$provenance,
    datasets = profile$faits$datasets, vintages = profile$faits$vintages)
  cmp <- comparaison_profil_ressource(projection, "distribution_dpe", reference)
  expect_identical(cmp$reference_content_version, reference$content_version)

  serie <- adaptateur_series_projection()
  serie$descriptor$comparison_levels <- c("commune")
  serie$descriptor$comparison_axis_values <- c("M2", "M3")
  serie$descriptor$direction <- "high"
  serie$descriptor$comparison_point <- "M3"
  serie$descriptor$comparison_statistic <- "median"
  cmp <- comparaison_series_ressource(serie, "artif_par_habitant", reference)
  expect_identical(cmp$reference_content_version, reference$content_version)
  expect_true(nrow(cmp$groups) > 0L)

  collection <- adaptateur_collection_projection()
  cmp <- comparaison_collection_ressource(collection, "acv", reference)
  expect_identical(cmp$reference_content_version, reference$content_version)
  expect_true(nrow(cmp$groups) > 0L)
})

test_that("every shape's adoption reader contract compares its real adapter projection", {
  root <- artefacts_fixture_root()
  on.exit(unlink(root, recursive = TRUE), add = TRUE)
  artefacts <- list(
    declared_profile = artefacts_fixture_profile_artefact(root = root)$artefact,
    owned_series = adaptateur_series_artefact(root),
    observed_collection = adaptateur_collection_artefact(root),
    aedar = adaptateur_aedar_artefact(root))
  for (forme in names(artefacts)) {
    handler <- REGISTRE_FORMES_RESSOURCE[[forme]]
    attendu <- handler$projeter(artefacts[[forme]])
    expect_true(comparer_ressource_adoptation(attendu, attendu, handler)$identique,
                info = forme)
    live <- attendu
    if (!is.null(live$comparison$groups) && nrow(live$comparison$groups))
      live$comparison$groups[1L, 1L] <- "changed"
    else if (!is.null(live$projection$points) && nrow(live$projection$points))
      live$projection$points$value[1L] <- live$projection$points$value[1L] + 1
    else if (!is.null(live$projection$facts) && nrow(live$projection$facts))
      live$projection$facts$value[1L] <- live$projection$facts$value[1L] + 1
    else live$descriptor$label[1L] <- "changed"
    expect_false(comparer_ressource_adoptation(attendu, live, handler)$identique,
                 info = forme)
  }
})
