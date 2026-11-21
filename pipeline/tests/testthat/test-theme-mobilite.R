# test-theme-mobilite ----------------------------------------------------------
# Le descripteur du thème Mobilité (issue #137, tracer bullet) : la même forme
# de contrat que theme_economie() / theme_demographie() — tout ce que la
# machinerie partagée doit savoir pour faire tourner Mobilité sans jamais
# nommer le thème : le manifeste de la source portée (l'analyse d'accessibilité
# « Vingt minutes sans voiture », épinglée comme un instantané), le builder de
# données (la normalisation du snapshot porté), les vintages (la date
# d'instantané de l'analyse comme référence, la date de portage comme
# publication) et le seam de calcul/publication. L'assembleur ne CALCULE rien
# (les 5 parts d'isolation, div_loss et la Story arrivent au ticket #138) et ne
# PUBLIE rien par lui-même : il lie les pièces existantes.


test_that("MANIFEST_MOBILITE : les quinze sources retenues, les 11 colonnes standard", {
  m <- MANIFEST_MOBILITE
  expect_s3_class(m, "tbl_df")
  expect_equal(nrow(m), 15L)
  expect_equal(nrow(m), length(unique(m$id)))
  expect_setequal(m$id,
                  c("rp_logement_princ", "osm_reseaux", IDS_OCSGE_RESEAUX,
                    "amenagements_cyclables", "communes_limites", "korrigo",
                    "bornes-recharges", "stationnement-velo", "bpe_b316",
                    "cog_passage", "sncf_voyageurs", "dila_bdl"))
  # les deux fragments retirés (#1048) ne figurent plus dans le manifeste
  expect_false(any(c("mobilite_snapshot", "batiments_residentiels") %in% m$id))
  expect_false(any(grepl(
    "bretagne_mobility_super_dashboard_gravity|batiments_residentiels_bretagne",
    m$fichier)))
  expect_true(all(c("id", "source", "url", "fichier", "vintage",
                    "date_reference", "date_publication", "licence",
                    "note", "mode", "type") %in% names(m)))
  expect_false(any(grepl("align", tolower(names(m)))))
  # le spine d'adresses AEDAR n'est PAS une ligne du manifeste Mobilité : il
  # est lu par son identifiant enregistré dans aedar_aggregates.R
  expect_false("aedar-address-origins-2026v1.parquet" %in% m$fichier)
  expect_equal(m$licence[m$id == "korrigo"], "odbl")
  expect_equal(m$licence[m$id == "bornes-recharges"], "lov2")
  expect_equal(m$licence[m$id == "stationnement-velo"], "odbl")
  expect_true(all(m$mode[m$id %in% c("korrigo", "bornes-recharges",
                                     "stationnement-velo")] == "cron"))
})


test_that("theme_mobilite : le descripteur porte les membres requis du contrat", {
  th <- theme_mobilite()

  # la forme du contrat : les membres requis dans l'ordre — `directions`
  # (issue #368 : chaque clé classée déclare SA direction) est un membre
  # REQUIS, pas une option
  expect_named(th, MEMBRES_DESCRIPTEUR_MOBILITE)
  expect_equal(th$theme, "mobilite")
  expect_identical(th$manifest, MANIFEST_MOBILITE)
  # les pièces que run_pipeline(theme = theme_mobilite()) consomme
  expect_true(is.function(th$vintages))
  expect_true(is.function(th$construire_donnees))
  expect_true(is.function(th$construire_analytiques))
  expect_true(is.function(th$publier))

  # le descripteur réel passe sa propre validation de forme
  expect_true(verifier_descripteur_mobilite(th))
})

test_that("verifier_descripteur_mobilite : un membre requis manquant échoue bruyamment", {
  th <- theme_mobilite()

  # chaque membre requis est indispensable : retirer n'importe lequel échoue en
  # NOMmant le membre fautif (jamais un échec silencieux)
  for (membre in MEMBRES_DESCRIPTEUR_MOBILITE) {
    defectueux <- th[setdiff(names(th), membre)]
    expect_error(verifier_descripteur_mobilite(defectueux), membre, info = membre)
  }

  # un descripteur vide échoue aussi
  expect_error(verifier_descripteur_mobilite(list()), "manquant")

  # le cas nommé de l'audit ordinal (issue #368) : un descripteur SANS la
  # déclaration des directions échoue FORT — jamais le défaut high-is-good
  # silencieux de la machinerie
  sans_directions <- th[setdiff(names(th), "directions")]
  expect_error(verifier_descripteur_mobilite(sans_directions), "directions")
})


test_that("vintages_mobilite : quinze sources publiques incluent la production nationale du raccordement", {
  v <- vintages_mobilite()
  expect_equal(nrow(v), 15L)

  expect_named(v, c("id", "source", "version", "licence",
                    "date_reference", "date_publication"))
  expect_setequal(v$id,
                  c("rp_logement_princ", "osm_reseaux", "amenagements_cyclables",
                    "communes_limites", "korrigo", "bornes-recharges",
                    "stationnement-velo", "bpe_b316", "cog_passage",
                    "sncf_voyageurs", "dila_bdl",
                    "matrice_temps_mairies", "population_raccordement",
                    "raccordement_gtfs_national", "ocsge_reseaux_routiers"))
  expect_false("batiments_residentiels" %in% v$id)
  expect_false("accessibilite_batiments" %in% v$id)
  # #1048 (slice 2) : la ligne temporaire du snapshot porté a quitté la table
  # avec sa dernière référence dans le catalogue épinglé.
  expect_false(any(grepl("snapshot", v$id)))

  # le raccordement : l'horloge du FIGÉ
  mat <- v[v$id == "matrice_temps_mairies", ]
  expect_equal(mat$version, "2026-09-16")
  expect_equal(mat$date_reference, "2026-08-25")
  expect_equal(mat$date_publication, "2026-08-26")
  national <- v[v$id == "raccordement_gtfs_national", ]
  expect_equal(national$version, "2026-10-21")
  expect_equal(national$date_reference, "2026-10-10")
  expect_equal(national$date_publication, "2026-10-10")
  pop_rac <- v[v$id == "population_raccordement", ]
  expect_equal(pop_rac$version, "2023")
  expect_equal(pop_rac$date_reference, "2023-01-01")

  rp <- v[v$id == "rp_logement_princ", ]
  expect_equal(rp$version, "2023")
  expect_equal(rp$date_reference, "2023-01-01")
  expect_equal(rp$licence, "lov2")
  osm <- v[v$id == "osm_reseaux", ]
  # Issue #1099 : OSM est une source DÉRIVÉE — son vintage publié est celui du
  # pin (timestamp du HeaderBlock PBF), jamais un mois écrit en dur ici.
  pin_osm <- lire_pin("osm_reseaux")
  if (!is.null(pin_osm) && !is.null(pin_osm$vintage)) {
    expect_equal(osm$version, pin_osm$vintage)
    expect_equal(osm$date_reference, pin_osm$date_reference)
    expect_equal(osm$date_publication, pin_osm$downloaded_at)
  } else {
    expect_equal(osm$version, MANIFEST_MOBILITE_OSM_RESEAUX$vintage)
  }
  lim <- v[v$id == "communes_limites", ]
  expect_equal(lim$date_reference, "2025-01-01")
  expect_true(is.na(lim$date_publication))
  expect_equal(v$licence[v$id == "korrigo"], "odbl")
  expect_equal(v$licence[v$id == "bornes-recharges"], "lov2")
  expect_equal(v$licence[v$id == "stationnement-velo"], "odbl")
  for (i in seq_len(nrow(v))) {
    if (!is.na(v$date_publication[i]))
      expect_true(as.Date(v$date_reference[i]) <= as.Date(v$date_publication[i]))
  }
})

test_that("verifier_contrat_mobilite_demande_reseaux : les trois sources de l'étage demande/réseaux, épinglées", {
  # le manifeste réel passe la validation des fragments demande/réseaux
  expect_true(verifier_contrat_mobilite_demande_reseaux(MANIFEST_MOBILITE))

  # voitures/ménage : LE fichier RP exploitation principale épinglé (le code de
  # table LOG T12 — jamais un autre fichier MELODI du dossier complet, qui ne
  # porte pas les voitures), licence Ouverte, mode cron (fichier melodi normal)
  defectueux <- MANIFEST_MOBILITE
  defectueux$fichier[defectueux$id == "rp_logement_princ"] <-
    "DS_RP_MENAGES_COMP_2023_CSV_FR.zip"
  expect_error(verifier_contrat_mobilite_demande_reseaux(defectueux),
               "DS_RP_LOGEMENT_PRINC")
  defectueux <- MANIFEST_MOBILITE
  defectueux$licence[defectueux$id == "rp_logement_princ"] <- "odbl"
  expect_error(verifier_contrat_mobilite_demande_reseaux(defectueux), "lov2")

  # réseaux : LE pbf Geofabrik épinglé, ODbL (ADR-0001), mode manuel (l'extrait
  # 312 Mo — jamais un cron), et la référence est le timestamp d'extraction
  # (le vintage n'est JAMAIS « aujourd'hui » : référence ≤ publication)
  defectueux <- MANIFEST_MOBILITE
  defectueux$fichier[defectueux$id == "osm_reseaux"] <- "france-latest.osm.pbf"
  expect_error(verifier_contrat_mobilite_demande_reseaux(defectueux),
               "bretagne-latest")
  defectueux <- MANIFEST_MOBILITE
  defectueux$licence[defectueux$id == "osm_reseaux"] <- "lov2"
  expect_error(verifier_contrat_mobilite_demande_reseaux(defectueux), "odbl")
  defectueux <- MANIFEST_MOBILITE
  defectueux$mode[defectueux$id == "osm_reseaux"] <- "cron"
  expect_error(verifier_contrat_mobilite_demande_reseaux(defectueux), "manuel")
  defectueux <- MANIFEST_MOBILITE
  defectueux$date_reference[defectueux$id == "osm_reseaux"] <- "2026-08-06"
  expect_error(verifier_contrat_mobilite_demande_reseaux(defectueux), "extraction")

  # limites communales : le WFS Admin Express épinglé, Licence Ouverte
  defectueux <- MANIFEST_MOBILITE
  defectueux$fichier[defectueux$id == "communes_limites"] <- "autre.geojson"
  expect_error(verifier_contrat_mobilite_demande_reseaux(defectueux),
               "communes_limites")
})




test_that("construire_donnees_mobilite : assemble le spine d'adresses et toutes les sources du thème", {
  table_amenagements <- sf::st_sf(
    id_local = "geovelo_1_29011", code_com_d = "29011", code_com_g = "29011",
    ame_d = "PISTE CYCLABLE", ame_g = "AUCUN",
    sens_d = "UNIDIRECTIONNEL", sens_g = NA_character_,
    geometry = sf::st_sfc(sf::st_linestring(rbind(c(-1.5, 48.5), c(-1.49, 48.5)))),
    crs = 4326
  )
  table_ocsge <- sf::st_sf(
    code_us = "US4.1.1", aire_m2 = 400, millesime = 2025L, departement = "22",
    geometry = sf::st_sfc(sf::st_polygon(list(rbind(
      c(0, 0), c(20, 0), c(20, 20), c(0, 20), c(0, 0)
    ))), crs = 2154)
  )
  appels <- new.env()
  local_mocked_bindings(
    lire_voitures_communes = function(chemin) {
      appels$voitures <- chemin
      tibble::tibble(commune = "29011", menages_total = 100,
                     menages_sans_voiture = 10, menages_une_voiture = 70,
                     menages_deux_plus = 20)
    },
    lire_communes_limites = function(chemin) {
      appels$limites <- chemin
      sf::st_sf(code_insee = "29011",
                geometry = sf::st_sfc(sf::st_polygon(
                  list(rbind(c(0, 0), c(1, 0), c(1, 1), c(0, 1), c(0, 0))))),
                crs = 2154)
    },
    lire_lignes_osm = function(chemin) {
      appels$osm <- chemin
      sf::st_sf(osm_id = 1L, highway = "residential",
                geometry = sf::st_sfc(sf::st_linestring(rbind(c(0, 0), c(1, 0)))),
                crs = 2154)
    },
    construire_donnees_ocsge_reseaux_routiers = function(cache, manifest) {
      appels$ocsge <- list(cache = cache, manifest = manifest)
      table_ocsge
    },
    construire_mappe_cog_bretagne = function(chemin_zip) {
      appels$cog <- chemin_zip
      tibble::tribble(~code_2022, ~code_2025, "29011", "29011")
    },
    construire_amenagements_cyclables = function(chemin_parquet, sortie,
                                                 vintage, mappe, lire) {
      appels$amenagements <- chemin_parquet
      appels$amenagements_sortie <- sortie
      appels$amenagements_vintage <- vintage
      list(vintage = vintage, table = table_amenagements)
    },
    construire_sources_offre_mobilite = function(cache) {
      appels$sources <- cache
      list(parkings_osm = sf::st_sf(osm_id = "p1", amenity = "parking",
                                   geometry = sf::st_sfc(sf::st_polygon(list(rbind(c(0,0), c(1,0), c(1,1), c(0,1), c(0,0))))), crs = 2154),
           stations_service = tibble::tibble(commune = "29011", fuel = 1),
           korrigo = tibble::tibble(stop_id = "AR1"),
           adresses_residentielles = sf::st_sf(
             address_id = "a1", code_commune_insee = "29011",
             geometry = sf::st_sfc(sf::st_point(c(0, 0)), crs = 2154)),
           bornes_recharges = tibble::tibble(code_insee_commune = "29011"),
           stationnement_velo = tibble::tibble(geocode_commune = "29011"))
    },
    .package = "lusk"
  )
  donnees <- construire_donnees_mobilite(cache = "cache-test")
  expect_named(donnees,
                c("voitures_communes", "communes_limites", "lignes_osm",
                  "ocsge_reseaux_routiers", "parkings_osm",
                  "stations_service", "amenagements_cyclables", "couverture",
                  "korrigo", "adresses_residentielles",
                  "bornes_recharges", "stationnement_velo"))
  expect_false("mobilite_snapshot" %in% names(donnees))
  expect_equal(appels$voitures,
               file.path("cache-test", "DS_RP_LOGEMENT_PRINC_2023_CSV_FR.zip"))
  expect_equal(appels$limites,
               file.path("cache-test", "communes_limites.geojson"))
  expect_equal(appels$osm, file.path("cache-test", "bretagne-latest.osm.pbf"))
  expect_identical(appels$ocsge$manifest, MANIFEST_MOBILITE)
  expect_equal(appels$amenagements,
               file.path("cache-test", "france-20260807.parquet"))
  expect_equal(appels$amenagements_sortie,
               file.path("data/processed/mobilite", "amenagements_dernier_bon.rds"))
  expect_equal(appels$amenagements_vintage, "2026-08-07")
  expect_identical(donnees$amenagements_cyclables, table_amenagements)
  expect_equal(appels$sources, "cache-test")
})


test_that("construire_donnees_mobilite : une source manquante du cache s'arrête bruyamment", {
  local_mocked_bindings(
    lire_voitures_communes = function(chemin) {
      stop("Fichier absent : ", chemin, call. = FALSE)
    },
    .package = "lusk"
  )
  expect_error(construire_donnees_mobilite(cache = "cache-test"),
               "DS_RP_LOGEMENT_PRINC")
})


