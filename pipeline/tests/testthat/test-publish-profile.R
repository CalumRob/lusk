test_that("ADR-0039 comparison family inventory covers in-scope publisher families", {
  expect_setequal(ADR0039_COMPARISON_FAMILIES, c(
    "declared_profile", "numeric_period_collection",
    "numeric_detail_collection", "scalar", "ordered_series", "aedar_fixed"
  ))
  themes <- lapply(c("habitat", "mobilite"), lire_theme_metadata)
  details <- unlist(lapply(themes, declared_detail_profile_ids), use.names=FALSE)
  expect_length(details, 8L)
  expect_true(all(vapply(themes, function(m) {
    expected <- declared_detail_profile_ids(m)
    all(expected %in% names(m$indicator_pages)) &&
      identical(expected, names(Filter(function(contract) identical(contract$completeness,
        "dense_complete") && !is.null(contract$detail_units), m$profile_contracts)))
  }, logical(1L))))
  expect_setequal(details, c("mix_logements", "statut", "type", "age_du_bati",
    "reseaux", "reseaux_par_habitant", "offre_cyclable", "voitures_menage"))
  demography <- lire_theme_metadata("demographie")
  habitat <- themes[[1L]]
  expect_true("structure_age" %in% names(demography$indicator_pages))
  expect_true("distribution_dpe" %in% names(habitat$indicator_pages))
  expect_identical(habitat$indicator_pages$distribution_dpe$comparison$indicator, "part_passoires")
  expect_setequal(c("structure_age", details), c("structure_age", "mix_logements", "statut", "type", "age_du_bati",
    "reseaux", "reseaux_par_habitant", "offre_cyclable", "voitures_menage"))
  expect_length(c("structure_age", details, "distribution_dpe"), 10L)
  root <- pkgload::pkg_path()
  canonical_dir <- Sys.getenv("LUSK_TEST_CANONICAL_DATA_DIR", unset=file.path(root, "..", "public", "data"))
  habitat_rows <- lire_indicateurs_commis("habitat", canonical_dir)
  habitat_canonical <- list(indicateurs=habitat_rows,
    territoires=unique(data.frame(territoire=as.character(habitat_rows$territoire),
      type=as.character(habitat_rows$type))))
  dpe <- project_dpe_profile(habitat_canonical, habitat, "scalar-v1")
  expect_identical(dpe$descriptor$indicator_id, "distribution_dpe")
  expect_identical(dpe$descriptor$comparison_scalar, "part_passoires")
  dpe_comparison <- project_declared_profile_comparisons(list(dpe),
    data.frame(territory_id=character(),territory_type=character(),epci_id=character(),density_class_code=character()),
    "profile-v1","reference-v1")
  expect_equal(nrow(dpe_comparison$groups),0L)
})

test_that("declared profile comparison publishes fixed-context median, ranks and ties", {
  profile <- list(descriptor=list(indicator_id="offre_cyclable", levels="commune",
    comparison_detail="velo", comparison_sex=NA_character_, comparison_direction="high"),
    facts=data.frame(territory_id=c("a","b","c"), territory_type="commune",
      detail="velo", sex="", value=c(4,4,1), status="measured"))
  reference <- data.frame(territory_id=c("a","b","c","r"),
    territory_type=c("commune","commune","commune","region"),
    epci_id="epci-1", density_class_code="dense")
  result <- project_declared_profile_comparisons(list(profile), reference, "pv", "rv")
  density <- result$territories[result$territories$comparison_context == "density_class",]
  expect_equal(unique(result$groups$median[result$groups$comparison_context == "density_class"]), 4)
  expect_equal(density$rank[density$territory_id == "a"], 1L)
  expect_equal(density$rank[density$territory_id == "b"], 1L)
  expect_equal(density$rank[density$territory_id == "c"], 3L)
  expect_equal(density$tie_count[density$territory_id == "b"], 2L)
  expect_true(all(density$profile_content_version == "pv"))
  expect_setequal(unique(result$groups$comparison_context), c("density_class", "epci", "bretagne"))
})

