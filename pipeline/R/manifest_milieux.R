# manifest_milieux --------------------------------------------------------------
# Le manifeste du thème Milieux (issue #171, ADR-0014) : la source CONSOENAF —
# le jeu Cerema « Consommation d'espaces naturels, agricoles et forestiers du
# 1er janvier 2011 au 1er janvier 2025 » (data.gouv.fr, Licence Ouverte 2.0,
# mises à jour annuelles, COG 2025) — plus la base des EPCI partagée (le
# référentiel commune -> EPCI -> département -> région que la table des
# territoires consomme ; le même id/URL que Démographie/Habitat — le cache
# idempotent évite le re-téléchargement). Depuis l'Histoire (issue #174), le
# manifeste porte AUSSI la série historique du recensement — la source partagée
# de la population (la règle de source d'ADR-0014 : la population de l'Histoire
# vient TOUJOURS de la série historique, jamais des champs embarqués de
# CONSOENAF ; le même id/URL que Démographie — le cache idempotent évite le
# re-téléchargement). La discipline des fragments (issue #13) : une ligne par
# source, chaque source garde SON vintage, SA référence et SA publication —
# aucun alignement de date.

# MANIFEST_MILIEUX_CONSOENAF ----------------------------------------------------
# Le fragment CONSOENAF : la ressource CSV « conso_com.csv » du jeu data.gouv
# (id 6a01b9280dd2d45907e5fc61, ressource b258feec-f8ff-4e0a-93b3-baf1fe46ef66),
# mise en ligne le 24/07/2026 — les indicateurs communaux de consommation
# d'ENAF (Fichiers Fonciers retraités), une ligne par commune, la période du
# 1er janvier 2011 au 1er janvier 2025. La référence est la fin de la fenêtre
# (2025-01-01) ; la publication est la mise en ligne du fichier après le
# RECALCUL des ratios (2026-07-24 — la description du jeu annonce : « les
# ratios artpop1622, mepart1622, menhab1622, naf16art22, art16hab22 et
# équivalents ont été recalculés le 24/07/2026 suite à une anomalie dans le
# traitement. Cela ne change rien aux valeurs de consommation diffusées par
# ailleurs »). L'ANOMALIE D'UNITÉ est documentée ici, jamais silencieusement
# ignorée : le dictionnaire Cerema labellise les champs de consommation « en
# hectares », mais le fichier distribue des m² (vérifié via la cohérence
# interne d'artcom1125 pour Rennes, docs/research/zan-rennes.md) — le reshape
# du thème convertit m² -> ha explicitement (÷ 10 000) et la conversion est
# testée (test-theme-milieux-reshape.R).
MANIFEST_MILIEUX_CONSOENAF <- tibble::tribble(
  ~id, ~source, ~url, ~fichier, ~vintage, ~date_reference,
  ~date_publication, ~licence, ~note, ~mode, ~type,
  "consoenaf",
  "Cerema — Consommation d'espaces naturels, agricoles et forestiers (CONSOENAF) 2011-2025 : indicateurs communaux (Fichiers Fonciers)",
  "https://static.data.gouv.fr/resources/consommation-despaces-naturels-agricoles-et-forestiers-du-1er-janvier-2011-au-1er-janvier-2025/20260724-142909/conso-com.csv",
  "conso-com.csv",
  "2025", "2025-01-01", "2026-07-24", "lov2",
  paste0(
    "La consommation d'espaces naturels, agricoles et forestiers (ENAF), ",
    "mesurée par le Cerema depuis les Fichiers Fonciers pour le Portail de ",
    "l'artificialisation (jeu data.gouv.fr 6a01b9280dd2d45907e5fc61, Licence ",
    "Ouverte 2.0, mise à jour ANNUELLE, COG 2025) : une ligne par commune, la ",
    "période du 1er janvier 2011 au 1er janvier 2025. La ressource est le CSV ",
    "« conso_com.csv » (b258feec-f8ff-4e0a-93b3-baf1fe46ef66, ~31 Mo, 172 ",
    "colonnes — jamais le classeur, jamais les gpkg géométriques conso_com_*.gpkg). ",
    "RECALCUL du 24/07/2026 : les ratios artpop1622/mepart1622/menhab1622/",
    "naf16art22/art16hab22 et équivalents ont été recalculés suite à une ",
    "anomalie de traitement — cela ne change rien aux valeurs de consommation ",
    "diffusées par ailleurs (la note de la description du jeu). ANOMALIE ",
    "D'UNITÉ (vérifiée, docs/research/zan-rennes.md) : le dictionnaire Cerema ",
    "labellise les champs de consommation « en hectares », mais le fichier ",
    "distribue des M² (la cohérence interne d'artcom1125 pour Rennes le ",
    "prouve) — le reshape du thème convertit m² -> ha (÷ 10 000), la ",
    "conversion est testée, jamais silencieusement trustée. Référence : la fin ",
    "de la fenêtre (2025-01-01) ; publication : la mise en ligne du fichier ",
    "recalculé (2026-07-24). TRAJECTOIRE ZAN (#173) : la formule annualise les ",
    "fenêtres natives avant le rapport — naf11art21 couvre la décennie de ",
    "référence 2011-2021 (10 ans) et naf21art25 couvre 2021-2025 (4 ans : ",
    "naf{AA}art{BB} = BB−AA tranches annuelles, 1er janvier 2021 -> 1er janvier ",
    "2025) — le rapport des rythmes (÷ 10 contre ÷ 4) est documenté dans ",
    "theme_milieux.R et vérifié à la main dans le fixture."
  ),
  "cron", "fichier"
)

