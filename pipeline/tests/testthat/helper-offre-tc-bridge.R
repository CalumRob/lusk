# Fixtures for the guarded #1071 offre_tc serving bridge.
# These are synthetic, live-shaped scalar rows: they mimic the projection that
# is read back from the serving tables. No real territory, fact or publication
# token is copied here, and no database connection is needed.

bridge_fixture_metadata <- function() lire_theme_metadata("mobilite")

bridge_fixture_eligible <- function() {
  data.frame(
    territory_id = c("29001", "29002", "35001", "242900314", "53"),
    territory_type = c("commune", "commune", "commune", "epci", "region"),
    stringsAsFactors = FALSE)
}

bridge_fixture_vintage <- function(source_id = "korrigo") {
  data.frame(
    source_id = source_id,
    vintage_id = "2026-02/2026-02-28",
    version = "2026-02",
    reference_date = as.Date("2026-02-28"),
    publication_date = as.Date("2026-08-06"),
    stringsAsFactors = FALSE)
}

bridge_fixture_simple_descriptor <- function(id, label, facet = NA_character_) {
  data.frame(
    indicator_id = id, theme_id = "fixture",
    allowed_sources = I(list("fixture_source")),
    label = label, unit = "count", direction = "high",
    comparison_facet = facet, allowed_levels = I(list("commune")),
    denominator_semantics = "count", completeness = "sparse",
    descriptor_version = paste0("v1-", id), stringsAsFactors = FALSE)
}

# A live-shaped scalar snapshot with:
#   - two preserved indicators (one of them with a comparison facet);
#   - one of the 29 retired legacy ids;
#   - the old (building-based) offre_tc facts.
bridge_live_fixture <- function() {
  metadata <- bridge_fixture_metadata()
  eligible <- bridge_fixture_eligible()
  offre_tc_descriptor <- scalar_descriptor_row(metadata, "offre_tc")
  # The old serving state carries every owner-retired id, derived from the
  # canonical contract registry (never a literal list in the fixture).
  retired_ids <- retained_scalar_retirement_ids()
  retired_descriptors <- do.call(rbind, lapply(retired_ids, function(id)
    bridge_fixture_simple_descriptor(id, paste("Retired", id), id)))
  descriptors <- rbind(
    bridge_fixture_simple_descriptor("kept_scalar", "Kept", "kept_scalar"),
    bridge_fixture_simple_descriptor("other_kept", "Other kept"),
    retired_descriptors,
    # The DPE declared profile binds to this scalar facet; it must be present
    # for the registered profile publisher's facet validation.
    (function() {
      d <- bridge_fixture_simple_descriptor("part_passoires", "Passoires", "part_passoires")
      d$theme_id <- "habitat"; d$unit <- "%"; d$direction <- "low"
      d$allowed_levels <- I(list(c("commune", "epci", "departement", "region")))
      d$allowed_sources <- I(list("fixture_source"))
      d
    })(),
    offre_tc_descriptor)
  rownames(descriptors) <- NULL
  facts <- rbind(
    data.frame(indicator_id = "kept_scalar", territory_id = c("29001", "29002"),
               territory_type = "commune", value = c(1, 2), status = "measured",
               support_count = NA_integer_, denominator_count = NA_integer_,
               stringsAsFactors = FALSE),
    data.frame(indicator_id = "other_kept", territory_id = "29001",
               territory_type = "commune", value = 7, status = "measured",
               support_count = NA_integer_, denominator_count = NA_integer_,
               stringsAsFactors = FALSE),
    data.frame(indicator_id = "part_passoires", territory_id = c("29001", "29002"),
               territory_type = "commune", value = c(0.1, 0.2), status = "measured",
               support_count = NA_integer_, denominator_count = NA_integer_,
               stringsAsFactors = FALSE),
    do.call(rbind, lapply(retired_ids, function(id) data.frame(
      indicator_id = id, territory_id = "29001", territory_type = "commune",
      value = 0.4, status = "measured", support_count = NA_integer_,
      denominator_count = NA_integer_, stringsAsFactors = FALSE))),
    data.frame(indicator_id = "offre_tc", territory_id = c("29001", "29002"),
               territory_type = "commune", value = c(0.10, 0.20), status = "measured",
               support_count = NA_integer_, denominator_count = NA_integer_,
               stringsAsFactors = FALSE))
  rownames(facts) <- NULL
  n_kept <- 2L + 1L + 2L  # kept_scalar, other_kept, part_passoires
  n_retired <- length(retired_ids)
  provenance <- data.frame(
    indicator_id = c(rep("kept_scalar", 2L), "other_kept",
                     rep("part_passoires", 2L), retired_ids,
                     rep("offre_tc", 2L)),
    territory_id = c("29001", "29002", "29001", "29001", "29002",
                     rep("29001", n_retired), "29001", "29002"),
    source_id = c(rep("fixture_source", n_kept + n_retired), rep("korrigo", 2L)),
    vintage_id = c(rep("fixture/2025", n_kept + n_retired),
                   rep("2026-02/2026-02-28", 2L)),
    stringsAsFactors = FALSE)
  fixture_vintage <- data.frame(
    source_id = "fixture_source", vintage_id = "fixture/2025", version = "fixture",
    reference_date = as.Date("2025-01-01"), publication_date = as.Date("2025-01-02"),
    stringsAsFactors = FALSE)
  projection <- list(
    facts = facts, descriptors = descriptors, provenance = provenance,
    datasets = data.frame(
      source_id = c("fixture_source", "korrigo"),
      name = c("Fixture source", "Bretagne Mobilité"), stringsAsFactors = FALSE),
    vintages = rbind(fixture_vintage, bridge_fixture_vintage()),
    eligible_territories = eligible)
  validate_scalar_artifact_projection(projection)
  projection
}

