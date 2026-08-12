# test-analytics-mobilite-e2e --------------------------------------------------
# Le run de bout en bout de Mobilité sur le VRAI snapshot porté (issue #137,
# tracer bullet, étendu par l'issue #138 — la chaîne analytique flagship) : la
# couture de téléchargement est MOCKÉE, les builders et le chaînon analytique
# sont RÉELS, et les fixtures d'entrée sont le VRAI snapshot du worktree
# (pipeline/data/raw/bretagne_mobility_super_dashboard_gravity.csv, gitignoré —
# jamais le réseau). C'est le miroir de test-analytics-economie-e2e.R.
#
# Ce que le run de bout en bout doit prouver (acceptance #137 + #138) :
#   - le snapshot porté est normalisé aux comptes verrouillés (mobilite_snapshot :
#     1 200 communes × 2 061 colonnes — le fichier de production, jamais
#     l'artefact non-production aux deltas vélo négatifs) ;
#   - la chaîne analytique FLAGSHIP produit ses artefacts aux comptes verrouillés :
#     les 5 parts d'isolation (1 − share_*, 6 330 lignes — 1 266 territoires ×
#     5 clés, les comptes par niveau commune/EPCI/département/région verrouillés),
#     div_loss_t/b (aucun delta négatif — la neutralité modale sur la base
#     d'abord ; l'EPCI Brest Métropole recalculé depuis les parties), la
#     classification de saillance (seuils verrouillés sur la distribution réelle
#     : top quartile 4+, top décile 10), la signature de densité + le nuage
#     même-échelle (les quelques nombres par territoire, jamais la matrice) et
#     les rangs-en-contexte (la machinerie partagée) ;
#   - le payload publié (indicateurs / histoires / territoires / vintages) sort
#     de run_pipeline(theme = theme_mobilite()) vers une cible TEMPORAIRE (le
#     public/data du worktree n'est jamais touché) : 1 268 territoires × 17
#     clés/détails (la « Taille » + la demande/réseaux + le sous-bloc + les 5
#     parts d'isolation de la grille, assemblées par le ticket payload #141),
#     histoires résolues aux comptes verrouillés (issue #312 — une lecture par
#     (territoire, groupe) : le défaut « vingt-minutes-sans-voiture » 1 127 +
#     la saillance « ce-que-le-velo-preserve » 139 qui le remplace) ;
#   - le run est DÉTERMINISTE : un second run produit des tables et un payload
#     octet-pour-octet identiques (run-report.json excepté — horodaté par
#     conception, issue #10) ;
#   - AUCUN artefact de fiche hors de la cible de publication ;
#   - le chemin d'échec est verrouillé : un input corrompu arrête le run avant
#     un payload partiel (jamais de succès partiel silencieux).
# Aucun appel réseau dans la boucle de test (docs/architecture.md §Testing) :
# download_sources et publier_geometrie sont mockés, le snapshot réel est lu
# par les builders réels.

# Les fixtures réelles — le seam d'entrée du run mocké --------------------------
# Le vrai snapshot porté, le référentiel EPCI partagé, les sources de l'étage
# demande/réseaux (issue #139 : le cube RP voitures, l'extrait OSM Geofabrik,
# les limites communales) et les sources du sous-bloc « L'offre de mobilité
# alternative » (issue #140 : la base GTFS, la couche bâtiments, les bornes
# IRVE, le hub stationnement vélo) vivent sous pipeline/data/ (gitignoré).
# Absents hors worktree, le test saute proprement (comme les autres tests
# « données réelles »).
fixture_e2e_raw <- function(...) {
  testthat::test_path("..", "..", "data", "raw", ...)
}

fixtures_reelles_presentes <- function() {
  all(file.exists(
    fixture_e2e_raw("bretagne_mobility_super_dashboard_gravity.csv"),
    fixture_e2e_raw("extracted", "EPCI_au_01-01-2025.xlsx"),
    fixture_e2e_raw("DS_RP_LOGEMENT_PRINC_2023_CSV_FR.zip"),
    fixture_e2e_raw("bretagne-latest.osm.pbf"),
    fixture_e2e_raw("communes_limites.geojson"),
    # le mode `b` (issue #230, ADR-0016) : le snapshot Geovelo + la table de
    # passage COG du cache
    fixture_e2e_raw("france-20260807.parquet"),
    fixture_e2e_raw("table_passage_annuelle_2025.zip"),
    # le sous-bloc (issue #140) : la base GTFS (les arrêts), la couche
    # bâtiments, les bornes IRVE, le hub stationnement vélo
    fixture_e2e_raw("korrigo-gtfs.zip"),
    fixture_e2e_raw("batiments_residentiels_bretagne.csv"),
    fixture_e2e_raw("bornes-recharges.csv"),
    fixture_e2e_raw("stationnement-velo-commune.csv")
  ))
}

# fabriquer_cache_e2e -----------------------------------------------------------
# La couture de téléchargement MOCKÉE écrit dans le cache les artefacts réels du
# worktree (le réseau n'entre jamais dans la boucle) : le snapshot porté (le
# cache EST le CSV), le référentiel partagé EPCI (déjà extrait, la base que
# lire_epci consomme — jamais re-téléchargée) et, depuis les issues #139/#140,
# les sources de l'étage demande/réseaux (le cube RP voitures, l'extrait OSM,
# les limites communales) et les QUATRE sources du sous-bloc « L'offre de
# mobilité alternative ».
fabriquer_cache_e2e <- function(cache) {
  dir.create(file.path(cache, "extracted"), recursive = TRUE, showWarnings = FALSE)
  file.copy(fixture_e2e_raw("bretagne_mobility_super_dashboard_gravity.csv"),
            cache, overwrite = TRUE)
  file.copy(fixture_e2e_raw("extracted", "EPCI_au_01-01-2025.xlsx"),
            file.path(cache, "extracted"), overwrite = TRUE)
  file.copy(fixture_e2e_raw("DS_RP_LOGEMENT_PRINC_2023_CSV_FR.zip"),
            cache, overwrite = TRUE)
  file.copy(fixture_e2e_raw("bretagne-latest.osm.pbf"),
            cache, overwrite = TRUE)
  file.copy(fixture_e2e_raw("communes_limites.geojson"),
            cache, overwrite = TRUE)
  # le mode `b` (issue #230, ADR-0016) : le snapshot Geovelo (le parquet) et
  # la table de passage COG (le zip — l'orchestrateur les lit depuis le cache)
  file.copy(fixture_e2e_raw("france-20260807.parquet"),
            cache, overwrite = TRUE)
  file.copy(fixture_e2e_raw("table_passage_annuelle_2025.zip"),
            cache, overwrite = TRUE)
  for (f in c("korrigo-gtfs.zip", "batiments_residentiels_bretagne.csv",
              "bornes-recharges.csv", "stationnement-velo-commune.csv")) {
    file.copy(fixture_e2e_raw(f), cache, overwrite = TRUE)
  }
  invisible(cache)
}

# statuts_mobilite ---------------------------------------------------------------
# La table des statuts que download_sources mocké renvoie (la même forme que
# test-run-pipeline-economie.R) : une ligne par source du manifeste Mobilité.
statuts_mobilite <- function(status = "frais") {
  tibble::tibble(
    id = MANIFEST_MOBILITE$id,
    mode = MANIFEST_MOBILITE$mode,
    status = rep(status, nrow(MANIFEST_MOBILITE))
  )
}

# executer_run_reel --------------------------------------------------------------
# LE run de bout en bout : la couture réseau mockée (téléchargement + géométrie
# WFS — jamais le réseau), le reste RÉEL — le builder lit le snapshot du cache,
# le chaînon analytique tourne, le payload sort vers la cible.
executer_run_reel <- function(cache, sortie) {
  local_mocked_bindings(
    download_sources = function(manifest, cache, mode) statuts_mobilite(),
    publier_geometrie = function(cible = "public/data", fetch = NULL) invisible(NULL),
    .package = "lusk"
  )
  run_pipeline(theme = theme_mobilite(), cache = cache, sortie = sortie)
}

