# manifest_mobilite -------------------------------------------------------------
# Les FRAGMENTS de manifeste du thème Mobilité (issues #137 tracer bullet, #138
# la chaîne analytique flagship, #140 le sous-bloc « L'offre de mobilité
# alternative ») — la convention des fragments par source (issue #13, la même
# forme que MANIFEST_ECONOMIE) : UNE ligne par source, jamais de doublon de
# cache, chaque source garde SON vintage, SA référence et SA publication.
#
# Les fragments (concaténés dans MANIFEST_MOBILITE, l'ordre du manifeste) :
#   - mobilite_snapshot   (issue #137, fragment SNAPSHOT) : le snapshot PORTÉ
#     de l'analyse d'accessibilité « Vingt minutes sans voiture » — le fichier
#     de production bretagne_mobility_super_dashboard_gravity.csv. INSTANTANÉ
#     sur horloge lente : la référence est la date d'instantané de l'analyse
#     (2026-02-28), la publication la date du portage (2026-08-06). Mode
#     « manuel » (ADR-0004), jamais de cron.
#   - korrigo             (issue #140, fragment KORRIGO) : les sources du
#     sous-bloc « Offre TC » — la base multimodale GTFS Korrigo (les 24
#     réseaux, Bretagne Mobilité), les arrêts mobibreizh-stops (24 380 arrêts,
#     Région Bretagne) et le RÉFÉRENTIEL GÉOGRAPHIQUE COMMUNAL qui permet de
#     spatialiser les arrêts (les arrêts ne portent AUCUN code INSEE — la
#     jointure spatiale arrêts → communes a besoin des géométries communales).
#     ODbL pour Korrigo et les arrêts (ADR-0001), Licence Ouverte pour le
#     référentiel.
#   - bornes-recharges    (issue #140, fragment BORNES) : le fichier consolidé
#     IRVE (Etalab via data.bretagne.bzh), Licence Ouverte, refreshed
#     2026-07-28 (le vintage verrouillé du contrat thème).
#   - stationnement-velo  (issue #140, fragment STATIONNEMENT VELO) : le hub
#     Ecolab « Nombre de places de stationnement vélo pour 1 000 hab. » pris
#     TEL QUEL (décision 2026-08-04 — les comptages de stationnement vélo ne
#     sont pas dérivables du propre pipeline de Lusk), ODbL (producteur OSM).
#
# La discipline des fragments (issue #13) : chaque fragment porte SON
# verifier_contrat_* (ce que la machinerie et les tests exigent de SES lignes),
# et verifier_contrat_manifest_mobilite vérifie le manifeste concaténé — les
# ids uniques, les fragments au contrat, les dates bien formées (la publication
# jamais antérieure à la référence). Un manifeste corrompu échoue là où il est
# construit, jamais plus tard dans la machinerie.
#
# Guardrails du PRD #136 (fragment SNAPSHOT) : l'artefact non-production
# indicateurs_summarized_communes.csv (deltas vélo NÉGATIFS) n'est JAMAIS une
# base — le contrat du fragment refuse tout autre nom de fichier ; aucune
# ingestion du dashboard original au-delà du fichier porté ; la matrice
# complète reste un artefact interne — jamais publiée dans le payload (leçon
# de l'issue #131).

# VINTAGE_MOBILITE_SNAPSHOT -----------------------------------------------------
# Le millésime du snapshot porté : l'analyse a été figée le 2026-02-28 (la
# date de génération du fichier de production — ses données de référence sont
# BPE 2024 · OSM 02-2026 · BDNB 2025-07). La RÉFÉRENCE du vintage est CETTE
# date d'instantané (ce que « l'analyse du 28 février 2026 » veut dire) ; la
# PUBLICATION est la date du portage dans le pipeline (2026-08-06 — le jour où
# le snapshot est devenu la source du thème). Les deux dates sont la vérité de
# la source, jamais alignées sur un tampon de thème.
VINTAGE_MOBILITE_SNAPSHOT <- "2026-02"
DATE_REFERENCE_MOBILITE_SNAPSHOT <- "2026-02-28"
DATE_PUBLICATION_MOBILITE_SNAPSHOT <- "2026-08-06"

