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
  attendu <- handler$lignes_persistees(artefact)

  equal <- comparer_lignes_persistees(attendu, attendu, handler)
  expect_true(equal$identique)
  expect_length(equal$parties, 0L)

  # PostgreSQL storage clocks are not Artefact de ressource content.
  live <- attendu
  live$scalar_observation$published_at <- as.POSIXct("2026-01-01", tz = "UTC")
  live$scalar_observation <- live$scalar_observation[
    rev(seq_len(nrow(live$scalar_observation))), , drop = FALSE]
  rownames(live$scalar_observation) <- paste0("storage-",
    seq_len(nrow(live$scalar_observation)))
  expect_true(comparer_lignes_persistees(attendu, live, handler)$identique)

  live <- attendu
  live$scalar_observation$value[1L] <- live$scalar_observation$value[1L] + 1
  live$scalar_descriptor$label[1L] <- "Changed"
  live$scalar_comparison_territory$rank[1L] <- 999L
  different <- comparer_lignes_persistees(attendu, live, handler)
  expect_false(different$identique)
  expect_setequal(different$parties, c("scalar_observation", "scalar_descriptor",
                                      "scalar_comparison_territory"))
})

fixture_adoption_run <- function(values_a = 1, values_b = 2, live_a = values_a,
                                 live_b = 2, dry_run = FALSE) {
  artefacts <- list(
    a = list(version = "va", forme = "scalar", digests_lignage = list(),
             rows = list(facts = data.frame(territory_id = "c1", value = values_a))),
    b = list(version = "vb", forme = "scalar", digests_lignage = list(),
             rows = list(facts = data.frame(territory_id = "c1", value = values_b))))
  builds <- data.frame(ressource = c("a", "b"), forme = "scalar",
                       version = c("va", "vb"), stringsAsFactors = FALSE)
  handler <- list(projeter = function(a) a$rows,
    lignes_persistees = function(a) a$rows,
    lire_live = function(con, ressource, reference, attendu, ...)
      list(facts = data.frame(territory_id = "c1",
                              value = if (ressource == "a") live_a else live_b)),
    colonnes_stockage = list(),
    remplacer = function(...) stop("adoption must never replace serving rows"))
  ecritures <- 0L; descripteurs <- 0L; recettes <- 0L; locales <- 0L
  local_mocked_bindings(
    REGISTRE_FORMES_RESSOURCE = list(scalar = handler),
    verifier_gel_lignage_ressource = function(...) TRUE,
    lire_reference_live_apply = function(con)
      list(version = "reference-v1", rows = data.frame()),
    verifier_reference_live_apply = function(...) TRUE,
    ecrire_registre_ressource = function(...) { ecritures <<- ecritures + 1L },
    ecrire_descripteurs_ressource = function(...) { descripteurs <<- descripteurs + 1L },
    ecrire_recette_ressource = function(...) { recettes <<- recettes + 1L },
    ecrire_recette_locale = function(...) { locales <<- locales + 1L })
  local_mocked_bindings(
    dbWithTransaction = function(con, expr) force(expr),
    dbExecute = function(...) 1L,
    dbGetQuery = function(...) data.frame(), .package = "DBI")
  resultat <- tryCatch(adopter_artefacts(builds, artefacts, dry_run = dry_run,
    con = structure(list(), class = "mock")), error = identity)
  list(resultat = resultat, ecritures = ecritures, descripteurs = descripteurs,
       recettes = recettes, locales = locales)
}

test_that("adoption refuses every mismatching resource before any registry or receipt write", {
  run <- fixture_adoption_run(live_a = 9, live_b = 99)
  expect_s3_class(run$resultat, "erreur_adoption")
  expect_identical(run$resultat$refus, "ressource_divergente")
  expect_match(conditionMessage(run$resultat), "a (facts)", fixed = TRUE)
  expect_match(conditionMessage(run$resultat), "b (facts)", fixed = TRUE)
  expect_identical(run$resultat$comparaisons$ressource, c("a", "b"))
  expect_identical(run$resultat$comparaisons$parties, c("facts", "facts"))
  expect_false(any(run$resultat$comparaisons$identique))
  expect_identical(run$ecritures, 0L)
  expect_identical(run$descripteurs, 0L)
  expect_identical(run$recettes, 0L)
  expect_identical(run$locales, 0L)
})

