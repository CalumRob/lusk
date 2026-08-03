# reshape_habitat_rp -----------------------------------------------------------
# Le remodelage de la source RP Logements (issue #14) : les fichiers longs
# INSEE (DS_RP_LOGEMENT_PRINC, docs/research/rp-logements.md) vers la table
# des communes bretonnes par le stock de logements — une ligne par commune,
# portant les champs des deux indicateurs de stock (mix de logements ;
# statut d'occupation / ancienneté / taille). Les pivots sont spécifiques à
# cette source et restent dans ce fichier (fragment de la vague 2) ; le lecteur
# CSV partagé (lire_csv_long), le filtre Bretagne (filter_bretagne,
# DEPT_BRETAGNE) et la base des EPCI (lire_epci) sont réutilisés.
#
# Le vocabulaire résolu par la recherche (issues #14) :
#   - RP_MEASURE = "DWELLINGS"  : le nombre de logements (la mesure des comptes)
#   - OCS  : DW_MAIN (RP) / DW_SEC_DW_OCC (RS + occasionnels) / DW_VAC (vacants)
#            / _T (total) — le mix de logements (indicateur 1)
#   - TSH  : 100 (propriétaire) / 200 (locataire) / 300 (gratuit) — le statut
#            d'occupation (indicateur 2, RP seulement)
#   - L_STAY : Y_LT2 / Y2T4 / Y5T9 / Y10T19 / Y20T29 / Y_GE30 — l'ancienneté
#            d'emménagement (indicateur 2, RP seulement)
#   - NOR  : R1 / R2 / R3 / R4 / R_GE5 — la taille en pièces (indicateur 2,
#            RP seulement)
# Chaque ligne « totale » d'une dimension porte _T sur toutes les autres ;
# OBS_STATUS = "A" écarte les doublons d'inclusion (K/W) ; une commune code
# réapparaît en BV2022/AAV2020/etc. — on ne garde que GEO_OBJECT = "COM".

# pivoter_logements_rp --------------------------------------------------------
# Le mix de logements (indicateur 1) : DWELLINGS ventilé par OCS, toutes les
# autres dimensions au total (_T), recensement 2023, statut A.
pivoter_logements_rp <- function(long) {
  long %>%
    dplyr::filter(
      GEO_OBJECT == "COM",
      RP_MEASURE == "DWELLINGS",
      TIME_PERIOD == 2023, OBS_STATUS == "A",
      L_STAY == "_T", TDW == "_T", CARS == "_T", CARPARK == "_T",
      NOR == "_T", TSH == "_T", BUILD_END == "_T", NRG_SRC == "_T"
    ) %>%
    dplyr::select(GEO, OCS, OBS_VALUE) %>%
    tidyr::pivot_wider(id_cols = GEO, names_from = OCS, values_from = OBS_VALUE) %>%
    dplyr::rename(
      logements = `_T`,
      logements_principales = DW_MAIN,
      logements_secondaires = DW_SEC_DW_OCC,
      logements_vacants = DW_VAC
    )
}

# pivoter_statut_rp -----------------------------------------------------------
# Le statut d'occupation (indicateur 2) : DWELLINGS des résidences principales
# (OCS = DW_MAIN) ventilé par TSH — propriétaire (100), locataire (200), logé
# gratuitement (300). Les sous-catégories de locataire (211/212_222/221) sont
# laissées de côté : 200 = 211 + 212_222 + 221, vérifié sur Rennes.
pivoter_statut_rp <- function(long) {
  long %>%
    dplyr::filter(
      GEO_OBJECT == "COM",
      RP_MEASURE == "DWELLINGS", OCS == "DW_MAIN",
      TIME_PERIOD == 2023, OBS_STATUS == "A",
      TSH %in% c("100", "200", "300"),
      L_STAY == "_T", TDW == "_T", CARS == "_T", CARPARK == "_T",
      NOR == "_T", BUILD_END == "_T", NRG_SRC == "_T"
    ) %>%
    dplyr::select(GEO, TSH, OBS_VALUE) %>%
    tidyr::pivot_wider(id_cols = GEO, names_from = TSH, values_from = OBS_VALUE) %>%
    dplyr::rename(
      statut_proprietaire = `100`,
      statut_locataire = `200`,
      statut_loge_gratuit = `300`
    )
}

