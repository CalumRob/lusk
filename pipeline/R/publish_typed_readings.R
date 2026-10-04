# Narrow projection of the already-selected R history records for typed serving.
# This deliberately does not publish candidate pools or recompute story selection.
project_typed_reading_facts <- function(histories, theme) {
  required <- switch(theme,
    demographie = c("territoire", "type", "theme", "groupe", "story_key", "salience_reason",
      "periode", "solde_naturel", "solde_migratoire", "taux_solde_naturel",
      "taux_solde_migratoire", "classification"),
    habitat = c("territoire", "type", "theme", "groupe", "story_key", "salience_reason",
      "classification", "part_passoires", "part_abc", "n_dpe"),
    economie = c("territoire", "type", "theme", "groupe", "story_key", "salience_reason",
      unlist(lapply(seq_len(5L), function(rank) paste0("top", rank, "_", c("activity_code", "activity_label", "lq", "n", "part_parc"))), use.names=FALSE)),
    milieux = c("territoire", "type", "theme", "groupe", "story_key", "salience_reason",
      "periode_pop", "periode_artif", "delta_population", "taux_variation_population",
      "artif_m2_par_habitant", "artif_m3_par_habitant", "trajectoire_artif_par_habitant", "classification"),
    mobilite = c("territoire", "type", "theme", "groupe", "story_key", "salience_reason",
      "div_loss_t", "div_loss_b"),
    stop("Unsupported typed-reading theme: ", theme, call.=FALSE))
  if (!is.data.frame(histories) || !all(required %in% names(histories)))
    stop("Canonical selected reading is missing fields for ", theme, call.=FALSE)
  rows <- histories[histories$theme == theme, required, drop=FALSE]
  if (anyNA(rows[c("territoire", "type", "groupe", "story_key", "salience_reason")]) ||
      any(!rows$type %in% c("commune", "epci", "departement", "region")) ||
      anyDuplicated(rows[c("territoire", "type", "groupe")]))
    stop("Invalid or duplicate selected reading identity for ", theme, call.=FALSE)
  if (theme == "economie") for (rank in seq_len(5L)) {
    code <- rows[[paste0("top",rank,"_activity_code")]]
    label <- rows[[paste0("top",rank,"_activity_label")]]
    lq <- rows[[paste0("top",rank,"_lq")]]
    count <- rows[[paste0("top",rank,"_n")]]
    park <- rows[[paste0("top",rank,"_part_parc")]]
    present <- !is.na(code)
    if (any(present & (is.na(label) | is.na(lq) | !is.finite(lq) | lq < 0 | is.na(count) | count < 0 |
        (!is.na(park) & (!is.finite(park) | park < 0 | park > 1)))) ||
        any(!present & (!is.na(label) | !is.na(lq) | !is.na(count) | !is.na(park))))
      stop("Invalid sparse activity evidence in canonical economy reading",call.=FALSE)
  }
  if(theme=="economie") for(i in seq_len(nrow(rows))) {
    populated <- vapply(seq_len(5L),function(rank) !is.na(rows[[paste0("top",rank,"_activity_code")]][[i]]),logical(1))
    if(any(diff(as.integer(populated))>0L)) stop("Canonical economy activity slots are not producer-ordered sparse ranks",call.=FALSE)
  }
  names(rows)[names(rows) == "territoire"] <- "territory_id"
  names(rows)[names(rows) == "type"] <- "territory_type"
  rows
}

# The canonical economy history already contains the producer-ranked top five.
# Normalize those populated slots without sorting or manufacturing zero rows.
project_economy_reading <- function(histories, vintages, metadata) {
  facts <- project_typed_reading_facts(histories, "economie")
  source_id <- metadata$sources$eco_activites
  subgroup_readings <- lapply(metadata$subgroups,function(group) group$reading$story_key)
  declared_groups <- vapply(metadata$subgroups,`[[`,character(1),"key")
  if(is.null(source_id) || length(source_id)!=1L || is.null(metadata$subgroups) ||
     any(!facts$groupe %in% declared_groups) || any(!facts$story_key %in% unlist(subgroup_readings,use.names=FALSE)))
    stop("Economy reading identities are not declared by producer theme metadata",call.=FALSE)
  for(i in seq_len(nrow(facts))) {
    selected <- metadata$subgroups[[match(facts$groupe[[i]],declared_groups)]]$reading
    if(is.null(selected) || !identical(facts$story_key[[i]],selected$story_key))
      stop("Economy selected reading disagrees with its producer subgroup declaration",call.=FALSE)
  }
  source <- vintages[vintages$id == source_id, , drop=FALSE]
  if (nrow(source) != 1L || anyNA(source[c("id", "source", "version")]) ||
      any(!nzchar(as.character(source$id))) || any(!nzchar(as.character(source$source))) ||
      any(!nzchar(as.character(source$version))) || length(source$id) != 1L)
    stop("Canonical vintage manifest has no unique economy source clock/identity", call.=FALSE)
  facts$status <- ifelse(is.na(facts$top1_activity_code), "unavailable", "measured")
  facts$source_id <- as.character(source$id[[1L]])
  # Keep the registered scalar vintage identity stable even when the manifest
  # has no reference date; NULL dates remain NULL in source_vintage.
  reference <- source$date_reference[[1L]]
  facts$vintage_id <- paste(as.character(source$version[[1L]]),
    if (is.na(reference)) "NA" else as.character(reference), sep="/")
  facts
}

economy_reading_content_version <- function(histories,vintages,metadata) {
  source_id <- metadata$sources$eco_activites
  source <- vintages[vintages$id==source_id,,drop=FALSE]
  if(nrow(source)!=1L) stop("Canonical vintage manifest has no unique economy source clock",call.=FALSE)
  scalar_content_version(list(facts=project_economy_reading(histories,vintages,metadata),source=source,metadata=metadata))
}

