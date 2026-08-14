# validate_payload pour le thème Habitat (issue #17) : les vérifications de
# VALEUR déclarées par le thème — les parts qui ne somment pas à 1 ou un prix
# négatif doivent faire échouer le payload bruyamment, comme côté Démographie.

test_that("validations_habitat : un payload valide passe", {
  p <- payload_habitat()
  expect_no_error(validate_payload(p, indicateurs = INDICATEURS_HABITAT,
                                   vintages = vintages_habitat(),
                                   validations = validations_habitat, apercu = APERCU_HABITAT))
})

test_that("validations_habitat : des parts de mix qui ne somment pas à 1 -> erreur", {
  p <- payload_habitat()
  p$indicateurs$value[p$indicateurs$key == "mix_logements" &
                        p$indicateurs$detail == "principales"] <- 0.9
  expect_error(validate_payload(p, indicateurs = INDICATEURS_HABITAT,
                                vintages = vintages_habitat(),
                                validations = validations_habitat, apercu = APERCU_HABITAT),
               "mix")
})

test_that("validations_habitat : des parts de statut qui ne somment pas à 1 -> erreur", {
  p <- payload_habitat()
  p$indicateurs$value[p$indicateurs$key == "statut" &
                        p$indicateurs$detail == "proprietaire"] <- 0.5
  expect_error(validate_payload(p, indicateurs = INDICATEURS_HABITAT,
                                vintages = vintages_habitat(),
                                validations = validations_habitat, apercu = APERCU_HABITAT),
               "statut")
})

test_that("validations_habitat : des parts d'âge du bâti qui ne somment pas à 1 -> erreur", {
  p <- payload_habitat()
  p$indicateurs$value[p$indicateurs$key == "age_du_bati" &
                        p$indicateurs$detail == "lt1919" &
                        p$indicateurs$territoire == "22001"] <- 0.5
  expect_error(validate_payload(p, indicateurs = INDICATEURS_HABITAT,
                                vintages = vintages_habitat(),
                                validations = validations_habitat, apercu = APERCU_HABITAT),
               "age_du_bati")
})

test_that("validations_habitat : des parts de type qui ne somment pas à 1 -> erreur", {
  p <- payload_habitat()
  p$indicateurs$value[p$indicateurs$key == "type" &
                        p$indicateurs$detail == "maison" &
                        p$indicateurs$territoire == "22001"] <- 0.5
  expect_error(validate_payload(p, indicateurs = INDICATEURS_HABITAT,
                                vintages = vintages_habitat(),
                                validations = validations_habitat, apercu = APERCU_HABITAT),
               "type")
})

test_that("validations_habitat : la distribution DPE doit sommer à 1 (quand publiée)", {
  p <- payload_habitat()
  p$indicateurs$value[p$indicateurs$key == "distribution_dpe" &
                        p$indicateurs$detail == "A" &
                        p$indicateurs$territoire == "22001"] <- 0.5
  expect_error(validate_payload(p, indicateurs = INDICATEURS_HABITAT,
                                vintages = vintages_habitat(),
                                validations = validations_habitat, apercu = APERCU_HABITAT),
               "distribution")
})

test_that("validations_habitat : la distribution supprimée (toute NA) est acceptée", {
  p <- payload_habitat()
  # la commune D est sous le seuil : ses 7 parts sont NA — ce n'est pas une
  # corruption, la validation ne doit pas la rejeter
  p$indicateurs$value[p$indicateurs$key == "distribution_dpe" &
                        p$indicateurs$territoire == "22002"] <- NA_real_
  expect_no_error(validate_payload(p, indicateurs = INDICATEURS_HABITAT,
                                   vintages = vintages_habitat(),
                                   validations = validations_habitat, apercu = APERCU_HABITAT))
})

test_that("validations_habitat : un prix au m² négatif -> erreur", {
  p <- payload_habitat()
  p$indicateurs$value[p$indicateurs$key == "prix_m2" &
                        is.na(p$indicateurs$detail)][1] <- -10
  expect_error(validate_payload(p, indicateurs = INDICATEURS_HABITAT,
                                vintages = vintages_habitat(),
                                validations = validations_habitat, apercu = APERCU_HABITAT),
               "négatif")
})

test_that("compute_payload valide à la sortie : un fixture cassé échoue fort", {
  fx <- load_fixture_habitat()
  fx$communes$logements_principales[1] <- 10000  # le mix ne somme plus
  expect_error(compute_payload(fx, theme = theme_habitat()), "somment pas")
})
