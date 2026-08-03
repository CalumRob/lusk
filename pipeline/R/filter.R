# filter ----------------------------------------------------------------------
# Étape 2 : filtrage + remodelage. Garde la Bretagne (22 · 29 · 35 · 56) et
# transforme les fichiers longs INSEE (GEO/RP_MEASURE/.../OBS_VALUE) en la
# forme du contrat de compute (le fixture).

DEPT_BRETAGNE <- c("22", "29", "35", "56")

filter_bretagne <- function(donnees) {
  donnees %>%
    dplyr::mutate(departement = as.character(departement)) %>%
    dplyr::filter(departement %in% DEPT_BRETAGNE)
}

# pivoter_serie ----------------------------------------------------------------
# Série historique du recensement : population (1968/2017/2023), superficie,
# naissances/décès cumulés entre recensements — une ligne par commune.
# OBS_STATUS = "A" écarte les lignes K/W (doublons d'inclusion) ; on ne garde
# que les mesures et périodes du contrat.
pivoter_serie <- function(long) {
  long %>%
    dplyr::filter(
      GEO_OBJECT == "COM", # une commune réapparaît comme BV2022/AAV2020, etc.
      OBS_STATUS == "A",
      (RP_MEASURE == "POP" & TIME_PERIOD %in% c(1968, 2017, 2023)) |
        (RP_MEASURE %in% c("SUP", "BRTH", "DEATH") & TIME_PERIOD == 2023)
    ) %>%
    dplyr::select(GEO, RP_MEASURE, TIME_PERIOD, OBS_VALUE) %>%
    tidyr::pivot_wider(
      id_cols = GEO,
      names_from = c(RP_MEASURE, TIME_PERIOD),
      values_from = OBS_VALUE
    ) %>%
    dplyr::rename(
      population = `POP_2023`,
      population_1968 = `POP_1968`,
      population_precedente = `POP_2017`,
      superficie_km2 = `SUP_2023`,
      naissances = `BRTH_2023`,
      deces = `DEATH_2023`
    )
}

# pivoter_menages --------------------------------------------------------------
# Ménages (dossier complet) : nombre de ménages et population des ménages —
# les lignes totales (TPH = _T, PCS = _T) des résidences principales.
pivoter_menages <- function(long) {
  long %>%
    dplyr::filter(
      GEO_OBJECT == "COM",
      RP_MEASURE %in% c("DWELLINGS", "DWELLINGS_POPSIZE"),
      OCS == "DW_MAIN", TPH == "_T", PCS == "_T",
      TIME_PERIOD == 2023, OBS_STATUS == "A"
    ) %>%
    dplyr::select(GEO, RP_MEASURE, OBS_VALUE) %>%
    tidyr::pivot_wider(id_cols = GEO, names_from = RP_MEASURE, values_from = OBS_VALUE) %>%
    dplyr::rename(menages = DWELLINGS, population_menages = DWELLINGS_POPSIZE)
}

# pivoter_age -----------------------------------------------------------------
# Population par sexe et âge (PRINC) : les 7 tranches exhaustives + l'agrégat
# moins de 20 ans (Y_LT20), sexe total (_T), recensement 2023, statut A.
pivoter_age <- function(long) {
  long %>%
    dplyr::filter(
      GEO_OBJECT == "COM",
      SEX == "_T", TIME_PERIOD == 2023, OBS_STATUS == "A",
      AGE %in% c("Y_LT15", "Y15T24", "Y25T39", "Y40T54", "Y55T64",
                 "Y65T79", "Y_GE80", "Y_LT20")
    ) %>%
    dplyr::select(GEO, AGE, OBS_VALUE) %>%
    tidyr::pivot_wider(id_cols = GEO, names_from = AGE, values_from = OBS_VALUE) %>%
    dplyr::rename(
      age_lt15 = Y_LT15, age_15_24 = Y15T24, age_25_39 = Y25T39,
      age_40_54 = Y40T54, age_55_64 = Y55T64, age_65_79 = Y65T79,
      age_80_plus = Y_GE80, age_lt20 = Y_LT20
    )
}

