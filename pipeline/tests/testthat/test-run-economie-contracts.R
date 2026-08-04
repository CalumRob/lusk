# test-run-economie-contracts ---------------------------------------------------
# Le test de bout en bout de la phase source-table du thème Économie/Emploi
# (plan economie-pipeline-contracts, todo 8) : le run complet « télécharger →
# extraire → normaliser → profiler » des TROIS familles de sources — SIRENE
# (sirene_snapshot), Flores (flores_a38 + flores_a88) et RP Emploi (rp_emploi)
# — avec la couture de téléchargement MOCKÉE (les fixtures des normalisateurs
# sont le seam d'entrée, jamais le réseau : ni SIRENE 2,7 Go, ni RP 988 Mo),
# la référence EPCI partagée MOCKÉE (lire_epci — la base des EPCI est une
# ressource transversale des thèmes, pas une source Économie), et les builders
# + le profilage RÉELS.
#
# Ce que le run source-table doit prouver (acceptance du todo 8) :
#   - les QUATRE tables du contrat sont produites et persistées sous
#     data/processed/economie/ avec leurs comptes connus (6 lignes SIRENE,
#     37 A38, 22 A88, 12 RP — les comptes verrouillés par le profilage, todo 7) ;
#   - la preuve profilée sort (un <id>-profil.json par table) ;
#   - AUCUN artefact de fiche n'est produit : publish() n'est jamais appelé,
#     aucun fichier indicateurs/histoires/territoires/apercu/vintages/rapport
#     de run ne sort — le profil vit sous pipeline/data/ (gitignoré) ;
#   - un SECOND run ne duplique aucune ligne (idempotence — relancer produit
#     des tables et des preuves IDENTIQUES).
# Le chemin d'échec est aussi verrouillé : une source invalide arrête le run
# avant la preuve profilée (jamais de succès partiel silencieux).
# Aucun appel réseau dans la boucle de test (docs/architecture.md §Testing).

# Les fixtures des normalisateurs — le seam d'entrée du run mocké --------------
fixture_contrats <- function(nom) {
  testthat::test_path("fixtures", nom)
}

# LE référentiel partagé : la base EPCI bretonne (lire_epci) — la MÊME
# référence que les joints des normalisateurs et du profilage (les quatre
# communes des fixtures, une par département breton ; 44001 en est absente).
reference_contrats <- tibble::tribble(
  ~CODGEO, ~LIBGEO, ~EPCI, ~LIBEPCI, ~DEP, ~REG,
  "22001", "Commune A1", "200000001", "EPCI X", "22", "53",
  "29001", "Commune B", "200000002", "EPCI Y", "29", "53",
  "35001", "Commune C", "200000003", "EPCI Z", "35", "53",
  "56001", "Commune D", "200000004", "EPCI W", "56", "53"
)

# les dictionnaires de libellés natifs du produit (les mêmes que les tests des
# normalisateurs) — le run réel les lit dans les fichiers de métadonnées du zip
dictionnaire_a38_contrats <- c(
  "CA" = "Fabrication de denrées alimentaires, de boissons et de produits à base de tabac",
  "GZ" = "Commerce ; réparation d'automobiles et de motocycles",
  "DZ" = "Production et distribution d'électricité, de gaz, de vapeur et d'air conditionné",
  "_T" = "Total"
)

dictionnaire_a88_contrats <- c(
  "11" = "Fabrication de boissons",
  "22" = "Fabrication de produits en caoutchouc et en plastique",
  "45" = "Commerce et réparation d'automobiles et de motocycles",
  "56" = "Restauration",
  "70" = "Activités des sièges sociaux ; conseil de gestion",
  "78" = "Activités liées à l'emploi",
  "96" = "Autres services personnels",
  "_T" = "Total"
)

