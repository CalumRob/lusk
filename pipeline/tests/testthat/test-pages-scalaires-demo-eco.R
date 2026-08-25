# test-pages-scalaires-demo-eco -------------------------------------------------
# Les cinq Pages d'indicateur scalaires de Démographie et d'Économie (issue
# #460) : le contrat de publication des descripteurs épinglés —
#   - le canon épinglé passe la validation du contrat (#309), vintages comprises ;
#   - la carte indicator_pages porte EXACTEMENT ses cinq clés, chacune dans SA
#     famille scalaire (l'héritage #401 : famille absente = scalar) ;
#   - chaque page déclare SA sémantique publiée : la direction du thème
#     (DIRECTIONS_ECONOMIE / directions Démographie — chômage low, jamais un
#     défaut silencieux), l'unité du payload committé, sa source de référence
#     et une fiche source complète ;
#   - la republication depuis le canon est STABLE À L'OCTET près contre
#     l'artefact commis (public/data/theme_<theme>.json) — un canon édité sans
#     régénération échoue ici, jamais en silence ;
#   - chaque clé page porte SES faits : une ligne sans détail par territoire
#     publié (la garde « exactement une fois » du catalogue #409 côté pipeline).
#
# Le miroir applicatif vit ailleurs (catalogue.spec.ts « catalogue × payload
# réel commis », generic every-and-only) ; ce fichier prouve le CÔTÉ
# PUBLICATION — rien d'autre (budget de tests #460).

test_that("les cinq pages scalaires Démographie + Économie sont déclarées dans les canons épinglés et valident le contrat (#460)", {
  meta_demo <- lire_theme_metadata("demographie")
  meta_eco <- lire_theme_metadata("economie")

  expect_no_error(valider_theme_metadata(meta_demo,
                                         vintages = vintages_demographie()))
  expect_no_error(valider_theme_metadata(meta_eco,
                                         vintages = vintages_economie()))

  expect_identical(sort(names(meta_demo$indicator_pages)),
                   sort(c("densite", "structure_age",
                          "evolution_1968", "taille_menages")))
  expect_identical(sort(names(meta_eco$indicator_pages)),
                   sort(c("effectifs_salaries", "chomage", "eco_activites")))
})

test_that("les cinq pages portent la sémantique publiée : famille scalaire, direction du thème, unité du payload, sources complètes (#460)", {
  attendues <- list(
    demographie = list(
      pages = c("evolution_1968", "taille_menages"),
      directions = theme_demographie()$directions,
      vintages = vintages_demographie()
    ),
    economie = list(
      pages = c("effectifs_salaries", "chomage", "eco_activites"),
      directions = DIRECTIONS_ECONOMIE,
      vintages = vintages_economie()
    )
  )

  racine_public <- file.path(testthat::test_path("..", "..", ".."),
                             "public", "data")
  expect_true(dir.exists(racine_public))

  for (theme in names(attendues)) {
    spec <- attendues[[theme]]
    meta <- lire_theme_metadata(theme)
    indiques <- jsonlite::fromJSON(
      file.path(racine_public, paste0("indicateurs_", theme, ".json")),
      simplifyVector = TRUE
    )
    unites <- tapply(indiques$unit, indiques$key, unique)

    for (cle in spec$pages) {
      page <- meta$indicator_pages[[cle]]
      # la forme héritée #401 : famille absente = scalar — jamais une autre
      expect_null(page$family,
                  info = paste(theme, cle, ": la famille doit rester scalaire"))
      # la direction DÉCLARÉE par le thème (jamais un défaut silencieux)
      expect_identical(page$direction, spec$directions[[cle]],
                       info = paste(theme, cle, ": direction"))
      # l'unité du payload committé (la même que rendent fiche et Repères)
      expect_identical(page$unit, unites[[cle]][[1L]],
                       info = paste(theme, cle, ": unité"))
      # la source de référence du thème est dans les sources de la page, et
      # chaque source déclarée possède sa fiche complète
      expect_true(meta$sources[[cle]] %in% unlist(page$sources),
                  info = paste(theme, cle, ": source de référence"))
      for (source_id in unlist(page$sources)) {
        record <- meta$source_records[[source_id]]
        expect_true(all(vapply(
          c("dataset", "publisher", "url", "licence", "vintage", "freshness"),
          function(champ) is.character(record[[champ]]) && nzchar(record[[champ]]),
          logical(1L))), info = paste(theme, cle, source_id, ": fiche source"))
      }
    }
  }
})

test_that("la republication depuis les canons épinglés est stable à l'octet contre les artefacts commis (#460)", {
  racine_public <- file.path(testthat::test_path("..", "..", ".."),
                             "public", "data")

  for (theme in c("demographie", "economie")) {
    sortie <- tempfile("pages-scalaires-")
    on.exit(unlink(sortie, recursive = TRUE), add = TRUE)

    meta <- if (theme == "demographie") {
      publier_theme_metadata(lire_theme_metadata(theme), sortie = sortie,
                             vintages = vintages_demographie(),
                             theme_attendu = theme)
    } else {
      publier_theme_metadata(lire_theme_metadata(theme), sortie = sortie,
                             vintages = vintages_economie(),
                             theme_attendu = theme)
    }

    commis <- file.path(racine_public, paste0("theme_", theme, ".json"))
    republie <- file.path(sortie, paste0("theme_", theme, ".json"))
    attendu <- readBin(commis, "raw", file.size(commis))
    observe <- readBin(republie, "raw", file.size(republie))
    expect_identical(observe, attendu,
                     info = paste("artefact", theme,
                                  "non régénéré depuis son canon épinglé"))
  }
})

test_that("chaque page porte ses faits : une ligne sans détail par territoire publié, exactement une fois (#460)", {
  racine_public <- file.path(testthat::test_path("..", "..", ".."),
                             "public", "data")
  cles_par_theme <- list(
    demographie = c("evolution_1968", "taille_menages"),
    economie = c("effectifs_salaries", "chomage", "eco_activites")
  )

  for (theme in names(cles_par_theme)) {
    indiques <- jsonlite::fromJSON(
      file.path(racine_public, paste0("indicateurs_", theme, ".json")),
      simplifyVector = TRUE
    )
    territoires <- unique(indiques$territoire)

    for (cle in cles_par_theme[[theme]]) {
      lignes <- indiques[indiques$key == cle, , drop = FALSE]
      expect_true(all(is.na(lignes$detail)),
                  info = paste(theme, cle, ": un scalaire ne porte pas de détail"))
      expect_false(anyDuplicated(lignes$territoire) > 0L,
                   info = paste(theme, cle, ": un territoire en double"))
      expect_true(setequal(lignes$territoire, territoires),
                  info = paste(theme, cle, ": un territoire sans fait"))
    }
  }
})
