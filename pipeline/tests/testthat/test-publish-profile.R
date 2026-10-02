test_that("dense profile validator rejects incomplete, duplicate, and undeclared cells", {
  axes <- data.frame(axis_name = c("detail", "detail", "sex", "sex"),
    axis_key = c("a", "b", "F", "M"), label = c("A", "B", "Femmes", "Hommes"), ordinal = c(0L,1L,0L,1L), unit="%")
  descriptor <- list(levels = "commune", details = c("a", "b"), sexes = c("F", "M"),
    comparison_detail = "a", comparison_sex = "F", comparison_direction = "high")
  facts <- expand.grid(territory_id = "x", territory_type = "commune", detail = c("a", "b"), sex = c("F", "M"), stringsAsFactors = FALSE)
  facts$value <- 0.25
  facts$status <- "measured"
  expect_invisible(validate_declared_profile(facts, descriptor, axes))
  expect_error(validate_declared_profile(facts[-1, ], descriptor, axes), "missing coordinates")
  expect_error(validate_declared_profile(rbind(facts, facts[1, ]), descriptor, axes), "Duplicate")
  facts$detail[1] <- "outside"
  expect_error(validate_declared_profile(facts, descriptor, axes), "Undeclared")
  facts$detail[1] <- "a"
  bad_facet <- descriptor
  bad_facet$comparison_detail <- "outside"
  expect_error(validate_declared_profile(facts, bad_facet, axes), "comparison facet")
  bad_facet <- descriptor
  bad_facet$comparison_sex <- "X"
  expect_error(validate_declared_profile(facts, bad_facet, axes), "comparison facet")
  bad_facet <- descriptor
  bad_facet$comparison_direction <- "none"
  expect_error(validate_declared_profile(facts, bad_facet, axes), "comparison facet")
})

test_that("dense one-axis profiles compare a declared detail without fabricating a sex axis", {
  facts <- data.frame(territory_id=c("x","x"), territory_type="commune",
    detail=c("protected","shared"), sex="", value=c(2,3), status="measured")
  axes <- data.frame(axis_name="detail", axis_key=c("protected","shared"),
    label=c("Protected","Shared"), ordinal=0:1, unit="km")
  descriptor <- list(levels="commune", details=c("protected","shared"), sexes=character(),
    comparison_detail="protected", comparison_sex=NA_character_, comparison_direction="high")
  expect_invisible(validate_declared_profile(facts, descriptor, axes))
  expect_error(validate_declared_profile(facts[-1,,drop=FALSE], descriptor, axes), "missing coordinates")
  bad <- descriptor; bad$comparison_sex <- "F"
  expect_error(validate_declared_profile(facts, bad, axes), "comparison facet")
})

