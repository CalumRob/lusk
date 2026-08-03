test_that("évolution 1968→ : les communes", {
  p <- compute_payload(load_fixture())
  expect_equal(valeur_payload(p, "22001", "evolution_1968")$value, 500 / 1500)
  expect_equal(valeur_payload(p, "22002", "evolution_1968")$value, -200 / 600)
  expect_equal(valeur_payload(p, "29001", "evolution_1968")$value, 600 / 2400)
  expect_equal(valeur_payload(p, "29002", "evolution_1968")$value, -300 / 3300)
  expect_equal(valeur_payload(p, "22001", "evolution_1968")$unit, "%")
})

test_that("évolution 1968→ : les agrégats", {
  p <- compute_payload(load_fixture())
  expect_equal(valeur_payload(p, "200000001", "evolution_1968")$value, 300 / 2100)
  expect_equal(valeur_payload(p, "200000002", "evolution_1968")$value, 300 / 5700)
  expect_equal(valeur_payload(p, "53", "evolution_1968")$value, 600 / 7800)
})