# fabriquer_telechargement_contrats ---------------------------------------------
# La couture de téléchargement MOCKÉE (le seam, comme test-run-pipeline-habitat.R
# mocke download_sources) : au lieu du réseau, elle écrit dans le cache brut les
# zips construits depuis les fixtures — exactement les noms de cache que les
# builders attendent de décompresser (les noms des manifestes). Un fragment de
# manifeste Économie en entrée (la convention des fragments), les zips de SES
# sources en sortie. `corrompre` : l'id d'une source dont le « téléchargement »
# est volontairement invalide (fichier non-zip) — le chemin d'échec du run.
fabriquer_telechargement_contrats <- function(corrompre = NULL) {
  function(manifest, cache, mode) {
    if (!dir.exists(cache)) dir.create(cache, recursive = TRUE)
    for (i in seq_len(nrow(manifest))) {
      id <- manifest$id[i]
      cible <- file.path(cache, manifest$fichier[i])

      if (identical(id, corrompre)) {
        # un « téléchargement » invalide : un fichier qui n'est pas un zip
        writeLines("téléchargement invalide (simulé)", cible)
        next
      }

      d <- tempfile("zip-contrats-")
      dir.create(d)
      if (id == "sirene_snapshot") {
        snapshot <- readr::read_csv(
          fixture_contrats("sirene-snapshot-fixture.csv"),
          col_types = readr::cols(.default = readr::col_character()),
          show_col_types = FALSE
        )
        # le fichier réel est un CSV « ; » (dessin de fichier INSEE v311) — la
        # fixture est lue en CSV « , » puis réécrite dans le format du réel
        readr::write_delim(
          snapshot, file.path(d, "StockEtablissement_utf8.csv"), delim = ";"
        )
      } else if (id == "flores_a38") {
        file.copy(fixture_contrats("flores-a38-fixture.csv"),
                  file.path(d, "DS_FLORES_A38_2024_data.csv"))
        readr::write_delim(
          tibble::tibble(COD_VAR = "ACTIVITY",
                         COD_MOD = names(dictionnaire_a38_contrats),
                         LIB_MOD = unname(dictionnaire_a38_contrats)),
          file.path(d, "DS_FLORES_A38_2024_metadata.csv"), delim = ";"
        )
      } else if (id == "flores_a88") {
        file.copy(fixture_contrats("flores-a88-fixture.csv"),
                  file.path(d, "DS_FLORES_A88_2024_data.csv"))
        readr::write_delim(
          tibble::tibble(COD_VAR = "ACTIVITY",
                         COD_MOD = names(dictionnaire_a88_contrats),
                         LIB_MOD = unname(dictionnaire_a88_contrats)),
          file.path(d, "DS_FLORES_A88_2024_metadata.csv"), delim = ";"
        )
      } else if (id == "rp_emploi") {
        file.copy(
          fixture_contrats("rp-emploi-fixture.csv"),
          file.path(d, "DS_RP_TD_ACTIVITE_PCSACTIVITY_COMP_2023_data.csv")
        )
      } else {
        stop("Fixture de téléchargement inconnue : ", id, call. = FALSE)
      }

      utils::zip(cible, list.files(d, full.names = TRUE), flags = "-jq")
    }
    tibble::tibble(id = manifest$id, mode = manifest$mode, status = "frais")
  }
}

# executer_phase_sources --------------------------------------------------------
# LE run source-table, dans la forme que l'orchestration future aura : les
# trois fragments de manifeste passent par la couture de téléchargement (mockée
# ici), les trois builders transforment le cache brut en tables normalisées
# (extraction + normalisation + persistance RÉELLES sous `sortie`), le
# profilage produit la preuve (les <id>-profil.json sous sortie/profil/).
# Retour : les quatre listes {table, exclusions} + le rapport profilé + la
# sortie — tout ce que le contrat doit vérifier.
executer_phase_sources <- function(cache, sortie) {
  download_sources(MANIFEST_ECONOMIE_SIRENE, cache = cache, mode = "full")
  download_sources(MANIFEST_ECONOMIE_FLORES, cache = cache, mode = "full")
  download_sources(MANIFEST_ECONOMIE_RP, cache = cache, mode = "full")

  sirene <- construire_sirene_normalise(
    cache = cache, sortie = file.path(sortie, "sirene_snapshot.rds")
  )
  flores <- construire_donnees_brut_flores(cache = cache, sortie = sortie)
  rp <- construire_donnees_brut_emploi_rp(
    cache = cache, sortie = file.path(sortie, "rp_emploi.rds")
  )

  tables <- list(
    sirene_snapshot = list(
      table = sirene,
      exclusions = readRDS(file.path(sortie, "sirene_snapshot_exclusions.rds"))
    ),
    flores_a38 = flores$flores_a38,
    flores_a88 = flores$flores_a88,
    rp_emploi = rp
  )

  profil <- profil_economie(tables, reference_contrats,
                            cible = file.path(sortie, "profil"))
  list(tables = tables, profil = profil, sortie = sortie)
}

# Les comptes du contrat (verrouillés par le profilage, todo 7) -----------------
lignes_attendu <- c(
  sirene_snapshot = 6, flores_a38 = 37, flores_a88 = 22, rp_emploi = 12
)

