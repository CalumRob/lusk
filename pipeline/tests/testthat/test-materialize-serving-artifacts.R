# test-materialize-serving-artifacts -------------------------------------------
# Issue #802: the offline materialization entrypoint derives every retained owner
# from producer metadata (never a copied theme list) and materializes the four
# serving families from the committed payload alone. These tests pin the owner
# derivation, the Milieux producer-only state-role reconstruction, the read-only
# guarantee on the canonical snapshot, and the end-to-end materialization.

serving_payload_dir <- function()
  file.path(pkgload::pkg_path(), "..", "public", "data")

serving_skip <- function() {
  skip_if_not(dir.exists(serving_payload_dir()),
    "public/data absent - le point de montage du depot est introuvable")
}

# One committed-payload materialization per test session: the committed read is
# ~100 MB of JSON projections, so the result is shared across the blocks below.
serving_materialized <- local({
  cache <- new.env(parent = emptyenv())
  function() {
    if (is.null(cache$result)) {
      source <- serving_payload_dir()
      plan <- plan_serving_artifacts(source)
      before <- serving_input_state(source, plan$inputs)
      work <- file.path(tempdir(), "materialize-serving-artifacts-e2e")
      if (dir.exists(work)) unlink(work, recursive = TRUE)
      cache$result <- materialize_serving_artifacts(source, work, "materialize")
      cache$before <- before
      cache$after <- serving_input_state(source, plan$inputs)
    }
    cache
  }
})

test_that("le plan derive chaque proprietaire retenu des metadonnees producteur", {
  serving_skip()
  source <- serving_payload_dir()
  plan <- plan_serving_artifacts(source)

  # The scalar owners are the producer-derived retained set, never a copied list.
  expect_identical(plan$scalar_owners, retained_scalar_artifact_owners(source))
  expect_setequal(plan$scalar_owners, c("demographie", "economie", "habitat", "mobilite"))

  # Series owners come from each theme's owned_series_routes map.
  expect_setequal(plan$series_owners,
    c("raccordement_courbe", "prix_m2", "conso_enaf_annuel", "artif_par_habitant"))
  expect_setequal(plan$series_themes, c("mobilite", "habitat", "milieux"))

  # Typed-reading owners come from the artifact contract map.
  expect_setequal(plan$typed_themes, names(typed_reading_artifact_contracts()))
  expect_setequal(plan$typed_themes, c("economie", "demographie", "habitat", "milieux"))

  # Profile owners come from the declared pyramid/dense profile contracts.
  expect_setequal(plan$profile_themes, c("mobilite", "demographie", "habitat"))
  expect_setequal(plan$profile_owners,
    c("offre_cyclable", "reseaux", "reseaux_par_habitant", "voitures_menage",
      "structure_age", "age_du_bati", "distribution_dpe", "mix_logements",
      "statut", "type"))
  expect_true("distribution_dpe" %in% plan$profile_owners)

  # The Programme theme declares no artifact-family owner, so it never enters the
  # fact-projection inventory (its Parquets are still copied for its publisher).
  expect_false("programmes" %in% plan$facts_themes)

  # Every fact-projection theme ships its projection, and the work directory is a
  # complete LUSK_SORTIE for the rollout's publication step.
  for (theme in plan$facts_themes)
    expect_true(any(startsWith(plan$inputs, paste0("indicateurs_", theme, "."))),
      info = theme)
  expect_true(all(c("territoires.parquet", "vintages.parquet", "vintages.json",
    "programmes_membres.parquet", "programmes_subventions.parquet") %in% plan$inputs))
  expect_silent(validate_serving_artifact_inputs(plan))
})