test_that("closed mobility profile projections preserve all canonical details and per-detail units", {
  metadata <- lire_theme_metadata("mobilite")
  details <- unlist(metadata$indicator_pages$offre_cyclable$comparison$details, use.names=FALSE)
  territories <- data.frame(territoire=c("35238","35238","35238","35238","35238"),
    type="commune", stringsAsFactors=FALSE)
  rows <- data.frame(territoire="35238", type="commune", key="offre_cyclable",
    detail=details, sex=NA_character_, value=c(1,2,3,4,5), unit=unname(unlist(metadata$profile_contracts$offre_cyclable$detail_units)[details]),
    vintage_source=metadata$source_records$osm_reseaux$dataset, vintage_version="2026-08", vintage_date_reference="2026-08-05",
    vintage_date_publication="2026-08-06", stringsAsFactors=FALSE)
  canonical_vintages <- data.frame(id="osm_reseaux", source=metadata$source_records$osm_reseaux$dataset,
    version="2026-08", date_reference="2026-08-05", date_publication="2026-08-06")
  canonical <- list(indicateurs=rows, territoires=territories, source_vintages=canonical_vintages)
  profile <- project_mobility_profile(canonical, metadata, "offre_cyclable")
  expect_identical(profile$facts$detail, details)
  expect_identical(profile$axes$unit, c("km", "km / 1 000 hab", "km", "km / 1 000 hab", "km"))
  expect_equal(profile$facts$value, c(1,2,3,4,5))
  expect_identical(profile$descriptor$source, "osm_reseaux")
  expect_match(profile$descriptor$denominator_semantics, "population")
  historical <- rbind(canonical_vintages, transform(canonical_vintages, version="old", date_reference="2025-01-01", date_publication="2025-01-02"))
  historical$id[2] <- "historic-unused"
  expanded <- project_mobility_profile(list(indicateurs=rows,territoires=territories,source_vintages=historical), metadata, "offre_cyclable")
  expect_equal(nrow(expanded$vintages), 1L)
  expect_true(all(expanded$provenance$vintage_id == "2026-08/2026-08-05"))
  rows$unit[2] <- "km"
  expect_error(project_mobility_profile(list(indicateurs=rows,territoires=territories,source_vintages=canonical_vintages), metadata, "offre_cyclable"), "undeclared unit")
  rows$unit[2] <- NA_character_
  expect_error(project_mobility_profile(list(indicateurs=rows,territoires=territories,source_vintages=canonical_vintages), metadata, "offre_cyclable"), "undeclared unit")
  rows$unit[2] <- "km / 1 000 hab"
  bad_vintages <- canonical_vintages; bad_vintages$source <- "wrong dataset"
  expect_error(project_mobility_profile(list(indicateurs=rows,territoires=territories,source_vintages=bad_vintages), metadata, "offre_cyclable"), "freshness stamp")
  bad_metadata <- metadata; bad_metadata$profile_contracts$offre_cyclable$completeness <- "sparse"
  expect_error(project_mobility_profile(canonical, bad_metadata, "offre_cyclable"), "contract is incomplete")
})

test_that("the four Habitat detail profiles project canonical cells including regional facts", {
  metadata <- lire_theme_metadata("habitat")
  root <- pkgload::pkg_path()
  canonical_dir <- Sys.getenv("LUSK_TEST_CANONICAL_DATA_DIR", unset=file.path(root, "..", "public", "data"))
  rows <- nanoparquet::read_parquet(file.path(canonical_dir, "indicateurs_habitat.parquet"))
  territories <- unique(data.frame(territoire=as.character(rows$territoire), type=as.character(rows$type)))
  canonical <- list(indicateurs=rows, territoires=territories)
  for (id in c("mix_logements", "statut", "type", "age_du_bati")) {
    projection <- project_declared_detail_profile(canonical, metadata, id)
    expected <- rows[rows$key == id, , drop=FALSE]
    expect_equal(nrow(projection$facts), nrow(expected))
    expect_equal(projection$facts$value, expected$value)
    expect_true(any(projection$facts$status == "measured"))
    expect_identical(projection$descriptor$levels, c("commune", "epci", "departement", "region"))
    expect_true("region" %in% projection$facts$territory_type)
    expect_true(all(projection$axes$unit == "%"))
    expect_identical(projection$descriptor$comparison_detail,
      unlist(metadata$indicator_pages[[id]]$comparison$detail, use.names=FALSE))
  }
})

