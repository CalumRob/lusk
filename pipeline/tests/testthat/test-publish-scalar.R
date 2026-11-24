
test_that("scalar publisher validates registered canonical fixture facts", {
  canonical <- compute_payload_test(load_fixture())$indicateurs
  fixture_fact <- canonical[canonical$key == "densite" & canonical$territoire == "22001", , drop=FALSE]
  expect_equal(nrow(fixture_fact), 1L)
  facts <- data.frame(indicator_id="fixture_scalar", territory_id="22001",
    territory_type="commune", value=fixture_fact$value[[1L]], status="measured", support_count=1L,
    denominator_count=1L)
  descriptors <- data.frame(indicator_id="fixture_scalar", theme_id="demographie", allowed_sources=I(list("fixture")), label="Fixture",
    unit="count", direction="high", comparison_facet=NA_character_,
    allowed_levels=I(list("commune")), denominator_semantics="units",
    completeness="sparse", descriptor_version="1")
  expect_invisible(validate_scalar_projection(facts, descriptors))
  expect_identical(facts$value[[1L]], fixture_fact$value[[1L]])
  expect_error(validate_scalar_projection(rbind(facts, facts), descriptors), "Duplicate")
  bad <- facts; bad$value <- NA_real_
  expect_error(validate_scalar_projection(bad, descriptors), "null/status")
  bad <- facts; bad$status <- NA_character_
  expect_error(validate_scalar_projection(bad, descriptors), "identity/key")
  invalid_descriptor <- descriptors; invalid_descriptor$label <- ""
  expect_error(validate_scalar_projection(facts, invalid_descriptor), "descriptor fields")
  invalid_descriptor <- descriptors; invalid_descriptor$allowed_levels <- I(list("unknown"))
  expect_error(validate_scalar_projection(facts, invalid_descriptor), "descriptor fields")
  descriptors$allowed_sources <- I(list(character()))
  expect_error(validate_scalar_projection(facts, descriptors), "descriptor fields")
  descriptors$allowed_sources <- I(list("fixture"))
  dense <- descriptors; dense$completeness <- "dense_complete"
  eligible <- data.frame(territory_id=c("22001", "22002"),
                         territory_type=c("commune", "commune"))
  expect_error(validate_scalar_projection(facts, dense, eligible), "Dense scalar")
  expect_error(validate_scalar_projection(facts, descriptors,
    data.frame(territory_id="99999", territory_type="commune")), "unknown eligible territory")
  registered_publish <- function(projection, db, version) db$replace(projection, version)
  registry <- register_scalar_publisher(list(), "fixture", identity, registered_publish)
  expect_named(registry, "fixture")
  expect_error(register_scalar_publisher(registry, "fixture", identity, registered_publish), "duplicate")
})

test_that("serving-disposition reading rejects malformed scalar contract declarations", {
  # #1060 review : une liste NON NOMMÉE est une déclaration corruption — elle
  # doit échouer FORT, pas se transformer en character(0) (source de NA).
  malforme <- list(scalar_contracts = list(
    list(allowed_levels = "commune", completeness = "sparse")))
  expect_error(
    scalar_indicators_with_serving_disposition(
      malforme, SERVING_DISPOSITION_EXCLUDED_LEGACY),
    "scalar contract declarations are invalid")
  # Une liste nommée avec un nom vide ou dupliqué échoue aussi.
  expect_error(
    scalar_indicators_with_serving_disposition(
      list(scalar_contracts = setNames(list(list()), "")),
      SERVING_DISPOSITION_EXCLUDED_LEGACY),
    "scalar contract declarations are invalid")
  expect_error(
    scalar_indicators_with_serving_disposition(
      list(scalar_contracts = stats::setNames(list(list(), list()), c("a", "a"))),
      SERVING_DISPOSITION_EXCLUDED_LEGACY),
    "scalar contract declarations are invalid")
  # Les deux cas légitimes restent vides sans bruit : absent et {} nommé vide.
  expect_identical(
    scalar_indicators_with_serving_disposition(
      list(), SERVING_DISPOSITION_EXCLUDED_LEGACY), character(0L))
  expect_identical(
    scalar_indicators_with_serving_disposition(
      list(scalar_contracts = list()), SERVING_DISPOSITION_EXCLUDED_LEGACY),
    character(0L))
})

