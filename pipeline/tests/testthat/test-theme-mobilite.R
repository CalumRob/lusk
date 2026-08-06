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

test_that("MANIFEST_MOBILITE : les fragments concaténés, six sources, les 11 colonnes standard", {
  m <- MANIFEST_MOBILITE

  # le manifeste est un tibble de SIX lignes — le snapshot porté + les cinq
  # sources du sous-bloc « L'offre de mobilité alternative » (issue #140),
  # jamais un doublon de cache
  expect_s3_class(m, "tbl_df")
  expect_equal(nrow(m), 6L)
  expect_equal(nrow(m), length(unique(m$id)))

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

  # les cinq sources du sous-bloc, chacune avec SA licence (ODbL pour
  # Korrigo/arrêts/stationnement vélo — ADR-0001, lov2 pour le référentiel et
  # les bornes) et SON mode cron
  expect_setequal(m$id, c("mobilite_snapshot", "korrigo", "mobibreizh-stops",
                          "communes-france", "bornes-recharges",
                          "stationnement-velo"))
  expect_equal(m$licence[m$id == "korrigo"], "odbl")
  expect_equal(m$licence[m$id == "mobibreizh-stops"], "odbl")
  expect_equal(m$licence[m$id == "communes-france"], "lov2")
  expect_equal(m$licence[m$id == "bornes-recharges"], "lov2")
  expect_equal(m$licence[m$id == "stationnement-velo"], "odbl")
  expect_true(all(m$mode[m$id != "mobilite_snapshot"] == "cron"))
})

test_that("verifier_contrat_manifest_mobilite : le manifeste concaténé passe son contrat", {
  # le manifeste réel passe sa propre validation de contrat
  expect_true(verifier_contrat_manifest_mobilite(MANIFEST_MOBILITE))

  # un manifeste amputé d'une source du sous-bloc échoue bruyamment
  defectueux <- MANIFEST_MOBILITE[MANIFEST_MOBILITE$id != "stationnement-velo", ]
  expect_error(verifier_contrat_manifest_mobilite(defectueux), "SIX")

  # un id dupliqué échoue
  defectueux <- MANIFEST_MOBILITE
  defectueux$id[defectueux$id == "bornes-recharges"] <- "korrigo"
  expect_error(verifier_contrat_manifest_mobilite(defectueux), "dupliqu")
})

test_that("MANIFEST_MOBILITE_KORRIGO : GTFS + arrêts + référentiel, leurs licences", {
  frag <- MANIFEST_MOBILITE_KORRIGO

  # le fragment porte TROIS sources — la base GTFS (le réseau), les arrêts (la
  # couche du calcul) et le référentiel géographique (la jointure spatiale)
  expect_equal(nrow(frag), 3L)
  expect_setequal(frag$id, c("korrigo", "mobibreizh-stops", "communes-france"))
  expect_true(verifier_contrat_mobilite_korrigo(frag))

  # ODbL pour Korrigo et les arrêts (ADR-0001), Licence Ouverte pour le
  # référentiel ODS ; les fichiers de cache distincts
  expect_equal(frag$licence[frag$id == "korrigo"], "odbl")
  expect_equal(frag$licence[frag$id == "mobibreizh-stops"], "odbl")
  expect_equal(frag$licence[frag$id == "communes-france"], "lov2")
  expect_equal(length(unique(frag$fichier)), 3L)

  # les dates : les arrêts portent le rafraîchissement verrouillé du contrat
  # (stops 2026-08-02), le référentiel sa date (2020-09-03, stale assumé)
  expect_equal(frag$date_reference[frag$id == "mobibreizh-stops"], "2026-08-02")
  expect_equal(frag$date_reference[frag$id == "communes-france"], "2020-09-03")

  # un fragment amputé du référentiel échoue (la jointure spatiale exige les
  # géométries communales — les arrêts ne portent aucun code INSEE)
  sans_ref <- frag[frag$id != "communes-france", ]
  expect_error(verifier_contrat_mobilite_korrigo(sans_ref), "TROIS")
})

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

