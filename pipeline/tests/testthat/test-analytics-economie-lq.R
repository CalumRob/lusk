# test-analytics-economie-lq ----------------------------------------------------
# L'analyse LQ continue du thème Économie/Emploi (plan economie-analytical-phase,
# todo 1 — gates C/D/E verrouillées 2026-08-05) : à partir de la table réelle
# normalisée `sirene_snapshot` (commune × code APE × tranche d'effectifs →
# nombre d'établissements actifs), le chaînon analytique complet :
#   1. regroupement de la dimension tranche (somme value par commune × code APE) ;
#   2. plancher de commune gate D (total d'établissements actifs ≥ 5) — les
#      communes sous le plancher sont SUPPRIMÉES et COMPTÉES dans un rapport de
#      suppression, jamais écartées silencieusement ;
#   3. LQ de Balassa CONTINU par commune × code APE 5 chiffres vs la moyenne
#      bretonne (gate E) : LQ_ca = (n_ca / n_c.) / (n_.a / n_..), avec n_c. =
#      total de la commune, n_.a = total de l'activité sur la Bretagne retenue,
#      n_.. = total général — PAS de seuillage (gate C) ;
#   4. l'Histoire « ce que la commune sait faire » : les top-3 spécialisations
#      par LQ (décision de build : TOP_N = 3, documentée), valeurs CONTINUES
#      uniquement — une entrée binaire échoue bruyamment (gate C) ; sélection
#      déterministe (ADR-0002) : même entrée → même Histoire, pour toujours ;
#   5. la matrice M sidecar (LQ ≥ 1 binaire, commune × activité) comme artefact
#      SÉPARÉ pour la relatedness future (gate F, docs/research/relatedness.md
#      §5 Layer 1) — l'Histoire ne l'utilise jamais.
#
# La fixture (fixture_lq_analytique) est un mini snapshot normalisé calculé À LA
# MAIN : 4 communes × 3 codes APE ventilés sur plusieurs tranches (le
# regroupement est exercé), dont une commune sous le plancher (56001, 3
# établissements). Les attendus de LQ sont des fractions exactes — la cellule
# 29001 × 01.11Z vérifie le cas LQ = 1 (la part de la commune = la part
# bretonne). Le chemin de joie RÉEL (la vraie table, pipeline/data/) est aussi
# exercé : 1202 communes, 0 suppression (min = 10 établissements), comptes
# connus. Aucun appel réseau dans la boucle de test.

