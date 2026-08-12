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
#   4. l'Histoire « ce que la commune abrite » : les top-5 spécialisations
#      par LQ (TOP_N_SPECIALISATIONS_LQ = 5, décision 2026-08-06 — la 4e/5e
#      place est encore une LQ énorme et apporte de la diversité sectorielle),
#      valeurs CONTINUES uniquement — une entrée binaire échoue bruyamment
#      (gate C) ; sélection déterministe (ADR-0002) : même entrée → même
#      Histoire, pour toujours ; `n` (la cellule n_ca, transparence de
#      calculer_lq_balassa) est CONSERVÉ par l'Histoire (issue #131) ;
#   5. la matrice M sidecar (LQ ≥ 1 binaire, commune × activité) comme artefact
#      SÉPARÉ pour la relatedness future (gate F, docs/research/relatedness.md
#      §5 Layer 1) — l'Histoire ne l'utilise jamais.
#
# La fixture (fixture_lq_analytique) est un mini snapshot normalisé calculé À LA
# MAIN : 4 communes × 3 codes APE ventilés sur plusieurs tranches (le
# regroupement est exercé), dont une commune sous le plancher (56001, 3
# établissements). Les attendus de LQ sont des fractions exactes — la cellule
# 29001 × 01.11Z vérifie le cas LQ = 1 (la part de la commune = la part
# bretonne). Le verrou « données réelles » (la vraie table, pipeline/data/ —
# gitignoré) vit désormais dans le graphe targets (verif_economie_lq,
# _targets.R — le run de l'issue #342) : il rejoue quand le snapshot SIRENE
# ou un lecteur change, saute sinon — sans variable d'environnement à
# retenir. Aucun appel réseau dans la boucle de test.

# La fixture analytique --------------------------------------------------------
# (vivante dans helper-fixture-sirene.R — partagée avec
# test-analytics-economie-territoires.R)

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

