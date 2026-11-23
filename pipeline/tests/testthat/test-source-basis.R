# Base de vintage déclarée par source (issue #1103) -----------------------------
# Chaque source de CHAQUE MANIFEST_* déclare exactement UNE base, choisie dans
# le vocabulaire fermé. Aucun défaut implicite : une source nouvelle sans
# déclaration fait échouer ce contrat (et le chargement du package).

test_that("chaque id de chaque MANIFEST_* résout vers une base valide", {
  manifestes <- tous_manifestes()
  expect_true(length(manifestes) >= 30L)
  for (nom in names(manifestes)) {
    m <- manifestes[[nom]]
    # Pas de mutation au chargement : la base est résolue au point d'usage.
    bases <- vapply(as.character(m$id), base_vintage, character(1))
    expect_false(anyNA(bases), info = nom)
    expect_true(all(bases %in% BASIS_VINTAGE), info = nom)
    # Le manifeste déclaré au point d'usage est cohérent avec le registre.
    expect_identical(declarer_bases(m)$vintage_basis, unname(bases), info = nom)
  }
})

test_that("base_vintage échoue bruyamment sur un id inconnu", {
  expect_error(base_vintage("source_inexistante"), "Aucune base de vintage")
})

test_that("base_vintage résout aussi les lectures réseau non-manifeste (#1122)", {
  for (id in names(LECTURES_RESEAU)) {
    expect_identical(base_vintage(id), "telechargement", info = id)
  }
})

test_that("les deux registres ne se chevauchent pas et couvrent tout digest (#1122)", {
  expect_length(intersect(names(VINTAGE_BASIS_PAR_ID), names(LECTURES_RESEAU)), 0L)
  manifestes <- tous_manifestes()
  ids <- ids_digests_publication(manifestes = unname(manifestes))
  expect_setequal(
    ids,
    unique(c(unlist(lapply(manifestes, function(m) as.character(m$id))),
             names(LECTURES_RESEAU)))
  )
  bases <- vapply(ids, base_vintage, character(1))
  expect_false(anyNA(bases))
  expect_true(all(bases %in% BASIS_VINTAGE))
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
  ids <- unique(unlist(lapply(tous_manifestes(), function(x) as.character(x$id))))
  bases <- vapply(ids, base_vintage, character(1))
  expect_length(unique(names(bases)), length(ids))
  expect_true(all(bases %in% BASIS_VINTAGE))
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
  # #1128 : SIRENE est un snapshot MENSUEL — la coupe déclarée (2026-10) est
  # sa vintage, pas le mois d'acquisition. Le relock #1105 l'avait dérivée en
  # "2026-11", publiant une vintage fausse (test-manifest-economie-sirene).
  expect_equal(b[["sirene_snapshot"]], "declaree")
})

test_that("les exports roulants ont une base telechargement honnête", {
  b <- VINTAGE_BASIS_PAR_ID
  pour_telechargement <- c(
    "korrigo", "sncf_voyageurs", "dila_bdl",
    "dpe_22", "dpe_29", "dpe_35", "dpe_56",
    "territoires_industrie", "subventions_scdl", "communes_limites"
  )
  for (id in pour_telechargement) {
    expect_equal(b[[id]], "telechargement", info = id)
  }
})

test_that("les sources à contenu daté gardent leur base dérivée", {
  expect_equal(VINTAGE_BASIS_PAR_ID[["osm_reseaux"]], "contenu_timestamp")
  expect_equal(VINTAGE_BASIS_PAR_ID[["bornes-recharges"]], "contenu_date")
  # Décision #1113 : l'ORT porte sa propre date de contenu (actualisation par
  # ligne) — sa base est `contenu_date`, jamais `telechargement`.
  expect_equal(VINTAGE_BASIS_PAR_ID[["ort"]], "contenu_date")
})

test_that("chaque source contenu_date a un extracteur enregistré (contrat #1113)", {
  ids <- unique(unlist(lapply(tous_manifestes(), function(m) as.character(m$id))))
  contenu_date <- ids[vapply(ids, base_vintage, character(1)) == "contenu_date"]
  expect_true("ort" %in% contenu_date)
  # le registre des extracteurs couvre EXACTEMENT les sources contenu_date :
  # aucune source ne peut déclarer cette base sans extracteur (et inversement).
  expect_setequal(contenu_date, names(CONTENT_DATE_EXTRACTOR_PAR_ID))
  for (id in contenu_date) {
    expect_true(is.function(extracteur_date_contenu(id)), info = id)
  }
  expect_error(extracteur_date_contenu("source_sans_extracteur"),
               "Aucun extracteur de date de contenu")
})
