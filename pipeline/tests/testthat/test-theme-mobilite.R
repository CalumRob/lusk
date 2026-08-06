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

test_that("MANIFEST_MOBILITE : la source portée, une ligne, les 11 colonnes standard", {
  m <- MANIFEST_MOBILITE

  # le manifeste est un tibble d'UNE ligne — le snapshot porté est l'unique
  # source du thème (jamais un doublon de cache)
  expect_s3_class(m, "tbl_df")
  expect_equal(nrow(m), 1L)
  expect_equal(nrow(m), length(unique(m$id)))

  # les 11 colonnes standard du manifeste (SIRENE / Flores / RP / Habitat)
  expect_true(all(c("id", "source", "url", "fichier", "vintage",
                    "date_reference", "date_publication", "licence",
                    "note", "mode", "type") %in% names(m)))

  # chaque source garde SON vintage : aucune colonne d'alignement de date
  expect_false(any(grepl("align", tolower(names(m)))))

  # l'identité de la source : LE fichier de production porté, jamais l'artefact
  # non-production (qui montrait des deltas vélo négatifs)
  expect_equal(m$id, "mobilite_snapshot")
  expect_equal(m$fichier, "bretagne_mobility_super_dashboard_gravity.csv")
  expect_false(grepl("indicateurs_summarized_communes", m$fichier))
  expect_equal(m$mode, "manuel")
  expect_equal(m$type, "fichier")
  expect_equal(m$licence, "odbl")
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

test_that("vintages_mobilite : la source porte SA référence (l'instantané) et SA publication (le portage)", {
  v <- vintages_mobilite()

  expect_equal(nrow(v), 1L)
  expect_named(v, c("id", "source", "version", "licence",
                    "date_reference", "date_publication"))
  expect_equal(v$id, "mobilite_snapshot")
  expect_equal(v$licence, "odbl")

  # la date de RÉFÉRENCE est la date d'instantané de l'analyse (le fichier de
  # production a été figé le 2026-02-28 — les données de référence BPE 2024 ·
  # OSM 02-2026 · BDNB 2025-07) ; la date de PUBLICATION est la date du portage
  # dans le pipeline (2026-08-06) — jamais alignées, chacune sa vérité
  expect_equal(v$version, "2026-02")
  expect_equal(v$date_reference, "2026-02-28")
  expect_equal(v$date_publication, "2026-08-06")
  expect_true(as.Date(v$date_reference) <= as.Date(v$date_publication))
})

test_that("verifier_contrat_mobilite_snapshot : le manifeste épingle le fichier de production", {
  # le manifeste réel passe sa propre validation de contrat
  expect_true(verifier_contrat_mobilite_snapshot(MANIFEST_MOBILITE))

  # l'artefact NON-production (les deltas vélo négatifs) est refusé bruyamment
  # par le contrat — la garde du « jamais cette base » du PRD #136
  defectueux <- MANIFEST_MOBILITE
  defectueux$fichier <- "indicateurs_summarized_communes.csv"
  expect_error(verifier_contrat_mobilite_snapshot(defectueux),
               "bretagne_mobility_super_dashboard_gravity")

  # un id hors contrat est refusé
  defectueux <- MANIFEST_MOBILITE
  defectueux$id <- "autre_source"
  expect_error(verifier_contrat_mobilite_snapshot(defectueux), "mobilite_snapshot")

  # une date de publication antérieure à la référence est refusée
  defectueux <- MANIFEST_MOBILITE
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

test_that("construire_donnees_mobilite : assemble la table normalisée du snapshot porté", {
  # la couture : le lecteur et le normaliseur MOCKÉS — le seam d'entrée du run
  # (jamais de fichier réel dans la boucle de test unitaire)
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
    .package = "lusk"
  )

  donnees <- construire_donnees_mobilite(cache = "cache-test")

  # la liste nommée des tables normalisées, dans l'ordre du contrat
  expect_named(donnees, "mobilite_snapshot")
  expect_identical(donnees$mobilite_snapshot, table_snapshot)
  # le lecteur reçoit le chemin du fichier porté dans le cache
  expect_equal(appels$chemin,
               file.path("cache-test", "bretagne_mobility_super_dashboard_gravity.csv"))
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

test_that("construire_analytiques_mobilite : le seam de calcul lie les tables du payload", {
  donnees <- list(
    mobilite_snapshot = tibble::tibble(commune = "29011", nb_buildings = 1113)
  )
  base_epci <- tibble::tibble(CODGEO = "29011", EPCI = "200000001", DEP = "29")
  suivi <- new.env()
  suivi$appels <- 0L

  local_mocked_bindings(
    agreger_nb_buildings_territoires = function(communes, base_epci) {
      suivi$appels <- suivi$appels + 1L
      tibble::tibble(code = "29011", value = 1113)
    },
    .package = "lusk"
  )

  res <- construire_analytiques_mobilite(donnees, base_epci,
                                         sortie = sortie_test <- tempfile("mob-sortie-"))
  on.exit(unlink(sortie_test, recursive = TRUE), add = TRUE)

  # les tables analytiques exposées : la table communale (la matière du poids)
  # et l'agrégation par niveau (la matière de l'indicateur)
  expect_named(res, c("mobilite_communes", "nb_buildings_territoires"))
  expect_equal(res$mobilite_communes$nb_buildings, 1113)
  expect_equal(res$nb_buildings_territoires$value, 1113)
  expect_equal(suivi$appels, 1L)
})

test_that("publier_mobilite : le seam de publication est câblé (plus un stub)", {
  # un appel sans données échoue pour une raison de DONNÉES (cache absent),
  # jamais sur un message de stub
  expect_false(grepl("stub", tryCatch(
    publier_mobilite(list()),
    error = function(e) conditionMessage(e)
  )))
})
