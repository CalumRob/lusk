# test-targets-smoke -----------------------------------------------------------
# Le garde-fou d'environnement du port targets (#329, ticket #339) : le spike
# a révélé un conflit préexistant knitr↔xfun dans la bibliothèque personnelle
# (importFrom(xfun, attr) retiré dans xfun ≥ 0.5x) que l'adoption de targets
# déclenche. Ce test verrouille que le trio épinglé (targets/knitr/xfun) se
# charge avec le paquet sous le workflow de dev (pkgload::load_all) — si un
# jour la pin casse, la suite le dit ici, pas au milieu d'un run.

test_that("targets, knitr et xfun se chargent avec le paquet (environnement)", {
  expect_true(requireNamespace("targets", quietly = TRUE))
  expect_true(requireNamespace("knitr", quietly = TRUE))
  expect_true(requireNamespace("xfun", quietly = TRUE))
})
