# test-contract-vintages-langue -------------------------------------------------
# Le contrat de langue publique sur les labels de source COMMITTÉS (issue #365) :
# le miroir pipeline du test MOTS_INTERNES de l'app (methodes-indicateurs.spec.ts).
# L'app rend ce que le payload dit (ADR-0003) — la fiche estampille les lignes du
# payload avec vintage_source (formaterVintage) et la table des vintages alimente
# la page Méthodes. Le contrat : AUCUN label de source committé ne porte un id
# d'artefact du pipeline — la même vocabulaire que l'app blackliste dans ses
# définitions, appliquée au payload réel.
# Cela ferme le trou que le test de parité #336 ne voit pas (il compare
# registre-app ↔ registre-app, jamais la table vintages committée ni les
# estampilles du payload) : un id d'artefact réintroduit dans un manifeste et
# publié échoue ici, sur l'artefact committé que l'app fetch.

# Le vocabulaire du pipeline à ne jamais publier (miroir de MOTS_INTERNES de
# methodes-indicateurs.spec.ts — les mots des définitions de l'app, appliqués
# ici aux labels de source).
motifs_artefacts <- c(
  "dpe03existant", "sirene-v3", "\\.rds", "parquet",
  "manifeste", "artefact", "gate"
)

# La racine du dépôt (public/data à la racine — la même lecture que
# test-parite-libelles.R : l'artefact que l'app fetch).
racine_public <- file.path(testthat::test_path("..", "..", ".."), "public", "data")

# collecter les valeurs des clés « source » et « vintage_source » d'un JSON
# committé, à toute profondeur (la table vintages porte la clé `source`, les
# tables de faits portent `vintage_source` ; les champs `note` ne sont PAS
# balayés — ils sont internes par design, ticket #365 §guardrails).
valeurs_sources <- function(objet) {
  if (is.data.frame(objet)) {
    noms <- names(objet)
    cles <- noms[noms %in% c("source", "vintage_source")]
    unlist(lapply(cles, function(cl) as.character(objet[[cl]])), use.names = FALSE)
  } else if (is.list(objet)) {
    unlist(lapply(objet, valeurs_sources), use.names = FALSE)
  } else {
    character(0)
  }
}

# Les fichiers JSON du payload committé (la table vintages + les tables de
# faits qui portent les estampilles de la fiche).
fichiers_payload <- list.files(
  racine_public, pattern = "\\.json$", full.names = TRUE
)
fichiers_payload <- fichiers_payload[!grepl(
  "(run-report|territoires|theme_|apercu|geojson)", basename(fichiers_payload)
)]

test_that("aucun label de source committé ne porte un id d'artefact du pipeline", {
  expect_true(dir.exists(racine_public),
              info = "public/data absent — la racine du dépôt est introuvable")

  for (fichier in fichiers_payload) {
    valeurs <- valeurs_sources(jsonlite::fromJSON(fichier))
    for (motif in motifs_artefacts) {
      fautifs <- unique(valeurs[grepl(motif, valeurs, ignore.case = TRUE)])
      expect_true(
        length(fautifs) == 0L,
        info = paste0(
          basename(fichier), " — label de source portant « ", motif, " » : ",
          paste(fautifs, collapse = " | ")
        )
      )
    }
  }
})