# Producer-shaped rows: the output of produire_offre_tc_mobilite(), supplied by
# the operator as a private file. New address-based values for two communes.
bridge_fresh_offre_tc_rows <- function(values = c(0.9968, 0.9261)) {
  data.frame(
    territory_id = c("29001", "29002"), territory_type = "commune",
    indicator_id = "offre_tc", value = values, unit = "%",
    source_name = "Bretagne Mobilité", source_version = "2026-02",
    reference_date = "2026-02-28", publication_date = "2026-08-06",
    stringsAsFactors = FALSE)
}

bridge_fixture_reference_rows <- function() {
  data.frame(
    territory_id = c("29001", "29002", "35001", "242900314", "53"),
    territory_type = c("commune", "commune", "commune", "epci", "region"),
    name = c("A", "B", "C", "D", "Bretagne"),
    epci_id = c("242900314", "242900314", "242900314", NA_character_, NA_character_),
    density_class_code = c("A", "A", "B", NA_character_, NA_character_),
    littoral_code = c("C", "NC", "NC", NA_character_, NA_character_),
    littoral_classement_source = c("Mer", NA_character_, NA_character_, NA_character_, NA_character_),
    stringsAsFactors = FALSE)
}

bridge_fixture_expected_tokens <- function() {
  c(scalar = "scalar-live", comparison = "comparison-live",
    profile = "profile-live", habitat = "habitat-live",
    reference = "reference-live")
}

bridge_fixture_markers <- function(expected = bridge_fixture_expected_tokens()) {
  list(
    tables = data.frame(
      table_name = c("territory_reference", "scalar_observation",
                     "declared_profile", "selected_reading"),
      content_version = unname(expected[c("reference", "scalar", "profile", "habitat")]),
      reference_content_version = c(NA_character_, unname(expected[["reference"]]),
                                    unname(expected[["reference"]]),
                                    unname(expected[["reference"]])),
      stringsAsFactors = FALSE),
    comparison = data.frame(
      content_version = unname(expected[["comparison"]]),
      scalar_content_version = unname(expected[["scalar"]]),
      reference_content_version = unname(expected[["reference"]]),
      stringsAsFactors = FALSE),
    series = data.frame(dataset_id = character(), content_version = character(),
                        reference_content_version = character(), stringsAsFactors = FALSE),
    profile_comparison = data.frame(
      content_version = "profile-comparison-live", profile_content_version = unname(expected[["profile"]]),
      reference_content_version = unname(expected[["reference"]]),
      group_row_count = 1L, territory_row_count = 1L, stringsAsFactors = FALSE),
    selected_publication = data.frame(
      theme_id = "habitat", content_version = unname(expected[["habitat"]]),
      reference_content_version = unname(expected[["reference"]]), row_count = 2L,
      stringsAsFactors = FALSE),
    selected_descriptor = data.frame(
      theme_id = "habitat", descriptor_version = unname(expected[["habitat"]]),
      linked_content_version = paste("canonical", unname(expected[["profile"]]),
                                     unname(expected[["scalar"]]), unname(expected[["reference"]]), sep = "-"),
      stringsAsFactors = FALSE),
    profile_descriptor = data.frame(
      indicator_id = "distribution_dpe", descriptor_version = "dpe-live",
      required_scalar_version = unname(expected[["scalar"]]), stringsAsFactors = FALSE))
}

