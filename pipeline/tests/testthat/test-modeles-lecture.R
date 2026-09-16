test_that("un modèle d'indicateur est une projection déterministe du canon", {
  metadata <- list(
    theme = "demographie",
    label = "Démographie",
    detail_labels = list(),
    source_records = list(
      serie_historique = list(
        dataset = "Série historique", publisher = "INSEE", url = "https://example.test",
        licence = "LO", vintage = "2023", freshness = "2026-06-30"
      )
    ),
    indicator_pages = list(
      densite = list(
        indicator = "densite",
        label = "Densité de population",
        definition = "Nombre d'habitants par kilomètre carré.",
        unit = "hab./km²",
        calculation = "Population divisée par la superficie.",
        direction = "high",
        caveats = "La superficie est celle du territoire.",
        levels = c("commune", "epci", "departement"),
        sources = "serie_historique"
      )
    )
  )
  indicateurs <- tibble::tibble(
    territoire = c("2000", "1000", "1000", "3000"),
    type = c("epci", "commune", "commune", "region"),
    theme = "demographie",
    key = c("densite", "taille_menages", "densite", "densite"),
    detail = NA_character_,
    sex = NA_character_,
    dimension = NA_character_,
    value = c(90, 2.1, 120, 110),
    unit = c("hab./km²", "personnes", "hab./km²", "hab./km²")
  )

  modele <- construire_modele_indicateur(
    indicateurs = indicateurs[c(4, 2, 1, 3), ],
    metadata = metadata,
    indicateur = "densite",
    snapshot_id = "2026-09-15"
  )

  expect_identical(modele$schema_version, "1")
  expect_identical(modele$snapshot_id, "2026-09-15")
  expect_identical(modele$theme, "demographie")
  expect_identical(modele$indicator, "densite")
  expect_identical(modele$theme_label, "Démographie")
  expect_identical(modele$page, metadata$indicator_pages$densite)
  expect_length(modele$detail_labels, 0)
  expect_named(modele$source_records, "serie_historique")
  expect_identical(modele$facts$territoire, c("1000", "2000"))
  expect_true(all(modele$facts$key == "densite"))
  expect_false(any(modele$facts$type == "region"))
})

test_that("un modèle d'indicateur se publie sous son adresse de lecture", {
  modele <- list(
    schema_version = "1",
    snapshot_id = "2026-09-15",
    theme = "demographie",
    indicator = "densite",
    theme_label = "Démographie",
    page = list(indicator = "densite", levels = c("commune")),
    detail_labels = list(),
    facts = tibble::tibble(
      territoire = "1000", type = "commune", theme = "demographie",
      key = "densite", detail = NA_character_, value = 120,
      unit = "hab./km²"
    )
  )
  sortie <- tempfile("modeles-lecture-")
  on.exit(unlink(sortie, recursive = TRUE))

  chemin <- publier_modele_indicateur(modele, sortie = sortie)

  expect_identical(
    normalizePath(chemin, winslash = "/"),
    normalizePath(
      file.path(sortie, "modeles-lecture", "indicateurs", "demographie",
                "densite.json"),
      winslash = "/"
    )
  )
  expect_true(file.exists(chemin))
  relu <- jsonlite::fromJSON(chemin, simplifyDataFrame = FALSE)
  expect_identical(relu$schema_version, "1")
  expect_identical(relu$facts[[1]]$territoire, "1000")
  expect_null(relu$facts[[1]]$detail)
})

test_that("l'identifiant de snapshot vient des vintages", {
  expect_identical(
    identifiant_snapshot(data.frame(
      date_reference = c("2023-01-01", NA, "2025-01-01")
    )),
    "2025-01-01"
  )
})

test_that("le registre de métadonnée pilote les modèles publiés", {
  metadata <- list(
    theme = "demographie",
    label = "Démographie",
    detail_labels = list(),
    source_records = list(
      serie_historique = list(
        dataset = "Série historique", publisher = "INSEE", url = "https://example.test",
        licence = "LO", vintage = "2023", freshness = "2026-06-30"
      )
    ),
    indicator_pages = list(
      densite = list(
        indicator = "densite", label = "Densité", definition = "Densité.",
        unit = "hab./km²", calculation = "Population / superficie.",
        direction = "high", caveats = "Aucune.",
        levels = c("commune"), sources = c("serie_historique"),
        read_model = TRUE
      )
    )
  )
  payload <- list(indicateurs = tibble::tibble(
    territoire = "1000", type = "commune", theme = "demographie",
    key = "densite", detail = NA_character_, value = 120,
    unit = "hab./km²"
  ))
  sortie <- tempfile("modeles-lecture-registre-")
  on.exit(unlink(sortie, recursive = TRUE))

  chemins <- publier_modeles_lecture(
    payload, metadata,
    data.frame(date_reference = "2025-01-01"),
    sortie = sortie
  )

  expect_length(chemins, 1)
  expect_true(file.exists(chemins[[1]]))
  expect_identical(
    jsonlite::fromJSON(chemins[[1]], simplifyDataFrame = FALSE)$snapshot_id,
    "2025-01-01"
  )
})
