# test-parite-libelles ---------------------------------------------------------
# Les libellés payload-owned (issue #318) — les gardes de parité bidirectionnelle
# qui verrouillent le contrat de vocabulaire :
#   1. le registre du pipeline (la colonne `libelle` de INDICATEURS_<THEME>) et
#      la carte indicator_labels du fichier épinglé theme_<theme>.json sont
#      EXACTEMENT la même vocabulaire — le pipeline déclare ce que la fiche
#      rend, jamais deux mots pour la même clé ;
#   2. le payload COMMITTÉ (public/data/indicateurs_<theme>.json) et les
#      métadonnées épinglées sont en parité bidirectionnelle : chaque ligne
#      (key, detail) publiée a son libellé (indicator_labels pour la clé,
#      detail_labels pour le détail), et aucun libellé de détail déclaré n'est
#      mort (chaque détail déclaré est publié quelque part dans le payload).
# La carte (miroir de la fiche) et la fiche lisent ces libellés ; une clé
# brute ne peut jamais revenir à l'écran — ces gardes prouvent que la
# vocabulaire vit dans les métadonnées, pas dans l'app.

test_that("indicator_labels du fichier épinglé == la colonne libelle du registre (le pipeline déclare la vocabulaire)", {
  for (theme in THEMES_METADATA) {
    meta <- lire_theme_metadata(theme)
    registre <- get(paste0("INDICATEURS_", toupper(theme)))
    libelles_registre <- stats::setNames(registre$libelle, registre$key)

    declarees <- unlist(meta$indicator_labels, use.names = TRUE)
    expect_identical(
      sort(declarees),
      sort(libelles_registre),
      info = paste("indicator_labels != INDICATEURS_", theme, sep = "")
    )
  }
})

test_that("parité bidirectionnelle métadonnées épinglées ↔ payload committé : chaque (key, detail) publié a son libellé, aucun libellé mort", {
  # Le payload COMMITTÉ est l'artefact que l'app fetch (public/data/ à la
  # racine du dépôt) — la même lecture que payload-contract.spec.ts côté app.
  racine_public <- file.path(testthat::test_path("..", "..", ".."), "public", "data")
  expect_true(dir.exists(racine_public), info = "public/data absent — la racine du dépôt est introuvable")

  for (theme in THEMES_METADATA) {
    indicateurs <- jsonlite::fromJSON(
      file.path(racine_public, paste0("indicateurs_", theme, ".json"))
    )
    meta <- lire_theme_metadata(theme)

    # payload → métadonnées : chaque ligne publiée porte ses libellés
    cles_publiees <- unique(indicateurs$key)
    manquants_libelle <- setdiff(cles_publiees, names(meta$indicator_labels))
    expect_true(length(manquants_libelle) == 0L, info = paste(
      theme, ": indicateur(s) publié(s) sans libellé :",
      paste(manquants_libelle, collapse = ", ")))

    lignes_detail <- indicateurs[!is.na(indicateurs$detail), , drop = FALSE]
    couples <- unique(lignes_detail[c("key", "detail")])
    for (i in seq_len(nrow(couples))) {
      cle <- couples$key[[i]]
      detail <- couples$detail[[i]]
      carte <- meta$detail_labels[[cle]]
      expect_false(is.null(carte), info = paste(
        theme, ": détail «", detail, "» de «", cle, "» sans carte detail_labels"))
      expect_false(is.null(carte[[detail]]), info = paste(
        theme, ": détail «", detail, "» de «", cle, "» sans libellé"))
    }

    # métadonnées → payload : aucun libellé de détail mort (chaque détail
    # déclaré est publié quelque part)
    for (cle in names(meta$detail_labels)) {
      declares <- names(meta$detail_labels[[cle]])
      publies <- unique(indicateurs$detail[indicateurs$key == cle &
                                             !is.na(indicateurs$detail)])
      morts <- setdiff(declares, publies)
      expect_true(length(morts) == 0L, info = paste(
        theme, ": détail(s) déclaré(s) jamais publié(s) pour «", cle, "» :",
        paste(morts, collapse = ", ")))
    }
  }
})
