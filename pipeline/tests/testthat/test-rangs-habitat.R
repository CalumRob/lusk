# Les rangs-en-contexte du thème Habitat (issue #17, ADR-0015/0021) : chaque
# indicateur est classé par SON scalaire déclaré (scalaires_habitat) — la part
# de secondaires pour le mix, la part de locataires pour statut/ancienneté/
# taille, la médiane poolée pour le prix, la part F/G pour l'énergie — en
# ORDINAL directionnel « Xᵉ / Y » : 1 = meilleur, la taille du groupe portée,
# un seul groupe par territoire (commune → son EPCI ; EPCI → tous les EPCIs
# bretons ; département → les départements). Low-is-good : part de passoires,
# distribution DPE et mix (classés par la part de secondaires — la tension
# logement) ; high-is-good : le prix et le statut/ancienneté/taille. Les
# valeurs NA (supprimées) n'empoisonnent pas leur groupe (la machinerie
# partagée).

test_that("rangs : la médiane poolée, avec l'ex æquo A1/C (même rang)", {
  p <- payload_habitat()
  # A1 et C sont ex æquo à 525 ; A1 est SEULE avec une valeur dans l'EPCI X
  # (D n < 10, E1/F1 sans mutation) -> 1er/1 ; C est 2e/2 dans l'EPCI Y
  r <- valeur_payload(p, "22001", "prix_m2")
  expect_equal(r$rang_epci[is.na(r$detail)], 1)
  expect_equal(r$rang_epci_n[is.na(r$detail)], 1)
  expect_true(is.na(r$rang_dep[is.na(r$detail)]))
  expect_true(is.na(r$rang_reg[is.na(r$detail)]))

  r2 <- valeur_payload(p, "29002", "prix_m2")
  expect_equal(r2$rang_epci[is.na(r2$detail)], 2)
  expect_equal(r2$rang_epci_n[is.na(r2$detail)], 2)
})

test_that("rangs : B en tête des prix, la commune supprimée n'a pas de rang", {
  p <- payload_habitat()
  # B : 750 > A1/C 525 -> 1er dans son EPCI (n = 2)
  r <- valeur_payload(p, "29001", "prix_m2")
  expect_equal(r$rang_epci[is.na(r$detail)], 1)
  expect_equal(r$rang_epci_n[is.na(r$detail)], 2)

  # D : pooled NA (n < 10) -> pas de rang, sans casser ceux des autres
  r3 <- valeur_payload(p, "22002", "prix_m2")
  expect_true(is.na(r3$value[is.na(r3$detail)]))
  expect_true(is.na(r3$rang_epci[is.na(r3$detail)]))
})

test_that("rangs : le prix est classé par la médiane poolée, pas par une année", {
  p <- payload_habitat()
  # le scalaire est la pooled (750 pour B) — la même valeur sur toutes les
  # lignes de l'indicateur (poolée et années)
  r <- valeur_payload(p, "29001", "prix_m2")
  expect_true(all(r$rang_epci == 1))
  # alors que la médiane 2025 de B (550) ne serait pas en tête : la pooled
  # classe — pas la série
  expect_equal(r$value[r$detail %in% "2025"], 550)
  expect_equal(r$rang_epci[r$detail %in% "2025"], 1)
})

test_that("rangs : les agrégats prix — EPCIs et départements se comparent entre eux", {
  p <- payload_habitat()
  # EPCI-X (550) au-dessus d'EPCI-Y (537.5) : X 1er/2, Y 2e/2 (ADR-0021 — la
  # comparaison des EPCIs est RÉGIONALE, jamais départementale)
  expect_equal(valeur_payload(p, "200000001", "prix_m2")$rang_reg[1], 1)
  expect_equal(valeur_payload(p, "200000001", "prix_m2")$rang_reg_n[1], 2)
  expect_equal(valeur_payload(p, "200000002", "prix_m2")$rang_reg[1], 2)
  # départements : 22 (550) au-dessus de 29 (537.5)
  expect_equal(valeur_payload(p, "22", "prix_m2")$rang_reg[1], 1)
  expect_equal(valeur_payload(p, "29", "prix_m2")$rang_reg[1], 2)
  # la région n'a aucun rang
  expect_true(all(is.na(valeur_payload(p, "53", "prix_m2")$rang_reg)))
})