test_that("les roles d'etat Milieux se reconstruisent depuis le payload commis", {
  serving_skip()
  source <- serving_payload_dir()
  indicators <- lire_indicateurs_commis("milieux", source)
  metadata <- serving_theme_metadata(source, "milieux")

  # The committed presentation projection omits the producer-only typed links,
  # which is exactly why the OCS-GE owned series needs them rebuilt.
  expect_false(all(c("state_role", "source_components") %in% names(indicators)))

  # Declared applied vintages only: the patch vintages sharing the source record
  # are excluded by construction.
  declared <- milieux_artificialisation_vintages(metadata)
  expect_setequal(declared$id, c(
    "ocsge_artificialisation_22_2021", "ocsge_artificialisation_22_2025",
    "ocsge_artificialisation_29_2021", "ocsge_artificialisation_29_2024",
    "ocsge_artificialisation_35_2020", "ocsge_artificialisation_35_2023",
    "ocsge_artificialisation_56_2022", "ocsge_artificialisation_56_2024"))

  roles <- reconstruct_milieux_state_roles(indicators, metadata)
  at <- !is.na(roles$key) & roles$key == "artif_par_habitant"
  expect_false(anyNA(roles$state_role[at]))
  expect_false(anyNA(roles$source_components[at]))
  expect_setequal(unique(roles$state_role[at]), c("M2", "M3"))

  components <- function(territoire, type, role) {
    rows <- roles[at & roles$territoire == territoire & roles$type == type, , drop = FALSE]
    row <- rows[rows$state_role == role, , drop = FALSE]
    expect_equal(nrow(row), 1L)
    jsonlite::fromJSON(row$source_components[[1L]], simplifyVector = TRUE)
  }

  # Single-window commune (dept 35): 2020 is M2, 2023 is M3.
  commune <- components("35001", "commune", "M2")
  expect_identical(commune$M2, "ocsge_artificialisation_35_2020")
  expect_identical(commune$M3, "ocsge_artificialisation_35_2023")

  # Cross-department EPCI span: both departments contribute to each role.
  span <- components("242900744", "epci", "M2")
  expect_identical(span$M2,
    c("ocsge_artificialisation_22_2021", "ocsge_artificialisation_29_2021"))
  expect_identical(span$M3,
    c("ocsge_artificialisation_22_2025", "ocsge_artificialisation_29_2024"))

  # Region span: all four Bretagne departments.
  region <- components("53", "region", "M3")
  expect_identical(region$M2, c("ocsge_artificialisation_22_2021",
    "ocsge_artificialisation_29_2021", "ocsge_artificialisation_35_2020",
    "ocsge_artificialisation_56_2022"))
  expect_identical(region$M3, c("ocsge_artificialisation_22_2025",
    "ocsge_artificialisation_29_2024", "ocsge_artificialisation_35_2023",
    "ocsge_artificialisation_56_2024"))

  # The reconstruction is idempotent: a payload that already carries the typed
  # columns is returned untouched.
  expect_identical(reconstruct_milieux_state_roles(roles, metadata), roles)
})

test_that("la reconstruction d'etat Milieux echoue bruyamment sur une entree invalide", {
  metadata <- list(indicator_pages = list(artif_par_habitant = list(sources = list("ocsge_artificialisation_22_2025"))),
    source_records = list(ocsge_artificialisation_22_2025 = list(vintages = list(
      list(id = "ocsge_artificialisation_22_2021", dateReference = "2021-01-01", version = "2021")))))
  indicators <- data.frame(territoire = "22001", type = "commune", key = "artif_par_habitant",
    detail = "2021", source_reference = "ocsge_artificialisation_22_2021", stringsAsFactors = FALSE)
  # A single state row cannot carry both roles.
  expect_error(reconstruct_milieux_state_roles(indicators, metadata),
    "exactly two states")
  # A territory with no state observations is refused rather than silently kept.
  expect_error(reconstruct_milieux_state_roles(
    data.frame(territoire = "22001", type = "commune", key = "autre", detail = NA_character_,
      source_reference = NA_character_, stringsAsFactors = FALSE), metadata),
    "no state observations")
})

test_that("l'analyseur d'arguments documente les deux modes", {
  expect_identical(parse_materialize_serving_args(character()),
    list(source = file.path("..", "public", "data"), work = NULL, check = FALSE))
  expect_identical(parse_materialize_serving_args(c("--check"))$check, TRUE)
  parsed <- parse_materialize_serving_args(c("--source", "snap", "--work", "out"))
  expect_identical(parsed$source, "snap")
  expect_identical(parsed$work, "out")
  expect_error(parse_materialize_serving_args("--work"), "requires a value")
  expect_error(parse_materialize_serving_args("--nope"), "Unknown argument")
})

test_that("le repertoire de travail prive ne peut pas viser l'instantane commis", {
  source <- serving_payload_dir()
  expect_error(assert_serving_work_isolated(source, source), "outside the committed payload")
  expect_error(assert_serving_work_isolated(source, file.path(source, "series-serving")),
    "outside the committed payload")
  expect_silent(assert_serving_work_isolated(source, file.path(tempdir(), "serving-outsider")))
})

