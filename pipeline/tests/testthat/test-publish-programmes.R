# test-publish-programmes ------------------------------------------------------
# Le ticket #178 : la publication du payload PARTAGÉ `programmes` — le fichier
# programmes.json (les DEUX tables de l'ADR-0013 : les lignes d'adhésion du
# ticket #175 et les agrégats de subventions du ticket #176) + les parquets
# canoniques PAR TABLE, écrits par le seam de publication du thème
# (publier_programmes) vers la cible que l'app lit — le contrat « 404 = table
# absente », le précédent apercu #116.
#
# Le contrat verrouillé ici (acceptance #178) :
#   - un run à tables PEUPLÉES écrit les fichiers partagés ; un run à tables
#     VIDES n'écrit RIEN et laisse tout fichier existant INTACT (la sentinelle,
#     le même motif que test-publish.R #116) ;
#   - la projection JSON égale le parquet BIT À BIT pour les mêmes tables en
#     mémoire (le contrat de non-dérive, ADR-0004 — verifier_non_derivee) ;
#   - les vintages du module (les CINQ sources ANCT + la source SCDL des
#     subventions, #176) sont FUSIONNÉS dans la table partagée des vintages
#     (upsert par id, issue #124 — jamais l'écrasement last-writer-wins) ;
#   - le run est tracé dans le rapport de run (statuts par source, horodatage)
#     et idempotent sur re-run.
#
# La couture (la même que test-run-pipeline-economie.R) : les étapes réseau et
# fichiers lourds sont mockées (download_sources, construire_donnees_*,
# lire_epci, publier_geometrie) ; le SEAM de publication (publier_programmes)
# et la machinerie partagée (run_pipeline, fusionner_vintages, rapport de run)
# sont RÉELS — ce qui est testé est ce qui part.

# Le référentiel EPCI du fixture (la forme de lire_epci : CODGEO/LIBGEO/EPCI/
# LIBEPCI/DEP/REG) : 7 communes, 2 EPCIs, 2 départements.
base_epci_programmes_pub <- function() {
  tibble::tribble(
    ~CODGEO, ~LIBGEO, ~EPCI, ~LIBEPCI, ~DEP, ~REG,
    "22001", "Commune A1", "200000001", "EPCI X", "22", "53",
    "22002", "Commune D", "200000001", "EPCI X", "22", "53",
    "22003", "Commune E", "200000001", "EPCI X", "22", "53",
    "22004", "Commune G", "200000001", "EPCI X", "22", "53",
    "29001", "Commune B", "200000002", "EPCI Y", "29", "53",
    "29002", "Commune C", "200000002", "EPCI Y", "29", "53",
    "29003", "Commune F", "200000002", "EPCI Y", "29", "53"
  )
}