# Le chaînon analytique flagship (issue #138) ----------------------------------
# Les tests unitaires de la chaîne analytique Mobilité : la neutralité modale,
# les 5 parts d'isolation (recalculées depuis les parties — jamais une moyenne
# de parts), div_loss_t/b, la signature de densité, la saillance et les rangs.
# Le fixture est une forme RÉDUITE mais fidèle du snapshot porté : 4 communes
# sur 2 EPCIs / 2 départements, toutes les familles de colonnes que le chaînon
# consomme (share_*, med_div_loss_*, pct_iso_full_*, dens_div_t_*, div_loss_t_
# dec_*, et leurs niveaux _epci/_dep/_reg), avec UN delta vélo NÉGATIF (29002 :
# med_div_loss_b 41 > med_div_loss_t 40 — l'artefact non-production du PRD
# #136) pour exercer la garde de neutralité modale sur la base.

# fixture_snapshot_analytique_mobilite -----------------------------------------
# La table normalisée mini du chaînon (la forme que construire_donnees_mobilite
# persiste) : les colonnes d'identité + les familles du snapshot porté, en
# NUMÉRIQUE comme le normaliseur les livre. Les colonnes de signature de
# densité (dens_div_t_1..10, div_loss_t_dec_1..10 et leurs niveaux) sont
# générées programmatiquement — des valeurs simples, présentes pour la forme.
# Le bloc _epci de l'EPCI 200000002 est NA (comme Brest Métropole dans le vrai
# fichier — un trou du portage) : le niveau y est RECALCULÉ depuis les parties.

# base_epci_mini_analytique ----------------------------------------------------
# La forme de lire_epci (CODGEO / LIBGEO / EPCI / LIBEPCI / DEP / REG) du
# fixture : 4 communes, 2 EPCIs, 2 départements.
base_epci_mini_analytique <- function() {
  tibble::tribble(
    ~CODGEO, ~LIBGEO, ~EPCI, ~LIBEPCI, ~DEP, ~REG,
    "22001", "Commune A1", "200000001", "EPCI X", "22", "53",
    "22002", "Commune D", "200000001", "EPCI X", "22", "53",
    "29001", "Commune B", "200000002", "EPCI Y", "29", "53",
    "29002", "Commune C", "200000002", "EPCI Y", "29", "53"
  )
}



test_that("construire_analytiques_mobilite : le poids-Adresse et les builders retenus", {
  adresses <- sf::st_sf(
    address_id = c("a1", "a2"), code_commune_insee = c("22001", "22001"),
    geometry = sf::st_sfc(sf::st_point(c(0, 0)), sf::st_point(c(10, 10)), crs = 2154)
  )
  donnees <- list(
    adresses_residentielles = adresses,
    voitures_communes = tibble::tibble(commune = "22001", menages_total = 100),
    communes_limites = sf::st_sf(code_insee = "22001",
                                 geometry = sf::st_sfc(sf::st_polygon(
                                   list(rbind(c(0, 0), c(1, 0), c(1, 1),
                                              c(0, 1), c(0, 0))))), crs = 2154),
    lignes_osm = sf::st_sf(osm_id = 1L, highway = "residential",
                           geometry = sf::st_sfc(sf::st_linestring(rbind(c(0, 0), c(1, 0)))),
                           crs = 2154),
    ocsge_reseaux_routiers = sf::st_sf(
      code_us = "US4.1.1", aire_m2 = 400, departement = "22",
      geometry = sf::st_sfc(sf::st_polygon(list(rbind(
        c(0, 0), c(20, 0), c(20, 20), c(0, 20), c(0, 0)
      ))), crs = 2154)
    ),
    amenagements_cyclables = sf::st_sf(
      id_local = "g1", code_com_d = "22001", code_com_g = "22001",
      ame_d = "PISTE CYCLABLE", ame_g = "AUCUN",
      sens_d = "UNIDIRECTIONNEL", sens_g = NA_character_,
      geometry = sf::st_sfc(sf::st_linestring(rbind(c(0, 0), c(1, 0)))), crs = 2154),
    korrigo = tibble::tibble(stop_id = "AR1", stop_lat = 48.0, stop_lon = -1.0),
    bornes_recharges = tibble::tibble(code_insee_commune = "22001"),
    stationnement_velo = tibble::tibble(geocode_commune = "22001")
  )
  base_epci <- base_epci_mini_analytique()
  suivi <- new.env(); suivi$ordre <- character()
  pousser <- function(etape) suivi$ordre <- c(suivi$ordre, etape)
  local_mocked_bindings(
    construire_territoires_mobilite = function(base_epci, analytiques, ...) {
      pousser("territoires")
      expect_equal(analytiques$mobilite_communes$n_adresses, 2L)
      tibble::tibble(code = "22001", type = "commune")
    },
    calculer_voitures_communes = function(voitures) {
      pousser("voitures_communes")
      tibble::tibble(commune = "22001", menages = 100,
                     part_sans_voiture = 0.1, part_deux_plus = 0.2)
    },
    agreger_voitures_territoires = function(voitures_communes, base_epci) {
      pousser("voitures_territoires")
      tibble::tibble(code = "22001", key = "voitures_menage",
                     detail = "sans_voiture", value = 0.1)
    },
    calculer_reseaux_communes = function(lignes, limites) {
      pousser("reseaux_communes")
      tibble::tibble(commune = "22001", longueur_t = 0.8, longueur_c = 2.0)
    },
    calculer_reseaux_velo_communes = function(amenagements, limites) {
      pousser("reseaux_velo_communes")
      tibble::tibble(commune = "22001", longueur_b = 1.0)
    },
    agreger_reseaux_territoires = function(reseaux_communes, base_epci) {
      pousser("reseaux_territoires")
      tibble::tibble(code = "22001", key = "reseaux", detail = "c_longueur", value = 2.0)
    },
    agreger_reseaux_par_habitant_territoires = function(reseaux_communes, population, base_epci) {
      pousser("reseaux_par_habitant_territoires")
      tibble::tibble(code = "22001", key = "reseaux_par_habitant",
                     detail = "c_km_1000", value = 2.0)
    },
    calculer_surface_reseaux_routiers_communes = function(ocsge, limites) {
      pousser("surface_reseaux_routiers_communes")
      tibble::tibble(commune = "22001", aire_m2 = 4e6,
                     surface_routiere_m2 = 4e5, part_surface_routiere = 0.1)
    },
    agreger_surface_reseaux_routiers_territoires = function(communes, base_epci) {
      pousser("surface_reseaux_routiers_territoires")
      tibble::tibble(code = "22001", value = 0.1)
    },
    calculer_part_proches_arret_communes = function(stops, adresses) {
      pousser("offre_tc_communes")
      expect_s3_class(adresses, "sf")
      tibble::tibble(commune = "22001", n_adresses = 2L, proches = 1L, part_proche = 0.5)
    },
    calculer_bornes_communes = function(bornes, base_epci) {
      pousser("bornes_communes")
      tibble::tibble(commune = "22001", nb_bornes = 3L)
    },
    calculer_stationnement_velo_communes = function(velo) {
      pousser("velo_communes")
      tibble::tibble(commune = "22001", annee = "2025", places = 30,
                     population = 1000, places_1000 = 30)
    },
    calculer_offre_cyclable_communes = function(amenagements, population) {
      pousser("offre_cyclable_communes")
      tibble::tibble(commune = "22001", population = 1000,
                     protege_longueur = 2.0, partage_longueur = 1.0,
                     total_longueur = 3.0, protege_km_1000 = 2.0, partage_km_1000 = 1.0)
    },
    agreger_offre_territoires = function(offre_tc, bornes, velo, base_epci, offre_cyclable) {
      pousser("offre_territoires")
      tibble::tibble(code = "22001", key = "offre_tc", detail = NA_character_, value = 0.9)
    },
    .package = "lusk"
  )
  sortie <- tempfile("mob-analytiques-")
  on.exit(unlink(sortie, recursive = TRUE), add = TRUE)
  res <- construire_analytiques_mobilite(donnees, base_epci, sortie = sortie)
  expect_equal(suivi$ordre,
               c("territoires", "voitures_communes", "voitures_territoires",
                 "reseaux_communes", "reseaux_velo_communes", "reseaux_territoires",
                 "velo_communes", "reseaux_par_habitant_territoires",
                 "surface_reseaux_routiers_communes",
                 "surface_reseaux_routiers_territoires",
                 "offre_tc_communes", "bornes_communes", "offre_cyclable_communes",
                 "offre_territoires"))
  expect_equal(res$mobilite_communes$n_adresses, 2L)
  expect_equal(res$offre_tc_communes$part_proche, 0.5)
  expect_equal(res$offre_territoires$value, 0.9)
  expect_false(any(c("nb_buildings_territoires", "acces_territoires",
                     "isolation_territoires", "div_loss_territoires",
                     "saillance_territoires", "densite_territoires",
                     "nuage_territoires", "moyennes_acces_territoires",
                     "tot_loss_territoires") %in% names(res)))
  for (f in c("mobilite_communes.rds", "voitures_communes.rds",
              "reseaux_communes.rds", "offre_tc_communes.rds",
              "offre_territoires.rds"))
    expect_true(file.exists(file.path(sortie, f)), info = f)
  for (f in c("nb_buildings_territoires.rds", "div_loss_territoires.rds",
              "saillance_territoires.rds", "moyennes_acces_territoires.rds"))
    expect_false(file.exists(file.path(sortie, f)), info = f)
})


test_that("publier_mobilite : le seam de publication est câblé (plus un stub)", {
  # un appel sans données échoue pour une raison de DONNÉES (cache absent),
  # jamais sur un message de stub
  expect_false(grepl("stub", tryCatch(
    publier_mobilite(list()),
    error = function(e) conditionMessage(e)
  )))
})












# analytiques_mobilite_fixture -------------------------------------------------
# La liste des artefacts analytiques du fixture — assemblée par les builders
# RÉELS (les mêmes que le chaînon) : la forme que compute_histoires_mobilite
# consomme.



# L'étage demande/réseaux (issue #139) ---------------------------------------
# Les tests unitaires de la demande (voitures par ménage, RP exploitation
# principale — le code de table épinglé LOG T12) et des réseaux (longueur /
# densité par mode t/b/c, OSM — projection EPSG:2154 avant toute mesure). Le
# fixture de la demande est une forme RÉDUITE mais fidèle de l'extraction du
# cube DS_RP_LOGEMENT_PRINC (les comptes DWELLINGS × CARS par commune) ; le
# fixture des réseaux est un EXtrait OSM MINUSCULE (le motif 3 communes du
# contrat — quelques lignes highway=* sur 3 polygones, projetées en EPSG:2154
# comme le vrai extract).

# fixture_voitures_mini -------------------------------------------------------
# Les comptes voitures/ménage de 4 communes (la forme que lire_voitures_communes
# persiste) : menages_total (DWELLINGS, CARS=_T), menages_sans_voiture (CARS=C0),
# menages_une_voiture (CARS=C1) et menages_deux_plus (CARS=C_GE2) — les TROIS
# parties depuis l'issue #368. Des comptes simples pour des parts calculables à
# la main (les trois parts somment à 1 par construction) :
#   22001 : 100 ménages, 10 sans (0.1), 70 avec 1 (0.7), 20 avec 2+ (0.2)
#   22002 : 300 ménages, 60 sans (0.2), 150 avec 1 (0.5), 90 avec 2+ (0.3)
#   29001 : 200 ménages, 80 sans (0.4), 80 avec 1 (0.4), 40 avec 2+ (0.2)
#   29002 : 400 ménages, 100 sans (0.25), 60 avec 1 (0.15), 240 avec 2+ (0.6)
fixture_voitures_mini <- function() {
  tibble::tribble(
    ~commune, ~menages_total, ~menages_sans_voiture, ~menages_une_voiture,
    ~menages_deux_plus,
    "22001", 100, 10, 70, 20,
    "22002", 300, 60, 150, 90,
    "29001", 200, 80, 80, 40,
    "29002", 400, 100, 60, 240
  )
}

test_that("calculer_voitures_communes : les TROIS parts (0 / 1 / 2+) par commune (le miroir de la demande)", {
  v <- calculer_voitures_communes(fixture_voitures_mini())

  # une ligne par commune, la forme : identité + le poids (ménages) + les trois
  # parts (sans voiture / une voiture / 2+) — des fractions dans [0, 1]
  expect_equal(nrow(v), 4)
  expect_named(v, c("commune", "menages", "part_sans_voiture",
                    "part_une_voiture", "part_deux_plus"))
  lire <- function(commune) v[v$commune == commune, ]
  expect_equal(lire("22001")$part_sans_voiture, 0.1)
  expect_equal(lire("22001")$part_une_voiture, 0.7)
  expect_equal(lire("22001")$part_deux_plus, 0.2)
  expect_equal(lire("22002")$part_sans_voiture, 0.2)
  expect_equal(lire("22002")$part_une_voiture, 0.5)
  expect_equal(lire("22002")$part_deux_plus, 0.3)
  expect_equal(lire("29001")$part_sans_voiture, 0.4)
  expect_equal(lire("29001")$part_une_voiture, 0.4)
  expect_equal(lire("29001")$part_deux_plus, 0.2)
  expect_equal(lire("29002")$part_sans_voiture, 0.25)
  expect_equal(lire("29002")$part_une_voiture, 0.15)
  expect_equal(lire("29002")$part_deux_plus, 0.6)
  # les trois parts SOMMENT à 1 (la dimension CARS partitionne les ménages —
  # issue #368 : la catégorie du milieu C1 est publiée, plus jamais un total
  # qui ne ferme pas)
  for (commune in v$commune) {
    expect_equal(sum(v$part_sans_voiture[v$commune == commune] +
                       v$part_une_voiture[v$commune == commune] +
                       v$part_deux_plus[v$commune == commune]), 1,
                 info = commune)
  }
  # le poids de l'agrégation : le nombre de ménages (la moyenne pondérée par
  # les ménages, jamais une moyenne de parts)
  expect_equal(lire("22001")$menages, 100)
  expect_true(all(v$part_sans_voiture >= 0 & v$part_sans_voiture <= 1))
  # déterministe : trié par commune
  expect_true(!is.unsorted(v$commune))
})

