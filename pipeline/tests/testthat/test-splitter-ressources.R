test_that("le splitter produit une Artefact de ressource par ressource, puis un no-op vérifié", {
  root <- artefacts_fixture_root()
  on.exit(unlink(root, recursive = TRUE), add = TRUE)
  projections <- artefacts_fixture_all_projections()
  reference <- artefacts_fixture_reference()
  digests <- artefacts_fixture_all_digests()

  premier <- splitter_sortie(tempfile("sortie-"), root = root, projections = projections,
    reference = reference, digests = digests)
  expect_setequal(premier$forme, names(REGISTRE_FORMES_RESSOURCE))
  expect_identical(nrow(premier), 6L)
  expect_setequal(premier$ressource, c("densite", "offre_tc", "distribution_dpe", "prix_m2",
    "acv", "aedar"))
  expect_true(all(premier$statut == "new"))
  version_densite <- premier$version[premier$ressource == "densite"]
  artefact <- lire_artefact_ressource("densite", version_densite, root = root)
  expect_identical(names(extraire_declaration_ressource(artefact$contenu$descriptor)),
                   "densite")
  version_aedar <- premier$version[premier$ressource == "aedar"]
  artefact_aedar <- lire_artefact_ressource("aedar", version_aedar, root = root)
  expect_setequal(names(extraire_declaration_ressource(artefact_aedar$contenu$descriptor)),
                  c("aedar_territorial_aggregate", "aedar_territory_summary"))

  second <- splitter_sortie(tempfile("sortie-"), root = root, projections = projections,
    reference = reference, digests = digests)
  expect_true(all(second$statut == "unchanged"))
  expect_identical(second$version, premier$version)
})

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

test_that("changer les faits d'un indicateur ne change que sa Version de ressource publiée", {
  root_a <- artefacts_fixture_root()
  root_b <- artefacts_fixture_root()
  on.exit(unlink(c(root_a, root_b), recursive = TRUE), add = TRUE)
  projections <- artefacts_fixture_all_projections()
  modifiees <- projections
  modifiees$scalar$densite$facts$value[1L] <- 999

  avant <- splitter_sortie(tempfile("sortie-"), root = root_a, projections = projections,
    reference = artefacts_fixture_reference(), digests = artefacts_fixture_all_digests())
  apres <- splitter_sortie(tempfile("sortie-"), root = root_b, projections = modifiees,
    reference = artefacts_fixture_reference(), digests = artefacts_fixture_all_digests())
  versions <- data.frame(ressource = avant$ressource, avant = avant$version, apres = apres$version)
  changees <- versions$ressource[versions$avant != versions$apres]
  expect_identical(changees, "densite")
})

test_that("la comparaison d'un artefact scalaire est celle de l'indicateur seul et lie la référence territoriale", {
  root <- artefacts_fixture_root()
  on.exit(unlink(root, recursive = TRUE), add = TRUE)
  reference <- artefacts_fixture_reference(version = "reference-territoriale-v2")
  resultat <- splitter_sortie(tempfile("sortie-"), root = root,
    projections = artefacts_fixture_all_projections(reference$content_version),
    reference = reference, digests = artefacts_fixture_all_digests())
  version <- resultat$version[resultat$ressource == "densite"]
  artefact <- lire_artefact_ressource("densite", version, root = root)
  comparaison <- artefact$contenu$comparison

  expect_silent(validate_scalar_comparison_projection(comparaison))
  expect_identical(unique(comparaison$groups$indicator_id), "densite")
  expect_identical(unique(comparaison$territories$indicator_id), "densite")
  expect_identical(unique(comparaison$lineage$facet_id), "densite")
  expect_identical(comparaison$reference_content_version, "reference-territoriale-v2")

  # Jeton explicite : la comparaison porte la version des FAITS de CETTE
  # ressource (descripteur + faits + provenance, comparaison exclue), jamais le
  # jeton scalaire global calculé sur le snapshot de tous les indicateurs.
  attendu <- version_faits_artefact(artefact)
  expect_identical(comparaison$scalar_content_version, attendu)
  projections <- artefacts_fixture_scalar_projections()
  global <- version_artefact(contenu_artefact(
    list(facts = do.call(rbind, lapply(projections, `[[`, "facts")),
         eligible_territories = projections[[1L]]$eligible_territories),
    do.call(rbind, lapply(projections, `[[`, "descriptors")),
    do.call(rbind, lapply(projections, `[[`, "provenance")), NULL))
  expect_false(identical(comparaison$scalar_content_version, global))

  # Même ref, un autre indicateur : comparaison différente, Liaison identique.
  version_autre <- resultat$version[resultat$ressource == "offre_tc"]
  autre <- lire_artefact_ressource("offre_tc", version_autre, root = root)
  expect_false(identical(comparaison$content_version, autre$contenu$comparison$content_version))
  expect_false(any(autre$contenu$comparison$groups$indicator_id == "densite"))
  expect_identical(autre$contenu$comparison$reference_content_version, "reference-territoriale-v2")
  expect_identical(autre$contenu$comparison$scalar_content_version,
    version_faits_artefact(autre))
})