# MANIFEST_MOBILITE_SNAPSHOT ----------------------------------------------------
# Le fragment SNAPSHOT (issue #137) : les 11 colonnes standard du manifeste (la
# même forme que SIRENE / Flores / RP / Habitat), une ligne : la source portée.
# `url` pointe le fichier de production original (une URL file:// — la source
# n'a pas de point de publication public ; le mode « manuel » fait que le cron
# ne la touche jamais, et le fichier est toujours présent dans le cache du
# worktree). Le fragment est VALIDÉ par verifier_contrat_mobilite_snapshot (la
# garde du « jamais cette base » du PRD #136).
MANIFEST_MOBILITE_SNAPSHOT <- tibble::tribble(
  ~id, ~source, ~url, ~fichier, ~vintage, ~date_reference,
  ~date_publication, ~licence, ~note, ~mode, ~type,
  "mobilite_snapshot",
  "Lusk — analyse d'accessibilité « Vingt minutes sans voiture » (analyse portée, BPE 2024 · OSM 02-2026 · BDNB 2025-07)",
  "file:///E:/Website/Data_handling/bretagne_mobility_super_dashboard_gravity.csv",
  "bretagne_mobility_super_dashboard_gravity.csv",
  VINTAGE_MOBILITE_SNAPSHOT,
  DATE_REFERENCE_MOBILITE_SNAPSHOT,
  DATE_PUBLICATION_MOBILITE_SNAPSHOT,
  "odbl",
  paste0(
    "Le snapshot PORTÉ de l'analyse d'accessibilité « Vingt minutes sans ",
    "voiture » (le flagship, docs/adr/0012) : le fichier de production ",
    "bretagne_mobility_super_dashboard_gravity.csv (1 200 communes × 2 061 ",
    "colonnes, les niveaux _epci/_dep/_reg inclus), figé le 2026-02-28 — les ",
    "données de référence BPE 2024 · OSM 02-2026 · BDNB 2025-07, calcul par ",
    "bâtiment (1,2 M de bâtiments résidentiels, routage R5, cap 20 minutes). ",
    "JAMAIS l'artefact non-production indicateurs_summarized_communes.csv : il ",
    "a montré des deltas vélo NÉGATIFS (le contrat refuse tout autre nom de ",
    "fichier). Le portage EST le fichier : le cache est le CSV, aucune autre ",
    "ingestion du dashboard original. La matrice complète du super dashboard ",
    "reste un artefact interne — jamais publiée dans le payload (leçon de ",
    "l'issue #131). INSTANTANÉ sur horloge lente : la date de référence est la ",
    "date d'instantané de l'analyse, la publication la date du portage — le ",
    "thème ne prétend jamais être plus frais que son calcul. Attribution ",
    "ODbL : l'analyse consomme l'OSM (réseaux) — © OpenStreetMap contributors, ",
    "licence ODbL (ADR-0001), code de l'analyse publié avec la Méthodes du thème."
  ),
  "manuel", "fichier"
)

