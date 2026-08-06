# sources_offre_mobilite -------------------------------------------------------
# Les sources du sous-bloc « L'offre de mobilité alternative » (issue #140) :
# les lecteurs (le réseau/le cache, non testés dans la boucle — la convention
# du pipeline) et les normaliseurs PURS (testés sur la forme réelle) des cinq
# sources du fragment sous-bloc du manifeste :
#   - korrigo              : la base GTFS Korrigo (le zip, l'extrait de
#     agency.txt — les 24+ réseaux) ;
#   - mobibreizh-stops     : les 24 380 arrêts (stop_coordinates « lat, lon ») ;
#   - communes-france      : le référentiel géographique communal (les
#     géométries — la jointure spatiale arrêts → communes) ;
#   - bornes-recharges     : le fichier consolidé IRVE (une ligne par point de
#     charge, avec code_insee_commune et id_station_itinerance) ;
#   - stationnement-velo   : le fichier par commune du hub Ecolab (une ligne
#     par commune × millésime × type d'accroche).
# Les normaliseurs S'ARRÊTENT bruyamment sur une corruption (colonne requise
# manquante, format refusé, identité invalide) — jamais un succès partiel
# silencieux — et documentent les CAVEATS SOURCE (le quart des lignes IRVE
# sans code commune, la couverture du hub) comme des faits, pas des erreurs.
# Le vocabulaire (CONTEXT.md) : « L'offre de mobilité alternative », « Offre
# TC », « Bornes de recharge », « Stationnement vélo ».

# DISTANCE_ARRET_M -------------------------------------------------------------
# La DÉCISION DE BUILD verrouillée de l'offre TC (l'item 🔶 du contrat,
# docs/themes/mobilite.md §Open items, documenté dans le manifeste) : la
# distance « près d'un arrêt » = 500 m à vol d'oiseau (straight-line) — le
# rayon classique « 10 minutes à pied » de l'offre TC (la famille du PTAL
# britannique, du « stop coverage »). La part des bâtiments près d'un arrêt
# est PROXYÉE par la part de la superficie communale à moins de 500 m d'un
# arrêt (la couche bâtiment par bâtiment vit dans l'analyse portée, pas dans
# le pipeline). Le rayon est UNE constante verrouillée, testée.
DISTANCE_ARRET_M <- 500

# CRS_OFFRE_MOBILITE -----------------------------------------------------------
# La projection du calcul spatial : EPSG:2154 (Lambert-93) — la projection
# nationale française, adaptée à la Bretagne entière, les distances en mètres
# (le buffer de 500 m y est un vrai 500 m). Les sources sont en WGS84
# (EPSG:4326) et sont reprojetées au calcul.
CRS_OFFRE_MOBILITE <- 2154

# lire_stops_mobilite -----------------------------------------------------------
# Le lecteur du fichier réel mobibreizh-stops.csv (l'export ODS, délimiteur
# « ; », tout en caractères — les coordonnées restent textuelles jusqu'au
# normaliseur). Non testé dans la boucle (comme lire_snapshot_mobilite).
lire_stops_mobilite <- function(chemin) {
  readr::read_delim(
    chemin, delim = ";",
    col_types = readr::cols(.default = readr::col_character()),
    show_col_types = FALSE, progress = FALSE,
    locale = readr::locale(encoding = "UTF-8")
  )
}

# normaliser_stops_mobilite ----------------------------------------------------
# La normalisation pure des arrêts : le tibble brut (une ligne par arrêt, tout
# en caractères) vers la table du calcul — {stop_id, stop_lat, stop_lon}
# numériques, la paire « lat, lon » de stop_coordinates découpée. Gardes : les
# colonnes requises, des coordonnées présentes et convertibles, l'unicité des
# stop_id (un doublon est une corruption). Le reste du fichier (stop_name,
# filename…) ne sert pas au calcul — il tombe.
normaliser_stops_mobilite <- function(stops_brut) {
  requis <- c("stop_id", "stop_coordinates")
  manquantes <- setdiff(requis, names(stops_brut))
  if (length(manquantes) > 0) {
    stop("Arrêts Mobilité corrompus — colonne(s) requise(s) manquante(s) : ",
         paste(manquantes, collapse = ", "), ".", call. = FALSE)
  }
  if (nrow(stops_brut) == 0) {
    stop("Arrêts Mobilité corrompus — le fichier ne porte aucune ligne.",
         call. = FALSE)
  }
  if (anyDuplicated(stops_brut$stop_id)) {
    stop("Arrêts Mobilité corrompus — des stop_id dupliqués.", call. = FALSE)
  }

  # « lat, lon » -> deux colonnes numériques (une valeur qui refuse la
  # conversion est une corruption, jamais une NA silencieuse)
  paires <- strsplit(stops_brut$stop_coordinates, ",", fixed = TRUE)
  if (any(lengths(paires) != 2L)) {
    stop("Arrêts Mobilité corrompus — une stop_coordinates hors format « lat, lon ».",
         call. = FALSE)
  }
  lat <- suppressWarnings(as.numeric(trimws(vapply(paires, `[[`, "", 1L))))
  lon <- suppressWarnings(as.numeric(trimws(vapply(paires, `[[`, "", 2L))))
  if (any(is.na(lat)) || any(is.na(lon))) {
    stop("Arrêts Mobilité corrompus — une stop_coordinates non numérique.",
         call. = FALSE)
  }

  tibble::tibble(
    stop_id = stops_brut$stop_id,
    stop_lat = lat,
    stop_lon = lon
  )
}