# MANIFEST_MILIEUX_SERIE_HISTORIQUE --------------------------------------------
# Le fragment série historique du recensement : le MÊME id/URL/fichier que la
# source partagée de Démographie (theme_demographie.R) — le cache idempotent
# évite le re-téléchargement. Milieux la consomme pour l'Histoire « Se
# densifier, s'étaler, ou s'en aller » (#174) : la règle de source d'ADR-0014
# (la population vient TOUJOURS de la série historique, jamais des champs
# embarqués de CONSOENAF — une seule population vraie par fiche) et la règle
# des DEUX HORLOGES (la fenêtre de l'Histoire dérive des deux millésimes RP les
# plus récents de la série — aujourd'hui 2017 et 2023 — jamais codée en dur ;
# elle glisse quand l'INSEE publie un nouveau recensement).
MANIFEST_MILIEUX_SERIE_HISTORIQUE <- tibble::tribble(
  ~id, ~source, ~url, ~fichier, ~vintage, ~date_reference,
  ~date_publication, ~licence, ~note, ~mode, ~type,
  "serie_historique",
  "INSEE — Série historique du recensement",
  "https://api.insee.fr/melodi/file/DS_RP_SERIE_HISTORIQUE/DS_RP_SERIE_HISTORIQUE_2023_CSV_FR",
  "DS_RP_SERIE_HISTORIQUE_2023_CSV_FR.zip", "2023", "2023-01-01", "2026-06-30", "lov2",
  paste0(
    "La population du recensement 1968-2023 (POP), mesurée par l'INSEE — la ",
    "source partagée de la population (le même id/URL que Démographie, le ",
    "cache idempotent évite le re-téléchargement). L'Histoire du thème (#174) ",
    "la consomme pour la règle de source d'ADR-0014 : la population vient ",
    "TOUJOURS de la série historique, jamais des champs embarqués de ",
    "CONSOENAF (une seule population vraie par fiche) — et pour la règle des ",
    "deux horloges : la fenêtre de l'Histoire dérive des deux millésimes RP ",
    "les plus récents de la série (aujourd'hui 2017 et 2023), jamais codée en ",
    "dur — elle glisse quand l'INSEE publie un nouveau recensement, les ",
    "annuels CONSOENAF se re-somment sur la fenêtre dérivée."
  ),
  "cron", "fichier"
)

