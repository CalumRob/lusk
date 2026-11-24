# Slow tier (#1172): the committed national raccordement artefact and full OD matrix
# protect byte identity, uncapped coverage, the reviewed Combourg journey, and the published golden model.
# Run from pipeline/: Rscript -e "pkgload::load_all('.', quiet=TRUE); testthat::test_file('slow-tests/test-raccordement-national-whole-payload.R', package='lusk')"

test_that("pinned national artifact is byte-verified and contains the uncapped matrix contract", {
  artifact <- lire_artefact_raccordement_national()
  expect_identical(artifact$metadata$schema,
                   "lusk-national-outbound-zero-inclusive-raccordement-candidate-v1")
  expect_identical(artifact$matrix_sha256, MATRICE_RACCORDEMENT_NATIONAL_SHA256)
  expect_equal(nrow(artifact$matrix), 798128L)
  expect_equal(sum(artifact$matrix$reachable), 431327L)
  expect_equal(max(artifact$matrix$travel_time_min[artifact$matrix$reachable]), 693)
  expect_equal(nrow(artifact$membership), 1202L)
  expect_equal(sum(artifact$membership$eligible_first_boarding_origin), 664L)
  expect_equal(sum(!artifact$membership$eligible_first_boarding_origin), 538L)
  expect_identical(artifact$metadata$source_provenance$router_cpp_sha256,
    "f36f09ebedb4d92898ecd2b6ca7b6c4dcdf207b497591e644e6434787732c876")
  expect_identical(artifact$metadata$source_provenance$matrix_rds$sha256,
    MATRICE_RACCORDEMENT_NATIONAL_SHA256)
  rows <- lignes_indicateurs_raccordement_national(artifact$calculation,
                                                    vintages_mobilite())
  expect_equal(sum(rows$key == "raccordement_courbe"), 1268L * 73L)
  expect_equal(sum(rows$key == "raccordement_reference"), 73L)
  model_zero <- rows[rows$key == "raccordement_courbe" & rows$code == "22001", ]
  expect_true(all(model_zero$value == 0))
  expect_true(all(model_zero$rider == "no_modeled_endpoint_stops"))
  expect_true(all(model_zero$observation_period == "2026-10-21"))
})

test_that("the pinned artifact calculates the independently reviewed Combourg journey and curve", {
  artifact <- lire_artefact_raccordement_national()
  combourg_curve <- artifact$calculation$commune_curves[
    artifact$calculation$commune_curves$code == "35085" &
      artifact$calculation$commune_curves$minute == 90, , drop = FALSE
  ]
  saved_journeys <- artifact$matrix[
    artifact$matrix$origin_id == "35085" &
      artifact$matrix$destination_id %in% c("35238", "35288"), , drop = FALSE
  ]
  inbound_to_combourg <- artifact$matrix[
    artifact$matrix$origin_id %in% c("35238", "35288") &
      artifact$matrix$destination_id == "35085", , drop = FALSE
  ]

  expect_equal(combourg_curve$share, 0.315322508168, tolerance = 1e-12)
  expect_equal(saved_journeys$travel_time_min[match("35238", saved_journeys$destination_id)], 19)
  expect_equal(saved_journeys$travel_time_min[match("35288", saved_journeys$destination_id)], 26)
  expect_equal(inbound_to_combourg$travel_time_min[
    match("35238", inbound_to_combourg$origin_id)], 20)
  expect_equal(inbound_to_combourg$travel_time_min[
    match("35288", inbound_to_combourg$origin_id)], 22)
  expect_equal(inbound_to_combourg$departure_min[
    match("35238", inbound_to_combourg$origin_id)], 970)
  expect_equal(inbound_to_combourg$departure_min[
    match("35288", inbound_to_combourg$origin_id)], 518)
  expect_identical(artifact$metadata$method$direction,
    "outbound: from eligible commune origin stops to reachable destination commune stop sets")
})

