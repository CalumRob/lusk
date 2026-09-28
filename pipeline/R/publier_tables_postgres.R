.tables_postgres_autorisees <- c("territory_reference", "service_registry",
  "essential_service_access", "building_ramp", "building_grid")
.tables_postgres_dependants <- setdiff(.tables_postgres_autorisees,
                                       c("territory_reference", "service_registry"))
.cles_postgres <- list(territory_reference = "territory_id", service_registry = "service")

.adapter_postgres <- function(con) {
  qid <- function(x) as.character(DBI::dbQuoteIdentifier(con, x))
  qs <- function(x) as.character(DBI::dbQuoteString(con, x))
  list(
    transaction = function(expr) DBI::dbWithTransaction(con, expr),
    lock = function() DBI::dbGetQuery(con, "SELECT pg_advisory_xact_lock(569, 1)"),
    marker = function(n) DBI::dbGetQuery(con, paste0(
      "SELECT content_version, row_count FROM table_publication WHERE table_name = ", qs(n))),
    delete_table = function(n) DBI::dbExecute(con, paste0("DELETE FROM ", qid(n))),
    insert_table = function(n, d) DBI::dbWriteTable(con, DBI::Id(table = n), d, append = TRUE,
                                                        row.names = FALSE),
    upsert_shared = function(n, d) {
      key <- .cles_postgres[[n]]
      cols <- names(d)
      updates <- setdiff(cols, key)
      for (i in seq_len(nrow(d))) {
        assignments <- if (length(updates)) paste(vapply(updates, function(c)
          paste0(qid(c), " = EXCLUDED.", qid(c)), character(1)), collapse = ", ") else
          paste0(qid(key), " = EXCLUDED.", qid(key))
        sql <- paste0("INSERT INTO ", qid(n), " (",
          paste(vapply(cols, qid, character(1)), collapse = ", "), ") VALUES (",
           paste0("$", seq_along(cols), collapse = ", "), ") ON CONFLICT (", qid(key),
          ") DO UPDATE SET ", assignments)
        DBI::dbExecute(con, sql, params = unname(as.list(d[i, cols, drop = FALSE])))
      }
    },
    delete_stale = function(n, d) {
      key <- .cles_postgres[[n]]
      incoming <- unique(as.character(d[[key]]))
      existing <- DBI::dbGetQuery(con, paste0("SELECT ", qid(key), " FROM ", qid(n)))[[key]]
      stale <- setdiff(as.character(existing), incoming)
      for (k in stale) DBI::dbExecute(con, paste0("DELETE FROM ", qid(n),
        " WHERE ", qid(key), " = ", qs(k)))
    },
    save_marker = function(n, version, count) DBI::dbExecute(con, paste0(
      "INSERT INTO table_publication (table_name, content_version, row_count, published_at) VALUES (",
      qs(n), ", ", qs(version), ", ", count, ", CURRENT_TIMESTAMP) ON CONFLICT (table_name) ",
      "DO UPDATE SET content_version = EXCLUDED.content_version, row_count = EXCLUDED.row_count, ",
      "published_at = EXCLUDED.published_at")),
    save_scope = function(s) DBI::dbExecute(con, paste0(
       "INSERT INTO access_publication_metadata (singleton, bretagne_kind, bretagne_label) VALUES (true, ",
       qs(s$kind), ", ", qs(s$label), ") ON CONFLICT (singleton) DO UPDATE SET ",
      "bretagne_kind = EXCLUDED.bretagne_kind, bretagne_label = EXCLUDED.bretagne_label")),
    save_building_contract = function(contract, sources, versions) {
      for (i in seq_len(nrow(sources))) {
        DBI::dbExecute(con, "INSERT INTO source_dataset(source_id,name) VALUES($1,$2) ON CONFLICT(source_id) DO UPDATE SET name=EXCLUDED.name",
          params=unname(as.list(sources[i,c("source_id","source_name"),drop=FALSE])))
        DBI::dbExecute(con, "INSERT INTO source_vintage(source_id,vintage_id,version,reference_date,publication_date) VALUES($1,$2,$2,$3,$4) ON CONFLICT(source_id,vintage_id) DO UPDATE SET version=EXCLUDED.version,reference_date=EXCLUDED.reference_date,publication_date=EXCLUDED.publication_date",
          params=unname(as.list(sources[i,c("source_id","vintage_id","reference_date","publication_date"),drop=FALSE])))
      }
      for (n in names(contract)) {
        DBI::dbExecute(con, "INSERT INTO building_evidence_descriptor(table_name,descriptor_version,contract) VALUES($1,$2,$3::jsonb) ON CONFLICT(table_name) DO UPDATE SET descriptor_version=EXCLUDED.descriptor_version,contract=EXCLUDED.contract",
          params=list(n, versions[[n]], as.character(jsonlite::toJSON(contract[[n]], auto_unbox=TRUE, null="null"))))
        DBI::dbExecute(con, "DELETE FROM building_evidence_descriptor_source WHERE table_name=$1", params=list(n))
        for (source in unique(as.character(contract[[n]]$provenance$source_id))) DBI::dbExecute(con,
          "INSERT INTO building_evidence_descriptor_source(table_name,source_id) VALUES($1,$2)", params=list(n,source))
      }
      invisible(TRUE)
    },
    assert_current = function(count) DBI::dbGetQuery(con,
      paste0("SELECT assert_current_dataset_complete(", count, ")")),
    assert_buildings = function(ramp, grid) DBI::dbGetQuery(con,
      paste0("SELECT assert_building_dataset_complete(", ramp, ", ", grid, ")"))
  )
}

