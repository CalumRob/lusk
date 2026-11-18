# #1042 — published littoral comparison contexts across the shared families.
# The served C/NC classification lives on the canonical territory reference;
# the canonical membership inventory must emit one exact same-status cohort per
# code, with the same reference/direction-aware rank law as every other fixed
# context. The coordinated rollout publishes the enriched reference together
# with these comparison generations.

littoral_reference <- function() {
  data.frame(
    territory_id = c("c1", "c2", "c3", "c4", "c5", "e1", "e2", "d1", "r1"),
    territory_type = c(rep("commune", 5), "epci", "epci", "departement", "region"),
    epci_id = c("e1", "e1", "e2", "e2", "e2", NA, NA, NA, NA),
    density_class_code = c("A", "B", "A", "B", "A", NA, NA, NA, NA),
    littoral_code = c("C", "C", "NC", "NC", "NC", NA, NA, NA, NA),
    littoral_classement_source = c("Mer", "Estuaire", NA, NA, NA, NA, NA, NA, NA),
    stringsAsFactors = FALSE
  )
}

scalar_littoral_fixture <- function(direction = "high") {
  list(
    facts = data.frame(
      indicator_id = "population",
      territory_id = c("c1", "c2", "c3", "c4", "c5"),
      territory_type = "commune",
      value = c(10, 0, 5, 5, NA_real_),
      status = c("measured", "measured", "measured", "measured", "not_available"),
      support_count = NA_integer_, denominator_count = NA_integer_,
      stringsAsFactors = FALSE
    ),
    descriptors = data.frame(
      indicator_id = "population", theme_id = "demographie",
      allowed_sources = I(list("census")), label = "Population", unit = "persons",
      direction = direction, comparison_facet = "population",
      allowed_levels = I(list("commune")), denominator_semantics = "count",
      completeness = "sparse", descriptor_version = "descriptor-v1",
      stringsAsFactors = FALSE
    ),
    eligible_territories = data.frame(
      territory_id = c("c1", "c2", "c3", "c4", "c5"),
      territory_type = "commune", stringsAsFactors = FALSE
    ),
    provenance = data.frame(
      indicator_id = "population", territory_id = c("c1", "c2", "c3", "c4", "c5"),
      source_id = "census", vintage_id = "2020", stringsAsFactors = FALSE
    )
  )
}

# Hand-computed expectations from the shared fixture values, never read back
# from a producer result: C = {c1:10, c2:0}; NC = {c3:5, c4:5, c5:missing}.
# The reference statistic is a median (direction-invariant); competition ranks
# follow the declared direction; ties and rank_size are direction-invariant.
# Every shared family declares a direction on its comparison descriptor, so
# none of them has to be excused from the low-direction assertions.
expected_littoral_cohort <- function(direction) {
  high <- identical(direction, "high")
  list(
    C = list(statistic = 5,
      rank = c(c1 = if (high) 1L else 2L, c2 = if (high) 2L else 1L),
      ties = c(c1 = 1L, c2 = 1L), size = c(c1 = 2L, c2 = 2L)),
    NC = list(statistic = 5,
      rank = c(c3 = 1L, c4 = 1L), ties = c(c3 = 2L, c4 = 2L),
      size = c(c3 = 2L, c4 = 2L))
  )
}

assert_littoral_family_cohort <- function(groups, territories, statistic_column,
                                          direction, family) {
  info <- function(...) paste(family, direction, ...)
  expected <- expected_littoral_cohort(direction)
  for (code in c("C", "NC")) {
    group <- groups[groups$comparison_context == "littoral" & groups$group_id == code, , drop = FALSE]
    expect_equal(nrow(group), 1L, info = info(code, "group row"))
    expect_equal(group[[statistic_column]][[1L]], expected[[code]]$statistic,
      info = info(code, "published reference value"))
    rows <- territories[territories$comparison_context == "littoral" & territories$group_id == code, , drop = FALSE]
    expect_setequal(rows$territory_id,
      c(names(expected[[code]]$rank), if (identical(code, "NC")) "c5" else character()))
    for (id in names(expected[[code]]$rank)) {
      row <- rows[rows$territory_id == id, , drop = FALSE]
      expect_equal(nrow(row), 1L, info = info(code, id, "territory row"))
      expect_equal(row$rank[[1L]], expected[[code]]$rank[[id]], info = info(code, id, "rank"))
      expect_equal(row$tie_count[[1L]], expected[[code]]$ties[[id]], info = info(code, id, "tie_count"))
      expect_equal(row$rank_size[[1L]], expected[[code]]$size[[id]], info = info(code, id, "rank_size"))
    }
    if (identical(code, "NC")) {
      missing_peer <- rows[rows$territory_id == "c5", , drop = FALSE]
      expect_equal(nrow(missing_peer), 1L, info = info("missing peer row"))
      expect_false(identical(missing_peer$status[[1L]], "measured"), info = info("missing peer status"))
      expect_true(is.na(missing_peer$value[[1L]]), info = info("missing peer carries no value"))
      expect_true(all(is.na(missing_peer[c("rank", "tie_count", "rank_size")])),
        info = info("missing peer carries no ranks"))
    }
  }
}