test_that("l'artefact d'un profil déclaré garde comparison_scalar et required_scalar_version", {
  root <- artefacts_fixture_root()
  on.exit(unlink(root, recursive = TRUE), add = TRUE)
  reference <- artefacts_fixture_reference()
  resultat <- splitter_sortie(tempfile("sortie-"), root = root,
    projections = artefacts_fixture_all_projections(reference$content_version),
    reference = reference, digests = artefacts_fixture_all_digests())
  version <- resultat$version[resultat$ressource == "distribution_dpe"]
  artefact <- lire_artefact_ressource("distribution_dpe", version, root = root)

  expect_identical(artefact$contenu$descriptor$comparison_scalar, "part_passoires")
  expect_identical(artefact$contenu$descriptor$required_scalar_version, "part-passoires-v1")
  # Le splitter ne réécrit PAS la dépendance : elle vient du descripteur produit.
  code <- paste(readLines(testthat::test_path("..", "..", "R", "splitter_ressources.R"),
    warn = FALSE), collapse = "\n")
  expect_false(grepl("part_passoires", code, fixed = TRUE))
})

test_that("les jetons d'une comparaison non scalaire lient aussi les faits de sa ressource et la référence", {
  root <- artefacts_fixture_root()
  root_invalide <- artefacts_fixture_root()
  on.exit(unlink(c(root, root_invalide), recursive = TRUE), add = TRUE)
  reference <- artefacts_fixture_reference(version = "reference-profil-v3")
  resultat <- splitter_sortie(tempfile("sortie-"), root = root,
    projections = artefacts_fixture_all_projections(reference$content_version),
    reference = reference, digests = artefacts_fixture_all_digests())
  version <- resultat$version[resultat$ressource == "distribution_dpe"]
  artefact <- lire_artefact_ressource("distribution_dpe", version, root = root)
  expect_identical(artefact$contenu$comparison$scalar_content_version,
    version_faits_artefact(artefact))
  expect_identical(artefact$contenu$comparison$reference_content_version,
    "reference-profil-v3")

  projections <- artefacts_fixture_all_projections(reference$content_version)
  projections$declared_profile$distribution_dpe$comparison$scalar_content_version <- "faux-jeton"
  expect_error(splitter_sortie(tempfile("sortie-"), root = root_invalide,
    projections = projections, reference = reference,
    digests = artefacts_fixture_all_digests()), "Comparison tokens are not bound")
})

test_that("les digests de lignage de chaque artefact portent exactement les source_id de sa provenance", {
  root <- artefacts_fixture_root()
  on.exit(unlink(root, recursive = TRUE), add = TRUE)
  projections <- artefacts_fixture_all_projections()
  resultat <- splitter_sortie(tempfile("sortie-"), root = root, projections = projections,
    reference = artefacts_fixture_reference(), digests = artefacts_fixture_all_digests())

  for (i in seq_len(nrow(resultat))) {
    artefact <- lire_artefact_ressource(resultat$ressource[[i]], resultat$version[[i]], root = root)
    source_ids <- unique(as.character(artefact$contenu$provenance$source_id))
    expect_setequal(names(artefact$digests_lignage), source_ids)
    expect_false("unrelated_source" %in% names(artefact$digests_lignage))
  }
})

test_that("le registre des formes est l'unique source de vérité des formes de ressource", {
  registre <- REGISTRE_FORMES_RESSOURCE
  expect_identical(names(registre), c("scalar", "declared_profile", "owned_series",
    "observed_collection", "aedar"))
  for (forme in names(registre)) {
    handler <- registre[[forme]]
    expect_true(all(c("lire", "champs_faits", "champ_descripteur", "champ_provenance",
      "champ_comparaison", "comparaison", "lier_dependance") %in% names(handler)), info = forme)
    expect_true(is.function(handler$lire), info = forme)
    expect_true(is.function(handler$comparaison), info = forme)
    expect_true(is.function(handler$lier_dependance), info = forme)
  }
  expect_false(exists("FORMES_RESSOURCE", inherits = TRUE))
  code <- paste(readLines(testthat::test_path("..", "..", "R", "splitter_ressources.R"),
    warn = FALSE), collapse = "\n")
  expect_false(grepl("if \\(identical\\(forme|if \\(forme", code))
})

