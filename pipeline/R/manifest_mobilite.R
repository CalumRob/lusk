# manifest_mobilite -------------------------------------------------------------
# Les FRAGMENTS de manifeste du thème Mobilité (issues #137 tracer bullet, #138
# la chaîne analytique flagship, #139 l'étage demande/réseaux, #140 le sous-bloc
# « L'offre de mobilité alternative ») — la convention des fragments par source
# (issue #13, la même forme que MANIFEST_ECONOMIE) : UNE ligne par source, jamais
# de doublon de cache, chaque source garde SON vintage, SA référence et SA
# publication.
#
# Les fragments (concaténés dans MANIFEST_MOBILITE, l'ordre du manifeste) :
#   - mobilite_snapshot   (issue #137, fragment SNAPSHOT) : le snapshot PORTÉ
#     de l'analyse d'accessibilité « Vingt minutes sans voiture » — le fichier
#     de production bretagne_mobility_super_dashboard_gravity.csv. INSTANTANÉ
#     sur horloge lente : la référence est la date d'instantané de l'analyse
#     (2026-02-28), la publication la date du portage (2026-08-06). Mode
#     « manuel » (ADR-0004), jamais de cron.
#   - rp_logement_princ  (issue #139, fragment DEMANDE) : le cube RP exploitation
#     principale DS_RP_LOGEMENT_PRINC (le code de table LOG T12 « Équipement
#     automobile des ménages ») — les voitures/ménage de la demande.
#   - osm_reseaux        (issue #139, fragment RESEAUX) : l'extrait Geofabrik
#     Bretagne (bretagne-latest.osm.pbf) — les réseaux t/b/c, le timestamp
#     d'extraction comme référence (jamais « aujourd'hui »). ODbL (ADR-0001).
#   - communes_limites   (issue #139, fragment LIMITES) : les limites communales
#     Admin Express COG (WFS data.geopf.fr) — l'attribution des lignes OSM et la
#     surface des densités. Licence Ouverte 2.0 (IGN).
#   - korrigo             (issue #140, fragment KORRIGO) : la base multimodale
#     GTFS Korrigo (Bretagne Mobilité) — le stops.txt de la fédération est LA
#     source des arrêts de l'offre TC. DÉCISION DE SOURCE (la correction de la
#     première passe, documentée dans la note) : les arrêts viennent du
#     stops.txt GTFS (27 297 arrêts, dont 2 919 STAR — Rennes), PAS de
#     mobibreizh-stops (24 380 arrêts SANS le réseau STAR — un constat de
#     qualité de la donnée). ODbL (ADR-0001).
#   - batiments_residentiels (issue #140, fragment BATIMENTS) : la couche des
#     bâtiments résidentiels de Bretagne (BDNB — Base Nationale des
#     Bâtiments), portée comme le snapshot (mode « manuel », son propre
#     millésime BDNB 2025-07). Les geom_adresse POINT (EPSG:2154) avec leur
#     code_commune_insee portent la VRAIE part des bâtiments près d'un arrêt
#     (la correction de la méthode). Licence Ouverte 2.0 (Etalab).
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
#
# Ce qui n'y figure PLUS (la correction de la première passe, issue #140) :
#   - mobibreizh-stops : le fichier ne porte AUCUN arrêt du réseau STAR de
#     Rennes (vérifié en direct 2026-08-06 — les préfixes CTRL, KICEO,
#     PENNARBED, QUB, BIBUS… y sont, STAR absent). La fédération GTFS
#     (stops.txt, 27 297 arrêts dont 2 919 STAR) est autoritaire. Le constat
#     est documenté dans la note du fragment korrigo ;
#   - communes-france : la couche bâtiments porte elle-même code_commune_insee
#     — la jointure spatiale aux polygones communaux n'est plus nécessaire.

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


# MANIFEST_MOBILITE_RP_LOGEMENT -------------------------------------------------
# Le fragment DEMANDE (issue #139) : le cube RP exploitation principale
# DS_RP_LOGEMENT_PRINC — les voitures/ménage, le code de table épinglé LOG T12
# (la même note que le fragment en ligne du manifeste #139, désormais isolée).
MANIFEST_MOBILITE_RP_LOGEMENT <- tibble::tribble(
  ~id, ~source, ~url, ~fichier, ~vintage, ~date_reference,
  ~date_publication, ~licence, ~note, ~mode, ~type,
  # ————————————————————————————————————————————————————————————————————————
  # rp_logement_princ — la demande : voitures/ménage (issue #139)
  # Le code de table RP épinglé en recherche (2026-08-06, l'item 🔶 du contrat
  # mobilite.md) : la table LOG T12 « Équipement automobile des ménages » du
  # dossier complet INSEE, alimentée par le jeu MELODI DS_RP_LOGEMENT_PRINC
  # (les exploitations PRINCIPALES du recensement — la source du tableau
  # « Équipement automobile des ménages » de la fiche dossier complet). La
  # dimension CARS du cube porte les comptes DWELLINGS par commune : C0 (aucune
  # voiture), C1 (une voiture), C_GE1 (au moins une), C_GE2 (deux ou plus), _T
  # (total des ménages). Les fichiers longs MELODI du dossier complet
  # (DS_RP_MENAGES_COMP — DWELLINGS/DWELLINGS_POPSIZE seulement — et
  # DS_RP_POPULATION_PRINC — POP seulement) ne portent PAS les voitures :
  # vérifié par scan complet des deux fichiers le 2026-08-06. La RÉFÉRENCE est
  # le millésime du recensement RP 2023 (2023-01-01) ; la PUBLICATION est la
  # date de la base du dossier complet qui porte le tableau LOG T12
  # (29/07/2026, vérifiée). Licence Ouverte 2.0 (INSEE).
  "rp_logement_princ",
  "INSEE — Recensement de la population, exploitations principales (Logements) — tableau LOG T12 « Équipement automobile des ménages » (le jeu DS_RP_LOGEMENT_PRINC, la dimension CARS)",
  "https://api.insee.fr/melodi/file/DS_RP_LOGEMENT_PRINC/DS_RP_LOGEMENT_PRINC_2023_CSV_FR",
  "DS_RP_LOGEMENT_PRINC_2023_CSV_FR.zip", "2023", "2023-01-01", "2026-07-29", "lov2",
  paste0(
    "La demande du bloc Mobilité : les voitures par ménage (parts sans ",
    "voiture / 2+). Le code de table RP ÉPINGLÉ en recherche (2026-08-06, ",
    "l'item 🔶 du contrat) : la table LOG T12 « Équipement automobile des ",
    "ménages » du dossier complet, alimentée par le jeu MELODI ",
    "DS_RP_LOGEMENT_PRINC (les exploitations principales du recensement). La ",
    "dimension CARS du cube porte les comptes DWELLINGS par commune : C0 ",
    "(aucune voiture), C1 (une), C_GE1 (au moins une), C_GE2 (deux ou plus), ",
    "_T (total des ménages). Les fichiers longs MELODI du dossier complet ",
    "(DS_RP_MENAGES_COMP — DWELLINGS/DWELLINGS_POPSIZE seulement — et ",
    "DS_RP_POPULATION_PRINC — POP seulement) ne portent PAS les voitures : ",
    "vérifié par scan complet des deux fichiers le 2026-08-06. Référence : le ",
    "millésime RP 2023 (2023-01-01) ; publication : la base du dossier complet ",
    "qui porte le tableau LOG T12 (2026-07-29, vérifiée). Licence Ouverte 2.0."
  ),
  "cron", "fichier"
)

