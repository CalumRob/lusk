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
  observed_collection_inventory(metadata)
  registry <- lapply(names(metadata$observed_collection_contracts),function(indicator) {
    kind <- metadata$observed_collection_contracts[[indicator]]$kind
    project <- switch(kind,period_detail=project_programme_period_details,
      anchored_membership=project_programme_memberships,stop("Unknown observed collection shape",call.=FALSE))
    list(project=function(canonical) project(canonical,metadata,indicator))
  })
  names(registry) <- names(metadata$observed_collection_contracts)
  registry
}

# Numeric sparse collection comparisons are derived solely from each typed
# observed-collection descriptor and the committed territory reference.
project_observed_collection_comparisons <- function(projections, territory_reference,
    collection_content_version, reference_content_version) {
  p <- projections
  if (!is.list(p) || is.null(p$descriptor) || is.null(p$facts)) stop("One validated observed collection projection is required",call.=FALSE)
  d <- p$descriptor
  valid_version <- function(x) is.character(x) && length(x)==1L && !is.na(x) && nzchar(x)
  if (!valid_version(collection_content_version) || !valid_version(reference_content_version)) stop("Invalid comparison publication versions",call.=FALSE)
  if (!identical(d$kind,"period_detail")) return(list(groups=data.frame(),territories=data.frame(),
    collection_content_version=collection_content_version,reference_content_version=reference_content_version))
  required <- c("territory_id","territory_type","detail_key","observation_period","value","source_id","vintage_id")
  if (!all(required %in% names(p$facts)) || !d$direction %in% c("high","low") ||
      length(d$comparison_detail)!=1L || is.na(d$comparison_detail) ||
      length(d$comparison_period)!=1L || is.na(d$comparison_period)) stop("Invalid period/detail comparison descriptor or facts",call.=FALSE)
  if (anyDuplicated(p$facts[c("territory_id","territory_type","detail_key","observation_period")]) ||
      any(!is.finite(p$facts$value)) || anyNA(p$facts[c("source_id","vintage_id")]) ||
      any(!nzchar(p$facts$source_id) | !nzchar(p$facts$vintage_id)) ||
      !all(c("source_id","vintage_id") %in% names(p$vintages)) || !all(c("source_id","name") %in% names(p$datasets)) ||
      any(!paste(p$facts$source_id,p$facts$vintage_id) %in% paste(p$vintages$source_id,p$vintages$vintage_id)) ||
      any(!p$facts$source_id %in% p$datasets$source_id))
    stop("Duplicate, non-finite or unowned sparse collection fact",call.=FALSE)
  if (any(!paste(p$facts$territory_id,p$facts$territory_type) %in%
      paste(territory_reference$territory_id,territory_reference$territory_type))) stop("Sparse collection fact is outside committed territory reference",call.=FALSE)
  groups <- list(); territories <- list(); lineage <- list()
    facts <- p$facts[p$facts$detail_key==d$comparison_detail & p$facts$observation_period==d$comparison_period,,drop=FALSE]
    membership <- comparison_context_membership(territory_reference,d$allowed_levels)
    for (i in seq_len(nrow(membership))) {
      g <- membership[i,,drop=FALSE]; type <- as.character(g$territory_type)
      if (!type %in% d$allowed_levels) next
      ids <- as.character(g$member_ids[[1L]])
      selected <- facts[facts$territory_type==type & facts$territory_id %in% ids,,drop=FALSE]
      if (anyDuplicated(selected$territory_id)) stop("Duplicate comparison facts for territory",call.=FALSE)
      ix <- match(ids,selected$territory_id)
      status <- ifelse(is.na(ix),"not_published","measured")
      values <- rep(NA_real_,length(ids)); values[!is.na(ix)] <- selected$value[ix[!is.na(ix)]]
      eligible <- values[!is.na(values)]
      ranks <- ties <- sizes <- rep(NA_integer_,length(ids))
      for (j in which(!is.na(values))) {
        ranks[j] <- 1L+sum(if(d$direction=="high") eligible>values[j] else eligible<values[j])
        ties[j] <- sum(eligible==values[j]); sizes[j] <- length(eligible)
      }
      key <- data.frame(comparison_context=as.character(g$comparison_context),group_id=as.character(g$group_id),
        territory_type=type,indicator_id=d$indicator_id,detail_key=d$comparison_detail,
        observation_period=d$comparison_period,stringsAsFactors=FALSE)
      pairs <- unique(selected[!is.na(selected$value),c("source_id","vintage_id"),drop=FALSE])
      if (nrow(pairs)) lineage[[length(lineage)+1L]] <- cbind(key[rep(1L,nrow(pairs)),,drop=FALSE],pairs)
      groups[[length(groups)+1L]] <- cbind(key,statistic="median",median=if(length(eligible)) stats::median(eligible) else NA_real_,
        member_count=length(ids),eligible_count=length(eligible),missing_count=length(ids)-length(eligible),
        lineage_source_count=nrow(pairs),
        collection_content_version=collection_content_version,reference_content_version=reference_content_version)
      territories[[length(territories)+1L]] <- cbind(key,territory_id=ids,value=values,status=status,rank=ranks,
        tie_count=ties,rank_size=sizes,collection_content_version=collection_content_version,
        reference_content_version=reference_content_version)
    }
  lineage_result <- if(length(lineage)) unique(do.call(rbind,lineage)) else data.frame(
      comparison_context=character(),group_id=character(),territory_type=character(),indicator_id=character(),
      detail_key=character(),observation_period=character(),source_id=character(),vintage_id=character())
  if (nrow(lineage_result)) lineage_result <- lineage_result[order(lineage_result$comparison_context,
    lineage_result$group_id,lineage_result$territory_type,lineage_result$detail_key,
    lineage_result$observation_period,lineage_result$source_id,lineage_result$vintage_id),,drop=FALSE]
  list(groups=if(length(groups)) do.call(rbind,groups) else data.frame(),
    territories=if(length(territories)) do.call(rbind,territories) else data.frame(),
    lineage=lineage_result,
    collection_content_version=collection_content_version,reference_content_version=reference_content_version)
}