# La fixture analytique --------------------------------------------------------
# Un mini snapshot normalisé (la forme de normaliser_sirene_snapshot) : 14
# lignes, commune × code APE × tranche. Après regroupement des tranches :
#   22001 : 01.11Z = 2 · 47.11Z = 3 · 86.10Z = 5   (total 10)
#   29001 : 01.11Z = 4 · 47.11Z = 1 · 86.10Z = 5   (total 10)
#   35001 : 01.11Z = 6 · 47.11Z = 2 · 86.10Z = 2   (total 10)
#   56001 : 01.11Z = 1 · 47.11Z = 1 · 86.10Z = 1   (total 3 — SOUS LE PLANCHER)
# Totaux bretons retenus : 01.11Z = 12 · 47.11Z = 6 · 86.10Z = 12 · total = 30
# → parts bretonnes 0,4 / 0,2 / 0,4.
#   LQ 22001 : (2/10)/0,4 = 0,5 · (3/10)/0,2 = 1,5 · (5/10)/0,4 = 1,25
#   LQ 29001 : (4/10)/0,4 = 1,0 · (1/10)/0,2 = 0,5 · (5/10)/0,4 = 1,25
#   LQ 35001 : (6/10)/0,4 = 1,5 · (2/10)/0,2 = 1,0 · (1/10)/0,4 = 0,5
fixture_lq_analytique <- function() {
  tibble::tribble(
    ~commune, ~activity_code, ~activity_label, ~value, ~measure, ~source,
    ~vintage, ~etat_administratif, ~tranche_effectifs, ~naf_version,
    # 22001 — 4 lignes (deux tranches sur 01.11Z : le regroupement est exercé)
    "22001", "01.11Z", "Culture de céréales", 1L, "ETABLISSEMENTS_ACTIFS",
    "data.bretagne.bzh — Base SIRENE", "2026-04", "Actif", "0 salarié",
    "NAF rév. 2",
    "22001", "01.11Z", "Culture de céréales", 1L, "ETABLISSEMENTS_ACTIFS",
    "data.bretagne.bzh — Base SIRENE", "2026-04", "Actif", "1 ou 2 salariés",
    "NAF rév. 2",
    "22001", "47.11Z", "Commerce de détail non spécialisé", 3L, "ETABLISSEMENTS_ACTIFS",
    "data.bretagne.bzh — Base SIRENE", "2026-04", "Actif", "0 salarié",
    "NAF rév. 2",
    "22001", "86.10Z", "Activités hospitalières", 5L, "ETABLISSEMENTS_ACTIFS",
    "data.bretagne.bzh — Base SIRENE", "2026-04", "Actif", "1 ou 2 salariés",
    "NAF rév. 2",
    # 29001 — 3 lignes
    "29001", "01.11Z", "Culture de céréales", 4L, "ETABLISSEMENTS_ACTIFS",
    "data.bretagne.bzh — Base SIRENE", "2026-04", "Actif", "0 salarié",
    "NAF rév. 2",
    "29001", "47.11Z", "Commerce de détail non spécialisé", 1L, "ETABLISSEMENTS_ACTIFS",
    "data.bretagne.bzh — Base SIRENE", "2026-04", "Actif", "0 salarié",
    "NAF rév. 2",
    "29001", "86.10Z", "Activités hospitalières", 5L, "ETABLISSEMENTS_ACTIFS",
    "data.bretagne.bzh — Base SIRENE", "2026-04", "Actif", "1 ou 2 salariés",
    "NAF rév. 2",
    # 35001 — 4 lignes (deux tranches sur 01.11Z)
    "35001", "01.11Z", "Culture de céréales", 3L, "ETABLISSEMENTS_ACTIFS",
    "data.bretagne.bzh — Base SIRENE", "2026-04", "Actif", "0 salarié",
    "NAF rév. 2",
    "35001", "01.11Z", "Culture de céréales", 3L, "ETABLISSEMENTS_ACTIFS",
    "data.bretagne.bzh — Base SIRENE", "2026-04", "Actif", "1 ou 2 salariés",
    "NAF rév. 2",
    "35001", "47.11Z", "Commerce de détail non spécialisé", 2L, "ETABLISSEMENTS_ACTIFS",
    "data.bretagne.bzh — Base SIRENE", "2026-04", "Actif", "0 salarié",
    "NAF rév. 2",
    "35001", "86.10Z", "Activités hospitalières", 2L, "ETABLISSEMENTS_ACTIFS",
    "data.bretagne.bzh — Base SIRENE", "2026-04", "Actif", "1 ou 2 salariés",
    "NAF rév. 2",
    # 56001 — sous le plancher (total 3)
    "56001", "01.11Z", "Culture de céréales", 1L, "ETABLISSEMENTS_ACTIFS",
    "data.bretagne.bzh — Base SIRENE", "2026-04", "Actif", "0 salarié",
    "NAF rév. 2",
    "56001", "47.11Z", "Commerce de détail non spécialisé", 1L, "ETABLISSEMENTS_ACTIFS",
    "data.bretagne.bzh — Base SIRENE", "2026-04", "Actif", "0 salarié",
    "NAF rév. 2",
    "56001", "86.10Z", "Activités hospitalières", 1L, "ETABLISSEMENTS_ACTIFS",
    "data.bretagne.bzh — Base SIRENE", "2026-04", "Actif", "1 ou 2 salariés",
    "NAF rév. 2"
  )
}

# Le chemin de la vraie table normalisée (gitignorée ; absente hors worktree —
# le test saute proprement sur une machine sans la donnée)
chemin_sirene_reel <- function() {
  testthat::test_path("..", "..", "data", "processed", "economie",
                      "sirene_snapshot.rds")
}

