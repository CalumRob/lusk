# test-analytics-economie-lq-flores --------------------------------------------
# L'analyse LQ d'emploi de la source Flores (plan economie-analytical-phase,
# todo 2 — gates B/D verrouillées 2026-08-05) : la MÊME fonction, paramétrée
# par grain, transforme la table Flores normalisée (flores_a88 / flores_a38,
# docs/themes/economie-emploi.md) en LQ de Balassa CONTINUE par commune ×
# secteur sur `effectifs_salaries` vs la moyenne bretonne :
#     LQ_ca = (n_ca / n_c.) / (n_.a / n_..)
# Le noyau partagé de T1 (analytics_economie_lq.R) est RÉUTILISÉ tel quel :
# appliquer_plancher_communes (gate D) et calculer_lq_balassa (gate E) — le
# grain ne change que l'agrégation d'entrée :
#   - A88 : pas de colonne tranche (les fichiers A88 ne sont pas déclinés par
#     tranche) ; la ligne d'activité _T (le total de la commune) est EXCLUE ;
#   - A38 : seules les lignes tranche_effectifs == "_T" (les totaux par poste)
#     portent les effectifs du grain ; les lignes de détail et le _T activité
#     sont exclus.
# Le plancher gate D (≥ 5 salariés au total de la commune, la somme de ligne)
# SUPPRIME et COMPTE — le rapport de suppression est un artefact, jamais une
# suppression silencieuse : la preuve réelle (48 821 lignes A88, 1202
# communes) supprime 6 communes (min = 2 salariés). A88 est livrée d'abord
# (lq_emploi_a88.rds) ; A38 passe par la MÊME fonction (test des deux grains).
# Aucun crosswalk A88↔A38↔NAF, aucune fusion des grains, aucune date alignée.

