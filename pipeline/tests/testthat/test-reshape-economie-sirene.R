# La normalisation du snapshot SIRENE (todo 9, plan economie-pipeline-contracts
# — la bascule régionale) -------------------------------------------------------
# L'export régional data.bretagne.bzh (jeu « sirene-v3-consolidee », vocabulaire
# ODS minuscules) vers la table communale longue et creuse du thème
# Économie/Emploi : une ligne par cellule commune × code APE (NAF rév. 2, 5
# chiffres) × tranche d'effectifs, le nombre d'établissements ACTIFS comme
# valeur. Le statut de diffusion n'est PAS retenu (décision todo 9 : chaque
# établissement actif avec commune et code APE exploitables compte) — les
# jumelles O/P d'une même cellule fusionnent en une ligne. Le mini-fixture
# (fixtures/sirene-snapshot-fixture.csv) reproduit le vocabulaire ODS RÉEL de
# l'export (libellés « Actif »/« Fermé », tranches en libellés,
# classeetablissement = libellé APET) ; les champs exacts viennent du CONTRAT
# (MANIFEST_ECONOMIE_SIRENE) — la normalisation consomme le manifeste, elle ne
# le re-épingle pas. Aucun appel réseau dans la boucle de test
# (docs/architecture.md §Testing).

fixture_sirene <- load_fixture_sirene()

test_that("l'enveloppe commune et les champs SIRENE : la forme du contrat", {
  res <- normaliser_sirene_snapshot(fixture_sirene)

  # l'enveloppe commune (docs/themes/economie-emploi.md) : commune |
  # activity_code | activity_label | value | measure | source | vintage
  expect_true(all(c("commune", "activity_code", "activity_label", "value",
                    "measure", "source", "vintage") %in% names(res$table)))
  # plus les champs spécifiques SIRENE régional : statut actif, tranche
  # d'effectifs, version NAF — PAS de statut de diffusion (non retenu)
  expect_equal(
    names(res$table),
    c("commune", "activity_code", "activity_label", "value", "measure",
      "source", "vintage", "etat_administratif", "tranche_effectifs",
      "naf_version")
  )
  expect_false("statut_diffusion" %in% names(res$table))
  # la mesure est le nombre d'établissements ACTIFS ; la source et le millésime
  # viennent du manifeste (jamais recopiés à la main)
  expect_true(all(res$table$measure == "ETABLISSEMENTS_ACTIFS"))
  expect_true(all(res$table$source == MANIFEST_ECONOMIE_SIRENE$source))
  expect_true(all(res$table$vintage == MANIFEST_ECONOMIE_SIRENE$vintage))
  expect_true(all(res$table$naf_version == MANIFEST_ECONOMIE_SIRENE$naf_version))
})

test_that("communes bretonnes uniquement : tous les codes sont des codes de référence 22/29/35/56", {
  res <- normaliser_sirene_snapshot(fixture_sirene)

  # toutes les communes retenues portent un département breton (le jeu régional
  # est pré-découpé ; la garde reste une validation défensive)
  expect_true(all(substr(res$table$commune, 1, 2) %in% DEPT_BRETAGNE))
  # les quatre départements bretons sont représentés, la non-bretonne (44001)
  # et le département inconnu (12345) sont absents
  expect_setequal(res$table$commune, c("22001", "29001", "35001", "56001"))
})

test_that("actifs seuls : aucune ligne n'a un statut non actif", {
  res <- normaliser_sirene_snapshot(fixture_sirene)

  # le filtre du manifeste (etatadministratifetablissement = 'Actif' — le
  # libellé ODS) est porté par la colonne SIRENE retenue : elle vaut 'Actif'
  # partout, sans exception
  expect_true(all(res$table$etat_administratif == "Actif"))
  expect_false(any(res$table$etat_administratif %in% c("Fermé", NA)))
})