test_that("la materialisation couvre les quatre familles et signale le proprietaire bloque", {
  serving_skip()
  cache <- serving_materialized()
  result <- cache$result
  outcomes <- result$outcomes

  expect_setequal(unique(outcomes$family),
    c("scalar-serving", "series-serving", "typed-reading", "profile-serving"))
  expect_equal(nrow(outcomes), 22L)
  expect_equal(nrow(result$versions), 21L)

  # The one owner the committed payload cannot feed is the Mobilite owned series:
  # public/data predates the #728 national GTFS raccordement run, so its committed
  # observation period violates the current producer snapshot-date contract.
  expect_equal(nrow(result$blocked), 1L)
  expect_identical(result$blocked$family[[1L]], "series-serving")
  expect_identical(result$blocked$owner[[1L]], "raccordement_courbe")
  expect_match(result$blocked$detail[[1L]], "raccordement observation period")

  # Every other declared owner produced its artifact pointer with a version.
  expect_false(anyNA(result$versions$content_version))
  expect_false(any(!nzchar(result$versions$content_version)))

  # The families land in their canonical serving directories.
  expect_true(dir.exists(file.path(result$work, "scalar-serving", "habitat")))
  expect_true(dir.exists(file.path(result$work, "series-serving", "artif_par_habitant")))
  expect_true(dir.exists(file.path(result$work, "series-serving", "prix_m2")))
  expect_true(dir.exists(file.path(result$work, "typed-reading-serving", "milieux")))
  expect_true(dir.exists(file.path(result$work, "profile-serving", "distribution_dpe")))

  # The canonical snapshot is read-only: the entrypoint asserts it internally and
  # the input inventory's size/mtime is unchanged around the run.
  expect_identical(cache$before, cache$after)
})

test_that("les artefacts materialises se relisent par les lecteurs servis", {
  serving_skip()
  result <- serving_materialized()$result
  work <- result$work

  # The declared-profile DPE facet binds to the retained scalar snapshot.
  binding <- read_profile_scalar_binding(work)
  expect_true(nzchar(binding))
  dpe <- read_profile_serving_artifact(file.path(work, "profile-serving", "distribution_dpe"),
    "distribution_dpe", binding)
  expect_identical(as.character(dpe$descriptor$required_scalar_version), binding)

  # The Milieux owned series carries both state roles at every served level.
  artif <- read_owned_series_artifact(file.path(work, "series-serving", "artif_par_habitant"),
    "artif_par_habitant")
  expect_setequal(unique(artif$points$territory_type),
    c("commune", "epci", "departement", "region"))
  expect_setequal(unique(artif$points$state_role), c("M2", "M3"))

  # The typed readings reload through their own reader.
  for (owner in c("demographie", "habitat", "economie", "milieux"))
    expect_true(nzchar(read_typed_reading_publication_from(work, owner)$content_version))
})

test_that("le mode --check est en lecture seule et rapporte les memes versions", {
  serving_skip()
  result <- serving_materialized()$result
  source <- serving_payload_dir()
  plan <- plan_serving_artifacts(source)
  before <- serving_input_state(source, plan$inputs)
  checked <- materialize_serving_artifacts(source, NULL, "check")
  after <- serving_input_state(source, plan$inputs)

  # No committed payload input changed, and the disposable temp directory is gone.
  expect_identical(before, after)
  expect_false(dir.exists(checked$work))
  expect_equal(nrow(checked$blocked), 1L)
  expect_identical(checked$blocked$owner[[1L]], "raccordement_courbe")
  # The materializable owners report the exact versions the materialization wrote.
  ordered <- function(versions) versions[order(versions$family, versions$owner), , drop = FALSE]
  expect_identical(ordered(checked$versions), ordered(result$versions))
})

# Regression suite for the two review blockers ---------------------------------
# 1. Isolation is decided from the filesystem, not from the lexical form of a
#    path: a junction, a symlink or an alias at the work root, at one of its
#    ancestors or at a pre-existing output descendant can reach the committed
#    snapshot.
# 2. An owner is reported materialized only on evidence produced by the CURRENT
#    attempt. The presence of an artifact a previous run left behind is never
#    that evidence, and a family that failed never promotes a retained or
#    unvisited generation to a success.

