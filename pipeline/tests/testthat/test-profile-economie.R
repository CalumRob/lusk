# test-profile-economie ----------------------------------------------------------
# Le profilage et la validation « commune d'abord » du thème Économie/Emploi
# (todo 7, plan economie-pipeline-contracts ; docs/themes/economie-emploi.md
# §Pipeline notes — étape 3 « profile »). Le profilage consomme les sorties
# des normalisateurs (todos 4-6) — les FIXTURES des normalisateurs sont le
# seam d'entrée — et produit, pour chacune des quatre tables, une preuve
# déterministe : couverture communale contre LE référentiel partagé,
# comptes de lignes, couverture des activités, comportement des cellules
# (zéro OBSERVÉ / cellule omise / valeur manquante — jamais confondus),
# suppression (diffusion partielle SIRENE, statuts K/W Flores, exclusions RP),
# exclusions d'éligibilité SIRENE et résumés de sparsité / fiabilité.
#
# Les acceptances du todo 7, verrouillées ici :
#   - comptes DÉTERMINISTES par source, distinguant explicitement zéro
#     observé, zéro omis, manquant, supprimé et exclu (là où la source le
#     permet) ;
#   - toutes les lignes normalisées passent les contrôles commune/référentiel ;
#   - RELANCER le profilage sur les mêmes fixtures produit des preuves
#     OCTET-POUR-OCTET identiques (déterminisme) ;
#   - aucune colonne analytique créée (ni LQ, ni rang, ni matrice).
# Aucun appel réseau dans la boucle de test (docs/architecture.md §Testing).

# Les fixtures des normalisateurs (le seam d'entrée du profilage) ---------------
fixture_sirene_profil <- function() {
  readr::read_csv(
    testthat::test_path("fixtures", "sirene-snapshot-fixture.csv"),
    col_types = readr::cols(.default = readr::col_character()),
    show_col_types = FALSE
  )
}

fixture_flores_profil_a38 <- function() {
  lire_csv_long(testthat::test_path("fixtures", "flores-a38-fixture.csv"))
}

fixture_flores_profil_a88 <- function() {
  lire_csv_long(testthat::test_path("fixtures", "flores-a88-fixture.csv"))
}

fixture_emploi_rp_profil <- function() {
  lire_csv_long(testthat::test_path("fixtures", "rp-emploi-fixture.csv"))
}

# LE référentiel partagé du profilage : la base EPCI bretonne (lire_epci) —
# la MÊME référence que les jointures des normalisateurs. Elle couvre les
# quatre communes des fixtures (22001 · 29001 · 35001 · 56001, une par
# département breton) ; 44001 (Nantes) en est absente.
reference_profil <- tibble::tribble(
  ~CODGEO, ~LIBGEO, ~EPCI, ~LIBEPCI, ~DEP, ~REG,
  "22001", "Commune A1", "200000001", "EPCI X", "22", "53",
  "29001", "Commune B", "200000002", "EPCI Y", "29", "53",
  "35001", "Commune C", "200000003", "EPCI Z", "35", "53",
  "56001", "Commune D", "200000004", "EPCI W", "56", "53"
)

# les dictionnaires de libellés natifs du produit (mêmes codes que les tests
# des normalisateurs — les VRAIS libellés des fichiers de métadonnées)
dictionnaire_a38_profil <- c(
  "CA" = "Fabrication de denrées alimentaires, de boissons et de produits à base de tabac",
  "GZ" = "Commerce ; réparation d'automobiles et de motocycles",
  "DZ" = "Production et distribution d'électricité, de gaz, de vapeur et d'air conditionné",
  "_T" = "Total"
)

dictionnaire_a88_profil <- c(
  "11" = "Fabrication de boissons",
  "22" = "Fabrication de produits en caoutchouc et en plastique",
  "45" = "Commerce et réparation d'automobiles et de motocycles",
  "56" = "Restauration",
  "70" = "Activités des sièges sociaux ; conseil de gestion",
  "78" = "Activités liées à l'emploi",
  "96" = "Autres services personnels",
  "_T" = "Total"
)

# construire_tables_profil : les QUATRE tables normalisées — les listes
# {table, exclusions} renvoyées par les normalisateurs des todos 4-6, dans
# l'ordre du contrat. C'est l'entrée exacte du profilage.
construire_tables_profil <- function() {
  list(
    sirene_snapshot = normaliser_sirene_snapshot(fixture_sirene_profil()),
    flores_a38 = normaliser_flores_a38(
      fixture_flores_profil_a38(), reference_profil, dictionnaire_a38_profil
    ),
    flores_a88 = normaliser_flores_a88(
      fixture_flores_profil_a88(), reference_profil, dictionnaire_a88_profil
    ),
    rp_emploi = normaliser_emploi_rp(fixture_emploi_rp_profil(), reference_profil)
  )
}