# Les comptes verrouillés (issue #137 : « compute and lock them in the test ») --
# Verrouillés sur le run réel 2026-08-06 (le snapshot porté, figé 2026-02-28) :
# POLITIQUE DES VERROUS DE VALEUR (issue #380, après la restauration du cache) :
# les verrous de VALEUR des couches dérivées de sources VIVANTES (les modes t/c
# de l'extrait OSM `latest`, les flux vivants) sont RELATIFS À L'ÉPOQUE DU CACHE :
# un extrait `latest` re-téléchargé bouge les derniers chiffres — ces verrous
# sont donc re-baselinés sur le cache restauré à leur précision naturelle
# (densités et parts au 4ᵉ décimale, longueurs au 3ᵉ, comptes exacts — issue
# #380, décision « accepter + documenter » : le payload publié n'est PAS
# régénéré).
# Les verrous de FORMAT (comptes, noms de colonnes, estampilles, règles
# d'agrégation, valeurs dérivées du snapshot FIGÉ) restent FORTS — la dérive
# d'époque ne touche que les couches vivantes, jamais le snapshot.
#   - mobilite_snapshot             : 1 200 communes × 2 061 colonnes — les 1 202
#     communes de la base moins 29083 (Île-de-Sein) et 29084 (Île-Molène), que
#     l'analyse d'origine n'a pas couvertes (un fait du portage, à documenter) ;
#   - mobilite_communes             : 1 200 communes × nb_buildings (la Taille) ;
#   - nb_buildings_territoires      : 1 266 lignes — 1 200 communes + 61 EPCIs +
#     4 départements + la région, SOMME recalculée depuis les parties (jamais
#     une moyenne) ; les 2 communes hors snapshot n'y figurent pas ;
#   - isolation_territoires         : 6 330 lignes (1 266 territoires × 5 clés
#     d'isolation) — par niveau : 1 200 communes × 5, 61 EPCIs × 5, 4
#     départements × 5, la région × 5 — les agrégats RECALCULÉS depuis les
#     parties (la moyenne pondérée par les bâtiments, jamais une moyenne de
#     parts) ;
#   - div_loss_territoires          : 1 266 lignes (div_loss_t/b + delta +
#     pct_iso_full_t) — AUCUN delta négatif (la neutralité modale sur la base
#     d'abord) ; l'EPCI 242900314 (Brest Métropole) est RECALCULÉ depuis les
#     parties (le bloc _epci du fichier y est absent — un trou du portage) ;
#   - saillance_territoires         : 1 266 lignes (delta + classification) —
#     seuils verrouillés sur la distribution réelle (SEUIL_DELTA_REEL_VELO = 4
#     = q75 réel, SEUIL_SAILLANCE_VELO = 10 = q90 réel ; 130 communes
#     saillantes, 9 EPCIs saillants) ;
#   - densite_territoires           : 1 266 lignes (la signature de densité —
#     les quelques nombres précalculés, jamais la matrice) ;
#   - nuage_territoires             : 1 266 lignes (le résumé du nuage
#     même-échelle : médiane / min / max / n des pairs) ;
#   - isolation_rangs               : 6 340 lignes (1 268 territoires du
#     squelette × 5 clés — ALIGNÉS sur la référence, les 2 communes hors
#     snapshot portent NA, jamais une ligne manquante) ;
#   - L'étage demande/réseaux (issue #139) : voitures_communes (1 202 communes
#     du cube RP exploitation principale — TOUTES les communes bretonnes, le RP
#     couvre ce que l'analyse d'accessibilité ne couvre pas), voitures_
#     territoires (1 268 territoires × 2 parts = 2 536 lignes — la moyenne
#     pondérée par les ménages), reseaux_communes (1 202 communes × 6 mesures)
#     et reseaux_territoires (1 268 × 6 = 7 608 lignes — longueurs sommées,
#     densités Σ L ÷ Σ surface) ;
#   - payload : 1 268 territoires (1 202 communes + 61 EPCIs + 4 départements +
#     la région — le squelette partagé, les 2 communes hors snapshot portent NA
#     pour l'indicateur, jamais une ligne manquante), × 22 clés/détails
#     (nb_buildings 1 + voitures_menage 2 + reseaux 6 + le sous-bloc 3 +
#     offre_cyclable 5 + les 5 parts d'isolation de la grille = 27 896
#     lignes) ;
#     histoires : 1 266 lignes — UNE lecture résolue par (territoire, groupe),
#     la saillance vélo (139 : 130 communes + 9 EPCIs au delta ≥ 10) REMPLACE
#     le défaut là où elle tire — jamais le pool (issue #312) ;
#     apercu vide (gating) ; vintages : 4 lignes (une par source du manifeste).
comptes_normalises_reels <- c(
  mobilite_snapshot = 1200
)
comptes_analytiques_reels <- c(
  mobilite_communes = 1200,
  nb_buildings_territoires = 1266,
  isolation_territoires = 6330,
  div_loss_territoires = 1266,
  saillance_territoires = 1266,
  densite_territoires = 1266,
  nuage_territoires = 1266,
  isolation_rangs = 6340,
  voitures_communes = 1202,
  voitures_territoires = 2536,
  reseaux_communes = 1202,
  reseaux_territoires = 7608
)
# les comptes par niveau des parts d'isolation (la forme « comptes par niveau
# commune/EPCI/département/région » de l'acceptance de l'issue #138) : 5 clés ×
# le nombre de territoires du niveau — jamais une moyenne de parts.
comptes_isolation_par_niveau_reels <- c(
  commune = 1200 * 5,
  epci = 61 * 5,
  departement = 4 * 5,
  region = 1 * 5
)
# la distribution réelle de la saillance (verrouillée sur le snapshot porté) :
#   - commune : 130 saillantes (delta ≥ 10 — le top décile), 213 notables
#     (4 ≤ delta < 10 — le top quartile), 857 non-saillantes (médiane ~1) ;
#   - EPCI   : 9 saillants, 21 notables, 31 non-saillants ;
#   - département : 4 notables (deltas 7/5/8 — la bande quartile, jamais une
#     Story) ; région : 1 notable (delta 7).
comptes_saillance_reels <- c(
  commune_saillant = 130,
  commune_notable = 213,
  commune_non_saillant = 857,
  epci_saillant = 9,
  epci_notable = 21,
  epci_non_saillant = 31,
  departement_notable = 4,
  region_notable = 1
)
# les comptes verrouillés du sous-bloc « L'offre de mobilité alternative »
# (issue #140) — verrouillés sur le run réel 2026-08-06 (les sources
# téléchargées : korrigo GTFS stops.txt, la couche bâtiments BDNB 2025-07,
# bornes 2026-07/08, hub vélo 2022-2025). Korrigo (GTFS) et bornes (IRVE)
# sont des sources VIVANTES (flux vivants) : leurs comptes sont relatifs à
# l'époque du cache (issue #380) — re-baselinés sur le cache restauré
# (korrigo 27 543 arrêts, bornes 9 900 lignes / 1 909 stations, 707 communes).
#   - korrigo (les arrêts GTFS stops.txt) : 27 543 arrêts — la FÉDÉRATION
#     complète (le réseau STAR de Rennes y figure, contrairement à
#     mobibreizh-stops : la correction de la source, documentée dans le
#     manifeste) ;
#   - batiments_residentiels : 1 235 417 bâtiments avec geom_adresse POINT
#     (EPSG:2154) + code_commune_insee, sur 1 200 communes — la couche qui
#     porte la VRAIE part des bâtiments près d'un arrêt (la correction de la
#     méthode : la fraction des BÂTIMENTS, jamais une part de superficie) ;
#   - bornes_recharges : 9 900 lignes de points de charge, 1 909 stations
#     distinctes avec un code du référentiel (les codes postaux /
#     départementaux du fichier consolidé tombent) ;
#   - stationnement_velo : 1 202 communes × 4 millésimes (2022-2025) — la
#     couverture bretonne VÉRIFIÉE à la lecture (l'acceptance) ;
#   - offre_tc_communes : 1 200 lignes (les communes avec ≥ 1 bâtiment) — les
#     deux îles sans bâtiment géocodé (29083, 29084) n'ont pas de part ;
#   - bornes_communes : 707 lignes (les communes du référentiel avec ≥ 1
#     station), 1 909 stations au total ;
#   - stationnement_velo_communes : 1 202 lignes (le millésime 2025) ;
#   - offre_cyclable_communes : 1 202 lignes (la figure « L'offre cyclable »,
#     issue #231 — TOUTES les communes de l'univers population, la commune
#     sans aménagement porte 0 : un fait, jamais une ligne manquante ;
#     437 communes bretonnes à zéro sur le fichier réel) ;
#   - offre_territoires : 10 142 lignes — offre_tc 1 266 (1 200 communes + 61
#     EPCIs + 4 départements + la région) + bornes 1 268 + velo 1 268 + la clé
#     offre_cyclable 6 340 (1 268 territoires × 5 mesures).
comptes_sources_offre_reels <- c(
  korrigo = 27543,
  batiments_residentiels = 1235417,
  bornes_recharges = 9900,
  stationnement_velo = 4808
)
comptes_sous_bloc_analytiques_reels <- c(
  offre_tc_communes = 1200,
  bornes_communes = 707,
  stationnement_velo_communes = 1202,
  offre_cyclable_communes = 1202,
  offre_territoires = 10142
)
# les comptes par niveau du sous-bloc : l'offre TC ne couvre que les 1 200
# communes à bâtiments ; les bornes, le vélo et l'offre cyclable couvrent les
# 1 202 communes du référentiel (× 5 mesures pour l'offre cyclable).
comptes_offre_par_niveau_reels <- c(
  offre_tc_commune = 1200,
  offre_tc_epci = 61,
  offre_tc_departement = 4,
  offre_tc_region = 1,
  bornes_commune = 1202,
  bornes_epci = 61,
  bornes_departement = 4,
  bornes_region = 1,
  velo_commune = 1202,
  velo_epci = 61,
  velo_departement = 4,
  velo_region = 1,
  cyclable_commune = 6010,   # 1 202 × 5 mesures
  cyclable_epci = 305,       # 61 × 5
  cyclable_departement = 20, # 4 × 5
  cyclable_region = 5        # 1 × 5
)
comptes_payload_reels <- c(
  indicateurs = 27896,  # 22 clés/détails × 1 268 territoires (nb_buildings 1 + voitures 2 + reseaux 6 + sous-bloc 3 + offre_cyclable 5 + isolation 5)
  histoires = 1266,    # issue #312 : UNE lecture résolue par (territoire, groupe) — la saillance vélo remplace le défaut là où elle tire (139), jamais le pool
  territoires = 1268,  # 1 202 communes + 61 EPCIs + 4 départements + 1 région
  apercu = 0,          # le gating du thème : la table est présente mais vide
  vintages = 10        # snapshot + RP voitures + osm t/c + amenagements b (#222) + limites (#139) + korrigo + bâtiments + bornes + vélo (#140) + cog_passage (#222/#227)
)
# les comptes des Story keys (la forme RÉSOLUE du contrat histoires, #312) :
# la story vélo ne remplace le défaut que là où la saillance tire (139
# territoires) — les autres territoires gardent « vingt-minutes-sans-voiture »
comptes_histoires_reels <- c(
  vingt_minutes_sans_voiture = 1127,  # 1 266 territoires − 139 saillants
  ce_que_le_velo_preserve = 139
)

