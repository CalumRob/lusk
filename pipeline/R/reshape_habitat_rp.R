# reshape_habitat_rp -----------------------------------------------------------
# Le remodelage de la source RP Logements (issue #14) : les fichiers longs
# INSEE (DS_RP_LOGEMENT_PRINC, docs/research/rp-logements.md) vers la table
# des communes bretonnes par le stock de logements — une ligne par commune,
# portant les champs des indicateurs de stock (mix de logements ; statut
# d'occupation ; âge du bâti ; type de logement — la taille est sortie du
# payload à l'issue #368, le split statut / âge du bâti / type remplace
# l'ancienne clé à 14 modalités). Les pivots sont spécifiques à
# cette source et restent dans ce fichier (fragment de la vague 2) ; le lecteur
# CSV partagé (lire_csv_long), le filtre Bretagne (filter_bretagne,
# DEPT_BRETAGNE) et la base des EPCI (lire_epci) sont réutilisés.
#
# Le vocabulaire résolu par la recherche (issues #14) :
#   - RP_MEASURE = "DWELLINGS"  : le nombre de logements (la mesure des comptes)
#   - OCS  : DW_MAIN (RP) / DW_SEC_DW_OCC (RS + occasionnels) / DW_VAC (vacants)
#            / _T (total) — le mix de logements (indicateur 1)
#   - TSH  : 100 (propriétaire) / 200 (locataire) / 211 (locataire du parc
#            privé vide) / 212_222 (locataire de logement meublé) / 221
#            (locataire du parc social — le HLM) / 300 (gratuit) — le statut
#            d'occupation (indicateur 2, RP seulement). Depuis l'issue #368, le
#            statut est décliné en QUATRE parts : propriétaire (100), HLM — le
#            parc social (221) —, locataire du parc privé (211 + 212_222) et
#            logé gratuitement (300) : 200 = 211 + 212_222 + 221, les quatre
#            parts partitionnent les résidences principales.
#   - BUILD_END : la période d'achèvement de la construction — Y_LT1919 (avant
#            1919) / Y1919T1945 / Y1946T1970 / Y1971T1990 / Y1991T2005 /
#            Y2006TAAAA (2006 et après) — l'ÂGE DU BÂTI (indicateur 2, RP
#            seulement, issue #368). Les six tranches disjointes couvrent le
#            stock dont la période est connue (~97,7 % des RP en Bretagne — la
#            période inconnue est un fait de la donnée RP, documenté) ; les
#            niveaux agrégés du cube (Y_LT1946, Y1946T1990, Y1991T2009,
#            Y_LT2010, Y_LT2015, Y_LT2021) sont des redondances, jamais pivotées.
#   - TDW  : le type de logement — 1 (maison) / 2 (appartement) / 3T6 (autres
#            logements de métropole) — le TYPE (indicateur 2, RP seulement,
#            issue #368) : les parts maison / appartement, la famille « autres »
#            (~0,7 % des RP) écartée du dénominateur comme les dépendances DVF.
#   - NOR  : la taille en pièces (R1 / R2 / R3 / R4 / R_GE5) — SORTIE du
#            payload à l'issue #368 (le split ne la reprend pas).
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
# (OCS = DW_MAIN) ventilé par TSH — propriétaire (100), locataire du parc
# social — le HLM — (221), locataire du parc privé (211 + 212_222) et logé
# gratuitement (300). Depuis l'issue #368 le locataire est SPLIT en ses deux
# familles : la part HLM est le scalaire classé de la clé `statut` (high-is-
# good — plus de logement social, mieux) et les QUATRE parts partitionnent les
# résidences principales (200 = 211 + 212_222 + 221, vérifié sur le fichier
# réel : 526 579 locataires bretons = 306 056 privé + 53 802 meublé + 166 721
# social).
pivoter_statut_rp <- function(long) {
  long %>%
    dplyr::filter(
      GEO_OBJECT == "COM",
      RP_MEASURE == "DWELLINGS", OCS == "DW_MAIN",
      TIME_PERIOD == 2023, OBS_STATUS == "A",
      TSH %in% c("100", "211", "212_222", "221", "300"),
      L_STAY == "_T", TDW == "_T", CARS == "_T", CARPARK == "_T",
      NOR == "_T", BUILD_END == "_T", NRG_SRC == "_T"
    ) %>%
    dplyr::select(GEO, TSH, OBS_VALUE) %>%
    tidyr::pivot_wider(id_cols = GEO, names_from = TSH,
                       values_from = OBS_VALUE) %>%
    dplyr::mutate(
      statut_hlm = `221`,
      statut_locataire_prive = `211` + `212_222`
    ) %>%
    dplyr::rename(
      statut_proprietaire = `100`,
      statut_loge_gratuit = `300`
    ) %>%
    dplyr::select(GEO, statut_proprietaire, statut_hlm,
                  statut_locataire_prive, statut_loge_gratuit)
}

