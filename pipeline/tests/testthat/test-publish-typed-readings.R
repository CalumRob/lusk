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

test_that("typed Milieux reading projection retains producer-selected reading coordinates", {
  histories <- data.frame(territoire=c("35238", "35238"), type="commune",
    theme=c("milieux", "autre"), groupe=c("artificialisation", "autre"),
    story_key=c("artif-par-habitant", "other"), salience_reason="declared",
    periode_pop="2012-2017", periode_artif="2011-2021", delta_population=125,
    taux_variation_population=4.7, artif_m2_par_habitant=321.5,
    artif_m3_par_habitant=101.2, trajectoire_artif_par_habitant="stable",
    classification="pression-moderee")
  projected <- project_typed_reading_facts(histories, "milieux")
  expect_equal(nrow(projected), 1L)
  expect_equal(projected$territory_id, "35238")
  expect_equal(projected$groupe, "artificialisation")
  expect_equal(projected$delta_population, 125)
  expect_equal(projected$taux_variation_population, 4.7)
  expect_equal(projected$periode_pop, "2012-2017")
  expect_equal(projected$periode_artif, "2011-2021")
  expect_equal(projected$trajectoire_artif_par_habitant, "stable")
})

test_that("Milieux population provenance revisions hash the actual source clock and preserve NULL dates", {
  vintage <- data.frame(id="serie_historique", source="Producer source", version="2023",
    date_reference="2023-01-01", date_publication=NA_character_, stringsAsFactors=FALSE)
  metadata <- list(source_records=list(serie_historique=list(dataset="Canonical population dataset")))

  original <- project_milieux_population_revision(vintage, metadata)
  expect_identical(original$source_name, "Producer source")
  expect_identical(original$dataset_name, "Canonical population dataset")
  expect_identical(as.character(original$reference_date), "2023-01-01")
  expect_true(is.na(original$publication_date))

  renamed <- vintage
  renamed$source <- "Revised producer source"
  expect_false(identical(original$population_revision_id,
    project_milieux_population_revision(renamed, metadata)$population_revision_id))
  redated <- vintage
  redated$date_reference <- "2023-01-02"
  expect_false(identical(original$population_revision_id,
    project_milieux_population_revision(redated, metadata)$population_revision_id))
})