test_that("canonical membership inventory publishes exact C and NC cohorts", {
  membership <- comparison_context_membership(littoral_reference(), "commune")
  littoral <- membership[membership$comparison_context == "littoral", , drop = FALSE]
  expect_setequal(littoral$group_id, c("C", "NC"))
  expect_true(all(littoral$territory_type == "commune"))
  c_ids <- littoral$member_ids[[which(littoral$group_id == "C")]]
  nc_ids <- littoral$member_ids[[which(littoral$group_id == "NC")]]
  expect_setequal(c_ids, c("c1", "c2"))
  expect_setequal(nc_ids, c("c3", "c4", "c5"))
  expect_false(any(c_ids %in% nc_ids))
  # The focal commune is always inside its own published group.
  expect_true("c1" %in% c_ids)
  expect_true("c4" %in% nc_ids)
  # Existing contexts are still present and unchanged.
  expect_setequal(unique(membership$comparison_context),
    c("density_class", "epci", "bretagne", "littoral"))
})

test_that("membership omits littoral for an unclassified transition reference and fails closed on a partial crosswalk", {
  # ABSENT classification columns are the legacy transition shape: no littoral
  # context, every existing context byte-identical.
  transition <- littoral_reference()
  transition$littoral_code <- NULL
  transition$littoral_classement_source <- NULL
  expect_false("littoral" %in% comparison_context_membership(transition, "commune")$comparison_context)

  partial <- littoral_reference()
  partial$littoral_code[[3]] <- NA_character_
  expect_error(comparison_context_membership(partial, "commune"), "unclassified|littoral")

  invalid <- littoral_reference()
  invalid$littoral_code[[3]] <- "X"
  expect_error(comparison_context_membership(invalid, "commune"), "littoral")

  misclassified <- littoral_reference()
  misclassified$littoral_code[[6]] <- "C"
  expect_error(comparison_context_membership(misclassified, "commune"), "non-commune|littoral")
})

test_that("membership refuses a declared-but-empty or half-declared classification", {
  # #1041 projector semantics: columns ABSENT = legacy transition (allowed),
  # but a classification the producer DECLARED and then emptied, or declared
  # with only one column, is a named failure — never a silent "no littoral
  # context" publication. The projector's post-hash flag carries the declaration.
  empty <- littoral_reference()
  empty$littoral_code[] <- NA_character_
  empty$littoral_classement_source[] <- NA_character_
  attr(empty, "littoral_declared") <- TRUE
  expect_error(comparison_context_membership(empty, "commune"), "present but empty")

  half <- littoral_reference()
  half$littoral_classement_source <- NULL
  expect_error(comparison_context_membership(half, "commune"), "declared together")

  half_code <- littoral_reference()
  half_code$littoral_code <- NULL
  expect_error(comparison_context_membership(half_code, "commune"), "declared together")
})

test_that("projected all-NA rows without declaration stay the legacy transition", {
  # The projector always emits both columns; a legacy transition therefore
  # arrives with all-NA values and littoral_declared=FALSE. It must publish no
  # littoral context while every existing context stays byte-identical.
  legacy <- project_territory_reference(data.frame(
    code = c("c1", "c2", "r1"), type = c("commune", "commune", "region"),
    nom = c("A", "B", "Bretagne"), departement = c("22", "29", NA_character_),
    epci = c("e1", "e2", NA_character_),
    classe_densite_code = c("A", "B", NA_character_), stringsAsFactors = FALSE))
  expect_false(isTRUE(attr(legacy$rows, "littoral_declared")))
  expect_true(all(is.na(legacy$rows$littoral_code)))
  membership <- comparison_context_membership(legacy$rows, "commune")
  expect_false("littoral" %in% membership$comparison_context)
  expect_setequal(unique(membership$comparison_context),
    c("density_class", "epci", "bretagne"))
})

