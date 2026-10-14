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

test_that("period/detail inventory is metadata-derived and excludes categorical memberships", {
  fixture <- programme_collection_fixture()
  registry <- register_programme_observed_collections(fixture$metadata)
  expected <- names(Filter(function(x) identical(x$kind,"period_detail"),fixture$metadata$observed_collection_contracts))
  expect_setequal(observed_collection_inventory(fixture$metadata),
    expected)
  registered_periods <- names(registry)[vapply(registry,function(x)
    identical(x$project(fixture$canonical)$descriptor$kind,"period_detail"),logical(1L))]
  expect_setequal(expected, registered_periods)
  expect_false("couverture_programmes" %in% observed_collection_inventory(fixture$metadata))
  broken <- fixture$metadata
  broken$indicator_pages$subventions_par_domaine$comparison$dimension <- NULL
  expect_error(observed_collection_inventory(broken),"typed comparison descriptor")
})

test_that("sparse comparison projection emits every canonical context member without synthesizing facts", {
  fixture <- programme_collection_fixture()
  p <- register_programme_observed_collections(fixture$metadata)$subventions_par_domaine$project(fixture$canonical)
  p$facts <- data.frame(indicator_id=p$descriptor$indicator_id,territory_id=c("C_TEST","C_ORT"),
    territory_type="commune",detail_key=p$descriptor$comparison_detail,
    observation_period=p$descriptor$comparison_period,value=c(100,200),source_id="subventions_scdl",
    vintage_id=p$vintages$vintage_id[[1L]])
  refs <- data.frame(territory_id=c("C_TEST","C_ORT","C_MISSING","E_TEST","D_TEST","BZH"),
    territory_type=c("commune","commune","commune","epci","departement","region"),
    epci_id=c("E_TEST","E_TEST","E_TEST",NA,NA,NA),density_class_code=c("d","d","d",NA,NA,NA))
  out <- project_observed_collection_comparisons(p,refs,"collection-v1","reference-v1")
  bretagne <- out$territories[out$territories$comparison_context=="bretagne",]
  expect_equal(nrow(bretagne),3L)
  expect_equal(sum(bretagne$status=="not_published"),1L)
  expect_true(is.na(bretagne$value[bretagne$territory_id=="C_MISSING"]))
  expect_equal(out$groups$eligible_count[out$groups$comparison_context=="bretagne"],2L)
  expect_equal(out$groups$missing_count[out$groups$comparison_context=="bretagne"],1L)
  high <- bretagne[bretagne$status=="measured",]
  expect_equal(high$rank[match("C_TEST",high$territory_id)],2L)
  expect_equal(high$rank[match("C_ORT",high$territory_id)],1L)
  expect_equal(high$tie_count,c(1L,1L))
  expect_equal(high$rank_size,c(2L,2L))
  absent <- bretagne[bretagne$status=="not_published",]
  expect_true(all(is.na(absent[c("rank","tie_count","rank_size")])) )
  expect_equal(out$groups$median[out$groups$comparison_context=="bretagne"],150)
  low_tie <- p; low_tie$descriptor$direction <- "low"; low_tie$facts$value <- 100
  tied <- project_observed_collection_comparisons(low_tie,refs,"collection-v1","reference-v1")
  tied_bretagne <- tied$territories[tied$territories$comparison_context=="bretagne" & tied$territories$status=="measured",]
  expect_equal(tied_bretagne$rank,c(1L,1L))
  expect_equal(tied_bretagne$tie_count,c(2L,2L))
  expect_equal(tied$groups$median[tied$groups$comparison_context=="bretagne"],100)
  expect_error(project_observed_collection_comparisons(p,rbind(refs,refs[1,]),"v","r"),"reference")
})

