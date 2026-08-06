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

test_that("MANIFEST_MOBILITE : les huit sources du thème, les 11 colonnes standard", {
  m <- MANIFEST_MOBILITE

  # le manifeste est un tibble de HUIT lignes : le snapshot porté + les trois
  # sources de l'étage demande/réseaux (issue #139 : voitures/ménage RP,
  # réseaux OSM, limites communales) + les quatre sources du sous-bloc
  # « L'offre de mobilité alternative » (issue #140 : korrigo — la base GTFS
  # dont les arrêts —, batiments_residentiels — la couche bâtiments —,
  # bornes-recharges IRVE et stationnement-velo, le hub Ecolab).
  # mobibreizh-stops et communes-france sont ABSENTS (issue #140, correction) :
  # les arrêts viennent du stops.txt GTFS (mobibreizh-stops ne porte AUCUN
  # arrêt STAR — un constat de qualité de la donnée, documenté dans le
  # fragment korrigo) et la couche bâtiments porte elle-même code_commune_insee
  # (plus de jointure spatiale aux polygones communaux).
  expect_s3_class(m, "tbl_df")
  expect_equal(nrow(m), 8L)
  expect_equal(nrow(m), length(unique(m$id)))
  expect_setequal(m$id,
                  c("mobilite_snapshot", "rp_logement_princ", "osm_reseaux",
                    "communes_limites", "korrigo", "batiments_residentiels",
                    "bornes-recharges", "stationnement-velo"))

  # les 11 colonnes standard du manifeste (SIRENE / Flores / RP / Habitat)
  expect_true(all(c("id", "source", "url", "fichier", "vintage",
                    "date_reference", "date_publication", "licence",
                    "note", "mode", "type") %in% names(m)))

  # chaque source garde SON vintage : aucune colonne d'alignement de date
  expect_false(any(grepl("align", tolower(names(m)))))

  # le fragment SNAPSHOT est intact : LE fichier de production porté, jamais
  # l'artefact non-production (qui montrait des deltas vélo négatifs)
  snap <- m[m$id == "mobilite_snapshot", ]
  expect_equal(snap$fichier, "bretagne_mobility_super_dashboard_gravity.csv")
  expect_false(grepl("indicateurs_summarized_communes", snap$fichier))
  expect_equal(snap$mode, "manuel")
  expect_equal(snap$type, "fichier")
  expect_equal(snap$licence, "odbl")

  # les sources du sous-bloc, chacune avec SA licence (ODbL pour Korrigo et le
  # stationnement vélo — ADR-0001 ; lov2 pour la couche bâtiments BDNB et les
  # bornes IRVE). Mode : « manuel » pour la couche bâtiments (portée à la main
  # comme le snapshot — jamais un cron), « cron » pour les sources téléchargées.
  expect_equal(m$licence[m$id == "korrigo"], "odbl")
  expect_equal(m$licence[m$id == "batiments_residentiels"], "lov2")
  expect_equal(m$licence[m$id == "bornes-recharges"], "lov2")
  expect_equal(m$licence[m$id == "stationnement-velo"], "odbl")
  expect_equal(m$mode[m$id == "batiments_residentiels"], "manuel")
  expect_true(all(m$mode[m$id %in% c("korrigo", "bornes-recharges",
                                     "stationnement-velo")] == "cron"))
})

test_that("theme_mobilite : le descripteur porte les membres requis du contrat", {
  th <- theme_mobilite()

  # la forme du contrat : les membres requis, dans l'ordre
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
})

