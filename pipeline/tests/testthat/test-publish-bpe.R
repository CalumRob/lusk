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

test_that("le publisher BPE lie la fermeture de classe à l'univers TYPEQU enregistré", {
  result <- project_bpe_profile_evidence(
    fixture_bpe_publication(),
    system.file("extdata", BPE_TYPEQU_ARTEFACT_FICHIER, package = "lusk"),
    fixture_bpe_vintages()
  )

  expect_equal(nrow(result$facts), 4L)
  expect_true(all(result$facts$univers_typequ_count == result$descriptor$universe_count))
  expect_equal(result$descriptor$universe_count, nrow(lire_correspondances_typequ()))
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
    fixture_bpe_vintages()
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
    fixture_bpe_vintages()
  )
  expect_equal(result$facts$nombre_typequ[[1L]], 0L)
  expect_true(is.na(result$facts$exemplar_typequ[[1L]]))
})
