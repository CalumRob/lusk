# theme_mobilite ---------------------------------------------------------------
# Le module du thème Mobilité (issues #137/#138/#139/#140 + #1048) : le
# descripteur theme_mobilite() que la machinerie partagée consomme sans jamais
# nommer le thème. Depuis #1048, le snapshot porté et la couche bâtiments BDNB
# ont été retirés : Offre TC est calculée sur le spine d'adresses résidentielles
# AEDAR, le poids du thème est le nombre d'adresses, les 29 clés du snapshot et
# ses deux histoires disparaissent du payload. Les 17 clés retenues (demande,
# réseaux, offre, stationnement, ravitaillement, raccordement) restent publiées.

# Ce qui N'y vit PAS : aucun calcul d'indicateur de la grille (la matière
# analytique est au ticket #138, l'assemblage des clés au #141 — les parts
# d'isolation sont CALCULÉES par le chaînon et ASSEMBLÉES ici), aucune
# modification de theme_demographie / theme_economie / theme_habitat ni du
# cœur partagé (compute.R, publish.R).

# construire_donnees_mobilite --------------------------------------------------
# L'acte « trouver la donnée » du thème (issue #1048) : le snapshot porté et la
# couche bâtiments BDNB ont été retirés. Le spine d'adresses résidentielles AEDAR
# est lu par construire_sources_offre_mobilite (AEDAR_ADDRESS_ORIGIN_FILE) ; il
# fournit la population du calcul Offre TC et le poids du thème. L'étage
# demande/réseaux garde ses sources (RP voitures, OSM t/c, Geovelo b, limites,
# OCS-GE routier, BPE B316, IRVE, hub vélo, parkings OSM). Aucun artefact
# mobilite_snapshot.rds n'est écrit. Le paramètre `sources` permet aux tests de
# passer les fixtures directement — le même chemin de code qu'en production.
construire_donnees_mobilite <- function(cache = "data/raw",
                                        sortie = "data/processed/mobilite",
                                        sources = NULL) {
  fichier_source <- function(id) {
    MANIFEST_MOBILITE$fichier[MANIFEST_MOBILITE$id == id]
  }

  voitures <- lire_voitures_communes(
    file.path(cache, fichier_source("rp_logement_princ"))
  )
  limites <- lire_communes_limites(
    file.path(cache, fichier_source("communes_limites"))
  )
  ocsge_reseaux_routiers <- construire_donnees_ocsge_reseaux_routiers(
    cache = cache,
    manifest = MANIFEST_MOBILITE
  )
  lignes <- lire_lignes_osm(
    file.path(cache, fichier_source("osm_reseaux"))
  )
  # le mode `b` (ADR-0016) : la table Geovelo normalisée via l'orchestrateur —
  # la table de passage COG vient du zip du cache, le dernier bon vit dans le
  # dossier processed du thème
  if (!dir.exists(sortie)) dir.create(sortie, recursive = TRUE)
  amenagements <- construire_amenagements_cyclables(
    file.path(cache, fichier_source("amenagements_cyclables")),
    sortie = file.path(sortie, "amenagements_dernier_bon.rds"),
    vintage = MANIFEST_MOBILITE$date_reference[
      MANIFEST_MOBILITE$id == "amenagements_cyclables"],
    mappe = construire_mappe_cog_bretagne(
      file.path(cache, fichier_source("cog_passage"))
    )
  )
  if (is.null(sources)) {
    sources <- construire_sources_offre_mobilite(cache)
    if (is.null(sources$parkings_osm))
      sources$parkings_osm <- lire_parkings_osm(file.path(cache, fichier_source("osm_reseaux")))
    if (is.null(sources$stations_service))
      sources$stations_service <- normaliser_bpe_b316(
        lire_bpe_b316(file.path(cache, fichier_source("bpe_b316"))))
  }

  c(list(
    voitures_communes = voitures,
    communes_limites = limites,
    lignes_osm = lignes,
    ocsge_reseaux_routiers = ocsge_reseaux_routiers,
    parkings_osm = sources$parkings_osm,
    stations_service = sources$stations_service,
    amenagements_cyclables = amenagements$table,
    # le diagnostic de couverture du snapshot Geovelo — la matière du run report
    couverture = amenagements$couverture
  ), sources[setdiff(names(sources), c("parkings_osm", "stations_service"))])
}

# VINTAGES_RACCORDEMENT -----------------------------------------------------------
# Les DEUX faits de vintage CONSTRUITS du raccordement (issue #486) : la
# matrice temps figée et la population RP 2023 épinglées sous inst/extdata ne
# sont PAS des sources téléchargées — elles n'ont pas de ligne de manifeste —
# mais ce sont des données VERSIONNÉES (la recette figée et les empreintes
# sha256 d'artefact_raccordement.R / calcul_raccordement.R). Leurs lignes
# voyagent dans la table des vintages du thème : l'estampillage des clés du
# raccordement passe par la jointure source_reference standard, la validation
# des métadonnées les retrouve, et la table partagée (fusionner_vintages) les
# publie à Sources comme toute autre fraîcheur.
VINTAGES_RACCORDEMENT <- tibble::tribble(
  ~id, ~source, ~version, ~licence, ~date_reference, ~date_publication,
  "matrice_temps_mairies",
  paste0("Lusk — matrice temps mairie à mairie figée du raccordement ",
         "(routage r5r sur SNCF Voyageurs national 2026-08-24 + ",
         "KorrigoBret v80335, mercredi réel de période scolaire 2026-09-16, ",
         "meilleur départ p01 — recherche raccordement, issue #485)"),
  "2026-09-16", "odbl", "2026-08-25", "2026-08-26",
  "population_raccordement",
  paste0("INSEE — Recensement de la population 2023 : la population totale ",
         "des 1 202 communes bretonnes COG 2025 (le dénominateur W = ",
         "3 449 370), transcription épinglée du run de recherche vérifié ",
         "(calcul_raccordement.R, issue #486)"),
  "2023", "lov2", "2023-01-01", "2026-08-26"
  ,"raccordement_gtfs_national",
  paste0("Lusk — matrice nationale GTFS de raccordement, trajets planifiés ",
    "aller simples par arrêts communaux (Korrigo v80630 + SNCF national ",
    "acquis le 2026-10-10 ; mesure le 2026-10-21)"),
  "2026-10-21", "odbl", "2026-10-10", "2026-10-10"
)