test_that("vintages_mobilite : huit sources, chacune avec SA référence et SA publication", {
  v <- vintages_mobilite()

  # huit sources (issues #139+#140), la forme du contrat — jamais alignées
  expect_equal(nrow(v), 8L)
  expect_named(v, c("id", "source", "version", "licence",
                    "date_reference", "date_publication"))
  expect_setequal(v$id,
                  c("mobilite_snapshot", "rp_logement_princ", "osm_reseaux",
                    "communes_limites", "korrigo", "batiments_residentiels",
                    "bornes-recharges", "stationnement-velo"))

  # le snapshot porté : SA référence (l'instantané) et SA publication (le portage)
  snap <- v[v$id == "mobilite_snapshot", ]
  expect_equal(snap$licence, "odbl")
  expect_equal(snap$version, "2026-02")
  expect_equal(snap$date_reference, "2026-02-28")
  expect_equal(snap$date_publication, "2026-08-06")
  expect_true(as.Date(snap$date_reference) <= as.Date(snap$date_publication))

  # la demande : RP 2023 (le millésime du recensement), référence au 1er
  # janvier 2023, publication à la mise en ligne du tableau LOG T12
  rp <- v[v$id == "rp_logement_princ", ]
  expect_equal(rp$version, "2023")
  expect_equal(rp$date_reference, "2023-01-01")
  expect_equal(rp$licence, "lov2")

  # les réseaux : le timestamp d'EXTRACTION OSM comme référence (jamais
  # « aujourd'hui » — la règle du contrat), la date du portage en publication
  osm <- v[v$id == "osm_reseaux", ]
  expect_equal(osm$version, "2026-08")
  expect_equal(osm$date_reference, "2026-08-05")  # l'extrait du 5 août 2026
  expect_equal(osm$date_publication, "2026-08-06")
  expect_equal(osm$licence, "odbl")

  # les limites communales : le référentiel IGN (Licence Ouverte), publication
  # inconnue (le WFS n'expose pas de date de fichier — NA, à compléter)
  lim <- v[v$id == "communes_limites", ]
  expect_equal(lim$date_reference, "2025-01-01")
  expect_true(is.na(lim$date_publication))
  expect_equal(lim$licence, "lov2")

  # les quatre sources du sous-bloc : korrigo (la base GTFS — les arrêts),
  # batiments_residentiels (la couche bâtiments BDNB), bornes-recharges (IRVE)
  # et stationnement-velo (le hub Ecolab) — chacune SA référence et SA
  # publication, jamais alignées sur un tampon de thème
  expect_equal(v$licence[v$id == "korrigo"], "odbl")
  expect_equal(v$licence[v$id == "batiments_residentiels"], "lov2")
  expect_equal(v$licence[v$id == "bornes-recharges"], "lov2")
  expect_equal(v$licence[v$id == "stationnement-velo"], "odbl")

  # chaque référence précède (ou égale) sa publication — sauf publication NA
  for (i in seq_len(nrow(v))) {
    if (!is.na(v$date_publication[i])) {
      expect_true(as.Date(v$date_reference[i]) <= as.Date(v$date_publication[i]))
    }
  }
})
test_that("verifier_contrat_mobilite_snapshot : le manifeste épingle le fichier de production", {
  # le contrat s'exécute sur le fragment SNAPSHOT du manifeste concaténé
  frag <- MANIFEST_MOBILITE[MANIFEST_MOBILITE$id == "mobilite_snapshot", ]
  expect_equal(nrow(frag), 1L)
  expect_true(verifier_contrat_mobilite_snapshot(frag))

  # l'artefact NON-production (les deltas vélo négatifs) est refusé bruyamment
  # par le contrat — la garde du « jamais cette base » du PRD #136
  defectueux <- frag
  defectueux$fichier <- "indicateurs_summarized_communes.csv"
  expect_error(verifier_contrat_mobilite_snapshot(defectueux),
               "bretagne_mobility_super_dashboard_gravity")

  # un id hors contrat est refusé
  defectueux <- frag
  defectueux$id <- "autre_source"
  expect_error(verifier_contrat_mobilite_snapshot(defectueux), "mobilite_snapshot")

  # une date de publication antérieure à la référence est refusée
  defectueux <- frag
  defectueux$date_reference <- "2026-09-01"
  expect_error(verifier_contrat_mobilite_snapshot(defectueux), "référence")
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

test_that("normaliser_snapshot_mobilite : normalise la forme du snapshot porté", {
  # une forme RÉDUITE mais fidèle : l'identité + une métrique + une colonne
  # libellé — le normaliseur ne touche pas au reste (les 2 061 colonnes vivent
  # dans le fichier réel, testé par l'E2E)
  snapshot <- tibble::tibble(
    region = "Bretagne",
    raison_sociale = "Brest Métropole",
    code_departement_insee = "29",
    code_insee = "29011",
    nom_commune = "Bohars",
    nb_buildings = "1113",
    share_food_t = "0.95",
    unique_dep_1 = "Alimentation"
  )

  table <- normaliser_snapshot_mobilite(snapshot)

  # les colonnes d'identité normalisées (la forme du contrat : commune,
  # nom, département, EPCI nommé), la métrique convertie en numérique, le
  # libellé laissé en caractères
  expect_true(all(c("commune", "nom", "departement", "epci_nom",
                    "nb_buildings", "share_food_t") %in% names(table)))
  expect_equal(table$commune, "29011")
  expect_equal(table$nom, "Bohars")
  expect_equal(table$departement, "29")
  expect_equal(table$epci_nom, "Brest Métropole")
  expect_equal(table$nb_buildings, 1113)
  expect_equal(table$share_food_t, 0.95)
  expect_type(table$unique_dep_1, "character")
})

test_that("normaliser_snapshot_mobilite : un input corrompu s'arrête bruyamment", {
  # une colonne requise manquante (une vague qui change de structure) nomme la
  # colonne fautive — jamais un échec silencieux
  corrompu <- tibble::tibble(
    code_insee = "29011", nom_commune = "Bohars",
    code_departement_insee = "29", raison_sociale = "Brest Métropole"
    # nb_buildings manque
  )
  expect_error(normaliser_snapshot_mobilite(corrompu), "nb_buildings")

  # une identité invalide (code INSEE non COG 5 chiffres) est une corruption
  mauvaise_id <- tibble::tibble(
    code_insee = "ABC", nom_commune = "Bohars",
    code_departement_insee = "29", raison_sociale = "Brest Métropole",
    nb_buildings = "1113"
  )
  expect_error(normaliser_snapshot_mobilite(mauvaise_id), "code_insee")

  # un fichier vide est une corruption
  expect_error(normaliser_snapshot_mobilite(tibble::tibble(
    code_insee = character(), nom_commune = character(),
    code_departement_insee = character(), raison_sociale = character(),
    nb_buildings = character()
  )), "aucune ligne")
})

test_that("construire_donnees_mobilite : assemble la table normalisée du snapshot porté et toutes les sources du thème", {
  # la couture : le lecteur/normaliseur du snapshot, les lecteurs de l'étage
  # demande/réseaux (issue #139) et le builder des sources du sous-bloc
  # (issue #140) MOCKÉS — le seam d'entrée du run (jamais de fichier réel dans
  # la boucle de test unitaire)
  table_snapshot <- tibble::tibble(commune = "29011", nb_buildings = 1113)
  appels <- new.env()

  local_mocked_bindings(
    lire_snapshot_mobilite = function(chemin) {
      appels$chemin <- chemin
      tibble::tibble(x = 1)
    },
    normaliser_snapshot_mobilite = function(snapshot) {
      appels$normalise <- TRUE
      table_snapshot
    },
    lire_voitures_communes = function(chemin) {
      appels$voitures <- chemin
      tibble::tibble(commune = "29011", menages_total = 100,
                     menages_sans_voiture = 10, menages_deux_plus = 20)
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
                geometry = sf::st_sfc(sf::st_linestring(
                  rbind(c(0, 0), c(1, 0)))), crs = 2154)
    },
    construire_sources_offre_mobilite = function(cache) {
      appels$sources <- cache
      list(korrigo = tibble::tibble(stop_id = "AR1"),
           batiments_residentiels = tibble::tibble(commune = "29011"),
           bornes_recharges = tibble::tibble(code_insee_commune = "29011"),
           stationnement_velo = tibble::tibble(geocode_commune = "29011"))
    },
    .package = "lusk"
  )

  donnees <- construire_donnees_mobilite(cache = "cache-test")

  # la liste nommée : le snapshot porté + les trois sources de l'étage
  # demande/réseaux + les QUATRE sources du sous-bloc, dans l'ordre du contrat
  expect_named(donnees,
               c("mobilite_snapshot", "voitures_communes",
                 "communes_limites", "lignes_osm",
                 "korrigo", "batiments_residentiels",
                 "bornes_recharges", "stationnement_velo"))
  expect_identical(donnees$mobilite_snapshot, table_snapshot)
  # le lecteur du snapshot reçoit le chemin du fichier porté dans le cache
  # (par SON id — jamais un vecteur de huit chemins)
  expect_equal(appels$chemin,
               file.path("cache-test", "bretagne_mobility_super_dashboard_gravity.csv"))
  # les trois sources de l'étage : chacun de leurs fichiers, par son id
  expect_equal(appels$voitures,
               file.path("cache-test", "DS_RP_LOGEMENT_PRINC_2023_CSV_FR.zip"))
  expect_equal(appels$limites,
               file.path("cache-test", "communes_limites.geojson"))
  expect_equal(appels$osm,
               file.path("cache-test", "bretagne-latest.osm.pbf"))
  expect_true(appels$normalise)
  # le builder des sources du sous-bloc lit dans le MÊME cache
  expect_equal(appels$sources, "cache-test")
})

test_that("construire_donnees_mobilite : une source manquante du cache s'arrête bruyamment (jamais un succès partiel)", {
  # le lecteur du snapshot est mocké, mais le lecteur des voitures lève une
  # erreur de fichier absent — le run s'arrête ICI, avant de construire quoi
  # que ce soit
  local_mocked_bindings(
    lire_snapshot_mobilite = function(chemin) tibble::tibble(x = 1),
    normaliser_snapshot_mobilite = function(snapshot) tibble::tibble(commune = "29011"),
    lire_voitures_communes = function(chemin) {
      stop("Fichier absent : ", chemin, call. = FALSE)
    },
    .package = "lusk"
  )
  expect_error(
    construire_donnees_mobilite(cache = "cache-test"),
    "DS_RP_LOGEMENT_PRINC"
  )
})

test_that("agreger_nb_buildings_territoires : les niveaux recalculent depuis les parties", {
  # 3 communes sur 2 EPCIs / 2 départements — la forme de la base partagée
  base <- tibble::tribble(
    ~CODGEO, ~EPCI, ~DEP,
    "22001", "200000001", "22",
    "22002", "200000001", "22",
    "29001", "200000002", "29"
  )
  communes <- tibble::tribble(
    ~commune, ~nb_buildings,
    "22001", 100,
    "22002", 200,
    "29001", 300
  )

  ag <- agreger_nb_buildings_territoires(communes, base)

  # une ligne par niveau : les 3 communes + 2 EPCIs + 2 départements + la région
  expect_equal(nrow(ag), 3 + 2 + 2 + 1)
  # EPCI X = 100 + 200 (la somme des parties, jamais une moyenne)
  expect_equal(ag$value[ag$code == "200000001"], 300)
  # département 22 = 100 + 200 ; région = 100 + 200 + 300
  expect_equal(ag$value[ag$code == "22"], 300)
  expect_equal(ag$value[ag$code == "53"], 600)
  # déterministe : trié par code
  expect_true(!is.unsorted(ag$code))
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
fixture_snapshot_analytique_mobilite <- function() {
  base <- tibble::tribble(
    ~commune, ~nb_buildings, ~share_food_t, ~share_health_t, ~share_admin_t,
    ~share_school_t, ~share_bank_t, ~med_div_loss_t, ~med_div_loss_b,
    ~pct_iso_full_t, ~dens_div_t_min, ~dens_div_t_max,
    ~med_div_loss_t_epci, ~med_div_loss_b_epci, ~pct_iso_full_t_epci,
    ~med_div_loss_t_dep, ~med_div_loss_b_dep, ~pct_iso_full_t_dep,
    ~med_div_loss_t_reg, ~med_div_loss_b_reg, ~pct_iso_full_t_reg,
    # EPCI 200000001 (dép. 22) : 22001 (100 bâtiments) + 22002 (300)
    "22001", 100, 0.9, 0.8, 0.7, 0.6, 0.5, 10, 9, 0.1, 5, 20,
    12, 11, 0.15, 14, 12, 0.12, 15, 13, 0.11,
    "22002", 300, 0.6, 0.7, 0.8, 0.9, 0.4, 20, 5, 0.3, 8, 30,
    12, 11, 0.15, 14, 12, 0.12, 15, 13, 0.11,
    # EPCI 200000002 (dép. 29) : 29001 (200) + 29002 (400 — delta NÉGATIF,
    # l'artefact non-production du PRD #136). Bloc _epci NA : le trou du
    # portage (le cas Brest Métropole du vrai fichier).
    "29001", 200, 0.5, 0.5, 0.5, 0.5, 0.5, 30, 12, 0.5, 10, 40,
    NA, NA, NA, 14, 12, 0.12, 15, 13, 0.11,
    "29002", 400, 0.8, 0.9, 0.9, 0.8, 0.9, 40, 41, 0.6, 12, 50,
    NA, NA, NA, 14, 12, 0.12, 15, 13, 0.11
  )
  for (i in 1:10) {
    base[[paste0("dens_div_t_", i)]] <- 0.01 * i
    base[[paste0("div_loss_t_dec_", i)]] <- 10 + i
    base[[paste0("dens_div_t_", i, "_epci")]] <- 0.02 * i
    base[[paste0("div_loss_t_dec_", i, "_epci")]] <-
      ifelse(base$commune %in% c("29001", "29002"), NA_real_, 11 + i)
    base[[paste0("dens_div_t_", i, "_dep")]] <- 0.03 * i
    base[[paste0("div_loss_t_dec_", i, "_dep")]] <- 12 + i
    base[[paste0("dens_div_t_", i, "_reg")]] <- 0.04 * i
    base[[paste0("div_loss_t_dec_", i, "_reg")]] <- 13 + i
  }
  # les bornes min/max de la signature, à chaque niveau (les familles _epci /
  # _dep / _reg du vrai fichier)
  base$dens_div_t_min_epci <- 5
  base$dens_div_t_max_epci <- 20
  base$dens_div_t_min_dep <- 5
  base$dens_div_t_max_dep <- 20
  base$dens_div_t_min_reg <- 5
  base$dens_div_t_max_reg <- 20
  base
}

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

test_that("construire_analytiques_mobilite : le chaînon flagship + le sous-bloc enchaînent les builders et persistent les artefacts", {
  # la garde de forme du chaînon consomme le snapshot normalisé : le fixture
  # analytique porte toutes les colonnes requises (identité + familles)
  donnees <- list(
    mobilite_snapshot = fixture_snapshot_analytique_mobilite(),
    voitures_communes = tibble::tibble(commune = "22001", menages_total = 100),
    communes_limites = sf::st_sf(code_insee = "22001",
                                 geometry = sf::st_sfc(sf::st_polygon(
                                   list(rbind(c(0, 0), c(1, 0), c(1, 1),
                                              c(0, 1), c(0, 0))))),
                                 crs = 2154),
    lignes_osm = sf::st_sf(osm_id = 1L, highway = "residential",
                           geometry = sf::st_sfc(sf::st_linestring(
                             rbind(c(0, 0), c(1, 0)))), crs = 2154),
    korrigo = tibble::tibble(stop_id = "AR1", stop_lat = 48.0, stop_lon = -1.0),
    batiments_residentiels = tibble::tibble(commune = "22001"),
    bornes_recharges = tibble::tibble(code_insee_commune = "22001"),
    stationnement_velo = tibble::tibble(geocode_commune = "22001")
  )
  base_epci <- base_epci_mini_analytique()
  suivi <- new.env()
  suivi$ordre <- character()
  pousser <- function(etape) suivi$ordre <- c(suivi$ordre, etape)

  local_mocked_bindings(
    agreger_nb_buildings_territoires = function(communes, base_epci) {
      pousser("nb_buildings")
      tibble::tibble(code = "22001", value = 100)
    },
    calculer_parts_isolation_communes = function(snapshot) {
      pousser("isolation_communes")
      tibble::tibble(commune = "22001", key = "iso_alimentation", value = 0.1)
    },
    agreger_parts_isolation_territoires = function(isolation, poids, base_epci) {
      pousser("isolation_territoires")
      tibble::tibble(code = "22001", key = "iso_alimentation", value = 0.1)
    },
    calculer_div_loss_communes = function(snapshot) {
      pousser("div_loss_communes")
      tibble::tibble(commune = "22001", div_loss_t = 10, div_loss_b = 9,
                     delta = 1, pct_iso_full_t = 0.1)
    },
    agreger_div_loss_territoires = function(div_communes, snapshot, base_epci) {
      pousser("div_loss_territoires")
      tibble::tibble(code = "22001", div_loss_t = 10, div_loss_b = 9,
                     delta = 1, pct_iso_full_t = 0.1)
    },
    construire_saillance_territoires = function(div_territoires) {
      pousser("saillance")
      tibble::tibble(code = "22001", delta = 1, classification = "non-saillant")
    },
    construire_signature_densite = function(snapshot, base_epci) {
      pousser("densite")
      tibble::tibble(type = "commune", code = "22001", dens_1 = 0.01)
    },
    construire_nuage_territoires = function(div_territoires, base_epci) {
      pousser("nuage")
      tibble::tibble(code = "22001", type = "commune", nuage_median = 12,
                     nuage_n = 1)
    },
    construire_territoires_mobilite = function(base_epci, analytiques) {
      pousser("territoires")
      tibble::tibble(code = "22001", type = "commune")
    },
    construire_rangs_isolation = function(isolation_territoires, territoires) {
      pousser("rangs")
      tibble::tibble(code = "22001", key = "iso_alimentation",
                     rang_epci = 0, rang_dep = 0, rang_reg = 0)
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
      tibble::tibble(commune = "22001", aire_m2 = 4e6,
                     longueur_t = 0.8, longueur_b = 1.0, longueur_c = 2.0,
                     densite_t = 0.2, densite_b = 0.25, densite_c = 0.5)
    },
    agreger_reseaux_territoires = function(reseaux_communes, base_epci) {
      pousser("reseaux_territoires")
      tibble::tibble(code = "22001", key = "reseaux",
                     detail = "c_longueur", value = 2.0)
    },
    # le sous-bloc « L'offre de mobilité alternative » (issue #140)
    calculer_part_proches_arret_communes = function(stops, batiments) {
      pousser("offre_tc_communes")
      tibble::tibble(commune = "22001", n_batiments = 100L, proches = 90L,
                     part_proche = 0.9)
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
    agreger_offre_territoires = function(offre_tc, bornes, velo, base_epci) {
      pousser("offre_territoires")
      tibble::tibble(code = "22001", key = "offre_tc", value = 0.9)
    },
    .package = "lusk"
  )

  sortie <- tempfile("mob-analytiques-")
  on.exit(unlink(sortie, recursive = TRUE), add = TRUE)
  res <- construire_analytiques_mobilite(donnees, base_epci, sortie = sortie)

  # le chaînon enchaîne les builders dans l'ordre — le seam ne calcule RIEN
  # lui-même, il orchestre (le flagship puis l'étage demande/réseaux, #139)
  expect_equal(suivi$ordre,
               c("nb_buildings", "isolation_communes", "isolation_territoires",
                 "div_loss_communes", "div_loss_territoires", "saillance",
                 "densite", "nuage", "territoires", "rangs",
                 "voitures_communes", "voitures_territoires",
                 "reseaux_communes", "reseaux_territoires",
                 "offre_tc_communes", "bornes_communes", "velo_communes",
                 "offre_territoires"))

  # les tables analytiques exposées : le poids + les artefacts flagship +
  # l'étage demande/réseaux (issue #139) + le sous-bloc (issue #140)
  expect_named(res, c("mobilite_communes", "nb_buildings_territoires",
                      "isolation_territoires", "div_loss_territoires",
                      "saillance_territoires", "densite_territoires",
                      "nuage_territoires", "isolation_rangs",
                      "voitures_communes", "voitures_territoires",
                      "reseaux_communes", "reseaux_territoires",
                      "offre_tc_communes", "bornes_communes",
                      "stationnement_velo_communes", "offre_territoires"))
  expect_equal(res$nb_buildings_territoires$value, 100)
  expect_equal(res$isolation_territoires$value, 0.1)
  expect_equal(res$div_loss_territoires$delta, 1)
  expect_equal(res$saillance_territoires$classification, "non-saillant")
  expect_equal(res$densite_territoires$dens_1, 0.01)
  expect_equal(res$nuage_territoires$nuage_median, 12)
  expect_equal(res$isolation_rangs$rang_epci, 0)
  expect_equal(res$voitures_territoires$value, 0.1)
  expect_equal(res$reseaux_territoires$value, 2.0)
  expect_equal(res$offre_tc_communes$part_proche, 0.9)
  expect_equal(res$bornes_communes$nb_bornes, 3L)
  expect_equal(res$stationnement_velo_communes$places_1000, 30)
  expect_equal(res$offre_territoires$value, 0.9)

  # les artefacts sont PERSISTÉS sous le dossier analytique du run
  expect_true(file.exists(file.path(sortie, "nb_buildings_territoires.rds")))
  expect_true(file.exists(file.path(sortie, "isolation_territoires.rds")))
  expect_true(file.exists(file.path(sortie, "div_loss_territoires.rds")))
  expect_true(file.exists(file.path(sortie, "saillance_territoires.rds")))
  expect_true(file.exists(file.path(sortie, "densite_territoires.rds")))
  expect_true(file.exists(file.path(sortie, "nuage_territoires.rds")))
  expect_true(file.exists(file.path(sortie, "isolation_rangs.rds")))
  expect_true(file.exists(file.path(sortie, "voitures_communes.rds")))
  expect_true(file.exists(file.path(sortie, "voitures_territoires.rds")))
  expect_true(file.exists(file.path(sortie, "reseaux_communes.rds")))
  expect_true(file.exists(file.path(sortie, "reseaux_territoires.rds")))
  expect_true(file.exists(file.path(sortie, "offre_tc_communes.rds")))
  expect_true(file.exists(file.path(sortie, "bornes_communes.rds")))
  expect_true(file.exists(file.path(sortie, "stationnement_velo_communes.rds")))
  expect_true(file.exists(file.path(sortie, "offre_territoires.rds")))
})

test_that("construire_analytiques_mobilite : un input corrompu (famille analytique manquante) s'arrête bruyamment", {
  donnees <- list(mobilite_snapshot = tibble::tibble(
    commune = "22001", nb_buildings = 100
    # share_* / med_* manquent : le chaînon flagship refuse l'input avant
    # toute écriture
  ))

  expect_error(
    construire_analytiques_mobilite(donnees, base_epci_mini_analytique(),
                                    sortie = tempfile("mob-corrompu-")),
    "share_food_t"
  )
})

test_that("publier_mobilite : le seam de publication est câblé (plus un stub)", {
  # un appel sans données échoue pour une raison de DONNÉES (cache absent),
  # jamais sur un message de stub
  expect_false(grepl("stub", tryCatch(
    publier_mobilite(list()),
    error = function(e) conditionMessage(e)
  )))
})


test_that("ensure_mode_neutrality : le vélo n'est jamais pire que pied/TC (aucun delta négatif)", {
  # la garde de base (PRD #136) : div_loss_b ≤ div_loss_t, TOUJOURS — un delta
  # négatif (l'artefact non-production du PRD) est une donnée à clamper, jamais
  # une valeur publiée
  expect_equal(ensure_mode_neutrality(40, 41), 40)      # delta négatif → clampé
  expect_equal(ensure_mode_neutrality(10, 9), 9)        # delta sain → intact
  expect_equal(ensure_mode_neutrality(10, 10), 10)      # delta nul → intact
  # vectorisé : un mélange de deltas sains (b ≤ t → b intact) et négatifs
  # (b > t → clampé à l'égalité)
  expect_equal(ensure_mode_neutrality(c(10, 20, 30), c(9, 25, 30)), c(9, 20, 30))
  # aucune NA introduite par la garde
  expect_equal(ensure_mode_neutrality(NA_real_, NA_real_), NA_real_)
})

test_that("calculer_parts_isolation_communes : les 5 parts d'isolation, le miroir des parts d'accès", {
  iso <- calculer_parts_isolation_communes(fixture_snapshot_analytique_mobilite())

  # une ligne par (commune × clé) — 4 communes × 5 clés, dans l'ordre du contrat
  expect_equal(nrow(iso), 4 * 5)
  expect_named(iso, c("commune", "key", "value"))
  expect_setequal(unique(iso$key),
                  c("iso_alimentation", "iso_sante", "iso_administration",
                    "iso_ecole", "iso_banque"))

  # 22001 : 1 − share_*_t (alimentation 0.9 → 0.1, santé 0.8 → 0.2, ...)
  lire <- function(commune, key) iso$value[iso$commune == commune & iso$key == key]
  expect_equal(lire("22001", "iso_alimentation"), 0.1)
  expect_equal(lire("22001", "iso_sante"), 0.2)
  expect_equal(lire("22001", "iso_administration"), 0.3)
  expect_equal(lire("22001", "iso_ecole"), 0.4)
  expect_equal(lire("22001", "iso_banque"), 0.5)
  expect_equal(lire("29002", "iso_banque"), 0.1)   # 1 − 0.9
})

test_that("agreger_parts_isolation_territoires : les niveaux RECALCULENT depuis les parties (jamais une moyenne de parts)", {
  snap <- fixture_snapshot_analytique_mobilite()
  iso <- calculer_parts_isolation_communes(snap)
  poids <- tibble::tibble(commune = snap$commune, nb_buildings = snap$nb_buildings)

  ag <- agreger_parts_isolation_territoires(iso, poids, base_epci_mini_analytique())

  # les quatre niveaux : 4 communes + 2 EPCIs + 2 départements + la région =
  # 9 territoires × 5 clés
  expect_equal(nrow(ag), 9 * 5)
  expect_named(ag, c("code", "key", "value"))

  # EPCI 200000001, alimentation : Σ (part × bâtiments) ÷ Σ bâtiments =
  # (0.1×100 + 0.4×300) ÷ 400 = 0.325 — la moyenne PONDÉRÉE par les bâtiments,
  # jamais la moyenne des parts (0.25)
  v_epci <- ag$value[ag$code == "200000001" & ag$key == "iso_alimentation"]
  expect_equal(v_epci, 0.325)
  expect_false(isTRUE(all.equal(v_epci, mean(c(0.1, 0.4)))))
  # EPCI 200000002 : (0.5×200 + 0.2×400) ÷ 600 = 0.3
  expect_equal(ag$value[ag$code == "200000002" & ag$key == "iso_alimentation"], 0.3)
  # département 22 : (0.1×100 + 0.4×300) ÷ 400 ; région : la somme des quatre
  expect_equal(ag$value[ag$code == "22" & ag$key == "iso_alimentation"], 0.325)
  expect_equal(ag$value[ag$code == "29" & ag$key == "iso_alimentation"], 0.3)
  expect_equal(ag$value[ag$code == "53" & ag$key == "iso_alimentation"],
               (0.1 * 100 + 0.4 * 300 + 0.5 * 200 + 0.2 * 400) / 1000)
  # la commune garde SA valeur telle quelle
  expect_equal(ag$value[ag$code == "22001" & ag$key == "iso_alimentation"], 0.1)
  # déterministe : trié par code puis clé
  expect_true(!is.unsorted(ag$code))
})

test_that("calculer_div_loss_communes : div_loss_t/b avec la neutralité modale sur la base d'abord", {
  div <- calculer_div_loss_communes(fixture_snapshot_analytique_mobilite())

  # la forme : une ligne par commune, les colonnes du Story (div_loss_t/b, le
  # delta, le story depth pct_iso_full_t)
  expect_equal(nrow(div), 4)
  expect_named(div, c("commune", "div_loss_t", "div_loss_b", "delta",
                      "pct_iso_full_t"))

  lire <- function(commune) div[div$commune == commune, ]
  # deltas sains : intacts (le fichier de production est propre)
  expect_equal(lire("22001")$div_loss_t, 10)
  expect_equal(lire("22001")$div_loss_b, 9)
  expect_equal(lire("22001")$delta, 1)
  # delta NÉGATIF (29002 : b 41 > t 40 — l'artefact non-production) : CLAMPÉ
  # à l'égalité par la garde de base — jamais un delta négatif publié
  expect_equal(lire("29002")$div_loss_t, 40)
  expect_equal(lire("29002")$div_loss_b, 40)
  expect_equal(lire("29002")$delta, 0)
  # le story depth pct_iso_full_t passe tel quel (la matière du « cas le plus
  # dur », jamais un dérivé)
  expect_equal(lire("29001")$pct_iso_full_t, 0.5)
  # aucun delta négatif possible après la garde
  expect_true(all(div$delta >= 0))
})

test_that("agreger_div_loss_territoires : les niveaux portent la valeur du fichier (recalcul depuis les parties quand le fichier est muet)", {
  snap <- fixture_snapshot_analytique_mobilite()
  div <- calculer_div_loss_communes(snap)

  ag <- agreger_div_loss_territoires(div, snap, base_epci_mini_analytique())

  # les quatre niveaux : 4 communes + 2 EPCIs + 2 départements + la région
  expect_equal(nrow(ag), 9)
  expect_named(ag, c("code", "div_loss_t", "div_loss_b", "delta",
                     "pct_iso_full_t"))
  lire <- function(code) ag[ag$code == code, ]

  # communes : leurs valeurs (clamées sur la base d'abord)
  expect_equal(lire("22001")$div_loss_t, 10)
  expect_equal(lire("29002")$div_loss_b, 40)
  expect_equal(lire("29002")$delta, 0)
  # EPCI 200000001 : la valeur du FICHIER (la médiane de la base bâtiment par
  # bâtiment, la même pour toutes les communes membres — jamais une moyenne
  # des médianes communales)
  expect_equal(lire("200000001")$div_loss_t, 12)
  expect_equal(lire("200000001")$div_loss_b, 11)
  expect_equal(lire("200000001")$delta, 1)
  expect_equal(lire("200000001")$pct_iso_full_t, 0.15)
  # EPCI 200000002 : le bloc _epci du fichier est NA (le trou du portage) →
  # RECALCULÉ depuis les parties : la médiane PONDÉRÉE par les bâtiments des
  # valeurs communales (t : {30 (200), 40 (400)} → 40 ; b : {12 (200), 40
  # (400)} → 40) ; pct_iso_full_t : la moyenne pondérée (0.5667)
  expect_equal(lire("200000002")$div_loss_t, 40)
  expect_equal(lire("200000002")$div_loss_b, 40)
  expect_equal(lire("200000002")$delta, 0)
  expect_equal(round(lire("200000002")$pct_iso_full_t, 4), 0.5667)
  # départements et région : la valeur du fichier
  expect_equal(lire("22")$div_loss_t, 14)
  expect_equal(lire("22")$delta, 2)
  expect_equal(lire("29")$pct_iso_full_t, 0.12)
  expect_equal(lire("53")$div_loss_t, 15)
  expect_equal(lire("53")$delta, 2)
  # la neutralité modale tient à CHAQUE niveau : aucun delta négatif
  expect_true(all(ag$delta >= 0))
  # déterministe : trié par code
  expect_true(!is.unsorted(ag$code))
})

test_that("classifier_saillance_velo : les seuils verrouillés (top quartile 4+, top décile 10)", {
  # l'échelle à trois marches, verrouillée sur la distribution réelle du
  # snapshot (2026-08-06 : médiane 1, q75 = 4, q90 = 10) :
  #   delta < 4  -> « non-saillant » (le médian ~1 : pas de Story)
  #   4 ≤ delta < 10 -> « notable » (le top quartile : un delta réel)
  #   delta ≥ 10 -> « saillant » (le top décile : l'Histoire se déclenche)
  expect_equal(classifier_saillance_velo(c(0, 1, 3)),
               rep("non-saillant", 3))
  expect_equal(classifier_saillance_velo(c(4, 7, 9)),
               rep("notable", 3))
  expect_equal(classifier_saillance_velo(c(10, 15, 31)),
               rep("saillant", 3))
  # les bornes exactes déclenchent (≥) — déterministe
  expect_equal(classifier_saillance_velo(4), "notable")
  expect_equal(classifier_saillance_velo(10), "saillant")
  # un delta inconnu (NA) n'est jamais classé
  expect_equal(classifier_saillance_velo(NA_real_), NA_character_)
})

test_that("construire_saillance_territoires : la classification de chaque territoire, seuils verrouillés", {
  div <- agreger_div_loss_territoires(
    calculer_div_loss_communes(fixture_snapshot_analytique_mobilite()),
    fixture_snapshot_analytique_mobilite(), base_epci_mini_analytique()
  )

  sa <- construire_saillance_territoires(div)

  # une ligne par territoire, la forme (code, delta, classification)
  expect_equal(nrow(sa), 9)
  expect_named(sa, c("code", "delta", "classification"))
  lire <- function(code) sa$classification[sa$code == code]
  # 22002 (delta 15) et 29001 (delta 18) : SAillants — l'Histoire se déclenche
  expect_equal(lire("22002"), "saillant")
  expect_equal(lire("29001"), "saillant")
  # 22001 (delta 1) : non-saillant — le médian, pas de Story
  expect_equal(lire("22001"), "non-saillant")
  # les niveaux suivent la même échelle (les deltas de niveau du fixture)
  expect_equal(lire("200000001"), "non-saillant")  # delta 1
  expect_equal(lire("200000002"), "non-saillant")  # delta 0
  expect_equal(lire("53"), "non-saillant")         # delta 2
  # déterministe : trié par code
  expect_true(!is.unsorted(sa$code))
})

test_that("construire_signature_densite : les quelques nombres précalculés par territoire (jamais la matrice)", {
  snap <- fixture_snapshot_analytique_mobilite()
  sig <- construire_signature_densite(snap, base_epci_mini_analytique())

  # une ligne par territoire (4 communes + 2 EPCIs + 2 départements + la
  # région), la forme : identité + type + la signature de densité (min/max +
  # 10 densités + 10 bornes de déciles)
  expect_equal(nrow(sig), 9)
  expect_named(sig, c("type", "code", "dens_min", "dens_max",
                      paste0("dens_", 1:10), paste0("dec_", 1:10)))
  lire <- function(code) sig[sig$code == code, ]

  # commune 22001 : la famille communale telle quelle (dens_1 = 0.01,
  # dens_10 = 0.1, dec_1 = 11, dec_10 = 20, min 5, max 20)
  expect_equal(lire("22001")$type, "commune")
  expect_equal(lire("22001")$dens_1, 0.01)
  expect_equal(lire("22001")$dens_10, 0.1)
  expect_equal(lire("22001")$dec_1, 11)
  expect_equal(lire("22001")$dec_10, 20)
  expect_equal(lire("22001")$dens_min, 5)
  expect_equal(lire("22001")$dens_max, 20)
  # EPCI 200000001 : la famille _epci (dens_1 = 0.02, dec_1 = 12) ; l'EPCI
  # 200000002 porte ses densités mais PAS ses déciles (le trou du portage —
  # NA, jamais une valeur inventée)
  expect_equal(lire("200000001")$type, "epci")
  expect_equal(lire("200000001")$dens_1, 0.02)
  expect_equal(lire("200000001")$dec_1, 12)
  expect_true(is.na(lire("200000002")$dec_1))
  expect_equal(lire("200000002")$dens_1, 0.02)
  # département 22 : la famille _dep ; région : la famille _reg
  expect_equal(lire("22")$type, "departement")
  expect_equal(lire("22")$dens_1, 0.03)
  expect_equal(lire("22")$dec_1, 13)
  expect_equal(lire("53")$type, "region")
  expect_equal(lire("53")$dens_1, 0.04)
  expect_equal(lire("53")$dec_1, 14)
  # déterministe : trié par code
  expect_true(!is.unsorted(sig$code))
})

test_that("construire_nuage_territoires : le nuage même-échelle, les quelques nombres par territoire", {
  snap <- fixture_snapshot_analytique_mobilite()
  div <- agreger_div_loss_territoires(
    calculer_div_loss_communes(snap), snap, base_epci_mini_analytique()
  )

  nu <- construire_nuage_territoires(div, base_epci_mini_analytique())

  # une ligne par territoire, la forme : identité + type + le résumé du nuage
  # (médiane / min / max / n des pairs même-échelle)
  expect_equal(nrow(nu), 9)
  expect_named(nu, c("code", "type", "nuage_median", "nuage_min",
                     "nuage_max", "nuage_n"))
  lire <- function(code) nu[nu$code == code, ]

  # 22001 (dans l'EPCI 200000001) : ses pairs sont les communes de SON EPCI,
  # 22002 (div_loss_t 20) — le nuage n'a qu'un point
  expect_equal(lire("22001")$nuage_median, 20)
  expect_equal(lire("22001")$nuage_n, 1)
  # 200000001 : ses pairs sont les AUTRES EPCIs — 200000002 (div_loss_t 40)
  expect_equal(lire("200000001")$nuage_median, 40)
  expect_equal(lire("200000001")$type, "epci")
  # département 22 : ses pairs sont les autres départements (29 : 14)
  expect_equal(lire("22")$nuage_median, 14)
  expect_equal(lire("22")$nuage_n, 1)
  # la région : ses pairs sont toutes ses communes {10, 20, 30, 40} — médiane
  # (20+30)/2 = 25, min 10, max 40, n 4
  expect_equal(lire("53")$nuage_median, 25)
  expect_equal(lire("53")$nuage_min, 10)
  expect_equal(lire("53")$nuage_max, 40)
  expect_equal(lire("53")$nuage_n, 4)
  # déterministe : trié par code
  expect_true(!is.unsorted(nu$code))
})

test_that("construire_rangs_isolation : les rangs-en-contexte via la machinerie partagée compute_ranks", {
  snap <- fixture_snapshot_analytique_mobilite()
  iso <- calculer_parts_isolation_communes(snap)
  poids <- tibble::tibble(commune = snap$commune, nb_buildings = snap$nb_buildings)
  isolation <- agreger_parts_isolation_territoires(iso, poids,
                                                   base_epci_mini_analytique())
  territoires <- construire_territoires_mobilite(
    base_epci_mini_analytique(),
    list(mobilite_communes = poids)
  )

  rangs <- construire_rangs_isolation(isolation, territoires)

  # la forme : une ligne par (territoire × clé) avec les trois rangs
  expect_equal(nrow(rangs), 9 * 5)
  expect_named(rangs, c("code", "key", "rang_epci", "rang_dep", "rang_reg"))
  lire <- function(code, key) rangs[rangs$code == code & rangs$key == key, ]

  # iso_alimentation dans l'EPCI 200000001 (n = 2) : 22001 (0.1) n'a rien en
  # dessous → 0 ; 22002 (0.4) a 22001 en dessous → 1/2 = 0.5 (le percentile
  # partagé : part strictement inférieure + moitié des ex æquo, sur le TOTAL
  # du groupe — la règle documentée de compute.R)
  expect_equal(lire("22001", "iso_alimentation")$rang_epci, 0)
  expect_equal(lire("22002", "iso_alimentation")$rang_epci, 0.5)
  # rang régional des communes (n = 4 : 0.1, 0.4, 0.5, 0.2) : 22002 (0.4) a
  # {0.1, 0.2} en dessous → 2/4 ; 29001 (0.5) a 3/4 en dessous
  expect_equal(lire("22002", "iso_alimentation")$rang_reg, 0.5)
  expect_equal(lire("29001", "iso_alimentation")$rang_reg, 0.75)
  # les agrégats : un EPCI ne se classe que dans son département et la région ;
  # la région ne se classe nulle part (NA)
  expect_equal(lire("200000001", "iso_alimentation")$rang_epci, NA_real_)
  expect_equal(lire("22", "iso_alimentation")$rang_epci, NA_real_)
  expect_equal(lire("53", "iso_alimentation")$rang_reg, NA_real_)
  # la région porte bien les cinq clés, triées par code puis clé
  expect_equal(nrow(rangs[rangs$code == "53", ]), 5)
  expect_true(!is.unsorted(rangs$code))
})

# analytiques_mobilite_fixture -------------------------------------------------
# La liste des artefacts analytiques du fixture — assemblée par les builders
# RÉELS (les mêmes que le chaînon) : la forme que compute_histoires_mobilite
# consomme.
analytiques_mobilite_fixture <- function() {
  snap <- fixture_snapshot_analytique_mobilite()
  base <- base_epci_mini_analytique()
  poids <- tibble::tibble(commune = snap$commune, nb_buildings = snap$nb_buildings)
  iso <- calculer_parts_isolation_communes(snap)
  div <- agreger_div_loss_territoires(
    calculer_div_loss_communes(snap), snap, base
  )
  list(
    div_loss_territoires = div,
    saillance_territoires = construire_saillance_territoires(div),
    densite_territoires = construire_signature_densite(snap, base),
    nuage_territoires = construire_nuage_territoires(div, base),
    isolation_territoires = agreger_parts_isolation_territoires(iso, poids, base),
    isolation_rangs = construire_rangs_isolation(
      agreger_parts_isolation_territoires(iso, poids, base),
      construire_territoires_mobilite(base, list(mobilite_communes = poids))
    )
  )
}

test_that("compute_histoires_mobilite : « Vingt minutes sans voiture », une ligne par territoire, distribuée et estampillée", {
  histoires <- compute_histoires_mobilite(analytiques_mobilite_fixture(),
                                          vintages_mobilite())

  vingt <- histoires[histoires$story_key == "vingt-minutes-sans-voiture", ]

  # une ligne par territoire (4 communes + 2 EPCIs + 2 départements + région),
  # la forme du contrat histoires (territoire | type | theme | story_key) + la
  # matière du Story (div_loss_t/b, delta, story depth, signature, saillance)
  expect_equal(nrow(vingt), 9)
  expect_true(all(c("territoire", "type", "theme", "story_key",
                    "div_loss_t", "div_loss_b", "delta", "pct_iso_full_t",
                    "dens_min", "dens_max", paste0("dens_", 1:10),
                    paste0("dec_", 1:10), "classification_saillance") %in%
                    names(vingt)))
  expect_true(all(vingt$theme == "mobilite"))
  expect_true(all(vingt$story_key == "vingt-minutes-sans-voiture"))

  lire <- function(code) vingt[vingt$territoire == code, ]
  # la matière du Story : le div_loss_t (la lecture), le delta, le story depth
  expect_equal(lire("22001")$div_loss_t, 10)
  expect_equal(lire("22001")$delta, 1)
  expect_equal(lire("22001")$pct_iso_full_t, 0.1)
  # la distribution (la signature de densité de la Story) + la saillance
  expect_equal(lire("22001")$dens_1, 0.01)
  expect_equal(lire("22001")$dec_10, 20)
  expect_equal(lire("22002")$classification_saillance, "saillant")
  expect_equal(lire("22001")$classification_saillance, "non-saillant")
  # le type est porté par les lignes (le contrat) ; la région a SA ligne
  expect_equal(lire("200000001")$type, "epci")
  expect_equal(lire("53")$type, "region")
  expect_equal(lire("53")$div_loss_t, 15)

  # les estampilles vintage : le Story porte le vintage de SA source de
  # référence (le snapshot porté — la date d'instantané de l'analyse, jamais
  # les autres sources du thème), la ligne du snapshot de la table des vintages
  ref_snapshot <- vintages_mobilite()$source[vintages_mobilite()$id == "mobilite_snapshot"]
  expect_true(all(vingt$vintage_source == ref_snapshot))
  expect_true(all(vingt$vintage_date_reference == "2026-02-28"))
  expect_true(all(vingt$vintage_date_publication == "2026-08-06"))
})

test_that("compute_histoires_mobilite : « Ce que le vélo préserve » ne se déclenche que sur la saillance réelle", {
  histoires <- compute_histoires_mobilite(analytiques_mobilite_fixture(),
                                          vintages_mobilite())

  velo <- histoires[histoires$story_key == "ce-que-le-velo-preserve", ]

  # se déclenche uniquement où le delta est saillant (≥ 10, le top décile) :
  # 22002 (delta 15) et 29001 (delta 18) — jamais ailleurs
  expect_equal(nrow(velo), 2)
  expect_setequal(velo$territoire, c("22002", "29001"))
  expect_true(all(velo$delta >= SEUIL_SAILLANCE_VELO))
  # la matière de la lecture : le delta + les deux lectures (div_loss_t/b) + la
  # classification (la même colonne que les lignes de défaut — la forme du
  # contrat, jamais un doublon de vocabulaire)
  expect_true(all(c("territoire", "type", "theme", "story_key",
                    "div_loss_t", "div_loss_b", "delta",
                    "classification_saillance") %in% names(velo)))
  expect_true(all(velo$classification_saillance == "saillant"))
  expect_false("classification" %in% names(histoires))
  expect_true(all(velo$theme == "mobilite"))
  # les estampilles vintage portées comme le défaut
  expect_true(all(velo$vintage_date_reference == "2026-02-28"))
})

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
# persiste) : menages_total (DWELLINGS, CARS=_T), menages_sans_voiture (CARS=C0)
# et menages_deux_plus (CARS=C_GE2). Des comptes simples pour des parts
# calculables à la main :
#   22001 : 100 ménages, 10 sans voiture (0.1), 20 avec 2+ (0.2)
#   22002 : 300 ménages, 60 sans (0.2), 90 avec 2+ (0.3)
#   29001 : 200 ménages, 80 sans (0.4), 40 avec 2+ (0.2)
#   29002 : 400 ménages, 100 sans (0.25), 240 avec 2+ (0.6)
fixture_voitures_mini <- function() {
  tibble::tribble(
    ~commune, ~menages_total, ~menages_sans_voiture, ~menages_deux_plus,
    "22001", 100, 10, 20,
    "22002", 300, 60, 90,
    "29001", 200, 80, 40,
    "29002", 400, 100, 240
  )
}

test_that("calculer_voitures_communes : les parts sans voiture / 2+ par commune (le miroir de la demande)", {
  v <- calculer_voitures_communes(fixture_voitures_mini())

  # une ligne par commune, la forme : identité + le poids (ménages) + les deux
  # parts (sans voiture / 2+) — des fractions dans [0, 1]
  expect_equal(nrow(v), 4)
  expect_named(v, c("commune", "menages", "part_sans_voiture", "part_deux_plus"))
  lire <- function(commune) v[v$commune == commune, ]
  expect_equal(lire("22001")$part_sans_voiture, 0.1)
  expect_equal(lire("22001")$part_deux_plus, 0.2)
  expect_equal(lire("22002")$part_sans_voiture, 0.2)
  expect_equal(lire("22002")$part_deux_plus, 0.3)
  expect_equal(lire("29001")$part_sans_voiture, 0.4)
  expect_equal(lire("29001")$part_deux_plus, 0.2)
  expect_equal(lire("29002")$part_sans_voiture, 0.25)
  expect_equal(lire("29002")$part_deux_plus, 0.6)
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
  # les deux parts = 18 lignes
  expect_equal(nrow(ag), 9 * 2)
  expect_named(ag, c("code", "key", "detail", "value"))
  expect_true(all(ag$key == "voitures_menage"))
  expect_setequal(unique(ag$detail), c("sans_voiture", "deux_plus"))
  lire <- function(code, detail) ag$value[ag$code == code & ag$detail == detail]

  # EPCI 200000001 (22001 + 22002) : Σ (part × ménages) ÷ Σ ménages — la
  # moyenne PONDÉRÉE par les ménages, jamais la moyenne des parts
  expect_equal(lire("200000001", "sans_voiture"), (0.1 * 100 + 0.2 * 300) / 400)
  expect_equal(lire("200000001", "deux_plus"), (0.2 * 100 + 0.3 * 300) / 400)
  # EPCI 200000002 (29001 + 29002)
  expect_equal(lire("200000002", "sans_voiture"), (0.4 * 200 + 0.25 * 400) / 600)
  expect_equal(lire("200000002", "deux_plus"), (0.2 * 200 + 0.6 * 400) / 600)
  # départements : la même pondération sur leurs communes ; la région : toutes
  expect_equal(lire("22", "sans_voiture"), (0.1 * 100 + 0.2 * 300) / 400)
  expect_equal(lire("29", "deux_plus"), (0.2 * 200 + 0.6 * 400) / 600)
  expect_equal(lire("53", "sans_voiture"), (10 + 60 + 80 + 100) / 1000)
  expect_equal(lire("53", "deux_plus"), (20 + 90 + 40 + 240) / 1000)
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
# calculent à la main. Le motif exerce le mapping des modes (c/b/t), l'exclusion
# de path/track, et l'attribution par centroïde :
#   L1 residential  (0,0)-(2000,0)        2 000 m → 22001 (c)
#   L2 cycleway     (500,500)-(1500,500)  1 000 m → 22001 (b)
#   L3 footway      (100,100)-(100,900)     800 m → 22001 (t)
#   L4 residential  (2000,0)-(4000,0)     2 000 m → 22002 (c)
#   L7 service      (2100,1500)-(3900,1500) 1 800 m → 22002 (c)
#   L5 path         (500,2500)-(1500,2500) 1 000 m → 29001 (EXCLU)
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

test_that("calculer_reseaux_communes : longueurs et densités par mode, EPSG:2154 projeté avant la mesure", {
  res <- calculer_reseaux_communes(fixture_lignes_mini(), fixture_limites_mini())

  # une ligne par commune, la forme : identité + surface + longueurs (km) +
  # densités (km/km²)
  expect_equal(nrow(res), 3)
  expect_named(res, c("commune", "aire_m2", "longueur_t", "longueur_b",
                      "longueur_c", "densite_t", "densite_b", "densite_c"))
  lire <- function(commune) res[res$commune == commune, ]

  # 22001 : c = L1 (2 000 m), b = L2 (1 000 m), t = L3 (800 m) ; surface 4 km²
  expect_equal(lire("22001")$aire_m2, 4e6)
  expect_equal(lire("22001")$longueur_c, 2.0)
  expect_equal(lire("22001")$longueur_b, 1.0)
  expect_equal(lire("22001")$longueur_t, 0.8)
  expect_equal(lire("22001")$densite_c, 0.5)
  expect_equal(lire("22001")$densite_b, 0.25)
  expect_equal(lire("22001")$densite_t, 0.2)
  # 22002 : c = L4 + L7 (2 000 + 1 800 m) ; b et t nuls
  expect_equal(lire("22002")$longueur_c, 3.8)
  expect_equal(lire("22002")$longueur_b, 0)
  expect_equal(lire("22002")$longueur_t, 0)
  expect_equal(lire("22002")$densite_c, 0.95)
  # 29001 : path et track EXCLUS du mapping — zéro réseau (un fait, jamais une
  # ligne manquante), surface portée
  expect_equal(lire("29001")$longueur_c, 0)
  expect_equal(lire("29001")$longueur_b, 0)
  expect_equal(lire("29001")$longueur_t, 0)
  expect_equal(lire("29001")$aire_m2, 4e6)
  # la longueur totale de la région est conservée : 2 + 3.8 + 1 + 0.8 km
  expect_equal(sum(res$longueur_c), 5.8)
  expect_equal(sum(res$longueur_b), 1.0)
  expect_equal(sum(res$longueur_t), 0.8)
  # déterministe : trié par commune
  expect_true(!is.unsorted(res$commune))
})

test_that("agreger_reseaux_territoires : longueurs sommées, densités recalculées depuis les parties (Σ L ÷ Σ surface)", {
  res <- calculer_reseaux_communes(fixture_lignes_mini(), fixture_limites_mini())
  ag <- agreger_reseaux_territoires(res, base_epci_mini_analytique())

  # les niveaux présents × 6 mesures = 48 lignes (3 communes du fixture + 2
  # EPCIs + 2 départements + la région ; 29002 — hors extract — n'a pas de
  # ligne ici ; l'alignement sur la référence se fait à l'assemblage)
  expect_equal(nrow(ag), 8 * 6)
  expect_named(ag, c("code", "key", "detail", "value"))
  expect_true(all(ag$key == "reseaux"))
  expect_setequal(unique(ag$detail),
                  c("t_longueur", "t_densite", "b_longueur", "b_densite",
                    "c_longueur", "c_densite"))
  lire <- function(code, detail) ag$value[ag$code == code & ag$detail == detail]

  # EPCI 200000001 (22001 + 22002) : longueur c = 2 + 3.8 = 5.8 km ; densité c =
  # 5 800 m ÷ 8 km² = 0.725 — la somme des longueurs sur la somme des surfaces,
  # jamais la moyenne des densités (0.5 + 0.95)/2 = 0.725 — attention : la
  # moyenne pondérée par la surface donne le même nombre ici (surfaces égales)
  expect_equal(lire("200000001", "c_longueur"), 5.8)
  expect_equal(lire("200000001", "c_densite"), 5.8 / 8)
  expect_equal(lire("200000001", "b_longueur"), 1.0)
  expect_equal(lire("200000001", "b_densite"), 1.0 / 8)
  expect_equal(lire("200000001", "t_longueur"), 0.8)
  expect_equal(lire("200000001", "t_densite"), 0.8 / 8)
  # EPCI 200000002 : n'agrège que 29001 (zéro réseau — 29002 absente)
  expect_equal(lire("200000002", "c_longueur"), 0)
  expect_equal(lire("200000002", "c_densite"), 0)
  # département 22 = EPCI 200000001 ; région : Σ L ÷ Σ surface sur 12 km²
  expect_equal(lire("22", "c_longueur"), 5.8)
  expect_equal(lire("53", "c_longueur"), 5.8)
  expect_equal(lire("53", "c_densite"), 5.8 / 12)
  expect_equal(lire("53", "b_densite"), 1.0 / 12)
  expect_equal(lire("53", "t_densite"), 0.8 / 12)
  # la commune garde SES valeurs telles quelles
  expect_equal(lire("22001", "c_longueur"), 2.0)
  expect_equal(lire("22001", "t_densite"), 0.2)
  # déterministe : trié par code puis détail
  expect_true(!is.unsorted(ag$code))
})

test_that("calculer_reseaux_communes : la projection EPSG:2154 précède toute mesure (l'entrée WGS84 mesure juste)", {
  # les MÊMES lignes et limites en WGS84 (le crs natif de l'extrait Geofabrik) :
  # le builder projette AVANT st_length/st_area — les longueurs restent en
  # mètres (la projection avant la mesure, jamais une mesure en degrés)
  lignes <- sf::st_transform(fixture_lignes_mini(), 4326)
  limites <- sf::st_transform(fixture_limites_mini(), 4326)

  res <- calculer_reseaux_communes(lignes, limites)
  lire <- function(commune) res[res$commune == commune, ]
  # les longueurs en km restent exactes (L1 2 km, L2 1 km, L3 0.8 km — le plan
  # Lambert ne déforme pas ces distances à l'échelle du fixture)
  expect_equal(lire("22001")$longueur_c, 2.0)
  expect_equal(lire("22001")$longueur_b, 1.0)
  expect_equal(round(lire("22001")$longueur_t, 3), 0.8)
  expect_equal(lire("22002")$longueur_c, 3.8)
})


# =============================================================================
# Le sous-bloc « L'offre de mobilité alternative » (issue #140)
# =============================================================================
# Les tests unitaires du sous-bloc : les contrats des fragments du manifeste
# (CINQ sources — korrigo GTFS, batiments_residentiels, bornes-recharges,
# stationnement-velo), les normaliseurs (les arrêts GTFS stops.txt, la couche
# bâtiments BDNB, les bornes IRVE, le hub vélo), les builders COMMUNAUX
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
#     (la couche batiments_residentiels, geom_adresse POINT EPSG:2154) à moins
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
test_that("MANIFEST_MOBILITE_BATIMENTS : la couche bâtiments (BDNB, portée comme le snapshot), Licence Ouverte", {
  frag <- MANIFEST_MOBILITE_BATIMENTS

  expect_equal(nrow(frag), 1L)
  expect_equal(frag$id, "batiments_residentiels")
  expect_equal(frag$fichier, "batiments_residentiels_bretagne.csv")
  expect_equal(frag$licence, "lov2")   # BDNB — Licence Ouverte 2.0 (Etalab)
  expect_equal(frag$mode, "manuel")    # portée à la main, comme le snapshot
  expect_equal(frag$type, "fichier")
  # la couche a SON propre millésime (BDNB 2025-07), jamais aligné sur le
  # snapshot
  expect_equal(frag$vintage, "2025-07")
  expect_true(verifier_contrat_mobilite_batiments(frag))
})

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

  # un manifeste amputé d'une source échoue bruyamment (les HUIT sources du
  # thème — le snapshot + les trois de l'étage demande/réseaux (#139) + les
  # quatre du sous-bloc (#140))
  defectueux <- MANIFEST_MOBILITE[MANIFEST_MOBILITE$id != "batiments_residentiels", ]
  expect_error(verifier_contrat_manifest_mobilite(defectueux), "HUIT")

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

# normaliser_batiments_residentiels ----------------------------------------------
test_that("normaliser_batiments_residentiels : la couche bâtiments (POINT EPSG:2154) portée", {
  # une forme RÉDUITE mais fidèle de la couche BDNB : le batiment_groupe_id,
  # le code commune et le geom_adresse (WKT POINT en EPSG:2154 — Lambert-93)
  brut <- tibble::tibble(
    batiment_groupe_id = c("bg-1", "bg-2", "bg-3"),
    code_commune_insee = c("35238", "35238", "29011"),
    geom_adresse = c("POINT (350000 6780000)", "POINT (350500 6780000)",
                     "POINT (165000 6780000)")
  )

  table <- normaliser_batiments_residentiels(brut)

  # un sf POINT en EPSG:2154 (la projection du fichier), le code commune
  # conservé en caractères (jamais deviné numérique)
  expect_s3_class(table, "sf")
  expect_equal(sf::st_crs(table)$epsg, 2154)
  expect_true(all(sf::st_geometry_type(table) == "POINT"))
  expect_true(all(c("code_commune_insee") %in% names(table)))
  expect_equal(table$code_commune_insee, c("29011", "35238", "35238"))
  expect_equal(nrow(table), 3)
})

test_that("normaliser_batiments_residentiels : un input corrompu s'arrête bruyamment", {
  # une colonne requise manquante nomme la colonne fautive
  expect_error(normaliser_batiments_residentiels(tibble::tibble(
    batiment_groupe_id = "bg-1")), "code_commune_insee")

  # un geom_adresse non POINT (ou mal formé) est une corruption
  expect_error(normaliser_batiments_residentiels(tibble::tibble(
    batiment_groupe_id = "bg-1",
    code_commune_insee = "35238",
    geom_adresse = "POLYGON ((0 0, 1 0, 1 1, 0 0))")), "POINT")

  # un code commune hors format COG est une corruption
  expect_error(normaliser_batiments_residentiels(tibble::tibble(
    batiment_groupe_id = "bg-1",
    code_commune_insee = "ABC",
    geom_adresse = "POINT (350000 6780000)")), "COG")

  # un fichier vide est une corruption
  expect_error(normaliser_batiments_residentiels(tibble::tibble(
    batiment_groupe_id = character(),
    code_commune_insee = character(),
    geom_adresse = character())), "aucune ligne")
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
fixture_batiments_spatiale <- function() {
  # trois communes : 22001 (bâtiments proches ET lointains d'un arrêt),
  # 22002 (tous proches), 22003 (aucun arrêt à proximité)
  bat <- tibble::tibble(
    batiment_groupe_id = paste0("bg-", 1:7),
    code_commune_insee = c(rep("22001", 4), rep("22002", 2), "22003"),
    geom_adresse = c(
      # 22001 : 2 à moins de 500 m de l'arrêt central (0 et 300 m), 2 au-delà
      # (800 et 1 500 m)
      "POINT (400000 6780000)",   # 0 m — proche
      "POINT (400300 6780000)",   # 300 m — proche
      "POINT (400800 6780000)",   # 800 m — au-delà du rayon
      "POINT (401500 6780000)",   # 1 500 m — loin
      # 22002 : 2 bâtiments collés à l'arrêt
      "POINT (400050 6780050)",   # ~71 m — proche
      "POINT (400100 6780000)",   # 100 m — proche
      # 22003 : aucun arrêt à moins de 500 m
      "POINT (500000 6780000)"
    )
  )
  stops <- tibble::tibble(
    stop_id = c("AR1", "AR2"),
    # l'arrêt central en WGS84 (la paire lat/lon que le GTFS porte) — le point
    # 2154 (400000, 6780000) exact, où les bâtiments 22001/22002 sont définis
    stop_lat = 48.0514967135,
    stop_lon = -1.0282079342
  )
  list(batiments = bat, stops = stops)
}

test_that("calculer_part_proches_arret_communes : la vraie part des bâtiments à 500 m (la correction de la méthode)", {
  skip_if_not(requireNamespace("sf", quietly = TRUE),
              "sf est requis pour le calcul spatial de l'offre TC.")

  fx <- fixture_batiments_spatiale()
  batiments <- normaliser_batiments_residentiels(fx$batiments)
  stops <- fx$stops

  tc <- calculer_part_proches_arret_communes(stops, batiments)

  # la forme : une ligne par commune avec ses bâtiments, la part dans [0, 1]
  expect_named(tc, c("commune", "n_batiments", "n_proches", "part_proche"))
  expect_setequal(tc$commune, c("22001", "22002", "22003"))

  # 22001 : 2 bâtiments sur 4 à moins de 500 m → 0,5 — la fraction des
  # BÂTIMENTS, jamais une part de superficie (la correction de la méthode)
  expect_equal(tc$part_proche[tc$commune == "22001"], 0.5)
  expect_equal(tc$n_proches[tc$commune == "22001"], 2L)
  expect_equal(tc$n_batiments[tc$commune == "22001"], 4L)
  # 22002 : 2 bâtiments sur 2 proches → 1, exactement
  expect_equal(tc$part_proche[tc$commune == "22002"], 1)
  # 22003 : aucun bâtiment dans le rayon → 0, exactement
  expect_equal(tc$part_proche[tc$commune == "22003"], 0)

  # déterministe : deux appels produisent la même table (et s2 est restauré)
  avant <- sf::sf_use_s2()
  tc2 <- calculer_part_proches_arret_communes(stops, batiments)
  expect_identical(tc, tc2)
  expect_identical(sf::sf_use_s2(), avant)
})

test_that("calculer_part_proches_arret_communes : un input corrompu s'arrête bruyamment", {
  skip_if_not(requireNamespace("sf", quietly = TRUE),
              "sf est requis pour le calcul spatial de l'offre TC.")

  fx <- fixture_batiments_spatiale()
  # un tableau d'arrêts sans coordonnées est refusé
  expect_error(
    calculer_part_proches_arret_communes(
      tibble::tibble(stop_id = "x"), normaliser_batiments_residentiels(fx$batiments)),
    "stop_lat"
  )
  # une couche bâtiments sans code commune est refusée
  expect_error(
    calculer_part_proches_arret_communes(
      fx$stops,
      sf::st_sf(geometry = sf::st_sfc(sf::st_point(c(400000, 6780000)),
                                      crs = 2154))),
    "code_commune_insee"
  )
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
# trois tables communales du sous-bloc. Les valeurs attendues sont calculées à
# la main — jamais une moyenne de valeurs. L'offre TC est agrégée par la règle
# du thème : la moyenne PONDÉRÉE par les bâtiments (n_batiments de la couche —
# la correction : le poids EST le dénominateur de la part), jamais la moyenne
# des parts communales.
test_that("agreger_offre_territoires : chaque indicateur agrégé par SA règle", {
  base <- tibble::tribble(
    ~CODGEO, ~EPCI, ~DEP,
    "22001", "200000001", "22",
    "22002", "200000001", "22",
    "29001", "200000002", "29",
    "29002", NA, "29"   # la commune sans EPCI (le fix « Sans objet » #131)
  )
  offre_tc <- tibble::tribble(
    ~commune, ~n_batiments, ~n_proches, ~part_proche,
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

  agg <- agreger_offre_territoires(offre_tc, bornes, velo, base)

  # la forme : une ligne par (territoire × clé) — 4 communes + 2 EPCIs +
  # 2 départements + la région, les trois clés
  expect_named(agg, c("code", "key", "value"))
  expect_equal(nrow(agg), (4 + 2 + 2 + 1) * 3)
  expect_setequal(unique(agg$key), c("offre_tc", "bornes_recharge",
                                     "places_stationnement_velo_1000"))
  lire <- function(code, key) agg$value[agg$code == code & agg$key == key]

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
  # déterministe : trié par code puis clé
  expect_true(!is.unsorted(paste(agg$code, agg$key)))
})

# INDICATEURS_MOBILITE -----------------------------------------------------------
test_that("INDICATEURS_MOBILITE : les onze clés du payload, chacune estampillée de SA source de référence", {
  ind <- INDICATEURS_MOBILITE

  # la « Taille » (le tracer bullet #137/#138) + les deux clés multi-mesures
  # de l'étage demande/réseaux (issue #139 : voitures_menage × 2, reseaux × 6)
  # + les trois clés du sous-bloc « L'offre de mobilité alternative »
  # (issue #140) + les CINQ parts d'isolation de la grille (issue #141) — une
  # ligne par clé, la multiplicité de chacune (1 / 2 / 6 / 1 / 1 / 1 et les
  # cinq 1 des parts d'isolation)
  expect_equal(nrow(ind), 11L)
  expect_setequal(ind$key, c("nb_buildings", "voitures_menage", "reseaux",
                             "offre_tc", "bornes_recharge",
                             "places_stationnement_velo_1000",
                             "iso_alimentation", "iso_sante",
                             "iso_administration", "iso_ecole", "iso_banque"))
  expect_equal(ind$multiplicite[ind$key == "nb_buildings"], 1L)
  expect_equal(ind$multiplicite[ind$key == "voitures_menage"], 2L)
  expect_equal(ind$multiplicite[ind$key == "reseaux"], 6L)
  expect_equal(ind$multiplicite[ind$key == "offre_tc"], 1L)
  expect_equal(ind$multiplicite[ind$key == "bornes_recharge"], 1L)
  expect_equal(ind$multiplicite[ind$key == "places_stationnement_velo_1000"], 1L)
  for (cle in names(CLES_ISOLATION_MOBILITE)) {
    expect_equal(ind$multiplicite[ind$key == cle], 1L, info = cle)
  }

  # chaque clé est estampillée du vintage de SA source de référence :
  #   - nb_buildings              -> le snapshot porté (l'horloge lente) ;
  #   - voitures_menage           -> le cube RP exploitation principale (le
  #     code de table LOG T12) ;
  #   - reseaux                   -> l'extrait OSM Geofabrik (le timestamp
  #     d'extraction comme vintage, ODbL) ;
  #   - offre_tc                  -> korrigo (les arrêts GTFS — la couche
  #     SIGNATURE de la part des bâtiments près d'un arrêt, ODbL) ;
  #   - bornes_recharge           -> bornes-recharges (IRVE, Licence Ouverte) ;
  #   - places_stationnement_velo_1000 -> stationnement-velo (le hub Ecolab,
  #     ODbL — producteur OSM) ;
  #   - les 5 parts d'isolation (issue #141) -> le snapshot porté, comme la
  #     « Taille » : l'estampille SNAPSHOT du flagship (la date d'instantané
  #     de l'analyse comme référence — la grille est la matière du snapshot).
  expect_equal(ind$source_reference[ind$key == "nb_buildings"],
               "mobilite_snapshot")
  expect_equal(ind$source_reference[ind$key == "voitures_menage"],
               "rp_logement_princ")
  expect_equal(ind$source_reference[ind$key == "reseaux"], "osm_reseaux")
  expect_equal(ind$source_reference[ind$key == "offre_tc"], "korrigo")
  expect_equal(ind$source_reference[ind$key == "bornes_recharge"],
               "bornes-recharges")
  expect_equal(ind$source_reference[ind$key == "places_stationnement_velo_1000"],
               "stationnement-velo")
  for (cle in names(CLES_ISOLATION_MOBILITE)) {
    expect_equal(ind$source_reference[ind$key == cle], "mobilite_snapshot",
                 info = cle)
  }
})

# fixture_indicateurs_mobilite ---------------------------------------------------
# La liste des artefacts analytiques pour l'assemblage des indicateurs (le seam
# construire_indicateurs_mobilite, issue #141) : la « Taille », les 5 parts
# d'isolation et LEURS RANGS (mocked — la forme exacte des artefacts que le
# chaînon persiste : isolation_territoires.rds et isolation_rangs.rds), l'étage
# demande/réseaux et le sous-bloc. La forme de chaque table est celle des
# builders réels — le seam ne calcule RIEN, il assemble.
fixture_indicateurs_mobilite <- function() {
  base <- base_epci_mini_analytique()
  poids <- tibble::tibble(commune = c("22001", "22002", "29001", "29002"),
                          nb_buildings = c(100, 300, 200, 400))
  territoires <- construire_territoires_mobilite(
    base, list(mobilite_communes = poids)
  )
  codes <- territoires$code  # 9 territoires (4 communes + 2 EPCIs + 2 déps + région)

  # les parts d'isolation MOCKÉES : une valeur synthétique en [0, 1] par
  # (territoire × clé) — la forme longue (code, key, value) de
  # isolation_territoires.rds
  isolation_territoires <- tidyr::crossing(
    code = codes, key = names(CLES_ISOLATION_MOBILITE)
  ) %>%
    dplyr::mutate(value = 0.1 + 0.05 * match(code, codes))

  # les rangs MOCKÉS : la forme longue (code, key, rang_epci/dep/reg) de
  # isolation_rangs.rds — des fractions dans [0, 1]
  isolation_rangs <- isolation_territoires %>%
    dplyr::transmute(
      code = code, key = key,
      rang_epci = 0.25, rang_dep = 0.5, rang_reg = 0.75
    )

  # l'étage demande/réseaux (issue #139) et le sous-bloc (issue #140) : les
  # formes longues (code, key[, detail], value) des artefacts du chaînon
  voitures_territoires <- tidyr::crossing(
    code = codes, detail = c("sans_voiture", "deux_plus")
  ) %>%
    dplyr::mutate(key = "voitures_menage", value = 0.3)
  reseaux_territoires <- tidyr::crossing(
    code = codes,
    detail = c("t_longueur", "t_densite", "b_longueur", "b_densite",
               "c_longueur", "c_densite")
  ) %>%
    dplyr::mutate(key = "reseaux", value = 1)
  offre_territoires <- tidyr::crossing(
    code = codes, key = c("offre_tc", "bornes_recharge",
                          "places_stationnement_velo_1000")
  ) %>%
    dplyr::mutate(value = dplyr::if_else(key == "offre_tc", 0.5, 10))

  list(
    nb_buildings_territoires = agreger_nb_buildings_territoires(poids, base),
    isolation_territoires = isolation_territoires,
    isolation_rangs = isolation_rangs,
    voitures_territoires = voitures_territoires,
    reseaux_territoires = reseaux_territoires,
    offre_territoires = offre_territoires
  )
}

test_that("construire_indicateurs_mobilite : les onze clés, avec les 5 parts d'isolation, leurs rangs et l'estampille snapshot", {
  fx <- fixture_indicateurs_mobilite()
  base <- base_epci_mini_analytique()
  poids <- tibble::tibble(commune = c("22001", "22002", "29001", "29002"),
                          nb_buildings = c(100, 300, 200, 400))
  territoires <- construire_territoires_mobilite(
    base, list(mobilite_communes = poids)
  )

  ind <- construire_indicateurs_mobilite(fx, territoires, vintages_mobilite())

  # les onze clés : la « Taille » + la demande/réseaux + le sous-bloc + les 5
  # parts d'isolation (issue #141) — une ligne par (territoire × détail)
  # (9 territoires × 17 détails)
  expect_setequal(unique(ind$key), c(
    "nb_buildings", "voitures_menage", "reseaux",
    "offre_tc", "bornes_recharge", "places_stationnement_velo_1000",
    "iso_alimentation", "iso_sante", "iso_administration",
    "iso_ecole", "iso_banque"
  ))
  expect_equal(nrow(ind), 9 * 17)
  expect_equal(sum(ind$key == "nb_buildings"), 9)
  expect_equal(sum(ind$key == "voitures_menage"), 9 * 2)
  expect_equal(sum(ind$key == "reseaux"), 9 * 6)
  for (cle in c("offre_tc", "bornes_recharge",
                "places_stationnement_velo_1000")) {
    expect_equal(sum(ind$key == cle), 9, info = cle)
  }
  for (cle in names(CLES_ISOLATION_MOBILITE)) {
    expect_equal(sum(ind$key == cle), 9, info = cle)
  }

  # chaque part d'isolation porte la valeur MOCKÉE de son artefact (la forme
  # longue de isolation_territoires.rds) avec le détail NA des clés scalaires
  lire <- function(code, key) ind$value[ind$territoire == code & ind$key == key]
  expect_equal(lire("22001", "iso_alimentation"),
               0.1 + 0.05 * match("22001", territoires$code))
  expect_equal(lire("53", "iso_banque"),
               0.1 + 0.05 * match("53", territoires$code))

  # chaque part d'isolation porte SES rangs-en-contexte (l'artefact
  # isolation_rangs.rds — la machinerie partagée, jamais re-forkée)
  rang <- function(code, key, col) {
    ind[[col]][ind$territoire == code & ind$key == key]
  }
  expect_equal(rang("22001", "iso_alimentation", "rang_epci"), 0.25)
  expect_equal(rang("22001", "iso_alimentation", "rang_dep"), 0.5)
  expect_equal(rang("22001", "iso_alimentation", "rang_reg"), 0.75)
  expect_equal(rang("53", "iso_banque", "rang_reg"), 0.75)

  # l'estampille SNAPSHOT : chaque part d'isolation est estampillée du vintage
  # de SA source de référence (le snapshot porté — la date d'instantané de
  # l'analyse, comme la « Taille »)
  ref_snapshot <- vintages_mobilite()$source[
    vintages_mobilite()$id == "mobilite_snapshot"]
  iso_ind <- ind[ind$key %in% names(CLES_ISOLATION_MOBILITE), ]
  expect_true(all(iso_ind$vintage_source == ref_snapshot))
  expect_true(all(iso_ind$vintage_date_reference == "2026-02-28"))
  expect_true(all(iso_ind$vintage_date_publication == "2026-08-06"))
  # le détail des clés d'isolation est NA (les clés scalaires de la grille)
  expect_true(all(is.na(iso_ind$detail)))
})

test_that("validations_mobilite : une part d'isolation hors [0, 1] fait échouer la validation bruyamment", {
  fx <- fixture_indicateurs_mobilite()
  base <- base_epci_mini_analytique()
  poids <- tibble::tibble(commune = c("22001", "22002", "29001", "29002"),
                          nb_buildings = c(100, 300, 200, 400))
  territoires <- construire_territoires_mobilite(
    base, list(mobilite_communes = poids)
  )

  # un payload sain passe la validation générique + les validations du thème
  payload <- list(
    indicateurs = construire_indicateurs_mobilite(fx, territoires,
                                                  vintages_mobilite()),
    histoires = tibble::tibble(),
    territoires = reference_territoires(territoires),
    apercu = assemble_apercu(territoires, list())
  )
  expect_no_error(validate_payload(
    payload,
    indicateurs = INDICATEURS_MOBILITE,
    vintages = vintages_mobilite(),
    validations = validations_mobilite,
    apercu = APERCU_MOBILITE
  ))

  # une part d'isolation hors [0, 1] (une corruption — jamais une part de
  # bâtiments > 100 %) fait échouer la validation bruyamment
  payload$indicateurs$value[
    payload$indicateurs$key == "iso_alimentation" &
      payload$indicateurs$territoire == "22001"] <- 1.5
  expect_error(validate_payload(
    payload,
    indicateurs = INDICATEURS_MOBILITE,
    vintages = vintages_mobilite(),
    validations = validations_mobilite,
    apercu = APERCU_MOBILITE
  ), "[0, 1]")
})
