fixture_bpe_publication <- function() {
  labels <- unname(PROFILS_ACCES_BPE)
  registry <- lire_correspondances_typequ()
  exemplar_codes <- c("A128", "A129", "A203", "A206")
  exemplar_labels <- registry$Libelle_TYPEQU[match(exemplar_codes, registry$TYPEQU)]
  data.frame(
    territoire = rep("35238", 4), type = rep("commune", 4),
    profil = names(PROFILS_ACCES_BPE), profil_libelle = labels,
    nombre_typequ = c(20L, 10L, 15L, 8L),
    exemplar_typequ = exemplar_codes,
    exemplar_libelle = exemplar_labels,
    exemplar_c = c(.2, .1, .3, 0), exemplar_b = c(.3, .2, .4, 0),
    exemplar_t = c(.4, .1, .2, 0), stringsAsFactors = FALSE
  )
}

fixture_bpe_vintages <- function() {
  data.frame(id = "mobilite_snapshot", source = "Vingt minutes sans voiture",
    version = "2026-02", date_reference = "2026-02-28",
    date_publication = "2026-08-06", stringsAsFactors = FALSE)
}

fixture_bpe_membership <- function() {
  codes <- lire_correspondances_typequ()$TYPEQU
  data.frame(territoire=rep("35238",length(codes)), type="commune",
             typequ=codes, stringsAsFactors=FALSE)
}

test_that("le publisher BPE lie la fermeture de classe à l'univers TYPEQU enregistré", {
  result <- project_bpe_profile_evidence(
    fixture_bpe_publication(),
    system.file("extdata", BPE_TYPEQU_ARTEFACT_FICHIER, package = "lusk"),
    fixture_bpe_vintages(), fixture_bpe_membership()
  )

  expect_equal(nrow(result$facts), 4L)
  expect_true(all(result$facts$univers_typequ_count == result$descriptor$universe_count))
  expect_equal(result$descriptor$universe_count, nrow(lire_correspondances_typequ()))
  reordered <- project_bpe_profile_evidence(
    fixture_bpe_publication(),
    system.file("extdata", BPE_TYPEQU_ARTEFACT_FICHIER, package = "lusk"),
    fixture_bpe_vintages(), rev(fixture_bpe_membership())
  )
  expect_identical(result$descriptor$membership_sha256,
                   reordered$descriptor$membership_sha256)
  expect_equal(result$descriptor$source$vintage_id, "2026-02")
  expect_equal(result$axes$class_key, names(PROFILS_ACCES_BPE))
  expect_equal(result$axes$direction, unname(DIRECTIONS_PROFILS_ACCES_BPE[names(PROFILS_ACCES_BPE)]))
})

test_that("le publisher refuse un décompte qui ne couvre pas l'univers attesté", {
  projection <- fixture_bpe_publication()
  projection$nombre_typequ[[1L]] <- projection$nombre_typequ[[1L]] - 1L

  expect_error(project_bpe_profile_evidence(
    projection,
    system.file("extdata", BPE_TYPEQU_ARTEFACT_FICHIER, package = "lusk"),
    fixture_bpe_vintages(), fixture_bpe_membership()
  ), "registered TYPEQU universe")
})

test_that("une classe vide peut être fermée seulement sans exemplaire", {
  projection <- fixture_bpe_publication()
  projection$nombre_typequ[[1L]] <- 0L
  projection$exemplar_typequ[[1L]] <- NA_character_
  projection$exemplar_libelle[[1L]] <- NA_character_
  projection$exemplar_c[[1L]] <- NA_real_
  projection$exemplar_b[[1L]] <- NA_real_
  projection$exemplar_t[[1L]] <- NA_real_
  projection$nombre_typequ[[2L]] <- projection$nombre_typequ[[2L]] + 20L

  result <- project_bpe_profile_evidence(
    projection,
    system.file("extdata", BPE_TYPEQU_ARTEFACT_FICHIER, package = "lusk"),
    fixture_bpe_vintages(), fixture_bpe_membership()
  )
  expect_equal(result$facts$nombre_typequ[[1L]], 0L)
  expect_true(is.na(result$facts$exemplar_typequ[[1L]]))
})

test_that("la preuve source refuse les identités TYPEQU inconnues ou omises malgré les mêmes comptes", {
  projection <- fixture_bpe_publication()
  membership <- fixture_bpe_membership()
  membership$typequ[[1]] <- "UNKNOWN"
  expect_error(project_bpe_profile_evidence(projection,
    system.file("extdata", BPE_TYPEQU_ARTEFACT_FICHIER, package="lusk"),
    fixture_bpe_vintages(), membership), "unknown")
  membership <- fixture_bpe_membership()
  membership$typequ[[1]] <- membership$typequ[[2]]
  expect_error(project_bpe_profile_evidence(projection,
    system.file("extdata", BPE_TYPEQU_ARTEFACT_FICHIER, package="lusk"),
    fixture_bpe_vintages(), membership), "membership")
  membership <- fixture_bpe_membership()
  membership$territoire[[1]] <- ""
  expect_error(project_bpe_profile_evidence(projection,
    system.file("extdata", BPE_TYPEQU_ARTEFACT_FICHIER, package="lusk"),
    fixture_bpe_vintages(), membership), "membership")
})

test_that("un branchement service ne publie pas BPE sans opt-in dédié", {
  called <- FALSE
  local_mocked_bindings(publish_bpe_profiles_from_canonical=function(...) {
    called <<- TRUE
  })
  expect_silent(publier_bpe_si_optin(FALSE, "not-a-bpe-artifact-dir", structure(list(),class="DBIConnection")))
  expect_false(called)
  expect_error(publier_bpe_si_optin(TRUE, "not-a-bpe-artifact-dir", NULL),
               "explicit service connection")
  expect_false(called)
  expect_error(run_pipeline(theme=list(theme="mobilite"), noms_epci_geo_api=NULL,
                            publier_bpe=TRUE), "requires the service connection")
})
