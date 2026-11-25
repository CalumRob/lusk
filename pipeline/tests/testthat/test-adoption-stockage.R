# Storage-only columns are the ONLY columns adoption may ignore (#1142). Vintage
# clocks and comparison / content-version tokens are persisted facts.

test_that("each shape declares exactly its genuinely write-time columns as storage-only", {
  declare <- lapply(REGISTRE_FORMES_RESSOURCE, `[[`, "colonnes_stockage")
  expect_identical(declare$scalar,
    list(scalar_observation = "published_at", source_dataset = "name"))
  for (forme in c("declared_profile", "owned_series", "observed_collection", "aedar"))
    expect_identical(declare[[forme]], list(source_dataset = "name"), info = forme)
  expect_identical(STOCKAGE_SOURCE_DATASET_NAME, "name")
})

test_that("vintage clocks and comparison tokens are compared, not ignored", {
  ignores <- unlist(lapply(REGISTRE_FORMES_RESSOURCE, `[[`, "colonnes_stockage"),
                    use.names = TRUE)
  expect_false(any(c("reference_date", "publication_date", "profile_content_version",
    "collection_content_version", "comparison_content_version") %in% ignores))
})

test_that("a scalar artefact carries the source clocks and adoption compares them", {
  root <- artefacts_fixture_root()
  on.exit(unlink(root, recursive = TRUE), add = TRUE)
  projection <- .adopt_db_scalar_indicator("a", "src_a", c(10, 10, 5, 3, NA, 1, 2, 3, 4, 5))
  reference <- artefacts_fixture_reference()
  handler <- REGISTRE_FORMES_RESSOURCE[["scalar"]]
  contenu <- contenu_artefact(faits_forme(handler, projection), projection$descriptors,
    projection$provenance, comparaison_scalaire_ressource(projection, "a", reference))
  ecrit <- ecrire_artefact_ressource("a", "scalar", contenu,
    digests_lignage = digests_lignage_ressource("src_a", artefacts_fixture_digests("src_a")),
    root = root)
  artefact <- lire_artefact_ressource("a", ecrit$version, root = root)
  attendu <- handler$lignes_persistees(artefact)

  vintage <- attendu$source_vintage
  expect_identical(as.character(vintage$reference_date), "2020-01-01")
  expect_identical(as.character(vintage$publication_date), "2021-01-01")
  expect_true(comparer_lignes_persistees(attendu, attendu, handler)$identique)

  for (champ in c("reference_date", "publication_date")) {
    live <- attendu
    live$source_vintage[[champ]] <- as.Date("1999-09-09")
    r <- comparer_lignes_persistees(attendu, live, handler)
    expect_false(r$identique, info = champ)
    expect_identical(r$parties, "source_vintage", info = champ)
  }
  live <- attendu
  live$comparison_source_lineage$comparison_content_version <- "autre-jeton"
  r <- comparer_lignes_persistees(attendu, live, handler)
  expect_false(r$identique)
  expect_identical(r$parties, "comparison_source_lineage")
  live <- attendu
  live$source_dataset$name <- "Libelle courant"
  expect_true(comparer_lignes_persistees(attendu, live, handler)$identique)
})

test_that("profile and collection tokens differing from the artefact refuse the comparison", {
  for (forme in c("declared_profile", "observed_collection")) {
    handler <- REGISTRE_FORMES_RESSOURCE[[forme]]
    for (table in names(handler$colonnes_stockage)) {
      expect_identical(as.character(handler$colonnes_stockage[[table]]), "name", info = forme)
    }
  }
  attendu <- list(
    profile_comparison_group = data.frame(group_id = "g", median = 1,
      profile_content_version = "token-artefact", stringsAsFactors = FALSE),
    source_vintage = data.frame(source_id = "s", vintage_id = "v", version = "v",
      reference_date = as.Date("2020-01-01"), publication_date = as.Date("2021-01-01"),
      stringsAsFactors = FALSE))
  handler <- REGISTRE_FORMES_RESSOURCE[["declared_profile"]]
  live <- attendu
  live$profile_comparison_group$profile_content_version <- "token-global"
  r <- comparer_lignes_persistees(attendu, live, handler)
  expect_false(r$identique)
  expect_identical(r$parties, "profile_comparison_group")
})