# MANIFEST_MOBILITE_KORRIGO ----------------------------------------------------
# Le fragment KORRIGO (issue #140, le sous-bloc « Offre TC ») : TROIS sources —
# la base GTFS Korrigo (le réseau, Bretagne Mobilité), les arrêts
# mobibreizh-stops (la couche d'arrêts, Région Bretagne) et le référentiel
# géographique communal (Opendatasoft — la géométrie des 1 202 communes de
# Bretagne). Le référentiel est INDISPENSABLE au calcul : les arrêts
# mobibreizh-stops portent des coordonnées mais AUCUN code INSEE (vérifié en
# direct 2026-08-06) — la part des bâtiments près d'un arrêt est une jointure
# SPATIALE arrêts → communes, qui exige les géométries communales. Le
# référentiel est stale (2020-09-03) — suffisant pour des limites communales
# quasi-statiques, documenté tel quel.
#
# DÉCISION DE BUILD (l'item 🔶 du contrat, docs/themes/mobilite.md §Open items
# et ADR-0012) : « part des bâtiments près d'un arrêt » = la part de la
# SUPERFICIE COMMUNALE à moins de 500 m à vol d'oiseau d'un arrêt Korrigo
# (mobibreizh-stops) — le proxy DOCUMENTÉ de la part des bâtiments : la couche
# bâtiment par bâtiment (1,2 M de bâtiments BDNB) vit dans l'analyse portée,
# pas dans le pipeline (le snapshot CSV n'en porte que l'agrégat communal
# nb_buildings). Le proxy « stop coverage » est la mesure standard d'offre TC
# (la même famille que le PTAL britannique) ; la distance de 500 m est le
# rayon classique « 10 minutes à pied ». La décision est documentée dans la
# note ci-dessous, dans la Méthodes du thème et verrouillée dans le code
# (DISTANCE_ARRET_M, analytics_mobilite.R).
#
# Dates : Korrigo = la dernière modification du jeu ODS (2026-02-03 — le
# timestamp d'extraction de la base GTFS, jamais « aujourd'hui ») ;
# mobibreizh-stops = le rafraîchissement verrouillé du contrat thème
# (stops 2026-08-02) ; communes-france = la date du référentiel (2020-09-03).
# Licences : odbl pour Korrigo et les arrêts (ADR-0001 — attribution
# « © OpenStreetMap contributors » portée par l'offre TC), lov2 pour le
# référentiel ODS.
MANIFEST_MOBILITE_KORRIGO <- tibble::tribble(
  ~id, ~source, ~url, ~fichier, ~vintage, ~date_reference,
  ~date_publication, ~licence, ~note, ~mode, ~type,
  "korrigo",
  "Bretagne Mobilité — Korrigo : base multimodale GTFS des transports publics en Bretagne (24 réseaux : BreizhGo TER/car/maritime + les réseaux urbains)",
  "https://data.bretagne.bzh/api/explore/v2.1/catalog/datasets/korrigo/alternative_exports/korrigo",
  "korrigo-gtfs.zip",
  "2026-02", "2026-02-03", "2026-02-03",
  "odbl",
  paste0(
    "La base multimodale GTFS Korrigo (Bretagne Mobilité, data.bretagne.bzh) : ",
    "le réseau de transport public breton — les 24 réseaux (BreizhGo TER/car/",
    "maritime + les réseaux urbains : STAR, Bibus, QUB, TUB, MAT, Izilo, TBK, ",
    "Kicéo… ; l'extrait du 2026-08-06 porte 32 agency.txt). L'export GTFS zip ",
    "est le cache (l'intégrité du zip est vérifiée par verifier_fichier). Le ",
    "calcul de l'offre TC consomme la couche d'arrêts mobibreizh-stops (le ",
    "fragment frère) ; la base GTFS est la PROVENANCE du réseau (le contrat « ",
    "Korrigo GTFS/NETEX (24 réseaux) » du sous-bloc). DÉCISION DE BUILD du ",
    "🔶 « Offre TC indicator shape » (docs/themes/mobilite.md §Open items) : la ",
    "part des bâtiments près d'un arrêt est PROXYÉE par la part de la ",
    "superficie communale à moins de 500 m à vol d'oiseau d'un arrêt Korrigo — ",
    "la couche bâtiment par bâtiment vit dans l'analyse portée, pas dans le ",
    "pipeline. ODbL (ADR-0001) : attribution « © OpenStreetMap contributors » ",
    "portée par l'indicateur et la Méthodes."
  ),
  "cron", "fichier",
  "mobibreizh-stops",
  "Région Bretagne — Korrigo Arrêts (mobibreizh-stops) : les arrêts des lignes de transport en commun bretonnes (24 380 arrêts, coordonnées)",
  "https://data.bretagne.bzh/api/explore/v2.1/catalog/datasets/mobibreizh-stops/exports/csv?limit=-1&timezone=UTC&use_labels=false&delimiter=%3B",
  "mobibreizh-stops.csv",
  "2026-08", "2026-08-02", "2026-08-02",
  "odbl",
  paste0(
    "La couche d'arrêts Korrigo (Région Bretagne, data.bretagne.bzh) : 24 380 ",
    "arrêts des lignes TC bretonnes avec leurs coordonnées (stop_coordinates) — ",
    "la SOURCE SIGNATURE de l'offre TC (l'indicateur est estampillé du vintage ",
    "de CETTE source). Les arrêts ne portent AUCUN code INSEE (vérifié en ",
    "direct 2026-08-06) : l'implantation sur les communes se fait par la ",
    "jointure SPATIALE avec le référentiel communal du fragment frère ",
    "(communes-france). Rafraîchi en continu (le 2026-08-02 est le ",
    "rafraîchissement verrouillé du contrat thème). ODbL (ADR-0001) : ",
    "attribution « © OpenStreetMap contributors »."
  ),
  "cron", "fichier",
  "communes-france",
  "Opendatasoft — Référentiel des communes de Bretagne (référentiel géographique ODS : 1 202 communes, géométries communales)",
  "https://data.bretagne.bzh/api/explore/v2.1/catalog/datasets/communes-france/exports/geojson?limit=-1&timezone=UTC",
  "communes-france.geojson",
  "2020-09", "2020-09-03", "2020-09-03",
  "lov2",
  paste0(
    "Le RÉFÉRENTIEL GÉOGRAPHIQUE COMMUNAL de Bretagne (Opendatasoft, ",
    "data.bretagne.bzh) : les 1 202 communes des départements 22/29/35/56 avec ",
    "leurs géométries (geo_shape). Il permet la jointure SPATIALE arrêts → ",
    "communes que l'offre TC exige (les arrêts mobibreizh-stops ne portent ",
    "aucun code INSEE). Référentiel stale (2020-09-03) — suffisant pour des ",
    "limites communales quasi-statiques, la date est documentée telle quelle ; ",
    "le champ epci_code du référentiel n'est PAS utilisé (la base des EPCI ",
    "partagée du pipeline est la référence autoritaire). Licence Ouverte v2.0."
  ),
  "cron", "fichier"
)

