# Le remodelage de la source Habitat RP Logements (issue #14) : des fichiers
# longs INSEE vers la forme du contrat — la table des communes bretonnes par le
# stock de logements. Le mini-fixture ci-dessous reproduit le format RÉEL du
# dossier complet Logements (DS_RP_LOGEMENT_PRINC, docs/research/rp-logements.md) :
# 16 colonnes, séparateur ; dans les vrais fichiers, GEO;GEO_OBJECT;OCS;L_STAY;
# TDW;CARS;RP_MEASURE;CARPARK;NOR;TSH;BUILD_END;NRG_SRC;FREQ;OBS_STATUS;
# TIME_PERIOD;OBS_VALUE. Les pivots ne lisent que les colonnes utiles.

# logements_mini --------------------------------------------------------------
# Deux communes bretonnes (22001, 29001) + une non-bretonne (44001, éliminée à
# la jointure EPCI). Valeurs réelles plausibles qui vérifient les cohérences
# documentées : _T = DW_MAIN + DW_SEC_DW_OCC + DW_VAC ; statut 100+200+300 = _T ;
# 6 tranches d'ancienneté = _T ; 5 tranches de taille = _T.
logements_mini <- tibble::tribble(
  # --- 22001 : catégorie de logement (DWELLINGS, autres dims _T)
  ~GEO, ~GEO_OBJECT, ~OCS, ~L_STAY, ~TDW, ~CARS, ~RP_MEASURE, ~CARPARK, ~NOR, ~TSH, ~BUILD_END, ~NRG_SRC, ~FREQ, ~OBS_STATUS, ~TIME_PERIOD, ~OBS_VALUE,
  "22001", "COM", "_T", "_T", "_T", "_T", "DWELLINGS", "_T", "_T", "_T", "_T", "_T", "A", "A", 2023, 1000,
  "22001", "COM", "DW_MAIN", "_T", "_T", "_T", "DWELLINGS", "_T", "_T", "_T", "_T", "_T", "A", "A", 2023, 850,
  "22001", "COM", "DW_SEC_DW_OCC", "_T", "_T", "_T", "DWELLINGS", "_T", "_T", "_T", "_T", "_T", "A", "A", 2023, 50,
  "22001", "COM", "DW_VAC", "_T", "_T", "_T", "DWELLINGS", "_T", "_T", "_T", "_T", "_T", "A", "A", 2023, 100,
  # doublon d'inclusion (K) : ignoré
  "22001", "COM", "_T", "_T", "_T", "_T", "DWELLINGS", "_T", "_T", "_T", "_T", "_T", "A", "K", 2023, 999999,
  # même code en bassin de vie : ignoré
  "22001", "BV2022", "_T", "_T", "_T", "_T", "DWELLINGS", "_T", "_T", "_T", "_T", "_T", "A", "A", 2023, 555555,
  # autre période (2017) : ignorée
  "22001", "COM", "_T", "_T", "_T", "_T", "DWELLINGS", "_T", "_T", "_T", "_T", "_T", "A", "A", 2017, 900,
  # une dimension active (TDW=1) : pas une ligne totale, ignorée
  "22001", "COM", "DW_MAIN", "_T", "1", "_T", "DWELLINGS", "_T", "_T", "_T", "_T", "_T", "A", "A", 2023, 300,
  # la mesure DWELLINGS_ROOMS (total de pièces, PAS une distribution) : ignorée
  "22001", "COM", "DW_MAIN", "_T", "_T", "_T", "DWELLINGS_ROOMS", "_T", "_T", "_T", "_T", "_T", "A", "A", 2023, 3000,
  # --- 22001 : statut d'occupation (TSH), RP seulement
  "22001", "COM", "DW_MAIN", "_T", "_T", "_T", "DWELLINGS", "_T", "_T", "100", "_T", "_T", "A", "A", 2023, 500,
  "22001", "COM", "DW_MAIN", "_T", "_T", "_T", "DWELLINGS", "_T", "_T", "200", "_T", "_T", "A", "A", 2023, 250,
  "22001", "COM", "DW_MAIN", "_T", "_T", "_T", "DWELLINGS", "_T", "_T", "211", "_T", "_T", "A", "A", 2023, 100, # détail locataire : ignoré
  "22001", "COM", "DW_MAIN", "_T", "_T", "_T", "DWELLINGS", "_T", "_T", "300", "_T", "_T", "A", "A", 2023, 100,
  # --- 22001 : ancienneté d'emménagement (L_STAY), RP seulement
  "22001", "COM", "DW_MAIN", "Y_LT2", "_T", "_T", "DWELLINGS", "_T", "_T", "_T", "_T", "_T", "A", "A", 2023, 150,
  "22001", "COM", "DW_MAIN", "Y2T4", "_T", "_T", "DWELLINGS", "_T", "_T", "_T", "_T", "_T", "A", "A", 2023, 200,
  "22001", "COM", "DW_MAIN", "Y5T9", "_T", "_T", "DWELLINGS", "_T", "_T", "_T", "_T", "_T", "A", "A", 2023, 150,
  "22001", "COM", "DW_MAIN", "Y10T19", "_T", "_T", "DWELLINGS", "_T", "_T", "_T", "_T", "_T", "A", "A", 2023, 150,
  "22001", "COM", "DW_MAIN", "Y20T29", "_T", "_T", "DWELLINGS", "_T", "_T", "_T", "_T", "_T", "A", "A", 2023, 100,
  "22001", "COM", "DW_MAIN", "Y_GE30", "_T", "_T", "DWELLINGS", "_T", "_T", "_T", "_T", "_T", "A", "A", 2023, 100,
  # --- 22001 : taille (NOR), RP seulement
  "22001", "COM", "DW_MAIN", "_T", "_T", "_T", "DWELLINGS", "_T", "R1", "_T", "_T", "_T", "A", "A", 2023, 100,
  "22001", "COM", "DW_MAIN", "_T", "_T", "_T", "DWELLINGS", "_T", "R2", "_T", "_T", "_T", "A", "A", 2023, 150,
  "22001", "COM", "DW_MAIN", "_T", "_T", "_T", "DWELLINGS", "_T", "R3", "_T", "_T", "_T", "A", "A", 2023, 200,
  "22001", "COM", "DW_MAIN", "_T", "_T", "_T", "DWELLINGS", "_T", "R4", "_T", "_T", "_T", "A", "A", 2023, 200,
  "22001", "COM", "DW_MAIN", "_T", "_T", "_T", "DWELLINGS", "_T", "R_GE5", "_T", "_T", "_T", "A", "A", 2023, 200,
  # --- 29001 : catégorie de logement
  "29001", "COM", "_T", "_T", "_T", "_T", "DWELLINGS", "_T", "_T", "_T", "_T", "_T", "A", "A", 2023, 600,
  "29001", "COM", "DW_MAIN", "_T", "_T", "_T", "DWELLINGS", "_T", "_T", "_T", "_T", "_T", "A", "A", 2023, 500,
  "29001", "COM", "DW_SEC_DW_OCC", "_T", "_T", "_T", "DWELLINGS", "_T", "_T", "_T", "_T", "_T", "A", "A", 2023, 40,
  "29001", "COM", "DW_VAC", "_T", "_T", "_T", "DWELLINGS", "_T", "_T", "_T", "_T", "_T", "A", "A", 2023, 60,
  # --- 29001 : statut d'occupation
  "29001", "COM", "DW_MAIN", "_T", "_T", "_T", "DWELLINGS", "_T", "_T", "100", "_T", "_T", "A", "A", 2023, 300,
  "29001", "COM", "DW_MAIN", "_T", "_T", "_T", "DWELLINGS", "_T", "_T", "200", "_T", "_T", "A", "A", 2023, 150,
  "29001", "COM", "DW_MAIN", "_T", "_T", "_T", "DWELLINGS", "_T", "_T", "300", "_T", "_T", "A", "A", 2023, 50,
  # --- 29001 : ancienneté d'emménagement
  "29001", "COM", "DW_MAIN", "Y_LT2", "_T", "_T", "DWELLINGS", "_T", "_T", "_T", "_T", "_T", "A", "A", 2023, 80,
  "29001", "COM", "DW_MAIN", "Y2T4", "_T", "_T", "DWELLINGS", "_T", "_T", "_T", "_T", "_T", "A", "A", 2023, 100,
  "29001", "COM", "DW_MAIN", "Y5T9", "_T", "_T", "DWELLINGS", "_T", "_T", "_T", "_T", "_T", "A", "A", 2023, 90,
  "29001", "COM", "DW_MAIN", "Y10T19", "_T", "_T", "DWELLINGS", "_T", "_T", "_T", "_T", "_T", "A", "A", 2023, 100,
  "29001", "COM", "DW_MAIN", "Y20T29", "_T", "_T", "DWELLINGS", "_T", "_T", "_T", "_T", "_T", "A", "A", 2023, 70,
  "29001", "COM", "DW_MAIN", "Y_GE30", "_T", "_T", "DWELLINGS", "_T", "_T", "_T", "_T", "_T", "A", "A", 2023, 60,
  # --- 29001 : taille
  "29001", "COM", "DW_MAIN", "_T", "_T", "_T", "DWELLINGS", "_T", "R1", "_T", "_T", "_T", "A", "A", 2023, 50,
  "29001", "COM", "DW_MAIN", "_T", "_T", "_T", "DWELLINGS", "_T", "R2", "_T", "_T", "_T", "A", "A", 2023, 100,
  "29001", "COM", "DW_MAIN", "_T", "_T", "_T", "DWELLINGS", "_T", "R3", "_T", "_T", "_T", "A", "A", 2023, 150,
  "29001", "COM", "DW_MAIN", "_T", "_T", "_T", "DWELLINGS", "_T", "R4", "_T", "_T", "_T", "A", "A", 2023, 120,
  "29001", "COM", "DW_MAIN", "_T", "_T", "_T", "DWELLINGS", "_T", "R_GE5", "_T", "_T", "_T", "A", "A", 2023, 80,
  # --- 44001 : non-bretonne, éliminée à la jointure EPCI
  "44001", "COM", "_T", "_T", "_T", "_T", "DWELLINGS", "_T", "_T", "_T", "_T", "_T", "A", "A", 2023, 500,
  "44001", "COM", "DW_MAIN", "_T", "_T", "_T", "DWELLINGS", "_T", "_T", "_T", "_T", "_T", "A", "A", 2023, 400
)