# Synthetic fixture trees may contain links: remove every link before any
# recursive delete, so cleanup can never follow one into its target.
serving_remove_links <- function(path) {
  for (entry in list.files(path, full.names = TRUE, all.files = TRUE, no.. = TRUE)) {
    if (fs::is_link(entry)) fs::link_delete(entry)
    else if (dir.exists(entry)) serving_remove_links(entry)
  }
  invisible(path)
}

serving_tree_fingerprint <- function(path) {
  entries <- list.files(path, recursive = TRUE, all.files = TRUE, no.. = TRUE)
  stats::setNames(vapply(entries, function(entry)
    as.character(tools::md5sum(file.path(path, entry))), character(1)), entries)
}

# Commit a pointer the way the family writers do: the immutable declaration the
# readers resolve the owner's generation through.
write_serving_pointer <- function(family, directory, owner, version) {
  path <- serving_artifact_pointer_path(family, directory, owner)
  if (!dir.exists(dirname(path))) dir.create(dirname(path), recursive = TRUE)
  pointer <- if (identical(family, "scalar-serving"))
    list(grain = "scalar", version = version, generation = paste0("scalar-", version))
  else list(semantic_version = version, generation = paste0("generation-", version))
  jsonlite::write_json(pointer, path, auto_unbox = TRUE)
  path
}

serving_pointer_value <- function(pointer) jsonlite::fromJSON(pointer, simplifyVector = FALSE)

test_that("provenance: seul l'artefact de la tentative courante est materialise", {
  version <- "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  directory <- tempfile("serving-outcomes-")
  dir.create(directory)
  on.exit(unlink(directory, recursive = TRUE), add = TRUE)
  pointer <- write_serving_pointer("scalar-serving", directory, "demographie", version)
  status <- function(outcomes) outcomes$status[[1L]]

  # An attempt that failed is never proven by a retained pointer.
  failed <- serving_attempt_outcomes("scalar-serving", "demographie", NULL,
    "producer refused the payload", directory)
  expect_identical(status(failed), "blocked")
  expect_identical(failed$detail[[1L]], "producer refused the payload")
  expect_true(file.exists(pointer))

  # The current attempt recomputed the version the pointer already declares: a
  # deterministic no-op rerun succeeds without rewriting anything.
  expect_identical(status(serving_attempt_outcomes("scalar-serving", "demographie",
    version, NULL, directory)), "materialized")

  # The current attempt computed a version the pointer does not declare: the
  # retained generation is stale and is not this attempt's artifact.
  expect_identical(status(serving_attempt_outcomes("scalar-serving", "demographie",
    "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", NULL, directory)), "blocked")

  # An attempt that returned without naming the owner is no evidence for it.
  expect_identical(status(serving_attempt_outcomes("scalar-serving", "demographie",
    NULL, NULL, directory)), "blocked")

  # A multi-owner family: a return that does not name an owner is never spread
  # over the family, and a failed attempt blocks every owner it covers even when
  # they all carry a valid retained pointer.
  owners <- c("conso_enaf_annuel", "artif_par_habitant")
  for (owner in owners) write_serving_pointer("series-serving", directory, owner, version)
  expect_true(all(serving_attempt_outcomes("series-serving", owners, version, NULL,
    directory)$status == "blocked"))
  expect_true(all(serving_attempt_outcomes("series-serving", owners,
    list(conso_enaf_annuel = version), "artif_par_habitant refused", directory)$status == "blocked"))
  expect_true(all(serving_attempt_outcomes("series-serving", owners,
    list(conso_enaf_annuel = version, artif_par_habitant = version), NULL,
    directory)$status == "materialized"))
  # An owner no attempt ever wrote stays blocked, pointer or not.
  expect_identical(status(serving_attempt_outcomes("series-serving", "prix_m2", NULL,
    NULL, directory)), "blocked")
})

