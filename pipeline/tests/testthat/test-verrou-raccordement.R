# test-verrou-raccordement --------------------------------------------------------
# La répétition du VERROU « données réelles » du raccordement (issue #486) :
# preparer_raccordement tourne sur les artefacts ÉPINGLÉS du package + les
# deux entrées de cache (la table de passage COG, le référentiel EPCI extrait
# — jamais un téléchargement, jamais un re-routage : la matrice est figée),
# puis verifier_raccordement_reel asserte les sorties PUBLIÉES — couverture,
# domaines, estampilles et les ancres du run de recherche vérifié.
#
# Le bloc saute proprement sans le cache des données réelles (CI froide) ;
# sur le desktop il rejoue via la cible verif_mobilite_raccordement du graphe,
# pilotée par la fraîcheur de l'artefact calculé.

test_that("verrou raccordement : les sorties réelles passent couverture, domaines, estampilles et ancres", {
  racine <- pkgload::pkg_path()
  zip_cog <- file.path(racine, "data", "raw", "table_passage_annuelle_2025.zip")
  base_epci <- file.path(racine, "data", "raw", "extracted",
                         "EPCI_au_01-01-2025.xlsx")
  payload <- file.path(racine, "public", "data",
                       "indicateurs_mobilite.json")
  skip_if_not(file.exists(zip_cog), "le cache des données réelles n'est pas présent")
  skip_if_not(file.exists(base_epci), "le référentiel EPCI extrait n'est pas présent")
  skip_if_not(file.exists(payload), "le payload publié du raccordement est absent")

  sortie <- tempfile("verrou-raccordement-")
  dir.create(sortie)
  on.exit(unlink(sortie, recursive = TRUE), add = TRUE)

  preparer_raccordement(zip_cog = zip_cog, chemin_base_epci = base_epci,
                        sortie = sortie)
  expect_invisible(verifier_raccordement_reel(sortie, payload))
})