# MANIFEST_MOBILITE_BORNES -----------------------------------------------------
# Le fragment BORNES (issue #140, « Bornes de recharge ») : le fichier
# consolidé IRVE (Etalab, federé sur data.bretagne.bzh, schéma 2.2.0) — les
# bornes de recharge pour véhicules électriques, une ligne par POINT DE CHARGE
# avec le code INSEE de la commune (code_insee_commune) et l'identifiant de
# station (id_station_itinerance). L'indicateur « bornes/commune » compte les
# STATIONS distinctes par commune (jamais les points de charge — une station
# porte plusieurs prises). Caveat source documenté : ~un quart des lignes ne
# porte aucun code_insee_commune (le fichier lui-même signale « certaines
# stations sont mal géolocalisées ») — ces stations n'entrent dans aucun
# comptage communal. Vintage verrouillé du contrat thème : refreshed
# 2026-07-28 ; la PUBLICATION est le traitement ODS du fichier exporté
# (2026-08-04 — le fichier téléchargé porte des mises à jour date_maj jusqu'au
# 2026-08-04, la référence du contrat reste le rafraîchissement déclaré).
MANIFEST_MOBILITE_BORNES <- tibble::tribble(
  ~id, ~source, ~url, ~fichier, ~vintage, ~date_reference,
  ~date_publication, ~licence, ~note, ~mode, ~type,
  "bornes-recharges",
  "Etalab / data.bretagne.bzh — Fichier consolidé des Bornes de Recharge pour Véhicules Électriques (IRVE), schéma 2.2.0",
  "https://data.bretagne.bzh/api/explore/v2.1/catalog/datasets/bornes-recharges/exports/csv?limit=-1&timezone=UTC&use_labels=false&delimiter=%3B",
  "bornes-recharges.csv",
  "2026-07", "2026-07-28", "2026-08-04",
  "lov2",
  paste0(
    "Les bornes de recharge pour véhicules électriques (IRVE), schéma 2.2.0, ",
    "consolidées par Etalab et federées sur data.bretagne.bzh : 9 898 lignes ",
    "(une par POINT DE CHARGE, l'export du 2026-08-04 — le compte documenté de ",
    "9 424 du contrat thème datait du pass de recherche). L'indicateur ",
    "« Bornes de recharge (IRVE) / commune » compte les STATIONS distinctes ",
    "(id_station_itinerance) par commune (code_insee_commune) — jamais les ",
    "points de charge (nbre_pdc) : « bornes » = stations, le vocabulaire du ",
    "contrat. Caveat source (documenté par le fichier lui-même) : ~24 % des ",
    "lignes ne portent aucun code_insee_commune (« certaines stations sont mal ",
    "géolocalisées ») — ces stations n'entrent dans aucun comptage communal, la ",
    "limite est documentée dans la Méthodes. Licence Ouverte v2.0. Vintage ",
    "verrouillé du contrat : refreshed 2026-07-28 (référence) ; publication : le ",
    "traitement ODS de l'export (2026-08-04)."
  ),
  "cron", "fichier"
)

