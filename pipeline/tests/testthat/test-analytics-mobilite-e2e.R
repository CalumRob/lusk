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
# Le vrai snapshot porté, le référentiel EPCI partagé et les sources de
# l'étage demande/réseaux (issue #139 : le cube RP voitures, l'extrait OSM
# Geofabrik, les limites communales) vivent sous pipeline/data/ (gitignoré).
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
    fixture_e2e_raw("communes_limites.geojson")
  ))
}

# fabriquer_cache_e2e -----------------------------------------------------------
# La couture de téléchargement MOCKÉE écrit dans le cache les artefacts réels du
# worktree (le réseau n'entre jamais dans la boucle) : le snapshot porté (le
# cache EST le CSV), le référentiel partagé EPCI (déjà extrait, la base que
# lire_epci consomme — jamais re-téléchargée) et, depuis l'issue #139, les
# trois sources de l'étage demande/réseaux (le cube RP voitures, l'extrait OSM,
# les limites communales).
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
#   - L'étage demande/réseaux (issue #139) : voitures_communes (1 202 communes
#     du cube RP exploitation principale — TOUTES les communes bretonnes, le RP
#     couvre ce que l'analyse d'accessibilité ne couvre pas), voitures_
#     territoires (1 268 territoires × 2 parts = 2 536 lignes — la moyenne
#     pondérée par les ménages), reseaux_communes (1 202 communes × 6 mesures)
#     et reseaux_territoires (1 268 × 6 = 7 608 lignes — longueurs sommées,
#     densités Σ L ÷ Σ surface) ;
#   - payload : 1 268 territoires (1 202 communes + 61 EPCIs + 4 départements +
#     la région — le squelette partagé, les 2 communes hors snapshot portent NA
#     pour l'indicateur, jamais une ligne manquante), × 3 clés (nb_buildings +
#     voitures_menage × 2 parts + reseaux × 6 mesures = 11 412 lignes) ;
#     histoires : 1 405 lignes — 1 266 « vingt-minutes-sans-voiture » (une
#     ligne par territoire, la Story par défaut) + 139 « ce-que-le-velo-
#     preserve » (la saillance : 130 communes + 9 EPCIs au delta ≥ 10) ;
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
comptes_payload_reels <- c(
  indicateurs = 11412,  # 1 268 territoires × (nb_buildings 1 + voitures 2 + reseaux 6)
  histoires = 1405,    # 1 266 « vingt-minutes-sans-voiture » + 139 « ce-que-le-vélo-préserve »
  territoires = 1268,  # 1 202 communes + 61 EPCIs + 4 départements + 1 région
  apercu = 0,          # le gating du thème : la table est présente mais vide
  vintages = 4         # une ligne par source du manifeste (snapshot + demande + reseaux + limites)
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
  # les clés publiées (issue #139 : la « Taille » + l'étage demande/réseaux) :
  # une ligne par territoire × multiplicité, avec leurs rangs — la grille
  # d'isolation et le Story complet arrivent aux tickets #138/#141
  expect_setequal(unique(payload$indicateurs$key),
                  c("nb_buildings", "voitures_menage", "reseaux"))
  expect_equal(sum(payload$indicateurs$key == "nb_buildings"), 1268)
  expect_equal(sum(payload$indicateurs$key == "voitures_menage"), 2536)
  expect_equal(sum(payload$indicateurs$key == "reseaux"), 7608)
  expect_true(all(c("rang_epci", "rang_dep", "rang_reg") %in%
                    names(payload$indicateurs)))
  # les deux communes hors snapshot (Île-de-Sein, Île-Molène) portent NA pour
  # la « Taille » — jamais une ligne manquante (l'alignement sur la référence
  # du squelette). Le RP, lui, couvre Île-de-Sein (voitures 0.603 sans voiture)
  expect_true(all(is.na(payload$indicateurs$value[
    payload$indicateurs$territoire %in% c("29083", "29084") &
      payload$indicateurs$key == "nb_buildings"])))
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
  expect_equal(round(rennes_sans$rang_epci, 4), 0.9767)
  expect_equal(round(rennes_sans$rang_reg, 4), 0.9933)
  expect_equal(round(lire_ind("35238", "voitures_menage", "deux_plus")$value, 6),
               0.150348)
  # l'île de Sein : sans EPCI → pas de rang EPCI (jamais un rang fantôme), et
  # la part sans voiture la plus forte de Bretagne (60 % — une île)
  sein_sans <- lire_ind("29083", "voitures_menage", "sans_voiture")
  expect_equal(round(sein_sans$value, 6), 0.603082)
  expect_true(is.na(sein_sans$rang_epci))
  expect_equal(round(sein_sans$rang_dep, 4), 0.9892)
  # l'étage réseaux (issue #139) : les longueurs/densités de la région
  # (longueurs SOMMÉES, densités Σ L ÷ Σ surface) et de Rennes
  expect_equal(round(lire_ind("53", "reseaux", "c_longueur")$value, 3),
               101353.736)
  expect_equal(round(lire_ind("53", "reseaux", "c_densite")$value, 6),
               3.692786)
  expect_equal(round(lire_ind("53", "reseaux", "b_longueur")$value, 3),
               950.721)
  expect_equal(round(lire_ind("53", "reseaux", "b_densite")$value, 6),
               0.034639)
  expect_equal(round(lire_ind("53", "reseaux", "t_longueur")$value, 3),
               6732.870)
  expect_equal(round(lire_ind("53", "reseaux", "t_densite")$value, 6),
               0.245310)
  rennes_c <- lire_ind("35238", "reseaux", "c_densite")
  expect_equal(round(rennes_c$value, 6), 18.162491)
  expect_equal(round(rennes_c$rang_reg, 4), 0.9967)
  expect_equal(round(lire_ind("242900314", "reseaux", "c_densite")$value, 6),
               8.946547)
  # les estampilles T7 : chaque indicateur porte le vintage de SA source de
  # référence (la « Taille » → le snapshot ; la demande → le RP exploitation
  # principale ; les réseaux → l'extrait OSM, le timestamp d'extraction)
  vintages <- vintages_mobilite()
  ind_mob <- payload$indicateurs
  expect_true(all(ind_mob$vintage_source[ind_mob$key == "nb_buildings"] ==
                    vintages$source[vintages$id == "mobilite_snapshot"]))
  expect_true(all(ind_mob$vintage_date_reference[ind_mob$key == "nb_buildings"] ==
                    "2026-02-28"))
  expect_true(all(ind_mob$vintage_source[ind_mob$key == "voitures_menage"] ==
                    vintages$source[vintages$id == "rp_logement_princ"]))
  expect_true(all(ind_mob$vintage_date_reference[
    ind_mob$key == "voitures_menage"] == "2023-01-01"))
  expect_true(all(ind_mob$vintage_date_publication[
    ind_mob$key == "voitures_menage"] == "2026-07-29"))
  expect_true(all(ind_mob$vintage_source[ind_mob$key == "reseaux"] ==
                    vintages$source[vintages$id == "osm_reseaux"]))
  expect_true(all(ind_mob$vintage_date_reference[ind_mob$key == "reseaux"] ==
                    "2026-08-05"))
  expect_true(all(ind_mob$vintage_date_publication[ind_mob$key == "reseaux"] ==
                    "2026-08-06"))

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
  # jamais la moyenne des densités communales). La région : 101 354 km de
  # routes (3.69 km/km²), 951 km de pistes cyclables, 6 733 km de trottoirs.
  rt <- readRDS(file.path(sortie_analytiques, "reseaux_territoires.rds"))
  expect_named(rt, c("code", "key", "detail", "value"))
  expect_true(all(rt$key == "reseaux"))
  expect_setequal(unique(rt$detail),
                  c("t_longueur", "t_densite", "b_longueur", "b_densite",
                    "c_longueur", "c_densite"))
  lire_rt <- function(code, detail) rt$value[rt$code == code & rt$detail == detail]
  expect_equal(round(lire_rt("53", "c_longueur"), 3), 101353.736)
  expect_equal(round(lire_rt("53", "c_densite"), 6), 3.692786)
  expect_equal(round(lire_rt("53", "b_longueur"), 3), 950.721)
  expect_equal(round(lire_rt("53", "b_densite"), 6), 0.034639)
  expect_equal(round(lire_rt("53", "t_longueur"), 3), 6732.870)
  expect_equal(round(lire_rt("53", "t_densite"), 6), 0.245310)
  # le contraste urbain : Rennes à 18.16 km/km² de routes (la densité la plus
  # forte de Bretagne), Brest Métropole à 8.95, l'île de Sein sans réseau
  # cyclable (0 km — un fait, jamais une ligne manquante)
  expect_equal(round(lire_rt("35238", "c_densite"), 6), 18.162491)
  expect_equal(round(lire_rt("242900314", "c_densite"), 6), 8.946547)
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
  # les trois rangs, alignés sur la référence (les 2 communes hors snapshot
  # portent NA, jamais une ligne manquante)
  rangs <- readRDS(file.path(sortie_analytiques, "isolation_rangs.rds"))
  expect_named(rangs, c("code", "key", "rang_epci", "rang_dep", "rang_reg"))
  expect_equal(length(unique(rangs$code)), 1268)
  expect_true(all(is.na(rangs$rang_epci[rangs$code %in% c("29083", "29084")])))

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
  # snapshot — jamais les autres sources du thème)
  expect_true(all(h$vintage_source ==
                    vintages$source[vintages$id == "mobilite_snapshot"]))
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