# MANIFEST_MILIEUX_OCSGE --------------------------------------------------------
# Le fragment OCS-GE (issue #234, amendé par #243 — ADR-0017) : les HUIT
# archives d'état « surfaces artificialisées » du produit millésimé OCS GE
# Artificialisation v2.0 (IGN, Nouvelle Génération) de la Géoplateforme —
# DEUX millésimes par département breton (22 : 2021/2025 · 29 : 2021/2024 ·
# 35 : 2020/2023 · 56 : 2022/2024) — le référentiel ZAN de l'État. L'amendement
# #243 a sorti les QUATRE couches DIFFÉRENTIELLES du manifeste : la couche
# différentielle n'est pas un état (elle ne porte que les CHANGEMENTS — le bug
# flux-et-état documenté dans docs/research/ocs-ge-etat-vs-flux.md) ; le
# produit millésimé porte l'ÉTAT complet — l'attribut `Artif` de chaque
# polygone est le résultat de la méthode officielle en trois étapes (matrice
# de croisement couverture×usage × seuils du décret 2023-1096 × forçage des
# surfaces adjacentes au bâti). La règle « jamais de superposition brute
# OCCUPATION_SOL — la mesure de l'État est lue, jamais re-dérivée » tient
# intégralement. Le nom de fichier suit le motif Géoplateforme vérifié à la
# première livraison réelle (2026-08-09) :
#   OCS-GE_2-0_ARTIFICIALISATION_GPKG_LAMB93_D0{XX}_{YYYY}-01-01.7z
# et l'URL le motif documenté de l'API de téléchargement :
#   https://data.geopf.fr/telechargement/download/OCSGE-ARTIFICIALISATION/{sub}/{sub}.7z
# La couche d'état dans le GPKG est nommée `artif_{YYYY}_{DD}` (découverte par
# le motif COUCHE_OCSGE_ARTIFICIALISATION, « dérive de la donnée ») ; ses
# attributs : artif (artif / non artif), aire (la surface du polygone en m²,
# EPSG:2154 — le CRS natif du produit) et millesime (l'année de l'état).
# Licence Ouverte 2.0 (les deux jeux data.gouv, ocs-ge et
# ocs-ge-artificialisation). La discipline des fragments : une ligne par source
# (par département × millésime), chaque source garde SA référence (le millésime
# de l'état — le produit millésimé porte SON année, jamais la fin d'une fenêtre
# différentielle) et SA publication (les dates `updated` de l'API
# Géoplateforme, vérifiées 2026-08-09). La couche est livrée en .7z :
# l'extraction est le seam documenté du thème (extraire_gpkg_ocsge,
# theme_milieux.R — aucun extracteur .7z en R, l'étape manuelle documentée,
# testée sur le format zip que R sait écrire).
ligne_ocsge_etat <- function(departement, nom_departement, millesime,
                             date_publication) {
  base <- paste0("OCS-GE_2-0_ARTIFICIALISATION_GPKG_LAMB93_D0", departement,
                 "_", millesime, "-01-01")
  tibble::tibble(
    id = paste0("ocsge_artificialisation_", departement, "_", millesime),
    source = paste0(
      "IGN — OCS GE « surfaces artificialisées » v2.0 (Nouvelle Génération) — ",
      nom_departement, " (", departement, "), millésime ", millesime
    ),
    url = paste0("https://data.geopf.fr/telechargement/download/",
                 "OCSGE-ARTIFICIALISATION/", base, "/", base, ".7z"),
    fichier = paste0(base, ".7z"),
    vintage = as.character(millesime),
    date_reference = paste0(millesime, "-01-01"),
    date_publication = date_publication,
    licence = "lov2",
    note = paste0(
      "L'ÉTAT artificialisé du produit millésimé OCS GE Artificialisation ",
      "v2.0 (IGN, Nouvelle Génération) pour le département ", departement,
      " au millésime ", millesime, " — la couche `artif_", millesime, "_",
      departement, "` du GPKG Géoplateforme (produit « surfaces ",
      "artificialisées », Licence Ouverte 2.0). Chaque polygone porte ",
      "l'attribut `artif` (artif / non artif) — le résultat COMPLET de la ",
      "méthode officielle en trois étapes (matrice de croisement couverture",
      "×usage, seuils du décret 2023-1096, forçage des surfaces adjacentes au ",
      "bâti) — et `aire`, la surface du polygone en m² (EPSG:2154, le CRS ",
      "natif du produit), plus `millesime` (l'année de l'état, dans la ",
      "donnée). On lit la MESURE de l'État, jamais re-dérivée : les couches ",
      "brutes OCCUPATION_SOL ne sont jamais superposées nous-mêmes. Le DIFF ",
      "est sorti du manifeste (amendement #243, ADR-0017) : la couche ",
      "différentielle n'est pas un état. Livraison .7z via l'API Géoplateforme ",
      "(data.geopf.fr) : l'extraction est l'étape documentée du thème ",
      "(extraire_gpkg_ocsge). Référence : le millésime de l'état (", millesime,
      "-01-01) ; publication : la mise en ligne du fichier (", date_publication,
      ")."
    ),
    mode = "cron",
    type = "fichier"
  )
}

