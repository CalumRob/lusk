# sources_offre_mobilite -------------------------------------------------------
# Les sources du sous-bloc « L'offre de mobilité alternative » (issue #140) :
# les lecteurs (le réseau/le cache, non testés dans la boucle — la convention
# du pipeline) et les normaliseurs PURS (testés sur la forme réelle) des
# quatre sources du fragment sous-bloc du manifeste :
#   - korrigo              : la base GTFS Korrigo (le zip, dont le stops.txt —
#     les ARRÊTS de la fédération, LA source de l'offre TC) ;
#   - adresses_residentielles : le spine d'adresses résidentielles AEDAR
#     (address_id, code_insee, lon, lat) — la population du calcul Offre TC
#     (décision 2026-11-18) ;
#   - bornes-recharges     : le fichier consolidé IRVE (une ligne par point de
#     charge, avec code_insee_commune et id_station_itinerance) ;
#   - stationnement-velo   : le fichier par commune du hub Ecolab (une ligne
#     par commune × millésime × type d'accroche).
# Les normaliseurs S'ARRÊTENT bruyamment sur une corruption (colonne requise
# manquante, format refusé, identité invalide) — jamais un succès partiel
# silencieux — et documentent les CAVEATS SOURCE (le quart des lignes IRVE
# sans code commune, la couverture du hub) comme des faits, pas des erreurs.
#
# La CORRECTION de la première passe (2026-08-06) :
#   - la SOURCE des arrêts est le stops.txt de la base GTFS Korrigo (27 297
#     arrêts, dont 2 919 STAR) — PAS mobibreizh-stops (24 380 arrêts SANS le
#     réseau STAR de Rennes, un constat de qualité de la donnée documenté dans
#     le manifeste). Le normaliseur lit donc le format GTFS (stop_id,
#     stop_lat, stop_lon) ;
#   - la MÉTHODE de l'offre TC est la VRAIE part des adresses : le spine
#     AEDAR porte un point par adresse résidentielle (reprojeté EPSG:2154)
#     et son code_commune_insee — la fraction des adresses à moins de 500 m
#     d'un arrêt, jamais un proxy de superficie communale.
# Le vocabulaire (CONTEXT.md) : « L'offre de mobilité alternative », « Offre
# TC », « Bornes de recharge », « Stationnement vélo ».

# lire_stops_gtfs ---------------------------------------------------------------
# Le lecteur de la base GTFS Korrigo : l'extraction du stops.txt du zip (le
# fichier qui porte les ARRÊTS de la fédération — 27 297 arrêts, dont 2 919 du
# réseau STAR de Rennes). Non testé dans la boucle (comme les lecteurs de cache).
lire_stops_gtfs <- function(chemin) {
  d <- tempfile("korrigo-gtfs-")
  dir.create(d)
  on.exit(unlink(d, recursive = TRUE), add = TRUE)
  utils::unzip(chemin, files = "stops.txt", exdir = d)
  readr::read_csv(file.path(d, "stops.txt"), show_col_types = FALSE,
                  progress = FALSE)
}

# normaliser_stops_gtfs ---------------------------------------------------------
# La normalisation pure des arrêts GTFS : le tibble brut (une ligne par arrêt
# de stops.txt — stop_id, stop_lat, stop_lon…) vers la table du calcul —
# {stop_id, stop_lat, stop_lon} numériques. Gardes : les colonnes requises
# (stop_id, stop_lat, stop_lon), des coordonnées présentes et convertibles
# (une valeur qui refuse la conversion est une corruption, jamais une NA
# silencieuse), l'unicité des stop_id (un doublon est une corruption) et un
# fichier non vide. Le reste du fichier (stop_code, stop_name…) ne sert pas au
# calcul — il tombe. Trié par stop_id — déterministe.
normaliser_stops_gtfs <- function(stops_brut) {
  requis <- c("stop_id", "stop_lat", "stop_lon")
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

  lat <- suppressWarnings(as.numeric(stops_brut$stop_lat))
  lon <- suppressWarnings(as.numeric(stops_brut$stop_lon))
  if (any(is.na(lat)) || any(is.na(lon))) {
    stop("Arrêts Mobilité corrompus — une stop_lat/stop_lon non numérique.",
         call. = FALSE)
  }

  tibble::tibble(
    stop_id = stops_brut$stop_id,
    stop_lat = lat,
    stop_lon = lon
  ) %>%
    dplyr::arrange(stop_id)
}