# MANIFEST_MOBILITE_STATIONNEMENT_VELO -----------------------------------------
# Le fragment STATIONNEMENT VELO (issue #140, « Stationnement vélo ») : le hub
# Ecolab « Nombre de places de stationnement vélo pour 1 000 hab. » (dataset
# data.gouv.fr 67f989c8d9b3a8440f204aa7, tag ecospheres-indicateurs), fichier
# par commune (~36 Mo). PRIS TEL QUEL (décision verrouillée 2026-08-04,
# docs/themes/mobilite.md : les comptages de stationnement vélo ne sont pas
# dérivables du propre pipeline de Lusk — seul le hub les pré-calcule depuis
# OSM ; les RÉSEAUX cyclables, eux, restent dans le pipeline). Le CSV porte une
# ligne par (commune × millésime × type d'accroche) ; l'indicateur somme les
# places (numerateur) sur les quatre types d'accroche et rapporte au
# dénominateur (la population) — le calcul exact du hub (vérifié contre le
# fichier région du hub : 18,499 places/1 000 hab pour la Bretagne 2025, la
# même valeur que la recomposition communale). Couverture bretonne VÉRIFIÉE à
# la lecture : 1 202 communes × 4 millésimes (2022-2025) × 4 types d'accroche.
# ODbL (producteur OSM — Base Nationale du Stationnement Cyclable, transport.
# data.gouv.fr) : attribution « © OpenStreetMap contributors », ADR-0001.
# Vintage : l'annuel du hub (2022–2025) ; la référence est la date de la mesure
# la plus récente (2025-01-01), la publication la mise en ligne du fichier
# (resource last_modified 2026-02-03).
MANIFEST_MOBILITE_STATIONNEMENT_VELO <- tibble::tribble(
  ~id, ~source, ~url, ~fichier, ~vintage, ~date_reference,
  ~date_publication, ~licence, ~note, ~mode, ~type,
  "stationnement-velo",
  "Ecolab — Nombre de places de stationnement vélo pour 1 000 hab. (hub d'indicateurs territoriaux de transition écologique ; source OSM : Base Nationale du Stationnement Cyclable)",
  "https://static.data.gouv.fr/resources/nombre-de-places-de-stationnement-velo-pour-1000-hab/20260203-170506/nombre-de-places-de-stationnement-velo-pour-1000-hab-commune.csv",
  "stationnement-velo-commune.csv",
  "2022-2025", "2025-01-01", "2026-02-03",
  "odbl",
  paste0(
    "Le hub Ecolab « Nombre de places de stationnement vélo pour 1 000 hab. » ",
    "(dataset data.gouv.fr 67f989c8d9b3a8440f204aa7, ecospheres-indicateurs, ",
    "fichier par commune ~36 Mo) — PRIS TEL QUEL (décision 2026-08-04 : les ",
    "comptages de stationnement vélo ne sont pas dérivables du propre pipeline ",
    "de Lusk ; le hub les pré-calcule depuis la Base Nationale du ",
    "Stationnement Cyclable, elle-même issue d'OSM). Une ligne par (commune × ",
    "millésime × type d'accroche : roue / cadre / cadre et roue / sans ",
    "accroche) ; l'indicateur somme les places (numerateur) sur les quatre ",
    "types et rapporte au dénominateur (population) — le calcul du hub, vérifié ",
    "contre son fichier région (Bretagne 2025 : 18,499 places/1 000 hab). ",
    "Couverture bretonne VÉRIFIÉE à la lecture : 1 202 communes × 2022-2025 × 4 ",
    "types. Le millésime le plus récent (2025) est l'indicateur ; la série ",
    "2022-2025 est le vintage. ODbL (producteur OSM, ADR-0001) : attribution ",
    "« © OpenStreetMap contributors » portée par l'indicateur et la Méthodes."
  ),
  "cron", "fichier"
)

# MANIFEST_MOBILITE -------------------------------------------------------------
# Le manifeste CONCATÉNÉ du thème (la même forme que MANIFEST_ECONOMIE) : les
# quatre fragments, dans l'ordre — le snapshot porté (l'horloge lente du
# flagship), puis les sources du sous-bloc « L'offre de mobilité alternative »
# (korrigo GTFS, mobibreizh-stops, communes-france, bornes-recharges,
# stationnement-velo). SIX lignes, six ids uniques, chaque source garde SON
# vintage. Validé par verifier_contrat_manifest_mobilite.
MANIFEST_MOBILITE <- dplyr::bind_rows(
  MANIFEST_MOBILITE_SNAPSHOT,
  MANIFEST_MOBILITE_KORRIGO,
  MANIFEST_MOBILITE_BORNES,
  MANIFEST_MOBILITE_STATIONNEMENT_VELO
)