MANIFEST_MILIEUX_OCSGE <- dplyr::bind_rows(
  ligne_ocsge_etat("22", "Côtes-d'Armor", 2021, "2025-09-12"),
  ligne_ocsge_etat("22", "Côtes-d'Armor", 2025, "2026-07-03"),
  ligne_ocsge_etat("29", "Finistère", 2021, "2025-03-07"),
  ligne_ocsge_etat("29", "Finistère", 2024, "2026-06-12"),
  ligne_ocsge_etat("35", "Ille-et-Vilaine", 2020, "2026-03-03"),
  ligne_ocsge_etat("35", "Ille-et-Vilaine", 2023, "2026-03-04"),
  ligne_ocsge_etat("56", "Morbihan", 2022, "2025-03-07"),
  ligne_ocsge_etat("56", "Morbihan", 2024, "2026-06-10")
)

# MANIFEST_MILIEUX_PATCH ---------------------------------------------------------
# Le fragment PATCH CORRECTIF M2 (issue #243, amendement ADR-0017 — la décision
# « appliquer où disponible, mesurer d'abord ») : les TROIS patchs Géoplateforme
# « PATCHCORRECTIF » du millésime INITIAL des départements 22/29/56 (D022 2021,
# D029 2021, D056 2022 — le 35 n'a pas de patch). Le patch recense les anomalies
# détectées dans le millésime M2 (la couche `PATCH_CORR_{DXX}_{YYYY}` du GPKG,
# les colonnes cs_corr / us_corr : la COUVERTURE/USAGE corrigée du polygone,
# « RAS » = aucune correction) — l'outil de traçabilité officiel, jamais
# re-dérivé. La MESURE (2026-08-09, documentée dans theme_milieux.R) : ~20 %
# des polygones du patch INVERTISSENT le statut artif (22 : 19,6 %, 29 : 19,0 %,
# 56 : 24,9 % ; ~16 % / 29 % / 49 % de la surface du patch) — matériel, la
# bascule « au niveau matrice sur ces polygones » est appliquée (le correctif
# cs/us -> artif, approximation documentée). Le patch est livré avec le
# millésime SUIVANT (la publication est celle du M3 — la même date que
# l'archive d'état la plus récente) ; sa référence est le 1er janvier du
# millésime qu'il corrige. La ressource Géoplateforme est le produit OCS GE
# brut (`OCSGE` — le motif `OCS-GE_2-0_PATCHCORRECTIF_GPKG_LAMB93_D0{XX}_{YYYY}
# -01-01.7z`, vérifié 2026-08-10), jamais un téléchargement ad-hoc : les trois
# sources sont PINNÉES dans le manifeste (Licence Ouverte 2.0, mode cron).
ligne_ocsge_patch <- function(departement, nom_departement, millesime,
                              date_publication) {
  base <- paste0("OCS-GE_2-0_PATCHCORRECTIF_GPKG_LAMB93_D0", departement,
                 "_", millesime, "-01-01")
  tibble::tibble(
    id = paste0("ocsge_patch_correctif_", departement),
    source = paste0(
      "IGN — OCS GE « patch correctif » (Nouvelle Génération) — ",
      nom_departement, " (", departement, "), millésime corrigé ", millesime
    ),
    url = paste0("https://data.geopf.fr/telechargement/download/",
                 "OCSGE/", base, "/", base, ".7z"),
    fichier = paste0(base, ".7z"),
    vintage = as.character(millesime),
    date_reference = paste0(millesime, "-01-01"),
    date_publication = date_publication,
    licence = "lov2",
    note = paste0(
      "Le PATCH CORRECTIF OCS GE NG (IGN, Nouvelle Génération) du millésime ",
      millesime, " du département ", departement, " — la couche `PATCH_CORR_D0",
      departement, "_", millesime, "` du GPKG Géoplateforme (produit OCS GE, ",
      "Licence Ouverte 2.0). Le patch recense les anomalies géométriques et ",
      "sémantiques identifiées dans le millésime ", millesime,
      " : chaque polygone porte la couverture/usage CORRIGÉE (cs_corr / ",
      "us_corr, « RAS » = aucune correction). Mesuré 2026-08-09 (voir ",
      "theme_milieux.R) : ~20 % des polygones du patch inversent le statut ",
      "artif (22 : 19,6 % · 29 : 19,0 % · 56 : 24,9 % de la surface du patch) ",
      "— la bascule « au niveau matrice sur ces polygones » (le correctif ",
      "cs/us -> artif) est appliquée au millésime initial du département, en ",
      "approximation DOCUMENTÉE (Méthodes). Le 35 n'a pas de patch. Référence : ",
      "le 1er janvier du millésime corrigé (", millesime, "-01-01) ; ",
      "publication : la livraison avec le millésime suivant (",
      date_publication, ")."
    ),
    mode = "cron",
    type = "fichier"
  )
}