test_that("scalar comparison publishes C and NC with direction-aware ranks, ties, zero and missing peers", {
  result <- project_scalar_comparisons(scalar_littoral_fixture("high"), littoral_reference(),
    "scalar-v1", "reference-v1")

  c_group <- result$groups[result$groups$comparison_context == "littoral" & result$groups$group_id == "C", ]
  expect_equal(nrow(c_group), 1L)
  expect_equal(c_group$statistic, "median")
  expect_equal(c_group$median, 5)                 # median(c(10, 0)) = 5
  expect_equal(c_group$member_count, 2L)
  expect_equal(c_group$eligible_count, 2L)
  expect_equal(c_group$missing_count, 0L)

  c_rows <- result$territories[result$territories$comparison_context == "littoral" &
    result$territories$group_id == "C", , drop = FALSE]
  # Independent competition ranks: 10 -> 1, finite zero 0 -> 2.
  expect_equal(c_rows$rank[match("c1", c_rows$territory_id)], 1L)
  expect_equal(c_rows$value[match("c2", c_rows$territory_id)], 0)
  expect_equal(c_rows$rank[match("c2", c_rows$territory_id)], 2L)
  expect_true(all(c_rows$rank_size == 2L))
  expect_true(all(c_rows$tie_count == 1L))

  nc_group <- result$groups[result$groups$comparison_context == "littoral" & result$groups$group_id == "NC", ]
  expect_equal(nc_group$median, 5)                 # median(c(5, 5)) with one missing peer
  expect_equal(nc_group$member_count, 3L)
  expect_equal(nc_group$eligible_count, 2L)
  expect_equal(nc_group$missing_count, 1L)
  nc_rows <- result$territories[result$territories$comparison_context == "littoral" &
    result$territories$group_id == "NC", , drop = FALSE]
  tied <- nc_rows[nc_rows$territory_id %in% c("c3", "c4"), ]
  expect_true(all(tied$rank == 1L))
  expect_true(all(tied$tie_count == 2L))
  expect_true(all(tied$rank_size == 2L))
  unavailable <- nc_rows[nc_rows$territory_id == "c5", ]
  expect_equal(unavailable$status, "not_available")
  expect_true(all(is.na(unavailable[c("value", "rank", "tie_count", "rank_size")])))

  expect_true(any(result$lineage$comparison_context == "littoral" & result$lineage$group_id == "C"))
  expect_true(any(result$lineage$comparison_context == "littoral" & result$lineage$group_id == "NC"))
  expect_invisible(validate_scalar_comparison_projection(result))

  low <- project_scalar_comparisons(scalar_littoral_fixture("low"), littoral_reference(),
    "scalar-low", "reference-v1")
  low_rows <- low$territories[low$territories$comparison_context == "littoral" &
    low$territories$group_id == "C", , drop = FALSE]
  # Direction low inverts the order: 0 -> 1, 10 -> 2.
  expect_equal(low_rows$rank[match("c2", low_rows$territory_id)], 1L)
  expect_equal(low_rows$rank[match("c1", low_rows$territory_id)], 2L)
})

test_that("declared profile comparison publishes C and NC reference/ranks/ties in both directions", {
  for (direction in c("high", "low")) {
    profile <- list(
      descriptor = list(indicator_id = "offre_cyclable", levels = "commune",
        comparison_detail = "velo", comparison_sex = NA_character_,
        comparison_direction = direction),
      facts = data.frame(territory_id = c("c1", "c2", "c3", "c4", "c5"), territory_type = "commune",
        detail = "velo", sex = "", value = c(10, 0, 5, 5, NA_real_),
        status = c("measured", "measured", "measured", "measured", "suppressed"))
    )
    result <- project_declared_profile_comparisons(list(profile), littoral_reference(), "pv", "rv")
    assert_littoral_family_cohort(result$groups, result$territories, "median", direction, "declared_profile")
  }
})