# assembler_communes ----------------------------------------------------------
# Assemble les trois pivots en une table par commune, dans la forme du contrat.
# La jointure avec la base des EPCI (limitée à la Bretagne) est LE filtre :
# les communes hors 22/29/35/56 tombent.
assembler_communes <- function(serie, menages, age, epci) {
  serie %>%
    dplyr::left_join(menages, by = "GEO") %>%
    dplyr::left_join(age, by = "GEO") %>%
    dplyr::inner_join(epci, by = c("GEO" = "CODGEO")) %>%
    dplyr::rename(
      code = GEO, nom = LIBGEO, departement = DEP, epci = EPCI,
      nom_epci = LIBEPCI
    ) %>%
    dplyr::select(code, nom, departement, epci, nom_epci,
                  population, population_1968, population_precedente,
                  superficie_km2, naissances, deces,
                  age_lt15, age_15_24, age_25_39, age_40_54,
                  age_55_64, age_65_79, age_80_plus, age_lt20,
                  population_menages, menages)
}

# Les lecteurs I/O -------------------------------------------------------------
# Non testés dans la boucle (comme le téléchargement) : ils lisent les vrais
# fichiers. Les pivots, eux, sont testés sur la forme réelle (test-reshape.R).

lire_csv_long <- function(chemin) {
  readr::read_delim(
    chemin, delim = ";",
    col_types = readr::cols(
      .default = readr::col_character(),
      TIME_PERIOD = readr::col_double(),
      OBS_VALUE = readr::col_double()
    ),
    show_col_types = FALSE, progress = FALSE
  )
}

lire_epci <- function(chemin) {
  # skip = 5 : les 4 premières lignes de la feuille sont titre + métadonnées,
  # la 5e est l'en-tête réel (CODGEO;LIBGEO;EPCI;LIBEPCI;DEP;REG).
  readxl::read_excel(chemin, sheet = "Composition_communale",
                     col_types = "text", skip = 5) %>%
    dplyr::filter(DEP %in% DEPT_BRETAGNE)
}

# construire_donnees_brut -----------------------------------------------------
# L'acte « trouver la donnée » : décompresse le cache brut, lit les trois
# fichiers longs + la base des EPCI, et produit la table des communes
# bretonnes dans la forme du contrat (data/processed).
construire_donnees_brut <- function(cache = "data/raw",
                                    sortie = "data/processed/communes_brut.rds") {
  extrait <- file.path(cache, "extracted")
  if (!dir.exists(extrait)) dir.create(extrait, recursive = TRUE)
  if (!dir.exists(dirname(sortie))) dir.create(dirname(sortie), recursive = TRUE)

  # décompresse (idempotent : overwrite = FALSE — les fichiers déjà extraits
  # sont laissés intacts, sans spammer de warning à chaque relance)
  for (f in MANIFEST_DEMOGRAPHIE$fichier) {
    suppressWarnings(
      utils::unzip(file.path(cache, f), exdir = extrait, overwrite = FALSE)
    )
  }

  serie <- lire_csv_long(
    file.path(extrait, "DS_RP_SERIE_HISTORIQUE_2023_data.csv")
  )
  menages <- lire_csv_long(
    file.path(extrait, "DS_RP_MENAGES_COMP_2023_data.csv")
  )
  age <- lire_csv_long(
    file.path(extrait, "DS_RP_POPULATION_PRINC_2023_data.csv")
  )
  epci <- lire_epci(file.path(extrait, "EPCI_au_01-01-2025.xlsx"))

  brut <- assembler_communes(
    pivoter_serie(serie), pivoter_menages(menages), pivoter_age(age), epci
  )

  # L'étape « filter » documentée (docs/architecture.md) : la jointure EPCI
  # (limitée à la Bretagne) est LE filtre ; filter_bretagne est la garde
  # explicite du schéma — redondante mais défensive, elle coûte une ligne.
  brut <- filter_bretagne(brut)

  readr::write_rds(brut, sortie)
  brut
}