# pivoter_anciennete_rp -------------------------------------------------------
# L'ancienneté d'emménagement (indicateur 2) : DWELLINGS des RP ventilé par
# L_STAY — les 6 tranches documentées.
pivoter_anciennete_rp <- function(long) {
  long %>%
    dplyr::filter(
      GEO_OBJECT == "COM",
      RP_MEASURE == "DWELLINGS", OCS == "DW_MAIN",
      TIME_PERIOD == 2023, OBS_STATUS == "A",
      L_STAY %in% c("Y_LT2", "Y2T4", "Y5T9", "Y10T19", "Y20T29", "Y_GE30"),
      TDW == "_T", CARS == "_T", CARPARK == "_T", NOR == "_T",
      TSH == "_T", BUILD_END == "_T", NRG_SRC == "_T"
    ) %>%
    dplyr::select(GEO, L_STAY, OBS_VALUE) %>%
    tidyr::pivot_wider(id_cols = GEO, names_from = L_STAY, values_from = OBS_VALUE) %>%
    dplyr::rename(
      anciennete_lt2 = Y_LT2, anciennete_2_4 = Y2T4, anciennete_5_9 = Y5T9,
      anciennete_10_19 = Y10T19, anciennete_20_29 = Y20T29,
      anciennete_30_plus = Y_GE30
    )
}

# pivoter_taille_rp -----------------------------------------------------------
# La taille (indicateur 2) : DWELLINGS des RP ventilé par NOR — R1 à R_GE5.
pivoter_taille_rp <- function(long) {
  long %>%
    dplyr::filter(
      GEO_OBJECT == "COM",
      RP_MEASURE == "DWELLINGS", OCS == "DW_MAIN",
      TIME_PERIOD == 2023, OBS_STATUS == "A",
      NOR %in% c("R1", "R2", "R3", "R4", "R_GE5"),
      L_STAY == "_T", TDW == "_T", CARS == "_T", CARPARK == "_T",
      TSH == "_T", BUILD_END == "_T", NRG_SRC == "_T"
    ) %>%
    dplyr::select(GEO, NOR, OBS_VALUE) %>%
    tidyr::pivot_wider(id_cols = GEO, names_from = NOR, values_from = OBS_VALUE) %>%
    dplyr::rename(
      taille_r1 = R1, taille_r2 = R2, taille_r3 = R3, taille_r4 = R4,
      taille_5_plus = R_GE5
    )
}

# assembler_communes_rp -------------------------------------------------------
# Assemble les quatre pivots en une table par commune bretonne, dans la forme
# du contrat. La jointure avec la base des EPCI (limitée à la Bretagne) est LE
# filtre : les communes hors 22/29/35/56 tombent (même pattern que Démographie).
assembler_communes_rp <- function(logements, statut, anciennete, taille, epci) {
  logements %>%
    dplyr::left_join(statut, by = "GEO") %>%
    dplyr::left_join(anciennete, by = "GEO") %>%
    dplyr::left_join(taille, by = "GEO") %>%
    dplyr::inner_join(epci, by = c("GEO" = "CODGEO")) %>%
    dplyr::rename(
      code = GEO, nom = LIBGEO, departement = DEP, epci = EPCI,
      nom_epci = LIBEPCI
    ) %>%
    dplyr::select(code, nom, departement, epci, nom_epci,
                  logements, logements_principales, logements_secondaires,
                  logements_vacants,
                  statut_proprietaire, statut_locataire, statut_loge_gratuit,
                  anciennete_lt2, anciennete_2_4, anciennete_5_9,
                  anciennete_10_19, anciennete_20_29, anciennete_30_plus,
                  taille_r1, taille_r2, taille_r3, taille_r4, taille_5_plus)
}

# construire_donnees_brut_rp --------------------------------------------------
# L'acte « trouver la donnée » de la source : décompresse le cache brut, lit le
# fichier long RP Logements + la base des EPCI (partagée), et produit la table
# des communes bretonnes par le stock de logements dans la forme du contrat.
# La base des EPCI est le référentiel partagé des territoires (le fragment de
# manifeste Démographie la télécharge ; le manifeste du thème Habitat — T3 —
# concatènera les fragments).
construire_donnees_brut_rp <- function(cache = "data/raw",
                                       sortie = "data/processed/communes_habitat_rp.rds") {
  extrait <- file.path(cache, "extracted")
  if (!dir.exists(extrait)) dir.create(extrait, recursive = TRUE)
  if (!dir.exists(dirname(sortie))) dir.create(dirname(sortie), recursive = TRUE)

  # décompresse (idempotent : overwrite = FALSE — les fichiers déjà extraits
  # sont laissés intacts, sans spammer de warning à chaque relance)
  for (f in MANIFEST_HABITAT_RP$fichier) {
    suppressWarnings(
      utils::unzip(file.path(cache, f), exdir = extrait, overwrite = FALSE)
    )
  }

  long <- lire_csv_long(
    file.path(extrait, "DS_RP_LOGEMENT_PRINC_2023_data.csv")
  )
  epci <- lire_epci(file.path(extrait, "EPCI_au_01-01-2025.xlsx"))

  brut <- assembler_communes_rp(
    pivoter_logements_rp(long), pivoter_statut_rp(long),
    pivoter_anciennete_rp(long), pivoter_taille_rp(long), epci
  )

  # L'étape « filter » documentée : la jointure EPCI (limitée à la Bretagne)
  # est LE filtre ; filter_bretagne est la garde explicite du schéma.
  brut <- filter_bretagne(brut)

  readr::write_rds(brut, sortie)
  brut
}
