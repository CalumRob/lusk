test_that("un modèle d'indicateur est une projection déterministe du canon", {
  metadata <- list(
    theme = "demographie",
    label = "Démographie",
    detail_labels = list(),
    source_records = list(
      serie_historique = list(
        dataset = "Série historique", publisher = "INSEE", url = "https://example.test",
        licence = "LO", vintage = "2023", freshness = "2026-06-30"
      )
    ),
    indicator_pages = list(
      densite = list(
        indicator = "densite",
        label = "Densité de population",
        definition = "Nombre d'habitants par kilomètre carré.",
        unit = "hab./km²",
        calculation = "Population divisée par la superficie.",
        direction = "high",
        caveats = "La superficie est celle du territoire.",
        levels = c("commune", "epci", "departement"),
        sources = "serie_historique"
      )
    )
  )
  indicateurs <- tibble::tibble(
    territoire = c("2000", "1000", "1000", "3000"),
    type = c("epci", "commune", "commune", "region"),
    theme = "demographie",
    key = c("densite", "taille_menages", "densite", "densite"),
    detail = NA_character_,
    sex = NA_character_,
    dimension = NA_character_,
    value = c(90, 2.1, 120, 110),
    unit = c("hab./km²", "personnes", "hab./km²", "hab./km²")
  )

  modele <- construire_modele_indicateur(
    indicateurs = indicateurs[c(4, 2, 1, 3), ],
    metadata = metadata,
    indicateur = "densite",
    snapshot_id = "2026-09-15"
  )

  expect_identical(modele$schema_version, "1")
  expect_identical(modele$snapshot_id, "2026-09-15")
  expect_identical(modele$theme, "demographie")
  expect_identical(modele$indicator, "densite")
  expect_identical(modele$theme_label, "Démographie")
  expect_identical(modele$page, metadata$indicator_pages$densite)
  expect_length(modele$detail_labels, 0)
  expect_named(modele$source_records, "serie_historique")
  expect_identical(modele$facts$territoire, c("1000", "2000"))
  expect_true(all(modele$facts$key == "densite"))
  expect_false(any(modele$facts$type == "region"))
})

test_that("un modèle d'indicateur se publie sous son adresse de lecture", {
  modele <- list(
    schema_version = "1",
    snapshot_id = "2026-09-15",
    theme = "demographie",
    indicator = "densite",
    theme_label = "Démographie",
    page = list(indicator = "densite", levels = c("commune")),
    detail_labels = list(),
    facts = tibble::tibble(
      territoire = "1000", type = "commune", theme = "demographie",
      key = "densite", detail = NA_character_, value = 120,
      unit = "hab./km²"
    )
  )
  sortie <- tempfile("modeles-lecture-")
  on.exit(unlink(sortie, recursive = TRUE))

  chemin <- publier_modele_indicateur(modele, sortie = sortie)

  expect_identical(
    normalizePath(chemin, winslash = "/"),
    normalizePath(
      file.path(sortie, "modeles-lecture", "indicateurs", "demographie",
                "densite.json"),
      winslash = "/"
    )
  )
  expect_true(file.exists(chemin))
  relu <- jsonlite::fromJSON(chemin, simplifyDataFrame = FALSE)
  expect_identical(relu$schema_version, "1")
  expect_identical(relu$facts[[1]]$territoire, "1000")
  expect_null(relu$facts[[1]]$detail)
})

test_that("l'identifiant de snapshot vient des vintages", {
  expect_identical(
    identifiant_snapshot(data.frame(
      date_reference = c("2023-01-01", NA, "2025-01-01")
    )),
    "2025-01-01"
  )
})

test_that("le registre de métadonnée pilote les modèles publiés", {
  metadata <- list(
    theme = "demographie",
    label = "Démographie",
    detail_labels = list(),
    source_records = list(
      serie_historique = list(
        dataset = "Série historique", publisher = "INSEE", url = "https://example.test",
        licence = "LO", vintage = "2023", freshness = "2026-06-30"
      )
    ),
    indicator_pages = list(
      densite = list(
        indicator = "densite", label = "Densité", definition = "Densité.",
        unit = "hab./km²", calculation = "Population / superficie.",
        direction = "high", caveats = "Aucune.",
        levels = c("commune"), sources = c("serie_historique"),
        read_model = TRUE
      )
    )
  )
  payload <- list(indicateurs = tibble::tibble(
    territoire = "1000", type = "commune", theme = "demographie",
    key = "densite", detail = NA_character_, value = 120,
    unit = "hab./km²"
  ))
  sortie <- tempfile("modeles-lecture-registre-")
  on.exit(unlink(sortie, recursive = TRUE))

  chemins <- publier_modeles_lecture(
    payload, metadata,
    data.frame(date_reference = "2025-01-01"),
    sortie = sortie
  )

  expect_length(chemins, 1)
  expect_true(file.exists(chemins[[1]]))
  expect_identical(
    jsonlite::fromJSON(chemins[[1]], simplifyDataFrame = FALSE)$snapshot_id,
    "2025-01-01"
  )
})