test_that("rangs : le mix est classé par la part de secondaires (low-is-good)", {
  p <- payload_habitat()
  # parts de secondaires : A1 5% < E1 10% < D 13.3% < F1 15% (EPCI X) ;
  # C 8.3% < B 13.3% (EPCI Y). Low-is-good : la PLUS PETITE part est 1re.
  r <- valeur_payload(p, "22001", "mix_logements")
  expect_equal(r$rang_epci[r$detail == "secondaires"], 1)
  expect_equal(r$rang_epci_n[r$detail == "secondaires"], 4)
  expect_equal(valeur_payload(p, "22003", "mix_logements")$rang_epci[
    valeur_payload(p, "22003", "mix_logements")$detail == "secondaires"], 2)
  expect_equal(valeur_payload(p, "22002", "mix_logements")$rang_epci[
    valeur_payload(p, "22002", "mix_logements")$detail == "secondaires"], 3)
  expect_equal(valeur_payload(p, "22004", "mix_logements")$rang_epci[
    valeur_payload(p, "22004", "mix_logements")$detail == "secondaires"], 4)
  expect_equal(valeur_payload(p, "29002", "mix_logements")$rang_epci[
    valeur_payload(p, "29002", "mix_logements")$detail == "secondaires"], 1)
  # le rang est le même sur les trois lignes de catégorie
  expect_length(unique(valeur_payload(p, "22001", "mix_logements")$rang_epci), 1)
})

test_that("rangs : statut/ancienneté/taille est classé par la part de locataires (high-is-good)", {
  p <- payload_habitat()
  # parts de locataires : A1 250/850 < E1 120/400 = F1 90/300 < D 120/240
  # (EPCI X) ; C 300/1000 < B 400/1200 (EPCI Y). High-is-good : la PLUS
  # GRANDE part est 1re ; E1/F1 ex æquo partagent le 2e rang.
  expect_equal(valeur_payload(p, "22001", "statut_anciennete_taille")$rang_epci[1], 4)
  expect_equal(valeur_payload(p, "22002", "statut_anciennete_taille")$rang_epci[1], 1)
  expect_equal(valeur_payload(p, "22003", "statut_anciennete_taille")$rang_epci[1], 2)
  expect_equal(valeur_payload(p, "22004", "statut_anciennete_taille")$rang_epci[1], 2)
  expect_equal(valeur_payload(p, "29001", "statut_anciennete_taille")$rang_epci[1], 1)
  expect_equal(valeur_payload(p, "29002", "statut_anciennete_taille")$rang_epci[1], 2)
  # uniforme sur les 14 modalités
  expect_length(unique(valeur_payload(p, "22001",
                                      "statut_anciennete_taille")$rang_epci), 1)
})

test_that("rangs : l'énergie est classée par la part F/G (low-is-good)", {
  p <- payload_habitat()
  # parts F/G : E1 2/100 < C 1/32 < A1 2/33 < B 12/33 < F1 30/35 ;
  # D supprimée -> pas de rang
  expect_equal(valeur_payload(p, "22003", "part_passoires")$rang_epci, 1)
  expect_equal(valeur_payload(p, "22003", "part_passoires")$rang_epci_n, 3)
  expect_equal(valeur_payload(p, "29002", "part_passoires")$rang_epci, 1)
  expect_equal(valeur_payload(p, "22001", "part_passoires")$rang_epci, 2)
  expect_equal(valeur_payload(p, "29001", "part_passoires")$rang_epci, 2)
  expect_equal(valeur_payload(p, "22004", "part_passoires")$rang_epci, 3)
  expect_true(is.na(valeur_payload(p, "22002", "part_passoires")$rang_epci))

  # la distribution A–G porte le MÊME classement (le composant signature du
  # graphique est la part F/G)
  expect_equal(valeur_payload(p, "29001", "distribution_dpe")$rang_epci,
               rep(2, 7))
  # agrégats : EPCI-Y (13/65) au-dessus d'EPCI-X (39/174) — E et F pèsent sur
  # le 22 (EPCI-X) depuis l'extension du fixture (issue #18) ; low-is-good :
  # la plus petite part F/G est 1re
  expect_equal(valeur_payload(p, "200000002", "part_passoires")$rang_reg, 1)
  expect_equal(valeur_payload(p, "200000001", "part_passoires")$rang_reg, 2)
  expect_equal(valeur_payload(p, "29", "part_passoires")$rang_reg, 1)
  expect_equal(valeur_payload(p, "22", "part_passoires")$rang_reg, 2)
})
