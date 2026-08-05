# test-run-pipeline-economie -----------------------------------------------------
# run_pipeline(theme = theme_economie()) — T8 : la publication du payload
# Économie/Emploi (plan economie-analytical-phase, todo 8). Le run complet de
# bout en bout, à étapes mockées : le réseau et les vrais fichiers n'entrent
# jamais dans la boucle de test. Le seam de publication du thème
# (publier_economie, câblé par T8) est RÉEL — ce qui est testé est ce qui
# part : le payload Économie complet (territoires référence, indicateurs avec
# rangs T6 + estampilles T7, histoires avec story_key ADR-0002), les fichiers
# par thème, la référence partagée, les vintages et le rapport de run.
#
# La couture analytique (construire_analytiques_economie — T1→T6) est MOCKÉE :
# les fixtures des tests analytiques (test-analytics-economie-*.R) sont le
# seam d'entrée de la chaîne ; ici on lui substitue des tables classées
# déjà calculées (la forme exacte des artefacts *_rangs.rds) pour verrouiller
# la publication elle-même. lire_epci (la base des EPCI partagée) est mockée —
# la même référence que les tests de rangs. publier_geometrie est mockée —
# jamais de WFS dans la boucle de test.

# statuts du run Économie — une ligne par source du manifeste, dans son ordre
statuts_economie <- function(status = "frais") {
  tibble::tibble(
    id = MANIFEST_ECONOMIE$id,
    mode = MANIFEST_ECONOMIE$mode,
    status = rep(status, nrow(MANIFEST_ECONOMIE))
  )
}

# La base des EPCI du fixture (la forme de lire_epci) — les 4 communes de la
# fixture Démographie (2 EPCIs, 2 départements), la référence que
# squelette_territoires consomme pour bâtir la table des territoires.
base_epci_economie <- tibble::tribble(
  ~CODGEO, ~LIBGEO, ~EPCI, ~LIBEPCI, ~DEP, ~REG,
  "22001", "Commune A1", "200000001", "EPCI X", "22", "53",
  "22002", "Commune D", "200000001", "EPCI X", "22", "53",
  "29001", "Commune B", "200000002", "EPCI Y", "29", "53",
  "29002", "Commune C", "200000002", "EPCI Y", "29", "53"
)