# les petits accesseurs de lecture du rapport (le vocabulaire du contrat)
valeur_metric <- function(profil, table, section, metric) {
  tab <- profil[[table]][[section]]
  tab$valeur[tab$metric == metric]
}

valeur_cellule <- function(profil, table, statut) {
  profil[[table]]$cellules$lignes[
    profil[[table]]$cellules$statut_cellule == statut
  ]
}

valeur_suppression <- function(profil, table, statut) {
  suppr <- profil[[table]]$suppression
  if (nrow(suppr) == 0) return(0L)
  suppr$lignes[suppr$statut == statut]
}

test_that("profil_economie : une section de rapport par table, dans l'ordre du contrat", {
  profil <- profil_economie(construire_tables_profil(), reference_profil)

  # les quatre tables du contrat, dans l'ordre — jamais une table fusionnée
  expect_named(profil, c("sirene_snapshot", "flores_a38", "flores_a88", "rp_emploi"))
  # chaque section porte le même squelette de rapport
  for (id in names(profil)) {
    expect_named(profil[[id]], c(
      "couverture", "comptes", "cellules",
      "suppression", "exclusions", "sparsite", "fiabilite"
    ))
  }
})

test_that("la couverture communale contre le référentiel partagé (commune-first)", {
  profil <- profil_economie(construire_tables_profil(), reference_profil)

  # SIRENE : les 4 communes bretonnes des fixtures sont présentes (une par
  # département) ; aucune absente, aucune inconnue
  expect_equal(valeur_metric(profil, "sirene_snapshot", "couverture",
                             "communes_reference"), 4)
  expect_equal(valeur_metric(profil, "sirene_snapshot", "couverture",
                             "communes_presentes"), 4)
  expect_equal(valeur_metric(profil, "sirene_snapshot", "couverture",
                             "communes_absentes"), 0)
  expect_equal(valeur_metric(profil, "sirene_snapshot", "couverture",
                             "communes_inconnues"), 0)

  # Flores A38/A88 et RP : 22001 et 29001 présentes ; 35001 et 56001 absentes
  # (le référentiel attend plus de communes que les fixtures n'en couvrent) ;
  # AUCUNE commune inconnue — toutes les lignes normalisées joignent le
  # référentiel breton (l'acceptance : « all normalized rows pass
  # commune/reference checks »)
  for (id in c("flores_a38", "flores_a88", "rp_emploi")) {
    expect_equal(valeur_metric(profil, id, "couverture", "communes_reference"), 4)
    expect_equal(valeur_metric(profil, id, "couverture", "communes_presentes"), 2)
    expect_equal(valeur_metric(profil, id, "couverture", "communes_absentes"), 2)
    expect_equal(valeur_metric(profil, id, "couverture", "communes_inconnues"), 0)
    detail <- profil[[id]]$couverture$detail[
      profil[[id]]$couverture$metric == "communes_absentes"
    ]
    expect_equal(detail, "35001,56001")
  }
})

test_that("comptes déterministes : lignes, communes, activités, mesures, total brut", {
  profil <- profil_economie(construire_tables_profil(), reference_profil)

  # SIRENE : 6 cellules observées (7 établissements actifs), 4 communes,
  # 4 codes APE, 1 mesure, 7 établissements au total
  expect_equal(profil$sirene_snapshot$comptes$valeur, c(6, 4, 4, 1, 7))

  # Flores A38 : 37 lignes, 2 communes, 4 postes natifs, 2 mesures
  expect_equal(profil$flores_a38$comptes$valeur, c(37, 2, 4, 2, 317))

  # Flores A88 : 22 lignes, 2 communes, 8 divisions, 2 mesures
  expect_equal(profil$flores_a88$comptes$valeur, c(22, 2, 8, 2, 389))

  # RP emploi : 12 lignes (2 communes × 6 secteurs natifs), 1 mesure
  expect_equal(profil$rp_emploi$comptes$valeur, c(12, 2, 6, 1, 1569.4))
})