# VINTAGES_MOBILITE_OCSGE_RESEAUX -----------------------------------------------
# Les quatre états départementaux sont des entrées techniques du manifeste
# (pour le téléchargement) mais forment une seule source éditoriale pour la
# clé `surface_reseaux_routiers`. La version porte explicitement la fenêtre
# couverte : les millésimes les plus récents disponibles pour les quatre
# départements bretons.
VINTAGES_MOBILITE_OCSGE_RESEAUX <- tibble::tribble(
  ~id, ~source, ~version, ~licence, ~date_reference, ~date_publication,
  "ocsge_reseaux_routiers",
  "IGN — OCS GE v2.0 (Nouvelle Génération) — occupation du sol et usage des réseaux routiers en Bretagne",
  "2023–2025", "lov2", "2023-01-01", "2026-07-03"
)

# VINTAGE_MOBILITE_SNAPSHOT_RETRAITE — slice 2 (#1048) ---------------------------
# Le snapshot a été retiré du manifeste et de la chaîne de calcul (#1048). Sa
# ligne de vintage subsiste TEMPORAIREMENT : le catalogue épinglé
# (theme_mobilite.json — slice 2) cite encore `mobilite_snapshot` comme source
# de référence des clés retirées, et la validation croisée exige un vintage par
# source déclarée. Le slice 2 retire ces références ; la ligne part avec elles.
VINTAGES_MOBILITE_SNAPSHOT_RETRAITE <- tibble::tibble(
  id = "mobilite_snapshot",
  source = paste0("Lusk — analyse d'accessibilité « Vingt minutes sans voiture » ",
                  "(source retirée, #1048)"),
  version = "2026-02", licence = "odbl",
  date_reference = "2026-02-28", date_publication = "2026-08-06"
)

# vintages_mobilite ------------------------------------------------------------
# Le builder de vintages du thème : la projection générique depuis le
# manifeste — une source, SA référence et SA publication, jamais alignées.
# Les fragments snapshot et bâtiments ont été retirés en #1048. Depuis
# l'issue #486, les DEUX faits construits du raccordement voyagent à leurs
# côtés.
vintages_mobilite <- function() {
  ids_techniques <- IDS_OCSGE_RESEAUX
  dplyr::bind_rows(
    vintages_depuis_manifest(
      MANIFEST_MOBILITE[
        !MANIFEST_MOBILITE$id %in% ids_techniques,
        , drop = FALSE
      ]
    ),
    VINTAGES_MOBILITE_SNAPSHOT_RETRAITE,
    VINTAGES_RACCORDEMENT,
    VINTAGES_MOBILITE_OCSGE_RESEAUX
  )
}

# construire_analytiques_mobilite ----------------------------------------------
# LE seam de calcul : le poids du thème (le nombre d'adresses résidentielles du
# spine AEDAR, par commune) et le SEUL chaînage retenu après #1048 :
#   - l'étage demande/réseaux (voitures/ménage, réseaux t/b/c, densités, OCS-GE) ;
#   - le sous-bloc « L'offre de mobilité alternative » : offre_tc (la vraie part
#     des adresses à 500 m d'un arrêt GTFS), bornes IRVE, stationnement vélo,
#     densités de ravitaillement ; la figure « L'offre cyclable » ;
#   - le raccordement (computé à part, injecté à la publication).
# La chaîne du snapshot porté (accès/isolation, div/tot loss, saillance,
# densité, nuage, moyennes, rangs) a été retirée : aucun artefact correspondant
# n'est calculé ni persisté. Tous les artefacts retenus sont persistés sous
# `sortie` — la matière que le payload assemble.
construire_analytiques_mobilite <- function(donnees, base_epci,
                                            sortie = "data/processed/mobilite",
                                            classes_densite = NULL,
                                            noms_epci_geo_api = NULL) {
  # le poids du thème : le nombre d'adresses du spine par commune (le
  # dénominateur de l'offre TC et la pluralité départementale des EPCI)
  adresses <- donnees$adresses_residentielles
  mobilite_communes <- sf::st_drop_geometry(adresses) %>%
    dplyr::group_by(commune = code_commune_insee) %>%
    dplyr::summarise(n_adresses = dplyr::n(), .groups = "drop") %>%
    dplyr::arrange(commune)

  territoires <- construire_territoires_mobilite(
    base_epci, list(mobilite_communes = mobilite_communes),
    noms_epci_geo_api = noms_epci_geo_api,
    classes_densite = classes_densite
  )

  # l'étage demande/réseaux : la demande (voitures/ménage — la moyenne pondérée
  # par les ménages) et les réseaux t/c (OSM) + b (le jeu Geovelo).
  voitures_communes <- calculer_voitures_communes(donnees$voitures_communes)
  voitures_territoires <- agreger_voitures_territoires(voitures_communes,
                                                       base_epci)
  reseaux_communes <- fusionner_reseaux_velo_communes(
    calculer_reseaux_communes(donnees$lignes_osm, donnees$communes_limites),
    calculer_reseaux_velo_communes(donnees$amenagements_cyclables,
                                   donnees$communes_limites)
  )
  reseaux_territoires <- agreger_reseaux_territoires(reseaux_communes,
                                                     base_epci)
  stationnement_velo_communes <- calculer_stationnement_velo_communes(
    donnees$stationnement_velo
  )
  reseaux_par_habitant_territoires <-
    agreger_reseaux_par_habitant_territoires(
      reseaux_communes,
      stationnement_velo_communes[c("commune", "population")],
      base_epci
    )
  surface_reseaux_routiers_communes <-
    calculer_surface_reseaux_routiers_communes(
      donnees$ocsge_reseaux_routiers,
      donnees$communes_limites
    )
  surface_reseaux_routiers_territoires <-
    agreger_surface_reseaux_routiers_territoires(
      surface_reseaux_routiers_communes,
      base_epci
    )

  # le sous-bloc et la figure cyclable : l'offre TC (la VRAIE part des adresses
  # à 500 m d'un arrêt), les bornes, le stationnement vélo, l'offre cyclable.
  offre_tc_communes <- calculer_part_proches_arret_communes(
    donnees$korrigo, adresses
  )
  bornes_communes <- calculer_bornes_communes(donnees$bornes_recharges,
                                              base_epci)
  offre_cyclable_communes <- calculer_offre_cyclable_communes(
    donnees$amenagements_cyclables,
    stationnement_velo_communes[c("commune", "population")]
  )
  stationnement_voiture_communes <- NULL
  if (all(c("parkings_osm", "lignes_osm", "communes_limites") %in% names(donnees))) {
    stationnement_voiture_communes <- calculer_stationnement_voiture_communes(
      donnees$parkings_osm, donnees$lignes_osm, donnees$communes_limites)
  }
  fuel_communes <- if ("stations_service" %in% names(donnees))
    calculer_fuel_communes(donnees$stations_service) else NULL
  if (is.null(stationnement_voiture_communes) && is.null(fuel_communes)) {
    offre_territoires <- agreger_offre_territoires(
      offre_tc_communes, bornes_communes, stationnement_velo_communes,
      base_epci, offre_cyclable_communes)
  } else {
    offre_territoires <- agreger_offre_territoires(
      offre_tc_communes, bornes_communes, stationnement_velo_communes,
      base_epci, offre_cyclable_communes, stationnement_voiture_communes,
      fuel_communes)
  }

  if (!dir.exists(sortie)) dir.create(sortie, recursive = TRUE)
  readr::write_rds(mobilite_communes, file.path(sortie, "mobilite_communes.rds"))
  readr::write_rds(voitures_communes,
                   file.path(sortie, "voitures_communes.rds"))
  readr::write_rds(voitures_territoires,
                   file.path(sortie, "voitures_territoires.rds"))
  readr::write_rds(reseaux_communes,
                   file.path(sortie, "reseaux_communes.rds"))
  readr::write_rds(reseaux_territoires,
                   file.path(sortie, "reseaux_territoires.rds"))
  readr::write_rds(reseaux_par_habitant_territoires,
                   file.path(sortie, "reseaux_par_habitant_territoires.rds"))
  readr::write_rds(surface_reseaux_routiers_communes,
                   file.path(sortie, "surface_reseaux_routiers_communes.rds"))
  readr::write_rds(surface_reseaux_routiers_territoires,
                   file.path(sortie, "surface_reseaux_routiers_territoires.rds"))
  readr::write_rds(offre_tc_communes,
                   file.path(sortie, "offre_tc_communes.rds"))
  readr::write_rds(bornes_communes,
                   file.path(sortie, "bornes_communes.rds"))
  readr::write_rds(stationnement_velo_communes,
                   file.path(sortie, "stationnement_velo_communes.rds"))
  readr::write_rds(offre_cyclable_communes,
                   file.path(sortie, "offre_cyclable_communes.rds"))
  readr::write_rds(offre_territoires,
                   file.path(sortie, "offre_territoires.rds"))

  list(
    mobilite_communes = mobilite_communes,
    voitures_communes = voitures_communes,
    voitures_territoires = voitures_territoires,
    reseaux_communes = reseaux_communes,
    reseaux_territoires = reseaux_territoires,
    reseaux_par_habitant_territoires = reseaux_par_habitant_territoires,
    surface_reseaux_routiers_communes = surface_reseaux_routiers_communes,
    surface_reseaux_routiers_territoires = surface_reseaux_routiers_territoires,
    offre_tc_communes = offre_tc_communes,
    bornes_communes = bornes_communes,
    stationnement_velo_communes = stationnement_velo_communes,
    offre_cyclable_communes = offre_cyclable_communes,
    offre_territoires = offre_territoires
  )
}

