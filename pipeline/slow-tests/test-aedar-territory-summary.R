# Slow tier (#1172): the complete 235-TYPEQU × 312-measure fixture protects all 40 territory summary readings and their independent sums/support/provenance.
# Run explicitly with testthat::test_file(..., package="lusk") from pipeline/.

local({
  withr::local_dir(file.path(pkgload::pkg_path(), "tests", "testthat"))
  for (helper in list.files(file.path(pkgload::pkg_path(), "tests", "testthat"), pattern = "^helper.*\\.R$", full.names = TRUE)) source(helper, local = environment())

test_that("AEDAR territory summary projects the bound 40 readings under complete support", {
  projection <- project_aedar_aggregates(make_aedar_test_inputs(),make_aedar_test_typequ_metadata())
  facts <- projection$facts
  # Independently vary measure values by TYPEQU and territory; expectations
  # below are sums over the fixture rows, not a call back into the projector.
  facts$count_5_walk_share <- seq_len(nrow(facts)) / 1000
  facts$count_5_walk_mean <- seq_len(nrow(facts)) / 10
  result <- project_aedar_territory_summary(facts,projection$source)
  expect_equal(nrow(result),4L*40L)
  expect_equal(unique(result$territory_type),AEDAR_AGGREGATE_LEVELS)
  # Independently expected all-40 fixture: every registry TYPEQU gets a
  # distinct, bounded value per reading, and expectations are plain sums over
  # those 235 source rows (not a call to the summary projector).
  independent_facts <- facts
  bindings <- aedar_aggregate_reading_bindings()
  for(i in seq_len(nrow(bindings))) {
    underlying <- bindings$underlying[[i]]
    independent_facts[[underlying]] <- ((seq_len(nrow(independent_facts))-1L)%%
      AEDAR_TYPEQU_REGISTRY_COUNT)/1000 + i/10000
  }
  all_readings <- project_aedar_territory_summary(independent_facts,projection$source)
  for(level in AEDAR_AGGREGATE_LEVELS) for(territory in unique(independent_facts$territory_id[
      independent_facts$territory_type==level])) for(i in seq_len(nrow(bindings))) {
    underlying <- bindings$underlying[[i]]
    source_rows <- independent_facts$territory_type==level & independent_facts$territory_id==territory
    reading <- subset(all_readings,territory_type==level & territory_id==territory &
      measure==bindings$measure[[i]])
    expect_equal(reading$value,sum(independent_facts[[underlying]][source_rows]))
    expect_equal(reading$status,"available")
    expect_equal(reading$n_typequ,AEDAR_TYPEQU_REGISTRY_COUNT)
    expect_equal(reading$n_addresses,2)
    expect_equal(reading$n_observed,sum(independent_facts$n_observed[source_rows]))
    expect_equal(reading$coverage_status,"covered")
    expect_equal(reading$source_id,projection$source$source_id)
    expect_equal(reading$vintage,projection$source$vintage)
    expect_equal(reading$source_url,projection$source$url)
    expect_equal(reading$licence,projection$source$licence)
    expect_equal(reading$attribution,projection$source$attribution)
    expect_equal(reading$reference_date,projection$source$reference_date)
    expect_equal(reading$publication_date,projection$source$publication_date)
  }
  commune <- subset(result,territory_type=="commune" & measure=="walk5Diversity")
  expected <- sum(facts$count_5_walk_share[facts$territory_type=="commune"])
  expect_equal(commune$value,expected)
  expect_equal(commune$status,"available")
  expect_equal(commune$n_typequ,AEDAR_TYPEQU_REGISTRY_COUNT)
  expect_equal(commune$n_addresses,2)
  expect_equal(commune$n_observed,235)
  expect_equal(commune$source_id,projection$source$source_id)
  car <- subset(result,territory_type=="commune" & measure=="meanVolume")
  expect_equal(car$value,sum(facts$count_15_car_mean[facts$territory_type=="commune"]))
  zero_facts <- facts
  zero_facts$count_5_walk_share[] <- 0
  zero <- subset(project_aedar_territory_summary(zero_facts,projection$source),measure=="walk5Diversity")
  expect_equal(zero$value,rep(0,4))
  partial <- project_aedar_territory_summary(facts[facts$TYPEQU!=facts$TYPEQU[[1L]],],projection$source)
  expect_true(all(is.na(subset(partial,measure=="walk5Diversity")$value)))
  partial_commune <- subset(partial,territory_type=="commune" & measure=="walk5Diversity")
  partial_commune_facts <- subset(facts[facts$TYPEQU!=facts$TYPEQU[[1L]],],territory_type=="commune")
  expect_equal(partial_commune$n_addresses,2)
  expect_equal(partial_commune$n_observed,sum(partial_commune_facts$n_observed))
  expect_equal(partial_commune$coverage_status,"covered")
  bad_support <- facts
  bad_support$n_addresses[bad_support$territory_type=="commune"] <- c(2,3,rep(2,AEDAR_TYPEQU_REGISTRY_COUNT-2L))
  unsupported <- subset(project_aedar_territory_summary(bad_support,projection$source),
    territory_type=="commune" & measure=="walk5Diversity")
  expect_true(is.na(unsupported$value))
  expect_true(is.na(unsupported$n_addresses))
  expect_equal(unsupported$n_observed,sum(bad_support$n_observed[bad_support$territory_type=="commune"]))
  varied_support <- facts
  commune_rows <- which(varied_support$territory_type=="commune")
  varied_support$n_observed[commune_rows] <- rep(c(1,2),length.out=length(commune_rows))
  varied_summary <- subset(project_aedar_territory_summary(varied_support,projection$source),
    territory_type=="commune" & measure=="walk5Diversity")
  expect_gt(varied_summary$n_observed,varied_summary$n_addresses)
  expect_equal(varied_summary$n_observed,sum(varied_support$n_observed[commune_rows]))
  bad_provenance <- projection$source
  bad_provenance$source_id <- NULL
  expect_error(project_aedar_territory_summary(facts,bad_provenance),"complete 40-reading binding")
})

})
