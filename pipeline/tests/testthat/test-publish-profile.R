test_that("dense profile validator rejects incomplete, duplicate, and undeclared cells", {
  axes <- data.frame(axis_name = c("detail", "detail", "sex", "sex"),
    axis_key = c("a", "b", "F", "M"), label = c("A", "B", "Femmes", "Hommes"), ordinal = c(0L,1L,0L,1L))
  descriptor <- list(levels = "commune", details = c("a", "b"), sexes = c("F", "M"))
  facts <- expand.grid(territory_id = "x", territory_type = "commune", detail = c("a", "b"), sex = c("F", "M"), stringsAsFactors = FALSE)
  facts$value <- 0.25
  facts$status <- "measured"
  expect_invisible(validate_declared_profile(facts, descriptor, axes))
  expect_error(validate_declared_profile(facts[-1, ], descriptor, axes), "missing coordinates")
  expect_error(validate_declared_profile(rbind(facts, facts[1, ]), descriptor, axes), "Duplicate")
  facts$detail[1] <- "outside"
  expect_error(validate_declared_profile(facts, descriptor, axes), "Undeclared")
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
  expect_setequal(unique(profile$facts$territory_type), unlist(metadata$indicator_pages$structure_age$levels))
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