# Les fixtures analytiques -----------------------------------------------------
# Deux mini tables Flores normalisées (la forme de normaliser_flores_a88 /
# normaliser_flores_a38) calculées À LA MAIN. Mêmes communes, mêmes totaux
# bretons (0,4 / 0,2 / 0,4) — mais les nomenclatures diffèrent, donc les LQ
# d'une même commune peuvent diverger entre les grains (le test « désaccord ») :
#
# A88 (3 secteurs à 2 chiffres + la ligne _T exclue + une mesure etablissements) :
#   22001 : 01 = 2 · 47 = 3 · 86 = 5   (total 10, _T = 10)
#   29001 : 01 = 4 · 47 = 1 · 86 = 5   (total 10, _T = 10)
#   35001 : 01 = 6 · 47 = 2 · 86 = 2   (total 10, _T = 10)
#   56001 : 01 = 1 · 47 = 1 · 86 = 1   (total 3 — SOUS LE PLANCHER, _T = 3)
#   Totaux bretons retenus : 01 = 12 · 47 = 6 · 86 = 12 · total = 30
#   → LQ 22001 : 0,5 · 1,5 · 1,25 — LQ 29001 : 1,0 (LQ = 1) · 0,5 · 1,25
#   → LQ 35001 : 1,5 · 1,0 · 0,5
#
# A38 (3 postes à 2 lettres + la ligne _T exclue + des tranches de détail qui
# PORTERAIENT une LQ fausse si le filtre tranche == "_T" n'était pas appliqué) :
#   22001 : AZ = 6 · DZ = 2 · FZ = 2   (total 10, _T = 10)
#   29001 : AZ = 4 · DZ = 1 · FZ = 5   (total 10, _T = 10)
#   35001 : AZ = 2 · DZ = 3 · FZ = 5   (total 10, _T = 10)
#   56001 : AZ = 1 · DZ = 1 · FZ = 1   (total 3 — SOUS LE PLANCHER, _T = 3)
#   Totaux bretons retenus : AZ = 12 · DZ = 6 · FZ = 12 · total = 30
#   → LQ 22001 : 1,5 · 1,0 · 0,5 — LQ 29001 : 1,0 (LQ = 1) · 0,5 · 1,25
#   → LQ 35001 : 0,5 · 1,5 · 1,25
#
# La cellule de désaccord entre grains : 22001 × « Agriculture » — A88 (01) =
# 0,5, A38 (AZ) = 1,5 : les deux nomenclatures agrègent différemment.
fixture_flores_lq_a88 <- function() {
  tibble::tribble(
    ~commune, ~departement, ~concept, ~classification, ~activity_code,
    ~activity_label, ~measure, ~value, ~statut_observation, ~source, ~vintage,
    # 22001 — trois secteurs + le total _T (exclu) + une mesure etablissements
    "22001", "22", "Emploi au lieu de travail", "A88", "01",
    "Agriculture, sylviculture et pêche", "effectifs_salaries", 2,
    "A", "DS_FLORES_A88_2024", "2024",
    "22001", "22", "Emploi au lieu de travail", "A88", "47",
    "Commerce de détail", "effectifs_salaries", 3,
    "A", "DS_FLORES_A88_2024", "2024",
    "22001", "22", "Emploi au lieu de travail", "A88", "86",
    "Activités pour la santé humaine", "effectifs_salaries", 5,
    "A", "DS_FLORES_A88_2024", "2024",
    "22001", "22", "Emploi au lieu de travail", "A88", "_T",
    "Total", "effectifs_salaries", 10,
    "A", "DS_FLORES_A88_2024", "2024",
    "22001", "22", "Emploi au lieu de travail", "A88", "01",
    "Agriculture, sylviculture et pêche", "etablissements", 3,
    "A", "DS_FLORES_A88_2024", "2024",
    # 29001
    "29001", "29", "Emploi au lieu de travail", "A88", "01",
    "Agriculture, sylviculture et pêche", "effectifs_salaries", 4,
    "A", "DS_FLORES_A88_2024", "2024",
    "29001", "29", "Emploi au lieu de travail", "A88", "47",
    "Commerce de détail", "effectifs_salaries", 1,
    "A", "DS_FLORES_A88_2024", "2024",
    "29001", "29", "Emploi au lieu de travail", "A88", "86",
    "Activités pour la santé humaine", "effectifs_salaries", 5,
    "A", "DS_FLORES_A88_2024", "2024",
    "29001", "29", "Emploi au lieu de travail", "A88", "_T",
    "Total", "effectifs_salaries", 10,
    "A", "DS_FLORES_A88_2024", "2024",
    # 35001
    "35001", "35", "Emploi au lieu de travail", "A88", "01",
    "Agriculture, sylviculture et pêche", "effectifs_salaries", 6,
    "A", "DS_FLORES_A88_2024", "2024",
    "35001", "35", "Emploi au lieu de travail", "A88", "47",
    "Commerce de détail", "effectifs_salaries", 2,
    "A", "DS_FLORES_A88_2024", "2024",
    "35001", "35", "Emploi au lieu de travail", "A88", "86",
    "Activités pour la santé humaine", "effectifs_salaries", 2,
    "A", "DS_FLORES_A88_2024", "2024",
    "35001", "35", "Emploi au lieu de travail", "A88", "_T",
    "Total", "effectifs_salaries", 10,
    "A", "DS_FLORES_A88_2024", "2024",
    # 56001 — sous le plancher (total 3)
    "56001", "56", "Emploi au lieu de travail", "A88", "01",
    "Agriculture, sylviculture et pêche", "effectifs_salaries", 1,
    "A", "DS_FLORES_A88_2024", "2024",
    "56001", "56", "Emploi au lieu de travail", "A88", "47",
    "Commerce de détail", "effectifs_salaries", 1,
    "A", "DS_FLORES_A88_2024", "2024",
    "56001", "56", "Emploi au lieu de travail", "A88", "86",
    "Activités pour la santé humaine", "effectifs_salaries", 1,
    "A", "DS_FLORES_A88_2024", "2024",
    "56001", "56", "Emploi au lieu de travail", "A88", "_T",
    "Total", "effectifs_salaries", 3,
    "A", "DS_FLORES_A88_2024", "2024"
  )
}