test_that("les cellules distinguent zéro observé, omis, manquant — jamais confondus", {
  profil <- profil_economie(construire_tables_profil(), reference_profil)

  # SIRENE : table creuse et sans zéro ni manquant — les cellules non
  # observées n'existent pas (0 établissement), elles sont OMISES :
  # 160 potentielles (4 communes × 4 APE × 2 statuts × 5 tranches), 6
  # observées, 154 omises, 0 zéro observé, 0 manquant
  expect_equal(profil$sirene_snapshot$cellules$lignes, c(160, 6, 0, 0, 154))

  # Flores A38 : le zéro OBSERVÉ (statut A, valeur 0) est compté à part du
  # manquant (statut K, valeur NA) et de l'omission (combinaison absente) :
  # 112 potentielles (2 × 4 × 7 tranches × 2 mesures), 37 observées, 1 zéro,
  # 1 manquant, 75 omises
  expect_equal(profil$flores_a38$cellules$lignes, c(112, 37, 1, 1, 75))

  # Flores A88 : même distinction, sans la dimension tranche — 32
  # potentielles (2 × 8 × 2), 22 observées, 1 zéro, 1 manquant, 10 omises
  expect_equal(profil$flores_a88$cellules$lignes, c(32, 22, 1, 1, 10))

  # RP emploi : le croisement commune × secteur est complet dans la fixture
  # (12 = 12) — ni zéro, ni manquant, ni omission
  expect_equal(profil$rp_emploi$cellules$lignes, c(12, 12, 0, 0, 0))
})

test_that("la suppression est comptée là où la source la porte, et nommée", {
  profil <- profil_economie(construire_tables_profil(), reference_profil)

  # SIRENE : 5 établissements en diffusion 'O', 1 en diffusion partielle 'P'
  # (conservée — sa commune et son code APE sont exploitables)
  expect_equal(valeur_suppression(profil, "sirene_snapshot", "O"), 5)
  expect_equal(valeur_suppression(profil, "sirene_snapshot", "P"), 1)

  # Flores A38 : 35 observations normales (A), 1 cellule non diffusée (K —
  # valeur NA, jamais un zéro), 1 observation d'inclusion (W)
  expect_equal(valeur_suppression(profil, "flores_a38", "A"), 35)
  expect_equal(valeur_suppression(profil, "flores_a38", "K"), 1)
  expect_equal(valeur_suppression(profil, "flores_a38", "W"), 1)

  # Flores A88 : même vocabulaire
  expect_equal(valeur_suppression(profil, "flores_a88", "A"), 20)
  expect_equal(valeur_suppression(profil, "flores_a88", "K"), 1)
  expect_equal(valeur_suppression(profil, "flores_a88", "W"), 1)

  # RP emploi : le statut de suppression de la source (OBS_STATUS ≠ 'A') est
  # filtré au pivot du contrat — le rapport le dit EXPLICITEMENT par un
  # tibble vide (la distinction « supprimé » n'existe pas dans la table)
  expect_equal(nrow(profil$rp_emploi$suppression), 0)
  expect_match(
    profil$rp_emploi$fiabilite$valeur[
      profil$rp_emploi$fiabilite$cle == "note_suppression"
    ],
    "filtré au pivot"
  )
})

test_that("les exclusions sont agrégées par motif, total en tête", {
  profil <- profil_economie(construire_tables_profil(), reference_profil)

  # SIRENE : 7 établissements exclus, un motif documenté par ligne
  expect_equal(profil$sirene_snapshot$exclusions$lignes[
    profil$sirene_snapshot$exclusions$motif == "total"
  ], 7)
  attendus <- c(
    commune_hors_bretagne = 2, commune_invalide = 1, commune_manquante = 1,
    ferme = 1, naf_invalide = 1, naf_manquante = 1
  )
  for (motif in names(attendus)) {
    expect_equal(
      profil$sirene_snapshot$exclusions$lignes[
        profil$sirene_snapshot$exclusions$motif == motif
      ], unname(attendus[[motif]]),
      info = paste("motif SIRENE", motif)
    )
  }

  # Flores (partagé par A38 et A88) : 3 exclusions — la commune hors Bretagne,
  # la période hors contrat, la forme juridique hors contrat
  for (id in c("flores_a38", "flores_a88")) {
    expect_equal(profil[[id]]$exclusions$lignes[
      profil[[id]]$exclusions$motif == "total"
    ], 3)
    motifs <- profil[[id]]$exclusions$motif
    expect_true(any(grepl("Bretagne", motifs)))
    expect_true(any(grepl("période hors contrat", motifs)))
    expect_true(any(grepl("forme juridique hors contrat", motifs)))
  }

  # RP : 2 exclusions — la commune hors Bretagne et l'emploi au lieu de
  # travail (EMPLT), exclu et rapporté, jamais relabellé en emploi résident
  expect_equal(profil$rp_emploi$exclusions$lignes[
    profil$rp_emploi$exclusions$motif == "total"
  ], 2)
  expect_true(any(grepl("Bretagne", profil$rp_emploi$exclusions$motif)))
  expect_true(any(grepl("EMPLT", profil$rp_emploi$exclusions$motif)))
})

