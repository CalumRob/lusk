# Owner-scoped typed-reading serving artifacts (#757). The transport is shared
# with the scalar, ordered-series and declared-profile grains; this file covers
# the reading family contract, the round-trip fidelity anchor of every reading
# owner, the one content-version rule per reading, the theme materializer, and
# every fail-closed reader guard.

fixture_mobility_reading_metadata <- function(reference_date = "2026-02-28", version = "v1") {
  list(sources = list(tot_loss_t = "mobilite_snapshot", tot_loss_b = "mobilite_snapshot"),
    story_keys = c("vingt-minutes-sans-voiture", "ce-que-le-velo-preserve"),
    selected_reading_contract = list(unit = "types de services", direction = "low",
      allowed_levels = c("commune", "epci", "departement", "region"), missing_status = "unavailable",
      classification_values = c("saillant", "notable", "non-saillant"),
      field_keys = c("groupe", "story_key", "salience_reason", "classification_saillance",
        "div_loss_t", "div_loss_b", "status")),
    source_records = list(mobilite_snapshot = list(dataset = "Mobility snapshot dataset",
      publisher = "Distinct publishing organisation",
      vintages = list(list(id = "mobilite_snapshot", version = version,
        dateReference = reference_date, datePublication = "2026-08-06")),
      clocks = list(list(name = "BPE", frequency = "annual", reference = "2024", trigger = "new release"),
        list(name = "Buildings", frequency = "campaign", reference = "2025-07", trigger = "new campaign")))))
}

fixture_mobility_reading_fixture <- function() {
  # The selected rows are the first and the third, so the projection keeps the
  # non-sequential row names of its source selection.
  histories <- data.frame(territoire = c("35238", "35239", "35047"), type = "commune",
    theme = c("mobilite", "autre", "mobilite"), groupe = "acces-aux-services",
    story_key = c("vingt-minutes-sans-voiture", "ignored", "ce-que-le-velo-preserve"),
    salience_reason = c("defaut", "ignored", "delta-velo-saillant"),
    div_loss_t = c(8, 99, 12), div_loss_b = c(5, 99, 2),
    classification_saillance = c("notable", "ignored", "saillant"), stringsAsFactors = FALSE)
  vintages <- data.frame(id = "mobilite_snapshot", source = MOBILITE_SNAPSHOT_SOURCE, version = "v1",
    date_reference = "2026-02-28", date_publication = "2026-08-06", stringsAsFactors = FALSE)
  metadata <- fixture_mobility_reading_metadata()
  list(histories = histories, vintages = vintages, metadata = metadata,
    reading = project_mobility_reading(histories, vintages, metadata),
    legacy_version = mobility_reading_content_version(histories, vintages, metadata))
}

fixture_economy_reading_fixture <- function() {
  histories <- data.frame(territoire = "35238", type = "commune", theme = "economie",
    groupe = "activites", story_key = "top-activites", salience_reason = "declared",
    top1_activity_code = "62", top1_activity_label = "Programmation", top1_lq = 2.5, top1_n = 120,
    top1_part_parc = 0.4, top2_activity_code = NA_character_, top2_activity_label = NA_character_,
    top2_lq = NA_real_, top2_n = NA_real_, top2_part_parc = NA_real_,
    top3_activity_code = NA_character_, top3_activity_label = NA_character_, top3_lq = NA_real_,
    top3_n = NA_real_, top3_part_parc = NA_real_, top4_activity_code = NA_character_,
    top4_activity_label = NA_character_, top4_lq = NA_real_, top4_n = NA_real_,
    top4_part_parc = NA_real_, top5_activity_code = NA_character_, top5_activity_label = NA_character_,
    top5_lq = NA_real_, top5_n = NA_real_, top5_part_parc = NA_real_, stringsAsFactors = FALSE)
  metadata <- list(sources = list(eco_activites = "bpe_activites"),
    subgroups = list(list(key = "activites", reading = list(story_key = "top-activites"))))
  # A declared source clock with a NULL publication date, as the merged vintage
  # manifest allows.
  vintages <- data.frame(id = "bpe_activites", source = "Producer BPE source", version = "2026-04",
    date_reference = "2026-03-31", date_publication = NA_character_, stringsAsFactors = FALSE)
  list(histories = histories, vintages = vintages, metadata = metadata,
    reading = project_economy_reading(histories, vintages, metadata))
}