fixture_flores_lq_a38 <- function() {
  tibble::tribble(
    ~commune, ~departement, ~concept, ~classification, ~activity_code,
    ~activity_label, ~tranche_effectifs, ~tranche_libelle, ~measure, ~value,
    ~statut_observation, ~source, ~vintage,
    # 22001 — les totaux _T par poste + des tranches de détail pièges
    "22001", "22", "Emploi au lieu de travail", "A38", "AZ",
    "Agriculture, sylviculture et pêche", "_T", "Total",
    "effectifs_salaries", 6, "A", "DS_FLORES_A38_2024", "2024",
    "22001", "22", "Emploi au lieu de travail", "A38", "DZ",
    "Production et distribution d'énergie", "_T", "Total",
    "effectifs_salaries", 2, "A", "DS_FLORES_A38_2024", "2024",
    "22001", "22", "Emploi au lieu de travail", "A38", "FZ",
    "Construction", "_T", "Total",
    "effectifs_salaries", 2, "A", "DS_FLORES_A38_2024", "2024",
    "22001", "22", "Emploi au lieu de travail", "A38", "_T",
    "Total", "_T", "Total",
    "effectifs_salaries", 10, "A", "DS_FLORES_A38_2024", "2024",
    # les tranches de détail PORTERAIENT une LQ fausse si le grain ne filtrait
    # pas tranche_effectifs == "_T" (1 + 2 ≠ 6)
    "22001", "22", "Emploi au lieu de travail", "A38", "AZ",
    "Agriculture, sylviculture et pêche", "E1T4", "1 à 4 salariés",
    "effectifs_salaries", 1, "A", "DS_FLORES_A38_2024", "2024",
    "22001", "22", "Emploi au lieu de travail", "A38", "AZ",
    "Agriculture, sylviculture et pêche", "E5T9", "5 à 9 salariés",
    "effectifs_salaries", 2, "A", "DS_FLORES_A38_2024", "2024",
    # une mesure etablissements (exclue par le filtre measure)
    "22001", "22", "Emploi au lieu de travail", "A38", "AZ",
    "Agriculture, sylviculture et pêche", "_T", "Total",
    "etablissements", 3, "A", "DS_FLORES_A38_2024", "2024",
    # 29001
    "29001", "29", "Emploi au lieu de travail", "A38", "AZ",
    "Agriculture, sylviculture et pêche", "_T", "Total",
    "effectifs_salaries", 4, "A", "DS_FLORES_A38_2024", "2024",
    "29001", "29", "Emploi au lieu de travail", "A38", "DZ",
    "Production et distribution d'énergie", "_T", "Total",
    "effectifs_salaries", 1, "A", "DS_FLORES_A38_2024", "2024",
    "29001", "29", "Emploi au lieu de travail", "A38", "FZ",
    "Construction", "_T", "Total",
    "effectifs_salaries", 5, "A", "DS_FLORES_A38_2024", "2024",
    "29001", "29", "Emploi au lieu de travail", "A38", "_T",
    "Total", "_T", "Total",
    "effectifs_salaries", 10, "A", "DS_FLORES_A38_2024", "2024",
    # 35001
    "35001", "35", "Emploi au lieu de travail", "A38", "AZ",
    "Agriculture, sylviculture et pêche", "_T", "Total",
    "effectifs_salaries", 2, "A", "DS_FLORES_A38_2024", "2024",
    "35001", "35", "Emploi au lieu de travail", "A38", "DZ",
    "Production et distribution d'énergie", "_T", "Total",
    "effectifs_salaries", 3, "A", "DS_FLORES_A38_2024", "2024",
    "35001", "35", "Emploi au lieu de travail", "A38", "FZ",
    "Construction", "_T", "Total",
    "effectifs_salaries", 5, "A", "DS_FLORES_A38_2024", "2024",
    "35001", "35", "Emploi au lieu de travail", "A38", "_T",
    "Total", "_T", "Total",
    "effectifs_salaries", 10, "A", "DS_FLORES_A38_2024", "2024",
    # 56001 — sous le plancher (total 3)
    "56001", "56", "Emploi au lieu de travail", "A38", "AZ",
    "Agriculture, sylviculture et pêche", "_T", "Total",
    "effectifs_salaries", 1, "A", "DS_FLORES_A38_2024", "2024",
    "56001", "56", "Emploi au lieu de travail", "A38", "DZ",
    "Production et distribution d'énergie", "_T", "Total",
    "effectifs_salaries", 1, "A", "DS_FLORES_A38_2024", "2024",
    "56001", "56", "Emploi au lieu de travail", "A38", "FZ",
    "Construction", "_T", "Total",
    "effectifs_salaries", 1, "A", "DS_FLORES_A38_2024", "2024",
    "56001", "56", "Emploi au lieu de travail", "A38", "_T",
    "Total", "_T", "Total",
    "effectifs_salaries", 3, "A", "DS_FLORES_A38_2024", "2024"
  )
}

# Le chemin des vraies tables normalisées (gitignorées ; absentes hors worktree
# — le test saute proprement sur une machine sans la donnée)
chemin_flores_reel <- function(grain) {
  testthat::test_path("..", "..", "data", "processed", "economie",
                      paste0("flores_", tolower(grain), ".rds"))
}

