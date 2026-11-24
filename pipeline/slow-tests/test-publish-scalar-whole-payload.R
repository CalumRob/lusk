# Slow tier (#1172): complete retained scalar snapshots are rebuilt from committed producer outputs.
# Run from pipeline/: Rscript -e "pkgload::load_all('.', quiet=TRUE); testthat::test_file('slow-tests/test-publish-scalar-whole-payload.R', package='lusk')"

for (helper in list.files(file.path(pkgload::pkg_path(), "tests", "testthat"), pattern = "^helper.*\\.R$", full.names = TRUE)) source(helper)

seed_scalar_artifact_fixture_from_producer_outputs <- function(themes) {
  # Fixture adapter only: exercise the production writer/reader against current
  # producer outputs and retained artifacts. No retired numerical JSON is read.
  public <- file.path(pkgload::pkg_path(), "..", "public", "data")
  destination <- tempfile("scalar-serving-fixture-")
  dir.create(destination)
  vintages <- nanoparquet::read_parquet(file.path(public, "vintages.parquet"))
  territories <- territoires_producteur_fixture(themes, public)
  for (theme in themes) {
    payload <- payload_producteur_fixture(theme, public)
    # Every owner artifact is checked against the same fixture serving
    # universe, just as the combined snapshot is.
    payload$territoires <- territories
    metadata <- lire_theme_metadata(theme)
    # The committed Mobility numeric fixture is an older source/vintage bundle;
    # its raccordement contract is exercised separately below with that historic
    # metadata. Do not combine those rows with the current canonical declaration.
    if (identical(theme, "mobilite")) {
      metadata$scalar_contracts$raccordement_tc <- NULL
      # #953 : les trois densités de ravitaillement sont déclarées au canon mais
      # leurs faits naissent au prochain run — l'artefact conservé ne les porte
      # pas encore, le fixture ne peut donc pas les projeter.
      metadata$scalar_contracts$stations_service <- NULL
      metadata$scalar_contracts$stations_service_1000 <- NULL
      metadata$scalar_contracts$bornes_recharge_1000 <- NULL
      # #1048 : les 15 `share_*` n'ont jamais eu de contrat de matérialisation
      # (le snapshot ne les publiait que comme directions) ; les autres contrats
      # déclarés `excluded_legacy_accessibility` sont des reçus de retrait, pas
      # des offres. Le fixture ne projette donc que les contrats retenus.
    }
    materialize_theme_scalar_artifact(payload, metadata, vintages, theme, destination)
  }
  destination
}

# Contract: retired service-share ids are excluded even after artefact poisoning.
test_that("legacy service-share source declarations are excluded from retained scalar publication", {
  withr::local_dir(file.path(pkgload::pkg_path(), "tests", "testthat"))
  root <- file.path(pkgload::pkg_path(), "..", "public", "data")
  metadata <- lire_theme_metadata("mobilite")
  # #1048 : la disposition de retrait vit dans LES CONTRATS SCALAIRES du canon,
  # pas dans les source_records (le snapshot porté a disparu du catalogue).
  excluded <- scalar_indicators_with_serving_disposition(
    metadata, SERVING_DISPOSITION_EXCLUDED_LEGACY)
  expect_setequal(excluded, INDICATEURS_MOBILITE_RETIRES)
  artifacts <- seed_scalar_artifact_fixture_from_producer_outputs(
    c("economie", "demographie", "mobilite", "habitat"))
  on.exit(unlink(artifacts, recursive=TRUE), add=TRUE)
  reference <- project_territory_reference(territoires_producteur_fixture(
    c("economie", "demographie", "mobilite", "habitat"), root))
  snapshot <- project_retained_scalar_snapshot(root, reference, artifacts)
  expect_false(any(snapshot$scalar$descriptors$indicator_id %in% excluded))
  expect_setequal(snapshot$retired_indicator_ids, excluded)
  expect_false("retired_indicator_ids" %in% names(snapshot$scalar))
  expect_identical(snapshot$comparison$scalar_content_version,
    scalar_content_version(snapshot$scalar))
  expect_false(any(grepl("^(share_|iso_)", snapshot$scalar$descriptors$indicator_id)))
  expect_true(all(snapshot$scalar$provenance$indicator_id %in%
    snapshot$scalar$descriptors$indicator_id))

  # Contôle NON tautologique : on injecte dans l'artefact Mobilité deux ids
  # retirés, comme le faisait l'artefact conservé avant #1048. La publication
  # retenue doit les éliminer ; l'assemblage legacy doit les contenir.
  legacy_dir <- file.path(artifacts, "scalar-serving", "mobilite")
  legacy <- read_scalar_serving_artifact(legacy_dir)
  source_id <- "bornes_recharge"
  injected <- c(share_food_t = "share_food_t", nb_buildings = "nb_buildings")
  for (grain in c("descriptors", "facts", "provenance")) {
    rows <- legacy[[grain]]
    modele <- rows[rows$indicator_id == source_id, , drop=FALSE]
    stopifnot(nrow(modele) > 0L)
    doublons <- do.call(rbind, lapply(unname(injected), function(id) {
      d <- modele; d$indicator_id <- id
      if (grain == "descriptors") d$comparison_facet <- id
      d
    }))
    legacy[[grain]] <- rbind(rows, doublons)
  }
  write_scalar_serving_artifact(legacy, legacy_dir)

  legacy_cohorts <- lapply(c("economie", "demographie", "mobilite", "habitat"),
    function(theme) read_scalar_serving_artifact(file.path(artifacts, "scalar-serving", theme)))
  legacy_scalar <- assemble_scalar_snapshot(legacy_cohorts[[1L]], legacy_cohorts[-1L])
  legacy_comparison <- project_scalar_comparisons(legacy_scalar, reference$rows,
    scalar_content_version(legacy_scalar), reference$content_version)
  legacy_retired <- intersect(unname(injected), legacy_scalar$descriptors$indicator_id)
  expect_setequal(legacy_retired, unname(injected))
  expect_true(any(legacy_scalar$facts$indicator_id %in% legacy_retired))
  expect_true(any(legacy_scalar$provenance$indicator_id %in% legacy_retired))
  expect_true(any(legacy_comparison$groups$indicator_id %in% legacy_retired))
  # Le snapshot RETENU reconstruit sur cet artefact empoisonné les élimine
  # des trois grains — la garde porte bien sur l'exclusion, pas sur l'absence.
  snapshot_apres <- project_retained_scalar_snapshot(root, reference, artifacts)
  expect_false(any(snapshot_apres$scalar$descriptors$indicator_id %in% injected))
  expect_false(any(snapshot_apres$scalar$facts$indicator_id %in% injected))
  expect_false(any(snapshot_apres$scalar$provenance$indicator_id %in% injected))
})

