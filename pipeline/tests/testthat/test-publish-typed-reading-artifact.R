# Owner-scoped typed-reading serving artifacts (#757). The transport is shared
# with the scalar, ordered-series and declared-profile grains; this file covers
# the reading family contract, the round-trip fidelity anchor of every reading
# owner, the one content-version rule per reading, the theme materializer, and
# every fail-closed reader guard.

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
  metadata <- list(param_labels = list(taux_solde_naturel = "Taux de solde naturel (‰/an)"),
    semantic_resources=list(list(kind="typed_reading",source_keys="serie_historique")))
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

fixture_typed_readings <- function() {
  fixtures <- list(economie = fixture_economy_reading_fixture(),
    demographie = fixture_demographic_reading_fixture(),
    habitat = fixture_habitat_reading_fixture(),
    milieux = fixture_milieux_reading_fixture())
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
  expect_setequal(names(contracts), c("economie", "demographie", "habitat", "milieux"))
  expect_error(typed_reading_artifact_fields("mobilite"), "Unknown typed-reading artifact owner")
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

test_that("demographic reading keeps the canonical source clock identity through projection and artifact validation", {
  fixture <- fixture_demographic_reading_fixture()
  materialized <- project_theme_typed_reading_artifact(
    list(histoires=fixture$histories,territoires=fixture$territories),fixture$metadata,
    fixture$vintages,"demographie")
  facts <- assemble_typed_reading(materialized,"demographie")
  expect_identical(facts$source_id, rep("serie_historique", nrow(facts)))
  expect_identical(facts$vintage_id, rep("2023/2023-01-01", nrow(facts)))
  projection <- typed_reading_projection(facts, "demographie", fixture$metadata, fixture$vintages)
  expect_identical(projection$descriptor$source_clock$source_id, "serie_historique")
  expect_identical(projection$descriptor$source_clock$version, "2023")
  expect_identical(projection$descriptor$source_clock$reference_date, "2023-01-01")
  expect_identical(projection$descriptor$source_clock$publication_date, "2023-06-01")
  expect_silent(validate_typed_reading_projection(projection, "demographie"))
  root <- typed_reading_root("demographic-clock")
  on.exit(unlink(root,recursive=TRUE),add=TRUE)
  directory <- typed_reading_artifact_directory(root,"demographie")
  write_typed_reading_artifact(materialized,directory,"demographie")
  reloaded <- read_typed_reading_publication(directory,"demographie")
  expect_identical(reloaded$reading$vintage_id,rep("2023/2023-01-01",nrow(facts)))
  expect_identical(attr(reloaded$reading,"source_clock"),
    as.data.frame(materialized$descriptor$source_clock,stringsAsFactors=FALSE,optional=TRUE))

  other <- fixture$vintages
  other$version <- "2024"; other$date_reference <- "2024-01-01"
  changed <- project_demographic_reading(fixture$histories, fixture$territories, other, fixture$metadata)
  expect_identical(changed$vintage_id, rep("2024/2024-01-01", nrow(changed)))
  version_only <- fixture$vintages; version_only$version <- "2024"
  expect_identical(project_demographic_reading(fixture$histories,fixture$territories,
    version_only,fixture$metadata)$vintage_id,rep("2024/2023-01-01",nrow(facts)))
  date_only <- fixture$vintages; date_only$date_reference <- "2024-01-01"
  expect_identical(project_demographic_reading(fixture$histories,fixture$territories,
    date_only,fixture$metadata)$vintage_id,rep("2023/2024-01-01",nrow(facts)))
  expect_false(identical(typed_reading_content_version(projection, "demographie"),
    typed_reading_content_version(typed_reading_projection(changed, "demographie", fixture$metadata, other), "demographie")))

  wrong_id <- projection
  wrong_id$facts$vintage_id[] <- "serie_historique"
  expect_error(validate_typed_reading_projection(wrong_id, "demographie"), "source clock")
  wrong_source <- projection
  wrong_source$facts$source_id[] <- "another_dataset"
  expect_error(validate_typed_reading_projection(wrong_source, "demographie"), "source clock")
  stale <- projection
  stale$descriptor$source_clock$vintage_id <- "2022/2022-01-01"
  expect_error(validate_typed_reading_projection(stale, "demographie"), "source clock")
  missing_clock <- projection
  missing_clock$descriptor$source_clock <- NULL
  expect_error(validate_typed_reading_projection(missing_clock, "demographie"), "rematerialize")
})

test_that("reading pieces keep their selection row names and typed missing values", {
  root <- typed_reading_root("typed-reading-fidelity")
  on.exit(unlink(root, recursive = TRUE), add = TRUE)
  fixtures <- fixture_typed_readings()
  for (owner in names(fixtures)) write_typed_reading_artifact(fixtures[[owner]]$projection,
    typed_reading_artifact_directory(root, owner), owner)

  habitat <- read_typed_reading_publication(
    typed_reading_artifact_directory(root, "habitat"), "habitat")
  expect_identical(habitat$reading$status,
    c("measured", "suppressed", "unavailable", "unavailable"))
  # A NULL source reference date stays NA rather than being dropped or filled.
  expect_true(is.na(habitat$projection$vintage$date_reference[[1L]]))
  expect_true(is.na(attr(habitat$reading, "vintage")$date_reference[[1L]]))
  expect_identical(attr(habitat$reading, "vintage"), habitat$projection$vintage)

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
  fixture <- fixture_typed_readings()$habitat
  directory <- typed_reading_artifact_directory(root, "habitat")
  expect_error(read_typed_reading_publication(tempfile("absent-"), "habitat"),
    "Typed canonical artifact is missing")

  write_typed_reading_artifact(fixture$projection, directory, "habitat")
  expect_error(read_typed_reading_publication(directory, "economie"),
    "Typed artifact pointer is invalid")

  generation <- jsonlite::fromJSON(file.path(directory, "current.json"))$generation
  # Content tamper: a rewritten table no longer matches its recorded checksum.
  nanoparquet::write_parquet(transform(fixture$projection$facts, status = "unavailable"),
    file.path(directory, generation, "facts.parquet"))
  expect_error(read_typed_reading_publication(directory, "habitat"), "checksum mismatch")
  unlink(directory, recursive = TRUE)

  write_typed_reading_artifact(fixture$projection, directory, "habitat")
  generation <- jsonlite::fromJSON(file.path(directory, "current.json"))$generation
  # Stale pointer: the generation was published for another content version.
  pointer <- jsonlite::fromJSON(file.path(directory, "current.json"), simplifyVector = FALSE)
  pointer$semantic_version <- strrep("0", 32L)
  jsonlite::write_json(pointer, file.path(directory, "current.json"), auto_unbox = TRUE)
  expect_error(read_typed_reading_publication(directory, "habitat"), "Typed artifact version mismatch")
  unlink(directory, recursive = TRUE)

  write_typed_reading_artifact(fixture$projection, directory, "habitat")
  generation <- jsonlite::fromJSON(file.path(directory, "current.json"))$generation
  # Stale manifest: the recorded content version no longer describes the pieces.
  manifest <- jsonlite::fromJSON(file.path(directory, generation, "manifest.json"), simplifyVector = FALSE)
  manifest$semantic_version <- strrep("0", 32L)
  jsonlite::write_json(manifest, file.path(directory, generation, "manifest.json"), auto_unbox = TRUE)
  pointer <- jsonlite::fromJSON(file.path(directory, "current.json"), simplifyVector = FALSE)
  pointer$semantic_version <- strrep("0", 32L)
  jsonlite::write_json(pointer, file.path(directory, "current.json"), auto_unbox = TRUE)
  expect_error(read_typed_reading_publication(directory, "habitat"),
    "Typed artifact semantic content version mismatch")
})

test_that("the theme reading materializer is owner-scoped and silent without a reading", {
  root <- typed_reading_root("typed-reading-materialize")
  on.exit(unlink(root, recursive = TRUE), add = TRUE)
  fixture <- fixture_economy_reading_fixture()
  payload <- list(histoires = fixture$histories, territoires = NULL, indicateurs = NULL)

  published <- materialize_theme_typed_reading_artifacts(payload, fixture$metadata, fixture$vintages,
    "economie", root)
  expect_identical(published, typed_reading_content_version(
    read_typed_reading_artifact(typed_reading_artifact_directory(root, "economie"), "economie"),
    "economie"))
  expect_true(file.exists(file.path(root, "typed-reading-serving", "economie", "current.json")))

  # Mobility is intentionally not a serving-artifact owner in the retained
  # snapshot architecture; it neither writes an artifact nor accepts the retired
  # snapshot-derived reading path.
  expect_null(materialize_theme_typed_reading_artifacts(payload, fixture$metadata, fixture$vintages,
    "mobilite", root))
  expect_false(dir.exists(file.path(root, "typed-reading-serving", "mobilite")))

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
  fixture <- fixture_typed_readings()$economie

  # Only the legacy theme Parquet history is present: the production readers must
  # fail closed rather than re-project it. No database connection is opened,
  # because the artifact is required before any publication.
  nanoparquet::write_parquet(fixture$histories, file.path(root, "histoires_economie.parquet"))
  expect_error(publish_canonical_demographic_reading(NULL, root), "Typed canonical artifact is missing")
  expect_error(publish_canonical_habitat_reading(NULL, root), "Typed canonical artifact is missing")
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
  registry <- register_typed_reading_artifact_publisher(list(), "economie", publish_economy_reading_family)
  expect_identical(registry$economie$project(list(reading = fixture$reading)), fixture$reading)
  expect_identical(registry$economie$publish, publish_economy_reading_family)
})