fixture_demographic_reading_fixture <- function() {
  histories <- data.frame(territoire = c("35238", "35047"), type = "commune", theme = "demographie",
    groupe = "demographie", story_key = "trajectory", salience_reason = "defaut", periode = "2017-2023",
    solde_naturel = c(6700, NA_real_), solde_migratoire = c(7375, NA_real_),
    taux_solde_naturel = c(4.9884038225, NA_real_), taux_solde_migratoire = c(5.4909668941, NA_real_),
    classification = c("attire-renouvelle", NA_character_), stringsAsFactors = FALSE)
  territories <- data.frame(territoire = c("35238", "35047"), type = "commune", stringsAsFactors = FALSE)
  vintages <- data.frame(id = "serie_historique", source = "Producer INSEE source", version = "2023",
    date_reference = "2023-01-01", date_publication = "2023-06-01", stringsAsFactors = FALSE)
  metadata <- list(param_labels = list(taux_solde_naturel = "Taux de solde naturel (‰/an)"))
  list(histories = histories, territories = territories, vintages = vintages, metadata = metadata,
    reading = project_demographic_reading(histories, territories, vintages, metadata))
}

fixture_habitat_reading_fixture <- function() {
  # Four source states in one reading: measured, suppressed below the declared
  # threshold, a missing measurement, and a zero-support reading.
  histories <- data.frame(territoire = c("35238", "22006", "22007", "22008"), type = "commune",
    theme = "habitat", groupe = "etat-energetique-du-parc",
    story_key = "etat-energetique-du-parc", salience_reason = "defaut",
    classification = c("parc-intermediaire", NA, NA, NA),
    part_passoires = c(.05, NA, NA, NA), part_abc = c(.48, NA, NA, NA),
    n_dpe = c(100, 24, NA, 0), stringsAsFactors = FALSE)
  vintages <- data.frame(id = "dpe_22", source = "Producer DPE source", version = "2026-08-11",
    date_reference = NA_character_, date_publication = "2026-08-11", stringsAsFactors = FALSE)
  metadata <- list(sources = list(part_passoires = "dpe_22"),
    scalar_contracts = list(part_passoires = list(suppressed_below = 30,
      zero_support_status = "not_available")))
  list(histories = histories, vintages = vintages, metadata = metadata,
    reading = project_habitat_reading(histories, vintages, metadata))
}

# The Milieux reading projector needs the full canonical OCS-GE indicator
# payload (built by test-publish-series.R); its persisted pieces are exercised
# here from the pieces themselves, which is what the transport has to preserve.
fixture_milieux_reading_fixture <- function() {
  facts <- data.frame(territory_id = c("35238", "35047"), territory_type = "commune",
    groupe = "artificialisation", story_key = "artif-par-habitant", salience_reason = "declared",
    periode_pop = "2012-2017", periode_artif = "2011-2021",
    delta_population = c(125, NA_real_), taux_variation_population = c(4.7, NA_real_),
    artif_m2_par_habitant = c(321.5, NA_real_), artif_m3_par_habitant = c(101.2, NA_real_),
    trajectoire_artif_par_habitant = c("stable", NA_character_),
    classification = c("pression-moderee", NA_character_),
    status = c("measured", "unavailable"), source_id = "serie_historique",
    vintage_id = "2023/2023-01-01", population_source_version = "2023",
    population_source_reference_date = as.Date(c("2023-01-01", NA)),
    population_source_publication_date = as.Date(c(NA, NA)), stringsAsFactors = FALSE)
  row.names(facts) <- c("5", "9")
  revision_id <- "serie_historique-2023-6ad9e5ea1dc6b2c9"
  bindings <- data.frame(territory_id = c("35238", "35238", "35047"), territory_type = "commune",
    groupe = "artificialisation", field_key = c("artif_m2_par_habitant", "population", "population"),
    source_id = c("ocsge_artificialisation_35_2020", "serie_historique", "serie_historique"),
    vintage_id = c("2020/2020-01-01", "2023/2023-01-01", "2023/2023-01-01"),
    source_name = c("Producer OCS-GE source", "Producer INSEE source", "Producer INSEE source"),
    source_version = c("2020", "2023", "2023"), reference_date = as.Date(c("2020-01-01", "2023-01-01", "2023-01-01")),
    publication_date = as.Date(c(NA, NA, NA)), dataset_id = c("ocsge_artif_etats", NA, NA),
    dataset_content_version = c(strrep("c", 32L), NA_character_, NA_character_),
    state_role = c("M2", NA, NA), observation_period = c("2021", "2012-2017", "2012-2017"),
    axis_value = c("2021", NA, NA), provenance_revision_id = c("ocsge-2020-aaaa", NA, NA),
    population_revision_id = c(NA_character_, revision_id, revision_id), stringsAsFactors = FALSE)
  revision <- data.frame(population_revision_id = revision_id, source_id = "serie_historique",
    vintage_id = "2023/2023-01-01", source_name = "Producer INSEE source",
    dataset_name = "Canonical population dataset", source_version = "2023",
    reference_date = as.Date("2023-01-01"), publication_date = as.Date(NA),
    revision_hash = strrep("6a", 16L), stringsAsFactors = FALSE)
  projection <- list(facts = facts, source_bindings = bindings, population_revisions = revision)
  list(histories = NULL, vintages = NULL, metadata = NULL,
    projection = projection, reading = assemble_typed_reading(projection, "milieux"))
}

