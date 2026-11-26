# DB-free proofs that the live readers return what the database HOLDS (#1142):
# every persisted column, every row selected by the RESOURCE's keys. Adoption is a
# proof of equality, so a live-only column or row must reach the comparison.

adoption_lecteur_artefact_scalaire <- function(root) {
  projection <- artefacts_fixture_scalar_indicator("a", "src_a", c(10, 10, 5, 3, NA))
  reference <- artefacts_fixture_reference()
  comparison <- comparaison_scalaire_ressource(projection, "a", reference)
  contenu <- contenu_artefact(
    faits_forme(REGISTRE_FORMES_RESSOURCE[["scalar"]], projection),
    projection$descriptors, projection$provenance, comparison)
  ecrit <- ecrire_artefact_ressource("a", "scalar", contenu,
    digests_lignage = digests_lignage_ressource("src_a", artefacts_fixture_digests("src_a")),
    root = root)
  lire_artefact_ressource("a", ecrit$version, root = root)
}

# A recording stand-in for the connection: every SELECT is answered from `tables`
# (the "live database") and its SQL and params are kept for assertions.
adoption_lecteur_base_factice <- function(tables) {
  journal <- new.env(parent = emptyenv()); journal$sql <- character(); journal$params <- list()
  repondre <- function(con, sql, params = NULL) {
    journal$sql <- c(journal$sql, sql); journal$params <- c(journal$params, list(params))
    table <- sub("^SELECT \\* FROM ([a-z_]+).*$", "\\1", sql)
    if (grepl("WHERE false", sql, fixed = TRUE)) return(tables[[table]][0L, , drop = FALSE])
    if (!table %in% names(tables)) return(data.frame(content_version = "global"))
    tables[[table]]
  }
  list(journal = journal, repondre = repondre)
}

test_that("a live-only column and a live-only row survive the reader and refuse the comparison", {
  root <- artefacts_fixture_root()
  on.exit(unlink(root, recursive = TRUE), add = TRUE)
  artefact <- adoption_lecteur_artefact_scalaire(root)
  handler <- REGISTRE_FORMES_RESSOURCE[["scalar"]]
  attendu <- handler$lignes_persistees(artefact)
  live <- attendu
  live$scalar_observation$published_at <- as.POSIXct("2026-01-01", tz = "UTC")
  live$scalar_descriptor$colonne_live_seule <- "x"
  live$scalar_observation_source <- rbind(live$scalar_observation_source,
    transform(live$scalar_observation_source[1L, , drop = FALSE], territory_id = "extra"))
  factice <- adoption_lecteur_base_factice(live)
  local_mocked_bindings(.adoption_query = function(con, sql, params = NULL)
    factice$repondre(con, sql, params))

  lu <- lire_live_scalaire(NULL, "a", NULL, attendu, handler$colonnes_tableau,
                           handler$colonnes_stockage)
  expect_true("colonne_live_seule" %in% names(lu$scalar_descriptor))
  expect_equal(nrow(lu$scalar_observation_source), nrow(attendu$scalar_observation_source) + 1L)
  resultat <- comparer_lignes_persistees(attendu, lu, handler)
  expect_false(resultat$identique)
  expect_setequal(resultat$parties, c("scalar_descriptor", "scalar_observation_source"))
})

test_that("readers select by the resource key, never by the artefact's own keys", {
  root <- artefacts_fixture_root()
  on.exit(unlink(root, recursive = TRUE), add = TRUE)
  artefact <- adoption_lecteur_artefact_scalaire(root)
  handler <- REGISTRE_FORMES_RESSOURCE[["scalar"]]
  attendu <- handler$lignes_persistees(artefact)
  factice <- adoption_lecteur_base_factice(attendu)
  local_mocked_bindings(.adoption_query = function(con, sql, params = NULL)
    factice$repondre(con, sql, params))
  lire_live_scalaire(NULL, "a", NULL, attendu, handler$colonnes_tableau,
                     handler$colonnes_stockage)

  cles <- grepl("^SELECT \\* FROM (scalar_|comparison_source_lineage)", factice$journal$sql)
  expect_true(any(cles))
  for (i in which(cles)) {
    expect_match(factice$journal$sql[[i]], "(indicator_id|facet_id)=\\$1", info = i)
    expect_identical(factice$journal$params[[i]], list("a"), info = i)
  }
  # No SELECT names a column list: every persisted column is read.
  # (only the global marker lookups, which are not resource rows, name columns.)
  lignes <- factice$journal$sql[!grepl("_publication |FROM profile_descriptor WHERE comparison_scalar",
                                       factice$journal$sql)]
  expect_false(any(grepl("^SELECT [a-z_]+,", lignes)))
})

test_that("shared source tables follow the resource's LIVE references", {
  root <- artefacts_fixture_root()
  on.exit(unlink(root, recursive = TRUE), add = TRUE)
  artefact <- adoption_lecteur_artefact_scalaire(root)
  handler <- REGISTRE_FORMES_RESSOURCE[["scalar"]]
  attendu <- handler$lignes_persistees(artefact)
  live <- attendu
  live$scalar_observation_source <- rbind(live$scalar_observation_source,
    transform(live$scalar_observation_source[1L, , drop = FALSE],
              territory_id = "extra", vintage_id = "vintage-live-seul"))
  live$source_vintage <- rbind(live$source_vintage,
    transform(live$source_vintage[1L, , drop = FALSE], vintage_id = "vintage-live-seul"))
  factice <- adoption_lecteur_base_factice(live)
  local_mocked_bindings(.adoption_query = function(con, sql, params = NULL)
    factice$repondre(con, sql, params))

  lu <- lire_live_scalaire(NULL, "a", NULL, attendu, handler$colonnes_tableau,
                           handler$colonnes_stockage)
  i <- grep("^SELECT \\* FROM source_vintage", factice$journal$sql)
  expect_length(i, 1L)
  expect_true("vintage-live-seul" %in% unlist(factice$journal$params[[i]]))
  expect_true("vintage-live-seul" %in% lu$source_vintage$vintage_id)
  expect_false(comparer_lignes_persistees(attendu, lu, handler)$identique)
})