project_demographic_reading <- function(histories, territories, vintages, metadata) {
  facts <- project_typed_reading_facts(histories, "demographie")
  reference <- territories[c("territoire", "type")]
  names(reference) <- c("territory_id", "territory_type")
  if (anyDuplicated(reference) || anyDuplicated(facts[c("territory_id", "territory_type", "groupe")]))
    stop("Duplicate identity in demographic reading/reference projection", call.=FALSE)
  fact_territories <- unique(facts[c("territory_id","territory_type")])
  if (!setequal(paste(fact_territories$territory_id,fact_territories$territory_type),
                paste(reference$territory_id,reference$territory_type)))
    stop("Demographic reading identities must exactly match the canonical territory reference",call.=FALSE)
  source <- vintages[vintages$id == "serie_historique", , drop=FALSE]
  if (nrow(source) != 1L || anyNA(source[c("id", "source", "version", "date_reference", "date_publication")]))
    stop("The canonical vintage manifest has no unique demographic source clock", call.=FALSE)
  facts$status <- ifelse(is.na(facts$periode) | is.na(facts$solde_naturel) |
    is.na(facts$solde_migratoire) | is.na(facts$taux_solde_naturel) |
    is.na(facts$taux_solde_migratoire) | is.na(facts$classification), "unavailable", "measured")
  facts$source_id <- as.character(source$id[[1L]])
  facts$vintage_id <- as.character(source$id[[1L]])
  label <- metadata$param_labels$taux_solde_naturel
  unit <- sub("^.*\\(([^()]*)\\)$", "\\1", label)
  if (identical(unit,label) || !nzchar(unit)) stop("Theme metadata has no typed demographic rate unit",call.=FALSE)
  attr(facts,"rate_unit") <- unit
  facts
}

project_habitat_reading <- function(histories,vintages,metadata) {
  facts <- project_typed_reading_facts(histories,"habitat")
  source_key <- metadata$sources$part_passoires
  threshold <- metadata$scalar_contracts$part_passoires$suppressed_below
  if (is.null(source_key) || !nzchar(source_key)) stop("Habitat metadata has no DPE source",call.=FALSE)
  if (length(threshold) != 1L || !is.numeric(threshold) || is.na(threshold) || threshold < 0)
    stop("Habitat metadata has no valid DPE suppression threshold",call.=FALSE)
  vintage <- vintages[vintages[["id"]] == source_key,,drop=FALSE]
  if(nrow(vintage)!=1L || anyNA(vintage[c("id","source","version","date_publication")]))
    stop("Canonical vintage manifest has no unique Habitat DPE source clock",call.=FALSE)
  facts$source_id <- vintage[["id"]][[1L]]
  # Match the registered DPE profile's vintage coordinate. A NULL reference
  # date is source-owned and is represented as NA, never filled from elsewhere.
  facts$vintage_id <- paste(vintage[["version"]][[1L]],
    ifelse(is.na(vintage[["date_reference"]][[1L]]),"NA",as.character(vintage[["date_reference"]][[1L]])),sep="/")
  zero_support_status <- metadata$scalar_contracts$part_passoires$zero_support_status
  facts$status <- ifelse(!is.na(facts$n_dpe) & facts$n_dpe == 0,
    if(identical(zero_support_status,"not_available")) "unavailable" else zero_support_status,
    ifelse(!is.na(facts$n_dpe) & facts$n_dpe < threshold,"suppressed",
      ifelse(is.na(facts$classification)|is.na(facts$part_passoires)|is.na(facts$part_abc)|is.na(facts$n_dpe),"unavailable","measured")))
  attr(facts,"vintage") <- vintage
  facts
}

