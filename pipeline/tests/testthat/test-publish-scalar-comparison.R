test_that("scalar comparison projection publishes fixed contexts at both declared grains", {
  scalar <- list(
    facts = data.frame(
      indicator_id = rep("population", 10),
      territory_id = c("c1", "c2", "c3", "c4", "c5", "e1", "e2", "d1", "d2", "r1"),
      territory_type = c(rep("commune", 5), "epci", "epci", "departement", "departement", "region"),
      value = c(10, 10, 5, 3, NA, 100, 50, 8, 8, 30),
      status = c(rep("measured", 4), "not_available", rep("measured", 5)),
      support_count = NA_integer_, denominator_count = NA_integer_,
      stringsAsFactors = FALSE
    ),
    descriptors = data.frame(
      indicator_id = "population", theme_id = "demographie", allowed_sources = I(list("census")),
      label = "Population", unit = "persons", direction = "high",
      comparison_facet = "population", allowed_levels = I(list(c("commune", "epci", "departement", "region"))),
      denominator_semantics = "count", completeness = "sparse", descriptor_version = "descriptor-v1",
      stringsAsFactors = FALSE
    ),
    eligible_territories = data.frame(territory_id = c("c1", "c2", "c3", "c4", "c5", "e1", "e2", "d1", "d2", "r1"),
      territory_type = c(rep("commune", 5), "epci", "epci", "departement", "departement", "region"),
      stringsAsFactors = FALSE),
    provenance = data.frame(indicator_id="population",
      territory_id=c("c1","c2","c3","c4","c5","e1","e2","d1","d2","r1"),
      source_id="census",vintage_id="2020",stringsAsFactors=FALSE)
  )
  territories <- data.frame(
    territory_id = c("c1", "c2", "c3", "c4", "c5", "e1", "e2", "d1", "d2", "r1"),
    territory_type = c(rep("commune", 5), "epci", "epci", "departement", "departement", "region"),
    epci_id = c("e1", "e1", "e2", NA, "e2", NA, NA, NA, NA, NA),
    density_class_code = c("A", "A", "B", "A", "B", NA, NA, NA, NA, NA),
    stringsAsFactors = FALSE
  )

  result <- project_scalar_comparisons(scalar, territories,
    input_scalar_content_version = "scalar-v1", reference_content_version = "territories-v1")

  expect_setequal(unique(result$groups$comparison_context),
    c("density_class", "epci", "bretagne", "same_level"))
  density_a <- result$groups[result$groups$comparison_context == "density_class" &
    result$groups$group_id == "A", , drop = FALSE]
  expect_equal(density_a$statistic, "median")
  expect_equal(density_a$median, 10)
  expect_equal(density_a$member_count, 3L)
  expect_equal(density_a$eligible_count, 3L)
  expect_equal(density_a$missing_count, 0L)

  bretagne <- result$groups[result$groups$comparison_context == "bretagne", , drop = FALSE]
  expect_equal(nrow(bretagne), 1L)
  expect_equal(bretagne$median, 7.5)
  expect_equal(bretagne$member_count, 5L)
  expect_equal(bretagne$eligible_count, 4L)
  expect_equal(bretagne$missing_count, 1L)

  tied <- result$territories[result$territories$comparison_context == "density_class" &
    result$territories$group_id == "A" & result$territories$territory_id == "c1", , drop = FALSE]
  expect_equal(tied$rank, 1L)
  expect_equal(tied$tie_count, 2L)
  expect_equal(tied$rank_size, 3L)

  missing <- result$territories[result$territories$comparison_context == "bretagne" &
    result$territories$territory_id == "c5", , drop = FALSE]
  expect_equal(missing$status, "not_available")
  expect_true(is.na(missing$rank))
  expect_true(is.na(missing$tie_count))

  missing_first <- scalar
  missing_first$facts$status[missing_first$facts$territory_id == "c1"] <- "not_available"
  missing_first$facts$value[missing_first$facts$territory_id == "c1"] <- NA_real_
  ranked_after_missing <- project_scalar_comparisons(missing_first, territories,
    input_scalar_content_version = "scalar-with-leading-missing-v1",
    reference_content_version = "territories-v1")$territories
  ranked_group <- ranked_after_missing[ranked_after_missing$comparison_context == "density_class" &
    ranked_after_missing$group_id == "A", , drop = FALSE]
  expect_equal(ranked_group$rank[ranked_group$territory_id == "c2"], 1L)
  expect_equal(ranked_group$rank[ranked_group$territory_id == "c4"], 2L)
  expect_equal(ranked_group$rank_size[ranked_group$territory_id == "c2"], 2L)

  expect_equal(result$scalar_content_version, "scalar-v1")
  expect_true(all(result$lineage$source_id == "census"))
  expect_true(any(result$lineage$comparison_context == "bretagne"))
  expect_equal(result$reference_content_version, "territories-v1")
  expect_true(nzchar(result$content_version))
})