test_that("vintages_mobilite : chaque source porte SA référence et SA publication", {
  v <- vintages_mobilite()

  expect_equal(nrow(v), 6L)  # le snapshot + les cinq sources du sous-bloc
  expect_named(v, c("id", "source", "version", "licence",
                    "date_reference", "date_publication"))
  expect_setequal(v$id, c("mobilite_snapshot", "korrigo", "mobibreizh-stops",
                          "communes-france", "bornes-recharges",
                          "stationnement-velo"))

  # le snapshot : la date de RÉFÉRENCE est la date d'instantané de l'analyse
  # (le fichier de production a été figé le 2026-02-28 — les données de
  # référence BPE 2024 · OSM 02-2026 · BDNB 2025-07) ; la date de PUBLICATION
  # est la date du portage dans le pipeline (2026-08-06) — jamais alignées,
  # chacune sa vérité
  snap <- v[v$id == "mobilite_snapshot", ]
  expect_equal(snap$version, "2026-02")
  expect_equal(snap$date_reference, "2026-02-28")
  expect_equal(snap$date_publication, "2026-08-06")
  expect_equal(snap$licence, "odbl")

  # les sources du sous-bloc gardent leurs dates (les extraits, jamais
  # « aujourd'hui ») : arrêts 2026-08-02, référentiel 2020-09-03, bornes
  # 2026-07-28 (référence) / 2026-08-04 (publication), hub vélo 2025-01-01
  # (référence) / 2026-02-03 (publication)
  expect_equal(v$date_reference[v$id == "mobibreizh-stops"], "2026-08-02")
  expect_equal(v$date_reference[v$id == "communes-france"], "2020-09-03")
  expect_equal(v$date_reference[v$id == "bornes-recharges"], "2026-07-28")
  expect_equal(v$date_publication[v$id == "bornes-recharges"], "2026-08-04")
  expect_equal(v$date_reference[v$id == "stationnement-velo"], "2025-01-01")
  expect_equal(v$date_publication[v$id == "stationnement-velo"], "2026-02-03")

  # la discipline : la publication d'une source n'est jamais antérieure à sa
  # référence
  expect_true(all(as.Date(v$date_reference) <= as.Date(v$date_publication)))
})

