test_that("les soldes : naturel = naissances - décès, migratoire = le résidu", {
  p <- compute_payload(load_fixture())
  h <- function(code) p$histoires[p$histoires$territoire == code, ]

  expect_equal(h("22001")$solde_naturel, 150 - 80)
  expect_equal(h("22001")$solde_migratoire, (2000 - 1900) - (150 - 80))
  expect_equal(h("29002")$solde_naturel, 100 - 120)
  expect_equal(h("29002")$solde_migratoire, (3000 - 3400) - (100 - 120))
})

test_that("les soldes : les agrégats somment les communes", {
  p <- compute_payload(load_fixture())
  h <- function(code) p$histoires[p$histoires$territoire == code, ]

  # EPCI-X = A1 + D
  expect_equal(h("200000001")$solde_naturel, (150 - 80) + (5 - 25))
  expect_equal(h("200000001")$solde_migratoire,
               ((2000 - 1900) - (150 - 80)) + ((400 - 425) - (5 - 25)))
  # EPCI-Y = B + C : les soldes s'annulent (cas « deux soldes minuscules »)
  expect_equal(h("200000002")$solde_naturel, 0)
  expect_equal(h("200000002")$solde_migratoire, 0)
})

test_that("la classification 2x2 : les quatre quadrants", {
  p <- compute_payload(load_fixture())
  h <- function(code) p$histoires[p$histoires$territoire == code, ]

  expect_equal(h("22001")$classification, "fertile")       # croît × naturel
  expect_equal(h("29001")$classification, "attractive")    # croît × migratoire
  expect_equal(h("22002")$classification, "vieillissante") # décroît × naturel
  expect_equal(h("29002")$classification, "exode")         # décroît × migratoire
})

test_that("la classification : agrégats, cas limite et région", {
  p <- compute_payload(load_fixture())
  h <- function(code) p$histoires[p$histoires$territoire == code, ]

  expect_equal(h("200000001")$classification, "fertile")
  # EPCI-Y : soldes nuls (ex æquo -> naturel), croissance sous la médiane
  expect_equal(h("200000002")$classification, "vieillissante")
  expect_equal(h("22")$classification, "fertile")
  expect_equal(h("29")$classification, "vieillissante")
  # la région se compare à une croissance nulle : croît × naturel
  expect_equal(h("53")$classification, "fertile")
})

test_that("chaque histoire porte la clé du thème et une classification", {
  p <- compute_payload(load_fixture())
  expect_true(all(p$histoires$story_key == "attractive-ou-fertile"))
  expect_true(all(!is.na(p$histoires$classification)))
})
