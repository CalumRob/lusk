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
  # l'indicateur — la même valeur sur chacune des 7 lignes de tranche.
  rangs_c <- unique(valeur_payload(p, "29002", "structure_age")$rang_reg)
  expect_equal(length(rangs_c), 1) # uniforme sur les 7 tranches
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

test_that("rangs : une valeur NA n'empoisonne pas son groupe (unitaire)", {
  # une commune sans population_1968 -> évolution NA. Le rang des autres
  # membres du groupe se calcule sur les non-NA ; le territoire NA n'a pas
  # de rang. (point 2 — test ciblé, exception prévue par la spec)
  r <- percentile_par_groupe(c(1, 2, NA, 4), c("a", "a", "a", "a"))
  expect_true(is.na(r[3]))
  expect_equal(r[1], 0)      # 1 < {2,4} : 0/3
  expect_equal(r[2], 1 / 3)  # 2 > {1} : 1/3
  expect_equal(r[4], 2 / 3)  # 4 > {1,2} : 2/3
})

test_that("rangs : une commune NA ne casse pas les rangs des autres (payload)", {
  fx <- load_fixture()
  fx$population_1968[fx$code == "22001"] <- NA  # A1 perd son évolution
  p <- compute_payload(fx)

  # A1 n'a pas de rang d'évolution (sa valeur est NA)
  expect_true(is.na(valeur_payload(p, "22001", "evolution_1968")$rang_reg))

  # les autres communes gardent des rangs corrects dans la région (n = 3)
  expect_equal(valeur_payload(p, "22002", "evolution_1968")$rang_reg, 0)
  expect_equal(valeur_payload(p, "29002", "evolution_1968")$rang_reg, 1 / 3)
  expect_equal(valeur_payload(p, "29001", "evolution_1968")$rang_reg, 2 / 3)

  # les autres indicateurs de A1 ne sont pas affectés (densité, pas NA)
  expect_false(is.na(valeur_payload(p, "22001", "densite")$rang_reg))
})
