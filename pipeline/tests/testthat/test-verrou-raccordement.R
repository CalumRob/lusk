# test-verrou-raccordement --------------------------------------------------------
# La répétition du VERROU « données réelles » du raccordement : le corpus
# GTFS national épinglé est relu par le lecteur canonique (le même que la
# publication), puis verifier_raccordement_reel asserte les sorties PUBLIÉES —
# couverture, domaines, estampilles et l'ancre du run vérifié.
#
# Le bloc saute proprement sans le cache des données réelles (CI froide) ;
# sur le desktop il rejoue via la cible verif_mobilite_raccordement du graphe,
# pilotée par la fraîcheur de l'épingle.

test_that("verrou raccordement : les sorties réelles passent couverture, domaines, estampilles et ancre", {
  racine <- pkgload::pkg_path()
  payload <- file.path(racine, "public", "data",
                       "indicateurs_mobilite.parquet")
  skip_if_not(file.exists(payload), "le Parquet Mobilité conservé est absent")

  # depuis #728, la cible raccordement_mobilite rend le CHEMIN de l'épingle
  # versionnée (un fichier) — le verrou le résout sans jamais le traiter
  # comme un répertoire (#1070).
  artefact <- chemin_artefact_raccordement_national()
  expect_invisible(verifier_raccordement_reel(artefact, payload))
})