test_that("adoption writes only registry rows and adopted receipts, and dry-run writes nothing", {
  run <- fixture_adoption_run()
  expect_identical(run$resultat$adopted, c("a", "b"))
  expect_identical(run$ecritures, 2L)
  expect_identical(run$descripteurs, 2L)
  expect_identical(run$recettes, 2L)
  expect_identical(run$locales, 2L)
  expect_identical(vapply(run$resultat$receipts, `[[`, character(1), "operation"),
                   c("adopted", "adopted"))

  sec <- fixture_adoption_run(dry_run = TRUE)
  expect_identical(sec$resultat$adopted, character())
  expect_identical(sec$ecritures, 0L)
  expect_identical(sec$descripteurs, 0L)
  expect_identical(sec$recettes, 0L)
  expect_identical(sec$locales, 0L)
})

test_that("AEDAR adoption reads only persisted tables and never invents a theme identity", {
  handler <- REGISTRE_FORMES_RESSOURCE[["aedar"]]
  expect_identical(handler$lignes_persistees, lignes_aedar_persistees)
  expect_false(grepl("lire_theme_metadata", paste(deparse(lire_live_aedar), collapse = "")))
  expect_false(grepl("descriptor", paste(deparse(lire_live_aedar), collapse = "")))
})

test_that("persisted-row comparison names every mismatching table and ignores declared storage columns", {
  attendu <- list(
    facts = data.frame(territory_id = c("c1", "c2"), value = c(1, 2),
                       published_at = as.POSIXct(NA)),
    descriptor = data.frame(indicator_id = "a", label = "A"),
    comparison = data.frame(group_id = "g", median = 1))
  live <- attendu
  live$facts$value[1L] <- 9
  live$facts$published_at <- as.POSIXct("2026-01-01", tz = "UTC")
  live$descriptor$label <- "Changed"
  live$comparison$median <- 2
  handler <- list(colonnes_stockage = list(facts = "published_at"))
  resultat <- comparer_lignes_persistees(attendu, live, handler)
  expect_false(resultat$identique)
  expect_setequal(resultat$parties, c("facts", "descriptor", "comparison"))
})

test_that("profile adoption accepts only the exact global-to-resource scalar binding chain", {
  dependance <- list(contenu = contenu_artefact(
    data.frame(territory_id = "c1", value = 1),
    list(indicator_id = "part_passoires"),
    data.frame(source_id = "s", vintage_id = "v"), NULL))
  artefacts <- list(part_passoires = dependance)
  facts_version <- version_faits_artefact(dependance)
  rows <- list(profile_descriptor = data.frame(
    comparison_scalar = "part_passoires",
    required_scalar_version = "global-scalar-token", stringsAsFactors = FALSE))
  attr(rows, "global_scalar_token") <- "global-scalar-token"
  normalise <- normaliser_live_profil(rows, artefacts, list())
  expect_identical(normalise$profile_descriptor$required_scalar_version, facts_version)

  attr(rows, "global_scalar_token") <- "another-global-token"
  normalise <- normaliser_live_profil(rows, artefacts, list())
  expect_identical(normalise$profile_descriptor$required_scalar_version,
                  "global-scalar-token")
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
  serie$dataset_name <- "build-only"
  serie$vintage <- data.frame(id = "build-only")
  serie$excluded <- list(rows = "build-only")
  persisted <- faits_forme(REGISTRE_FORMES_RESSOURCE[["owned_series"]], serie)
  expect_false(any(c("dataset_name", "vintage", "excluded") %in% names(persisted)))
  expect_true(all(c("points", "point_provenance") %in% names(persisted)))
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