# Reconstruct the shape RPostgres returns for the serving tables from a
# projection fixture: descriptors lose their list columns (source rows move to
# scalar_descriptor_source, levels become a Postgres text-array literal).
bridge_db_rows_from_projection <- function(projection) {
  descriptors <- projection$descriptors
  sources <- do.call(rbind, lapply(seq_len(nrow(descriptors)), function(i)
    data.frame(indicator_id = descriptors$indicator_id[[i]],
               source_id = as.character(descriptors$allowed_sources[[i]][[1L]]),
               stringsAsFactors = FALSE)))
  pg_array <- function(x) paste0("{", paste(as.character(x), collapse = ","), "}")
  descriptor_rows <- data.frame(
    indicator_id = descriptors$indicator_id,
    theme_id = descriptors$theme_id,
    label = descriptors$label,
    unit = descriptors$unit,
    direction = descriptors$direction,
    comparison_facet = descriptors$comparison_facet,
    allowed_levels = vapply(descriptors$allowed_levels, pg_array, character(1)),
    denominator_semantics = descriptors$denominator_semantics,
    completeness = descriptors$completeness,
    descriptor_version = descriptors$descriptor_version,
    stringsAsFactors = FALSE)
  facts <- projection$facts
  facts$support_count <- as.numeric(facts$support_count)
  facts$denominator_count <- as.numeric(facts$denominator_count)
  reference <- bridge_fixture_reference_rows()
  list(
    facts = facts,
    descriptors = descriptor_rows,
    descriptor_sources = sources,
    provenance = projection$provenance,
    datasets = projection$datasets,
    vintages = projection$vintages,
    territories = reference[c("territory_id", "territory_type")],
    reference_rows = reference)
}

bridge_fake_reader <- function(rows, profile_rows = NULL) {
  if (is.null(profile_rows))
    profile_rows <- bridge_db_rows_from_profile_projections(bridge_live_profile_fixture())
  c(list(
    facts = function(con) rows$facts,
    descriptors = function(con) rows$descriptors,
    descriptor_sources = function(con) rows$descriptor_sources,
    provenance = function(con) rows$provenance,
    datasets = function(con) rows$datasets,
    vintages = function(con) rows$vintages,
    territories = function(con) rows$territories,
    reference_rows = function(con) rows$reference_rows),
    list(
      profile_descriptors = function(con) profile_rows$profile_descriptors,
      profile_sources = function(con) profile_rows$profile_sources,
      profile_axes = function(con) profile_rows$profile_axes,
      profile_facts = function(con) profile_rows$profile_facts,
      profile_provenance = function(con) profile_rows$profile_provenance))
}

bridge_fake_env <- function(values) function(name, unset = "") {
  if (name %in% names(values)) values[[name]] else unset
}