test_that("retained scalar retirement is metadata-derived and leaves undeclared omissions strict", {
  metadata_directory <- testthat::test_path("../../inst/extdata/theme-metadata")
  meta <- lire_theme_metadata("mobilite")
  declares_retirement <- names(meta$scalar_contracts)[vapply(
    meta$scalar_contracts, function(contract)
      identical(contract$serving_disposition,
                SERVING_DISPOSITION_EXCLUDED_LEGACY),
    logical(1))]
  # #1048 : TOUS les ids retirés sont déclarés dans scalar_contracts — les 29,
  # y compris les 15 `share_*` qui n'ont jamais eu de page scalaire.
  expect_setequal(declares_retirement, INDICATEURS_MOBILITE_RETIRES)

  retirements <- retained_scalar_retirement_ids(metadata_directory)
  # La liste nominale vient de l'epic, pas du canon — une clé oubliée dans
  # scalar_contracts ferait échouer cette garde.
  expect_setequal(retirements, INDICATEURS_MOBILITE_RETIRES)
  expect_length(retirements, 29L)

  projection <- list(descriptors=data.frame(indicator_id="densite"))
  expect_silent(assert_complete_scalar_snapshot(
    c("densite", retirements[[1L]]), projection, retirements))
  expect_error(assert_complete_scalar_snapshot(
    c("densite", "unapproved_live_indicator"), projection, retirements),
    "omitted registered indicators")
  expect_error(assert_complete_scalar_snapshot(
    c("densite", retirements[[1L]]), projection),
    "omitted registered indicators")
})

test_that("economy scalar projector retains canonical units, levels, and source vintages", {
  metadata <- jsonlite::fromJSON(testthat::test_path("../../inst/extdata/theme-metadata/theme_economie.json"), simplifyVector=FALSE)
  canonical_dir <- Sys.getenv("LUSK_TEST_CANONICAL_DATA_DIR", unset=file.path(pkgload::pkg_path(), "..", "public", "data"))
  canonical <- lire_indicateurs_producteur_fixture("economie", canonical_dir)
  ids <- names(metadata$scalar_contracts)
  eligible <- unique(data.frame(territory_id=as.character(canonical$territoire),
    territory_type=as.character(canonical$type)))
  rows <- data.frame(territory_id=as.character(canonical$territoire),
    territory_type=as.character(canonical$type), indicator_id=as.character(canonical$key),
    value=as.numeric(canonical$value), unit=as.character(canonical$unit),
    source_name=as.character(canonical$vintage_source), source_version=as.character(canonical$vintage_version),
    reference_date=as.character(canonical$vintage_date_reference),
    publication_date=as.character(canonical$vintage_date_publication))
  projection <- project_scalar_canonical_rows(rows, metadata, ids, eligible)
  expect_setequal(projection$descriptors$indicator_id, c("effectifs_salaries","chomage","eco_activites"))
  eco_policy <- metadata$scalar_contracts$eco_activites
  eco <- projection$facts[projection$facts$indicator_id == "eco_activites", , drop=FALSE]
  expect_false(eco_policy$counts_available)
  expect_true(all(is.na(eco$support_count) & is.na(eco$denominator_count)))
  expect_true(all(eco$status[is.na(eco$value)] == "suppressed"))
  expect_true(all(eco$status[!is.na(eco$value)] == "measured"))
  eco_canonical <- canonical[canonical$key == "eco_activites", , drop=FALSE]
  eco_expected <- eco_canonical[match(eco$territory_id, as.character(eco_canonical$territoire)), , drop=FALSE]
  expect_equal(eco$value, as.numeric(eco_expected$value))
  expect_identical(eco$status, ifelse(is.na(eco_expected$value), "suppressed", "measured"))
  expect_equal(projection$descriptors$unit[match(ids, projection$descriptors$indicator_id)],
    unname(vapply(ids, function(id) metadata$indicator_pages[[id]]$unit, character(1))))
  expect_equal(projection$descriptors$direction[match(c("effectifs_salaries","chomage"), projection$descriptors$indicator_id)],
    c("high","low"))
  expect_true(all(projection$provenance$vintage_id %in% paste(canonical$vintage_version,
    canonical$vintage_date_reference, sep="/")))
  bad <- rows; bad$unit <- "wrong"
  expect_error(project_scalar_canonical_rows(bad, metadata, ids, eligible), "unit disagrees")
  expect_true(all(c("commune", "epci", "departement", "region") %in%
    unique(projection$facts$territory_type)))
  expect_true(all(vapply(ids, function(id) identical(
    projection$descriptors$allowed_levels[[match(id, projection$descriptors$indicator_id)]],
    unlist(metadata$scalar_contracts[[id]]$allowed_levels)), logical(1))))
  expect_false("region" %in% unlist(metadata$indicator_pages$effectifs_salaries$levels))
})