# 4. L'Histoire « ce que la commune abrite » --------------------------------
test_that("l'Histoire = top-5 spécialisations par LQ, valeurs continues, déterministe", {
  agrege <- agreger_sirene_par_activite(fixture_lq_analytique())
  retenu <- appliquer_plancher_communes(agrege)$retenu
  lq <- calculer_lq_balassa(retenu)
  histoires <- calculer_histoires_lq(lq)

  # une ligne par (commune × rang), rang 1..min(top_n, activités) — les 3
  # activités de la fixture (< top_n) donnent 3 lignes, jamais de padding
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

test_that("l'Histoire conserve `n` — la cellule n_ca, transparence de la LQ (issue #131)", {
  agrege <- agreger_sirene_par_activite(fixture_lq_analytique())
  retenu <- appliquer_plancher_communes(agrege)$retenu
  lq <- calculer_lq_balassa(retenu)
  histoires <- calculer_histoires_lq(lq)

  # la colonne n (le nombre d'établissements de la cellule commune × activité)
  # n'est PAS jetée par la sélection — l'Histoire la porte, comme le payload
  expect_true("n" %in% names(histoires))
  # 22001 : 47.11Z porte 3 établissements, 86.10Z en porte 5, 01.11Z en porte 2
  expect_equal(
    histoires$n[histoires$commune == "22001"],
    c(3, 5, 2)
  )
})

test_that("l'Histoire va jusqu'au top-5 quand une commune a 5 activités ou plus", {
  # une commune à 6 activités → 5 lignes d'Histoire (la profondeur top-5),
  # jamais plus — la 6e activité (la plus faible LQ) est écartée
  lq_profonde <- tibble::tibble(
    commune = c(rep("22001", 6), rep("29001", 6)),
    activity_code = c("A", "B", "C", "D", "E", "F",
                      "A", "B", "C", "D", "E", "F"),
    activity_label = c(paste0("Activité ", c("A", "B", "C", "D", "E", "F")),
                       paste0("Activité ", c("A", "B", "C", "D", "E", "F"))),
    lq = c(2.0, 1.8, 1.6, 1.4, 1.2, 0.5,
           1.0, 0.8, 0.6, 0.4, 0.2, 0.1),
    n = c(2, 3, 4, 5, 6, 1,
          1, 2, 3, 4, 5, 6)
  )
  histoires <- calculer_histoires_lq(lq_profonde)

  # 22001 : les 5 meilleures LQ, rang 1..5, F (0,5) écartée
  h22001 <- histoires[histoires$commune == "22001", ]
  expect_equal(nrow(h22001), TOP_N_SPECIALISATIONS_LQ)
  expect_equal(h22001$rang, 1:TOP_N_SPECIALISATIONS_LQ)
  expect_equal(h22001$activity_code, c("A", "B", "C", "D", "E"))
  expect_equal(h22001$n, c(2, 3, 4, 5, 6))
  # 29001 : la même profondeur, dans l'ordre de LQ
  h29001 <- histoires[histoires$commune == "29001", ]
  expect_equal(h29001$activity_code, c("A", "B", "C", "D", "E"))
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

test_that("une commune avec moins de top_n activités reçoit toute son Histoire (rang < top_n)", {
  # une commune à 2 activités → 2 lignes d'Histoire, pas de padding
  lq_mince <- tibble::tibble(
    commune = c("22001", "22001", "29001", "29001", "29001"),
    activity_code = c("01.11Z", "47.11Z", "01.11Z", "47.11Z", "86.10Z"),
    activity_label = c("a", "b", "a", "b", "c"),
    lq = c(1.5, 0.5, 1.0, 1.2, 0.8),
    n = c(2L, 3L, 4L, 1L, 5L)
  )
  histoires <- calculer_histoires_lq(lq_mince)
  expect_equal(sum(histoires$commune == "22001"), 2)
  expect_equal(histoires$rang[histoires$commune == "22001"], 1:2)
  expect_equal(sum(histoires$commune == "29001"), 3)
  expect_equal(histoires$rang[histoires$commune == "29001"], 1:3)
  # `n` est conservé jusqu'au bout, même sous top_n — 29001 trié par LQ
  # décroissante : 47.11Z (1,2 → n=1) · 01.11Z (1,0 → n=4) · 86.10Z (0,8 → n=5)
  expect_equal(histoires$n[histoires$commune == "29001"], c(1, 4, 5))
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
  # l'artefact Histoire porte `n` (la transparence de la LQ, issue #131)
  expect_true("n" %in% names(readRDS(file.path(sortie, "histoires_lq_economie.rds"))))
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

# 8. La LQ à référence même-échelle (issue #131, décision 2026-08-06) ---------
# Un agrégat (EPCI, département) recalcule SA LQ contre le total de SON niveau
# — un EPCI contre les autres EPCIs, jamais contre la moyenne bretonne des
# communes : la LQ d'un EPCI n'est pas la LQ de ses communes.

test_that("calculer_lq_par_niveau : un EPCI se compare aux autres EPCIs (référence même-échelle)", {
  # la table agrégée par EPCI des cellules retenues de la fixture (22001 +
  # 29001 → EPCI X ; 35001 → EPCI Y ; 56001 supprimée au plancher) :
  #   EPCI X : 01.11Z = 6 · 47.11Z = 4 · 86.10Z = 10  (total 20)
  #   EPCI Y : 01.11Z = 6 · 47.11Z = 2 · 86.10Z = 2   (total 10)
  # Totaux du NIVEAU EPCI : 01.11Z = 12 · 47.11Z = 6 · 86.10Z = 12 · total = 30
  table_epci <- tibble::tribble(
    ~EPCI, ~activity_code, ~activity_label, ~n,
    "200000001", "01.11Z", "Culture de céréales", 6L,
    "200000001", "47.11Z", "Commerce de détail non spécialisé", 4L,
    "200000001", "86.10Z", "Activités hospitalières", 10L,
    "200000002", "01.11Z", "Culture de céréales", 6L,
    "200000002", "47.11Z", "Commerce de détail non spécialisé", 2L,
    "200000002", "86.10Z", "Activités hospitalières", 2L
  )
  lq <- calculer_lq_par_niveau(table_epci, "EPCI")

  expect_equal(nrow(lq), 6)
  expect_setequal(names(lq), c("EPCI", "activity_code", "activity_label", "lq", "n"))
  # EPCI X : (6/20)/(12/30) = 0,75 · (4/20)/(6/30) = 1,0 · (10/20)/(12/30) = 1,25
  lq_x <- lq[lq$EPCI == "200000001", ]
  expect_equal(lq_x$activity_code, c("01.11Z", "47.11Z", "86.10Z"))
  expect_equal(lq_x$lq, c(0.75, 1, 1.25))
  # EPCI Y : (6/10)/(12/30) = 1,5 · (2/10)/(6/30) = 1,0 · (2/10)/(12/30) = 0,5
  lq_y <- lq[lq$EPCI == "200000002", ]
  expect_equal(lq_y$lq, c(1.5, 1, 0.5))
  # `n` est conservé (la cellule agrégée du niveau)
  expect_equal(lq$n[lq$EPCI == "200000001"], c(6, 4, 10))

  # la référence EST le total du niveau : 22001 (commune seule) avait une LQ
  # de 0,5 sur 01.11Z vs la Bretagne des communes — son EPCI (X) vaut 0,75 vs
  # les autres EPCIs. Le même EPCI, autre référence, autre LQ : l'agrégat ne
  # recopie JAMAIS la LQ de ses communes.
  expect_false(lq_x$lq[lq_x$activity_code == "01.11Z"] == 0.5)
})

test_that("calculer_lq_par_niveau : un département se compare aux autres départements", {
  # chaque département de la fixture ne porte qu'une commune retenue : ses
  # parts égalent les parts communales, la référence est le total des
  # DÉPARTEMENTS (identique ici aux totaux communaux — les LQ coïncident)
  table_dep <- tibble::tribble(
    ~DEP, ~activity_code, ~activity_label, ~n,
    "22", "01.11Z", "Culture de céréales", 2L,
    "22", "47.11Z", "Commerce de détail non spécialisé", 3L,
    "22", "86.10Z", "Activités hospitalières", 5L,
    "29", "01.11Z", "Culture de céréales", 4L,
    "29", "47.11Z", "Commerce de détail non spécialisé", 1L,
    "29", "86.10Z", "Activités hospitalières", 5L,
    "35", "01.11Z", "Culture de céréales", 6L,
    "35", "47.11Z", "Commerce de détail non spécialisé", 2L,
    "35", "86.10Z", "Activités hospitalières", 2L
  )
  lq <- calculer_lq_par_niveau(table_dep, "DEP")

  expect_equal(lq$lq[lq$DEP == "22" & lq$activity_code == "01.11Z"], 0.5)
  expect_equal(lq$lq[lq$DEP == "35" & lq$activity_code == "86.10Z"], 0.5)
  # la colonne de niveau est la clé de regroupement
  expect_setequal(unique(lq$DEP), c("22", "29", "35"))
})

test_that("calculer_lq_par_niveau : une table vide échoue bruyamment", {
  expect_error(
    calculer_lq_par_niveau(
      tibble::tibble(EPCI = character(), activity_code = character(),
                     activity_label = character(), n = numeric()),
      "EPCI"
    ),
    "nul"
  )
})

# 9. La présence régionale « Ce que la Bretagne abrite » (issue #131) ---------
# La région (53) n'a pas de Story LQ (sa LQ est dégénérée, toute ≡ 1) : elle
# reçoit une lecture de STRUCTURE — le top-5 des types d'établissements les
# plus présents par nombre d'établissements actifs, avec leur part du parc.

test_that("calculer_presence_bretagne : top-5 par présence (n), avec la part du parc", {
  agrege <- agreger_sirene_par_activite(fixture_lq_analytique())
  retenu <- appliquer_plancher_communes(agrege)$retenu
  lq <- calculer_lq_balassa(retenu)
  # parc retenu : 01.11Z = 12 · 47.11Z = 6 · 86.10Z = 12 · total = 30
  presence <- calculer_presence_bretagne(lq)

  # la forme du contrat : la ligne région, story_key dédié, la part du parc
  expect_equal(nrow(presence), 3)  # 3 activités < top_n → toutes, sans padding
  expect_setequal(names(presence),
                  c("territoire", "type", "story_key", "rang",
                    "activity_code", "activity_label", "lq", "n", "part_parc"))
  expect_true(all(presence$territoire == "53"))
  expect_true(all(presence$type == "region"))
  expect_true(all(presence$story_key == "ce-que-la-bretagne-abrite"))
  expect_true(all(is.na(presence$lq)))  # pas de LQ pour la structure régionale

  # tri déterministe par n décroissant, ex æquo par code APE croissant
  # (01.11Z et 86.10Z portent tous deux 12 établissements — 01.11Z d'abord)
  expect_equal(presence$rang, 1:3)
  expect_equal(presence$activity_code, c("01.11Z", "86.10Z", "47.11Z"))
  expect_equal(presence$n, c(12, 12, 6))
  # la part du parc : n / total breton retenu
  expect_equal(presence$part_parc, c(12 / 30, 12 / 30, 6 / 30))
  # la somme des parts ne dépasse jamais 1 (la structure, pas un total garanti)
  expect_lte(sum(presence$part_parc), 1)
  # déterminisme (ADR-0002)
  expect_identical(presence, calculer_presence_bretagne(lq))
})

test_that("calculer_presence_bretagne : la profondeur top-5, jamais plus", {
  # un parc à 7 activités → 5 lignes (TOP_N_PRESENCE_REGION), les 2 plus
  # faibles présences écartées
  lq_riche <- tibble::tibble(
    commune = rep("22001", 7),
    activity_code = c("A", "B", "C", "D", "E", "F", "G"),
    activity_label = paste0("Activité ", c("A", "B", "C", "D", "E", "F", "G")),
    lq = runif(7, 0.5, 2),
    n = c(50, 40, 30, 20, 10, 5, 2)
  )
  presence <- calculer_presence_bretagne(lq_riche)
  expect_equal(nrow(presence), TOP_N_PRESENCE_REGION)
  expect_equal(presence$activity_code, c("A", "B", "C", "D", "E"))
  expect_equal(presence$n, c(50, 40, 30, 20, 10))
  # la part se calcule sur le parc total (157)
  expect_equal(presence$part_parc[1], 50 / 157)
})
