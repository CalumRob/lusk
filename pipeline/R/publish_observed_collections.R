# A sparse year/detail grain is not a dense profile and never fills absent cells.
project_programme_period_details <- function(canonical,metadata,indicator) {
  page <- metadata$indicator_pages[[indicator]]
  policy <- metadata$observed_collection_contracts[[indicator]]
  if (!identical(policy$kind,"period_detail") || !identical(policy$completeness,"observed_sparse") ||
      is.null(page) || !identical(page$indicator,indicator)) stop("Sparse period/detail contract is undeclared",call.=FALSE)
  raw <- construire_indicateurs_programmes(canonical$programmes$membres,canonical$programmes$subventions)
  raw <- raw[raw$key==indicator,,drop=FALSE]
  details <- unlist(page$list$categories,use.names=FALSE)
  labels <- unlist(metadata$detail_labels[[indicator]],use.names=TRUE)
  levels <- unlist(page$levels,use.names=FALSE)
  source <- unlist(page$sources,use.names=FALSE)
  vintage <- canonical$vintages[canonical$vintages$id %in% source,,drop=FALSE]
  if (!length(details) || anyDuplicated(details) || !setequal(names(labels),details) ||
      length(source)!=1L || nrow(vintage)!=1L || anyNA(raw[c("territoire","type","detail","dimension","value","unit")]) ||
      any(!raw$detail %in% details) || any(!raw$type %in% levels) || any(raw$unit!=page$unit) ||
      any(!grepl("^[0-9]{4}$",raw$dimension)) || any(!is.finite(raw$value)) ||
      anyDuplicated(raw[c("territoire","dimension","detail")]) ||
      !page$comparison$detail %in% details || !page$direction %in% c("high","low"))
    stop("Sparse period/detail observations differ from declared coordinates or metadata",call.=FALSE)
  # Uses the same source-contract validation as the independent annual owner;
  # additionally check every sparse raw row (not only the pooled total stamp).
  annual <- project_annual_grants_owned_series(canonical,metadata)
  p <- annual$provenance
  if (anyNA(raw[c("vintage_source","vintage_version","vintage_date_reference","vintage_date_publication")]) ||
      any(raw$vintage_source!=p$source_name[[1L]]) || any(raw$vintage_version!=p$source_version[[1L]]) ||
      any(as.character(raw$vintage_date_reference)!=as.character(p$reference_date[[1L]])) ||
      any(as.character(raw$vintage_date_publication)!=as.character(p$publication_date[[1L]])))
    stop("Sparse grant row source vintage differs from the canonical grant owner",call.=FALSE)
  vintage_id <- paste(p$source_version,p$reference_date,p$publication_date,sep="/")
  descriptor <- list(indicator_id=indicator,theme_id=metadata$theme,kind=policy$kind,label=page$label,unit=page$unit,
    allowed_levels=levels,comparison_detail=page$comparison$detail,comparison_period=page$comparison$dimension,
    direction=page$direction)
  cats <- data.frame(indicator_id=indicator,detail_key=details,label=unname(labels[details]),ordinal=seq_along(details)-1L,source_id=source)
  descriptor$descriptor_version <- scalar_content_version(list(descriptor,cats))
  list(descriptor=descriptor,
    categories=cats,
    facts=data.frame(indicator_id=rep(indicator,nrow(raw)),territory_id=as.character(raw$territoire),territory_type=as.character(raw$type),
      detail_key=as.character(raw$detail),observation_period=as.character(raw$dimension),value=raw$value,
      source_id=rep(source,nrow(raw)),vintage_id=rep(vintage_id,nrow(raw))),
    datasets=data.frame(source_id=source,name=p$source_name),
    vintages=data.frame(source_id=source,vintage_id=vintage_id,version=p$source_version,
      reference_date=p$reference_date,publication_date=p$publication_date))
}