test_that("canonical scalar contracts remain complete while public projections omit producer fields", {
  root <- pkgload::pkg_path()
  themes <- c("services", "economie", "demographie", "mobilite", "habitat", "milieux", "programmes")
  themes <- themes[file.exists(file.path(root, "inst", "extdata", "theme-metadata", paste0("theme_", themes, ".json")))]
  for (theme in themes) {
    source <- jsonlite::fromJSON(file.path(root, "inst", "extdata", "theme-metadata", paste0("theme_", theme, ".json")), simplifyVector=FALSE)
    generated <- jsonlite::fromJSON(file.path(root, "..", "public", "data", paste0("theme_", theme, ".json")), simplifyVector=FALSE)
    canonical <- lire_theme_metadata(theme)
    expect_identical(source$scalar_contracts, canonical$scalar_contracts, info=theme)
    scalar_ids <- names(canonical$scalar_contracts %||% list())
    # #1048 : seuls les contrats RETENUS ont une page — les contrats déclarés
    # `excluded_legacy_accessibility` sont des reçus de retrait (les 15 `share_*`
    # n'ont jamais eu de page scalaire).
    retained_ids <- setdiff(scalar_ids,
      scalar_indicators_with_serving_disposition(canonical,
        SERVING_DISPOSITION_EXCLUDED_LEGACY))
    expect_true(all(retained_ids %in% names(canonical$indicator_pages)), info=theme)
    expect_false(any(c("scalar_contracts", "profile_contracts", "map_layers") %in% names(generated)), info=theme)
    expect_true("indicator_pages" %in% names(generated), info=theme)
    expect_true(all(names(generated$indicator_pages) %in% names(canonical$indicator_pages)), info=theme)
  }
})

test_that("raccordement scalar projection binds its producer metadata, source vintage, and trajectory t0090", {
  canonical_dir <- file.path(pkgload::pkg_path(), "..", "public", "data")
  canonical <- nanoparquet::read_parquet(file.path(canonical_dir, "indicateurs_mobilite.parquet"))
  vintages <- nanoparquet::read_parquet(file.path(canonical_dir, "vintages.parquet"))
  current <- jsonlite::fromJSON(testthat::test_path("../../inst/extdata/theme-metadata/theme_mobilite.json"), simplifyVector=FALSE)
  # Le Parquet conservé est le snapshot de la publication PRÉCÉDENTE : il ne
  # se lie pas au canon courant (la fraîcheur du raccordement a changé). La
  # métadonnée servie est désormais exactement la projection du canon (#953),
  # il n'existe plus de copie « historique » à opposer — la vérité producteur
  # reste la liaison NÉGATIVE ci-dessous.
  expect_error(validate_raccordement_scalar_bundle(canonical, current, vintages),
    "Raccordement scalar source vintage is unavailable in its metadata bundle")

  artifact <- lire_artefact_raccordement_national()
  candidate_vintages <- vintages_mobilite()
  owned_rows <- lignes_indicateurs_raccordement_national(artifact$calculation, candidate_vintages)
  mutated <- owned_rows
  index <- which(mutated$key == "raccordement_tc")[[1L]]
  mutated$value[[index]] <- mutated$value[[index]] + 0.01
  expect_error(validate_raccordement_scalar_bundle(mutated, current, candidate_vintages),
    "Raccordement scalar does not match its t0090 trajectory fact")
  expect_equal(sum(owned_rows$key == "raccordement_tc"), 1268L)
  expect_silent(validate_raccordement_scalar_bundle(owned_rows, current, candidate_vintages))
})

