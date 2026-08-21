# L'Histoire « L'état énergétique du parc » (issue #18) ------------------------
# La classification DÉTERMINISTE de la distribution DPE en 4 lectures, calculées
# DANS L'ORDRE (spec #12) :
#   1. parc-heterogene      — A/B/C >= 25 % ET F/G >= 25 % (bimodal, vérifié 1er)
#   2. passoire-energetique — sinon F/G >= 30 %
#   3. parc-performant      — sinon A/B/C >= 50 %
#   4. parc-intermediaire   — le résidu (un stock du milieu C/D/E)
# Suppression : n_dpe < 30 -> classification ET parts de justification NA (le n,
# lui, est publié — la même règle que l'indicateur, #17). Seuils PROVISOIRES,
# fixés au premier run réel (point de contrôle documenté, spec #12 « Further
# Notes »). Le fixture étendu (issue #18) couvre les quatre lectures : A1
# (intermédiaire), B (hétérogène), E (performant), F (passoire) et le cas
# n < 30 (D). Contrat déterministe : même territoire + mêmes données -> même
# lecture, toujours.

test_that("les quatre lectures : une classification par territoire, dans l'ordre", {
  p <- payload_habitat()
  h <- function(code) p$histoires[p$histoires$territoire == code, ]

  expect_equal(h("22003")$classification, "parc-performant")       # 98 % A/B/C
  expect_equal(h("22004")$classification, "passoire-energetique")  # 85,7 % F/G
  expect_equal(h("29001")$classification, "parc-heterogene")       # 64 % A/B/C ET 36 % F/G
  expect_equal(h("22001")$classification, "parc-intermediaire")    # le résidu
  expect_equal(h("29002")$classification, "parc-intermediaire")
})

test_that("la suppression n < 30 : classification et parts NA, n publié", {
  p <- payload_habitat()
  h <- p$histoires[p$histoires$territoire == "22002", ]
  expect_true(is.na(h$classification))
  expect_true(is.na(h$part_passoires))
  expect_true(is.na(h$part_abc))
  expect_equal(h$n_dpe, 6)
})

test_that("les parts de justification : part_passoires, part_abc, n_dpe", {
  p <- payload_habitat()
  h <- function(code) p$histoires[p$histoires$territoire == code, ]

  # E (performant) : 2/100 F/G, 98/100 A/B/C, 100 équivalents
  expect_equal(h("22003")$part_passoires, 2 / 100)
  expect_equal(h("22003")$part_abc, 98 / 100)
  expect_equal(h("22003")$n_dpe, 100)

  # F (passoire) : 30/35 F/G, 3/35 A/B/C
  expect_equal(h("22004")$part_passoires, 30 / 35)
  expect_equal(h("22004")$part_abc, 3 / 35)
  expect_equal(h("22004")$n_dpe, 35)

  # B (hétérogène) : les deux queues au-dessus de 25 %
  expect_equal(h("29001")$part_passoires, 12 / 33)
  expect_equal(h("29001")$part_abc, 21 / 33)

  # A1 (intermédiaire) : ni l'une ni l'autre queue ne domine
  expect_equal(h("22001")$part_passoires, 2 / 33)
  expect_equal(h("22001")$part_abc, 1 / 33)
})

test_that("les agrégats : EPCI, départements et région suivent la même règle", {
  p <- payload_habitat()
  h <- function(code) p$histoires[p$histoires$territoire == code, ]

  # EPCI-X = A1 + D + E + F : 103/174 A/B/C -> performant
  expect_equal(h("200000001")$classification, "parc-performant")
  expect_equal(h("200000001")$part_abc, 103 / 174)
  expect_equal(h("200000001")$part_passoires, 39 / 174)
  expect_equal(h("200000001")$n_dpe, 174)
  # EPCI-Y = B + C (agrégats de #17 inchangés) : 24/65 A/B/C, 13/65 F/G
  # -> intermédiaire
  expect_equal(h("200000002")$classification, "parc-intermediaire")
  expect_equal(h("200000002")$part_abc, 24 / 65)
  expect_equal(h("200000002")$n_dpe, 65)
  # la région : 127/239 A/B/C -> performant
  expect_equal(h("53")$classification, "parc-performant")
  expect_equal(h("53")$part_abc, 127 / 239)
  expect_equal(h("53")$part_passoires, 52 / 239)
  expect_equal(h("53")$n_dpe, 239)
  # les départements : 22 (A1 + D + E + F) performant, 29 (B + C) intermédiaire
  expect_equal(h("22")$classification, "parc-performant")
  expect_equal(h("29")$classification, "parc-intermediaire")
})

test_that("le schéma de la table est le contrat de l'issue #18 (étendu #312)", {
  p <- payload_habitat()
  expect_named(p$histoires, c(
    "territoire", "type", "theme", "groupe", "story_key", "salience_reason",
    "classification", "part_passoires", "part_abc", "n_dpe"
  ))
  expect_true(all(p$histoires$theme == "habitat"))
  expect_true(all(p$histoires$groupe == "etat-energetique-du-parc"))
  expect_true(all(p$histoires$salience_reason == "defaut"))
  expect_true(all(p$histoires$story_key == "etat-energetique-du-parc"))
})

test_that("déterminisme : même territoire + mêmes données -> même lecture, toujours", {
  p1 <- payload_habitat()
  p2 <- payload_habitat()
  expect_identical(p1$histoires, p2$histoires)
  # la re-computation directe du classifieur ne change rien non plus : la
  # résolution partagée (issue #312) appliquée aux candidats du classifieur
  # redonne exactement la table publiée
  h1 <- p1$histoires
  h2 <- resoudre_histoires(
    compute_histoires_habitat(construire_territoires_habitat(load_fixture_habitat())),
    "habitat"
  )
  expect_identical(h1, h2)
})

test_that("l'Histoire Démographie n'est pas touchée", {
  p <- compute_payload(load_fixture())
  expect_true(all(p$histoires$story_key == "trajectoire-demographique"))
  expect_true(all(!is.na(p$histoires$classification)))
})
