# Adopt guarded-proof fixture helpers (#1142).
# Shared by tests/testthat/test-adopt-db.R and slow-tests/test-adopt-fixture-lineage.R.

.adopt_db_config <- function() {
  required <- c("LUSK_SCALAR_TEST_HOST", "LUSK_SCALAR_TEST_DATABASE",
                "LUSK_SCALAR_TEST_USER", "PGPASSFILE")
  env <- Sys.getenv(required, unset = "")
  database <- Sys.getenv("LUSK_SCALAR_TEST_DATABASE", unset = "")
  if (any(!nzchar(env)) || !file.exists(Sys.getenv("PGPASSFILE", unset = "")) ||
      database != "lusk_it_contract" || !startsWith(database, "lusk_it_") ||
      identical(database, "lusk"))
    testthat::skip("guarded adopt proof requires explicit lusk_it_* DSNs and private PGPASSFILE")
  if (Sys.getenv("LUSK_SCALAR_TEST_CLEANUP", unset = "") != "1")
    testthat::skip("set LUSK_SCALAR_TEST_CLEANUP=1 for the non-retained adopt proof")
  list(host = env[["LUSK_SCALAR_TEST_HOST"]],
       port = suppressWarnings(as.integer(Sys.getenv("LUSK_SCALAR_TEST_PORT", "5432"))),
       dbname = database, user = env[["LUSK_SCALAR_TEST_USER"]],
       passfile = normalizePath(Sys.getenv("PGPASSFILE"), winslash = "/", mustWork = TRUE))
}

.adopt_db_connect <- function() {
  cfg <- .adopt_db_config()
  con <- DBI::dbConnect(RPostgres::Postgres(), dbname = cfg$dbname, host = cfg$host,
                        port = cfg$port, user = cfg$user, passfile = cfg$passfile,
                        connect_timeout = 5)
  identite <- DBI::dbGetQuery(con,
    "SELECT current_database() AS db, current_user AS usr")
  if (!identical(identite$db[[1L]], "lusk_it_contract") ||
      !identical(identite$usr[[1L]], "lusk_it_contract_pub")) {
    DBI::dbDisconnect(con)
    testthat::skip("guarded adopt proof requires the lusk_it_contract test role")
  }
  con
}

.adopt_db_schema <- function(con) {
  schema <- paste0("it_adopt_", paste(sample(c(letters, 0:9), 12, TRUE), collapse = ""))
  DBI::dbExecute(con, paste0('CREATE SCHEMA "', schema, '"'))
  DBI::dbExecute(con, paste0('SET search_path TO "', schema, '"'))
  sql <- paste(readLines(testthat::test_path("..", "..", "..", "api", "schema.sql"),
                         warn = FALSE), collapse = "\n")
  for (statement in split_postgres_sql(sql)) DBI::dbExecute(con, statement)
  schema
}

.adopt_db_scalar_indicator <- function(id, source, values) {
  p <- artefacts_fixture_scalar_indicator(id, source, values)
  p$datasets <- data.frame(source_id = source, name = source, stringsAsFactors = FALSE)
  p$vintages <- data.frame(source_id = source, vintage_id = "2020", version = "2020",
    reference_date = as.Date("2020-01-01"), publication_date = as.Date("2021-01-01"),
    stringsAsFactors = FALSE)
  p
}

.adopt_db_profile_projection <- function(source, id, reference, scalar_version = NULL,
                                         comparison_scalar = NULL, scalar_descriptor = NULL) {
  descriptor <- source$descriptor
  descriptor$indicator_id <- id
  descriptor$required_scalar_version <- scalar_version
  descriptor$comparison_scalar <- comparison_scalar
  if (!is.null(comparison_scalar)) {
    if (is.null(scalar_descriptor) || nrow(scalar_descriptor) != 1L)
      stop("DPE-like fixture requires its scalar descriptor", call. = FALSE)
    scalaire <- as.list(scalar_descriptor[1L, , drop = FALSE])
    descriptor$unit <- as.character(scalaire$unit)[[1L]]
    descriptor$comparison_direction <- as.character(scalaire$direction)[[1L]]
    descriptor$levels <- as.character(unlist(scalaire$allowed_levels, use.names = FALSE))
    descriptor$comparison_scalar <- as.character(scalaire$indicator_id)[[1L]]
    descriptor$comparison_detail <- NA_character_
    descriptor$comparison_sex <- NA_character_
  }
  eligible <- reference$rows[reference$rows$territory_type %in% descriptor$levels,
                            c("territory_id", "territory_type"), drop = FALSE]
  details <- source$axes$axis_key[source$axes$axis_name == "detail"]
  sexes <- source$axes$axis_key[source$axes$axis_name == "sex"]
  if (!length(sexes)) sexes <- ""
  coordinates <- expand.grid(detail = details, sex = sexes, stringsAsFactors = FALSE)
  grid <- cbind(eligible[rep(seq_len(nrow(eligible)), each = nrow(coordinates)), , drop = FALSE],
    coordinates[rep(seq_len(nrow(coordinates)), times = nrow(eligible)), , drop = FALSE])
  rownames(grid) <- NULL
  facts <- data.frame(territory_id = grid$territory_id, territory_type = grid$territory_type,
    detail = grid$detail, sex = grid$sex, value = seq_len(nrow(grid)),
    status = "measured", stringsAsFactors = FALSE)
  p <- source$provenance[1L, , drop = FALSE]
  provenance <- data.frame(indicator_id = id, territory_id = grid$territory_id,
    detail_key = grid$detail, sex_key = grid$sex, source_id = p$source_id,
    vintage_id = p$vintage_id, stringsAsFactors = FALSE)
  list(descriptor = descriptor, facts = facts, axes = source$axes,
    provenance = provenance, datasets = source$datasets, vintages = source$vintages,
    eligible_territories = eligible)
}

