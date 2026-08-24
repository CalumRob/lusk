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
  # les validations de VALEUR sont déclarées par le thème (issue #13) — on les
  # passe explicitement à la validation générique
  expect_error(validate_payload(p, validations = validations_demographie),
               "somment pas")
})

test_that("validate_payload : une densité non positive -> erreur", {
  p <- compute_payload(load_fixture())
  p$indicateurs$value[p$indicateurs$key == "densite"][1] <- -1
  expect_error(validate_payload(p, validations = validations_demographie),
               "densité")
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
  fx$age_lt15_F[1] <- fx$age_lt15_F[1] + 500  # les parts d'âge ne somment plus à 1
  expect_error(compute_payload(fx), "somment pas")
})

test_that("validate_payload : une évolution NA reste acceptée (point 2)", {
  # une commune sans population_1968 -> évolution NA : c'est un cas légitime,
  # pas une corruption — la validation ne doit pas le rejeter.
  fx <- load_fixture()
  fx$population_1968[fx$code == "22001"] <- NA
  expect_no_error(compute_payload(fx))
})

test_that("validate_payload : une clé non déclarée dans INDICATEURS_<theme> -> erreur (issue #9)", {
  p <- compute_payload(load_fixture())
  p$indicateurs$key[1] <- "superficie"  # jamais déclaré dans la table
  expect_error(validate_payload(p), "non déclarée")
})

test_that("validate_payload : une estampille hors source de référence -> erreur (issue #9)", {
  p <- compute_payload(load_fixture())
  # structure_age déclare age_detail (PRINC) ; une estampille série historique
  # est une fraude à la fraîcheur — la validation doit la rejeter.
  p$indicateurs$vintage_source[p$indicateurs$key == "structure_age"] <-
    "INSEE — Série historique du recensement"
  expect_error(validate_payload(p), "source de référence")
})

test_that("validate_payload : un vintage falsifié (version) -> erreur (issue #9)", {
  p <- compute_payload(load_fixture())
  p$indicateurs$vintage_version[p$indicateurs$key == "densite"] <- "2024"
  expect_error(validate_payload(p), "source de référence")
})

test_that("validate_payload : une source de référence absente des vintages -> erreur", {
  p <- compute_payload(load_fixture())
  v <- vintages_demographie()
  v <- v[v$id != "age_detail", ]  # la référence de structure_age disparaît
  expect_error(validate_payload(p, vintages = v), "absente des vintages")
})

test_that("validate_payload : les estampilles du fixture égalent les vintages déclarés", {
  p <- compute_payload(load_fixture())
  expect_no_error(validate_payload(p, vintages = vintages_demographie()))
})

test_that("validate_payload : un fait SANS AUCUNE horloge (référence ET publication NA) -> erreur (#408, le miroir de l'app)", {
  # La règle des DEUX horloges : une base roulante n'a pas de référence (DPE,
  # ADR-0009), un suivi continu n'a pas de publication (ORT, #175) — l'une des
  # deux dates peut manquer, JAMAIS les deux ensemble. Sans cette garde R, le
  # pipeline publierait ce que validerIndicateurs refuse au chargement de
  # l'app (le miroir exact, TOUTE ligne d'indicateurs publiée). Le cas se
  # produit quand le vintage déclaré LUI-MÊME perd ses deux horloges (l'état
  # pré-pull d'une base roulante) et que les estampilles le suivent fidèlement.
  p <- compute_payload(load_fixture())
  v <- vintages_demographie()
  cle_ref <- INDICATEURS_DEMOGRAPHIE$source_reference[
    INDICATEURS_DEMOGRAPHIE$key == "structure_age"]
  v$date_reference[v$id == cle_ref] <- NA_character_
  v$date_publication[v$id == cle_ref] <- NA_character_
  lignes <- p$indicateurs$key == "structure_age"
  p$indicateurs$vintage_date_reference[lignes] <- NA_character_
  p$indicateurs$vintage_date_publication[lignes] <- NA_character_

  expect_error(validate_payload(p, vintages = v), "au moins une horloge")

  # le cas valide symétrique : UNE seule horloge manquante reste légitime —
  # la référence absente (base roulante) passe comme la publication absente
  p <- compute_payload(load_fixture())
  v <- vintages_demographie()
  v$date_reference[v$id == cle_ref] <- NA_character_
  lignes <- p$indicateurs$key == "structure_age"
  p$indicateurs$vintage_date_reference[lignes] <- NA_character_
  expect_no_error(validate_payload(p, vintages = v))
})