test_that("isolation: un alias, un lien ou un ancetre lie ne peuvent pas viser l'instantane", {
  root <- tempfile("serving-isolation-")
  dir.create(root)
  on.exit({ serving_remove_links(root); unlink(root, recursive = TRUE, force = TRUE) }, add = TRUE)
  source <- file.path(root, "snapshot")
  dir.create(source)
  writeLines("canonical payload", file.path(source, "marker.txt"))
  writeLines("second", file.path(source, "other.txt"))
  before <- serving_tree_fingerprint(source)
  expect_rejected <- function(work, destinations = character()) {
    expect_error(assert_serving_work_isolated(source, work, destinations), "committed payload")
    # A refused work directory is refused before anything is written through it.
    expect_identical(serving_tree_fingerprint(source), before)
  }

  # Plain overlap: identical, contained and containing.
  expect_rejected(source)
  expect_rejected(file.path(source, "series-serving"))
  expect_rejected(root)

  # A work root that is a link to the snapshot, and a not-yet-created work
  # directory below a linked ancestor.
  root_alias <- file.path(root, "root-alias")
  fs::link_create(source, root_alias)
  expect_rejected(root_alias)
  expect_rejected(file.path(root_alias, "fresh-work"))

  # A linked destination subdirectory under an otherwise isolated work root: the
  # root alone passes, the destination that resolves into the snapshot does not.
  work <- file.path(root, "work")
  dir.create(work)
  fs::link_create(source, file.path(work, "scalar-serving"))
  expect_silent(assert_serving_work_isolated(source, work))
  expect_rejected(work, file.path(work, "scalar-serving", "demographie"))

  # A destination that escapes an isolated work root without touching the
  # snapshot is refused too: every write lands in the caller's own tree.
  elsewhere <- file.path(root, "elsewhere")
  dir.create(elsewhere)
  fs::link_create(elsewhere, file.path(work, "series-serving"))
  expect_error(assert_serving_work_isolated(source, work,
    file.path(work, "series-serving", "prix_m2")), "work directory")

  # A legitimate isolated work directory, with destinations not created yet, is
  # accepted.
  expect_silent(assert_serving_work_isolated(source, file.path(root, "outside"),
    file.path(root, "outside", "scalar-serving", "demographie")))

  # On Windows the same directory answers to any case, and only the filesystem
  # says so: the lexical form keeps the case it was given.
  if (.Platform$OS.type == "windows") {
    expect_identical(serving_path_key(serving_resolve_path(toupper(source))),
      serving_path_key(source))
    expect_rejected(toupper(source))
    expect_rejected(file.path(toupper(source), "series-serving"))
  }

  expect_identical(serving_tree_fingerprint(source), before)
})

test_that("isolation: l'entree refuse un travail recouvrant l'instantane avant toute ecriture", {
  serving_skip()
  real <- serving_payload_dir()
  plan <- plan_serving_artifacts(real)
  root <- tempfile("serving-entry-isolation-")
  dir.create(root)
  on.exit({ serving_remove_links(root); unlink(root, recursive = TRUE, force = TRUE) }, add = TRUE)

  # A synthetic snapshot carrying the producer-derived input inventory: the owner
  # derivation reads the real theme metadata (copied read-only), and the guard has
  # to fire before any of the remaining inputs is read or copied.
  snapshot <- file.path(root, "snapshot")
  dir.create(snapshot)
  metadata_inputs <- paste0("theme_", THEMES_METADATA, ".json")
  file.copy(file.path(real, metadata_inputs), snapshot)
  for (input in setdiff(plan$inputs, metadata_inputs)) file.create(file.path(snapshot, input))
  before <- serving_input_state(snapshot, plan$inputs)
  expect_setequal(list.files(snapshot), plan$inputs)

  overlap <- file.path(snapshot, "series-serving")
  expect_error(materialize_serving_artifacts(snapshot, overlap, "materialize"),
    "outside the committed payload")
  expect_error(materialize_serving_artifacts(snapshot, snapshot, "materialize"),
    "outside the committed payload")

  # Nothing was written: no work directory, no artifact, and every committed input
  # keeps its size and mtime.
  expect_false(dir.exists(overlap))
  expect_setequal(list.files(snapshot), plan$inputs)
  expect_identical(serving_input_state(snapshot, plan$inputs), before)
})