.adopt_db_anchored_collection <- function(reference) {
  eligible <- reference$rows[reference$rows$territory_type == "commune",
                            c("territory_id", "territory_type"), drop = FALSE]
  indicator <- "membres"
  descriptor <- list(indicator_id = indicator, theme_id = "programmes",
    kind = "anchored_membership", label = "Membres", unit = "count",
    allowed_levels = "commune", comparison_detail = NA_character_,
    comparison_period = NA_character_, direction = "none", descriptor_version = "membres-v1")
  categories <- data.frame(indicator_id = indicator, detail_key = "petite_ville",
    label = "Petite ville", ordinal = 0L, source_id = "programme_source",
    anchor_levels = "{commune}", rider_label = NA_character_, clock_policy = "dataset",
    stringsAsFactors = FALSE)
  facts <- data.frame(indicator_id = indicator, territory_id = eligible$territory_id,
    territory_type = eligible$territory_type, detail_key = "petite_ville",
    convention_valant_ort = FALSE, source_id = "programme_source", vintage_id = "v1",
    stringsAsFactors = FALSE)
  structure(list(descriptor = descriptor, categories = categories, facts = facts,
    datasets = data.frame(source_id = "programme_source", name = "Programmes",
      stringsAsFactors = FALSE),
    vintages = data.frame(source_id = "programme_source", vintage_id = "v1", version = "v1",
      reference_date = as.Date("2023-01-01"), publication_date = as.Date("2024-01-01"),
      stringsAsFactors = FALSE), provenance = data.frame(source_id = character(),
        vintage_id = character(), stringsAsFactors = FALSE)), class = "collection-projection")
}

# The splitter derives an artefact's `digests_lignage` from its provenance
# source ids (splitter_ressources.R:461). Both collection helpers carry facts
# with a source_id but an intentionally empty provenance (they are shared with
# adapter-only tests), which would leave the adopt artefact with NO attested
# lineage and make the shared freeze guard refuse the resource. Give every
# collection fact its provenance row so the lineage digest resolves from the
# sortie's source-digests.json and from `fixture$lock`, exactly as the real
# publisher's projection does.
.adopt_db_collection_lineage <- function(projection) {
  data.frame(source_id = as.character(projection$facts$source_id),
             vintage_id = as.character(projection$facts$vintage_id),
             stringsAsFactors = FALSE)
}

.adopt_db_series_projection <- function() {
  p <- adaptateur_series_projection()
  p$descriptor$direction <- "high"
  p$descriptor$comparison_point <- "M3"
  p$descriptor$comparison_statistic <- "median"
  p$descriptor$comparison_levels <- "commune"
  p$descriptor$comparison_axis_values <- c("M2", "M3")
  p
}