# Every reading owner, projected from its own producer contract.
fixture_typed_readings <- function() {
  fixtures <- list(mobilite = fixture_mobility_reading_fixture(),
    economie = fixture_economy_reading_fixture(),
    demographie = fixture_demographic_reading_fixture(),
    habitat = fixture_habitat_reading_fixture(),
    milieux = fixture_milieux_reading_fixture())
  fixtures$mobilite$projection <- typed_reading_projection(fixtures$mobilite$reading, "mobilite",
    fixtures$mobilite$metadata, fixtures$mobilite$vintages)
  fixtures$economie$projection <- typed_reading_projection(fixtures$economie$reading, "economie",
    fixtures$economie$metadata, fixtures$economie$vintages)
  fixtures$demographie$projection <- typed_reading_projection(fixtures$demographie$reading, "demographie",
    fixtures$demographie$metadata, fixtures$demographie$vintages)
  fixtures$habitat$projection <- typed_reading_projection(fixtures$habitat$reading, "habitat",
    fixtures$habitat$metadata, fixtures$habitat$vintages)
  fixtures
}

typed_reading_root <- function(label) {
  root <- tempfile(paste0(label, "-"))
  dir.create(root)
  root
}

test_that("typed reading serving owners and their persisted fields derive from the reading family", {
  contracts <- typed_reading_artifact_contracts()
  expect_setequal(names(contracts), c("mobilite", "economie", "demographie", "habitat", "milieux"))
  expect_identical(typed_reading_artifact_fields("mobilite")$table_fields, c("facts", "stories", "clocks"))
  expect_identical(typed_reading_artifact_fields("mobilite")$json_fields, "descriptor")
  expect_identical(typed_reading_artifact_fields("economie")$table_fields, c("facts", "source"))
  expect_length(typed_reading_artifact_fields("economie")$json_fields, 0L)
  expect_identical(typed_reading_artifact_fields("demographie")$table_fields, "facts")
  expect_identical(typed_reading_artifact_fields("demographie")$json_fields, "descriptor")
  expect_identical(typed_reading_artifact_fields("habitat")$table_fields, c("facts", "vintage"))
  expect_length(typed_reading_artifact_fields("habitat")$json_fields, 0L)
  expect_identical(typed_reading_artifact_fields("milieux")$table_fields,
    c("facts", "source_bindings", "population_revisions"))
  expect_length(typed_reading_artifact_fields("milieux")$json_fields, 0L)
  expect_error(typed_reading_artifact_fields("acces_aux_services"), "Unknown typed-reading artifact owner")
  expect_error(typed_reading_artifact_fields(character()), "required")
  # The reading directory layout is owner-scoped under the published data root.
  expect_identical(typed_reading_artifact_directory("../public/data", "habitat"),
    file.path("../public/data", "typed-reading-serving", "habitat"))
})

