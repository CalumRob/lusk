test_that("densité : les communes", {
  p <- compute_payload(load_fixture())
  expect_equal(valeur_payload(p, "22001", "densite")$value, 2000 / 10)
  expect_equal(valeur_payload(p, "22002", "densite")$value, 400 / 8)
  expect_equal(valeur_payload(p, "29001", "densite")$value, 3000 / 20)
  expect_equal(valeur_payload(p, "29002", "densite")$value, 3000 / 20)
  expect_equal(valeur_payload(p, "22001", "densite")$unit, "hab/km²")
})

test_that("densité : les agrégats (EPCI, départements, région)", {
  p <- compute_payload(load_fixture())
  # Un agrégat = la somme de ses communes : (2000+400)/(10+8), etc.
  expect_equal(valeur_payload(p, "200000001", "densite")$value, 2400 / 18)
  expect_equal(valeur_payload(p, "200000002", "densite")$value, 6000 / 40)
  expect_equal(valeur_payload(p, "22", "densite")$value, 2400 / 18)
  expect_equal(valeur_payload(p, "29", "densite")$value, 6000 / 40)
  expect_equal(valeur_payload(p, "53", "densite")$value, 8400 / 58)
})