# La couture analytique mockée : la forme exacte de la liste retournée par
# construire_analytiques_economie (les artefacts T6 classés) — 4 communes ×
# 3 activités pour LQ/LQ emploi (une commune dortoir-profond, les autres
# équilibre), le score vert et le chômage en une ligne par commune. Les rangs
# sont des fractions dans [0,1] (la forme de la machinerie partagée).
fixture_analytiques_economie <- function() {
  lq <- tibble::tribble(
    ~commune, ~activity_code, ~activity_label, ~lq, ~n, ~n_c, ~n_a,
    ~rang_epci, ~rang_dep, ~rang_reg,
    "22001", "A", "Activité A", 1.5, 2, 10, 6, 0.5, 0.5, 0.4,
    "22001", "B", "Activité B", 0.5, 3, 10, 8, 0.0, 0.0, 0.0,
    "22001", "C", "Activité C", 1.2, 2, 10, 4, 0.5, 0.5, 0.4,
    "22002", "A", "Activité A", 1.0, 4, 10, 6, 0.5, 0.5, 0.4,
    "22002", "B", "Activité B", 1.2, 5, 10, 8, 0.5, 0.5, 0.4,
    "22002", "C", "Activité C", 0.8, 3, 10, 4, 0.0, 0.0, 0.0,
    "29001", "A", "Activité A", 0.8, 6, 10, 6, 0.5, 0.5, 0.4,
    "29001", "B", "Activité B", 1.8, 7, 10, 8, 0.5, 0.5, 0.4,
    "29001", "C", "Activité C", 1.1, 4, 10, 4, 0.5, 0.5, 0.4,
    "29002", "A", "Activité A", 1.1, 8, 10, 6, 0.5, 0.5, 0.4,
    "29002", "B", "Activité B", 0.9, 9, 10, 8, 0.5, 0.5, 0.4,
    "29002", "C", "Activité C", 1.4, 3, 10, 4, 0.5, 0.5, 0.4
  )
  eco <- tibble::tribble(
    ~commune, ~departement, ~n_etablissements, ~n_eco, ~n_eco_100, ~n_eco_partial,
    ~part_economie_verte, ~rang_epci, ~rang_dep, ~rang_reg,
    "22001", "22", 10, 4, 3, 1, 0.4, 0.5, 0.5, 0.4,
    "22002", "22", 10, 5, 4, 1, 0.5, 0.5, 0.5, 0.4,
    "29001", "29", 10, 6, 5, 1, 0.6, 0.5, 0.5, 0.4,
    "29002", "29", 10, 7, 6, 1, 0.7, 0.5, 0.5, 0.4
  )
  dortoir <- tibble::tribble(
    ~commune, ~departement, ~workplace, ~resident, ~ratio, ~classification,
    "22001", "22", 2, 10, 0.2, "dortoir-profond",
    "22002", "22", 6, 10, 0.6, "equilibre",
    "29001", "29", 8, 10, 0.8, "equilibre",
    "29002", "29", 7, 10, 0.7, "equilibre"
  )
  chomage <- tibble::tribble(
    ~commune, ~departement, ~chomeurs, ~actifs_occupes, ~population_active,
    ~taux_chomage, ~rang_epci, ~rang_dep, ~rang_reg,
    "22001", "22", 2, 8, 10, 0.2, 0.5, 0.5, 0.4,
    "22002", "22", 1, 9, 10, 0.1, 0.0, 0.0, 0.0,
    "29001", "29", 3, 7, 10, 0.3, 0.5, 0.5, 0.4,
    "29002", "29", 4, 6, 10, 0.4, 0.5, 0.5, 0.4
  )
  histoires_lq <- lq %>%
    dplyr::select(commune, activity_code, activity_label, lq) %>%
    dplyr::group_by(commune) %>%
    dplyr::arrange(dplyr::desc(lq), activity_code, .by_group = TRUE) %>%
    dplyr::mutate(rang = dplyr::row_number()) %>%
    dplyr::ungroup() %>%
    dplyr::select(commune, rang, activity_code, activity_label, lq)

  list(
    lq = lq,
    histoires_lq = histoires_lq,
    m = tibble::tibble(commune = character(), activity_code = character(), m = integer()),
    lq_emploi_a88 = lq,
    lq_emploi_a38 = lq,
    eco_activites = eco,
    dortoir = dortoir,
    chomage = chomage
  )
}