# La référence du déterminisme, capturée par le premier test (le run de bout
# en bout) et comparée par le second (un run supplémentaire unique) : prouver
# la stabilité octet-pour-octet avec DEUX runs au total, jamais trois.
reference_determinisme <- NULL

# empreintes_binaires -------------------------------------------------------------
# Les empreintes octet-pour-octet des fichiers d'un dossier (le déterminisme du
# run : relancer produit des fichiers identiques). `exclure` nomme les fichiers
# à écarter (run-report.json — horodaté par conception, issue #10).
empreintes_binaires <- function(dossier, exclure = character()) {
  fichiers <- setdiff(list.files(dossier, recursive = TRUE), exclure)
  stats::setNames(lapply(fichiers, function(f) {
    readBin(file.path(dossier, f), "raw", n = file.info(file.path(dossier, f))$size)
  }), fichiers)
}

# 1. Le chemin de joie RÉEL ------------------------------------------------------

test_that("le run de bout en bout : snapshot normalisé + payload publié, aux comptes verrouillés", {
  skip_sans_donnees_reelles(fixtures_reelles_presentes(),
              "les fixtures réelles ne sont pas présentes (data/ est gitignoré).")

  # tout vit dans des dossiers temporaires : le cache (les fixtures copiées), la
  # sortie analytique (le dossier processed du run) et la cible de publication —
  # le public/data du worktree n'est JAMAIS touché
  racine <- tempfile("e2e-mob-")
  dir.create(racine)
  cache <- file.path(racine, "cache")
  cwd_run <- file.path(racine, "cwd")   # le cwd du run : les sorties RELATIVES
  dir.create(cwd_run)                   # des builders (data/processed/mobilite)
  sortie <- file.path(racine, "pub")    # restent dans le temporaire
  on.exit(unlink(racine, recursive = TRUE), add = TRUE)

  fabriquer_cache_e2e(cache)
  withr::local_dir(cwd_run)

  payload <- executer_run_reel(cache, sortie)
  sortie_analytiques <- file.path(dirname(cache), "processed", "mobilite")

  # le payload complet du thème, aux comptes réels verrouillés
  expect_named(payload, c("indicateurs", "histoires", "territoires", "apercu"))
  expect_equal(nrow(payload$indicateurs), comptes_payload_reels[["indicateurs"]])
  expect_equal(nrow(payload$histoires), comptes_payload_reels[["histoires"]])
  expect_equal(nrow(payload$territoires), comptes_payload_reels[["territoires"]])
  expect_equal(nrow(payload$apercu), comptes_payload_reels[["apercu"]])
  # les clés publiées : la « Taille » (nb_buildings) + l'étage demande/réseaux
  # (issue #139 : voitures_menage, reseaux) + le sous-bloc « L'offre de
  # mobilité alternative » (issue #140 : offre_tc, bornes_recharge,
  # places_stationnement_velo_1000 + issue #231 : offre_cyclable) + les 5
  # parts d'isolation de la GRILLE (issue #141 : iso_alimentation, iso_sante,
  # iso_administration, iso_ecole, iso_banque) — une ligne par territoire ×
  # multiplicité, avec leurs rangs. La matrice complète ne part JAMAIS dans le
  # payload : les seules clés du payload sont les douze déclarées (aucune clé
  # dens_div_t_*, div_loss_t_dec_*, share_* — la leçon de l'issue #131)
  expect_setequal(unique(payload$indicateurs$key),
                  c("nb_buildings", "voitures_menage", "reseaux",
                    "offre_tc", "bornes_recharge",
                    "places_stationnement_velo_1000",
                    "offre_cyclable",
                    "iso_alimentation", "iso_sante", "iso_administration",
                    "iso_ecole", "iso_banque"))
  expect_false(any(grepl("dens_|dec_|share_|norm_score|tot_loss",
                         payload$indicateurs$key)))
  expect_equal(sum(payload$indicateurs$key == "nb_buildings"), 1268)
  expect_equal(sum(payload$indicateurs$key == "voitures_menage"), 2536)
  expect_equal(sum(payload$indicateurs$key == "reseaux"), 7608)
  for (cle in c("offre_tc", "bornes_recharge",
                "places_stationnement_velo_1000")) {
    expect_equal(sum(payload$indicateurs$key == cle), 1268, info = cle)
  }
  # la figure « L'offre cyclable » (issue #231) : 5 mesures par territoire —
  # les longueurs protégé/partagé/total et les km/1 000 hab
  expect_equal(sum(payload$indicateurs$key == "offre_cyclable"), 1268 * 5)
  expect_setequal(unique(payload$indicateurs$detail[
    payload$indicateurs$key == "offre_cyclable"]),
    c("protege_longueur", "protege_km_1000", "partage_longueur",
      "partage_km_1000", "total_longueur"))
  # les 5 parts d'isolation : une ligne par territoire (les agrégats EPCI /
  # département / région sont recalculés depuis les parties — la moyenne
  # pondérée par les bâtiments, jamais une moyenne de parts), chacune avec ses
  # rangs-en-contexte et l'estampille SNAPSHOT
  for (cle in names(CLES_ISOLATION_MOBILITE)) {
    expect_equal(sum(payload$indicateurs$key == cle), 1268, info = cle)
  }
  expect_true(all(c("rang_epci", "rang_dep", "rang_reg") %in%
                    names(payload$indicateurs)))
  # les deux communes hors snapshot (Île-de-Sein, Île-Molène) portent NA pour
  # la « Taille » et l'offre TC (aucun bâtiment géocodé dans la couche — un
  # fait de la donnée, jamais une part fabriquée) — jamais une ligne manquante
  # (l'alignement sur la référence du squelette). Le RP, lui, couvre Île-de-Sein
  # (voitures 0.603 sans voiture) ; les bornes et le stationnement vélo, eux,
  # les couvrent (zéro porté)
  expect_true(all(is.na(payload$indicateurs$value[
    payload$indicateurs$territoire %in% c("29083", "29084") &
      payload$indicateurs$key == "nb_buildings"])))
  expect_true(all(is.na(payload$indicateurs$value[
    payload$indicateurs$territoire %in% c("29083", "29084") &
      payload$indicateurs$key == "offre_tc"])))
  # la valeur de la région : la SOMME des 1 200 communes (recalculée depuis les
  # parties, jamais une moyenne) — le total verrouillé du fichier de production
  expect_equal(
    payload$indicateurs$value[payload$indicateurs$territoire == "53" &
                                payload$indicateurs$key == "nb_buildings"],
    1223578
  )
  expect_equal(
    payload$indicateurs$value[payload$indicateurs$territoire == "22" &
                                payload$indicateurs$key == "nb_buildings"],
    260617
  )
  # l'étage demande (issue #139) : les parts voitures/ménage de la région
  # (recalculées depuis les parties — la moyenne pondérée par les ménages,
  # jamais une moyenne de parts) et de Rennes, avec leurs rangs-en-contexte
  lire_ind <- function(territoire, key, detail) {
    payload$indicateurs[
      payload$indicateurs$territoire == territoire &
        payload$indicateurs$key == key &
        ifelse(is.na(payload$indicateurs$detail), is.na(detail),
               payload$indicateurs$detail == detail), ]
  }
  expect_equal(round(lire_ind("53", "voitures_menage", "sans_voiture")$value, 6),
               0.118268)
  expect_equal(round(lire_ind("53", "voitures_menage", "deux_plus")$value, 6),
               0.402230)
  expect_equal(round(lire_ind("22", "voitures_menage", "sans_voiture")$value, 6),
               0.094700)
  rennes_sans <- lire_ind("35238", "voitures_menage", "sans_voiture")
  expect_equal(round(rennes_sans$value, 6), 0.319333)
  # ADR-0021 : une commune avec EPCI se classe DANS son EPCI — Rennes est 1re
  # de Rennes Métropole (le rang ordinal 1, plus jamais une fraction), et son
  # rang régional n'existe plus (NA par design — le repli régional n'est que
  # pour les communes SANS EPCI)
  expect_equal(rennes_sans$rang_epci, 1)
  expect_true(is.na(rennes_sans$rang_reg))
  expect_equal(round(lire_ind("35238", "voitures_menage", "deux_plus")$value, 6),
               0.150348)
  # l'île de Sein : sans EPCI → pas de rang EPCI (jamais un rang fantôme), et
  # la part sans voiture la plus forte de Bretagne (60 % — une île)
  sein_sans <- lire_ind("29083", "voitures_menage", "sans_voiture")
  expect_equal(round(sein_sans$value, 6), 0.603082)
  expect_true(is.na(sein_sans$rang_epci))
  # ADR-0021 : plus AUCUN groupe de comparaison au niveau département —
  # rang_dep est NA pour tout le monde (la colonne reste dans le contrat, vide)
  expect_true(is.na(sein_sans$rang_dep))
  # l'étage réseaux (issue #139) : les longueurs/densités de la région
  # (longueurs SOMMÉES, densités Σ L ÷ Σ surface) et de Rennes. Verrous de
  # VALEUR des couches dérivées de l'extrait OSM `latest` (les modes t/c) :
  # relatifs à l'ÉPOQUE du cache (issue #380) — re-baselinés sur le cache
  # restauré au 4ᵉ décimale (les longueurs gardent leur précision, une dérive
  # d'époque déplace le nombre entier) — les verrous de FORMAT restent forts.
  expect_equal(round(lire_ind("53", "reseaux", "c_longueur")$value, 3),
               101373.625)
  expect_equal(round(lire_ind("53", "reseaux", "c_densite")$value, 4),
               3.6935)
  expect_equal(round(lire_ind("53", "reseaux", "b_longueur")$value, 3),
               4940.309)
  expect_equal(round(lire_ind("53", "reseaux", "b_densite")$value, 6),
               0.179998)
  expect_equal(round(lire_ind("53", "reseaux", "t_longueur")$value, 3),
               6742.766)
  expect_equal(round(lire_ind("53", "reseaux", "t_densite")$value, 4),
               0.2457)
  rennes_c <- lire_ind("35238", "reseaux", "c_densite")
  expect_equal(round(rennes_c$value, 4), 18.1578)
  # ADR-0021 : Rennes a un EPCI → pas de rang régional (NA par design — le
  # repli régional n'est que pour les communes SANS EPCI)
  expect_true(is.na(rennes_c$rang_reg))
  # Brest Métropole : la densité routière dérivée du pbf OSM `latest` (source
  # vivante) — verrou de VALEUR relatif à l'époque du cache, au 4ᵉ décimale
  # (le 6ᵉ décimale chahute entre extraits re-téléchargés)
  expect_equal(round(lire_ind("242900314", "reseaux", "c_densite")$value, 4),
               8.9465)
  # le sous-bloc (issue #140) : la part des bâtiments près d'un arrêt (l'offre
  # TC corrigée — la vraie part des BÂTIMENTS à 500 m d'un arrêt GTFS, jamais
  # une part de superficie), les bornes et le stationnement vélo de la région.
  # Korrigo (GTFS) et bornes IRVE sont des sources VIVANTES re-téléchargées par
  # la restauration du cache (issue #380) : verrous de VALEUR relatifs à
  # l'époque du cache (4ᵉ décimale pour une part, re-baselinés)
  expect_equal(round(lire_ind("53", "offre_tc", NA)$value, 4), 0.5731)
  expect_equal(round(lire_ind("35238", "offre_tc", NA)$value, 6), 0.995736)
  expect_equal(round(lire_ind("29011", "offre_tc", NA)$value, 6), 0.918206)
  expect_equal(round(lire_ind("29232", "offre_tc", NA)$value, 6), 0.968711)
  expect_equal(round(lire_ind("53", "bornes_recharge", NA)$value, 6), 1909)
  expect_equal(round(lire_ind("35238", "bornes_recharge", NA)$value, 6), 49)
  expect_equal(round(lire_ind("53", "places_stationnement_velo_1000", NA)$value,
                     6), 18.498939)
  expect_equal(round(lire_ind("35238", "places_stationnement_velo_1000", NA)$value,
                     6), 72.804284)
  # la GRILLE (issue #141) : les 5 parts d'isolation — la part des bâtiments
  # SANS accès à pied ou en transports en commun à 20 minutes (1 − share_*),
  # l'agrégat de chaque niveau RECALCULÉ depuis les parties (la moyenne
  # pondérée par les bâtiments, jamais une moyenne de parts). Les valeurs de
  # la région et de Rennes sont verrouillées sur le run réel ; une part hors
  # [0, 1] ferait échouer validations_mobilite.
  lire_iso <- function(territoire, key) {
    lire_ind(territoire, key, NA)$value
  }
  # la région : la banque isole le plus (50 % des bâtiments — l'accès au
  # dernier distributeur), l'alimentation le moins (31 %)
  expect_equal(round(lire_iso("53", "iso_alimentation"), 6), 0.310495)
  expect_equal(round(lire_iso("53", "iso_sante"), 6), 0.388552)
  expect_equal(round(lire_iso("53", "iso_administration"), 6), 0.343320)
  expect_equal(round(lire_iso("53", "iso_ecole"), 6), 0.323002)
  expect_equal(round(lire_iso("53", "iso_banque"), 6), 0.502248)
  # Rennes : la métropole — la part des bâtiments isolés est nulle (l'offre
  # dense), et chaque part porte ses rangs-en-contexte (Rennes se classe très
  # haut — les bâtiments isolés sont rares). ADR-0021 : Rennes a un EPCI → son
  # rang EPCI est porté (Rennes 1re de Rennes Métropole), ses rangs
  # départemental et régional sont NA par design
  expect_equal(round(lire_iso("35238", "iso_alimentation"), 6), 0)
  expect_equal(round(lire_iso("35238", "iso_banque"), 6), 0)
  rennes_iso <- payload$indicateurs[
    payload$indicateurs$territoire == "35238" &
      payload$indicateurs$key == "iso_banque", ]
  expect_true(!is.na(rennes_iso$rang_epci))
  expect_true(all(is.na(c(rennes_iso$rang_dep, rennes_iso$rang_reg))))
  # Brest Métropole (l'EPCI) : la moyenne pondérée par les bâtiments de ses
  # communes membres
  expect_equal(round(lire_iso("242900314", "iso_banque"), 6), 0.076433)
  # les agrégats ne sont JAMAIS la moyenne des parts communales : le contraste
  # réel (la moyenne des 1 200 parts communales de l'école — 0,449 — vs la
  # valeur agrégée de la région, pondérée par les bâtiments — 0,323)
  parts_communales_ecole <- payload$indicateurs$value[
    payload$indicateurs$key == "iso_ecole" &
      type_territoire_mobilite(payload$indicateurs$territoire) == "commune"]
  expect_false(isTRUE(all.equal(lire_iso("53", "iso_ecole"),
                                mean(parts_communales_ecole, na.rm = TRUE))))
  # toutes les parts publiées restent des parts dans [0, 1] (une valeur NA —
  # commune hors snapshot — est un cas légitime, jamais une part hors borne)
  for (cle in names(CLES_ISOLATION_MOBILITE)) {
    v <- payload$indicateurs$value[payload$indicateurs$key == cle]
    expect_true(all(is.na(v) | (v >= 0 & v <= 1)), info = cle)
  }
  # les 2 communes hors snapshot portent NA pour les parts d'isolation (jamais
  # une part fabriquée) — l'alignement sur la référence du squelette
  expect_true(all(is.na(lire_iso("29083", "iso_alimentation"))))
  expect_true(all(is.na(lire_iso("29084", "iso_banque"))))
  # les estampilles T7 : CHAQUE indicateur porte le vintage de SA source de
  # référence (la « Taille » → le snapshot ; la demande → le RP exploitation
  # principale ; les réseaux → l'extrait OSM, le timestamp d'extraction ; le
  # sous-bloc → la base GTFS korrigo pour l'offre TC, l'IRVE pour les bornes,
  # le hub Ecolab pour le stationnement vélo ; les parts d'isolation → le
  # snapshot — l'ESTAMPILLE SNAPSHOT du flagship, la date d'instantané de
  # l'analyse comme référence, distincte des thèmes légers)
  vintages <- vintages_mobilite()
  pour <- function(cle) {
    payload$indicateurs[payload$indicateurs$key == cle &
                          !is.na(payload$indicateurs$value), ]
  }
  ref_snapshot <- vintages[vintages$id == "mobilite_snapshot", ]
  nb <- pour("nb_buildings")
  expect_true(all(nb$vintage_source == ref_snapshot$source))
  expect_true(all(nb$vintage_date_reference == "2026-02-28"))
  expect_true(all(nb$vintage_date_publication == "2026-08-06"))
  for (cle in names(CLES_ISOLATION_MOBILITE)) {
    iso_stamp <- pour(cle)
    expect_true(all(iso_stamp$vintage_source == ref_snapshot$source), info = cle)
    expect_true(all(iso_stamp$vintage_version == "2026-02"), info = cle)
    expect_true(all(iso_stamp$vintage_date_reference == "2026-02-28"),
                info = cle)
    expect_true(all(iso_stamp$vintage_date_publication == "2026-08-06"),
                info = cle)
  }
  expect_true(all(pour("voitures_menage")$vintage_source ==
                    vintages$source[vintages$id == "rp_logement_princ"]))
  expect_true(all(pour("voitures_menage")$vintage_date_reference == "2023-01-01"))
  expect_true(all(pour("voitures_menage")$vintage_date_publication == "2026-07-29"))
  expect_true(all(pour("reseaux")$vintage_source ==
                    vintages$source[vintages$id == "amenagements_cyclables"]))
  expect_true(all(pour("reseaux")$vintage_date_reference == "2026-08-07"))
  expect_true(all(pour("reseaux")$vintage_date_publication == "2026-08-07"))
  ref_korrigo <- vintages[vintages$id == "korrigo", ]
  expect_true(all(pour("offre_tc")$vintage_source == ref_korrigo$source))
  expect_true(all(pour("offre_tc")$vintage_date_reference == "2026-02-03"))
  ref_bornes <- vintages[vintages$id == "bornes-recharges", ]
  expect_true(all(pour("bornes_recharge")$vintage_source == ref_bornes$source))
  expect_true(all(pour("bornes_recharge")$vintage_date_reference == "2026-07-28"))
  ref_velo <- vintages[vintages$id == "stationnement-velo", ]
  expect_true(all(pour("places_stationnement_velo_1000")$vintage_source ==
                    ref_velo$source))
  expect_true(all(pour("places_stationnement_velo_1000")$vintage_version ==
                    "2022-2025"))
  expect_true(all(pour("places_stationnement_velo_1000")$vintage_date_reference ==
                    "2025-01-01"))
  # la figure « L'offre cyclable » (issue #231) : l'estampille de SA source de
  # référence — l'extrait OSM (osm_reseaux, l'horloge LENTE : la référence est
  # le timestamp d'extraction 2026-08-05, la publication le portage 2026-08-06)
  # — JAMAIS le vintage Geovelo frais (2026-08-07) : le ratio « X % de
  # l'infrastructure routière » est limité par sa plus lente horloge (décision
  # #226 US6)
  ref_osm <- vintages[vintages$id == "osm_reseaux", ]
  expect_true(all(pour("offre_cyclable")$vintage_source == ref_osm$source))
  expect_true(all(pour("offre_cyclable")$vintage_date_reference == "2026-08-05"))
  expect_true(all(pour("offre_cyclable")$vintage_date_publication == "2026-08-06"))
  expect_false(any(pour("offre_cyclable")$vintage_date_reference == "2026-08-07"))

  # la référence des territoires : le squelette partagé (communes + EPCIs +
  # départements + région), les noms réels, l'EPCI de chaque commune
  expect_setequal(unique(payload$territoires$type),
                  c("commune", "epci", "departement", "region"))
  expect_equal(
    payload$territoires$nom[payload$territoires$territoire == "29011"],
    "Bohars"
  )
  expect_equal(
    payload$territoires$epci[payload$territoires$territoire == "29011"],
    "242900314"  # Brest Métropole — le SIREN, jamais le nom
  )

  # les fichiers par thème + la référence partagée + vintages + rapport de run.
  # Issue #116 : l'Aperçu d'un run Mobilité est vide par design — le fichier
  # partagé apercu n'est NI écrit NI écrasé par un thème sans aperçu.
  for (f in c("indicateurs_mobilite.parquet", "indicateurs_mobilite.json",
              "histoires_mobilite.parquet", "histoires_mobilite.json",
              "territoires.parquet", "territoires.json",
              "vintages.parquet", "run-report.json")) {
    expect_true(file.exists(file.path(sortie, f)), info = f)
  }
  expect_false(file.exists(file.path(sortie, "apercu.parquet")))
  expect_false(file.exists(file.path(sortie, "apercu.json")))

  # le parquet relit exactement le payload publié
  ind <- nanoparquet::read_parquet(file.path(sortie, "indicateurs_mobilite.parquet"))
  expect_equal(nrow(ind), nrow(payload$indicateurs))
  expect_equal(ind$value, payload$indicateurs$value)
  # vintages.parquet : une ligne par source du manifeste Mobilité
  vint <- nanoparquet::read_parquet(file.path(sortie, "vintages.parquet"))
  expect_equal(nrow(vint), comptes_payload_reels[["vintages"]])
  expect_setequal(vint$id, MANIFEST_MOBILITE$id)

  # les tables NORMALISÉES persistées, aux comptes réels verrouillés (la forme
  # du portage : le snapshot complet, 1 200 communes × 2 061 colonnes)
  norm <- readRDS(file.path(cwd_run, "data", "processed", "mobilite",
                            "mobilite_snapshot.rds"))
  expect_equal(nrow(norm), comptes_normalises_reels[["mobilite_snapshot"]])
  expect_equal(ncol(norm), 2061)
  expect_equal(sum(norm$nb_buildings), 1223578)

  # les tables ANALYTIQUES persistées, aux comptes réels verrouillés
  for (nom in names(comptes_analytiques_reels)) {
    expect_equal(nrow(readRDS(file.path(sortie_analytiques, paste0(nom, ".rds")))),
                 unname(comptes_analytiques_reels[[nom]]), info = nom)
  }

  # l'étage demande/réseaux (issue #139) --------------------------------------
  # La demande : les parts voitures/ménage aux quatre niveaux, RECALCULÉES
  # depuis les parties (la moyenne pondérée par les ménages — jamais une
  # moyenne de parts), la région à 0.1183 sans voiture / 0.4022 avec 2+ (la
  # Bretagne rurale possède la voiture), Rennes à 0.319 (la métropole), l'île
  # de Sein à 0.603 (sans voiture — une île).
  vt <- readRDS(file.path(sortie_analytiques, "voitures_territoires.rds"))
  expect_named(vt, c("code", "key", "detail", "value"))
  expect_true(all(vt$key == "voitures_menage"))
  expect_setequal(unique(vt$detail), c("sans_voiture", "deux_plus"))
  lire_vt <- function(code, detail) vt$value[vt$code == code & vt$detail == detail]
  expect_equal(round(lire_vt("53", "sans_voiture"), 6), 0.118268)
  expect_equal(round(lire_vt("53", "deux_plus"), 6), 0.402230)
  expect_equal(round(lire_vt("22", "sans_voiture"), 6), 0.094700)
  expect_equal(round(lire_vt("35238", "sans_voiture"), 6), 0.319333)
  expect_equal(round(lire_vt("242900314", "sans_voiture"), 6), 0.208605)
  expect_equal(round(lire_vt("29083", "sans_voiture"), 6), 0.603082)
  # la règle d'agrégation : un agrégat n'est JAMAIS la moyenne des parts
  # communales — le contraste réel (la moyenne des 1 202 parts communales vs
  # la valeur agrégée de la région, pondérée par les ménages)
  parts_communales_v <- vt$value[vt$detail == "sans_voiture" &
                                   type_territoire_mobilite(vt$code) == "commune"]
  expect_false(isTRUE(all.equal(lire_vt("53", "sans_voiture"),
                                mean(parts_communales_v))))
  expect_true(all(!is.na(vt$value) & vt$value >= 0 & vt$value <= 1))

  # Les réseaux : les longueurs/densités aux quatre niveaux, RECALCULÉES
  # depuis les parties (les longueurs SOMMÉES, les densités Σ L ÷ Σ surface —
  # jamais la moyenne des densités communales). La région : 101 374 km de
  # routes (3.69 km/km²), 4 940 km de réseau cyclable Geovelo par direction
  # (0.18 km/km² — ADR-0016, issue #230 : le comptage par direction de la
  # table normalisée, ~4 913 km de géométrie unique + 155 lignes
  # bidirectionnelles, verrouillé sur le snapshot du 2026-08-07), 6 743 km de
  # trottoirs. Les modes t/c (l'extrait OSM `latest`) portent des verrous de
  # VALEUR relatifs à l'époque du cache (issue #380 — re-baselinés sur le
  # cache restauré), les modes b (Geovelo épinglé) restent forts.
  rt <- readRDS(file.path(sortie_analytiques, "reseaux_territoires.rds"))
  expect_named(rt, c("code", "key", "detail", "value"))
  expect_true(all(rt$key == "reseaux"))
  expect_setequal(unique(rt$detail),
                  c("t_longueur", "t_densite", "b_longueur", "b_densite",
                    "c_longueur", "c_densite"))
  lire_rt <- function(code, detail) rt$value[rt$code == code & rt$detail == detail]
  expect_equal(round(lire_rt("53", "c_longueur"), 3), 101373.625)
  expect_equal(round(lire_rt("53", "c_densite"), 4), 3.6935)
  expect_equal(round(lire_rt("53", "b_longueur"), 3), 4940.309)
  expect_equal(round(lire_rt("53", "b_densite"), 6), 0.179998)
  expect_equal(round(lire_rt("53", "t_longueur"), 3), 6742.766)
  expect_equal(round(lire_rt("53", "t_densite"), 4), 0.2457)
  # le contraste urbain : Rennes à 18.16 km/km² de routes (la densité la plus
  # forte de Bretagne), Brest Métropole à 8.95, l'île de Sein sans réseau
  # cyclable (0 km — un fait, jamais une ligne manquante)
  expect_equal(round(lire_rt("35238", "c_densite"), 4), 18.1578)
  expect_equal(round(lire_rt("242900314", "c_densite"), 4), 8.9465)
  expect_equal(lire_rt("29083", "b_longueur"), 0)
  # la règle d'agrégation : une densité de niveau = Σ L ÷ Σ surface (la
  # moyenne pondérée par la surface), jamais la moyenne des densités
  densites_communales_c <- rt$value[rt$detail == "c_densite" &
                                      type_territoire_mobilite(rt$code) == "commune"]
  expect_false(isTRUE(all.equal(lire_rt("53", "c_densite"),
                                mean(densites_communales_c))))
  expect_true(all(!is.na(rt$value) & rt$value >= 0))

  # la chaîne analytique FLAGSHIP (issue #138) ---------------------------------
  # Les 5 parts d'isolation aux comptes par niveau (l'acceptance : comptes
  # commune/EPCI/département/région) — les agrégats RECALCULÉS depuis les
  # parties, jamais une moyenne de parts.
  iso <- readRDS(file.path(sortie_analytiques, "isolation_territoires.rds"))
  expect_named(iso, c("code", "key", "value"))
  expect_setequal(unique(iso$key),
                  c("iso_alimentation", "iso_sante", "iso_administration",
                    "iso_ecole", "iso_banque"))
  comptes_niveaux <- table(type_territoire_mobilite(iso$code), iso$key)
  for (niveau in names(comptes_isolation_par_niveau_reels)) {
    expect_equal(sum(comptes_niveaux[niveau, ]),
                 unname(comptes_isolation_par_niveau_reels[[niveau]]),
                 info = niveau)
  }
  # la règle d'agrégation : un agrégat n'est JAMAIS la moyenne des parts
  # communales — le contraste réel (la moyenne des 1 200 parts communales de
  # l'alimentation vs la valeur agrégée de la région, pondérée par les
  # bâtiments) ; et les valeurs restent des parts dans [0, 1]
  parts_communales <- iso$value[iso$key == "iso_alimentation" &
                                  type_territoire_mobilite(iso$code) == "commune"]
  region_iso <- iso$value[iso$code == "53" & iso$key == "iso_alimentation"]
  expect_false(isTRUE(all.equal(region_iso, mean(parts_communales))))
  expect_true(all(!is.na(iso$value) & iso$value >= 0 & iso$value <= 1))

  # div_loss_t/b : AUCUN delta négatif à aucun niveau (la neutralité modale
  # sur la base d'abord) ; l'EPCI 242900314 (Brest Métropole) est RECALCULÉ
  # depuis les parties (le bloc _epci du fichier y est absent — un trou du
  # portage) : div_loss_t 8, div_loss_b 1, delta 7, pct_iso_full_t 0.0219
  div <- readRDS(file.path(sortie_analytiques, "div_loss_territoires.rds"))
  expect_named(div, c("code", "div_loss_t", "div_loss_b", "delta",
                      "pct_iso_full_t"))
  expect_true(all(div$delta >= 0))
  brest <- div[div$code == "242900314", ]
  expect_equal(brest$div_loss_t, 8)
  expect_equal(brest$div_loss_b, 1)
  expect_equal(brest$delta, 7)
  expect_equal(round(brest$pct_iso_full_t, 4), 0.0219)
  # le story depth : pct_iso_full_c = 0 partout (la voiture n'isole jamais) et
  # la région porte sa valeur du fichier (0.1)
  expect_true(all(payload$histoires$pct_iso_full_t[
    payload$histoires$story_key == "vingt-minutes-sans-voiture" &
      payload$histoires$type == "region"] == 0.1))

  # la saillance : seuils verrouillés sur la distribution réelle — le top
  # quartile réel (q75 = 4) et le top décile réel (q90 = 10) du delta communal
  # (343 communes ≥ 4, 130 ≥ 10 — les chiffres de conception ADR-0012), et les
  # comptes de classification par niveau
  delta_communes <- div$delta[type_territoire_mobilite(div$code) == "commune"]
  expect_equal(SEUIL_DELTA_REEL_VELO, 4)
  expect_equal(SEUIL_SAILLANCE_VELO, 10)
  expect_equal(unname(quantile(delta_communes, c(0.75, 0.9))), c(4, 10))
  expect_equal(sum(delta_communes >= SEUIL_DELTA_REEL_VELO), 343)
  expect_equal(sum(delta_communes >= SEUIL_SAILLANCE_VELO), 130)
  sai <- readRDS(file.path(sortie_analytiques, "saillance_territoires.rds"))
  comptes_sai <- table(type_territoire_mobilite(sai$code), sai$classification)
  for (cle in names(comptes_saillance_reels)) {
    bits <- strsplit(cle, "_")[[1]]
    niveau <- bits[[1]]
    classe <- paste(bits[-1], collapse = "-")
    expect_equal(unname(comptes_sai[niveau, classe]),
                 unname(comptes_saillance_reels[[cle]]), info = cle)
  }

  # la signature de densité et le nuage même-échelle : les quelques nombres
  # précalculés par territoire (jamais la matrice) — la forme du contrat, et
  # le nuage de la région = toutes ses communes (n = 1 200)
  dens <- readRDS(file.path(sortie_analytiques, "densite_territoires.rds"))
  expect_named(dens, c("type", "code", "dens_min", "dens_max",
                       paste0("dens_", 1:10), paste0("dec_", 1:10)))
  nu <- readRDS(file.path(sortie_analytiques, "nuage_territoires.rds"))
  expect_named(nu, c("code", "type", "nuage_median", "nuage_min",
                     "nuage_max", "nuage_n"))
  expect_equal(nu$nuage_n[nu$code == "53"], 1200)
  expect_equal(nu$nuage_median[nu$code == "53"], 36)

  # les rangs-en-contexte via la machinerie partagée : les artefacts portent
  # les trois rangs ORDINAUX directionnels et la TAILLE de chaque groupe
  # (rang_*_n — ADR-0015, #310), alignés sur la référence (les 2 communes
  # hors snapshot portent NA, jamais une ligne manquante)
  rangs <- readRDS(file.path(sortie_analytiques, "isolation_rangs.rds"))
  expect_named(rangs, c("code", "key",
                        "rang_epci", "rang_epci_n",
                        "rang_dep", "rang_dep_n",
                        "rang_reg", "rang_reg_n"))
  expect_equal(length(unique(rangs$code)), 1268)
  expect_true(all(is.na(rangs$rang_epci[rangs$code %in% c("29083", "29084")])))
  # ADR-0021 : rang_dep vide partout (plus aucun groupe départemental) — la
  # colonne reste dans le contrat, NA ; une commune avec EPCI n'a pas de rang
  # régional (le repli régional n'est que pour les communes SANS EPCI)
  expect_true(all(is.na(rangs$rang_dep)))
  rennes_rangs <- rangs[rangs$code == "35238", ]
  expect_true(all(!is.na(rennes_rangs$rang_epci)))
  expect_true(all(is.na(rennes_rangs$rang_reg)))

  # le sous-bloc « L'offre de mobilité alternative » (issue #140) ---------------
  # Les sources NORMALISÉES du sous-bloc, aux comptes réels verrouillés (la
  # matière de construire_donnees_mobilite — jamais re-persistée par le
  # chaînon, lue directement depuis le run).
  #   - korrigo : les arrêts du stops.txt GTFS (27 543 — la fédération, dont
  #     le réseau STAR de Rennes — re-baseliné sur le cache restauré, issue
  #     #380) — la correction de la source (mobibreizh-stops n'a aucun arrêt
  #     STAR) ;
  #   - batiments_residentiels : la couche bâtiments BDNB (1 235 417 points
  #     géocodés, 1 200 communes) — la couche qui porte la VRAIE part ;
  #   - bornes_recharges : 9 900 lignes de points de charge (issue #380 :
  #     re-baseliné sur le cache restauré) ;
  #   - stationnement_velo : 1 202 communes × 4 millésimes.
  # Le chaînon persiste ses propres artefacts sous data/processed/mobilite/ —
  # les tables COMMUNALES et l'agrégation aux quatre niveaux.
  norm_sources <- construire_sources_offre_mobilite(cache)
  expect_equal(nrow(norm_sources$korrigo), comptes_sources_offre_reels[["korrigo"]])
  expect_equal(nrow(norm_sources$batiments_residentiels),
               comptes_sources_offre_reels[["batiments_residentiels"]])
  expect_equal(nrow(norm_sources$bornes_recharges),
               comptes_sources_offre_reels[["bornes_recharges"]])
  expect_equal(nrow(norm_sources$stationnement_velo),
               comptes_sources_offre_reels[["stationnement_velo"]])

  for (nom in names(comptes_sous_bloc_analytiques_reels)) {
    expect_equal(nrow(readRDS(file.path(sortie_analytiques, paste0(nom, ".rds")))),
                 unname(comptes_sous_bloc_analytiques_reels[[nom]]), info = nom)
  }

  # les comptes par niveau du sous-bloc (la forme « comptes par niveau » de
  # l'acceptance) : l'offre TC ne couvre que les 1 200 communes à bâtiments
  # (les îles sans bâtiment géocodé n'ont pas de part) ; bornes, vélo et
  # l'offre cyclable couvrent les 1 202 communes du référentiel (× 5 mesures
  # pour l'offre cyclable).
  offre <- readRDS(file.path(sortie_analytiques, "offre_territoires.rds"))
  expect_named(offre, c("code", "key", "detail", "value"))
  comptes_offre <- table(offre$key, type_territoire_mobilite(offre$code))
  for (cle in names(comptes_offre_par_niveau_reels)) {
    bits <- strsplit(cle, "_")[[1]]
    # le niveau est le DERNIER élément (« offre_tc_commune » → « commune ») ;
    # le préfixe est la clé du sous-bloc (« offre_tc », « bornes », « velo »,
    # « cyclable »)
    cle_key <- switch(paste(bits[-length(bits)], collapse = "_"),
                      offre_tc = "offre_tc",
                      bornes = "bornes_recharge",
                      velo = "places_stationnement_velo_1000",
                      cyclable = "offre_cyclable")
    niveau <- bits[length(bits)]
    expect_equal(unname(comptes_offre[cle_key, niveau]),
                 unname(comptes_offre_par_niveau_reels[[cle]]), info = cle)
  }

  # les valeurs VERROUILLÉES du sous-bloc sur les sources réelles (run
  # 2026-08-06 — la correction de la première passe) :
  #   - offre_tc : la VRAIE part des BÂTIMENTS à moins de 500 m à vol
  #     d'oiseau d'un arrêt GTFS (stops.txt Korrigo), par commune — Rennes
  #     0,9957 (la superficie communale donnait 0,40 — la divergence corrigée),
  #     Bohars 0,9182 (desservi par ARBUS), Quimper 0,9687 ; l'agrégat régional
  #     0,5731 = la moyenne pondérée par les bâtiments de la couche. Korrigo
  #     (GTFS) est une source VIVANTE re-téléchargée par la restauration du
  #     cache (issue #380) : verrous de VALEUR relatifs à l'époque du cache
  #     (re-baselinés, 4ᵉ décimale) ;
  #   - bornes_recharge : les stations IRVE distinctes — région 1 909,
  #     Ille-et-Vilaine 623, Rennes 49. Les bornes (IRVE) sont une source
  #     VIVANTE (issue #380) : verrous de VALEUR relatifs à l'époque du cache ;
  #   - places_stationnement_velo_1000 : le hub Ecolab 2025 pris tel quel —
  #     région 18,4989 (la même valeur que le fichier région du hub — la
  #     recomposition communale est exactement le calcul du hub) ;
  #   - offre_cyclable (issue #231) : la figure « L'offre cyclable » — la
  #     LONGUEUR en GÉOMÉTRIE UNIQUE (jamais le comptage par direction du mode
  #     `b`) : région 4 913,2 km de total cyclable (protégé 3 290,5 + partagé
  #     1 622,7 — le mode `b` par direction donne 4 940,3 : la différence de
  #     +0,5 % documentée par ADR-0016), le numérateur du headline « X % de
  #     l'infrastructure routière » (le dénominateur `c` — 101 373,6 km — est
  #     une ligne du payload, la règle du « dans l'EPCI : X % » d'ADR-0015 :
  #     l'app regarde les lignes existantes) ; Rennes 263,1 km (105,0 protégé
  #     + 158,1 partagé), Brest 126,4, Bohars 1,47, Plumieux 0 (la commune de
  #     la fusion COG 2022→2025 SANS aménagement — le zéro porté, jamais une
  #     ligne manquante).
  lire_offre <- function(code, key, detail = NA) {
    ok <- offre$code == code & offre$key == key &
      (if (is.na(detail)) is.na(offre$detail) else offre$detail %in% detail)
    offre$value[ok]
  }
  # offre_tc — commune, EPCI Brest Métropole, département 29, région
  expect_equal(round(lire_offre("35238", "offre_tc"), 4), 0.9957)
  expect_equal(round(lire_offre("29232", "offre_tc"), 4), 0.9687)
  expect_equal(round(lire_offre("29011", "offre_tc"), 4), 0.9182)
  expect_equal(round(lire_offre("242900314", "offre_tc"), 4), 0.9412)
  expect_equal(round(lire_offre("29", "offre_tc"), 4), 0.6761)
  expect_equal(round(lire_offre("53", "offre_tc"), 4), 0.5731)
  # la règle d'agrégation : un agrégat n'est JAMAIS la moyenne des parts
  # communales — le contraste réel (la moyenne des 1 200 parts communales vs
  # la valeur pondérée de la région)
  parts_communes_tc <- offre$value[offre$key == "offre_tc" &
                                     type_territoire_mobilite(offre$code) == "commune"]
  expect_false(isTRUE(all.equal(lire_offre("53", "offre_tc"),
                                mean(parts_communes_tc))))
  # les parts restent dans [0, 1]
  expect_true(all(!is.na(offre$value[offre$key == "offre_tc"]) &
                    offre$value[offre$key == "offre_tc"] >= 0 &
                    offre$value[offre$key == "offre_tc"] <= 1))
  # bornes_recharge — région, département, EPCI, communes (bornes IRVE : une
  # source VIVANTE — verrous relatifs à l'époque du cache, issue #380)
  expect_equal(lire_offre("53", "bornes_recharge"), 1909)
  expect_equal(lire_offre("35", "bornes_recharge"), 623)
  expect_equal(lire_offre("242900314", "bornes_recharge"), 74)
  expect_equal(lire_offre("35238", "bornes_recharge"), 49)
  expect_equal(lire_offre("29011", "bornes_recharge"), 1)
  # places_stationnement_velo_1000 — région, département, EPCI, communes
  expect_equal(round(lire_offre("53", "places_stationnement_velo_1000"), 4),
               18.4989)
  expect_equal(round(lire_offre("35", "places_stationnement_velo_1000"), 4),
               27.5650)
  expect_equal(round(lire_offre("35238", "places_stationnement_velo_1000"), 4),
               72.8043)
  expect_equal(round(lire_offre("29011", "places_stationnement_velo_1000"), 4),
               13.3479)

  # la figure « L'offre cyclable » (issue #231) — la clé multi-mesures aux
  # valeurs VERROUILLÉES sur le run réel : les longueurs en GÉOMÉTRIE UNIQUE
  # (protégé + partagé = total, exactement une somme) et les km/1 000 hab
  # RECOMPOSÉS depuis les parties (Σ km ÷ Σ population × 1 000)
  lire_cyclable <- function(code, detail) {
    lire_offre(code, "offre_cyclable", detail)
  }
  # région : protégé 3 290,5 km / partagé 1 622,7 / total 4 913,2 — le total
  # est le numérateur du ratio (le mode `b` par direction = 4 940,3 km, la
  # différence +0,5 % d'ADR-0016 : les deux conventions restent distinctes)
  expect_equal(round(lire_cyclable("53", "protege_longueur"), 3), 3290.494)
  expect_equal(round(lire_cyclable("53", "partage_longueur"), 3), 1622.739)
  expect_equal(round(lire_cyclable("53", "total_longueur"), 3), 4913.233)
  expect_equal(round(lire_cyclable("53", "protege_km_1000"), 6), 0.961333)
  expect_equal(round(lire_cyclable("53", "partage_km_1000"), 6), 0.474091)
  # le numérateur du headline : le total cyclable de la région vs le réseau
  # `c` (101 353,7 km — la ligne reseaux du payload, la règle du « dans
  # l'EPCI : X % » d'ADR-0015 : le dénominateur est une ligne existante,
  # l'app regarde, jamais une seconde mesure publiée) : ~4,85 %
  expect_equal(round(lire_cyclable("53", "total_longueur") /
                       lire_rt("53", "c_longueur"), 4), 0.0485)
  # Rennes : 263,1 km de total (105,0 protégé + 158,1 partagé) — la métropole
  # du sous-bloc, et ses km/1 000 hab
  expect_equal(round(lire_cyclable("35238", "protege_longueur"), 3), 105.005)
  expect_equal(round(lire_cyclable("35238", "partage_longueur"), 3), 158.103)
  expect_equal(round(lire_cyclable("35238", "total_longueur"), 3), 263.108)
  expect_equal(round(lire_cyclable("35238", "protege_km_1000"), 6), 0.460891)
  expect_equal(round(lire_cyclable("35238", "partage_km_1000"), 6), 0.693953)
  # Brest, Bohars, l'EPCI Rennes Métropole et le département 35
  expect_equal(round(lire_cyclable("29019", "total_longueur"), 3), 126.420)
  expect_equal(round(lire_cyclable("29011", "total_longueur"), 3), 1.473)
  expect_equal(round(lire_cyclable("243500139", "total_longueur"), 3), 678.612)
  expect_equal(round(lire_cyclable("35", "total_longueur"), 3), 1420.886)
  # Plumieux (22241 — la commune de la fusion COG 2022→2025) SANS aménagement
  # : le ZÉRO porté — un fait, jamais une ligne manquante, jamais supprimée
  expect_equal(lire_cyclable("22241", "total_longueur"), 0)
  expect_equal(lire_cyclable("22241", "protege_longueur"), 0)
  # l'île de Sein : zéro cyclable (le réseau `b` porte 0 aussi — le contraste
  # routier n'existe pas), l'île de Molène : 7,24 km de partagé
  expect_equal(lire_cyclable("29083", "total_longueur"), 0)
  expect_equal(round(lire_cyclable("29084", "partage_longueur"), 3), 7.239)
  # la règle d'agrégation : un km/1 000 hab de niveau = Σ km ÷ Σ population
  # (jamais la moyenne des taux communaux) — le contraste réel (la moyenne
  # des 1 202 taux communaux vs la valeur recomposée de la région)
  taux_communaux <- offre$value[
    offre$key == "offre_cyclable" & offre$detail == "protege_km_1000" &
      type_territoire_mobilite(offre$code) == "commune"]
  expect_false(isTRUE(all.equal(lire_cyclable("53", "protege_km_1000"),
                                mean(taux_communaux))))
  # toutes les valeurs publiées restent non négatives (le validateur du
  # payload couvre la nouvelle clé — jamais une longueur publiée négative)
  v_cyclable <- offre$value[offre$key == "offre_cyclable"]
  expect_true(all(!is.na(v_cyclable) & v_cyclable >= 0))

  # la couche communale de l'offre TC porte la VRAIE part des bâtiments (les
  # comptes qui la fondent — la correction de la méthode, jamais une part de
  # superficie) : Rennes 20 314 bâtiments proches sur 20 401
  offre_communes <- readRDS(file.path(sortie_analytiques, "offre_tc_communes.rds"))
  expect_named(offre_communes, c("commune", "n_batiments", "n_proches",
                                 "part_proche"))
  rennes <- offre_communes[offre_communes$commune == "35238", ]
  expect_equal(rennes$n_batiments, 20401L)
  expect_equal(rennes$n_proches, 20314L)
  expect_equal(round(rennes$part_proche, 4), 0.9957)

  # la couche communale de l'offre cyclable (issue #231) : UNE ligne par
  # commune de l'univers population (1 202 — la commune sans aménagement porte
  # 0, jamais une ligne manquante), la forme du contrat, la population portée
  # et Rennes aux valeurs verrouillées
  cyclable_communes <- readRDS(file.path(sortie_analytiques,
                                         "offre_cyclable_communes.rds"))
  expect_named(cyclable_communes, c("commune", "population",
                                    "protege_longueur", "partage_longueur",
                                    "total_longueur", "protege_km_1000",
                                    "partage_km_1000"))
  expect_equal(nrow(cyclable_communes), 1202)
  # 437 communes bretonnes SANS aménagement portent 0 (un fait — jamais
  # supprimées, jamais une ligne manquante)
  expect_equal(sum(cyclable_communes$total_longueur == 0), 437)
  rennes_c <- cyclable_communes[cyclable_communes$commune == "35238", ]
  expect_equal(round(rennes_c$total_longueur, 3), 263.108)
  expect_equal(round(rennes_c$protege_km_1000, 6), 0.460891)
  # l'île de Molène : 7,24 km de partagé (un fait de la donnée), l'île de Sein
  # : zéro (le zéro porté, jamais une ligne manquante)
  expect_equal(round(cyclable_communes$partage_longueur[
    cyclable_communes$commune == "29084"], 3), 7.239)
  expect_equal(cyclable_communes$total_longueur[
    cyclable_communes$commune == "29083"], 0)

  # les Stories : la lecture RÉSOLUE par (territoire, groupe) — le défaut
  # « vingt-minutes-sans-voiture » partout, la saillance « ce-que-le-velo-
  # preserve » qui REMPLACE le défaut là où le delta est réel (≥ 10) : une
  # ligne par territoire, jamais le pool (issue #312)
  h <- payload$histoires
  expect_named(h, c("territoire", "type", "theme", "groupe", "story_key",
                    "salience_reason",
                    "div_loss_t", "div_loss_b", "delta", "pct_iso_full_t",
                    "dens_min", "dens_max", paste0("dens_", 1:10),
                    paste0("dec_", 1:10), "classification_saillance",
                    "vintage_source", "vintage_version",
                    "vintage_date_reference", "vintage_date_publication"))
  expect_true(all(h$theme == "mobilite"))
  expect_true(all(h$groupe == "acces-aux-services"))
  expect_false(any(duplicated(h[c("territoire", "groupe")])))
  expect_equal(sum(h$story_key == "vingt-minutes-sans-voiture"),
               comptes_histoires_reels[["vingt_minutes_sans_voiture"]])
  expect_equal(sum(h$story_key == "ce-que-le-velo-preserve"),
               comptes_histoires_reels[["ce_que_le_velo_preserve"]])
  # la raison de saillance : « defaut » pour la lecture par défaut, la raison
  # déclarée du candidat quand la saillance a remplacé le défaut
  expect_true(all(h$salience_reason[h$story_key == "vingt-minutes-sans-voiture"] ==
                    "defaut"))
  expect_true(all(h$salience_reason[h$story_key == "ce-que-le-velo-preserve"] ==
                    "delta-velo-saillant"))
  vingt <- h[h$story_key == "vingt-minutes-sans-voiture", ]
  velo <- h[h$story_key == "ce-que-le-velo-preserve", ]
  # la Story de la région : « la même Story, pas de Story spéciale région »
  expect_equal(vingt$div_loss_t[vingt$territoire == "53"], 29)
  expect_equal(vingt$delta[vingt$territoire == "53"], 7)
  expect_equal(sum(vingt$type == "commune"), 1200 - 130)
  # la saillance : chaque ligne déclenchée porte un delta ≥ le seuil verrouillé
  expect_true(all(velo$delta >= SEUIL_SAILLANCE_VELO))
  expect_equal(sum(velo$type == "commune"), 130)
  expect_equal(sum(velo$type == "epci"), 9)
  # les estampilles du Story : le vintage de SA source (l'instantané du
  # snapshot — la ligne snapshot de la table des vintages, jamais le tampon
  # de thème, jamais les autres sources du thème)
  ref_story <- vintages$source[vintages$id == "mobilite_snapshot"]
  expect_true(all(h$vintage_source == ref_story))
  expect_true(all(h$vintage_date_reference == "2026-02-28"))

  # AUCUN artefact de fiche hors de la cible de publication : ni indicateurs, ni
  # histoires, ni territoires, ni aperçu, ni vintages, ni rapport de run — les
  # preuves vivent sous data/processed/, jamais publiées avant publish().
  # La garde cible les NOMS PUBLIÉS exacts, ancrés au début du nom (les
  # artefact analytiques nb_buildings_territoires.rds / mobilite_communes.rds
  # contiennent les mots « territoires »/« mobilite » — légitimes ici, jamais
  # un nom publié).
  motifs_fiche <- paste(
    "^indicateurs_mobilite", "^histoires_mobilite", "^territoires",
    "^apercu", "^vintages", "^run-report", sep = "|"
  )
  hors_cible <- c(sortie_analytiques,
                  file.path(cwd_run, "data", "processed", "mobilite"))
  for (dossier in hors_cible) {
    expect_false(any(grepl(motifs_fiche,
                           list.files(dossier, recursive = TRUE))),
                 info = dossier)
  }

  # la référence du déterminisme : les empreintes de CE run — le second test
  # relance une seule fois et compare contre elles
  reference_determinisme <<- list(
    analytiques = empreintes_binaires(sortie_analytiques),
    payload = empreintes_binaires(sortie, exclure = "run-report.json")
  )
})