.adopt_db_aedar_manifest <- function(projection, reference) {
  comparison <- adaptateur_aedar_comparaison(projection, with_littoral = FALSE,
    reference_version = reference$content_version)
  comparison$membership <- aedar_comparison_membership_rows(
    adaptateur_aedar_reference_rows(FALSE))
  hashes <- stats::setNames(rep(paste(rep("a", 64), collapse = ""),
    length(c(paste0("mode:", AEDAR_ADDRESS_SOURCE_MODES), "address_origins", "density_reference",
      "density_artifact", "density_aggregate_content_version", "density_reference_identity",
      "density_reference_sha256", "density_reference_vintage"))),
    c(paste0("mode:", AEDAR_ADDRESS_SOURCE_MODES), "address_origins", "density_reference",
      "density_artifact", "density_aggregate_content_version", "density_reference_identity",
      "density_reference_sha256", "density_reference_vintage"))
  hashes[["density_reference_identity"]] <- MANIFEST_CLASSES_DENSITE$id[[1L]]
  hashes[["density_reference_sha256"]] <- MANIFEST_CLASSES_DENSITE$sha256[[1L]]
  hashes[["density_reference_vintage"]] <- MANIFEST_CLASSES_DENSITE$vintage[[1L]]
  identity <- as.character(jsonlite::toJSON(as.list(hashes), auto_unbox = TRUE))
  input_version <- paste(as.character(openssl::sha256(charToRaw(identity))), collapse = "")
  directory <- tempfile("adopt-aedar-")
  metadata <- list(source_snapshot_id = comparison$source_snapshot_id,
    aedar_content_version = comparison$aedar_content_version,
    reference_content_version = comparison$reference_content_version,
    input_content_version = input_version, input_identity = identity,
    membership = comparison$membership, typequ_axis = read_aedar_typequ_registry()$TYPEQU,
    typequ_axis_sha256 = AEDAR_TYPEQU_REGISTRY_SHA256,
    density_class_summaries = comparison$density_rows, littoral_summaries = NULL)
  part_builder <- function(code) {
    groups <- comparison$groups[comparison$groups$typequ == code, , drop = FALSE]
    names(groups)[names(groups) == "typequ"] <- "TYPEQU"
    list(groups = groups[AEDAR_COMPARISON_GROUP_COLUMNS],
      territories = data.frame())
  }
  manifest <- write_aedar_comparison_canonical(part_builder, directory, metadata)
  list(directory = directory, manifest = manifest,
    comparison = comparaison_aedar_pour_artefact(directory, reference))
}

