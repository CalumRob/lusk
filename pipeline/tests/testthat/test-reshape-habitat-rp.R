# Le remodelage de la source Habitat RP Logements (issue #14) : des fichiers
# longs INSEE vers la forme du contrat — la table des communes bretonnes par le
# stock de logements. Le mini-fixture ci-dessous reproduit le format RÉEL du
# dossier complet Logements (DS_RP_LOGEMENT_PRINC, docs/research/rp-logements.md) :
# 16 colonnes, séparateur ; dans les vrais fichiers, GEO;GEO_OBJECT;OCS;L_STAY;
# TDW;CARS;RP_MEASURE;CARPARK;NOR;TSH;BUILD_END;NRG_SRC;FREQ;OBS_STATUS;
# TIME_PERIOD;OBS_VALUE. Les pivots ne lisent que les colonnes utiles.
# Depuis l'issue #368, le statut (4 parts dont le HLM), l'âge du bâti (les 6
# tranches BUILD_END) et le type (maison / appartement) remplacent l'ancienne
# clé à 14 modalités (l'ancienneté L_STAY et la taille NOR ne sont plus
# pivotées).

# logements_mini --------------------------------------------------------------
# Deux communes bretonnes (22001, 29001) + une non-bretonne (44001, éliminée à
# la jointure EPCI). Valeurs réelles plausibles qui vérifient les cohérences
# documentées : _T = DW_MAIN + DW_SEC_DW_OCC + DW_VAC ; statut 100+221+(211+
# 212_222)+300 = _T ; 6 tranches BUILD_END = _T ; maison + appartement = _T.
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
  # la mesure DWELLINGS_ROOMS (total de pièces, PAS une distribution) : ignorée
  "22001", "COM", "DW_MAIN", "_T", "_T", "_T", "DWELLINGS_ROOMS", "_T", "_T", "_T", "_T", "_T", "A", "A", 2023, 3000,
  # --- 22001 : statut d'occupation (TSH), RP seulement — les QUATRE parts de
  # l'issue #368 : propriétaire (100), parc social / HLM (221), parc privé
  # (211 + 212_222) et logé gratuitement (300)
  "22001", "COM", "DW_MAIN", "_T", "_T", "_T", "DWELLINGS", "_T", "_T", "100", "_T", "_T", "A", "A", 2023, 500,
  "22001", "COM", "DW_MAIN", "_T", "_T", "_T", "DWELLINGS", "_T", "_T", "211", "_T", "_T", "A", "A", 2023, 100,
  "22001", "COM", "DW_MAIN", "_T", "_T", "_T", "DWELLINGS", "_T", "_T", "212_222", "_T", "_T", "A", "A", 2023, 50,
  "22001", "COM", "DW_MAIN", "_T", "_T", "_T", "DWELLINGS", "_T", "_T", "221", "_T", "_T", "A", "A", 2023, 100,
  "22001", "COM", "DW_MAIN", "_T", "_T", "_T", "DWELLINGS", "_T", "_T", "300", "_T", "_T", "A", "A", 2023, 100,
  # le total locataire (200) est ignoré (les sous-catégories partitionnent)
  "22001", "COM", "DW_MAIN", "_T", "_T", "_T", "DWELLINGS", "_T", "_T", "200", "_T", "_T", "A", "A", 2023, 250,
  # --- 22001 : âge du bâti (BUILD_END), RP seulement — les 6 tranches
  "22001", "COM", "DW_MAIN", "_T", "_T", "_T", "DWELLINGS", "_T", "_T", "_T", "Y_LT1919", "_T", "A", "A", 2023, 100,
  "22001", "COM", "DW_MAIN", "_T", "_T", "_T", "DWELLINGS", "_T", "_T", "_T", "Y1919T1945", "_T", "A", "A", 2023, 150,
  "22001", "COM", "DW_MAIN", "_T", "_T", "_T", "DWELLINGS", "_T", "_T", "_T", "Y1946T1970", "_T", "A", "A", 2023, 200,
  "22001", "COM", "DW_MAIN", "_T", "_T", "_T", "DWELLINGS", "_T", "_T", "_T", "Y1971T1990", "_T", "A", "A", 2023, 200,
  "22001", "COM", "DW_MAIN", "_T", "_T", "_T", "DWELLINGS", "_T", "_T", "_T", "Y1991T2005", "_T", "A", "A", 2023, 100,
  "22001", "COM", "DW_MAIN", "_T", "_T", "_T", "DWELLINGS", "_T", "_T", "_T", "Y2006TAAAA", "_T", "A", "A", 2023, 100,
  # le niveau agrégé Y_LT2021 est ignoré (une redondance du cube)
  "22001", "COM", "DW_MAIN", "_T", "_T", "_T", "DWELLINGS", "_T", "_T", "_T", "Y_LT2021", "_T", "A", "A", 2023, 850,
  # --- 22001 : type de logement (TDW), RP seulement — maison (1) / appartement (2)
  "22001", "COM", "DW_MAIN", "_T", "1", "_T", "DWELLINGS", "_T", "_T", "_T", "_T", "_T", "A", "A", 2023, 550,
  "22001", "COM", "DW_MAIN", "_T", "2", "_T", "DWELLINGS", "_T", "_T", "_T", "_T", "_T", "A", "A", 2023, 300,
  # la famille « autres » (3T6) est ignorée par le pivot type
  "22001", "COM", "DW_MAIN", "_T", "3T6", "_T", "DWELLINGS", "_T", "_T", "_T", "_T", "_T", "A", "A", 2023, 10,
  # l'ancienneté d'emménagement (L_STAY) et la taille (NOR) ne sont PLUS
  # pivotées (issue #368) : leurs lignes sont ignorées
  "22001", "COM", "DW_MAIN", "Y_LT2", "_T", "_T", "DWELLINGS", "_T", "_T", "_T", "_T", "_T", "A", "A", 2023, 150,
  "22001", "COM", "DW_MAIN", "_T", "_T", "_T", "DWELLINGS", "_T", "R1", "_T", "_T", "_T", "A", "A", 2023, 100,
  # --- 29001 : catégorie de logement
  "29001", "COM", "_T", "_T", "_T", "_T", "DWELLINGS", "_T", "_T", "_T", "_T", "_T", "A", "A", 2023, 600,
  "29001", "COM", "DW_MAIN", "_T", "_T", "_T", "DWELLINGS", "_T", "_T", "_T", "_T", "_T", "A", "A", 2023, 500,
  "29001", "COM", "DW_SEC_DW_OCC", "_T", "_T", "_T", "DWELLINGS", "_T", "_T", "_T", "_T", "_T", "A", "A", 2023, 40,
  "29001", "COM", "DW_VAC", "_T", "_T", "_T", "DWELLINGS", "_T", "_T", "_T", "_T", "_T", "A", "A", 2023, 60,
  # --- 29001 : statut d'occupation
  "29001", "COM", "DW_MAIN", "_T", "_T", "_T", "DWELLINGS", "_T", "_T", "100", "_T", "_T", "A", "A", 2023, 300,
  "29001", "COM", "DW_MAIN", "_T", "_T", "_T", "DWELLINGS", "_T", "_T", "211", "_T", "_T", "A", "A", 2023, 60,
  "29001", "COM", "DW_MAIN", "_T", "_T", "_T", "DWELLINGS", "_T", "_T", "212_222", "_T", "_T", "A", "A", 2023, 40,
  "29001", "COM", "DW_MAIN", "_T", "_T", "_T", "DWELLINGS", "_T", "_T", "221", "_T", "_T", "A", "A", 2023, 50,
  "29001", "COM", "DW_MAIN", "_T", "_T", "_T", "DWELLINGS", "_T", "_T", "300", "_T", "_T", "A", "A", 2023, 50,
  # --- 29001 : âge du bâti
  "29001", "COM", "DW_MAIN", "_T", "_T", "_T", "DWELLINGS", "_T", "_T", "_T", "Y_LT1919", "_T", "A", "A", 2023, 80,
  "29001", "COM", "DW_MAIN", "_T", "_T", "_T", "DWELLINGS", "_T", "_T", "_T", "Y1919T1945", "_T", "A", "A", 2023, 100,
  "29001", "COM", "DW_MAIN", "_T", "_T", "_T", "DWELLINGS", "_T", "_T", "_T", "Y1946T1970", "_T", "A", "A", 2023, 120,
  "29001", "COM", "DW_MAIN", "_T", "_T", "_T", "DWELLINGS", "_T", "_T", "_T", "Y1971T1990", "_T", "A", "A", 2023, 100,
  "29001", "COM", "DW_MAIN", "_T", "_T", "_T", "DWELLINGS", "_T", "_T", "_T", "Y1991T2005", "_T", "A", "A", 2023, 60,
  "29001", "COM", "DW_MAIN", "_T", "_T", "_T", "DWELLINGS", "_T", "_T", "_T", "Y2006TAAAA", "_T", "A", "A", 2023, 40,
  # --- 29001 : type de logement
  "29001", "COM", "DW_MAIN", "_T", "1", "_T", "DWELLINGS", "_T", "_T", "_T", "_T", "_T", "A", "A", 2023, 350,
  "29001", "COM", "DW_MAIN", "_T", "2", "_T", "DWELLINGS", "_T", "_T", "_T", "_T", "_T", "A", "A", 2023, 150,
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

