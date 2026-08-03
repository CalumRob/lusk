# La part de passoires thermiques et la distribution A–G (DPE, issue #17) :
# des parts PONDÉRÉES par le poids d'équivalent-logement (immeubles), avec la
# suppression n < 30 (n = la somme des poids) et la colonne `n` publiée.

test_that("part_passoires : la part F/G pondérée, n = somme des poids", {
  p <- payload_habitat()
  v <- valeur_payload(p, "29001", "part_passoires")
  # B : IMM-B1 (20 C) + IMM-B2 (10 - 1 = 9 F) + FLAT-B1 (1 A) + 3 maisons
  # (G, G, F) = 33 équivalents ; F/G = 9 + 1 + 1 + 1 = 12
  expect_equal(v$value, 12 / 33)
  expect_equal(v$n, 33)
})

test_that("part_passoires : l'immeuble pondéré compte pour son poids (poids > 1)", {
  p <- payload_habitat()
  # A1 : IMM-A1 porte 30 équivalents à lui seul (une seule ligne) — si le poids
  # était ignoré, la part F/G serait de 2/3 au lieu de 2/33
  v <- valeur_payload(p, "22001", "part_passoires")
  expect_equal(v$value, 2 / 33)
  expect_equal(v$n, 33)
})

test_that("part_passoires : la suppression n < 30 — commune D toute supprimée, n publié", {
  p <- payload_habitat()
  v <- valeur_payload(p, "22002", "part_passoires")
  # D n'a que 6 équivalents (< 30) : valeur NA, n publié
  expect_true(is.na(v$value))
  expect_equal(unique(v$n), 6)
})

test_that("distribution_dpe : les parts A–G, la donnée du graphique", {
  p <- payload_habitat()
  v <- valeur_payload(p, "22001", "distribution_dpe")

  expect_equal(nrow(v), 7)
  expect_setequal(v$detail, c("A", "B", "C", "D", "E", "F", "G"))
  expect_equal(unique(v$unit), "%")
  # A1 : E = 30/33, B/F/G = 1/33 chacune, A/C/D = 0
  expect_equal(v$value[v$detail == "E"], 30 / 33)
  expect_equal(v$value[v$detail == "B"], 1 / 33)
  expect_equal(v$value[v$detail == "F"], 1 / 33)
  expect_equal(v$value[v$detail == "G"], 1 / 33)
  expect_equal(v$value[v$detail == "A"], 0)
  expect_equal(unique(v$n), 33) # le n est répété sur les 7 lignes
})

test_that("distribution_dpe : les agrégats et la région", {
  p <- payload_habitat()
  # EPCI-Y (B + C) : C = 20/65, D = 28/65, F = 10/65, G = 3/65, A = 2/65
  v <- valeur_payload(p, "200000002", "distribution_dpe")
  expect_equal(v$value[v$detail == "C"], 20 / 65)
  expect_equal(v$value[v$detail == "D"], 28 / 65)
  expect_equal(v$value[v$detail == "A"], 2 / 65)
  expect_equal(unique(v$n), 65)
  # la région : 239 équivalents (A1 + D + B + C + E + F), F = 36/239, G = 16/239
  vr <- valeur_payload(p, "53", "distribution_dpe")
  expect_equal(unique(vr$n), 239)
  expect_equal(vr$value[vr$detail == "F"], 36 / 239)
  expect_equal(vr$value[vr$detail == "G"], 16 / 239)
})

test_that("distribution_dpe : la suppression suit part_passoires (n < 30)", {
  p <- payload_habitat()
  v <- valeur_payload(p, "22002", "distribution_dpe")
  expect_true(all(is.na(v$value)))
  expect_equal(unique(v$n), 6)
})

test_that("distribution_dpe : le dédoublonnage du fixture change la distribution", {
  p <- payload_habitat()
  # C : M-C1 (F, 2023) et M-C2 (B, 2025) partagent le même logement (RNB-C1) —
  # le nettoyage (nettoyer_dpe, #16) garde le plus récent : seul M-C2 compte.
  # Si le F de 2023 était compté, la part F/G de C serait de 2/32 au lieu de 1/32.
  v <- valeur_payload(p, "29002", "part_passoires")
  expect_equal(v$value, 1 / 32)
  expect_equal(v$n, 32)
  # et aucun poids F sur C
  expect_equal(valeur_payload(p, "29002", "distribution_dpe")$value[
    valeur_payload(p, "29002", "distribution_dpe")$detail == "F"], 0)
})