.adopt_db_fixture <- function() {
  sortie <- tempfile("adopt-sortie-")
  root <- artefacts_fixture_root()
  # The semantic grammar (producer-semantic-resources-v1) lives BESIDE the theme-metadata
  # directory (registre_ressource.R: declarations_semantiques_publication), as in the
  # package's inst/extdata: without it AEDAR's two grammar identities
  # (aedar_territorial_aggregate, aedar_territory_summary) get no descriptor.
  base_metadata <- tempfile("adopt-fixture-")
  metadata_directory <- file.path(base_metadata, "theme-metadata")
  aedar_dir <- NULL
  dir.create(sortie, recursive = TRUE)
  dir.create(metadata_directory, recursive = TRUE)
  file.copy(system.file("extdata", "semantic-resource-contracts.json", package = "lusk"),
            base_metadata)
  file.copy(list.files(system.file("extdata", "theme-metadata", package = "lusk"),
    pattern = "^theme_.*\\.json$", full.names = TRUE), metadata_directory)
  jsonlite::write_json(list(theme = "programmes", indicator_keys = list("membres", "acv"),
    sources = list(membres = "programme_source", acv = "programme_source"),
    source_records = list(programme_source = list(name = "Programmes")),
    observed_collection_contracts = list(membres = list(kind = "anchored_membership"),
      acv = list(kind = "period_detail")),
    indicator_pages = list(membres = list(sources = list("programme_source")),
      acv = list(sources = list("programme_source")))),
    file.path(metadata_directory, "theme_programmes_fixture.json"), auto_unbox = TRUE,
    null = "null", pretty = TRUE)
  # No fake "aedar" indicator declaration: AEDAR is discovered through the producer's
  # semantic grammar (aedar_territorial_aggregate / aedar_territory_summary), exactly as
  # in production; an indicator entry would shadow it (declarations_decouverte_ressource).
  base <- artefacts_fixture_reference()$rows
  canonical <- data.frame(territoire = base$territory_id, type = base$territory_type,
    nom = base$territory_id, departement = rep(NA_character_, nrow(base)),
    epci = base$epci_id, classe_densite_code = base$density_class_code,
    classe_densite_libelle_public = base$density_class_code, stringsAsFactors = FALSE)
  nanoparquet::write_parquet(canonical, file.path(sortie, "territoires.parquet"))
  reference <- project_territory_reference(canonical)

  densite <- .adopt_db_scalar_indicator("densite", "src_densite", seq_len(nrow(base)))
  passoires <- .adopt_db_scalar_indicator("part_passoires", "dpe_22",
    seq_len(nrow(base)) + 100L)
  scalar <- list(facts = rbind(densite$facts, passoires$facts),
    descriptors = rbind(densite$descriptors, passoires$descriptors),
    provenance = rbind(densite$provenance, passoires$provenance),
    datasets = rbind(densite$datasets, passoires$datasets),
    vintages = rbind(densite$vintages, passoires$vintages),
    eligible_territories = densite$eligible_territories)
  scalar_version <- scalar_content_version(scalar)
  write_scalar_serving_artifact(scalar, file.path(sortie, "scalar-serving", "demographie"))
  # A real kept sortie records the global scalar token the profiles were bound to
  # (run_pipeline.R: cache_profile_scalar_binding(profile_binding, sortie)). Adoption
  # attests the live global binding against exactly this file.
  cache_profile_scalar_binding(scalar_version, sortie)
  snapshot <- list(scalar = scalar,
    comparison = project_scalar_comparisons(scalar, reference$rows, scalar_version,
      reference$content_version), retired_indicator_ids = character())

  payload <- compute_payload_test(load_fixture())
  habitat <- payload_habitat()
  structure_source <- project_structure_age_profile(payload, lire_theme_metadata("demographie"))
  structure_age <- .adopt_db_profile_projection(structure_source, "structure_age", reference)
  dpe_source <- project_dpe_profile(habitat, lire_theme_metadata("habitat"), scalar_version)
  dpe <- .adopt_db_profile_projection(dpe_source, "distribution_dpe", reference,
    scalar_version = scalar_version, comparison_scalar = "part_passoires",
    scalar_descriptor = passoires$descriptors)
  write_profile_serving_artifact(structure_age,
    file.path(sortie, "profile-serving", "structure_age"))
  write_profile_serving_artifact(dpe, file.path(sortie, "profile-serving", "distribution_dpe"),
    scalar_binding = scalar_version)

  serie <- .adopt_db_series_projection()
  period <- adaptateur_collection_projection()
  period$provenance <- .adopt_db_collection_lineage(period)
  membres <- .adopt_db_anchored_collection(reference)
  membres$provenance <- .adopt_db_collection_lineage(membres)
  aedar <- adaptateur_aedar_projection()
  # AEDAR producers carry `source` as scalar list fields; the splitter derives
  # `digests_lignage` from a provenance DATA.FRAME's source_id column. Coerce it
  # to the one-row frame the canonical sortie reader yields so this resource
  # gets the same attested lineage as the other shapes.
  if (is.list(aedar$source) && "source_id" %in% names(aedar$source))
    aedar$source <- as.data.frame(aedar$source, stringsAsFactors = FALSE)
  aedar$descriptor <- list(indicator_id = "aedar",
    theme_id = lire_theme_metadata("mobilite")$theme)
  aedar_manifest <- .adopt_db_aedar_manifest(aedar, reference)
  # The splitter takes the comparison from the projection itself; without this
  # the AEDAR artefact has none and projeter_artefact_aedar() refuses it.
  aedar$comparison <- aedar_manifest$comparison
  aedar_dir <- aedar_manifest$directory
  projections <- list(
    scalar = list(densite = densite, part_passoires = passoires),
    declared_profile = list(structure_age = structure_age, distribution_dpe = dpe),
    owned_series = list(artif_par_habitant = serie),
    observed_collection = list(acv = period, membres = membres),
    aedar = list(aedar = aedar))
  sources <- sort(unique(c(scalar$provenance$source_id, structure_age$provenance$source_id,
    dpe$provenance$source_id, serie$provenance$source_id, period$facts$source_id,
    membres$facts$source_id, aedar$source$source_id)))
  digests <- artefacts_fixture_digests(sources)
  jsonlite::write_json(unname(digests), file.path(sortie, "source-digests.json"),
    auto_unbox = TRUE)
  typed <- new.env(parent = emptyenv())
  typed$hits <- integer()
  list(sortie = sortie, root = root, reference = reference, snapshot = snapshot,
    scalar_version = scalar_version, lock = digests, projections = projections,
    aedar_manifest = aedar_manifest$manifest, aedar_dir = aedar_dir,
    base_metadata = base_metadata, metadata_directory = metadata_directory, typed = typed)
}

.adopt_db_publish_all <- function(con, fixture) {
  typed <- fixture$typed
  local_mocked_bindings(
    project_retained_scalar_snapshot = function(...) fixture$snapshot,
    declared_profile_owners = function() c("structure_age", "distribution_dpe"),
    profile_scalar_binding = function(...) fixture$scalar_version,
    publish_canonical_demographic_reading = function(...) {
      typed$hits <- c(typed$hits, "demographic"); list()
    },
    publish_canonical_habitat_reading = function(...) {
      typed$hits <- c(typed$hits, "habitat"); list()
    },
    read_typed_reading_publication_from = function(...) {
      typed$hits <- c(typed$hits, "economy-read"); list()
    },
    publish_typed_reading_publication = function(...) {
      typed$hits <- c(typed$hits, "economy-publish"); list()
    },
    publish_canonical_milieux_reading = function(...) {
      typed$hits <- c(typed$hits, "milieux"); list(reading = list(), owned_series = list())
    }, .package = "lusk")
  publish_retained_backend_snapshot(con, sortie = fixture$sortie, atomic = TRUE,
    companion_profiles = TRUE)
  expect_setequal(typed$hits, c("demographic", "habitat", "economy-read",
    "economy-publish", "milieux"))
  publish_owned_series_projection(fixture$projections$owned_series$artif_par_habitant,
    owned_series_postgres_adapter(con))
  for (projection in fixture$projections$observed_collection)
    publish_observed_collection(projection, con)
  aedar <- fixture$projections$aedar$aedar
  comparison <- fixture$aedar_manifest
  publish_aedar_aggregates(aedar, con,
    reference_version = fixture$reference$content_version,
    reference_pairs = adaptateur_aedar_reference_rows(FALSE),
    version = comparison$aedar_content_version)
  publish_aedar_comparisons(comparison, con)
  invisible(TRUE)
}

