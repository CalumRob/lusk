programme_collection_fixture <- function() {
  metadata <- lire_theme_metadata("programmes")
  vintages <- vintages_depuis_manifest(MANIFEST_PROGRAMMES_COMPLET)
  stamp <- function(id) vintages[vintages$id==id,,drop=FALSE]
  grant <- stamp("subventions_scdl")
  labels <- unlist(metadata$indicator_pages$subventions_par_domaine$list$categories)[1:2]
  grants <- data.frame(territoire="C_TEST",type="commune",
    annee=as.integer(metadata$indicator_pages$subventions_annuelles$comparison$dimension),
    programme_libl=labels,montant=c(100,200),vintage_source=grant$source,
    vintage_version=grant$version,vintage_date_reference=grant$date_reference,
    vintage_date_publication=grant$date_publication)
  acv <- stamp("acv"); ort <- stamp("ort")
  members <- data.frame(territoire=c("C_TEST","C_ORT"),type="commune",sigle=c("ACV","ORT"),
    convention_valant_ort=c(TRUE,FALSE),vintage_source=c(acv$source,ort$source),
    vintage_version=c(acv$version,ort$version),
    vintage_date_reference=c(as.character(acv$date_reference),"2025-11-10"),
    vintage_date_publication=c(as.character(acv$date_publication),NA_character_))
  canonical <- list(programmes=list(membres=members,subventions=grants),vintages=vintages,
    territoires=data.frame(territoire=c("C_TEST","C_ORT"),type="commune",epci="E_TEST"))
  list(metadata=metadata,canonical=canonical)
}

test_that("registered observed collections preserve worked grant coordinates and sparse absence", {
  fixture <- programme_collection_fixture()
  registry <- register_programme_observed_collections(fixture$metadata)
  projection <- registry$subventions_par_domaine$project(fixture$canonical)
  expect_equal(nrow(projection$facts),2L)
  expect_equal(projection$facts$value,c(100,200))
  expect_equal(sum(projection$facts$value),300)
  expect_equal(projection$facts$detail_key,fixture$canonical$programmes$subventions$programme_libl)
  expect_equal(projection$facts$observation_period,as.character(fixture$canonical$programmes$subventions$annee))
  expect_gt(nrow(projection$categories),nrow(projection$facts))
  # Declared categories without a source row are not zero-valued observations.
  expect_false(any(projection$facts$value==0))
})

test_that("registered memberships retain anchor, rider and nullable row-reference publication clocks", {
  fixture <- programme_collection_fixture()
  registry <- register_programme_observed_collections(fixture$metadata)
  projection <- registry$couverture_programmes$project(fixture$canonical)
  expect_equal(projection$facts$territory_id,c("C_TEST","C_ORT"))
  expect_equal(projection$facts$convention_valant_ort,c(TRUE,FALSE))
  ort <- projection$vintages[projection$vintages$source_id=="ort",]
  expect_equal(as.character(ort$reference_date),"2025-11-10")
  expect_true(is.na(ort$publication_date))
  expect_equal(projection$descriptor$direction,"none")
  expect_true(is.na(projection$descriptor$comparison_detail))
})

test_that("registered collections reject vocabulary, source, anchor and clock drift", {
  fixture <- programme_collection_fixture()
  registry <- register_programme_observed_collections(fixture$metadata)
  bad <- fixture$canonical
  bad$programmes$subventions$programme_libl[[1L]] <- "undeclared-domain"
  expect_error(registry$subventions_par_domaine$project(bad),"declared coordinates")
  bad <- fixture$canonical
  bad$programmes$subventions$vintage_version[[2L]] <- "stale"
  expect_error(registry$subventions_par_domaine$project(bad),"source vintage")
  bad <- fixture$canonical
  bad$programmes$membres$type[[1L]] <- "epci"
  expect_error(registry$couverture_programmes$project(bad),"anchor")
  bad <- fixture$canonical
  bad$programmes$membres$vintage_date_publication[[2L]] <- "2025-11-11"
  expect_error(registry$couverture_programmes$project(bad),"publication inventée")
  bad <- fixture$canonical
  bad$programmes$membres$territoire[[2L]] <- "C_TEST"
  expect_error(registry$couverture_programmes$project(bad),"double badge")
})