# MANIFEST_MOBILITE_OSM_RESEAUX ------------------------------------------------
# Le fragment RESEAUX (issue #139) : l'extrait Geofabrik Bretagne — les réseaux
# t/b/c, le timestamp d'extraction comme référence (jamais « aujourd'hui »).
MANIFEST_MOBILITE_OSM_RESEAUX <- tibble::tribble(
  ~id, ~source, ~url, ~fichier, ~vintage, ~date_reference,
  ~date_publication, ~licence, ~note, ~mode, ~type,
  # ————————————————————————————————————————————————————————————————————————
  # osm_reseaux — les réseaux t/b/c (issue #139)
  # L'extrait Geofabrik Bretagne (bretagne-latest.osm.pbf, ~312 Mo, reconstruit
  # chaque jour) — la couche `lines` highway=* que le pipeline projette en
  # EPSG:2154 AVANT toute mesure (la consigne du contrat). Le vintage est le
  # TIMESTAMP D'EXTRACTION (la donnée « up to » de l'extrait, jamais
  # « aujourd'hui ») : référence 2026-08-05 (l'extrait contient les données
  # jusqu'au 2026-08-05T20:21:23Z, vérifié sur la page Geofabrik), publication
  # 2026-08-06 (le portage). ODbL (ADR-0001) : attribution « © OpenStreetMap
  # contributors » + lien ODbL portée par la note, le code d'extraction publié
  # avec la Méthodes (ODbL §4.6). Mode « manuel » (312 Mo, jamais un cron).
  "osm_reseaux",
  "OpenStreetMap — réseaux routier/cyclable/piéton (extrait Geofabrik Bretagne) — © OpenStreetMap contributors, licence ODbL 1.0 (ADR-0001)",
  "https://download.geofabrik.de/europe/france/bretagne-latest.osm.pbf",
  "bretagne-latest.osm.pbf", "2026-08", "2026-08-05", "2026-08-06", "odbl",
  paste0(
    "Les réseaux du bloc Mobilité : longueurs et densités par mode t/b/c ",
    "(à pied / vélo / voiture), lues sur la couche `lines` de l'extrait ",
    "Geofabrik Bretagne (highway=*), projetée en EPSG:2154 AVANT toute mesure. ",
    "Le VINTAGE est le timestamp d'EXTRACTION — jamais « aujourd'hui » : ",
    "l'extrait du 5 août 2026 contient les données OSM jusqu'au ",
    "2026-08-05T20:21:23Z (vérifié sur la page Geofabrik). ODbL 1.0 ",
    "(ADR-0001) : attribution « © OpenStreetMap contributors » + lien ODbL, ",
    "code d'extraction publié avec la Méthodes (ODbL §4.6). Mode « manuel » : ",
    "l'extrait fait ~312 Mo — le portage suit l'horloge lente du flagship."
  ),
  "manuel", "fichier"
)

# MANIFEST_MOBILITE_AMENAGEMENTS_CYCLABLES --------------------------------------
# Le fragment AMENAGEMENTS CYCLABLES (issue #222, ticket #228) : la source du
# mode `b` (vélo) de `reseaux` — le jeu Geovelo « Aménagements cyclables
# France Métropolitaine » (data.gouv.fr, ODbL — ADR-0001), snapshot parquet
# mensuel, normalisé au schéma national v0.3.5, rattaché aux communes par côté
# (code_com_d/g, COG 2022 — la table de passage cog_passage les projette vers
# le COG 2025 du squelette). REMPLACE le raw OSM pour le vélo : plus
# d'extraction maison du mode `b` — la longueur/densité devient une somme sur
# les lignes du fichier. `osm_reseaux` reste le fragment des modes `t`/`c` (le
# pbf n'est pas retiré). Vérifié sur le jeu réel (research note §4, 2026-08-08) :
# chaque snapshot est UNE ressource distincte (pas d'alias « latest » stable) —
# le manifeste épingle un snapshot précis (france-20260807.parquet, 64,5 Mo,
# 412 681 lignes) ; la mise à jour mensuelle du pin est le travail du Watchdog.
# Le VINTAGE est la date du snapshot (2026-08), jamais « aujourd'hui ».
MANIFEST_MOBILITE_AMENAGEMENTS_CYCLABLES <- tibble::tribble(
  ~id, ~source, ~url, ~fichier, ~vintage, ~date_reference,
  ~date_publication, ~licence, ~note, ~mode, ~type,
  "amenagements_cyclables",
  "Geovelo — Aménagements cyclables France Métropolitaine (schéma national v0.3.5, ODbL — © OpenStreetMap contributors, ADR-0001)",
  "https://static.data.gouv.fr/resources/amenagements-cyclables-france-metropolitaine/20260807-093413/france-20260807.parquet",
  "france-20260807.parquet", "2026-08", "2026-08-07", "2026-08-07", "odbl",
  paste0(
    "Le réseau cyclable du bloc Mobilité (le mode `b` de `reseaux` — la ",
    "longueur/densité à vélo) : le jeu Geovelo « Aménagements cyclables ",
    "France Métropolitaine », l'ensemble des aménagements cyclables OSM ",
    "normalisés au schéma national v0.3.5, rattachés aux communes par côté ",
    "(code_com_d/g, COG 2022 → 2025 via cog_passage). REMPLACE le raw OSM ",
    "(issue #222) : plus d'extraction maison du mode `b` — la longueur devient ",
    "une somme sur les lignes du fichier, la règle par direction d'ADR-0016. ",
    "Snapshot parquet MENSUEL épinglé (chaque snapshot est une ressource ",
    "distincte, sans alias « latest » stable — le pin mensuel est le travail ",
    "du Watchdog ; france-20260807.parquet : 64,5 Mo, 412 681 lignes). ",
    "VINTAGE = la date du snapshot (2026-08-07), jamais « aujourd'hui ». ",
    "ODbL (ADR-0001) : attribution « © OpenStreetMap contributors ». Le pbf ",
    "Geofabrik (osm_reseaux) reste la source des modes t/c et du dénominateur ",
    "routier de la figure « L'offre cyclable »."
  ),
  "cron", "fichier"
)