test_that("isolation: l'inventaire garde couvre chaque ecriture planifiee", {
  serving_skip()
  plan <- plan_serving_artifacts(serving_payload_dir())
  work <- normalize_serving_dir(file.path(tempdir(), "serving-destinations-probe"))
  guard <- serving_write_destinations(plan, work)

  # Every entry is the work root or sits inside it, and the guard accepts the
  # inventory the entry point hands it.
  expect_true(all(vapply(guard, function(destination)
    identical(serving_path_key(destination), serving_path_key(work)) ||
      serving_path_within(work, destination), logical(1))))
  expect_silent(assert_serving_work_isolated(plan$source, work, guard))

  # The inventory covers every planned owner directory — derived from the plan,
  # not from a copied list — so a linked destination cannot hide behind an owner
  # the inventory forgot.
  keys <- serving_path_key(guard)
  owner_directories <- function(family, owners) vapply(owners, function(owner)
    dirname(serving_artifact_pointer_path(family, work, owner)), character(1))
  planned <- list("scalar-serving" = plan$scalar_owners, "series-serving" = plan$series_owners,
    "typed-reading" = plan$typed_themes, "profile-serving" = plan$profile_owners)
  for (family in names(planned)) {
    directories <- owner_directories(family, planned[[family]])
    expect_true(all(serving_path_key(directories) %in% keys))
  }
  # Plus the two family-level locations the publishers write beside the owners:
  # the declared-profile scalar binding and the Milieux annual series reading.
  expect_true(serving_path_key(file.path(work, "scalar-serving")) %in% keys)
  expect_true(serving_path_key(file.path(work, "series-reading",
    "conso_enaf_annuel")) %in% keys)
})

# One retained scalar owner materialized from the committed payload, scoped so the
# probe pays only that theme's read.
serving_scalar_probe <- local({
  cache <- new.env(parent = emptyenv())
  function() {
    if (is.null(cache$payload)) {
      source <- serving_payload_dir()
      plan <- plan_serving_artifacts(source)
      theme <- "demographie"
      scoped <- plan
      scoped$scalar_owners <- theme
      scoped$series_themes <- character()
      scoped$series_owners <- character()
      scoped$typed_themes <- character()
      scoped$profile_themes <- character()
      scoped$profile_owners <- character()
      scoped$facts_themes <- theme
      scoped$history_themes <- character()
      scoped$inputs <- serving_artifact_input_files(scoped)
      cache$plan <- scoped
      cache$payload <- list(
        facts = stats::setNames(list(lire_faits_commis(source, theme, "indicateurs")), theme),
        histories = list(),
        vintages = nanoparquet::read_parquet(file.path(source, "vintages.parquet")),
        territories = nanoparquet::read_parquet(file.path(source, "territoires.parquet")),
        metadata = plan$metadata)
    }
    cache
  }
})

test_that("provenance: une regeneration invalide bloque et conserve l'ancienne generation", {
  serving_skip()
  probe <- serving_scalar_probe()
  work <- file.path(tempdir(), "materialize-serving-regeneration")
  if (dir.exists(work)) unlink(work, recursive = TRUE)
  on.exit(unlink(work, recursive = TRUE), add = TRUE)

  first <- materialize_serving_families(probe$plan, probe$payload, work)
  expect_identical(first$status[[1L]], "materialized")
  pointer <- serving_artifact_pointer_path("scalar-serving", work, "demographie")
  version <- serving_pointer_value(pointer)$version
  generation <- file.path(dirname(pointer), serving_pointer_value(pointer)$generation)
  bytes <- readBin(pointer, "raw", file.info(pointer)$size)
  expect_true(dir.exists(generation))

  # The unchanged payload recomputes the same deterministic version: the owner
  # stays materialized and the immutable pointer is not rewritten.
  rerun <- materialize_serving_families(probe$plan, probe$payload, work)
  expect_identical(rerun$status[[1L]], "materialized")
  expect_identical(readBin(pointer, "raw", file.info(pointer)$size), bytes)

  # A payload the current producer contract refuses is blocked, and the previous
  # generation is retained — not deleted, and never reported as this attempt's
  # success. That blocked owner is what the caller turns into a non-zero status.
  broken <- probe$payload
  facts <- broken$facts[["demographie"]]
  facts$unit <- NULL
  broken$facts[["demographie"]] <- facts
  refused <- materialize_serving_families(probe$plan, broken, work)
  expect_identical(refused$status[[1L]], "blocked")
  expect_match(refused$detail[[1L]], "no valid scalar fact rows")
  expect_true(file.exists(pointer))
  expect_identical(serving_pointer_value(pointer)$version, version)
  expect_true(dir.exists(generation))
  expect_true(file.exists(file.path(generation, "manifest.json")))
})