# donnees_programmes_pub -------------------------------------------------------
# Les tables normalisées du fixture (la forme que construire_donnees_programmes
# assemble) : ACV/PVD (code_commune, nom_commune, id), CRTE (id_crte, lib_crte,
# type_grp_crte, nature_juridique, siren_epci), TI (id_ti, lib_ti, siren_epci,
# nom_epci), ORT (code_commune, statut, actualisation). Le statut ORT :
#   22001 (ACV) « Signée » ; 29002 (ACV) « Signée » ; 22002 (PVD) « Terminée » ;
#   29001 (PVD) « Non signée » ; 22003, 22004 (autres) « Signée » ;
#   29003 (autre) « Terminée ». Le payload résultant est VALIDE (le verifier
# l'exige — pas de doublon territoire × sigle : chaque EPCI ne signe qu'UN
# CRTE, la ligne COM ne produit aucune ligne).
donnees_programmes_pub <- function() {
  list(
    acv = tibble::tribble(
      ~code_commune, ~nom_commune, ~id_acv,
      "22001", "Commune A1", "ACV001",
      "29002", "Commune C", "ACV002"
    ),
    pvd = tibble::tribble(
      ~code_commune, ~nom_commune, ~id_pvd,
      "22002", "Commune D", "pvd-53-22-1",
      "29001", "Commune B", "pvd-53-29-1"
    ),
    crte = tibble::tribble(
      ~id_crte, ~lib_crte, ~type_grp_crte, ~nature_juridique, ~siren_epci,
      "crte-53-22-1", "CRTE EPCI X", "mono", "CC", "200000001",
      "crte-53-29-1", "CRTE EPCI Y", "mono", "CA", "200000002",
      "crte-53-29-3", "CRTE à communes seules", "pluri", "COM", "22001"
    ),
    territoires_industrie = tibble::tribble(
      ~id_ti, ~lib_ti, ~siren_epci, ~nom_epci,
      "ti-5301", "Territoire Industriel A", "200000001", "EPCI X",
      "ti-5302", "Territoire Industriel B", "200000002", "EPCI Y"
    ),
    ort = tibble::tribble(
      ~code_commune, ~statut, ~actualisation,
      "22001", "Signée", "2026-02-01",
      "22002", "Terminée", "2026-01-15",
      "29001", "Non signée", "2026-03-01",
      "29002", "Signée", "2026-02-10",
      "22003", "Signée", "2026-02-20",
      "29003", "Terminée", "2025-12-01",
      "22004", "Signée", "2026-04-01"
    )
  )
}

# conventions_subventions_pub ---------------------------------------------------
# Les conventions NORMALISÉES du fixture (la forme que construire_donnees_
# subventions retourne : commune | annee | programme_libl | montant — le seam
# d'ingestion SCDL est testé dans test-subventions.R, ici on lui substitue le
# résultat). Les règles du contrat : l'année complète la plus récente (2025 —
# 2026 est partielle, 2024 est révolue), 22002 porte HUIT domaines (la
# ventilation COMPLÈTE est publiée — le pli d'affichage top-5 + révélation est
# l'affaire de l'app, issue #305), l'île 29155 n'existe pas dans ce référentiel.
conventions_subventions_pub <- function() {
  tibble::tribble(
    ~commune, ~annee, ~programme_libl, ~montant,
    "22001", 2025L, "Développement économique", 10000,
    "22001", 2025L, "Emploi", 5000,
    "22002", 2025L, "Domaine 1", 100,
    "22002", 2025L, "Domaine 2", 90,
    "22002", 2025L, "Domaine 3", 80,
    "22002", 2025L, "Domaine 4", 70,
    "22002", 2025L, "Domaine 5", 60,
    "22002", 2025L, "Domaine 6", 50,
    "22002", 2025L, "Domaine 7", 40,
    "22002", 2025L, "Domaine 8", 30,
    "29002", 2025L, "Agriculture", 30000,
    "29002", 2025L, "Culture", 7000,
    "29003", 2025L, "Emploi", 20000,
    "29001", 2024L, "Emploi", 12000,
    "22001", 2026L, "Emploi", 6000
  )
}

# statuts du run Programmes — une ligne par source du manifeste du thème (les
# CINQ sources ANCT + la source SCDL des subventions, #176), dans son ordre
statuts_programmes_pub <- function(status = "frais") {
  tibble::tibble(
    id = theme_programmes()$manifest$id,
    mode = theme_programmes()$manifest$mode,
    status = rep(status, nrow(theme_programmes()$manifest))
  )
}

# executer_run_programmes_pub --------------------------------------------------
# Le run de bout en bout à étapes mockées : le réseau et les fichiers lourds
# n'entrent jamais dans la boucle de test. Le seam de publication
# (publier_programmes) et la machinerie partagée sont RÉELS.
executer_run_programmes_pub <- function(cache, sortie, donnees,
                                        conventions, statuts) {
  local_mocked_bindings(
    download_sources = function(manifest, cache, mode) statuts,
    construire_donnees_programmes = function(cache) donnees,
    construire_donnees_subventions = function(cache) list(conventions = conventions),
    lire_epci = function(chemin) base_epci_programmes_pub(),
    publier_geometrie = function(cible = "public/data", fetch = NULL) invisible(NULL),
    .package = "lusk"
  )
  run_pipeline(theme = theme_programmes(), cache = cache, sortie = sortie)
}