# Keep comparison artifacts as immutable generations. The database publication
# marker can then identify the same comparison content without overwriting the
# previous complete artifact when a refresh fails.
write_observed_collection_comparison_parquets <- function(projection,directory,indicator_id,
    write_fn=nanoparquet::write_parquet,rename_fn=file.rename) {
  if (!is.list(projection) || !all(c("groups","territories","lineage","collection_content_version",
      "reference_content_version") %in% names(projection)) ||
      !is.data.frame(projection$groups) || !is.data.frame(projection$territories) ||
      !is.data.frame(projection$lineage))
    stop("Invalid observed collection comparison projection",call.=FALSE)
  if (!is.character(indicator_id) || length(indicator_id)!=1L || is.na(indicator_id) ||
      !grepl("^[a-z][a-z0-9_]{0,95}$",indicator_id) || !is.character(directory) ||
      length(directory)!=1L || is.na(directory) || !nzchar(directory) ||
      !is.function(write_fn) || !is.function(rename_fn))
    stop("Observed collection comparison artifact destination is invalid",call.=FALSE)
  if (!requireNamespace("nanoparquet",quietly=TRUE))
    stop("nanoparquet is required to write observed collection comparison artifacts",call.=FALSE)
  dir.create(directory,recursive=TRUE,showWarnings=FALSE)
  version <- scalar_content_version(projection)
  generation <- file.path(directory,paste0("observed-collection-comparison-",indicator_id,"-",version))
  dir.create(generation,recursive=TRUE,showWarnings=FALSE)
  targets <- file.path(generation,c("groups.parquet","territories.parquet","lineage.parquet"))
  expected <- list(projection$groups,projection$territories,projection$lineage)
  present <- file.exists(targets)
  for (i in which(present)) {
    existing <- tryCatch(nanoparquet::read_parquet(targets[[i]]),error=function(e) NULL)
    if (is.null(existing) || !isTRUE(all.equal(existing,expected[[i]],check.attributes=FALSE)))
      stop("Existing observed collection comparison generation differs from its content version",call.=FALSE)
  }
  if (all(present)) return(invisible(targets))
  staged <- vapply(targets,function(path) tempfile("observed-collection-comparison-",dirname(path),fileext=".parquet"),character(1))
  on.exit(unlink(staged[file.exists(staged)]),add=TRUE)
  for (i in which(!present)) write_fn(expected[[i]],staged[[i]])
  for (i in which(!present)) {
    checked <- nanoparquet::read_parquet(staged[[i]])
    if (!isTRUE(all.equal(checked,expected[[i]],check.attributes=FALSE)))
      stop("Staged observed collection comparison artifact validation failed",call.=FALSE)
    if (!rename_fn(staged[[i]],targets[[i]]))
      stop("Could not install observed collection comparison artifacts",call.=FALSE)
  }
  invisible(targets)
}