test_that("scalar comparison projection validates fixed-context membership and version dependencies", {
  scalar <- list(
    facts = data.frame(indicator_id = "population", territory_id = "c1", territory_type = "commune",
      value = 1, status = "measured", support_count = NA_integer_, denominator_count = NA_integer_,
      stringsAsFactors = FALSE),
    descriptors = data.frame(indicator_id = "population", theme_id = "demographie",
      allowed_sources = I(list("census")), label = "Population", unit = "persons", direction = "high",
      comparison_facet = "population", allowed_levels = I(list("commune")),
      denominator_semantics = "count", completeness = "sparse", descriptor_version = "descriptor-v1",
      stringsAsFactors = FALSE),
    eligible_territories = data.frame(territory_id = "c1", territory_type = "commune", stringsAsFactors = FALSE),
    provenance = data.frame(indicator_id="population",territory_id="c1",source_id="census",vintage_id="2020")
  )
  territories <- data.frame(territory_id = c("c1", "e1", "d1", "r1"),
    territory_type = c("commune", "epci", "departement", "region"), epci_id = c("e1", NA, NA, NA),
    density_class_code = c("A", NA, NA, NA), stringsAsFactors = FALSE)

  expect_error(project_scalar_comparisons(scalar, territories,
    input_scalar_content_version = "scalar-v1", reference_content_version = ""), "version")
  expect_error(project_scalar_comparisons(scalar, territories[-4, ],
    input_scalar_content_version = "scalar-v1", reference_content_version = "territories-v1"), "reference")

  altered <- project_scalar_comparisons(scalar, territories,
    input_scalar_content_version = "scalar-v1", reference_content_version = "territories-v1")
  measured_row <- which(!is.na(altered$territories$rank))[[1L]]
  altered$territories$rank[measured_row] <- altered$territories$rank_size[measured_row] + 1L
  expect_error(validate_scalar_comparison_projection(altered), "ranks or tie counts")
})