# verifier_contrat_mobilite_snapshot ---------------------------------------------
# La VALIDATION du contrat du manifeste (la discipline des fragments, comme
# verifier_contrat_sirene_snapshot) : le contrat épingle LE fichier de
# production porté, jamais l'artefact non-production. Elle s'exécute sur le
# manifeste réel ET sur des fixtures négatives : toute violation — id hors
# contrat, fichier hors contrat, dates mal formées, publication antérieure à
# la référence, licence non ODbL, mode non manuel — échoue bruyamment en
# nommant le champ fautif.
verifier_contrat_mobilite_snapshot <- function(manifest) {
  manquer <- function(champ, detail) {
    stop(sprintf("Contrat Mobilité snapshot violé — %s : %s.", champ, detail),
         call. = FALSE)
  }
  valeur <- function(champ) {
    x <- manifest[[champ]]
    if (is.null(x) || length(x) == 0) NA_character_ else as.character(x[1])
  }

  # UNE source, un id unique
  if (!inherits(manifest, "tbl_df")) {
    manquer("forme", "le manifeste doit être un tibble")
  }
  if (nrow(manifest) != 1L) {
    manquer("id", "le contrat épingle UNE source — une seule ligne")
  }
  if (anyDuplicated(manifest$id)) manquer("id", "id dupliqué")
  if (valeur("id") != "mobilite_snapshot") {
    manquer("id", "id attendu : 'mobilite_snapshot'")
  }

  # LE fichier de production, jamais l'artefact non-production aux deltas vélo
  # négatifs — la garde du « jamais cette base » du PRD #136
  fichier <- valeur("fichier")
  if (is.na(fichier)) manquer("fichier", "nom de cache absent")
  if (fichier != "bretagne_mobility_super_dashboard_gravity.csv") {
    manquer("fichier", paste0(
      "le contrat épingle le fichier de production ",
      "bretagne_mobility_super_dashboard_gravity.csv — l'artefact ",
      "non-production (indicateurs_summarized_communes.csv, deltas vélo ",
      "négatifs) est refusé"
    ))
  }

  # mode manuel (ADR-0004 — le snapshot est porté à la main, horloge lente) et
  # type fichier (le cache EST le CSV)
  mode <- valeur("mode")
  if (is.na(mode) || mode != "manuel") {
    manquer("mode", "mode attendu : 'manuel' (snapshot porté, jamais de cron)")
  }
  type <- valeur("type")
  if (is.na(type) || type != "fichier") {
    manquer("type", "type attendu : 'fichier'")
  }

  # la licence ODbL (l'analyse consomme l'OSM — ADR-0001)
  if (valeur("licence") != "odbl") {
    manquer("licence", "licence attendue : 'odbl' (OSM, ADR-0001)")
  }

  # les dates — ISO ; la référence (l'instantané de l'analyse) antérieure ou
  # égale à la publication (le portage)
  vintage <- valeur("vintage")
  date_ref <- valeur("date_reference")
  date_pub <- valeur("date_publication")
  toutes <- c(vintage, date_ref, date_pub)
  if (any(is.na(toutes)) ||
      any(!grepl("^[0-9]{4}-[0-9]{2}(-[0-9]{2})?$", toutes))) {
    manquer("dates", "vintage / date_reference / date_publication manquants ou mal formés")
  }
  if (as.Date(date_pub) < as.Date(date_ref)) {
    manquer("date_publication", paste0(
      "la publication (le portage, ", date_pub, ") doit être postérieure ou ",
      "égale à la référence (l'instantané de l'analyse, ", date_ref, ")"
    ))
  }

  invisible(TRUE)
}