# The Milieux owned-series family writes two owners from one attempt, so it can be
# driven into a partial failure through the real producers.
serving_milieux_series_probe <- local({
  cache <- new.env(parent = emptyenv())
  function() {
    if (is.null(cache$payload)) {
      source <- serving_payload_dir()
      plan <- plan_serving_artifacts(source)
      theme <- "milieux"
      scoped <- plan
      scoped$scalar_owners <- character()
      scoped$series_themes <- theme
      scoped$series_owners <- names(plan$metadata[[theme]]$owned_series_routes)
      scoped$typed_themes <- character()
      scoped$profile_themes <- character()
      scoped$profile_owners <- character()
      scoped$facts_themes <- theme
      scoped$history_themes <- theme
      scoped$inputs <- serving_artifact_input_files(scoped)
      raw <- lire_faits_commis(source, theme, "indicateurs")
      cache$raw <- raw
      cache$plan <- scoped
      cache$payload <- list(
        facts = stats::setNames(list(reconstruct_milieux_state_roles(raw, plan$metadata[[theme]])), theme),
        histories = stats::setNames(list(lire_faits_commis(source, theme, "histoires")), theme),
        vintages = nanoparquet::read_parquet(file.path(source, "vintages.parquet")),
        metadata = plan$metadata)
    }
    cache
  }
})

test_that("provenance: une defaillance partielle bloque toute la famille multiple", {
  serving_skip()
  probe <- serving_milieux_series_probe()
  owners <- probe$plan$series_owners
  expect_length(owners, 2L)
  work <- tempfile("materialize-serving-partial-")
  dir.create(work)
  on.exit(unlink(work, recursive = TRUE), add = TRUE)

  # A complete attempt materializes every owner of the family.
  complete <- materialize_serving_families(probe$plan, probe$payload, work)
  expect_true(all(complete$status[match(owners, complete$owner)] == "materialized"))
  pointers <- stats::setNames(vapply(owners, function(owner)
    serving_artifact_pointer_path("series-serving", work, owner), character(1)), owners)
  expect_true(all(file.exists(pointers)))
  versions <- vapply(pointers, function(pointer) serving_pointer_value(pointer)$semantic_version, character(1))

  # The producer contract refuses the second owner's input after the first owner
  # was already written. The retained pointers of both owners are not evidence for
  # the current attempt, so the whole family is blocked and every previous
  # generation is left in place — the caller's blocked set is what turns non-zero.
  refused <- materialize_serving_families(probe$plan,
    list(facts = stats::setNames(list(probe$raw), probe$plan$series_themes),
      histories = probe$payload$histories, vintages = probe$payload$vintages,
      metadata = probe$payload$metadata), work)
  expect_true(all(refused$status == "blocked"))
  expect_match(refused$detail[[1L]], "incomplete")
  expect_true(all(file.exists(pointers)))
  expect_identical(vapply(pointers, function(pointer)
    serving_pointer_value(pointer)$semantic_version, character(1)), versions)
})

test_that("provenance: un binding de profil indisponible bloque meme un pointeur existant", {
  serving_skip()
  plan <- plan_serving_artifacts(serving_payload_dir())
  theme <- plan$profile_themes[[1L]]
  scoped <- plan
  scoped$scalar_owners <- character()
  scoped$series_themes <- character()
  scoped$series_owners <- character()
  scoped$typed_themes <- character()
  scoped$profile_themes <- theme
  scoped$profile_owners <- profile_serving_owners(plan$metadata[[theme]])
  work <- tempfile("materialize-serving-binding-")
  dir.create(work)
  on.exit(unlink(work, recursive = TRUE), add = TRUE)
  owner <- scoped$profile_owners[[1L]]
  pointer <- write_serving_pointer("profile-serving", work, owner, strrep("b", 32))

  # Without the retained scalar generations the declared-profile facet cannot
  # bind: the retained pointer is not evidence, so every owner stays blocked.
  outcomes <- materialize_serving_families(scoped,
    list(facts = list(), histories = list(), territories = NULL, vintages = NULL,
      metadata = plan$metadata), work)
  expect_true(all(outcomes$status == "blocked"))
  expect_match(outcomes$detail[[1L]], "retained scalar generations")
  expect_true(file.exists(pointer))
})
