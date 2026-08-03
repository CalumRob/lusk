test_that("filter_bretagne garde les quatre départements (22 · 29 · 35 · 56)", {
  brut <- tibble::tibble(
    code = c("22001", "44001", "29001", "75001", "35001", "56001", "99001"),
    departement = c("22", "44", "29", "75", "35", "56", "99"),
    population = c(100, 200, 300, 400, 500, 600, 700)
  )

  filtre <- filter_bretagne(brut)

  expect_setequal(filtre$departement, c("22", "29", "35", "56"))
  expect_setequal(filtre$code, c("22001", "29001", "35001", "56001"))
  expect_equal(nrow(filtre), 4)
})

test_that("filter_bretagne tolère les départements numériques", {
  brut <- tibble::tibble(
    code = c("22001", "75001"),
    departement = c(22, 75),
    population = c(100, 200)
  )

  filtre <- filter_bretagne(brut)

  expect_setequal(filtre$code, "22001")
})
