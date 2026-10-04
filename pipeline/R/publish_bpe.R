# Constrained publisher for the bounded BPE class evidence used by the fiche.
# R remains the authority for the classifier and chooses the exemplar; this
# adapter only verifies and publishes the already projected canonical rows.
BPE_EVIDENCE_TABLE <- "bpe_profile_evidence"

project_bpe_profile_evidence <- function(projection, registry_path,
                                         vintages, universe_membership) {
  if (!is.data.frame(projection) ||
      !all(c("territoire", "type", "profil", "profil_libelle", "nombre_typequ",
             "exemplar_typequ", "exemplar_libelle", "exemplar_c", "exemplar_b",
             "exemplar_t") %in% names(projection))) {
    stop("BPE evidence projection is missing canonical columns", call.=FALSE)
  }
  registry <- lire_correspondances_typequ(registry_path)
  codes <- as.character(registry$TYPEQU)
  registry_labels <- stats::setNames(as.character(registry$Libelle_TYPEQU),codes)
  if (anyDuplicated(codes) || !length(codes)) stop("Invalid TYPEQU universe", call.=FALSE)
  if (!is.data.frame(universe_membership) ||
      !all(c("territoire", "type", "typequ") %in% names(universe_membership)) ||
      anyDuplicated(universe_membership[c("territoire", "type", "typequ")]) ||
      anyNA(universe_membership[c("territoire", "type", "typequ")]) ||
      any(!nzchar(as.character(universe_membership$territoire))) ||
      any(!as.character(universe_membership$type) %in%
          c("commune", "epci", "departement", "region")) ||
      any(!as.character(universe_membership$typequ) %in% codes))
    stop("BPE source TYPEQU membership is missing, duplicated or unknown", call.=FALSE)
  vintage <- vintages[as.character(vintages$id) == "mobilite_snapshot", , drop=FALSE]
  if (nrow(vintage) != 1L) stop("Canonical mobilite_snapshot vintage is required", call.=FALSE)
  if (any(!as.character(projection$profil) %in% names(PROFILS_ACCES_BPE)) ||
      any(as.character(projection$profil_libelle) !=
          unname(PROFILS_ACCES_BPE[as.character(projection$profil)]))) {
    stop("BPE projection contains an unknown class or class label", call.=FALSE)
  }
  if (anyDuplicated(projection[c("territoire", "type", "profil")]) ||
      any(!as.character(projection$type) %in%
          c("commune", "epci", "departement", "region")) ||
      any(!is.finite(projection$nombre_typequ) | projection$nombre_typequ < 0)) {
    stop("BPE projection has invalid keys, levels or counts", call.=FALSE)
  }
  groups <- split(projection, paste(projection$type, projection$territoire, sep="\r"))
  projected_groups <- unique(paste(projection$type, projection$territoire, sep="\r"))
  membership_groups <- unique(paste(universe_membership$type, universe_membership$territoire, sep="\r"))
  if (!setequal(projected_groups, membership_groups))
    stop("BPE projected territories differ from source TYPEQU membership", call.=FALSE)
  complete <- lapply(groups, function(g) {
    members <- universe_membership[
      as.character(universe_membership$type) == as.character(g$type[[1L]]) &
        as.character(universe_membership$territoire) == as.character(g$territoire[[1L]]), , drop=FALSE]
    if (nrow(members) != length(codes) || !setequal(as.character(members$typequ), codes))
      stop("BPE source TYPEQU membership does not match the registered universe", call.=FALSE)
    if (sum(g$nombre_typequ) != length(codes))
      stop("BPE class counts do not cover the registered TYPEQU universe", call.=FALSE)
    missing <- setdiff(names(PROFILS_ACCES_BPE), as.character(g$profil))
    if (length(missing)) {
      g <- rbind(g, data.frame(
        territoire=as.character(g$territoire[[1L]]), type=as.character(g$type[[1L]]),
        profil=missing, profil_libelle=unname(PROFILS_ACCES_BPE[missing]),
        nombre_typequ=0L, exemplar_typequ=NA_character_, exemplar_libelle=NA_character_,
        exemplar_c=NA_real_, exemplar_b=NA_real_, exemplar_t=NA_real_,
        stringsAsFactors=FALSE
      ))
    }
    if (!setequal(as.character(g$profil), names(PROFILS_ACCES_BPE)))
      stop("BPE profile axis is not closed", call.=FALSE)
    g$univers_typequ_count <- length(codes)
    g
  })
  facts <- do.call(rbind, complete)
  if (any((facts$nombre_typequ == 0L) != is.na(facts$exemplar_typequ)))
    stop("Zero BPE class counts may not carry exemplars", call.=FALSE)
  if (any(facts$nombre_typequ > 0L &
          (!facts$exemplar_typequ %in% codes | is.na(facts$exemplar_libelle) |
           !is.finite(facts$exemplar_c) | !is.finite(facts$exemplar_b) |
           !is.finite(facts$exemplar_t))))
    stop("Nonzero BPE classes require a valid producer-selected exemplar", call.=FALSE)
  has_exemplar <- facts$nombre_typequ > 0L
  if (any(has_exemplar & facts$exemplar_libelle != unname(registry_labels[facts$exemplar_typequ])))
    stop("BPE exemplar labels differ from the registered TYPEQU labels",call.=FALSE)
  if (any(vapply(facts[c("exemplar_c", "exemplar_b", "exemplar_t")],
                 function(x) any(!is.na(x) & (x < 0 | x > 1)), logical(1))))
    stop("BPE exemplar access shares are outside [0,1]", call.=FALSE)
  registry_bytes <- readBin(registry_path, "raw", n=file.info(registry_path)$size)
  registry_hash <- paste(as.character(openssl::sha256(registry_bytes)), collapse="")
  source <- data.frame(source_id="mobilite_snapshot",
    source_name=as.character(vintage$source[[1L]]), vintage_id=as.character(vintage$version[[1L]]),
    reference_date=as.character(vintage$date_reference[[1L]]),
    publication_date=as.character(vintage$date_publication[[1L]]), stringsAsFactors=FALSE
  )
  source$reference_date[is.na(vintage$date_reference[[1L]])] <- NA_character_
  source$publication_date[is.na(vintage$date_publication[[1L]])] <- NA_character_
  axes <- data.frame(class_key=names(PROFILS_ACCES_BPE),
    label=unname(PROFILS_ACCES_BPE), ordinal=seq_along(PROFILS_ACCES_BPE)-1L,
    direction=unname(DIRECTIONS_PROFILS_ACCES_BPE[names(PROFILS_ACCES_BPE)]),
    stringsAsFactors=FALSE)
  membership_canonical <- data.frame(
    territoire=as.character(universe_membership$territoire),
    type=as.character(universe_membership$type),
    typequ=as.character(universe_membership$typequ), stringsAsFactors=FALSE)
  membership_canonical <- membership_canonical[
    order(membership_canonical$type,membership_canonical$territoire,
          membership_canonical$typequ),,drop=FALSE]
  rownames(membership_canonical) <- NULL
  membership_hash <- paste(as.character(openssl::sha256(
    serialize(membership_canonical,NULL))),collapse="")
  descriptor_version <- paste(as.character(openssl::sha256(serialize(
    list(axes, length(codes), registry_hash, membership_hash, source), NULL))), collapse="")
  list(facts=facts, axes=axes, descriptor=list(
    descriptor_version=descriptor_version,
    allowed_levels=c("commune", "epci", "departement", "region"),
    completeness="dense_complete", classification_id="bpe_access_profile_v1",
    universe_count=length(codes), universe_sha256=registry_hash,
    registry_filename=basename(registry_path),
    registry_semantic_effect="TYPEQU membership and canonical French labels used by the BPE classifier",
    source=source, membership_sha256=membership_hash
  ))
}