# One published fixture serves every guarded case in test-adopt-db.R. The case
# owns the outer transaction and always rolls it back. Production publication
# transactions join it through savepoints; dbWriteTable() is routed through the
# equivalent non-committing append method. PostgreSQL-only transaction mode
# changes that cannot run after the fixture's first write are suppressed here.
# Their own DB-free contracts remain in test-publication-cli.R and the adapter tests.
.adopt_db_remplacer_binding <- function(nom, valeur, envir) {
  original <- get(nom, envir = asNamespace("DBI"), inherits = FALSE)
  assignInNamespace(nom, valeur, ns = "DBI")
  withr::defer(assignInNamespace(nom, original, ns = "DBI"), envir = envir)
  invisible(NULL)
}

.adopt_db_begin_rollback <- function(con) {
  envir <- parent.frame()
  executer_original <- DBI::dbExecute
  executer_original(con, "BEGIN")
  executer_original(con, "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")
  withr::defer(executer_original(con, "ROLLBACK"), envir = envir)
  .adopt_db_remplacer_binding("dbExecute", function(con, statement, ...) {
    if (identical(statement, "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ") ||
        identical(statement, "SET TRANSACTION READ ONLY")) return(0L)
    executer_original(con, statement, ...)
  }, envir = envir)
  .adopt_db_remplacer_binding("dbWithTransaction", function(con, expr, ...) {
    savepoint <- paste0("adopt_cas_", paste(sample(c(letters, 0:9), 12, TRUE),
                                             collapse = ""))
    executer_original(con, paste("SAVEPOINT", savepoint))
    on.exit({
      executer_original(con, paste("ROLLBACK TO SAVEPOINT", savepoint))
      executer_original(con, paste("RELEASE SAVEPOINT", savepoint))
    }, add = TRUE)
    valeur <- force(expr)
    executer_original(con, paste("RELEASE SAVEPOINT", savepoint))
    on.exit(NULL)
    valeur
  }, envir = envir)
  # RPostgres::dbWriteTable() commits even when append=TRUE. Its append method
  # performs the same parameterised insert without owning a transaction.
  .adopt_db_remplacer_binding("dbWriteTable",
    function(con, name, value, append = FALSE, row.names = FALSE, ...) {
      if (!isTRUE(append) || !identical(row.names, FALSE))
        stop("The adopt rollback harness only appends complete fixture rows.")
      if (!nrow(value)) return(0L)
      DBI::dbAppendTable(con, name, value, ...)
    }, envir = envir)
  invisible(NULL)
}

.adopt_db_rollback <- function(con, code) {
  .adopt_db_begin_rollback(con)
  force(code)
}

# Splitting the sortie and reading its immutable Artefacts de ressource is pure
# fixture work. Build it once; refusal/mutation cases keep the real CLI and DB
# path but do not rebuild the same content-addressed files for every call.
.adopt_db_reuse_artefacts <- function(partage, ids = NULL) {
  builds <- partage$builds
  artefacts <- partage$artefacts
  if (!is.null(ids)) {
    if (any(!ids %in% as.character(builds$ressource)))
      stop("Unknown adopt fixture resource: ", paste(setdiff(ids, builds$ressource), collapse = ", "),
           call. = FALSE)
    builds <- builds[match(ids, as.character(builds$ressource)), , drop = FALSE]
    artefacts <- artefacts[as.character(builds$ressource)]
  }
  testthat::local_mocked_bindings(
    splitter_sortie = function(...) builds,
    charger_artefacts_construits = function(...) artefacts,
    construites_depuis_magasin = function(...) builds,
    .package = "lusk", .env = parent.frame()
  )
  invisible(NULL)
}

