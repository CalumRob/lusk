# test-passage-cog ------------------------------------------------------------
# Le composant partagé « passage COG » (issue #222, ticket #227) : la table de
# passage INSEE 2022 → 2025 — la discipline que l'issue supposait existante
# mais qui n'existait pas (le pipeline n'a que des gardes de FORMAT COG, jamais
# de table millésime-à-millésime). Trois pièces :
#   - le fragment `cog_passage` du manifeste Mobilité (la source partagée —
#     le même pattern que la base EPCI partagée de Milieux) : le zip INSEE
#     « table_passage_annuelle_2025 » (Licence Ouverte 2.0, mise à jour
#     annuelle, COG 2025), la feuille COM (une ligne par commune de la
#     géographie 2025, CODGEO_<année> = le code de la commune dans chaque
#     millésime — vérifié sur le fichier réel : 36 760 lignes, 47 colonnes) ;
#   - construire_passage_cog : la table WIDE (CODGEO_2022 → CODGEO_2025) vers
#     la table LONG de passage (code_2022, code_2025), dédupliquée des lignes
#     identité (Plumieux → Plumieux), triée — déterministe. Garde : un code
#     2022 qui mappe vers PLUSIEURS codes 2025 (une scission) est une
#     corruption, jamais un choix silencieux.
#   - passage_cog : applique la table de passage à un vecteur de codes ;
#     l'identité passe (un code inchangé entre millésimes), un code non mappé
#     s'arrête bruyamment en nommant le code fautif — jamais une NA silencieuse.
# Les tests portent la FORME RÉELLE : la fusion vérifiée Le Cambout (22027) +
# Coëtlogon (22043) → Plumieux (22241), l'identité Plumieux → Plumieux, et le
# cas corrompu (un code qui disparaît des deux côtés). Les fixtures sont
# construites inline (la convention du pipeline — jamais le réseau dans la
# boucle de test).

# MANIFEST_MOBILITE : le fragment cog_passage ----------------------------------

test_that("MANIFEST_MOBILITE : le fragment cog_passage — la table de passage INSEE partagée", {
  cog <- MANIFEST_MOBILITE[MANIFEST_MOBILITE$id == "cog_passage", ]

  expect_equal(nrow(cog), 1L)
  expect_equal(cog$fichier, "table_passage_annuelle_2025.zip")
  expect_equal(cog$vintage, "2025")
  expect_equal(cog$licence, "lov2")
  expect_equal(cog$mode, "cron")
  expect_equal(cog$type, "fichier")
  # la référence est le millésime (2025-01-01) ; la publication postérieure ou
  # égale à la référence — la discipline des dates du manifeste
  expect_false(is.na(cog$date_reference))
  expect_false(cog$date_publication < cog$date_reference)
})

test_that("verifier_contrat_mobilite_cog_passage : le fragment épinglé, un mauvais fichier échoue", {
  expect_true(verifier_contrat_mobilite_cog_passage(
    MANIFEST_MOBILITE[MANIFEST_MOBILITE$id == "cog_passage", ]))

  # un autre fichier (l'ancien millésime, ou la table 2003-2025 qui ne porte
  # pas la correspondance complète) est hors contrat
  defectueux <- MANIFEST_MOBILITE[MANIFEST_MOBILITE$id == "cog_passage", ]
  defectueux$fichier <- "table_passage_geo2003_geo2025.zip"
  expect_error(verifier_contrat_mobilite_cog_passage(defectueux), "fichier")
  expect_error(verifier_contrat_mobilite_cog_passage(defectueux), "annuelle")
})

# construire_passage_cog -------------------------------------------------------

test_that("construire_passage_cog : la table WIDE → la table LONG dédupliquée (la fusion vérifiée Le Cambout/Coëtlogon → Plumieux)", {
  # la FORME RÉELLE : une ligne par commune 2025, CODGEO_2022 = le code de la
  # commune en 2022 (une fusion = plusieurs lignes, une par ancienne commune)
  wide <- tibble::tribble(
    ~CODGEO_2022, ~CODGEO_2025, ~LIBGEO_2025,
    "22027", "22241", "Plumieux",   # Le Cambout → Plumieux (fusion)
    "22043", "22241", "Plumieux",   # Coëtlogon → Plumieux (fusion)
    "22241", "22241", "Plumieux",   # l'identité (la commune elle-même)
    "22147", "22147", "Merdrignac"  # l'identité
  )

  mappe <- construire_passage_cog(wide)

  expect_s3_class(mappe, "tbl_df")
  expect_named(mappe, c("code_2022", "code_2025"))
  # une ligne par code 2022 distinct (les lignes identité sont dédupliquées)
  expect_equal(nrow(mappe), 4L)
  expect_equal(mappe$code_2022, c("22027", "22043", "22147", "22241"))
  expect_equal(mappe$code_2025, c("22241", "22241", "22147", "22241"))
  expect_equal(mappe$code_2022, sort(mappe$code_2022))  # déterministe
})