test_that("pivoter_statut_rp : les QUATRE parts du statut (HLM comprise), la partition des RP", {
  p <- pivoter_statut_rp(logements_mini)

  expect_setequal(names(p), c("GEO", "statut_proprietaire", "statut_hlm",
                              "statut_locataire_prive", "statut_loge_gratuit"))
  # 22001 : 850 = 500 (propriétaire) + 100 (HLM — le parc social 221) +
  # 150 (parc privé : 211 + 212_222) + 100 (gratuit) ; le total locataire 200
  # est ignoré (les sous-catégories partitionnent)
  expect_equal(p$statut_proprietaire[p$GEO == "22001"], 500)
  expect_equal(p$statut_hlm[p$GEO == "22001"], 100)
  expect_equal(p$statut_locataire_prive[p$GEO == "22001"], 150)
  expect_equal(p$statut_loge_gratuit[p$GEO == "22001"], 100)
  expect_equal(p$statut_proprietaire[p$GEO == "29001"], 300)
  expect_equal(p$statut_hlm[p$GEO == "29001"], 50)
  expect_equal(p$statut_locataire_prive[p$GEO == "29001"], 100)
  expect_equal(p$statut_loge_gratuit[p$GEO == "29001"], 50)
})

test_that("pivoter_build_end_rp : les 6 tranches de la période d'achèvement", {
  p <- pivoter_build_end_rp(logements_mini)

  expect_setequal(names(p), c("GEO", "bati_lt1919", "bati_1919_1945",
                              "bati_1946_1970", "bati_1971_1990",
                              "bati_1991_2005", "bati_2006_plus"))
  # 100 + 150 + 200 + 200 + 100 + 100 = 850 = RP de 22001 ; le niveau agrégé
  # Y_LT2021 est ignoré (une redondance du cube, jamais un double comptage)
  expect_equal(p$bati_lt1919[p$GEO == "22001"], 100)
  expect_equal(p$bati_1919_1945[p$GEO == "22001"], 150)
  expect_equal(p$bati_1946_1970[p$GEO == "22001"], 200)
  expect_equal(p$bati_1971_1990[p$GEO == "22001"], 200)
  expect_equal(p$bati_1991_2005[p$GEO == "22001"], 100)
  expect_equal(p$bati_2006_plus[p$GEO == "22001"], 100)
  expect_equal(p$bati_lt1919[p$GEO == "29001"], 80)
  expect_equal(p$bati_2006_plus[p$GEO == "29001"], 40)
})

