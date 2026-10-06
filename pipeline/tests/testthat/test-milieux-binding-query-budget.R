test_that("Milieux source binding validation uses three scoped reads and rejects corrupt associations", {
  schema <- Sys.getenv("LUSK_FOCUSED_SCHEMA")
  if (!nzchar(schema)) skip("requires an explicitly selected disposable Milieux schema")
  expect_match(schema, "^it_[a-f0-9]{12,20}$")
  con <- DBI::dbConnect(RPostgres::Postgres(),host=Sys.getenv("LUSK_PROFILE_TEST_HOST"),
    port=as.integer(Sys.getenv("LUSK_PROFILE_TEST_PORT")),dbname=Sys.getenv("LUSK_PROFILE_TEST_DATABASE"),
    user=Sys.getenv("LUSK_PROFILE_TEST_USER"),options="-c default_transaction_read_only=on")
  on.exit(DBI::dbDisconnect(con), add=TRUE)
  identity <- DBI::dbGetQuery(con,"SELECT current_database() db,current_user usr")
  expect_identical(identity$db[[1]], "lusk_it_contract")
  expect_identical(identity$usr[[1]], "lusk_it_contract_pub")
  DBI::dbExecute(con, paste0("SET search_path TO ", DBI::dbQuoteIdentifier(con,schema)))

  root <- Sys.getenv("LUSK_TEST_CANONICAL_DATA_DIR")
  histories <- nanoparquet::read_parquet(file.path(root,"histoires_milieux.parquet"))
  canonical <- list(histories=histories, histoires=histories,
    indicateurs=nanoparquet::read_parquet(file.path(root,"indicateurs_milieux.parquet")),
    vintages=nanoparquet::read_parquet(file.path(root,"vintages.parquet")),
    metadata=lire_theme_metadata("milieux"))
  facts <- register_milieux_reading_publisher(list())$milieux$project(canonical)
  # Four real selected records cover multiple territory identities and retain
  # their original projected facts/binding attributes and producer clocks.
  take <- seq_len(min(4L,nrow(facts)))
  small <- facts[take,,drop=FALSE]
  attr(small,"source_bindings") <- attr(facts,"source_bindings")
  all_bindings <- attr(facts,"source_bindings")
  keys <- paste(small$territory_id,small$territory_type,small$groupe)
  attr(small,"source_bindings") <- all_bindings[
    paste(all_bindings$territory_id,all_bindings$territory_type,all_bindings$groupe) %in% keys,,drop=FALSE]
  attr(small,"population_revisions") <- attr(facts,"population_revisions")

  .GlobalEnv$.lusk_milieux_query_counts <- new.env(parent=emptyenv())
  counts <- .GlobalEnv$.lusk_milieux_query_counts
  counts$revision <- counts$observation <- counts$link <- 0L
  .GlobalEnv$.lusk_milieux_marker_reached <- FALSE
  marker_reached <- .GlobalEnv$.lusk_milieux_marker_reached
  trace(DBI::dbGetQuery, where=asNamespace("DBI"), print=FALSE,
    tracer=quote({
      query <- as.character(statement)[[1L]]
      if (grepl("FROM series_provenance_revision WHERE provenance_revision_id IN",query,fixed=TRUE)) .GlobalEnv$.lusk_milieux_query_counts$revision <- .GlobalEnv$.lusk_milieux_query_counts$revision+1L
      if (grepl("FROM series_dataset_observation WHERE indicator_id='artif_par_habitant'",query,fixed=TRUE)) .GlobalEnv$.lusk_milieux_query_counts$observation <- .GlobalEnv$.lusk_milieux_query_counts$observation+1L
      if (grepl("FROM series_observation_provenance WHERE indicator_id='artif_par_habitant'",query,fixed=TRUE)) .GlobalEnv$.lusk_milieux_query_counts$link <- .GlobalEnv$.lusk_milieux_query_counts$link+1L
    }))
  on.exit(untrace(DBI::dbGetQuery, where=asNamespace("DBI")),add=TRUE)
  trace(DBI::dbWithTransaction,where=asNamespace("DBI"),print=FALSE,
    tracer=quote(stop(structure(list(message="binding checks completed",call=NULL),
      class=c("binding_checks_complete","error","condition")))))
  on.exit(untrace(DBI::dbWithTransaction,where=asNamespace("DBI")),add=TRUE)
  expect_error(publish_milieux_reading(con,small,canonical),class="binding_checks_complete")
  expect_identical(c(counts$revision,counts$observation,counts$link),c(1L,1L,1L))

  bindings <- attr(small,"source_bindings")
  ocs <- which(bindings$field_key!="population")
  expect_gt(length(ocs),1L)
  bad_cases <- list(
    revision=transform(bindings,provenance_revision_id=replace(provenance_revision_id,ocs[1],"missing-revision")),
    source=transform(bindings,source_id=replace(source_id,ocs[1],"wrong-source")),
    window=transform(bindings,observation_period=replace(observation_period,ocs[1],"wrong-window")),
    role=transform(bindings,state_role=replace(state_role,ocs[1],"wrong-role")),
    missing_link=transform(bindings,provenance_revision_id=replace(provenance_revision_id,ocs[1],"unlinked-revision")))
  for (name in names(bad_cases)) {
    bad <- small
    attr(bad,"source_bindings") <- bad_cases[[name]]
    err <- tryCatch(publish_milieux_reading(con,bad,canonical),error=function(e) e)
    expect_true(inherits(err,"error"),info=paste("association corruption was accepted:",name))
    expect_false(inherits(err,"binding_checks_complete"),
      info=paste("corrupt association passed all validation checks:",name))
  }
  wrong_value <- small
  row <- bindings[ocs[1],,drop=FALSE]
  fact_row <- match(paste(row$territory_id,row$territory_type,row$groupe),
    paste(wrong_value$territory_id,wrong_value$territory_type,wrong_value$groupe))
  field <- if(row$field_key=="artif_m2_par_habitant") "artif_m2_par_habitant" else "artif_m3_par_habitant"
  wrong_value[[field]][fact_row] <- wrong_value[[field]][fact_row]+1
  err <- tryCatch(publish_milieux_reading(con,wrong_value,canonical),error=function(e)e)
  expect_true(inherits(err,"error"))
  expect_false(inherits(err,"binding_checks_complete"),"value mismatch passed association checks")
  rm(.lusk_milieux_query_counts,.lusk_milieux_marker_reached,envir=.GlobalEnv)
})
