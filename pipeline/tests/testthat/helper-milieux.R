# helper-milieux ---------------------------------------------------------------
# Les fixtures partagées du thème Milieux (issue #171) : la base des EPCI du
# fixture (la forme de lire_epci — les communes de la fixture CONSOENAF), la
# SÉRIE HISTORIQUE du recensement (la source partagée de la population — la
# règle de source d'ADR-0014 ; la fixture est déposée dans le dossier extrait
# du cache, sous le nom exact que le builder lit) et le builder des communes
# via le VRAI reshape (la fixture CSV dans un cache temporaire, la base des
# EPCI mockée — jamais de réseau dans la boucle de test). Les tests de reshape
# (test-theme-milieux-reshape.R), de payload (test-contract-payload-milieux.R)
# et d'Histoire (test-theme-milieux-histoire.R) consomment ces communes.

base_epci_milieux <- tibble::tribble(
  ~CODGEO, ~LIBGEO, ~EPCI, ~LIBEPCI, ~DEP, ~REG,
  "22001", "Commune A1", "200000001", "EPCI X", "22", "53",
  "22002", "Commune D", "200000001", "EPCI X", "22", "53",
  "29001", "Commune B", "200000002", "EPCI Y", "29", "53",
  "29002", "Commune C", "200000002", "EPCI Y", "29", "53",
  "29003", "Commune NA", "200000002", "EPCI Y", "29", "53"
)

# copier_fixture_serie_historique : dépose la fixture CSV de la série
# historique du recensement dans le dossier extrait d'un cache, sous le nom
# exact que construire_donnees_milieux lit (l'extraction du zip du cache est
# idempotente — le fichier extrait fait foi, comme pour la base des EPCI).
copier_fixture_serie_historique <- function(cache) {
  extrait <- file.path(cache, "extracted")
  if (!dir.exists(extrait)) dir.create(extrait, recursive = TRUE)
  file.copy(
    testthat::test_path("fixtures", "serie-historique-fixture.csv"),
    file.path(extrait, NOM_FICHIER_SERIE_HISTORIQUE),
    overwrite = TRUE
  )
}

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
  copier_fixture_serie_historique(cache)
  local_mocked_bindings(lire_epci = function(chemin) base_epci_milieux,
                        .package = "lusk")
  construire_donnees_milieux(cache = cache,
                             sortie = tempfile(fileext = ".rds"))
}