observed_collection_inventory <- function(metadata) {
  contracts <- metadata$observed_collection_contracts
  if (is.null(contracts) || is.null(metadata$indicator_pages)) stop("Observed collection inventory requires typed metadata",call.=FALSE)
  ids <- names(Filter(function(x) identical(x$kind,"period_detail"),contracts))
  for (id in ids) {
    contract <- contracts[[id]]; page <- metadata$indicator_pages[[id]]
    if (is.null(page) || !identical(page$indicator,id) || is.null(page$comparison$detail) ||
        is.null(page$comparison$dimension) || !identical(contract$completeness,"observed_sparse") ||
        !page$direction %in% c("high","low") || is.null(page$levels) || is.null(page$list$categories))
      stop(sprintf("Period/detail inventory has no typed comparison descriptor: %s",id),call.=FALSE)
  }
  ids
}

observed_collection_comparison_stale <- function(marker, expected_version, collection_version,
    reference_version, expected_groups, expected_territories, actual_groups,
    actual_territories, mismatched_group_versions=0L, mismatched_territory_versions=0L,
    expected_lineage=0L,actual_lineage=0L,mismatched_lineage_versions=0L) {
  is.null(marker) || !isTRUE(marker$lineage_complete) || !identical(as.character(marker$content_version),as.character(expected_version)) ||
    !identical(as.character(marker$collection_content_version),as.character(collection_version)) ||
    !identical(as.character(marker$reference_content_version),as.character(reference_version)) ||
    as.integer(marker$group_row_count)!=as.integer(expected_groups) ||
    as.integer(marker$territory_row_count)!=as.integer(expected_territories) ||
    as.integer(actual_groups)!=as.integer(expected_groups) ||
    as.integer(actual_territories)!=as.integer(expected_territories) ||
    as.integer(marker$lineage_row_count)!=as.integer(expected_lineage) ||
    as.integer(actual_lineage)!=as.integer(expected_lineage) ||
    as.integer(mismatched_group_versions)!=0L || as.integer(mismatched_territory_versions)!=0L ||
    as.integer(mismatched_lineage_versions)!=0L
}