# verifier_contrat_mobilite_korrigo ---------------------------------------------
# Le contrat du fragment KORRIGO (issue #140) : TROIS sources — korrigo (la
# base GTFS, odbl), mobibreizh-stops (les arrêts, odbl), communes-france (le
# référentiel géographique, lov2). Chaque ligne : mode cron, type fichier,
# dates ISO bien formées (publication ≥ référence), fichier de cache distinct.
# Le fragment porte le RÉFÉRENTIEL GÉOGRAPHIQUE : les arrêts n'ont pas de code
# INSEE, la jointure spatiale exige les géométries communales — un fragment
# sans communes-france est un fragment incomplet qui échoue bruyamment.
verifier_contrat_mobilite_korrigo <- function(fragment) {
  manquer <- function(champ, detail) {
    stop(sprintf("Contrat Mobilité Korrigo violé — %s : %s.", champ, detail),
         call. = FALSE)
  }
  if (!inherits(fragment, "tbl_df") || nrow(fragment) != 3L) {
    manquer("forme", "le fragment Korrigo porte TROIS sources (GTFS + arrêts + référentiel)")
  }
  ids <- fragment$id
  attendus <- c("korrigo", "mobibreizh-stops", "communes-france")
  if (!setequal(ids, attendus) || anyDuplicated(ids)) {
    manquer("id", "ids attendus : korrigo / mobibreizh-stops / communes-france, uniques")
  }
  licences <- stats::setNames(fragment$licence, ids)
  if (is.na(licences["korrigo"]) || is.na(licences["mobibreizh-stops"]) ||
      is.na(licences["communes-france"]) ||
      licences["korrigo"] != "odbl" ||
      licences["mobibreizh-stops"] != "odbl" ||
      licences["communes-france"] != "lov2") {
    manquer("licence", "korrigo/mobibreizh-stops = odbl (ADR-0001), communes-france = lov2")
  }
  if (any(fragment$mode != "cron") || any(fragment$type != "fichier")) {
    manquer("mode/type", "mode 'cron' et type 'fichier' pour les trois sources")
  }
  if (anyDuplicated(fragment$fichier)) {
    manquer("fichier", "un fichier de cache distinct par source")
  }
  dates_ok <- all(grepl("^[0-9]{4}-[0-9]{2}(-[0-9]{2})?$",
                        fragment$date_reference) &
                    grepl("^[0-9]{4}-[0-9]{2}(-[0-9]{2})?$",
                          fragment$date_publication))
  if (!dates_ok ||
      any(as.Date(fragment$date_publication) < as.Date(fragment$date_reference))) {
    manquer("dates", "dates ISO bien formées, publication jamais antérieure à la référence")
  }
  invisible(TRUE)
}

# verifier_contrat_mobilite_bornes ----------------------------------------------
# Le contrat du fragment BORNES (issue #140) : UNE source — bornes-recharges,
# le fichier consolidé IRVE (Licence Ouverte v2.0, refreshed 2026-07-28 selon
# le contrat thème ; la publication 2026-08-04 = le traitement ODS de l'export).
verifier_contrat_mobilite_bornes <- function(fragment) {
  manquer <- function(champ, detail) {
    stop(sprintf("Contrat Mobilité Bornes violé — %s : %s.", champ, detail),
         call. = FALSE)
  }
  if (!inherits(fragment, "tbl_df") || nrow(fragment) != 1L) {
    manquer("forme", "le fragment Bornes porte UNE source")
  }
  if (fragment$id != "bornes-recharges") {
    manquer("id", "id attendu : 'bornes-recharges'")
  }
  if (fragment$fichier != "bornes-recharges.csv") {
    manquer("fichier", "fichier de cache attendu : bornes-recharges.csv")
  }
  if (fragment$licence != "lov2") {
    manquer("licence", "licence attendue : 'lov2' (Licence Ouverte v2.0)")
  }
  if (fragment$mode != "cron" || fragment$type != "fichier") {
    manquer("mode/type", "mode 'cron' et type 'fichier'")
  }
  if (!grepl("^[0-9]{4}-[0-9]{2}(-[0-9]{2})?$", fragment$date_reference) ||
      !grepl("^[0-9]{4}-[0-9]{2}(-[0-9]{2})?$", fragment$date_publication) ||
      as.Date(fragment$date_publication) < as.Date(fragment$date_reference)) {
    manquer("dates", "dates ISO bien formées, publication jamais antérieure à la référence")
  }
  invisible(TRUE)
}