test_that("agreger_voitures_territoires : les niveaux RECALCULENT depuis les parties (la moyenne pondérée par les ménages)", {
  v <- calculer_voitures_communes(fixture_voitures_mini())
  ag <- agreger_voitures_territoires(v, base_epci_mini_analytique())

  # les quatre niveaux : 4 communes + 2 EPCIs + 2 départements + la région, ×
  # les trois parts = 27 lignes
  expect_equal(nrow(ag), 9 * 3)
  expect_named(ag, c("code", "key", "detail", "value"))
  expect_true(all(ag$key == "voitures_menage"))
  expect_setequal(unique(ag$detail),
                  c("sans_voiture", "une_voiture", "deux_plus"))
  lire <- function(code, detail) ag$value[ag$code == code & ag$detail == detail]

  # EPCI 200000001 (22001 + 22002) : Σ (part × ménages) ÷ Σ ménages — la
  # moyenne PONDÉRÉE par les ménages, jamais la moyenne des parts
  expect_equal(lire("200000001", "sans_voiture"), (0.1 * 100 + 0.2 * 300) / 400)
  expect_equal(lire("200000001", "une_voiture"), (0.7 * 100 + 0.5 * 300) / 400)
  expect_equal(lire("200000001", "deux_plus"), (0.2 * 100 + 0.3 * 300) / 400)
  # EPCI 200000002 (29001 + 29002)
  expect_equal(lire("200000002", "sans_voiture"), (0.4 * 200 + 0.25 * 400) / 600)
  expect_equal(lire("200000002", "une_voiture"), (0.4 * 200 + 0.15 * 400) / 600)
  expect_equal(lire("200000002", "deux_plus"), (0.2 * 200 + 0.6 * 400) / 600)
  # départements : la même pondération sur leurs communes ; la région : toutes
  expect_equal(lire("22", "sans_voiture"), (0.1 * 100 + 0.2 * 300) / 400)
  expect_equal(lire("29", "deux_plus"), (0.2 * 200 + 0.6 * 400) / 600)
  expect_equal(lire("53", "sans_voiture"), (10 + 60 + 80 + 100) / 1000)
  expect_equal(lire("53", "une_voiture"), (70 + 150 + 80 + 60) / 1000)
  expect_equal(lire("53", "deux_plus"), (20 + 90 + 40 + 240) / 1000)
  # les agrégats portent eux aussi les trois parts qui somment à 1
  for (code in unique(ag$code)) {
    expect_equal(sum(ag$value[ag$code == code]), 1, info = code)
  }
  # la commune garde SA part telle quelle
  expect_equal(lire("22001", "sans_voiture"), 0.1)
  # déterministe : trié par code puis détail
  expect_true(!is.unsorted(ag$code))
})

test_that("agreger_voitures_territoires : une commune absente de la demande n'agrège à aucun niveau", {
  # 29002 n'a pas de ligne voitures (une commune hors RP — le cas des îles)
  voitures <- fixture_voitures_mini()[fixture_voitures_mini()$commune != "29002", ]
  v <- calculer_voitures_communes(voitures)
  ag <- agreger_voitures_territoires(v, base_epci_mini_analytique())

  # l'EPCI 200000002 n'agrège QUE 29001 (la part de 29001 telle quelle) — jamais
  # un NA fabriqué ni un zéro silencieux
  expect_equal(ag$value[ag$code == "200000002" & ag$detail == "sans_voiture"], 0.4)
  # le département 29 et la région recalculent sur les communes présentes
  expect_equal(ag$value[ag$code == "29" & ag$detail == "sans_voiture"],
               (0.4 * 200) / 200)
  expect_equal(ag$value[ag$code == "53" & ag$detail == "deux_plus"],
               (20 + 90 + 40) / 600)
})

# fixture_reseaux_mini --------------------------------------------------------
# L'extrait OSM MINUSCULE du motif 3 communes (le contrat, testing note) : trois
# polygones communaux carrés de 2 km de côté (4 km²) en EPSG:2154 — Lambert-93,
# comme le vrai extract — et sept lignes highway=* dont les longueurs se
# calculent à la main. Le motif exerce le mapping des modes (c/b/t), l'inclusion
# de path, l'exclusion de track, et l'attribution par centroïde :
#   L1 residential  (0,0)-(2000,0)        2 000 m → 22001 (c)
#   L2 cycleway     (500,500)-(1500,500)  1 000 m → 22001 (b)
#   L3 footway      (100,100)-(100,900)     800 m → 22001 (t)
#   L4 residential  (2000,0)-(4000,0)     2 000 m → 22002 (c)
#   L7 service      (2100,1500)-(3900,1500) 1 800 m → 22002 (c)
#   L5 path         (500,2500)-(1500,2500) 1 000 m → 29001 (t)
#   L6 track        (500,3000)-(1500,3000) 1 000 m → 29001 (EXCLU)
fixture_limites_mini <- function() {
  sf::st_sf(
    code_insee = c("22001", "22002", "29001"),
    geometry = sf::st_sfc(
      sf::st_polygon(list(rbind(c(0, 0), c(2000, 0), c(2000, 2000),
                                c(0, 2000), c(0, 0)))),
      sf::st_polygon(list(rbind(c(2000, 0), c(4000, 0), c(4000, 2000),
                                c(2000, 2000), c(2000, 0)))),
      sf::st_polygon(list(rbind(c(0, 2000), c(2000, 2000), c(2000, 4000),
                                c(0, 4000), c(0, 2000))))
    ),
    crs = 2154
  )
}

fixture_lignes_mini <- function() {
  sf::st_sf(
    osm_id = c(101L, 102L, 103L, 104L, 105L, 106L, 107L),
    highway = c("residential", "cycleway", "footway", "residential",
                "path", "track", "service"),
    geometry = sf::st_sfc(
      sf::st_linestring(rbind(c(0, 0), c(2000, 0))),
      sf::st_linestring(rbind(c(500, 500), c(1500, 500))),
      sf::st_linestring(rbind(c(100, 100), c(100, 900))),
      sf::st_linestring(rbind(c(2000, 0), c(4000, 0))),
      sf::st_linestring(rbind(c(500, 2500), c(1500, 2500))),
      sf::st_linestring(rbind(c(500, 3000), c(1500, 3000))),
      sf::st_linestring(rbind(c(2100, 1500), c(3900, 1500)))
    ),
    crs = 2154
  )
}

fixture_lignes_reseaux_canon <- function() {
  highways <- c(
    "footway", "residential", "primary", "trunk", "residential", "primary",
    "residential", "service", "service", "residential", "primary", "service",
    "primary", "service", "busway", "residential", "residential", "primary"
  )
  n <- length(highways)
  sf::st_sf(
    osm_id = as.character(seq_len(n)),
    highway = highways,
    foot = c(
      rep(NA_character_, 6), "no", rep(NA_character_, 10), NA_character_
    ),
    access = c(
      rep(NA_character_, 9), "private", "no", "destination", rep(NA_character_, 4),
      "customers", "destination"
    ),
    vehicle = rep(NA_character_, n),
    motor_vehicle = c(
      rep(NA_character_, 15), "permit", NA_character_, NA_character_
    ),
    motorcar = rep(NA_character_, n),
    busway = c(
      rep(NA_character_, 12), "lane", "designated", rep(NA_character_, 4)
    ),
    service = c(
      rep(NA_character_, 7), "parking_aisle", "driveway", rep(NA_character_, 9)
    ),
    maxspeed = c(
      NA_character_, "30", "30", "30", "50", "50", "30", "20", NA_character_,
      rep(NA_character_, 8), "30"
    ),
    sidewalk = c(
      rep(NA_character_, 5), "both", rep(NA_character_, 12)
    ),
    geometry = sf::st_sfc(
      lapply(seq_len(n), function(i) {
        sf::st_linestring(rbind(c(i * 100, 0), c(i * 100, 100)))
      }),
      crs = 2154
    )
  )
}

fixture_limites_reseaux_canon <- function() {
  sf::st_sf(
    code_insee = "22001",
    geometry = sf::st_sfc(sf::st_polygon(list(rbind(
      c(-100, -100), c(2000, -100), c(2000, 200), c(-100, 200), c(-100, -100)
    ))), crs = 2154)
  )
}

# fixture_amenagements_velo_mini -------------------------------------------------
# La table Geovelo NORMALISÉE MINUSCULE du motif 3 communes (le même motif que
# fixture_limites_mini : trois polygones de 2 km × 2 km = 4 km² en EPSG:2154) :
# sept segments dont les longueurs se calculent à la main. Le motif exerce les
# DEUX règles du contrat :
#   S1 (500,500)-(2500,500) 2 000 m   d=g=22001, PISTE, AUCUN,   BIDIRECTIONNEL → 22001 ×1
#   S2 (500,1000)-(1500,1000) 1 000 m d=g=22001, PISTE, AUCUN,   UNIDIRECTIONNEL → 22001 ×1
#   S3 (2000,300)-(2000,1500) 1 200 m d=22001 g=22002, BANDE, AUCUN → le d porte → 22001
#   S4 (2000,600)-(2000,1700) 1 100 m d=22001 g=22002, AUCUN, PISTE → le g porte → 22002
#   S5 (2000,100)-(2000,500)  400 m   d=22001 g=22002, BANDE, PISTE → les deux → d départage → 22001
#   S6 (500,2500)-(1500,2500) 1 000 m d=g=29001, VOIE VERTE, AUCUN, sens NA → 29001 ×1
#   S7 (500,1500)-(1500,1500) 1 000 m d=g=22001, AUTRE, AUCUN, sens NA → 22001 ×1
# Totaux attendus : 22001 = 2 + 1 + 1,2 + 0,4 + 1 = 5,6 km ; 22002 = 1,1 km ;
# 29001 = 1,0 km ; région = 7,7 km = la somme des contributions (zéro
# double-compte).
fixture_amenagements_velo_mini <- function() {
  sf::st_sf(
    id_local = c("S1", "S2", "S3", "S4", "S5", "S6", "S7"),
    code_com_d = c("22001", "22001", "22001", "22001", "22001", "29001", "22001"),
    code_com_g = c("22001", "22001", "22002", "22002", "22002", "29001", "22001"),
    ame_d = c("PISTE CYCLABLE", "PISTE CYCLABLE", "BANDE CYCLABLE", "AUCUN",
              "BANDE CYCLABLE", "VOIE VERTE", "AUTRE"),
    ame_g = c("AUCUN", "AUCUN", "AUCUN", "PISTE CYCLABLE", "PISTE CYCLABLE",
              "AUCUN", "AUCUN"),
    sens_d = c("BIDIRECTIONNEL", "UNIDIRECTIONNEL", "UNIDIRECTIONNEL",
               NA, NA, NA, NA),
    sens_g = c("BIDIRECTIONNEL", "UNIDIRECTIONNEL", NA, NA, NA, NA, NA),
    geometry = sf::st_sfc(
      sf::st_linestring(rbind(c(500, 500), c(2500, 500))),
      sf::st_linestring(rbind(c(500, 1000), c(1500, 1000))),
      sf::st_linestring(rbind(c(2000, 300), c(2000, 1500))),
      sf::st_linestring(rbind(c(2000, 600), c(2000, 1700))),
      sf::st_linestring(rbind(c(2000, 100), c(2000, 500))),
      sf::st_linestring(rbind(c(500, 2500), c(1500, 2500))),
      sf::st_linestring(rbind(c(500, 1500), c(1500, 1500)))
    ),
    crs = 2154
  )
}

test_that("calculer_reseaux_communes : longueurs par mode, EPSG:2154 projeté avant la mesure", {
  res <- calculer_reseaux_communes(fixture_lignes_mini(), fixture_limites_mini())

  # une ligne par commune, la forme : identité + surface + longueurs (km).
  # Depuis l'issue #230 (ADR-0016), le mode `b` n'est PLUS
  # lu sur le raw OSM (highway=cycleway — la ligne L2 du fixture est ignorée) :
  # il vient du jeu Geovelo (calculer_reseaux_velo_communes, fusionné par le
  # seam) — la table t/c ne porte que t et c.
  expect_equal(nrow(res), 3)
  expect_named(res, c("commune", "aire_m2", "longueur_t", "longueur_c"))
  lire <- function(commune) res[res$commune == commune, ]

  # 22001 : c = L1 (2 000 m), t = L1 + L3 (2 800 m) ; L2 (cycleway) est
  # IGNORÉE — le mode b ne se lit plus sur OSM ; surface 4 km²
  expect_equal(lire("22001")$aire_m2, 4e6)
  expect_equal(lire("22001")$longueur_c, 2.0)
  expect_equal(lire("22001")$longueur_t, 2.8)
  # 22002 : c = L4 + L7 (2 000 + 1 800 m) ; t = L4 (2 000 m)
  expect_equal(lire("22002")$longueur_c, 3.8)
  expect_equal(lire("22002")$longueur_t, 2.0)
  # 29001 : path est inclus dans le réseau piéton ; track reste exclu (un fait,
  # jamais une ligne manquante), surface portée
  expect_equal(lire("29001")$longueur_c, 0)
  expect_equal(lire("29001")$longueur_t, 1.0)
  expect_equal(lire("29001")$aire_m2, 4e6)
  # la longueur totale de la région est conservée : 2 + 3.8 km de c, 2.8 + 2 + 1 km de t
  expect_equal(sum(res$longueur_c), 5.8)
  expect_equal(sum(res$longueur_t), 5.8)
  # déterministe : trié par commune
  expect_true(!is.unsorted(res$commune))
})

test_that("calculer_reseaux_communes : les dénégations explicites retirent un path du réseau piéton", {
  lignes <- fixture_lignes_mini()
  lignes$foot <- NA_character_
  lignes$access <- NA_character_
  lignes$foot[lignes$highway == "path"] <- "no"

  res <- calculer_reseaux_communes(lignes, fixture_limites_mini())

  expect_equal(res$longueur_t[res$commune == "29001"], 0)
})

test_that("calculer_reseaux_communes : canonical walking and car contracts", {
  lignes <- fixture_lignes_reseaux_canon()
  limites <- fixture_limites_reseaux_canon()
  res <- calculer_reseaux_communes(lignes, limites)

  # t: footway, residential ways, low-speed ordinary roads, explicit sidewalk,
  # and a destination-speed road; motorway/trunk classes, denied access,
  # parking/driveway services, and a customer-only road do not add walking.
  expect_equal(res$longueur_t[res$commune == "22001"], 0.7)
  # c: every eligible OSM way contributes once.  The one-way residential way
  # is 100 m, not 200 m; the separately mapped trunk remains infrastructure.
  expect_equal(res$longueur_c[res$commune == "22001"], 0.9)

  one_way <- lignes[2, , drop = FALSE]
  one_way_result <- calculer_reseaux_communes(one_way, limites)
  expect_equal(one_way_result$longueur_c[one_way_result$commune == "22001"], 0.1)
})

test_that("agreger_reseaux_territoires : longueurs sommées depuis les parties", {
  # la table communale du contrat (les quatre colonnes), telle que le
  # seam la construit depuis l'issue #230 : t/c du OSM, b du jeu Geovelo
  res <- fusionner_reseaux_velo_communes(
    calculer_reseaux_communes(fixture_lignes_mini(), fixture_limites_mini()),
    calculer_reseaux_velo_communes(fixture_amenagements_velo_mini(),
                                   fixture_limites_mini())
  )
  ag <- agreger_reseaux_territoires(res, base_epci_mini_analytique())

  # les niveaux présents × 6 mesures = 48 lignes (3 communes du fixture + 2
  # EPCIs + 2 départements + la région ; 29002 — hors extract — n'a pas de
  # ligne ici ; l'alignement sur la référence se fait à l'assemblage)
  expect_equal(nrow(ag), 8 * 3)
  expect_named(ag, c("code", "key", "detail", "value"))
  expect_true(all(ag$key == "reseaux"))
  expect_setequal(unique(ag$detail),
                  c("t_longueur", "b_longueur", "c_longueur"))
  lire <- function(code, detail) ag$value[ag$code == code & ag$detail == detail]

  # EPCI 200000001 (22001 + 22002) : c = 2 + 3.8 = 5.8 km et
  # b = 5.6 (22001) + 1.1 (22002) = 6.7 km (le Geovelo, géométrie unique)
  expect_equal(lire("200000001", "c_longueur"), 5.8)
  expect_equal(lire("200000001", "b_longueur"), 5.6 + 1.1)
  expect_equal(lire("200000001", "t_longueur"), 2.8 + 2.0)
  # EPCI 200000002 : n'agrège que 29001 (b 1.0 — le Geovelo —, t 1.0 — le
  # path —, zéro route ; 29002 absente)
  expect_equal(lire("200000002", "b_longueur"), 1.0)
  expect_equal(lire("200000002", "t_longueur"), 1.0)
  expect_equal(lire("200000002", "c_longueur"), 0)
  # département 22 = EPCI 200000001 ; région : somme des longueurs
  expect_equal(lire("22", "c_longueur"), 5.8)
  expect_equal(lire("53", "c_longueur"), 5.8)
  expect_equal(lire("53", "b_longueur"), 7.7)
  # la commune garde SES valeurs telles quelles
  expect_equal(lire("22001", "c_longueur"), 2.0)
  expect_equal(lire("22001", "b_longueur"), 5.6)
  # déterministe : trié par code puis détail
  expect_true(!is.unsorted(ag$code))
})

