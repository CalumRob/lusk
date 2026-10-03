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
      unlist(lapply(seq_len(5), function(i) paste0("top", i, c("_activity_code", "_activity_label", "_lq", "_n", "_part_parc"))), use.names=FALSE)),
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
  names(rows)[names(rows) == "territoire"] <- "territory_id"
  names(rows)[names(rows) == "type"] <- "territory_type"
  rows
}

project_demographic_reading <- function(histories, territories, vintages, metadata) {
  facts <- project_typed_reading_facts(histories, "demographie")
  reference <- territories[c("territoire", "type")]
  names(reference) <- c("territory_id", "territory_type")
  if (anyDuplicated(reference) || anyDuplicated(facts[c("territory_id", "territory_type", "groupe")]))
    stop("Duplicate identity in demographic reading/reference projection", call.=FALSE)
  if (any(!paste(facts$territory_id, facts$territory_type) %in%
          paste(reference$territory_id, reference$territory_type)))
    stop("Demographic reading identity is absent from the canonical territory reference", call.=FALSE)
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
  if (nrow(facts) != 1268L) stop("Unexpected canonical demographic reading row count", call.=FALSE)
  reference_version <- DBI::dbGetQuery(con,
    "SELECT content_version FROM table_publication WHERE table_name='territory_reference'")$content_version
  if (length(reference_version) != 1L || is.na(reference_version) || !nzchar(reference_version))
    stop("Published territory reference is required for demographic readings", call.=FALSE)
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