test_that("sparse collection comparison publishes C and NC reference/ranks/ties in both directions", {
  for (direction in c("high", "low")) {
    p <- list(
      descriptor = list(indicator_id = "subventions_par_domaine", kind = "period_detail",
        direction = direction, comparison_detail = "domaine", comparison_period = "2025",
        allowed_levels = "commune"),
      facts = data.frame(indicator_id = "subventions_par_domaine",
        territory_id = c("c1", "c2", "c3", "c4"), territory_type = "commune",
        detail_key = "domaine", observation_period = "2025", value = c(10, 0, 5, 5),
        source_id = "src", vintage_id = "v1", stringsAsFactors = FALSE),
      vintages = data.frame(source_id = "src", vintage_id = "v1", stringsAsFactors = FALSE),
      datasets = data.frame(source_id = "src", name = "Source", stringsAsFactors = FALSE)
    )
    out <- project_observed_collection_comparisons(p, littoral_reference(), "collection-v1", "reference-v1")
    assert_littoral_family_cohort(out$groups, out$territories, "median", direction, "observed_collection")

    rows <- out$territories[out$territories$comparison_context == "littoral", , drop = FALSE]
    c_rows <- rows[rows$group_id == "C", , drop = FALSE]
    # A genuine finite zero is a measured, rankable observation — never mistaken
    # for a missing peer.
    zero <- c_rows[c_rows$territory_id == "c2", , drop = FALSE]
    expect_equal(zero$value[[1L]], 0)
    expect_identical(zero$status[[1L]], "measured")
    expect_false(is.na(zero$rank[[1L]]))
    expect_equal(zero$rank_size[[1L]], 2L)
    # c5 is in the NC cohort but has NO fact row at all: it is not_published
    # with no value and no ranks. A fabricated measured zero would fail both
    # of these independent assertions.
    missing_peer <- rows[rows$group_id == "NC" & rows$territory_id == "c5", , drop = FALSE]
    expect_identical(missing_peer$status[[1L]], "not_published")
    expect_true(is.na(missing_peer$value[[1L]]))
    expect_false(isTRUE(missing_peer$value[[1L]] == 0))
  }
})

series_littoral_projection <- function(direction = "high") {
  d <- list(dataset_id = "d", indicator_id = "i", axis_kind = "year", axis_values = "2024",
    completeness = "dense_complete", comparison_point = "2024", label = "I", unit = "u",
    direction = direction, allowed_levels = c("commune", "region"), descriptor_version = "dv1",
    comparison_levels = "commune")
  points <- data.frame(dataset_id = "d", indicator_id = "i",
    territory_id = c("c1", "c2", "c3", "c4", "c5", "r1"),
    territory_type = c(rep("commune", 5), "region"), axis_value = "2024",
    observation_period = "2024-01-01", value = c(10, 0, 5, 5, NA_real_, 30),
    status = c(rep("measured", 4), "missing", "measured"), stringsAsFactors = FALSE)
  s <- "src"; v <- "v1"; sn <- "Source"; dn <- "Dataset"; sv <- "v1"
  rd <- "2024-01-01"; pd <- "2024-01-01"
  rh <- series_revision_hash(s, v, sn, dn, sv, rd, pd)
  rid <- paste0(s, "-", v, "-", substr(rh, 1L, 16L))
  provenance <- data.frame(provenance_revision_id = rid, source_id = s, vintage_id = v,
    source_name = sn, dataset_name = dn, source_version = sv, reference_date = rd,
    publication_date = pd, revision_hash = rh, stringsAsFactors = FALSE)
  links <- data.frame(dataset_id = "d", indicator_id = "i",
    territory_id = points$territory_id, axis_value = "2024",
    provenance_revision_id = rid, stringsAsFactors = FALSE)
  list(dataset_id = "d", descriptor = d, points = points, provenance = provenance,
    point_provenance = links)
}

test_that("ordered series comparison publishes C and NC reference/ranks/ties in both directions", {
  for (direction in c("high", "low")) {
    projected <- project_ordered_series_comparisons(series_littoral_projection(direction),
      littoral_reference(), "series-v1", "reference-v1")
    assert_littoral_family_cohort(projected$groups, projected$territories,
      "group_value", direction, "ordered_series")
  }
})

test_that("ADR-0039 comparison family inventory requires littoral in every shared family", {
  # Each in-scope published family must consume the canonical membership
  # inventory (which now carries the littoral context); a family that silently
  # stops using it would drop the context without any other test noticing.
  expect_setequal(ADR0039_COMPARISON_FAMILIES, c(
    "declared_profile", "numeric_period_collection",
    "numeric_detail_collection", "scalar", "ordered_series", "aedar_fixed"
  ))
  for (family in c("publish_scalar.R", "publish_profile.R", "publish_series.R",
                   "publish_observed_collections.R")) {
    source <- paste(readLines(file.path(pkgload::pkg_path(), "R", family)), collapse = "\n")
    expect_true(grepl("comparison_context_membership", source), family)
  }
  scalar_source <- paste(readLines(file.path(pkgload::pkg_path(), "R", "publish_scalar.R")), collapse = "\n")
  expect_true(grepl('"littoral"', scalar_source))
})
