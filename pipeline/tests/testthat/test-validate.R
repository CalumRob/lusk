# validate_payload ------------------------------------------------------------
# Point 7 : la validation de bon sens du payload réel. Le fixture teste la
# logique ; validate_payload() attrape les dérives de format des sources sur
# les données réelles (l'INSEE change de format entre vagues — c'est ce qui
# a tué les anciens fichiers per-département). Appelée à la sortie de
# compute_payload : un payload invalide fait échouer le pipeline bruyamment.

test_that("validate_payload : le payload du fixture est valide", {
  p <- compute_payload(load_fixture())
  expect_no_error(validate_payload(p))
})

test_that("validate_payload : des parts d'âge qui ne somment pas à 1 -> erreur", {
  p <- compute_payload(load_fixture())
  p$indicateurs$value[p$indicateurs$key == "structure_age" &
                        p$indicateurs$detail == "<15"] <- 0.9
  expect_error(validate_payload(p), "somment pas")
})

test_that("validate_payload : une densité non positive -> erreur", {
  p <- compute_payload(load_fixture())
  p$indicateurs$value[p$indicateurs$key == "densite"][1] <- -1
  expect_error(validate_payload(p), "densité")
})

test_that("validate_payload : un rang hors de [0, 1] -> erreur", {
  p <- compute_payload(load_fixture())
  p$indicateurs$rang_reg[1] <- 1.5
  expect_error(validate_payload(p), "rang")
})

test_that("validate_payload : une ligne en double -> erreur", {
  p <- compute_payload(load_fixture())
  p$indicateurs <- rbind(p$indicateurs, p$indicateurs[1, ])
  expect_error(validate_payload(p), "double")
})

test_that("validate_payload : une clé d'indicateur absente -> erreur", {
  p <- compute_payload(load_fixture())
  p$indicateurs <- p$indicateurs[p$indicateurs$key != "densite", ]
  expect_error(validate_payload(p), "densite")
})

test_that("compute_payload valide à la sortie : un fixture cassé échoue fort", {
  fx <- load_fixture()
  fx$age_lt15[1] <- fx$age_lt15[1] + 500  # les tranches ne somment plus
  expect_error(compute_payload(fx), "somment pas")
})

test_that("validate_payload : une évolution NA reste acceptée (point 2)", {
  # une commune sans population_1968 -> évolution NA : c'est un cas légitime,
  # pas une corruption — la validation ne doit pas le rejeter.
  fx <- load_fixture()
  fx$population_1968[fx$code == "22001"] <- NA
  expect_no_error(compute_payload(fx))
})