# INDICATEURS_MOBILITE ---------------------------------------------------------
# La table déclarative des DIX-SEPT indicateurs retenus du thème (issue #1048) :
# les 29 clés du snapshot porté (tot_loss, avg_*, iso_*, share_*, nb_buildings)
# ont été retirées, ainsi que leurs rangs et leurs estampilles. Chaque clé garde
# sa source de référence pour l'estampillage T7 ; `offre_tc` est désormais porté
# par la base GTFS Korrigo, son dénominateur étant le spine d'adresses AEDAR.
INDICATEURS_MOBILITE <- tibble::tibble(
  key = c("voitures_menage", "reseaux", "reseaux_par_habitant",
          "surface_reseaux_routiers", "offre_tc", "bornes_recharge",
          "places_stationnement_velo_1000",
          "places_stationnement_voiture_1000", "bornes_ev_par_station_service",
          "stationnement_velo_par_voiture",
          "stations_service", "stations_service_1000", "bornes_recharge_1000",
          "offre_cyclable",
          "raccordement_tc", "raccordement_courbe", "raccordement_reference"),
  libelle = c(
     "Voitures par ménage",
     "Réseaux à pied / vélo / voiture",
     "Longueur du réseau par habitant",
     "Part du territoire consacré aux réseaux routiers",
    "Part des bâtiments près d’un arrêt (à 500 m)",
    "Bornes de recharge pour véhicules électriques",
    "Places de stationnement vélo pour 1 000 hab.",
     "Places de stationnement voiture pour 1 000 hab.",
     "Bornes de recharge par station-service",
     "Places de stationnement vélo pour 1 place voiture",
     "Stations-service",
     "Stations-service pour 1 000 hab.",
     "Bornes de recharge pour 1 000 hab.",
     "L’offre cyclable",
     "Population bretonne jointe en 90 minutes en transports en commun",
     "Courbe de population bretonne jointe selon le temps de trajet",
     "Moyenne de Bretagne — communes évaluées"
  ),
  sources = list(
     "rp_logement_princ",
     c("amenagements_cyclables", "osm_reseaux", "communes_limites"),
     c("amenagements_cyclables", "osm_reseaux", "stationnement-velo"),
     "ocsge_reseaux_routiers",
    "korrigo",
    "bornes-recharges",
    "stationnement-velo",
     "osm_reseaux", c("bornes-recharges", "bpe_b316"),
      c("stationnement-velo", "osm_reseaux"),
      "bpe_b316", "bpe_b316", "bornes-recharges",
     c("amenagements_cyclables", "osm_reseaux", "stationnement-velo"),
       "raccordement_gtfs_national", "raccordement_gtfs_national",
       "raccordement_gtfs_national"
  ),
  source_reference = c("rp_logement_princ", "amenagements_cyclables",
                       "osm_reseaux", "ocsge_reseaux_routiers", "korrigo",
                       "bornes-recharges", "stationnement-velo", "osm_reseaux",
                       "bpe_b316", "osm_reseaux", "bpe_b316", "bpe_b316",
                       "bornes-recharges", "osm_reseaux",
                       "raccordement_gtfs_national", "raccordement_gtfs_national",
                       "raccordement_gtfs_national"),
  multiplicite = c(3L, 3L, 3L, 1L, 1L, 1L, 1L, 1L, 1L, 1L, 1L, 1L, 1L, 5L,
                   1L, length(grille_raccordement_national()), NA_integer_)
)

# APERCU_MOBILITE ---------------------------------------------------------------
# La table déclarative des clés de l'Aperçu du thème (issue #32, ADR-0007) :
# VIDE — le gating par thème. Mobilité ne déclare aucune clé aujourd'hui : la
# table `apercu` du payload d'un run Mobilité est présente mais vide (jamais
# un « under construction »).
APERCU_MOBILITE <- tibble::tibble(
  key = character(),
  libelle = character(),
  multiplicite = integer()
)