# 1. Regroupement de la dimension tranche --------------------------------------
test_that("le regroupement des tranches somme value par commune × code APE", {
  agrege <- agreger_sirene_par_activite(fixture_lq_analytique())

  # une ligne par cellule commune × activité (les tranches sont regroupées)
  expect_equal(nrow(agrege), 12)
  # les totaux attendus (calculés à la main ci-dessus)
  attendus <- tibble::tribble(
    ~commune, ~activity_code, ~n,
    "22001", "01.11Z", 2L,
    "22001", "47.11Z", 3L,
    "22001", "86.10Z", 5L,
    "29001", "01.11Z", 4L,
    "29001", "47.11Z", 1L,
    "29001", "86.10Z", 5L,
    "35001", "01.11Z", 6L,
    "35001", "47.11Z", 2L,
    "35001", "86.10Z", 2L,
    "56001", "01.11Z", 1L,
    "56001", "47.11Z", 1L,
    "56001", "86.10Z", 1L
  )
  expect_equal(
    agrege[c("commune", "activity_code", "n")] %>%
      dplyr::arrange(commune, activity_code),
    attendus
  )
  # le libellé d'activité est conservé
  expect_true(all(c("commune", "activity_code", "activity_label", "n") %in%
                    names(agrege)))
  # aucune ligne en double (commune × activité)
  expect_equal(anyDuplicated(agrege[c("commune", "activity_code")]), 0L)
})

# 2. Plancher de commune gate D ------------------------------------------------
test_that("le plancher de commune (≥ 5 établissements) supprime ET compte", {
  agrege <- agreger_sirene_par_activite(fixture_lq_analytique())
  res <- appliquer_plancher_communes(agrege)

  # la commune 56001 (3 établissements) est exclue du calcul...
  expect_false("56001" %in% unique(res$retenu$commune))
  # ...et COMPTÉE dans le rapport de suppression — jamais écartée en silence
  expect_true("56001" %in% res$suppression$commune)
  expect_equal(res$suppression$n_total[res$suppression$commune == "56001"], 3)
  # les trois communes au-dessus du plancher sont retenues
  expect_setequal(res$retenu$commune, c("22001", "29001", "35001"))
  # le seuil est documenté dans le rapport
  expect_equal(unique(res$suppression$seuil_commune), SEUIL_PLANCHER_COMMUNES_LQ)
})

test_that("une commune AU plancher (exactement 5) est retenue", {
  # 5 établissements exactement → le plancher (n ≥ 5) la garde
  agrege <- agreger_sirene_par_activite(fixture_lq_analytique()) %>%
    dplyr::filter(commune != "56001") %>%
    dplyr::bind_rows(tibble::tibble(
      commune = "56001", activity_code = "01.11Z",
      activity_label = "Culture de céréales", n = 5L
    ))
  res <- appliquer_plancher_communes(agrege)
  expect_true("56001" %in% res$retenu$commune)
  expect_false("56001" %in% res$suppression$commune)
})