# MANIFEST_MOBILITE_COMMUNES_LIMITES -------------------------------------------
# Le fragment LIMITES (issue #139) : les limites communales Admin Express COG
# (WFS data.geopf.fr) — l'attribution des lignes OSM et la surface des densités.
MANIFEST_MOBILITE_COMMUNES_LIMITES <- tibble::tribble(
  ~id, ~source, ~url, ~fichier, ~vintage, ~date_reference,
  ~date_publication, ~licence, ~note, ~mode, ~type,
  # ————————————————————————————————————————————————————————————————————————
  # communes_limites — le référentiel géométrique des réseaux (issue #139)
  # Les limites communales Admin Express COG (WFS data.geopf.fr, Licence
  # Ouverte 2.0 — la même famille que le fond de carte ADR-0008, mais en
  # géométrie COG complète pour le CALCUL) : l'attribution des lignes OSM aux
  # communes ET la surface (le dénominateur des densités). Le WFS renvoie la
  # Bretagne + les communes des régions voisines débordant de la bbox — le
  # filtre breton se fait au chargement (le code département ∈ 22/29/35/56).
  "communes_limites",
  "IGN — Admin Express COG, limites communales (WFS data.geopf.fr, Licence Ouverte 2.0)",
  "https://data.geopf.fr/wfs/ows?service=WFS&version=2.0.0&request=GetFeature&typeNames=ADMINEXPRESS-COG.LATEST:commune&count=3000&outputFormat=application/json&bbox=47.0,-5.5,49.0,-0.5,urn:ogc:def:crs:EPSG::4326",
  "communes_limites.geojson", "2025", "2025-01-01", NA_character_, "lov2",
  paste0(
    "Le référentiel géométrique des réseaux t/b/c : les limites communales ",
    "Admin Express COG (IGN, Licence Ouverte 2.0) — l'attribution des lignes ",
    "OSM aux communes (le centroïde de chaque ligne) et la SURFACE communale ",
    "(le dénominateur des densités, EPSG:2154). La même famille que le fond de ",
    "carte (ADR-0008) mais en géométrie COG complète, pour le calcul. Le WFS ",
    "renvoie la Bretagne plus les communes voisines qui débordent de la bbox : ",
    "le filtre breton (département 22/29/35/56) se fait au chargement. La ",
    "publication du WFS n'est pas exposée (NA, à compléter par le watchdog)."
  ),
  "cron", "fichier"
)

# MANIFEST_MOBILITE_KORRIGO ----------------------------------------------------
# Le fragment KORRIGO (issue #140, le sous-bloc « Offre TC ») : la base
# multimodale GTFS Korrigo (Bretagne Mobilité, data.bretagne.bzh) — le zip GTFS
# est le cache ; le stops.txt de la fédération (27 297 arrêts, dont 2 919 du
# réseau STAR de Rennes) est LA source des arrêts de l'offre TC.
#
# DÉCISION DE SOURCE (la correction de la première passe, 2026-08-06) :
# mobibreizh-stops (24 380 arrêts, Région Bretagne) ne porte AUCUN arrêt STAR
# — le réseau métro+bus de Rennes y est absent (vérifié en direct : les
# préfixes CTRL, KICEO, PENNARBED, QUB, BIBUS… y figurent, STAR non). Le
# stops.txt GTFS est la fédération COMPLÈTE : c'est la source autoritaire des
# arrêts. Le fichier mobibreizh-stops n'est plus une source du thème (le
# constat est documenté ici, dans la Méthodes et dans les tests).
#
# DÉCISION DE MÉTHODE (l'item 🔶 du contrat, docs/themes/mobilite.md §Open
# items et ADR-0012) : « part des bâtiments près d'un arrêt » = la fraction
# des BÂTIMENTS de la commune (la couche batiments_residentiels, geom_adresse
# POINT EPSG:2154, code_commune_insee) à moins de 500 m à vol d'oiseau d'un
# arrêt GTFS — la VRAIE part, jamais un proxy de superficie communale (la
# première passe proxyait par la part de surface : Rennes superficie 0,40 vs
# bâtiments 0,996 — la divergence massive des communes denses a fait rejeter
# la passe). La distance de 500 m est le rayon classique « 10 minutes à pied »
# (la famille du « stop coverage ») ; verrouillée dans le code
# (DISTANCE_ARRET_M, analytics_mobilite.R) et documentée dans la Méthodes.
#
# Dates : le vintage de l'export GTFS (2026-02 — la date d'extraction du jeu,
# jamais « aujourd'hui » ; le feed porte feed_version « 80195 », valide à
# partir du 2025-09-19). ODbL (ADR-0001) : attribution « © OpenStreetMap
# contributors » portée par l'indicateur et la Méthodes.
MANIFEST_MOBILITE_KORRIGO <- tibble::tribble(
  ~id, ~source, ~url, ~fichier, ~vintage, ~date_reference,
  ~date_publication, ~licence, ~note, ~mode, ~type,
  "korrigo",
  "Bretagne Mobilité — Korrigo : base multimodale GTFS des transports publics en Bretagne (les 24+ réseaux : BreizhGo TER/car/maritime + les réseaux urbains STAR, Bibus, QUB, TUB, MAT, Izilo, TBK, Kicéo…)",
  "https://data.bretagne.bzh/api/explore/v2.1/catalog/datasets/korrigo/alternative_exports/korrigo",
  "korrigo-gtfs.zip",
  "2026-02", "2026-02-03", "2026-02-03",
  "odbl",
  paste0(
    "La base multimodale GTFS Korrigo (Bretagne Mobilité, data.bretagne.bzh) : ",
    "le réseau de transport public breton — la fédération des réseaux (STAR, ",
    "Bibus, QUB, TUB, MAT, TBK, Kicéo… + BreizhGo TER/car/maritime). Le zip ",
    "GTFS est le cache ; son stops.txt (27 297 arrêts, dont 2 919 du réseau ",
    "STAR de Rennes) est LA source des arrêts de l'offre TC. DÉCISION DE ",
    "SOURCE (la correction de la première passe, 2026-08-06) : mobibreizh-",
    "stops (24 380 arrêts) ne porte AUCUN arrêt STAR — le réseau métro+bus de ",
    "Rennes y est absent (vérifié en direct : CTRL, KICEO, PENNARBED, QUB, ",
    "BIBUS… présents, STAR non). Le stops.txt GTFS est la fédération COMPLÈTE — ",
    "source autoritaire ; mobibreizh-stops n'est plus une source du thème. ",
    "DÉCISION DE MÉTHODE (l'item 🔶 du contrat) : « part des bâtiments près ",
    "d'un arrêt » = la fraction des BÂTIMENTS de la commune à moins de 500 m à ",
    "vol d'oiseau d'un arrêt GTFS (la couche batiments_residentiels, ",
    "geom_adresse POINT EPSG:2154) — la VRAIE part, jamais un proxy de ",
    "superficie (la première passe proxyait par la surface : Rennes 0,40 vs ",
    "bâtiments 0,996 — rejetée). Le 500 m = le rayon « 10 minutes à pied » du ",
    "stop coverage, verrouillé dans le code et la Méthodes. ODbL (ADR-0001) : ",
    "attribution « © OpenStreetMap contributors » portée par l'indicateur."
  ),
  "cron", "fichier"
)

