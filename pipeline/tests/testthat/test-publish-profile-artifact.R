# Offline declared-profile serving artifacts (#757). The transport is shared
# with the scalar and ordered-series grains; this file covers the profile family
# contract, the owner inventory, the DPE scalar binding, and every fail-closed
# reader guard.

habitat_profile_payload <- function() {
  payload <- payload_habitat()
  list(indicateurs = payload$indicateurs, territoires = payload$territoires)
}

mobilite_profile_payload <- function(metadata, owner = "offre_cyclable") {
  details <- unlist(metadata$indicator_pages[[owner]]$comparison$details, use.names = FALSE)
  rows <- data.frame(territoire = "35238", type = "commune", key = owner,
    detail = details, sex = NA_character_, value = seq_along(details),
    unit = unname(unlist(metadata$profile_contracts[[owner]]$detail_units)[details]),
    vintage_source = metadata$source_records$osm_reseaux$dataset,
    vintage_version = "2026-08", vintage_date_reference = "2026-08-05",
    vintage_date_publication = "2026-08-06", stringsAsFactors = FALSE)
  vintages <- data.frame(id = "osm_reseaux",
    source = metadata$source_records$osm_reseaux$dataset, version = "2026-08",
    date_reference = "2026-08-05", date_publication = "2026-08-06")
  list(payload = list(indicateurs = rows,
    territoires = data.frame(territoire = "35238", type = "commune", stringsAsFactors = FALSE)),
    vintages = vintages)
}

test_that("declared profile serving owners derive from producer contracts", {
  habitat <- lire_theme_metadata("habitat")
  expect_setequal(profile_serving_owners(habitat),
    c("age_du_bati", "distribution_dpe", "mix_logements", "statut", "type"))
  # Every dense detail contract is an owner; the pyramid page is a structure_age
  # owner even though Demography declares no profile contract.
  expect_setequal(setdiff(profile_serving_owners(habitat), "distribution_dpe"),
    declared_detail_profile_ids(habitat))
  expect_identical(profile_serving_owners(lire_theme_metadata("demographie")), "structure_age")
  mobilite <- lire_theme_metadata("mobilite")
  expect_setequal(profile_serving_owners(mobilite),
    c("offre_cyclable", "reseaux", "reseaux_par_habitant", "voitures_menage"))
  # The mobility density distribution is deliberately not a serving owner: it is
  # read through its own readers, not the declared-profile grain.
  expect_false("mobilite_density_distribution" %in% profile_serving_owners(mobilite))
  expect_identical(profile_serving_scalar_owners(habitat), "distribution_dpe")
  expect_length(profile_serving_scalar_owners(mobilite), 0L)
})

test_that("declared profile serving artifacts round-trip every owner as one generation", {
  metadata <- lire_theme_metadata("habitat")
  payload <- habitat_profile_payload()
  binding <- strrep("ab", 16L)
  root <- tempfile("profile-serving-"); dir.create(root)
  on.exit(unlink(root, recursive = TRUE), add = TRUE)

  owners <- profile_serving_owners(metadata)
  published <- materialize_theme_profile_artifacts(payload, metadata, NULL, "habitat", root, binding)
  expect_setequal(names(published), owners)

  for (owner in owners) {
    scalar_backed <- owner %in% profile_serving_scalar_owners(metadata)
    owner_binding <- if (scalar_backed) binding else NULL
    directory <- file.path(root, "profile-serving", owner)
    restored <- read_profile_serving_artifact(directory, owner, owner_binding)
    projected <- project_profile_serving_owner(payload, metadata, NULL, "habitat", owner, owner_binding)
    # Fidelity anchor: the read-back projection must carry exactly the content
    # version of the independently projected owner, so a payload field the
    # transport fails to preserve cannot slip through.
    expect_identical(profile_content_version(restored), profile_content_version(projected))
    expect_identical(published[[owner]], profile_content_version(restored))
    expect_identical(restored$descriptor$indicator_id, owner)
    generation <- jsonlite::fromJSON(file.path(directory, "current.json"))$generation
    expect_true(file.exists(file.path(directory, generation, "manifest.json")))
  }

  # Republishing identical content reuses the immutable generation and leaves the
  # pointer untouched.
  pointer <- readLines(file.path(root, "profile-serving", "mix_logements", "current.json"), warn = FALSE)
  again <- materialize_theme_profile_artifacts(payload, metadata, NULL, "habitat", root, binding)
  expect_identical(readLines(file.path(root, "profile-serving", "mix_logements", "current.json"), warn = FALSE), pointer)
  expect_identical(again[["mix_logements"]], published[["mix_logements"]])
})