test_that("registered publisher versions independently, retries DB-behind-local, and rolls back failures", {
  facts <- data.frame(indicator_id="fixture_scalar", territory_id="22001",
    territory_type="commune", value=0, status="measured", support_count=1L,
    denominator_count=1L)
  descriptors <- data.frame(indicator_id="fixture_scalar", theme_id="demographie", allowed_sources=I(list(c("fixture", "fixture_secondary"))), label="Fixture",
    unit="count", direction="high", comparison_facet=NA_character_,
    allowed_levels=I(list("commune")), denominator_semantics="units",
    completeness="sparse", descriptor_version="1")
  projection <- function(canonical) {
    f <- facts; f$value <- canonical$value
    list(facts=f, descriptors=descriptors,
      provenance=data.frame(indicator_id=f$indicator_id, territory_id=f$territory_id,
        source_id=c(f$source_id, "fixture_secondary"), vintage_id=c(f$vintage_id, "2023")),
      datasets=data.frame(source_id=c("fixture", "fixture_secondary"), name=c("Fixture", "Secondary")),
      vintages=data.frame(source_id=c("fixture", "fixture_secondary"),
        vintage_id=c("2024", "2023"), version=c("2024", "2023"),
        reference_date=as.Date(c(NA, NA)), publication_date=as.Date(c(NA, NA))),
      eligible_territories=data.frame(territory_id="22001", territory_type="commune"))
  }
  state <- new.env(parent=emptyenv()); state$markers <- list(); state$payload <- NULL
  state$reference_version <- "territory-v1"
  state$scalar_reference_version <- NULL
  state$territories <- data.frame(territory_id="22001", territory_type="commune")
  db <- list(
    transaction=function(expr) {
      old_markers <- state$markers; old_payload <- state$payload
      old_scalar_reference <- state$scalar_reference_version
      tryCatch(force(expr), error=function(e) {
        state$markers <- old_markers; state$payload <- old_payload
        state$scalar_reference_version <- old_scalar_reference; stop(e)
      })
    },
    marker=function(name) {
      version <- state$markers[[name]]
      if (is.null(version)) data.frame(content_version=character()) else
        data.frame(content_version=version, reference_content_version=state$scalar_reference_version)
    },
    reference_marker=function() data.frame(content_version=state$reference_version),
    validate_territories=function(territories, descriptors) {
      expected <- unique(territories[c("territory_id", "territory_type")])
      actual <- state$territories[state$territories$territory_type %in%
        unique(unlist(descriptors$allowed_levels)), , drop=FALSE]
      if (!setequal(paste(expected$territory_id, expected$territory_type),
                    paste(actual$territory_id, actual$territory_type)))
        stop("territory universe mismatch")
    },
    set_reference_version=function(version) { state$scalar_reference_version <- version },
    replace=function(value, version) {
      state$payload <- value
      if (identical(value$facts$value[[1]], 9)) stop("simulated SQL failure")
      state$markers$scalar_observation <- version
      state$scalar_reference_version <- state$reference_version
    })
  registry <- register_scalar_publisher(list(), "fixture", projection,
    function(value, db, version) db$replace(value, version))
  first <- publish_registered_scalar(registry, "fixture", list(value=0), db)
  expect_true(first$changed)
  state$markers$unrelated_owner <- "unrelated-v1"
  marker <- state$markers$scalar_observation
  expect_false(publish_registered_scalar(registry, "fixture", list(value=0), db)$changed)
  bad_provenance_registry <- register_scalar_publisher(list(), "bad-provenance",
    project=function(x) { p <- projection(x); p$provenance$vintage_id[[1]] <- NA_character_; p },
    function(value, db, version) db$replace(value, version))
  expect_error(publish_registered_scalar(bad_provenance_registry, "bad-provenance", list(value=0), db),
               "provenance associations")
  bad_universe_registry <- register_scalar_publisher(list(), "bad-universe",
    project=function(x) { p <- projection(x); p$eligible_territories <- rbind(p$eligible_territories,
      data.frame(territory_id="99999", territory_type="commune")); p },
    function(value, db, version) db$replace(value, version))
  expect_error(publish_registered_scalar(bad_universe_registry, "bad-universe", list(value=0), db),
               "territory universe mismatch")
  state$reference_version <- "territory-v2"
  compatibility <- publish_registered_scalar(registry, "fixture", list(value=0), db)
  expect_false(compatibility$changed)
  expect_true(compatibility$compatibility_updated)
  expect_identical(state$reference_version, "territory-v2")
  state$reference_version <- "territory-v3"
  state$territories$territory_id <- "99999"
  expect_error(publish_registered_scalar(registry, "fixture", list(value=0), db),
               "territory universe mismatch")
  expect_identical(state$scalar_reference_version, "territory-v2")
  state$territories$territory_id <- "22001"
  state$reference_version <- "territory-v2"
  local_new <- publish_registered_scalar(registry, "fixture", list(value=1), db)
  expect_true(local_new$changed)
  state$markers$scalar_observation <- marker
  expect_true(publish_registered_scalar(registry, "fixture", list(value=1), db)$changed)
  expect_identical(state$markers$scalar_observation, local_new$content_version)
  last_good <- state$markers$scalar_observation
  expect_error(publish_registered_scalar(registry, "fixture", list(value=9), db), "simulated SQL failure")
  expect_identical(state$markers$scalar_observation, last_good)
  expect_identical(state$markers$unrelated_owner, "unrelated-v1")
})