# la base des EPCI bretonne (lire_epci, déjà filtrée Bretagne) — même forme
# que dans le fixture Démographie
epci_habitat_mini <- tibble::tribble(
  ~CODGEO, ~LIBGEO, ~EPCI, ~LIBEPCI, ~DEP, ~REG,
  "22001", "Commune A1", "200000001", "EPCI X", "22", "53",
  "29001", "Commune B", "200000002", "EPCI Y", "29", "53"
)

test_that("pivoter_logements_rp : mix de logements par commune", {
  p <- pivoter_logements_rp(logements_mini)

  expect_setequal(names(p), c("GEO", "logements", "logements_principales",
                              "logements_secondaires", "logements_vacants"))
  # 22001 : total = RP + RS + vacants (1000 = 850 + 50 + 100)
  expect_equal(p$logements[p$GEO == "22001"], 1000)
  expect_equal(p$logements_principales[p$GEO == "22001"], 850)
  expect_equal(p$logements_secondaires[p$GEO == "22001"], 50)
  expect_equal(p$logements_vacants[p$GEO == "22001"], 100)
  # 29001 : 600 = 500 + 40 + 60
  expect_equal(p$logements[p$GEO == "29001"], 600)
  expect_equal(p$logements_vacants[p$GEO == "29001"], 60)
  # la non-bretonne reste au pivot (filtrée plus tard à la jointure)
  expect_equal(p$logements[p$GEO == "44001"], 500)
})