.publier_tables_postgres_impl <- function(tables, versions, access_scope, db,
                                          building_contract=NULL, building_sources=NULL) {
  db$transaction({
    if (!is.null(db$lock)) db$lock()
    current <- setNames(lapply(.tables_postgres_autorisees, db$marker),
                        .tables_postgres_autorisees)
    changed <- names(tables)[!vapply(names(tables), function(n)
      nrow(current[[n]]) > 0L && identical(as.character(current[[n]]$content_version[[1L]]),
                                            versions[[n]]), logical(1))]
    if (length(changed)) {
    if (any(changed %in% c("building_ramp", "building_grid"))) {
      if (is.null(building_contract) || is.null(building_sources) ||
          is.null(db$save_building_contract)) stop("Building descriptor/provenance requis pour la publication.", call.=FALSE)
      db$save_building_contract(building_contract, building_sources, versions)
    }
    # Remove changed children before pruning shared identities. Unchanged
    # children stay in place; any stale referenced identity makes DELETE fail
    # and the enclosing transaction rolls back.
    children <- intersect(changed, .tables_postgres_dependants)
    for (n in children) db$delete_table(n)
    for (n in intersect(changed, names(.cles_postgres))) {
      db$upsert_shared(n, tables[[n]])
      db$delete_stale(n, tables[[n]])
    }
    for (n in children) db$insert_table(n, tables[[n]])

    if ("essential_service_access" %in% changed) db$save_scope(access_scope)
    relevant_current <- any(changed %in% c("territory_reference", "service_registry",
                                           "essential_service_access"))
    if (relevant_current) {
      n <- if ("essential_service_access" %in% changed) nrow(tables$essential_service_access) else
        if (nrow(current$essential_service_access)) current$essential_service_access$row_count[[1L]] else 0L
      db$assert_current(n)
    }
    if (any(changed %in% c("territory_reference", "building_ramp", "building_grid"))) {
      ramp <- if ("building_ramp" %in% changed) nrow(tables$building_ramp) else
        if (nrow(current$building_ramp)) current$building_ramp$row_count[[1L]] else 0L
      grid <- if ("building_grid" %in% changed) nrow(tables$building_grid) else
        if (nrow(current$building_grid)) current$building_grid$row_count[[1L]] else 0L
      db$assert_buildings(ramp, grid)
    }
    for (n in changed) db$save_marker(n, versions[[n]], nrow(tables[[n]]))
    }
    invisible(changed)
  })
}