.adopt_db_digest <- function(con) {
  tables <- DBI::dbGetQuery(con, paste0(
    "SELECT tablename FROM pg_tables WHERE schemaname=current_schema() ",
    "AND tablename NOT IN ('resource_publication','resource_publication_descriptor',",
    "'resource_publication_event','scalar_resource_comparison_publication',",
    "'profile_resource_comparison_publication') ",
    "ORDER BY tablename"))$tablename
  out <- lapply(tables, function(table) {
    champs <- DBI::dbListFields(con, table)
    ordre <- paste(vapply(champs, function(champ)
      as.character(DBI::dbQuoteIdentifier(con, champ)), character(1)), collapse = ",")
    DBI::dbGetQuery(con, paste0("SELECT * FROM ", table, " ORDER BY ", ordre))
  })
  names(out) <- tables
  serialize(out, NULL)
}

.adopt_db_registry_digest <- function(con) {
  serialize(list(
    registry = DBI::dbGetQuery(con,
      "SELECT * FROM resource_publication ORDER BY resource_id"),
    descriptors = DBI::dbGetQuery(con,
      "SELECT * FROM resource_publication_descriptor ORDER BY publication_resource_id,resource_id"),
    receipts = DBI::dbGetQuery(con,
      "SELECT * FROM resource_publication_event ORDER BY event_id"),
    marqueurs_scalaires = DBI::dbGetQuery(con,
      "SELECT * FROM scalar_resource_comparison_publication ORDER BY indicator_id"),
    marqueurs_profils = DBI::dbGetQuery(con,
      "SELECT * FROM profile_resource_comparison_publication ORDER BY indicator_id")), NULL)
}