test_that("construire_passage_cog : une colonne requise manquante s'arrête bruyamment", {
  expect_error(
    construire_passage_cog(tibble::tibble(CODGEO_2022 = "22027")),
    "CODGEO_2025"
  )
})

test_that("construire_passage_cog : un code 2022 vers PLUSIEURS codes 2025 (scission) est une corruption", {
  # une scission : un code 2022 qui se divise en deux codes 2025 — le mapping
  # serait ambigu, jamais un choix silencieux
  wide <- tibble::tribble(
    ~CODGEO_2022, ~CODGEO_2025,
    "35130", "35130",   # Hédé (scission 2008 vérifiée)
    "35130", "35317"    # Hédé → Saint-Symphorien
  )
  expect_error(construire_passage_cog(wide), "35130")
})

# passage_cog ------------------------------------------------------------------

test_that("passage_cog : la fusion appliquée, l'identité passe", {
  mappe <- tibble::tribble(
    ~code_2022, ~code_2025,
    "22027", "22241",
    "22043", "22241",
    "22241", "22241",
    "22147", "22147"
  )

  resultat <- passage_cog(c("22027", "22241", "22147"), mappe)

  expect_equal(resultat, c("22241", "22241", "22147"))
})

test_that("passage_cog : un code non mappé s'arrête bruyamment en nommant le code", {
  mappe <- tibble::tribble(
    ~code_2022, ~code_2025,
    "22241", "22241"
  )

  expect_error(passage_cog(c("22241", "99999"), mappe), "99999")
  # un code en dehors des codes mappés n'est JAMAIS une NA silencieuse
  expect_error(passage_cog("99999", mappe), "99999")
})

test_that("passage_cog : un vecteur vide reste vide (déterministe)", {
  mappe <- tibble::tribble(
    ~code_2022, ~code_2025,
    "22241", "22241"
  )
  expect_equal(passage_cog(character(0), mappe), character(0))
})

# le fichier RÉEL (données réelles — LUSK_RUN_REAL=1) ---------------------------
# La vérification de bout en bout contre la table INSEE téléchargée dans le
# cache : les fusions bretonnes réelles 2022→2025 (Le Cambout + Coëtlogon →
# Plumieux, vérifiées sur le fichier réel le 2026-08-08), le filtre Bretagne
# AVANT la table de passage (les scissions post-2022 du fichier réel sont
# toutes hors Bretagne — la 15141 Neussargues en Pinatelle est cantalienne —
# et ne doivent jamais atteindre le mapping breton), et passage_cog sur des
# vrais codes Geovelo. Le même motif que la discipline « données réelles » du
# pipeline (helper-donnees-reelles.R).
test_that("données réelles : la table INSEE réelle — les fusions bretonnes mappées, aucune NA", {
  skip_if(Sys.getenv("LUSK_RUN_REAL") != "1",
          "les tests « données réelles » sont désactivés — LUSK_RUN_REAL=1 pour les inclure")

  zip <- "data/raw/table_passage_annuelle_2025.zip"
  extrait <- "data/raw/extracted"
  skip_if(!file.exists(zip), "la source COG n'est pas dans le cache (data/raw)")
  if (!dir.exists(extrait)) dir.create(extrait, recursive = TRUE)
  suppressWarnings(utils::unzip(zip, exdir = extrait, overwrite = TRUE))
  brut <- lire_table_passage(file.path(extrait, "table_passage_annuelle_2025.xlsx"))

  expect_true(all(c("CODGEO_2022", "CODGEO_2025") %in% names(brut)))
  expect_gt(nrow(brut), 30000)

  # le filtre Bretagne AVANT la table de passage — le même ordre que le
  # normaliseur Geovelo (ticket #229)
  bretagne <- brut[grepl("^(22|29|35|56)", brut$CODGEO_2025), ]
  mappe <- construire_passage_cog(bretagne)

  # les fusions réelles vérifiées
  expect_equal(mappe$code_2025[mappe$code_2022 == "22027"], "22241")
  expect_equal(mappe$code_2025[mappe$code_2022 == "22043"], "22241")
  expect_equal(mappe$code_2025[mappe$code_2022 == "22200"], "22237")  # Pléven → Val-d'Arguenon
  expect_equal(mappe$code_2025[mappe$code_2022 == "22309"], "22147")  # Saint-Launeuc → Merdrignac
  expect_equal(mappe$code_2025[mappe$code_2022 == "35112"], "35062")  # Fleurigné → La Chapelle-Fleurigné
  # l'identité passe
  expect_equal(mappe$code_2025[mappe$code_2022 == "22241"], "22241")

  # passage_cog sur des vrais codes Geovelo (COG 2022) : aucune NA, des codes
  # 2025 bretons
  codes_geovelo <- c("22027", "22043", "22241", "22200", "22309", "35112")
  projetes <- passage_cog(codes_geovelo, mappe)
  expect_false(anyNA(projetes))
  expect_true(all(grepl("^(22|29|35|56)", projetes)))
})
