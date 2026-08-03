test_that("structure par âge : une ligne par tranche (commune A1)", {
  p <- compute_payload(load_fixture())
  v <- valeur_payload(p, "22001", "structure_age")

  expect_equal(nrow(v), 7)
  expect_setequal(v$detail, c("<15", "15-24", "25-39", "40-54", "55-64", "65-79", "80+"))
  expect_equal(v$value[v$detail == "<15"], 400 / 2000)
  expect_equal(v$value[v$detail == "15-24"], 250 / 2000)
  expect_equal(v$value[v$detail == "25-39"], 350 / 2000)
  expect_equal(v$value[v$detail == "40-54"], 450 / 2000)
  expect_equal(v$value[v$detail == "55-64"], 250 / 2000)
  expect_equal(v$value[v$detail == "65-79"], 200 / 2000)
  expect_equal(v$value[v$detail == "80+"], 100 / 2000)
})

test_that("structure par âge : les parts somment à 1 pour chaque territoire", {
  p <- compute_payload(load_fixture())
  for (code in unique(p$indicateurs$territoire)) {
    v <- valeur_payload(p, code, "structure_age")
    expect_equal(sum(v$value), 1, info = code)
  }
})

test_that("structure par âge : les agrégats somment les tranches", {
  p <- compute_payload(load_fixture())
  v <- valeur_payload(p, "200000001", "structure_age")
  # EPCI-X = A1 + D : parts sur 2400 habitants
  expect_equal(v$value[v$detail == "<15"], (400 + 70) / 2400)
  expect_equal(v$value[v$detail == "15-24"], (250 + 50) / 2400)
  expect_equal(v$value[v$detail == "25-39"], (350 + 70) / 2400)
  expect_equal(v$value[v$detail == "40-54"], (450 + 90) / 2400)
  expect_equal(v$value[v$detail == "55-64"], (250 + 50) / 2400)
  expect_equal(v$value[v$detail == "65-79"], (200 + 40) / 2400)
  expect_equal(v$value[v$detail == "80+"], (100 + 30) / 2400)
})
