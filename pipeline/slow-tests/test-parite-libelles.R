# Slow tier (#1172): bidirectional label parity scans every committed producer fact and pinned metadata page; protects public vocabulary with no dead or missing labels.
# Run explicitly with testthat::test_file(..., package="lusk") from pipeline/.

local({
  withr::local_dir(file.path(pkgload::pkg_path(), "tests", "testthat"))
  for (helper in list.files(file.path(pkgload::pkg_path(), "tests", "testthat"), pattern = "^helper.*\\.R$", full.names = TRUE)) source(helper, local = environment())

# test-parite-libelles ---------------------------------------------------------
# Les libellés payload-owned (issue #318) — les gardes de parité bidirectionnelle
# qui verrouillent le contrat de vocabulaire :
#   1. le registre du pipeline (la colonne `libelle` de INDICATEURS_<THEME>) et
#      la carte indicator_labels du fichier épinglé theme_<theme>.json sont
#      EXACTEMENT la même vocabulaire — le pipeline déclare ce que la fiche
#      rend, jamais deux mots pour la même clé ;
#   2. les faits issus des producteurs de fixture (le Parquet Mobilité conservé
#      inclus) et les métadonnées épinglées sont en parité bidirectionnelle : chaque ligne
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
    # #1048 (slice 2) : le catalogue Mobilité est RÉTRÉCI aux 17 clés que le
    # producteur publie encore — la parité est stricte pour les six thèmes,
    # sans exception ni sur-ensemble toléré.
    expect_identical(
      sort(declarees),
      sort(libelles_registre),
      info = paste("indicator_labels != INDICATEURS_", theme, sep = "")
    )
  }
})

test_that("parité bidirectionnelle métadonnées épinglées ↔ faits producteurs : chaque (key, detail) a son libellé, aucun libellé mort", {
  # Les tables numériques navigateur sont retirées. La preuve reste attachée
  # aux seams producteurs en mémoire ; Mobilité lit seulement son Parquet de
  # thème conservé (#619), et Programmes reconstruit ses faits depuis ses deux
  # Parquets producteurs retenus.
  racine_public <- file.path(testthat::test_path("..", "..", ".."), "public", "data")
  expect_true(dir.exists(racine_public), info = "public/data absent — la racine du dépôt est introuvable")

  for (theme in THEMES_METADATA) {
    indicateurs <- lire_indicateurs_producteur_fixture(theme, racine_public)
    meta <- lire_theme_metadata(theme)

    # payload → métadonnées : chaque ligne publiée porte ses libellés.
    # #1048 : le Parquet Mobilité COMMIS est l'état antérieur au retrait — il
    # porte encore les 29 faits du snapshot. On le ramène au catalogue courant
    # en écartant explicitement ces clés (jamais un filtre muet).
    cles_publiees <- unique(indicateurs$key)
    if (theme_sans_lecture(theme))
      cles_publiees <- setdiff(cles_publiees, INDICATEURS_MOBILITE_RETIRES)
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
      detail_courant <- detail
      if (theme == "programmes" && identical(cle, "subventions_par_domaine")) {
        # #1151 : la snapshot producteur retenue (2026-08-05) porte encore les
        # anciens domaines ; on la ramène au vocabulaire courant avant la parité.
        detail_courant <- detail_scdl_courant(detail)
        if (detail_courant %in% DOMAINES_SCDL_RETIRES_SNAPSHOT) next
      }
      expect_false(is.null(carte[[detail_courant]]), info = paste(
        theme, ": détail «", detail_courant, "» de «", cle, "» sans libellé"))
    }

    # métadonnées → payload : aucun libellé de détail mort (chaque détail
    # déclaré est publié quelque part)
    for (cle in names(meta$detail_labels)) {
      declares <- names(meta$detail_labels[[cle]])
      owned_route <- Filter(function(route) isTRUE(route$active_read_route) &&
        (identical(route$indicator_id, cle) || identical(route$reference_indicator, cle)),
        meta$owned_series_routes %||% list())
      if (length(owned_route)) {
        # The active owned-series contract describes the next canonical
        # publication; committed public/data remains the incumbent snapshot.
        expected <- paste0("t", sprintf("%04d", as.integer(unlist(
          owned_route[[1L]]$axis_values, use.names = FALSE))))
        expect_setequal(declares, expected)
        next
      }
      publies <- unique(indicateurs$detail[indicateurs$key == cle &
                                             !is.na(indicateurs$detail)])
      if (theme == "programmes" && identical(cle, "subventions_par_domaine")) {
        # #1151 : la déclaration porte les 43 domaines courants du jeu source ;
        # la snapshot producteur committée en porte encore 39. La parité
        # déclaration ↔ source est verrouillée par
        # test-theme-programmes-domaines-scdl.R et par le garde d'exécution
        # project_programme_period_details(), pas par cette snapshot datée.
        next
      }
      morts <- setdiff(declares, publies)
      expect_true(length(morts) == 0L, info = paste(
        theme, ": détail(s) déclaré(s) jamais publié(s) pour «", cle, "» :",
        paste(morts, collapse = ", ")))
    }
  }
})

})