test_that("la diffusion n'est pas retenue : les jumelles O/P fusionnent en une cellule", {
  res <- normaliser_sirene_snapshot(fixture_sirene)

  # l'établissement en diffusion partielle côté INSEE (et sa jumelle O) ne se
  # distinguent que par un statut NON retenu (todo 9) : une seule cellule
  # 22001 × 47.11Z × « 20 à 49 salariés », valeur 2 — la diffusion n'existe
  # plus comme dimension de grain
  cellule <- res$table[res$table$commune == "22001" &
                         res$table$activity_code == "47.11Z", ]
  expect_equal(nrow(cellule), 1)
  expect_equal(cellule$value, 2)
  expect_equal(cellule$tranche_effectifs, "20 à 49 salariés")
})

test_that("le décompte des établissements actifs par cellule commune × code APE × tranche", {
  res <- normaliser_sirene_snapshot(fixture_sirene)

  valeur <- function(commune, naf, tranche) {
    res$table$value[res$table$commune == commune &
                      res$table$activity_code == naf &
                      res$table$tranche_effectifs == tranche]
  }
  # deux établissements actifs sur la même cellule → value = 2
  expect_equal(valeur("22001", "01.11Z", "0 salarié"), 2)
  expect_equal(valeur("22001", "47.11Z", "20 à 49 salariés"), 2)
  # les cellules simples → value = 1
  expect_equal(valeur("29001", "62.01Z", "10 à 19 salariés"), 1)
  expect_equal(valeur("35001", "86.10Z", "Etablissement non employeur"), 1)
  expect_equal(valeur("56001", "01.11Z", "6 à 9 salariés"), 1)
})

test_that("la table est longue et creuse : une ligne par cellule observée, aucune cellule à zéro", {
  res <- normaliser_sirene_snapshot(fixture_sirene)

  # 7 établissements actifs répartis sur 5 cellules observées : les cellules
  # non observées (0 établissement) n'existent tout simplement pas
  expect_equal(nrow(res$table), 5)
  expect_true(nrow(res$table) > length(unique(res$table$commune)))
  # chaque ligne est une cellule observée : value >= 1, pas de doublon de clé
  # (le grain est commune × code APE × tranche — plus de dimension diffusion)
  expect_true(all(res$table$value >= 1))
  expect_equal(anyDuplicated(res$table[c("commune", "activity_code",
                                         "tranche_effectifs")]), 0L)
  # les cellules agrégées du grain fin redonnent bien le total par commune × NAF
  agrege <- res$table %>%
    dplyr::group_by(commune, activity_code) %>%
    dplyr::summarise(n = sum(value), .groups = "drop")
  expect_equal(agrege$n[agrege$commune == "22001" &
                          agrege$activity_code == "47.11Z"], 2)
})

test_that("le libellé du code APE vient de classeetablissement (le vocabulaire ODS)", {
  res <- normaliser_sirene_snapshot(fixture_sirene)

  # le libellé APET est porté par classeetablissement dans le jeu régional
  # (il n'existe PAS de libelleActivitePrincipaleEtablissement) — le libellé
  # retenu est celui du champ épinglé par le manifeste
  c01 <- res$table[res$table$commune == "22001" &
                     res$table$activity_code == "01.11Z", ]
  expect_equal(c01$activity_label,
               "Culture de céréales (à l'exception du riz), de légumineuses et de graines oléagineuses")
  expect_equal(res$table$activity_label[res$table$activity_code == "62.01Z"],
               "Programmation informatique")

  # quand le snapshot ne porte PAS le libellé épinglé par le manifeste
  # (classeetablissement), le contrat du manifeste est violé : la normalisation
  # s'arrête — le libellé déclaré est un champ OBLIGATOIRE de l'export
  sans_libelle <- fixture_sirene
  sans_libelle$classeetablissement <- NULL
  expect_error(normaliser_sirene_snapshot(sans_libelle), "champs absents")
})

