# test-verrou-raccordement --------------------------------------------------------
# Le VERROU « données réelles » du raccordement. NOUVEAUX verrous du modèle
# SORTANT arrêt-à-arrêt GTFS (#728) : couverture dorée aux quatre niveaux,
# ancres de communes couvrant l'étendue des parts @90 + médiane et points de
# courbe — ils REMPLACENT les ancres mairie-à-mairie retirées (le run #485), qui
# ne décrivent plus le modèle publié.
#
# Le verrou est DÉRIVÉ, pas lu sur une épingle figée : il rejoue d'abord le
# calcul depuis les entrées du cache (COG zip + référentiel EPCI extrait) dans
# un répertoire temporaire, puis il y recopie les épingles du modèle publié et
# n'ASSERTE qu'après cette recomputation. Le lecteur normalise le répertoire à
# la frontière (#1070). Le bloc saute proprement sans le cache réel ni le
# Parquet conservé (CI froide) ; sur le desktop il rejoue via la cible
# verif_mobilite_raccordement du graphe, pilotée par la fraîcheur de l'épingle.

test_that("verrou raccordement : les sorties réelles passent couverture, domaines, estampilles et ancres", {
  racine <- pkgload::pkg_path()
  zip_cog <- file.path(racine, "data", "raw", "table_passage_annuelle_2025.zip")
  base_epci <- file.path(racine, "data", "raw", "extracted",
                         "EPCI_au_01-01-2025.xlsx")
  payload <- file.path(racine, "public", "data",
                       "indicateurs_mobilite.parquet")
  skip_if_not(file.exists(zip_cog), "le cache des données réelles n'est pas présent")
  skip_if_not(file.exists(base_epci), "le référentiel EPCI extrait n'est pas présent")
  skip_if_not(file.exists(payload), "le Parquet Mobilité conservé est absent")

  sortie <- tempfile("verrou-raccordement-")
  dir.create(sortie)
  on.exit(unlink(sortie, recursive = TRUE), add = TRUE)

  # 1. DÉRIVATION depuis les entrées épinglées du cache : le calcul historique
  # est rejoué (COG + EPCI), jamais une lecture d'artefact pré-fabriqué.
  preparer_raccordement(zip_cog = zip_cog, chemin_base_epci = base_epci,
                        sortie = sortie)
  expect_true(file.exists(file.path(sortie, RACCORDEMENT_ARTEFACT)))

  # 2. Le modèle PUBLIÉ est recomputé depuis SES propres épingles, recopiées
  # dans le même répertoire temporaire — le lecteur y résout l'enveloppe.
  file.copy(chemin_artefact_raccordement_national(),
            file.path(sortie, RACCORDEMENT_NATIONAL_ENVELOPPE_FICHIER))
  file.copy(chemin_matrice_raccordement_national(),
            file.path(sortie, RACCORDEMENT_NATIONAL_MATRICE_FICHIER))

  # 3. seulement maintenant : assertion sur les sorties dérivées
  expect_invisible(verifier_raccordement_reel(sortie, payload))
})
