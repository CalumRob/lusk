# helper-milieux ---------------------------------------------------------------
# Les fixtures partagées du thème Milieux (issue #171) : la base des EPCI du
# fixture (la forme de lire_epci — les communes de la fixture CONSOENAF) et le
# builder des communes via le VRAI reshape (la fixture CSV dans un cache
# temporaire, la base des EPCI mockée — jamais de réseau dans la boucle de
# test). Les tests de reshape (test-theme-milieux-reshape.R) et de payload
# (test-contract-payload-milieux.R) consomment ces communes.

base_epci_milieux <- tibble::tribble(
  ~CODGEO, ~LIBGEO, ~EPCI, ~LIBEPCI, ~DEP, ~REG,
  "22001", "Commune A1", "200000001", "EPCI X", "22", "53",
  "22002", "Commune D", "200000001", "EPCI X", "22", "53",
  "29001", "Commune B", "200000002", "EPCI Y", "29", "53",
  "29002", "Commune C", "200000002", "EPCI Y", "29", "53",
  "29003", "Commune NA", "200000002", "EPCI Y", "29", "53"
)

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
