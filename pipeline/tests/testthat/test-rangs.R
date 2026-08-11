# Les rangs-en-contexte (ADR-0015, ADR-0021) : l'ORDINAL directionnel « Xᵉ / Y »
# — 1 = meilleur, la taille du groupe toujours portée, un SEUL groupe par type
# de territoire (commune → les communes de son EPCI ; sans EPCI → les communes
# de la région ; EPCI → tous les EPCIs bretons ; département → les
# départements). Ex æquo : rang partagé, rang suivant sauté (1, 1, 3).

test_that("rangs : l'unité — competition ranking, ex æquo partagés, rang sauté", {
  # low-is-good : la plus petite valeur est la meilleure
  expect_equal(rang_ordinal_par_groupe(c(1, 1, 2), c("a", "a", "a"), "low"),
               c(1, 1, 3))
  # high-is-good : la plus grande valeur est la meilleure
  expect_equal(rang_ordinal_par_groupe(c(1, 1, 2), c("a", "a", "a"), "high"),
               c(2, 2, 1))
  # un groupe à un seul membre donne 1
  expect_equal(rang_ordinal_par_groupe(c(5), c("a"), "high"), 1)
  # une valeur NA n'a pas de rang et n'empoisonne pas son groupe (point 2) :
  # le dénominateur exclut les NA, la valeur NA elle-même est NA
  expect_equal(rang_ordinal_par_groupe(c(1, 2, NA, 4), c("a", "a", "a", "a"), "high"),
               c(3, 2, NA, 1))
})

test_that("rangs : la taille du groupe — le dénominateur des non-NA, porté à côté du rang", {
  expect_equal(taille_groupe(c(1, 2, NA, 4), c("a", "a", "a", "a")), c(3, 3, NA, 3))
  # sans groupe de comparaison à ce niveau : NA
  expect_equal(taille_groupe(c(1, 2), c(NA, NA)), c(NA_real_, NA_real_))
  expect_equal(taille_groupe(c(1, 2), c("a", NA)), c(1, NA))
})

test_that("rangs : la densité, avec l'ex æquo B/C (même rang, groupe partagé)", {
  p <- compute_payload(load_fixture())
  # B et C (29001/29002) sont ex æquo à 150 dans l'EPCI Y (n = 2) : les deux
  # sont 1ers — competition ranking (1, 1, pas de 2)
  r <- valeur_payload(p, "29001", "densite")
  expect_equal(r$rang_epci, 1)
  expect_equal(r$rang_epci_n, 2)
  # une commune avec EPCI ne se classe PLUS ailleurs (ADR-0021)
  expect_true(is.na(r$rang_dep))
  expect_true(is.na(r$rang_reg))

  r2 <- valeur_payload(p, "29002", "densite")
  expect_equal(r2$rang_epci, 1)
  expect_equal(r2$rang_epci_n, 2)
})

test_that("rangs : la densité, A1 en tête et D en queue de l'EPCI X", {
  p <- compute_payload(load_fixture())
  r <- valeur_payload(p, "22001", "densite")
  expect_equal(r$rang_epci, 1)   # 200 > 50
  expect_equal(r$rang_epci_n, 2)

  r2 <- valeur_payload(p, "22002", "densite")
  expect_equal(r2$rang_epci, 2)
  expect_equal(r2$rang_epci_n, 2)
})

test_that("rangs : les niveaux qui ne s'appliquent pas sont absents (NA)", {
  p <- compute_payload(load_fixture())

  # une EPCI n'a pas de rang « dans son EPCI » ; elle se classe parmi TOUS
  # les EPCIs bretons (rang_reg, ADR-0021) — plus jamais dans son département
  r_epci <- valeur_payload(p, "200000001", "densite")
  expect_true(is.na(r_epci$rang_epci))
  expect_true(is.na(r_epci$rang_dep))
  expect_equal(r_epci$rang_reg, 2) # 133.33 < 150 (EPCI Y) : 2e/2
  expect_equal(r_epci$rang_reg_n, 2)

  r_epci2 <- valeur_payload(p, "200000002", "densite")
  expect_equal(r_epci2$rang_reg, 1)
  expect_equal(r_epci2$rang_reg_n, 2)

  # un département n'a de rang que parmi les départements (rang_reg)
  r_dep <- valeur_payload(p, "22", "densite")
  expect_true(is.na(r_dep$rang_epci))
  expect_true(is.na(r_dep$rang_dep))
  expect_equal(r_dep$rang_reg, 2)
  expect_equal(valeur_payload(p, "29", "densite")$rang_reg, 1)

  # la région n'a aucun rang
  r_reg <- valeur_payload(p, "53", "densite")
  expect_true(is.na(r_reg$rang_epci))
  expect_true(is.na(r_reg$rang_dep))
  expect_true(is.na(r_reg$rang_reg))
})