project_programme_memberships <- function(canonical,metadata,indicator) {
  policy <- metadata$observed_collection_contracts[[indicator]]
  if (!identical(policy$kind,"anchored_membership") || !identical(policy$completeness,"observed_sparse"))
    stop("Membership collection contract is undeclared",call.=FALSE)
  categories <- names(policy$categories)
  labels <- unlist(metadata$detail_labels[[indicator]],use.names=TRUE)
  raw <- canonical$programmes$membres
  reference <- canonical$territoires[canonical$territoires$type=="commune",,drop=FALSE]
  verifier_membres_programmes(raw,data.frame(CODGEO=reference$territoire,EPCI=reference$epci),canonical$vintages)
  if (!setequal(categories,names(labels)) || anyNA(raw[c("territoire","type","sigle","convention_valant_ort","vintage_source","vintage_version","vintage_date_reference")]) ||
      any(!raw$sigle %in% categories) || anyDuplicated(raw[c("territoire","sigle")]) ||
      anyNA(as.Date(raw$vintage_date_reference))) stop("Invalid membership anchors or clocks",call.=FALSE)
  coverage <- construire_indicateurs_programmes(raw,canonical$programmes$subventions)
  coverage <- coverage[coverage$key==indicator,,drop=FALSE]
  if (any(coverage$unit!=policy$unit)) stop("Membership unit differs from its canonical producer",call.=FALSE)
  cats <- lapply(seq_along(categories),function(i) {
    key <- categories[[i]]; contract <- policy$categories[[key]]
    if (sum(canonical$vintages$id==contract$source)!=1L || !contract$clock %in% c("dataset","row_reference") ||
        !length(contract$anchor_levels) || any(!unlist(contract$anchor_levels) %in% c("commune","epci")))
      stop("Invalid declared membership source, anchor or clock policy",call.=FALSE)
    data.frame(indicator_id=indicator,detail_key=key,label=labels[[key]],ordinal=i-1L,source_id=contract$source,
      anchor_levels=paste0("{",paste(unlist(contract$anchor_levels),collapse=","),"}"),
      rider_label=contract$rider_label %||% NA_character_,clock_policy=contract$clock,stringsAsFactors=FALSE)
  })
  sources <- vapply(as.character(raw$sigle),function(key) policy$categories[[key]]$source,character(1))
  for (i in seq_len(nrow(raw))) {
    contract <- policy$categories[[raw$sigle[[i]]]]
    vintage <- canonical$vintages[canonical$vintages$id==sources[[i]],,drop=FALSE]
    if (nrow(vintage)!=1L || !raw$type[[i]] %in% unlist(contract$anchor_levels) ||
        !identical(as.character(raw$vintage_source[[i]]),as.character(vintage$source[[1L]])) ||
        !identical(as.character(raw$vintage_version[[i]]),as.character(vintage$version[[1L]])) ||
        (raw$convention_valant_ort[[i]] && is.null(contract$rider_label)))
      stop("Membership source, anchor or rider differs from its producer contract",call.=FALSE)
    if (identical(contract$clock,"dataset")) {
      if (!identical(as.character(raw$vintage_date_reference[[i]]),as.character(vintage$date_reference[[1L]])) ||
          !identical(as.character(raw$vintage_date_publication[[i]]),as.character(vintage$date_publication[[1L]])))
        stop("Membership dataset clocks differ from canonical vintage",call.=FALSE)
    } else if (!identical(contract$clock,"row_reference") || !is.na(raw$vintage_date_publication[[i]]))
      stop("Row-reference membership must preserve its actual reference and absent publication date",call.=FALSE)
  }
  vintage_ids <- paste(raw$vintage_version,raw$vintage_date_reference,raw$vintage_date_publication,sep="/")
  descriptor <- list(indicator_id=indicator,theme_id=metadata$theme,kind=policy$kind,
    label=metadata$indicator_labels[[indicator]],unit=policy$unit,allowed_levels=unlist(policy$levels,use.names=FALSE),
    comparison_detail=NA_character_,comparison_period=NA_character_,direction="none")
  descriptor$descriptor_version <- scalar_content_version(list(descriptor,cats,policy))
  list(descriptor=descriptor,categories=do.call(rbind,cats),
    facts=data.frame(indicator_id=rep(indicator,nrow(raw)),territory_id=as.character(raw$territoire),territory_type=as.character(raw$type),
      detail_key=as.character(raw$sigle),convention_valant_ort=raw$convention_valant_ort,source_id=sources,vintage_id=vintage_ids),
    datasets=data.frame(source_id=vapply(policy$categories,function(contract) contract$source,character(1)),
      name=vapply(policy$categories,function(contract) as.character(canonical$vintages$source[canonical$vintages$id==contract$source]),character(1))),
    vintages=unique(data.frame(source_id=sources,vintage_id=vintage_ids,version=as.character(raw$vintage_version),
      reference_date=as.Date(raw$vintage_date_reference),publication_date=as.Date(raw$vintage_date_publication))))
}