# Injectable adapters that satisfy the registered publisher contracts without a
# database. They record what the write path would have sent to PostgreSQL.
bridge_fake_scalar_adapter <- function(old_version, old_reference = "reference-live") {
  state <- new.env(parent = emptyenv())
  state$replaced <- NULL
  state$retired <- NULL
  list(
    transaction = function(expr) force(expr),
    lock = function(owner_arg) invisible(NULL),
    marker = function(name) data.frame(
      content_version = old_version, reference_content_version = old_reference,
      stringsAsFactors = FALSE),
    reference_marker = function() data.frame(
      content_version = old_reference, row_count = 4L, actual_rows = 4L,
      stringsAsFactors = FALSE),
    validate_territories = function(territories, descriptors) invisible(TRUE),
    validate_snapshot = function(projection, retired_indicator_ids = character()) {
      state$retired <- retired_indicator_ids
      list(pending_retirement = FALSE)
    },
    set_reference_version = function(version) invisible(NULL),
    replace = function(projection, version, retired_indicator_ids = character()) {
      state$replaced <- version
      state$retired <- retired_indicator_ids
      invisible(TRUE)
    },
    state = state)
}

bridge_fake_comparison_adapter <- function(old_version, input_scalar = "scalar-new") {
  state <- new.env(parent = emptyenv())
  state$replaced <- NULL
  list(
    transaction = function(expr) force(expr),
    lock = function() invisible(NULL),
    input_markers = function() data.frame(
      scalar_content_version = input_scalar,
      reference_content_version = "reference-live", stringsAsFactors = FALSE),
    marker = function() data.frame(
      content_version = old_version, scalar_content_version = input_scalar,
      reference_content_version = "reference-live", lineage_row_count = 1L,
      stringsAsFactors = FALSE),
    replace = function(projection) {
      state$replaced <- projection$content_version
      invisible(TRUE)
    },
    state = state)
}

bridge_fake_marker_writer <- function(old_linked = NULL) {
  state <- new.env(parent = emptyenv())
  list(
    set_habitat_linked = function(new_linked) {
      state$linked_new <- new_linked
      invisible(TRUE)
    },
    state = state)
}


# Live declared-profile projections for the lineage proof. Descriptor field
# order intentionally matches project_dpe_profile()/project_structure_age_profile()
# because those exact lists are the hash input of profile_content_version().
bridge_live_profile_fixture <- function(scalar_version = "scalar-live") {
  habitat <- lire_theme_metadata("habitat")
  demographie <- lire_theme_metadata("demographie")
  dpe_contract <- habitat$profile_contracts$distribution_dpe
  dpe_axes <- data.frame(
    axis_name = c("detail", "detail"), axis_key = c("ancien", "recent"),
    label = c("Ancien", "RÃ©cent"), ordinal = c(0L, 1L), unit = "%",
    stringsAsFactors = FALSE)
  dpe_descriptor <- list(
    indicator_id = "distribution_dpe", theme_id = "habitat", levels = "commune",
    details = c("ancien", "recent"), sexes = character(), label = "DPE", unit = "%",
    source = "fixture_source", comparison_detail = NA_character_,
    comparison_sex = NA_character_, comparison_direction = "low",
    comparison_scalar = "part_passoires", required_scalar_version = scalar_version,
    completeness = "dense_complete")
  dpe_descriptor$descriptor_version <- profile_content_version(
    list(dpe_descriptor, dpe_axes, dpe_contract))
  communes <- c("29001", "29002", "35001")
  dpe_facts <- data.frame(
    territory_id = rep(communes, each = 2L), territory_type = "commune",
    detail = rep(c("ancien", "recent"), length(communes)), sex = "",
    value = rep(c(0.3, 0.7), length(communes)), status = "measured",
    stringsAsFactors = FALSE)
  dpe_provenance <- data.frame(
    indicator_id = "distribution_dpe", territory_id = rep(communes, each = 2L),
    detail_key = rep(c("ancien", "recent"), length(communes)), sex_key = "",
    source_id = "fixture_source", vintage_id = "fixture/2025",
    stringsAsFactors = FALSE)

  structure_axes <- data.frame(
    axis_name = "detail", axis_key = "jeune", label = "Jeune", ordinal = 0L,
    unit = "%", stringsAsFactors = FALSE)
  structure_descriptor <- list(
    indicator_id = "structure_age", theme_id = "demographie", levels = "commune",
    details = "jeune", sexes = character(), label = "Structure", unit = "%",
    source = "fixture_source", comparison_detail = "jeune",
    comparison_sex = NA_character_, comparison_direction = "high",
    completeness = "dense_complete")
  structure_descriptor$descriptor_version <- profile_content_version(
    list(structure_descriptor, structure_axes))
  structure_facts <- data.frame(
    territory_id = communes, territory_type = "commune", detail = "jeune",
    sex = "", value = c(0.25, 0.30, 0.20), status = "measured",
    stringsAsFactors = FALSE)
  structure_provenance <- data.frame(
    indicator_id = "structure_age", territory_id = communes, detail_key = "jeune",
    sex_key = "", source_id = "fixture_source", vintage_id = "fixture/2025",
    stringsAsFactors = FALSE)

  vintage <- data.frame(
    source_id = "fixture_source", vintage_id = "fixture/2025", version = "fixture",
    reference_date = as.Date("2025-01-01"), publication_date = as.Date("2025-01-02"),
    stringsAsFactors = FALSE)
  dataset <- data.frame(source_id = "fixture_source", name = "Fixture source",
                        stringsAsFactors = FALSE)
  eligible <- data.frame(territory_id = communes, territory_type = "commune",
                         stringsAsFactors = FALSE)
  make <- function(descriptor, axes, facts, provenance) list(
    facts = facts, axes = axes, descriptor = descriptor, provenance = provenance,
    datasets = dataset, vintages = vintage, eligible_territories = eligible)
  profiles <- list(
    distribution_dpe = make(dpe_descriptor, dpe_axes, dpe_facts, dpe_provenance),
    structure_age = make(structure_descriptor, structure_axes, structure_facts,
                         structure_provenance))
  profiles
}