test_that("pivoter_statut_rp : statut d'occupation des résidences principales", {
  p <- pivoter_statut_rp(logements_mini)

  expect_setequal(names(p), c("GEO", "statut_proprietaire", "statut_locataire",
                              "statut_loge_gratuit"))
  # 850 = 500 (propriétaire) + 250 (locataire) + 100 (gratuit) ; le détail 211
  # (sous-catégorie de locataire) est ignoré
  expect_equal(p$statut_proprietaire[p$GEO == "22001"], 500)
  expect_equal(p$statut_locataire[p$GEO == "22001"], 250)
  expect_equal(p$statut_loge_gratuit[p$GEO == "22001"], 100)
  expect_equal(p$statut_locataire[p$GEO == "29001"], 150)
})

test_that("pivoter_anciennete_rp : ancienneté d'emménagement des résidences principales", {
  p <- pivoter_anciennete_rp(logements_mini)

  expect_setequal(names(p), c("GEO", "anciennete_lt2", "anciennete_2_4",
                              "anciennete_5_9", "anciennete_10_19",
                              "anciennete_20_29", "anciennete_30_plus"))
  # 150 + 200 + 150 + 150 + 100 + 100 = 850 = RP de 22001
  expect_equal(p$anciennete_lt2[p$GEO == "22001"], 150)
  expect_equal(p$anciennete_2_4[p$GEO == "22001"], 200)
  expect_equal(p$anciennete_5_9[p$GEO == "22001"], 150)
  expect_equal(p$anciennete_10_19[p$GEO == "22001"], 150)
  expect_equal(p$anciennete_20_29[p$GEO == "22001"], 100)
  expect_equal(p$anciennete_30_plus[p$GEO == "22001"], 100)
  expect_equal(p$anciennete_lt2[p$GEO == "29001"], 80)
  expect_equal(p$anciennete_30_plus[p$GEO == "29001"], 60)
})