register_bpe_profile_publisher <- function(registry) {
  if (!is.list(registry) || "bpe_profile_evidence" %in% names(registry))
    stop("Invalid or duplicate BPE publisher registration", call.=FALSE)
  registry$bpe_profile_evidence <- list(
    project=function(canonical) project_bpe_profile_evidence(
      canonical$projection, canonical$registry_path, canonical$vintages,
      canonical$universe_membership),
    publish=function(projection, db, version) {
      d <- projection$descriptor; src <- d$source
      existing <- DBI::dbGetQuery(db,
        "SELECT name FROM source_dataset WHERE source_id=$1", params=list(src$source_id))
      if (nrow(existing) && existing$name[[1L]] != src$source_name)
        stop("BPE source identity conflicts with existing source_dataset", call.=FALSE)
      DBI::dbExecute(db, "INSERT INTO source_dataset(source_id,name) VALUES($1,$2) ON CONFLICT(source_id) DO NOTHING",
                     params=list(src$source_id,src$source_name))
      vintage <- DBI::dbGetQuery(db,
        "SELECT version,reference_date,publication_date FROM source_vintage WHERE source_id=$1 AND vintage_id=$2",
        params=list(src$source_id,src$vintage_id))
      if (nrow(vintage) && (vintage$version[[1L]] != src$vintage_id ||
          !identical(as.character(vintage$reference_date[[1L]]),src$reference_date) ||
          !identical(as.character(vintage$publication_date[[1L]]),src$publication_date)))
        stop("BPE snapshot vintage conflicts with existing provenance", call.=FALSE)
      DBI::dbExecute(db, "INSERT INTO source_vintage(source_id,vintage_id,version,reference_date,publication_date) VALUES($1,$2,$3,$4,$5) ON CONFLICT(source_id,vintage_id) DO NOTHING",
        params=list(src$source_id,src$vintage_id,src$vintage_id,src$reference_date,src$publication_date))
      reference <- DBI::dbGetQuery(db,
        "SELECT content_version FROM table_publication WHERE table_name='territory_reference'")
      if (nrow(reference)!=1L || !nzchar(reference$content_version[[1L]]))
        stop("BPE publication requires the shared territory reference", call.=FALSE)
      ids <- unique(as.character(projection$facts$territoire))
      placeholders <- paste0("$",seq_along(ids),collapse=",")
      identities <- DBI::dbGetQuery(db,
        paste0("SELECT territory_id,territory_type FROM territory_reference WHERE territory_id IN (",placeholders,")"),
        params=as.list(ids))
      projected <- unique(projection$facts[c("territoire","type")])
      names(projected) <- c("territory_id","territory_type")
      if (nrow(identities) != nrow(projected) ||
          anyDuplicated(identities$territory_id) ||
          !identical(sort(paste(identities$territory_id,identities$territory_type)),
                     sort(paste(projected$territory_id,projected$territory_type))))
        stop("BPE territory identities differ from the published reference",call.=FALSE)
      current <- DBI::dbGetQuery(db,
        "SELECT content_version,reference_content_version FROM table_publication WHERE table_name='bpe_profile_evidence'")
      if (nrow(current) && identical(current$content_version[[1L]], version) &&
          identical(current$reference_content_version[[1L]], reference$content_version[[1L]]))
        return(invisible(FALSE))
      DBI::dbExecute(db, "DELETE FROM bpe_profile_evidence")
      DBI::dbExecute(db, "DELETE FROM bpe_profile_class_axis")
      DBI::dbExecute(db, "DELETE FROM bpe_profile_evidence_descriptor")
       DBI::dbExecute(db, "INSERT INTO bpe_profile_evidence_descriptor(singleton,indicator_id,descriptor_version,allowed_levels,completeness,classification_id,universe_count,universe_sha256,registry_filename,registry_semantic_effect,membership_sha256,source_id,vintage_id) VALUES(true,'bpe_access_profile',$1,ARRAY[$2,$3,$4,$5]::text[],$6,$7,$8,$9,$10,$11,$12,$13,$14)",
        params=list(d$descriptor_version,d$allowed_levels[[1L]],d$allowed_levels[[2L]],
          d$allowed_levels[[3L]],d$allowed_levels[[4L]],d$completeness,d$classification_id,
           d$universe_count,d$universe_sha256,d$registry_filename,d$registry_semantic_effect,
           d$membership_sha256,src$source_id,src$vintage_id))
      DBI::dbWriteTable(db,"bpe_profile_class_axis",projection$axes,append=TRUE,row.names=FALSE)
      facts <- projection$facts
      keep <- c("territory_id","territory_type","class_key","class_label","class_count",
        "universe_count","exemplar_typequ","exemplar_label","exemplar_c","exemplar_b","exemplar_t")
      rows <- data.frame(territory_id=as.character(facts$territoire),
        territory_type=as.character(facts$type), class_key=as.character(facts$profil),
        class_label=as.character(facts$profil_libelle),class_count=as.integer(facts$nombre_typequ),
        universe_count=as.integer(facts$univers_typequ_count),
        exemplar_typequ=as.character(facts$exemplar_typequ),exemplar_label=as.character(facts$exemplar_libelle),
        exemplar_c=as.numeric(facts$exemplar_c),exemplar_b=as.numeric(facts$exemplar_b),
        exemplar_t=as.numeric(facts$exemplar_t),stringsAsFactors=FALSE)[keep]
      DBI::dbWriteTable(db,"bpe_profile_evidence",rows,append=TRUE,row.names=FALSE)
      DBI::dbExecute(db,"INSERT INTO bpe_profile_evidence_source SELECT territory_type,territory_id,class_key,$1,$2 FROM bpe_profile_evidence",
        params=list(src$source_id,src$vintage_id))
      DBI::dbExecute(db,"INSERT INTO table_publication(table_name,content_version,row_count,reference_content_version,published_at) VALUES('bpe_profile_evidence',$1,$2,$3,now()) ON CONFLICT(table_name) DO UPDATE SET content_version=EXCLUDED.content_version,row_count=EXCLUDED.row_count,reference_content_version=EXCLUDED.reference_content_version,published_at=EXCLUDED.published_at",
        params=list(version,nrow(rows),reference$content_version[[1L]]))
      TRUE
    }
  )
  registry
}