test_that("profile comparison Parquet generations are immutable and version-keyed", {
  directory <- tempfile("profile-comparison-artifact-"); dir.create(directory)
  old <- list(groups=data.frame(indicator_id="old", profile_content_version="old-v"),
    territories=data.frame(territory_id="old", profile_content_version="old-v"))
  current <- list(groups=data.frame(indicator_id="new", profile_content_version="new-v"),
    territories=data.frame(territory_id="new", profile_content_version="new-v"))
  paths <- write_profile_comparison_parquets(old, directory)
  read_pair <- function(files) lapply(files, function(path) readBin(path, what="raw", n=file.info(path)$size))
  old_bytes <- read_pair(paths)
  refreshed <- write_profile_comparison_parquets(current, directory)
  expect_false(identical(paths, refreshed))
  expect_identical(read_pair(paths), old_bytes)
  expect_equal(nanoparquet::read_parquet(refreshed[[1L]])$indicator_id, "new")
  expect_equal(nanoparquet::read_parquet(refreshed[[2L]])$territory_id, "new")
  expect_equal(nanoparquet::read_parquet(refreshed[[1L]])$profile_content_version, "new-v")
  expect_identical(write_profile_comparison_parquets(current, directory), refreshed)
})

test_that("serving publication script requests profile target only with explicit opt-in", {
  expect_identical(serving_publication_target_names(FALSE), "publie_tables_service")
  expect_identical(serving_publication_target_names(TRUE), c("publie_tables_service", "publie_profiles_declares"))
})

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
  # If one canonical bike count is unavailable, the regional ratio stays NA;
  # it must not be turned into a measured zero or partial ratio.
  velo_incomplete <- velo
  velo_incomplete$places[[1L]] <- NA_real_
  parking_incomplete <- agreger_stationnement_voiture_territoires(
    data.frame(commune=base$CODGEO,places_voiture=c(10,90)),
    velo_incomplete, base)
  expect_true(is.na(region_value(parking_incomplete,
    "stationnement_velo_par_voiture")))
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
  rows <- lire_indicateurs_commis("habitat", canonical_dir)
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

test_that("same profile content rebuilds comparison memberships on reference change and repairs stale markers", {
  metadata <- lire_theme_metadata("demographie")
  canonical <- compute_payload(load_fixture())
  profile <- project_structure_age_profile(canonical, metadata)
  reference_version <- "ref-1"
  marker <- data.frame(content_version="initial", reference_content_version="ref-1")
  comparison_marker <- NULL; saved <- NULL; profile_rows <- "old-facts"; writes <- 0L; fail_replace <- FALSE
  reference <- data.frame(territory_id=profile$eligible_territories$territory_id,
    territory_type=profile$eligible_territories$territory_type,
    epci_id=NA_character_, density_class_code=NA_character_)
  reference <- rbind(reference, data.frame(territory_id="bretagne", territory_type="region",
    epci_id=NA_character_, density_class_code=NA_character_))
  reference$epci_id[reference$territory_type == "commune"] <- "epci"
  reference$density_class_code[reference$territory_type == "commune"] <- "dense"
  db <- list(
    transaction=function(expr) {
      old <- list(marker=marker, comparison_marker=comparison_marker, saved=saved, profile_rows=profile_rows)
      tryCatch(force(expr), error=function(e) { marker <<- old$marker; comparison_marker <<- old$comparison_marker; saved <<- old$saved; profile_rows <<- old$profile_rows; stop(e) })
    },
    marker=function(name) marker,
    reference_marker=function() data.frame(content_version=reference_version),
    validate_territories=function(...) invisible(NULL),
    prepare_comparisons=function(profiles, version, ref_version) {
      projected <- project_declared_profile_comparisons(profiles, reference, version, ref_version)
      cv <- profile_content_version(projected)
      artifact <<- projected
      writes <<- writes + 1L
      stale <- is.null(comparison_marker) || !identical(comparison_marker$content_version, cv) ||
        !identical(comparison_marker$reference_content_version, ref_version)
      list(stale=stale, projection=projected)
    },
    replace=function(projection, version) {
      profile_rows <<- "partially-replaced-facts"
      saved <<- db$prepare_comparisons(list(projection), version, reference_version)$projection
      marker <<- data.frame(content_version=version, reference_content_version=reference_version)
      comparison_marker <<- data.frame(content_version=profile_content_version(saved), reference_content_version=reference_version)
      if (fail_replace) stop("comparison replacement failed", call.=FALSE)
    },
    write_artifacts=function() stop("artifact writing must not occur after transaction")
  )
  artifact <- NULL
  registry <- register_structure_age_profile_publisher(list(), metadata)
  first <- publish_registered_profile(registry, "structure_age", canonical, db)
  expect_true(first$changed)
  first_comparison_version <- profile_content_version(saved)
  expect_identical(profile_content_version(artifact), first_comparison_version)
  no_op <- publish_registered_profile(registry, "structure_age", canonical, db)
  expect_false(no_op$changed)
  expect_identical(profile_content_version(artifact), first_comparison_version)
  reference_version <- "ref-2"
  reference$density_class_code[reference$territory_type == "commune"] <- "sparse"
  rebuilt <- publish_registered_profile(registry, "structure_age", canonical, db)
  expect_true(rebuilt$changed)
  expect_identical(marker$content_version, first$content_version)
  expect_identical(comparison_marker$reference_content_version, "ref-2")
  expect_false(identical(profile_content_version(saved), first_comparison_version))
  comparison_marker <- NULL
  repaired <- publish_registered_profile(registry, "structure_age", canonical, db)
  expect_true(repaired$changed)
  expect_equal(writes, 7L)
  before <- list(marker=marker, saved=saved, profile_rows=profile_rows, comparison_marker=comparison_marker)
  fail_replace <- TRUE
  comparison_marker <- NULL
  before$comparison_marker <- NULL
  expect_error(publish_registered_profile(registry, "structure_age", canonical, db), "comparison replacement failed")
  expect_identical(marker, before$marker)
  expect_identical(saved, before$saved)
  expect_identical(profile_rows, before$profile_rows)
})