# verifier_contrat_mobilite_stationnement_velo ----------------------------------
# Le contrat du fragment STATIONNEMENT VELO (issue #140) : UNE source —
# stationnement-velo, le fichier par commune du hub Ecolab (~36 Mo, ODbL car
# producteur OSM, ADR-0001), PRIS TEL QUEL (décision 2026-08-04). Vintage
# annuel du hub (2022-2025), référence 2025-01-01 (la mesure la plus récente),
# publication 2026-02-03 (la mise en ligne du fichier).
verifier_contrat_mobilite_stationnement_velo <- function(fragment) {
  manquer <- function(champ, detail) {
    stop(sprintf("Contrat Mobilité Stationnement vélo violé — %s : %s.",
                 champ, detail), call. = FALSE)
  }
  if (!inherits(fragment, "tbl_df") || nrow(fragment) != 1L) {
    manquer("forme", "le fragment Stationnement vélo porte UNE source")
  }
  if (fragment$id != "stationnement-velo") {
    manquer("id", "id attendu : 'stationnement-velo'")
  }
  if (fragment$fichier != "stationnement-velo-commune.csv") {
    manquer("fichier", "fichier de cache attendu : stationnement-velo-commune.csv")
  }
  if (fragment$licence != "odbl") {
    manquer("licence", "licence attendue : 'odbl' (producteur OSM, ADR-0001)")
  }
  if (fragment$mode != "cron" || fragment$type != "fichier") {
    manquer("mode/type", "mode 'cron' et type 'fichier'")
  }
  if (fragment$vintage != "2022-2025") {
    manquer("vintage", "vintage attendu : '2022-2025' (l'annuel du hub)")
  }
  if (!grepl("^[0-9]{4}-[0-9]{2}(-[0-9]{2})?$", fragment$date_reference) ||
      !grepl("^[0-9]{4}-[0-9]{2}(-[0-9]{2})?$", fragment$date_publication) ||
      as.Date(fragment$date_publication) < as.Date(fragment$date_reference)) {
    manquer("dates", "dates ISO bien formées, publication jamais antérieure à la référence")
  }
  invisible(TRUE)
}

# verifier_contrat_manifest_mobilite --------------------------------------------
# Le contrat du MANIFESTE CONCATÉNÉ du thème (issue #140, la même idée que les
# contrats de manifeste des fragments) : SIX lignes, six ids uniques et exacts
# (le snapshot porté + les cinq sources du sous-bloc), chaque fragment passe
# SON contrat, et la discipline des dates tient sur tout le manifeste — la
# publication d'une source n'est jamais antérieure à sa référence. Un manifeste
# corrompu échoue FORT en nommant le champ fautif.
verifier_contrat_manifest_mobilite <- function(manifest) {
  manquer <- function(champ, detail) {
    stop(sprintf("Contrat manifeste Mobilité violé — %s : %s.", champ, detail),
         call. = FALSE)
  }
  if (!inherits(manifest, "tbl_df")) {
    manquer("forme", "le manifeste doit être un tibble")
  }
  if (nrow(manifest) != 6L) {
    manquer("forme", "SIX sources attendues (snapshot + korrigo + mobibreizh-stops + communes-france + bornes-recharges + stationnement-velo)")
  }
  if (anyDuplicated(manifest$id)) {
    manquer("id", "ids dupliqués")
  }
  attendus <- c("mobilite_snapshot", "korrigo", "mobibreizh-stops",
                "communes-france", "bornes-recharges", "stationnement-velo")
  if (!setequal(manifest$id, attendus)) {
    manquer("id", paste0("ids attendus : ", paste(attendus, collapse = ", ")))
  }
  # le fragment snapshot passe SON contrat (la garde du « jamais cette base »)
  verifier_contrat_mobilite_snapshot(
    manifest[manifest$id == "mobilite_snapshot", ]
  )
  # les fragments du sous-bloc passent LEURS contrats
  verifier_contrat_mobilite_korrigo(
    manifest[manifest$id %in% c("korrigo", "mobibreizh-stops", "communes-france"), ]
  )
  verifier_contrat_mobilite_bornes(
    manifest[manifest$id == "bornes-recharges", ]
  )
  verifier_contrat_mobilite_stationnement_velo(
    manifest[manifest$id == "stationnement-velo", ]
  )
  # la discipline des 11 colonnes standard + les dates sur tout le manifeste
  if (!all(c("id", "source", "url", "fichier", "vintage", "date_reference",
             "date_publication", "licence", "note", "mode", "type") %in%
             names(manifest))) {
    manquer("forme", "les 11 colonnes standard du manifeste")
  }
  if (any(is.na(manifest$date_reference)) ||
      any(is.na(manifest$date_publication)) ||
      any(as.Date(manifest$date_publication) < as.Date(manifest$date_reference))) {
    manquer("dates", "la publication d'une source n'est jamais antérieure à sa référence")
  }
  invisible(TRUE)
}