# lire_bornes_recharges ---------------------------------------------------------
# Le lecteur du fichier réel bornes-recharges.csv (l'export ODS, « ; », tout
# en caractères — les codes restent textuels). Non testé dans la boucle.
lire_bornes_recharges <- function(chemin) {
  readr::read_delim(
    chemin, delim = ";",
    col_types = readr::cols(.default = readr::col_character()),
    show_col_types = FALSE, progress = FALSE,
    locale = readr::locale(encoding = "UTF-8")
  )
}

# normaliser_bornes_recharges ---------------------------------------------------
# La normalisation pure des bornes IRVE : le tibble brut vers la table du
# calcul — {code_insee_commune, id_station_itinerance}. Gardes : les colonnes
# requises, et tout code commune NON VIDE au format COG (5 chiffres). Caveat
# SOURCE documenté (le fichier lui-même le dit : « certaines stations sont mal
# géolocalisées ») : ~un quart des lignes ne porte aucun code_insee_commune —
# elles restent dans la table avec un code NA, et le COMPTEUR (le builder
# calculer_bornes_communes) les écarte du comptage communal. Un code vide
# n'est jamais une corruption — c'est la limite déclarée de la source.
normaliser_bornes_recharges <- function(bornes_brut) {
  requis <- c("code_insee_commune", "id_station_itinerance")
  manquantes <- setdiff(requis, names(bornes_brut))
  if (length(manquantes) > 0) {
    stop("Bornes IRVE corrompues — colonne(s) requise(s) manquante(s) : ",
         paste(manquantes, collapse = ", "), ".", call. = FALSE)
  }
  if (nrow(bornes_brut) == 0) {
    stop("Bornes IRVE corrompues — le fichier ne porte aucune ligne.",
         call. = FALSE)
  }
  codes <- bornes_brut$code_insee_commune
  codes_presents <- !is.na(codes) & nzchar(codes)
  if (any(!grepl("^[0-9]{5}$", codes[codes_presents]))) {
    stop("Bornes IRVE corrompues — un code_insee_commune hors format COG ",
         "(5 chiffres).", call. = FALSE)
  }
  tibble::tibble(
    code_insee_commune = ifelse(codes_presents, codes, NA_character_),
    id_station_itinerance = bornes_brut$id_station_itinerance
  )
}

# lire_stationnement_velo -------------------------------------------------------
# Le lecteur du fichier réel du hub Ecolab (stationnement-velo-commune.csv,
# délimiteur « , »). Les colonnes numériques (numerateur, denominateur,
# valeur) sont lues numériques, la date de mesure en caractères (l'année est
# extraite par le normaliseur). Non testé dans la boucle.
lire_stationnement_velo <- function(chemin) {
  readr::read_delim(
    chemin, delim = ",",
    col_types = readr::cols(
      date_mesure = readr::col_character(),
      geocode_commune = readr::col_character(),
      libelle_commune = readr::col_character(),
      type_accroche = readr::col_character(),
      numerateur = readr::col_double(),
      denominateur = readr::col_double(),
      valeur = readr::col_double()
    ),
    show_col_types = FALSE, progress = FALSE,
    locale = readr::locale(encoding = "UTF-8")
  )
}

# TYPES_ACCRoche_STATIONNEMENT_VELO ---------------------------------------------
# Les quatre types d'accroche du hub Ecolab (l'axe du fichier) : une ligne par
# (commune × millésime × type). La somme sur les quatre types = le nombre
# total de places de la commune (le calcul du hub, vérifié contre son fichier
# région : « summable: false » ne porte que sur les TAUX, jamais sur les
# places). Un type inconnu est une évolution de la source — le normaliseur
# s'arrête (le contrat du hub a changé, à re-vérifier).
TYPES_ACCRCHE_STATIONNEMENT_VELO <- c("roue", "cadre", "cadre et roue",
                                      "sans accroche")

