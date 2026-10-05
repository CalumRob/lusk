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
  expect_error(project_typed_reading_facts(transform(histories[1, ], story_key=""), "mobilite"),
    "Invalid selected mobility story or salience classification")
})

test_that("Mobility publisher projection binds selected readings to the declared snapshot clock", {
  histories <- data.frame(territoire="35238",type="commune",theme="mobilite",
    groupe="access",story_key="story-from-producer",salience_reason="producer-choice",
    div_loss_t=8,div_loss_b=5,classification_saillance="producer-classification")
  vintages <- data.frame(id="mobilite_snapshot",source="Snapshot source",version="v1",
    date_reference="2026-02-28",date_publication="2026-08-06",stringsAsFactors=FALSE)
  metadata <- list(sources=list(tot_loss_t="mobilite_snapshot",tot_loss_b="mobilite_snapshot"),
    story_keys="story-from-producer")
  projection <- project_mobility_reading(histories,vintages,metadata)
  expect_equal(projection$status,"measured")
  expect_equal(projection$source_id,"mobilite_snapshot")
  expect_equal(projection$vintage_id,"v1/2026-02-28")
  expect_equal(projection$classification_saillance,"producer-classification")
  expect_error(project_mobility_reading(histories,vintages,modifyList(metadata,
    list(sources=list(tot_loss_t="wrong",tot_loss_b="wrong")))),"unique mobility snapshot source clock")
  unavailable <- histories
  unavailable$div_loss_t <- NA_real_
  expect_equal(project_mobility_reading(unavailable,vintages,metadata)$status,"unavailable")
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