publish_registered_bpe_profiles <- function(canonical, db) {
  publisher <- register_bpe_profile_publisher(list())$bpe_profile_evidence
  projection <- publisher$project(canonical)
  version <- paste(as.character(openssl::sha256(serialize(projection, NULL))), collapse="")
  changed <- DBI::dbWithTransaction(db, publisher$publish(projection, db, version))
  list(changed=isTRUE(changed), content_version=version, row_count=nrow(projection$facts), projection=projection)
}

publish_bpe_profiles_from_canonical <- function(canonical_dir, db,
                                                registry_path=file.path("inst","extdata",BPE_TYPEQU_ARTEFACT_FICHIER)) {
  required <- c("profils_acces_bpe.parquet","vintages.parquet")
  paths <- file.path(canonical_dir, required)
  if (any(!file.exists(paths))) stop("Canonical BPE projection or vintages are missing", call.=FALSE)
  canonical <- list(
    projection=nanoparquet::read_parquet(paths[[1L]]),
    vintages=nanoparquet::read_parquet(paths[[2L]]),
    universe_membership=nanoparquet::read_parquet(file.path(canonical_dir,"profils_acces_bpe_univers.parquet")),
    registry_path=registry_path
  )
  publish_registered_bpe_profiles(canonical, db)
}