test_that("pivoter_taille_rp : taille (nombre de pièces) des résidences principales", {
  p <- pivoter_taille_rp(logements_mini)

  expect_setequal(names(p), c("GEO", "taille_r1", "taille_r2", "taille_r3",
                              "taille_r4", "taille_5_plus"))
  # 100 + 150 + 200 + 200 + 200 = 850 = RP de 22001
  expect_equal(p$taille_r1[p$GEO == "22001"], 100)
  expect_equal(p$taille_r2[p$GEO == "22001"], 150)
  expect_equal(p$taille_r3[p$GEO == "22001"], 200)
  expect_equal(p$taille_r4[p$GEO == "22001"], 200)
  expect_equal(p$taille_5_plus[p$GEO == "22001"], 200)
  expect_equal(p$taille_r1[p$GEO == "29001"], 50)
  expect_equal(p$taille_5_plus[p$GEO == "29001"], 80)
})

test_that("assembler_communes_rp : la forme du contrat, Bretagne seulement", {
  brut <- assembler_communes_rp(
    pivoter_logements_rp(logements_mini),
    pivoter_statut_rp(logements_mini),
    pivoter_anciennete_rp(logements_mini),
    pivoter_taille_rp(logements_mini),
    epci_habitat_mini
  )

  # une ligne par commune bretonne ; 44001 éliminée à la jointure
  expect_setequal(brut$code, c("22001", "29001"))
  expect_equal(nrow(brut), 2)
  expect_setequal(brut$nom, c("Commune A1", "Commune B"))
  expect_setequal(brut$departement, c("22", "29"))
  expect_setequal(brut$epci, c("200000001", "200000002"))

  # les champs des deux indicateurs de stock sont portés
  expect_true(all(c(
    "logements", "logements_principales", "logements_secondaires",
    "logements_vacants",
    "statut_proprietaire", "statut_locataire", "statut_loge_gratuit",
    "anciennete_lt2", "anciennete_2_4", "anciennete_5_9", "anciennete_10_19",
    "anciennete_20_29", "anciennete_30_plus",
    "taille_r1", "taille_r2", "taille_r3", "taille_r4", "taille_5_plus"
  ) %in% names(brut)))

  # valeurs de 22001
  l <- brut[brut$code == "22001", ]
  expect_equal(l$logements, 1000)
  expect_equal(l$logements_principales, 850)
  expect_equal(l$logements_secondaires, 50)
  expect_equal(l$logements_vacants, 100)
  expect_equal(l$statut_proprietaire, 500)
  expect_equal(l$statut_locataire, 250)
  expect_equal(l$statut_loge_gratuit, 100)
  expect_equal(l$anciennete_lt2, 150)
  expect_equal(l$anciennete_30_plus, 100)
  expect_equal(l$taille_r1, 100)
  expect_equal(l$taille_5_plus, 200)

  # cohérences structurelles documentées (docs/research/rp-logements.md)
  expect_equal(l$logements_principales + l$logements_secondaires +
                 l$logements_vacants, l$logements)
  expect_equal(l$statut_proprietaire + l$statut_locataire +
                 l$statut_loge_gratuit, l$logements_principales)
  expect_equal(l$anciennete_lt2 + l$anciennete_2_4 + l$anciennete_5_9 +
                 l$anciennete_10_19 + l$anciennete_20_29 + l$anciennete_30_plus,
               l$logements_principales)
  expect_equal(l$taille_r1 + l$taille_r2 + l$taille_r3 + l$taille_r4 +
                 l$taille_5_plus, l$logements_principales)
})
