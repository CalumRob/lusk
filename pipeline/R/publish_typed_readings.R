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
  if (nrow(source) != 1L || anyNA(source[c("id", "source", "version", "date_reference", "date_publication")]))
    stop("Canonical vintage manifest has no unique economy source clock", call.=FALSE)
  facts$status <- ifelse(is.na(facts$top1_activity_code), "unavailable", "measured")
  facts$source_id <- as.character(source$id[[1L]])
  facts$vintage_id <- paste(as.character(source$version[[1L]]),
    ifelse(is.na(source$date_reference[[1L]]),"NA",as.character(source$date_reference[[1L]])),sep="/")
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