test_that("la tranche d'effectifs reste de la métadonnée, jamais convertie en effectif", {
  res <- normaliser_sirene_snapshot(fixture_sirene)

  # les tranches sources sont conservées telles quelles (les libellés ODS)
  expect_setequal(res$table$tranche_effectifs,
                  c("0 salarié", "6 à 9 salariés", "10 à 19 salariés",
                    "20 à 49 salariés", "Etablissement non employeur"))
  # et aucune colonne d'effectifs salariés ESTIMÉS n'apparaît (la tranche
  # retenue est la métadonnée ; l'estimation d'emploi est hors contrat)
  expect_false(any(grepl("salari|emploi|estime", names(res$table),
                         ignore.case = TRUE)))
})

test_that("aucune matrice de présence ni colonne 'presence'/'matrix' n'existe", {
  res <- normaliser_sirene_snapshot(fixture_sirene)

  # guardrail du plan : pas de matrice binaire, pas de seuil de présence, pas
  # d'estimation d'emploi — la table est un comptage long et creux
  expect_false(any(grepl("presence|matrix", names(res$table),
                         ignore.case = TRUE)))
  expect_false(any(res$table$value %in% c(0, NA)))
})

test_that("le rapport d'exclusions compte les lignes inutilisables avec leur motif", {
  res <- normaliser_sirene_snapshot(fixture_sirene)

  # 7 lignes rejetées sur 14 : fermé, commune manquante, commune au format
  # invalide, commune hors Bretagne (×2), code APE manquant, code APE invalide
  expect_equal(nrow(res$exclusions), 7)
  # les motifs appartiennent tous au vocabulaire documenté du normaliseur
  expect_true(all(res$exclusions$raison %in% RAISONS_EXCLUSION_SIRENE))
  motifs <- table(res$exclusions$raison)
  expect_equal(as.integer(motifs["ferme"]), 1)
  expect_equal(as.integer(motifs["commune_manquante"]), 1)
  expect_equal(as.integer(motifs["commune_invalide"]), 1)
  expect_equal(as.integer(motifs["commune_hors_bretagne"]), 2)
  expect_equal(as.integer(motifs["naf_manquante"]), 1)
  expect_equal(as.integer(motifs["naf_invalide"]), 1)

  # chaque motif nomme la ligne fautive (siret) pour inspection
  expect_setequal(
    res$exclusions$siret[res$exclusions$raison == "ferme"],
    "00000000600001"
  )
  expect_setequal(
    res$exclusions$siret[res$exclusions$raison == "commune_manquante"],
    "00000000700001"
  )
  expect_setequal(
    res$exclusions$siret[res$exclusions$raison == "naf_manquante"],
    "00000000800001"
  )
  expect_setequal(
    res$exclusions$siret[res$exclusions$raison == "naf_invalide"],
    "00000001000001"
  )
  expect_setequal(
    res$exclusions$siret[res$exclusions$raison == "commune_invalide"],
    "00000001200001"
  )
  expect_setequal(
    res$exclusions$siret[res$exclusions$raison == "commune_hors_bretagne"],
    c("00000000900001", "00000001100001")
  )

  # le rapport porte les valeurs fautives : rien n'est perdu silencieusement
  # (plus de statut de diffusion — non retenu par le contrat)
  expect_true(all(c("siret", "raison", "commune", "naf",
                    "etat_administratif") %in% names(res$exclusions)))
  expect_false("statut_diffusion" %in% names(res$exclusions))
  # les 7 établissements retenus du fixture ne figurent pas dans le rapport :
  # l'exclusion et la rétention sont des partitions de l'entrée
  expect_setequal(
    setdiff(fixture_sirene$siret, res$exclusions$siret),
    c("00000000100001", "00000000100002", "00000000200001",
      "00000000200002", "00000000300001", "00000000400001",
      "00000000500001")
  )
  # le total des établissements actifs est conservé dans la table
  expect_equal(sum(res$table$value), 7)
})