# construire_territoires_mobilite ----------------------------------------------
# La table des territoires du thème : le squelette PARTAGÉ (squelette_territoires,
# compute.R) — communes/EPCIs/départements/région avec les noms réels de la
# base des EPCI (lire_epci), la règle de pluralité départementale — avec le
# POIDS du thème : le nombre d'adresses résidentielles du spine par commune (n_adresses du
# snapshot porté — la mesure signature de l'analyse d'accessibilité).
construire_territoires_mobilite <- function(base_epci, analytiques,
                                            noms_epci_geo_api = NULL,
                                            classes_densite = NULL,
                                            classes_littoral = NULL) {
  poids <- analytiques$mobilite_communes %>%
    dplyr::select(commune, n_adresses)
  communes <- base_epci %>%
    dplyr::transmute(
      code = CODGEO, nom = LIBGEO, departement = DEP,
      epci = EPCI, nom_epci = LIBEPCI
    ) %>%
    dplyr::left_join(poids, by = c("code" = "commune")) %>%
    dplyr::mutate(n_adresses = dplyr::coalesce(n_adresses, 0))
  territoires <- squelette_territoires(
    communes,
    poids = "n_adresses",
    noms_epci_geo_api = noms_epci_geo_api
  )
  appliquer_classifications_communales(
    territoires,
    classes_densite = classes_densite,
    classes_littoral = classes_littoral
  )
}

# aligner_indicateur_mobilite ---------------------------------------------------
# L'alignement d'une agrégation scalaire sur le squelette des territoires : une
# ligne par territoire (NA si la donnée manque — jamais une ligne absente),
# avec la clé, l'unité et le rider éventuel. Extrait de
# construire_indicateurs_mobilite pour être PARTAGÉ avec la matérialisation
# scalaire ciblée (#989) : une seule règle de forme.
aligner_indicateur_mobilite <- function(territoires, table_agregee, key, unit) {
  if (!"rider" %in% names(table_agregee)) table_agregee$rider <- NA_character_
  dplyr::left_join(territoires["code"], table_agregee, by = "code") %>%
    dplyr::transmute(
      code = code, key = key, detail = NA_character_,
      value = value, unit = unit, rider = rider
    )
}

# assembler_indicateurs_mobilite ------------------------------------------------
# L'assemblage final des indicateurs du thème : les lignes alignées + leurs
# rangs + le type de territoire + les estampilles de vintage. Extrait de
# construire_indicateurs_mobilite pour être PARTAGÉ avec la matérialisation
# scalaire ciblée (#989) — le même code produit la ligne complète et la ligne
# ciblée, jamais deux assemblages.
assembler_indicateurs_mobilite <- function(lignes, rangs_combines, territoires,
                                           vintages) {
  tampons <- INDICATEURS_MOBILITE %>%
    dplyr::select(key, source_reference) %>%
    dplyr::left_join(vintages, by = c("source_reference" = "id")) %>%
    dplyr::select(key,
                  vintage_source = source,
                  vintage_version = version,
                  vintage_date_reference = date_reference,
                  vintage_date_publication = date_publication)

  lignes %>%
    dplyr::left_join(rangs_combines, by = c("code", "key", "detail")) %>%
    dplyr::left_join(territoires[c("code", "type")], by = "code") %>%
    dplyr::rename(territoire = code) %>%
    dplyr::mutate(theme = "mobilite") %>%
    dplyr::left_join(tampons, by = "key") %>%
    dplyr::select(dplyr::any_of(c(
      "territoire", "type", "theme", "key", "detail", "value", "unit",
      "rang_epci", "rang_dep", "rang_reg",
      "rang_epci_n", "rang_dep_n", "rang_reg_n",
      "vintage_source", "vintage_version",
       "vintage_date_reference", "vintage_date_publication", "rider",
       "observation_period"
    )))
}