# The API's own comparison predicates, evaluated in the database, for the resources
# that carry a comparison. Each check cites the api/ reader condition it mirrors;
# "adopt then deploy the API" must not turn any scalar/profile read into a 503.
#   resource_publication.py = api/resource_publication.py (live_resource_publications)
#   snapshot_reads.py       = api/snapshot_reads.py
#   profile_reads.py        = api/profile_reads.py (focal_profiles)
# Deliberately NOT mirrored (request/cohort-dependent, not a property of adopted rows):
#   * `member_count == len(members)` (snapshot_reads.py:544,1010) depends on the cohort
#     of the request; we check the cohort-independent `eligible+missing == member_count`.
#   * profile_reads.py `len(versions) != 1` ("Profile publication versions are not
#     uniform"): uniformity of registry content_version across the profiles a REQUEST
#     selects; it depends on the theme/indicator filter and equally constrains `apply`.
#   * the typed-reading and HTTP layers (the end-to-end sweep is #1143's rehearsal).
.adopt_db_predicats_api <- function(con, scalaires, profils, profils_scalaires = character(),
                                    dependances = c(distribution_dpe = "part_passoires")) {
  dans <- function(ids) in_params(ids)
  nombre <- function(sql, ...) as.numeric(DBI::dbGetQuery(con, sql, params = list(...))[[1L]][[1L]])
  ref <- DBI::dbGetQuery(con, paste0("SELECT content_version FROM table_publication ",
    "WHERE table_name='territory_reference'"))$content_version[[1L]]

  # live_resource_publications (resource_publication.py:22-50): rows exist, retired=false,
  # non-empty content_version; the reader fails if len(rows) != len(ids).
  registre <- function(ids) {
    r <- DBI::dbGetQuery(con, paste0("SELECT resource_id,shape,content_version,",
      "reference_content_version FROM resource_publication WHERE resource_id IN (", dans(ids),
      ") AND retired=false"), params = as.list(ids))
    testthat::expect_setequal(r$resource_id, ids)                       # :22-50 len(rows)==len(ids)
    testthat::expect_true(all(!is.na(r$content_version) & nzchar(r$content_version)))
    r
  }
  # SQL boolean copies of the readers' validity expressions
  groupe_valide <- "(statistic='median' AND eligible_count+missing_count=member_count AND ((eligible_count=0 AND median IS NULL) OR (eligible_count>0 AND median IS NOT NULL AND median NOT IN ('Infinity'::float8,'-Infinity'::float8,'NaN'::float8))))"
  territoire_valide <- paste0("((status='measured' AND value IS NOT NULL AND rank IS NOT NULL ",
    "AND tie_count IS NOT NULL AND rank_size IS NOT NULL AND tie_count>=1 AND rank_size>=1 ",
    "AND rank>=1 AND rank<=rank_size AND tie_count<=rank_size AND rank+tie_count<=rank_size+1) OR ",
    "(status IN ('suppressed','unsupported','not_available','not_published') AND value IS NULL ",
    "AND rank IS NULL AND tie_count IS NULL AND rank_size IS NULL))")

  # _scalar_comparison_publication_marker (snapshot_reads.py:908-936)
  rs <- registre(scalaires)
  m <- DBI::dbGetQuery(con, paste0("SELECT indicator_id,content_version,scalar_content_version,",
    "reference_content_version,group_row_count,territory_row_count,lineage_row_count ",
    "FROM scalar_resource_comparison_publication WHERE indicator_id IN (", dans(scalaires), ")"),
    params = as.list(scalaires))
  testthat::expect_setequal(m$indicator_id, scalaires)                      # :924
  testthat::expect_length(unique(m$reference_content_version), 1L)          # :926-928 len(marker_references)==1
  testthat::expect_true(all(m$reference_content_version == ref))            # :929-933 == live territory reference
  testthat::expect_true(all(rs$reference_content_version[match(m$indicator_id, rs$resource_id)] ==
                              m$reference_content_version))               # :933 publications[id].reference
  testthat::expect_true(all(nzchar(m$content_version) & nzchar(m$scalar_content_version))) # :932 not marker[0]/[1]
  testthat::expect_true(all(m$group_row_count >= 1 & m$territory_row_count >= 1))           # :934
  for (id in scalaires) {
    mk <- m[m$indicator_id == id, ]
    jetons <- DBI::dbGetQuery(con, paste0("SELECT DISTINCT comparison_content_version FROM ",
      "comparison_source_lineage WHERE comparison_family='scalar' AND facet_id=$1"),
      params = list(id))[[1L]]
    testthat::expect_identical(as.character(jetons), mk$content_version, info = id)      # :350 lineage==marker
    testthat::expect_equal(nombre(paste0("SELECT count(*) FROM scalar_comparison_group ",
      "WHERE indicator_id=$1"), id), mk$group_row_count, info = id)
    testthat::expect_equal(nombre(paste0("SELECT count(*) FROM scalar_comparison_territory ",
      "WHERE indicator_id=$1"), id), mk$territory_row_count, info = id)
    testthat::expect_equal(nombre(paste0("SELECT count(*) FROM comparison_source_lineage ",
      "WHERE comparison_family='scalar' AND facet_id=$1"), id), mk$lineage_row_count, info = id)
    # :1010-1013 group + territory results valid
    testthat::expect_equal(nombre(paste0("SELECT count(*) FROM scalar_comparison_group ",
      "WHERE indicator_id=$1 AND NOT ", groupe_valide), id), 0, info = id)
    testthat::expect_equal(nombre(paste0("SELECT count(*) FROM scalar_comparison_territory ",
      "WHERE indicator_id=$1 AND NOT ", territoire_valide), id), 0, info = id)
    # :1014-1017/353 _published_comparison_sources: each group's lineage_source_count is
    # the number of lineage rows JOINed to source_dataset and source_vintage.
    testthat::expect_equal(nombre(paste0("SELECT count(*) FROM scalar_comparison_group g WHERE ",
      "g.indicator_id=$1 AND g.lineage_source_count <> (SELECT count(*) FROM ",
      "comparison_source_lineage l JOIN source_dataset sd USING(source_id) ",
      "JOIN source_vintage sv USING(source_id,vintage_id) WHERE l.comparison_family='scalar' ",
      "AND l.comparison_context=g.comparison_context AND l.group_id=g.group_id ",
      "AND l.territory_type=g.territory_type AND l.facet_id=g.indicator_id)"), id), 0, info = id)
  }

  # _profile_comparison_publication_marker (snapshot_reads.py:412-440), computed profiles
  todos <- c(profils, profils_scalaires)
  rp <- registre(todos)
  p <- DBI::dbGetQuery(con, paste0("SELECT indicator_id,content_version,profile_content_version,",
    "reference_content_version,group_row_count,territory_row_count,lineage_row_count ",
    "FROM profile_resource_comparison_publication WHERE indicator_id IN (",
    dans(profils), ")"), params = as.list(profils))
  testthat::expect_setequal(p$indicator_id, profils)                        # :428
  testthat::expect_length(unique(p$reference_content_version), 1L)          # :430-432
  testthat::expect_true(all(p$reference_content_version == ref))            # :433-436
  testthat::expect_true(all(rp$reference_content_version[match(p$indicator_id, rp$resource_id)] ==
                              p$reference_content_version))               # :437
  testthat::expect_true(all(nzchar(p$content_version) & nzchar(p$profile_content_version))) # :436 not marker[0]/[1]
  testthat::expect_true(all(p$group_row_count >= 1 & p$territory_row_count >= 1))           # :438
  for (id in profils) {
    mk <- p[p$indicator_id == id, ]
    jetons <- DBI::dbGetQuery(con, paste0("SELECT DISTINCT comparison_content_version FROM ",
      "comparison_source_lineage WHERE comparison_family='profile' AND facet_id=$1"),
      params = list(id))[[1L]]
    testthat::expect_identical(as.character(jetons), mk$content_version, info = id)      # :350
    for (table in c("profile_comparison_group", "profile_comparison_territory")) {
      v <- DBI::dbGetQuery(con, paste0("SELECT DISTINCT profile_content_version,",
        "reference_content_version FROM ", table, " WHERE indicator_id=$1"), params = list(id))
      testthat::expect_identical(as.character(v$profile_content_version),
                                 mk$profile_content_version, info = paste(id, table))    # :545-546 pv==marker[1]
      testthat::expect_identical(as.character(v$reference_content_version),
                                 mk$reference_content_version, info = paste(id, table))  # rv==marker[2]
    }
    testthat::expect_equal(nombre(paste0("SELECT count(*) FROM profile_comparison_group ",
      "WHERE indicator_id=$1"), id), mk$group_row_count, info = id)
    testthat::expect_equal(nombre(paste0("SELECT count(*) FROM profile_comparison_territory ",
      "WHERE indicator_id=$1"), id), mk$territory_row_count, info = id)
    # :544-550 group/territory results valid (cohort-independent part)
    testthat::expect_equal(nombre(paste0("SELECT count(*) FROM profile_comparison_group ",
      "WHERE indicator_id=$1 AND NOT ", groupe_valide), id), 0, info = id)
    testthat::expect_equal(nombre(paste0("SELECT count(*) FROM profile_comparison_territory ",
      "WHERE indicator_id=$1 AND NOT ", territoire_valide), id), 0, info = id)
    testthat::expect_equal(nombre(paste0("SELECT count(*) FROM profile_comparison_group g WHERE ",
      "g.indicator_id=$1 AND g.lineage_source_count <> (SELECT count(*) FROM ",
      "comparison_source_lineage l JOIN source_dataset sd USING(source_id) ",
      "JOIN source_vintage sv USING(source_id,vintage_id) WHERE l.comparison_family='profile' ",
      "AND l.comparison_context=g.comparison_context AND l.group_id=g.group_id ",
      "AND l.territory_type=g.territory_type AND l.facet_id=g.indicator_id)"), id), 0, info = id)
  }

  # focal_profiles (profile_reads.py:22-55): every scalar-backed profile
  testthat::expect_length(unique(rp$reference_content_version), 1L)         # :22-25 uniform reference
  testthat::expect_true(all(rp$reference_content_version == ref))           # :26-27 live_territory_reference_version
  for (profil in profils_scalaires) {
    dep <- unname(dependances[[profil]])
    d <- DBI::dbGetQuery(con, paste0("SELECT unit,comparison_direction,allowed_levels,",
      "comparison_scalar,required_scalar_version FROM profile_descriptor WHERE indicator_id=$1"),
      params = list(profil))
    s <- DBI::dbGetQuery(con, paste0("SELECT s.unit,s.direction,s.comparison_facet,",
      "(SELECT bool_and(l=ANY(s.allowed_levels)) FROM unnest(p.allowed_levels) l) AS niveaux ",
      "FROM scalar_descriptor s, profile_descriptor p WHERE s.indicator_id=$1 AND p.indicator_id=$2"),
      params = list(dep, profil))
    mk <- DBI::dbGetQuery(con, paste0("SELECT scalar_content_version FROM ",
      "scalar_resource_comparison_publication WHERE indicator_id=$1"), params = list(dep))
    testthat::expect_identical(d$comparison_scalar, dep, info = profil)
    # :52 scalar_markers.get(dep) != required_scalar_version => 503 (THE adopt-then-503 condition)
    testthat::expect_identical(mk$scalar_content_version, d$required_scalar_version, info = profil)
    testthat::expect_true(nzchar(d$required_scalar_version), info = profil)
    testthat::expect_identical(registre(dep)$reference_content_version, ref, info = profil)  # :53
    testthat::expect_true(nrow(s) == 1L && s$unit == d$unit && s$direction == d$comparison_direction &&
      isTRUE(s$niveaux) && s$comparison_facet == dep, info = profil)                          # :54-55
  }
  invisible(list(scalaires = m, profils = p))
}

# AEDAR discovery: api/resource_catalogue.py:1026-1033 serves a resource only through a
# `resource_publication_descriptor` row joined to a NON-retired `resource_publication`
# row with the SAME content_version (`live`). One storage resource (`aedar`) projects
# both grammar identities.
.adopt_db_catalogue <- function(con) {
  DBI::dbGetQuery(con, paste0(
    "SELECT p.resource_id AS publication_id,p.content_version,d.resource_id,",
    "COALESCE(p.content_version=d.content_version AND NOT p.retired,false) AS live ",
    "FROM resource_publication_descriptor d LEFT JOIN resource_publication p ",
    "ON d.publication_resource_id=p.resource_id AND d.content_version=p.content_version ",
    "ORDER BY p.resource_id,d.resource_id"))
}
