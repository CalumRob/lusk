test_that("le splitter produit le descripteur AEDAR depuis le chemin canonique réel", {
  sortie <- tempfile("sortie-aedar-canonique-")
  root <- artefacts_fixture_root()
  dir.create(sortie, recursive = TRUE)
  on.exit(unlink(c(sortie, root), recursive = TRUE), add = TRUE)
  base <- artefacts_fixture_reference()$rows
  canonical <- data.frame(territoire = base$territory_id, type = base$territory_type,
    nom = base$territory_id, departement = rep(NA_character_, nrow(base)),
    epci = base$epci_id, classe_densite_code = base$density_class_code,
    classe_densite_libelle_public = base$density_class_code, stringsAsFactors = FALSE)
  nanoparquet::write_parquet(canonical, file.path(sortie, "territoires.parquet"))
  reference <- project_territory_reference(canonical)
  projection <- adaptateur_aedar_projection()
  aedar_dir <- file.path(sortie, "aedar")
  .adopt_db_aedar_manifest(projection, reference, directory = aedar_dir)
  digests <- artefacts_fixture_digests(AEDAR_AGGREGATE_SOURCE_ID)
  jsonlite::write_json(unname(digests), file.path(sortie, "source-digests.json"),
    auto_unbox = TRUE)

  resultat <- splitter_sortie(sortie, root = root)
  expect_identical(resultat$ressource, "aedar")
  expect_identical(resultat$forme, "aedar")
  artefact <- lire_artefact_ressource("aedar", resultat$version, root = root)
  descriptor <- artefact$contenu$descriptor
  declarations <- extraire_declaration_ressource(descriptor)
  expect_identical(descriptor$indicator_id, "aedar")
  expect_identical(descriptor$semantic_resources, names(declarations))
  expect_identical(declarations, declarations_decouverte_ressource("aedar"))
  expect_setequal(names(declarations), c("aedar_territorial_aggregate",
    "aedar_territory_summary"))
  expect_identical(descriptor$source_id, AEDAR_AGGREGATE_SOURCE_ID)
  expect_identical(descriptor$vintage, AEDAR_AGGREGATE_VINTAGE)

  rows <- projeter_artefact_aedar(artefact)
  expect_identical(rows$projection$descriptor, descriptor)
  expect_identical(rows$projection$source$source_id, descriptor$source_id)
  expect_identical(rows$projection$source$vintage, descriptor$vintage)
  persistees <- lignes_aedar_persistees(artefact)
  expect_identical(persistees$source_dataset$source_id, descriptor$source_id)
  expect_identical(persistees$source_vintage$vintage_id, descriptor$vintage)
  expect_setequal(names(artefact$digests_lignage), AEDAR_AGGREGATE_SOURCE_ID)
})