test_that("un modèle de territoire rassemble le contexte et les preuves Mobilité", {
  territoires <- tibble::tribble(
    ~territoire, ~type, ~nom, ~departement, ~epci,
    "22001", "commune", "Commune A", "22", "200000001",
    "22002", "commune", "Commune B", "22", "200000001",
    "200000001", "epci", "EPCI X", "22", NA_character_,
    "22", "departement", "Département 22", "22", NA_character_,
    "53", "region", "Bretagne", NA_character_, NA_character_,
    "29001", "commune", "Commune C", "29", "200000002"
  )
  indicateurs <- tibble::tibble(
    territoire = c("22001", "22002", "22002", "53", "29001"),
    type = c("commune", "commune", "commune", "region", "commune"),
    theme = "mobilite",
    key = c("nb_buildings", "nb_buildings", "autre_fait", "nb_buildings", "nb_buildings"),
    detail = NA_character_,
    value = c(100, 200, 42, 1000, 300),
    unit = "bâtiments"
  )
  histoires <- tibble::tibble(
    territoire = c("22001", "22002", "53"),
    type = c("commune", "commune", "region"),
    theme = "mobilite",
    story_key = "vingt-minutes-sans-voiture",
    groupe = "acces-aux-services",
    div_loss_t = c(10, 12, 8)
  )
  profils <- tibble::tibble(
    territoire = c("22001", "22002"),
    type = "commune",
    profil = "velo-compense",
    profil_libelle = "Le vélo compense",
    nombre_typequ = c(3L, 4L),
    exemplar_typequ = "D267",
    exemplar_libelle = "Exemple",
    exemplar_c = 0.1,
    exemplar_b = 0.4,
    exemplar_t = 0.2
  )
  payload <- list(
    territoires = territoires,
    indicateurs = indicateurs,
    histoires = histoires,
    profils_acces_bpe = profils,
    distribution_acces_batiments = NULL,
    rampe_acces_batiments = NULL
  )

  modele <- construire_modele_territoire(
    payload = payload,
    metadata = list(theme = "mobilite", label = "Mobilité"),
    territoire = "22001",
    snapshot_id = "2026-09-15",
    directions = list(nb_buildings = "high")
  )

  expect_identical(modele$schema_version, "1")
  expect_identical(modele$territory$territoire, "22001")
  expect_true(all(c("22001", "200000001", "22", "53") %in%
                    modele$territoires$territoire))
  expect_false("22002" %in% modele$territoires$territoire)
  expect_false("29001" %in% modele$territoires$territoire)
  expect_identical(
    modele$themes$mobilite$profils_acces_bpe$territoire,
    "22001"
  )
  expect_identical(
    modele$themes$mobilite$indicateurs$territoire,
    c("22001", "53")
  )
  expect_false(any(modele$themes$mobilite$indicateurs$key == "autre_fait"))
  expect_identical(
    modele$themes$mobilite$histoires$territoire,
    "22001"
  )
  expect_identical(names(modele$themes$mobilite$comparaisons), "epci")
  expect_identical(
    modele$themes$mobilite$comparaisons$epci$scope,
    list(
      kind = "communes-epci",
      label = "communes de EPCI X"
    )
  )
  fait_batiments <- modele$themes$mobilite$comparaisons$epci$faits |>
    dplyr::filter(.data$key == "nb_buildings")
  expect_identical(
    fait_batiments,
    tibble::tibble(
      key = "nb_buildings",
      detail = NA_character_,
      sex = NA_character_,
      dimension = NA_character_,
      origin = "indicator",
      direction = "plus-est-mieux",
      rank_position = 2,
      rank_size = 2L,
      reference_kind = "median",
      reference_value = 150
    )
  )
})