test_that("multi-source profile lineage is limited to each current declared producer vintage", {
  metadata <- lire_theme_metadata("mobilite")
  details <- unlist(metadata$indicator_pages$reseaux_par_habitant$comparison$details, use.names=FALSE)
  units <- unlist(metadata$profile_contracts$reseaux_par_habitant$detail_units, use.names=TRUE)
  rows <- data.frame(territoire="35238", type="commune", key="reseaux_par_habitant",
    detail=details, sex=NA_character_, value=1:3, unit=unname(units[details]),
    vintage_source=metadata$source_records$osm_reseaux$dataset, vintage_version="2026-08",
    vintage_date_reference="2026-08-05", vintage_date_publication="2026-08-06")
  territories <- data.frame(territoire="35238", type="commune")
  vintages <- do.call(rbind, lapply(c("osm_reseaux", "stationnement-velo"), function(id) {
    v <- metadata$source_records[[id]]$vintages[[1]]
    data.frame(id=id, source=metadata$source_records[[id]]$dataset, version=v$version,
      date_reference=v$dateReference, date_publication=v$datePublication)
  }))
  vintages <- rbind(vintages, data.frame(id="historic-unused", source="unused", version="old",
    date_reference="2020-01-01", date_publication="2020-01-02"))
  profile <- project_mobility_profile(list(indicateurs=rows, territoires=territories), metadata,
    "reseaux_par_habitant", vintages)
  expect_setequal(unique(profile$provenance$source_id), c("osm_reseaux", "stationnement-velo"))
  expect_equal(nrow(profile$vintages), 2L)
  expect_false(any(profile$provenance$source_id == "historic-unused"))
  invalid_vintages <- vintages[vintages$id != "stationnement-velo", , drop=FALSE]
  expect_error(project_mobility_profile(list(indicateurs=rows, territoires=territories), metadata,
    "reseaux_par_habitant", invalid_vintages), "Missing or duplicate")
})

test_that("primary multi-vintage facts retain only their matching territory vintage associations", {
  metadata <- lire_theme_metadata("mobilite")
  details <- unlist(metadata$indicator_pages$offre_cyclable$comparison$details, use.names=FALSE)
  units <- unlist(metadata$profile_contracts$offre_cyclable$detail_units, use.names=TRUE)
  rows <- do.call(rbind, lapply(c("35238", "35239"), function(territory) {
    old <- territory == "35239"
    data.frame(territoire=territory, type="commune", key="offre_cyclable", detail=details,
      sex=NA_character_, value=seq_along(details), unit=unname(units[details]),
      vintage_source="Canonical OSM title",
      vintage_version=if (old) "2025-08" else "2026-08",
      vintage_date_reference=if (old) "2025-08-05" else "2026-08-05",
      vintage_date_publication=if (old) "2025-08-06" else "2026-08-06", stringsAsFactors=FALSE)
  }))
  territories <- data.frame(territoire=c("35238", "35239"), type="commune")
  vintage <- data.frame(id="osm_reseaux", source="Canonical OSM title",
    version=c("2026-08", "2025-08"), date_reference=c("2026-08-05", "2025-08-05"),
    date_publication=c("2026-08-06", "2025-08-06"))
  profile <- project_mobility_profile(list(indicateurs=rows, territoires=territories), metadata,
    "offre_cyclable", vintage)
  for (territory in territories$territoire) {
    expected_vintage <- if (territory == "35238") "2026-08/2026-08-05" else "2025-08/2025-08-05"
    associations <- profile$provenance[profile$provenance$territory_id == territory, ]
    expect_equal(unique(associations$vintage_id), expected_vintage)
    expect_equal(nrow(associations), length(details))
  }
  expect_equal(nrow(profile$vintages), 2L)
})

test_that("structure_age projection uses canonical fixture and descriptor order", {
  metadata <- lire_theme_metadata("demographie")
  canonical <- compute_payload(load_fixture())$indicateurs
  profile <- project_structure_age_profile(canonical, metadata)
  expect_identical(profile$axes$axis_key[profile$axes$axis_name == "detail"],
    unlist(metadata$indicator_pages$structure_age$comparison$details, use.names = FALSE))
  expect_identical(profile$axes$axis_key[profile$axes$axis_name == "sex"], c("F", "M"))
  canonical_rows <- canonical[canonical$key == "structure_age" & canonical$type %in% unlist(metadata$indicator_pages$structure_age$levels), , drop=FALSE]
  expect_equal(nrow(profile$facts), nrow(canonical_rows))
  expect_equal(profile$facts$value, canonical_rows$value)
  expect_identical(profile$facts$status, ifelse(is.na(canonical_rows$value), "not_available", "measured"))
  expect_setequal(unique(profile$facts$territory_type), unlist(metadata$indicator_pages$structure_age$levels))
  canonical$value[which(canonical$key == "structure_age")[[1L]]] <- NA_real_
  unavailable <- project_structure_age_profile(canonical, metadata)
  expect_equal(sum(unavailable$facts$status == "not_available"), 1L)
  expect_true(is.na(unavailable$facts$value[unavailable$facts$status == "not_available"][[1L]]))
})

