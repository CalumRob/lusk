test_that("territory reference is projected from retained canonical territory facts", {
  canonical <- data.frame(code=c("29001", "29002"), type="commune",
    nom=c("Alpha", "Beta"), departement="29", epci="200000001",
    classe_densite_code=c("D1", "D2"),
    classe_densite_libelle_public=c("Dense", "Rural"), stringsAsFactors=FALSE)
  projection <- project_territory_reference(canonical)
  expect_identical(names(projection$rows), c("territory_id", "territory_type", "name",
    "department_id", "epci_id", "density_class_code", "density_class_label"))
  expect_identical(projection$rows$territory_id, c("29001", "29002"))
  expect_true(nzchar(projection$content_version))
  expect_error(project_territory_reference(canonical[c(1, 1), ]), "duplicate identities")
})

test_that("reference publishing uses the owner protocol without legacy serving dependencies", {
  calls <- character()
  current <- data.frame(content_version="old", reference_content_version="source-old")
  fail_write <- FALSE
  db <- list(
    transaction=function(expr) {
      old_current <- current; old_calls <- calls
      tryCatch(force(expr), error=function(err) {
        current <<- old_current; calls <<- old_calls; stop(err)
      })
    },
    lock=function(owner) calls <<- c(calls, paste("lock", owner)),
    marker=function(owner) { calls <<- c(calls, paste("marker", owner)); current },
    write=function(projection, version, dependency) {
      calls <<- c(calls, paste("write", version, nrow(projection$rows), dependency$content_version))
      if (fail_write) stop("injected retained reference write failure")
      current <<- data.frame(content_version=version, reference_content_version=dependency$content_version)
    },
    rebind=function(owner, version) {
      calls <<- c(calls, paste("rebind", owner, version))
      current$reference_content_version <<- version
    }
  )
  territories <- data.frame(code="29001", type="commune", nom="Alpha",
    departement="29", epci="200000001", stringsAsFactors=FALSE)
  projection <- project_territory_reference(territories)
  result <- publish_territory_reference_projection(projection, db)
  expect_true(result$changed)
  expect_true(any(grepl("^write ", calls)))
  expect_false(any(grepl("service_registry|essential_service_access|building_ramp|building_grid|bpe_profile", calls)))
  writes <- sum(grepl("^write ", calls))
  noop <- publish_territory_reference_projection(projection, db)
  expect_false(noop$changed)
  expect_equal(sum(grepl("^write ", calls)), writes)
  current$content_version <- "database-behind"
  retried <- publish_territory_reference_projection(projection, db)
  expect_true(retried$changed)
  current$reference_content_version <- "dependency-behind"
  rebound <- publish_territory_reference_projection(projection, db)
  expect_false(rebound$changed)
  expect_true(rebound$rebound)
  expect_identical(current$reference_content_version, projection$content_version)
  committed <- current; committed_calls <- calls
  fail_write <- TRUE; current$content_version <- "database-behind-again"
  before_failure <- current; before_failure_calls <- calls
  expect_error(publish_territory_reference_projection(projection, db),
    "injected retained reference write failure")
  expect_identical(current, before_failure)
  expect_identical(calls, before_failure_calls)
  fail_write <- FALSE
  expect_equal(committed$content_version, projection$content_version)
  expect_true(length(committed_calls) > 0L)
})

test_that("retained scalar snapshot is assembled without legacy service-share projection", {
  root <- file.path(pkgload::pkg_path(), "..", "public", "data")
  artifacts <- tempfile("retained-scalar-artifacts-")
  dir.create(artifacts)
  on.exit(unlink(artifacts, recursive=TRUE), add=TRUE)
  vintages <- nanoparquet::read_parquet(file.path(root, "vintages.parquet"))
  territories <- nanoparquet::read_parquet(file.path(root, "territoires.parquet"))
  for (theme in c("economie", "demographie", "mobilite", "habitat")) {
    payload <- list(indicateurs=lire_indicateurs_commis(theme, root), territoires=territories)
    metadata <- jsonlite::fromJSON(file.path(root, paste0("theme_", theme, ".json")),
      simplifyVector=FALSE)
    materialize_theme_scalar_artifact(payload, metadata, vintages, theme, artifacts)
  }
  reference <- project_territory_reference(nanoparquet::read_parquet(
    file.path(root, "territoires.parquet")))
  snapshot <- project_retained_scalar_snapshot(root, reference, artifacts)
  ids <- as.character(snapshot$scalar$descriptors$indicator_id)
  expect_true(length(ids) > 0L)
  expect_false(any(grepl("^(share_|iso_)", ids)))
  expect_identical(snapshot$comparison$scalar_content_version,
    scalar_content_version(snapshot$scalar))
  expect_identical(snapshot$comparison$reference_content_version,
    reference$content_version)
})