# MANIFEST_MOBILITE_BATIMENTS ---------------------------------------------------
# Le fragment BATIMENTS (issue #140, la correction de la méthode) : la couche
# des bâtiments résidentiels de Bretagne, dérivée de la BDNB (Base Nationale
# des Bâtiments) — 1 338 591 bâtiments, dont 1 235 417 portent un geom_adresse
# POINT (EPSG:2154) et leur code_commune_insee. PORTÉE comme le snapshot (mode
# « manuel », jamais un cron) : le fichier est extrait à la main, avec SON
# propre millésime (BDNB 2025-07 — la même référence BDNB que le snapshot),
# la publication étant la date du portage. Licence Ouverte 2.0 (Etalab) — la
# BDNB Open est réutilisable librement sous condition de citation des sources
# (docs/research/bndb.md §3).
#
# Cette couche porte la correction de la MÉTHODE de l'offre TC : la part des
# bâtiments près d'un arrêt est désormais la fraction des BÂTIMENTS de la
# commune à moins de 500 m d'un arrêt GTFS — calculée POINT par POINT sur les
# geom_adresse (jamais une part de superficie communale, qui diverge
# massivement dans les communes denses : Rennes superficie 0,40 vs bâtiments
# 0,996). La couche portant elle-même code_commune_insee, la jointure spatiale
# aux polygones communaux (communes-france) n'est plus nécessaire — le
# référentiel disparaît du manifeste.
MANIFEST_MOBILITE_BATIMENTS <- tibble::tribble(
  ~id, ~source, ~url, ~fichier, ~vintage, ~date_reference,
  ~date_publication, ~licence, ~note, ~mode, ~type,
  "batiments_residentiels",
  "BDNB (Base Nationale des Bâtiments) — couche des bâtiments résidentiels de Bretagne, portée pour l'offre TC (geom_adresse POINT EPSG:2154, code_commune_insee)",
  "file:///E:/Website/Data_handling/batiments_residentiels_bretagne.csv",
  "batiments_residentiels_bretagne.csv",
  "2025-07", "2025-07-31", "2026-08-06",
  "lov2",
  paste0(
    "La couche des bâtiments résidentiels de Bretagne, dérivée de la BDNB : ",
    "1 338 591 bâtiments, dont 1 235 417 portent un geom_adresse POINT ",
    "(EPSG:2154 — Lambert-93) et leur code_commune_insee (1 200 communes ; les ",
    "deux îles sans bâtiment géocodé — 29083/29084 — n'ont pas de part, un ",
    "fait de la couche). PORTÉE à la main comme le snapshot (mode « manuel », ",
    "jamais un cron), avec SON propre millésime BDNB 2025-07 (la référence du ",
    "fichier, citée dans le snapshot) et la date du portage comme publication. ",
    "Elle porte la CORRECTION de la méthode de l'offre TC : « part des ",
    "bâtiments près d'un arrêt » = la fraction des BÂTIMENTS de la commune à ",
    "moins de 500 m à vol d'oiseau d'un arrêt GTFS — calculée POINT par POINT, ",
    "jamais un proxy de superficie communale (la première passe proxyait par ",
    "la surface : Rennes 0,40 vs bâtiments 0,996 — rejetée). La couche portant ",
    "code_commune_insee, communes-france disparaît du manifeste. Licence ",
    "Ouverte 2.0 (Etalab — la BDNB Open est réutilisable librement sous ",
    "condition de citation des sources, docs/research/bndb.md)."
  ),
  "manuel", "fichier"
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

MANIFEST_MOBILITE_BPE_B316 <- tibble::tribble(
  ~id, ~source, ~url, ~fichier, ~vintage, ~date_reference,
  ~date_publication, ~licence, ~note, ~mode, ~type,
  "bpe_b316", "INSEE — Base permanente des équipements, B316 stations-service",
  "https://api.insee.fr/melodi/file/BPE/BPE_2024_CSV_FR", "bpe_b316_2024.csv", "2024",
  "2024-01-01", "2026-08-18", "lov2",
  "BPE 2024, type d’équipement B316 (FACILITIES) : dénombré par commune pour le dénominateur stations-service du ratio EV/fuel. Les absences restent NA.",
  "manuel", "fichier"
)

verifier_contrat_mobilite_bpe_b316 <- function(fragment, contenu = NULL) {
  manquer <- function(champ, detail) stop(sprintf(
    "Contrat Mobilité BPE B316 violé — %s : %s.", champ, detail), call. = FALSE)
  if (!inherits(fragment, "tbl_df") || nrow(fragment) != 1L) manquer("forme", "une source")
  if (fragment$id != "bpe_b316") manquer("id", "id attendu : bpe_b316")
  if (fragment$fichier != "bpe_b316_2024.csv") manquer("fichier", "export BPE B316 2024")
  if (fragment$vintage != "2024") manquer("vintage", "millésime 2024")
  if (!grepl("^https://api\\.insee\\.fr/melodi/file/BPE/BPE_[0-9]{4}_CSV_FR$", fragment$url))
    manquer("url", "export CSV BPE INSEE, pas une page HTML ni un chemin local")
  if (fragment$licence != "lov2") manquer("licence", "lov2")
  if (fragment$mode != "manuel" || fragment$type != "fichier") manquer("mode/type", "manuel/fichier")
  if (!is.null(contenu) &&
      (!is.data.frame(contenu) || !all(c("GEO", "FACILITIES", "NB_EQUIP") %in% names(contenu))))
    manquer("contenu", "le CSV doit porter GEO, FACILITIES et NB_EQUIP")
  if (!grepl("^[0-9]{4}-[0-9]{2}(-[0-9]{2})?$", fragment$date_reference) ||
      !grepl("^[0-9]{4}-[0-9]{2}(-[0-9]{2})?$", fragment$date_publication) ||
      as.Date(fragment$date_publication) < as.Date(fragment$date_reference))
    manquer("dates", "référence/publication ISO cohérentes")
  invisible(TRUE)
}

# MANIFEST_MOBILITE_COG_PASSAGE ------------------------------------------------
# Le fragment COG PASSAGE (issue #222, ticket #227) : la table de passage
# annuelle INSEE 2022 → 2025 — le composant PARTAGÉ (le même pattern que la
# base EPCI partagée de Milieux : un id/URL unique, le cache idempotent évite
# le re-téléchargement). La discipline que l'issue #222 supposait existante
# mais qui n'existait pas : le pipeline n'avait que des gardes de FORMAT COG
# (codes 5 chiffres, département breton), jamais de table millésime-à-millésime.
# Le jeu Geovelo « Aménagements cyclables » joint ses segments sur des codes
# COG 2022 (§3 du research note) — la table de passage les projette vers le
# COG 2025 du squelette de l'app (EPCI_au_01-01-2025.xlsx, Admin Express
# LATEST). Source : INSEE « Table de passage annuelle 2025 » (la feuille COM —
# une ligne par commune de la géographie 2025, CODGEO_<année> = le code de la
# commune dans chaque millésime depuis 2003 ; vérifié sur le fichier réel :
# 36 760 lignes × 47 colonnes, 1 270 communes bretonnes 2025, les fusions
# bretonnes 2022→2025 = Le Cambout 22027 + Coëtlogon 22043 → Plumieux 22241,
# Pléven 22200 → Val-d'Arguenon 22237, Saint-Launeuc 22309 → Merdrignac
# 22147, Fleurigné 35112 → La Chapelle-Fleurigné 35062). Licence Ouverte 2.0,
# mise à jour annuelle ; la référence est le millésime (2025-01-01), la
# publication la mise en ligne (2026-05-06 — la version corrigée, 3 lignes
# incohérentes supprimées). Le lecteur + les builders vivent dans geometrie.R
# (les helpers partagés du référentiel), pas dans le thème.
MANIFEST_MOBILITE_COG_PASSAGE <- tibble::tribble(
  ~id, ~source, ~url, ~fichier, ~vintage, ~date_reference,
  ~date_publication, ~licence, ~note, ~mode, ~type,
  "cog_passage",
  "INSEE — Table de passage annuelle des communes (COG 2025) : la correspondance des codes communaux entre les millésimes 2003-2025",
  "https://www.insee.fr/fr/statistiques/fichier/7671867/table_passage_annuelle_2025.zip",
  "table_passage_annuelle_2025.zip",
  "2025", "2025-01-01", "2026-05-06", "lov2",
  paste0(
    "La table de passage annuelle INSEE (COG 2025, Licence Ouverte 2.0, mise ",
    "à jour annuelle) : pour chaque commune de la géographie 2025, son code ",
    "dans chaque millésime depuis 2003 (la feuille COM, une ligne par commune, ",
    "36 760 lignes × 47 colonnes — vérifiée sur le fichier réel). Le composant ",
    "partagé qui projette les codes COG 2022 du jeu Geovelo « Aménagements ",
    "cyclables » vers le COG 2025 du squelette de l'app (la discipline que ",
    "#222 supposait existante — la table de passage n'existait pas, elle est ",
    "construite ici). Vérifié sur le fichier réel : les fusions bretonnes ",
    "2022→2025 sont Le Cambout (22027) + Coëtlogon (22043) → Plumieux (22241), ",
    "Pléven (22200) → Val-d'Arguenon (22237), Saint-Launeuc (22309) → ",
    "Merdrignac (22147), Fleurigné (35112) → La Chapelle-Fleurigné (35062) ; ",
    "1 270 communes bretonnes 2025, aucune créée après 2022 (0 NA CODGEO_2022). ",
    "Référence : le millésime (2025-01-01) ; publication : la mise en ligne de ",
    "la version corrigée du 06/05/2025 (3 lignes incohérentes supprimées)."
  ),
  "cron", "fichier"
)

# MANIFEST_MOBILITE -------------------------------------------------------------
# Le manifeste CONCATÉNÉ du thème (la même forme que MANIFEST_ECONOMIE) : les
# fragments, dans l'ordre — le snapshot porté (l'horloge lente du flagship), les
# trois sources de l'étage demande/réseaux (issue #139 : le cube RP voitures,
# l'extrait OSM, les limites communales), puis les quatre sources du sous-bloc
# « L'offre de mobilité alternative » (issue #140 : korrigo GTFS,
# batiments_residentiels, bornes-recharges, stationnement-velo). Depuis l'issue
# #222 (ticket #227), le manifeste porte aussi la table de passage COG partagée
# (cog_passage — le composant qui projette les codes 2022 du jeu Geovelo vers
# le COG 2025 du squelette) ; depuis le ticket #228, le mode `b` de `reseaux`
# est alimenté par le jeu Geovelo (amenagements_cyclables, cron mensuel) —
# osm_reseaux reste le fragment des modes t/c. DIX lignes, dix ids uniques,
# chaque source garde SON vintage. Validé par verifier_contrat_manifest_mobilite.
MANIFEST_MOBILITE <- dplyr::bind_rows(
  MANIFEST_MOBILITE_SNAPSHOT,
  MANIFEST_MOBILITE_RP_LOGEMENT,
  MANIFEST_MOBILITE_OSM_RESEAUX,
  MANIFEST_MOBILITE_AMENAGEMENTS_CYCLABLES,
  MANIFEST_MOBILITE_COMMUNES_LIMITES,
  MANIFEST_MOBILITE_KORRIGO,
  MANIFEST_MOBILITE_BATIMENTS,
  MANIFEST_MOBILITE_BORNES,
  MANIFEST_MOBILITE_STATIONNEMENT_VELO,
  MANIFEST_MOBILITE_BPE_B316,
  MANIFEST_MOBILITE_COG_PASSAGE
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
  # le fragment peut vivre dans le manifeste COMPLET du thème (issue #139 —
  # quatre sources) : on isole la ligne de la source avant de valider son
  # contrat — la discipline du fragment reste entière (une ligne, un id)
  if (inherits(manifest, "tbl_df") && "id" %in% names(manifest)) {
    manifest <- manifest[manifest$id == "mobilite_snapshot", ]
  }
  manquer <- function(champ, detail) {
    stop(sprintf("Contrat Mobilité snapshot violé — %s : %s.", champ, detail),
         call. = FALSE)
  }
  valeur <- function(champ) {
    x <- manifest[[champ]]
    if (is.null(x) || length(x) == 0) NA_character_ else as.character(x[1])
  }

  # UNE source, un id unique — la source absente du manifeste est nommée
  if (!inherits(manifest, "tbl_df")) {
    manquer("forme", "le manifeste doit être un tibble")
  }
  if (nrow(manifest) == 0L) {
    manquer("id", "la source 'mobilite_snapshot' est absente du manifeste")
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

# verifier_contrat_mobilite_demande_reseaux --------------------------------------
# La VALIDATION du contrat des trois sources de l'étage demande/réseaux
# (issue #139), dans le manifeste COMPLET du thème : chaque fragment est
# isolé par son id puis vérifié sur son contrat — le fichier épinglé, la
# licence, le mode et les dates. Toute violation — id absent, fichier hors
# contrat, licence non attendue, mode non attendu, dates mal formées,
# publication antérieure à la référence — échoue bruyamment en nommant le
# champ fautif. Le snapshot porté a SA propre validation
# (verifier_contrat_mobilite_snapshot) ; le manifeste réel et les fixtures
# négatives exécutent les deux.
verifier_contrat_mobilite_demande_reseaux <- function(manifest) {
  manquer <- function(champ, detail) {
    stop(sprintf("Contrat Mobilité demande/réseaux violé — %s : %s.", champ,
                 detail), call. = FALSE)
  }
  fragment <- function(id) {
    ligne <- manifest[manifest$id == id, ]
    if (nrow(ligne) != 1L) {
      manquer("id", paste0("la source '", id, "' doit porter exactement une ",
                           "ligne dans le manifeste"))
    }
    ligne
  }
  valeur <- function(ligne, champ) {
    x <- ligne[[champ]]
    if (is.null(x) || length(x) == 0) NA_character_ else as.character(x[1])
  }
  dates_iso <- function(ligne) {
    toutes <- c(valeur(ligne, "vintage"), valeur(ligne, "date_reference"),
                valeur(ligne, "date_publication"))
    if (any(is.na(toutes[1:2])) ||
        any(!grepl("^[0-9]{4}(-[0-9]{2}(-[0-9]{2})?)?$",
                   toutes[!is.na(toutes)]))) {
      manquer("dates", "vintage / date_reference / date_publication manquants ou mal formés")
    }
    if (!is.na(valeur(ligne, "date_publication")) &&
        as.Date(valeur(ligne, "date_publication")) <
        as.Date(valeur(ligne, "date_reference"))) {
      manquer("date_publication", "la publication doit être postérieure ou égale à la référence")
    }
  }

  # — rp_logement_princ : le cube RP exploitation principale épinglé (le code
  # de table LOG T12 — jamais un autre fichier MELODI du dossier complet, qui
  # ne porte pas les voitures), licence Ouverte, mode cron (fichier melodi)
  rp <- fragment("rp_logement_princ")
  if (valeur(rp, "fichier") != "DS_RP_LOGEMENT_PRINC_2023_CSV_FR.zip") {
    manquer("fichier", paste0(
      "le contrat épingle le cube DS_RP_LOGEMENT_PRINC (le code de table ",
      "LOG T12 « Équipement automobile des ménages ») — les fichiers longs ",
      "du dossier complet (DS_RP_MENAGES_COMP, DS_RP_POPULATION_PRINC) ne ",
      "portent pas les voitures"
    ))
  }
  if (valeur(rp, "licence") != "lov2") {
    manquer("licence", "licence attendue : 'lov2' (INSEE, Licence Ouverte)")
  }
  if (valeur(rp, "mode") != "cron") {
    manquer("mode", "mode attendu : 'cron' (un fichier melodi standard)")
  }
  if (valeur(rp, "vintage") != "2023") {
    manquer("vintage", "vintage attendu : '2023' (le millésime RP 2023)")
  }
  dates_iso(rp)

  # — osm_reseaux : le pbf Geofabrik Bretagne épinglé, ODbL (ADR-0001), mode
  # manuel (312 Mo, jamais un cron), et la RÉFÉRENCE est le timestamp
  # d'EXTRACTION (le vintage n'est JAMAIS « aujourd'hui » : la référence doit
  # précéder strictement la publication — l'extrait est antérieur au portage).
  # Depuis l'issue #222 (ticket #228) : la source des modes `t`/`c` (à pied /
  # voiture) SEULEMENT — le mode `b` (vélo) est alimenté par le jeu Geovelo
  # (amenagements_cyclables), le pbf reste pour t/c et le dénominateur routier
  # de la figure « L'offre cyclable ».
  osm <- fragment("osm_reseaux")
  if (valeur(osm, "fichier") != "bretagne-latest.osm.pbf") {
    manquer("fichier", paste0(
      "le contrat épingle l'extrait Geofabrik Bretagne (bretagne-latest.",
      "osm.pbf) — jamais un autre extrait"
    ))
  }
  if (valeur(osm, "licence") != "odbl") {
    manquer("licence", "licence attendue : 'odbl' (OSM, ADR-0001)")
  }
  if (valeur(osm, "mode") != "manuel") {
    manquer("mode", "mode attendu : 'manuel' (l'extrait ~312 Mo, horloge lente)")
  }
  dates_iso(osm)
  if (!grepl("^[0-9]{4}-[0-9]{2}$", valeur(osm, "vintage"))) {
    manquer("vintage", "vintage attendu : le mois d'extraction (AAAA-MM)")
  }
  if (as.Date(valeur(osm, "date_reference")) >=
      as.Date(valeur(osm, "date_publication"))) {
    manquer("date_reference", paste0(
      "la référence est le timestamp d'extraction — jamais « aujourd'hui » : ",
      "elle doit précéder strictement la publication (le portage)"
    ))
  }

  # — amenagements_cyclables : le jeu Geovelo épinglé (issue #222, ticket #228),
  # ODbL (ADR-0001), mode cron mensuel (jamais manuel — c'est le point du swap :
  # la fraîcheur mensuelle du jeu), le vintage est le MOIS du snapshot
  # (AAAA-MM, jamais « aujourd'hui »). La référence est la date du snapshot,
  # la publication sa mise en ligne.
  amen <- fragment("amenagements_cyclables")
  if (valeur(amen, "fichier") != "france-20260807.parquet") {
    manquer("fichier", paste0(
      "le contrat épingle le snapshot parquet mensuel du jeu Geovelo ",
      "(france-20260807.parquet) — jamais le geojson (~305 Mo), jamais un ",
      "autre millésime"
    ))
  }
  if (valeur(amen, "licence") != "odbl") {
    manquer("licence", "licence attendue : 'odbl' (Geovelo/OSM, ADR-0001)")
  }
  if (valeur(amen, "mode") != "cron") {
    manquer("mode", "mode attendu : 'cron' (le snapshot mensuel du jeu — le swap promet la fraîcheur mensuelle)")
  }
  dates_iso(amen)
  if (!grepl("^[0-9]{4}-[0-9]{2}$", valeur(amen, "vintage"))) {
    manquer("vintage", "vintage attendu : le mois du snapshot (AAAA-MM)")
  }
  if (as.Date(valeur(amen, "date_reference")) >
      as.Date(valeur(amen, "date_publication"))) {
    manquer("date_reference", paste0(
      "la référence est la date du snapshot, la publication sa mise en ligne — ",
      "la publication jamais antérieure à la référence"
    ))
  }

  # — communes_limites : le WFS Admin Express épinglé, Licence Ouverte
  limites <- fragment("communes_limites")
  if (valeur(limites, "fichier") != "communes_limites.geojson") {
    manquer("fichier", "le contrat épingle communes_limites.geojson (WFS Admin Express)")
  }
  if (valeur(limites, "licence") != "lov2") {
    manquer("licence", "licence attendue : 'lov2' (IGN, Licence Ouverte)")
  }
  dates_iso(limites)

  invisible(TRUE)
}

# verifier_contrat_mobilite_korrigo ---------------------------------------------
# Le contrat du fragment KORRIGO (issue #140) : UNE source — korrigo, la base
# GTFS (odbl). La DÉCISION DE SOURCE y est verrouillée : le fichier de cache
# est le zip GTFS (jamais mobibreizh-stops — le constat STAR y est documenté,
# plus une source du thème). Mode cron, type fichier, dates ISO bien formées
# (publication ≥ référence), licence odbl.
verifier_contrat_mobilite_korrigo <- function(fragment) {
  manquer <- function(champ, detail) {
    stop(sprintf("Contrat Mobilité Korrigo violé — %s : %s.", champ, detail),
         call. = FALSE)
  }
  if (!inherits(fragment, "tbl_df") || nrow(fragment) != 1L) {
    manquer("forme", "le fragment Korrigo porte UNE source (la base GTFS)")
  }
  if (fragment$id != "korrigo") {
    manquer("id", "id attendu : 'korrigo'")
  }
  if (fragment$fichier != "korrigo-gtfs.zip") {
    manquer("fichier", "fichier de cache attendu : korrigo-gtfs.zip (le zip GTFS)")
  }
  if (fragment$licence != "odbl") {
    manquer("licence", "licence attendue : 'odbl' (ADR-0001 — OSM)")
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

# verifier_contrat_mobilite_cog_passage ------------------------------------------
# Le contrat du fragment COG PASSAGE (issue #222, ticket #227) : UNE source —
# cog_passage, le zip INSEE « table_passage_annuelle_2025 » (le composant
# partagé, le même pattern que la base EPCI de Milieux). Licence Ouverte 2.0
# (lov2), vintage 2025 (le millésime), mode cron, type fichier, dates ISO bien
# formées (publication ≥ référence).
verifier_contrat_mobilite_cog_passage <- function(fragment) {
  manquer <- function(champ, detail) {
    stop(sprintf("Contrat Mobilité COG passage violé — %s : %s.", champ, detail),
         call. = FALSE)
  }
  if (!inherits(fragment, "tbl_df") || nrow(fragment) != 1L) {
    manquer("forme", "le fragment COG passage porte UNE source (la table de passage INSEE)")
  }
  if (fragment$id != "cog_passage") {
    manquer("id", "id attendu : 'cog_passage'")
  }
  if (fragment$fichier != "table_passage_annuelle_2025.zip") {
    manquer("fichier", paste0(
      "le contrat épingle le zip INSEE « table_passage_annuelle_2025 » — ",
      "jamais un autre millésime ni la table 2003-2025 (la annuelle porte la ",
      "correspondance de TOUS les codes 2022 vers le COG 2025)"
    ))
  }
  if (fragment$licence != "lov2") {
    manquer("licence", "licence attendue : 'lov2' (INSEE, Licence Ouverte)")
  }
  if (fragment$mode != "cron" || fragment$type != "fichier") {
    manquer("mode/type", "mode 'cron' et type 'fichier'")
  }
  if (fragment$vintage != "2025") {
    manquer("vintage", "vintage attendu : '2025' (le millésime COG 2025)")
  }
  if (!grepl("^[0-9]{4}-[0-9]{2}(-[0-9]{2})?$", fragment$date_reference) ||
      !grepl("^[0-9]{4}-[0-9]{2}(-[0-9]{2})?$", fragment$date_publication) ||
      as.Date(fragment$date_publication) < as.Date(fragment$date_reference)) {
    manquer("dates", "dates ISO bien formées, publication jamais antérieure à la référence")
  }
  invisible(TRUE)
}

# verifier_contrat_mobilite_batiments -------------------------------------------
# Le contrat du fragment BATIMENTS (issue #140, la correction de la méthode) :
# UNE source — batiments_residentiels, la couche BDNB portée comme le snapshot
# (mode « manuel », jamais un cron), Licence Ouverte 2.0 (lov2), son propre
# millésime (BDNB 2025-07).
verifier_contrat_mobilite_batiments <- function(fragment) {
  manquer <- function(champ, detail) {
    stop(sprintf("Contrat Mobilité Bâtiments violé — %s : %s.", champ, detail),
         call. = FALSE)
  }
  if (!inherits(fragment, "tbl_df") || nrow(fragment) != 1L) {
    manquer("forme", "le fragment Bâtiments porte UNE source")
  }
  if (fragment$id != "batiments_residentiels") {
    manquer("id", "id attendu : 'batiments_residentiels'")
  }
  if (fragment$fichier != "batiments_residentiels_bretagne.csv") {
    manquer("fichier", "fichier de cache attendu : batiments_residentiels_bretagne.csv")
  }
  if (fragment$licence != "lov2") {
    manquer("licence", "licence attendue : 'lov2' (Licence Ouverte 2.0 — BDNB, Etalab)")
  }
  if (fragment$mode != "manuel" || fragment$type != "fichier") {
    manquer("mode/type", "mode 'manuel' (portée à la main, comme le snapshot) et type 'fichier'")
  }
  if (!grepl("^[0-9]{4}-[0-9]{2}(-[0-9]{2})?$", fragment$date_reference) ||
      !grepl("^[0-9]{4}-[0-9]{2}(-[0-9]{2})?$", fragment$date_publication) ||
      as.Date(fragment$date_publication) < as.Date(fragment$date_reference)) {
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
# Le contrat du MANIFESTE CONCATÉNÉ du thème (issues #139 + #140 + #222, la
# même idée que les contrats de manifeste des fragments) : DIX lignes, dix ids
# uniques et exacts (le snapshot porté + les quatre sources de l'étage
# demande/réseaux + les quatre sources du sous-bloc + la table de passage COG
# partagée), chaque fragment passe SON contrat, les dates du manifeste sont
# bien formées (la publication jamais antérieure à la référence) et chaque id
# de la table des indicateurs du thème est couvert par une source du manifeste.
# Un manifeste corrompu — une source manquante, un id dupliqué, une licence
# hors contrat, un fragment incohérent — échoue bruyamment en nommant le champ
# fautif.
verifier_contrat_manifest_mobilite <- function(manifest) {
  manquer <- function(champ, detail) {
    stop(sprintf("Contrat Mobilité manifeste violé — %s : %s.", champ, detail),
         call. = FALSE)
  }
  if (!inherits(manifest, "tbl_df")) {
    manquer("forme", "le manifeste doit être un tibble")
  }
  if (nrow(manifest) != 11L) {
    manquer("forme", paste0("le manifeste concaténé porte ONZE sources (le ",
                            "snapshot + les quatre de l'étage demande/réseaux ",
                            "(#139) + les quatre du sous-bloc (#140) + la ",
                             "BPE B316 et la table de passage COG partagée), pas ",
                            nrow(manifest)))
  }
  if (anyDuplicated(manifest$id)) manquer("id", "id dupliqué")
  attendus <- c("mobilite_snapshot", "rp_logement_princ", "osm_reseaux",
                "amenagements_cyclables", "communes_limites", "korrigo",
                "batiments_residentiels", "bornes-recharges",
                "stationnement-velo", "bpe_b316", "cog_passage")
  if (!setequal(manifest$id, attendus)) {
    manquer("id", paste0("ids attendus : ", paste(attendus, collapse = " / ")))
  }

  # chaque fragment passe SON contrat
  verifier_contrat_mobilite_snapshot(
    manifest[manifest$id == "mobilite_snapshot", ])
  verifier_contrat_mobilite_demande_reseaux(manifest)
  verifier_contrat_mobilite_korrigo(
    manifest[manifest$id == "korrigo", ])
  verifier_contrat_mobilite_batiments(
    manifest[manifest$id == "batiments_residentiels", ])
  verifier_contrat_mobilite_bornes(
    manifest[manifest$id == "bornes-recharges", ])
  verifier_contrat_mobilite_stationnement_velo(
    manifest[manifest$id == "stationnement-velo", ])
  verifier_contrat_mobilite_bpe_b316(manifest[manifest$id == "bpe_b316", ])
  verifier_contrat_mobilite_cog_passage(
    manifest[manifest$id == "cog_passage", ])

  # les dates de tout le manifeste — ISO, publication jamais antérieure à la
  # référence (l'horloge lente du snapshot et les vintages du sous-bloc). La
  # publication NA (communes_limites — le WFS n'expose pas de date) est un cas
  # légitime : seules les publications RENSEIGNÉES doivent précéder ou égaler
  # la référence.
  if (any(!grepl("^[0-9]{4}-[0-9]{2}(-[0-9]{2})?$",
                 manifest$date_reference)) ||
      any(!is.na(manifest$date_publication) &
          !grepl("^[0-9]{4}-[0-9]{2}(-[0-9]{2})?$",
                 manifest$date_publication)) ||
      any(!is.na(manifest$date_publication) &
          as.Date(manifest$date_publication) < as.Date(manifest$date_reference))) {
    manquer("dates", "dates ISO bien formées, publication jamais antérieure à la référence")
  }

  invisible(TRUE)
}