test_that("le modèle de territoire remplace atomiquement son adresse sans fusionner un ancien snapshot", {
  modele <- list(
    schema_version = "1",
    snapshot_id = "2026-09-15",
    territory = list(
      territoire = "22001", type = "commune", nom = "Commune A",
      departement = "22", epci = "200000001"
    ),
    territoires = tibble::tibble(
      territoire = "22001", type = "commune", nom = "Commune A",
      departement = "22", epci = "200000001"
    ),
    themes = list(mobilite = list(
      theme = "mobilite",
      indicateurs = tibble::tibble(),
      histoires = tibble::tibble(),
      theme_metadata = list(theme = "mobilite", label = "Mobilité"),
      profils_acces_bpe = NULL,
      distribution_acces_batiments = NULL,
      rampe_acces_batiments = NULL
    ))
  )
  sortie <- tempfile("modeles-lecture-territoire-")
  on.exit(unlink(sortie, recursive = TRUE))

  chemin <- publier_modele_territoire(modele, sortie = sortie)

  expect_identical(
    normalizePath(chemin, winslash = "/"),
    normalizePath(
      file.path(sortie, "modeles-lecture", "territoires", "commune", "22001.json"),
      winslash = "/"
    )
  )
  expect_true(file.exists(chemin))
  relu <- jsonlite::fromJSON(chemin, simplifyDataFrame = FALSE)
  expect_identical(relu$territory$territoire, "22001")
  expect_identical(relu$themes$mobilite$theme, "mobilite")

  modele_demographie <- modele
  modele_demographie$themes <- list(demographie = list(
    theme = "demographie",
    indicateurs = tibble::tibble(),
    histoires = tibble::tibble(),
    theme_metadata = list(theme = "demographie", label = "Démographie"),
    profils_acces_bpe = NULL,
    distribution_acces_batiments = NULL,
    rampe_acces_batiments = NULL
  ))
  publier_modele_territoire(modele_demographie, sortie = sortie)
  relu_apres_second_theme <- jsonlite::fromJSON(chemin, simplifyDataFrame = FALSE)
  expect_named(relu_apres_second_theme$themes, "demographie")

  modele_programmes <- modele
  modele_programmes$themes <- list(programmes = list(
    theme = "programmes",
    indicateurs = tibble::tibble(),
    histoires = tibble::tibble(),
    theme_metadata = list(theme = "programmes", label = "Programmes"),
    profils_acces_bpe = NULL,
    distribution_acces_batiments = NULL,
    rampe_acces_batiments = NULL
  ))
  publier_modele_territoire(modele_programmes, sortie = sortie)
  relu_apres_programmes <- jsonlite::fromJSON(chemin, simplifyDataFrame = FALSE)
  expect_named(relu_apres_programmes$themes, "programmes")
})

test_that("un run multi-thèmes garde les thèmes dans le même modèle", {
  payload_mobilite <- list(
    territoires = tibble::tibble(
      territoire = c("22001", "22002"), type = "commune",
      nom = c("A", "B"), departement = "22", epci = "200000001"
    ),
    indicateurs = tibble::tibble(
      territoire = c("22001", "22002"), type = "commune", theme = "mobilite",
      key = "nb_buildings", value = c(1, 2)
    ),
    histoires = tibble::tibble(
      territoire = c("22001", "22002"), type = "commune", theme = "mobilite",
      story_key = "vingt-minutes-sans-voiture"
    )
  )
  payload_demographie <- payload_mobilite
  payload_demographie$indicateurs$theme <- "demographie"
  payload_demographie$histoires$theme <- "demographie"
  payloads <- list(mobilite = payload_mobilite, demographie = payload_demographie)
  metadatas <- list(
    mobilite = list(theme = "mobilite", label = "Mobilité"),
    demographie = list(theme = "demographie", label = "Démographie")
  )
  vintages <- list(
    mobilite = data.frame(date_reference = "2025-01-01"),
    demographie = data.frame(date_reference = "2026-01-01")
  )

  modeles <- construire_modeles_territoire(payloads, metadatas, vintages)

  expect_named(modeles, c("22001", "22002"))
  expect_identical(modeles$`22001`$snapshot_id, "2026-01-01")
  expect_named(modeles$`22001`$themes, c("mobilite", "demographie"))

  modele_cible <- construire_modeles_territoire(
    payloads, metadatas, vintages, territoires = "22002"
  )
  expect_named(modele_cible, "22002")

  expect_error(
    publier_modeles_territoire_complet(payloads, metadatas, vintages,
                                        sortie = tempfile("incomplet-")),
    "six thèmes canoniques"
  )
})

test_that("la matérialisation JSON refuse une publication territoriale partielle", {
  entree <- tempfile("modeles-territoire-incomplets-")
  dir.create(entree)
  on.exit(unlink(entree, recursive = TRUE), add = TRUE)

  expect_error(
    publier_modeles_territoire_depuis_json(entree, strict = TRUE),
    "fichiers canoniques manquants"
  )
  expect_identical(
    publier_modeles_territoire_depuis_json(entree, strict = FALSE),
    character(0)
  )
})