test_that("les résumés de sparsité / fiabilité sont déterministes", {
  profil <- profil_economie(construire_tables_profil(), reference_profil)

  # SIRENE : 6/160 cellules observées, max 2 établissements, moyenne 7/6,
  # aucune part de zéro ni de manquant
  expect_equal(profil$sirene_snapshot$sparsite$valeur,
               c(6 / 160, 2, 7 / 6, 0, 0))

  # Flores A38 : 37/112, max 45, moyenne 317/36, 1/37 pour zéro, manquant et
  # non diffusé
  expect_equal(profil$flores_a38$sparsite$valeur,
               c(37 / 112, 45, 317 / 36, 1 / 37, 1 / 37, 1 / 37))

  # Flores A88 : 22/32, max 112, moyenne 389/21
  expect_equal(profil$flores_a88$sparsite$valeur,
               c(22 / 32, 112, 389 / 21, 1 / 22, 1 / 22, 1 / 22))

  # RP : densité complète (12/12), max 500, moyenne 1569.4/12
  expect_equal(profil$rp_emploi$sparsite$valeur,
               c(1, 500, 1569.4 / 12, 0, 0))

  # l'avertissement de fiabilité Flores est répété dans le rapport (la source
  # elle-même met en garde sur les données communales)
  for (id in c("flores_a38", "flores_a88")) {
    note <- profil[[id]]$fiabilite$valeur[
      profil[[id]]$fiabilite$cle == "note_fiabilite"
    ]
    expect_match(note, "non validées par des experts")
  }
})

test_that("relancer le profilage sur les mêmes fixtures : preuves octet-pour-octet identiques", {
  # l'acceptance clé du todo 7 : le déterminisme. Le rapport est une liste
  # pure de tibbles — deux appels sur les mêmes fixtures sont identiques
  # objet pour objet...
  p1 <- profil_economie(construire_tables_profil(), reference_profil)
  p2 <- profil_economie(construire_tables_profil(), reference_profil)
  expect_identical(p1, p2)

  # ...et les FICHIERS écrits sont byte-pour-byte identiques (l'écriture
  # jsonlite est déterministe : dataframe = "rows", digits = 17, na = "null")
  d1 <- tempfile("profil-")
  d2 <- tempfile("profil-")
  on.exit(unlink(c(d1, d2), recursive = TRUE), add = TRUE)
  ecrire_profil_economie(p1, d1)
  ecrire_profil_economie(p2, d2)

  expect_setequal(list.files(d1), list.files(d2))
  for (f in list.files(d1)) {
    b1 <- readBin(file.path(d1, f), "raw", n = file.info(file.path(d1, f))$size)
    b2 <- readBin(file.path(d2, f), "raw", n = file.info(file.path(d2, f))$size)
    expect_identical(b1, b2, info = paste("fichier", f))
  }
})

test_that("les preuves profilées vivent sous data/processed/, un JSON par table", {
  p <- profil_economie(construire_tables_profil(), reference_profil)
  d <- tempfile("profil-")
  on.exit(unlink(d, recursive = TRUE), add = TRUE)

  ecrire_profil_economie(p, d)

  # un JSON par table, nommé <id>-profil.json
  expect_setequal(
    list.files(d),
    paste0(TABLES_ECONOMIE_PROFIL, "-profil.json")
  )
  # la cible par défaut est le dossier Économie/Emploi des données processées
  # (data/ étant gitignoré, seul le chemin est vérifié — jamais public/)
  expect_match(as.character(formals(ecrire_profil_economie)$cible),
               "data/processed/economie/profil")
  # le JSON relu en retour garde la distinction zéro / omis / manquant
  relu <- jsonlite::fromJSON(file.path(d, "flores_a38-profil.json"))
  expect_equal(relu$cellules$lignes, c(112, 37, 1, 1, 75))
})