test_that("un run peuplé écrit programmes.json + les parquets par table ; le JSON égale les parquets bit à bit", {
  racine <- tempfile("pub-prog-")
  dir.create(racine)
  cache <- file.path(racine, "cache")
  sortie <- file.path(racine, "pub")
  on.exit(unlink(racine, recursive = TRUE), add = TRUE)

  payload <- executer_run_programmes_pub(
    cache, sortie,
    donnees = donnees_programmes_pub(),
    conventions = conventions_subventions_pub(),
    statuts = statuts_programmes_pub()
  )

  # le payload retourné porte les DEUX tables (la forme du contrat)
  expect_named(payload, c("membres", "subventions"))
  expect_true(nrow(payload$membres) > 0)
  expect_true(nrow(payload$subventions) > 0)

  # les fichiers partagés : programmes.json (les deux tables) + un parquet PAR
  # table (le format parquet ne tient qu'une table — le nommage documenté du
  # contrat #178 : programmes_membres / programmes_subventions)
  expect_true(file.exists(file.path(sortie, "programmes.json")))
  expect_true(file.exists(file.path(sortie, "programmes_membres.parquet")))
  expect_true(file.exists(file.path(sortie, "programmes_subventions.parquet")))
  # Issue #408 : Programmes et subventions est le SIXIÈME thème — le run
  # publie SON theme_programmes.json (le canon épinglé, via le trait
  # `metadata` du descripteur) ET sa paire hermétique de faits
  expect_true(file.exists(file.path(sortie, "theme_programmes.json")))
  expect_true(file.exists(file.path(sortie, "indicateurs_programmes.json")))
  expect_true(file.exists(file.path(sortie, "histoires_programmes.json")))
  # la paire hermétique : les histoires sont VIDES (le thème sans lecture),
  # les faits portent les trois clés du registre
  histoires <- jsonlite::fromJSON(file.path(sortie, "histoires_programmes.json"))
  expect_length(histoires, 0L)
  faits <- jsonlite::fromJSON(file.path(sortie, "indicateurs_programmes.json"))
  expect_setequal(unique(faits$key), c("couverture_programmes", "subventions_annuelles",
                                       "subventions_par_domaine"))
  expect_true(all(faits$theme == "programmes"))

  # la forme du JSON : un OBJET à deux clés (ce que l'app lit — #179)
  js <- jsonlite::fromJSON(file.path(sortie, "programmes.json"))
  expect_named(js, c("membres", "subventions"))
  expect_true(nrow(js$membres) == nrow(payload$membres))
  expect_true(nrow(js$subventions) == nrow(payload$subventions))

  # le contrat de non-dérive (ADR-0004) : la projection JSON égale le parquet
  # BIT À BIT pour chacune des deux tables (le motif de test-publish.R)
  pq_membres <- nanoparquet::read_parquet(file.path(sortie, "programmes_membres.parquet"))
  pq_subventions <- nanoparquet::read_parquet(file.path(sortie, "programmes_subventions.parquet"))
  verifier_non_derivee(pq_membres, js$membres, "programmes_membres")
  verifier_non_derivee(pq_subventions, js$subventions, "programmes_subventions")
})