test_that("national artifact verifier rejects altered bytes and incomplete OD matrix", {
  artifact <- lire_artefact_raccordement_national()
  expect_error(verifier_contrat_artefact_raccordement_national(
    artifact, chemin_matrice = tempfile("missing-matrix-")), "matrix|file|missing")
  bad <- artifact
  bad$matrix <- bad$matrix[-1, ]
  expect_error(verifier_contrat_artefact_raccordement_national(bad, verifier_octets = FALSE),
               "row|coverage|complete")
})

# chemin_enveloppe_raccordement (#1070) ------------------------------------------
# Les verrous « données réelles » reçoivent le chemin rendu par la cible
# raccordement_<thème> : depuis #728 c'est le FICHIER de l'épingle versionnée.
# Le résolveur ne doit JAMAIS joindre un nom de fichier à un fichier.

test_that("les valeurs dorées du modèle publié tiennent à l'artefact épinglé (#1066)", {
  artefact <- lire_artefact_raccordement_national()
  calcul <- artefact$calculation

  # couverture : les littéraux du verrou « données réelles » sont ceux du
  # modèle arrêt-à-arrêt GTFS recomputé depuis l'épingle (73 points).
  lignes <- lignes_indicateurs_raccordement_national(calcul, vintages_mobilite())
  for (cle in names(COUVERTURE_DOREE_RACCORDEMENT)) {
    sub <- lignes[lignes$key == cle, , drop = FALSE]
    obtenu <- c(communes = sum(sub$type == "commune"),
                epcis = sum(sub$type == "epci"),
                departements = sum(sub$type == "departement"),
                region = sum(sub$type == "region"))
    expect_identical(unname(obtenu),
                     unname(COUVERTURE_DOREE_RACCORDEMENT[[cle]]), info = cle)
  }

  # ancres @90, médiane et points de courbe : de nouvelles valeurs dorées qui
  # remplacent les anciennes ancres mairie-à-mairie retirées.
  part_de <- function(code, minute) {
    calcul$commune_curves$share[
      calcul$commune_curves$code == code &
        calcul$commune_curves$minute == minute]
  }
  for (code in names(ANCRE_DOREE_90)) {
    expect_equal(part_de(code, 90L), ANCRE_DOREE_90[[code]],
                 tolerance = 1e-6, info = code)
  }
  expect_equal(median(calcul$commune_scalars$share_90), ANCRE_DOREE_MEDIANE_90,
               tolerance = 1e-9)
  for (code in names(ANCRE_DOREE_COURBE)) {
    for (minute in names(ANCRE_DOREE_COURBE[[code]])) {
      expect_equal(part_de(code, as.integer(minute)),
                   ANCRE_DOREE_COURBE[[code]][[minute]],
                   tolerance = 1e-9, info = paste(code, minute))
    }
  }
})

test_that("le lecteur national lit l'épingle copiée dans un répertoire de sortie (#1070)", {
  sortie <- tempfile("sortie-lecture-raccordement-")
  dir.create(sortie)
  on.exit(unlink(sortie, recursive = TRUE), add = TRUE)

  enveloppe <- file.path(sortie, RACCORDEMENT_NATIONAL_ENVELOPPE_FICHIER)
  matrice <- file.path(sortie, RACCORDEMENT_NATIONAL_MATRICE_FICHIER)
  file.copy(chemin_artefact_raccordement_national(), enveloppe)
  file.copy(chemin_matrice_raccordement_national(), matrice)

  # Le lecteur normalise LUI-MÊME à la frontière : un répertoire OU le fichier
  # rendu par la cible mènent au même artefact. Aucun appelant ne doit refaire
  # la règle du nom de fichier (ni reconstruire le jointure fallacieuse).
  lu_dir <- lire_artefact_raccordement_national(
    chemin_enveloppe = sortie, chemin_matrice = matrice)
  lu_file <- lire_artefact_raccordement_national(
    chemin_enveloppe = enveloppe, chemin_matrice = matrice)
  for (lu in list(lu_dir, lu_file)) {
    expect_identical(lu$envelope_sha256,
                     empreinte_fichier_raccordement(enveloppe))
    expect_identical(lu$matrix_sha256,
                     empreinte_fichier_raccordement(matrice))
  }
})
