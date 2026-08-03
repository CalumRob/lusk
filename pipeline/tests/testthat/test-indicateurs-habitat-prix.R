# La médiane prix/m² (DVF, issue #17) : la ligne poolée (le headline classé)
# + une ligne par année de la fenêtre (la série d'évolution), avec la
# suppression n < 10 par ligne et la colonne `n` = le nombre de mutations.

test_that("prix_m2 : une ligne poolée (detail NA) + une ligne par année", {
  p <- payload_habitat()
  v <- valeur_payload(p, "22001", "prix_m2")

  expect_equal(nrow(v), 1L + length(ANNEE_DVF))
  expect_true(is.na(v$detail[1]))
  expect_setequal(v$detail[-1], as.character(ANNEE_DVF))
  expect_equal(unique(v$unit), "€/m²")
})

test_that("prix_m2 : la médiane poolée de A1 est la médiane de ses 12 mutations", {
  p <- payload_habitat()
  v <- valeur_payload(p, "22001", "prix_m2")
  # 12 mutations à 400,400,450,450,500,500,550,550,600,600,600,600
  expect_equal(v$value[is.na(v$detail)], (500 + 550) / 2)
  expect_equal(v$n[is.na(v$detail)], 12)
})

test_that("prix_m2 : la série par année porte les médianes annuelles", {
  p <- payload_habitat()
  # A1 : tout en 2025 — 2025 = la pooled, les autres années n = 0
  v <- valeur_payload(p, "22001", "prix_m2")
  expect_equal(v$value[v$detail %in% "2025"], (500 + 550) / 2)
  expect_equal(v$n[v$detail %in% "2025"], 12)
  expect_true(is.na(v$value[v$detail %in% "2024"]))
  expect_equal(v$n[v$detail %in% "2024"], 0)

  # B : 10 mutations en 2025 (médiane 550), 4 en 2024 (n < 10 -> supprimée)
  vb <- valeur_payload(p, "29001", "prix_m2")
  expect_equal(vb$value[vb$detail %in% "2025"], (500 + 600) / 2)
  expect_equal(vb$n[vb$detail %in% "2025"], 10)
  expect_true(is.na(vb$value[vb$detail %in% "2024"]))
  expect_equal(vb$n[vb$detail %in% "2024"], 4)
})

test_that("prix_m2 : le cas poolé-vs-année (B) — la pooled diffère de 2025", {
  p <- payload_habitat()
  # B : pooled = médiane des 14 mutations (100..1000 + 2000..2300) = 750,
  # alors que 2025 seule = 550 : le headline et la série racontent deux choses
  v <- valeur_payload(p, "29001", "prix_m2")
  expect_equal(v$value[is.na(v$detail)], 750)
  expect_equal(v$n[is.na(v$detail)], 14)
  expect_equal(v$value[v$detail %in% "2025"], 550)
  # le cas est visible : pooled ≠ année
  expect_false(v$value[is.na(v$detail)] == v$value[v$detail %in% "2025"])
})

test_that("prix_m2 : la suppression n < 10 — commune D toute supprimée, n publié", {
  p <- payload_habitat()
  v <- valeur_payload(p, "22002", "prix_m2")
  # D n'a que 3 mutations : poolé et toutes les années sous le seuil -> NA,
  # mais le n est publié honnêtement
  expect_true(is.na(v$value[is.na(v$detail)]))
  expect_equal(v$n[is.na(v$detail)], 3)
  expect_true(all(is.na(v$value[!is.na(v$detail)])))
  expect_equal(v$n[v$detail %in% "2025"], 2)
  expect_equal(v$n[v$detail %in% "2024"], 1)
})

test_that("prix_m2 : l'ex æquo A1/C et les agrégats", {
  p <- payload_habitat()
  # A1 et C ont la même médiane poolée (525) — l'ex æquo du classement
  expect_equal(valeur_payload(p, "22001", "prix_m2")$value[1], 525)
  expect_equal(valeur_payload(p, "29002", "prix_m2")$value[1], 525)

  # les agrégats : EPCI-X (A1 + D) = 550, EPCI-Y (B + C) = 537.5
  expect_equal(valeur_payload(p, "200000001", "prix_m2")$value[1], 550)
  expect_equal(valeur_payload(p, "200000001", "prix_m2")$n[1], 15)
  expect_equal(valeur_payload(p, "200000002", "prix_m2")$value[1], 537.5)
  expect_equal(valeur_payload(p, "200000002", "prix_m2")$n[1], 26)
  # la région : 41 mutations, médiane 550
  expect_equal(valeur_payload(p, "53", "prix_m2")$value[1], 550)
  expect_equal(valeur_payload(p, "53", "prix_m2")$n[1], 41)
})
