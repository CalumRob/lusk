# test-programmes-e2e ----------------------------------------------------------
# Le run de bout en bout du thème Programmes & financements (issue #175 +
# #178) sur les VRAIES sources officielles (pipeline/data/raw/, gitignoré —
# jamais le réseau) : la couture de téléchargement est MOCKÉE, les lecteurs et
# le calcul sont RÉELS, les fixtures d'entrée sont les fichiers officiels du
# worktree. C'est le miroir de test-analytics-mobilite-e2e.R.
#
# Ce que le run doit prouver (acceptance #175) :
#   - la table des adhésions porte les comptes réels VERROUILLÉS :
#       ACV 11 communes (11/11 villes lauréates, chacune avec sa convention
#       signée — drapeau « convention valant ORT » TRUE) ;
#       PVD 135 communes (les 135 identiques des deux sources ANCT ; 123 avec
#       une convention signée — drapeau TRUE —, 12 sans — les 4 communes du
#       Pays Bigouden Sud absentes du fichier ORT (Guilvinec, Loctudy,
#       Penmarch, Treffiagat) + Plobannalec-Lesconil, et 7 présentes mais non
#       signées) ;
#       CRTE 58 lignes EPCI (40 contrats bretons ; les lignes « COM » du
#       fichier — des communes signataires individuelles, jamais un EPCI — ne
#       produisent AUCUNE ligne : 39 contrats portent des EPCI signataires,
#       les îles du Ponant signent sans EPCI) ;
#       Territoires d'industrie 32 lignes EPCI (10 territoires) ;
#       ORT 11 lignes commune (les « 3. Autre » SIGNÉES) + 6 lignes EPCI (les
#       EPCIs dont l'ORT n'est pas porté par un label — Brest Métropole, CC
#       Pays de Châteaugiron, CC Côte d'Émeraude, CA Dinan, CC Vallons de
#       Haute-Bretagne, CA Morlaix) ;
#   - les règles de badge sur les données réelles : ORT Signée seulement
#     (les 152 lignes bretonnes du fichier — 145 Signée, 5 Terminée, 2 Non
#     signée — ne produisent que les 11 + 6 lignes) ; jamais de double badge
#     (une commune labellisée ne porte jamais de ligne ORT) ;
#   - chaque ligne porte le vintage de SA source (les mises à jour ANCT ;
#     l'actualisation PAR LIGNE pour l'ORT) ;
#   - le run est IDEMPOTENT : un second run produit la même table (l'ingestion
#     ne duplique rien), et le rapport de run trace les statuts par source ;
#   - les vintages du thème (les SIX sources — les cinq ANCT/DGALN + la SCDL
#     des subventions) sont fusionnés dans la table partagée ;
#   - le FICHIER PARTAGÉ programmes (issue #178) est publié : programmes.json
#     (les deux tables en un objet) + un parquet par table, bit-à-bit égaux.

# Les fixtures réelles — le seam d'entrée du run mocké --------------------------
# Les cinq fichiers officiels (ACV, PVD, CRTE, Territoires d'industrie, ORT),
# l'export SCDL des subventions (#176) et le référentiel EPCI partagé vivent
# sous pipeline/data/ (gitignoré). Absents hors worktree, le test saute
# proprement (comme les autres tests « données réelles »).
fixture_e2e_programmes <- function(...) {
  testthat::test_path("..", "..", "data", "raw", ...)
}

fixtures_reelles_programmes_presentes <- function() {
  all(file.exists(
    fixture_e2e_programmes("liste-acv-com2025-20250704.csv"),
    fixture_e2e_programmes("liste-pvd-com2025-20260427.csv"),
    fixture_e2e_programmes("liste-crte-grpt2025-20250717.csv"),
    fixture_e2e_programmes("liste-ti-communes.csv"),
    fixture_e2e_programmes("ort-conventions.xlsx"),
    fixture_e2e_programmes("subventions_attribuees_scdl0.csv"),
    fixture_e2e_programmes("extracted", "EPCI_au_01-01-2025.xlsx")
  ))
}

