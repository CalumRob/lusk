# Les rangs-en-contexte du thème Habitat (issue #17, ADR-0015/0021) : chaque
# indicateur est classé par SON scalaire déclaré (scalaires_habitat, l'audit
# ordinal de l'issue #368) — la part de résidences principales pour le mix, la
# part HLM pour le statut, la part du parc d'avant 1971 pour l'âge du bâti, la
# part d'appartements pour le type, la médiane poolée pour le prix, la part
# F/G pour l'énergie — en ORDINAL directionnel « Xᵉ / Y » : 1 = meilleur, la
# taille du groupe portée, un seul groupe par territoire (commune → son EPCI ;
# EPCI → tous les EPCIs bretons ; département → les départements). Chaque clé
# déclare SA direction (issue #368 — aucun défaut silencieux) : low-is-good
# pour la part de passoires, la distribution DPE, l'âge du bâti (le vieux
# stock est dur à isoler) et le prix au m² (l'accès au logement) ; high-is-good
# pour le mix (les résidences principales), le statut (le HLM) et le type (les
# appartements). Les valeurs NA (supprimées) n'empoisonnent pas leur groupe (la
# machinerie partagée).

test_that("rangs : la médiane poolée, avec l'ex æquo A1/C (même rang)", {
  p <- payload_habitat()
  # A1 et C sont ex æquo à 525 ; A1 est SEULE avec une valeur dans l'EPCI X
  # (D n < 10, E1/F1 sans mutation) -> 1er/1 ; C est 1er/2 dans l'EPCI Y
  # (low-is-good depuis l'issue #368 : 525 < 750, la plus petite est 1re)
  r <- valeur_payload(p, "22001", "prix_m2")
  expect_equal(r$rang_epci[is.na(r$detail)], 1)
  expect_equal(r$rang_epci_n[is.na(r$detail)], 1)
  expect_true(is.na(r$rang_dep[is.na(r$detail)]))
  expect_true(is.na(r$rang_reg[is.na(r$detail)]))

  r2 <- valeur_payload(p, "29002", "prix_m2")
  expect_equal(r2$rang_epci[is.na(r2$detail)], 1)
  expect_equal(r2$rang_epci_n[is.na(r2$detail)], 2)
})

test_that("rangs : le prix low-is-good — B (le plus cher) est 2e, la commune supprimée n'a pas de rang", {
  p <- payload_habitat()
  # B : 750 > A1/C 525 -> avec le low-is-good (issue #368), la PLUS PETITE
  # valeur est la meilleure : B est 2e dans son EPCI (n = 2)
  r <- valeur_payload(p, "29001", "prix_m2")
  expect_equal(r$rang_epci[is.na(r$detail)], 2)
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
  expect_true(all(r$rang_epci == 2))
  # alors que la médiane 2025 de B (550) serait en tête d'un classement par
  # année : la pooled classe — pas la série
  expect_equal(r$value[r$detail %in% "2025"], 550)
  expect_equal(r$rang_epci[r$detail %in% "2025"], 2)
})

test_that("rangs : les agrégats prix — EPCIs et départements se comparent entre eux (low-is-good)", {
  p <- payload_habitat()
  # EPCI-X (550) au-dessus d'EPCI-Y (537.5) : avec le low-is-good, l'EPCI le
  # MOINS cher est 1er (ADR-0021 — la comparaison des EPCIs est RÉGIONALE,
  # jamais départementale)
  expect_equal(valeur_payload(p, "200000001", "prix_m2")$rang_reg[1], 2)
  expect_equal(valeur_payload(p, "200000001", "prix_m2")$rang_reg_n[1], 2)
  expect_equal(valeur_payload(p, "200000002", "prix_m2")$rang_reg[1], 1)
  # départements : 22 (550) plus cher que 29 (537.5) -> 29 1er
  expect_equal(valeur_payload(p, "22", "prix_m2")$rang_reg[1], 2)
  expect_equal(valeur_payload(p, "29", "prix_m2")$rang_reg[1], 1)
  # la région n'a aucun rang
  expect_true(all(is.na(valeur_payload(p, "53", "prix_m2")$rang_reg)))
})