test_that("les propriétaires de profils scalaires viennent des métadonnées producteur, sans thème écrit en dur", {
  repertoire <- tempfile("theme-metadata-")
  dir.create(repertoire)
  on.exit(unlink(repertoire, recursive = TRUE), add = TRUE)
  writeLines('{"theme":"programmes","indicator_pages":{},"sources":{"un_profil":"src"},"source_records":{"src":{}},"profile_contracts":{"un_profil":{"completeness":"dense_complete","support_count_field":"n"}}}',
    file.path(repertoire, "theme_programmes.json"))
  expect_identical(profil_owners_scalaires_depuis_metadata(repertoire), "un_profil")

  code <- paste(readLines(testthat::test_path("..", "..", "R", "splitter_ressources.R"),
    warn = FALSE), collapse = "\n")
  expect_false(grepl('c("demographie", "habitat", "mobilite")', code, fixed = TRUE))
  expect_true(grepl("declared_profile_owners()", code, fixed = TRUE))
})

test_that("un artefact scalaire dont l'univers diffère de la référence canonique est refusé", {
  sortie <- artefacts_fixture_sortie_scalaire()
  root <- artefacts_fixture_root()
  on.exit(unlink(c(sortie, root), recursive = TRUE), add = TRUE)
  territoires <- nanoparquet::read_parquet(file.path(sortie, "territoires.parquet"))
  territoires <- territoires[territoires$territoire != "22001", , drop = FALSE]
  nanoparquet::write_parquet(territoires, file.path(sortie, "territoires.parquet"))

  expect_error(splitter_sortie(sortie, root = root),
    "eligibility differs from the current serving universe")
})

test_that("le contrat des fichiers canoniques AEDAR appartient au producteur et est partagé", {
  expect_identical(unname(AEDAR_CANONICAL_FILES),
    c("aedar_territorial_aggregate.parquet", "aedar_territorial_aggregate_source.parquet",
      "aedar_typequ_metadata.parquet"))
  expect_false(exists("NOMS_FICHIERS_AEDAR", inherits = TRUE))
  racine <- testthat::test_path("..", "..")
  lire <- function(chemin) paste(readLines(chemin, warn = FALSE), collapse = "\n")
  expect_true(grepl("AEDAR_CANONICAL_FILES", lire(file.path(racine, "R", "aedar_aggregates.R")),
                   fixed = TRUE))
  expect_false(grepl("aedar_territorial_aggregate.parquet",
                     lire(file.path(racine, "R", "splitter_ressources.R")), fixed = TRUE))
})

test_that("le vocabulaire et le nommage suivent CONTEXT.md", {
  racine <- testthat::test_path("..", "..")
  lire <- function(chemin) paste(readLines(chemin, warn = FALSE), collapse = "\n")
  splitteur <- lire(file.path(racine, "R", "splitter_ressources.R"))
  expect_false(grepl("Pont temporaire", splitteur))
  expect_true(grepl("Splitter par thème", splitteur, fixed = TRUE))
  expect_true(grepl("étape 3", splitteur, fixed = TRUE))
  magasin <- lire(file.path(racine, "R", "artefact_ressource.R"))
  expect_true(grepl("Seul nom de la « Version de ressource publiée »", magasin, fixed = TRUE))
  expect_true(grepl("absent = TRUE", magasin, fixed = TRUE))
  expect_true(grepl("#1136", magasin, fixed = TRUE))
})

test_that("aucune connexion à la base de service n'est introduite dans ce slice", {
  racine <- testthat::test_path("..", "..")
  fichiers <- c(
    file.path(racine, "R", "artefact_ressource.R"),
    file.path(racine, "R", "splitter_ressources.R"),
    file.path(racine, "scripts", "publication.R")
  )
  for (fichier in fichiers) {
    if (!file.exists(fichier)) next
    code <- paste(readLines(fichier, warn = FALSE), collapse = "\n")
    expect_false(grepl("dbConnect|DBI::|RPostgres", code), info = basename(fichier))
  }
})