test_that("run_pipeline(theme = theme_economie()) : le run Économie complet, de bout en bout", {
  cible <- tempfile("pub-economie-")
  on.exit(unlink(cible, recursive = TRUE))
  cache <- tempfile("cache-economie-")
  dir.create(cache)
  on.exit(unlink(cache, recursive = TRUE))

  # les étapes réseau / fichiers lourds sont mockées ; le seam de publication
  # (publier_economie — T8) est RÉEL : ce qui est testé est ce qui part
  local_mocked_bindings(
    download_sources = function(manifest, cache, mode) statuts_economie(),
    construire_donnees_economie = function(cache) list(
      sirene_snapshot = tibble::tibble(x = 1),
      flores_a38 = tibble::tibble(x = 2),
      flores_a88 = tibble::tibble(x = 3),
      rp_emploi = tibble::tibble(x = 4),
      rp_chomage = tibble::tibble(x = 5)
    ),
    construire_analytiques_economie = function(donnees, base_epci, artefact, sortie) {
      fixture_analytiques_economie()
    },
    lire_epci = function(chemin) base_epci_economie,
    publier_geometrie = function(cible = "public/data", fetch = NULL) invisible(NULL),
    .package = "lusk"
  )

  payload <- run_pipeline(theme = theme_economie(), cache = cache, sortie = cible)

  # le payload complet du thème : les quatre tables du contrat
  expect_named(payload, c("indicateurs", "histoires", "territoires", "apercu"))
  expect_true(all(payload$indicateurs$theme == "economie"))
  # les quatre indicateurs publiés (T1/T2/T3/T5) — les Stories ne sont pas
  # des indicateurs (jamais de clé dortoir, jamais de classification)
  expect_setequal(unique(payload$indicateurs$key),
                  c("lq", "lq_emploi", "eco_activites", "chomage"))
  # les rangs-en-contexte de T6 sont portés par les lignes (fractions [0,1])
  expect_true(all(c("rang_epci", "rang_dep", "rang_reg") %in%
                    names(payload$indicateurs)))
  expect_true(all(is.na(payload$indicateurs$rang_epci) |
                    (payload$indicateurs$rang_epci >= 0 &
                       payload$indicateurs$rang_epci <= 1)))
  # les estampilles T7 : chaque indicateur porte le vintage de SA source de
  # référence — LQ et score vert sur SIRENE, LQ emploi sur Flores A88, chômage
  # sur RP chômage (aucun alignement de dates)
  src_par_cle <- stats::setNames(
    c("sirene_snapshot", "flores_a88", "sirene_snapshot", "rp_chomage"),
    c("lq", "lq_emploi", "eco_activites", "chomage")
  )
  vintages <- vintages_economie()
  for (cle in names(src_par_cle)) {
    attendu <- vintages$source[vintages$id == src_par_cle[[cle]]]
    expect_true(all(payload$indicateurs$vintage_source[
      payload$indicateurs$key == cle] == attendu),
      info = cle)
  }

  # les histoires : une ligne par commune, story_key par ADR-0002 — la
  # commune dortoir-profond porte l'Histoire dortoir (saillance), les autres
  # l'Histoire LQ par défaut ; la classification du Story n'est JAMAIS un
  # indicateur (elle vit dans histoires)
  expect_true(all(payload$histoires$theme == "economie"))
  expect_true(all(c("story_key") %in% names(payload$histoires)))
  expect_equal(
    payload$histoires$story_key[payload$histoires$territoire == "22001"],
    "le-matin-la-commune-se-vide"
  )
  expect_true(all(payload$histoires$story_key[
    payload$histoires$territoire != "22001"] ==
    "ce-que-la-commune-sait-faire"))
  expect_false("classification" %in% unique(payload$indicateurs$key))

  # la référence des territoires : le squelette partagé (communes + EPCIs +
  # départements + région), les noms réels, l'EPCI de chaque commune
  expect_setequal(unique(payload$territoires$type),
                  c("commune", "epci", "departement", "region"))
  expect_equal(
    payload$territoires$nom[payload$territoires$territoire == "22001"],
    "Commune A1"
  )
  expect_equal(
    payload$territoires$epci[payload$territoires$territoire == "22001"],
    "200000001"
  )

  # les fichiers par thème + la référence partagée + vintages + rapport.
  # Issue #116 : l'Aperçu d'un run Économie est vide par design — le fichier
  # partagé apercu n'est NI écrit NI écrasé par un thème sans aperçu (seul
  # Démographie le peuple).
  for (f in c("indicateurs_economie.parquet", "indicateurs_economie.json",
              "histoires_economie.parquet", "histoires_economie.json",
              "territoires.parquet", "territoires.json",
              "vintages.parquet", "run-report.json")) {
    expect_true(file.exists(file.path(cible, f)), info = f)
  }
  expect_false(file.exists(file.path(cible, "apercu.parquet")))
  expect_false(file.exists(file.path(cible, "apercu.json")))

  # le parquet relit exactement le payload publié
  ind <- nanoparquet::read_parquet(file.path(cible, "indicateurs_economie.parquet"))
  expect_equal(nrow(ind), nrow(payload$indicateurs))
  expect_equal(ind$value, payload$indicateurs$value)
  hist <- nanoparquet::read_parquet(file.path(cible, "histoires_economie.parquet"))
  expect_equal(hist$story_key, payload$histoires$story_key)

  # vintages.parquet : une ligne par source du manifeste Économie (les 5)
  vint <- nanoparquet::read_parquet(file.path(cible, "vintages.parquet"))
  expect_equal(nrow(vint), nrow(MANIFEST_ECONOMIE))
  expect_setequal(vint$id, MANIFEST_ECONOMIE$id)

  # le rapport de run : mode full, une ligne par source
  rapport <- jsonlite::fromJSON(file.path(cible, "run-report.json"))
  expect_equal(rapport$mode, "full")
  expect_equal(rapport$statuts$id, MANIFEST_ECONOMIE$id)
})