test_that("agreger_reseaux_par_habitant_territoires : longueurs rapportées à la population", {
  res <- fusionner_reseaux_velo_communes(
    calculer_reseaux_communes(fixture_lignes_mini(), fixture_limites_mini()),
    calculer_reseaux_velo_communes(fixture_amenagements_velo_mini(),
                                   fixture_limites_mini())
  )
  population <- tibble::tibble(
    commune = c("22001", "22002", "29001"),
    population = c(100, 200, 50)
  )

  ag <- agreger_reseaux_par_habitant_territoires(
    res, population, base_epci_mini_analytique()
  )

  expect_equal(nrow(ag), 8 * 3)
  expect_named(ag, c("code", "key", "detail", "value"))
  expect_true(all(ag$key == "reseaux_par_habitant"))
  expect_setequal(unique(ag$detail),
                  c("t_km_1000", "b_km_1000", "c_km_1000"))
  lire <- function(code, detail) ag$value[ag$code == code & ag$detail == detail]

  # EPCI 200000001 (22001 + 22002) : Σ longueur ÷ Σ population × 1 000.
  expect_equal(lire("200000001", "t_km_1000"), (2.8 + 2.0) / 300 * 1000)
  expect_equal(lire("200000001", "b_km_1000"), (5.6 + 1.1) / 300 * 1000)
  expect_equal(lire("200000001", "c_km_1000"), (2.0 + 3.8) / 300 * 1000)
  # La commune conserve sa propre population au dénominateur.
  expect_equal(lire("22001", "c_km_1000"), 2.0 / 100 * 1000)
})

test_that("calculer_reseaux_communes : la projection EPSG:2154 précède toute mesure (l'entrée WGS84 mesure juste)", {
  # les MÊMES lignes et limites en WGS84 (le crs natif de l'extrait Geofabrik) :
  # le builder projette AVANT st_length/st_area — les longueurs restent en
  # mètres (la projection avant la mesure, jamais une mesure en degrés)
  lignes <- sf::st_transform(fixture_lignes_mini(), 4326)
  limites <- sf::st_transform(fixture_limites_mini(), 4326)

  res <- calculer_reseaux_communes(lignes, limites)
  lire <- function(commune) res[res$commune == commune, ]
  # les longueurs en km restent exactes (L1 2 km + L3 0.8 km — le plan Lambert
  # ne déforme pas ces distances à l'échelle du fixture ; L2 cycleway est
  # ignorée depuis l'issue #230 — le b ne se lit plus sur OSM)
  expect_equal(lire("22001")$longueur_c, 2.0)
  expect_equal(round(lire("22001")$longueur_t, 3), 2.8)
  expect_equal(lire("22002")$longueur_c, 3.8)
})

# =============================================================================
# Le mode `b` (vélo) depuis le jeu Geovelo (issue #230, ADR-0032)
# =============================================================================
# Les tests unitaires du builder calculer_reseaux_velo_communes : la table
# communale du mode `b` depuis la table Geovelo NORMALISÉE (la forme que
# normaliser_amenagements_cyclables livre — le sf EPSG:4326 breton aux clés COG
# 2025), avec les DEUX règles du contrat :
#   - le comptage en GÉOMÉTRIE UNIQUE : un segment contribue sa longueur une
#     seule fois, quel que soit le nombre de directions qu'il sert ;
#   - l'attribution par le CÔTÉ PORTEUR : pour un segment de frontière (les
#     deux codes diffèrent), la longueur va à la commune dont le côté porte
#     l'aménagement (ame ≠ AUCUN) ; les deux côtés porteurs → le côté `d`
#     départage. Chaque segment aboutit dans EXACTEMENT une commune — le total
#     de la région est la somme des communes, zéro double-compte.
# La sortie alimente agreger_reseaux_territoires par le seam (fusionner_ avec
# la table t/c) — la forme (commune, longueur_b en km) est celle du contrat.

test_that("calculer_reseaux_velo_communes : longueur géométrique unique, attribution par le côté porteur", {
  res <- calculer_reseaux_velo_communes(fixture_amenagements_velo_mini(),
                                        fixture_limites_mini())

  # une ligne par commune, la forme du contrat : commune, longueur_b en km
  expect_equal(nrow(res), 3)
  expect_named(res, c("commune", "longueur_b"))
  lire <- function(commune) res[res$commune == commune, ]

  # 22001 : S1 bidirectionnel (2 km) + S2 unidirectionnel (1 km) +
  # S3 (frontière, le d porte : 1,2 km) + S5 (frontière, les deux portent → d
  # départage : 0,4 km) + S7 (AUTRE, sens NA : 1 km) = 5,6 km ; surface 4 km²
  expect_equal(lire("22001")$longueur_b, 5.6)
  # 22002 : S4 (frontière, le g porte : 1,1 km)
  expect_equal(lire("22002")$longueur_b, 1.1)
  # 29001 : S6 (voie verte, sens NA : 1 km)
  expect_equal(lire("29001")$longueur_b, 1.0)
  # la longueur totale de la région = la somme des contributions (ZÉRO
  # double-compte — chaque segment aboutit dans exactement une commune)
  expect_equal(sum(res$longueur_b), 5.6 + 1.1 + 1.0)
  # déterministe : trié par commune
  expect_true(!is.unsorted(res$commune))
})

test_that("calculer_reseaux_velo_communes : la géométrie unique ignore la direction", {
  # une piste bidirectionnelle de 2 km → 2 km : la direction ne multiplie plus
  # la longueur physique du segment (ADR-0032)
  bidir <- sf::st_sf(
    id_local = "B1", code_com_d = "22001", code_com_g = "22001",
    ame_d = "PISTE CYCLABLE", ame_g = "AUCUN",
    sens_d = "BIDIRECTIONNEL", sens_g = NA_character_,
    geometry = sf::st_sfc(sf::st_linestring(rbind(c(0, 0), c(2000, 0)))),
    crs = 2154
  )
  res <- calculer_reseaux_velo_communes(bidir, fixture_limites_mini())
  expect_equal(res$longueur_b[res$commune == "22001"], 2.0)

  # une piste UNIdirectionnelle de 2 km → 2 km
  unidir <- bidir
  unidir$sens_d <- "UNIDIRECTIONNEL"
  res2 <- calculer_reseaux_velo_communes(unidir, fixture_limites_mini())
  expect_equal(res2$longueur_b[res2$commune == "22001"], 2.0)

  # un sens non renseigné (NA — la quasi-totalité du fichier réel) compte 1×
  na <- bidir
  na$sens_d <- NA_character_
  res3 <- calculer_reseaux_velo_communes(na, fixture_limites_mini())
  expect_equal(res3$longueur_b[res3$commune == "22001"], 2.0)
})

test_that("calculer_reseaux_velo_communes : l'attribution par le CÔTÉ PORTEUR (ADR-0016), le d départage", {
  limites <- fixture_limites_mini()
  segment <- function(code_d, code_g, ame_d, ame_g) {
    sf::st_sf(
      id_local = "B", code_com_d = code_d, code_com_g = code_g,
      ame_d = ame_d, ame_g = ame_g,
      sens_d = NA_character_, sens_g = NA_character_,
      geometry = sf::st_sfc(sf::st_linestring(rbind(c(2000, 500), c(2000, 1500)))),
      crs = 2154
    )
  }

  # le côté d porte seul (ame_d ≠ AUCUN, ame_g = AUCUN) → la commune du d
  res <- calculer_reseaux_velo_communes(
    segment("22001", "22002", "PISTE CYCLABLE", "AUCUN"), limites)
  expect_equal(res$commune, "22001")
  expect_equal(res$longueur_b, 1.0)
  # le côté g porte seul → la commune du g
  res <- calculer_reseaux_velo_communes(
    segment("22001", "22002", "AUCUN", "PISTE CYCLABLE"), limites)
  expect_equal(res$commune, "22002")
  expect_equal(res$longueur_b, 1.0)
  # les DEUX côtés portent → le d départage (le tiebreak déterministe)
  res <- calculer_reseaux_velo_communes(
    segment("22001", "22002", "BANDE CYCLABLE", "PISTE CYCLABLE"), limites)
  expect_equal(res$commune, "22001")
  expect_equal(res$longueur_b, 1.0)
  # un segment NON-frontière (les deux codes identiques) va à SA commune, quel
  # que soit le côté qui porte
  res <- calculer_reseaux_velo_communes(
    segment("29001", "29001", "AUCUN", "VOIE VERTE"), limites)
  expect_equal(res$commune, "29001")
})

test_that("calculer_reseaux_velo_communes : la projection EPSG:2154 précède toute mesure (l'entrée WGS84 mesure juste)", {
  # les MÊMES segments en WGS84 (le crs du lecteur — le normaliseur livre le sf
  # en EPSG:4326) : le builder projette AVANT st_length — les longueurs restent
  # en mètres
  lignes <- sf::st_transform(fixture_amenagements_velo_mini(), 4326)
  limites <- sf::st_transform(fixture_limites_mini(), 4326)

  res <- calculer_reseaux_velo_communes(lignes, limites)
  lire <- function(commune) res[res$commune == commune, ]
  expect_equal(lire("22001")$longueur_b, 5.6)
  expect_equal(lire("22002")$longueur_b, 1.1)
  expect_equal(round(lire("29001")$longueur_b, 3), 1.0)
})

test_that("calculer_reseaux_velo_communes : un input corrompu s'arrête bruyamment", {
  # une colonne requise manquante nomme la colonne fautive
  defectueux <- fixture_amenagements_velo_mini()
  defectueux$ame_g <- NULL
  expect_error(calculer_reseaux_velo_communes(defectueux, fixture_limites_mini()),
               "ame_g")
  defectueux <- fixture_amenagements_velo_mini()
  defectueux$code_com_d <- NULL
  expect_error(calculer_reseaux_velo_communes(defectueux, fixture_limites_mini()),
               "code_com_d")
  # un segment sans aménagement des DEUX côtés (AUCUN/AUCUN) est une corruption
  # — le fichier réel n'en porte aucune (vérifié §7.10bis), jamais une ligne
  # silencieusement perdue
  defectueux <- fixture_amenagements_velo_mini()
  defectueux$ame_d[1] <- "AUCUN"
  defectueux$ame_g[1] <- "AUCUN"
  expect_error(calculer_reseaux_velo_communes(defectueux, fixture_limites_mini()),
               "AUCUN")
  # des limites sans code_insee sont refusées
  expect_error(calculer_reseaux_velo_communes(
    fixture_amenagements_velo_mini(),
    sf::st_drop_geometry(fixture_limites_mini())), "sf")
  # un fichier vide est une corruption
  vide <- fixture_amenagements_velo_mini()[0, ]
  expect_error(calculer_reseaux_velo_communes(vide, fixture_limites_mini()),
               "aucune ligne")
})

# fusionner_reseaux_velo_communes -----------------------------------------------
# Le seam du mode `b` : la table t/c (OSM) et la table b (Geovelo) sont
# FUSIONNÉES par commune en la table communale du contrat (les quatre
# colonnes que agreger_reseaux_territoires consomme — la forme reste, la source
# du b change). Une commune sans aménagement Geovelo porte b = 0 (zéro réseau —
# un fait, jamais une ligne manquante) ; une commune présente dans le b mais
# absente du t/c (impossible en pratique — tout le monde a des routes) porte
# t/c = 0.
test_that("fusionner_reseaux_velo_communes : la table b s'intègre à la table t/c en la table complète", {
  tc <- tibble::tibble(
    commune = c("22001", "22002", "29001"),
    aire_m2 = c(4e6, 4e6, 4e6),
    longueur_t = c(0.8, 0, 0), longueur_c = c(2.0, 3.8, 0)
  )
  velo <- tibble::tibble(
    commune = c("22001", "22002"),
    aire_m2 = c(4e6, 4e6),
    longueur_b = c(5.6, 1.1)
  )

  res <- fusionner_reseaux_velo_communes(tc, velo)

  # la forme du contrat : t/c du OSM, b du Geovelo
  expect_named(res, c("commune", "longueur_t", "longueur_b", "longueur_c"))
  expect_equal(nrow(res), 3)
  lire <- function(commune) res[res$commune == commune, ]
  expect_equal(lire("22001")$longueur_b, 5.6)
  expect_equal(lire("22001")$longueur_t, 0.8)
  # 29001 : SANS aménagement Geovelo → b = 0 (un fait, jamais une ligne
  # manquante — l'invariant du zéro réseau)
  expect_equal(lire("29001")$longueur_b, 0)
  # déterministe : trié par commune
  expect_true(!is.unsorted(res$commune))
})


# =============================================================================
# Le sous-bloc « L'offre de mobilité alternative » (issue #140)
# =============================================================================
# Les tests unitaires du sous-bloc : les contrats des fragments du manifeste
# (korrigo GTFS, bornes-recharges, stationnement-velo), les normaliseurs (les
# arrêts GTFS stops.txt, le spine d'adresses AEDAR, les bornes IRVE, le hub
# vélo), les builders COMMUNAUX
# (la part des bâtiments à 500 m d'un arrêt — la vraie part, jamais une part
# de superficie, la correction de la première passe ; les stations IRVE ; le
# millésime le plus récent du hub) et l'agrégation aux quatre niveaux (la
# règle du thème : la moyenne pondérée par les bâtiments pour une part, la
# SOMME pour un compte, Σ places ÷ Σ population pour un taux — jamais une
# moyenne de valeurs communales).
#
# La correction (première passe rejetée) :
#   - Bug 1 — la SOURCE des arrêts : les arrêts viennent du stops.txt de la
#     base GTFS Korrigo (27 297 arrêts, dont 2 919 STAR), PAS de
#     mobibreizh-stops (24 380 arrêts SANS le réseau STAR — un constat de
#     qualité de la donnée, documenté dans le fragment korrigo). Le
#     normaliseur lit donc le format GTFS (stop_id, stop_lat, stop_lon), plus
#     jamais la paire « lat, lon » de mobibreizh.
#   - Bug 2 — la MÉTHODE : la part est la fraction des BÂTIMENTS de la commune
#     (le spine d'adresses AEDAR, reprojeté EPSG:2154) à moins
#     de 500 m à vol d'oiseau d'un arrêt GTFS — jamais la part de la
#     SUPERFICIE communale (qui diverge massivement dans les communes denses :
#     Rennes superficie 0,40 vs bâtiments 0,996). La couche bâtiments porte
#     code_commune_insee : plus de jointure spatiale aux polygones communaux —
#     communes-france disparaît du manifeste.
# Le vocabulaire (CONTEXT.md) : « L'offre de mobilité alternative », « Offre
# TC », « Bornes de recharge », « Stationnement vélo ».