test_that("registered publication keeps marker-bound immutable Parquet generations across failures and retries", {
  metadata <- lire_theme_metadata("demographie")
  canonical <- compute_payload(load_fixture())
  reference <- unique(data.frame(territory_id=canonical$territoires$territoire,
    territory_type=canonical$territoires$type, epci_id=NA_character_, density_class_code=NA_character_))
  state <- new.env(parent=emptyenv())
  state$marker <- "old-marker"; state$facts <- "old-facts"; state$artifact_version <- "old-generation"
  state$artifact_dir <- tempfile("registered-profile-generations-"); dir.create(state$artifact_dir)
  state$comparison <- NULL; state$fail_write <- FALSE; state$fail_commit <- FALSE; state$fail_second_rename <- FALSE
  registry <- register_profile_publisher(list(), "fixture",
    function(x) project_structure_age_profile(x, metadata),
    function(projection, db, version) db$replace(projection, version))
  adapter <- list(
    transaction=function(expr) {
      old <- mget(c("marker","facts","artifact_version","comparison"), envir=state, inherits=FALSE)
      result <- tryCatch(force(expr), error=function(e) {
        list2env(old, envir=state); stop(e)
      })
      if (state$fail_commit) { list2env(old, envir=state); stop("commit rejected", call.=FALSE) }
      result
    },
    marker=function(...) data.frame(content_version=state$marker, reference_content_version="ref-v1"),
    reference_marker=function() data.frame(content_version="ref-v1"),
    validate_territories=function(...) invisible(NULL),
    prepare_comparisons=function(profiles, version, ref) {
      comparison <- project_declared_profile_comparisons(profiles, reference, version, ref)
      if (state$fail_write) stop("artifact writer rejected", call.=FALSE)
      rename <- file.rename
      if (state$fail_second_rename) {
        count <- 0L
        rename <- function(from, to) { count <<- count + 1L; if (count == 2L) FALSE else file.rename(from,to) }
        state$fail_second_rename <- FALSE
      }
      paths <- write_profile_comparison_parquets(comparison, state$artifact_dir, rename_fn=rename)
      state$comparison <- list(version=profile_content_version(comparison), paths=paths)
      stale <- !identical(state$artifact_version, state$comparison$version)
      list(stale=stale, projection=comparison)
    },
    replace=function(projection, version) {
      state$facts <- version; state$marker <- version
      state$artifact_version <- state$comparison$version
    })
  publish <- function(x=canonical) publish_registered_profile(registry,"fixture",x,adapter)
  publish()
  old_marker <- state$marker; old_facts <- state$facts; old_artifact <- state$artifact_version
  old_paths <- state$comparison$paths
  changed <- canonical; changed$indicateurs$value[which(changed$indicateurs$key=="structure_age")[[1L]]] <-
    changed$indicateurs$value[which(changed$indicateurs$key=="structure_age")[[1L]]] + .01
  state$fail_write <- TRUE
  expect_error(publish(changed), "artifact writer rejected")
  expect_identical(state$marker,old_marker); expect_identical(state$facts,old_facts)
  expect_true(all(file.exists(old_paths))); expect_identical(state$artifact_version,old_artifact)
  state$fail_write <- FALSE; state$fail_commit <- TRUE
  expect_error(publish(changed), "commit rejected")
  expected_changed <- project_declared_profile_comparisons(
    list(project_structure_age_profile(changed,metadata)), reference,
    profile_content_version(project_structure_age_profile(changed,metadata)), "ref-v1")
  orphan_version <- profile_content_version(expected_changed)
  orphan_paths <- file.path(state$artifact_dir,paste0("profile-comparison-",orphan_version),
    c("groups.parquet","territories.parquet"))
  expect_identical(state$marker,old_marker); expect_identical(state$facts,old_facts)
  expect_identical(state$artifact_version,old_artifact); expect_true(all(file.exists(old_paths)))
  expect_true(all(file.exists(orphan_paths))); expect_false(identical(orphan_version,state$artifact_version))
  state$fail_commit <- FALSE
  retried <- publish(changed)
  expect_true(retried$changed); expect_identical(state$artifact_version,orphan_version)
  expect_identical(state$comparison$paths,orphan_paths)
  active_path <- file.path(state$artifact_dir,paste0("profile-comparison-",state$artifact_version))
  expect_true(all(startsWith(state$comparison$paths,active_path)))
  state$fail_second_rename <- TRUE
  changed_again <- changed; changed_again$indicateurs$value[which(changed_again$indicateurs$key=="structure_age")[[1L]]] <-
    changed_again$indicateurs$value[which(changed_again$indicateurs$key=="structure_age")[[1L]]] + .02
  expected_partial <- project_declared_profile_comparisons(
    list(project_structure_age_profile(changed_again,metadata)), reference,
    profile_content_version(project_structure_age_profile(changed_again,metadata)), "ref-v1")
  partial_paths <- file.path(state$artifact_dir,paste0("profile-comparison-",profile_content_version(expected_partial)),
    c("groups.parquet","territories.parquet"))
  expect_error(publish(changed_again), "Could not install")
  expect_true(sum(file.exists(partial_paths)) == 1L)
  publish(changed_again)
  expect_true(all(file.exists(partial_paths)))
})

test_that("declared profile serving artifacts consume the same projection as the database publisher", {
  metadata <- lire_theme_metadata("habitat")
  payload <- payload_habitat()
  root <- tempfile("profile-serving-"); dir.create(root)
  on.exit(unlink(root, recursive = TRUE), add = TRUE)
  binding <- strrep("1a", 16L)
  published <- materialize_theme_profile_artifacts(payload, metadata, NULL, "habitat", root, binding)
  expect_setequal(names(published), profile_serving_owners(metadata))
  # The stored content version is exactly the version the database publisher
  # recomputes from the same restored projection, so the artifact and the live
  # marker can never diverge.
  restored <- read_profile_serving_profiles(root, names(published), scalar_binding = binding)
  for (owner in names(published))
    expect_identical(published[[owner]], profile_content_version(restored[[owner]]))
  # The verified scalar binding round-trips through the artifact directory.
  cache_profile_scalar_binding(binding, root)
  expect_identical(read_profile_scalar_binding(root), binding)
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