# Shape the profile projections exactly as the serving tables hold them, so the
# read-only R loader can be exercised without a database.
bridge_db_rows_from_profile_projections <- function(profiles) {
  descriptors <- do.call(rbind, lapply(profiles, function(p) {
    d <- p$descriptor
    data.frame(
      indicator_id = d$indicator_id, label = d$label, unit = d$unit,
      allowed_levels = I(list(as.character(d$levels))),
      completeness = d$completeness, descriptor_version = d$descriptor_version,
      denominator_semantics = if (is.null(d$denominator_semantics)) NA_character_ else d$denominator_semantics,
      detail_units_required = isTRUE(d$detail_units_required),
      comparison_detail = if (is.null(d$comparison_detail)) NA_character_ else d$comparison_detail,
      comparison_sex = if (is.null(d$comparison_sex)) NA_character_ else d$comparison_sex,
      comparison_direction = d$comparison_direction,
      theme_id = d$theme_id,
      comparison_scalar = if (is.null(d$comparison_scalar)) NA_character_ else d$comparison_scalar,
      required_scalar_version = if (is.null(d$required_scalar_version)) NA_character_ else d$required_scalar_version,
      stringsAsFactors = FALSE)
  }))
  rownames(descriptors) <- NULL
  sources <- do.call(rbind, lapply(profiles, function(p)
    data.frame(indicator_id = p$descriptor$indicator_id,
               source_id = as.character(p$descriptor$source), stringsAsFactors = FALSE)))
  axes <- do.call(rbind, lapply(names(profiles), function(owner) {
    a <- profiles[[owner]]$axes
    a$indicator_id <- owner
    a
  }))
  facts <- do.call(rbind, lapply(names(profiles), function(owner) {
    f <- profiles[[owner]]$facts
    data.frame(indicator_id = owner, territory_id = f$territory_id,
               territory_type = f$territory_type, detail_key = f$detail,
               sex_key = f$sex,
               detail_axis_name = "detail",
               sex_axis_name = if (length(profiles[[owner]]$descriptor$sexes)) "sex" else NA_character_,
               value = f$value, status = f$status, stringsAsFactors = FALSE)
  }))
  provenance <- do.call(rbind, lapply(profiles, `[[`, "provenance"))
  list(profile_descriptors = descriptors, profile_sources = sources,
       profile_axes = axes, profile_facts = facts,
       profile_provenance = provenance)
}