# MANIFEST_MOBILITE_KORRIGO -----------------------------------------------------
test_that("MANIFEST_MOBILITE_KORRIGO : la base GTFS Korrigo — les arrêts (stops.txt), ODbL", {
  frag <- MANIFEST_MOBILITE_KORRIGO

  # le fragment porte UNE source — la base GTFS Korrigo, dont le stops.txt
  # (27 297 arrêts, la fédération complète incluant le réseau STAR de Rennes)
  # est LA source des arrêts. mobibreizh-stops est ABSENT : il ne porte aucun
  # arrêt STAR (constat de qualité de la donnée, documenté dans la note).
  expect_equal(nrow(frag), 1L)
  expect_equal(frag$id, "korrigo")
  expect_equal(frag$fichier, "korrigo-gtfs.zip")
  expect_equal(frag$licence, "odbl")
  expect_equal(frag$mode, "cron")
  expect_equal(frag$type, "fichier")
  # la note documente la décision de source : le stops.txt GTFS est autoritaire
  # sur mobibreizh-stops (l'absence STAR)
  expect_match(frag$note, "stops\\.txt")
  expect_match(frag$note, "mobibreizh")
  expect_match(frag$note, "STAR")
  expect_true(verifier_contrat_mobilite_korrigo(frag))
})

# MANIFEST_MOBILITE_BATIMENTS ---------------------------------------------------

# MANIFEST_MOBILITE_BORNES ------------------------------------------------------
test_that("MANIFEST_MOBILITE_BORNES : le fichier consolidé IRVE, Licence Ouverte, vintage verrouillé", {
  frag <- MANIFEST_MOBILITE_BORNES

  expect_equal(nrow(frag), 1L)
  expect_equal(frag$id, "bornes-recharges")
  expect_equal(frag$fichier, "bornes-recharges.csv")
  expect_equal(frag$licence, "lov2")
  # la référence est le rafraîchissement verrouillé du contrat thème (2026-07-28),
  # la publication le traitement ODS de l'export (2026-08-04)
  expect_equal(frag$date_reference, "2026-07-28")
  expect_equal(frag$date_publication, "2026-08-04")
  expect_true(verifier_contrat_mobilite_bornes(frag))
})

# MANIFEST_MOBILITE_STATIONNEMENT_VELO ------------------------------------------
test_that("MANIFEST_MOBILITE_STATIONNEMENT_VELO : le hub Ecolab pris tel quel, ODbL", {
  frag <- MANIFEST_MOBILITE_STATIONNEMENT_VELO

  expect_equal(nrow(frag), 1L)
  expect_equal(frag$id, "stationnement-velo")
  expect_equal(frag$fichier, "stationnement-velo-commune.csv")
  expect_equal(frag$licence, "odbl")  # producteur OSM (ADR-0001)
  # l'annuel du hub (2022-2025) ; la référence est la mesure la plus récente
  # (2025-01-01), la publication la mise en ligne du fichier (2026-02-03)
  expect_equal(frag$vintage, "2022-2025")
  expect_equal(frag$date_reference, "2025-01-01")
  expect_equal(frag$date_publication, "2026-02-03")
  expect_true(verifier_contrat_mobilite_stationnement_velo(frag))
})

# verifier_contrat_manifest_mobilite --------------------------------------------
test_that("verifier_contrat_manifest_mobilite : le manifeste concaténé passe son contrat", {
  # le manifeste réel passe sa propre validation de contrat
  expect_true(verifier_contrat_manifest_mobilite(MANIFEST_MOBILITE))

    # un manifeste amputé d'une source échoue bruyamment (les QUINZE sources du
  # thème — les quatre de l'étage demande/réseaux (#139) + les
  # quatre du sous-bloc (#140) + la table de passage COG partagée (#222/#227)
  # + les deux sources du raccordement (#485))
  defectueux <- MANIFEST_MOBILITE[MANIFEST_MOBILITE$id != "korrigo", ]
     expect_error(verifier_contrat_manifest_mobilite(defectueux), "QUINZE")

  # un id dupliqué échoue
  defectueux <- MANIFEST_MOBILITE
  defectueux$id[defectueux$id == "bornes-recharges"] <- "korrigo"
  expect_error(verifier_contrat_manifest_mobilite(defectueux), "dupliqu")
})

# normaliser_stops_gtfs ----------------------------------------------------------
test_that("normaliser_stops_gtfs : la base GTFS stops.txt, les coordonnées numérisées", {
  # une forme RÉDUITE mais fidèle du stops.txt GTFS (la fédération Korrigo) :
  # stop_id (le préfixe réseau — STAR pour Rennes), stop_lat, stop_lon
  brut <- tibble::tibble(
    stop_id = c("STAR:ST:AUTO$1", "QUB:ST:AUTO$2", "ARBUS:ST:AUTO$3"),
    stop_code = c("1", "2", "3"),
    stop_name = c("Villejean-Université", "Centre", "Kergoat"),
    stop_lat = c(48.1221, 47.997, 48.4658),
    stop_lon = c(-1.7063, -4.1, -4.2426),
    location_type = c("0", "0", "0")
  )

  table <- normaliser_stops_gtfs(brut)

  # la forme du calcul : stop_id + coordonnées numériques, trié par stop_id
  # (ARBUS < QUB < STAR — le tri par id, jamais l'ordre du fichier)
  expect_named(table, c("stop_id", "stop_lat", "stop_lon"))
  expect_equal(nrow(table), 3)
  expect_type(table$stop_lat, "double")
  expect_equal(table$stop_id, c("ARBUS:ST:AUTO$3", "QUB:ST:AUTO$2",
                                "STAR:ST:AUTO$1"))
  expect_equal(table$stop_lat[1], 48.4658)   # ARBUS — Kergoat
  expect_equal(table$stop_lon[3], -1.7063)   # STAR — Villejean-Université
  expect_true(!is.unsorted(table$stop_id))
})

test_that("normaliser_stops_gtfs : un input corrompu s'arrête bruyamment", {
  # une colonne requise manquante nomme la colonne fautive
  expect_error(normaliser_stops_gtfs(tibble::tibble(stop_id = "x")), "stop_lat")

  # des coordonnées non numériques sont une corruption (jamais une NA
  # silencieuse)
  expect_error(
    normaliser_stops_gtfs(tibble::tibble(
      stop_id = "x", stop_lat = "abc", stop_lon = "1")),
    "numé"
  )

  # un fichier vide est une corruption
  expect_error(
    normaliser_stops_gtfs(tibble::tibble(
      stop_id = character(), stop_lat = numeric(), stop_lon = numeric())),
    "aucune ligne"
  )
})

# normaliser_bornes_recharges ----------------------------------------------------
test_that("normaliser_bornes_recharges : une ligne par point de charge, le code commune conservé", {
  brut <- tibble::tibble(
    code_insee_commune = c("29011", "29011", "22001", NA, "22100"),
    id_station_itinerance = c("FR1", "FR1", "FR2", "FR3", "FR4")
  )

  table <- normaliser_bornes_recharges(brut)

  # la forme du calcul : le code commune (NA pour les lignes mal
  # géolocalisées — un caveat SOURCE documenté, jamais une corruption) et la
  # station. Le comptage des stations distinctes est l'affaire du builder.
  expect_named(table, c("code_insee_commune", "id_station_itinerance"))
  expect_equal(nrow(table), 5)
  expect_true(all(is.na(table$code_insee_commune[4])))
  # un code hors format COG est une corruption
  expect_error(normaliser_bornes_recharges(tibble::tibble(
    code_insee_commune = "ABC", id_station_itinerance = "FR1")), "COG")
})

# normaliser_stationnement_velo ---------------------------------------------------
test_that("normaliser_stationnement_velo : une ligne par (commune × millésime), le taux recomposé", {
  brut <- tibble::tibble(
    date_mesure = c("2024-01-01", "2024-01-01", "2024-01-01", "2024-01-01",
                    "2025-01-01", "2025-01-01", "2025-01-01", "2025-01-01"),
    geocode_commune = rep(c("29011", "22001"), each = 4),
    type_accroche = rep(c("roue", "cadre", "cadre et roue", "sans accroche"), 2),
    numerateur = c(10, 5, 2, 1, 30, 10, 5, 4),
    denominateur = c(1000, 1000, 1000, 1000, 2000, 2000, 2000, 2000)
  )

  table <- normaliser_stationnement_velo(brut)

  # une ligne par (commune × millésime), les places sommées sur les quatre
  # types d'accroche, le taux recomposé (Σ places ÷ population × 1 000)
  expect_named(table, c("geocode_commune", "annee", "places", "population",
                        "places_1000"))
  expect_equal(nrow(table), 2)
  expect_equal(table$places[table$geocode_commune == "29011" &
                            table$annee == "2024"], 18)
  expect_equal(table$places[table$geocode_commune == "22001" &
                            table$annee == "2025"], 49)
  expect_equal(table$places_1000[table$geocode_commune == "22001" &
                                 table$annee == "2025"], 49 / 2000 * 1000)
})

# fixture_batiments_spatiale ------------------------------------------------------
# Le FIXTURE SPATIAL SYNTHÉTIQUE du calcul d'offre TC CORRIGÉ (la vraie part
# des bâtiments — la décision de distance testée à l'unité, sans les 27 297
# arrêts réels) : la couche bâtiments (POINT EPSG:2154, code_commune_insee) et
# les arrêts GTFS (WGS84) qui les servent. L'arrêt unique est posé sur le
# point 2154 (400000, 6780000) — sa paire WGS84 exacte (lon -1.0282079342,
# lat 48.0514967135) est celle que le normaliseur GTFS lit. Les distances
# bâtiments → arrêt (calculées à la main en 2154) : 0 / 300 / 800 / 1 500 m
# pour 22001, 71 / 100 m pour 22002, ~100 km pour 22003.

fixture_adresses_spatiale <- function() {
  adresses <- tibble::tibble(
    address_id = paste0("a-", 1:7),
    code_insee = c(rep("22001", 4), rep("22002", 2), "22003"),
    lon = c(-1.0282079342, -1.0241867009, -1.0174845992, -1.0081015594,
            -1.0275719443, -1.0268675254, 0.3132333716),
    lat = c(48.0514967135, 48.0516343052, 48.0518633197, 48.0521832992,
            48.0519690103, 48.0515425926, 48.0897490693)
  )
  stops <- tibble::tibble(stop_id = "AR1", stop_lat = 48.0514967135,
                          stop_lon = -1.0282079342)
  list(adresses = adresses, stops = stops)
}


test_that("calculer_part_proches_arret_communes : la vraie part des adresses à 500 m", {
  skip_if_not(requireNamespace("sf", quietly = TRUE),
              "sf est requis pour le calcul spatial de l'offre TC.")
  fx <- fixture_adresses_spatiale()
  adresses <- normaliser_adresses_residentielles(fx$adresses)
  tc <- calculer_part_proches_arret_communes(fx$stops, adresses)
  expect_named(tc, c("commune", "n_adresses", "n_proches", "part_proche"))
  expect_setequal(tc$commune, c("22001", "22002", "22003"))
  expect_equal(tc$part_proche[tc$commune == "22001"], 0.5)
  expect_equal(tc$n_proches[tc$commune == "22001"], 2L)
  expect_equal(tc$n_adresses[tc$commune == "22001"], 4L)
  expect_equal(tc$part_proche[tc$commune == "22002"], 1)
  expect_equal(tc$part_proche[tc$commune == "22003"], 0)
  avant <- sf::sf_use_s2()
  tc2 <- calculer_part_proches_arret_communes(fx$stops, adresses)
  expect_identical(tc, tc2)
  expect_identical(sf::sf_use_s2(), avant)
})


test_that("calculer_part_proches_arret_communes : un input corrompu s'arrête bruyamment", {
  skip_if_not(requireNamespace("sf", quietly = TRUE),
              "sf est requis pour le calcul spatial de l'offre TC.")
  fx <- fixture_adresses_spatiale()
  expect_error(
    calculer_part_proches_arret_communes(
      tibble::tibble(stop_id = "x"),
      normaliser_adresses_residentielles(fx$adresses)),
    "stop_lat")
  expect_error(
    calculer_part_proches_arret_communes(
      fx$stops,
      sf::st_sf(geometry = sf::st_sfc(sf::st_point(c(400000, 6780000)), crs = 2154))),
    "code_commune_insee")
})

# calculer_bornes_communes -------------------------------------------------------
test_that("calculer_bornes_communes : les stations distinctes par commune du référentiel partagé", {
  base_epci <- tibble::tribble(
    ~CODGEO, ~EPCI, ~DEP,
    "29011", "242900314", "29",
    "22001", "200000001", "22",
    "35238", "243500139", "35"
  )
  bornes <- tibble::tibble(
    code_insee_commune = c("29011", "29011", "29011", "22001", "35238",
                           NA, "22100", "99999"),
    id_station_itinerance = c("FR1", "FR1", "FR2", "FR3", "FR4", "FR5",
                              "FR6", "FR7")
  )

  b <- calculer_bornes_communes(bornes, base_epci)

  # « bornes » = stations distinctes (FR1 portée par DEUX points de charge ne
  # compte qu'une fois) ; les lignes sans code commune (NA) et les codes hors
  # référentiel (22100 — un code postal, 99999) tombent
  expect_named(b, c("commune", "nb_bornes"))
  expect_setequal(b$commune, c("29011", "22001", "35238"))
  expect_equal(b$nb_bornes[b$commune == "29011"], 2)
  expect_equal(b$nb_bornes[b$commune == "22001"], 1)
  expect_equal(b$nb_bornes[b$commune == "35238"], 1)
  expect_true(!is.unsorted(b$commune))
})

# calculer_stationnement_velo_communes -------------------------------------------
test_that("calculer_stationnement_velo_communes : le millésime le plus récent par commune", {
  velo <- tibble::tibble(
    geocode_commune = c("29011", "29011", "22001"),
    annee = c("2024", "2025", "2025"),
    places = c(35, 49, 12),
    population = c(3660, 3671, 599),
    places_1000 = c(35 / 3660 * 1000, 49 / 3671 * 1000, 12 / 599 * 1000)
  )

  v <- calculer_stationnement_velo_communes(velo)

  # une ligne par commune, le millésime le plus récent (2025 pour 29011), trié
  expect_named(v, c("commune", "annee", "places", "population", "places_1000"))
  expect_equal(nrow(v), 2)
  expect_equal(v$places[v$commune == "29011"], 49)
  expect_equal(v$annee[v$commune == "29011"], "2025")
  expect_equal(v$commune[1], "22001")   # trié par code
  expect_equal(v$places_1000[v$commune == "22001"], 12 / 599 * 1000)
})