# lire_adresses_residentielles ---------------------------------------------------
# Le lecteur de la population d'adresses résidentielles (le spine AEDAR :
# address_id, code_insee, lon, lat). C'est la population qui remplace la couche
# bâtiments dans le calcul Offre TC (décision propriétaire 2026-11-18) : chaque
# adresse est un point, et le code commune est son appartenance administrative.
# Non testé dans la boucle (comme les autres lecteurs de cache).
lire_adresses_residentielles <- function(chemin) {
  if (!file.exists(chemin)) {
    stop("Population d'adresses résidentielles absente du cache (", chemin,
         ") — le spine AEDAR enregistré est requis par Offre TC.",
         call. = FALSE)
  }
  as.data.frame(nanoparquet::read_parquet(chemin))[
    c("address_id", "code_insee", "lon", "lat")
  ]
}

# normaliser_adresses_residentielles ---------------------------------------------
# La normalisation PURE du spine d'adresses vers la table du calcul : un sf
# POINT en EPSG:2154 (le spine porte lon/lat WGS84, reprojetés) avec
# code_commune_insee en caractères. La projection native du spine est 4326, à la
# différence de la couche BDNB (déjà en 2154). Gardes : colonnes requises,
# fichier non vide, identité unique, code commune au format COG (5 chiffres),
# coordonnées présentes et finies. Trié par code puis identité — déterministe.
normaliser_adresses_residentielles <- function(brut) {
  requis <- c("address_id", "code_insee", "lon", "lat")
  manquantes <- setdiff(requis, names(brut))
  if (length(manquantes) > 0) {
    stop("Population d'adresses corrompue — colonne(s) requise(s) manquante(s) : ",
         paste(manquantes, collapse = ", "), ".", call. = FALSE)
  }
  if (nrow(brut) == 0) {
    stop("Population d'adresses corrompue — le fichier ne porte aucune ligne.",
         call. = FALSE)
  }
  if (any(is.na(brut$address_id) | !nzchar(brut$address_id))) {
    stop("Population d'adresses corrompue — un address_id vide.", call. = FALSE)
  }
  if (anyDuplicated(brut$address_id)) {
    stop("Population d'adresses corrompue — des address_id dupliqués.",
         call. = FALSE)
  }
  code <- as.character(brut$code_insee)
  if (any(is.na(code) | !grepl("^[0-9]{5}$", code))) {
    stop("Population d'adresses corrompue — un code_insee hors format COG ",
         "(5 chiffres).", call. = FALSE)
  }
  lon <- as.numeric(brut$lon)
  lat <- as.numeric(brut$lat)
  if (any(!is.finite(lon)) || any(!is.finite(lat))) {
    stop("Population d'adresses corrompue — une coordonnée absente ou non finie.",
         call. = FALSE)
  }
  table <- data.frame(
    address_id = brut$address_id,
    code_commune_insee = code,
    lon = lon,
    lat = lat,
    stringsAsFactors = FALSE
  )
  sf::st_as_sf(table, coords = c("lon", "lat"), crs = 4326) %>%
    sf::st_transform(CRS_OFFRE_MOBILITE) %>%
    dplyr::arrange(code_commune_insee, address_id)
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
# des numerateur sur les quatre types), population (le dénominateur, un seul
# par commune × millésime — vérifié : un dénominateur divergent par commune ×
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

# construire_sources_offre_mobilite ----------------------------------------------
# L'acte « trouver la donnée » des sources du sous-bloc : chaque source est
# lue dans le cache (le nom de fichier du manifeste par id — jamais un chemin
# codé en dur) puis normalisée. Retourne la liste nommée (la forme que
# construire_donnees_mobilite assemble) : les arrêts GTFS
# (korrigo), le spine d'adresses (adresses_residentielles), les bornes IRVE
# (bornes_recharges) et le hub vélo (stationnement_velo).
construire_sources_offre_mobilite <- function(cache = "data/raw") {
  fichier <- function(id) {
    MANIFEST_MOBILITE$fichier[MANIFEST_MOBILITE$id == id]
  }
  adresses <- normaliser_adresses_residentielles(
    lire_adresses_residentielles(file.path(cache, AEDAR_ADDRESS_ORIGIN_FILE))
  )
  list(
    korrigo = normaliser_stops_gtfs(
      lire_stops_gtfs(file.path(cache, fichier("korrigo")))
    ),
    adresses_residentielles = adresses,
    bornes_recharges = normaliser_bornes_recharges(
      lire_bornes_recharges(file.path(cache, fichier("bornes-recharges")))
    ),
    stationnement_velo = normaliser_stationnement_velo(
      lire_stationnement_velo(file.path(cache, fichier("stationnement-velo")))
    )
  )
}
