# helper-reference-canonique ---------------------------------------------------
# TEST ONLY. Ces helpers ne sont JAMAIS appelés par le pipeline de production :
# les producteurs réels exigent la dimension canonique (#1057). Ils fournissent
# aux fixtures bornées l'ancienne référence « dérivée des lignes du thème »,
# désormais interdite hors de ce répertoire de tests. Le nom _test explicite
# rend tout appel accidentel depuis R/ visible en revue.

reference_territoires_theme_test <- function(territoires) {
  reference_territoires(territoires)
}

# Une base EPCI synthétique couvrant EXACTEMENT l'univers communal épinglé.
# Les deux îles n'ont pas d'EPCI ; les communes des fixtures gardent leurs
# SIREN (les faits les citent). Sert aux seams de run_pipeline qui ne déposent
# pas les épingles réelles dans leur cache temporaire.
pop_canonique_test <- function() {
  readr::read_csv(
    testthat::test_path("..", "..", "inst", "extdata",
                        "population_communes_2023.csv"),
    col_types = readr::cols(.default = readr::col_character()),
    show_col_types = FALSE
  )
}

base_epci_canonique_test <- function() {
  pop <- pop_canonique_test()
  codes <- pop$code_commune
  dep <- substr(codes, 1L, 2L)
  sans_epci <- codes %in% c("29083", "29084")
  epci_fixture <- c(
    "22001" = "200000001", "22002" = "200000001",
    "29001" = "200000002", "29002" = "200000002", "29003" = "200000002",
    "35001" = "200000003", "56001" = "200000003"
  )
  nom_epci_fixture <- c(
    "200000001" = "EPCI X", "200000002" = "EPCI Y", "200000003" = "EPCI Z"
  )
  epci <- ifelse(sans_epci, NA_character_,
                 ifelse(codes %in% names(epci_fixture),
                        unname(epci_fixture[codes]), paste0("2", dep, "000001")))
  nom_epci <- ifelse(sans_epci, NA_character_,
                     ifelse(epci %in% names(nom_epci_fixture),
                            unname(nom_epci_fixture[epci]), paste0("EPCI ", dep)))
  tibble::tibble(
    CODGEO = codes, LIBGEO = paste0("Commune ", codes),
    EPCI = epci, LIBEPCI = nom_epci, DEP = dep, REG = "53"
  )
}

# La base des EPCI du fixture Habitat (six communes) — pour que le seam de
# cache de run_pipeline produise une référence de la MÊME taille que les faits
# Habitat du fixture (les profils denses exigent un univers de territoires
# exactement couvert par les faits).
base_epci_habitat_test <- function() {
  communes <- load_fixture_habitat()$communes
  tibble::tibble(
    CODGEO = as.character(communes$code),
    LIBGEO = as.character(communes$nom),
    EPCI = as.character(communes$epci),
    LIBEPCI = as.character(communes$nom_epci),
    DEP = as.character(communes$departement),
    REG = "53"
  )
}

# La référence canonique SYNTHÉTIQUE (sans classifications — la forme de
# transition est valide) utilisée par les seams de run_pipeline bornés.
reference_canonique_minimale_test <- function() {
  reference_territoires_canonique(base_epci_canonique_test())
}

# Seam de CACHE pour les tests de run_pipeline : ils mockent `lire_epci` avec
# leur propre base de fixture (4 communes) et vérifient des noms/ comptes
# attachés à CETTE base. Le mock du cache doit donc dériver la référence de la
# même base mockée — jamais du référentiel réel 1 202 communes. C'est un test-
# only helper : aucun producteur de production ne l'appelle.
reference_cache_seam_test <- function(cache, noms_epci_geo_api = NULL) {
  # Le mapping Geo API réel ne connaît pas les SIREN synthétiques des fixtures :
  # on garde les LIBEPCI de la base mockée (le contrat public est hors boucle).
  chemin <- file.path(cache, "extracted", "EPCI_au_01-01-2025.xlsx")
  # Les seams mockent souvent `lire_epci` SANS déposer le fichier : on tente
  # d'abord le lecteur (mocké ou réel), puis la base synthétique du helper
  # (jamais les lignes de faits du thème).
  base <- tryCatch(
    lire_epci(chemin),
    error = function(e) base_epci_canonique_test()
  )
  communes <- tibble::tibble(
    code = as.character(base$CODGEO),
    nom = as.character(base$LIBGEO),
    departement = as.character(base$DEP),
    epci = as.character(base$EPCI),
    nom_epci = as.character(base$LIBEPCI),
    population = rep(1, nrow(base))
  )
  reference_territoires(squelette_territoires(
    communes, poids = "population", noms_epci_geo_api = NULL
  ))
}

compute_payload_test <- function(data, theme = theme_demographie(),
                                 vintages = NULL, noms_epci_geo_api = NULL,
                                 classes_densite = NULL,
                                 classes_littoral = NULL) {
  territoires <- theme$construire_territoires(data)
  if (!is.null(noms_epci_geo_api)) {
    territoires <- appliquer_noms_epci_geo_api(territoires, noms_epci_geo_api)
  }
  territoires <- appliquer_classifications_communales(
    territoires,
    classes_densite = classes_densite,
    classes_littoral = classes_littoral
  )
  compute_payload(
    data, theme = theme, vintages = vintages,
    noms_epci_geo_api = noms_epci_geo_api,
    classes_densite = classes_densite,
    classes_littoral = classes_littoral,
    reference = reference_territoires_theme_test(territoires)
  )
}

construire_payload_economie_test <- function(analytiques, base_epci, vintages,
                                             noms_epci_geo_api = NULL,
                                             classes_densite = NULL,
                                             classes_littoral = NULL) {
  territoires <- construire_territoires_economie(base_epci, analytiques)
  if (!is.null(noms_epci_geo_api)) {
    territoires <- appliquer_noms_epci_geo_api(territoires, noms_epci_geo_api)
  }
  territoires <- appliquer_classifications_communales(
    territoires,
    classes_densite = classes_densite,
    classes_littoral = classes_littoral
  )
  construire_payload_economie(
    analytiques, base_epci, vintages,
    noms_epci_geo_api = noms_epci_geo_api,
    classes_densite = classes_densite,
    classes_littoral = classes_littoral,
    reference = reference_territoires_theme_test(territoires)
  )
}

construire_payload_mobilite_test <- function(analytiques, base_epci, vintages,
                                             noms_epci_geo_api = NULL,
                                             classes_densite = NULL,
                                             classes_littoral = NULL) {
  territoires <- construire_territoires_mobilite(
    base_epci, analytiques,
    noms_epci_geo_api = noms_epci_geo_api,
    classes_densite = classes_densite,
    classes_littoral = classes_littoral
  )
  construire_payload_mobilite(
    analytiques, base_epci, vintages,
    noms_epci_geo_api = noms_epci_geo_api,
    classes_densite = classes_densite,
    classes_littoral = classes_littoral,
    reference = reference_territoires_theme_test(territoires)
  )
}