test_that("collection competition ranking shares tie ranks and skips the next position", {
  fixture <- programme_collection_fixture()
  projection <- register_programme_observed_collections(fixture$metadata)$subventions_par_domaine$project(fixture$canonical)
  projection$facts <- data.frame(indicator_id=projection$descriptor$indicator_id,
    territory_id=c("C_TEST","C_ORT","C_OTHER"), territory_type="commune",
    detail_key=projection$descriptor$comparison_detail,
    observation_period=projection$descriptor$comparison_period,value=c(100,100,50),
    source_id="subventions_scdl",vintage_id=projection$vintages$vintage_id[[1L]])
  refs <- data.frame(territory_id=c("C_TEST","C_ORT","C_OTHER","BZH"),
    territory_type=c("commune","commune","commune","region"), epci_id=NA_character_,
    density_class_code=NA_character_)
  comparison <- project_observed_collection_comparisons(projection,refs,"cv","rv")
  bretagne <- comparison$territories[comparison$territories$comparison_context=="bretagne",]
  expect_equal(bretagne$rank[match(c("C_TEST","C_ORT","C_OTHER"),bretagne$territory_id)],c(1L,1L,3L))
  expect_equal(bretagne$tie_count[match(c("C_TEST","C_ORT","C_OTHER"),bretagne$territory_id)],c(2L,2L,1L))
})

test_that("observed collection publication repairs comparison state and rebuilds atomically", {
  fixture <- programme_collection_fixture()
  p <- register_programme_observed_collections(fixture$metadata)$subventions_par_domaine$project(fixture$canonical)
  p$facts <- data.frame(indicator_id=p$descriptor$indicator_id,territory_id=c("C_TEST","C_ORT"),
    territory_type="commune",detail_key=p$descriptor$comparison_detail,
    observation_period=p$descriptor$comparison_period,value=c(100,200),source_id="subventions_scdl",
    vintage_id=p$vintages$vintage_id[[1L]])
  refs <- data.frame(territory_id=c("C_TEST","C_ORT","C_MISSING","E_TEST","D_TEST","BZH"),
    territory_type=c("commune","commune","commune","epci","departement","region"),
    epci_id=c("E_TEST","E_TEST","E_TEST",NA,NA,NA),density_class_code=c("d","d","d",NA,NA,NA))
  state <- new.env(parent=emptyenv()); state$reference_version <- "r1"; state$territory_reference <- refs
  state$collection_version <- NULL; state$collection_reference_version <- NULL; state$comparison <- NULL
  adapter <- list(
    transaction=function(fn) { before <- as.list.environment(state); tryCatch(fn(),error=function(e) {rm(list=ls(state),envir=state);list2env(before,state);stop(e)}) },
    state=function(id) as.list.environment(state),
    replace_base=function(x,v,r) {state$collection_version <- v;state$collection_reference_version <- r},
    replace_comparisons=function(x,v,c,r) {state$comparison <- list(content_version=v,collection_content_version=c,
      reference_content_version=r,group_row_count=nrow(x$groups),territory_row_count=nrow(x$territories),
      actual_group_rows=nrow(x$groups),actual_territory_rows=nrow(x$territories))}
  )
  first <- publish_observed_collection_with_adapter(p,adapter)
  expect_true(first$changed)
  expect_false(publish_observed_collection_with_adapter(p,adapter)$changed)
  state$comparison$actual_group_rows <- 0L
  expect_true(publish_observed_collection_with_adapter(p,adapter)$changed)
  state$mismatched_group_versions <- 1L
  expect_true(publish_observed_collection_with_adapter(p,adapter)$changed)
  state$mismatched_group_versions <- 0L
  state$comparison <- NULL
  expect_true(publish_observed_collection_with_adapter(p,adapter)$changed)
  state$reference_version <- "r2"
  expect_true(publish_observed_collection_with_adapter(p,adapter)$changed)
  old <- state$comparison
  adapter$replace_comparisons <- function(...) stop("injected comparison write failure")
  state$reference_version <- "r3"
  expect_error(publish_observed_collection_with_adapter(p,adapter),"injected")
  expect_equal(state$comparison,old)
  expect_equal(state$collection_reference_version,"r2")
})
