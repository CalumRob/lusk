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
