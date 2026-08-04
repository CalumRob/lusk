test_that("taille moyenne des ménages : les communes", {
  p <- compute_payload(load_fixture())
  expect_equal(valeur_payload(p, "22001", "taille_menages")$value, 1950 / 850)
  expect_equal(valeur_payload(p, "22002", "taille_menages")$value, 390 / 175)
  expect_equal(valeur_payload(p, "29001", "taille_menages")$value, 2920 / 1400)
  expect_equal(valeur_payload(p, "29002", "taille_menages")$value, 2950 / 1500)
  expect_equal(valeur_payload(p, "22001", "taille_menages")$unit, "pers./ménage")
})

test_that("taille moyenne des ménages : l'unité est le UTF-8 exact pers./ménage (issue #52)", {
  # issue #52 : la chaîne d'unité a porté un « é » corrompu dans un payload
  # (U+00E9 -> U+01F8, « pers./m + U+01F8 + nage »). L'app rend le payload tel
  # quel (règle du seam), la correction vit donc ici, côté pipeline. Le verrou
  # est posé AU NIVEAU DES CODEPOINTS : le payload ne peut pas porter un
  # ré-encodage malheureux (Latin-1 -> UTF-8, U+00E9 -> U+01F8, etc.) sans
  # casser ce test.
  p <- compute_payload(load_fixture())

  lignes <- p$indicateurs[p$indicateurs$key == "taille_menages", , drop = FALSE]
  # chaque territoire porte la même unité
  expect_equal(unique(lignes$unit), "pers./ménage")

  # les codepoints exacts de l'unité attendue : p e r s . / m é n a g e
  # (U+00E9 = 233 — le « é » correct ; U+01F8 = 504 serait le caractère corrompu)
  cps_attendus <- c(112L, 101L, 114L, 115L, 46L, 47L, 109L, 233L, 110L, 97L, 103L, 101L)
  expect_equal(utf8ToInt(unique(lignes$unit)), cps_attendus)
})

test_that("taille moyenne des ménages : les agrégats", {
  p <- compute_payload(load_fixture())
  expect_equal(valeur_payload(p, "200000001", "taille_menages")$value, 2340 / 1025)
  expect_equal(valeur_payload(p, "200000002", "taille_menages")$value, 5870 / 2900)
  expect_equal(valeur_payload(p, "53", "taille_menages")$value, 8210 / 3925)
})
