# PostgreSQL publication of the declared-profile serving grain (#757). The
# opt-in smoke scripts exercise this path against a real disposable database;
# this file covers the same wiring with the database adapter faked, so the
# fail-closed order — verified scalar binding, artifact read, one publication
# transaction — is asserted without a service. The publisher is the only
# consumer of the declared-profile serving generations, so a regression here
# would silently publish a stale DPE facet or discard the previous snapshot.

declared_profile_postgres_owners <- c("structure_age", "distribution_dpe", "mix_logements")

profile_postgres_fake_state <- function(binding = strrep("ab", 16L)) {
  state <- new.env(parent = emptyenv())
  state$binding <- binding
  state$binding_requests <- character()
  state$adapter_directories <- character()
  state$reference_version <- "reference-fixture-v1"
  state$scalar_version <- binding
  state$marker <- NULL
  state$facts <- "previously-published-facts"
  state$replaced <- NULL
  state$prepared <- character()
  state$scalar_facets <- character()
  state$validated <- character()
  state$transactions <- 0L
  state$commits <- 0L
  state$replacements <- 0L
  state$fail_replace <- FALSE
  state
}

# The narrow transaction adapter profile_postgres_adapter() builds, faked: every
# method records its call, and the transaction restores the previous facts and
# marker when the publication fails, exactly as DBI::dbWithTransaction does.
profile_postgres_fake_adapter <- function(state) {
  list(
    transaction = function(expr) {
      before <- list(marker = state$marker, facts = state$facts)
      state$transactions <- state$transactions + 1L
      value <- tryCatch(force(expr), error = function(condition) {
        state$marker <- before$marker
        state$facts <- before$facts
        stop(condition)
      })
      state$commits <- state$commits + 1L
      value
    },
    lock = function() invisible(NULL),
    marker = function(name) {
      if (identical(name, "scalar_observation"))
        return(data.frame(content_version = state$scalar_version,
          reference_content_version = state$reference_version, stringsAsFactors = FALSE))
      if (is.null(state$marker)) return(data.frame())
      data.frame(content_version = state$marker,
        reference_content_version = state$reference_version, stringsAsFactors = FALSE)
    },
    reference_marker = function() data.frame(content_version = state$reference_version,
      row_count = 1L, actual_rows = 1L, stringsAsFactors = FALSE),
    validate_territories = function(territories, descriptor) {
      state$validated <- c(state$validated, descriptor$indicator_id)
      invisible(NULL)
    },
    validate_scalar_facet = function(descriptor) {
      state$scalar_facets <- c(state$scalar_facets, descriptor$indicator_id)
      invisible(NULL)
    },
    prepare_comparisons = function(profiles, version, reference_version) {
      state$prepared <- c(state$prepared, version)
      list(stale = FALSE, projection = list(profiles = profiles, version = version))
    },
    replace = function(projection, version) {
      state$replacements <- state$replacements + 1L
      state$replaced <- projection
      state$marker <- version
      state$facts <- version
      if (state$fail_replace) stop("injected declared-profile write failure", call. = FALSE)
      invisible(NULL)
    })
}

# The publisher reads its owner-scoped generations back from the artifact
# directory, so the fixture seeds the same profile-serving family the pipeline
# writes: the Demography pyramid and the scalar-backed Habitat profiles.
seed_declared_profile_postgres_artifacts <- function(root, binding) {
  fixture <- compute_payload(load_fixture())
  materialize_theme_profile_artifacts(
    list(indicateurs = fixture$indicateurs, territoires = fixture$territoires),
    lire_theme_metadata("demographie"), NULL, "demographie", root)
  materialize_theme_profile_artifacts(payload_habitat(), lire_theme_metadata("habitat"),
    NULL, "habitat", root, binding)
  invisible(root)
}

# The publisher's own identity-registry path: the pyramid projection plus the
# additional owners, ordered by indicator id, hashed as one named list.
declared_profile_postgres_version <- function(root, binding,
    owners = declared_profile_postgres_owners) {
  profiles <- read_profile_serving_profiles(root, owners, scalar_binding = binding)
  ordered <- c(list(profiles$structure_age), profiles[setdiff(names(profiles), "structure_age")])
  ids <- vapply(ordered, function(profile) profile$descriptor$indicator_id, character(1))
  profile_content_version(list(profiles = ordered[order(ids)]))
}

fake_profile_connection <- function() structure(list(), class = "fake_profile_connection")

# The publisher owns the adapter construction, so the two seams it reaches for
# are mocked around the code under test: the recomputed binding is recorded, and
# the transaction adapter is replaced entirely (no DBI, no RPostgres).
with_declared_profile_postgres <- function(state, code) {
  adapter <- profile_postgres_fake_adapter(state)
  local_mocked_bindings(
    profile_scalar_binding = function(sortie = "../public/data") {
      state$binding_requests <- c(state$binding_requests, sortie)
      state$binding
    },
    profile_postgres_adapter = function(con, artifact_directory = NULL) {
      state$adapter_directories <- c(state$adapter_directories,
        if (is.null(artifact_directory)) NA_character_ else artifact_directory)
      adapter
    },
    .package = "lusk")
  code
}

