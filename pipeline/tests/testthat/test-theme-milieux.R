# test-theme-milieux ------------------------------------------------------------
# Le descripteur du thème Milieux (issue #171) : la forme du contrat que la
# machinerie partagée consomme (les mêmes membres que theme_demographie() /
# theme_habitat()) — manifeste, table déclarative des indicateurs, aperçu,
# vintages, construction des données, table des territoires (le squelette
# partagé, pesé par la consommation), indicateurs, scalaires, Histoire et
# validations. Ce ticket est le TRACEUR : une seule clé d'indicateur
# (conso_enaf, la consommation totale 2011-2025 en hectares), des tables
# d'Histoire et d'Aperçu vides (les tickets #172/#173/#174 les peupleront).

# La base des EPCI du fixture (la forme de lire_epci) — les communes de la
# fixture CONSOENAF, la référence que squelette_territoires consomme.
base_epci_milieux <- tibble::tribble(
  ~CODGEO, ~LIBGEO, ~EPCI, ~LIBEPCI, ~DEP, ~REG,
  "22001", "Commune A1", "200000001", "EPCI X", "22", "53",
  "22002", "Commune D", "200000001", "EPCI X", "22", "53",
  "29001", "Commune B", "200000002", "EPCI Y", "29", "53",
  "29002", "Commune C", "200000002", "EPCI Y", "29", "53",
  "29003", "Commune NA", "200000002", "EPCI Y", "29", "53"
)

# Les communes du fixture, via le VRAI builder (la fixture CSV dans un cache
# temporaire, la base des EPCI mockée) — le reshape m² -> ha + le filtre
# Bretagne y sont réels.
communes_fixture_milieux <- function(cache = NULL) {
  if (is.null(cache)) {
    cache <- tempfile("cache-milieux-")
    dir.create(cache)
  }
  file.copy(
    testthat::test_path("fixtures", "consoenaf-fixture.csv"),
    file.path(cache, "conso-com.csv"),
    overwrite = TRUE
  )
  local_mocked_bindings(lire_epci = function(chemin) base_epci_milieux,
                        .package = "lusk")
  construire_donnees_milieux(cache = cache,
                             sortie = tempfile(fileext = ".rds"))
}

test_that("theme_milieux() : le descripteur porte les douze membres du contrat", {
  d <- theme_milieux()

  expect_equal(d$theme, "milieux")
  expect_identical(d$manifest, MANIFEST_MILIEUX)
  expect_identical(d$indicateurs, INDICATEURS_MILIEUX)
  expect_identical(d$apercu, APERCU_MILIEUX)
  expect_true(is.function(d$vintages))
  expect_true(is.function(d$construire_donnees))
  expect_true(is.function(d$construire_territoires))
  expect_true(is.function(d$construire_indicateurs))
  expect_true(is.function(d$construire_apercu))
  expect_type(d$scalaires, "list")
  expect_true(is.function(d$compute_histoires))
  expect_type(d$validations, "list")
})

test_that("verifier_descripteur_milieux : un descripteur incomplet échoue bruyamment", {
  d <- theme_milieux()
  manquant <- d[setdiff(names(d), "compute_histoires")]
  expect_error(verifier_descripteur_milieux(manquant), "compute_histoires")

  # une table déclarative absente (l'aperçu) — le gating par thème ne doit
  # jamais passer à travers un descripteur incomplet
  manquant <- d[setdiff(names(d), "apercu")]
  expect_error(verifier_descripteur_milieux(manquant), "apercu")
})

test_that("construire_donnees_milieux : le builder assemble les communes bretonnes du fixture", {
  communes <- communes_fixture_milieux()

  # la commune hors Bretagne (01001) est tombée au reshape
  expect_setequal(communes$code, c("22001", "22002", "29001", "29002", "29003"))
  expect_true(all(communes$departement %in% DEPT_BRETAGNE))
  # l'identité vient de la base des EPCI partagée (jamais des champs embarqués)
  expect_equal(communes$nom[communes$code == "22001"], "Commune A1")
  expect_equal(communes$epci[communes$code == "29001"], "200000002")
  expect_equal(communes$nom_epci[communes$code == "29002"], "EPCI Y")
  # la conversion m² -> ha est réelle dans la table assemblée
  expect_equal(communes$naf11art25[communes$code == "22001"], 1233202 / 10000)
  expect_equal(communes$naf11art25[communes$code == "29002"], 7.5)
  # la commune sans donnée garde sa consommation NA (jamais un 0 inventé)
  expect_true(is.na(communes$naf11art25[communes$code == "29003"]))
})

test_that("construire_territoires_milieux : le squelette partagé — communes + EPCIs + départements + région", {
  communes <- communes_fixture_milieux()
  territoires <- construire_territoires_milieux(communes)

  # 5 communes + 2 EPCIs + 2 départements + la région = 9 territoires
  expect_equal(nrow(territoires), 5L + 2L + 2L + 1L)
  expect_setequal(unique(territoires$type),
                  c("commune", "epci", "departement", "region"))
  expect_equal(
    territoires$code[territoires$type == "region"],
    "53"
  )
  # les agrégats portent les sommes des consommations (hectares) :
  #   - EPCI X = 22001 (123,3202 ha) + 22002 (25 ha) = 148,3202 ha
  expect_equal(
    territoires$naf11art25[territoires$code == "200000001"],
    1233202 / 10000 + 25
  )
  #   - le département 22 = la même somme
  expect_equal(
    territoires$naf11art25[territoires$code == "22"],
    1233202 / 10000 + 25
  )
  #   - la commune sans donnée (29003) rend le total de SON EPCI NA — un total
  #     incomplet n'est jamais publié comme s'il était complet
  expect_true(is.na(territoires$naf11art25[territoires$code == "200000002"]))
  expect_true(is.na(territoires$naf11art25[territoires$code == "29"]))
  #   - un annuel s'agrège aussi
  expect_equal(
    territoires$naf11art12[territoires$code == "200000001"],
    120000 / 10000 + 30000 / 10000
  )
  # le poids de la pluralité départementale : la consommation coalescée (la
  # commune NA pèse 0) — EPCI Y reste au département 29
  expect_equal(
    territoires$departement[territoires$code == "200000002"],
    "29"
  )
})

test_that("vintages_milieux : la projection générique depuis le manifeste", {
  v <- vintages_milieux()

  expect_equal(nrow(v), nrow(MANIFEST_MILIEUX))
  expect_setequal(v$id, c("epci", "consoenaf"))
  conso <- v[v$id == "consoenaf", ]
  expect_equal(conso$version, "2025")
  expect_equal(conso$date_reference, "2025-01-01")
  expect_equal(conso$date_publication, "2026-07-24")
  expect_equal(conso$licence, "lov2")
})
