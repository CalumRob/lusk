# test-nettoyage-dpe -----------------------------------------------------------
# Les règles de nettoyage du DPE (issue #16) sur un jeu synthétique — jamais de
# réseau. Le contrat de la table DPE processée :
#   - actifs seulement (la vue publique exclut déjà les DPE désactivés ;
#     le filtre est défensif, pour le cas d'un dump brut) ;
#   - une ligne par LOGEMENT-ÉQUIVALENT : maisons/appartements = poids 1,
#     immeubles pondérés par nombre_appartement ;
#   - dédoublonnage par logement : date d'établissement la plus récente,
#     version_dpe >= 2.1 préférée à date égale ;
#   - un appartement avec son propre DPE l'emporte sur la contribution de son
#     immeuble (numero_dpe_immeuble_associe) : le poids de l'immeuble est réduit
#     d'autant ;
#   - les deux dates portées (date_etablissement_dpe, date_derniere_modification_dpe) ;
#   - code commune (code_insee_ban, 5 chiffres) et étiquette (etiquette_dpe)
#     conservés, étiquette normalisée en majuscules.

# ligne_dpe --------------------------------------------------------------------
# Fabrique une ligne de DPE brute (forme du pull API) avec des valeurs par
# défaut — pour construire de petits scénarios ciblés sans répéter les colonnes.
ligne_dpe <- function(numero_dpe, date_etablissement_dpe, version_dpe,
                      etiquette_dpe = "D", etiquette_ges = "D",
                      type_batiment = "maison",
                      nombre_appartement = NA_real_,
                      position_logement_dans_immeuble = NA_character_,
                      numero_dpe_immeuble_associe = NA_character_,
                      numero_dpe_remplace = NA_character_,
                      id_rnb = NA_character_,
                      code_insee_ban = "22001",
                      code_departement_ban = "22",
                      date_derniere_modification_dpe = NA_character_,
                      dpe_desactive = "0") {
  tibble::tibble(
    numero_dpe = numero_dpe,
    numero_dpe_remplace = numero_dpe_remplace,
    numero_dpe_immeuble_associe = numero_dpe_immeuble_associe,
    date_etablissement_dpe = date_etablissement_dpe,
    date_derniere_modification_dpe = date_derniere_modification_dpe,
    version_dpe = version_dpe,
    etiquette_dpe = etiquette_dpe,
    etiquette_ges = etiquette_ges,
    type_batiment = type_batiment,
    nombre_appartement = nombre_appartement,
    position_logement_dans_immeuble = position_logement_dans_immeuble,
    code_insee_ban = code_insee_ban,
    code_departement_ban = code_departement_ban,
    id_rnb = id_rnb,
    dpe_desactive = dpe_desactive
  )
}

# jeu_dpe_synthetique ----------------------------------------------------------
# Le scénario complet — couvre : dédoublonnage maison par date (M1A -> M1B),
# chaîne de remplacement (D1 -> D2), dédoublonnage appartement dans le même
# immeuble (F1A -> F1B), immeuble pondéré avec appartements propres (IMM1),
# immeuble entièrement couvert par ses appartements (IMM2, retiré),
# DPE désactivé (M3, retiré), étiquettes en minuscules (F1A/F2, normalisées).
jeu_dpe_synthetique <- function() {
  tibble::tibble(
    numero_dpe = c("M1A", "M1B", "M2A", "C1", "D1", "D2",
                   "IMM1", "F1A", "F1B", "F2",
                   "IMM2", "F3", "F4", "M3"),
    numero_dpe_remplace = c(NA, NA, NA, NA, NA, "D1",
                            NA, NA, NA, NA,
                            NA, NA, NA, NA),
    numero_dpe_immeuble_associe = c(NA, NA, NA, NA, NA, NA,
                                    NA, "IMM1", "IMM1", "IMM1",
                                    NA, "IMM2", "IMM2", NA),
    date_etablissement_dpe = c("2023-05-01", "2025-06-15", "2024-01-10",
                               "2023-09-09", "2022-03-03", "2024-05-05",
                               "2023-03-03", "2024-04-04", "2025-05-05",
                               "2024-04-05", "2024-01-01", "2024-02-02",
                               "2024-02-03", "2023-01-01"),
    date_derniere_modification_dpe = c("2024-01-01", "2025-06-20", NA,
                                       NA, NA, NA,
                                       "2024-02-02", NA, "2025-05-06", NA,
                                       NA, NA, NA, NA),
    version_dpe = c("2.0", "2.2", "2.1", "2.1", "2.0", "2.1",
                    "2.0", "2.1", "2.2", "2.1",
                    "2.1", "2.1", "2.1", "2.1"),
    etiquette_dpe = c("F", "D", "G", "C", "E", "D",
                      "E", "d", "C", "f",
                      "B", "A", "D", "G"),
    etiquette_ges = c("G", "D", "G", "B", "E", "C",
                      "E", "D", "B", "F",
                      "B", "A", "D", "G"),
    type_batiment = c("maison", "maison", "maison", "maison", "maison", "maison",
                      "immeuble", "appartement", "appartement", "appartement",
                      "immeuble", "appartement", "appartement", "maison"),
    nombre_appartement = c(NA, NA, NA, NA, NA, NA,
                           5, NA, NA, NA,
                           2, NA, NA, NA),
    position_logement_dans_immeuble = c(NA, NA, NA, NA, NA, NA,
                                        NA, "ETAGE 1", "ETAGE 1", "ETAGE 2",
                                        NA, "ETAGE 1", "ETAGE 2", NA),
    code_insee_ban = c("22001", "22001", "22001", "29001", "35001", "35001",
                       "35001", "35001", "35001", "35001",
                       "56001", "56001", "56001", "56001"),
    code_departement_ban = c("22", "22", "22", "29", "35", "35",
                             "35", "35", "35", "35",
                             "56", "56", "56", "56"),
    id_rnb = c("RNB-M1", "RNB-M1", "RNB-M2", NA, NA, NA,
               "RNB-I1", NA, NA, NA,
               "RNB-I2", NA, NA, "RNB-M3"),
    dpe_desactive = c("0", "0", "0", "0", "0", "0",
                      "0", "0", "0", "0",
                      "0", "0", "0", "1")
  )
}

