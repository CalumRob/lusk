test_that("taille moyenne des ménages : les communes", {
  p <- compute_payload(load_fixture())
  expect_equal(valeur_payload(p, "22001", "taille_menages")$value, 1950 / 850)
  expect_equal(valeur_payload(p, "22002", "taille_menages")$value, 390 / 175)
  expect_equal(valeur_payload(p, "29001", "taille_menages")$value, 2920 / 1400)
  expect_equal(valeur_payload(p, "29002", "taille_menages")$value, 2950 / 1500)
  expect_equal(valeur_payload(p, "22001", "taille_menages")$unit, "pers./ménage")
})

test_that("taille moyenne des ménages : les agrégats", {
  p <- compute_payload(load_fixture())
  expect_equal(valeur_payload(p, "200000001", "taille_menages")$value, 2340 / 1025)
  expect_equal(valeur_payload(p, "200000002", "taille_menages")$value, 5870 / 2900)
  expect_equal(valeur_payload(p, "53", "taille_menages")$value, 8210 / 3925)
})