# pivoter_build_end_rp --------------------------------------------------------
# L'âge du bâti (indicateur 2, issue #368) : DWELLINGS des RP ventilé par
# BUILD_END — les SIX tranches disjointes de la période d'achèvement (avant
# 1919, 1919-1945, 1946-1970, 1971-1990, 1991-2005, 2006 et après). Les
# niveaux agrégés du cube (Y_LT1946, Y1946T1990, Y1991T2009, Y_LT2010,
# Y_LT2015, Y_LT2021) sont des redondances de la même ventilation — jamais
# pivotées, un double comptage serait silencieux. La période inconnue (le
# résidu entre la somme des six tranches et le total RP, ~2,3 % en Bretagne)
# est un fait de la donnée RP : les parts sont calculées sur le stock dont la
# période est CONNUE (la somme des six tranches), documenté dans la note de
# l'indicateur — jamais une part fabriquée sur un total qui ne ferme pas.
pivoter_build_end_rp <- function(long) {
  long %>%
    dplyr::filter(
      GEO_OBJECT == "COM",
      RP_MEASURE == "DWELLINGS", OCS == "DW_MAIN",
      TIME_PERIOD == 2023, OBS_STATUS == "A",
      BUILD_END %in% c("Y_LT1919", "Y1919T1945", "Y1946T1970",
                       "Y1971T1990", "Y1991T2005", "Y2006TAAAA"),
      TDW == "_T", CARS == "_T", CARPARK == "_T", NOR == "_T",
      TSH == "_T", L_STAY == "_T", NRG_SRC == "_T"
    ) %>%
    dplyr::select(GEO, BUILD_END, OBS_VALUE) %>%
    tidyr::pivot_wider(id_cols = GEO, names_from = BUILD_END,
                       values_from = OBS_VALUE) %>%
    dplyr::rename(
      bati_lt1919 = Y_LT1919, bati_1919_1945 = Y1919T1945,
      bati_1946_1970 = Y1946T1970, bati_1971_1990 = Y1971T1990,
      bati_1991_2005 = Y1991T2005, bati_2006_plus = Y2006TAAAA
    )
}

# pivoter_type_rp -------------------------------------------------------------
# Le type de logement (indicateur 2, issue #368) : DWELLINGS des RP ventilé
# par TDW — maison (1) et appartement (2). La famille « autres logements de
# métropole » (3T6, ~0,7 % des RP en Bretagne) est ÉCARTÉE du dénominateur
# comme les dépendances côté DVF : les parts maison / appartement somment à 1
# sur l'univers (maison + appartement), la part d'appartements étant le
# scalaire classé de la clé `type` (high-is-good).
pivoter_type_rp <- function(long) {
  long %>%
    dplyr::filter(
      GEO_OBJECT == "COM",
      RP_MEASURE == "DWELLINGS", OCS == "DW_MAIN",
      TIME_PERIOD == 2023, OBS_STATUS == "A",
      TDW %in% c("1", "2"),
      L_STAY == "_T", CARS == "_T", CARPARK == "_T", NOR == "_T",
      TSH == "_T", BUILD_END == "_T", NRG_SRC == "_T"
    ) %>%
    dplyr::select(GEO, TDW, OBS_VALUE) %>%
    tidyr::pivot_wider(id_cols = GEO, names_from = TDW,
                       values_from = OBS_VALUE) %>%
    dplyr::rename(type_maison = `1`, type_appartement = `2`)
}

# assembler_communes_rp -------------------------------------------------------
# Assemble les pivots en une table par commune bretonne, dans la forme du
# contrat. La jointure avec la base des EPCI (limitée à la Bretagne) est LE
# filtre : les communes hors 22/29/35/56 tombent (même pattern que Démographie).
assembler_communes_rp <- function(logements, statut, build_end, type, epci) {
  logements %>%
    dplyr::left_join(statut, by = "GEO") %>%
    dplyr::left_join(build_end, by = "GEO") %>%
    dplyr::left_join(type, by = "GEO") %>%
    dplyr::inner_join(epci, by = c("GEO" = "CODGEO")) %>%
    dplyr::rename(
      code = GEO, nom = LIBGEO, departement = DEP, epci = EPCI,
      nom_epci = LIBEPCI
    ) %>%
    dplyr::select(code, nom, departement, epci, nom_epci,
                  logements, logements_principales, logements_secondaires,
                  logements_vacants,
                  statut_proprietaire, statut_hlm, statut_locataire_prive,
                  statut_loge_gratuit,
                  bati_lt1919, bati_1919_1945, bati_1946_1970,
                  bati_1971_1990, bati_1991_2005, bati_2006_plus,
                  type_maison, type_appartement)
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
    pivoter_build_end_rp(long), pivoter_type_rp(long), epci
  )

  # L'étape « filter » documentée : la jointure EPCI (limitée à la Bretagne)
  # est LE filtre ; filter_bretagne est la garde explicite du schéma.
  brut <- filter_bretagne(brut)

  readr::write_rds(brut, sortie)
  brut
}