test_that("un re-run Économie écrase sans dupliquer (upsert, idempotence)", {
  cible <- tempfile("pub-economie-")
  on.exit(unlink(cible, recursive = TRUE))
  cache <- tempfile("cache-economie-")
  dir.create(cache)
  on.exit(unlink(cache, recursive = TRUE))

  local_mocked_bindings(
    download_sources = function(manifest, cache, mode) statuts_economie(),
    construire_donnees_economie = function(cache) list(
      sirene_snapshot = tibble::tibble(x = 1),
      flores_a38 = tibble::tibble(x = 2),
      flores_a88 = tibble::tibble(x = 3),
      rp_emploi = tibble::tibble(x = 4),
      rp_chomage = tibble::tibble(x = 5)
    ),
    construire_analytiques_economie = function(donnees, base_epci, artefact, sortie) {
      fixture_analytiques_economie()
    },
    lire_epci = function(chemin) base_epci_economie,
    publier_geometrie = function(cible = "public/data", fetch = NULL) invisible(NULL),
    .package = "lusk"
  )

  run_pipeline(theme = theme_economie(), cache = cache, sortie = cible)
  run_pipeline(theme = theme_economie(), cache = cache, sortie = cible)

  # le payload EST l'état complet : relancer écrase, ne duplique jamais —
  # aucune ligne en double, les comptes du premier run sont conservés
  ind <- nanoparquet::read_parquet(file.path(cible, "indicateurs_economie.parquet"))
  ref <- nanoparquet::read_parquet(file.path(cible, "territoires.parquet"))
  expect_equal(nrow(ind), nrow(fixture_analytiques_economie()$lq) * 2 +
                 nrow(fixture_analytiques_economie()$eco_activites) +
                 nrow(fixture_analytiques_economie()$chomage))
  expect_equal(anyDuplicated(ind[c("territoire", "key", "detail")]), 0L)
  expect_equal(nrow(ref), 4 + 2 + 2 + 1) # communes + EPCIs + départements + région
})

test_that("une dérive du schéma du payload Économie échoue bruyamment", {
  cible <- tempfile("pub-economie-")
  on.exit(unlink(cible, recursive = TRUE))
  cache <- tempfile("cache-economie-")
  dir.create(cache)
  on.exit(unlink(cache, recursive = TRUE))

  # la couture analytique renvoie une table corrompue : une ligne en double
  # dans le chômage (le MÊME territoire deux fois pour la clé multiplicité 1)
  # — la validation générique du payload détecte la dérive de schéma et le
  # run s'arrête FORT, jamais un chiffre faux publié silencieusement
  local_mocked_bindings(
    download_sources = function(manifest, cache, mode) statuts_economie(),
    construire_donnees_economie = function(cache) list(
      sirene_snapshot = tibble::tibble(x = 1),
      flores_a38 = tibble::tibble(x = 2),
      flores_a88 = tibble::tibble(x = 3),
      rp_emploi = tibble::tibble(x = 4),
      rp_chomage = tibble::tibble(x = 5)
    ),
    construire_analytiques_economie = function(donnees, base_epci, artefact, sortie) {
      fx <- fixture_analytiques_economie()
      fx$chomage <- rbind(fx$chomage, fx$chomage[1, ])
      fx
    },
    lire_epci = function(chemin) base_epci_economie,
    publier_geometrie = function(cible = "public/data", fetch = NULL) invisible(NULL),
    .package = "lusk"
  )

  # le doublon casse la multiplicité déclarée (chômage : une ligne par
  # territoire) — validate_payload l'attrape bruyamment
  expect_error(
    run_pipeline(theme = theme_economie(), cache = cache, sortie = cible),
    "double"
  )
})