fabriquer_cache_e2e_programmes <- function(cache) {
  dir.create(file.path(cache, "extracted"), recursive = TRUE, showWarnings = FALSE)
  for (f in c("liste-acv-com2025-20250704.csv",
              "liste-pvd-com2025-20260427.csv",
              "liste-crte-grpt2025-20250717.csv",
              "liste-ti-communes.csv",
              "ort-conventions.xlsx",
              "subventions_attribuees_scdl0.csv")) {
    file.copy(fixture_e2e_programmes(f), cache, overwrite = TRUE)
  }
  file.copy(fixture_e2e_programmes("extracted", "EPCI_au_01-01-2025.xlsx"),
            file.path(cache, "extracted"), overwrite = TRUE)
  invisible(cache)
}

# statuts du run Programmes : une ligne par source du manifeste COMPLET du
# thème (les cinq ANCT/DGALN + la SCDL des subventions, issue #178)
statuts_programmes <- function(status = "frais") {
  tibble::tibble(
    id = MANIFEST_PROGRAMMES_COMPLET$id,
    mode = MANIFEST_PROGRAMMES_COMPLET$mode,
    status = rep(status, nrow(MANIFEST_PROGRAMMES_COMPLET))
  )
}

executer_run_programmes <- function(cache, sortie) {
  local_mocked_bindings(
    download_sources = function(manifest, cache, mode) statuts_programmes(),
    publier_geometrie = function(cible = "public/data", fetch = NULL) invisible(NULL),
    .package = "lusk"
  )
  run_pipeline(theme = theme_programmes(), cache = cache, sortie = sortie)
}

# Les comptes réels VERROUILLÉS (acceptance #175, vérifiés sur les sources
# officielles du 2026-08-07) :
#   - ACV : 11 villes lauréates bretonnes ; les 11 ont une convention ORT
#     signée dans le fichier → 11 lignes, drapeau TRUE partout.
#   - PVD : 135 communes bretonnes (les deux sources ANCT identiques) ; 123
#     ont une convention signée (drapeau TRUE), 12 non (les 5 absentes du
#     fichier ORT — les 4 communes du Pays Bigouden Sud Guilvinec/Loctudy/
#     Penmarch/Treffiagat et Plobannalec-Lesconil — + 7 présentes mais non
#     signées).
#   - CRTE : 40 contrats bretons → 58 paires (contrat × EPCI signataire — les
#     lignes « COM » du fichier sont des communes signataires individuelles,
#     jamais un EPCI, et ne produisent aucune ligne).
#   - Territoires d'industrie : 10 territoires → 32 EPCIs.
#   - ORT : les 152 lignes bretonnes du fichier (145 « Signée », 5 « Terminée »,
#     2 « Non signée ») → 11 lignes commune (les « 3. Autre » signées) + 6
#     lignes EPCI.
#   - Au total : 11 + 135 + 58 + 32 + 11 + 6 = 253 lignes d'adhésion.
comptes_adhesions_reels <- c(
  acv = 11,
  pvd = 135,
  crte = 58,
  territoires_industrie = 32,
  ort_commune = 11,
  ort_epci = 6
)
# Les communes du Pays Bigouden Sud ABSENTES du fichier ORT — leur badge PVD
# dérive toujours, elles n'ont simplement pas de drapeau (le fait à verrouiller)
communes_absentes_ort_reelles <- c("29072", "29135", "29158", "29284") # Guilvinec, Loctudy, Penmarch, Treffiagat