test_that("fixture publisher projects the complete canonical scalar slice and versions metadata", {
  payload <- compute_payload_test(load_fixture())
  metadata <- jsonlite::fromJSON(testthat::test_path("../../inst/extdata/theme-metadata/theme_demographie.json"),
                                 simplifyVector=FALSE)
  expected <- payload$indicateurs[payload$indicateurs$key == "densite" &
    payload$indicateurs$type %in% metadata$indicator_pages$densite$levels, , drop=FALSE]
  expected <- expected[order(expected$type, expected$territoire), , drop=FALSE]
  # Explicit fixture-only policy: these fixture facts cover every declared
  # level/territory. Completeness is not present in product metadata, so the
  # projection API requires the caller to state it.
  eligible <- payload$territoires[payload$territoires$type %in%
    metadata$indicator_pages$densite$levels, c("territoire", "type"), drop=FALSE]
  expect_equal(nrow(expected), nrow(eligible))
  projected <- project_fixture_scalar(payload, metadata, completeness="dense_complete")
  source_id <- metadata$indicator_pages$densite$sources[[1L]]
  vintage_id <- paste(expected$vintage_version, expected$vintage_date_reference, sep="/")
  expected_facts <- data.frame(indicator_id="densite", territory_id=expected$territoire,
    territory_type=expected$type, value=expected$value,
    status=ifelse(is.na(expected$value), "not_available", "measured"),
    support_count=NA_integer_, denominator_count=NA_integer_, stringsAsFactors=FALSE)
  expect_equal(projected$facts, expected_facts)
  expect_equal(projected$provenance,
    unique(data.frame(indicator_id="densite", territory_id=expected$territoire,
      source_id=source_id, vintage_id=vintage_id)))
  expect_equal(projected$descriptors$label, metadata$indicator_pages$densite$label)
  expect_equal(projected$descriptors$unit, metadata$indicator_pages$densite$unit)
  expect_equal(projected$descriptors$direction, metadata$indicator_pages$densite$direction)
  expect_equal(projected$descriptors$allowed_levels[[1]], unlist(metadata$indicator_pages$densite$levels))
  expect_equal(projected$descriptors$denominator_semantics,
               metadata$indicator_pages$densite$calculation)
  expect_equal(projected$descriptors$allowed_sources[[1]], source_id)
  expect_identical(projected$descriptors$completeness, "dense_complete")
  expect_equal(projected$datasets,
    data.frame(source_id=source_id, name=unique(as.character(expected$vintage_source))[[1L]]))
  expect_equal(projected$vintages, unique(data.frame(source_id=source_id,
    vintage_id=vintage_id, version=as.character(expected$vintage_version),
    reference_date=as.Date(expected$vintage_date_reference),
    publication_date=as.Date(expected$vintage_date_publication))))
  expect_equal(projected$eligible_territories,
    stats::setNames(eligible, c("territory_id", "territory_type")))
  expect_invisible(validate_scalar_projection(projected$facts, projected$descriptors,
                                               projected$eligible_territories))
  changed_metadata <- metadata
  changed_metadata$indicator_pages$densite$label <- "Densité modifiée"
  changed <- project_fixture_scalar(payload, changed_metadata, completeness="dense_complete")
  expect_false(identical(scalar_content_version(projected), scalar_content_version(changed)))
  expect_false(identical(projected$descriptors$descriptor_version,
                         changed$descriptors$descriptor_version))
  expect_error(project_fixture_scalar(payload, metadata), "completeness")
  multi_source_metadata <- metadata
  multi_source_metadata$indicator_pages$densite$sources <- c(source_id, "secondary_without_fixture_provenance")
  expect_error(project_fixture_scalar(payload, multi_source_metadata,
    completeness="dense_complete"), "exactly one declared source")
})