# A fake profile adapter for publish_registered_profile(); records the exact
# version/lineage the registered publisher would send to PostgreSQL.
bridge_fake_profile_adapter <- function(old_version = "profile-live",
                                        scalar_version = "scalar-live") {
  state <- new.env(parent = emptyenv())
  state$replaced <- NULL
  state$comparisons <- NULL
  list(
    transaction = function(expr) force(expr),
    lock = function(owner) invisible(NULL),
    marker = function(name) data.frame(
      content_version = if (identical(name, "scalar_observation")) scalar_version else old_version,
      reference_content_version = "reference-live", stringsAsFactors = FALSE),
    reference_marker = function() data.frame(
      content_version = "reference-live", row_count = 5L, actual_rows = 5L,
      stringsAsFactors = FALSE),
    validate_territories = function(territories, descriptor) invisible(TRUE),
    validate_scalar_facet = function(descriptor) invisible(TRUE),
    set_reference_version = function(version) invisible(NULL),
    prepare_comparisons = function(profiles, version, reference_version) {
      state$comparisons <- version
      list(stale = TRUE, projection = NULL)
    },
    replace = function(projection, version) {
      state$replaced <- version
      invisible(TRUE)
    },
    state = state)
}


# --- Round-2 review helpers: pure tests never touch the real environment ------
bridge_pure_config <- function() list(
  host = "192.168.1.120", port = 5432L,
  dbname = "lusk_it_contract", user = "lusk_it_contract_pub")

bridge_pure_identity <- function(con) data.frame(
  database = "lusk_it_contract", role = "lusk_it_contract_pub",
  stringsAsFactors = FALSE)

bridge_pure_connect <- function(cfg)
  stop("PURE TEST: DBI::dbConnect must never be called", call. = FALSE)

bridge_pure_env_clear <- function() {
  vars <- c("LUSK_PUBLISH_HOST", "LUSK_PUBLISH_PORT", "LUSK_PUBLISH_DATABASE",
            "LUSK_PUBLISH_USER", "PGPASSFILE", "LUSK_SCALAR_SCOPE",
            "LUSK_BRIDGE_DUMP_CONFIRMED", "LUSK_PUBLISH_OFFRE_TC_BRIDGE",
            unname(BRIDGE_EXPECTED_ENV), BRIDGE_FACTS_ENV)
  withr::local_envvar(setNames(rep(list(""), length(vars)), vars))
}

# Build the operator env values from the registered scope (resolved once) so no
# domain string is duplicated in the tests.
bridge_test_env_values <- function(expected, facts_path = "facts.rds", extra = list()) {
  scope <- bridge_scope()
  c(setNames(unname(expected), unname(BRIDGE_EXPECTED_ENV)),
    setNames(facts_path, BRIDGE_FACTS_ENV),
    setNames(paste0(scope$theme, ":", paste(scope$indicators, collapse = ",")),
             "LUSK_SCALAR_SCOPE"),
    setNames(c(bridge_pure_config()$dbname, bridge_pure_config()$user),
             c("LUSK_PUBLISH_DATABASE", "LUSK_PUBLISH_USER")),
    extra)
}


# --- Round-3: robust repo-root resolution for the guarded DB proof ------------
# testthat runs tests with cwd = pipeline/tests/testthat, NOT pipeline/. Resolve
# from testthat's own test path (or the cwd as a fallback) by walking up to the
# directory that actually contains api/schema.sql.
.bridge_db_repo_root_cache <- NULL
bridge_db_repo_root <- function(start = NULL) {
  explicit <- !is.null(start)
  if (!explicit && !is.null(.bridge_db_repo_root_cache))
    return(.bridge_db_repo_root_cache)
  if (!explicit) start <- tryCatch(testthat::test_path(), error = function(e) getwd())
  current <- normalizePath(start, winslash = "/", mustWork = TRUE)
  repeat {
    if (file.exists(file.path(current, "api", "schema.sql"))) {
      if (!explicit) .bridge_db_repo_root_cache <<- current
      return(current)
    }
    parent <- dirname(current)
    if (identical(parent, current)) break
    current <- parent
  }
  stop("Cannot locate the repository root containing api/schema.sql from '",
       start, "'; testthat must run with the project checkout intact", call. = FALSE)
}

bridge_db_schema_path <- function() {
  path <- file.path(bridge_db_repo_root(), "api", "schema.sql")
  if (!file.exists(path))
    stop("Serving schema is missing: ", path, call. = FALSE)
  path
}

