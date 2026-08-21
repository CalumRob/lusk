# test-committed-payload-contract ----------------------------------------------
# The checked-in static snapshot is itself a published payload. Keep the JSON
# projections and parquet artifacts on the same current reading-group contract.

test_that("les payloads Démographie et Habitat commis restent canoniques et paritaires", {
  sortie <- file.path(pkgload::pkg_path(), "..", "public", "data")

  for (theme in c("demographie", "habitat")) {
    json <- jsonlite::fromJSON(
      file.path(sortie, paste0("histoires_", theme, ".json")),
      simplifyVector = TRUE
    )
    parquet <- nanoparquet::read_parquet(
      file.path(sortie, paste0("histoires_", theme, ".parquet"))
    )

    groupe_attendu <- if (theme == "demographie") {
      "trajectoire-demographique"
    } else {
      "etat-energetique-du-parc"
    }
    expect_identical(unique(json$groupe), groupe_attendu)
    expect_identical(unique(parquet$groupe), groupe_attendu)
    verifier_non_derivee(parquet, json, paste0("histoires_", theme))
  }
})