test_that("aucune colonne analytique n'est créée (ni LQ, ni rang, ni matrice)", {
  p <- profil_economie(construire_tables_profil(), reference_profil)

  # le vocabulaire entier des métriques profilées est descriptif : ni LQ, ni
  # relatedness, ni green/nitrogen, ni matrice, ni rang, ni seuil de présence
  vocabulaire <- unique(unlist(lapply(p, function(sec) {
    unlist(lapply(sec, function(tab) {
      if ("metric" %in% names(tab)) tab$metric else names(tab)
    }))
  })))
  interdit <- "\\b(lq|rca|relatedness|green|nitro|nitrogen|matrice|matrix|rang|rank|seuil|presence)\\b"
  expect_false(any(grepl(interdit, vocabulaire, ignore.case = TRUE)))

  # et la sérialisation écrite ne contient aucun vocabulaire analytique
  d <- tempfile("profil-")
  on.exit(unlink(d, recursive = TRUE), add = TRUE)
  ecrire_profil_economie(p, d)
  texte <- paste(vapply(
    list.files(d, full.names = TRUE),
    function(f) paste(readLines(f, warn = FALSE), collapse = "\n"),
    character(1)
  ), collapse = "\n")
  expect_false(grepl(interdit, texte, ignore.case = TRUE))
})

test_that("toutes les lignes normalisées passent les contrôles commune/référentiel", {
  # le profilage est LA validation commune-first : aucune ligne ne cite une
  # commune hors du référentiel breton — les quatre tables des fixtures
  # passent sans erreur
  expect_no_error(profil_economie(construire_tables_profil(), reference_profil))

  # et la couverture le prouve : communes_inconnues = 0 partout
  p <- profil_economie(construire_tables_profil(), reference_profil)
  for (id in names(p)) {
    expect_equal(valeur_metric(p, id, "couverture", "communes_inconnues"), 0)
  }
})

test_that("échec bruyant : une commune corrompue est refusée avec le nom de la table", {
  # format COG invalide (code tronqué) — nomme la source fautive
  tables <- construire_tables_profil()
  tables$sirene_snapshot$table$commune[1] <- "2200"
  expect_error(
    profil_economie(tables, reference_profil),
    "sirene_snapshot"
  )
  expect_error(
    profil_economie(tables, reference_profil),
    "COG"
  )

  # code breton bien formé mais inconnu du référentiel (99999 = pas une
  # commune de la base EPCI) — nomme la table fautive
  tables2 <- construire_tables_profil()
  tables2$flores_a38$table$commune[1] <- "99999"
  expect_error(
    profil_economie(tables2, reference_profil),
    "flores_a38"
  )
  expect_error(
    profil_economie(tables2, reference_profil),
    "référentiel Bretagne"
  )
})

test_that("échec bruyant : un statut de suppression non classé est refusé avec la table", {
  # Flores A88 : un statut d'observation hors vocabulaire (A/K/W) — la
  # suppression non classée arrête le profilage en nommant la table
  tables <- construire_tables_profil()
  tables$flores_a88$table$statut_observation[1] <- "Z"
  expect_error(
    profil_economie(tables, reference_profil),
    "flores_a88"
  )
  expect_error(
    profil_economie(tables, reference_profil),
    "statut d'observation non classé"
  )

  # SIRENE : un statut de diffusion hors vocabulaire (O/P)
  tables2 <- construire_tables_profil()
  tables2$sirene_snapshot$table$statut_diffusion[1] <- "Q"
  expect_error(
    profil_economie(tables2, reference_profil),
    "sirene_snapshot"
  )
  expect_error(
    profil_economie(tables2, reference_profil),
    "statut de diffusion non classé"
  )

  # SIRENE : un motif d'exclusion hors vocabulaire (le rapport d'éligibilité
  # ne peut inventer une raison)
  tables3 <- construire_tables_profil()
  tables3$sirene_snapshot$exclusions$raison[1] <- "inconnue"
  expect_error(
    profil_economie(tables3, reference_profil),
    "sirene_snapshot"
  )
  expect_error(
    profil_economie(tables3, reference_profil),
    "motif d'exclusion non classé"
  )
})

test_that("échec bruyant : une table absente ou une référence sans CODGEO", {
  tables <- construire_tables_profil()

  # une table du contrat manque -> l'erreur nomme la table absente
  sans_rp <- tables[names(tables) != "rp_emploi"]
  expect_error(profil_economie(sans_rp, reference_profil), "rp_emploi")

  # une table inattendue -> l'erreur la nomme
  avec_extra <- tables
  avec_extra$autre_table <- avec_extra$rp_emploi
  expect_error(profil_economie(avec_extra, reference_profil), "autre_table")

  # la référence sans la colonne CODGEO (la clé des jointures) est refusée
  mauvaise_ref <- reference_profil
  mauvaise_ref$CODGEO <- NULL
  expect_error(profil_economie(tables, mauvaise_ref), "CODGEO")
})