publier_bpe_si_optin <- function(publier_bpe, canonical_dir, db) {
  if (!isTRUE(publier_bpe)) return(invisible(NULL))
  if (is.null(db)) stop("BPE publication requires an explicit service connection", call.=FALSE)
  publish_bpe_profiles_from_canonical(canonical_dir, db)
}

run_bpe_publication_cli <- function(action=c("check","publish"),
                                    canonical_dir=Sys.getenv("LUSK_TEST_CANONICAL_DATA_DIR"),
                                    db=NULL,
                                    opt_in=Sys.getenv("LUSK_PUBLISH_BPE",unset=""),
                                    registry_path=file.path("inst","extdata",BPE_TYPEQU_ARTEFACT_FICHIER)) {
  action <- match.arg(action)
  result <- project_bpe_profile_evidence(
    nanoparquet::read_parquet(file.path(canonical_dir,"profils_acces_bpe.parquet")),
    registry_path,
    nanoparquet::read_parquet(file.path(canonical_dir,"vintages.parquet")),
    nanoparquet::read_parquet(file.path(canonical_dir,"profils_acces_bpe_univers.parquet")))
  if (action == "check") return(list(valid=TRUE,rows=nrow(result$facts),universe_count=result$descriptor$universe_count))
  if (!identical(opt_in,"1")) stop("BPE publication requires LUSK_PUBLISH_BPE=1",call.=FALSE)
  if (is.null(db)) stop("A guarded publisher connection is required",call.=FALSE)
  publish_registered_bpe_profiles(list(projection=result$facts,registry_path=registry_path,
    vintages=nanoparquet::read_parquet(file.path(canonical_dir,"vintages.parquet")),
    universe_membership=nanoparquet::read_parquet(file.path(canonical_dir,"profils_acces_bpe_univers.parquet"))),db)
}