test_that("le contrat du manifeste est vérifié avant la normalisation", {
  # la normalisation consomme le CONTRAT : un manifeste qui le viole (URL
  # historique data.gouv) arrête la normalisation avant tout filtrage
  mauvais <- MANIFEST_ECONOMIE_SIRENE
  mauvais$url <- paste0(
    "https://www.data.gouv.fr/api/1/datasets/r/",
    "88fbb6b4-0320-443e-b739-b4376a012c32"
  )
  expect_error(normaliser_sirene_snapshot(fixture_sirene, mauvais),
               "historique")

  # et un snapshot sans les champs épinglés par le manifeste est refusé : le
  # code APE comme le libellé déclaré (classeetablissement) et le champ de
  # fraîcheur (datederniertraitementetablissement) sont obligatoires
  incomplet <- fixture_sirene
  incomplet$activiteprincipaleetablissement <- NULL
  expect_error(normaliser_sirene_snapshot(incomplet), "champs absents")
  sans_libelle <- fixture_sirene
  sans_libelle$classeetablissement <- NULL
  expect_error(normaliser_sirene_snapshot(sans_libelle), "champs absents")
  sans_traitement <- fixture_sirene
  sans_traitement$datederniertraitementetablissement <- NULL
  expect_error(normaliser_sirene_snapshot(sans_traitement), "champs absents")
})

test_that("la date de référence est auto-vérifiée contre le fichier (le fichier a le dernier mot)", {
  # le maximum de datederniertraitementetablissement parmi les lignes RETENUES
  # doit égaler EXACTEMENT la date de référence épinglée par le manifeste — le
  # fichier a le dernier mot sur sa propre date (la notice du jeu ne fait que
  # l'annoncer). Tolérance zéro jour : as.Date lit la composante date UTC
  # telle qu'écrite dans l'ISO — un traitement à 2026-03-31T23:41:59+00:00
  # reste le 2026-03-31, sans débordement au jour suivant.
  expect_no_error(normaliser_sirene_snapshot(fixture_sirene))

  # un fichier rafraîchi vers un stock plus récent déplace le maximum : le
  # contrat échoue bruyamment, en nommant la date du manifeste ET la date
  # observée — le seam du watchdog qui force la mise à jour consciente du
  # manifeste
  plus_recent <- fixture_sirene
  plus_recent$datederniertraitementetablissement[
    plus_recent$siret == "00000000300001"
  ] <- "2026-04-15T10:00:00+00:00"
  expect_error(normaliser_sirene_snapshot(plus_recent), "2026-03-31")
  expect_error(normaliser_sirene_snapshot(plus_recent), "2026-04-15")
  expect_error(normaliser_sirene_snapshot(plus_recent), "date_reference")

  # une colonne de traitement entièrement vide est aussi une violation : on ne
  # vérifie jamais silencieusement la fraîcheur d'un fichier muet
  sans_dates <- fixture_sirene
  sans_dates$datederniertraitementetablissement <- NA_character_
  expect_error(normaliser_sirene_snapshot(sans_dates), "date_reference")
})

test_that("construire_sirene_normalise persiste la table et le rapport sous data/processed/economie/", {
  sortie <- tempfile("sirene-normalise-", fileext = ".rds")
  on.exit(unlink(sortie), add = TRUE)

  # le constructeur accepte le snapshot directement (les tests passent la
  # fixture ; le pipeline réel lit le cache brut — même chemin de code)
  table <- construire_sirene_normalise(snapshot = fixture_sirene, sortie = sortie)

  expect_equal(nrow(table), 5)
  expect_true(file.exists(sortie))
  # le rapport d'exclusions est persisté à côté, dans la même localisation
  sortie_exclusions <- sub("\\.rds$", "_exclusions.rds", sortie)
  expect_true(file.exists(sortie_exclusions))
  expect_equal(nrow(readr::read_rds(sortie_exclusions)), 7)
  # la localisation par défaut est le dossier Économie/Emploi des données
  # processées — data/ étant ignoré par git, seul le chemin est vérifié
  expect_match(as.character(formals(construire_sirene_normalise)$sortie),
               "data/processed/economie/")
})