test_that("le run de bout en bout : les lignes d'adhésion aux comptes réels verrouillés", {
  skip_sans_donnees_reelles(fixtures_reelles_programmes_presentes(),
              "les fixtures réelles ne sont pas présentes (data/ est gitignoré).")

  racine <- tempfile("e2e-prog-")
  dir.create(racine)
  cache <- file.path(racine, "cache")
  cwd_run <- file.path(racine, "cwd")
  dir.create(cwd_run)
  sortie <- file.path(racine, "pub")
  on.exit(unlink(racine, recursive = TRUE), add = TRUE)

  fabriquer_cache_e2e_programmes(cache)
  withr::local_dir(cwd_run)

  payload <- executer_run_programmes(cache, sortie)
  membres <- payload$membres

  # la forme du contrat et les comptes verrouillés par programme
  expect_named(membres, c("territoire", "type", "sigle", "convention_valant_ort",
                          "vintage_source", "vintage_version",
                          "vintage_date_reference", "vintage_date_publication"))
  for (cle in names(comptes_adhesions_reels)) {
    sigle <- switch(cle,
      acv = "ACV",
      pvd = "PVD",
      crte = "CRTE",
      territoires_industrie = "Territoires d'industrie",
      ort_commune = "ORT",
      ort_epci = "ORT"
    )
    type <- if (cle %in% c("ort_commune")) "commune" else
      if (cle == "ort_epci") "epci" else NULL
    lignes <- membres[membres$sigle == sigle, ]
    if (!is.null(type)) lignes <- lignes[lignes$type == type, ]
    expect_equal(nrow(lignes), unname(comptes_adhesions_reels[[cle]]), info = cle)
  }

  # les ancrages : ACV/PVD à la commune, CRTE/TI à l'EPCI, ORT aux deux
  expect_true(all(membres$type[membres$sigle %in% c("ACV", "PVD")] == "commune"))
  expect_true(all(membres$type[membres$sigle %in% c("CRTE", "Territoires d'industrie")] == "epci"))

  # 11/11 villes ACV dans le fichier ORT : chaque ligne ACV porte le drapeau
  acv <- membres[membres$sigle == "ACV", ]
  expect_equal(nrow(acv), 11L)
  expect_true(all(acv$convention_valant_ort))
  # les 11 villes lauréates attendues, nommément
  expect_setequal(acv$territoire,
                  c("22113", "22278", "29151", "29232", "35115", "35236",
                    "35288", "35360", "56121", "56178", "56260"))

  # PVD : 135 communes ; les 4 communes du Pays Bigouden Sud absentes du
  # fichier ORT portent le badge PVD SANS drapeau (jamais une ligne ORT)
  pvd <- membres[membres$sigle == "PVD", ]
  expect_equal(nrow(pvd), 135L)
  expect_equal(sum(pvd$convention_valant_ort), 123L)
  for (commune in communes_absentes_ort_reelles) {
    expect_true(commune %in% pvd$territoire, info = commune)
    expect_false(pvd$convention_valant_ort[pvd$territoire == commune],
                 info = commune)
  }

  # les règles de badge sur les données réelles
  ort <- membres[membres$sigle == "ORT", ]
  # JAMAIS de double badge : aucune commune labellisée ne porte de ligne ORT
  labellisees <- c(acv$territoire, pvd$territoire)
  expect_false(any(ort$territoire[ort$type == "commune"] %in% labellisees))
  # les lignes ORT n'existent que pour les conventions SIGNÉES : les 11
  # communes « 3. Autre » du fichier, jamais une « Terminée » ni « Non signée »
  expect_equal(sum(ort$type == "commune"), 11L)
  # le drapeau n'existe que sur les labels
  expect_true(all(membres$convention_valant_ort[membres$sigle == "ORT"] == FALSE))

  # les estampilles vintage : les mises à jour ANCT sur les labels/contrats,
  # l'actualisation PAR LIGNE sur l'ORT (jamais la métadonnée de page)
  expect_true(all(acv$vintage_source ==
                    vintages_programmes()$source[vintages_programmes()$id == "acv"]))
  expect_true(all(ort$vintage_version == "en continu"))
  expect_true(all(is.na(ort$vintage_date_publication)))
  expect_true(all(!is.na(ort$vintage_date_reference)))
  expect_true(all(grepl("^[0-9]{4}-[0-9]{2}-[0-9]{2}$", ort$vintage_date_reference)))

  # l'artefact analytique est persisté sous data/processed/programmes/ — les
  # deux tables du payload (adhésions + subventions, issue #178)
  sortie_analytiques <- file.path(dirname(cache), "processed", "programmes")
  expect_true(file.exists(file.path(sortie_analytiques, "membres_programmes.rds")))
  relu <- readRDS(file.path(sortie_analytiques, "membres_programmes.rds"))
  expect_identical(relu, membres)
  expect_true(file.exists(file.path(sortie_analytiques, "subventions_programmes.rds")))
  expect_true(nrow(readRDS(file.path(sortie_analytiques,
                                     "subventions_programmes.rds"))) > 0)

  # le payload retourné porte les DEUX tables du contrat (ADR-0013) — les
  # adhésions (253 lignes) et les agrégats de subventions de l'année de
  # référence (une ligne par territoire, estampillés hebdomadaire)
  expect_named(payload, c("membres", "subventions"))
  subventions <- payload$subventions
  expect_true(nrow(subventions) > 0)
  expect_true(all(c("territoire", "type", "annee", "programme_libl", "montant",
                    "vintage_source", "vintage_version",
                    "vintage_date_reference", "vintage_date_publication") %in%
                    names(subventions)))
  # l'estampille HEBDOMADAIRE de la source SCDL sur chaque ligne d'agrégat
  scdl <- vintages_programmes()$source[vintages_programmes()$id == "subventions_scdl"]
  expect_true(all(subventions$vintage_source == scdl))
  expect_true(all(!is.na(subventions$montant)))
  expect_true(any(subventions$type == "region"))
  expect_true(sum(subventions$montant[subventions$type == "region"]) > 0)

  # les vintages du thème (les SIX sources — les cinq ANCT/DGALN + la SCDL) +
  # le rapport de run sont publiés
  expect_true(file.exists(file.path(sortie, "vintages.parquet")))
  expect_true(file.exists(file.path(sortie, "vintages.json")))
  expect_true(file.exists(file.path(sortie, "run-report.json")))
  vint <- nanoparquet::read_parquet(file.path(sortie, "vintages.parquet"))
  expect_true(all(MANIFEST_PROGRAMMES_COMPLET$id %in% vint$id))
  expect_true("subventions_scdl" %in% vint$id)
  rapport <- jsonlite::fromJSON(file.path(sortie, "run-report.json"))
  expect_equal(nrow(rapport$statuts), 6L)
  expect_setequal(rapport$statuts$id, MANIFEST_PROGRAMMES_COMPLET$id)

  # le FICHIER PARTAGÉ programmes (issue #178) : programmes.json (les DEUX
  # tables en un objet — ce que l'app lit) + un parquet PAR TABLE, écrits vers
  # la cible du payload
  expect_true(file.exists(file.path(sortie, "programmes.json")))
  expect_true(file.exists(file.path(sortie, "programmes_membres.parquet")))
  expect_true(file.exists(file.path(sortie, "programmes_subventions.parquet")))
  js <- jsonlite::fromJSON(file.path(sortie, "programmes.json"))
  expect_named(js, c("membres", "subventions"))
  expect_equal(nrow(js$membres), nrow(membres))
  expect_equal(nrow(js$subventions), nrow(subventions))

  # le contrat de non-dérive (ADR-0004) : le JSON se relit BIT À BIT comme les
  # parquets pour chacune des deux tables
  verifier_non_derivee(
    nanoparquet::read_parquet(file.path(sortie, "programmes_membres.parquet")),
    js$membres, "programmes_membres")
  verifier_non_derivee(
    nanoparquet::read_parquet(file.path(sortie, "programmes_subventions.parquet")),
    js$subventions, "programmes_subventions")

  # AUCUN artefact de fiche hors de la cible de publication
  motifs_fiche <- paste("^programmes", "^vintages", "^run-report", sep = "|")
  expect_false(any(grepl(motifs_fiche,
                         list.files(sortie_analytiques, recursive = TRUE))))
})

