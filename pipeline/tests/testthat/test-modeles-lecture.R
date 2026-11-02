# test-modeles-lecture -----------------------------------------------------------
# Issue #890 : la génération PLANIFIÉE des modèles de lecture est retirée du
# graphe (#890) — les générateurs/publieurs d'indicateurs et de manifeste sont
# supprimés du paquet, les cibles modeles_lecture_<thème>,
# manifeste_modeles_lecture et modeles_territoire disparaissent de _targets.R
# (test-targets-graphe-cinq-themes). Les artefacts déjà publiés
# (public/data/modeles-lecture/**, app/dist/data/**) et leurs validateurs
# restent inchangés. Les builders/publieurs de modèles de TERRITOIRE restent :
# la commande manuelle de rafraîchissement JSON
# (pipeline/scripts/publish-territory-models.R ->
#  publier_modeles_territoire_depuis_json) en est le seul générateur restant
# jusqu'au suivi #891 — les tests ci-dessous couvrent ce chemin retenu.

test_that("la génération planifiée des modèles de lecture est retirée du paquet (#890)", {
  ns <- asNamespace("lusk")
  # les générateurs/publieurs d'indicateurs et de manifeste, devenus
  # injoignables depuis le graphe, ne font plus partie du paquet
  for (fonction in c("construire_modele_indicateur", "publier_modele_indicateur",
                     "publier_modeles_lecture", "construire_manifeste_modeles_lecture",
                     "publier_manifeste_modeles_lecture")) {
    expect_false(exists(fonction, envir = ns, inherits = FALSE), info = fonction)
  }
  # le chemin retenu de l'aide manuelle JSON reste présent (#891 le retirera)
  for (fonction in c("publier_modeles_territoire_depuis_json",
                     "publier_modeles_territoire_complet",
                     "construire_modeles_territoire", "construire_modele_territoire",
                     "publier_modele_territoire")) {
    expect_true(exists(fonction, envir = ns, inherits = FALSE), info = fonction)
  }
})