publier_tables_postgres <- function(connexion, tables, versions, access_scope,
                                    building_contract=NULL, building_sources=NULL) {
  if (!is.list(tables) || is.null(names(tables)) || anyDuplicated(names(tables)) ||
     !setequal(names(tables), .tables_postgres_autorisees) ||
      !all(vapply(tables, is.data.frame, logical(1))))
     stop("tables doit contenir les cinq projections autorisées.", call. = FALSE)
  if (!is.character(versions) || is.null(names(versions)) || anyDuplicated(names(versions)) ||
      !all(.tables_postgres_autorisees %in% names(versions)) ||
      anyNA(versions[.tables_postgres_autorisees]) || any(!nzchar(versions[.tables_postgres_autorisees])) ||
       !is.list(access_scope) || !is.character(access_scope$kind) ||
       length(access_scope$kind) != 1L || !nzchar(access_scope$kind) ||
       !is.character(access_scope$label) || length(access_scope$label) != 1L ||
       !nzchar(access_scope$label))
    stop("Versions ou descripteur access_scope invalides.", call. = FALSE)
  if (!requireNamespace("DBI", quietly = TRUE)) stop("DBI est requis.", call. = FALSE)
  .publier_tables_postgres_impl(tables, versions, access_scope, .adapter_postgres(connexion),
                                building_contract, building_sources)
}

# R connects directly from the publishing PC using libpq and the operator's
# private password file. Neither the targets graph nor the package stores
# credentials. The same seam serves a standalone retry and the opt-in leaf.
configuration_service_postgres <- function() {
  required <- c("LUSK_PUBLISH_HOST", "LUSK_PUBLISH_DATABASE", "LUSK_PUBLISH_USER")
  env <- Sys.getenv(required, unset = "")
  passfile_env <- Sys.getenv("PGPASSFILE", unset = "")
  if (!nzchar(passfile_env)) {
    passfile_env <- file.path(Sys.getenv("APPDATA"), "PostgreSQL", "pgpass.conf")
  }
  if (any(!nzchar(env)) || !file.exists(passfile_env)) {
    stop("Publication SQL : hôte, base, rôle et passfile libpq privé requis.",
         call. = FALSE)
  }
  passfile <- normalizePath(passfile_env, winslash = "/", mustWork = TRUE)
  repository <- normalizePath("..", winslash = "/", mustWork = TRUE)
  if (startsWith(tolower(passfile), paste0(tolower(repository), "/"))) {
    stop("PGPASSFILE doit rester hors du dépôt.", call. = FALSE)
  }
  port <- suppressWarnings(as.integer(Sys.getenv("LUSK_PUBLISH_PORT", unset = "5432")))
  if (is.na(port) || port < 1L || port > 65535L) {
    stop("LUSK_PUBLISH_PORT doit être un port TCP valide.", call. = FALSE)
  }
  list(host = env[["LUSK_PUBLISH_HOST"]], port = port,
       dbname = env[["LUSK_PUBLISH_DATABASE"]],
       user = env[["LUSK_PUBLISH_USER"]], passfile = passfile)
}

publier_tables_service_depuis_parquet <- function(sortie = "../public/data") {
  config <- configuration_service_postgres()
  donnees <- preparer_tables_service(sortie)
  conn <- do.call(DBI::dbConnect, c(list(drv = RPostgres::Postgres()), config))
  tryCatch(publier_tables_postgres(conn, donnees$tables, donnees$versions,
                                   donnees$access_scope, donnees$building_contract,
                                   donnees$building_sources),
           finally = DBI::dbDisconnect(conn))
}
