#!/usr/bin/env Rscript
# #1041 guarded DBI proof: the REAL nine-column territory-reference adapter,
# with a bounded synthetic classified reference. No scalar/profile artifact is
# needed. The caller owns a disposable schema; this script only sets its
# search_path and never creates/drops schemas.
pkgload::load_all(".", quiet = TRUE)
keys <- c("HOST", "PORT", "DATABASE", "USER", "SCHEMA")
config <- setNames(lapply(keys, function(key)
  Sys.getenv(paste0("LUSK_REFERENCE_TEST_", key), unset = "")), keys)
if (!all(vapply(config, nzchar, logical(1))) ||
    !grepl("^lusk_it_[A-Za-z0-9_]+$", config$DATABASE) ||
    !grepl("^it_[A-Za-z0-9_]+$", config$SCHEMA) ||
    !grepl("^[A-Za-z0-9_.:-]+$", config$HOST) ||
    !grepl("^[0-9]+$", config$PORT))
  stop("Explicit guarded lusk_it_* reference-test configuration is required", call. = FALSE)
passfile <- Sys.getenv("PGPASSFILE", unset = "")
if (!nzchar(passfile) || !file.exists(passfile) ||
    startsWith(tolower(normalizePath(passfile, winslash = "/")),
               tolower(normalizePath("..", winslash = "/"))))
  stop("PGPASSFILE must be private and outside the checkout", call. = FALSE)

con <- DBI::dbConnect(RPostgres::Postgres(), host = config$HOST,
  port = as.integer(config$PORT), dbname = config$DATABASE, user = config$USER)
on.exit(DBI::dbDisconnect(con), add = TRUE)
DBI::dbExecute(con, paste0("SET search_path TO ",
  as.character(DBI::dbQuoteIdentifier(con, config$SCHEMA))))

territoires <- tibble::tibble(
  code = c("22001", "29083", "29209", "22", "53"),
  type = c("commune", "commune", "commune", "departement", "region"),
  nom = c("Commune A", "Île-de-Sein", "Plouvien", "Côtes-d'Armor", "Bretagne"),
  departement = c("22", "29", "29", "22", NA_character_),
  epci = rep(NA_character_, 5L),
  classe_densite_code = c("1", "7", "5", NA_character_, NA_character_),
  classe_densite_libelle_public = c(
    "grands centres urbains bretons",
    "communes rurales à habitat très dispersé en Bretagne",
    "bourgs ruraux bretons", NA_character_, NA_character_),
  littoral_code = c("C", "C", "NC", NA_character_, NA_character_),
  littoral_classement_source = c("Mer", "Mer", NA_character_,
                                 NA_character_, NA_character_)
)
projection <- project_territory_reference(territoires)
adapter <- territory_reference_postgres_adapter(con)

first <- publish_territory_reference_projection(projection, adapter)
stopifnot(isTRUE(first$changed))
lignes <- DBI::dbGetQuery(con, paste(
  "SELECT territory_id,territory_type,name,littoral_code,",
  "littoral_classement_source FROM territory_reference",
  "ORDER BY territory_id"))
stopifnot(nrow(lignes) == 5L,
  identical(lignes$littoral_code,
            c(NA_character_, "C", "C", "NC", NA_character_)),
  identical(lignes$littoral_classement_source,
            c(NA_character_, "Mer", "Mer", NA_character_, NA_character_)),
  all(is.na(lignes$littoral_code[lignes$territory_type != "commune"])))
marker <- DBI::dbGetQuery(con, paste(
  "SELECT content_version,row_count,reference_content_version",
  "FROM table_publication WHERE table_name='territory_reference'"))
stopifnot(nrow(marker) == 1L,
  marker$content_version[[1L]] == projection$content_version,
  marker$row_count[[1L]] == 5L,
  marker$reference_content_version[[1L]] == projection$content_version)

second <- publish_territory_reference_projection(projection, adapter)
stopifnot(!isTRUE(second$changed), !isTRUE(second$rebound))

# ON CONFLICT update: the same territory id is updated, not duplicated.
territoires$nom[territoires$code == "22001"] <- "Commune A mise à jour"
projection2 <- project_territory_reference(territoires)
updated <- publish_territory_reference_projection(projection2, adapter)
stopifnot(isTRUE(updated$changed))
nom <- DBI::dbGetQuery(con,
  "SELECT name FROM territory_reference WHERE territory_id='22001'")
stopifnot(identical(nom$name[[1L]], "Commune A mise à jour"))
marker2 <- DBI::dbGetQuery(con, paste(
  "SELECT content_version FROM table_publication",
  "WHERE table_name='territory_reference'"))
stopifnot(marker2$content_version[[1L]] == projection2$content_version,
  marker2$content_version[[1L]] != marker$content_version[[1L]])

# Rollback: an invalid classification is rejected by the DB CHECK and leaves
# both rows and marker exactly as before.
bad <- projection2
bad$rows$littoral_classement_source[
  bad$rows$territory_id == "22001"] <- "Lac"
# Force a different content version so the publisher actually attempts the
# write (otherwise it is a legitimate no-op on the unchanged marker).
bad$content_version <- scalar_content_version(bad$rows)
before_rows <- DBI::dbGetQuery(con,
  "SELECT * FROM territory_reference ORDER BY territory_id")
before_marker <- DBI::dbGetQuery(con, paste(
  "SELECT * FROM table_publication WHERE table_name='territory_reference'"))
echec <- tryCatch({
  publish_territory_reference_projection(bad, adapter)
  FALSE
}, error = function(e) TRUE)
stopifnot(isTRUE(echec))
after_rows <- DBI::dbGetQuery(con,
  "SELECT * FROM territory_reference ORDER BY territory_id")
after_marker <- DBI::dbGetQuery(con, paste(
  "SELECT * FROM table_publication WHERE table_name='territory_reference'"))
stopifnot(identical(before_rows, after_rows),
          identical(before_marker, after_marker))

cat("littoral reference publisher roundtrip ok\n")