# agreger_offre_territoires ------------------------------------------------------
# Le fixture d'agrégation : 4 communes sur 2 EPCIs / 2 départements, et les
# QUATRE tables communales du sous-bloc (depuis l'issue #231, la figure
# « L'offre cyclable »). Les valeurs attendues sont calculées à la main —
# jamais une moyenne de valeurs. L'offre TC est agrégée par la règle du thème :
# la moyenne PONDÉRÉE par les bâtiments (n_adresses de la couche — la
# correction : le poids EST le dénominateur de la part), jamais la moyenne des
# parts communales. La clé offre_cyclable est MULTI-MESURE (5 détails) : les
# longueurs sont SOMMÉES, les km/1 000 hab RECOMPOSÉS depuis les parties
# (Σ km ÷ Σ population × 1 000 — jamais la moyenne des taux communaux), le
# zéro porté par toute commune sans aménagement.
# Les trois clés scalaires du sous-bloc portent le détail NA — la forme longue
# (code × key × detail × value) du contrat, la même que les autres clés
# multi-mesures du payload.
test_that("agreger_offre_territoires : chaque indicateur agrégé par SA règle", {
  base <- tibble::tribble(
    ~CODGEO, ~EPCI, ~DEP,
    "22001", "200000001", "22",
    "22002", "200000001", "22",
    "29001", "200000002", "29",
    "29002", NA, "29"   # la commune sans EPCI (le fix « Sans objet » #131)
  )
  offre_tc <- tibble::tribble(
    ~commune, ~n_adresses, ~n_proches, ~part_proche,
    "22001", 100, 50, 0.5,
    "22002", 300, 240, 0.8,
    "29001", 200, 40, 0.2,
    "29002", 400, 240, 0.6
  )
  bornes <- tibble::tribble(
    ~commune, ~nb_bornes,
    "22001", 3, "29002", 2
  )
  velo <- tibble::tribble(
    ~commune, ~annee, ~places, ~population, ~places_1000,
    "22001", "2025", 30, 1000, 30,
    "22002", "2025", 90, 3000, 30,
    "29001", "2025", 40, 2000, 20,
    "29002", "2025", 120, 4000, 30
  )
  # la figure « L'offre cyclable » (issue #231) : la forme de
  # calculer_offre_cyclable_communes — 29001 SANS aménagement (le zéro porté)
  cyclable <- tibble::tribble(
    ~commune, ~population, ~protege_longueur, ~partage_longueur,
    ~total_longueur, ~protege_km_1000, ~partage_km_1000,
    "22001", 1000, 3.0, 2.0, 5.0, 3.0, 2.0,
    "22002", 3000, 1.0, 1.0, 2.0, 1 / 3, 1 / 3,
    "29001", 2000, 0, 0, 0, 0, 0,
    "29002", 4000, 2.0, 4.0, 6.0, 0.5, 1.0
  )

  agg <- agreger_offre_territoires(offre_tc, bornes, velo, base, cyclable)

  # la forme : une ligne par (territoire × clé × détail) — 4 communes + 2
  # EPCIs + 2 départements + la région, les QUATRE clés scalaires (détail NA,
  # dont le taux de bornes / 1 000 hab de l'issue #953) + les 5 détails de la
  # clé offre_cyclable
  expect_named(agg, c("code", "key", "detail", "value"))
  expect_equal(nrow(agg), (4 + 2 + 2 + 1) * (4 + 5))
  expect_setequal(unique(agg$key), c("offre_tc", "bornes_recharge",
                                     "places_stationnement_velo_1000",
                                     "bornes_recharge_1000",
                                     "offre_cyclable"))
  lire <- function(code, key, detail = NA) {
    ok <- agg$code == code & agg$key == key &
      (if (is.na(detail)) is.na(agg$detail) else agg$detail %in% detail)
    agg$value[ok]
  }

  # offre_tc : la moyenne PONDÉRÉE par les bâtiments (jamais la moyenne des
  # parts) — EPCI 200000001 : (0.5×100 + 0.8×300) ÷ 400 = 0.725
  expect_equal(lire("200000001", "offre_tc"), 0.725)
  # département 22 : (0.5×100 + 0.8×300) ÷ 400 ; région : le même calcul sur
  # les quatre communes (les îles sans poids comptent pour zéro)
  expect_equal(lire("22", "offre_tc"), 0.725)
  expect_equal(lire("53", "offre_tc"),
               (0.5 * 100 + 0.8 * 300 + 0.2 * 200 + 0.6 * 400) / 1000)
  # bornes : la SOMME, avec le ZÉRO porté par les communes sans station
  # (22002, 29001 ont 0 borne — jamais un NA) ; l'EPCI 200000002 n'agrège que
  # 29001 (29002 est la commune sans EPCI) : 0
  expect_equal(lire("200000001", "bornes_recharge"), 3)
  expect_equal(lire("200000002", "bornes_recharge"), 0)
  expect_equal(lire("29001", "bornes_recharge"), 0)
  expect_equal(lire("29002", "bornes_recharge"), 2)
  expect_equal(lire("53", "bornes_recharge"), 5)
  # velo : Σ places ÷ Σ population × 1 000 (jamais la moyenne des taux)
  # EPCI 200000001 : (30 + 90) ÷ (1 000 + 3 000) × 1 000 = 30
  expect_equal(lire("200000001", "places_stationnement_velo_1000"), 30)
  # région : (30+90+40+120) ÷ (1 000+3 000+2 000+4 000) × 1 000 = 28
  expect_equal(lire("53", "places_stationnement_velo_1000"), 28)
  # la commune sans EPCI (29002) n'agrège à AUCUN niveau EPCI — l'EPCI
  # 200000002 n'agrège que 29001 : offre_tc = 0.2 (29002 exclue), velo =
  # 40 ÷ 2 000 × 1 000 = 20, bornes = 0 (les 2 stations de 29002 ne montent
  # qu'au département 29 : 0 + 2 = 2)
  expect_equal(lire("200000002", "offre_tc"), 0.2)
  expect_equal(lire("200000002", "places_stationnement_velo_1000"), 20)
  expect_equal(lire("200000002", "bornes_recharge"), 0)
  expect_equal(lire("29", "bornes_recharge"), 2)

  # la clé offre_cyclable (issue #231) : les LONGUEURS SOMMÉES et les
  # km/1 000 hab RECOMPOSÉS depuis les parties (Σ km ÷ Σ population × 1 000 —
  # jamais la moyenne des taux communaux)
  # EPCI 200000001 (22001 + 22002) : protégé 3 + 1 = 4 km, partagé 2 + 1 = 3,
  # total 7 ; km/1 000 hab : 4 ÷ 4 000 × 1 000 = 1,0 et 3 ÷ 4 000 × 1 000 =
  # 0,75
  expect_equal(lire("200000001", "offre_cyclable", "protege_longueur"), 4.0)
  expect_equal(lire("200000001", "offre_cyclable", "partage_longueur"), 3.0)
  expect_equal(lire("200000001", "offre_cyclable", "total_longueur"), 7.0)
  expect_equal(lire("200000001", "offre_cyclable", "protege_km_1000"), 1.0)
  expect_equal(lire("200000001", "offre_cyclable", "partage_km_1000"), 0.75)
  # EPCI 200000002 : n'agrège QUE 29001 (sans aménagement) — le zéro porté,
  # jamais un NA (29002 est la commune sans EPCI, exclue)
  for (detail in c("protege_longueur", "partage_longueur", "total_longueur",
                   "protege_km_1000", "partage_km_1000")) {
    expect_equal(lire("200000002", "offre_cyclable", detail), 0, info = detail)
  }
  # département 29 (29001 + 29002) : protégé 0 + 2 = 2, partagé 0 + 4 = 4 ;
  # km/1 000 hab : 2 ÷ 6 000 × 1 000 = 1/3
  expect_equal(lire("29", "offre_cyclable", "protege_longueur"), 2.0)
  expect_equal(lire("29", "offre_cyclable", "partage_longueur"), 4.0)
  expect_equal(lire("29", "offre_cyclable", "total_longueur"), 6.0)
  expect_equal(lire("29", "offre_cyclable", "protege_km_1000"), 1 / 3)
  # région : protégé 6, partagé 7, total 13 ; km/1 000 hab sur 10 000 hab
  expect_equal(lire("53", "offre_cyclable", "protege_longueur"), 6.0)
  expect_equal(lire("53", "offre_cyclable", "partage_longueur"), 7.0)
  expect_equal(lire("53", "offre_cyclable", "total_longueur"), 13.0)
  expect_equal(lire("53", "offre_cyclable", "protege_km_1000"), 0.6)
  expect_equal(lire("53", "offre_cyclable", "partage_km_1000"), 0.7)
  # la commune garde SES valeurs telles quelles
  expect_equal(lire("22001", "offre_cyclable", "protege_longueur"), 3.0)
  expect_equal(lire("22001", "offre_cyclable", "protege_km_1000"), 3.0)
  # la commune sans aménagement porte 0 à tous les détails
  expect_equal(lire("29001", "offre_cyclable", "total_longueur"), 0)
  # déterministe : trié par code puis clé puis détail
  expect_true(!is.unsorted(paste(agg$code, agg$key, agg$detail)))
})

# Les densités de ravitaillement (issue #953) : le compte de stations-service
# B316 et les deux taux pour 1 000 hab. Les EPCI/départements SOMMENT les
# comptes des parties (jamais une moyenne de taux), puis recalculent le taux
# avec la population du territoire — le dénominateur du hub stationnement vélo,
# le même que les densités de stationnement. Une observation BPE absente reste
# absente (jamais un zéro inventé) ; le zéro observé d'une commune rurale sans
# station reste un fait.
test_that("agreger_offre_territoires : stations-service et densités / 1 000 hab. recalculées depuis les comptes (#953)", {
  base <- tibble::tribble(
    ~CODGEO, ~EPCI, ~DEP,
    "22001", "200000001", "22",
    "22002", "200000001", "22",
    "29001", "200000002", "29",
    "29002", NA, "29"
  )
  offre_tc <- tibble::tribble(
    ~commune, ~n_adresses, ~n_proches, ~part_proche,
    "22001", 100, 50, 0.5,
    "22002", 300, 240, 0.8,
    "29001", 200, 40, 0.2,
    "29002", 400, 240, 0.6
  )
  bornes <- tibble::tribble(
    ~commune, ~nb_bornes,
    "22001", 3, "29002", 2
  )
  velo <- tibble::tribble(
    ~commune, ~annee, ~places, ~population, ~places_1000,
    "22001", "2025", 30, 1000, 30,
    "22002", "2025", 90, 3000, 30,
    "29001", "2025", 40, 2000, 20,
    "29002", "2025", 120, 4000, 30
  )
  cyclable <- tibble::tribble(
    ~commune, ~population, ~protege_longueur, ~partage_longueur,
    ~total_longueur, ~protege_km_1000, ~partage_km_1000,
    "22001", 1000, 3.0, 2.0, 5.0, 3.0, 2.0,
    "22002", 3000, 1.0, 1.0, 2.0, 1 / 3, 1 / 3,
    "29001", 2000, 0, 0, 0, 0, 0,
    "29002", 4000, 2.0, 4.0, 6.0, 0.5, 1.0
  )
  # BPE B316 observée pour les quatre communes — 22002 est un zéro OBSERVÉ
  fuel <- tibble::tibble(
    code = c("22001", "22002", "29001", "29002"),
    fuel = c(2, 0, 1, 3))

  agg <- agreger_offre_territoires(
    offre_tc, bornes, velo, base, cyclable, fuel_communes = fuel)

  lire <- function(code, key) {
    agg$value[agg$code == code & agg$key == key]
  }
  expect_true(all(c("stations_service", "stations_service_1000",
                    "bornes_recharge_1000") %in% unique(agg$key)))
  expect_true(all(is.na(agg$detail[agg$key %in% c(
    "stations_service", "stations_service_1000", "bornes_recharge_1000")])))
  # le compte : une ligne par territoire, le zéro observé est un fait
  for (code in c("22001", "22002", "29001", "29002")) {
    expect_equal(lire(code, "stations_service"),
                 fuel$fuel[fuel$code == code], info = code)
  }
  expect_equal(lire("200000001", "stations_service"), 2)
  # 29002 (sans EPCI) n'agrège à aucun niveau EPCI — l'EPCI 200000002 ne
  # porte que la station de 29001
  expect_equal(lire("200000002", "stations_service"), 1)
  expect_equal(lire("22", "stations_service"), 2)
  expect_equal(lire("29", "stations_service"), 4)
  expect_equal(lire("53", "stations_service"), 6)

  # les taux sont RECALCULÉS depuis les comptes et la population du territoire
  # — jamais la moyenne des taux communaux (EPCI 200000001 : 2 / 4 000 × 1 000
  # = 0,5, pas la moyenne de 2 et 0)
  expect_equal(lire("200000001", "stations_service_1000"), 0.5)
  expect_equal(lire("200000002", "stations_service_1000"), 0.5)
  expect_equal(lire("22", "stations_service_1000"), 0.5)
  expect_equal(lire("29", "stations_service_1000"), 4 / 6000 * 1000)
  expect_equal(lire("53", "stations_service_1000"), 6 / 10000 * 1000)
  # le taux de bornes suit la même règle (Σ bornes ÷ Σ population × 1 000) ;
  # le zéro porté d'une commune sans borne reste un fait
  expect_equal(lire("22001", "bornes_recharge_1000"), 3)
  expect_equal(lire("22002", "bornes_recharge_1000"), 0)
  expect_equal(lire("200000001", "bornes_recharge_1000"), 3 / 4000 * 1000)
  expect_equal(lire("200000002", "bornes_recharge_1000"), 0)
  expect_equal(lire("53", "bornes_recharge_1000"), 5 / 10000 * 1000)

  # une observation BPE absente n'est jamais un zéro : le compte et son taux
  # restent absents à tous les niveaux qui contiennent la commune, tandis que
  # la densité de bornes reste calculable
  fuel_incomplet <- fuel[fuel$code != "22002", ]
  agg_na <- agreger_offre_territoires(
    offre_tc, bornes, velo, base, cyclable, fuel_communes = fuel_incomplet)
  lire_na <- function(code, key) {
    agg_na$value[agg_na$code == code & agg_na$key == key]
  }
  expect_true(is.na(lire_na("22002", "stations_service")))
  expect_true(is.na(lire_na("22002", "stations_service_1000")))
  expect_true(is.na(lire_na("200000001", "stations_service")))
  expect_true(is.na(lire_na("200000001", "stations_service_1000")))
  expect_true(is.na(lire_na("22", "stations_service")))
  expect_true(is.na(lire_na("53", "stations_service")))
  expect_equal(lire_na("200000001", "bornes_recharge_1000"),
               3 / 4000 * 1000)
  # les autres communes observées gardent leur fait
  expect_equal(lire_na("29001", "stations_service"), 1)

  # la forme : les douze clés du bloc pour chaque territoire (les trois
  # scalaires, les cinq mesures cyclables, le ratio et les trois nouvelles)
  expect_equal(nrow(agg), 9L * 12L)
  expect_equal(sort(unique(agg$key)), sort(c(
    "offre_tc", "bornes_recharge", "places_stationnement_velo_1000",
    "offre_cyclable", "bornes_ev_par_station_service",
    "stations_service", "stations_service_1000", "bornes_recharge_1000")))
})

# INDICATEURS_MOBILITE -----------------------------------------------------------

