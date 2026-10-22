# test-committed-payload-contract ----------------------------------------------
# The checked-in static snapshot is itself a published payload. Keep the JSON
# projections and parquet artifacts on the same current reading-group contract.

test_that("les payloads Démographie et Habitat commis restent canoniques (JSON seul, #757)", {
  sortie <- file.path(pkgload::pkg_path(), "..", "public", "data")

  for (theme in c("demographie", "habitat")) {
    json <- jsonlite::fromJSON(
      file.path(sortie, paste0("histoires_", theme, ".json")),
      simplifyVector = TRUE
    )

    groupe_attendu <- if (theme == "demographie") {
      "trajectoire-demographique"
    } else {
      "etat-energetique-du-parc"
    }
    expect_identical(unique(json$groupe), groupe_attendu)
    # #757 : le parquet par-thème est retiré du snapshot commis pour les cinq
    # thèmes non-mobilité — le contrat porte sur la projection JSON, qui reste
    # servie à l'app.
    expect_false(
      file.exists(file.path(sortie, paste0("histoires_", theme, ".parquet")))
    )
  }
})
