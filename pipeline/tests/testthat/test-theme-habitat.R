# theme_habitat / manifeste / table des indicateurs / vintages -----------------
# Le descripteur du thème Habitat (issue #17) : la même forme de contrat que
# theme_demographie() — tout ce que la machinerie partagée doit savoir pour
# faire tourner Habitat sans jamais nommer le thème.

test_that("MANIFEST_HABITAT : les trois fragments + la base des EPCI partagée", {
  m <- MANIFEST_HABITAT

  # le manifeste du thème concatène les trois fragments (#14/#15/#16) et la
  # source « epci » partagée (le référentiel commune -> EPCI -> département)
  expect_setequal(m$id, c("epci", "logements", MANIFEST_HABITAT_DVF$id,
                          MANIFEST_HABITAT_DPE$id))
  # une ligne par source, jamais de doublon
  expect_equal(nrow(m), length(unique(m$id)))
  # la source epci réutilise l'id et l'URL du manifeste Démographie (le cache
  # idempotent évite le re-téléchargement)
  ligne_epci <- m[m$id == "epci", ]
  ref_epci <- MANIFEST_DEMOGRAPHIE[MANIFEST_DEMOGRAPHIE$id == "epci", ]
  expect_equal(ligne_epci$url, ref_epci$url)
  expect_equal(ligne_epci$fichier, ref_epci$fichier)
  # les types et modes des sources sont portés (fichier/api, cron/manuel)
  expect_true(all(m$type[m$id == "epci"] == "fichier"))
  expect_true(all(m$type[grepl("^dvf_", m$id)] == "fichier"))
  expect_true(all(m$type[grepl("^dpe_", m$id)] == "api"))
  expect_true(all(m$mode[grepl("^dvf_|^dpe_", m$id)] == "manuel"))
  expect_equal(m$mode[m$id == "logements"], "cron")
})

test_that("INDICATEURS_HABITAT : les 5 clés, multiplicité comprise", {
  tab <- INDICATEURS_HABITAT
  expect_named(tab, c("key", "libelle", "sources", "source_reference",
                      "multiplicite"))
  expect_setequal(tab$key, c("mix_logements", "statut_anciennete_taille",
                             "prix_m2", "part_passoires", "distribution_dpe"))
  # 3 catégories ; 3 statuts + 6 anciennetés + 5 tailles ; poolé + 5 années ;
  # scalaire ; 7 étiquettes A-G
  expect_equal(tab$multiplicite[tab$key == "mix_logements"], 3L)
  expect_equal(tab$multiplicite[tab$key == "statut_anciennete_taille"], 14L)
  expect_equal(tab$multiplicite[tab$key == "prix_m2"], 1L + length(ANNEE_DVF))
  expect_equal(tab$multiplicite[tab$key == "part_passoires"], 1L)
  expect_equal(tab$multiplicite[tab$key == "distribution_dpe"], 7L)
})

test_that("INDICATEURS_HABITAT : chaque clé déclare sa source de référence", {
  tab <- INDICATEURS_HABITAT
  # la source de référence est le composant signature : RP pour les deux
  # indicateurs de stock, DVF (le millésime le plus récent de la fenêtre) pour
  # le prix, DPE pour l'énergie
  expect_equal(tab$source_reference[tab$key == "mix_logements"], "logements")
  expect_equal(tab$source_reference[tab$key == "statut_anciennete_taille"],
               "logements")
  expect_equal(tab$source_reference[tab$key == "prix_m2"], "dvf_2025_dep22")
  expect_equal(tab$source_reference[tab$key == "part_passoires"], "dpe_22")
  expect_equal(tab$source_reference[tab$key == "distribution_dpe"], "dpe_22")

  ids_manifest <- MANIFEST_HABITAT$id
  for (i in seq_len(nrow(tab))) {
    # la référence est toujours parmi les sources, et toutes les sources
    # citées existent dans le manifeste
    expect_true(tab$source_reference[i] %in% tab$sources[[i]], info = tab$key[i])
    expect_true(all(tab$sources[[i]] %in% ids_manifest), info = tab$key[i])
  }
})

test_that("theme_habitat : le descripteur porte toutes les pièces du contrat", {
  th <- theme_habitat()
  expect_named(th, c("theme", "manifest", "indicateurs", "vintages",
                     "construire_donnees", "construire_territoires",
                     "construire_indicateurs", "scalaires",
                     "compute_histoires", "validations"))
  expect_equal(th$theme, "habitat")
  expect_identical(th$manifest, MANIFEST_HABITAT)
  expect_identical(th$indicateurs, INDICATEURS_HABITAT)
  # toutes les clés multi-valeurs déclarent un scalaire de classement
  expect_setequal(names(th$scalaires), c("mix_logements",
                                         "statut_anciennete_taille",
                                         "prix_m2", "part_passoires",
                                         "distribution_dpe"))
})

test_that("vintages_habitat : une ligne par source, dates de référence DVF", {
  v <- vintages_habitat()
  expect_equal(nrow(v), nrow(MANIFEST_HABITAT))
  expect_named(v, c("id", "source", "version", "licence",
                    "date_reference", "date_publication"))
  expect_true(all(v$licence == "lov2"))
  # le millésime de la fenêtre DVF porte ses deux dates (référence + livraison)
  expect_equal(v$date_reference[v$id == "dvf_2025_dep22"], "2025-12-31")
  expect_equal(v$date_publication[v$id == "dvf_2025_dep22"], "2026-05-18")
  expect_equal(v$version[v$id == "dvf_2021_dep56"], "2021")
  # RP : millésime annuel 2023
  expect_equal(v$date_reference[v$id == "logements"], "2023-01-01")
  expect_equal(v$date_publication[v$id == "logements"], "2026-06-30")
})

test_that("vintages_habitat : les DPE (base roulante) n'ont pas encore de date de pull", {
  v <- vintages_habitat()
  # base roulante : version = date du pull (écrite sur le cache au pull) — tant
  # que le pull n'a pas eu lieu (le cas des tests), la date est NA : honnête,
  # jamais inventée
  for (id in MANIFEST_HABITAT_DPE$id) {
    expect_true(is.na(v$version[v$id == id]), info = id)
    expect_true(is.na(v$date_publication[v$id == id]), info = id)
  }
})
