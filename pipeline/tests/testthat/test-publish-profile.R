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

test_that("canonical regional Mobility producers feed complete profiles and supported parking facts", {
  metadata <- lire_theme_metadata("mobilite")
  base <- data.frame(CODGEO=c("22001","29001"), EPCI=c("200000001","200000001"),
    DEP=c("22","29"), stringsAsFactors=FALSE)
  communes <- data.frame(commune=base$CODGEO, population=c(1000,3000),
    longueur_t=c(12,18), longueur_b=c(2,7), longueur_c=c(9,21))
  reseaux <- agreger_reseaux_territoires(communes, base)
  reseaux_hab <- agreger_reseaux_par_habitant_territoires(
    communes[c("commune","longueur_t","longueur_b","longueur_c")],
    data.frame(commune=base$CODGEO,population=c(1000,3000)),base)
  velo <- data.frame(commune=base$CODGEO, population=c(1000,3000),
    places=c(1,90), places_1000=c(1,30))
  cyclable <- data.frame(commune=base$CODGEO, population=velo$population,
    protege_longueur=c(2,8), protege_km_1000=c(2,8/3),
    partage_longueur=c(1,4), partage_km_1000=c(1,4/3), total_longueur=c(3,12))
  offre <- agreger_offre_territoires(
    data.frame(commune=base$CODGEO,part_proche=c(.2,.8),n_batiments=c(10,30)),
    data.frame(commune=base$CODGEO,nb_bornes=c(0L,1L)), velo, base, cyclable)
  parking <- agreger_stationnement_voiture_territoires(
    data.frame(commune=base$CODGEO,places_voiture=c(10,90)), velo, base)

  region_value <- function(rows, key, detail=NULL) {
    row <- rows[rows$code == "53" & rows$key == key &
      (if (is.null(detail)) is.na(rows$detail) else rows$detail == detail), , drop=FALSE]
    expect_equal(nrow(row), 1L, info=paste(key, detail %||% "scalar"))
    row$value[[1L]]
  }
  expect_equal(region_value(reseaux,"reseaux","t_longueur"),30)
  expect_equal(region_value(reseaux,"reseaux","b_longueur"),9)
  expect_equal(region_value(reseaux_hab,"reseaux_par_habitant","t_km_1000"),7.5)
  expect_equal(region_value(offre,"offre_cyclable","protege_longueur"),10)
  expect_equal(region_value(offre,"offre_cyclable","partage_longueur"),5)
  expect_equal(region_value(offre,"offre_cyclable","total_longueur"),15)
  expect_equal(region_value(offre,"places_stationnement_velo_1000"),22.75)
  expect_equal(region_value(parking,"places_stationnement_voiture_1000"),25)
  # Ratio is a producer-derived count ratio (91 bike places / 100 car places),
  # not an average of commune ratios (0.55).
  expect_equal(region_value(parking,"stationnement_velo_par_voiture"),.91)

  territory_types <- data.frame(code=c(base$CODGEO,"200000001","22","29","53"),
    type=c("commune","commune","epci","departement","departement","region"))
  profile_from <- function(rows, key, source) {
    rows <- rows[rows$key == key, , drop=FALSE]
    rows$territoire <- rows$code
    rows$type <- territory_types$type[match(rows$code,territory_types$code)]
    rows$key <- key
    rows$sex <- NA_character_
    rows$unit <- unname(unlist(metadata$profile_contracts[[key]]$detail_units)[rows$detail])
    record <- metadata$source_records[[source]]
    vintage <- record$vintages[[1L]]
    rows$vintage_source <- record$dataset
    rows$vintage_version <- vintage$version
    rows$vintage_date_reference <- vintage$dateReference
    rows$vintage_date_publication <- vintage$datePublication
    sources <- unlist(metadata$indicator_pages[[key]]$sources, use.names=FALSE)
    source_vintages <- do.call(rbind, lapply(sources, function(source_id) {
      source_record <- metadata$source_records[[source_id]]
      source_vintage <- source_record$vintages[[1L]]
      data.frame(id=source_id, source=source_record$dataset,
        version=source_vintage$version, date_reference=source_vintage$dateReference,
        date_publication=source_vintage$datePublication, stringsAsFactors=FALSE)
    }))
    project_declared_detail_profile(list(indicateurs=rows,
      territoires=data.frame(territoire=territory_types$code,type=territory_types$type),
      source_vintages=source_vintages),metadata,key)
  }
  network_profile <- profile_from(reseaux,"reseaux","amenagements_cyclables")
  per_capita_profile <- profile_from(reseaux_hab,"reseaux_par_habitant","osm_reseaux")
  cycling_profile <- profile_from(offre,"offre_cyclable","osm_reseaux")
  expect_setequal(network_profile$facts$detail[network_profile$facts$territory_id=="53"],
    c("t_longueur","b_longueur","c_longueur"))
  expect_true(all(network_profile$facts$status[network_profile$facts$territory_id=="53"]=="measured"))
  expect_true("region" %in% per_capita_profile$descriptor$levels)
  expect_setequal(per_capita_profile$facts$detail[per_capita_profile$facts$territory_id=="53"],
    c("t_km_1000","b_km_1000","c_km_1000"))
  expect_equal(per_capita_profile$facts$value[per_capita_profile$facts$territory_id=="53"],
    c(2.25, 7.5, 7.5))
  expect_true(all(per_capita_profile$facts$status[per_capita_profile$facts$territory_id=="53"]=="measured"))
  expect_setequal(cycling_profile$facts$detail[cycling_profile$facts$territory_id=="53"],
    unlist(metadata$indicator_pages$offre_cyclable$comparison$details,use.names=FALSE))
  expect_true(all(cycling_profile$facts$status[cycling_profile$facts$territory_id=="53"]=="measured"))

  # Project the actual canonical producer outputs through the scalar serving
  # contract. The regional ratio is supported only by both canonical counts;
  # no display-layer arithmetic is involved.
  parking_rows <- data.frame(
    territory_id=rep("53", 3), territory_type=rep("region", 3),
    indicator_id=c("places_stationnement_velo_1000",
      "places_stationnement_voiture_1000", "stationnement_velo_par_voiture"),
    value=c(region_value(offre,"places_stationnement_velo_1000"),
      region_value(parking,"places_stationnement_voiture_1000"),
      region_value(parking,"stationnement_velo_par_voiture")),
    unit=c("places / 1 000 hab", "places / 1 000 hab",
      "places vÃ©lo / place voiture"),
    source_name=rep("", 3), source_version=rep("", 3),
    reference_date=rep("", 3), publication_date=rep("", 3),
    stringsAsFactors=FALSE)
  scalar_vintages <- do.call(rbind, lapply(c("stationnement-velo","osm_reseaux"), function(source_id) {
    source_record <- metadata$source_records[[source_id]]
    source_vintage <- source_record$vintages[[1L]]
    data.frame(id=source_id, source=source_record$dataset,
      version=source_vintage$version, date_reference=source_vintage$dateReference,
      date_publication=source_vintage$datePublication, stringsAsFactors=FALSE)
  }))
  for (i in seq_len(nrow(parking_rows))) {
    parking_rows$unit[[i]] <- metadata$indicator_pages[[parking_rows$indicator_id[[i]]]]$unit
    source_id <- unlist(metadata$indicator_pages[[parking_rows$indicator_id[[i]]]]$sources, use.names=FALSE)[[1L]]
    source_record <- metadata$source_records[[source_id]]
    source_vintage <- source_record$vintages[[1L]]
    parking_rows$source_name[[i]] <- source_record$dataset
    parking_rows$source_version[[i]] <- source_vintage$version
    parking_rows$reference_date[[i]] <- source_vintage$dateReference
    parking_rows$publication_date[[i]] <- source_vintage$datePublication
  }
  scalar <- project_scalar_canonical_rows(parking_rows, metadata,
    c("places_stationnement_velo_1000", "places_stationnement_voiture_1000",
      "stationnement_velo_par_voiture"),
    data.frame(territory_id="53", territory_type="region"),
    source_vintages=scalar_vintages)
  regional <- scalar$facts[scalar$facts$territory_id == "53", , drop=FALSE]
  expect_true(all(vapply(c("places_stationnement_velo_1000",
    "places_stationnement_voiture_1000", "stationnement_velo_par_voiture"),
    function(id) "region" %in% scalar$descriptors$allowed_levels[[
      match(id, scalar$descriptors$indicator_id)]], logical(1L))))
  expect_equal(regional$value[match(c("places_stationnement_velo_1000",
    "places_stationnement_voiture_1000","stationnement_velo_par_voiture"),
    regional$indicator_id)], c(22.75,25,.91))
  expect_true(all(regional$status == "measured"))
})