test_that("every typed reading round-trips its owner generation as the projector's own reading", {
  root <- typed_reading_root("typed-reading-serving")
  on.exit(unlink(root, recursive = TRUE), add = TRUE)
  fixtures <- fixture_typed_readings()
  expect_setequal(names(fixtures), names(typed_reading_artifact_contracts()))

  for (owner in names(fixtures)) {
    fixture <- fixtures[[owner]]
    directory <- typed_reading_artifact_directory(root, owner)
    version <- write_typed_reading_artifact(fixture$projection, directory, owner)
    publication <- read_typed_reading_publication(directory, owner)
    # Fidelity anchor: the read-back projection must hash to exactly the version
    # the writer recorded, so a piece the transport fails to preserve cannot slip
    # through; and the assembled reading must be the projector-shaped object
    # again, attributes included — no extra attribute may appear, because an
    # extra one would change a database content version for unchanged facts.
    expect_identical(publication$content_version, version)
    # The transport hashes the canonical projection (the form its reader rebuilds
    # from Parquet), so the recorded version is the version of that canonical
    # projection, not of the volatile allocation flags of the in-memory one.
    expect_identical(publication$content_version,
      typed_reading_content_version(canonicalize_typed_reading_projection(fixture$projection), owner))
    expect_identical(publication$projection, canonicalize_typed_reading_projection(fixture$projection))
    expect_identical(publication$reading, fixture$reading)
    expect_identical(names(attributes(publication$reading)), names(attributes(fixture$reading)))
    expect_identical(read_typed_reading_artifact(directory, owner), publication$projection)
    expect_identical(basename(dirname(directory)), "typed-reading-serving")
  }

  # Republishing identical content reuses the immutable generation.
  pointer <- readLines(file.path(root, "typed-reading-serving", "habitat", "current.json"), warn = FALSE)
  again <- write_typed_reading_artifact(fixtures$habitat$projection,
    typed_reading_artifact_directory(root, "habitat"), "habitat")
  expect_identical(again, typed_reading_content_version(fixtures$habitat$projection, "habitat"))
  expect_identical(readLines(file.path(root, "typed-reading-serving", "habitat", "current.json"),
    warn = FALSE), pointer)
})

test_that("reading pieces keep their selection row names and typed missing values", {
  root <- typed_reading_root("typed-reading-fidelity")
  on.exit(unlink(root, recursive = TRUE), add = TRUE)
  fixtures <- fixture_typed_readings()
  for (owner in names(fixtures)) write_typed_reading_artifact(fixtures[[owner]]$projection,
    typed_reading_artifact_directory(root, owner), owner)

  mobility <- read_typed_reading_publication(
    typed_reading_artifact_directory(root, "mobilite"), "mobilite")
  expect_identical(row.names(mobility$projection$facts), c("1", "3"))
  expect_identical(mobility$projection$facts$status, c("measured", "measured"))
  # The serving descriptor is stored without its story/clock tables and without
  # descriptor_version: both are rebuilt on assembly.
  mobility_directory <- typed_reading_artifact_directory(root, "mobilite")
  expect_false(is.null(fixtures$mobilite$projection$descriptor$descriptor_version))
  expect_true(all(c("stories", "clocks") %in% names(attr(mobility$reading, "serving_contract"))))
  contract <- attr(mobility$reading, "serving_contract")
  expect_identical(contract$descriptor_version,
    scalar_content_version(contract[setdiff(names(contract), "descriptor_version")]))
  expect_identical(contract$story_count, nrow(contract$stories))
  expect_identical(contract$clock_count, nrow(contract$clocks))

  habitat <- read_typed_reading_publication(
    typed_reading_artifact_directory(root, "habitat"), "habitat")
  expect_identical(habitat$reading$status,
    c("measured", "suppressed", "unavailable", "unavailable"))
  # A NULL source reference date stays NA rather than being dropped or filled.
  expect_true(is.na(habitat$projection$vintage$date_reference[[1L]]))
  expect_true(is.na(attr(habitat$reading, "vintage")$date_reference[[1L]]))
  expect_identical(attr(habitat$reading, "vintage"), habitat$projection$vintage)

  # A declared source clock with no reference date is written as JSON null in the
  # serving descriptor; it must decode back to a length-one typed NA, never to a
  # dropped element.
  null_root <- typed_reading_root("typed-reading-null-clock")
  on.exit(unlink(null_root, recursive = TRUE), add = TRUE)
  null_fixture <- fixture_mobility_reading_fixture()
  null_metadata <- fixture_mobility_reading_metadata(NULL)
  null_vintages <- null_fixture$vintages
  null_vintages$date_reference <- NA_character_
  null_reading <- project_mobility_reading(null_fixture$histories, null_vintages, null_metadata)
  null_projection <- typed_reading_projection(null_reading, "mobilite", null_metadata, null_vintages)
  write_typed_reading_artifact(null_projection,
    typed_reading_artifact_directory(null_root, "mobilite"), "mobilite")
  null_publication <- read_typed_reading_publication(
    typed_reading_artifact_directory(null_root, "mobilite"), "mobilite")
  expect_identical(attr(null_publication$reading, "serving_contract")$reference_date, NA_character_)
  expect_identical(attr(null_publication$reading, "serving_contract")$vintage_id, "v1/NA")
  expect_identical(null_publication$reading, null_reading)

  milieux <- read_typed_reading_publication(
    typed_reading_artifact_directory(root, "milieux"), "milieux")
  # Non-sequential row names, NULL publication dates and typed NA character
  # columns all survive the transport.
  expect_identical(row.names(milieux$projection$facts), c("5", "9"))
  expect_true(is.na(milieux$projection$facts$classification[[2L]]))
  expect_true(is.na(milieux$projection$population_revisions$publication_date[[1L]]))
  expect_identical(class(milieux$projection$population_revisions$reference_date), "Date")
  expect_identical(milieux$projection$source_bindings$dataset_content_version[[1L]], strrep("c", 32L))
  expect_true(is.na(milieux$projection$source_bindings$dataset_content_version[[2L]]))
  expect_identical(attr(milieux$reading, "population_revisions"),
    milieux$projection$population_revisions)
})