test_that("INDICATEURS_MOBILITE : les dix-sept clés retenues, chacune estampillée", {
  ind <- INDICATEURS_MOBILITE
  expect_equal(nrow(ind), 17L)
  expect_setequal(ind$key, c("voitures_menage", "reseaux", "reseaux_par_habitant",
  "surface_reseaux_routiers", "offre_tc", "bornes_recharge",
  "places_stationnement_velo_1000", "places_stationnement_voiture_1000",
  "bornes_ev_par_station_service", "stationnement_velo_par_voiture",
  "stations_service", "stations_service_1000", "bornes_recharge_1000",
  "offre_cyclable", "raccordement_tc", "raccordement_courbe",
  "raccordement_reference"))
  expect_false(any(c("tot_loss_t", "tot_loss_b", "nb_buildings",
                     "iso_alimentation", "share_food_t", "avg_tot_car") %in%
                     ind$key))
  expect_equal(ind$multiplicite[ind$key == "voitures_menage"], 3L)
  expect_equal(ind$multiplicite[ind$key == "reseaux"], 3L)
  expect_equal(ind$multiplicite[ind$key == "reseaux_par_habitant"], 3L)
  expect_equal(ind$multiplicite[ind$key == "offre_cyclable"], 5L)
  expect_equal(ind$multiplicite[ind$key == "offre_tc"], 1L)
  grille_n <- length(grille_raccordement_national())
  expect_equal(ind$multiplicite[ind$key == "raccordement_tc"], 1L)
  expect_equal(ind$multiplicite[ind$key == "raccordement_courbe"], grille_n)
  expect_true(is.na(ind$multiplicite[ind$key == "raccordement_reference"]))
  for (cle in c("stations_service", "stations_service_1000",
                "bornes_recharge_1000"))
    expect_equal(ind$multiplicite[ind$key == cle], 1L, info = cle)
  expect_equal(ind$source_reference[ind$key == "voitures_menage"],
               "rp_logement_princ")
  expect_equal(ind$source_reference[ind$key == "reseaux"], "amenagements_cyclables")
  expect_equal(ind$source_reference[ind$key == "reseaux_par_habitant"], "osm_reseaux")
  expect_equal(ind$source_reference[ind$key == "offre_tc"], "korrigo")
  expect_equal(ind$source_reference[ind$key == "bornes_recharge"], "bornes-recharges")
  expect_equal(ind$source_reference[ind$key == "stations_service"], "bpe_b316")
  expect_equal(ind$source_reference[ind$key == "bornes_recharge_1000"], "bornes-recharges")
  expect_equal(ind$source_reference[ind$key == "offre_cyclable"], "osm_reseaux")
  for (cle in c("raccordement_tc", "raccordement_courbe", "raccordement_reference"))
    expect_equal(ind$source_reference[ind$key == cle], "raccordement_gtfs_national")
  # le dénominateur d'offre_tc est le spine d'adresses : la couche bâtiments
  # n'est plus une source de l'indicateur
  expect_false(any(grepl("batiments", unlist(ind$sources))))
})

# fixture_raccordement ------------------------------------------------------------
# L'assembleur national consomme un résultat complet et validé, jamais une
# miniature présentée comme la production nationale. Les exemples de calcul à
# trois communes restent à la couture du calcul dans test-raccordement-national.
fixture_raccordement <- function() {
  lire_artefact_raccordement_national()
}

territoires_fixture_indicateurs_mobilite <- function() {
  path <- file.path(pkgload::pkg_path(), "..", "public", "data", "territoires.parquet")
  nanoparquet::read_parquet(path) %>% dplyr::rename(code = territoire)
}

histoires_fixture_indicateurs_mobilite <- function() {
  # #1048 : le producteur n'émet plus aucune lecture — la table est VIDE.
  # Le Parquet `histoires_mobilite.parquet` committé est l'état ANTÉRIEUR au
  # retrait (facts non republiés en slice 2) : il ne doit plus servir de fixture.
  data.frame(
    territoire = character(), type = character(), theme = character(),
    story_key = character(), stringsAsFactors = FALSE
  )
}

# fixture_indicateurs_mobilite ---------------------------------------------------
 # La liste des artefacts analytiques pour l'assemblage des indicateurs (le seam
 # construire_indicateurs_mobilite, issue #141) : la « Taille », les 5 parts
# d'isolation et LEURS RANGS (mocked — la forme exacte des artefacts que le
# chaînon persiste : isolation_territoires.rds et isolation_rangs.rds), l'étage
# demande/réseaux et le sous-bloc. La forme de chaque table est celle des
# builders réels — le seam ne calcule RIEN, il assemble.

fixture_indicateurs_mobilite <- function() {
  territoires <- territoires_fixture_indicateurs_mobilite()
  codes <- territoires$codes %||% territoires$code
  voitures_territoires <- tidyr::crossing(code = codes,
    detail = c("sans_voiture", "une_voiture", "deux_plus")) %>%
    dplyr::mutate(key = "voitures_menage",
      value = dplyr::if_else(detail == "sans_voiture", 0.2,
                             dplyr::if_else(detail == "une_voiture", 0.5, 0.3)))
  reseaux_territoires <- tidyr::crossing(code = codes,
    detail = c("t_longueur", "b_longueur", "c_longueur")) %>%
    dplyr::mutate(key = "reseaux", value = 1)
  reseaux_par_habitant_territoires <- tidyr::crossing(code = codes,
    detail = c("t_km_1000", "b_km_1000", "c_km_1000")) %>%
    dplyr::mutate(key = "reseaux_par_habitant", value = 2)
  surface_reseaux_routiers_territoires <- tibble::tibble(code = codes, value = 0.1)
  offre_territoires <- dplyr::bind_rows(
    tidyr::crossing(code = codes, key = c("offre_tc", "bornes_recharge",
      "places_stationnement_velo_1000", "places_stationnement_voiture_1000",
      "bornes_ev_par_station_service", "stationnement_velo_par_voiture",
      "stations_service", "stations_service_1000", "bornes_recharge_1000")) %>%
      dplyr::mutate(detail = NA_character_,
                    value = dplyr::if_else(key == "offre_tc", 0.5, 10)),
    tidyr::crossing(code = codes,
      detail = c("protege_longueur", "protege_km_1000", "partage_longueur",
                 "partage_km_1000", "total_longueur")) %>%
      dplyr::mutate(key = "offre_cyclable", value = 1)
  )
  list(
    voitures_territoires = voitures_territoires,
    reseaux_territoires = reseaux_territoires,
    reseaux_par_habitant_territoires = reseaux_par_habitant_territoires,
    surface_reseaux_routiers_territoires = surface_reseaux_routiers_territoires,
    offre_territoires = offre_territoires,
    raccordement = fixture_raccordement()
  )
}


test_that("construire_indicateurs_mobilite : les dix-sept clés retenues, leurs rangs et estampilles", {
  fx <- fixture_indicateurs_mobilite()
  territoires <- territoires_fixture_indicateurs_mobilite()
  n_territoires <- nrow(territoires)
  ind <- construire_indicateurs_mobilite(fx, territoires, vintages_mobilite())
  expect_setequal(unique(ind$key), c("voitures_menage", "reseaux", "reseaux_par_habitant",
  "surface_reseaux_routiers", "offre_tc", "bornes_recharge",
  "places_stationnement_velo_1000", "places_stationnement_voiture_1000",
  "bornes_ev_par_station_service", "stationnement_velo_par_voiture",
  "stations_service", "stations_service_1000", "bornes_recharge_1000",
  "offre_cyclable", "raccordement_tc", "raccordement_courbe",
  "raccordement_reference"))
  expect_false(any(c("nb_buildings", "tot_loss_t", "iso_banque",
                     "share_food_t", "avg_tot_car") %in% ind$key))
  grille_n <- length(grille_raccordement_national())
  expect_equal(nrow(ind),
    n_territoires * (3L + 3L + 3L + 1L + 9L + 5L + 1L) +
      n_territoires * grille_n + grille_n)
  expect_equal(sum(ind$key == "voitures_menage"), n_territoires * 3)
  expect_equal(sum(ind$key == "reseaux"), n_territoires * 3)
  expect_equal(sum(ind$key == "reseaux_par_habitant"), n_territoires * 3)
  expect_equal(sum(ind$key == "surface_reseaux_routiers"), n_territoires)
  expect_equal(sum(ind$key == "offre_cyclable"), n_territoires * 5)
  for (cle in c("offre_tc", "bornes_recharge", "places_stationnement_velo_1000",
                "places_stationnement_voiture_1000", "bornes_ev_par_station_service",
                "stationnement_velo_par_voiture", "stations_service",
                "stations_service_1000", "bornes_recharge_1000"))
    expect_equal(sum(ind$key == cle), n_territoires, info = cle)
  expect_equal(unique(ind$unit[ind$key == "stations_service"]), "stations")
  expect_equal(unique(ind$unit[ind$key == "bornes_recharge_1000"]), "bornes / 1 000 hab")
  for (cle in c("stations_service", "stations_service_1000", "bornes_recharge_1000"))
    expect_true(any(!is.na(ind$rang_epci[ind$key == cle])), info = cle)
  # l'estampille de l'offre cyclable : l'horloge lente OSM
  ref_osm <- vintages_mobilite()$source[vintages_mobilite()$id == "osm_reseaux"]
  expect_true(all(ind$vintage_source[ind$key == "offre_cyclable"] == ref_osm))
  # LE RACCORDEMENT : le scalaire et ses deux clés de figure
  racc_ind <- ind[ind$key == "raccordement_tc", ]
  expect_equal(racc_ind$value[racc_ind$territoire == "35238"], 0.43772196082183124)
  non_routee <- racc_ind[racc_ind$territoire == "22001", ]
  expect_equal(non_routee$value, 0)
  expect_equal(non_routee$rider, "no_modeled_endpoint_stops")
  ref_national <- vintages_mobilite()$source[
    vintages_mobilite()$id == "raccordement_gtfs_national"]
  expect_true(all(racc_ind$vintage_source == ref_national))
  expect_true(all(racc_ind$vintage_date_reference == "2026-10-10"))
  courbe_ind <- ind[ind$key == "raccordement_courbe", ]
  expect_equal(sum(courbe_ind$territoire == "22001"), grille_n)
  expect_setequal(courbe_ind$detail[courbe_ind$territoire == "22001"],
                  grille_raccordement_national())
  reference_ind <- ind[ind$key == "raccordement_reference", ]
  expect_setequal(unique(reference_ind$territoire), "53")
  expect_equal(nrow(reference_ind), grille_n)
})


test_that("construire_rangs_detail : le rang PAR DÉTAIL consomme la direction DÉCLARÉE de SA clé (#368)", {
  # le mécanisme de l'audit ordinal : chaque mesure est classée dans SON groupe
  # avec la direction de SA clé (DIRECTIONS_MOBILITE — jamais le défaut
  # high-is-good de rang_ordinal_par_groupe). Deux communes du même EPCI X,
  # deux détails, la valeur de 22001 supérieure à celle de 22002 : avec le
  # high déclaré, 22001 est 1re ; en basculant la clé en low (la preuve que la
  # déclaration EST consommée), les rangs s'INVERSENT.
  base <- base_epci_mini_analytique()
  poids <- tibble::tibble(commune = c("22001", "22002", "29001", "29002"),
                          n_adresses = c(100, 300, 200, 400))
  territoires <- construire_territoires_mobilite(
    base, list(mobilite_communes = poids)
  )
  table_long <- tidyr::crossing(
    code = territoires$code,
    detail = c("mesure_a", "mesure_b")
  ) %>%
    dplyr::mutate(
      key = "voitures_menage",
      # 22001 > 22002 dans le même EPCI X ; les autres codes portent des
      # valeurs hors du groupe comparé
      value = dplyr::case_when(
        code == "22001" ~ 0.8,
        code == "22002" ~ 0.2,
        TRUE ~ 0.5
      )
    )

  lire <- function(rangs, code, detail) {
    rangs$rang_epci[rangs$code == code & rangs$detail == detail]
  }
  # la direction par défaut (DIRECTIONS_MOBILITE — high pour voitures_menage) :
  # 22001 (0.8) est 1re de l'EPCI X
  rang_high <- construire_rangs_detail(table_long, territoires)
  expect_equal(lire(rang_high, "22001", "mesure_a"), 1)
  expect_equal(lire(rang_high, "22002", "mesure_a"), 2)
  # la direction DÉCLARÉE basculée en low : la plus PETITE valeur est 1re — les
  # rangs s'inversent, la déclaration est consommée
  rang_low <- construire_rangs_detail(
    table_long, territoires, directions = list(voitures_menage = "low")
  )
  expect_equal(lire(rang_low, "22001", "mesure_a"), 2)
  expect_equal(lire(rang_low, "22002", "mesure_a"), 1)
  # une clé SANS direction déclarée est une erreur de descripteur, jamais un
  # défaut silencieux
  expect_error(
    construire_rangs_detail(
      table_long, territoires,
      directions = list(reseaux = "high")
    ),
    "voitures_menage"
  )
})


test_that("validations_mobilite : le raccordement hors domaine ou hors grille fait échouer la validation bruyamment (#486)", {
  fx <- fixture_indicateurs_mobilite()
  territoires <- territoires_fixture_indicateurs_mobilite()
  fabriquer_payload <- function() list(
    indicateurs = construire_indicateurs_mobilite(fx, territoires,
                                                  vintages_mobilite()),
    histoires = histoires_fixture_indicateurs_mobilite(),
    territoires = reference_territoires(territoires),
    apercu = assemble_apercu(territoires, list())
  )

  # une part joignable > 1 (une corruption du calcul) fait échouer
  payload <- fabriquer_payload()
  payload$indicateurs$value[
    payload$indicateurs$key == "raccordement_tc" &
      payload$indicateurs$territoire == "22001"] <- 1.5
  expect_error(validate_payload(
    payload, indicateurs = INDICATEURS_MOBILITE,
    vintages = vintages_mobilite(), validations = validations_mobilite,
    apercu = APERCU_MOBILITE), "population joignable")

  # un détail de courbe HORS GRILLE (91 minutes) fait échouer
  payload <- fabriquer_payload()
  courbe <- which(payload$indicateurs$key == "raccordement_courbe" &
                    payload$indicateurs$detail == "t0090")
  payload$indicateurs$detail[courbe[1]] <- "t0091"
  expect_error(validate_payload(
    payload, indicateurs = INDICATEURS_MOBILITE,
    vintages = vintages_mobilite(), validations = validations_mobilite,
    apercu = APERCU_MOBILITE), "grille publiée")

  # un détail MAL FORMÉ fait échouer
  payload <- fabriquer_payload()
  courbe <- which(payload$indicateurs$key == "raccordement_reference" &
                    payload$indicateurs$detail == "t0000")
  payload$indicateurs$detail[courbe[1]] <- "90 minutes"
  expect_error(validate_payload(
    payload, indicateurs = INDICATEURS_MOBILITE,
    vintages = vintages_mobilite(), validations = validations_mobilite,
    apercu = APERCU_MOBILITE), "grille publiée")
})

