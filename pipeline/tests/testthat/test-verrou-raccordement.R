# test-verrou-raccordement --------------------------------------------------------
# Le VERROU « données réelles » du raccordement vérifie l'ARTEFACT NATIONAL
# ÉPINGLÉ (entrée de contrat : enveloppe, matrice OD et population sous
# extdata) contre les VALEURS DORÉES du modèle SORTANT arrêt-à-arrêt GTFS
# (#728) : couverture aux quatre niveaux, ancres de communes couvrant l'étendue
# des parts @90 + médiane et points de courbe. Ces verrous REMPLACENT les
# ancres mairie-à-mairie retirées (le run #485), qui ne décrivent plus le
# modèle publié.
#
# La dérivation depuis les INPUTS du modèle retiré (COG zip + référentiel EPCI)
# ne s'applique PLUS : le modèle publié se construit depuis les épingles
# versionnées de extdata, pas depuis preparer_raccordement() (artefact
# mairie-à-mairie). Le verrou lit donc l'épingle par
# lire_artefact_raccordement_national(), qui normalise le chemin à la frontière
# (#1070) et RECOMPUTE les courbes depuis la matrice épinglée avant d'asserter
# — il ne consomme pas un chiffre figé dans le payload. Les épingles sont
# recopiées dans un répertoire temporaire pour exercer cette normalisation.
# Saute sans le Parquet Mobilité conservé (CI froide) ; sur le desktop il
# rejoue via la cible verif_mobilite_raccordement du graphe, pilotée par la
# fraîcheur de l'épingle.

test_that("verrou raccordement : l'artefact épinglé passe couverture, domaines, estampilles et ancres", {
  racine <- pkgload::pkg_path()
  payload <- file.path(racine, "public", "data",
                       "indicateurs_mobilite.parquet")
  skip_if_not(file.exists(payload), "le Parquet Mobilité conservé est absent")

  sortie <- tempfile("verrou-raccordement-")
  dir.create(sortie)
  on.exit(unlink(sortie, recursive = TRUE), add = TRUE)

  # épingles du contrat recopiées telles quelles : le lecteur résout le
  # répertoire vers l'enveloppe, puis recompute depuis la matrice épinglée.
  file.copy(chemin_artefact_raccordement_national(),
            file.path(sortie, RACCORDEMENT_NATIONAL_ENVELOPPE_FICHIER))
  file.copy(chemin_matrice_raccordement_national(),
            file.path(sortie, RACCORDEMENT_NATIONAL_MATRICE_FICHIER))

  expect_invisible(verifier_raccordement_reel(sortie, payload))
})