test_that("scalar comparison publisher is version-bound, idempotent, and rolls back failed replacement", {
  scalar <- list(
    facts = data.frame(indicator_id = "population", territory_id = "c1", territory_type = "commune",
      value = 1, status = "measured", support_count = NA_integer_, denominator_count = NA_integer_,
      stringsAsFactors = FALSE),
    descriptors = data.frame(indicator_id = "population", theme_id = "demographie",
      allowed_sources = I(list("census")), label = "Population", unit = "persons", direction = "high",
      comparison_facet = "population", allowed_levels = I(list("commune")),
      denominator_semantics = "count", completeness = "sparse", descriptor_version = "descriptor-v1",
      stringsAsFactors = FALSE),
    eligible_territories = data.frame(territory_id = "c1", territory_type = "commune", stringsAsFactors = FALSE),
    provenance = data.frame(indicator_id="population",territory_id="c1",source_id="census",vintage_id="2020")
  )
  territories <- data.frame(territory_id = c("c1", "e1", "d1", "r1"),
    territory_type = c("commune", "epci", "departement", "region"), epci_id = c("e1", NA, NA, NA),
    density_class_code = c("A", NA, NA, NA), stringsAsFactors = FALSE)
  projection <- project_scalar_comparisons(scalar, territories, "scalar-v1", "territories-v1")
  state <- list(input = data.frame(scalar_content_version="scalar-v1", reference_content_version="territories-v1"),
    marker = data.frame(), groups = NULL, territories = NULL, fail = FALSE)
  adapter <- list(
    transaction = function(expr) {
      previous <- unserialize(serialize(state, NULL))
      tryCatch(force(expr), error=function(error) { state <<- previous; stop(error) })
    },
    input_markers = function() state$input,
    marker = function() state$marker,
    replace = function(value) {
      state$groups <<- value$groups
      state$territories <<- value$territories
      state$lineage <<- value$lineage
      state$marker <<- data.frame(content_version=value$content_version,
        scalar_content_version=value$scalar_content_version,
        reference_content_version=value$reference_content_version,
        lineage_row_count=nrow(value$lineage))
      if (state$fail) stop("injected replacement failure")
    }
  )

  first <- publish_registered_scalar_comparison(projection, adapter)
  expect_true(first$changed)
  expect_equal(state$marker$content_version, projection$content_version)
  retry <- publish_registered_scalar_comparison(projection, adapter)
  expect_false(retry$changed)

  state$marker$lineage_row_count <- NA_integer_
  repaired <- publish_registered_scalar_comparison(projection, adapter)
  expect_true(repaired$changed)
  expect_identical(state$marker$lineage_row_count, nrow(projection$lineage))

  state$input$scalar_content_version <- "scalar-v2"
  expect_error(publish_registered_scalar_comparison(projection, adapter), "stale or unavailable")
  expect_equal(state$marker$content_version, projection$content_version)

  state$input$scalar_content_version <- "scalar-v1"
  state$fail <- TRUE
  changed <- project_scalar_comparisons(scalar, territories, "scalar-v1", "territories-v2")
  state$input$reference_content_version <- "territories-v2"
  expect_error(publish_registered_scalar_comparison(changed, adapter), "injected replacement failure")
  expect_equal(state$marker$content_version, projection$content_version)
  expect_true(all(state$groups$content_version == projection$content_version))
})

test_that("scalar comparison Parquets publish constrained grains with exact input versions", {
  scalar <- list(
    facts = data.frame(indicator_id = "population", territory_id = "c1", territory_type = "commune",
      value = 1, status = "measured", support_count = NA_integer_, denominator_count = NA_integer_,
      stringsAsFactors = FALSE),
    descriptors = data.frame(indicator_id = "population", theme_id = "demographie",
      allowed_sources = I(list("census")), label = "Population", unit = "persons", direction = "high",
      comparison_facet = "population", allowed_levels = I(list("commune")),
      denominator_semantics = "count", completeness = "sparse", descriptor_version = "descriptor-v1",
      stringsAsFactors = FALSE),
    eligible_territories = data.frame(territory_id = "c1", territory_type = "commune", stringsAsFactors = FALSE),
    provenance = data.frame(indicator_id="population",territory_id="c1",source_id="census",vintage_id="2020")
  )
  territories <- data.frame(territory_id = c("c1", "e1", "d1", "r1"),
    territory_type = c("commune", "epci", "departement", "region"), epci_id = c("e1", NA, NA, NA),
    density_class_code = c("A", NA, NA, NA), stringsAsFactors = FALSE)
  projection <- project_scalar_comparisons(scalar, territories, "scalar-v1", "territories-v1")
  directory <- tempfile("scalar-comparison-parquet-")
  on.exit(unlink(directory, recursive=TRUE), add=TRUE)

  paths <- write_scalar_comparison_parquets(projection, directory)

  expect_length(paths, 3L)
  expect_true(all(file.exists(paths)))
  groups <- nanoparquet::read_parquet(paths[[1L]])
  results <- nanoparquet::read_parquet(paths[[2L]])
  lineage <- nanoparquet::read_parquet(paths[[3L]])
  expect_true(all(groups$scalar_content_version == "scalar-v1"))
  expect_true(all(groups$reference_content_version == "territories-v1"))
  expect_true(all(groups$content_version == projection$content_version))
  expect_true(all(results$scalar_content_version == "scalar-v1"))
  expect_true(all(results$reference_content_version == "territories-v1"))
  expect_true(all(results$content_version == projection$content_version))
  expect_true(all(lineage$vintage_id == "2020"))
})
