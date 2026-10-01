test_that("scalar publisher validates registered canonical fixture facts", {
  canonical <- compute_payload(load_fixture())$indicateurs
  fixture_fact <- canonical[canonical$key == "densite" & canonical$territoire == "22001", , drop=FALSE]
  expect_equal(nrow(fixture_fact), 1L)
  facts <- data.frame(indicator_id="fixture_scalar", territory_id="22001",
    territory_type="commune", value=fixture_fact$value[[1L]], status="measured", support_count=1L,
    denominator_count=1L)
  descriptors <- data.frame(indicator_id="fixture_scalar", allowed_sources=I(list("fixture")), label="Fixture",
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

test_that("services scalar projection keeps all fifteen canonical indicator identities", {
  metadata <- jsonlite::fromJSON(testthat::test_path("../../inst/extdata/theme-metadata/theme_mobilite.json"), simplifyVector=FALSE)
  keys <- unlist(lapply(metadata$subgroups, `[[`, "indicators"), use.names=FALSE)
  keys <- keys[grepl("^share_", keys)]
  access <- expand.grid(territory_id=c("29001", "29"), indicator_id=keys,
    stringsAsFactors=FALSE)
  access$territory_type <- ifelse(access$territory_id == "29001", "commune", "departement")
  access$value <- seq_len(nrow(access)) / 100
  access$unit <- "%"
  access$label <- vapply(access$indicator_id, function(k) metadata$indicator_labels[[k]], character(1))
  access$direction <- vapply(access$indicator_id, function(k) metadata$indicator_directions[[k]], character(1))
  access$source_id <- vapply(access$indicator_id, function(k) metadata$sources[[k]], character(1))
  access$source_name <- "Snapshot"
  access$source_version <- "2024"
  access$reference_date <- "2024-01-01"
  access$publication_date <- "2024-02-01"
  eligible <- unique(access[c("territory_id", "territory_type")])
  projection <- project_service_share_scalars(access, metadata, eligible)
  expect_equal(nrow(projection$facts), 30L)
  expect_setequal(unique(projection$facts$indicator_id), keys)
  expect_equal(nrow(projection$descriptors), 15L)
  expect_true(all(projection$descriptors$unit == "%"))
  expect_equal(projection$facts$value,
    access$value[order(access$indicator_id, access$territory_id)])
  expect_true(all(projection$facts$status == "measured"))
  expect_equal(projection$descriptors$label, unname(
    vapply(projection$descriptors$indicator_id, function(k) metadata$indicator_labels[[k]], character(1))))
  expect_equal(projection$descriptors$direction, unname(
    vapply(projection$descriptors$indicator_id, function(k) metadata$indicator_directions[[k]], character(1))))
  expect_equal(projection$descriptors$allowed_sources,
    I(lapply(projection$descriptors$indicator_id, function(k) metadata$sources[[k]])))
  expect_true(all(projection$descriptors$denominator_semantics ==
    metadata$service_share_scalar$denominator_semantics))
  expect_setequal(unique(projection$provenance$indicator_id), keys)
  expect_invisible(validate_scalar_projection(projection$facts,
    projection$descriptors, projection$eligible_territories))
  expect_identical(scalar_content_version(projection), scalar_content_version(
    project_service_share_scalars(access[rev(seq_len(nrow(access))), ], metadata,
      eligible[rev(seq_len(nrow(eligible))), ])))
  changed_contract <- metadata
  changed_contract$service_share_scalar$denominator_semantics <-
    paste(changed_contract$service_share_scalar$denominator_semantics, "version 2")
  expect_false(identical(scalar_content_version(projection), scalar_content_version(
    project_service_share_scalars(access, changed_contract, eligible))))
  invalid_source <- access
  invalid_source$source_id[[1L]] <- "undeclared_source"
  expect_error(project_service_share_scalars(invalid_source, metadata, eligible),
    "descriptor is inconsistent")
  registry <- register_service_share_scalar_publisher(list(), metadata)
  canonical <- list(access=access, eligible_territories=eligible)
  registered_projection <- registry$services_essentiels_scalar$project(canonical)
  expect_equal(registered_projection, projection)

  state <- new.env(parent=emptyenv())
  state$version <- NULL; state$payload <- NULL; state$reference <- "territory-v1"
  state$fail <- FALSE
  db <- list(
    transaction=function(expr) {
      old <- list(version=state$version, payload=state$payload)
      tryCatch(force(expr), error=function(e) {
        state$version <- old$version; state$payload <- old$payload; stop(e)
      })
    },
    marker=function(name) if (is.null(state$version)) data.frame(content_version=character()) else
      data.frame(content_version=state$version, reference_content_version=state$reference),
    reference_marker=function() data.frame(content_version=state$reference),
    validate_territories=function(...) invisible(NULL),
    set_reference_version=function(version) { state$reference <- version },
    replace=function(value, version) {
      state$payload <- value
      if (state$fail) stop("simulated transaction failure")
      state$version <- version
    })
  first <- publish_registered_scalar(registry, "services_essentiels_scalar", canonical, db)
  expect_true(first$changed)
  expect_equal(state$payload$facts, projection$facts)
  expect_false(publish_registered_scalar(registry, "services_essentiels_scalar",
    canonical, db)$changed)
  state$version <- "behind-local"
  expect_true(publish_registered_scalar(registry, "services_essentiels_scalar",
    canonical, db)$changed)
  committed <- state$version; committed_payload <- state$payload
  state$fail <- TRUE
  changed_access <- access; changed_access$value[[1L]] <- changed_access$value[[1L]] + .001
  expect_error(publish_registered_scalar(registry, "services_essentiels_scalar",
    list(access=changed_access, eligible_territories=eligible), db), "simulated transaction failure")
  expect_identical(state$version, committed)
  expect_identical(state$payload, committed_payload)
})

test_that("complete scalar snapshots combine service and economy cohorts deterministically", {
  metadata <- jsonlite::fromJSON(testthat::test_path("../../inst/extdata/theme-metadata/theme_mobilite.json"), simplifyVector=FALSE)
  keys <- unlist(lapply(metadata$subgroups, `[[`, "indicators"), use.names=FALSE)
  keys <- keys[grepl("^share_", keys)]
  access <- expand.grid(territory_id=c("29001", "29"), indicator_id=keys, stringsAsFactors=FALSE)
  access$territory_type <- ifelse(access$territory_id == "29001", "commune", "departement")
  access$value <- seq_len(nrow(access))/100; access$unit <- "%"
  access$label <- vapply(access$indicator_id, function(k) metadata$indicator_labels[[k]], character(1))
  access$direction <- vapply(access$indicator_id, function(k) metadata$indicator_directions[[k]], character(1))
  access$source_id <- vapply(access$indicator_id, function(k) metadata$sources[[k]], character(1))
  access$source_name <- "Snapshot"; access$source_version <- "2024"
  access$reference_date <- "2024-01-01"; access$publication_date <- "2024-02-01"
  service <- project_service_share_scalars(access, metadata,
    unique(access[c("territory_id", "territory_type")]))
  economy <- service
  economy$facts <- service$facts[1:2, , drop=FALSE]
  economy$facts$indicator_id <- c("effectifs_salaries", "chomage")
  economy$facts$value <- c(123, 4.2)
  economy$descriptors <- service$descriptors[1:2, , drop=FALSE]
  economy$descriptors$indicator_id <- economy$facts$indicator_id
  economy$descriptors$label <- c("canonical employment label", "canonical unemployment label")
  economy$descriptors$unit <- c("canonical employment unit", "canonical unemployment unit")
  economy$descriptors$direction <- "low"
  economy$descriptors$allowed_sources <- I(list("rp_emploi", "rp_chomage"))
  economy$descriptors$allowed_levels <- I(list(c("commune", "departement"), c("commune", "departement")))
  economy$descriptors$completeness <- "sparse"
  economy$descriptors$denominator_semantics <- c("producer-defined employment count", "producer-defined unemployment rate")
  economy$descriptors$descriptor_version <- c("effectifs-v1", "chomage-v1")
  economy$provenance <- data.frame(indicator_id=economy$facts$indicator_id,
    territory_id=c("29001", "29001"), source_id=c("rp_emploi", "rp_chomage"), vintage_id="2023/2023-01-01")
  economy$datasets <- data.frame(source_id=c("rp_emploi", "rp_chomage"), name=c("Employment", "Unemployment"))
  economy$vintages <- data.frame(source_id=c("rp_emploi", "rp_chomage"), vintage_id="2023/2023-01-01",
    version="2023", reference_date=as.Date("2023-01-01"), publication_date=as.Date("2026-01-01"))
  economy$eligible_territories <- service$eligible_territories

  combined <- combine_scalar_projections(service, economy)
  expect_identical(assemble_scalar_snapshot(service), service)
  expect_identical(assemble_scalar_snapshot(service, list(economy)), combined)
  expect_identical(assemble_scalar_snapshot(service, list(list(economy))), combined)
  expect_equal(nrow(combined$descriptors), 17L)
  expect_true(all(keys %in% combined$descriptors$indicator_id))
  expect_true(all(c("effectifs_salaries", "chomage") %in% combined$descriptors$indicator_id))
  expect_identical(combined, combine_scalar_projections(economy, service))
  preserved_service <- combined$facts[combined$facts$indicator_id %in% keys, , drop=FALSE]
  rownames(preserved_service) <- NULL
  expect_equal(preserved_service, service$facts)
  expect_invisible(assert_complete_scalar_snapshot(keys, combined))
  expect_error(assert_complete_scalar_snapshot(c(keys, "previously-published"), combined),
    "omitted registered indicators")
  expect_false(identical(scalar_content_version(service), scalar_content_version(combined)))
  conflict <- economy; conflict$datasets$source_id[[1]] <- service$datasets$source_id[[1]]
  conflict$datasets$name[[1]] <- "conflicting source ownership"
  expect_error(combine_scalar_projections(service, conflict), "conflict")
  expect_error(combine_scalar_projections(service, service), "conflicting indicator")
})

test_that("economy scalar projector retains canonical units, levels, and source vintages", {
  metadata <- jsonlite::fromJSON(testthat::test_path("../../inst/extdata/theme-metadata/theme_economie.json"), simplifyVector=FALSE)
  canonical <- nanoparquet::read_parquet(file.path(pkgload::pkg_path(), "..", "public", "data", "indicateurs_economie.parquet"))
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
  expect_setequal(projection$descriptors$indicator_id, c("effectifs_salaries","chomage"))
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

test_that("registered publisher versions independently, retries DB-behind-local, and rolls back failures", {
  facts <- data.frame(indicator_id="fixture_scalar", territory_id="22001",
    territory_type="commune", value=0, status="measured", support_count=1L,
    denominator_count=1L)
  descriptors <- data.frame(indicator_id="fixture_scalar", allowed_sources=I(list(c("fixture", "fixture_secondary"))), label="Fixture",
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
  state$markers$building_ramp <- "building-v1"
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
  expect_identical(state$markers$building_ramp, "building-v1")
})

test_that("fixture publisher projects the complete canonical scalar slice and versions metadata", {
  payload <- compute_payload(load_fixture())
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

test_that("smoke schema cleanup is explicitly dependency ordered and restricted", {
  sql <- scalar_smoke_schema_cleanup_sql(function(x) paste0('"', x, '"'), "scalar_it_test")
  serving_sql <- serving_smoke_schema_cleanup_sql(function(x) paste0('"', x, '"'), "scalar_it_test")
  profile_sql <- serving_smoke_schema_cleanup_sql(function(x) paste0('"', x, '"'), "profile_it_test")
  building_sql <- serving_smoke_schema_cleanup_sql(function(x) paste0('"', x, '"'), "it_building_publisher_test")
  expect_true(any(grepl('DROP TABLE IF EXISTS "scalar_it_test"."scalar_observation_source" RESTRICT', sql, fixed=TRUE)))
  expect_true(any(grepl('DROP FUNCTION IF EXISTS "scalar_it_test"."reject_smoke_value"() RESTRICT', sql, fixed=TRUE)))
  expect_lt(which(grepl('"scalar_observation_source"', sql, fixed=TRUE))[1L],
            which(grepl('"territory_reference"', sql, fixed=TRUE))[1L])
  expect_lt(which(grepl('"territory_reference"', sql, fixed=TRUE))[1L],
            which(grepl('"table_publication"', sql, fixed=TRUE))[1L])
  expect_true(grepl("DROP SCHEMA IF EXISTS \"scalar_it_test\" RESTRICT", tail(sql, 1L), fixed=TRUE))
  expect_false(any(grepl("CASCADE", sql, fixed=TRUE)))
  expect_true(any(grepl('DROP TABLE IF EXISTS "scalar_it_test"."ordered_series" RESTRICT', serving_sql, fixed=TRUE)))
  expect_true(any(grepl('DROP TABLE IF EXISTS "scalar_it_test"."building_evidence_descriptor_source" RESTRICT', serving_sql, fixed=TRUE)))
  expect_lt(which(grepl('"scalar_observation_source"', serving_sql, fixed=TRUE))[1L],
            which(grepl('"scalar_observation"', serving_sql, fixed=TRUE))[1L])
  expect_lt(which(grepl('"profile_observation_source"', serving_sql, fixed=TRUE))[1L],
            which(grepl('"profile_observation"', serving_sql, fixed=TRUE))[1L])
  expect_true(grepl('DROP SCHEMA IF EXISTS "profile_it_test" RESTRICT', tail(profile_sql, 1L), fixed=TRUE))
  expect_true(grepl('DROP SCHEMA IF EXISTS "it_building_publisher_test" RESTRICT', tail(building_sql, 1L), fixed=TRUE))
  expect_false(any(grepl("CASCADE", c(serving_sql, profile_sql, building_sql), fixed=TRUE)))
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