# 3. LQ de Balassa continue -----------------------------------------------------
test_that("la LQ de Balassa continue correspond à la formule calculée à la main", {
  agrege <- agreger_sirene_par_activite(fixture_lq_analytique())
  retenu <- appliquer_plancher_communes(agrege)$retenu
  lq <- calculer_lq_balassa(retenu)

  # LQ_ca = (n_ca / n_c.) / (n_.a / n_..) — les valeurs exactes de la fixture
  lq_cellule <- function(commune, activity) {
    lq$lq[lq$commune == commune & lq$activity_code == activity]
  }
  # 22001 : (2/10)/0,4 = 0,5 · (3/10)/0,2 = 1,5 · (5/10)/0,4 = 1,25
  expect_equal(lq_cellule("22001", "01.11Z"), 0.5)
  expect_equal(lq_cellule("22001", "47.11Z"), 1.5)
  expect_equal(lq_cellule("22001", "86.10Z"), 1.25)
  # 29001 : la cellule où la part de la commune ÉGALE la part bretonne → LQ = 1
  expect_equal(lq_cellule("29001", "01.11Z"), 1)
  expect_equal(lq_cellule("29001", "47.11Z"), 0.5)
  expect_equal(lq_cellule("29001", "86.10Z"), 1.25)
  # 35001 : (6/10)/0,4 = 1,5 · (2/10)/0,2 = 1,0 · (1/10)/0,4 = 0,5
  expect_equal(lq_cellule("35001", "01.11Z"), 1.5)
  expect_equal(lq_cellule("35001", "47.11Z"), 1)
  expect_equal(lq_cellule("35001", "86.10Z"), 0.5)

  # les colonnes de transparence : n (cellule), n_c (commune), n_a (activité)
  expect_true(all(c("commune", "activity_code", "lq", "n", "n_c", "n_a") %in%
                    names(lq)))
  expect_true(all(lq$n_c == 10))     # chaque commune retenue totalise 10
  # 01.11Z = 12 · 47.11Z = 6 · 86.10Z = 12 (une valeur n_a par activité)
  n_a_par_activite <- lq %>%
    dplyr::select(activity_code, n_a) %>%
    dplyr::distinct() %>%
    dplyr::arrange(activity_code)
  expect_equal(n_a_par_activite$n_a, c(12, 6, 12))
  # la LQ reste CONTINUE : des valeurs strictement positives, non seuillées en
  # binaire — aucune valeur hors {0,1} n'est perdue par un plancher
  expect_true(all(lq$lq > 0))
  expect_true(any(lq$lq != 1))
  expect_true(any(lq$lq < 1))
})

test_that("les totaux bretons se calculent sur la Bretagne RETENUE seulement", {
  # si la commune sous plancher entrait dans le dénominateur, ses 3
  # établissements changeraient les parts bretonnes — elles ne doivent pas
  agrege <- agreger_sirene_par_activite(fixture_lq_analytique())
  retenu <- appliquer_plancher_communes(agrege)$retenu
  lq <- calculer_lq_balassa(retenu)
  # total général retenu = 30 (3 × 10), jamais 33 (avec la commune supprimée)
  expect_equal(sum(retenu$n), 30)
  n_a_par_activite <- lq %>%
    dplyr::select(activity_code, n_a) %>%
    dplyr::distinct() %>%
    dplyr::arrange(activity_code)
  expect_equal(n_a_par_activite$n_a, c(12, 6, 12))
})

# 4. L'Histoire « ce que la commune sait faire » --------------------------------
test_that("l'Histoire = top-3 spécialisations par LQ, valeurs continues, déterministe", {
  agrege <- agreger_sirene_par_activite(fixture_lq_analytique())
  retenu <- appliquer_plancher_communes(agrege)$retenu
  lq <- calculer_lq_balassa(retenu)
  histoires <- calculer_histoires_lq(lq)

  # une ligne par (commune × rang), rang 1..3 — les top-3 spécialisations
  expect_equal(nrow(histoires), 9)
  expect_equal(unique(histoires$rang), 1:3)
  # 22001 : 47.11Z (1,5) > 86.10Z (1,25) > 01.11Z (0,5)
  h22001 <- histoires[histoires$commune == "22001", ]
  expect_equal(h22001$activity_code, c("47.11Z", "86.10Z", "01.11Z"))
  expect_equal(h22001$lq, c(1.5, 1.25, 0.5))
  # 29001 : 86.10Z (1,25) > 01.11Z (1,0) > 47.11Z (0,5)
  h29001 <- histoires[histoires$commune == "29001", ]
  expect_equal(h29001$activity_code, c("86.10Z", "01.11Z", "47.11Z"))
  expect_equal(h29001$lq, c(1.25, 1, 0.5))
  # 35001 : 01.11Z (1,5) > 47.11Z (1,0) > 86.10Z (0,5)
  h35001 <- histoires[histoires$commune == "35001", ]
  expect_equal(h35001$activity_code, c("01.11Z", "47.11Z", "86.10Z"))
  expect_equal(h35001$lq, c(1.5, 1, 0.5))

  # les VALEURS continues sont portées par l'Histoire (jamais un binaire)
  expect_true(any(histoires$lq < 1))
  # déterminisme (ADR-0002) : même entrée → même Histoire, à l'identique
  expect_identical(histoires, calculer_histoires_lq(lq))
})