test_that("nettoyer_dpe : une ligne par logement-équivalent, immeuble pondéré, dates et code portés", {
  res <- nettoyer_dpe(jeu_dpe_synthetique())

  # 9 lignes : M1B, M2A, C1, D2 (maisons) ; IMM1 (pondéré 5 - 2) ;
  # F1B, F2, F3, F4 (appartements)
  expect_equal(nrow(res), 9)
  expect_equal(sort(res$numero_dpe),
               sort(c("M1B", "M2A", "C1", "D2", "IMM1", "F1B", "F2", "F3", "F4")))

  # 11 logements-équivalents : 4 maisons + immeuble IMM1 (3) + 4 appartements
  expect_equal(sum(res$poids), 11)

  # le poids de l'immeuble : nombre_appartement - appartements propres
  expect_equal(res$poids[res$numero_dpe == "IMM1"], 3)
  expect_equal(res$poids[res$numero_dpe %in% c("M1B", "C1", "F1B", "F4")],
               rep(1, 4))

  # les deux dates sont portées
  expect_true(all(c("date_etablissement_dpe", "date_derniere_modification_dpe") %in%
                    names(res)))
  expect_equal(res$date_etablissement_dpe[res$numero_dpe == "M1B"],
               as.Date("2025-06-15"))
  expect_equal(res$date_derniere_modification_dpe[res$numero_dpe == "M1B"],
               as.Date("2025-06-20"))

  # code commune 5 chiffres en caractères (les zéros de tête survivent)
  expect_type(res$code_insee_ban, "character")
  expect_true(all(nchar(res$code_insee_ban) == 5))

  # étiquette conservée, normalisée en majuscules
  expect_equal(res$etiquette_dpe[res$numero_dpe == "F2"], "F")
  expect_equal(res$etiquette_dpe[res$numero_dpe == "M1B"], "D")
})

test_that("nettoyer_dpe : seuls les DPE actifs restent", {
  res <- nettoyer_dpe(jeu_dpe_synthetique())
  # M3 est désactivé (dpe_desactive = "1") : retiré
  expect_false("M3" %in% res$numero_dpe)
  expect_false("M3" %in% nettoyer_dpe(jeu_dpe_synthetique())$numero_dpe)

  # sans colonne dpe_desactive (la vue publique du pull ne la porte pas),
  # le nettoyage passe sans erreur et seul le filtre actif est sauté : le DPE
  # désactivé M3 reste, les autres règles (dédoublonnage, pondération)
  # s'appliquent — 10 lignes au lieu de 9
  sans_colonne <- dplyr::select(jeu_dpe_synthetique(), -dpe_desactive)
  res2 <- nettoyer_dpe(sans_colonne)
  expect_true("M3" %in% res2$numero_dpe)
  expect_equal(nrow(res2), 10)
})

test_that("nettoyer_dpe : le DPE le plus récent d'un même logement l'emporte", {
  res <- nettoyer_dpe(jeu_dpe_synthetique())
  # M1A (2023) et M1B (2025) partagent id_rnb = RNB-M1 : seule M1B reste
  expect_false("M1A" %in% res$numero_dpe)
  expect_true("M1B" %in% res$numero_dpe)

  # appartement : F1A et F1B partagent (immeuble IMM1, position ETAGE 1)
  expect_false("F1A" %in% res$numero_dpe)
  expect_true("F1B" %in% res$numero_dpe)
})