# construire_indicateurs_mobilite ----------------------------------------------
# Les DIX-SEPT indicateurs publiés du thème, alignés sur le squelette des
# territoires (une ligne par territoire, NA si la donnée manque), avec leurs
# rangs et leurs estampilles T7 (la machinerie partagée compute_ranks). Les clés
# multi-mesures (voitures_menage, reseaux, reseaux_par_habitant, offre_cyclable)
# portent un rang PAR DÉTAIL. Le raccordement garde ses trois clés. Aucune clé
# du snapshot retiré n'est assemblée.
construire_indicateurs_mobilite <- function(analytiques, territoires, vintages,
                                            directions = DIRECTIONS_MOBILITE) {
  # LE RACCORDEMENT : les artefacts calculés doivent être là — un absent nomme
  # la chaîne à lancer, jamais un payload amputé en silence.
  if (is.null(analytiques$raccordement)) {
    stop("construire_indicateurs_mobilite : les artefacts du raccordement ",
         "(issue #486) sont absents des analytiques — lancez le calcul ",
         "(preparer_raccordement / la cible raccordement_mobilite du graphe).",
         call. = FALSE)
  }
  racc <- analytiques$raccordement
  grille <- grille_raccordement_national()
  calcul_racc <- racc$calculation
  if (is.null(calcul_racc)) {
    stop("Le calcul national versionné du raccordement est absent.", call. = FALSE)
  }
  scalar_to_legacy_shape <- function(level) {
    rows <- calcul_racc$aggregate_scalars[calcul_racc$aggregate_scalars$level == level, , drop = FALSE]
    tibble::tibble(code = rows$group_code, part_90 = rows$share_mean_90,
      couverture = 1, complete = rows$assessment_complete,
      communes_attendues = rows$members_expected,
      communes_disponibles = rows$members_assessed)
  }

  aligner <- function(table_agregee, key, unit) {
    aligner_indicateur_mobilite(territoires, table_agregee, key, unit)
  }
  sous_bloc <- function(key) {
    dplyr::left_join(
      territoires["code"],
      analytiques$offre_territoires %>%
        dplyr::filter(key == !!key) %>%
        dplyr::select(code, value),
      by = "code"
    )
  }

  tables <- list(
    offre_tc = aligner(sous_bloc("offre_tc"), "offre_tc", "%"),
    bornes_recharge = aligner(sous_bloc("bornes_recharge"),
                              "bornes_recharge", "bornes"),
    places_stationnement_velo_1000 = aligner(
      sous_bloc("places_stationnement_velo_1000"),
      "places_stationnement_velo_1000", "places / 1 000 hab")
    ,places_stationnement_voiture_1000 = aligner(
      sous_bloc("places_stationnement_voiture_1000"),
      "places_stationnement_voiture_1000", "places / 1 000 hab")
     ,bornes_ev_par_station_service = aligner(
       analytiques$offre_territoires %>% dplyr::filter(key == "bornes_ev_par_station_service") %>%
         dplyr::select(dplyr::any_of(c("code", "value", "rider"))),
       "bornes_ev_par_station_service", "bornes / station")
    ,stations_service = aligner(
      sous_bloc("stations_service"), "stations_service", "stations")
    ,stations_service_1000 = aligner(
      sous_bloc("stations_service_1000"), "stations_service_1000",
      "stations / 1 000 hab")
    ,bornes_recharge_1000 = aligner(
      sous_bloc("bornes_recharge_1000"), "bornes_recharge_1000",
      "bornes / 1 000 hab")
    ,stationnement_velo_par_voiture = aligner(
        sous_bloc("stationnement_velo_par_voiture"),
        "stationnement_velo_par_voiture", "places vélo / place voiture")
    ,surface_reseaux_routiers = aligner(
      analytiques$surface_reseaux_routiers_territoires,
      "surface_reseaux_routiers", "%")
  )

  # Scalar@90 is the same point as the complete outbound curve. Proven model
  # zeros remain measured zero facts and carry their assessment reason.
  racc_scalaire <- dplyr::bind_rows(
    calcul_racc$commune_scalars %>%
      dplyr::transmute(code = code, value = share_90,
        rider = structural_zero_reason),
    scalar_to_legacy_shape("epci") %>%
      dplyr::transmute(code = code, value = part_90, rider = NA_character_),
    scalar_to_legacy_shape("department") %>%
      dplyr::transmute(code = code, value = part_90, rider = NA_character_),
    scalar_to_legacy_shape("region") %>%
      dplyr::transmute(code = code, value = part_90, rider = NA_character_)
  )
  tables$raccordement_tc <- aligner(racc_scalaire, "raccordement_tc", "%")
  rangs <- compute_ranks(territoires, tables, scalaires = list(),
                         directions = directions)

  # les clés multi-mesures : le squelette (territoire × détail) étend la table
  # agrégée — chaque territoire porte TOUTES les mesures, NA si la donnée
  # manque (la multiplicité de la table déclarative).
  aligner_detail <- function(table_long, key, unites) {
    details <- names(unites)
    squelette_detail <- tidyr::crossing(code = territoires$code, detail = details)
    dplyr::left_join(squelette_detail, table_long, by = c("code", "detail")) %>%
      dplyr::mutate(key = key, unit = unites[detail]) %>%
      dplyr::select(code, key, detail, value, unit)
  }
  voitures <- aligner_detail(
    analytiques$voitures_territoires, "voitures_menage",
    c(sans_voiture = "%", une_voiture = "%", deux_plus = "%")
  )
  reseaux <- aligner_detail(
    analytiques$reseaux_territoires, "reseaux",
    c(t_longueur = "km", b_longueur = "km", c_longueur = "km")
  )
  reseaux_par_habitant <- aligner_detail(
    analytiques$reseaux_par_habitant_territoires, "reseaux_par_habitant",
    c(t_km_1000 = "km / 1 000 hab.", b_km_1000 = "km / 1 000 hab.",
      c_km_1000 = "km / 1 000 hab.")
  )
  offre_cyclable <- aligner_detail(
    analytiques$offre_territoires %>%
      dplyr::filter(key == "offre_cyclable"),
    "offre_cyclable",
    c(protege_longueur = "km", protege_km_1000 = "km / 1 000 hab",
      partage_longueur = "km", partage_km_1000 = "km / 1 000 hab",
      total_longueur = "km")
  )

  # le rang PAR DÉTAIL : chaque mesure est classée dans SON groupe de
  # comparaison (la machinerie partagée, jamais re-forkée).
  rangs_voitures <- construire_rangs_detail(
    analytiques$voitures_territoires, territoires
  )
  rangs_reseaux <- construire_rangs_detail(
    analytiques$reseaux_territoires, territoires
  )
  rangs_reseaux_par_habitant <- construire_rangs_detail(
    analytiques$reseaux_par_habitant_territoires, territoires
  )
  rangs_offre_cyclable <- construire_rangs_detail(
    analytiques$offre_territoires %>%
      dplyr::filter(key == "offre_cyclable"),
    territoires
  )

  # la grille nationale complète aux quatre niveaux : 73 points par territoire.
  raccordement_lignes <- lignes_indicateurs_raccordement_national(
    calcul_racc, vintages)
  raccordement_courbe <- raccordement_lignes %>%
    dplyr::filter(key == "raccordement_courbe") %>%
    dplyr::select(code, key, detail, value, unit, rider, observation_period)
  raccordement_reference <- raccordement_lignes %>%
    dplyr::filter(key == "raccordement_reference") %>%
    dplyr::select(code, key, detail, value, unit, rider, observation_period)

  rangs_combines <- dplyr::bind_rows(
    dplyr::bind_rows(lapply(rangs, function(rang) {
      rang %>% dplyr::mutate(detail = NA_character_)
    })),
    rangs_voitures,
    rangs_reseaux,
    rangs_reseaux_par_habitant,
    rangs_offre_cyclable
  )

  assembler_indicateurs_mobilite(
    dplyr::bind_rows(
       tables$offre_tc,
       tables$bornes_recharge,
       tables$places_stationnement_velo_1000,
       tables$places_stationnement_voiture_1000,
       tables$bornes_ev_par_station_service,
       tables$stationnement_velo_par_voiture,
       tables$surface_reseaux_routiers,
       tables$stations_service,
       tables$stations_service_1000,
       tables$bornes_recharge_1000,
       voitures,
       reseaux,
       reseaux_par_habitant,
       offre_cyclable,
       tables$raccordement_tc,
       raccordement_courbe,
       raccordement_reference
    ),
    rangs_combines,
    territoires,
    vintages
  )
}