test_that("rangs : l'évolution suit son propre classement (high-is-good)", {
  p <- compute_payload(load_fixture())
  # EPCI Y : 29001 (1/4) > 29002 (-1/11)
  expect_equal(valeur_payload(p, "29001", "evolution_1968")$rang_epci, 1)
  expect_equal(valeur_payload(p, "29002", "evolution_1968")$rang_epci, 2)
  # EPCI X : 22001 (1/3) > 22002 (-1/3)
  expect_equal(valeur_payload(p, "22001", "evolution_1968")$rang_epci, 1)
  expect_equal(valeur_payload(p, "22002", "evolution_1968")$rang_epci, 2)
})

test_that("rangs : la structure par âge est classée par la part des moins de 20 ans", {
  p <- compute_payload(load_fixture())
  # parts : C (550/3000) < D (80/400) < B (700/3000) < A1 (500/2000). Le rang
  # est celui de l'indicateur — la même valeur sur chacune des 7 lignes.
  rangs_a1 <- unique(valeur_payload(p, "22001", "structure_age")$rang_epci)
  expect_equal(length(rangs_a1), 1) # uniforme sur les 7 tranches
  expect_equal(rangs_a1, 1)
  expect_equal(unique(valeur_payload(p, "22002", "structure_age")$rang_epci), 2)
  expect_equal(unique(valeur_payload(p, "29001", "structure_age")$rang_epci), 1)
  expect_equal(unique(valeur_payload(p, "29002", "structure_age")$rang_epci), 2)
})

test_that("rangs : la taille des ménages", {
  p <- compute_payload(load_fixture())
  # ordre : C (2) < B (3000/1400) < D (400/175) < A1 (2000/850)
  expect_equal(valeur_payload(p, "22001", "taille_menages")$rang_epci, 1)
  expect_equal(valeur_payload(p, "22002", "taille_menages")$rang_epci, 2)
  expect_equal(valeur_payload(p, "29001", "taille_menages")$rang_epci, 1)
  expect_equal(valeur_payload(p, "29002", "taille_menages")$rang_epci, 2)
})

test_that("rangs : une valeur NA n'empoisonne pas son groupe (unitaire)", {
  # high-is-good : 4 > 2 > 1 -> rangs 3, 2, NA, 1 ; la taille du groupe exclut
  # la valeur NA (n = 3) et le territoire NA ne porte ni rang ni taille
  r <- rang_ordinal_par_groupe(c(1, 2, NA, 4), c("a", "a", "a", "a"), "high")
  expect_true(is.na(r[3]))
  expect_equal(r[1], 3)      # 1 < {2, 4} : 2 meilleures + 1
  expect_equal(r[2], 2)
  expect_equal(r[4], 1)
  expect_equal(taille_groupe(c(1, 2, NA, 4), c("a", "a", "a", "a")), c(3, 3, NA, 3))
})

test_that("rangs : une commune NA ne casse pas les rangs des autres (payload)", {
  fx <- load_fixture()
  fx$population_1968[fx$code == "22001"] <- NA  # A1 perd son évolution
  p <- compute_payload(fx)

  # A1 n'a pas de rang d'évolution (sa valeur est NA)
  expect_true(is.na(valeur_payload(p, "22001", "evolution_1968")$rang_epci))

  # les autres communes gardent des rangs corrects dans leur EPCI (n = 1 pour
  # l'EPCI X — D est seule à avoir une valeur ; n = 2 pour l'EPCI Y)
  expect_equal(valeur_payload(p, "22002", "evolution_1968")$rang_epci, 1)
  expect_equal(valeur_payload(p, "22002", "evolution_1968")$rang_epci_n, 1)
  expect_equal(valeur_payload(p, "29002", "evolution_1968")$rang_epci, 2)
  expect_equal(valeur_payload(p, "29001", "evolution_1968")$rang_epci, 1)

  # les autres indicateurs de A1 ne sont pas affectés (densité, pas NA)
  expect_false(is.na(valeur_payload(p, "22001", "densite")$rang_epci))
})
