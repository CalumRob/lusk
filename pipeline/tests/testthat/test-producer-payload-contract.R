# test-producer-payload-contract -----------------------------------------------
# Validate producer facts directly. Numerical JSON snapshots are retired; the
# producer's in-memory outputs remain the fact/schema contract.

test_that("les sorties producteur Démographie et Habitat gardent leurs groupes de lecture", {
  for (theme in c("demographie", "habitat")) {
    facts <- lire_histoires_producteur_fixture(theme)

    groupe_attendu <- if (theme == "demographie") {
      "trajectoire-demographique"
    } else {
      "etat-energetique-du-parc"
    }
    expect_identical(unique(facts$groupe), groupe_attendu)
    expect_true(all(facts$theme == theme))
    expect_true(all(c("story_key", "territoire", "type", "groupe") %in% names(facts)))
  }
})