# construire_rangs_detail --------------------------------------------------------
# Les rangs-en-contexte PAR DÉTAIL d'une table longue multi-mesures (les clés
# voitures_menage / reseaux / offre_cyclable de l'étage demande/réseaux,
# issue #139/#231) : chaque mesure est classée dans SON groupe de comparaison
# (commune → les communes de son EPCI, ou les communes de la région sans EPCI ;
# EPCI → tous les EPCIs bretons ; département → les départements — ADR-0021)
# avec la MACHINERIE PARTAGÉE rang_ordinal_par_groupe (compute.R) — l'ordinal
# directionnel « Xᵉ / Y » (ADR-0015), les NA exclus du dénominateur. Depuis
# l'audit ordinal de l'issue #368, AUCUN détail ne se repose sur le défaut
# high-is-good : la direction de SA clé (la déclaration DIRECTIONS_MOBILITE —
# high-is-good par design pour les trois clés multi-mesures : plus de mesure,
# mieux) est passée à chaque rang_ordinal_par_groupe. `territoires` est le
# squelette partagé du thème (la forme de construire_territoires_mobilite).
# Sortie longue (code × key × detail × les trois rangs et leurs tailles),
# triée par code puis détail — déterministe.
construire_rangs_detail <- function(table_long, territoires,
                                    directions = DIRECTIONS_MOBILITE) {
  groupes <- groupes_comparaison(territoires)
  tab <- dplyr::left_join(
    territoires[c("code", "type", "epci", "departement")],
    table_long,
    by = "code"
  )

  groupes_detail <- unique(tab[c("key", "detail")])
  groupes_detail <- groupes_detail[order(groupes_detail$key,
                                         groupes_detail$detail,
                                         na.last = TRUE), , drop = FALSE]
  dplyr::bind_rows(lapply(seq_len(nrow(groupes_detail)), function(i) {
    cle <- groupes_detail$key[[i]]
    detail <- groupes_detail$detail[[i]]
    lignes <- tab[tab$key == cle & (is.na(tab$detail) == is.na(detail)) &
                    (is.na(detail) | tab$detail == detail), , drop = FALSE]
    # la direction DÉCLARÉE de la clé (issue #368 — aucune clé ne se repose sur
    # le défaut high-is-good de rang_ordinal_par_groupe) ; une clé sans
    # déclaration est une erreur de descripteur, jamais un défaut silencieux
    if (!cle %in% names(directions)) {
      stop("construire_rangs_detail : la clé « ", cle,
           " » n'a pas de direction déclarée (DIRECTIONS_MOBILITE).",
           call. = FALSE)
    }
    tibble::tibble(
      code = lignes$code,
      key = cle,
      detail = detail,
      rang_epci = rang_ordinal_par_groupe(lignes$value, groupes$epci,
                                          direction = directions[[cle]]),
      rang_epci_n = taille_groupe(lignes$value, groupes$epci),
      rang_dep = rang_ordinal_par_groupe(lignes$value, groupes$dep,
                                         direction = directions[[cle]]),
      rang_dep_n = taille_groupe(lignes$value, groupes$dep),
      rang_reg = rang_ordinal_par_groupe(lignes$value, groupes$reg,
                                         direction = directions[[cle]]),
      rang_reg_n = taille_groupe(lignes$value, groupes$reg)
    )
  })) %>%
    dplyr::arrange(code, detail)
}

# compute_histoires_mobilite ---------------------------------------------------
# Le thème Mobilité ne porte plus de lecture (issue #1048) : la table des
# histoires candidates est VIDE, comme pour Programmes. Les deux story keys
# « vingt-minutes-sans-voiture » et « ce-que-le-velo-preserve » et le champ
# classification_saillance disparaissent du payload.
compute_histoires_mobilite <- function(analytiques, vintages) {
  data.frame(
    territoire = character(), type = character(), theme = character(),
    story_key = character(), stringsAsFactors = FALSE
  )
}

# construire_apercu_mobilite ---------------------------------------------------
# Les stats de base de l'onglet Aperçu (ADR-0007) : AUCUNE aujourd'hui — le
# gating par thème (APERCU_MOBILITE vide). Retourne la liste vide ; la table
# `apercu` du payload reste présente et vide (la forme du contrat).
construire_apercu_mobilite <- function(territoires) {
  list()
}

# validations_mobilite ---------------------------------------------------------
# Les vérifications de valeur propres au thème (point 7) : déclarées ici,
# exécutées par validate_payload() après ses vérifications génériques.
validations_mobilite <- list(
  # les parts voitures/ménage sont des parts dans [0, 1] (une part hors de la
  # borne est une corruption — un ratio RP qui déraille, jamais un NA)
  function(payload) {
    voitures <- payload$indicateurs$value[
      payload$indicateurs$key == "voitures_menage"]
    if (any(!is.na(voitures) & (voitures < 0 | voitures > 1))) {
      stop("Payload invalide : une part voitures/ménage sort de [0, 1].",
           call. = FALSE)
    }
    invisible(payload)
  },
  # les TROIS parts voitures/ménage (0 / 1 / 2+) SOMMENT à 1 par territoire
  # (issue #368 — la dimension CARS partitionne les ménages : C0 + C1 + C_GE2
  # = _T ; un total qui déraille est une corruption)
  function(payload) {
    parts <- stats::aggregate(
      value ~ territoire,
      payload$indicateurs[payload$indicateurs$key == "voitures_menage", ],
      sum
    )
    if (any(abs(parts$value - 1) > 1e-6)) {
      stop("Payload invalide : les parts voitures/ménage ne somment pas à 1.",
           call. = FALSE)
    }
    invisible(payload)
  },
  # les réseaux sont des longueurs non négatives (une mesure négative est une
  # corruption — jamais une longueur publiée négative)
  function(payload) {
    reseaux <- payload$indicateurs$value[payload$indicateurs$key == "reseaux"]
    if (any(!is.na(reseaux) & reseaux < 0)) {
      stop("Payload invalide : une longueur de réseau négative.",
           call. = FALSE)
    }
    invisible(payload)
  },
  # la part de territoire occupée par les réseaux routiers est une fraction
  # bornée — l'aire OCS-GE ne peut ni être négative ni dépasser le territoire
  function(payload) {
    surface <- payload$indicateurs$value[
      payload$indicateurs$key == "surface_reseaux_routiers"]
    if (any(!is.na(surface) & (surface < 0 | surface > 1))) {
      stop("Payload invalide : une part de surface routière sort de [0, 1].",
           call. = FALSE)
    }
    invisible(payload)
  },
  # l'offre TC est une part dans [0, 1] (une valeur NA — commune sans adresse
  # dans la couche — est un cas légitime, jamais une corruption)
  function(payload) {
    tc <- payload$indicateurs$value[payload$indicateurs$key == "offre_tc"]
    if (any(!is.na(tc) & (tc < 0 | tc > 1))) {
      stop("Payload invalide : une part d'adresses près d'un arrêt hors [0, 1].",
           call. = FALSE)
    }
    invisible(payload)
  },
  # les bornes de recharge sont un compte entier non négatif
  function(payload) {
    b <- payload$indicateurs$value[payload$indicateurs$key == "bornes_recharge"]
    if (any(!is.na(b) & (b < 0 | b != floor(b)))) {
      stop("Payload invalide : un compte de bornes de recharge négatif ou non entier.",
           call. = FALSE)
    }
    invisible(payload)
  },
  # le stationnement vélo est un taux non négatif (les places / 1 000 hab)
  function(payload) {
    v <- payload$indicateurs$value[
      payload$indicateurs$key == "places_stationnement_velo_1000"]
    if (any(!is.na(v) & v < 0)) {
      stop("Payload invalide : un taux de stationnement vélo négatif.",
           call. = FALSE)
    }
    invisible(payload)
  },
  function(payload) {
    keys <- payload$indicateurs$key
    p <- payload$indicateurs$value[keys == "places_stationnement_voiture_1000"]
    r <- payload$indicateurs$value[keys == "bornes_ev_par_station_service"]
    if (any(!is.na(c(p, r)) & c(p, r) < 0))
      stop("Payload invalide : stationnement voiture ou ratio EV/fuel négatif.", call. = FALSE)
    invisible(payload)
  },
  # les densités de ravitaillement (issue #953) : des dénombrements et des taux
  # non négatifs — une valeur négative est une corruption, jamais une offre
  function(payload) {
    keys <- payload$indicateurs$key
    v <- payload$indicateurs$value[keys %in% c(
      "stations_service", "stations_service_1000", "bornes_recharge_1000")]
    if (any(!is.na(v) & v < 0))
      stop("Payload invalide : une densité de ravitaillement négative.", call. = FALSE)
    invisible(payload)
  },
  # la figure « L'offre cyclable » (issue #231) : des longueurs et taux non
  # négatifs (une longueur protégé/partagé/total négative — le numérateur du
  # ratio — ou un km/1 000 hab négatif est une corruption, jamais une offre
  # publiée négative)
  function(payload) {
    cyclable <- payload$indicateurs$value[
      payload$indicateurs$key == "offre_cyclable"]
    if (any(!is.na(cyclable) & cyclable < 0)) {
      stop("Payload invalide : une longueur ou un km/1 000 hab de l'offre ",
           "cyclable négatif.", call. = FALSE)
    }
    invisible(payload)
  },
  # LE RACCORDEMENT (issue #486) : les parts joignables — scalaire, courbe et
  # référence — sont des parts dans [0, 1] (une valeur NA — la commune non
  # routée au géocode DILA aberrant, son motif nommé voyage dans `rider` — est
  # légitime ; une part hors de la borne est une corruption du calcul)
  function(payload) {
    racc <- payload$indicateurs$value[
      payload$indicateurs$key %in% c("raccordement_tc", "raccordement_courbe",
                                     "raccordement_reference")]
    if (any(!is.na(racc) & (racc < 0 | racc > 1))) {
      stop("Payload invalide : une part de population joignable (raccordement)",
           " sort de [0, 1].", call. = FALSE)
    }
    invisible(payload)
  },
  # la GRILLE de la courbe du raccordement : les 73 détails déclarés « t0000 »
  # → « t0360 » par pas de cinq minutes — un détail hors grille ou mal formé est une
  # corruption, jamais une courbe qui ment sur son axe
  function(payload) {
    grille_attendue <- grille_raccordement_national()
    for (cle in c("raccordement_courbe", "raccordement_reference")) {
      lignes <- payload$indicateurs[
        payload$indicateurs$key == cle &
          !is.na(payload$indicateurs$detail), , drop = FALSE]
      par_territoire <- split(lignes$detail, lignes$territoire)
      if (length(par_territoire) > 0 && any(!vapply(
        par_territoire,
        function(details) identical(as.character(details), grille_attendue),
        logical(1L)))) {
        stop("Payload invalide : la grille de la courbe du raccordement ",
             "(", cle, ") n'est pas la grille publiée déclarée.",
             call. = FALSE)
      }
    }
    invisible(payload)
  }
)

