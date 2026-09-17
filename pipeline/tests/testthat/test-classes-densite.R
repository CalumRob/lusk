test_that("la référence territoriale publie les sept classes de densité officielles", {
  territoires <- tibble::tibble(
    territoire = c(sprintf("2200%d", 1:7), "200000001", "22", "53"),
    type = c(rep("commune", 7), "epci", "departement", "region"),
    nom = c(paste("Commune", 1:7), "EPCI X", "Côtes-d'Armor", "Bretagne"),
    departement = c(rep("22", 9), NA_character_),
    epci = c(rep("200000001", 7), rep(NA_character_, 3))
  )
  source <- tibble::tibble(
    CODGEO = sprintf("2200%d", 1:7),
    DENS7 = as.character(1:7),
    LIBDENS7 = c(
      "Grands centres urbains",
      "Centres urbains intermédiaires",
      "Petites villes",
      "Ceintures urbaines",
      "Bourgs ruraux",
      "Rural à habitat dispersé",
      "Rural à habitat très dispersé"
    )
  )

  publies <- publier_classes_densite(territoires, source)
  communes <- publies[publies$type == "commune", ]

  expect_equal(communes$classe_densite_code, as.character(1:7))
  expect_equal(communes$classe_densite_libelle_insee, source$LIBDENS7)
  expect_equal(
    communes$classe_densite_libelle_public,
    c(
      "grands centres urbains bretons",
      "centres urbains intermédiaires bretons",
      "petites villes bretonnes",
      "ceintures urbaines bretonnes",
      "bourgs ruraux bretons",
      "communes rurales à habitat dispersé en Bretagne",
      "communes rurales à habitat très dispersé en Bretagne"
    )
  )
  expect_true(all(is.na(publies$classe_densite_code[publies$type != "commune"])))
  expect_true(all(is.na(publies$classe_densite_libelle_insee[publies$type != "commune"])))
  expect_true(all(is.na(publies$classe_densite_libelle_public[publies$type != "commune"])))
})

test_that("la publication refuse une commune bretonne sans classe de densité", {
  territoires <- tibble::tibble(
    territoire = c("22001", "22002"),
    type = "commune",
    nom = c("Commune A", "Commune B"),
    departement = "22",
    epci = NA_character_
  )
  source <- tibble::tibble(
    CODGEO = "22001",
    DENS7 = "1",
    LIBDENS7 = "Grands centres urbains"
  )

  expect_error(
    publier_classes_densite(territoires, source),
    "22002.*sans classe"
  )
})

test_that("la publication refuse un code ou libellé de classe inconnu", {
  territoires <- tibble::tibble(
    territoire = "22001",
    type = "commune",
    nom = "Commune A",
    departement = "22",
    epci = NA_character_
  )
  source <- tibble::tibble(
    CODGEO = "22001",
    DENS7 = "8",
    LIBDENS7 = "Classe inventée"
  )

  expect_error(
    publier_classes_densite(territoires, source),
    "code ou libellé.*inconnu"
  )
})

test_that("la publication refuse une jointure communale ambiguë", {
  territoires <- tibble::tibble(
    territoire = "22001",
    type = "commune",
    nom = "Commune A",
    departement = "22",
    epci = NA_character_
  )
  source <- tibble::tibble(
    CODGEO = c("22001", "22001"),
    DENS7 = c("1", "2"),
    LIBDENS7 = c("Grands centres urbains", "Centres urbains intermédiaires")
  )

  expect_error(
    publier_classes_densite(territoires, source),
    "jointure.*ambiguë"
  )
})

test_that("la référence de payload conserve les classes et la provenance séparée", {
  source <- tibble::tibble(
    CODGEO = c("22001", "22002", "29001", "29002"),
    DENS7 = c("1", "2", "6", "7"),
    LIBDENS7 = c(
      "Grands centres urbains",
      "Centres urbains intermédiaires",
      "Rural à habitat dispersé",
      "Rural à habitat très dispersé"
    )
  )
  payload <- compute_payload(load_fixture(), classes_densite = source)

  expect_named(payload$territoires, c(
    "territoire", "type", "nom", "departement", "epci",
    "classe_densite_code", "classe_densite_libelle_insee",
    "classe_densite_libelle_public"
  ))
  expect_equal(
    payload$territoires$classe_densite_code[payload$territoires$type == "commune"],
    c("1", "2", "6", "7")
  )
  expect_true(all(is.na(payload$territoires$classe_densite_code[payload$territoires$type != "commune"])))

  sortie <- tempfile("publish-classes-densite-")
  dir.create(sortie)
  on.exit(unlink(sortie, recursive = TRUE), add = TRUE)
  publish(payload, sortie)
  sidecar <- jsonlite::fromJSON(
    file.path(sortie, "territoires-metadata.json"), simplifyVector = FALSE
  )
  expect_equal(sidecar$territory_reference_label, "Référentiel territorial — classes de densité communale")
  expect_equal(sidecar$density_classes[["7"]][["code"]], "7")
})

test_that("les métadonnées de la grille exposent la classification et ses millésimes", {
  metadata <- metadata_classes_densite()

  expect_equal(metadata$schema_version, "1")
  expect_equal(
    metadata$territory_reference_label,
    "Référentiel territorial — classes de densité communale"
  )
  expect_length(metadata$density_classes, 7)
  expect_equal(
    metadata$source_records$classe_densite_communale$dataset,
    "Grille de densité 2025 — maille communale"
  )
  expect_match(
    metadata$source_records$classe_densite_communale$sha256,
    "^[0-9a-f]{64}$"
  )
  expect_match(
    metadata$source_records$classe_densite_communale$vintage,
    "01/01/2026.*RP 2021"
  )
  expect_equal(
    metadata$source_records$classe_densite_communale$vintages[[1]]$datePublication,
    "2026-05-15"
  )
  expect_match(metadata$source_records$classe_densite_communale$caveat, "classification officielle")
})