test_that("verifier_contrat_mobilite_snapshot : le manifeste épingle le fichier de production", {
  # le fragment snapshot réel passe sa propre validation de contrat
  expect_true(verifier_contrat_mobilite_snapshot(MANIFEST_MOBILITE_SNAPSHOT))

  # l'artefact NON-production (les deltas vélo négatifs) est refusé bruyamment
  # par le contrat — la garde du « jamais cette base » du PRD #136
  defectueux <- MANIFEST_MOBILITE_SNAPSHOT
  defectueux$fichier <- "indicateurs_summarized_communes.csv"
  expect_error(verifier_contrat_mobilite_snapshot(defectueux),
               "bretagne_mobility_super_dashboard_gravity")

  # un id hors contrat est refusé
  defectueux <- MANIFEST_MOBILITE_SNAPSHOT
  defectueux$id <- "autre_source"
  expect_error(verifier_contrat_mobilite_snapshot(defectueux), "mobilite_snapshot")

  # une date de publication antérieure à la référence est refusée
  defectueux <- MANIFEST_MOBILITE_SNAPSHOT
  defectueux$date_reference <- "2026-09-01"
  expect_error(verifier_contrat_mobilite_snapshot(defectueux), "référence")
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

test_that("construire_donnees_mobilite : assemble le snapshot porté et les sources du sous-bloc", {
  # la couture : le lecteur, le normaliseur et le builder des sources du
  # sous-bloc MOCKÉS — le seam d'entrée du run (jamais de fichier réel dans la
  # boucle de test unitaire)
  table_snapshot <- tibble::tibble(commune = "29011", nb_buildings = 1113)
  sources_fixture <- list(
    korrigo = tibble::tibble(agency_id = "STAR"),
    mobibreizh_stops = tibble::tibble(stop_id = "STAR:1"),
    communes_referentiel = tibble::tibble(com_code = "29011"),
    bornes_recharges = tibble::tibble(code_insee_commune = "29011"),
    stationnement_velo = tibble::tibble(geocode_commune = "29011")
  )
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
    construire_sources_offre_mobilite = function(cache) {
      appels$sources_cache <- cache
      sources_fixture
    },
    .package = "lusk"
  )

  donnees <- construire_donnees_mobilite(cache = "cache-test")

  # la liste nommée des tables, dans l'ordre du contrat : le snapshot + les
  # cinq sources du sous-bloc (issue #140)
  expect_named(donnees, c("mobilite_snapshot", "korrigo", "mobibreizh_stops",
                          "communes_referentiel", "bornes_recharges",
                          "stationnement_velo"))
  expect_identical(donnees$mobilite_snapshot, table_snapshot)
  expect_identical(donnees$korrigo, sources_fixture$korrigo)
  expect_identical(donnees$mobibreizh_stops, sources_fixture$mobibreizh_stops)
  expect_identical(donnees$communes_referentiel, sources_fixture$communes_referentiel)
  expect_identical(donnees$bornes_recharges, sources_fixture$bornes_recharges)
  expect_identical(donnees$stationnement_velo, sources_fixture$stationnement_velo)
  # le lecteur reçoit le chemin du fichier porté dans le cache (le fragment
  # SNAPSHOT — jamais le manifeste entier) et le builder des sources reçoit le
  # cache
  expect_equal(appels$chemin,
               file.path("cache-test", "bretagne_mobility_super_dashboard_gravity.csv"))
  expect_equal(appels$sources_cache, "cache-test")
  expect_true(appels$normalise)
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
  donnees <- list(mobilite_snapshot = fixture_snapshot_analytique_mobilite())
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
    calculer_part_proches_arret_communes = function(stops, communes) {
      pousser("offre_tc_communes")
      tibble::tibble(commune = "22001", part_proche = 0.4)
    },
    calculer_bornes_communes = function(bornes, communes_referentiel) {
      pousser("bornes_communes")
      tibble::tibble(commune = "22001", nb_bornes = 3)
    },
    calculer_stationnement_velo_communes = function(velo) {
      pousser("velo_communes")
      tibble::tibble(commune = "22001", annee = "2025", places = 30,
                     population = 1000, places_1000 = 30)
    },
    agreger_offre_territoires = function(offre_tc, bornes, velo, poids, base_epci) {
      pousser("offre_territoires")
      tibble::tibble(code = "22001", key = "offre_tc", value = 0.4)
    },
    .package = "lusk"
  )

  # les sources du sous-bloc font partie des données du seam
  donnees$mobibreizh_stops <- tibble::tibble(stop_id = "x")
  donnees$communes_referentiel <- tibble::tibble(com_code = "22001")
  donnees$bornes_recharges <- tibble::tibble(code_insee_commune = "22001")
  donnees$stationnement_velo <- tibble::tibble(geocode_commune = "22001")

  sortie <- tempfile("mob-analytiques-")
  on.exit(unlink(sortie, recursive = TRUE), add = TRUE)
  res <- construire_analytiques_mobilite(donnees, base_epci, sortie = sortie)

  # le chaînon enchaîne les builders dans l'ordre — le seam ne calcule RIEN
  # lui-même, il orchestre (le flagship #138 puis le sous-bloc #140)
  expect_equal(suivi$ordre,
               c("nb_buildings", "isolation_communes", "isolation_territoires",
                 "div_loss_communes", "div_loss_territoires", "saillance",
                 "densite", "nuage", "territoires", "rangs",
                 "offre_tc_communes", "bornes_communes", "velo_communes",
                 "offre_territoires"))

  # les tables analytiques exposées : le poids + les artefacts flagship + le
  # sous-bloc
  expect_named(res, c("mobilite_communes", "nb_buildings_territoires",
                      "isolation_territoires", "div_loss_territoires",
                      "saillance_territoires", "densite_territoires",
                      "nuage_territoires", "isolation_rangs",
                      "offre_tc_communes", "bornes_communes",
                      "stationnement_velo_communes", "offre_territoires"))
  expect_equal(res$nb_buildings_territoires$value, 100)
  expect_equal(res$isolation_territoires$value, 0.1)
  expect_equal(res$div_loss_territoires$delta, 1)
  expect_equal(res$saillance_territoires$classification, "non-saillant")
  expect_equal(res$densite_territoires$dens_1, 0.01)
  expect_equal(res$nuage_territoires$nuage_median, 12)
  expect_equal(res$isolation_rangs$rang_epci, 0)
  expect_equal(res$offre_tc_communes$part_proche, 0.4)
  expect_equal(res$bornes_communes$nb_bornes, 3)
  expect_equal(res$stationnement_velo_communes$places_1000, 30)
  expect_equal(res$offre_territoires$value, 0.4)

  # les artefacts sont PERSISTÉS sous le dossier analytique du run
  expect_true(file.exists(file.path(sortie, "nb_buildings_territoires.rds")))
  expect_true(file.exists(file.path(sortie, "isolation_territoires.rds")))
  expect_true(file.exists(file.path(sortie, "div_loss_territoires.rds")))
  expect_true(file.exists(file.path(sortie, "saillance_territoires.rds")))
  expect_true(file.exists(file.path(sortie, "densite_territoires.rds")))
  expect_true(file.exists(file.path(sortie, "nuage_territoires.rds")))
  expect_true(file.exists(file.path(sortie, "isolation_rangs.rds")))
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
  # référence (le snapshot porté — la date d'instantané de l'analyse)
  tampon_snapshot <- vintages_mobilite() %>%
    dplyr::filter(id == "mobilite_snapshot")
  expect_true(all(vingt$vintage_source == tampon_snapshot$source))
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

# =============================================================================
# Le sous-bloc « L'offre de mobilité alternative » (issue #140)
# =============================================================================
# Les tests unitaires des sources (les normaliseurs) et des builders du
# sous-bloc : la normalisation des arrêts / bornes / stationnement vélo /
# référentiel / GTFS, le calcul spatial de la part des bâtiments près d'un
# arrêt (sur un FIXTURE SPATIAL SYNTHÉTIQUE — la décision de distance à 500 m),
# le compte des bornes par commune, le stationnement vélo pris tel quel, et
# l'agrégation aux quatre niveaux par la règle du thème.

# normaliser_stops_mobilite -----------------------------------------------------
# La forme RÉELLE du fichier ODS (une ligne par arrêt, tout en caractères,
# stop_coordinates « lat, lon ») — le normaliseur découpe et numérise.
test_that("normaliser_stops_mobilite : découpe « lat, lon » et numérise", {
  brut <- tibble::tibble(
    stop_id = c("ARBUS:1", "STAR:2"),
    stop_code = c("A1", "S2"),
    stop_coordinates = c("48.465791, -4.242627", "48.10, -1.67"),
    filename = c("KORRIGOBRET.gtfs", "KORRIGOBRET.gtfs")
  )

  table <- normaliser_stops_mobilite(brut)

  # la table du calcul : stop_id + les deux coordonnées numériques
  expect_named(table, c("stop_id", "stop_lat", "stop_lon"))
  expect_equal(table$stop_lat, c(48.465791, 48.10))
  expect_equal(table$stop_lon, c(-4.242627, -1.67))
})

test_that("normaliser_stops_mobilite : un input corrompu s'arrête bruyamment", {
  # une colonne requise manquante nomme la colonne fautive
  expect_error(normaliser_stops_mobilite(tibble::tibble(stop_id = "x")),
               "stop_coordinates")
  # une coordonnée hors format « lat, lon » est une corruption
  expect_error(
    normaliser_stops_mobilite(tibble::tibble(
      stop_id = "x", stop_coordinates = "48.1 ; -4.2")),
    "lat, lon"
  )
  # un doublon de stop_id est une corruption
  expect_error(
    normaliser_stops_mobilite(tibble::tibble(
      stop_id = c("x", "x"),
      stop_coordinates = c("48.1, -4.2", "48.1, -4.2"))),
    "dupliqu"
  )
})

# normaliser_bornes_recharges ---------------------------------------------------
test_that("normaliser_bornes_recharges : garde les codes commune, NA pour les vides", {
  brut <- tibble::tibble(
    code_insee_commune = c("35238", NA, "22000", "22100"),
    id_station_itinerance = c("FR1", "FR2", "FR3", "FR4"),
    id_pdc_itinerance = c("PDC1", "PDC2", "PDC3", "PDC4")
  )

  table <- normaliser_bornes_recharges(brut)

  # la table du calcul : les codes (NA pour les lignes sans code — le caveat
  # source des stations mal géolocalisées, jamais une erreur) + l'id station
  expect_named(table, c("code_insee_commune", "id_station_itinerance"))
  expect_equal(table$code_insee_commune, c("35238", NA, "22000", "22100"))
  # les codes non vides restent au format COG (même « 22000 »/« 22100 » — les
  # valeurs hors référentiel sont écartées au BUILD, pas ici)
  expect_equal(table$id_station_itinerance[1], "FR1")
})

test_that("normaliser_bornes_recharges : un code hors format COG s'arrête bruyamment", {
  expect_error(
    normaliser_bornes_recharges(tibble::tibble(
      code_insee_commune = "ABC", id_station_itinerance = "FR1")),
    "COG"
  )
})

# normaliser_stationnement_velo --------------------------------------------------
# La forme RÉELLE du hub Ecolab : une ligne par (commune × millésime × type
# d'accroche), numerateur/denominateur numériques. Le normaliseur somme les
# places sur les quatre types et garde le dénominateur (le calcul du hub).
test_that("normaliser_stationnement_velo : somme les quatre types d'accroche, filtre la Bretagne", {
  brut <- tibble::tibble(
    date_mesure = c("2025-01-01T00:00:00.000", "2025-01-01T00:00:00.000",
                    "2025-01-01T00:00:00.000", "2025-01-01T00:00:00.000",
                    "2024-01-01T00:00:00.000", "2024-01-01T00:00:00.000",
                    "2024-01-01T00:00:00.000", "2024-01-01T00:00:00.000",
                    "2025-01-01T00:00:00.000"),
    geocode_commune = c("29011", "29011", "29011", "29011",
                        "29011", "29011", "29011", "29011",
                        "75101"),  # Paris : hors Bretagne, tombe
    libelle_commune = c(rep("Bohars", 8), "Paris"),
    type_accroche = c("roue", "cadre", "cadre et roue", "sans accroche",
                      "roue", "cadre", "cadre et roue", "sans accroche",
                      "roue"),
    numerateur = c(15, 0, 34, 0, 10, 5, 20, 0, 999),
    denominateur = c(3671, 3671, 3671, 3671, 3660, 3660, 3660, 3660, 2100000),
    valeur = c(1, 2, 3, 4, 5, 6, 7, 8, 9)
  )

  table <- normaliser_stationnement_velo(brut)

  # une ligne par (commune × millésime) — les quatre types sommés (2025 :
  # 15+0+34+0 = 49 places), le dénominateur gardé, le taux recomposé ; la
  # ligne parisienne tombe (la garde Bretagne)
  expect_equal(nrow(table), 2)
  expect_named(table, c("geocode_commune", "annee", "places", "population",
                        "places_1000"))
  v25 <- table[table$annee == "2025", ]
  expect_equal(v25$places, 49)
  expect_equal(v25$population, 3671)
  expect_equal(round(v25$places_1000, 4), round(49 / 3671 * 1000, 4))
  v24 <- table[table$annee == "2024", ]
  expect_equal(v24$places, 35)
  expect_setequal(table$geocode_commune, "29011")
})

test_that("normaliser_stationnement_velo : un input corrompu s'arrête bruyamment", {
  # un type d'accroche inconnu est une évolution du contrat du hub
  expect_error(
    normaliser_stationnement_velo(tibble::tibble(
      geocode_commune = "29011", date_mesure = "2025-01-01T00:00:00.000",
      type_accroche = "parapente", numerateur = 1, denominateur = 100)),
    "accroche"
  )
  # un dénominateur divergent par commune × millésime est une corruption
  # (les QUATRE types présents — la garde du nombre de types passée, la garde
  # du dénominateur déclenche)
  expect_error(
    normaliser_stationnement_velo(tibble::tibble(
      geocode_commune = c("29011", "29011", "29011", "29011"),
      date_mesure = c("2025-01-01T00:00:00.000", "2025-01-01T00:00:00.000",
                      "2025-01-01T00:00:00.000", "2025-01-01T00:00:00.000"),
      type_accroche = c("roue", "cadre", "cadre et roue", "sans accroche"),
      numerateur = c(1, 2, 3, 4), denominateur = c(100, 200, 100, 100))),
    "dénominateur"
  )
  # aucune ligne bretonne est une corruption
  expect_error(
    normaliser_stationnement_velo(tibble::tibble(
      geocode_commune = "75101", date_mesure = "2025-01-01T00:00:00.000",
      type_accroche = "roue", numerateur = 1, denominateur = 100)),
    "bretonne"
  )
})

# normaliser_communes_referentiel ------------------------------------------------
test_that("normaliser_communes_referentiel : garde les communes bretonnes et la géométrie", {
  # le référentiel du calcul : le compte verrouillé de 1 202 communes
  # bretonnes généré programmatiquement (les codes COG des quatre
  # départements), dont UNE commune hors Bretagne qui doit tomber
  codes_breton <- c(sprintf("22%03d", 1:344), sprintf("29%03d", 1:277),
                    sprintf("35%03d", 1:332), sprintf("56%03d", 1:249))
  carre <- function(lon, lat) {
    sf::st_sfc(sf::st_polygon(list(rbind(
      c(lon, lat), c(lon + 0.001, lat), c(lon + 0.001, lat + 0.001),
      c(lon, lat + 0.001), c(lon, lat)))), crs = 4326)
  }
  brut <- sf::st_sf(
    com_code = c(codes_breton, "75101"),  # 1 203 : Paris hors Bretagne
    geometry = do.call(c, c(
      lapply(seq_along(codes_breton), function(i) {
        carre(-4 + (i %% 40) * 0.05, 47.5 + (i %% 30) * 0.05)
      }),
      list(carre(2.3, 48.8))
    ))
  )

  table <- normaliser_communes_referentiel(brut)

  # la table du calcul : com_code + la géométrie, les colonnes annexes
  # tombent, la commune parisienne tombe (la garde Bretagne)
  expect_s3_class(table, "sf")
  expect_named(table, c("com_code", "geometry"))
  expect_equal(nrow(table), 1202)
  expect_false("75101" %in% table$com_code)
  expect_true(all(sf::st_is_valid(table)))
})

test_that("normaliser_communes_referentiel : un référentiel corrompu s'arrête bruyamment", {
  # le compte verrouillé des communes bretonnes (1 202) est une garde
  carre <- sf::st_sfc(sf::st_polygon(list(rbind(
    c(-4.5, 48.4), c(-4.49, 48.4), c(-4.49, 48.41), c(-4.5, 48.41),
    c(-4.5, 48.4)))), crs = 4326)
  petit <- sf::st_sf(com_code = "29011", geometry = carre)
  expect_error(normaliser_communes_referentiel(petit), "1 202")
  # un objet non sf est une corruption
  expect_error(normaliser_communes_referentiel(tibble::tibble(com_code = "1")),
               "sf")
})

# normaliser_korrigo_gtfs --------------------------------------------------------
test_that("normaliser_korrigo_gtfs : le registre des réseaux (agency.txt)", {
  brut <- tibble::tibble(
    agency_id = c("STAR", "QUB", "BIBUS"),
    agency_name = c("STAR (Rennes Métropole)", "QUB (Quimper urbain)",
                    "Bibus (Brest Métropole)"),
    agency_url = c("a", "b", "c")
  )

  table <- normaliser_korrigo_gtfs(brut)

  expect_named(table, c("agency_id", "agency_name"))
  expect_equal(nrow(table), 3)
  expect_true(!is.unsorted(table$agency_id))
})

# fixture_communes_spatiale -----------------------------------------------------
# Le FIXTURE SPATIAL SYNTHÉTIQUE du calcul d'offre TC (la décision de distance
# testée à l'unité, sans les 24 380 arrêts réels) : trois communes carrées en
# WGS84 autour de (lon -1, lat 48) — une grande commune (22001, ~0.02° de
# côté ≈ 1,5 km × 2,2 km), une commune minuscule (22002, ~75 m × 110 m), une
# commune lointaine (22003, ~90 km à l'ouest) — et les arrêts qui les
# servent. Les valeurs attendues sont des rapports d'aire calculés à la main
# (une tolérance absorbe la distorsion de la reprojection 4326 → Lambert-93).
fixture_communes_spatiale <- function() {
  carre <- function(lon0, lat0, dlon, dlat) {
    sf::st_sfc(sf::st_polygon(list(rbind(
      c(lon0, lat0), c(lon0 + dlon, lat0), c(lon0 + dlon, lat0 + dlat),
      c(lon0, lat0 + dlat), c(lon0, lat0)))), crs = 4326)
  }
  sf::st_sf(
    com_code = c("22001", "22002", "22003"),
    geometry = c(
      carre(-1.02, 47.99, 0.02, 0.02),     # ~1 490 m × 2 226 m
      carre(-1.0105, 47.9995, 0.001, 0.001),  # ~74 m × 111 m
      carre(-2.00, 48.00, 0.01, 0.01)      # loin, aucun arrêt
    )
  )
}

fixture_arrets_spatiale <- function() {
  tibble::tibble(
    stop_id = c("AR1", "AR2", "AR3"),
    stop_lat = c(48.00, 48.00, 47.99),
    stop_lon = c(-1.01, -1.01, -1.02)
  )
}

test_that("calculer_part_proches_arret_communes : la part à 500 m d'un arrêt (la décision de build)", {
  skip_if_not(requireNamespace("sf", quietly = TRUE),
              "sf est requis pour le calcul spatial de l'offre TC.")

  tc <- calculer_part_proches_arret_communes(fixture_arrets_spatiale(),
                                             fixture_communes_spatiale())

  # la forme : une ligne par commune du référentiel, la part dans [0, 1]
  expect_named(tc, c("commune", "part_proche"))
  expect_setequal(tc$commune, c("22001", "22002", "22003"))

  # 22002 (la commune minuscule, ~74 m × 111 m, entièrement dans le tampon de
  # 500 m de l'arrêt central) : couverte à 100 % — exactement 1, la commune
  # est toute petite devant le disque de 500 m
  expect_equal(tc$part_proche[tc$commune == "22002"], 1)
  # 22003 (aucun arrêt à moins de 500 m) : 0 — exactement
  expect_equal(tc$part_proche[tc$commune == "22003"], 0)
  # 22001 (la grande commune) : l'arrêt central couvre π×500² ≈ 785 400 m²
  # sur ~3,3 km² (~0,237) et l'arrêt du coin ajoute son quart de disque
  # (~0,059) — la part réelle ~0,296, jamais un doublon (les deux arrêts
  # superposés du centre ne comptent qu'une fois)
  v <- tc$part_proche[tc$commune == "22001"]
  expect_true(v > 0.25 && v < 0.35)
  # la somme des parts ne dépasse jamais la commune (l'union des tampons,
  # jamais l'addition)
  expect_true(all(tc$part_proche <= 1))

  # déterministe : deux appels produisent la même table (et s2 est restauré)
  avant <- sf::sf_use_s2()
  tc2 <- calculer_part_proches_arret_communes(fixture_arrets_spatiale(),
                                              fixture_communes_spatiale())
  expect_identical(tc, tc2)
  expect_identical(sf::sf_use_s2(), avant)
})

test_that("calculer_part_proches_arret_communes : un input corrompu s'arrête bruyamment", {
  skip_if_not(requireNamespace("sf", quietly = TRUE),
              "sf est requis pour le calcul spatial de l'offre TC.")

  # un tableau d'arrêts sans coordonnées est refusé
  expect_error(
    calculer_part_proches_arret_communes(
      tibble::tibble(stop_id = "x"), fixture_communes_spatiale()),
    "stop_lat"
  )
})

# calculer_bornes_communes -------------------------------------------------------
test_that("calculer_bornes_communes : les stations distinctes par commune du référentiel", {
  referentiel <- sf::st_sf(com_code = c("29011", "22001", "35238"),
                           geometry = sf::st_sfc(
                             sf::st_point(c(-4.5, 48.4)),
                             sf::st_point(c(-2.7, 48.4)),
                             sf::st_point(c(-1.7, 48.1)), crs = 4326))
  bornes <- tibble::tibble(
    code_insee_commune = c("29011", "29011", "29011", "22001", "35238",
                           NA, "22100", "99999"),
    id_station_itinerance = c("FR1", "FR1", "FR2", "FR3", "FR4", "FR5",
                              "FR6", "FR7")
  )

  b <- calculer_bornes_communes(bornes, referentiel)

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
# Le fixture d'agrégation : 4 communes sur 2 EPCIs / 2 départements, les poids
# (nb_buildings), et les trois tables communales du sous-bloc. Les valeurs
# attendues sont calculées à la main — jamais une moyenne de valeurs.
test_that("agreger_offre_territoires : chaque indicateur agrégé par SA règle", {
  base <- tibble::tribble(
    ~CODGEO, ~EPCI, ~DEP,
    "22001", "200000001", "22",
    "22002", "200000001", "22",
    "29001", "200000002", "29",
    "29002", NA, "29"   # la commune sans EPCI (le fix « Sans objet » #131)
  )
  poids <- tibble::tribble(
    ~commune, ~nb_buildings,
    "22001", 100, "22002", 300, "29001", 200, "29002", 400
  )
  offre_tc <- tibble::tribble(
    ~commune, ~part_proche,
    "22001", 0.5, "22002", 0.8, "29001", 0.2, "29002", 0.6
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

  agg <- agreger_offre_territoires(offre_tc, bornes, velo, poids, base)

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
test_that("INDICATEURS_MOBILITE : les quatre clés du payload, chacune estampillée de SA source de référence", {
  ind <- INDICATEURS_MOBILITE

  # la « Taille » (le tracer bullet) + les trois clés du sous-bloc « L'offre
  # de mobilité alternative » (issue #140), chacune à une ligne par territoire
  expect_equal(nrow(ind), 4L)
  expect_setequal(ind$key, c("nb_buildings", "offre_tc", "bornes_recharge",
                             "places_stationnement_velo_1000"))
  expect_true(all(ind$multiplicite == 1L))

  # chaque clé porte SA source de référence (la règle du CONTEXT « Reference
  # source » — la source qui contribue le composant signature, jamais un
  # tampon de thème) : le snapshot pour la Taille, les ARRÊTS pour l'offre TC
  # (le vintage affiché est celui de la couche d'arrêts), le fichier IRVE
  # pour les bornes, le hub pour le stationnement vélo
  expect_equal(ind$source_reference[ind$key == "nb_buildings"], "mobilite_snapshot")
  expect_equal(ind$source_reference[ind$key == "offre_tc"], "mobibreizh-stops")
  expect_equal(ind$source_reference[ind$key == "bornes_recharge"], "bornes-recharges")
  expect_equal(ind$source_reference[ind$key == "places_stationnement_velo_1000"],
               "stationnement-velo")
  # la table déclarative liste les sources qui nourrissent chaque clé (la
  # matière de la Méthodes) : l'offre TC est portée par les trois sources du
  # fragment Korrigo
  expect_equal(ind$sources[ind$key == "offre_tc"][[1]],
               c("korrigo", "mobibreizh-stops", "communes-france"))
})

# construire_indicateurs_mobilite -------------------------------------------------
test_that("construire_indicateurs_mobilite : les quatre clés alignées sur la référence, estampillées", {
  # la forme des artefacts (la table agrégée + les communes) — le fixture mini
  base <- base_epci_mini_analytique()
  poids <- tibble::tribble(
    ~commune, ~nb_buildings,
    "22001", 100, "22002", 300, "29001", 200, "29002", 400
  )
  territoires <- construire_territoires_mobilite(
    base, list(mobilite_communes = poids)
  )
  offre <- tibble::tribble(
    ~code, ~key, ~value,
    "22001", "offre_tc", 0.5,
    "200000001", "offre_tc", 0.725,
    "53", "offre_tc", 0.6,
    "22001", "bornes_recharge", 3,
    "200000001", "bornes_recharge", 3,
    "53", "bornes_recharge", 5,
    "22001", "places_stationnement_velo_1000", 30,
    "200000001", "places_stationnement_velo_1000", 30,
    "53", "places_stationnement_velo_1000", 28
  )
  analytiques <- list(
    nb_buildings_territoires = agreger_nb_buildings_territoires(poids, base),
    offre_territoires = offre
  )

  ind <- construire_indicateurs_mobilite(analytiques, territoires,
                                         vintages_mobilite())

  # une ligne par (territoire × clé) — 1 268 territoires × 4 clés, ALIGNÉS
  # sur la référence (un territoire sans donnée porte NA, jamais une ligne
  # manquante)
  expect_equal(nrow(ind), nrow(territoires) * 4)
  expect_setequal(unique(ind$key), c("nb_buildings", "offre_tc",
                                     "bornes_recharge",
                                     "places_stationnement_velo_1000"))
  expect_true(all(c("rang_epci", "rang_dep", "rang_reg") %in% names(ind)))
  # la valeur communale telle quelle, les rangs calculés par la machinerie
  # partagée, et l'ESTAMPILLE de chaque clé = le vintage de SA source
  v <- function(code, key) ind$value[ind$territoire == code & ind$key == key]
  expect_equal(v("22001", "offre_tc"), 0.5)
  expect_equal(v("22001", "bornes_recharge"), 3)
  vintages <- vintages_mobilite()
  for (i in seq_len(nrow(INDICATEURS_MOBILITE))) {
    cle <- INDICATEURS_MOBILITE$key[i]
    ref <- INDICATEURS_MOBILITE$source_reference[i]
    tampon <- vintages[vintages$id == ref, ]
    lignes <- ind[ind$key == cle & !is.na(ind$value), ]
    expect_true(all(lignes$vintage_source == tampon$source), info = cle)
    expect_true(all(lignes$vintage_version == tampon$version), info = cle)
  }
  # un territoire sans donnée analytique porte NA — jamais une ligne manquante
  # (l'EPCI 200000002 n'a aucune ligne dans le fixture d'offre)
  expect_true(all(is.na(ind$value[ind$territoire == "200000002" &
                                    ind$key == "offre_tc"])))
  expect_equal(nrow(ind[ind$territoire == "200000002", ]), 4)
})

# validations_mobilite -------------------------------------------------------------
test_that("validations_mobilite : les valeurs du sous-bloc sont gardées", {
  payload_ok <- list(indicateurs = tibble::tibble(
    key = c("nb_buildings", "offre_tc", "bornes_recharge",
            "places_stationnement_velo_1000"),
    value = c(100, 0.5, 3, 30)
  ))
  for (val in validations_mobilite) expect_silent(val(payload_ok))

  # une part d'offre TC hors [0, 1] est un payload invalide
  mauvais <- payload_ok
  mauvais$indicateurs$value[mauvais$indicateurs$key == "offre_tc"] <- 1.5
  expect_error(validations_mobilite[[2]](mauvais), "hors \\[0, 1\\]")

  # un compte de bornes non entier est un payload invalide
  mauvais <- payload_ok
  mauvais$indicateurs$value[mauvais$indicateurs$key == "bornes_recharge"] <- 2.5
  expect_error(validations_mobilite[[3]](mauvais), "entier")

  # un taux de stationnement vélo négatif est un payload invalide
  mauvais <- payload_ok
  mauvais$indicateurs$value[
    mauvais$indicateurs$key == "places_stationnement_velo_1000"] <- -1
  expect_error(validations_mobilite[[4]](mauvais), "négatif")
})