test_that("declared profile serving round-trips a structure-age pyramid and a mobility detail", {
  demography <- lire_theme_metadata("demographie")
  payload <- compute_payload(load_fixture())
  root <- tempfile("profile-serving-dem-"); dir.create(root)
  on.exit(unlink(root, recursive = TRUE), add = TRUE)
  published <- materialize_theme_profile_artifacts(
    list(indicateurs = payload$indicateurs, territoires = payload$territoires),
    demography, NULL, "demographie", root)
  restored <- read_profile_serving_artifact(file.path(root, "profile-serving", "structure_age"), "structure_age")
  projected <- project_profile_serving_owner(payload, demography, NULL, "demographie", "structure_age")
  expect_identical(profile_content_version(restored), profile_content_version(projected))
  expect_identical(published[["structure_age"]], profile_content_version(restored))

  mobilite <- lire_theme_metadata("mobilite")
  fixture <- mobilite_profile_payload(mobilite)
  projected2 <- project_profile_serving_owner(fixture$payload, mobilite, fixture$vintages, "mobilite", "offre_cyclable")
  directory2 <- file.path(tempfile("profile-serving-mob-"), "profile-serving", "offre_cyclable")
  on.exit(unlink(dirname(dirname(directory2)), recursive = TRUE), add = TRUE)
  published2 <- write_profile_serving_artifact(projected2, directory2)
  restored2 <- read_profile_serving_artifact(directory2, "offre_cyclable")
  expect_identical(profile_content_version(restored2), profile_content_version(projected2))
  expect_identical(published2, profile_content_version(restored2))
})

test_that("a scalar-backed declared profile is skipped without its binding, never stubbed", {
  metadata <- lire_theme_metadata("habitat")
  payload <- habitat_profile_payload()
  root <- tempfile("profile-serving-"); dir.create(root)
  on.exit(unlink(root, recursive = TRUE), add = TRUE)

  published <- materialize_theme_profile_artifacts(payload, metadata, NULL, "habitat", root)
  expect_false("distribution_dpe" %in% names(published))
  expect_true(all(c("mix_logements", "statut", "type", "age_du_bati") %in% names(published)))
  # No DPE generation is written, so a reader cannot pick up a stub artifact.
  expect_error(read_profile_serving_artifact(
    file.path(root, "profile-serving", "distribution_dpe"), "distribution_dpe", strrep("ab", 16L)),
    "missing")
})

test_that("a missing, stale or malformed scalar binding fails closed", {
  metadata <- lire_theme_metadata("habitat")
  payload <- habitat_profile_payload()
  binding <- strrep("cd", 16L)
  directory <- tempfile("profile-serving-dpe-")
  projected <- project_profile_serving_owner(payload, metadata, NULL, "habitat", "distribution_dpe", binding)

  # Writing a scalar-backed profile without a binding is refused.
  expect_error(write_profile_serving_artifact(projected, directory),
    "scalar binding is missing, stale or incompatible")
  # Reading the same generation under a different binding is refused.
  write_profile_serving_artifact(projected, directory, binding)
  expect_error(read_profile_serving_artifact(directory, "distribution_dpe", strrep("ef", 16L)),
    "scalar binding is missing, stale or incompatible")
  expect_identical(profile_content_version(read_profile_serving_artifact(directory, "distribution_dpe", binding)),
    profile_content_version(projected))
  # A projection that declares a required scalar version without a scalar facet
  # is refused rather than silently bound.
  plain <- project_profile_serving_owner(payload, metadata, NULL, "habitat", "mix_logements")
  plain$descriptor$required_scalar_version <- binding
  expect_error(write_profile_serving_artifact(plain, tempfile("plain-"), binding),
    "without a scalar facet carries a scalar binding")
})

