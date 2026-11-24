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

  second <- splitter_sortie(tempfile("sortie-"), root = root, projections = projections,
    reference = reference, digests = digests)
  expect_true(all(second$statut == "unchanged"))
  expect_identical(second$version, premier$version)
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
    projections = artefacts_fixture_all_projections(), reference = reference,
    digests = artefacts_fixture_all_digests())
  version <- resultat$version[resultat$ressource == "densite"]
  artefact <- lire_artefact_ressource("densite", version, root = root)
  comparaison <- artefact$contenu$comparison

  expect_silent(validate_scalar_comparison_projection(comparaison))
  expect_identical(unique(comparaison$groups$indicator_id), "densite")
  expect_identical(unique(comparaison$territories$indicator_id), "densite")
  expect_identical(unique(comparaison$lineage$facet_id), "densite")
  expect_identical(comparaison$reference_content_version, "reference-territoriale-v2")

  # Même ref, un autre indicateur : comparaison différente, Liaison identique.
  version_autre <- resultat$version[resultat$ressource == "offre_tc"]
  autre <- lire_artefact_ressource("offre_tc", version_autre, root = root)
  expect_false(identical(comparaison$content_version, autre$contenu$comparison$content_version))
  expect_false(any(autre$contenu$comparison$groups$indicator_id == "densite"))
  expect_identical(autre$contenu$comparison$reference_content_version, "reference-territoriale-v2")
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

test_that("la commande locale split lit une vraie sortie et imprime resource, shape, version, statut", {
  sortie <- artefacts_fixture_sortie_scalaire()
  root <- artefacts_fixture_root()
  on.exit(unlink(c(sortie, root), recursive = TRUE), add = TRUE)
  script <- testthat::test_path("..", "..", "scripts", "publication.R")
  precedent <- Sys.getenv("LUSK_ARTEFACTS", unset = NA_character_)
  Sys.setenv(LUSK_ARTEFACTS = root)
  on.exit(if (is.na(precedent)) Sys.unsetenv("LUSK_ARTEFACTS") else
    Sys.setenv(LUSK_ARTEFACTS = precedent), add = TRUE)
  commande <- function() system2("Rscript", c(shQuote(script), "split", shQuote(sortie)),
    stdout = TRUE, stderr = TRUE)

  premier <- commande()
  expect_true(any(grepl("^densite, scalar, [a-f0-9]{32}, new$", premier)))
  second <- commande()
  expect_true(any(grepl("^densite, scalar, [a-f0-9]{32}, unchanged$", second)))
  version <- function(lignes) sub("^densite, scalar, ([a-f0-9]{32}), .*$", "\\1",
    grep("^densite, scalar,", lignes, value = TRUE))
  expect_identical(version(premier), version(second))
})

test_that("le registre des formes est l'unique source de vérité des formes de ressource", {
  registre <- REGISTRE_FORMES_RESSOURCE
  expect_identical(names(registre), c("scalar", "declared_profile", "owned_series",
    "observed_collection", "aedar"))
  for (forme in names(registre)) {
    handler <- registre[[forme]]
    expect_true(all(c("lire", "champs_faits", "champ_descripteur", "champ_provenance",
      "champ_comparaison", "comparaison") %in% names(handler)), info = forme)
    expect_true(is.function(handler$lire), info = forme)
    expect_true(is.function(handler$comparaison), info = forme)
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
