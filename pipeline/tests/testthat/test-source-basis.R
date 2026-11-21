# Base de vintage déclarée par source (issue #1103) -----------------------------
# Chaque source de CHAQUE MANIFEST_* déclare exactement UNE base, choisie dans
# le vocabulaire fermé. Aucun défaut implicite : une source nouvelle sans
# déclaration fait échouer ce contrat (et le chargement du package).

test_that("chaque source de chaque MANIFEST_* déclare une base valide", {
  manifestes <- tous_manifestes()
  expect_true(length(manifestes) >= 30L)
  for (nom in names(manifestes)) {
    m <- manifestes[[nom]]
    expect_true("vintage_basis" %in% names(m), info = nom)
    expect_false(anyNA(m$vintage_basis), info = nom)
    expect_false(any(!as.character(m$vintage_basis) %in% BASIS_VINTAGE), info = nom)
    # Exactement UNE valeur par source (pas de liste, pas de vecteur multiple).
    expect_type(m$vintage_basis, "character")
  }
})

test_that("le registre couvre toutes les sources sans base implicite", {
  ids <- unique(unlist(lapply(tous_manifestes(), function(m) as.character(m$id))))
  expect_setequal(ids, names(VINTAGE_BASIS_PAR_ID))
  expect_true(all(VINTAGE_BASIS_PAR_ID %in% BASIS_VINTAGE))
  # Les anciens libellés n'existent plus nulle part (pas de littéral périmé).
  expect_false(any(grepl("fichier_date|contenu_date_maj",
                        unlist(VINTAGE_BASIS_PAR_ID), fixed = FALSE)))
  expect_setequal(BASIS_VINTAGE,
                  c("declaree", "contenu_date", "contenu_timestamp", "telechargement"))
})

test_that("les sources partagées n'ont qu'une seule base", {
  m <- tous_manifestes()
  paires <- unique(unlist(lapply(m, function(x) {
    data.frame(id = as.character(x$id), base = as.character(x$vintage_basis))
  }), recursive = FALSE))
  for (id in unique(paires$id)) {
    expect_length(unique(paires$base[paires$id == id]), 1L, info = id)
  }
})

test_that("les publications millésimées gardent leur base declaree", {
  b <- VINTAGE_BASIS_PAR_ID
  # RP 2023, DVF 2025, BPE 2025, les années OCS-GE : VINTAGE DÉCLARÉE.
  expect_equal(b[["serie_historique"]], "declaree")
  expect_equal(b[["rp_emploi"]], "declaree")
  expect_equal(b[["bpe_b316"]], "declaree")
  expect_equal(b[["dvf_2025_dep22"]], "declaree")
  expect_equal(b[["dvf_2025_dep56"]], "declaree")
  expect_equal(b[["ocsge_artificialisation_22_2021"]], "declaree")
  expect_equal(b[["ocsge_artificialisation_22_2025"]], "declaree")
  expect_equal(b[["ocsge_patch_correctif_29"]], "declaree")
  expect_equal(b[["ocsge_reseaux_35_2023"]], "declaree")
})

test_that("les exports roulants ont une base telechargement honnête", {
  b <- VINTAGE_BASIS_PAR_ID
  pour_telechargement <- c(
    "sirene_snapshot", "korrigo", "sncf_voyageurs", "dila_bdl",
    "dpe_22", "dpe_29", "dpe_35", "dpe_56",
    "territoires_industrie", "ort", "subventions_scdl", "communes_limites"
  )
  for (id in pour_telechargement) {
    expect_equal(b[[id]], "telechargement", info = id)
  }
})

test_that("les deux sources à contenu daté gardent leur base dérivée", {
  expect_equal(VINTAGE_BASIS_PAR_ID[["osm_reseaux"]], "contenu_timestamp")
  expect_equal(VINTAGE_BASIS_PAR_ID[["bornes-recharges"]], "contenu_date")
})