test_that("un second run produit des tables analytiques et un payload octet-pour-octet identiques (déterminisme)", {
  skip_sans_donnees_reelles(fixtures_reelles_presentes(),
              "les fixtures réelles ne sont pas présentes (data/ est gitignoré).")

  racine <- tempfile("e2e-mob-det-")
  dir.create(racine)
  cache <- file.path(racine, "cache")
  cwd_run <- file.path(racine, "cwd")
  dir.create(cwd_run)
  sortie2 <- file.path(racine, "pub2")
  on.exit(unlink(racine, recursive = TRUE), add = TRUE)

  fabriquer_cache_e2e(cache)
  withr::local_dir(cwd_run)
  sortie_analytiques <- file.path(dirname(cache), "processed", "mobilite")

  # le second run : relancer produit LES MÊMES fichiers que la référence du
  # premier test — octet-pour-octet
  executer_run_reel(cache, sortie2)
  analytiques2 <- empreintes_binaires(sortie_analytiques)
  payload2 <- empreintes_binaires(sortie2, exclure = "run-report.json")

  # le déterminisme du chaînon analytique : les artefacts réels identiques
  expect_identical(analytiques2, reference_determinisme$analytiques)
  # le déterminisme du payload : tous les fichiers publiés identiques (le
  # run-report.json est exclu — il porte un horodatage par conception)
  expect_identical(payload2, reference_determinisme$payload)
  # et les comptes restent ceux du run verrouillé (jamais de doublon : le payload
  # EST l'état complet, la relance écrase)
  expect_equal(
    nrow(nanoparquet::read_parquet(file.path(sortie2, "indicateurs_mobilite.parquet"))),
    comptes_payload_reels[["indicateurs"]]
  )
  expect_equal(
    nrow(readRDS(file.path(sortie_analytiques, "nb_buildings_territoires.rds"))),
    comptes_analytiques_reels[["nb_buildings_territoires"]]
  )
})