publish_observed_collection <- function(projection,con,artifact_directory=NULL) {
  d <- projection$descriptor; indicator <- d$indicator_id
  version <- scalar_content_version(projection)
  DBI::dbWithTransaction(con,{
    DBI::dbGetQuery(con,"SELECT pg_advisory_xact_lock(hashtext('observed-collection'),hashtext($1))",params=list(indicator))
    ref <- DBI::dbGetQuery(con,"SELECT content_version FROM table_publication WHERE table_name='territory_reference'")
    if (nrow(ref)!=1L) stop("Observed collection reference is unavailable",call.=FALSE)
    reference <- DBI::dbGetQuery(con,"SELECT territory_id,territory_type,epci_id,density_class_code FROM territory_reference")
    previous <- DBI::dbGetQuery(con,"SELECT content_version,reference_content_version FROM observed_collection_publication WHERE indicator_id=$1",params=list(indicator))
    changed <- !nrow(previous) || previous$content_version[[1L]]!=version || previous$reference_content_version[[1L]]!=ref$content_version[[1L]]
    comparisons <- project_observed_collection_comparisons(projection,reference,version,ref$content_version[[1L]])
    comparison_version <- scalar_content_version(comparisons)
    artifact_paths <- if (identical(d$kind,"period_detail") && !is.null(artifact_directory))
      write_observed_collection_comparison_parquets(comparisons,artifact_directory,indicator) else NULL
    comparison_marker <- DBI::dbGetQuery(con,"SELECT content_version,collection_content_version,reference_content_version,group_row_count,territory_row_count,lineage_row_count,lineage_complete FROM observed_collection_comparison_publication WHERE indicator_id=$1",params=list(indicator))
    actual_groups <- DBI::dbGetQuery(con,"SELECT count(*) AS n FROM observed_collection_comparison_group WHERE indicator_id=$1",params=list(indicator))$n[[1L]]
    actual_territories <- DBI::dbGetQuery(con,"SELECT count(*) AS n FROM observed_collection_comparison_territory WHERE indicator_id=$1",params=list(indicator))$n[[1L]]
    mismatched_groups <- DBI::dbGetQuery(con,"SELECT count(*) AS n FROM observed_collection_comparison_group WHERE indicator_id=$1 AND (collection_content_version<>$2 OR reference_content_version<>$3)",params=list(indicator,version,ref$content_version[[1L]]))$n[[1L]]
    mismatched_territories <- DBI::dbGetQuery(con,"SELECT count(*) AS n FROM observed_collection_comparison_territory WHERE indicator_id=$1 AND (collection_content_version<>$2 OR reference_content_version<>$3)",params=list(indicator,version,ref$content_version[[1L]]))$n[[1L]]
    actual_lineage <- DBI::dbGetQuery(con,"SELECT count(*) AS n FROM observed_collection_comparison_lineage WHERE indicator_id=$1",params=list(indicator))$n[[1L]]
    mismatched_lineage <- DBI::dbGetQuery(con,"SELECT count(*) AS n FROM observed_collection_comparison_lineage WHERE indicator_id=$1 AND comparison_content_version<>$2",params=list(indicator,comparison_version))$n[[1L]]
    comparison_stale <- identical(d$kind,"period_detail") && observed_collection_comparison_stale(
      if(nrow(comparison_marker)) as.list(comparison_marker[1,,drop=FALSE]) else NULL,comparison_version,version,
      ref$content_version[[1L]],nrow(comparisons$groups),nrow(comparisons$territories),actual_groups,actual_territories,
      mismatched_groups,mismatched_territories,nrow(comparisons$lineage),actual_lineage,mismatched_lineage)
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
    if (identical(d$kind,"period_detail") && (changed || comparison_stale)) {
      DBI::dbExecute(con,"INSERT INTO observed_collection_comparison_publication(indicator_id,content_version,collection_content_version,reference_content_version,group_row_count,territory_row_count,lineage_row_count,lineage_complete,published_at) VALUES($1,$2,$3,$4,$5,$6,$7,true,now()) ON CONFLICT(indicator_id) DO UPDATE SET content_version=EXCLUDED.content_version,collection_content_version=EXCLUDED.collection_content_version,reference_content_version=EXCLUDED.reference_content_version,group_row_count=EXCLUDED.group_row_count,territory_row_count=EXCLUDED.territory_row_count,lineage_row_count=EXCLUDED.lineage_row_count,lineage_complete=true,published_at=EXCLUDED.published_at",
        params=list(indicator,comparison_version,version,ref$content_version[[1L]],nrow(comparisons$groups),nrow(comparisons$territories),nrow(comparisons$lineage)))
      DBI::dbExecute(con,"DELETE FROM observed_collection_comparison_group WHERE indicator_id=$1",params=list(indicator))
      DBI::dbWriteTable(con,"observed_collection_comparison_group",transform(comparisons$groups,indicator_id=indicator),append=TRUE,row.names=FALSE)
      DBI::dbWriteTable(con,"observed_collection_comparison_territory",transform(comparisons$territories,indicator_id=indicator),append=TRUE,row.names=FALSE)
      if (nrow(comparisons$lineage)) DBI::dbWriteTable(con,"observed_collection_comparison_lineage",
        transform(comparisons$lineage,indicator_id=indicator,comparison_content_version=comparison_version),append=TRUE,row.names=FALSE)
    }
    list(changed=changed || comparison_stale,content_version=version,indicator_id=indicator,
      comparison_content_version=comparison_version,comparison_artifacts=artifact_paths)
  })
}