test_that("nettoyer_dpe : à date égale, la version >= 2.1 est préférée", {
  dpe <- dplyr::bind_rows(
    ligne_dpe("V1", "2024-01-01", "2.0", etiquette_dpe = "F"),
    ligne_dpe("V2", "2024-01-01", "2.2", etiquette_dpe = "D", id_rnb = "RNB-X")
  )
  # V1 omet id_rnb : on le force pour que les deux partagent le même logement
  dpe$id_rnb <- "RNB-X"

  res <- nettoyer_dpe(dpe)
  expect_equal(res$numero_dpe, "V2")
})

test_that("nettoyer_dpe : une date plus récente prime sur une version plus ancienne", {
  dpe <- dplyr::bind_rows(
    ligne_dpe("V1", "2023-01-01", "2.2", etiquette_dpe = "D", id_rnb = "RNB-Y"),
    ligne_dpe("V2", "2025-06-01", "2.0", etiquette_dpe = "F", id_rnb = "RNB-Y")
  )

  res <- nettoyer_dpe(dpe)
  expect_equal(res$numero_dpe, "V2")  # 2025, même si version 2.0
})

test_that("nettoyer_dpe : un DPE remplacé (numero_dpe_remplace) est retiré", {
  res <- nettoyer_dpe(jeu_dpe_synthetique())
  # D1 est remplacé par D2 (D2.numero_dpe_remplace = "D1") — seule D2 reste,
  # même sans identifiant de logement (pas d'id_rnb)
  expect_false("D1" %in% res$numero_dpe)
  expect_true("D2" %in% res$numero_dpe)
})

test_that("nettoyer_dpe : un immeuble sans appartement propre est pondéré par nombre_appartement", {
  dpe <- dplyr::bind_rows(
    ligne_dpe("IMM-SOLO", "2024-01-01", "2.1", type_batiment = "immeuble",
              nombre_appartement = 5, id_rnb = "RNB-I3", etiquette_dpe = "E")
  )
  res <- nettoyer_dpe(dpe)
  expect_equal(nrow(res), 1)
  expect_equal(res$numero_dpe, "IMM-SOLO")
  expect_equal(res$poids, 5)
})

test_that("nettoyer_dpe : l'appartement propre l'emporte sur la contribution de son immeuble", {
  res <- nettoyer_dpe(jeu_dpe_synthetique())
  # IMM1 a 5 appartements déclarés, F1B et F2 ont leur propre DPE
  # (numero_dpe_immeuble_associe = IMM1) : le poids d'IMM1 tombe à 3,
  # et les deux appartements comptent pour 1 chacun — 5 équivalents au total
  expect_equal(res$poids[res$numero_dpe == "IMM1"], 3)
  expect_equal(res$poids[res$numero_dpe %in% c("F1B", "F2")], c(1, 1))
  expect_equal(sum(res$poids[res$numero_dpe %in% c("IMM1", "F1B", "F2")]), 5)
})

test_that("nettoyer_dpe : un immeuble entièrement couvert par ses appartements est retiré", {
  res <- nettoyer_dpe(jeu_dpe_synthetique())
  # IMM2 a 2 appartements déclarés, F3 et F4 ont leur propre DPE :
  # poids = 2 - 2 = 0 -> l'immeuble ne représente plus aucun logement
  expect_false("IMM2" %in% res$numero_dpe)
  expect_true(all(c("F3", "F4") %in% res$numero_dpe))
  expect_equal(res$poids[res$numero_dpe %in% c("F3", "F4")], c(1, 1))
})

test_that("nettoyer_dpe : les lignes sans identité de logement sont conservées telles quelles", {
  # deux appartements sans lien immeuble et sans id_rnb : rien ne prouve que ce
  # soit le même logement — les deux restent, chacun poids 1
  dpe <- dplyr::bind_rows(
    ligne_dpe("NA1", "2024-01-01", "2.1", type_batiment = "appartement"),
    ligne_dpe("NA2", "2024-02-01", "2.1", type_batiment = "appartement",
              etiquette_dpe = "F")
  )
  res <- nettoyer_dpe(dpe)
  expect_equal(sort(res$numero_dpe), c("NA1", "NA2"))
  expect_equal(res$poids, c(1, 1))
})

test_that("nettoyer_dpe : un immeuble sans nombre_appartement est retiré", {
  dpe <- dplyr::bind_rows(
    ligne_dpe("IMM-NB-NA", "2024-01-01", "2.1", type_batiment = "immeuble",
              id_rnb = "RNB-I4")
  )
  res <- nettoyer_dpe(dpe)
  expect_equal(nrow(res), 0)
})
