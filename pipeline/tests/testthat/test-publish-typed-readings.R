test_that("typed reading projection retains only the selected demographic reading", {
  histories <- data.frame(territoire=c("35238", "35238"), type="commune",
    theme="demographie", groupe=c("demographie", "autre"), story_key=c("trajectory", "other"),
    salience_reason="defaut", periode="2017-2023", solde_naturel=6700,
    solde_migratoire=7375, taux_solde_naturel=4.9884038225,
    taux_solde_migratoire=5.4909668941, classification="attire-renouvelle")
  projected <- project_typed_reading_facts(histories, "demographie")
  expect_equal(nrow(projected), 2L)
  expect_equal(projected$territory_id, c("35238", "35238"))
  expect_true(all(c("story_key", "salience_reason", "periode", "taux_solde_naturel",
                    "taux_solde_migratoire", "classification") %in% names(projected)))
  expect_false(any(grepl("history|json", names(projected))))
})

test_that("typed reading projection rejects incomplete or duplicate selected facts", {
  expect_error(project_typed_reading_facts(data.frame(theme="demographie"), "demographie"),
               "missing fields")
})
