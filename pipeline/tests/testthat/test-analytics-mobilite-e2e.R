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
#     public/data du worktree n'est jamais touché) : 1 268 territoires × 1 clé
#     (nb_buildings — la « Taille » ; les clés de la grille sont assemblées par
#     le ticket payload #141), histoires aux deux story keys verrouillées
#     (« vingt-minutes-sans-voiture » 1 266 + « ce-que-le-velo-preserve » 139) ;
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
# Les vraies sources (le snapshot porté, le référentiel EPCI partagé et les
# cinq sources du sous-bloc « L'offre de mobilité alternative » — korrigo GTFS,
# mobibreizh-stops, communes-france, bornes-recharges, stationnement-velo)
# vivent sous pipeline/data/ (gitignoré). Absents hors worktree, le test saute
# proprement (comme les autres tests « données réelles »).
fixture_e2e_raw <- function(...) {
  testthat::test_path("..", "..", "data", "raw", ...)
}

fixtures_reelles_presentes <- function() {
  all(file.exists(
    fixture_e2e_raw("bretagne_mobility_super_dashboard_gravity.csv"),
    fixture_e2e_raw("extracted", "EPCI_au_01-01-2025.xlsx"),
    fixture_e2e_raw("korrigo-gtfs.zip"),
    fixture_e2e_raw("mobibreizh-stops.csv"),
    fixture_e2e_raw("communes-france.geojson"),
    fixture_e2e_raw("bornes-recharges.csv"),
    fixture_e2e_raw("stationnement-velo-commune.csv")
  ))
}