test_that("Mobility density signature preserves independent range, density and decile coordinates", {
  metadata <- lire_theme_metadata("mobilite")
  fields <- c("territoire", "type", "story_key", "dens_min", "dens_max",
    paste0("dens_", 1:10), paste0("dec_", 1:10), "vintage_source", "vintage_version",
    "vintage_date_reference", "vintage_date_publication")
  history <- as.data.frame(setNames(rep(list(NA), length(fields)), fields), stringsAsFactors=FALSE)
  history[1,] <- c(list("35238", "commune", "vingt-minutes-sans-voiture", 1, 52),
    as.list(seq(.01,.10,.01)), as.list(c(1,4,8,12,18,NA,NA,33,42,52)),
    list(metadata$source_records$mobilite_snapshot$dataset,"2026-02","2026-02-28","2026-08-06"))
  vintage <- data.frame(id="mobilite_snapshot",source=metadata$source_records$mobilite_snapshot$dataset,
    version="2026-02",date_reference="2026-02-28",date_publication="2026-08-06")
  histories <- do.call(rbind, lapply(list(c("35238","commune"), c("200000001","epci"),
    c("35","departement"), c("53","region")), function(identity) {
      row <- history
      row$territoire <- identity[[1L]]
      row$type <- identity[[2L]]
      row
  }))
  projected <- project_mobility_density_distribution(histories, vintage, metadata)
  focal_range <- projected$ranges[projected$ranges$territory_id == "35238",]
  focal_points <- projected$points[projected$points$territory_id == "35238",]
  expect_equal(focal_range$range_min, 1)
  expect_equal(focal_range$range_max, 52)
  expect_equal(focal_points$density, seq(.01,.10,.01))
  expect_equal(focal_points$decile, c(1,4,8,12,18,NA,NA,33,42,52))
  expect_identical(focal_points$ordinal, 0:9)
  expect_setequal(unique(projected$ranges$territory_type), c("commune","epci","departement","region"))
  expect_identical(focal_points$decile_status[6:7], c("not_available","not_available"))
  restricted <- metadata
  restricted$distribution_contracts$mobilite_density_distribution$allowed_focal_levels <- "commune"
  expect_error(project_mobility_density_distribution(histories, vintage, restricted), "outside.*producer-declared focal levels")
  expect_error(project_mobility_density_distribution(history[c("territoire", "type")], vintage, metadata),
    "fields are incomplete")
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