test_that("rangs : le mix est classé par la part de résidences principales (high-is-good, #368)", {
  p <- payload_habitat()
  # parts de résidences principales : A1 85% > D 80% = E1 80% > F1 75%
  # (EPCI X) ; C 83.3% > B 80% (EPCI Y). High-is-good : la PLUS GRANDE part
  # est 1re ; D/E1 ex æquo partagent le 2e rang (1, 2, 2, 4).
  r <- valeur_payload(p, "22001", "mix_logements")
  expect_equal(r$rang_epci[r$detail == "principales"], 1)
  expect_equal(r$rang_epci_n[r$detail == "principales"], 4)
  expect_equal(valeur_payload(p, "22002", "mix_logements")$rang_epci[
    valeur_payload(p, "22002", "mix_logements")$detail == "principales"], 2)
  expect_equal(valeur_payload(p, "22003", "mix_logements")$rang_epci[
    valeur_payload(p, "22003", "mix_logements")$detail == "principales"], 2)
  expect_equal(valeur_payload(p, "22004", "mix_logements")$rang_epci[
    valeur_payload(p, "22004", "mix_logements")$detail == "principales"], 4)
  expect_equal(valeur_payload(p, "29002", "mix_logements")$rang_epci[
    valeur_payload(p, "29002", "mix_logements")$detail == "principales"], 1)
  # le rang est le même sur les trois lignes de catégorie
  expect_length(unique(valeur_payload(p, "22001", "mix_logements")$rang_epci), 1)
})

test_that("rangs : le statut est classé par la part HLM (high-is-good, #368)", {
  p <- payload_habitat()
  # parts HLM : D 40/240 > A1 100/850 > E1 40/400 = F1 30/300 (EPCI X) ;
  # B 150/1200 > C 100/1000 (EPCI Y). High-is-good : la PLUS GRANDE part est
  # 1re ; E1/F1 ex æquo partagent le 3e rang (1, 2, 3, 3).
  expect_equal(valeur_payload(p, "22002", "statut")$rang_epci[1], 1)
  expect_equal(valeur_payload(p, "22001", "statut")$rang_epci[1], 2)
  expect_equal(valeur_payload(p, "22003", "statut")$rang_epci[1], 3)
  expect_equal(valeur_payload(p, "22004", "statut")$rang_epci[1], 3)
  expect_equal(valeur_payload(p, "29001", "statut")$rang_epci[1], 1)
  expect_equal(valeur_payload(p, "29002", "statut")$rang_epci[1], 2)
  # uniforme sur les 4 modalités
  expect_length(unique(valeur_payload(p, "22001", "statut")$rang_epci), 1)
})

test_that("rangs : l'âge du bâti est classé par la part du parc d'avant 1971 (low-is-good, #368)", {
  p <- payload_habitat()
  # parts d'avant 1971 : E1 45% < F1 46.7% < D 50% < A1 52.9% (EPCI X) ;
  # B 50% = C 50% (EPCI Y). Low-is-good : la PLUS PETITE part est 1re (le
  # vieux stock est dur à isoler) ; B/C ex æquo partagent le 1er rang.
  expect_equal(valeur_payload(p, "22003", "age_du_bati")$rang_epci[1], 1)
  expect_equal(valeur_payload(p, "22004", "age_du_bati")$rang_epci[1], 2)
  expect_equal(valeur_payload(p, "22002", "age_du_bati")$rang_epci[1], 3)
  expect_equal(valeur_payload(p, "22001", "age_du_bati")$rang_epci[1], 4)
  expect_equal(valeur_payload(p, "29001", "age_du_bati")$rang_epci[1], 1)
  expect_equal(valeur_payload(p, "29002", "age_du_bati")$rang_epci[1], 1)
  # uniforme sur les 6 tranches
  expect_length(unique(valeur_payload(p, "22001", "age_du_bati")$rang_epci), 1)
})

test_that("rangs : le type est classé par la part d'appartements (high-is-good, #368)", {
  p <- payload_habitat()
  # parts d'appartements : E1 37.5% > A1 35.3% > D 33.3% = F1 33.3% (EPCI X) ;
  # B 33.3% > C 30% (EPCI Y). High-is-good : la PLUS GRANDE part est 1re ;
  # D/F1 ex æquo partagent le 3e rang (1, 2, 3, 3).
  expect_equal(valeur_payload(p, "22003", "type")$rang_epci[1], 1)
  expect_equal(valeur_payload(p, "22001", "type")$rang_epci[1], 2)
  expect_equal(valeur_payload(p, "22002", "type")$rang_epci[1], 3)
  expect_equal(valeur_payload(p, "22004", "type")$rang_epci[1], 3)
  expect_equal(valeur_payload(p, "29001", "type")$rang_epci[1], 1)
  expect_equal(valeur_payload(p, "29002", "type")$rang_epci[1], 2)
  # uniforme sur les 2 modalités
  expect_length(unique(valeur_payload(p, "22001", "type")$rang_epci), 1)
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
