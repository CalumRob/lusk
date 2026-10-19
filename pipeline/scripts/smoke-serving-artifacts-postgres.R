#!/usr/bin/env Rscript
# Issue #802 end-to-end proof.
#
# The offline materializer's private work directory must feed the *unified*
# publishers end-to-end: this script materializes the retained serving artifacts
# from the committed payload with the #802 entrypoint, publishes them through
# the real R publishers on a fresh guarded `lusk_it_*` schema, then reads the
# published rows back semantically — against the very artifacts the materializer
# wrote, including the declared-profile DPE binding to the retained scalar
# snapshot.
#
# Disposable-only, exactly like the other serving smokes: it never reads
# LUSK_PUBLISH_* serving settings, libpq resolves the credentials from the
# operator's private passfile, and it creates, grants and cleans up only its own
# random schema. A fresh schema starts with an empty source registry, so the
# typed-reading clocks the payload declares are registered before publication
# (the scalar, profile and owned-series publishers register their own).
#
# Publication follows the real dependency order (reference -> scalar -> declared
# profiles -> typed readings -> owned series -> the retained annual series). The
# habitat reading binds to the registered DPE profile marker, so the bare
# `publish-serving-tables.R` bundle — which assumes the serving database already
# holds the profiles — is exercised afterwards as the no-op republication check.
#
# Scope of this proof: diagnostic subset, never all-owner acceptance. One retained
# owner (the Mobilite owned series `raccordement_courbe`, whose committed facts
# predate the #728 national GTFS producer run) cannot be fed by the committed
# payload, so the materializer reports it blocked and the full `--check` exits
# non-zero. This smoke asserts exactly that one blocked owner — the run stays
# fail-closed, nothing is stubbed or exempted — and proves the publication and
# semantic read-back of the subset the committed payload does feed. All-owner and
# rollout acceptance require the committed payload to be regenerated first and are
# deliberately not claimed here.
pkgload::load_all(".", quiet=TRUE)
required <- c("HOST", "PORT", "DATABASE", "USER")
config <- setNames(lapply(required, function(key) Sys.getenv(paste0("LUSK_SERVING_TEST_", key), unset="")), required)
stopifnot(all(vapply(config, nzchar, logical(1))), grepl("^lusk_it_[A-Za-z0-9_]+$", config$DATABASE),
  grepl("^[A-Za-z0-9_.:-]+$", config$HOST), grepl("^[0-9]+$", config$PORT),
  identical(Sys.getenv("LUSK_TEST_DATABASE_NAME"), config$DATABASE),
  identical(Sys.getenv("LUSK_TEST_DATABASE_PREFIX"), "lusk_it_"))
read_user <- Sys.getenv("LUSK_TEST_READ_USER", unset="")
stopifnot(nzchar(read_user), read_user != config$USER)
if (!requireNamespace("DBI", quietly=TRUE) || !requireNamespace("RPostgres", quietly=TRUE))
  stop("DBI and RPostgres are required")
canonical_source <- Sys.getenv("LUSK_TEST_CANONICAL_DATA_DIR", unset=file.path("..", "public", "data"))
stopifnot(dir.exists(canonical_source))

# Compare the rows a publisher stored with the materialized projection it was
# published from, on the columns they share, in a stable order. `keys` must
# identify a row uniquely on both sides, so callers rename projected fields to
# their stored column names before comparing.
assert_parity <- function(con, query, expected, keys, params=NULL) {
  actual <- if (is.null(params)) DBI::dbGetQuery(con, query) else DBI::dbGetQuery(con, query, params=params)
  expected <- as.data.frame(expected)
  shared <- intersect(names(actual), names(expected))
  keys <- intersect(keys, shared)
  stopifnot(length(keys) > 0L, nrow(actual) == nrow(expected), !anyDuplicated(actual[keys]),
    !anyDuplicated(expected[keys]))
  ordering <- function(frame) do.call(order, unname(frame[keys]))
  actual <- actual[ordering(actual), shared, drop=FALSE]
  expected <- expected[ordering(expected), shared, drop=FALSE]
  rownames(actual) <- rownames(expected) <- NULL
  stopifnot(isTRUE(all.equal(actual, expected, check.attributes=FALSE)))
  nrow(actual)
}

work <- tempfile("serving-artifacts-work-")
dir.create(work)
con <- DBI::dbConnect(RPostgres::Postgres(), host=config$HOST, port=as.integer(config$PORT),
  dbname=config$DATABASE, user=config$USER)