test_that("les vintages du module (6 sources, SCDL incluse) sont fusionnés dans la table partagée ; le run est tracé", {
  racine <- tempfile("pub-prog-vint-")
  dir.create(racine)
  cache <- file.path(racine, "cache")
  sortie <- file.path(racine, "pub")
  on.exit(unlink(racine, recursive = TRUE), add = TRUE)

  executer_run_programmes_pub(
    cache, sortie,
    donnees = donnees_programmes_pub(),
    conventions = conventions_subventions_pub(),
    statuts = statuts_programmes_pub()
  )

  # la table partagée des vintages porte les SIX sources du module — les cinq
  # jeux ANCT/DGALN (acv, pvd, crte, territoires_industrie, ort) + la source
  # SCDL des subventions (subventions_scdl, #176) — jamais l'écrasement
  vint <- nanoparquet::read_parquet(file.path(sortie, "vintages.parquet"))
  expect_setequal(vint$id,
                  c("acv", "pvd", "crte", "territoires_industrie", "ort",
                    "subventions_scdl"))
  # la projection JSON porte la MÊME union (ce que l'app lit)
  vj <- jsonlite::fromJSON(file.path(sortie, "vintages.json"))
  expect_equal(nrow(vj), nrow(vint))
  expect_true("subventions_scdl" %in% vj$id)

  # le rapport de run : mode full, une ligne par source (6), horodatage présent
  rapport <- jsonlite::fromJSON(file.path(sortie, "run-report.json"))
  expect_equal(rapport$mode, "full")
  expect_equal(nrow(rapport$statuts), 6L)
  expect_setequal(rapport$statuts$id, vint$id)
  expect_true(grepl("^[0-9]{4}-[0-9]{2}-[0-9]{2}T", rapport$timestamp))
})

test_that("un re-run ne duplique AUCUNE ligne et n'écrase pas les fichiers partagés (upsert)", {
  racine <- tempfile("pub-prog-idem-")
  dir.create(racine)
  cache <- file.path(racine, "cache")
  sortie <- file.path(racine, "pub")
  on.exit(unlink(racine, recursive = TRUE), add = TRUE)

  executer_run_programmes_pub(
    cache, sortie,
    donnees = donnees_programmes_pub(),
    conventions = conventions_subventions_pub(),
    statuts = statuts_programmes_pub()
  )
  executer_run_programmes_pub(
    cache, sortie,
    donnees = donnees_programmes_pub(),
    conventions = conventions_subventions_pub(),
    statuts = statuts_programmes_pub()
  )

  # le payload EST l'état complet : relancer écrase, ne duplique jamais
  membres <- nanoparquet::read_parquet(file.path(sortie, "programmes_membres.parquet"))
  subventions <- nanoparquet::read_parquet(file.path(sortie, "programmes_subventions.parquet"))
  expect_equal(anyDuplicated(membres[c("territoire", "sigle")]), 0L)
  # aucune ligne en double — une commune porte plusieurs domaines (lignes
  # distinctes), la clé naturelle est la ligne complète
  expect_equal(anyDuplicated(subventions), 0L)
  # la table partagée des vintages ne duplique pas non plus (upsert par id)
  vint <- nanoparquet::read_parquet(file.path(sortie, "vintages.parquet"))
  expect_equal(nrow(vint), 6L)
})

test_that("un run à tables VIDES n'écrit RIEN et laisse la sentinelle INTACTE (issue #178)", {
  racine <- tempfile("pub-prog-sent-")
  dir.create(racine)
  cache <- file.path(racine, "cache")
  sortie <- file.path(racine, "pub")
  on.exit(unlink(racine, recursive = TRUE), add = TRUE)

  # 1) un run peuplé écrit les fichiers partagés (la sentinelle)
  executer_run_programmes_pub(
    cache, sortie,
    donnees = donnees_programmes_pub(),
    conventions = conventions_subventions_pub(),
    statuts = statuts_programmes_pub()
  )
  octets <- function(fichier) {
    readBin(file.path(sortie, fichier), "raw",
            n = file.info(file.path(sortie, fichier))$size)
  }
  avant <- lapply(c("programmes.json", "programmes_membres.parquet",
                    "programmes_subventions.parquet"), octets)

  # 2) un run à tables vides (aucune ligne d'adhésion, aucune convention)
  #    n'écrit RIEN : les fichiers partagés restent EXACTEMENT les mêmes
  executer_run_programmes_pub(
    cache, sortie,
    donnees = list(
      acv = tibble::tibble(code_commune = character(), nom_commune = character(), id_acv = character()),
      pvd = tibble::tibble(code_commune = character(), nom_commune = character(), id_pvd = character()),
      crte = tibble::tibble(id_crte = character(), lib_crte = character(),
                            type_grp_crte = character(), nature_juridique = character(),
                            siren_epci = character()),
      territoires_industrie = tibble::tibble(id_ti = character(), lib_ti = character(),
                                             siren_epci = character(), nom_epci = character()),
      ort = tibble::tibble(code_commune = character(), statut = character(), actualisation = character())
    ),
    conventions = tibble::tibble(commune = character(), annee = integer(),
                                 programme_libl = character(), montant = numeric()),
    statuts = statuts_programmes_pub()
  )

  apres <- lapply(c("programmes.json", "programmes_membres.parquet",
                    "programmes_subventions.parquet"), octets)
  for (i in seq_along(avant)) expect_identical(apres[[i]], avant[[i]])
})

