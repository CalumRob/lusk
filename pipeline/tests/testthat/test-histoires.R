test_that("les soldes : naturel = naissances - décès, migratoire = le résidu", {
  p <- compute_payload(load_fixture())
  h <- function(code) p$histoires[p$histoires$territoire == code, ]

  expect_equal(h("22001")$solde_naturel, 150 - 80)
  expect_equal(h("22001")$solde_migratoire, (2000 - 1900) - (150 - 80))
  expect_equal(h("29002")$solde_naturel, 100 - 120)
  expect_equal(h("29002")$solde_migratoire, (3000 - 3400) - (100 - 120))
})

test_that("les taux annuels : solde / 6 ans / population moyenne x 1000 (ADR-0011)", {
  p <- compute_payload(load_fixture())
  h <- function(code) p$histoires[p$histoires$territoire == code, ]

  # 22001 : pop_moyenne = (1900 + 2000) / 2 = 1950 ; solde naturel 70, migratoire 30
  expect_equal(h("22001")$taux_solde_naturel, 70 / 6 / 1950 * 1000)
  expect_equal(h("22001")$taux_solde_migratoire, 30 / 6 / 1950 * 1000)
  # 29002 : pop_moyenne = (3400 + 3000) / 2 = 3200 ; soldes -20 et -380
  expect_equal(h("29002")$taux_solde_naturel, -20 / 6 / 3200 * 1000)
  expect_equal(h("29002")$taux_solde_migratoire, -380 / 6 / 3200 * 1000)
})

test_that("les taux des agrégats : soldes sommés sur population moyenne sommée", {
  p <- compute_payload(load_fixture())
  h <- function(code) p$histoires[p$histoires$territoire == code, ]

  # EPCI-X = A1 + D : pop_moyenne = (2325 + 2400) / 2 = 2362,5 ; soldes 50 et 25
  expect_equal(h("200000001")$taux_solde_naturel, 50 / 6 / 2362.5 * 1000)
  expect_equal(h("200000001")$taux_solde_migratoire, 25 / 6 / 2362.5 * 1000)
  # EPCI-Y = B + C : soldes nuls -> taux nuls (cas « deux soldes minuscules »)
  expect_equal(h("200000002")$taux_solde_naturel, 0)
  expect_equal(h("200000002")$taux_solde_migratoire, 0)
  # les soldes bruts restent publiés inchangés (la colonne n'est pas remplacée)
  expect_equal(h("22001")$solde_naturel, 70)
  expect_equal(h("22001")$solde_migratoire, 30)
})

test_that("les soldes : les agrégats somment les communes", {
  p <- compute_payload(load_fixture())
  h <- function(code) p$histoires[p$histoires$territoire == code, ]

  # EPCI-X = A1 + D
  expect_equal(h("200000001")$solde_naturel, (150 - 80) + (5 - 25))
  expect_equal(h("200000001")$solde_migratoire,
               ((2000 - 1900) - (150 - 80)) + ((400 - 425) - (5 - 25)))
  # EPCI-Y = B + C : les soldes s'annulent (cas « deux soldes minuscules »)
  expect_equal(h("200000002")$solde_naturel, 0)
  expect_equal(h("200000002")$solde_migratoire, 0)
})

test_that("la lecture par quadrant : les quatre lectures sur le fixture", {
  p <- compute_payload(load_fixture())
  h <- function(code) p$histoires[p$histoires$territoire == code, ]

  # signes des taux (le fixture couvre deux quadrants : les deux forces même
  # signe)
  expect_equal(h("22001")$classification, "attire-renouvelle") # +70/+30
  expect_equal(h("29001")$classification, "attire-renouvelle") # +20/+380
  expect_equal(h("22002")$classification, "vide-meurt")        # -20/-5
  expect_equal(h("29002")$classification, "vide-meurt")        # -20/-380
})

test_that("la lecture par quadrant : agrégats et cas limite (zéro = négatif)", {
  p <- compute_payload(load_fixture())
  h <- function(code) p$histoires[p$histoires$territoire == code, ]

  # EPCI-X = A1 + D : soldes 50 et 25 -> les deux taux positifs
  expect_equal(h("200000001")$classification, "attire-renouvelle")
  # EPCI-Y = B + C : soldes nuls -> taux nuls, zéro compte négatif
  expect_equal(h("200000002")$classification, "vide-meurt")
  expect_equal(h("22")$classification, "attire-renouvelle")
  expect_equal(h("29")$classification, "vide-meurt")
  # la région : même règle que les autres — les signes de SES deux taux
  expect_equal(h("53")$classification, "attire-renouvelle")
})

test_that("la lecture par quadrant : cas mixtes (signes opposés)", {
  # Le fixture ne couvre que les quadrants à signes alignés ; le classifieur
  # doit aussi lire les deux quadrants mixtes — le cas réel 22004 (solde
  # naturel -228, solde migratoire +309, issue #73) lit « attire-meurt ».
  territoires <- tibble::tibble(
    code = c("22004", "22005", "22006"),
    type = "commune",
    naissances = c(400, 400, 450),
    deces = c(628, 400, 400),        # 22004 : naturel -228 ; 22005 : naturel 0 ; 22006 : naturel +50
    population = c(1962, 2000, 1800),
    population_precedente = c(1881, 1900, 2000)
  )
  h <- compute_histoires_demographie(territoires)
  lire <- function(code) h$classification[h$territoire == code]

  # 22004 : variation +81, naturel -228 -> migratoire +309 -> attire-meurt
  expect_equal(h$solde_migratoire[h$territoire == "22004"], 309)
  expect_equal(lire("22004"), "attire-meurt")
  # 22005 : naturel 0 (zéro compte négatif), migratoire +100 -> attire-meurt
  expect_equal(lire("22005"), "attire-meurt")
  # 22006 : naturel +50, migratoire -250 -> vide-renouvelle
  expect_equal(lire("22006"), "vide-renouvelle")
})

test_that("chaque histoire porte la clé du thème et une classification", {
  p <- compute_payload(load_fixture())
  expect_true(all(p$histoires$story_key == "trajectoire-demographique"))
  expect_true(all(!is.na(p$histoires$classification)))
})

test_that("chaque histoire porte la fenêtre inter-recensement de la trajectoire", {
  p <- compute_payload(load_fixture())
  # la même fenêtre (POP 2017 -> POP 2023, 6 ans) que le taux / 6 et la
  # population moyenne d'ADR-0011 — publiée pour que l'app date le titre
  expect_true(all(p$histoires$periode == "2017-2023"))
})
