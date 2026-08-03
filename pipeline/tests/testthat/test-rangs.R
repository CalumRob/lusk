test_that("rangs : la densité, avec l'ex æquo B/C (symétrique)", {
  p <- compute_payload(load_fixture())
  r <- valeur_payload(p, "29001", "densite")
  # B et C sont seules dans leur EPCI (n = 2) et ex æquo : chaque membre du
  # bloc partage le crédit -> 0.25 partout, et surtout le MÊME rang.
  expect_equal(r$rang_epci, 0.25)
  expect_equal(r$rang_dep, 0.25)
  expect_equal(r$rang_reg, 0.375) # région (n = 4) : 1 en dessous + 1 ex æquo

  r2 <- valeur_payload(p, "29002", "densite")
  expect_equal(r2$rang_epci, 0.25)
  expect_equal(r2$rang_dep, 0.25)
  expect_equal(r2$rang_reg, 0.375)
})

test_that("rangs : la densité, A1 en tête et D en queue", {
  p <- compute_payload(load_fixture())
  r <- valeur_payload(p, "22001", "densite")
  expect_equal(r$rang_epci, 0.5)
  expect_equal(r$rang_dep, 0.5)
  expect_equal(r$rang_reg, 0.75)

  r2 <- valeur_payload(p, "22002", "densite")
  expect_equal(r2$rang_epci, 0)
  expect_equal(r2$rang_reg, 0)
})

test_that("rangs : les niveaux qui ne s'appliquent pas sont absents (NA)", {
  p <- compute_payload(load_fixture())

  # une EPCI n'a pas de rang « dans son EPCI »
  r_epci <- valeur_payload(p, "200000001", "densite")
  expect_true(is.na(r_epci$rang_epci))
  expect_equal(r_epci$rang_dep, 0) # seule EPCI du 22 : rien en dessous -> 0
  expect_equal(r_epci$rang_reg, 0) # parmi les EPCIs

  # un département n'a de rang que dans la région
  r_dep <- valeur_payload(p, "22", "densite")
  expect_true(is.na(r_dep$rang_epci))
  expect_true(is.na(r_dep$rang_dep))
  expect_equal(r_dep$rang_reg, 0)

  # la région n'a aucun rang
  r_reg <- valeur_payload(p, "53", "densite")
  expect_true(is.na(r_reg$rang_epci))
  expect_true(is.na(r_reg$rang_dep))
  expect_true(is.na(r_reg$rang_reg))
})

test_that("rangs : l'évolution suit son propre classement", {
  p <- compute_payload(load_fixture())
  # ordre : D (-1/3) < C (-1/11) < B (1/4) < A1 (1/3)
  expect_equal(valeur_payload(p, "29002", "evolution_1968")$rang_reg, 0.25)
  expect_equal(valeur_payload(p, "29001", "evolution_1968")$rang_reg, 0.5)
  expect_equal(valeur_payload(p, "22001", "evolution_1968")$rang_reg, 0.75)
})

test_that("rangs : la structure par âge est classée par la part des moins de 20 ans", {
  p <- compute_payload(load_fixture())
  # parts : C (11/60) < D (0.2) < B (7/30) < A1 (0.25). Le rang est celui de
  # l'indicateur — la même valeur sur chacune des 5 lignes de tranche.
  rangs_c <- unique(valeur_payload(p, "29002", "structure_age")$rang_reg)
  expect_equal(length(rangs_c), 1) # uniforme sur les 5 tranches
  expect_equal(rangs_c, 0)
  expect_equal(unique(valeur_payload(p, "29001", "structure_age")$rang_reg), 0.5)
  expect_equal(unique(valeur_payload(p, "22001", "structure_age")$rang_reg), 0.75)
})

test_that("rangs : la taille des ménages", {
  p <- compute_payload(load_fixture())
  # ordre : C (2) < B (3000/1400) < D (400/175) < A1 (2000/850)
  expect_equal(valeur_payload(p, "29001", "taille_menages")$rang_reg, 0.25)
  expect_equal(valeur_payload(p, "22002", "taille_menages")$rang_reg, 0.5)
  expect_equal(valeur_payload(p, "22001", "taille_menages")$rang_reg, 0.75)
})
