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
    "recalculé (2026-07-24)."
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

# MANIFEST_MILIEUX --------------------------------------------------------------
# Le manifeste CONCATÉNÉ du thème : la source CONSOENAF + la base des EPCI
# partagée (la même ligne que Démographie/Habitat — jamais re-déclarée avec un
# autre id, le cache idempotent évite le re-téléchargement) + la série
# historique du recensement (la même ligne que Démographie — la source
# partagée de la population de l'Histoire, #174). TROIS lignes, trois ids
# uniques. Validé par verifier_contrat_milieux.
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
  MANIFEST_MILIEUX_SERIE_HISTORIQUE
)

# verifier_contrat_milieux ------------------------------------------------------
# La validation du contrat du manifeste Milieux (la discipline des fragments,
# comme verifier_contrat_programmes) : TROIS sources, trois ids uniques et
# exacts, chaque source sur SON contrat — le fichier épinglé, la licence
# Ouverte, le mode cron, le type fichier, les dates bien formées (la
# publication jamais antérieure à la référence ; la publication de la base EPCI
# reste NA, la convention partagée). Un manifeste corrompu échoue bruyamment en
# nommant le champ fautif.
verifier_contrat_milieux <- function(manifest) {
  manquer <- function(champ, detail) {
    stop(sprintf("Contrat Milieux manifeste violé — %s : %s.", champ,
                 detail), call. = FALSE)
  }
  if (!inherits(manifest, "tbl_df")) {
    manquer("forme", "le manifeste doit être un tibble")
  }
  if (anyDuplicated(manifest$id)) manquer("id", "id dupliqué")
  if (nrow(manifest) != 3L) {
    manquer("forme", paste0("le manifeste porte TROIS sources (la base EPCI ",
                            "partagée + CONSOENAF + la série historique du ",
                            "recensement), pas ", nrow(manifest)))
  }
  attendus <- c("epci", "consoenaf", "serie_historique")
  if (!setequal(manifest$id, attendus)) {
    manquer("id", paste0("ids attendus : ", paste(attendus, collapse = " / ")))
  }

  # le contrat commun : fichier téléchargeable en cron (les jeux officiels
  # ouverts — jamais un portage à la main), Licence Ouverte 2.0
  if (any(manifest$mode != "cron")) {
    manquer("mode", "mode attendu : 'cron' pour les deux sources")
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

  # les dates : ISO et bien formées pour CONSOENAF (la publication jamais
  # antérieure à la référence) ; la base EPCI porte SA publication NA (la
  # convention partagée — insee.fr n'expose pas de date de fichier)
  iso <- grepl("^[0-9]{4}-[0-9]{2}(-[0-9]{2})?$", manifest$date_reference) |
    is.na(manifest$date_reference)
  if (!all(iso)) manquer("date_reference", "dates ISO bien formées (ou NA)")
  iso_pub <- grepl("^[0-9]{4}-[0-9]{2}(-[0-9]{2})?$",
                   manifest$date_publication) | is.na(manifest$date_publication)
  if (!all(iso_pub)) {
    manquer("date_publication", "dates ISO bien formées (ou NA)")
  }
  conso <- manifest[manifest$id == "consoenaf", ]
  if (is.na(conso$date_reference) || is.na(conso$date_publication)) {
    manquer("dates", "CONSOENAF porte référence ET publication")
  }
  if (as.Date(conso$date_publication) < as.Date(conso$date_reference)) {
    manquer("date_publication", "la publication doit être postérieure ou égale à la référence")
  }

  invisible(TRUE)
}