# construire_payload_mobilite --------------------------------------------------
# L'assembleur du payload du thème : les quatre tables du contrat (la forme
# d'compute_payload, compute.R) — indicateurs (les clés historiques + le
# raccordement #486 — avec rangs + estampilles T7, les 5
# parts d'isolation portant l'estampille snapshot),
# histoires (les deux story keys), territoires (référence partagée), la
# apercu (vide — gating). Validé par la validation
# GÉNÉRIQUE avec les tables
# déclaratives du thème — un payload invalide s'arrête là.
construire_payload_mobilite <- function(analytiques, base_epci, vintages,
                                         noms_epci_geo_api = NULL,
                                         classes_densite = NULL,
                                         classes_littoral = NULL,
                                         reference = NULL) {
  reference <- exiger_reference_territoires(reference, "construire_payload_mobilite")
  territoires <- construire_territoires_mobilite(
    base_epci,
    analytiques,
    noms_epci_geo_api = noms_epci_geo_api,
    classes_densite = classes_densite,
    classes_littoral = classes_littoral
  )

  payload <- list(
    indicateurs = construire_indicateurs_mobilite(analytiques, territoires, vintages),
    # Issue #312 : le pool de Stories se RÉSOUT ici — une lecture par
    # (territoire, groupe), la saillance vélo remplace le défaut là où elle
    # tire, jamais le pool dans le payload (ADR-0002)
    histoires = resoudre_histoires(
      compute_histoires_mobilite(analytiques, vintages), "mobilite"),
    # #1056 : la dimension canonique exigée à l'entrée, sans repli.
    territoires = reference,
    apercu = assemble_apercu(territoires, construire_apercu_mobilite(territoires))
  )

  validate_payload(payload,
                   indicateurs = INDICATEURS_MOBILITE,
                   vintages = vintages,
                   validations = validations_mobilite,
                   apercu = APERCU_MOBILITE)
  payload
}

# publier_mobilite -------------------------------------------------------------
# Le seam de publication du thème : lit le référentiel partagé (base_epci du
# cache), enchaîne le calcul (construire_analytiques_mobilite — les artefacts
# sont régénérés sous data/processed/mobilite/), LIT l'artefact du
# RACCORDEMENT calculé (issue #486 — `raccordement` : le chemin de l'enveloppe
# passée par la cible du graphe, ou à défaut le répertoire analytique
# conventionnel ; absent ou périmé, la lecture s'arrête bruyamment — les parts
# ne se recalculent QUE quand leurs entrées figées changent, jamais au fil des
# republications), assemble le payload, le valide et le publie via la
# machinerie PARTAGÉE publish (backend "static" par défaut — Parquets Mobilité,
# ressources partagées et vintages ; les projections numériques JSON sont
# retirées). Retourne le payload, comme run_pipeline
# l'attend.
publier_mobilite <- function(donnees, cache = "data/raw", vintages = NULL,
                             sortie = "public/data",
                             sortie_analytiques = file.path(dirname(cache),
                                                             "processed", "mobilite"),
                             raccordement = NULL,
                             noms_epci_geo_api = NULL,
                             classes_densite = NULL,
                             classes_littoral = NULL,
                              reference = NULL) {
  # #1057 : valider AVANT toute lecture du cache.
  reference <- exiger_reference_territoires(reference, "publier_mobilite")
  if (is.null(vintages)) vintages <- vintages_mobilite()

  base_epci <- lire_epci(file.path(cache, "extracted", "EPCI_au_01-01-2025.xlsx"))
  analytiques <- construire_analytiques_mobilite(donnees, base_epci,
                                                  sortie = sortie_analytiques,
                                                  classes_densite = classes_densite,
                                                  noms_epci_geo_api = noms_epci_geo_api)
  # The existing argument remains accepted for run/targets compatibility, but
  # the canonical v1 reader is bound to its own package pins. It never opens
  # the historical mairie artifact or external research-cache paths.
  analytiques$raccordement <- lire_artefact_raccordement_national()
  payload <- construire_payload_mobilite(
    analytiques,
    base_epci,
    vintages,
    noms_epci_geo_api = noms_epci_geo_api,
    classes_densite = classes_densite,
    classes_littoral = classes_littoral,
    reference = reference
  )
  publish(payload, sortie)
  payload
}