register_programme_observed_collections <- function(metadata) {
  registry <- lapply(names(metadata$observed_collection_contracts),function(indicator) {
    kind <- metadata$observed_collection_contracts[[indicator]]$kind
    project <- switch(kind,period_detail=project_programme_period_details,
      anchored_membership=project_programme_memberships,stop("Unknown observed collection shape",call.=FALSE))
    list(project=function(canonical) project(canonical,metadata,indicator))
  })
  names(registry) <- names(metadata$observed_collection_contracts)
  registry
}

publish_observed_collection <- function(projection,con) {
  d <- projection$descriptor; indicator <- d$indicator_id
  version <- scalar_content_version(projection)
  DBI::dbWithTransaction(con,{
    DBI::dbGetQuery(con,"SELECT pg_advisory_xact_lock(hashtext('observed-collection'),hashtext($1))",params=list(indicator))
    ref <- DBI::dbGetQuery(con,"SELECT content_version FROM table_publication WHERE table_name='territory_reference'")
    if (nrow(ref)!=1L) stop("Observed collection reference is unavailable",call.=FALSE)
    previous <- DBI::dbGetQuery(con,"SELECT content_version,reference_content_version FROM observed_collection_publication WHERE indicator_id=$1",params=list(indicator))
    changed <- !nrow(previous) || previous$content_version[[1L]]!=version || previous$reference_content_version[[1L]]!=ref$content_version[[1L]]
    if (changed) {
      for (i in seq_len(nrow(projection$datasets))) {
        r <- projection$datasets[i,,drop=FALSE]
        DBI::dbExecute(con,"INSERT INTO source_dataset(source_id,name) VALUES($1,$2) ON CONFLICT DO NOTHING",params=unname(as.list(r)))
        same <- DBI::dbGetQuery(con,"SELECT name FROM source_dataset WHERE source_id=$1",params=list(r$source_id))
        if (!identical(same$name,r$name)) stop("Observed source identity conflicts with an existing publication",call.=FALSE)
      }
      for (i in seq_len(nrow(projection$vintages))) {
        r <- projection$vintages[i,,drop=FALSE]
        DBI::dbExecute(con,"INSERT INTO source_vintage(source_id,vintage_id,version,reference_date,publication_date) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",params=unname(as.list(r)))
        same <- DBI::dbGetQuery(con,"SELECT version,reference_date,publication_date FROM source_vintage WHERE source_id=$1 AND vintage_id=$2",params=list(r$source_id,r$vintage_id))
        if (!isTRUE(all.equal(same,r[c("version","reference_date","publication_date")],check.attributes=FALSE)))
          stop("Observed source vintage conflicts with an existing publication",call.=FALSE)
      }
      DBI::dbExecute(con,"DELETE FROM observed_collection_publication WHERE indicator_id=$1",params=list(indicator))
      DBI::dbExecute(con,"INSERT INTO observed_collection_publication(indicator_id,content_version,reference_content_version,row_count) VALUES($1,$2,$3,$4)",params=list(indicator,version,ref$content_version[[1L]],nrow(projection$facts)))
      levels <- paste0("{",paste(d$allowed_levels,collapse=","),"}")
      DBI::dbExecute(con,"INSERT INTO observed_collection_descriptor(indicator_id,theme_id,kind,label,unit,descriptor_version,allowed_levels,comparison_detail,comparison_period,direction) VALUES($1,$2,$3,$4,$5,$6,$7::text[],$8,$9,$10)",
        params=list(indicator,d$theme_id,d$kind,d$label,d$unit,d$descriptor_version,levels,d$comparison_detail,d$comparison_period,d$direction))
      DBI::dbWriteTable(con,"observed_collection_category",projection$categories,append=TRUE,row.names=FALSE)
      table <- switch(d$kind,period_detail="period_detail_observation",anchored_membership="anchored_membership",
        stop("Unknown observed fact shape",call.=FALSE))
      DBI::dbWriteTable(con,table,projection$facts,append=TRUE,row.names=FALSE)
    }
    list(changed=changed,content_version=version,indicator_id=indicator)
  })
}

publish_registered_observed_collections <- function(canonical,metadata,con) {
  registry <- register_programme_observed_collections(metadata)
  # All registered inputs validate before the first collection replacement.
  projections <- lapply(registry,function(publisher) publisher$project(canonical))
  lapply(projections,function(projection) publish_observed_collection(projection,con))
}