# =============================================================================
# La figure « L'offre cyclable » (issue #231, la binaison provisoire d'ADR-0016)
# =============================================================================
# Les tests unitaires du builder calculer_offre_cyclable_communes : la table
# communale de la figure (protégé/partagé en km et km/1 000 hab + le total
# cyclable — le numérateur du ratio « X % de l'infrastructure routière »). Le
# même jeu Geovelo que le mode `b` de `reseaux`, la même attribution par le
# côté porteur (ADR-0016), mais la longueur en GÉOMÉTRIE UNIQUE (chaque segment
# compté UNE fois — le contre-pied assumé du comptage par direction du mode
# `b` : le ratio compare au réseau `c`, lui-même en géométrie unique, les deux
# conventions doivent coïncider pour que le « X % » soit honnête, ADR-0016).
#
# La binaison provisoire est VERROUILLÉE sur la forme RÉELLE du jeu : une
# ligne par valeur de l'enum ame_d/ame_g (le schéma national v0.3.5, vérifié
# sur le fichier réel — 27 797 lignes bretonnes, 2026-08-08), chaque valeur
# dans SA famille (protégé = pistes, voies vertes, CVCB, mixte piéton-vélo ;
# partagé = bandes, doubles sens, vélos rues, couloirs bus+vélo, AUTRE,
# accotements + les auxiliaires GOULOTTE/RAMPE — la décision provisoire).

# fixture_offre_cyclable_binning ------------------------------------------------
# Un segment de 1 000 m par valeur RÉELLE de l'enum, attribué à la commune
# 22001 (le motif 3 communes du contrat), sens NA (la géométrie unique ne
# multiplie jamais). 5 protégés + 9 partagés = 14 km attendus sur 22001.
fixture_offre_cyclable_binning <- function() {
  valeurs <- c(
    # protégé
    "PISTE CYCLABLE", "DOUBLE SENS CYCLABLE PISTE", "VOIE VERTE",
    "CHAUSSEE A VOIE CENTRALE BANALISEE",
    "AMENAGEMENT MIXTE PIETON VELO HORS VOIE VERTE",
    # partagé
    "BANDE CYCLABLE", "DOUBLE SENS CYCLABLE BANDE",
    "DOUBLE SENS CYCLABLE NON MATERIALISE", "VELO RUE",
    "COULOIR BUS+VELO", "AUTRE", "ACCOTEMENT REVETU HORS CVCB",
    "GOULOTTE", "RAMPE"
  )
  n <- length(valeurs)
  geoms <- lapply(seq_len(n), function(i) {
    x0 <- (i - 1) %% 2 * 1000
    y0 <- floor((i - 1) / 2) * 100 + 100
    sf::st_linestring(rbind(c(x0, y0), c(x0 + 1000, y0)))
  })
  sf::st_sf(
    id_local = paste0("B", seq_len(n)),
    code_com_d = rep("22001", n), code_com_g = rep("22001", n),
    ame_d = valeurs, ame_g = rep("AUCUN", n),
    sens_d = rep(NA_character_, n), sens_g = rep(NA_character_, n),
    geometry = sf::st_sfc(geoms),
    crs = 2154
  )
}

# fixture_population_mini -------------------------------------------------------
# La population communale de l'univers : 22001 (1 000 hab) + DEUX communes SANS
# aménagement (22002, 29001 — le zéro porté, jamais une ligne manquante).
fixture_population_mini <- function() {
  tibble::tibble(
    commune = c("22001", "22002", "29001"),
    population = c(1000, 2000, 500)
  )
}

test_that("calculer_offre_cyclable_communes : la binaison provisoire verrouillée sur la forme réelle du jeu", {
  res <- calculer_offre_cyclable_communes(fixture_offre_cyclable_binning(),
                                          fixture_population_mini())

  # une ligne par commune de l'univers (les 3), la forme du contrat
  expect_equal(nrow(res), 3)
  expect_named(res, c("commune", "population", "protege_longueur",
                      "partage_longueur", "total_longueur",
                      "protege_km_1000", "partage_km_1000"))
  lire <- function(commune) res[res$commune == commune, ]

  # la binaison verrouillée : 5 valeurs protégées × 1 km = 5 km, 9 valeurs
  # partagées × 1 km = 9 km — le total cyclable = protégé + partagé (le
  # numérateur du ratio, exactement une somme)
  expect_equal(lire("22001")$protege_longueur, 5.0)
  expect_equal(lire("22001")$partage_longueur, 9.0)
  expect_equal(lire("22001")$total_longueur, 14.0)
  # km / 1 000 hab : 22001 population 1 000 → 5 et 9
  expect_equal(lire("22001")$protege_km_1000, 5.0)
  expect_equal(lire("22001")$partage_km_1000, 9.0)
  # la commune SANS aménagement porte 0 (un fait, jamais une ligne manquante,
  # jamais supprimée)
  expect_equal(lire("22002")$protege_longueur, 0)
  expect_equal(lire("22002")$partage_longueur, 0)
  expect_equal(lire("22002")$total_longueur, 0)
  expect_equal(lire("22002")$protege_km_1000, 0)
  expect_equal(lire("22002")$partage_km_1000, 0)
  expect_equal(lire("29001")$total_longueur, 0)
  # déterministe : trié par commune
  expect_true(!is.unsorted(res$commune))
})

test_that("calculer_offre_cyclable_communes : la longueur en GÉOMÉTRIE UNIQUE (une piste bidirectionnelle compte 1×)", {
  # une piste bidirectionnelle de 2 000 m — le mode `b` de `reseaux` la compte
  # 2× (4 km, ADR-0016, verrouillé par le test de calculer_reseaux_velo_
  # communes) ; la figure « L'offre cyclable » la compte 1× (2 km) : le
  # numérateur du ratio compare au réseau `c` (le pbf mesure chaque way une
  # fois — géométrie unique), les conventions doivent coïncider
  bidir <- sf::st_sf(
    id_local = "B1", code_com_d = "22001", code_com_g = "22001",
    ame_d = "PISTE CYCLABLE", ame_g = "AUCUN",
    sens_d = "BIDIRECTIONNEL", sens_g = "BIDIRECTIONNEL",
    geometry = sf::st_sfc(sf::st_linestring(rbind(c(0, 0), c(2000, 0)))),
    crs = 2154
  )
  res <- calculer_offre_cyclable_communes(bidir, fixture_population_mini())
  expect_equal(res$protege_longueur[res$commune == "22001"], 2.0)
  expect_equal(res$total_longueur[res$commune == "22001"], 2.0)
  expect_equal(res$protege_km_1000[res$commune == "22001"], 2.0)
})

test_that("calculer_offre_cyclable_communes : l'attribution par le CÔTÉ PORTEUR (ADR-0016), le d départage, la famille du côté gagnant", {
  pop <- tibble::tibble(commune = c("22001", "22002"),
                        population = c(1000, 2000))
  segment <- function(code_d, code_g, ame_d, ame_g) {
    sf::st_sf(
      id_local = "B", code_com_d = code_d, code_com_g = code_g,
      ame_d = ame_d, ame_g = ame_g,
      sens_d = NA_character_, sens_g = NA_character_,
      geometry = sf::st_sfc(sf::st_linestring(rbind(c(2000, 500), c(2000, 1500)))),
      crs = 2154
    )
  }
  lire <- function(res, commune) res[res$commune == commune, ]

  # le côté d porte seul → la commune du d, la famille du d (protégé)
  res <- calculer_offre_cyclable_communes(
    segment("22001", "22002", "PISTE CYCLABLE", "AUCUN"), pop)
  expect_equal(lire(res, "22001")$protege_longueur, 1.0)
  expect_equal(lire(res, "22001")$total_longueur, 1.0)
  # le côté g porte seul → la commune du g, la famille du g (partagé)
  res <- calculer_offre_cyclable_communes(
    segment("22001", "22002", "AUCUN", "BANDE CYCLABLE"), pop)
  expect_equal(lire(res, "22002")$partage_longueur, 1.0)
  expect_equal(lire(res, "22002")$total_longueur, 1.0)
  # les DEUX portent → le d départage, la famille du côté GAGNANT (le d, bande)
  res <- calculer_offre_cyclable_communes(
    segment("22001", "22002", "BANDE CYCLABLE", "PISTE CYCLABLE"), pop)
  expect_equal(lire(res, "22001")$partage_longueur, 1.0)
  expect_equal(lire(res, "22001")$protege_longueur, 0)
  expect_equal(lire(res, "22002")$total_longueur, 0)
  # la longueur totale de la région = la somme des parties (zéro double-compte)
  expect_equal(sum(res$total_longueur), 1.0)
})

test_that("calculer_offre_cyclable_communes : la projection EPSG:2154 précède toute mesure (l'entrée WGS84 mesure juste)", {
  # les MÊMES segments en WGS84 (le crs du lecteur — le normaliseur livre le sf
  # en EPSG:4326) : le builder projette AVANT st_length — les longueurs restent
  # en mètres
  amen <- sf::st_transform(fixture_offre_cyclable_binning(), 4326)
  res <- calculer_offre_cyclable_communes(amen, fixture_population_mini())
  lire <- function(commune) res[res$commune == commune, ]
  expect_equal(round(lire("22001")$protege_longueur, 3), 5.0)
  expect_equal(round(lire("22001")$partage_longueur, 3), 9.0)
  expect_equal(round(lire("22001")$total_longueur, 3), 14.0)
})

test_that("calculer_offre_cyclable_communes : un input corrompu s'arrête bruyamment", {
  # une colonne requise manquante nomme la colonne fautive
  defectueux <- fixture_offre_cyclable_binning()
  defectueux$ame_g <- NULL
  expect_error(calculer_offre_cyclable_communes(defectueux,
                                                fixture_population_mini()),
               "ame_g")
  # une valeur d'enum HORS binaison est une corruption (le contrat du jeu a
  # changé — jamais une ligne silencieusement perdue)
  defectueux <- fixture_offre_cyclable_binning()
  defectueux$ame_d[1] <- "NOUVEAU TYPE DU JEU"
  expect_error(calculer_offre_cyclable_communes(defectueux,
                                                fixture_population_mini()),
               "binaison")
  # un segment sans aménagement des DEUX côtés (AUCUN/AUCUN) est une corruption
  defectueux <- fixture_offre_cyclable_binning()
  defectueux$ame_d[1] <- "AUCUN"
  defectueux$ame_g[1] <- "AUCUN"
  expect_error(calculer_offre_cyclable_communes(defectueux,
                                                fixture_population_mini()),
               "AUCUN")
  # un segment attribué à une commune HORS référentiel (population absente)
  defectueux <- fixture_offre_cyclable_binning()
  defectueux$code_com_d[1] <- "99999"
  expect_error(calculer_offre_cyclable_communes(defectueux,
                                                fixture_population_mini()),
               "référentiel")
  # un fichier vide est une corruption
  vide <- fixture_offre_cyclable_binning()[0, ]
  expect_error(calculer_offre_cyclable_communes(vide, fixture_population_mini()),
               "aucune ligne")
  # une table de population sans la colonne population est refusée
  expect_error(calculer_offre_cyclable_communes(
    fixture_offre_cyclable_binning(),
    tibble::tibble(commune = "22001")), "population")
})

# #1041 : le builder territorial de la Mobilité conserve la classification
# littorale publiée par le seam partagé, sans dépendre d'un autre thème.

test_that("construire_territoires_mobilite : poids-Adresse et classification littorale", {
  poids <- tibble::tibble(commune = c("22001", "22002", "29001", "29002"),
                          n_adresses = c(100, 300, 200, 400))
  source <- tibble::tibble(Code_insee = "22001", Commune = "Commune A1",
                           Dpt = "22", Classement = "Mer")
  attr(source, "pin_verifie") <- TRUE
  territoires <- construire_territoires_mobilite(
    base_epci_mini_analytique(), list(mobilite_communes = poids),
    classes_littoral = source)
  expect_true(all(c("littoral_code", "littoral_classement_source") %in%
                    names(territoires)))
  expect_identical(territoires$littoral_code[territoires$code == "22001"], "C")
  expect_true(all(territoires$littoral_code[territoires$type == "commune"] %in%
                    c("C", "NC")))
  expect_true(all(is.na(territoires$littoral_code[territoires$type != "commune"])))
})

# #1041 : le seam publier_mobilite TRANSMET la classification au payload (le
# builder réel de la référence), au lieu de l'abandonner en silence.

test_that("publier_mobilite transmet classes_littoral au payload", {
  vu <- new.env(parent = emptyenv())
  source <- tibble::tibble(Code_insee = "22001", Commune = "Commune A1",
                           Dpt = "22", Classement = "Mer")
  local_mocked_bindings(
    lire_epci = function(chemin) base_epci_mini_analytique(),
    construire_analytiques_mobilite = function(donnees, base_epci, sortie, ...) {
      list(mobilite_communes = tibble::tibble(commune = "22001", n_adresses = 1))
    },
    lire_artefact_raccordement_national = function() list(),
    construire_payload_mobilite = function(analytiques, base_epci, vintages, ...) {
      vu$classes_littoral <- list(...)$classes_littoral
      list(indicateurs = tibble::tibble(), histoires = tibble::tibble(),
           territoires = tibble::tibble(), apercu = tibble::tibble())
    },
    publish = function(...) invisible(NULL),
    .package = "lusk"
  )
  publier_mobilite(list(), cache = tempdir(), vintages = vintages_mobilite(),
                   sortie = tempfile("sortie-mobilite-littoral-"),
                   classes_littoral = source,
                   reference = reference_canonique_minimale_test())
  expect_identical(vu$classes_littoral, source)
})
test_that("compute_histoires_mobilite : le thème ne porte plus de lecture (#1048)", {
  vide <- compute_histoires_mobilite(list(), vintages_mobilite())
  expect_equal(nrow(vide), 0L)
  expect_true(all(c("territoire", "type", "theme", "story_key") %in% names(vide)))
  resolu <- resoudre_histoires(vide, "mobilite")
  expect_equal(nrow(resolu), 0L)
})

test_that("validations_mobilite : les corruptions des validateurs survivants échouent bruyamment", {
  fx <- fixture_indicateurs_mobilite()
  territoires <- territoires_fixture_indicateurs_mobilite()
  fabriquer_payload <- function() list(
    indicateurs = construire_indicateurs_mobilite(fx, territoires,
                                                  vintages_mobilite()),
    histoires = resoudre_histoires(compute_histoires_mobilite(fx,
      vintages_mobilite()), "mobilite"),
    territoires = reference_territoires(territoires),
    apercu = assemble_apercu(territoires, list())
  )
  valider <- function(payload) validate_payload(
    payload, indicateurs = INDICATEURS_MOBILITE,
    vintages = vintages_mobilite(), validations = validations_mobilite,
    apercu = APERCU_MOBILITE)

  # un payload sain passe la validation générique + les validations du thème
  expect_no_error(valider(fabriquer_payload()))

  # une part de surface routière > 1 est une corruption (aire intersectée)
  payload <- fabriquer_payload()
  payload$indicateurs$value[
    payload$indicateurs$key == "surface_reseaux_routiers" &
      payload$indicateurs$territoire == "22001"] <- 1.5
  expect_error(valider(payload), "surface routière")

  # une longueur d'offre cyclable négative est une corruption
  payload <- fabriquer_payload()
  payload$indicateurs$value[
    payload$indicateurs$key == "offre_cyclable" &
      payload$indicateurs$detail == "protege_longueur" &
      payload$indicateurs$territoire == "22001"] <- -1
  expect_error(valider(payload), "offre cyclable")
})