# 1. A88 : la LQ de Balassa sur la fixture calculée à la main ------------------
test_that("A88 : la LQ de Balassa correspond à la formule calculée à la main (cellule LQ = 1)", {
  res <- calculer_lq_emploi_flores(fixture_flores_lq_a88(), "A88")
  lq <- res$lq

  # une ligne par cellule commune × secteur retenue (3 communes × 3 secteurs)
  expect_equal(nrow(lq), 9)
  expect_setequal(lq$commune, c("22001", "29001", "35001"))
  # les colonnes de transparence du noyau partagé
  expect_true(all(c("commune", "activity_code", "activity_label", "lq",
                    "n", "n_c", "n_a") %in% names(lq)))

  lq_cellule <- function(commune, act) {
    lq$lq[lq$commune == commune & lq$activity_code == act]
  }
  # 22001 : (2/10)/0,4 = 0,5 · (3/10)/0,2 = 1,5 · (5/10)/0,4 = 1,25
  expect_equal(lq_cellule("22001", "01"), 0.5)
  expect_equal(lq_cellule("22001", "47"), 1.5)
  expect_equal(lq_cellule("22001", "86"), 1.25)
  # 29001 : la cellule où la part de la commune ÉGALE la part bretonne → LQ = 1
  expect_equal(lq_cellule("29001", "01"), 1)
  expect_equal(lq_cellule("29001", "47"), 0.5)
  expect_equal(lq_cellule("29001", "86"), 1.25)
  # 35001 : (6/10)/0,4 = 1,5 · (2/10)/0,2 = 1,0 · (2/10)/0,4 = 0,5
  expect_equal(lq_cellule("35001", "01"), 1.5)
  expect_equal(lq_cellule("35001", "47"), 1)
  expect_equal(lq_cellule("35001", "86"), 0.5)

  # transparence : n_c = 10 par commune — la ligne d'activité _T (total, 10)
  # et la mesure etablissements n'entrent JAMAIS dans les totaux
  expect_true(all(lq$n_c == 10))
  expect_false("_T" %in% lq$activity_code)
  n_a_par_secteur <- lq %>%
    dplyr::select(activity_code, n_a) %>%
    dplyr::distinct() %>%
    dplyr::arrange(activity_code)
  expect_equal(n_a_par_secteur$n_a, c(12, 6, 12))
  # LQ continues, strictement positives, non seuillées
  expect_true(all(lq$lq > 0))
  expect_true(any(lq$lq < 1) & any(lq$lq > 1))
})

# 2. La MÊME fonction tourne les deux grains -----------------------------------
test_that("la MÊME fonction calcule A88 et A38 (le grain paramètre la table)", {
  # seul le paramètre grain change — le même chemin de code
  r88 <- calculer_lq_emploi_flores(fixture_flores_lq_a88(), "A88")
  r38 <- calculer_lq_emploi_flores(fixture_flores_lq_a38(), "A38")
  expect_equal(nrow(r88$lq), 9)
  expect_equal(nrow(r38$lq), 9)

  # A38 : les LQ se calculent sur les lignes tranche_effectifs == "_T"
  # uniquement — les tranches de détail de la fixture (1 + 2 ≠ 6) PORTERAIENT
  # une LQ fausse si le filtre de grain n'était pas appliqué
  lq38 <- r38$lq
  lq38_cellule <- function(commune, act) {
    lq38$lq[lq38$commune == commune & lq38$activity_code == act]
  }
  # 22001 : (6/10)/0,4 = 1,5 · (2/10)/0,2 = 1,0 · (2/10)/0,4 = 0,5
  expect_equal(lq38_cellule("22001", "AZ"), 1.5)
  expect_equal(lq38_cellule("22001", "DZ"), 1)
  expect_equal(lq38_cellule("22001", "FZ"), 0.5)
  # 29001 : la cellule LQ = 1 existe aussi en A38
  expect_equal(lq38_cellule("29001", "AZ"), 1)
  expect_equal(lq38_cellule("29001", "DZ"), 0.5)
  expect_equal(lq38_cellule("29001", "FZ"), 1.25)
  # 35001
  expect_equal(lq38_cellule("35001", "AZ"), 0.5)
  expect_equal(lq38_cellule("35001", "DZ"), 1.5)
  expect_equal(lq38_cellule("35001", "FZ"), 1.25)
  # le total _T de la commune est exclu du grain A38 lui aussi
  expect_true(all(lq38$n_c == 10))
  expect_false("_T" %in% lq38$activity_code)
})