test_that("scalar descriptor decoding fails closed on an unrecorded list column", {
  rows <- list(
    list(indicator_id="densite", label="Densité", allowed_sources=list("a", "b"), allowed_levels=list("commune")),
    list(indicator_id="densite2", label="Densité 2", allowed_sources=list("c"), allowed_levels=list("epci", "region")))
  expect_error(decode_scalar_descriptors(rows, character()),
    "unrecorded list value")
  expect_error(decode_scalar_descriptors(rows, "allowed_levels"),
    "unrecorded list value")
  expect_error(decode_scalar_descriptors(rows, "missing_column"),
    "disagree with the recorded schema")
  decoded <- decode_scalar_descriptors(rows, c("allowed_sources", "allowed_levels"))
  expect_identical(decoded$allowed_sources[[1L]], c("a", "b"))
  expect_identical(decoded$allowed_levels[[2L]], c("epci", "region"))
  expect_identical(decoded$indicator_id, c("densite", "densite2"))
})

test_that("scalar serving artifacts round-trip all typed grains as one coherent generation", {
  payload <- compute_payload_test(load_fixture())
  metadata <- jsonlite::fromJSON(testthat::test_path("../../inst/extdata/theme-metadata/theme_demographie.json"),
                                 simplifyVector=FALSE)
  projection <- project_fixture_scalar(payload, metadata, completeness="dense_complete")
  root <- tempfile("scalar-serving-")
  dir.create(root)
  on.exit(unlink(root, recursive=TRUE), add=TRUE)

  version <- write_scalar_serving_artifact(projection, root)
  expect_match(version, "^[a-f0-9]{32}$")
  restored <- read_scalar_serving_artifact(root)
  expect_equal(restored$descriptors, projection$descriptors)
  expect_equal(as.data.frame(restored$facts[c("indicator_id", "territory_id", "territory_type", "status")]),
               as.data.frame(projection$facts[c("indicator_id", "territory_id", "territory_type", "status")]))
  # Fidelity anchor: the artifact-read projection must carry exactly the
  # content version of the independently projected pure output, so a scalar
  # value payload that the transport fails to preserve cannot slip through.
  expect_identical(scalar_content_version(restored), scalar_content_version(projection))
  generation <- jsonlite::fromJSON(file.path(root, "scalar-current.json"))$generation
  expect_true(all(file.exists(file.path(root, generation, c("facts.parquet",
    "descriptors.json", "provenance.parquet", "datasets.parquet",
    "vintages.parquet", "eligible_territories.parquet")))))
  manifest <- jsonlite::fromJSON(file.path(root, generation, "manifest.json"), simplifyVector=FALSE)
  expect_setequal(as.character(unlist(manifest$descriptor_list_columns, use.names=FALSE)),
    c("allowed_sources", "allowed_levels"))

  # Re-publishing identical content validates and reuses the immutable
  # generation; a failed replacement leaves the old pointer unchanged.
  pointer_before <- readLines(file.path(root, "scalar-current.json"), warn=FALSE)
  expect_identical(write_scalar_serving_artifact(projection, root), version)
  expect_identical(readLines(file.path(root, "scalar-current.json"), warn=FALSE), pointer_before)
  changed <- projection
  changed$facts$value[[1L]] <- changed$facts$value[[1L]] + 0.125
  changed_version <- write_scalar_serving_artifact(changed, root)
  expect_false(identical(changed_version, version))
  expect_equal(read_scalar_serving_artifact(root)$facts$value, changed$facts$value)
  pointer_before <- readLines(file.path(root, "scalar-current.json"), warn=FALSE)
  invalid <- changed
  invalid$facts$value[[1L]] <- Inf
  expect_error(write_scalar_serving_artifact(invalid, root), "Invalid scalar value")
  expect_identical(readLines(file.path(root, "scalar-current.json"), warn=FALSE), pointer_before)
  other_owner <- file.path(root, "other-owner")
  write_scalar_serving_artifact(projection, other_owner)
  expect_equal(read_scalar_serving_artifact(other_owner)$facts$value,
               restored$facts$value)
  changed_generation <- jsonlite::fromJSON(file.path(root, "scalar-current.json"))$generation
  facts_path <- file.path(root, changed_generation, "facts.parquet")
  facts <- nanoparquet::read_parquet(facts_path)
  facts$value[[1L]] <- facts$value[[1L]] + 1
  nanoparquet::write_parquet(facts, facts_path)
  expect_error(write_scalar_serving_artifact(changed, root), "checksum mismatch")
  expect_identical(readLines(file.path(root, "scalar-current.json"), warn=FALSE), pointer_before)
  expect_error(read_scalar_serving_artifact(root), "checksum mismatch")
  unlink(file.path(root, changed_generation, "datasets.parquet"))
  expect_error(read_scalar_serving_artifact(root), "grain is missing")
  expect_error(read_scalar_serving_artifact(tempfile("no-scalar-")), "artifact is missing")
})