MANIFEST_MILIEUX_PATCH <- dplyr::bind_rows(
  ligne_ocsge_patch("22", "Côtes-d'Armor", 2021, "2026-07-03"),
  ligne_ocsge_patch("29", "Finistère", 2021, "2026-06-12"),
  ligne_ocsge_patch("56", "Morbihan", 2022, "2026-06-10")
)

# MANIFEST_MILIEUX --------------------------------------------------------------
# Le manifeste CONCATÉNÉ du thème : la source CONSOENAF + la base des EPCI
# partagée (la même ligne que Démographie/Habitat — jamais re-déclarée avec un
# autre id, le cache idempotent évite le re-téléchargement) + la série
# historique du recensement (la même ligne que Démographie — la source
# partagée de la population de l'Histoire, #174) + les HUIT archives d'état
# OCS-GE « surfaces artificialisées » (issue #234, amendées par #243) + les
# TROIS patchs correctifs M2 22/29/56 (issue #243 — l'amendement ADR-0017).
# QUATORZE lignes, quatorze ids uniques. Validé par verifier_contrat_milieux.
MANIFEST_MILIEUX <- dplyr::bind_rows(
  tibble::tribble(
    ~id, ~source, ~url, ~fichier, ~vintage, ~date_reference,
    ~date_publication, ~licence, ~note, ~mode, ~type,
    "epci",
    "INSEE — Base des EPCI à fiscalité propre au 01/01/2025",
    "https://www.insee.fr/fr/statistiques/fichier/2510634/epci_au_01-01-2025.zip",
    "epci_au_01-01-2025.zip", "2025", "2025-01-01", NA_character_, "lov2",
    "Feuille Composition_communale : CODGEO -> EPCI (SIREN), LIBEPCI, DEP, REG",
    "cron", "fichier"
  ),
  MANIFEST_MILIEUX_CONSOENAF,
  MANIFEST_MILIEUX_SERIE_HISTORIQUE,
  MANIFEST_MILIEUX_OCSGE,
  MANIFEST_MILIEUX_PATCH
)

