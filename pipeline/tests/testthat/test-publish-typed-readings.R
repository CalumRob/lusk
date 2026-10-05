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

test_that("Mobility reading projection keeps only actual selected story facts", {
  histories <- data.frame(territoire=c("35238", "35238"), type="commune",
    theme=c("mobilite", "autre"), groupe=c("acces-aux-services", "ignored"),
    story_key=c("vingt-minutes-sans-voiture", "ignored"), salience_reason="defaut",
    div_loss_t=c(8, 99), div_loss_b=c(5, 99),
    classification_saillance=c("non-saillant", "ignored"),
    dens_1=c(.2, .9), dec_1=c(3, 99))

  projected <- project_typed_reading_facts(histories, "mobilite")

  expect_equal(nrow(projected), 1L)
  expect_equal(projected[c("story_key", "groupe", "salience_reason", "div_loss_t", "div_loss_b",
                           "classification_saillance")], histories[1, c("story_key", "groupe",
    "salience_reason", "div_loss_t", "div_loss_b", "classification_saillance")])
  expect_false(any(c("dens_1", "dec_1") %in% names(projected)))
  expect_error(project_typed_reading_facts(transform(histories[1, ], div_loss_b=9), "mobilite"),
    "Invalid selected mobility reading values")
})

fixture_mobility_metadata <- function(reference_date="2026-02-28",version="v1",dataset="Mobility snapshot dataset") {
  list(sources=list(tot_loss_t="mobilite_snapshot",tot_loss_b="mobilite_snapshot"),
    story_keys=c("vingt-minutes-sans-voiture","ce-que-le-velo-preserve"),
    selected_reading_contract=list(unit="types de services",direction="low",
      allowed_levels=c("commune","epci","departement","region"),missing_status="unavailable",
      classification_values=c("saillant","notable","non-saillant"),
      field_keys=c("groupe","story_key","salience_reason","classification_saillance","div_loss_t","div_loss_b","status")),
    source_records=list(mobilite_snapshot=list(dataset=dataset,publisher="Snapshot source",
      vintages=list(list(id="mobilite_snapshot",version=version,dateReference=reference_date,datePublication="2026-08-06")),
      clocks=list(list(name="BPE",frequency="annual",reference="2024",trigger="new release"),
        list(name="Buildings",frequency="campaign",reference="2025-07",trigger="new campaign")))))
}

test_that("Mobility projection validates selected story semantics and registered source contract", {
  histories <- data.frame(territoire=c("35238","35239"),type="commune",theme="mobilite",
    groupe="acces-aux-services",story_key=c("vingt-minutes-sans-voiture","ce-que-le-velo-preserve"),
    salience_reason=c("defaut","delta-velo-saillant"),div_loss_t=c(8,12),div_loss_b=c(5,2),
    classification_saillance=c("notable","saillant"))
  vintages <- data.frame(id="mobilite_snapshot",source="Snapshot source",version="v1",
    date_reference="2026-02-28",date_publication="2026-08-06",stringsAsFactors=FALSE)
  metadata <- fixture_mobility_metadata()
  projection <- project_mobility_reading(histories,vintages,metadata)
  expect_equal(projection$status,c("measured","measured"))
  expect_equal(projection$source_id,c("mobilite_snapshot","mobilite_snapshot"))
  expect_equal(projection$vintage_id,c("v1/2026-02-28","v1/2026-02-28"))
  expect_equal(projection$classification_saillance,c("notable","saillant"))
  expect_error(project_mobility_reading(transform(histories,story_key="unknown"),vintages,metadata),"producer registry")
  expect_error(project_mobility_reading(transform(histories,groupe="wrong-group"),vintages,metadata),"producer registry")
  expect_error(project_mobility_reading(transform(histories,salience_reason="invented"),vintages,metadata),"producer registry")
  expect_error(project_mobility_reading(transform(histories,classification_saillance="unknown"),vintages,metadata),"classification")
  expect_error(project_mobility_reading(transform(histories,classification_saillance=c("notable","notable")),vintages,metadata),"classification")
  expect_error(project_mobility_reading(histories,vintages,modifyList(metadata,
    list(sources=list(tot_loss_t="wrong",tot_loss_b="wrong")))),"producer contract")
  expect_error(project_mobility_reading(histories,vintages,modifyList(metadata,
    list(source_records=list(mobilite_snapshot=list(dataset=""))))),"producer contract")
  wrong_dataset <- metadata
  wrong_dataset$source_records$mobilite_snapshot$dataset <- ""
  expect_error(project_mobility_reading(histories,vintages,wrong_dataset),"producer contract")
  wrong_version <- vintages; wrong_version$version <- "different"
  expect_error(project_mobility_reading(histories,wrong_version,metadata),"producer-declared source clock")
  wrong_name <- vintages; wrong_name$source <- ""
  expect_error(project_mobility_reading(histories,wrong_name,metadata),"non-empty source identity")
  wrong_name$source <- "Another source"
  expect_error(project_mobility_reading(histories,wrong_name,metadata),"producer-declared source clock")
  unavailable <- histories
  unavailable$div_loss_t[1] <- NA_real_
  unavailable$classification_saillance[1] <- NA_character_
  absent <- project_mobility_reading(unavailable,vintages,metadata)
  expect_equal(absent$status,c("unavailable","measured"))
  expect_true(is.na(absent$div_loss_t[1]))
  null_clock_vintage <- vintages; null_clock_vintage$date_reference <- NA_character_
  null_metadata <- fixture_mobility_metadata(reference_date=NULL)
  expect_equal(project_mobility_reading(histories,null_clock_vintage,null_metadata)$vintage_id,
    c("v1/NA","v1/NA"))
  bad_format <- vintages; bad_format$date_reference <- "not-a-date"
  expect_error(project_mobility_reading(histories,bad_format,metadata),"Invalid Mobility source clock date")
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