# normaliser_stationnement_velo -------------------------------------------------
# La normalisation pure du hub stationnement vélo : le tibble brut (une ligne
# par commune × millésime × type d'accroche) vers la table du calcul — une
# ligne par (commune × millésime) : {geocode_commune, annee, places (la somme
# des numerateur sur les quatre types), population (le denominateur, un seul
# par commune × millésime — vérifié : un denominateur divergent par commune ×
# millésime est une corruption). L'indicateur est PRIS TEL QUEL du hub
# (décision 2026-08-04) : la recomposition (somme des places ÷ population ×
# 1 000) est EXACTEMENT le calcul du hub — vérifié contre son fichier région
# (Bretagne 2025 : 18,499 places/1 000 hab, identique à la recomposition
# communale). La couverture bretonne est vérifiée ICI : les lignes hors
# départements 22/29/35/56 tombent (le fichier est France entière).
normaliser_stationnement_velo <- function(velo_brut) {
  requis <- c("geocode_commune", "date_mesure", "type_accroche",
              "numerateur", "denominateur")
  manquantes <- setdiff(requis, names(velo_brut))
  if (length(manquantes) > 0) {
    stop("Stationnement vélo corrompu — colonne(s) requise(s) manquante(s) : ",
         paste(manquantes, collapse = ", "), ".", call. = FALSE)
  }
  if (nrow(velo_brut) == 0) {
    stop("Stationnement vélo corrompu — le fichier ne porte aucune ligne.",
         call. = FALSE)
  }
  if (!all(velo_brut$type_accroche %in% TYPES_ACCRCHE_STATIONNEMENT_VELO)) {
    stop("Stationnement vélo corrompu — un type d'accroche inconnu du contrat ",
         "du hub (roue / cadre / cadre et roue / sans accroche).",
         call. = FALSE)
  }
  annee <- substr(velo_brut$date_mesure, 1, 4)
  if (any(!grepl("^[0-9]{4}$", annee))) {
    stop("Stationnement vélo corrompu — une date_mesure hors format ISO.",
         call. = FALSE)
  }

  # la garde Bretagne (le fichier est France entière) — les lignes bretonnes
  # seules. La garde du format COG s'applique au sous-ensemble breton : le
  # fichier complet porte des codes hors COG numérique (la Corse 2Axxx, les
  # DOM) qui sont hors sujet, jamais une corruption.
  breton <- velo_brut[substr(velo_brut$geocode_commune, 1, 2) %in%
                        DEPT_BRETAGNE, ]
  if (nrow(breton) == 0) {
    stop("Stationnement vélo corrompu — aucune ligne bretonne (22/29/35/56).",
         call. = FALSE)
  }
  if (any(!grepl("^[0-9]{5}$", breton$geocode_commune))) {
    stop("Stationnement vélo corrompu — un geocode_commune breton hors format ",
         "COG (5 chiffres).", call. = FALSE)
  }

  # une ligne par (commune × millésime) : la somme des places sur les types
  # d'accroche, UN dénominateur par groupe (un dénominateur divergent = une
  # corruption — la population d'une commune × millésime est une seule valeur)
  agrege <- breton %>%
    dplyr::mutate(annee = substr(date_mesure, 1, 4)) %>%
    dplyr::group_by(geocode_commune, annee) %>%
    dplyr::summarise(
      places = sum(numerateur),
      population = dplyr::first(denominateur),
      n_types = dplyr::n(),
      n_denominateurs = length(unique(denominateur)),
      .groups = "drop"
    )
  if (any(agrege$n_types != length(TYPES_ACCRCHE_STATIONNEMENT_VELO))) {
    stop("Stationnement vélo corrompu — un (commune × millésime) ne porte pas ",
         "les quatre types d'accroche du contrat du hub.", call. = FALSE)
  }
  if (any(agrege$n_denominateurs > 1)) {
    stop("Stationnement vélo corrompu — des dénominateurs divergents pour un ",
         "même (commune × millésime).", call. = FALSE)
  }
  agrege %>%
    dplyr::mutate(
      places_1000 = places / population * 1000
    ) %>%
    dplyr::select(geocode_commune, annee, places, population, places_1000) %>%
    dplyr::arrange(geocode_commune, annee)
}

# lire_communes_referentiel ------------------------------------------------------
# Le lecteur du référentiel géographique communal (communes-france.geojson,
# l'export GeoJSON ODS — une feature par commune bretonne, com_code +
# geometry). sf::st_read via GDAL — non testé dans la boucle (le réseau et
# GDAL ne font pas partie de la boucle de test).
lire_communes_referentiel <- function(chemin) {
  sf::st_read(chemin, quiet = TRUE)
}