test_that("each reading has exactly one content-version rule over its persisted pieces", {
  fixtures <- fixture_typed_readings()
  mobility <- fixtures$mobilite
  # Mobility reuses the projector's own rule, so the cutover cannot silently
  # change an existing Mobility reading version.
  expect_identical(typed_reading_content_version(mobility$projection, "mobilite"),
    mobility$legacy_version)
  economy <- fixtures$economie
  expect_identical(typed_reading_content_version(economy$projection, "economie"),
    scalar_content_version(list(facts = economy$projection$facts, source = economy$projection$source)))
  demographic <- fixtures$demographie
  expect_identical(typed_reading_content_version(demographic$projection, "demographie"),
    scalar_content_version(list(facts = demographic$projection$facts,
      descriptor = demographic$projection$descriptor)))
  habitat <- fixtures$habitat
  expect_identical(typed_reading_content_version(habitat$projection, "habitat"),
    scalar_content_version(list(facts = habitat$projection$facts, vintage = habitat$projection$vintage)))
  milieux <- fixtures$milieux
  expect_identical(typed_reading_content_version(milieux$projection, "milieux"),
    scalar_content_version(list(facts = milieux$projection$facts,
      source_bindings = milieux$projection$source_bindings,
      population_revisions = milieux$projection$population_revisions)))
})

test_that("a missing, tampered, foreign or stale reading generation fails closed", {
  root <- typed_reading_root("typed-reading-guards")
  on.exit(unlink(root, recursive = TRUE), add = TRUE)
  fixture <- fixture_typed_readings()$mobilite
  directory <- typed_reading_artifact_directory(root, "mobilite")
  expect_error(read_typed_reading_publication(tempfile("absent-"), "mobilite"),
    "Typed canonical artifact is missing")

  write_typed_reading_artifact(fixture$projection, directory, "mobilite")
  expect_error(read_typed_reading_publication(directory, "habitat"),
    "Typed artifact pointer is invalid")

  generation <- jsonlite::fromJSON(file.path(directory, "current.json"))$generation
  # Content tamper: a rewritten table no longer matches its recorded checksum.
  nanoparquet::write_parquet(transform(fixture$projection$facts, status = "unavailable"),
    file.path(directory, generation, "facts.parquet"))
  expect_error(read_typed_reading_publication(directory, "mobilite"), "checksum mismatch")
  unlink(directory, recursive = TRUE)

  write_typed_reading_artifact(fixture$projection, directory, "mobilite")
  generation <- jsonlite::fromJSON(file.path(directory, "current.json"))$generation
  # Stale pointer: the generation was published for another content version.
  pointer <- jsonlite::fromJSON(file.path(directory, "current.json"), simplifyVector = FALSE)
  pointer$semantic_version <- strrep("0", 32L)
  jsonlite::write_json(pointer, file.path(directory, "current.json"), auto_unbox = TRUE)
  expect_error(read_typed_reading_publication(directory, "mobilite"), "Typed artifact version mismatch")
  unlink(directory, recursive = TRUE)

  write_typed_reading_artifact(fixture$projection, directory, "mobilite")
  generation <- jsonlite::fromJSON(file.path(directory, "current.json"))$generation
  # Stale manifest: the recorded content version no longer describes the pieces.
  manifest <- jsonlite::fromJSON(file.path(directory, generation, "manifest.json"), simplifyVector = FALSE)
  manifest$semantic_version <- strrep("0", 32L)
  jsonlite::write_json(manifest, file.path(directory, generation, "manifest.json"), auto_unbox = TRUE)
  pointer <- jsonlite::fromJSON(file.path(directory, "current.json"), simplifyVector = FALSE)
  pointer$semantic_version <- strrep("0", 32L)
  jsonlite::write_json(pointer, file.path(directory, "current.json"), auto_unbox = TRUE)
  expect_error(read_typed_reading_publication(directory, "mobilite"),
    "Typed artifact semantic content version mismatch")

  # A reading that no longer satisfies its own contract is refused on write.
  broken <- fixture$projection
  broken$stories <- transform(broken$stories, story_key = "unknown-story")
  expect_error(write_typed_reading_artifact(broken, tempfile("broken-"), "mobilite"),
    "does not match its serving contract")
})