# 3. Le plancher de commune gate D (≥ 5 salariés) ------------------------------
test_that("le plancher de commune (≥ 5 salariés) supprime ET compte (A88)", {
  res <- calculer_lq_emploi_flores(fixture_flores_lq_a88(), "A88")

  # 56001 (3 salariés) est exclue du calcul...
  expect_false("56001" %in% res$lq$commune)
  # ...et COMPTÉE dans le rapport de suppression — jamais écartée en silence
  expect_true("56001" %in% res$suppression$commune)
  expect_equal(res$suppression$n_total[res$suppression$commune == "56001"], 3)
  # le seuil du noyau partagé est documenté dans le rapport
  expect_equal(unique(res$suppression$seuil_commune), SEUIL_PLANCHER_COMMUNES_LQ)
  # les trois communes au-dessus du plancher sont retenues
  expect_setequal(res$lq$commune, c("22001", "29001", "35001"))
})

test_that("une commune AU plancher (exactement 5 salariés) est retenue", {
  # 5 salariés exactement → le plancher (n ≥ 5) la garde
  flores <- fixture_flores_lq_a88() %>%
    dplyr::filter(commune != "56001") %>%
    dplyr::bind_rows(tibble::tibble(
      commune = "56001", departement = "56",
      concept = "Emploi au lieu de travail", classification = "A88",
      activity_code = "01", activity_label = "Agriculture, sylviculture et pêche",
      measure = "effectifs_salaries", value = 5,
      statut_observation = "A", source = "DS_FLORES_A88_2024", vintage = "2024"
    ))
  res <- calculer_lq_emploi_flores(flores, "A88")
  expect_true("56001" %in% res$lq$commune)
  expect_false("56001" %in% res$suppression$commune)
})

# 4. A88 et A38 DISENT des LQ différentes sur une cellule à la main -------------
test_that("une cellule où A88 et A38 DISENT des LQ différentes échoue si on les confond", {
  lq88 <- calculer_lq_emploi_flores(fixture_flores_lq_a88(), "A88")$lq
  lq38 <- calculer_lq_emploi_flores(fixture_flores_lq_a38(), "A38")$lq

  # 22001 × « Agriculture » : A88 (division 01) = 0,5, A38 (poste AZ) = 1,5 —
  # les deux nomenclatures agrègent différemment, la LQ de la même commune
  # peut diverger. Un code qui confondrait les grains (résultat identique)
  # échoue ici bruyamment.
  cell88 <- lq88$lq[lq88$commune == "22001" & lq88$activity_code == "01"]
  cell38 <- lq38$lq[lq38$commune == "22001" & lq38$activity_code == "AZ"]
  expect_equal(cell88, 0.5)
  expect_equal(cell38, 1.5)
  expect_false(isTRUE(all.equal(cell88, cell38)))
})

# 5. L'orchestrateur + la persistance -------------------------------------------
test_that("construire_analytique_lq_flores persiste lq_emploi_a88 + rapport (A38 via la même fonction)", {
  sortie <- tempfile("analytique-lq-flores-")
  on.exit(unlink(sortie, recursive = TRUE), add = TRUE)

  res <- construire_analytique_lq_flores(
    fixture_flores_lq_a88(), "A88", sortie = sortie
  )

  # A88 est le grain livré : lq_emploi_a88.rds + le rapport de suppression
  expect_setequal(list.files(sortie),
                  c("lq_emploi_a88.rds", "suppression_emploi_a88.rds"))
  lq_relue <- readRDS(file.path(sortie, "lq_emploi_a88.rds"))
  expect_identical(res$lq, lq_relue)
  expect_equal(nrow(lq_relue), 9)
  suppression <- readRDS(file.path(sortie, "suppression_emploi_a88.rds"))
  expect_true("56001" %in% suppression$commune)
  expect_named(res, c("lq", "suppression"))

  # le grain A38 passe par la MÊME fonction de construction
  res38 <- construire_analytique_lq_flores(
    fixture_flores_lq_a38(), "A38", sortie = sortie
  )
  expect_true(file.exists(file.path(sortie, "lq_emploi_a38.rds")))
  expect_true(file.exists(file.path(sortie, "suppression_emploi_a38.rds")))
  expect_equal(nrow(res38$lq), 9)
})

test_that("relancer l'analyse Flores est déterministe (octet-pour-octet)", {
  r1 <- calculer_lq_emploi_flores(fixture_flores_lq_a88(), "A88")
  r2 <- calculer_lq_emploi_flores(fixture_flores_lq_a88(), "A88")
  expect_identical(r1$lq, r2$lq)
  expect_identical(r1$suppression, r2$suppression)
})