test_that("l'identifiant de snapshot vient des vintages", {
  expect_identical(
    identifiant_snapshot(data.frame(
      date_reference = c("2023-01-01", NA, "2025-01-01")
    )),
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
  expect_identical(
    names(modele$themes$mobilite$comparaisons),
    c("epci", "bretagne")
  )
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

test_that("un modèle communal publie les contextes densité, EPCI et Bretagne", {
  territoires <- tibble::tribble(
    ~territoire, ~type, ~nom, ~departement, ~epci,
    ~classe_densite_code, ~classe_densite_libelle_insee,
    ~classe_densite_libelle_public,
    "22001", "commune", "Commune A", "22", "200000001", "1",
    "Grands centres urbains", "grands centres urbains bretons",
    "22002", "commune", "Commune B", "22", "200000001", "1",
    "Grands centres urbains", "grands centres urbains bretons",
    "22003", "commune", "Commune sans EPCI", "22", NA_character_, "2",
    "Centres urbains intermédiaires", "centres urbains intermédiaires bretons",
    "22004", "commune", "Commune d'un autre EPCI", "22", "200000002", "1",
    "Grands centres urbains", "grands centres urbains bretons",
    "200000001", "epci", "EPCI X", "22", NA_character_, NA_character_,
    NA_character_, NA_character_,
    "22", "departement", "Département 22", "22", NA_character_, NA_character_,
    NA_character_, NA_character_,
    "53", "region", "Bretagne", NA_character_, NA_character_, NA_character_,
    NA_character_, NA_character_,
    "29001", "commune", "Commune C", "29", "200000002", "3",
    "Petites villes", "petites villes bretonnes"
  )
  indicateurs <- tibble::tibble(
    territoire = c("22001", "22002", "22003", "22004", "29001", "53"),
    type = c("commune", "commune", "commune", "commune", "commune", "region"),
    theme = "mobilite",
    key = "nb_buildings",
    detail = NA_character_,
    value = c(100, 200, 300, 600, 400, 1000),
    unit = "bâtiments"
  )
  indicateurs <- dplyr::bind_rows(indicateurs, tibble::tibble(
    territoire = c("22001", "22002", "22004"), type = "commune",
    theme = "mobilite", key = "avg_div_t", detail = NA_character_,
    value = c(10, 20, 40), unit = "types / bâtiment"
  ))
  histoires <- tibble::tibble(
    territoire = "53",
    type = "region",
    theme = "mobilite",
    story_key = "vingt-minutes-sans-voiture",
    groupe = "acces-aux-services"
  )
  payload <- list(
    territoires = territoires,
    indicateurs = indicateurs,
    histoires = histoires,
    profils_acces_bpe = NULL,
    distribution_acces_batiments = NULL,
    rampe_acces_batiments = NULL,
    distribution_acces_batiments_comparaisons = tibble::tibble(
      territoire = rep("22001", 3),
      type = rep("commune", 3),
      comparison_mode = c("densite", "epci", "bretagne"),
      scope_kind = c("communes-densite", "communes-epci", "communes-bretagne"),
      scope_label = c("grands centres urbains bretons", "communes de EPCI X", "communes bretonnes"),
      breadth_bucket = "1-9",
      depth_bucket = "1-9",
      comparison_total_buildings = c(5L, 10L, 20L),
      comparison_building_count = c(5L, 10L, 20L),
      comparison_share = c(1, 1, 1)
    ),
    rampe_acces_batiments_comparaisons = tibble::tibble(
      territoire = rep("22001", 3),
      type = rep("commune", 3),
      comparison_mode = c("densite", "epci", "bretagne"),
      scope_kind = c("communes-densite", "communes-epci", "communes-bretagne"),
      scope_label = c("grands centres urbains bretons", "communes de EPCI X", "communes bretonnes"),
      mode = "t",
      quantile = 0.5,
      comparison_total_buildings = c(5L, 10L, 20L),
      comparison_accessible_types = c(3, 4, 5)
    )
  )

  commune <- construire_modele_territoire(
    payload = payload,
    metadata = list(theme = "mobilite", label = "Mobilité"),
    territoire = "22001",
    snapshot_id = "2026-09-15",
    directions = list(nb_buildings = "high", avg_div_t = "high")
  )
  contextes <- commune$themes$mobilite$comparaisons

  expect_named(contextes, c("densite", "epci", "bretagne"))
  expect_identical(
    contextes$densite$scope,
    list(kind = "communes-densite", label = "grands centres urbains bretons")
  )
  expect_identical(
    contextes$densite$faits |>
      dplyr::filter(.data$key == "nb_buildings") |>
      dplyr::select(rank_position, rank_size, reference_value),
    tibble::tibble(rank_position = 3, rank_size = 3L, reference_value = 200)
  )
  expect_identical(
    contextes$densite$distribution_batiments,
    list(
      label = "grands centres urbains bretons",
      total_buildings = 5L,
      cells = tibble::tibble(
        breadth_bucket = "1-9",
        depth_bucket = "1-9",
        building_count = 5L,
        share = 1
      )
    )
  )
  expect_identical(
    contextes$densite$rampe_acces,
    list(
      label = "grands centres urbains bretons",
      total_buildings = 5L,
      points = tibble::tibble(
        mode = "t",
        quantile = 0.5,
        accessible_types = 3
      )
    )
  )
  # A legacy table may still carry a generic label; the published context owns
  # the canonical public EPCI name and must not duplicate the generic wording.
  legacy_payload <- payload
  legacy_payload$distribution_acces_batiments_comparaisons <- NULL
  legacy_payload$rampe_acces_batiments_comparaisons <- NULL
  legacy_payload$distribution_acces_batiments <- tibble::tibble(
    territoire = "22001", comparison_label = "communes de l'EPCI",
    comparison_total_buildings = 5L, breadth_bucket = "1-9",
    depth_bucket = "1-9", comparison_building_count = 5L,
    comparison_share = 1
  )
  legacy_payload$rampe_acces_batiments <- tibble::tibble(
    territoire = "22001", comparison_label = "communes de l'EPCI",
    comparison_total_buildings = 5L, mode = "t", quantile = 0.5,
    comparison_accessible_types = 3
  )
  legacy <- construire_modele_territoire(
    legacy_payload, list(theme = "mobilite", label = "Mobilité"), "22001", "2026-09-15"
  )$themes$mobilite$comparaisons
  expect_identical(legacy$epci$distribution_batiments$label, "communes de EPCI X")
  expect_identical(legacy$epci$rampe_acces$label, "communes de EPCI X")
  expect_null(legacy$bretagne$distribution_batiments)
  expect_null(legacy$bretagne$rampe_acces)
  for (mode in c("densite", "epci", "bretagne")) {
    expect_identical(contextes[[mode]]$distribution_batiments$label,
                     contextes[[mode]]$scope$label)
    expect_identical(contextes[[mode]]$rampe_acces$label,
                     contextes[[mode]]$scope$label)
  }
  expect_identical(contextes$epci$distribution_batiments$total_buildings, 10L)
  expect_identical(contextes$bretagne$distribution_batiments$total_buildings, 20L)
  expect_identical(contextes$epci$rampe_acces$points$accessible_types, 4)
  expect_identical(contextes$bretagne$rampe_acces$points$accessible_types, 5)
  expect_identical(
    contextes$epci$faits |>
      dplyr::filter(.data$key == "nb_buildings") |>
      dplyr::select(rank_position, rank_size, reference_value),
    tibble::tibble(rank_position = 2, rank_size = 2L, reference_value = 150)
  )
  reference_ponderee <- contextes$epci$faits |>
    dplyr::filter(.data$key == "avg_div_t")
  expect_identical(reference_ponderee$reference_kind, "mean")
  expect_equal(reference_ponderee$reference_value, (100 * 10 + 200 * 20) / 300)
  expect_identical(
    contextes$bretagne$faits |>
      dplyr::filter(.data$key == "nb_buildings") |>
      dplyr::select(rank_position, rank_size, reference_value),
    tibble::tibble(rank_position = 5, rank_size = 5L, reference_value = 300)
  )

  sans_epci <- construire_modele_territoire(
    payload = payload,
    metadata = list(theme = "mobilite", label = "Mobilité"),
    territoire = "22003",
    snapshot_id = "2026-09-15",
    directions = list(nb_buildings = "high")
  )
  contextes_sans_epci <- sans_epci$themes$mobilite$comparaisons

  expect_named(contextes_sans_epci, c("densite", "bretagne"))
  expect_true(is.na(contextes_sans_epci$densite$faits$rank_position[[1L]]))
  expect_true(is.na(contextes_sans_epci$densite$faits$reference_value[[1L]]))
  expect_identical(
    contextes_sans_epci$bretagne$faits |>
      dplyr::filter(.data$key == "nb_buildings") |>
      dplyr::select(rank_position, rank_size),
    tibble::tibble(rank_position = 3, rank_size = 5L)
  )

  incoherent <- payload
  incoherent$distribution_acces_batiments_comparaisons$scope_label <-
    "communes bretonnes"
  expect_error(
    construire_modele_territoire(
      payload = incoherent,
      metadata = list(theme = "mobilite", label = "Mobilité"),
      territoire = "22001",
      snapshot_id = "2026-09-15",
      directions = list(nb_buildings = "high")
    ),
    "projection bâtiment.*périmètre"
  )

  mode_inconnu <- payload
  mode_inconnu$distribution_acces_batiments_comparaisons$comparison_mode <-
    "contexte-inconnu"
  expect_error(
    construire_modele_territoire(
      payload = mode_inconnu,
      metadata = list(theme = "mobilite", label = "Mobilité"),
      territoire = "22001",
      snapshot_id = "2026-09-15",
      directions = list(nb_buildings = "high")
    ),
    "mode de comparaison inconnu"
  )

  projection_dupliquee <- payload
  projection_dupliquee$distribution_acces_batiments_comparaisons <-
    dplyr::bind_rows(
      projection_dupliquee$distribution_acces_batiments_comparaisons,
      projection_dupliquee$distribution_acces_batiments_comparaisons
    )
  expect_error(
    construire_modele_territoire(
      payload = projection_dupliquee,
      metadata = list(theme = "mobilite", label = "Mobilité"),
      territoire = "22001",
      snapshot_id = "2026-09-15",
      directions = list(nb_buildings = "high")
    ),
    "projection bâtiment.*double"
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
  payload_mobilite$distribution_acces_batiments_comparaisons <- tibble::tibble(
    territoire = c("22001", "22002"), type = "commune",
    comparison_mode = "bretagne", scope_kind = "communes-bretagne",
    scope_label = "communes bretonnes", breadth_bucket = "1-9",
    depth_bucket = "1-9", comparison_total_buildings = c(2L, 3L),
    comparison_building_count = c(2L, 3L), comparison_share = 1
  )
  payload_mobilite$rampe_acces_batiments_comparaisons <- tibble::tibble(
    territoire = c("22001", "22002"), type = "commune",
    comparison_mode = "bretagne", scope_kind = "communes-bretagne",
    scope_label = "communes bretonnes", mode = "t", quantile = 0.5,
    comparison_total_buildings = c(2L, 3L),
    comparison_accessible_types = c(4, 5)
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
  expect_identical(
    modeles$`22001`$themes$mobilite$comparaisons$bretagne$distribution_batiments$total_buildings,
    2L
  )
  expect_identical(
    modeles$`22002`$themes$mobilite$comparaisons$bretagne$distribution_batiments$total_buildings,
    3L
  )
  expect_identical(
    modeles$`22002`$themes$mobilite$comparaisons$bretagne$rampe_acces$points$accessible_types,
    5
  )

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