# Small adapter seam for exercising publication recovery/atomicity without a
# database. Adapters implement transaction(), state(), replace_base(), and
# replace_comparisons(); the production path above performs the same operations
# directly through DBI inside dbWithTransaction().
publish_observed_collection_with_adapter <- function(projection, adapter) {
  d <- projection$descriptor; version <- scalar_content_version(projection)
  protocol_db <- list(
    transaction = function(expr) adapter$transaction(function() force(expr)),
    lock = if (is.function(adapter$lock)) function(owner) adapter$lock(owner) else NULL,
    marker = function(owner) {
      state <- adapter$state(owner)
      data.frame(content_version = state$collection_version %||% NA_character_,
        reference_content_version = state$collection_reference_version %||% NA_character_)
    })
  publish_snapshot <- function(state, reference_version) {
    comparisons <- project_observed_collection_comparisons(
      projection, state$territory_reference, version, reference_version)
    comparison_version <- scalar_content_version(comparisons)
    adapter$replace_base(projection, version, reference_version)
    if (identical(d$kind,"period_detail"))
      adapter$replace_comparisons(comparisons,comparison_version,version,reference_version)
  }
  result <- publish_owner_snapshot(
    db = protocol_db, owner = d$indicator_id, content_version = version,
    dependency_name = "territory_reference",
    read_dependency = function() {
      state <- adapter$state(d$indicator_id)
      data.frame(content_version = state$reference_version %||% NA_character_)
    },
    validate_dependency = function(dependency) {
      if (!nrow(dependency) || is.na(dependency$content_version[[1L]]) ||
          !nzchar(dependency$content_version[[1L]]))
        stop("Observed collection reference is unavailable",call.=FALSE)
    },
    publish_content = function(version_arg, dependency) {
      publish_snapshot(adapter$state(d$indicator_id), dependency$content_version[[1L]])
    },
    rebind_dependency = function(reference_version) {
      publish_snapshot(adapter$state(d$indicator_id), reference_version)
    },
    requires_republish = function(marker, dependency) {
      if (!identical(d$kind,"period_detail")) return(FALSE)
      state <- adapter$state(d$indicator_id)
      comparisons <- project_observed_collection_comparisons(
        projection, state$territory_reference, version, dependency$content_version[[1L]])
      comparison_version <- scalar_content_version(comparisons)
      comparison <- state$comparison
      observed_collection_comparison_stale(
        comparison, comparison_version, version, dependency$content_version[[1L]],
        nrow(comparisons$groups),nrow(comparisons$territories),
        state$actual_group_rows %||% (comparison$actual_group_rows %||% NA_integer_),
        state$actual_territory_rows %||% (comparison$actual_territory_rows %||% NA_integer_),
        state$mismatched_group_versions %||% 0L,state$mismatched_territory_versions %||% 0L,
        nrow(comparisons$lineage),
        state$actual_lineage_rows %||% (comparison$actual_lineage_rows %||% NA_integer_),
        state$mismatched_lineage_versions %||% 0L)
    })
  invisible(list(changed = result$changed || result$rebound || result$republished_for_dependency,
    content_version = version, indicator_id = d$indicator_id))
}

publish_registered_observed_collections <- function(canonical,metadata,con,artifact_directory=NULL) {
  registry <- register_programme_observed_collections(metadata)
  # All registered inputs validate before the first collection replacement.
  projections <- lapply(registry,function(publisher) publisher$project(canonical))
  lapply(projections,function(projection) publish_observed_collection(projection,con,artifact_directory))
}