test_that("pivoter_type_rp : maison / appartement, la famille « autres » écartée", {
  p <- pivoter_type_rp(logements_mini)

  expect_setequal(names(p), c("GEO", "type_maison", "type_appartement"))
  # 550 + 300 = 850 = RP de 22001 ; le 3T6 (autres) est ignoré
  expect_equal(p$type_maison[p$GEO == "22001"], 550)
  expect_equal(p$type_appartement[p$GEO == "22001"], 300)
  expect_equal(p$type_maison[p$GEO == "29001"], 350)
  expect_equal(p$type_appartement[p$GEO == "29001"], 150)
})

test_that("assembler_communes_rp : la forme du contrat, Bretagne seulement", {
  brut <- assembler_communes_rp(
    pivoter_logements_rp(logements_mini),
    pivoter_statut_rp(logements_mini),
    pivoter_build_end_rp(logements_mini),
    pivoter_type_rp(logements_mini),
    epci_habitat_mini
  )

  # une ligne par commune bretonne ; 44001 éliminée à la jointure
  expect_setequal(brut$code, c("22001", "29001"))
  expect_equal(nrow(brut), 2)
  expect_setequal(brut$nom, c("Commune A1", "Commune B"))
  expect_setequal(brut$departement, c("22", "29"))
  expect_setequal(brut$epci, c("200000001", "200000002"))

  # les champs des indicateurs de stock sont portés (le split #368 : statut 4
  # parts + âge du bâti 6 tranches + type maison/appartement)
  expect_true(all(c(
    "logements", "logements_principales", "logements_secondaires",
    "logements_vacants",
    "statut_proprietaire", "statut_hlm", "statut_locataire_prive",
    "statut_loge_gratuit",
    "bati_lt1919", "bati_1919_1945", "bati_1946_1970",
    "bati_1971_1990", "bati_1991_2005", "bati_2006_plus",
    "type_maison", "type_appartement"
  ) %in% names(brut)))
  # l'ancienneté et la taille ne sont PLUS portées (issue #368)
  expect_false(any(grepl("anciennete_|taille_", names(brut))))

  # valeurs de 22001
  l <- brut[brut$code == "22001", ]
  expect_equal(l$logements, 1000)
  expect_equal(l$logements_principales, 850)
  expect_equal(l$logements_secondaires, 50)
  expect_equal(l$logements_vacants, 100)
  expect_equal(l$statut_proprietaire, 500)
  expect_equal(l$statut_hlm, 100)
  expect_equal(l$statut_locataire_prive, 150)
  expect_equal(l$statut_loge_gratuit, 100)
  expect_equal(l$bati_lt1919, 100)
  expect_equal(l$bati_2006_plus, 100)
  expect_equal(l$type_maison, 550)
  expect_equal(l$type_appartement, 300)

  # cohérences structurelles documentées (docs/research/rp-logements.md)
  expect_equal(l$logements_principales + l$logements_secondaires +
                 l$logements_vacants, l$logements)
  expect_equal(l$statut_proprietaire + l$statut_hlm +
                 l$statut_locataire_prive + l$statut_loge_gratuit,
               l$logements_principales)
  expect_equal(l$bati_lt1919 + l$bati_1919_1945 + l$bati_1946_1970 +
                 l$bati_1971_1990 + l$bati_1991_2005 + l$bati_2006_plus,
               l$logements_principales)
  expect_equal(l$type_maison + l$type_appartement, l$logements_principales)
})
