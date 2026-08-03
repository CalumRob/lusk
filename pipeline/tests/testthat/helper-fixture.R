# helper-fixture ---------------------------------------------------------------
# Le jeu de données synthétique — le contrat d'entrée de l'étape compute.
# 4 communes, 2 EPCIs, 2 départements ; les quadrants d'Histoire, une égalité
# de densité (rang) et le cas « deux soldes minuscules » y sont couverts
# (les tickets 3-4 les exploitent).

load_fixture <- function() {
  readr::read_csv(
    testthat::test_path("fixtures", "demographie-fixture.csv"),
    col_types = readr::cols(
      code = readr::col_character(),
      epci = readr::col_character()
    ),
    show_col_types = FALSE
  )
}