test_that("un second run ne duplique AUCUNE ligne (l'ingestion est idempotente)", {
  skip_sans_donnees_reelles(fixtures_reelles_programmes_presentes(),
              "les fixtures réelles ne sont pas présentes (data/ est gitignoré).")

  racine <- tempfile("e2e-prog-idem-")
  dir.create(racine)
  cache <- file.path(racine, "cache")
  cwd_run <- file.path(racine, "cwd")
  dir.create(cwd_run)
  sortie2 <- file.path(racine, "pub2")
  on.exit(unlink(racine, recursive = TRUE), add = TRUE)

  fabriquer_cache_e2e_programmes(cache)
  withr::local_dir(cwd_run)

  executer_run_programmes(cache, sortie2)
  executer_run_programmes(cache, sortie2)  # idempotent

  membres <- readRDS(file.path(dirname(cache), "processed", "programmes",
                               "membres_programmes.rds"))
  # les comptes verrouillés tiennent après deux runs — aucune ligne dupliquée
  expect_equal(sum(membres$sigle == "ACV"), 11L)
  expect_equal(sum(membres$sigle == "PVD"), 135L)
  expect_equal(sum(membres$sigle == "CRTE"), 58L)
  expect_equal(sum(membres$sigle == "Territoires d'industrie"), 32L)
  expect_equal(sum(membres$sigle == "ORT"), 17L)  # 11 commune + 6 EPCI
  expect_equal(nrow(membres), 253L)
  expect_equal(anyDuplicated(membres[c("territoire", "sigle")]), 0L)
})