test_that("smoke schema cleanup is explicitly dependency ordered and restricted", {
  sql <- scalar_smoke_schema_cleanup_sql(function(x) paste0('"', x, '"'), "scalar_it_test")
  serving_sql <- serving_smoke_schema_cleanup_sql(function(x) paste0('"', x, '"'), "scalar_it_test")
  profile_sql <- serving_smoke_schema_cleanup_sql(function(x) paste0('"', x, '"'), "profile_it_test")
  serving_it_sql <- serving_smoke_schema_cleanup_sql(function(x) paste0('"', x, '"'), "serving_it_test")
  expect_true(any(grepl('DROP TABLE IF EXISTS "scalar_it_test"."scalar_observation_source" RESTRICT', sql, fixed=TRUE)))
  expect_true(any(grepl('DROP FUNCTION IF EXISTS "scalar_it_test"."reject_smoke_value"() RESTRICT', sql, fixed=TRUE)))
  expect_lt(which(grepl('"scalar_observation_source"', sql, fixed=TRUE))[1L],
            which(grepl('"territory_reference"', sql, fixed=TRUE))[1L])
  expect_lt(which(grepl('"territory_reference"', sql, fixed=TRUE))[1L],
            which(grepl('"table_publication"', sql, fixed=TRUE))[1L])
  expect_true(grepl("DROP SCHEMA IF EXISTS \"scalar_it_test\" RESTRICT", tail(sql, 1L), fixed=TRUE))
  expect_false(any(grepl("CASCADE", sql, fixed=TRUE)))
  expect_true(any(grepl('DROP TABLE IF EXISTS "scalar_it_test"."ordered_series" RESTRICT', serving_sql, fixed=TRUE)))
  expect_true(any(grepl('DROP TABLE IF EXISTS "profile_it_test"."profile_comparison_territory" RESTRICT', profile_sql, fixed=TRUE)))
  expect_true(any(grepl('DROP TABLE IF EXISTS "profile_it_test"."observed_collection_comparison_territory" RESTRICT', profile_sql, fixed=TRUE)))
  expect_lt(which(grepl('"observed_collection_comparison_territory"', profile_sql, fixed=TRUE))[1L],
    which(grepl('"observed_collection_category"', profile_sql, fixed=TRUE))[1L])
  expect_lt(which(grepl('"profile_comparison_territory"', profile_sql, fixed=TRUE))[1L],
    which(grepl('"profile_comparison_group"', profile_sql, fixed=TRUE))[1L])
  expect_lt(which(grepl('"observed_collection_comparison_territory"', profile_sql, fixed=TRUE))[1L],
    which(grepl('"observed_collection_comparison_group"', profile_sql, fixed=TRUE))[1L])
  expect_false(grepl("building_ramp|building_grid|service_registry|essential_service_access|bpe_profile", paste(serving_sql, collapse="\n")))
  expect_lt(which(grepl('"scalar_observation_source"', serving_sql, fixed=TRUE))[1L],
            which(grepl('"scalar_observation"', serving_sql, fixed=TRUE))[1L])
  expect_lt(which(grepl('"profile_observation_source"', serving_sql, fixed=TRUE))[1L],
            which(grepl('"profile_observation"', serving_sql, fixed=TRUE))[1L])
  expect_true(grepl('DROP SCHEMA IF EXISTS "profile_it_test" RESTRICT', tail(profile_sql, 1L), fixed=TRUE))
  expect_true(grepl('DROP SCHEMA IF EXISTS "serving_it_test" RESTRICT', tail(serving_it_sql, 1L), fixed=TRUE))
  expect_false(any(grepl("CASCADE", c(serving_sql, profile_sql, serving_it_sql), fixed=TRUE)))
  expect_error(scalar_smoke_schema_cleanup_sql(identity, "public"), "owned smoke schema")
  expect_error(profile_smoke_schema_cleanup_sql(identity, "public"), "owned profile smoke schema")
  expect_error(serving_smoke_schema_cleanup_sql(identity, "public"), "owned smoke schema")
  expect_error(serving_smoke_schema_cleanup_sql(identity, "unowned_it_test"), "owned smoke schema")
})

test_that("PostgreSQL schema splitter preserves literals, quoted identifiers, and function bodies", {
  schema <- paste(readLines(testthat::test_path("../../../api/schema.sql"), warn=FALSE), collapse="\n")
  statements <- split_postgres_sql(schema)
  publication_ddl <- statements[grepl("CREATE TABLE table_publication", statements, fixed=TRUE)]
  expect_length(publication_ddl, 1L)
  expect_true(grepl("'territory_reference'", publication_ddl, fixed=TRUE))
  expect_true(grepl("'scalar_observation'", publication_ddl, fixed=TRUE))
  source_assertion <- statements[grepl("CREATE FUNCTION assert_scalar_descriptor_sources", statements, fixed=TRUE)]
  expect_length(source_assertion, 1L)
  expect_true(grepl("RAISE EXCEPTION 'scalar descriptor must declare at least one source dataset';", source_assertion, fixed=TRUE))
  expect_length(split_postgres_sql("SELECT 'a'';b', \"quoted\"; -- ignored;\nSELECT $$body; stays$$;"), 2L)
})