test_that("une Histoire construite depuis une entrée BINAIRE échoue bruyamment", {
  # la matrice M (0/1) ne doit JAMAIS piloter l'Histoire (gate C) — la
  # fonction refuse une colonne lq binaire
  agrege <- agreger_sirene_par_activite(fixture_lq_analytique())
  retenu <- appliquer_plancher_communes(agrege)$retenu
  lq <- calculer_lq_balassa(retenu)
  binaire <- lq %>% dplyr::mutate(lq = as.numeric(lq >= 1))

  expect_error(calculer_histoires_lq(binaire), "continu")
})

test_that("une commune avec moins de 3 activités reçoit toute son Histoire (rang < top_n)", {
  # une commune à 2 activités → 2 lignes d'Histoire, pas de padding
  lq_mince <- tibble::tibble(
    commune = c("22001", "22001", "29001", "29001", "29001"),
    activity_code = c("01.11Z", "47.11Z", "01.11Z", "47.11Z", "86.10Z"),
    activity_label = c("a", "b", "a", "b", "c"),
    lq = c(1.5, 0.5, 1.0, 1.2, 0.8)
  )
  histoires <- calculer_histoires_lq(lq_mince)
  expect_equal(sum(histoires$commune == "22001"), 2)
  expect_equal(histoires$rang[histoires$commune == "22001"], 1:2)
  expect_equal(sum(histoires$commune == "29001"), 3)
  expect_equal(histoires$rang[histoires$commune == "29001"], 1:3)
})

test_that("une entrée sans colonne lq échoue en nommant le champ", {
  expect_error(calculer_histoires_lq(tibble::tibble(commune = "x")), "lq")
})

# 5. La matrice M sidecar -------------------------------------------------------
test_that("la matrice M est un artefact séparé 0/1 (LQ ≥ 1), jamais l'Histoire", {
  agrege <- agreger_sirene_par_activite(fixture_lq_analytique())
  retenu <- appliquer_plancher_communes(agrege)$retenu
  lq <- calculer_lq_balassa(retenu)
  m <- calculer_matrice_m(lq)

  # forme : commune × activité, une ligne par cellule de la matrice croisée
  expect_equal(nrow(m), 9)
  expect_setequal(names(m), c("commune", "activity_code", "m"))
  # valeurs binaires 0/1 uniquement
  expect_true(all(m$m %in% c(0, 1)))
  # LQ ≥ 1 → 1, LQ < 1 → 0 (le seuil 1.0 appartient à la spécialisation)
  m_cellule <- function(commune, activity) {
    m$m[m$commune == commune & m$activity_code == activity]
  }
  expect_equal(m_cellule("22001", "01.11Z"), 0)  # LQ 0,5
  expect_equal(m_cellule("22001", "47.11Z"), 1)  # LQ 1,5
  expect_equal(m_cellule("29001", "01.11Z"), 1)  # LQ 1,0 → 1 (bornes incluses)
  expect_equal(m_cellule("35001", "86.10Z"), 0)  # LQ 0,5
  # M est SÉPARÉ de l'Histoire : l'Histoire porte les valeurs continues, M les
  # seuille — jamais l'inverse
  histoires <- calculer_histoires_lq(lq)
  expect_true(all(c("rang") %in% names(histoires)))
  expect_false("rang" %in% names(m))
  expect_true(all(histoires$lq != as.numeric(histoires$lq >= 1) | histoires$lq == 1))
})