# MEMBRES_DESCRIPTEUR_MOBILITE -------------------------------------------------
# Les membres requis du descripteur — le contrat de FORME du thème (ce que la
# machinerie partagée consomme : theme, manifest, vintages, construire_donnees
# — et ce que le run branche : construire_analytiques, publier). `directions`
# est requis depuis l'audit ordinal de l'issue #368 : chaque clé classée
# déclare SA désirabilité (ADR-0015) — un descripteur sans déclaration se
# reposerait sur le défaut high-is-good. La même idée que
# MEMBRES_DESCRIPTEUR_ECONOMIE : un descripteur incomplet échoue FORT, en
# nommant le membre fautif.
MEMBRES_DESCRIPTEUR_MOBILITE <- c(
  "theme", "manifest", "vintages", "construire_donnees",
  "construire_analytiques", "publier", "directions", "metadata",
  "retire_vintages", "raccordement"
)

# verifier_descripteur_mobilite -------------------------------------------------
# La validation de FORME du descripteur : tout membre requis manquant fait
# échouer la validation bruyamment, en nommant le membre fautif. Exécutée par
# theme_mobilite() sur son propre résultat (la construction échoue si le
# descripteur est cassé) et par les tests sur des fixtures négatives.
verifier_descripteur_mobilite <- function(descripteur) {
  manquants <- setdiff(MEMBRES_DESCRIPTEUR_MOBILITE, names(descripteur))
  if (length(manquants) > 0) {
    stop("Descripteur Mobilité invalide — membre(s) requis manquant(s) : ",
         paste(manquants, collapse = ", "), ".", call. = FALSE)
  }
  invisible(TRUE)
}

# DIRECTIONS_MOBILITE ----------------------------------------------------------
# La désirabilité par clé (ADR-0015, l'audit ordinal de l'issue #368) : chaque
# clé CLASSÉE par le producteur déclare SA direction — aucune ne se repose sur
# le défaut high-is-good. Les clés retenues sont celles des 17 indicateurs
# publiés ; la constante est la SOURCE UNIQUE du descripteur (theme_mobilite)
# et de la machinerie de rangs
# (construire_indicateurs_mobilite) — jamais un appel à theme_mobilite() depuis
# un builder (le graphe targets ne peut pas suivre le cycle descripteur →
# builder → descripteur).
#
# Les clés `nb_buildings`, `tot_loss_*`, `avg_*`, `iso_*` et `share_*` ci-dessous
# ne sont PLUS calculées ni publiées depuis #1048. Elles restent déclarées UNIQUEMENT
# pour la parité avec le catalogue épinglé (theme_mobilite.json — slice 2) :
# valider_theme_metadata() croise la direction de chaque page encore épinglée et
# les 15 `indicator_directions`, dont certaines sont `low`. Le slice 2 retire ces
# pages du catalogue ; les lignes correspondantes partent alors d'ici.
DIRECTIONS_MOBILITE <- list(
  nb_buildings = "high",
  voitures_menage = "high",
  reseaux = "high",
  reseaux_par_habitant = "high",
  surface_reseaux_routiers = "low",
  offre_tc = "high",
  bornes_recharge = "high",
  places_stationnement_velo_1000 = "high",
  places_stationnement_voiture_1000 = "low",
  bornes_ev_par_station_service = "high",
  stationnement_velo_par_voiture = "high",
  # les densités de ravitaillement (issue #953) : des dénombrements d'offre —
  # plus il y a de stations-service ou de bornes, mieux c'est. La lecture de
  # transition (EV contre fuel) reste portée par le ratio, inchangé.
  stations_service = "high",
  stations_service_1000 = "high",
  bornes_recharge_1000 = "high",
  avg_tot_car = "high", avg_tot_b = "high", avg_tot_t = "high",
  avg_div_car = "high", avg_div_b = "high", avg_div_t = "high",
  tot_loss_t = "low",
  tot_loss_b = "low",
  offre_cyclable = "high",
  raccordement_tc = "high",
  # les deux clés de MATIÈRE DE FIGURE du raccordement (#486) : déclarées
  # pour l'audit directions↔registre (la bijection du contrat), jamais
  # consommées — des courbes ne sont classées nulle part
  raccordement_courbe = "high",
  raccordement_reference = "high",
  share_food_t = "high", share_food_b = "high", share_food_c = "high",
  share_health_t = "high", share_health_b = "high", share_health_c = "high",
  share_admin_t = "high", share_admin_b = "high", share_admin_c = "high",
  share_school_t = "high", share_school_b = "high", share_school_c = "high",
  share_bank_t = "high", share_bank_b = "high", share_bank_c = "high",
  iso_alimentation = "low", iso_sante = "low",
  iso_administration = "low", iso_ecole = "low", iso_banque = "low"
)

# theme_mobilite ---------------------------------------------------------------
# Le descripteur du thème Mobilité : la même forme de contrat que
# theme_economie() / theme_demographie(), avec les pièces du thème. Le
# descripteur est validé à la construction (verifier_descripteur_mobilite) :
# un membre manquant échoue là où il est construit, jamais plus tard dans la
# machinerie.
theme_mobilite <- function() {
  descripteur <- list(
    theme = "mobilite",
    manifest = MANIFEST_MOBILITE,
    vintages = vintages_mobilite,
    construire_donnees = construire_donnees_mobilite,
    construire_analytiques = construire_analytiques_mobilite,
    publier = publier_mobilite,
    # la désirabilité par clé — la constante DIRECTIONS_MOBILITE (l'audit
    # ordinal de l'issue #368 : aucune clé ne se repose sur le défaut
    # high-is-good)
    directions = DIRECTIONS_MOBILITE,
    # Issue #311 : les métadonnées du thème (le fichier épinglé
    # inst/extdata/theme-metadata/) — publiées par run_pipeline après le
    # payload, jamais un recompute des tables de faits
    metadata = function() lire_theme_metadata("mobilite"),
    # L'export bâtiment retiré ne doit pas subsister dans les vintages partagés
    # issus d'une publication antérieure. Les faits conservés citent le snapshot.
    retire_vintages = "accessibilite_batiments",
    # LE TRAIT RACCORDEMENT (issue #486) : le graphe le voit et câble la
    # chaîne de calcul — les épingles du package en cibles de fichiers, la
    # cible raccordement_mobilite (le calcul, persisté), la publication
    # chaînée derrière. Le mode cron pose cue = "never" sur la chaîne :
    # l'horloge légère ne paie JAMAIS le raccordement.
    raccordement = TRUE
  )
  verifier_descripteur_mobilite(descripteur)
  descripteur
}
