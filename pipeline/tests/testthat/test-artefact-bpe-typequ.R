test_that("le registre BPE épinglé reste complet pour les producteurs grid et ramp", {
  registre <- lire_correspondances_typequ()

  expect_equal(nrow(registre), 53L)
  expect_named(registre, BPE_TYPEQU_COLONNES)
  expect_equal(length(unique(registre$TYPEQU)), 53L)
  expect_silent(verifier_contrat_bpe_typequ(
    registre, codes_attendus = registre$TYPEQU
  ))
})