# 6. Le contrat de grain échoue bruyamment --------------------------------------
test_that("un grain inconnu est refusé", {
  expect_error(
    calculer_lq_emploi_flores(fixture_flores_lq_a88(), "A99"),
    "A88"
  )
})

test_that("A88 avec une colonne tranche_effectifs est refusé (contrat de grain)", {
  # les fichiers A88 ne sont pas déclinés par tranche — une colonne tranche
  # serait une violation du contrat : refusée, jamais devinée
  flores <- fixture_flores_lq_a88() %>% dplyr::mutate(tranche_effectifs = "_T")
  expect_error(calculer_lq_emploi_flores(flores, "A88"), "tranche")
})

test_that("A38 sans colonne tranche_effectifs est refusé (contrat de grain)", {
  flores <- fixture_flores_lq_a38() %>% dplyr::select(-tranche_effectifs)
  expect_error(calculer_lq_emploi_flores(flores, "A38"), "tranche")
})

test_that("une valeur effectifs manquante (non diffusée) échoue — jamais silencieux", {
  # une cellule K (valeur NA) au grain _T ne peut pas entrer dans le calcul :
  # l'analyse refuse bruyamment plutôt que de sous-compter la commune
  flores <- fixture_flores_lq_a38() %>%
    dplyr::bind_rows(tibble::tibble(
      commune = "29002", departement = "29",
      concept = "Emploi au lieu de travail", classification = "A38",
      activity_code = "AZ", activity_label = "Agriculture, sylviculture et pêche",
      tranche_effectifs = "_T", tranche_libelle = "Total",
      measure = "effectifs_salaries", value = NA_real_,
      statut_observation = "K", source = "DS_FLORES_A38_2024", vintage = "2024"
    ))
  expect_error(calculer_lq_emploi_flores(flores, "A38"), "manquante|non diffus")
})

# 7. Le chemin de joie RÉEL ------------------------------------------------------
test_that("la vraie table flores_a88 : 1202 communes, 6 supprimées (min = 2), LQ continues", {
  skip_if_not(file.exists(chemin_flores_reel("A88")),
              "flores_a88.rds n'est pas présente (worktree sans donnée).")
  flores <- readRDS(chemin_flores_reel("A88"))

  # la forme réelle connue (issue #92) : 48 821 lignes, 1202 communes
  expect_equal(nrow(flores), 48821)
  expect_equal(dplyr::n_distinct(flores$commune), 1202)

  res <- calculer_lq_emploi_flores(flores, "A88")

  # gate D : 6 communes sous le plancher (min = 2 salariés), TOUTES comptées
  # dans le rapport de suppression — jamais une suppression silencieuse
  expect_equal(nrow(res$suppression), 6)
  expect_equal(min(res$suppression$n_total), 2)
  expect_setequal(
    res$suppression$commune,
    c("22057", "22169", "22350", "35026", "35325", "56025")
  )
  # 1202 - 6 = 1196 communes retenues dans la LQ
  expect_equal(dplyr::n_distinct(res$lq$commune), 1196)
  # LQ continues, finies, positives — aucune valeur binaire
  expect_true(all(is.finite(res$lq$lq)))
  expect_true(all(res$lq$lq > 0))
  expect_true(any(res$lq$lq < 1) & any(res$lq$lq > 1))
  # déterministe
  expect_identical(res$lq,
                   calculer_lq_emploi_flores(flores, "A88")$lq)
})

test_that("la vraie table flores_a38 tourne via la MÊME fonction (mêmes 6 communes)", {
  skip_if_not(file.exists(chemin_flores_reel("A38")),
              "flores_a38.rds n'est pas présente (worktree sans donnée).")
  flores <- readRDS(chemin_flores_reel("A38"))

  # la forme réelle connue (issue #92) : 109 413 lignes, 1202 communes
  expect_equal(nrow(flores), 109413)
  expect_equal(dplyr::n_distinct(flores$commune), 1202)

  # le grain A38 filtre tranche_effectifs == "_T" — mêmes 6 communes supprimées
  res <- calculer_lq_emploi_flores(flores, "A38")
  expect_equal(nrow(res$suppression), 6)
  expect_equal(min(res$suppression$n_total), 2)
  expect_equal(dplyr::n_distinct(res$lq$commune), 1196)
  expect_true(all(is.finite(res$lq$lq)))
  expect_true(all(res$lq$lq > 0))
})