test_that("the declared profile scalar binding caches and reads back a validated hash", {
  root <- tempfile("profile-binding-"); dir.create(root)
  on.exit(unlink(root, recursive = TRUE), add = TRUE)
  binding <- strrep("0f", 16L)
  cache_profile_scalar_binding(binding, root)
  expect_identical(read_profile_scalar_binding(root), binding)
  expect_error(cache_profile_scalar_binding("not-a-hash", root), "invalid")
  expect_error(read_profile_scalar_binding(tempfile("no-binding-")), "missing")
})

test_that("declared profile serving reader fails closed on tampering, owner and universe drift", {
  metadata <- lire_theme_metadata("habitat")
  payload <- habitat_profile_payload()
  root <- tempfile("profile-serving-guards-"); dir.create(root)
  on.exit(unlink(root, recursive = TRUE), add = TRUE)
  projected <- project_profile_serving_owner(payload, metadata, NULL, "habitat", "mix_logements")
  directory <- file.path(root, "profile-serving", "mix_logements")
  write_profile_serving_artifact(projected, directory)

  # Wrong owner: the pointer records the family and owner it was written for.
  expect_error(read_profile_serving_artifact(directory, "statut"), "invalid")
  # Missing pointer.
  expect_error(read_profile_serving_artifact(tempfile("absent-"), "mix_logements"), "missing")
  # Tampered generation bytes are detected by the recorded checksum.
  generation <- jsonlite::fromJSON(file.path(directory, "current.json"))$generation
  facts_path <- file.path(directory, generation, "facts.parquet")
  facts <- nanoparquet::read_parquet(facts_path)
  facts$value[[1L]] <- facts$value[[1L]] + 1
  nanoparquet::write_parquet(facts, facts_path)
  expect_error(read_profile_serving_artifact(directory, "mix_logements"), "checksum mismatch")
})

test_that("declared profile serving reader enforces the current eligible universe", {
  metadata <- lire_theme_metadata("habitat")
  payload <- habitat_profile_payload()
  root <- tempfile("profile-serving-universe-"); dir.create(root)
  on.exit(unlink(root, recursive = TRUE), add = TRUE)
  projected <- project_profile_serving_owner(payload, metadata, NULL, "habitat", "mix_logements")
  directory <- file.path(root, "profile-serving", "mix_logements")
  write_profile_serving_artifact(projected, directory)

  universe <- projected$eligible_territories
  expect_silent(read_profile_serving_artifact(directory, "mix_logements", universe = universe))
  drifted <- universe[-1L, , drop = FALSE]
  expect_error(read_profile_serving_artifact(directory, "mix_logements", universe = drifted),
    "eligible universe differs")
})

test_that("declared profile provenance drift is refused before publication", {
  metadata <- lire_theme_metadata("habitat")
  payload <- habitat_profile_payload()
  projection <- project_profile_serving_owner(payload, metadata, NULL, "habitat", "mix_logements")
  broken <- projection
  broken$provenance <- broken$provenance[-1L, , drop = FALSE]
  expect_error(validate_profile_serving_projection(broken),
    "Invalid or incomplete profile provenance associations")
  expect_error(write_profile_serving_artifact(broken, tempfile("broken-")),
    "Invalid or incomplete profile provenance associations")
})