# normaliser_communes_referentiel ------------------------------------------------
# La normalisation pure du référentiel : le sf brut vers la table du calcul —
# {com_code, geometry} en WGS84. Gardes : la colonne com_code, des géométries
# présentes et valides, les communes bretonnes seules (22/29/35/56), et le
# NOMBRE verrouillé de communes (1 202 — le référentiel breton ODS ; un
# écart est une évolution de la source, à re-vérifier, jamais silencieux).
# Toutes les colonnes du référentiel sauf com_code et la géométrie tombent.
normaliser_communes_referentiel <- function(communes) {
  if (!inherits(communes, "sf")) {
    stop("Référentiel communal corrompu — le fichier n'est pas un objet sf.",
         call. = FALSE)
  }
  if (!"com_code" %in% names(communes)) {
    stop("Référentiel communal corrompu — colonne requise manquante : com_code.",
         call. = FALSE)
  }
  if (nrow(communes) == 0) {
    stop("Référentiel communal corrompu — aucune feature.", call. = FALSE)
  }
  if (any(!grepl("^[0-9]{5}$", as.character(communes$com_code)))) {
    stop("Référentiel communal corrompu — un com_code hors format COG.",
         call. = FALSE)
  }
  dep <- substr(as.character(communes$com_code), 1, 2)
  communes <- communes[dep %in% DEPT_BRETAGNE, ]
  if (nrow(communes) != 1202) {
    stop("Référentiel communal corrompu — ", nrow(communes),
         " communes bretonnes au lieu des 1 202 du référentiel ODS.",
         call. = FALSE)
  }
  if (any(!sf::st_is_valid(communes))) {
    stop("Référentiel communal corrompu — une géométrie communale invalide.",
         call. = FALSE)
  }
  communes %>%
    dplyr::select(com_code) %>%
    dplyr::mutate(com_code = as.character(com_code))
}

# lire_korrigo_gtfs --------------------------------------------------------------
# Le lecteur de la base GTFS Korrigo : l'extrait d'agency.txt du zip (le
# fichier qui porte les réseaux — la provenance « 24 réseaux » du contrat).
# Non testé dans la boucle.
lire_korrigo_gtfs <- function(chemin) {
  d <- tempfile("korrigo-gtfs-")
  dir.create(d)
  on.exit(unlink(d, recursive = TRUE), add = TRUE)
  utils::unzip(chemin, files = "agency.txt", exdir = d)
  readr::read_csv(file.path(d, "agency.txt"), show_col_types = FALSE,
                  progress = FALSE)
}

# normaliser_korrigo_gtfs --------------------------------------------------------
# La normalisation pure du réseau Korrigo : la table agency.txt vers la table
# du calcul — {agency_id, agency_name} — le registre des réseaux de la base
# (le contrat dit « 24 réseaux » ; l'extrait réel porte 32 agencies — le
# compte réel est verrouillé par l'E2E, le chiffre documenté du contrat est
# plus ancien). Garde : les colonnes requises.
normaliser_korrigo_gtfs <- function(agency) {
  requis <- c("agency_id", "agency_name")
  manquantes <- setdiff(requis, names(agency))
  if (length(manquantes) > 0) {
    stop("Base GTFS Korrigo corrompue — colonne(s) requise(s) manquante(s) : ",
         paste(manquantes, collapse = ", "), ".", call. = FALSE)
  }
  agency %>%
    dplyr::select(agency_id, agency_name) %>%
    dplyr::arrange(agency_id)
}

# construire_sources_offre_mobilite ----------------------------------------------
# L'acte « trouver la donnée » des sources du sous-bloc : chaque source est
# lue dans le cache (le nom de fichier du manifeste par id — jamais un chemin
# codé en dur) puis normalisée. Retourne la liste nommée (la forme que
# construire_donnees_mobilite assemble à mobilite_snapshot).
construire_sources_offre_mobilite <- function(cache = "data/raw") {
  fichier <- function(id) {
    MANIFEST_MOBILITE$fichier[MANIFEST_MOBILITE$id == id]
  }
  list(
    korrigo = normaliser_korrigo_gtfs(
      lire_korrigo_gtfs(file.path(cache, fichier("korrigo")))
    ),
    mobibreizh_stops = normaliser_stops_mobilite(
      lire_stops_mobilite(file.path(cache, fichier("mobibreizh-stops")))
    ),
    communes_referentiel = normaliser_communes_referentiel(
      lire_communes_referentiel(file.path(cache, fichier("communes-france")))
    ),
    bornes_recharges = normaliser_bornes_recharges(
      lire_bornes_recharges(file.path(cache, fichier("bornes-recharges")))
    ),
    stationnement_velo = normaliser_stationnement_velo(
      lire_stationnement_velo(file.path(cache, fichier("stationnement-velo")))
    )
  )
}