project_milieux_reading <- function(histories, vintages, metadata, canonical) {
  facts <- project_typed_reading_facts(histories, "milieux")
  if (any(!is.finite(facts$delta_population[!is.na(facts$delta_population)])) ||
      any(!is.finite(facts$taux_variation_population[!is.na(facts$taux_variation_population)])) ||
      any(!is.finite(facts$artif_m2_par_habitant[!is.na(facts$artif_m2_par_habitant)])) ||
      any(!is.finite(facts$artif_m3_par_habitant[!is.na(facts$artif_m3_par_habitant)])))
    stop("Canonical Milieux reading contains non-finite measurements", call.=FALSE)
  # Selected story labels/classification are producer metadata-owned. Build
  # source bindings from the same canonical OCS role/component projection as
  # the registered owned-series publisher; never infer M2/M3 from years.
  if (is.null(metadata$subgroups) || !length(metadata$subgroups) ||
      any(!facts$groupe %in% vapply(metadata$subgroups, `[[`, character(1), "key")) ||
      any(!facts$story_key %in% unlist(metadata$story_keys,use.names=FALSE)) ||
      any(!is.na(facts$classification) & !facts$classification %in% names(metadata$classification_labels)))
    stop("Milieux selected reading identities are not declared by producer metadata", call.=FALSE)
  facts$status <- ifelse(is.na(facts$classification) | is.na(facts$periode_pop) |
    is.na(facts$periode_artif), "unavailable", "measured")
  facts$source_id <- "serie_historique"
  population_vintage <- vintages[vintages$id == "serie_historique",,drop=FALSE]
  if(nrow(population_vintage)!=1L || anyNA(population_vintage[c("version","source")]))
    stop("Canonical population-history source vintage is missing or ambiguous",call.=FALSE)
  population_vintage_id <- paste(as.character(population_vintage$version[[1L]]),
    if(is.na(population_vintage$date_reference[[1L]])) "NA" else as.character(population_vintage$date_reference[[1L]]),sep="/")
  facts$vintage_id <- population_vintage_id
  facts$population_source_version <- as.character(population_vintage$version[[1L]])
  facts$population_source_reference_date <- population_vintage$date_reference[[1L]]
  facts$population_source_publication_date <- population_vintage$date_publication[[1L]]
  indicators <- canonical$indicateurs
  if (!is.data.frame(indicators)) stop("Canonical Milieux state observations are required",call.=FALSE)
  states <- project_artif_m2m3_projection(indicators,histories,vintages,metadata)
  state_points <- states$points
  state_links <- states$point_provenance
  binding_rows <- list()
  for(i in seq_len(nrow(facts))) {
    territory <- facts$territory_id[[i]]
    level <- facts$territory_type[[i]]
    for(role in c("M2","M3")) {
      point <- state_points[state_points$territory_id==territory & state_points$territory_type==level &
        state_points$state_role==role,,drop=FALSE]
      if(nrow(point)!=1L) stop("Canonical OCS-GE role is missing or ambiguous for selected reading ",level," ",territory," ",role,call.=FALSE)
      links <- state_links[state_links$territory_id==territory & state_links$axis_value==point$axis_value[[1L]],,drop=FALSE]
      if(!nrow(links)) stop("Canonical OCS-GE state role has no source-component association",call.=FALSE)
      for(link in seq_len(nrow(links))) {
        revision <- states$provenance[states$provenance$provenance_revision_id==links$provenance_revision_id[[link]],,drop=FALSE]
        if(nrow(revision)!=1L) stop("Canonical OCS-GE provenance revision is missing or ambiguous",call.=FALSE)
        binding_rows[[length(binding_rows)+1L]] <- data.frame(territory_id=territory,territory_type=level,
          groupe=facts$groupe[[i]],field_key=if(role=="M2") "artif_m2_par_habitant" else "artif_m3_par_habitant",
          source_id=revision$source_id[[1L]],vintage_id=revision$vintage_id[[1L]],source_name=revision$source_name[[1L]],
          source_version=revision$source_version[[1L]],reference_date=revision$reference_date[[1L]],
          publication_date=revision$publication_date[[1L]],dataset_id=states$dataset_id,
          dataset_content_version=scalar_content_version(states),state_role=role,
          observation_period=point$observation_period[[1L]],axis_value=point$axis_value[[1L]],provenance_revision_id=revision$provenance_revision_id[[1L]],
          stringsAsFactors=FALSE)
      }
    }
    binding_rows[[length(binding_rows)+1L]] <- data.frame(territory_id=territory,territory_type=level,
      groupe=facts$groupe[[i]],field_key="population",source_id="serie_historique",vintage_id=population_vintage_id,source_name=population_vintage$source[[1L]],
      source_version=population_vintage$version[[1L]],reference_date=population_vintage$date_reference[[1L]],
      publication_date=population_vintage$date_publication[[1L]],dataset_id=NA_character_,
      dataset_content_version=NA_character_,state_role=NA_character_,observation_period=facts$periode_pop[[i]],axis_value=NA_character_,
      provenance_revision_id=NA_character_,stringsAsFactors=FALSE)
  }
  attr(facts,"source_bindings") <- do.call(rbind,binding_rows)
  facts
}

register_typed_reading_publisher <- function(registry, name, project, publish) {
  if (!is.list(registry) || (length(registry) && is.null(names(registry))) || name %in% names(registry) ||
      !is.function(project) || !is.function(publish))
    stop("Invalid or duplicate typed-reading publisher registration", call.=FALSE)
  registry[[name]] <- list(project=project,publish=publish)
  registry
}

publish_registered_typed_reading <- function(registry, name, canonical, db) {
  publisher <- registry[[name]]
  if (is.null(publisher) || !is.function(publisher$project) || !is.function(publisher$publish))
    stop("Unregistered typed-reading publisher: ",name,call.=FALSE)
  projection <- publisher$project(canonical)
  publisher$publish(db,projection,canonical)
}