test_that("un input corrompu arrête le run avant un payload partiel (jamais de succès partiel silencieux)", {
  skip_sans_donnees_reelles(fixtures_reelles_presentes(),
              "les fixtures réelles ne sont pas présentes (data/ est gitignoré).")

  racine <- tempfile("e2e-mob-fail-")
  dir.create(racine)
  cache <- file.path(racine, "cache")
  cwd_run <- file.path(racine, "cwd")
  dir.create(cwd_run)
  sortie <- file.path(racine, "pub")
  on.exit(unlink(racine, recursive = TRUE), add = TRUE)

  fabriquer_cache_e2e(cache)
  withr::local_dir(cwd_run)

  # les tables normalisées RÉELLES, puis UN input analytique corrompu : le
  # snapshot porté perd sa colonne nb_buildings (une vague qui change de
  # structure) — le chaînon analytique s'arrête sur la garde de forme, AVANT la
  # moindre écriture
  donnees <- construire_donnees_mobilite(cache = cache)
  donnees$mobilite_snapshot$nb_buildings <- NULL

  local_mocked_bindings(
    download_sources = function(manifest, cache, mode) statuts_mobilite(),
    construire_donnees_mobilite = function(cache) donnees,
    publier_geometrie = function(cible = "public/data", fetch = NULL) invisible(NULL),
    .package = "lusk"
  )

  # le run s'arrête bruyamment sur l'input corrompu, en nommant la colonne
  expect_error(
    run_pipeline(theme = theme_mobilite(), cache = cache, sortie = sortie),
    "nb_buildings"
  )

  # ...AVANT un payload partiel : ni la cible de publication ni le dossier
  # analytique n'existent — le chaînon n'a rien persisté, publish n'a jamais
  # tourné
  expect_false(dir.exists(sortie))
  expect_false(dir.exists(file.path(dirname(cache), "processed", "mobilite")))
})
