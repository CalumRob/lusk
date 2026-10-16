seed_scalar_artifact_fixture_from_producer_outputs <- function(themes) {
  # Fixture adapter only: source the committed producer fixtures once, then
  # exercise the production writer/reader contract. No production code reads
  # these legacy theme filenames.
  public <- file.path(pkgload::pkg_path(), "..", "public", "data")
  destination <- tempfile("scalar-serving-fixture-")
  dir.create(destination)
  vintages <- nanoparquet::read_parquet(file.path(public, "vintages.parquet"))
  territories <- nanoparquet::read_parquet(file.path(public, "territoires.parquet"))
  for (theme in themes) {
    payload <- list(
      indicateurs=lire_indicateurs_commis(theme, public),
      territoires=territories
    )
    metadata <- jsonlite::fromJSON(file.path(public, paste0("theme_", theme, ".json")), simplifyVector=FALSE)
    materialize_theme_scalar_artifact(payload, metadata, vintages, theme, destination)
  }
  destination
}

test_that("scalar publisher validates registered canonical fixture facts", {
  canonical <- compute_payload(load_fixture())$indicateurs
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

test_that("legacy service-share source declarations are excluded from retained scalar publication", {
  root <- file.path(pkgload::pkg_path(), "..", "public", "data")
  metadata <- lire_theme_metadata("mobilite")
  excluded <- names(metadata$sources)[vapply(names(metadata$sources), function(id) {
    record <- metadata$source_records[[metadata$sources[[id]]]]
    identical(record$serving_disposition, "excluded_legacy_accessibility")
  }, logical(1))]
  expect_gt(length(excluded), 0L)
  artifacts <- seed_scalar_artifact_fixture_from_producer_outputs(
    c("economie", "demographie", "mobilite", "habitat"))
  on.exit(unlink(artifacts, recursive=TRUE), add=TRUE)
  territories <- nanoparquet::read_parquet(file.path(root, "territoires.parquet"))
  reference <- project_territory_reference(territories)
  snapshot <- project_retained_scalar_snapshot(root, reference, artifacts)
  expect_false(any(snapshot$scalar$descriptors$indicator_id %in% excluded))
  expect_false(any(grepl("^(share_|iso_)", snapshot$scalar$descriptors$indicator_id)))
  expect_true(all(snapshot$scalar$provenance$indicator_id %in%
    snapshot$scalar$descriptors$indicator_id))
})

test_that("retained scalar snapshot combines exact producer-declared owners deterministically", {
  root <- file.path(pkgload::pkg_path(), "..", "public", "data")
  artifacts <- seed_scalar_artifact_fixture_from_producer_outputs(
    retained_scalar_artifact_owners())
  on.exit(unlink(artifacts, recursive=TRUE), add=TRUE)
  reference <- project_territory_reference(nanoparquet::read_parquet(
    file.path(root, "territoires.parquet")))
  snapshot <- project_retained_scalar_snapshot(root, reference, artifacts)
  owners <- retained_scalar_artifact_owners()
  owner_metadata <- stats::setNames(lapply(owners, lire_theme_metadata), owners)
  expected <- unlist(lapply(owners, function(owner) {
    metadata <- lire_theme_metadata(owner)
    names(metadata$scalar_contracts)[!vapply(names(metadata$scalar_contracts), function(id)
      identical(metadata$source_records[[metadata$sources[[id]]]]$serving_disposition,
        "excluded_legacy_accessibility"), logical(1))]
  }), use.names=FALSE)
  expect_setequal(snapshot$scalar$descriptors$indicator_id, expected)
  expect_identical(snapshot$scalar, assemble_scalar_snapshot(snapshot$scalar))
  expect_gt(nrow(snapshot$comparison$groups), 0L)
  expect_gt(nrow(snapshot$comparison$territories), 0L)
  expect_identical(snapshot$comparison$scalar_content_version, scalar_content_version(snapshot$scalar))
  expect_identical(snapshot$comparison$reference_content_version, reference$content_version)
  for (id in expected) {
    theme <- names(Filter(function(metadata) id %in% names(metadata$scalar_contracts),
      owner_metadata))[[1L]]
    canonical <- lire_indicateurs_commis(theme, root)
    rows <- canonical[canonical$key == id & is.na(canonical$detail), , drop=FALSE]
    descriptor <- snapshot$scalar$descriptors[
      snapshot$scalar$descriptors$indicator_id == id, , drop=FALSE]
    rows <- rows[rows$type %in% descriptor$allowed_levels[[1L]], , drop=FALSE]
    actual <- snapshot$scalar$facts[snapshot$scalar$facts$indicator_id == id, , drop=FALSE]
    key <- paste(rows$territoire, rows$type)
    actual_key <- paste(actual$territory_id, actual$territory_type)
    expect_setequal(actual_key, key)
    expect_equal(actual$value[match(key, actual_key)], as.numeric(rows$value), info=id)
    policy <- lire_theme_metadata(theme)$scalar_contracts[[id]]
    missing <- rep(policy$missing_status %||% "not_available", nrow(rows))
    support_field <- if (identical(policy$support_count_field, "support")) "n" else policy$support_count_field
    if (isTRUE(policy$counts_available) && support_field %in% names(rows) &&
        !is.null(policy$zero_support_status))
      missing[is.na(rows$value) & rows[[support_field]] == 0L] <- policy$zero_support_status
    if (isTRUE(policy$counts_available) && support_field %in% names(rows) &&
        !is.null(policy$suppressed_below))
      missing[is.na(rows$value) & rows[[support_field]] > 0L &
        rows[[support_field]] < policy$suppressed_below] <- "suppressed"
    if (nrow(rows)) expect_equal(actual$status[match(key, actual_key)],
      ifelse(is.na(rows$value), missing, "measured"), info=id)
    expect_true(nzchar(descriptor$unit[[1L]]), info=id)
    expect_true(all(snapshot$scalar$provenance$source_id[
      snapshot$scalar$provenance$indicator_id == id] %in% descriptor$allowed_sources[[1L]]), info=id)
  }
})

test_that("economy scalar projector retains canonical units, levels, and source vintages", {
  metadata <- jsonlite::fromJSON(testthat::test_path("../../inst/extdata/theme-metadata/theme_economie.json"), simplifyVector=FALSE)
  canonical_dir <- Sys.getenv("LUSK_TEST_CANONICAL_DATA_DIR", unset=file.path(pkgload::pkg_path(), "..", "public", "data"))
  canonical <- lire_indicateurs_commis("economie", canonical_dir)
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

test_that("housing DPE scalar retains producer denominator and suppression", {
  metadata <- jsonlite::fromJSON(testthat::test_path("../../inst/extdata/theme-metadata/theme_habitat.json"), simplifyVector=FALSE)
  public <- jsonlite::fromJSON(file.path(pkgload::pkg_path(), "..", "public", "data", "theme_habitat.json"), simplifyVector=FALSE)
  expect_identical(names(public$scalar_contracts), names(metadata$scalar_contracts))
  expect_identical(public$scalar_contracts, metadata$scalar_contracts)
  canonical <- lire_indicateurs_commis("habitat",
    file.path(pkgload::pkg_path(), "..", "public", "data"))
  rows <- data.frame(territory_id=as.character(canonical$territoire),
    territory_type=as.character(canonical$type), indicator_id=as.character(canonical$key),
    value=as.numeric(canonical$value), unit=as.character(canonical$unit),
    source_name=as.character(canonical$vintage_source), source_version=as.character(canonical$vintage_version),
    reference_date=as.character(canonical$vintage_date_reference),
    publication_date=as.character(canonical$vintage_date_publication), support=as.integer(canonical$n))
  eligible <- unique(data.frame(territory_id=rows$territory_id, territory_type=rows$territory_type))
  projection <- project_scalar_canonical_rows(rows, metadata, "part_passoires", eligible)
  facts <- projection$facts
  expect_true(any(facts$status == "suppressed" & facts$support_count < 30L))
  expected <- canonical[canonical$key == "part_passoires", , drop=FALSE]
  expect_equal(facts$support_count, as.integer(expected$n[match(facts$territory_id, expected$territoire)]))
  expect_equal(facts$denominator_count, facts$support_count)
  expect_true(all(facts$status[facts$support_count == 0L] == "not_available"))
  expect_true(all(facts$status[facts$support_count > 0L & facts$support_count < 30L] == "suppressed"))
  expect_equal(projection$descriptors$comparison_facet, "part_passoires")
  expect_true("region" %in% projection$descriptors$allowed_levels[[1L]])
  price_rows <- rows[canonical$key == "prix_m2" & is.na(canonical$detail), , drop=FALSE]
  price <- project_scalar_canonical_rows(price_rows, metadata, "prix_m2",
    unique(price_rows[c("territory_id", "territory_type")]))
  expect_equal(nrow(price$facts), 1268L)
  expect_setequal(as.character(table(price$facts$territory_type)), c("1202", "61", "4", "1"))
  rennes <- price$facts[price$facts$territory_id == "35238", , drop=FALSE]
  expect_equal(rennes$value, 3819.4444444444443)
  expect_equal(rennes$status, "measured")
  expect_true(any(price$facts$status == "suppressed" & price$facts$support_count < 10L))
  expect_true(all(price$provenance$source_id == metadata$sources$prix_m2))
  artifacts <- seed_scalar_artifact_fixture_from_producer_outputs(c("economie", "demographie", "mobilite", "habitat"))
  on.exit(unlink(artifacts, recursive=TRUE), add=TRUE)
  reference <- project_territory_reference(nanoparquet::read_parquet(
    file.path(pkgload::pkg_path(), "..", "public", "data", "territoires.parquet")))
  snapshot <- project_retained_scalar_snapshot(
    file.path(pkgload::pkg_path(), "..", "public", "data"), reference, artifacts)$scalar
  expect_true(all(c("effectifs_salaries", "chomage", "densite", "taille_menages", "part_passoires") %in%
    snapshot$descriptors$indicator_id))
  expect_false(any(snapshot$descriptors$indicator_id %in% c("share_food_t", "iso_alimentation", "nb_buildings")))
  expect_true(all(c("prix_m2", "part_passoires") %in% snapshot$descriptors$indicator_id))
  expect_true(all(c("distribution_dpe", "part_passoires") %in% names(metadata$indicator_pages)))
  expect_identical(metadata$indicator_pages$distribution_dpe$comparison$indicator, "part_passoires")
})

test_that("all producer scalar contracts match their checked-in generated metadata", {
  root <- pkgload::pkg_path()
  themes <- c("services", "economie", "demographie", "mobilite", "habitat", "milieux", "programmes")
  themes <- themes[file.exists(file.path(root, "inst", "extdata", "theme-metadata", paste0("theme_", themes, ".json")))]
  for (theme in themes) {
    source <- jsonlite::fromJSON(file.path(root, "inst", "extdata", "theme-metadata", paste0("theme_", theme, ".json")), simplifyVector=FALSE)
    generated <- jsonlite::fromJSON(file.path(root, "..", "public", "data", paste0("theme_", theme, ".json")), simplifyVector=FALSE)
    expect_identical(generated$scalar_contracts, source$scalar_contracts, info=theme)
  }
})

test_that("demography scalars are projected from the canonical producer into full snapshots", {
  artifacts <- seed_scalar_artifact_fixture_from_producer_outputs(c("economie", "demographie", "mobilite", "habitat"))
  on.exit(unlink(artifacts, recursive=TRUE), add=TRUE)
  canonical <- lire_indicateurs_commis("demographie",
    file.path(pkgload::pkg_path(), "..", "public", "data"))
  eligible <- unique(data.frame(territory_id=as.character(canonical$territoire),
    territory_type=as.character(canonical$type)))
  projection <- project_theme_scalar_cohort(file.path(pkgload::pkg_path(), "..", "public", "data"), eligible, "demographie", artifacts)
  expect_setequal(projection$descriptors$indicator_id, c("densite", "taille_menages", "evolution_1968"))
  for (id in projection$descriptors$indicator_id) {
    expected <- canonical[canonical$key == id, , drop=FALSE]
    expected <- expected[expected$type %in% projection$descriptors$allowed_levels[[
      match(id, projection$descriptors$indicator_id)]], , drop=FALSE]
    actual <- projection$facts[projection$facts$indicator_id == id, , drop=FALSE]
    expect_setequal(paste(actual$territory_id, actual$territory_type), paste(expected$territoire, expected$type))
    expect_equal(actual$value[match(expected$territoire, actual$territory_id)], expected$value)
    expect_true(all(is.na(actual$support_count) & is.na(actual$denominator_count)))
  }
  expect_false("structure_age" %in% projection$descriptors$indicator_id)
  root <- file.path(pkgload::pkg_path(), "..", "public", "data")
  reference <- project_territory_reference(nanoparquet::read_parquet(file.path(root, "territoires.parquet")))
  snapshot <- project_retained_scalar_snapshot(root, reference, artifacts)
  expect_gt(nrow(snapshot$comparison$groups), 0L)
  expect_gt(nrow(snapshot$comparison$territories), 0L)
  expect_identical(snapshot$comparison$scalar_content_version,
    scalar_content_version(snapshot$scalar))
  expect_identical(snapshot$comparison$reference_content_version,
    reference$content_version)
  expect_type(snapshot$comparison$content_version, "character")
  expect_equal(sum(snapshot$scalar$facts$indicator_id %in% projection$descriptors$indicator_id), nrow(projection$facts))
  expect_true(all(c("effectifs_salaries", "chomage", "densite", "taille_menages", "evolution_1968") %in%
    snapshot$scalar$descriptors$indicator_id))
  expected <- canonical[canonical$key == "evolution_1968", , drop=FALSE]
  expected <- expected[expected$type %in% projection$descriptors$allowed_levels[[
    match("evolution_1968", projection$descriptors$indicator_id)]], , drop=FALSE]
  actual <- projection$facts[projection$facts$indicator_id == "evolution_1968", , drop=FALSE]
  expect_gt(nrow(expected), 0L)
  expect_equal(actual$value[match(expected$territoire, actual$territory_id)], expected$value)
  lineage <- projection$provenance[projection$provenance$indicator_id == "evolution_1968", , drop=FALSE]
  expect_true(all(lineage$source_id == "serie_historique"))
  expect_true(all(lineage$vintage_id == paste(expected$vintage_version, expected$vintage_date_reference, sep="/")))
  expect_false(any(snapshot$scalar$descriptors$indicator_id %in% c("nb_buildings", "share_food_t")))
})

test_that("mobility scalar cohort preserves all declared ordinary canonical scalar facts in complete snapshots", {
  artifacts <- seed_scalar_artifact_fixture_from_producer_outputs(c("economie", "demographie", "mobilite", "habitat"))
  on.exit(unlink(artifacts, recursive=TRUE), add=TRUE)
  canonical <- nanoparquet::read_parquet(file.path(pkgload::pkg_path(), "..", "public", "data", "indicateurs_mobilite.parquet"))
  metadata <- jsonlite::fromJSON(file.path(pkgload::pkg_path(), "..", "public", "data", "theme_mobilite.json"), simplifyVector=FALSE)
  declaration <- lire_theme_metadata("mobilite")
  ids <- names(declaration$scalar_contracts)[!vapply(names(declaration$scalar_contracts), function(id) {
    source <- declaration$source_records[[declaration$sources[[id]]]]
    identical(source$serving_disposition, "excluded_legacy_accessibility")
  }, logical(1))]
  eligible <- unique(data.frame(territory_id=as.character(canonical$territoire),
    territory_type=as.character(canonical$type)))
  projection <- project_theme_scalar_cohort(file.path(pkgload::pkg_path(), "..", "public", "data"), eligible, "mobilite", artifacts)
  expect_setequal(projection$descriptors$indicator_id, ids)
  for (id in ids) {
    expected <- canonical[canonical$key == id, , drop=FALSE]
    allowed_levels <- projection$descriptors$allowed_levels[[match(id, projection$descriptors$indicator_id)]]
    expected <- expected[expected$type %in% allowed_levels, , drop=FALSE]
    actual <- projection$facts[projection$facts$indicator_id == id, , drop=FALSE]
    expect_equal(nrow(actual), nrow(expected))
    expect_equal(actual$value[match(expected$territoire, actual$territory_id)], expected$value)
    if (nrow(expected)) {
      missing <- metadata$scalar_contracts[[id]]$missing_status %||% "not_available"
      expect_equal(actual$status[match(expected$territoire, actual$territory_id)],
        ifelse(is.na(expected$value), missing, "measured"))
    }
    expect_true(all(actual$support_count %in% NA_integer_))
    expect_true(all(actual$denominator_count %in% NA_integer_))
  }
  source_by_id <- unlist(metadata$sources, use.names=TRUE)
  for (id in ids) {
    if (!id %in% names(source_by_id)) next
    expected <- canonical[canonical$key == id, , drop=FALSE]
    lineage <- projection$provenance[projection$provenance$indicator_id == id, , drop=FALSE]
    declared_sources <- unlist(metadata$indicator_pages[[id]]$sources, use.names=FALSE)
    expect_true(all(lineage$source_id %in% declared_sources))
    if (length(declared_sources) == 1L)
      expect_true(all(lineage$vintage_id %in% paste(expected$vintage_version,
        expected$vintage_date_reference, sep="/")))
    expect_identical(projection$descriptors$unit[match(id, projection$descriptors$indicator_id)],
      unique(expected$unit))
  }
  metadata <- jsonlite::fromJSON(file.path(pkgload::pkg_path(), "..", "public", "data", "theme_mobilite.json"), simplifyVector=FALSE)
  source_vintages <- nanoparquet::read_parquet(file.path(pkgload::pkg_path(), "..", "public", "data", "vintages.parquet"))
  multi_source_ids <- c("bornes_ev_par_station_service", "stationnement_velo_par_voiture")
  mobility_rows <- data.frame(territory_id=as.character(canonical$territoire),
    territory_type=as.character(canonical$type), indicator_id=as.character(canonical$key),
    value=as.numeric(canonical$value), unit=as.character(canonical$unit),
    source_name=as.character(canonical$vintage_source), source_version=as.character(canonical$vintage_version),
    reference_date=as.character(canonical$vintage_date_reference),
    publication_date=as.character(canonical$vintage_date_publication), stringsAsFactors=FALSE)
  for (id in multi_source_ids) {
    page_sources <- unlist(metadata$indicator_pages[[id]]$sources, use.names=FALSE)
    reference_source <- as.character(metadata$sources[[id]])
    expect_true(reference_source %in% page_sources, info=id)
    descriptor <- projection$descriptors[projection$descriptors$indicator_id == id, , drop=FALSE]
    expect_setequal(as.character(descriptor$allowed_sources[[1L]]), page_sources)
    expected <- canonical[canonical$key == id & canonical$type %in% descriptor$allowed_levels[[1L]], , drop=FALSE]
    actual <- projection$facts[projection$facts$indicator_id == id, , drop=FALSE]
    expected_key <- paste(expected$territoire, expected$type)
    actual_key <- paste(actual$territory_id, actual$territory_type)
    expect_setequal(actual_key, expected_key)
    expect_equal(actual$value[match(expected_key, actual_key)], expected$value)
    expect_equal(actual$status[match(expected_key, actual_key)],
      ifelse(is.na(expected$value), "not_available", "measured"))
    lineage <- projection$provenance[projection$provenance$indicator_id == id, , drop=FALSE]
    expect_equal(nrow(lineage), nrow(expected) * length(page_sources))
    for (territory_key in expected_key) {
      territory <- expected$territoire[match(territory_key, expected_key)]
      # Territory identifiers are unique in the canonical territory reference.
      links <- lineage[lineage$territory_id == territory, , drop=FALSE]
      expect_setequal(as.character(links$source_id), page_sources)
      for (source_id in page_sources) {
        vintage <- source_vintages[as.character(source_vintages$id) == source_id, , drop=FALSE]
        expected_vintage_id <- paste(as.character(vintage$version[[1L]]),
          as.character(vintage$date_reference[[1L]]), sep="/")
        expect_identical(as.character(links$vintage_id[links$source_id == source_id]),
          expected_vintage_id)
      }
    }
    for (source_id in page_sources) {
      vintage <- source_vintages[as.character(source_vintages$id) == source_id, , drop=FALSE]
      expect_equal(nrow(vintage), 1L, info=source_id)
      vintage_id <- paste(as.character(vintage$version[[1L]]),
        as.character(vintage$date_reference[[1L]]), sep="/")
      source_links <- lineage[lineage$source_id == source_id, , drop=FALSE]
      expect_true(all(source_links$vintage_id == vintage_id), info=source_id)
      dataset <- projection$datasets[projection$datasets$source_id == source_id, , drop=FALSE]
      expect_identical(as.character(dataset$name), as.character(vintage$source[[1L]]))
      stored_vintage <- projection$vintages[projection$vintages$source_id == source_id, , drop=FALSE]
      expect_identical(as.character(stored_vintage$vintage_id), vintage_id)
      expect_identical(as.character(stored_vintage$version), as.character(vintage$version[[1L]]))
      expect_identical(as.character(stored_vintage$reference_date), as.character(vintage$date_reference[[1L]]))
      expect_identical(as.character(stored_vintage$publication_date), as.character(vintage$date_publication[[1L]]))
    }
    reference_vintage <- source_vintages[as.character(source_vintages$id) == reference_source, , drop=FALSE]
    expect_equal(nrow(reference_vintage), 1L)
    expect_true(all(as.character(expected$vintage_version) == as.character(reference_vintage$version[[1L]])))
    expect_true(all(as.character(expected$vintage_date_reference) == as.character(reference_vintage$date_reference[[1L]])))
    expect_true(all(as.character(expected$vintage_date_publication) == as.character(reference_vintage$date_publication[[1L]])))
  }
  # Page source order is not the reference-freshness contract: the reference
  # source is independently owned by metadata$sources.
  reordered_metadata <- metadata
  for (id in multi_source_ids) {
    reordered_metadata$indicator_pages[[id]]$sources <-
      as.list(rev(unlist(reordered_metadata$indicator_pages[[id]]$sources, use.names=FALSE)))
  }
  reordered_projection <- project_scalar_canonical_rows(mobility_rows, reordered_metadata,
    multi_source_ids, eligible, source_vintages=source_vintages)
  expect_setequal(unique(reordered_projection$provenance$source_id),
    unique(projection$provenance$source_id[projection$provenance$indicator_id %in% multi_source_ids]))
  expect_true(all(c("region", "commune", "epci", "departement") %in% projection$facts$territory_type))
  reference <- project_territory_reference(nanoparquet::read_parquet(file.path(pkgload::pkg_path(), "..", "public", "data", "territoires.parquet")))
  snapshot <- project_retained_scalar_snapshot(file.path(pkgload::pkg_path(), "..", "public", "data"), reference, artifacts)$scalar
  expected_ids <- unlist(lapply(retained_scalar_artifact_owners(), function(owner) {
    owner_metadata <- lire_theme_metadata(owner)
    names(owner_metadata$scalar_contracts)[!vapply(names(owner_metadata$scalar_contracts), function(id) {
      source <- owner_metadata$source_records[[owner_metadata$sources[[id]]]]
      identical(source$serving_disposition, "excluded_legacy_accessibility")
    }, logical(1))]
  }), use.names=FALSE)
  expect_setequal(snapshot$descriptors$indicator_id, expected_ids)
  expect_gt(length(retained_scalar_artifact_owners()), 0L)
  expect_equal(sum(snapshot$facts$indicator_id %in% ids), nrow(projection$facts))
})

test_that("raccordement scalar projection binds its producer metadata, source vintage, and trajectory t0090", {
  canonical_dir <- file.path(pkgload::pkg_path(), "..", "public", "data")
  canonical <- nanoparquet::read_parquet(file.path(canonical_dir, "indicateurs_mobilite.parquet"))
  vintages <- nanoparquet::read_parquet(file.path(canonical_dir, "vintages.parquet"))
  historical <- jsonlite::fromJSON(file.path(canonical_dir, "theme_mobilite.json"), simplifyVector=FALSE)
  current <- jsonlite::fromJSON(testthat::test_path("../../inst/extdata/theme-metadata/theme_mobilite.json"), simplifyVector=FALSE)
  expect_silent(validate_raccordement_scalar_bundle(canonical, historical, vintages))
  expect_error(validate_raccordement_scalar_bundle(canonical, current, vintages),
    "Raccordement scalar source vintage is unavailable in its metadata bundle")
  mutated <- canonical
  index <- which(mutated$key == "raccordement_tc")[[1L]]
  mutated$value[[index]] <- mutated$value[[index]] + 0.01
  expect_error(validate_raccordement_scalar_bundle(mutated, historical, vintages),
    "Raccordement scalar does not match its t0090 trajectory fact")

  artifact <- lire_artefact_raccordement_national()
  candidate_vintages <- vintages_mobilite()
  owned_rows <- lignes_indicateurs_raccordement_national(artifact$calculation, candidate_vintages)
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
  payload <- compute_payload(load_fixture())
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
  expect_false(any(grepl("CASCADE", c(serving_sql, profile_sql), fixed=TRUE)))
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