# Contract: exact producer-declared scalar owners assemble deterministically with canonical values and lineage.
test_that("retained scalar snapshot combines exact producer-declared owners deterministically", {
  withr::local_dir(file.path(pkgload::pkg_path(), "tests", "testthat"))
  root <- file.path(pkgload::pkg_path(), "..", "public", "data")
  artifacts <- seed_scalar_artifact_fixture_from_producer_outputs(
    retained_scalar_artifact_owners())
  on.exit(unlink(artifacts, recursive=TRUE), add=TRUE)
  reference <- project_territory_reference(territoires_producteur_fixture(
    retained_scalar_artifact_owners(), root))
  snapshot <- project_retained_scalar_snapshot(root, reference, artifacts)
  owners <- retained_scalar_artifact_owners()
  owner_metadata <- stats::setNames(lapply(owners, lire_theme_metadata), owners)
  expected <- unlist(lapply(owners, function(owner) {
    metadata <- lire_theme_metadata(owner)
    setdiff(names(metadata$scalar_contracts),
      scalar_indicators_with_serving_disposition(metadata,
        SERVING_DISPOSITION_EXCLUDED_LEGACY))
  }), use.names=FALSE)
  # The checked-in Mobility facts are an older raccordement vintage and are not
  # a valid fixture for the canonical scalar owner declared by current extdata.
  expected <- setdiff(expected, "raccordement_tc")
  # #953 : déclarées, pas encore matérialisées dans l'artefact conservé
  expected <- setdiff(expected, c("stations_service", "stations_service_1000",
                                  "bornes_recharge_1000"))
  expect_setequal(snapshot$scalar$descriptors$indicator_id, expected)
  expect_identical(snapshot$scalar, assemble_scalar_snapshot(snapshot$scalar))
  expect_gt(nrow(snapshot$comparison$groups), 0L)
  expect_gt(nrow(snapshot$comparison$territories), 0L)
  expect_identical(snapshot$comparison$scalar_content_version, scalar_content_version(snapshot$scalar))
  expect_identical(snapshot$comparison$reference_content_version, reference$content_version)
  for (id in expected) {
    theme <- names(Filter(function(metadata) id %in% names(metadata$scalar_contracts),
      owner_metadata))[[1L]]
    canonical <- lire_indicateurs_producteur_fixture(theme, root)
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

# Contract: Habitat denominator, suppression and pooled price facts survive the complete retained snapshot.
test_that("housing scalar retains producer denominator, suppression, and values", {
  withr::local_dir(file.path(pkgload::pkg_path(), "tests", "testthat"))
  metadata <- jsonlite::fromJSON(testthat::test_path("../../inst/extdata/theme-metadata/theme_habitat.json"), simplifyVector=FALSE)
  public <- jsonlite::fromJSON(file.path(pkgload::pkg_path(), "..", "public", "data", "theme_habitat.json"), simplifyVector=FALSE)
  expect_setequal(names(metadata$scalar_contracts), c("prix_m2", "part_passoires"))
  expect_false(any(c("scalar_contracts", "profile_contracts", "map_layers") %in% names(public)))
  expect_true("indicator_pages" %in% names(public))
  expect_true(all(c("prix_m2", "part_passoires") %in% names(public$indicator_pages)))
  canonical <- lire_indicateurs_producteur_fixture("habitat",
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
  expected_price <- price_rows
  expect_equal(nrow(price$facts), nrow(expected_price))
  expect_setequal(as.character(table(price$facts$territory_type)),
    as.character(table(expected_price$territory_type)))
  sample_id <- expected_price$territory_id[which(!is.na(expected_price$value))[[1L]]]
  sample_fact <- price$facts[price$facts$territory_id == sample_id, , drop=FALSE]
  expected_fact <- expected_price[expected_price$territory_id == sample_id, , drop=FALSE]
  expect_equal(sample_fact$value, expected_fact$value)
  expect_identical(sample_fact$status, "measured")
  expect_true(any(price$facts$status == "suppressed" & price$facts$support_count < 10L))
  expect_true(all(price$provenance$source_id == metadata$sources$prix_m2))
  artifacts <- seed_scalar_artifact_fixture_from_producer_outputs(c("economie", "demographie", "mobilite", "habitat"))
  on.exit(unlink(artifacts, recursive=TRUE), add=TRUE)
  reference <- project_territory_reference(territoires_producteur_fixture(
    c("economie", "demographie", "mobilite", "habitat"),
    file.path(pkgload::pkg_path(), "..", "public", "data")))
  snapshot <- project_retained_scalar_snapshot(
    file.path(pkgload::pkg_path(), "..", "public", "data"), reference, artifacts)$scalar
  expect_true(all(c("effectifs_salaries", "chomage", "densite", "taille_menages", "part_passoires") %in%
    snapshot$descriptors$indicator_id))
  expect_false(any(snapshot$descriptors$indicator_id %in% c("share_food_t", "iso_alimentation", "nb_buildings")))
  expect_true(all(c("prix_m2", "part_passoires") %in% snapshot$descriptors$indicator_id))
  expect_true(all(c("distribution_dpe", "part_passoires") %in% names(metadata$indicator_pages)))
  expect_identical(metadata$indicator_pages$distribution_dpe$comparison$indicator, "part_passoires")
})

# Contract: the Demography cohort projects canonical facts into a complete comparison snapshot.
test_that("demography scalars are projected from the canonical producer into full snapshots", {
  withr::local_dir(file.path(pkgload::pkg_path(), "tests", "testthat"))
  themes <- c("economie", "demographie", "mobilite", "habitat")
  artifacts <- seed_scalar_artifact_fixture_from_producer_outputs(themes)
  on.exit(unlink(artifacts, recursive=TRUE), add=TRUE)
  root <- file.path(pkgload::pkg_path(), "..", "public", "data")
  canonical <- lire_indicateurs_producteur_fixture("demographie", root)
  territory_fixture <- territoires_producteur_fixture(themes, root)
  eligible <- unique(data.frame(territory_id=as.character(territory_fixture$territoire),
    territory_type=as.character(territory_fixture$type)))
  projection <- project_theme_scalar_cohort(root, eligible, "demographie", artifacts)
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
  reference <- project_territory_reference(territoires_producteur_fixture(
    c("economie", "demographie", "mobilite", "habitat"), root))
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

# Contract: every published ordinary Mobility scalar survives the complete retained snapshot with source clocks.
test_that("mobility scalar cohort preserves all declared ordinary canonical scalar facts in complete snapshots", {
  withr::local_dir(file.path(pkgload::pkg_path(), "tests", "testthat"))
  themes <- retained_scalar_artifact_owners()
  artifacts <- seed_scalar_artifact_fixture_from_producer_outputs(themes)
  on.exit(unlink(artifacts, recursive=TRUE), add=TRUE)
  root <- file.path(pkgload::pkg_path(), "..", "public", "data")
  canonical <- nanoparquet::read_parquet(file.path(root, "indicateurs_mobilite.parquet"))
  metadata <- lire_theme_metadata("mobilite")
  public_metadata <- jsonlite::fromJSON(file.path(root, "theme_mobilite.json"), simplifyVector=FALSE)
  ids <- setdiff(names(metadata$scalar_contracts),
    scalar_indicators_with_serving_disposition(metadata,
      SERVING_DISPOSITION_EXCLUDED_LEGACY))
  # The static fixture has only the retired raccordement vintage; canonical
  # scalar serving is covered with its owner-produced rows in the bundle test.
  ids <- setdiff(ids, "raccordement_tc")
  # The retained Mobility Parquet predates the three refuelling densities
  # (#953): their pages and producer contracts are declared now and their facts
  # publish on the next run. The cohort parity then covers the published keys;
  # a separate assertion keeps the declaration honest.
  pending <- c("stations_service", "stations_service_1000",
               "bornes_recharge_1000")
  expect_true(all(pending %in% names(metadata$scalar_contracts)))
  ids <- setdiff(ids, pending)
  territory_fixture <- territoires_producteur_fixture(themes, root)
  eligible <- unique(data.frame(territory_id=as.character(territory_fixture$territoire),
    territory_type=as.character(territory_fixture$type)))
  projection <- project_theme_scalar_cohort(root, eligible, "mobilite", artifacts)
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
  source_by_id <- unlist(public_metadata$sources, use.names=TRUE)
  for (id in ids) {
    if (!id %in% names(source_by_id)) next
    expected <- canonical[canonical$key == id, , drop=FALSE]
    lineage <- projection$provenance[projection$provenance$indicator_id == id, , drop=FALSE]
    declared_sources <- unlist(public_metadata$indicator_pages[[id]]$sources, use.names=FALSE)
    expect_true(all(lineage$source_id %in% declared_sources))
    if (length(declared_sources) == 1L)
      expect_true(all(lineage$vintage_id %in% paste(expected$vintage_version,
        expected$vintage_date_reference, sep="/")))
    expect_identical(projection$descriptors$unit[match(id, projection$descriptors$indicator_id)],
      unique(expected$unit))
  }
  metadata <- lire_theme_metadata("mobilite")
  public_metadata <- jsonlite::fromJSON(file.path(pkgload::pkg_path(), "..", "public", "data", "theme_mobilite.json"), simplifyVector=FALSE)
  source_vintages <- nanoparquet::read_parquet(file.path(pkgload::pkg_path(), "..", "public", "data", "vintages.parquet"))
  multi_source_ids <- c("bornes_ev_par_station_service", "stationnement_velo_par_voiture")
  mobility_rows <- data.frame(territory_id=as.character(canonical$territoire),
    territory_type=as.character(canonical$type), indicator_id=as.character(canonical$key),
    value=as.numeric(canonical$value), unit=as.character(canonical$unit),
    source_name=as.character(canonical$vintage_source), source_version=as.character(canonical$vintage_version),
    reference_date=as.character(canonical$vintage_date_reference),
    publication_date=as.character(canonical$vintage_date_publication), stringsAsFactors=FALSE)
  for (id in multi_source_ids) {
    page_sources <- unlist(public_metadata$indicator_pages[[id]]$sources, use.names=FALSE)
    reference_source <- as.character(public_metadata$sources[[id]])
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
      as.list(rev(unlist(public_metadata$indicator_pages[[id]]$sources, use.names=FALSE)))
  }
  reordered_projection <- project_scalar_canonical_rows(mobility_rows, reordered_metadata,
    multi_source_ids, eligible, source_vintages=source_vintages)
  expect_setequal(unique(reordered_projection$provenance$source_id),
    unique(projection$provenance$source_id[projection$provenance$indicator_id %in% multi_source_ids]))
  expect_true(all(c("region", "commune", "epci", "departement") %in% projection$facts$territory_type))
  reference <- project_territory_reference(territoires_producteur_fixture(
    retained_scalar_artifact_owners(),
    file.path(pkgload::pkg_path(), "..", "public", "data")))
  snapshot <- project_retained_scalar_snapshot(file.path(pkgload::pkg_path(), "..", "public", "data"), reference, artifacts)$scalar
  expected_ids <- unlist(lapply(retained_scalar_artifact_owners(), function(owner) {
    owner_metadata <- lire_theme_metadata(owner)
    setdiff(names(owner_metadata$scalar_contracts),
      scalar_indicators_with_serving_disposition(owner_metadata,
        SERVING_DISPOSITION_EXCLUDED_LEGACY))
  }), use.names=FALSE)
  expected_ids <- setdiff(expected_ids, "raccordement_tc")
  # les densités de ravitaillement (#953) naissent au prochain run : le
  # snapshot conservé ne les porte pas encore
  expected_ids <- setdiff(expected_ids,
                          c("stations_service", "stations_service_1000",
                            "bornes_recharge_1000"))
  expect_setequal(snapshot$descriptors$indicator_id, expected_ids)
  expect_gt(length(retained_scalar_artifact_owners()), 0L)
  expect_equal(sum(snapshot$facts$indicator_id %in% ids), nrow(projection$facts))
})