test_that("the theme reading materializer is owner-scoped and silent without a reading", {
  root <- typed_reading_root("typed-reading-materialize")
  on.exit(unlink(root, recursive = TRUE), add = TRUE)
  fixture <- fixture_mobility_reading_fixture()
  payload <- list(histoires = fixture$histories, territoires = NULL, indicateurs = NULL)

  published <- materialize_theme_typed_reading_artifacts(payload, fixture$metadata, fixture$vintages,
    "mobilite", root)
  expect_identical(published, typed_reading_content_version(
    read_typed_reading_artifact(typed_reading_artifact_directory(root, "mobilite"), "mobilite"),
    "mobilite"))
  expect_true(file.exists(file.path(root, "typed-reading-serving", "mobilite", "current.json")))

  # Themes outside the reading family materialize nothing at all.
  expect_null(materialize_theme_typed_reading_artifacts(payload, fixture$metadata, fixture$vintages,
    "programmes", root))
  expect_false(dir.exists(file.path(root, "typed-reading-serving", "programmes")))
  # A reading theme without its reading inputs fails closed instead of writing
  # an empty artifact.
  expect_error(materialize_theme_typed_reading_artifacts(list(histoires = fixture$histories),
    fixture$metadata, fixture$vintages, "milieux", root), "missing fields for milieux")
})

test_that("production reading publishers read the artifact and refuse a legacy Parquet fallback", {
  root <- typed_reading_root("typed-reading-production")
  on.exit(unlink(root, recursive = TRUE), add = TRUE)
  fixture <- fixture_typed_readings()$mobilite

  # Only the legacy theme Parquet history is present: the production readers must
  # fail closed rather than re-project it. No database connection is opened,
  # because the artifact is required before any publication.
  nanoparquet::write_parquet(fixture$histories, file.path(root, "histoires_mobilite.parquet"))
  expect_error(publish_canonical_mobility_reading(NULL, root), "Typed canonical artifact is missing")
  expect_error(publish_canonical_demographic_reading(NULL, root), "Typed canonical artifact is missing")
  expect_error(read_typed_reading_publication_from(root, "economie"), "Typed canonical artifact is missing")
  expect_error(publish_canonical_milieux_reading(NULL, root),
    "Milieux vintage and territory artifacts are required")

  # The shared grains Milieux keeps are not a fallback either: with them present
  # the owned OCS-GE serving artifact is still required.
  nanoparquet::write_parquet(fixture$vintages, file.path(root, "vintages.parquet"))
  nanoparquet::write_parquet(data.frame(territoire = "35238", type = "commune"),
    file.path(root, "territoires.parquet"))
  expect_error(publish_canonical_milieux_reading(NULL, root), "artifact")

  # Every production entry point publishes the artifact's reading through the
  # registered publisher: the identity projector is the whole projection step.
  registry <- register_typed_reading_artifact_publisher(list(), "mobilite", publish_mobility_reading)
  expect_identical(registry$mobilite$project(list(reading = fixture$reading)), fixture$reading)
  expect_identical(registry$mobilite$publish, publish_mobility_reading)
})