# verifier_contrat_milieux ------------------------------------------------------
# La validation du contrat du manifeste Milieux (la discipline des fragments,
# comme verifier_contrat_programmes) : QUATORZE sources, quatorze ids uniques
# et exacts, chaque source sur SON contrat — le fichier épinglé, la licence
# Ouverte, le mode cron, le type fichier, les dates bien formées (la
# publication jamais antérieure à la référence pour toute source datée — les
# huit OCS-GE, les trois patchs correctifs comme CONSOENAF ; la publication de
# la base EPCI reste NA, la convention partagée). Un manifeste corrompu échoue
# bruyamment en nommant le champ fautif.
verifier_contrat_milieux <- function(manifest) {
  manquer <- function(champ, detail) {
    stop(sprintf("Contrat Milieux manifeste violé — %s : %s.", champ,
                 detail), call. = FALSE)
  }
  if (!inherits(manifest, "tbl_df")) {
    manquer("forme", "le manifeste doit être un tibble")
  }
  if (anyDuplicated(manifest$id)) manquer("id", "id dupliqué")
  if (nrow(manifest) != 14L) {
    manquer("forme", paste0("le manifeste porte QUATORZE sources (la base EPCI ",
                            "partagée + CONSOENAF + la série historique du ",
                            "recensement + les huit archives d'état OCS-GE ",
                            "« surfaces artificialisées » + les trois patchs ",
                            "correctifs M2 22/29/56), pas ", nrow(manifest)))
  }
  attendus <- c("epci", "consoenaf", "serie_historique",
                paste0("ocsge_artificialisation_22_", c(2021, 2025)),
                paste0("ocsge_artificialisation_29_", c(2021, 2024)),
                paste0("ocsge_artificialisation_35_", c(2020, 2023)),
                paste0("ocsge_artificialisation_56_", c(2022, 2024)),
                paste0("ocsge_patch_correctif_", c("22", "29", "56")))
  if (!setequal(manifest$id, attendus)) {
    manquer("id", paste0("ids attendus : ", paste(attendus, collapse = " / ")))
  }

  # le contrat commun : fichier téléchargeable en cron (les jeux officiels
  # ouverts — jamais un portage à la main), Licence Ouverte 2.0
  if (any(manifest$mode != "cron")) {
    manquer("mode", "mode attendu : 'cron' pour les quatorze sources")
  }
  if (any(manifest$type != "fichier")) {
    manquer("type", "type attendu : 'fichier'")
  }
  if (any(manifest$licence != "lov2")) {
    manquer("licence", "licence attendue : 'lov2' (Licence Ouverte 2.0)")
  }

  # les fragments épinglés : le fichier de cache exact de chaque source
  fichiers <- stats::setNames(manifest$fichier, manifest$id)
  if (fichiers[["epci"]] != "epci_au_01-01-2025.zip") {
    manquer("fichier", "le contrat épingle la base EPCI epci_au_01-01-2025.zip")
  }
  if (fichiers[["consoenaf"]] != "conso-com.csv") {
    manquer("fichier", paste0(
      "le contrat épingle la ressource CSV conso-com.csv du jeu CONSOENAF — ",
      "le CSV est LA base, jamais le classeur ni les gpkg géométriques"))
  }
  if (fichiers[["serie_historique"]] != "DS_RP_SERIE_HISTORIQUE_2023_CSV_FR.zip") {
    manquer("fichier", paste0(
      "le contrat épingle le zip DS_RP_SERIE_HISTORIQUE_2023_CSV_FR.zip de la ",
      "série historique du recensement (le même fichier que Démographie)"))
  }
  # les huit archives d'état OCS-GE : le fichier Géoplateforme ÉPINGLÉ, motif
  # OCS-GE_2-0_ARTIFICIALISATION_GPKG_LAMB93_D0{XX}_{YYYY}-01-01.7z — le
  # millésime de la spec et la date de publication vérifiée dans l'API
  # Géoplateforme (2026-08-09) sont PINNÉS : une dérive du nom (millésime ou
  # date) est un signal de fichier déplacé, pas un simple détail. Le DIFF est
  # hors contrat : un fichier _DIFF- ressorti du chapeau est un signal
  # (l'amendement #243 a sorti le différentiel du manifeste).
  fichiers_ocsge <- c(
    "22_2021" = "OCS-GE_2-0_ARTIFICIALISATION_GPKG_LAMB93_D022_2021-01-01.7z",
    "22_2025" = "OCS-GE_2-0_ARTIFICIALISATION_GPKG_LAMB93_D022_2025-01-01.7z",
    "29_2021" = "OCS-GE_2-0_ARTIFICIALISATION_GPKG_LAMB93_D029_2021-01-01.7z",
    "29_2024" = "OCS-GE_2-0_ARTIFICIALISATION_GPKG_LAMB93_D029_2024-01-01.7z",
    "35_2020" = "OCS-GE_2-0_ARTIFICIALISATION_GPKG_LAMB93_D035_2020-01-01.7z",
    "35_2023" = "OCS-GE_2-0_ARTIFICIALISATION_GPKG_LAMB93_D035_2023-01-01.7z",
    "56_2022" = "OCS-GE_2-0_ARTIFICIALISATION_GPKG_LAMB93_D056_2022-01-01.7z",
    "56_2024" = "OCS-GE_2-0_ARTIFICIALISATION_GPKG_LAMB93_D056_2024-01-01.7z"
  )
  for (cle in names(fichiers_ocsge)) {
    id <- paste0("ocsge_artificialisation_", cle)
    if (fichiers[[id]] != fichiers_ocsge[[cle]]) {
      manquer("fichier", paste0(
        "le contrat épingle le fichier OCS-GE ", cle, " : ",
        fichiers_ocsge[[cle]], " (le produit millésimé « surfaces ",
        "artificialisées » — le millésime de la spec et la date de ",
        "publication de l'API Géoplateforme ; une dérive du nom est un ",
        "signal, pas un détail)"))
    }
  }
  # les trois patchs correctifs M2 (issue #243) : le fichier Géoplateforme
  # ÉPINGLÉ, motif OCS-GE_2-0_PATCHCORRECTIF_GPKG_LAMB93_D0{XX}_{YYYY}-01-01.7z
  # — le millésime corrigé et la date de publication (la livraison avec le
  # millésime suivant) sont PINNÉS : jamais un téléchargement ad-hoc, jamais un
  # fichier déplacé silencieusement.
  fichiers_patch <- c(
    "22" = "OCS-GE_2-0_PATCHCORRECTIF_GPKG_LAMB93_D022_2021-01-01.7z",
    "29" = "OCS-GE_2-0_PATCHCORRECTIF_GPKG_LAMB93_D029_2021-01-01.7z",
    "56" = "OCS-GE_2-0_PATCHCORRECTIF_GPKG_LAMB93_D056_2022-01-01.7z"
  )
  for (dep in names(fichiers_patch)) {
    id <- paste0("ocsge_patch_correctif_", dep)
    if (fichiers[[id]] != fichiers_patch[[dep]]) {
      manquer("fichier", paste0(
        "le contrat épingle le fichier PATCH CORRECTIF ", dep, " : ",
        fichiers_patch[[dep]], " (le patch du millésime initial — une dérive ",
        "du nom est un signal, pas un détail)"))
    }
  }

  # les dates : ISO et bien formées pour toute source datée ; la publication
  # jamais antérieure à la référence pour TOUTE source qui porte les deux
  # dates (CONSOENAF et les huit OCS-GE) ; la base EPCI porte SA publication
  # NA (la convention partagée — insee.fr n'expose pas de date de fichier)
  iso <- grepl("^[0-9]{4}-[0-9]{2}(-[0-9]{2})?$", manifest$date_reference) |
    is.na(manifest$date_reference)
  if (!all(iso)) manquer("date_reference", "dates ISO bien formées (ou NA)")
  iso_pub <- grepl("^[0-9]{4}-[0-9]{2}(-[0-9]{2})?$",
                   manifest$date_publication) | is.na(manifest$date_publication)
  if (!all(iso_pub)) {
    manquer("date_publication", "dates ISO bien formées (ou NA)")
  }
  datees <- manifest[!is.na(manifest$date_reference) &
                       !is.na(manifest$date_publication), ]
  if (any(as.Date(datees$date_publication) < as.Date(datees$date_reference))) {
    manquer("date_publication", paste0(
      "la publication doit être postérieure ou égale à la référence (les ",
      "huit OCS-GE comme CONSOENAF)"))
  }

  invisible(TRUE)
}
