# Slow tier (#1172): the bidirectional parity scan reads every committed producer fact; the pinned-label registry contract is back in tests/testthat/.
# Subject files: pipeline/inst/extdata/theme-metadata, pipeline/tests/testthat/helper-payload.R, public/data
# Run explicitly with testthat::test_file(..., package="lusk") from pipeline/.

local({
  withr::local_dir(file.path(pkgload::pkg_path(), "tests", "testthat"))
  for (helper in list.files(file.path(pkgload::pkg_path(), "tests", "testthat"), pattern = "^helper.*\\.R$", full.names = TRUE)) source(helper, local = environment())

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