test_that("validate_payload : une colonne epci manquante -> erreur (issue #32)", {
  p <- compute_payload(load_fixture())
  p$territoires$epci <- NULL
  expect_error(validate_payload(p), "epci")
})

test_that("validate_payload : une commune sans EPCI est ACCEPTÉE (fix sans-objet, issue #131)", {
  # les trois îles bretonnes (22016 Île-de-Bréhat, 29083 Île-de-Sein, 29155
  # Ouessant) n'ont pas d'EPCI — la base INSEE les code « ZZZZZZZZZ »,
  # normalisé en NA à la lecture : une commune sans EPCI est légitime, jamais
  # une faute (l'inversion du §5bis, décidée 2026-08-06)
  p <- compute_payload(load_fixture())
  p$territoires$epci[p$territoires$type == "commune"][1] <- NA_character_
  expect_no_error(validate_payload(p))
})

test_that("validate_payload : une ligne EPCI qui ne porte pas un vrai SIREN -> erreur (fix #131)", {
  p <- compute_payload(load_fixture())
  # le code de la première EPCI devient un code fantôme (pas 9 chiffres — le
  # « ZZZZZZZZZ » de la base INSEE n'est pas un SIREN). La référentielle reste
  # INTACTE (le territoire renommé, la colonne epci des communes, les faits
  # qui le citent) : c'est la garde SIREN du §5bis qui doit attraper la dérive.
  epci_ancien <- "200000001"
  p$territoires$territoire[p$territoires$territoire == epci_ancien] <- "12345"
  p$territoires$epci[p$territoires$epci == epci_ancien] <- "12345"
  p$indicateurs$territoire[p$indicateurs$territoire == epci_ancien] <- "12345"
  p$histoires$territoire[p$histoires$territoire == epci_ancien] <- "12345"
  p$apercu$territoire[p$apercu$territoire == epci_ancien] <- "12345"
  expect_error(validate_payload(p), "SIREN")
})

test_that("validate_payload : un agrégat portant un EPCI -> erreur (issue #32)", {
  p <- compute_payload(load_fixture())
  p$territoires$epci[p$territoires$territoire == "53"] <- "200000001"
  expect_error(validate_payload(p), "EPCI")
})

test_that("validate_payload : un EPCI de commune inconnu de la référence -> erreur", {
  p <- compute_payload(load_fixture())
  p$territoires$epci[p$territoires$territoire == "22001"] <- "999999999"
  expect_error(validate_payload(p), "inconnu")
})

test_that("validate_payload : la table apercu absente -> erreur (issue #32)", {
  p <- compute_payload(load_fixture())
  p$apercu <- NULL
  expect_error(validate_payload(p), "apercu")
})

test_that("validate_payload : une clé apercu manquante -> erreur (issue #32)", {
  p <- compute_payload(load_fixture())
  p$apercu <- p$apercu[p$apercu$key != "densite", ]
  expect_error(validate_payload(p), "manquantes")
})

test_that("validate_payload : une clé apercu non déclarée -> erreur (issue #32)", {
  p <- compute_payload(load_fixture())
  p$apercu$key[1] <- "superficie"
  expect_error(validate_payload(p), "non déclarée")
})

test_that("validate_payload : un doublon apercu (territoire × clé) -> erreur", {
  p <- compute_payload(load_fixture())
  p$apercu <- rbind(p$apercu, p$apercu[1, ])
  expect_error(validate_payload(p), "double")
})