test_that("un run Programmes publie SON canon par-dessus toute relique (#408)", {
  # Issue #408 : Programmes et subventions EST un thème — le run publie
  # theme_programmes.json depuis le canon épinglé (trait `metadata` du
  # descripteur). Un fichier préexistant (une relique d'un autre outil) est
  # REMPLACÉ par le contenu validé — jamais conservé en silence.
  racine <- tempfile("pub-prog-sent-meta-")
  dir.create(racine)
  cache <- file.path(racine, "cache")
  sortie <- file.path(racine, "pub")
  dir.create(sortie, recursive = TRUE)
  on.exit(unlink(racine, recursive = TRUE), add = TRUE)

  # la relique : un fichier theme_programmes.json qui ne vient pas du run
  writeLines('{"theme": "programmes", "relique": true}',
             file.path(sortie, "theme_programmes.json"))

  executer_run_programmes_pub(
    cache, sortie,
    donnees = donnees_programmes_pub(),
    conventions = conventions_subventions_pub(),
    statuts = statuts_programmes_pub()
  )

  # le run publie SES fichiers partagés, et le canon remplace la relique
  expect_true(file.exists(file.path(sortie, "programmes.json")))
  relu <- jsonlite::fromJSON(file.path(sortie, "theme_programmes.json"),
                             simplifyVector = FALSE)
  expect_identical(relu$theme, "programmes")
  expect_null(relu$relique)
  expect_error(valider_theme_metadata(relu), NA)
})

test_that("un run à tables vides ne crée JAMAIS les fichiers partagés (issue #178)", {
  racine <- tempfile("pub-prog-vide-")
  dir.create(racine)
  cache <- file.path(racine, "cache")
  sortie <- file.path(racine, "pub")
  on.exit(unlink(racine, recursive = TRUE), add = TRUE)

  executer_run_programmes_pub(
    cache, sortie,
    donnees = list(
      acv = tibble::tibble(code_commune = character(), nom_commune = character(), id_acv = character()),
      pvd = tibble::tibble(code_commune = character(), nom_commune = character(), id_pvd = character()),
      crte = tibble::tibble(id_crte = character(), lib_crte = character(),
                            type_grp_crte = character(), nature_juridique = character(),
                            siren_epci = character()),
      territoires_industrie = tibble::tibble(id_ti = character(), lib_ti = character(),
                                             siren_epci = character(), nom_epci = character()),
      ort = tibble::tibble(code_commune = character(), statut = character(), actualisation = character())
    ),
    conventions = tibble::tibble(commune = character(), annee = integer(),
                                 programme_libl = character(), montant = numeric()),
    statuts = statuts_programmes_pub()
  )

  # le payload retourné est vide, et JAMAIS de fichier partagé ne naît
  expect_false(file.exists(file.path(sortie, "programmes.json")))
  expect_false(file.exists(file.path(sortie, "programmes_membres.parquet")))
  expect_false(file.exists(file.path(sortie, "programmes_subventions.parquet")))
})
