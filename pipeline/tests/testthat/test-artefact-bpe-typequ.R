test_that("le registre BPE épinglé est complet et contractuel", {
  registre <- lire_correspondances_typequ()

  expect_equal(nrow(registre), 53L)
  expect_named(registre, BPE_TYPEQU_COLONNES)
  expect_equal(length(unique(registre$TYPEQU)), 53L)
  expect_silent(verifier_contrat_bpe_typequ(registre,
                                             codes_attendus = registre$TYPEQU))
})

fixture_snapshot_bpe <- function() {
  registre <- lire_correspondances_typequ()
  snapshot <- tibble::tibble(commune = c("22001", "22002"))
  suffixes <- c("", "_epci", "_dep", "_reg")
  for (code in registre$TYPEQU) {
    for (suffixe in suffixes) {
      for (mode in c("c", "b", "t")) {
        snapshot[[paste0("has_", code, "_", mode, suffixe, "_raw")]] <-
          c("0.10", "0.10")
      }
    }
  }
  # Un cas par profil, identique aux quatre niveaux pour rester une fixture
  # simple ; les tests de divergence couvrent séparément la garde d'agrégat.
  for (suffixe in suffixes) {
    snapshot[[paste0("has_A128_t", suffixe, "_raw")]] <- c("0.30", "0.30")
    snapshot[[paste0("has_A129_c", suffixe, "_raw")]] <- c("0.30", "0.30")
    snapshot[[paste0("has_A203_b", suffixe, "_raw")]] <- c("0.30", "0.30")
  }
  snapshot
}

base_epci_bpe <- tibble::tibble(
  CODGEO = c("22001", "22002"),
  EPCI = c("200000001", "200000001"),
  DEP = c("22", "22"),
  REG = c("53", "53")
)

test_that("la matrice BPE porte les 4 niveaux, le triptyque et le profil", {
  matrice <- construire_matrice_profils_acces_bpe(
    fixture_snapshot_bpe(), base_epci_bpe
  )

  expect_equal(nrow(matrice), 5L * 53L)
  expect_named(matrice, CLES_PROFILS_ACCES_BPE)
  expect_equal(
    sort(unique(matrice$type)),
    sort(c("commune", "epci", "departement", "region"))
  )
  expect_equal(
    matrice$profil[matrice$territoire == "22001" & matrice$typequ == "A128"][[1L]],
    "acces-pied-tc"
  )
  expect_equal(
    matrice$profil[matrice$territoire == "22001" & matrice$typequ == "A129"][[1L]],
    "voiture-requise"
  )
  expect_equal(
    matrice$profil[matrice$territoire == "22001" & matrice$typequ == "A203"][[1L]],
    "velo-compense"
  )
  expect_equal(
    matrice$profil[matrice$territoire == "22001" & matrice$typequ == "A206"][[1L]],
    "inaccessible-20-minutes"
  )
})

test_that("une divergence d'une valeur agrégée arrête la matrice", {
  snapshot <- fixture_snapshot_bpe()
  snapshot$has_A128_t_epci_raw[[2L]] <- "0.31"

  expect_error(
    construire_matrice_profils_acces_bpe(snapshot, base_epci_bpe),
    "valeurs « t » divergentes"
  )
})

test_that("la projection est bornée et choisit l'exemplaire rare puis le code", {
  matrice <- construire_matrice_profils_acces_bpe(
    fixture_snapshot_bpe(), base_epci_bpe
  )
  projection <- construire_projection_profils_acces_bpe(matrice)

  expect_named(projection, CLES_PROJECTION_PROFILS_ACCES_BPE)
  expect_silent(verifier_contrat_projection_profils_acces_bpe(projection))
  expect_equal(anyDuplicated(projection[c("territoire", "type", "profil")]), 0L)
  expect_equal(
    projection$nombre_typequ[
      projection$territoire == "22001" & projection$type == "commune" &
        projection$profil == "inaccessible-20-minutes"
    ],
    50L
  )
  expect_equal(
    projection$exemplar_typequ[
      projection$territoire == "22001" & projection$type == "commune" &
        projection$profil == "inaccessible-20-minutes"
    ],
    "A206"
  )
  expect_true(all(projection$nombre_typequ >= 1L))
})

test_that("un univers de codes snapshot incomplet est refusé", {
  snapshot <- fixture_snapshot_bpe()
  snapshot <- snapshot[setdiff(names(snapshot), "has_F307_t_reg_raw")]

  expect_error(
    construire_matrice_profils_acces_bpe(snapshot, base_epci_bpe),
    "colonne"
  )
})
