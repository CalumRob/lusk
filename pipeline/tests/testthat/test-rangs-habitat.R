# Les rangs-en-contexte du thème Habitat (issue #17) : chaque indicateur est
# classé par SON scalaire déclaré (scalaires_habitat) — la part de secondaires
# pour le mix, la part de locataires pour statut/ancienneté/taille, la médiane
# poolée pour le prix, la part F/G pour l'énergie. Les valeurs NA (supprimées)
# n'empoisonnent pas leur groupe (la machinerie partagée).

test_that("rangs : la médiane poolée, avec l'ex æquo A1/C (symétrique)", {
  p <- payload_habitat()
  r <- valeur_payload(p, "22001", "prix_m2")
  # A1 et C sont ex æquo à 525 ; région (n = 3 non-NA : A1, B, C) : 1 en
  # dessous + 1 ex æquo -> 0.5/3
  expect_equal(r$rang_epci[is.na(r$detail)], 0)
  expect_equal(r$rang_dep[is.na(r$detail)], 0)
  expect_equal(r$rang_reg[is.na(r$detail)], 1 / 6)

  r2 <- valeur_payload(p, "29002", "prix_m2")
  expect_equal(r2$rang_epci[is.na(r2$detail)], 0)
  expect_equal(r2$rang_reg[is.na(r2$detail)], 1 / 6)
})

test_that("rangs : B en tête des prix, la commune supprimée n'a pas de rang", {
  p <- payload_habitat()
  # B : 750 > A1/C 525 -> rang 0.5 dans son EPCI, 0.5 dans son département,
  # 2/3 dans la région
  r <- valeur_payload(p, "29001", "prix_m2")
  expect_equal(r$rang_epci[is.na(r$detail)], 0.5)
  expect_equal(r$rang_dep[is.na(r$detail)], 0.5)
  expect_equal(r$rang_reg[is.na(r$detail)], 2 / 3)

  # D : pooled NA (n < 10) -> pas de rang, sans casser ceux des autres
  r3 <- valeur_payload(p, "22002", "prix_m2")
  expect_true(is.na(r3$value[is.na(r3$detail)]))
  expect_true(is.na(r3$rang_reg[is.na(r3$detail)]))
})

test_that("rangs : le prix est classé par la médiane poolée, pas par une année", {
  p <- payload_habitat()
  # le scalaire est la pooled (750 pour B) — la même valeur sur toutes les
  # lignes de l'indicateur (poolée et années)
  r <- valeur_payload(p, "29001", "prix_m2")
  expect_true(all(r$rang_reg == 2 / 3))
  # alors que la médiane 2025 de B (550) ne serait pas en tête : la pooled
  # classe — pas la série
  expect_equal(r$value[r$detail %in% "2025"], 550)
  expect_equal(r$rang_reg[r$detail %in% "2025"], 2 / 3)
})

test_that("rangs : les agrégats prix — EPCI et départements", {
  p <- payload_habitat()
  # EPCI-X (550) au-dessus d'EPCI-Y (537.5) dans la région des EPCIs
  expect_equal(valeur_payload(p, "200000001", "prix_m2")$rang_reg[1], 0.5)
  expect_equal(valeur_payload(p, "200000002", "prix_m2")$rang_reg[1], 0)
  # départements : 22 (550) au-dessus de 29 (537.5)
  expect_equal(valeur_payload(p, "22", "prix_m2")$rang_reg[1], 0.5)
  expect_equal(valeur_payload(p, "29", "prix_m2")$rang_reg[1], 0)
  # la région n'a aucun rang
  expect_true(all(is.na(valeur_payload(p, "53", "prix_m2")$rang_reg)))
})

test_that("rangs : le mix est classé par la part de secondaires", {
  p <- payload_habitat()
  # parts : A1 5% < C 8.3% < D/B 13.3% (ex æquo) — classement par secondaires
  r <- valeur_payload(p, "22001", "mix_logements")
  expect_equal(r$rang_reg[r$detail == "secondaires"], 0)
  # l'ex æquo D/B à la région : 2 en dessous + 0.5 -> 2.5/4
  expect_equal(valeur_payload(p, "22002", "mix_logements")$rang_reg[
    valeur_payload(p, "22002", "mix_logements")$detail == "secondaires"], 0.625)
  expect_equal(valeur_payload(p, "29001", "mix_logements")$rang_reg[
    valeur_payload(p, "29001", "mix_logements")$detail == "secondaires"], 0.625)
  # le rang est le même sur les trois lignes de catégorie
  expect_length(unique(valeur_payload(p, "22001", "mix_logements")$rang_reg), 1)
})

test_that("rangs : statut/ancienneté/taille est classé par la part de locataires", {
  p <- payload_habitat()
  # parts de locataires : A1 250/850 < C 300/1000 < B 400/1200 < D 120/240
  expect_equal(valeur_payload(p, "22001", "statut_anciennete_taille")$rang_reg[1], 0)
  expect_equal(valeur_payload(p, "22002", "statut_anciennete_taille")$rang_reg[1], 0.75)
  expect_equal(valeur_payload(p, "29001", "statut_anciennete_taille")$rang_reg[1], 0.5)
  expect_equal(valeur_payload(p, "29002", "statut_anciennete_taille")$rang_reg[1], 0.25)
  # uniforme sur les 14 modalités
  expect_length(unique(valeur_payload(p, "22001",
                                      "statut_anciennete_taille")$rang_reg), 1)
})

test_that("rangs : l'énergie est classée par la part F/G", {
  p <- payload_habitat()
  # parts F/G : C 1/32 < A1 2/33 < B 12/33 ; D supprimée -> pas de rang
  expect_equal(valeur_payload(p, "29002", "part_passoires")$rang_reg, 0)
  expect_equal(valeur_payload(p, "22001", "part_passoires")$rang_reg, 1 / 3)
  expect_equal(valeur_payload(p, "29001", "part_passoires")$rang_reg, 2 / 3)
  expect_true(is.na(valeur_payload(p, "22002", "part_passoires")$rang_reg))

  # la distribution A–G porte le MÊME classement (le composant signature du
  # graphique est la part F/G)
  expect_equal(valeur_payload(p, "29001", "distribution_dpe")$rang_reg,
               rep(2 / 3, 7))
  # agrégats : EPCI-Y (0.2) au-dessus d'EPCI-X (7/39)
  expect_equal(valeur_payload(p, "200000002", "part_passoires")$rang_reg, 0.5)
  expect_equal(valeur_payload(p, "200000001", "part_passoires")$rang_reg, 0)
  expect_equal(valeur_payload(p, "29", "part_passoires")$rang_reg, 0.5)
  expect_equal(valeur_payload(p, "22", "part_passoires")$rang_reg, 0)
})
