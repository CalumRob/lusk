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