# 6. L'orchestrateur + la persistance -------------------------------------------
test_that("construire_analytique_lq_economie persiste les quatre artefacts sous data/processed/economie/", {
  sortie <- tempfile("analytique-lq-")
  on.exit(unlink(sortie, recursive = TRUE), add = TRUE)

  res <- construire_analytique_lq_economie(
    snapshot = fixture_lq_analytique(),
    sortie = sortie
  )

  # les quatre artefacts du chaînon, sous la localisation Économie/Emploi
  attendus <- c(
    "lq_economie.rds", "histoires_lq_economie.rds",
    "m_economie.rds", "suppression_lq_economie.rds"
  )
  expect_setequal(list.files(sortie), attendus)

  # chaque artefact relit le bon contenu
  expect_equal(nrow(readRDS(file.path(sortie, "lq_economie.rds"))), 9)
  expect_equal(nrow(readRDS(file.path(sortie, "histoires_lq_economie.rds"))), 9)
  expect_equal(nrow(readRDS(file.path(sortie, "m_economie.rds"))), 9)
  suppress <- readRDS(file.path(sortie, "suppression_lq_economie.rds"))
  expect_true("56001" %in% suppress$commune)

  # le retour porte tout le chaînon
  expect_named(res, c("lq", "histoires", "m", "suppression"))
  expect_identical(res$lq, readRDS(file.path(sortie, "lq_economie.rds")))
  expect_identical(res$histoires,
                   readRDS(file.path(sortie, "histoires_lq_economie.rds")))
  expect_identical(res$m, readRDS(file.path(sortie, "m_economie.rds")))
  expect_identical(res$suppression,
                   readRDS(file.path(sortie, "suppression_lq_economie.rds")))
})

test_that("relancer l'analyse est déterministe (octet-pour-octet)", {
  sortie1 <- tempfile("analytique-lq-1-")
  sortie2 <- tempfile("analytique-lq-2-")
  on.exit(unlink(c(sortie1, sortie2), recursive = TRUE), add = TRUE)

  res1 <- construire_analytique_lq_economie(fixture_lq_analytique(), sortie1)
  res2 <- construire_analytique_lq_economie(fixture_lq_analytique(), sortie2)

  expect_identical(res1$lq, res2$lq)
  expect_identical(res1$histoires, res2$histoires)
  expect_identical(res1$m, res2$m)
  expect_identical(res1$suppression, res2$suppression)
})

# 7. Le chemin de joie RÉEL ------------------------------------------------------
test_that("la vraie table sirene_snapshot : 1202 communes, 0 suppression, comptes connus", {
  skip_if_not(file.exists(chemin_sirene_reel()),
              "La vraie table sirene_snapshot n'est pas présente (worktree sans donnée).")
  snapshot <- readRDS(chemin_sirene_reel())

  # la forme réelle connue (issue #91) : 181 481 lignes, 1202 communes,
  # 695 codes APE 5 chiffres
  expect_equal(nrow(snapshot), 181481)
  expect_equal(dplyr::n_distinct(snapshot$commune), 1202)
  expect_equal(dplyr::n_distinct(snapshot$activity_code), 695)

  agrege <- agreger_sirene_par_activite(snapshot)
  res <- appliquer_plancher_communes(agrege)
  # 0 commune supprimée (le minimum observé est 10 établissements — gate D)
  expect_equal(nrow(res$suppression), 0)
  expect_equal(dplyr::n_distinct(res$retenu$commune), 1202)

  lq <- calculer_lq_balassa(res$retenu)
  # une ligne par cellule observée commune × activité (regroupée)
  expect_equal(nrow(lq), nrow(res$retenu))
  expect_equal(dplyr::n_distinct(lq$commune), 1202)
  # LQ continues, finies, positives — aucune valeur binaire
  expect_true(all(is.finite(lq$lq)))
  expect_true(all(lq$lq > 0))
  expect_true(any(lq$lq < 1) & any(lq$lq > 1))

  # Histoire : 3 lignes par commune, déterminée
  histoires <- calculer_histoires_lq(lq)
  expect_equal(nrow(histoires), 1202 * TOP_N_SPECIALISATIONS_LQ)
  expect_identical(histoires, calculer_histoires_lq(lq))

  # M sidecar : une ligne par cellule croisée commune × activité, binaire
  m <- calculer_matrice_m(lq)
  expect_equal(nrow(m), dplyr::n_distinct(lq$commune) * dplyr::n_distinct(lq$activity_code))
  expect_true(all(m$m %in% c(0, 1)))
  # l'analyse entière tourne en un temps raisonnable (dplyr, aucune boucle)
  duree <- system.time(
    construire_analytique_lq_economie(snapshot, sortie = tempfile("lq-reel-"))
  )["elapsed"]
  expect_lt(unname(duree), 120)
})