# fabriquer_cache_e2e -----------------------------------------------------------
# La couture de téléchargement MOCKÉE écrit dans le cache les artefacts réels du
# worktree (le réseau n'entre jamais dans la boucle) : le snapshot porté (le
# cache EST le CSV), le référentiel partagé EPCI (déjà extrait, la base que
# lire_epci consomme — jamais re-téléchargée) et les cinq sources du sous-bloc
# (issue #140 — le calcul de l'offre TC et des bornes/stationnement vélo
# consomme les fichiers réels).
fabriquer_cache_e2e <- function(cache) {
  dir.create(file.path(cache, "extracted"), recursive = TRUE, showWarnings = FALSE)
  file.copy(fixture_e2e_raw("bretagne_mobility_super_dashboard_gravity.csv"),
            cache, overwrite = TRUE)
  file.copy(fixture_e2e_raw("extracted", "EPCI_au_01-01-2025.xlsx"),
            file.path(cache, "extracted"), overwrite = TRUE)
  for (f in c("korrigo-gtfs.zip", "mobibreizh-stops.csv",
              "communes-france.geojson", "bornes-recharges.csv",
              "stationnement-velo-commune.csv")) {
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
#   - le sous-bloc (issue #140) : offre_tc_communes (1 202 communes × la part
#     à 500 m d'un arrêt — le référentiel complet, pas l'analyse), bornes_
#     communes (709 communes × le compte de stations IRVE — les codes hors
#     référentiel du fichier consolidé tombent), stationnement_velo_communes
#     (1 202 communes × places/1 000 hab, millésime 2025), offre_territoires
#     (3 804 lignes — 3 clés × 1 268 territoires : 1 202 communes + 61 EPCIs +
#     4 départements + la région, chaque indicateur agrégé par SA règle) ;
#   - payload : 1 268 territoires (1 202 communes + 61 EPCIs + 4 départements +
#     la région — le squelette partagé, les 2 communes hors snapshot portent NA
#     pour l'indicateur, jamais une ligne manquante), × 4 clés (nb_buildings —
#     la « Taille » — + offre_tc + bornes_recharge + places_stationnement_
#     velo_1000, le sous-bloc) ; histoires : 1 405 lignes — 1 266 « vingt-
#     minutes-sans-voiture » (une ligne par territoire, la Story par défaut) +
#     139 « ce-que-le-velo-preserve » (la saillance : 130 communes + 9 EPCIs au
#     delta ≥ 10) ; apercu vide (gating) ; vintages : 6 lignes (le snapshot +
#     les cinq sources du sous-bloc).
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
  isolation_rangs = 6340
)
# les comptes verrouillés du sous-bloc (issue #140) — verrouillés sur le run
# réel 2026-08-06 (les sources téléchargées : korrigo GTFS 2026-02, arrêts
# 2026-08-02, référentiel 2020-09, bornes 2026-07/08, hub vélo 2022-2025) :
#   - korrigo                     : 32 réseaux (agency.txt de l'export GTFS) ;
#   - mobibreizh_stops            : 24 380 arrêts ;
#   - communes_referentiel        : 1 202 communes (le référentiel breton) ;
#   - bornes_recharges            : 9 898 lignes de points de charge, 2 018
#     stations distinctes avec un code du référentiel (les codes postaux /
#     départementaux du fichier consolidé tombent) ;
#   - stationnement_velo          : 1 202 communes × 4 millésimes × 4 types —
#     la couverture bretonne VÉRIFIÉE à la lecture (l'acceptance) ;
#   - offre_tc_communes           : 1 202 lignes (la part à 500 m, la décision
#     de build : le proxy superficie communale couverte) — médiane 0,0417 ;
#   - bornes_communes             : 709 lignes (les communes du référentiel
#     avec ≥ 1 station), 1 918 stations au total ;
#   - stationnement_velo_communes : 1 202 lignes (le millésime 2025 — la
#     valeur du hub telle quelle) ;
#   - offre_territoires           : 3 804 lignes (3 clés × 1 268 territoires).
comptes_sources_offre_reels <- c(
  korrigo = 32,
  mobibreizh_stops = 24380,
  communes_referentiel = 1202,
  bornes_recharges = 9898,
  stationnement_velo = 4808
)
comptes_sous_bloc_analytiques_reels <- c(
  offre_tc_communes = 1202,
  bornes_communes = 709,
  stationnement_velo_communes = 1202,
  offre_territoires = 3804
)
# les comptes par niveau du sous-bloc (la forme « comptes par niveau » de
# l'acceptance) : 3 clés × le nombre de territoires du niveau.
comptes_offre_par_niveau_reels <- c(
  commune = 1202 * 3,
  epci = 61 * 3,
  departement = 4 * 3,
  region = 1 * 3
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
# les valeurs VERROUILLÉES du sous-bloc sur les sources réelles (run 2026-08-06)
#   - offre_tc (la part à 500 m, agrégat pondéré par les bâtiments) : région
#     0,26972 ; département 29 = 0,32446 ; Bohars (29011) = 0,44619 ;
#   - bornes_recharge (les stations) : région 1 918 ; Ille-et-Vilaine = 634 ;
#     Rennes (35238) = 49 ;
#   - places_stationnement_velo_1000 (le hub, millésime 2025) : région
#     18,49894 (la même valeur que le fichier région du hub — la recomposition
#     communale est exactement le calcul du hub) ; Ille-et-Vilaine = 27,56502 ;
#     Rennes (35238) = 72,80428.
valeurs_sous_bloc_reels <- list(
  offre_tc = c(
    "53" = 0.269720258054, "29" = 0.324457128656,
    "29011" = 0.446189545101, "35238" = 0.401909679433
  ),
  bornes_recharge = c(
    "53" = 1918, "35" = 634, "29011" = 1, "35238" = 49
  ),
  places_stationnement_velo_1000 = c(
    "53" = 18.4989387483, "35" = 27.5650179584,
    "29011" = 13.3478616181, "35238" = 72.8042838959
  )
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
comptes_payload_reels <- c(
  indicateurs = 5072,  # 4 clés × 1 268 territoires (nb_buildings + le sous-bloc)
  histoires = 1405,    # 1 266 « vingt-minutes-sans-voiture » + 139 « ce-que-le-vélo-préserve »
  territoires = 1268,  # 1 202 communes + 61 EPCIs + 4 départements + 1 région
  apercu = 0,          # le gating du thème : la table est présente mais vide
  vintages = 6         # le snapshot + les cinq sources du sous-bloc
)
# les comptes des Story keys (la forme multi-lignes du contrat histoires)
comptes_histoires_reels <- c(
  vingt_minutes_sans_voiture = 1266,
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
  # les QUATRE indicateurs publiés : la « Taille » du thème (le nombre de
  # bâtiments analysés par commune) + les trois clés du sous-bloc « L'offre de
  # mobilité alternative » (issue #140) — une ligne par territoire, avec leurs
  # rangs
  expect_setequal(unique(payload$indicateurs$key),
                  c("nb_buildings", "offre_tc", "bornes_recharge",
                    "places_stationnement_velo_1000"))
  for (cle in c("nb_buildings", "offre_tc", "bornes_recharge",
                "places_stationnement_velo_1000")) {
    expect_equal(sum(payload$indicateurs$key == cle), 1268, info = cle)
  }
  expect_true(all(c("rang_epci", "rang_dep", "rang_reg") %in%
                    names(payload$indicateurs)))
  # les deux communes hors snapshot (Île-de-Sein, Île-Molène) portent NA pour
  # la Taille (l'analyse ne les couvre pas) — jamais une ligne manquante ;
  # le sous-bloc, lui, les COUVRE (les sources couvrent tout le référentiel) :
  # l'offre TC et le stationnement vélo ont des valeurs réelles pour 29083
  expect_true(all(is.na(payload$indicateurs$value[
    payload$indicateurs$territoire %in% c("29083", "29084") &
      payload$indicateurs$key == "nb_buildings"])))
  expect_true(all(!is.na(payload$indicateurs$value[
    payload$indicateurs$territoire == "29083" &
      payload$indicateurs$key %in% c("offre_tc",
                                     "places_stationnement_velo_1000")])))
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
  # les estampilles T7 : CHAQUE indicateur porte le vintage de SA source de
  # référence (la « Taille » le snapshot porté ; le sous-bloc ses sources)
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
  # l'offre TC est estampillée des ARRÊTS (le vintage de la couche signature) ;
  # les bornes du fichier IRVE (référence 2026-07-28) ; le stationnement vélo
  # du hub (référence 2025-01-01, l'annuel 2022-2025)
  ref_arrets <- vintages[vintages$id == "mobibreizh-stops", ]
  expect_true(all(pour("offre_tc")$vintage_source == ref_arrets$source))
  expect_true(all(pour("offre_tc")$vintage_date_reference == "2026-08-02"))
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
  # les trois rangs, alignés sur la référence (les 2 communes hors snapshot
  # portent NA, jamais une ligne manquante)
  rangs <- readRDS(file.path(sortie_analytiques, "isolation_rangs.rds"))
  expect_named(rangs, c("code", "key", "rang_epci", "rang_dep", "rang_reg"))
  expect_equal(length(unique(rangs$code)), 1268)
  expect_true(all(is.na(rangs$rang_epci[rangs$code %in% c("29083", "29084")])))

  # le sous-bloc « L'offre de mobilité alternative » (issue #140) -----------
  # Les sources normalisées, aux comptes réels verrouillés : les 32 réseaux
  # Korrigo, les 24 380 arrêts, le référentiel des 1 202 communes, les 9 898
  # lignes IRVE, et la couverture bretonne VÉRIFIÉE du hub stationnement vélo
  # (1 202 communes × 4 millésimes × 4 types = 4 808 lignes — l'acceptance).
  sources <- construire_sources_offre_mobilite(cache)
  for (nom in names(comptes_sources_offre_reels)) {
    expect_equal(nrow(sources[[nom]]), unname(comptes_sources_offre_reels[[nom]]),
                 info = nom)
  }
  # la couverture bretonne du hub est la VÉRIFICATION demandée par le contrat :
  # les 1 202 communes bretonnes, tous millésimes (2022-2025) et types présents
  expect_setequal(unique(sources$stationnement_velo$geocode_commune),
                  unique(as.character(sf::st_drop_geometry(
                    sources$communes_referentiel)$com_code)))
  expect_setequal(unique(sources$stationnement_velo$annee),
                  c("2022", "2023", "2024", "2025"))

  # les tables COMMUNALES persistées, aux comptes réels verrouillés
  for (nom in names(comptes_sous_bloc_analytiques_reels)) {
    expect_equal(nrow(readRDS(file.path(sortie_analytiques, paste0(nom, ".rds")))),
                 unname(comptes_sous_bloc_analytiques_reels[[nom]]), info = nom)
  }
  # l'offre TC : la part à 500 m dans [0, 1], le proxy superficie communale —
  # 357 communes sans aucun arrêt à 500 m, la médiane réelle ~0,04, la valeur
  # de Bohars verrouillée
  tc <- readRDS(file.path(sortie_analytiques, "offre_tc_communes.rds"))
  expect_named(tc, c("commune", "part_proche"))
  expect_true(all(tc$part_proche >= 0 & tc$part_proche <= 1))
  expect_equal(sum(tc$part_proche == 0), 357)
  expect_equal(round(median(tc$part_proche), 4), 0.0417)
  # les bornes : un compte entier non négatif, le total réel 1 918 stations
  # (les codes hors référentiel du fichier consolidé tombent — le caveat
  # source), Rennes 49 stations
  born <- readRDS(file.path(sortie_analytiques, "bornes_communes.rds"))
  expect_named(born, c("commune", "nb_bornes"))
  expect_true(all(born$nb_bornes == floor(born$nb_bornes) & born$nb_bornes >= 0))
  expect_equal(sum(born$nb_bornes), 1918)
  expect_equal(born$nb_bornes[born$commune == "35238"], 49)
  # le stationnement vélo : pris TEL QUEL du hub, millésime 2025 partout, la
  # valeur de la région = la recomposition communale (le calcul du hub, vérifié
  # contre son fichier région : 18,49894 places/1 000 hab)
  vel <- readRDS(file.path(sortie_analytiques,
                           "stationnement_velo_communes.rds"))
  expect_named(vel, c("commune", "annee", "places", "population",
                      "places_1000"))
  expect_true(all(vel$annee == "2025"))
  expect_equal(round(sum(vel$places) / sum(vel$population) * 1000, 5),
               18.49894)

  # l'agrégation aux QUATRE niveaux : 3 clés × 1 268 territoires, les comptes
  # par niveau verrouillés (jamais une moyenne de valeurs)
  offre <- readRDS(file.path(sortie_analytiques, "offre_territoires.rds"))
  expect_named(offre, c("code", "key", "value"))
  expect_setequal(unique(offre$key), c("offre_tc", "bornes_recharge",
                                       "places_stationnement_velo_1000"))
  comptes_offre <- table(type_territoire_mobilite(offre$code), offre$key)
  for (niveau in names(comptes_offre_par_niveau_reels)) {
    expect_equal(sum(comptes_offre[niveau, ]),
                 unname(comptes_offre_par_niveau_reels[[niveau]]),
                 info = niveau)
  }
  # les valeurs VERROUILLÉES : la région (l'agrégat pondéré par les bâtiments
  # pour la part, la somme pour les bornes, Σ places ÷ Σ population pour le
  # taux), un département et deux communes
  for (cle in names(valeurs_sous_bloc_reels)) {
    for (code in names(valeurs_sous_bloc_reels[[cle]])) {
      attendue <- valeurs_sous_bloc_reels[[cle]][[code]]
      reelle <- offre$value[offre$key == cle & offre$code == code]
      if (cle == "bornes_recharge") {
        expect_equal(reelle, attendue, info = paste(cle, code))
      } else {
        expect_equal(round(reelle, 6), round(attendue, 6),
                     info = paste(cle, code))
      }
    }
  }
  # la règle d'agrégation : l'offre TC de la région n'est JAMAIS la moyenne
  # des parts communales (le contraste réel, comme la grille d'isolation)
  parts_communales <- offre$value[offre$key == "offre_tc" &
                                    type_territoire_mobilite(offre$code) == "commune"]
  region_tc <- offre$value[offre$key == "offre_tc" & offre$code == "53"]
  expect_false(isTRUE(all.equal(region_tc, mean(parts_communales))))

  # le payload : les trois clés du sous-bloc portent leurs valeurs et rangs,
  # alignées sur la référence (1 268 lignes par clé, les îles incluses pour
  # les clés qui les couvrent)
  for (cle in c("offre_tc", "bornes_recharge", "places_stationnement_velo_1000")) {
    lignes <- payload$indicateurs[payload$indicateurs$key == cle, ]
    expect_equal(nrow(lignes), 1268, info = cle)
    expect_true(all(c("rang_epci", "rang_dep", "rang_reg") %in% names(lignes)))
    expect_false(any(is.na(lignes$vintage_source)), info = cle)
  }

  # les Stories : les deux story keys aux comptes verrouillés — le défaut
  # « vingt-minutes-sans-voiture » une ligne par territoire, la saillance
  # « ce-que-le-velo-preserve » seulement où le delta est réel (≥ 10)
  h <- payload$histoires
  expect_named(h, c("territoire", "type", "theme", "story_key",
                    "div_loss_t", "div_loss_b", "delta", "pct_iso_full_t",
                    "dens_min", "dens_max", paste0("dens_", 1:10),
                    paste0("dec_", 1:10), "classification_saillance",
                    "vintage_source", "vintage_version",
                    "vintage_date_reference", "vintage_date_publication"))
  expect_true(all(h$theme == "mobilite"))
  expect_equal(sum(h$story_key == "vingt-minutes-sans-voiture"),
               comptes_histoires_reels[["vingt_minutes_sans_voiture"]])
  expect_equal(sum(h$story_key == "ce-que-le-velo-preserve"),
               comptes_histoires_reels[["ce_que_le_velo_preserve"]])
  vingt <- h[h$story_key == "vingt-minutes-sans-voiture", ]
  velo <- h[h$story_key == "ce-que-le-velo-preserve", ]
  # la Story de la région : « la même Story, pas de Story spéciale région »
  expect_equal(vingt$div_loss_t[vingt$territoire == "53"], 29)
  expect_equal(vingt$delta[vingt$territoire == "53"], 7)
  expect_equal(sum(vingt$type == "commune"), 1200)
  # la saillance : chaque ligne déclenchée porte un delta ≥ le seuil verrouillé
  expect_true(all(velo$delta >= SEUIL_SAILLANCE_VELO))
  expect_equal(sum(velo$type == "commune"), 130)
  expect_equal(sum(velo$type == "epci"), 9)
  # les estampilles du Story : le vintage de SA source (l'instantané du
  # snapshot — les Stories sourcent l'analyse portée, jamais un tampon du
  # sous-bloc)
  tampon_histoires <- vintages[vintages$id == "mobilite_snapshot", ]
  expect_true(all(h$vintage_source == tampon_histoires$source))
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