schema <- paste0("serving_it_", Sys.getpid()); created <- FALSE
tryCatch({
  identity <- DBI::dbGetQuery(con, "SELECT current_database(), current_user")
  stopifnot(identity[[1L]][[1L]] == config$DATABASE, identity[[2L]][[1L]] == config$USER)

  # 1. Materialize from the committed payload into the private work directory.
  #    The entrypoint copies the payload inputs itself, so the canonical snapshot
  #    is never written to.
  materialized <- materialize_serving_artifacts(canonical_source, work, "materialize")
  stopifnot(nrow(materialized$blocked) == 1L,
    identical(materialized$blocked$owner[[1L]], "raccordement_courbe"))
  scalar_binding <- read_profile_scalar_binding(work)
  stopifnot(grepl("^[a-f0-9]{32}$", scalar_binding))
  cat("Materialized", nrow(materialized$versions), "retained owners into the work dir;",
    nrow(materialized$blocked), "blocked (", materialized$blocked$owner[[1L]],
    ") - the blocked owner is the committed-payload prerequisite, so this run proves the feedable subset only\n")

  DBI::dbExecute(con, paste0("CREATE SCHEMA ", DBI::dbQuoteIdentifier(con, schema))); created <- TRUE
  DBI::dbExecute(con, paste0("SET search_path TO ", DBI::dbQuoteIdentifier(con, schema)))
  ddl <- paste(readLines("../api/schema.sql", warn=FALSE), collapse="\n")
  for (statement in split_postgres_sql(ddl)) DBI::dbExecute(con, statement)
  cat("Serving-artifacts smoke schema created:", schema, "\n")

  # 2. Register the source clocks the materialized typed readings declare. The
  #    scalar, profile and owned-series publishers register their own sources as
  #    they publish; the readings read their clock from the merged vintage
  #    universe, and a fresh schema holds an empty registry.
  vintages <- nanoparquet::read_parquet(file.path(work, "vintages.parquet"))
  declared <- do.call(rbind, lapply(c("demographie", "habitat", "economie", "milieux"),
    function(owner) unique(read_typed_reading_publication_from(work, owner)$reading[c("source_id", "vintage_id")])))
  declared <- unique(declared)
  for (i in seq_len(nrow(declared))) {
    clock <- vintages[vintages$id == declared$source_id[[i]], , drop=FALSE]
    stopifnot(nrow(clock) == 1L)
    DBI::dbExecute(con, "INSERT INTO source_dataset(source_id,name) VALUES($1,$2)
      ON CONFLICT(source_id) DO NOTHING",
      params=list(declared$source_id[[i]], clock$source[[1L]]))
    DBI::dbExecute(con, "INSERT INTO source_vintage(source_id,vintage_id,version,reference_date,publication_date)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT(source_id,vintage_id) DO NOTHING",
      params=list(declared$source_id[[i]], declared$vintage_id[[i]], as.character(clock$version[[1L]]),
        as.Date(clock$date_reference[[1L]]), as.Date(clock$date_publication[[1L]])))
  }

  # 3. Unified publication straight from the materialized work dir, in dependency
  #    order: territory reference, retained scalar snapshot + comparisons, every
  #    declared profile, the four typed readings (Milieux also publishes the
  #    OCS-GE owned series), the remaining owned series, then the retained annual
  #    series.
  reference <- publish_canonical_territory_reference(con, work)$projection
  retained <- project_retained_scalar_snapshot(work, reference)
  publish_retained_scalar_snapshot(con, retained, work)
  profile_owners <- unique(c(
    profile_serving_owners(serving_theme_metadata(work, "demographie")),
    profile_serving_owners(serving_theme_metadata(work, "habitat")),
    profile_serving_owners(serving_theme_metadata(work, "mobilite"))))
  profiles <- publier_declared_profiles_postgres(work, profile_owners, con=con)
  stopifnot(profiles$changed)
  publish_canonical_demographic_reading(con, work)
  publish_canonical_habitat_reading(con, work)
  publish_typed_reading_publication(
    register_typed_reading_artifact_publisher(list(), "economie", publish_economy_reading_family),
    "economie", read_typed_reading_publication_from(work, "economie"), con)
  milieux <- publish_canonical_milieux_reading(con, work, conso_source_path=NULL)
  # The owned-series CLI dispatch owns its connection, so pin the schema on it.
  connect_owned <- function() {
    connection <- DBI::dbConnect(RPostgres::Postgres(), host=config$HOST, port=as.integer(config$PORT),
      dbname=config$DATABASE, user=config$USER)
    DBI::dbExecute(connection, paste0("SET search_path TO ",
      DBI::dbQuoteIdentifier(connection, schema)))
    connection
  }
  publish_owned <- function(owner) dispatch_owned_series_cli("publish",
    read_owned_series_projections(work, indicator_id=owner), connect_owned,
    opt_in="1", indicator_id=owner)
  for (owner in c("conso_enaf_annuel", "prix_m2")) publish_owned(owner)
  annual <- read_conso_enaf_series_projection(work)
  publish_series_projection(annual, series_postgres_adapter(con),
    function(validated, db, content_version) db$replace(validated, content_version))
  cat("Unified publication: reference + scalar + comparisons + 4 typed readings +",
    length(profile_owners), "declared profiles + 3 owned series + 1 annual series\n")

  # 4. Semantic read-back against the materialized artifacts.
  scalar_rows <- assert_parity(con, "SELECT * FROM scalar_observation", retained$scalar$facts,
    c("indicator_id", "territory_id"))
  scalar_marker <- DBI::dbGetQuery(con,
    "SELECT content_version FROM table_publication WHERE table_name='scalar_observation'")$content_version
  stopifnot(identical(as.character(scalar_marker[[1L]]),
    as.character(scalar_content_version(retained$scalar))))

  reading_rows <- 0L
  reading_tables <- c(demographie="demographic_typed_reading", habitat="habitat_typed_reading",
    economie="economy_typed_reading", milieux="milieux_typed_reading")
  for (owner in names(reading_tables)) {
    publication <- read_typed_reading_publication_from(work, owner)
    reading_rows <- reading_rows + assert_parity(con, paste0("SELECT * FROM ", reading_tables[[owner]]),
      publication$reading, c("territory_id", "territory_type", "groupe"))
  }

  owned_rows <- 0L
  for (owner in c("artif_par_habitant", "conso_enaf_annuel", "prix_m2")) {
    projection <- read_owned_series_artifact(file.path(work, "series-serving", owner), owner)
    owned_rows <- owned_rows + assert_parity(con,
      "SELECT * FROM series_dataset_observation WHERE dataset_id=$1", projection$points,
      c("dataset_id", "indicator_id", "territory_id", "axis_value"),
      params=list(projection$descriptor$dataset_id))
  }
  # The reconstructed Milieux state roles survive into the published series.
  habitat_series <- read_owned_series_artifact(
    file.path(work, "series-serving", "artif_par_habitant"), "artif_par_habitant")$points
  stopifnot(sum(habitat_series$status == "measured" & !is.na(habitat_series$state_role)) > 0L)
  annual_rows <- assert_parity(con, "SELECT * FROM ordered_series", annual$points,
    c("indicator_id", "territory_id", "axis_value"))

  profile_rows <- 0L
  for (owner in profile_owners) {
    projection <- read_profile_serving_artifact(file.path(work, "profile-serving", owner), owner,
      scalar_binding = if ("distribution_dpe" == owner) scalar_binding else NULL)
    expected <- projection$facts
    names(expected)[names(expected) == "detail"] <- "detail_key"
    names(expected)[names(expected) == "sex"] <- "sex_key"
    profile_rows <- profile_rows + assert_parity(con,
      "SELECT * FROM profile_observation WHERE indicator_id=$1", expected,
      c("indicator_id", "territory_id", "detail_key", "sex_key"), params=list(owner))
  }

  # 5. The DPE declared profile is bound to the retained scalar snapshot the
  #    materializer cached, and to the producer-declared DPE source clock.
  dpe_binding <- DBI::dbGetQuery(con, "SELECT d.required_scalar_version, s.content_version
    FROM profile_descriptor d JOIN table_publication s ON s.table_name='scalar_observation'
    WHERE d.indicator_id='distribution_dpe'")
  stopifnot(nrow(dpe_binding) == 1L,
    identical(as.character(dpe_binding$required_scalar_version[[1L]]), scalar_binding),
    identical(as.character(dpe_binding$content_version[[1L]]), scalar_binding))
  dpe_source <- as.character(serving_theme_metadata(work, "habitat")$sources$part_passoires)
  dpe_clock_row <- vintages[vintages$id == dpe_source, , drop=FALSE]
  stopifnot(nrow(dpe_clock_row) == 1L)
  dpe_clock <- DBI::dbGetQuery(con, "SELECT DISTINCT source_id, vintage_id
    FROM profile_observation_source WHERE indicator_id='distribution_dpe'")
  stopifnot(nrow(dpe_clock) == 1L, identical(dpe_clock$source_id[[1L]], dpe_source),
    identical(dpe_clock$vintage_id[[1L]], paste(as.character(dpe_clock_row$version[[1L]]),
      if (is.na(dpe_clock_row$date_reference[[1L]])) "NA" else
        as.character(dpe_clock_row$date_reference[[1L]]), sep="/")))
  cat("Semantic read-back: scalar", scalar_rows, "+ readings", reading_rows,
    "+ owned series", owned_rows, "+ annual series", annual_rows, "+ profiles", profile_rows,
    "rows match the materialized artifacts; DPE bound to scalar", scalar_binding, "\n")

  # 6. Republishing the same work dir is a no-op: every marker (including its
  #    timestamp) is untouched. This also drives the runbook's unified bundle
  #    against the materialized directory.
  markers <- DBI::dbGetQuery(con, "SELECT * FROM table_publication ORDER BY table_name")
  publish_retained_backend_snapshot(con, work, conso_source_path=NULL)
  for (owner in c("conso_enaf_annuel", "prix_m2")) publish_owned(owner)
  publish_series_projection(annual, series_postgres_adapter(con),
    function(validated, db, content_version) db$replace(validated, content_version))
  no_op <- publier_declared_profiles_postgres(work, profile_owners, con=con)
  stopifnot(!no_op$changed,
    identical(markers, DBI::dbGetQuery(con, "SELECT * FROM table_publication ORDER BY table_name")))
  cat("Unified republication of the same work dir is a no-op: PASS\n")

  # 7. Guarded semantic HTTP read-back through the API. The habitat test in this
  #    file reads its typed reading through the current `/api/resources/read`
  #    contract, so it proves the materialized rows reach the served semantic
  #    layer. The demographic test in the same file still calls the
  #    `/api/territories/{type}/{id}/themes/{theme}/facts` route retired by
  #    ADR-0040 / issue #797 (the backend now registers only `/api/resources*`),
  #    so it 404s on this branch independently of #802 and is excluded here; the
  #    demographic reading is proven at the parity step above.
  if (nzchar(Sys.getenv("LUSK_TEST_READ_DSN")) && nzchar(Sys.which("python"))) {
    DBI::dbExecute(con, paste0("GRANT USAGE ON SCHEMA ", DBI::dbQuoteIdentifier(con, schema),
      " TO ", DBI::dbQuoteIdentifier(con, read_user)))
    DBI::dbExecute(con, paste0("GRANT SELECT ON ALL TABLES IN SCHEMA ",
      DBI::dbQuoteIdentifier(con, schema), " TO ", DBI::dbQuoteIdentifier(con, read_user)))
    keys <- c("LUSK_READING_HTTP_SCHEMA", "PYTHONPATH")
    previous <- Sys.getenv(keys, unset=NA_character_)
    on.exit(for (i in seq_along(keys)) if (is.na(previous[[i]])) Sys.unsetenv(keys[[i]]) else
      do.call(Sys.setenv, setNames(list(previous[[i]]), keys[[i]])), add=TRUE)
    Sys.setenv(LUSK_READING_HTTP_SCHEMA=schema,
      PYTHONPATH=normalizePath("..", winslash="/", mustWork=TRUE))
    test_file <- normalizePath("../api/tests/integration/test_reading_publisher_http.py",
      winslash="/", mustWork=TRUE)
    status <- system2(Sys.which("python"), c("-m", "pytest", "-q",
      shQuote(test_file, type="cmd"), "-k", shQuote("habitat", type="cmd")),
      stdout="", stderr="")
    if (!identical(status, 0L)) stop("Serving-artifacts publisher-to-HTTP parity failed", call.=FALSE)
    cat("Guarded publisher-to-HTTP semantic read-back (habitat typed reading via /api/resources/read): PASS\n")
  } else cat("Guarded publisher-to-HTTP semantic read-back: SKIPPED (read DSN/pytest not configured)\n")
  cat("Serving-artifacts subset end-to-end proof (diagnostic): PASS",
    "- one retained owner stays blocked by the committed payload, so all-owner acceptance is pending payload regeneration\n")
}, finally={
  if (created && identical(Sys.getenv("LUSK_TEST_ALLOW_SCHEMA_CLEANUP"), "1")) {
    tryCatch(cleanup_serving_smoke_schema(con, schema, "serving"),
      error=function(e) stop("Could not clean serving smoke schema ", schema,
        " (inspect and remove manually): ", conditionMessage(e), call.=FALSE))
    cat("Serving smoke schema cleaned:", schema, "\n")
  }
  tryCatch(DBI::dbDisconnect(con), error=function(e)
    warning("Could not disconnect serving smoke DB connection: ", conditionMessage(e), call.=FALSE))
  unlink(work, recursive=TRUE)
})
