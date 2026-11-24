test_that("every persisted SQL array column is a PostgreSQL array literal", {
  root <- artefacts_fixture_root()
  on.exit(unlink(root, recursive = TRUE), add = TRUE)
  projection <- artefacts_fixture_scalar_indicator("a", "src_a", c(1, 2, 3, 4, 5))
  reference <- artefacts_fixture_reference()
  contenu <- contenu_artefact(
    faits_forme(REGISTRE_FORMES_RESSOURCE[["scalar"]], projection),
    projection$descriptors, projection$provenance,
    comparaison_scalaire_ressource(projection, "a", reference))
  ecrit <- ecrire_artefact_ressource("a", "scalar", contenu, root = root)
  artefacts <- list(
    scalar = lire_artefact_ressource("a", ecrit$version, root = root),
    declared_profile = artefacts_fixture_profile_artefact(root = root)$artefact,
    owned_series = adaptateur_series_artefact(root),
    observed_collection = adaptateur_collection_artefact(root))
  for (forme in names(artefacts)) {
    handler <- REGISTRE_FORMES_RESSOURCE[[forme]]
    lignes <- handler$lignes_persistees(artefacts[[forme]])
    expect_true(length(handler$colonnes_tableau) > 0L, info = forme)
    for (table in names(handler$colonnes_tableau)) {
      for (colonne in handler$colonnes_tableau[[table]]) {
        valeur <- lignes[[table]][[colonne]]
        expect_true(is.character(valeur), info = paste(forme, table, colonne))
        expect_false(is.list(valeur), info = paste(forme, table, colonne))
        presentes <- valeur[!is.na(valeur)]
        expect_true(all(grepl("^\\{.*\\}$", presentes)),
                    info = paste(forme, table, colonne))
      }
    }
  }
  aedar <- REGISTRE_FORMES_RESSOURCE[["aedar"]]
  expect_length(aedar$colonnes_tableau, 0L)

  live <- data.frame(allowed_levels = I(list(c("commune", "epci"))),
                     stringsAsFactors = FALSE)
  normalise <- .adoption_normaliser_tableau(live,
    data.frame(allowed_levels = "{}"), "allowed_levels")
  expect_identical(normalise$allowed_levels, "{commune,epci}")
})