test_that("declared profile publication recomputes the scalar binding from artifacts and publishes", {
  root <- tempfile("declared-profile-postgres-")
  dir.create(root)
  on.exit(unlink(root, recursive = TRUE), add = TRUE)
  state <- profile_postgres_fake_state()
  seed_declared_profile_postgres_artifacts(root, state$binding)

  with_declared_profile_postgres(state, {
    result <- publier_declared_profiles_postgres(root, declared_profile_postgres_owners,
      con = fake_profile_connection())

    expect_true(result$changed)
    expect_equal(state$replacements, 1L)
    expect_equal(state$commits, 1L)
    expect_identical(state$marker, declared_profile_postgres_version(root, state$binding))
    # The binding is recomputed from the artifact directory, never trusted from
    # the generation's own recorded version, and the adapter publishes there too.
    expect_identical(state$binding_requests, root)
    expect_identical(state$adapter_directories, root)
    expect_setequal(state$validated, declared_profile_postgres_owners)
    # The DPE facet is cross-checked against the live scalar marker inside the
    # same transaction, and every comparison projection was prepared for it.
    expect_identical(state$scalar_facets, "distribution_dpe")
    expect_identical(state$prepared, state$marker)
  })
})

test_that("a stale DPE scalar binding fails closed before any database write", {
  root <- tempfile("declared-profile-postgres-stale-")
  dir.create(root)
  on.exit(unlink(root, recursive = TRUE), add = TRUE)
  state <- profile_postgres_fake_state()
  # The artifacts carry the binding they were generated under...
  seed_declared_profile_postgres_artifacts(root, state$binding)
  # ...and the canonical scalar inputs now recompute a different one.
  state$binding <- strrep("cd", 16L)

  with_declared_profile_postgres(state, {
    expect_error(publier_declared_profiles_postgres(root, declared_profile_postgres_owners,
      con = fake_profile_connection()), "scalar binding is missing, stale or incompatible")

    # Nothing reached the database: no adapter, no transaction, no replacement,
    # and the previous publication marker is untouched.
    expect_length(state$adapter_directories, 0L)
    expect_equal(state$transactions, 0L)
    expect_equal(state$replacements, 0L)
    expect_null(state$marker)
    expect_identical(state$binding_requests, root)
  })
})

test_that("an unchanged declared profile snapshot is a no-op", {
  root <- tempfile("declared-profile-postgres-noop-")
  dir.create(root)
  on.exit(unlink(root, recursive = TRUE), add = TRUE)
  state <- profile_postgres_fake_state()
  seed_declared_profile_postgres_artifacts(root, state$binding)

  with_declared_profile_postgres(state, {
    first <- publier_declared_profiles_postgres(root, declared_profile_postgres_owners,
      con = fake_profile_connection())
    expect_true(first$changed)
    marker <- state$marker
    facts <- state$facts
    commits <- state$commits

    no_op <- publier_declared_profiles_postgres(root, declared_profile_postgres_owners,
      con = fake_profile_connection())
    expect_false(no_op$changed)
    expect_identical(state$marker, marker)
    expect_identical(state$facts, facts)
    expect_equal(state$replacements, 1L)
    expect_equal(state$commits, commits + 1L)
  })
})

test_that("an injected declared-profile write failure rolls the previous snapshot back", {
  root <- tempfile("declared-profile-postgres-rollback-")
  dir.create(root)
  on.exit(unlink(root, recursive = TRUE), add = TRUE)
  state <- profile_postgres_fake_state()
  seed_declared_profile_postgres_artifacts(root, state$binding)
  publish <- function() publier_declared_profiles_postgres(root, declared_profile_postgres_owners,
    con = fake_profile_connection())

  with_declared_profile_postgres(state, {
    expect_true(publish()$changed)
    marker <- state$marker
    facts <- state$facts

    # A changed generation reaches the publisher, and the write fails mid-way.
    changed <- compute_payload(load_fixture())
    changed$indicateurs$value[which(changed$indicateurs$key == "structure_age")[[1L]]] <-
      changed$indicateurs$value[which(changed$indicateurs$key == "structure_age")[[1L]]] + 0.001
    materialize_theme_profile_artifacts(
      list(indicateurs = changed$indicateurs, territoires = changed$territoires),
      lire_theme_metadata("demographie"), NULL, "demographie", root)
    state$fail_replace <- TRUE

    expect_error(publish(), "injected declared-profile write failure")
    expect_identical(state$marker, marker)
    expect_identical(state$facts, facts)
    # The replacement was attempted inside the transaction and rolled back.
    expect_equal(state$replacements, 2L)
    expect_equal(state$commits, 1L)

    # The failed generation is still publishable on retry.
    state$fail_replace <- FALSE
    expect_true(publish()$changed)
    expect_false(publish()$changed)
  })
})

test_that("declared profile publication validates its owners before reading artifacts", {
  absent <- tempfile("declared-profile-postgres-absent-")
  expect_error(publier_declared_profiles_postgres(absent, "distribution_dpe",
    con = fake_profile_connection()), "requires the structure_age owner")
  expect_error(publier_declared_profiles_postgres(absent, character(0),
    con = fake_profile_connection()), "owners are required")
  expect_error(publier_declared_profiles_postgres(absent, c("structure_age", "structure_age"),
    con = fake_profile_connection()), "owners are required")
  expect_error(publier_declared_profiles_postgres(absent, c("structure_age", NA_character_),
    con = fake_profile_connection()), "owners are required")
})
