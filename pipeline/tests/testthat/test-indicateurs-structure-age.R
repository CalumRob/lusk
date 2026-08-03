test_that("structure par âge : une ligne par tranche (commune A1)", {
  p <- compute_payload(load_fixture())
  v <- valeur_payload(p, "22001", "structure_age")

  expect_equal(nrow(v), 5)
  expect_setequal(v$detail, c("0-19", "20-39", "40-59", "60-74", "75+"))
  expect_equal(v$value[v$detail == "0-19"], 500 / 2000)
  expect_equal(v$value[v$detail == "20-39"], 450 / 2000)
  expect_equal(v$value[v$detail == "40-59"], 550 / 2000)
  expect_equal(v$value[v$detail == "60-74"], 300 / 2000)
  expect_equal(v$value[v$detail == "75+"], 200 / 2000)
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
  expect_equal(v$value[v$detail == "0-19"], (500 + 80) / 2400)
  expect_equal(v$value[v$detail == "20-39"], (450 + 90) / 2400)
  expect_equal(v$value[v$detail == "40-59"], (550 + 120) / 2400)
  expect_equal(v$value[v$detail == "60-74"], (300 + 70) / 2400)
  expect_equal(v$value[v$detail == "75+"], (200 + 40) / 2400)
})
