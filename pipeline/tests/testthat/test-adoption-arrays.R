test_that("collection categories satisfy validate_observed_collection_publication by kind", {
  # Mirror api/schema.sql::validate_observed_collection_publication(): period
  # details require NULL anchor/rider + dataset clock; anchored memberships
  # require a non-empty subset of commune/epci.
  periode <- adaptateur_collection_projection()
  lignes <- .lignes_collection_projection(list(projection = periode))
  categories <- lignes$observed_collection_category
  expect_true(all(is.na(categories$anchor_levels)))
  expect_true(all(is.na(categories$rider_label)))
  expect_identical(categories$clock_policy, rep("dataset", nrow(categories)))

  membres <- periode
  membres$descriptor$kind <- "anchored_membership"
  membres$descriptor$direction <- "none"
  membres$descriptor$comparison_detail <- NA_character_
  membres$descriptor$comparison_period <- NA_character_
  membres$categories$anchor_levels <- "{commune}"
  membres$facts <- data.frame(indicator_id = "acv", territory_id = "c1",
    territory_type = "commune", detail_key = "acv_2023", convention_valant_ort = FALSE,
    source_id = "programme_source", vintage_id = "v1", stringsAsFactors = FALSE)
  lignes <- .lignes_collection_projection(list(projection = membres))
  categories <- lignes$observed_collection_category
  expect_false(any(is.na(categories$anchor_levels)))
  expect_true(all(vapply(categories$anchor_levels, function(x) {
    valeurs <- bridge_parse_text_array(x)
    length(valeurs) > 0L && all(valeurs %in% c("commune", "epci"))
  }, logical(1))))
})

test_that("absent SQL arrays are NULL rather than an empty array literal", {
  expect_true(is.na(litteral_tableau_postgres(NULL)))
  expect_true(is.na(litteral_tableau_postgres(NA_character_)))
  expect_true(is.na(litteral_tableau_postgres(character())))
  expect_true(is.na(litteral_tableau_postgres(c("commune", NA_character_))))
  expect_identical(litteral_tableau_postgres(c("commune", "epci")), "{commune,epci}")
  expect_identical(litteral_tableau_postgres("{commune}"), "{commune}")
})

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