test_that("la phase source-table de bout en bout : quatre tables + preuves profilées, aucun artefact de fiche", {
  cache <- tempfile("cache-eco-")
  sortie <- tempfile("processed-eco-")
  on.exit(unlink(c(cache, sortie), recursive = TRUE), add = TRUE)

  local_mocked_bindings(
    download_sources = fabriquer_telechargement_contrats(),
    lire_epci = function(chemin) reference_contrats,
    # la garde du contrat : publish() est interdit pendant la phase source-table
    publish = function(...) {
      stop("publish ne doit jamais être appelé pendant la phase source-table.", call. = FALSE)
    },
    .package = "lusk"
  )

  res <- executer_phase_sources(cache, sortie)

  # les quatre tables du contrat, chacune avec SES comptes (jamais fusionnées)
  expect_named(res$tables, c("sirene_snapshot", "flores_a38", "flores_a88",
                             "rp_emploi"))
  for (id in names(lignes_attendu)) {
    expect_equal(nrow(res$tables[[id]]$table), unname(lignes_attendu[[id]]),
                 info = id)
  }
  # la preuve profilée : une section par table, dans l'ordre du contrat
  expect_named(res$profil, c("sirene_snapshot", "flores_a38", "flores_a88",
                             "rp_emploi"))

  # la sortie est EXACTEMENT l'artefact source-table : les quatre .rds + le
  # rapport d'exclusions SIRENE + un <id>-profil.json par table — rien d'autre
  attendus <- c(
    "flores_a38.rds", "flores_a88.rds", "rp_emploi.rds",
    "sirene_snapshot.rds", "sirene_snapshot_exclusions.rds",
    "profil/flores_a38-profil.json", "profil/flores_a88-profil.json",
    "profil/rp_emploi-profil.json", "profil/sirene_snapshot-profil.json"
  )
  expect_setequal(list.files(sortie, recursive = TRUE), attendus)

  # AUCUN artefact de fiche publique : ni indicateurs, ni histoires, ni
  # territoires, ni aperçu, ni vintages, ni rapport de run — la preuve vit
  # sous data/processed/ (gitignoré), pas sous public/
  expect_false(any(grepl(
    "indicateurs|histoires|territoires|apercu|vintages|run-report",
    list.files(sortie, recursive = TRUE)
  )))

  # les tables persistées relisent les comptes du contrat
  expect_equal(nrow(readRDS(file.path(sortie, "sirene_snapshot.rds"))),
               lignes_attendu[["sirene_snapshot"]])
  expect_equal(nrow(readRDS(file.path(sortie, "flores_a38.rds"))),
               lignes_attendu[["flores_a38"]])
  expect_equal(nrow(readRDS(file.path(sortie, "flores_a88.rds"))),
               lignes_attendu[["flores_a88"]])
  expect_equal(nrow(readRDS(file.path(sortie, "rp_emploi.rds"))),
               lignes_attendu[["rp_emploi"]])
})

test_that("un second run ne duplique aucune ligne (idempotence)", {
  cache <- tempfile("cache-eco-")
  sortie <- tempfile("processed-eco-")
  on.exit(unlink(c(cache, sortie), recursive = TRUE), add = TRUE)

  local_mocked_bindings(
    download_sources = fabriquer_telechargement_contrats(),
    lire_epci = function(chemin) reference_contrats,
    .package = "lusk"
  )

  res1 <- executer_phase_sources(cache, sortie)
  fichiers_apres_premier_run <- list.files(sortie, recursive = TRUE)
  res2 <- executer_phase_sources(cache, sortie)

  # relancer produit les MÊMES tables — aucune ligne en plus, aucune en moins :
  # l'idempotence est la preuve que le run est un état complet, pas un append
  for (id in names(lignes_attendu)) {
    expect_identical(res1$tables[[id]]$table, res2$tables[[id]]$table, info = id)
  }
  # la preuve profilée est octet-pour-octet identique (déterminisme du profilage)
  expect_identical(res1$profil, res2$profil)
  # et les fichiers persistés restent exactement les mêmes après le re-run —
  # ni doublon, ni artefact nouveau
  expect_identical(list.files(sortie, recursive = TRUE), fichiers_apres_premier_run)
  expect_equal(nrow(readRDS(file.path(sortie, "sirene_snapshot.rds"))),
               lignes_attendu[["sirene_snapshot"]])
})

test_that("une source invalide arrête le run avant la preuve profilée (pas de succès partiel)", {
  cache <- tempfile("cache-eco-")
  sortie <- tempfile("processed-eco-")
  on.exit(unlink(c(cache, sortie), recursive = TRUE), add = TRUE)

  local_mocked_bindings(
    # le « téléchargement » RP produit un fichier invalide (non-zip)
    download_sources = fabriquer_telechargement_contrats(corrompre = "rp_emploi"),
    lire_epci = function(chemin) reference_contrats,
    .package = "lusk"
  )

  # le run s'arrête bruyamment sur la source invalide...
  expect_error(
    executer_phase_sources(cache, sortie),
    "DS_RP_TD_ACTIVITE_PCSACTIVITY_COMP_2023_data.csv"
  )

  # ...AVANT la preuve profilée : le profilage n'a jamais tourné, aucun
  # <id>-profil.json n'existe — jamais de succès partiel silencieux
  expect_false(dir.exists(file.path(sortie, "profil")))
  expect_false(any(grepl("-profil\\.json", list.files(sortie, recursive = TRUE))))
})