publish_demographic_reading <- function(con, projection, canonical) {
  rate_unit <- attr(projection,"rate_unit")
  if (is.null(rate_unit) || !nzchar(rate_unit)) stop("Typed reading projection has no source-owned rate unit",call.=FALSE)
  facts <- projection
  facts <- facts[c("territory_id","territory_type","groupe","story_key","salience_reason","periode",
    "solde_naturel","solde_migratoire","taux_solde_naturel","taux_solde_migratoire",
    "classification","status","source_id","vintage_id")]
  reference_version <- DBI::dbGetQuery(con,
    "SELECT content_version FROM table_publication WHERE table_name='territory_reference'")$content_version
  if (length(reference_version) != 1L || is.na(reference_version) || !nzchar(reference_version))
    stop("Published territory reference is required for demographic readings", call.=FALSE)
  registered_territories <- DBI::dbGetQuery(con,"SELECT territory_id,territory_type FROM territory_reference")
  fact_territories <- unique(facts[c("territory_id","territory_type")])
  if (!setequal(paste(fact_territories$territory_id,fact_territories$territory_type),
      paste(registered_territories$territory_id,registered_territories$territory_type)))
    stop("Demographic reading territory identities do not match the registered territory reference",call.=FALSE)
  version <- canonical$content_version
  unchanged <- FALSE
  DBI::dbWithTransaction(con, {
    marker <- DBI::dbGetQuery(con,"SELECT p.content_version,p.row_count,p.reference_content_version,
      d.descriptor_version,d.source_id,d.vintage_id,d.rate_unit FROM table_publication p
      JOIN demographic_reading_descriptor d ON d.singleton WHERE p.table_name='demographic_typed_reading'")
    if(nrow(marker)==1L && identical(as.character(marker$content_version[[1L]]),version) &&
       marker$row_count[[1L]]==nrow(facts) && identical(as.character(marker$reference_content_version[[1L]]),as.character(reference_version[[1L]])) &&
       identical(as.character(marker$descriptor_version[[1L]]),version) &&
       identical(as.character(marker$source_id[[1L]]),as.character(facts$source_id[[1L]])) &&
       identical(as.character(marker$vintage_id[[1L]]),as.character(facts$vintage_id[[1L]])) &&
       identical(as.character(marker$rate_unit[[1L]]),rate_unit)) {
      unchanged <- TRUE
    } else {
      DBI::dbExecute(con,"DELETE FROM demographic_typed_reading")
      DBI::dbWriteTable(con,"demographic_typed_reading",facts,append=TRUE,row.names=FALSE)
      DBI::dbExecute(con, "INSERT INTO demographic_reading_descriptor(singleton,descriptor_version,source_id,vintage_id,rate_unit)
        VALUES(true,$1,$2,$3,$4) ON CONFLICT(singleton) DO UPDATE SET descriptor_version=EXCLUDED.descriptor_version,
        source_id=EXCLUDED.source_id,vintage_id=EXCLUDED.vintage_id,rate_unit=EXCLUDED.rate_unit",
        params=list(version, facts$source_id[[1L]], facts$vintage_id[[1L]],rate_unit))
      DBI::dbExecute(con, "INSERT INTO table_publication(table_name,content_version,row_count,reference_content_version,published_at)
        VALUES('demographic_typed_reading',$1,$2,$3,now()) ON CONFLICT(table_name) DO UPDATE SET
        content_version=EXCLUDED.content_version,row_count=EXCLUDED.row_count,
        reference_content_version=EXCLUDED.reference_content_version,published_at=EXCLUDED.published_at",
        params=list(version,nrow(facts),reference_version[[1L]]))
    }
  })
  invisible(list(content_version=version,row_count=nrow(facts),changed=!unchanged))
}

publish_selected_reading_family <- function(con, facts, canonical, theme) {
  vintage <- attr(facts,"vintage"); reference_version <- DBI::dbGetQuery(con,
    "SELECT content_version FROM table_publication WHERE table_name='territory_reference'")$content_version
  if(length(reference_version)!=1L || is.na(reference_version) || !nzchar(reference_version))
    stop("Published territory reference is required for selected readings",call.=FALSE)
  if (theme != "habitat") stop("Unsupported selected-reading family",call.=FALSE)
  dependency <- DBI::dbGetQuery(con,"SELECT p.content_version,p.reference_content_version,
    s.content_version AS scalar_version,d.required_scalar_version,d.allowed_levels,t.content_version AS reference_version,
    s.reference_content_version AS scalar_reference_version
    FROM table_publication p JOIN profile_descriptor d ON d.indicator_id='distribution_dpe'
    JOIN table_publication s ON s.table_name='scalar_observation'
    JOIN table_publication t ON t.table_name='territory_reference'
    WHERE p.table_name='declared_profile'")
  if (nrow(dependency)!=1L || is.na(dependency$reference_content_version[[1L]]) ||
      !identical(as.character(dependency$required_scalar_version[[1L]]),as.character(dependency$scalar_version[[1L]])) ||
      !identical(as.character(dependency$reference_content_version[[1L]]),as.character(dependency$reference_version[[1L]])) ||
      !identical(as.character(dependency$scalar_reference_version[[1L]]),as.character(dependency$reference_version[[1L]])))
    stop("Habitat readings require compatible registered scalar and DPE profile publications",call.=FALSE)
  profile_bound <- DBI::dbGetQuery(con,"SELECT DISTINCT os.territory_id,tr.territory_type,os.source_id,os.vintage_id
    FROM profile_observation_source os JOIN territory_reference tr USING(territory_id)
    WHERE os.indicator_id='distribution_dpe'")
  scalar_bound <- DBI::dbGetQuery(con,"SELECT DISTINCT os.territory_id,so.territory_type,os.source_id,os.vintage_id
    FROM scalar_observation_source os JOIN scalar_observation so USING(indicator_id,territory_id)
    WHERE os.indicator_id='part_passoires'")
  binding_key <- function(rows) sort(unique(paste(rows$territory_id,rows$territory_type,rows$source_id,rows$vintage_id,sep="\r")))
  # Compare every source association where the registered DPE profile has a
  # supported territory. Outside those registered levels, Habitat uses the
  # scalar binding only (the descriptor, not a territory literal, defines this).
  profile_levels <- strsplit(gsub("[{}]","",as.character(dependency$allowed_levels[[1L]])),",",fixed=TRUE)[[1L]]
  scalar_profile_levels <- scalar_bound[scalar_bound$territory_type %in% profile_levels,,drop=FALSE]
  if (!nrow(profile_bound) || !nrow(scalar_bound) || !identical(binding_key(profile_bound),binding_key(scalar_profile_levels)))
    stop("Registered DPE profile and scalar source/vintage associations disagree (profile-only: ",
      paste(head(setdiff(binding_key(profile_bound),binding_key(scalar_bound)),3L),collapse="; "),
      "; scalar-only: ",paste(head(setdiff(binding_key(scalar_profile_levels),binding_key(profile_bound)),3L),collapse="; "),")",call.=FALSE)
  bound <- scalar_bound
  scalar_facts <- DBI::dbGetQuery(con,"SELECT territory_id,value,status,support_count FROM scalar_observation
    WHERE indicator_id='part_passoires'")
  for (i in seq_len(nrow(facts))) {
    matches <- bound[bound$territory_id==facts$territory_id[[i]] & bound$territory_type==facts$territory_type[[i]],,drop=FALSE]
    if (nrow(matches)!=1L) stop("DPE profile source binding is missing or ambiguous for Habitat reading: ",
      facts$territory_type[[i]]," ",facts$territory_id[[i]]," (",nrow(matches)," matches)",call.=FALSE)
    facts$source_id[[i]] <- matches$source_id[[1L]]
    facts$vintage_id[[i]] <- matches$vintage_id[[1L]]
    scalar_fact <- scalar_facts[scalar_facts$territory_id==facts$territory_id[[i]],,drop=FALSE]
    if(nrow(scalar_fact)!=1L) stop("Registered DPE scalar fact is missing or ambiguous for Habitat reading",call.=FALSE)
    expected_status <- switch(as.character(scalar_fact$status[[1L]]),measured="measured",suppressed="suppressed",
      not_available="unavailable",unsupported="unavailable",NA_character_)
    same_value <- (is.na(scalar_fact$value[[1L]]) && is.na(facts$part_passoires[[i]])) ||
      (!is.na(scalar_fact$value[[1L]]) && !is.na(facts$part_passoires[[i]]) &&
        isTRUE(all.equal(as.numeric(scalar_fact$value[[1L]]),as.numeric(facts$part_passoires[[i]]),tolerance=1e-10)))
    same_support <- (is.na(scalar_fact$support_count[[1L]]) && is.na(facts$n_dpe[[i]])) ||
      (!is.na(scalar_fact$support_count[[1L]]) && !is.na(facts$n_dpe[[i]]) &&
        as.numeric(scalar_fact$support_count[[1L]])==as.numeric(facts$n_dpe[[i]]))
    if(is.na(expected_status) || !identical(facts$status[[i]],expected_status) || !same_value || !same_support)
      stop("Habitat reading value/status/support disagrees with registered DPE scalar at ",facts$territory_type[[i]],
        " ",facts$territory_id[[i]]," (reading ",facts$status[[i]],"/",facts$part_passoires[[i]],"/",facts$n_dpe[[i]],
        "; scalar ",scalar_fact$status[[1L]],"/",scalar_fact$value[[1L]],"/",scalar_fact$support_count[[1L]],")",call.=FALSE)
  }
  expected_vintage_id <- paste(vintage[["version"]][[1L]],
    ifelse(is.na(vintage[["date_reference"]][[1L]]),"NA",as.character(vintage[["date_reference"]][[1L]])),sep="/")
  source_pairs <- unique(bound[c("source_id","vintage_id")])
  if (nrow(source_pairs)!=1L || !identical(as.character(source_pairs$source_id[[1L]]),as.character(vintage[["id"]][[1L]])) ||
      !identical(as.character(source_pairs$vintage_id[[1L]]),as.character(expected_vintage_id)))
    stop("The registered DPE binding is not the producer-declared single source clock",call.=FALSE)
  version <- canonical$content_version; count <- nrow(facts)
  linked_version <- paste(canonical$linked_content_version,dependency$content_version[[1L]],
    dependency$scalar_version[[1L]],dependency$reference_content_version[[1L]],sep="-")
  target <- "habitat_typed_reading"
  marker <- DBI::dbGetQuery(con,"SELECT p.content_version,p.row_count,p.reference_content_version,
    d.descriptor_version,d.source_id,d.vintage_id,d.linked_content_version FROM selected_reading_publication p
    JOIN selected_reading_descriptor d USING(theme_id) WHERE p.theme_id=$1",params=list(theme))
  if(nrow(marker)==1L && identical(as.character(marker$content_version[[1L]]),version) &&
     marker$row_count[[1L]]==count && identical(as.character(marker$reference_content_version[[1L]]),as.character(reference_version[[1L]])) &&
     identical(as.character(marker$descriptor_version[[1L]]),version) &&
     identical(as.character(marker$source_id[[1L]]),as.character(vintage$id[[1L]])) &&
     identical(as.character(marker$vintage_id[[1L]]),as.character(facts$vintage_id[[1L]])) &&
     identical(as.character(marker$linked_content_version[[1L]]),as.character(linked_version))) {
      generic_marker <- DBI::dbGetQuery(con,"SELECT content_version,row_count,reference_content_version
        FROM table_publication WHERE table_name='selected_reading'")
      if(nrow(generic_marker)==1L && identical(as.character(generic_marker$content_version[[1L]]),version) &&
         generic_marker$row_count[[1L]]==count &&
         identical(as.character(generic_marker$reference_content_version[[1L]]),as.character(reference_version[[1L]])))
        return(invisible(list(content_version=version,row_count=count,changed=FALSE)))
  }
  DBI::dbWithTransaction(con, {
    DBI::dbExecute(con,paste("DELETE FROM",target))
    if(theme=="habitat") {
     facts <- facts[c("territory_id","territory_type","groupe","story_key","salience_reason","classification",
        "part_passoires","part_abc","n_dpe","status","source_id","vintage_id")]
      DBI::dbWriteTable(con,target,facts,append=TRUE,row.names=FALSE)
    }
    inserted_count <- DBI::dbGetQuery(con,paste0("SELECT count(*) AS row_count FROM ",target))$row_count[[1L]]
    if (!identical(as.integer(inserted_count),as.integer(count)))
      stop("Selected-reading inserted row count does not match its projection",call.=FALSE)
    DBI::dbExecute(con,"INSERT INTO selected_reading_descriptor(theme_id,descriptor_version,source_id,vintage_id,linked_content_version)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT(theme_id) DO UPDATE SET descriptor_version=EXCLUDED.descriptor_version,
      source_id=EXCLUDED.source_id,vintage_id=EXCLUDED.vintage_id,linked_content_version=EXCLUDED.linked_content_version",
      params=list(theme,version,vintage[["id"]][[1L]],facts$vintage_id[[1L]],linked_version))
    DBI::dbExecute(con,"INSERT INTO selected_reading_publication(theme_id,content_version,reference_content_version,row_count,published_at)
      VALUES($1,$2,$3,$4,now()) ON CONFLICT(theme_id) DO UPDATE SET content_version=EXCLUDED.content_version,
      reference_content_version=EXCLUDED.reference_content_version,row_count=EXCLUDED.row_count,published_at=now()",
      params=list(theme,version,reference_version[[1L]],count))
    DBI::dbExecute(con,"INSERT INTO table_publication(table_name,content_version,row_count,reference_content_version,published_at)
      VALUES('selected_reading',$1,$2,$3,now()) ON CONFLICT(table_name) DO UPDATE SET
      content_version=EXCLUDED.content_version,row_count=EXCLUDED.row_count,
      reference_content_version=EXCLUDED.reference_content_version,published_at=EXCLUDED.published_at",
      params=list(version,count,reference_version[[1L]]))
  })
  invisible(list(content_version=version,row_count=count,changed=TRUE))
}

register_habitat_reading_publisher <- function(registry) {
  register_typed_reading_publisher(registry,"habitat",
    function(input) project_habitat_reading(input$histories,input$vintages,input$metadata),
    function(db,projection,input) publish_selected_reading_family(db,projection,input,"habitat"))
}

register_economy_reading_publisher <- function(registry) {
  register_typed_reading_publisher(registry,"economie",
    function(input) project_economy_reading(input$histories,input$vintages,input$metadata),
    function(db,projection,input) publish_economy_reading_family(db,projection,input))
}

register_milieux_reading_publisher <- function(registry) {
  register_typed_reading_publisher(registry,"milieux",
    function(input) project_milieux_reading(input$histories,input$vintages,input$metadata,canonical=input),
    function(db,projection,input) publish_milieux_reading(db,projection,input))
}

# Production publication path: reuse the registered OCS-GE dataset publisher,
# then publish the reading against that exact owned-series marker and canonical
# population vintage. The history/window/measurement values still come only
# from the canonical Parquets.
publish_canonical_milieux_reading <- function(con, sortie="../public/data") {
  history_path <- file.path(sortie,"histoires_milieux.parquet")
  indicator_path <- file.path(sortie,"indicateurs_milieux.parquet")
  vintage_path <- file.path(sortie,"vintages.parquet")
  if(any(!file.exists(c(history_path,indicator_path,vintage_path))))
    stop("Canonical Milieux history, indicator, and vintage artifacts are required",call.=FALSE)
  histories <- nanoparquet::read_parquet(history_path)
  canonical <- list(histories=histories,histoires=histories,
    indicateurs=nanoparquet::read_parquet(indicator_path),vintages=nanoparquet::read_parquet(vintage_path),
    metadata=lire_theme_metadata("milieux"))
  population <- canonical$vintages[canonical$vintages$id=="serie_historique",,drop=FALSE]
  if(nrow(population)!=1L || anyNA(population[c("source","version")]))
    stop("Canonical Milieux population-history source clock is missing or ambiguous",call.=FALSE)
  vintage_id <- paste(as.character(population$version[[1L]]),
    if(is.na(population$date_reference[[1L]])) "NA" else as.character(population$date_reference[[1L]]),sep="/")
  DBI::dbExecute(con,"INSERT INTO source_dataset(source_id,name) VALUES($1,$2) ON CONFLICT(source_id) DO UPDATE SET name=EXCLUDED.name",
    params=list(population$id[[1L]],population$source[[1L]]))
  DBI::dbExecute(con,"INSERT INTO source_vintage(source_id,vintage_id,version,reference_date,publication_date) VALUES($1,$2,$3,$4,$5) ON CONFLICT(source_id,vintage_id) DO UPDATE SET version=EXCLUDED.version,reference_date=EXCLUDED.reference_date,publication_date=EXCLUDED.publication_date",
    params=list(population$id[[1L]],vintage_id,population$version[[1L]],population$date_reference[[1L]],population$date_publication[[1L]]))
  series_registry <- register_artif_m2m3_owned_publisher(list(),canonical$metadata)
  series_result <- publish_registered_series(series_registry,"artif_par_habitant_owned",canonical,
    owned_series_postgres_adapter(con))
  reading_result <- publish_registered_typed_reading(register_milieux_reading_publisher(list()),"milieux",canonical,con)
  list(owned_series=series_result,reading=reading_result)
}

publish_milieux_reading <- function(con, facts, canonical) {
  bindings <- attr(facts,"source_bindings")
  binding_fields <- c("territory_id","territory_type","groupe","field_key","source_id","vintage_id","source_name","source_version",
    "reference_date","publication_date","observation_period","dataset_id","dataset_content_version","state_role","axis_value","provenance_revision_id")
  if (!is.data.frame(bindings) || !all(binding_fields %in% names(bindings)))
    stop("Canonical Milieux producer projection did not supply source/window bindings",call.=FALSE)
  reference <- DBI::dbGetQuery(con,"SELECT content_version FROM table_publication WHERE table_name='territory_reference'")$content_version
  if(length(reference)!=1L || is.na(reference) || !nzchar(reference)) stop("Published territory reference is required for Milieux readings",call.=FALSE)
  identity <- c("territory_id","territory_type","groupe","field_key","source_id","vintage_id")
  if(anyDuplicated(bindings[identity]) || any(!paste(bindings$territory_id,bindings$territory_type,bindings$groupe) %in%
      paste(facts$territory_id,facts$territory_type,facts$groupe))) stop("Milieux source bindings are duplicate or outside selected readings",call.=FALSE)
  source_rows <- DBI::dbGetQuery(con,"SELECT source_id,vintage_id,version,reference_date,publication_date FROM source_vintage")
  for(i in which(bindings$field_key=="population")) {
    match <- source_rows[source_rows$source_id==bindings$source_id[[i]] & source_rows$vintage_id==bindings$vintage_id[[i]],,drop=FALSE]
    same_date <- function(actual,expected) (is.na(actual) && is.na(expected)) ||
      (!is.na(actual) && !is.na(expected) && as.character(actual)==as.character(expected))
    if(nrow(match)!=1L || as.character(match$version[[1L]])!=as.character(bindings$source_version[[i]]) ||
       !same_date(match$reference_date[[1L]],bindings$reference_date[[i]]) ||
       !same_date(match$publication_date[[1L]],bindings$publication_date[[i]]))
      stop("Milieux reading source/window binding differs from registered source vintage: ",bindings$source_id[[i]],call.=FALSE)
  }
  for(i in which(bindings$field_key!="population")) {
    revision <- DBI::dbGetQuery(con,"SELECT source_id,vintage_id,source_name,source_version,reference_date,publication_date FROM series_provenance_revision WHERE provenance_revision_id=$1",
      params=list(bindings$provenance_revision_id[[i]]))
    if(nrow(revision)!=1L || !identical(as.character(revision$source_id[[1L]]),as.character(bindings$source_id[[i]])) ||
       !identical(as.character(revision$vintage_id[[1L]]),as.character(bindings$vintage_id[[i]])) ||
       !identical(as.character(revision$source_version[[1L]]),as.character(bindings$source_version[[i]])) ||
       !identical(as.character(revision$source_name[[1L]]),as.character(bindings$source_name[[i]])))
      stop("Milieux OCS-GE binding differs from immutable registered series provenance",call.=FALSE)
    observation <- DBI::dbGetQuery(con,"SELECT state_role,observation_period,status,value FROM series_dataset_observation WHERE dataset_id=$1 AND indicator_id='artif_par_habitant' AND territory_id=$2 AND territory_type=$3 AND axis_value=$4",
      params=list(bindings$dataset_id[[i]],bindings$territory_id[[i]],bindings$territory_type[[i]],bindings$axis_value[[i]]))
    linked <- DBI::dbGetQuery(con,"SELECT 1 FROM series_observation_provenance WHERE dataset_id=$1 AND indicator_id='artif_par_habitant' AND territory_id=$2 AND axis_value=$3 AND provenance_revision_id=$4",
      params=list(bindings$dataset_id[[i]],bindings$territory_id[[i]],bindings$axis_value[[i]],bindings$provenance_revision_id[[i]]))
    expected_value <- facts[[if(bindings$field_key[[i]]=="artif_m2_par_habitant") "artif_m2_par_habitant" else "artif_m3_par_habitant"]][match(paste(bindings$territory_id[[i]],bindings$territory_type[[i]],bindings$groupe[[i]]),paste(facts$territory_id,facts$territory_type,facts$groupe))]
    if(nrow(observation)!=1L || nrow(linked)!=1L || !identical(as.character(observation$state_role[[1L]]),as.character(bindings$state_role[[i]])) ||
       !identical(as.character(observation$observation_period[[1L]]),as.character(bindings$observation_period[[i]])) ||
       !((is.na(observation$value[[1L]]) && is.na(expected_value)) || (!is.na(observation$value[[1L]]) && !is.na(expected_value) && isTRUE(all.equal(as.numeric(observation$value[[1L]]),as.numeric(expected_value),tolerance=1e-10)))))
      stop("Milieux selected reading does not match its registered OCS-GE role/value/window association",call.=FALSE)
  }
  for(dataset in unique(na.omit(bindings$dataset_id))) {
    marker <- DBI::dbGetQuery(con,"SELECT content_version,reference_content_version FROM series_dataset_publication WHERE dataset_id=$1",params=list(dataset))
    expected <- unique(bindings$dataset_content_version[bindings$dataset_id %in% dataset])
    if(nrow(marker)!=1L || length(expected)!=1L || !identical(as.character(marker$content_version[[1L]]),as.character(expected)) ||
       !identical(as.character(marker$reference_content_version[[1L]]),as.character(reference[[1L]])))
      stop("Milieux reading requires matching OCS-GE tokens for ",dataset," (marker rows=",nrow(marker),
        "; expected=",paste(expected,collapse=","),"; published=",if(nrow(marker)) marker$content_version[[1L]] else "<missing>",
        "; expected reference=",reference[[1L]],"; published reference=",if(nrow(marker)) marker$reference_content_version[[1L]] else "<missing>",")",call.=FALSE)
  }
  version <- scalar_content_version(list(facts=facts,source_bindings=bindings))
  expected_count <- nrow(facts); expected_sources <- nrow(bindings); unchanged <- FALSE
  DBI::dbWithTransaction(con, {
    marker <- DBI::dbGetQuery(con,"SELECT content_version,row_count,reference_content_version FROM table_publication WHERE table_name='milieux_typed_reading'")
    source_count <- DBI::dbGetQuery(con,"SELECT count(*) n FROM milieux_reading_source")$n[[1L]]
    if(nrow(marker)==1L && identical(as.character(marker$content_version[[1L]]),version) && marker$row_count[[1L]]==expected_count &&
       identical(as.character(marker$reference_content_version[[1L]]),as.character(reference[[1L]])) && source_count==expected_sources) unchanged <- TRUE
    if(!unchanged) {
      DBI::dbExecute(con,"DELETE FROM milieux_typed_reading")
      persisted <- facts[c("territory_id","territory_type","groupe","story_key","salience_reason","periode_pop","periode_artif","delta_population","taux_variation_population","artif_m2_par_habitant","artif_m3_par_habitant","trajectoire_artif_par_habitant","classification","status","source_id","vintage_id")]
      DBI::dbWriteTable(con,"milieux_typed_reading",persisted,append=TRUE,row.names=FALSE)
      DBI::dbWriteTable(con,"milieux_reading_source",bindings[binding_fields],append=TRUE,row.names=FALSE)
      inserted <- DBI::dbGetQuery(con,"SELECT count(*) n FROM milieux_typed_reading")$n[[1L]]
      inserted_sources <- DBI::dbGetQuery(con,"SELECT count(*) n FROM milieux_reading_source")$n[[1L]]
      if(inserted!=expected_count || inserted_sources!=expected_sources) stop("Milieux reading inserted fact/source counts do not match projection",call.=FALSE)
      DBI::dbExecute(con,"INSERT INTO table_publication(table_name,content_version,row_count,reference_content_version,published_at) VALUES('milieux_typed_reading',$1,$2,$3,now()) ON CONFLICT(table_name) DO UPDATE SET content_version=EXCLUDED.content_version,row_count=EXCLUDED.row_count,reference_content_version=EXCLUDED.reference_content_version,published_at=now()",params=list(version,inserted,reference[[1L]]))
    }
  })
  invisible(list(content_version=version,row_count=expected_count,source_row_count=expected_sources,changed=!unchanged))
}

publish_economy_reading_family <- function(con, facts, canonical) {
  reference_version <- DBI::dbGetQuery(con,"SELECT content_version FROM table_publication WHERE table_name='territory_reference'")$content_version
  if(length(reference_version)!=1L || is.na(reference_version) || !nzchar(reference_version))
    stop("Published territory reference is required for economy readings",call.=FALSE)
  registered <- DBI::dbGetQuery(con,"SELECT territory_id,territory_type FROM territory_reference")
  fact_territories <- unique(facts[c("territory_id","territory_type")])
  if(any(!paste(fact_territories$territory_id,fact_territories$territory_type) %in% paste(registered$territory_id,registered$territory_type)))
    stop("Economy reading contains a territory absent from the registered territory reference",call.=FALSE)
  version <- canonical$content_version
  expected_count <- nrow(facts)
  unchanged <- FALSE
  DBI::dbWithTransaction(con, {
    marker <- DBI::dbGetQuery(con,"SELECT p.content_version,p.row_count,p.reference_content_version,e.content_version AS evidence_version,e.row_count AS evidence_count,e.reference_content_version AS evidence_reference FROM table_publication p LEFT JOIN table_publication e ON e.table_name='economy_activity_evidence' WHERE p.table_name='economy_typed_reading'")
    if(nrow(marker)==1L && identical(as.character(marker$content_version[[1L]]),version) && marker$row_count[[1L]]==expected_count &&
       identical(as.character(marker$reference_content_version[[1L]]),as.character(reference_version[[1L]])) &&
       identical(as.character(marker$evidence_version[[1L]]),version) &&
       identical(as.integer(marker$evidence_count[[1L]]),as.integer(DBI::dbGetQuery(con,"SELECT count(*) AS n FROM economy_activity_evidence")$n[[1L]])) &&
       identical(as.character(marker$evidence_reference[[1L]]),as.character(reference_version[[1L]]))) unchanged <- TRUE
    if (!unchanged) {
    DBI::dbExecute(con,"DELETE FROM economy_activity_evidence")
    DBI::dbExecute(con,"DELETE FROM economy_typed_reading")
    DBI::dbWriteTable(con,"economy_typed_reading",facts[c("territory_id","territory_type","groupe","story_key","salience_reason","status","source_id","vintage_id")],append=TRUE,row.names=FALSE)
    evidence <- do.call(rbind,lapply(seq_len(5L),function(rank) {
      code <- facts[[paste0("top",rank,"_activity_code")]]
      keep <- !is.na(code)
    data.frame(territory_id=facts$territory_id[keep],territory_type=facts$territory_type[keep],groupe=facts$groupe[keep],
        rank=rank,activity_code=code[keep],activity_label=facts[[paste0("top",rank,"_activity_label")]][keep],
        lq=facts[[paste0("top",rank,"_lq")]][keep],establishment_count=facts[[paste0("top",rank,"_n")]][keep],
        park_share=facts[[paste0("top",rank,"_part_parc")]][keep],source_id=facts$source_id[keep],vintage_id=facts$vintage_id[keep],stringsAsFactors=FALSE)
    }))
    DBI::dbWriteTable(con,"economy_activity_evidence",evidence,append=TRUE,row.names=FALSE)
    count <- DBI::dbGetQuery(con,"SELECT count(*) AS n FROM economy_typed_reading")$n[[1L]]
    evidence_count <- DBI::dbGetQuery(con,"SELECT count(*) AS n FROM economy_activity_evidence")$n[[1L]]
    if(count != expected_count || evidence_count != nrow(evidence)) stop("Economy reading publication row counts do not match",call.=FALSE)
    DBI::dbExecute(con,"INSERT INTO table_publication(table_name,content_version,row_count,reference_content_version,published_at) VALUES('economy_typed_reading',$1,$2,$3,now()) ON CONFLICT(table_name) DO UPDATE SET content_version=EXCLUDED.content_version,row_count=EXCLUDED.row_count,reference_content_version=EXCLUDED.reference_content_version,published_at=EXCLUDED.published_at",params=list(version,count,reference_version[[1L]]))
    DBI::dbExecute(con,"INSERT INTO table_publication(table_name,content_version,row_count,reference_content_version,published_at) VALUES('economy_activity_evidence',$1,$2,$3,now()) ON CONFLICT(table_name) DO UPDATE SET content_version=EXCLUDED.content_version,row_count=EXCLUDED.row_count,reference_content_version=EXCLUDED.reference_content_version,published_at=EXCLUDED.published_at",params=list(version,evidence_count,reference_version[[1L]]))
    }
  })
  invisible(list(content_version=version,row_count=expected_count,changed=!unchanged))
}