test_that("profile publisher keeps the committed version when replacement fails", {
  marker <- "old-complete"
  stored <- "old-facts"
  replaced <- FALSE
  db <- list(transaction = function(expr) {
    before <- list(marker=marker,stored=stored)
    tryCatch(force(expr), error=function(e) { marker <<- before$marker; stored <<- before$stored; stop(e) })
  }, marker = function(name)
    data.frame(content_version = marker), reference_marker = function() data.frame(content_version="ref-v1"),
    validate_territories = function(...) invisible(NULL), replace = function(projection, version) {
      replaced <<- TRUE
      stored <<- "partial replacement"
      marker <<- version
      stop("fixture write rejected")
    })
  metadata <- lire_theme_metadata("demographie")
  canonical <- compute_payload(load_fixture())
  registry <- register_structure_age_profile_publisher(list(), metadata)
  expect_error(publish_registered_profile(registry, "structure_age", canonical, db), "fixture write rejected")
  expect_true(replaced)
  expect_identical(marker, "old-complete")
  expect_identical(stored, "old-facts")
})

test_that("profile smoke cleanup removes only its owned schema in dependency order with RESTRICT", {
  sql <- profile_smoke_schema_cleanup_sql(function(parts) paste0('"', parts, '"'), "profile_it_test")
  joined <- paste(sql, collapse="\n")
  expect_true(grepl('DROP TABLE IF EXISTS "profile_it_test"."profile_observation_source" RESTRICT', joined, fixed=TRUE))
  expect_true(grepl('DROP TABLE IF EXISTS "profile_it_test"."series_named_reference_descriptor" RESTRICT', joined, fixed=TRUE))
  expect_lt(gregexpr('series_named_reference_provenance', joined, fixed=TRUE)[[1L]][[1L]],
    gregexpr('series_named_reference" RESTRICT', joined, fixed=TRUE)[[1L]][[1L]])
  expect_lt(gregexpr('series_named_reference" RESTRICT', joined, fixed=TRUE)[[1L]][[1L]],
    gregexpr('series_named_reference_descriptor" RESTRICT', joined, fixed=TRUE)[[1L]][[1L]])
  expect_lt(gregexpr('series_named_reference_descriptor', joined, fixed=TRUE)[[1L]][[1L]],
    gregexpr('series_dataset_descriptor" RESTRICT', joined, fixed=TRUE)[[1L]][[1L]])
  expect_true(grepl('DROP TABLE IF EXISTS "profile_it_test"."profile_observation" RESTRICT', joined, fixed=TRUE))
  expect_true(grepl('DROP TABLE IF EXISTS "profile_it_test"."profile_descriptor" RESTRICT', joined, fixed=TRUE))
  expect_true(grepl('DROP FUNCTION IF EXISTS "profile_it_test"."assert_profile_territory_level"() RESTRICT', joined, fixed=TRUE))
  expect_true(grepl('DROP FUNCTION IF EXISTS "profile_it_test"."reject_profile_insert"() RESTRICT', joined, fixed=TRUE))
  expect_lt(gregexpr('profile_observation_source', joined, fixed=TRUE)[[1L]][[1L]],
    gregexpr('profile_observation" RESTRICT', joined, fixed=TRUE)[[1L]][[1L]])
  expect_true(endsWith(tail(sql, 1L), 'DROP SCHEMA IF EXISTS "profile_it_test" RESTRICT'))
  expect_false(grepl("CASCADE", joined, fixed=TRUE))
  expect_error(profile_smoke_schema_cleanup_sql(identity, "public"), "owned profile smoke schema")
})
