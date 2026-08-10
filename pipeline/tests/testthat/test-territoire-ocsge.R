# test-territoire-ocsge --------------------------------------------------------
# Le câblage territorial des valeurs OCS-GE (issue #237, spec #225, amendé par
# #243) : les états d'artificialisation par commune (ingestion #234 —
# désormais le produit millésimé « surfaces artificialisées », le DIFF est
# sorti) entrent dans la table des territoires à CHAQUE niveau — commune = ses
# propres valeurs, EPCI / département / région = la somme naïve des membres,
# NA PROPAGÉ (une commune sans donnée rend son niveau NA, jamais un 0
# inventé). flux_net a QUITTÉ la table (l'amendement #243 : la couche
# différentielle n'est pas un état). La fenêtre `periode_artif` d'un territoire
# dérive de LA DONNÉE — les couples (département -> millésimes OCS-GE)
# distincts de ses membres : un territoire mono-département dit son couple
# simplement (« 2021-2025 »), un EPCI transfrontalier dit le SPAN (« 2020-2023
# (35) · 2022-2024 (56) », trié par code de département), la région dit ses
# quatre fenêtres. Les dénominateurs de population (les millésimes RP 2017/2023
# de la série historique) restent INTACTS — les millésimes OCS-GE sont portés
# sous LEUR PROPRE NOM (millesime_ocsge_debut/fin, la collision de noms résolue
# à la construction). Le raccord se fait dans construire_donnees_milieux quand
# les archives OCS-GE sont présentes dans le cache ; archives absentes -> la
# table de base inchangée (le chemin rétro-compatible, les tests existants
# continuent de passer).
#
# Depuis l'amendement #243, CHAQUE commune du fixture porte SES états (le
# produit millésimé couvre tout le département) : les valeurs par commune, en
# m² (vérifiées à la main sur les polygones de
# polygones_etat_ocsge_territoire) —
#   22001 : 400 -> 1200 (22, 2021/2025)   35001 : 400 -> 400 (35, 2020/2023)
#   22002 : 400 -> 800  (22, 2021/2025)   56001 : 800 -> 600 (56, 2022/2024)
#   29001 : 800 -> 1200 (29, 2021/2024)   29003 : 500 -> 700 (29, 2021/2024)
#   29002 : 800 -> 800  (29, 2021/2024)
#
# La table des territoires porte les valeurs en m² — l'unité native de
# l'ingestion ; la conversion en hectares se fait au moment de construire le
# payload (ticket #238).

# rattacher_ocsge_communes -----------------------------------------------------

test_that("rattacher_ocsge_communes : les millésimes OCS-GE arrivent SOUS LEUR PROPRE NOM — jamais de collision avec les millésimes RP", {
  communes <- tibble::tibble(
    code = c("22001", "22002"),
    millesime_debut = 2017, millesime_fin = 2023
  )
  ocsge <- tibble::tibble(
    code = c("22001", "22002"),
    artif_m2 = c(400, 400), artif_m3 = c(1200, 800),
    millesime_ocsge_debut = c(2021, 2021),
    millesime_ocsge_fin = c(2025, 2025)
  )
  joint <- rattacher_ocsge_communes(communes, ocsge)

  # les millésimes RP (la population) passent intacts — le piège du ticket
  expect_equal(joint$millesime_debut, c(2017, 2017))
  expect_equal(joint$millesime_fin, c(2023, 2023))
  # les millésimes OCS-GE sont portés SOUS LEUR PROPRE NOM (le builder les
  # nomme dès la construction — plus aucun renommage à la jointure, #243)
  expect_equal(joint$millesime_ocsge_debut, c(2021, 2021))
  expect_equal(joint$millesime_ocsge_fin, c(2025, 2025))
  expect_equal(joint$artif_m2, c(400, 400))
  expect_equal(joint$artif_m3, c(1200, 800))
})

test_that("rattacher_ocsge_communes : une commune absente de la table OCS-GE garde NA, jamais un 0", {
  communes <- tibble::tibble(code = c("22001", "29003"), pop_debut = c(2200, 500))
  ocsge <- tibble::tibble(
    code = "22001", artif_m2 = 400, artif_m3 = 1200,
    millesime_ocsge_debut = 2021, millesime_ocsge_fin = 2025
  )
  joint <- rattacher_ocsge_communes(communes, ocsge)

  ligne <- joint[joint$code == "29003", ]
  expect_true(is.na(ligne$artif_m2))
  expect_true(is.na(ligne$artif_m3))
  expect_true(is.na(ligne$millesime_ocsge_debut))
  expect_true(is.na(ligne$millesime_ocsge_fin))
})

# construire_periode_artif -----------------------------------------------------

test_that("construire_periode_artif : un couple unique se dit simplement, sans département", {
  expect_equal(
    construire_periode_artif(c("22", "22"), c(2021, 2021), c(2025, 2025)),
    "2021-2025"
  )
})

test_that("construire_periode_artif : plusieurs couples = le span avec les départements, triés par code de département", {
  expect_equal(
    construire_periode_artif(c("56", "35"), c(2022, 2020), c(2024, 2023)),
    "2020-2023 (35) · 2022-2024 (56)"
  )
  # la région : les quatre couples, triés 22/29/35/56 — jamais un ordre inventé
  expect_equal(
    construire_periode_artif(
      c("35", "56", "22", "29"),
      c(2020, 2022, 2021, 2021),
      c(2023, 2024, 2025, 2024)
    ),
    "2021-2025 (22) · 2021-2024 (29) · 2020-2023 (35) · 2022-2024 (56)"
  )
})

test_that("construire_periode_artif : aucun membre porteur de donnée -> NA", {
  expect_true(is.na(
    construire_periode_artif(c("22", "29"), c(NA_real_, NA_real_),
                            c(NA_real_, NA_real_))
  ))
  # un membre porteur de donnée suffit — un autre sans donnée n'ajoute rien
  expect_equal(
    construire_periode_artif(c("22", "29"), c(NA_real_, 2021), c(NA_real_, 2024)),
    "2021-2024"
  )
})

# Le câblage complet sur le fixture --------------------------------------------

test_that("les communes portent LEURS propres valeurs (mono-département), des STOCKS jamais des flux", {
  communes <- communes_fixture_milieux_ocsge()
  territoires <- construire_territoires_milieux(communes)

  t <- function(code) territoires[territoires$code == code, ]
  # 22001 : l'état initial 400 m² + le polygone entier à l'état final (400 m²)
  # + la moitié du polygone qui traverse la frontière 22001|22002 (800 m²) —
  # la fenêtre du 22, dérivée de la donnée
  expect_equal(t("22001")$artif_m2, 400)
  expect_equal(t("22001")$artif_m3, 1200)
  expect_equal(t("22001")$periode_artif, "2021-2025")
  # 22002 : 400 -> 800 (la moitié du polygone qui traverse)
  expect_equal(t("22002")$artif_m2, 400)
  expect_equal(t("22002")$artif_m3, 800)
  expect_equal(t("22002")$periode_artif, "2021-2025")
  # 29001 : les valeurs de SON département (29 : 2021/2024), jamais celles du 22
  expect_equal(t("29001")$artif_m2, 800)
  expect_equal(t("29001")$artif_m3, 1200)
  expect_equal(t("29001")$periode_artif, "2021-2024")
  # 29002 : 800 -> 800 (la moitié du polygone qui traverse)
  expect_equal(t("29002")$artif_m2, 800)
  expect_equal(t("29002")$artif_m3, 800)
  expect_equal(t("29002")$periode_artif, "2021-2024")
  # 29003 porte SES états (le produit millésimé couvre tout le département) :
  # 500 -> 700, jamais NA
  expect_equal(t("29003")$artif_m2, 500)
  expect_equal(t("29003")$artif_m3, 700)
  expect_equal(t("29003")$periode_artif, "2021-2024")
  # 35001 : sa fenêtre (35 : 2020/2023)
  expect_equal(t("35001")$artif_m2, 400)
  expect_equal(t("35001")$artif_m3, 400)
  expect_equal(t("35001")$periode_artif, "2020-2023")
  # 56001 : la renaturation MESURÉE — l'état DIMINUE (800 -> 600), les deux
  # états strictement positifs (un stock n'est jamais 0)
  expect_equal(t("56001")$artif_m2, 800)
  expect_equal(t("56001")$artif_m3, 600)
  expect_equal(t("56001")$periode_artif, "2022-2024")
  # flux_net a QUITTÉ la table (le DIFF est sorti — amendement #243)
  expect_false("flux_net" %in% names(territoires))
})

test_that("les agrégats : EPCI/département/région = la SOMME naïve des membres, NA propagé au niveau", {
  territoires <- construire_territoires_milieux(communes_fixture_milieux_ocsge())
  t <- function(code) territoires[territoires$code == code, ]

  # EPCI X (mono-département 22) : 22001 + 22002
  expect_equal(t("200000001")$artif_m2, 400 + 400)
  expect_equal(t("200000001")$artif_m3, 1200 + 800)
  # le département 22 suit ses communes
  expect_equal(t("22")$artif_m2, 800)
  expect_equal(t("22")$artif_m3, 2000)
  # EPCI Y : 29001 + 29002 + 29003 (toutes portent leurs états)
  expect_equal(t("200000002")$artif_m2, 800 + 800 + 500)
  expect_equal(t("200000002")$artif_m3, 1200 + 800 + 700)
  # le département 29 suit ses communes
  expect_equal(t("29")$artif_m2, 2100)
  expect_equal(t("29")$artif_m3, 2700)
  # EPCI Z (transfrontalier 35+56) : la somme des deux membres
  expect_equal(t("200000003")$artif_m2, 400 + 800)
  expect_equal(t("200000003")$artif_m3, 400 + 600)
  # la région : les sept communes
  expect_equal(t("53")$artif_m2, 400 + 400 + 800 + 800 + 500 + 400 + 800)
  expect_equal(t("53")$artif_m3, 1200 + 800 + 1200 + 800 + 700 + 400 + 600)
})

test_that("periode_artif : la fenêtre dérive de la DONNÉE — le couple du département, le SPAN pour le transfrontalier, les quatre fenêtres pour la région", {
  territoires <- construire_territoires_milieux(communes_fixture_milieux_ocsge())
  t <- function(code) territoires[territoires$code == code, ]

  # mono-département : le couple se dit simplement, sans parenthèses
  expect_equal(t("200000001")$periode_artif, "2021-2025")  # EPCI X
  expect_equal(t("200000002")$periode_artif, "2021-2024")  # EPCI Y
  expect_equal(t("22")$periode_artif, "2021-2025")
  expect_equal(t("29")$periode_artif, "2021-2024")
  expect_equal(t("35")$periode_artif, "2020-2023")
  expect_equal(t("56")$periode_artif, "2022-2024")
  # EPCI transfrontalier : le SPAN avec les dates par département, trié par code
  expect_equal(t("200000003")$periode_artif, "2020-2023 (35) · 2022-2024 (56)")
  # la région : SES QUATRE fenêtres, triées par code de département
  expect_equal(t("53")$periode_artif,
               "2021-2025 (22) · 2021-2024 (29) · 2020-2023 (35) · 2022-2024 (56)")
})

test_that("les dénominateurs de population (RP 2017/2023) restent INTACTS — jamais les millésimes OCS-GE à leur place", {
  territoires <- construire_territoires_milieux(communes_fixture_milieux_ocsge())

  # la fenêtre de population : les deux millésimes RP de la série historique,
  # constants du run (2017-2023), portés tels quels à chaque niveau
  expect_equal(unique(territoires$millesime_debut), 2017)
  expect_equal(unique(territoires$millesime_fin), 2023)
  expect_true(!"millesime_debut_ocsge" %in% names(territoires))
  # les populations par niveau restent les sommes de la série (22001 : 2400)
  t <- function(code) territoires[territoires$code == code, ]
  expect_equal(t("22001")$pop_fin, 2400)
  expect_equal(t("200000001")$pop_fin, 2400 + 1300)
})

# Le raccord dans construire_donnees_milieux -----------------------------------

test_that("construire_donnees_milieux : les archives OCS-GE présentes dans le cache -> la table des communes porte les états", {
  cache <- cache_ocsge_milieux()
  on.exit(unlink(cache, recursive = TRUE))
  communes <- communes_fixture_milieux_ocsge(cache = cache)

  # les colonnes OCS-GE sont portées par la table des communes
  expect_true(all(c("artif_m2", "artif_m3",
                    "millesime_ocsge_debut", "millesime_ocsge_fin") %in%
                    names(communes)))
  expect_false("flux_net" %in% names(communes))
  expect_equal(nrow(communes), 7L)
  # chaque commune porte SES états (le produit millésimé couvre le département)
  expect_equal(communes$artif_m3[communes$code == "29003"], 700)
  # une commune du 35 porte SA fenêtre (2020/2023) sous le nom renommé
  expect_equal(communes$millesime_ocsge_debut[communes$code == "35001"], 2020)
  expect_equal(communes$millesime_ocsge_fin[communes$code == "35001"], 2023)
  # les millésimes RP de la population restent ceux de la série historique
  expect_equal(unique(communes$millesime_debut), 2017)
  expect_equal(unique(communes$millesime_fin), 2023)
})

test_that("chemin rétro-compatible : les archives OCS-GE ABSENTES du cache -> la table de base inchangée", {
  communes <- communes_fixture_milieux()

  # la base du fixture sans OCS-GE ne porte AUCUNE colonne d'état
  expect_false(any(c("artif_m2", "artif_m3") %in% names(communes)))
  expect_false("periode_artif" %in% names(construire_territoires_milieux(communes)))
  # les colonnes du thème sont intactes — le contrat d'avant #237
  expect_true(all(c("code", "departement", "epci", "conso_fenetre",
                    "pop_debut", "pop_fin", "millesime_debut", "millesime_fin") %in%
                    names(communes)))
  # et le territoire agrégé reste le squelette d'avant (5 communes + 2 EPCIs +
  # 2 départements + la région)
  territoires <- construire_territoires_milieux(communes)
  expect_equal(nrow(territoires), 10L)
})

test_that("construire_donnees_milieux : des archives présentes SANS le référentiel communes_limites.geojson échouent bruyamment (jamais un silence)", {
  cache <- cache_ocsge_milieux()
  on.exit(unlink(cache, recursive = TRUE))
  unlink(file.path(cache, "communes_limites.geojson"))

  local_mocked_bindings(lire_epci = function(chemin) base_epci_milieux_ocsge,
                        .package = "lusk")
  expect_error(
    construire_donnees_milieux(cache = cache, sortie = tempfile(fileext = ".rds")),
    "communes_limites"
  )
})

# L'alignement COG 2025 (amendement #243) --------------------------------------
# La géométrie d'intersection (communes_limites.geojson, Admin Express) doit
# être à l'édition 01/01/2025 de la base. Une édition différente (des codes du
# référentiel absents de la base — une commune fusionnée portée sous son
# ancien code) est TRADUITE via passage_cog (#227) et RE-SOMMÉE avant la
# jointure ; sans table de passage, jamais une NA silencieuse : l'échec est
# bruyant.

test_that("l'alignement COG 2025 : une édition plus ancienne du référentiel est traduite via passage_cog et re-sommée", {
  cache <- cache_ocsge_milieux()
  on.exit(unlink(cache, recursive = TRUE))

  # le référentiel du cache porte 22002 sous son ANCIEN code (22999 — une
  # fusion 22999 -> 22002 entre les millésimes OCS-GE et la base) : l'édition
  # diffère de la base (22002), les codes doivent être traduits.
  unlink(file.path(cache, "communes_limites.geojson"))
  geom_22001 <- sf::st_polygon(list(polygone_rectangle(0, 0, 100, 100)))
  geom_22999 <- sf::st_polygon(list(polygone_rectangle(100, 0, 200, 100)))
  sf::st_write(
    sf::st_sf(
      code_insee = c("22001", "22999"),
      code_insee_du_departement = c("22", "22"),
      geometry = sf::st_sfc(list(geom_22001, geom_22999), crs = 2154)
    ),
    file.path(cache, "communes_limites.geojson"), quiet = TRUE
  )
  # la table de passage du cache (un zip de forme valide — le lecteur du xlsx
  # est mocké, la convention du pipeline) : 22999 -> 22002 (la fusion), 22001
  # -> 22001 (l'identité)
  writeLines("pas un zip réel", file.path(cache, "table_passage_annuelle_2025.zip"))
  local_mocked_bindings(
    lire_epci = function(chemin) base_epci_milieux_ocsge,
    lire_table_passage = function(chemin) tibble::tribble(
      ~CODGEO_2022, ~CODGEO_2025, ~LIBGEO_2025,
      "22999", "22002", "Commune D",
      "22001", "22001", "Commune A1"
    ),
    .package = "lusk"
  )

  communes <- construire_donnees_milieux(cache = cache,
                                         sortie = tempfile(fileext = ".rds"))

  # la fusion est ABSORBÉE : 22002 porte les états des polygones de 22999
  # (l'archive 22 les agrège sous le code traduit — la re-somme avant la
  # jointure), jamais NA
  expect_equal(communes$artif_m2[communes$code == "22002"], 400)
  expect_equal(communes$artif_m3[communes$code == "22002"], 800)
  expect_equal(communes$artif_m2[communes$code == "22001"], 400)
  expect_equal(communes$artif_m3[communes$code == "22001"], 1200)
})

test_that("l'alignement COG 2025 : une édition différente SANS table de passage échoue bruyamment (jamais une NA silencieuse)", {
  cache <- cache_ocsge_milieux()
  on.exit(unlink(cache, recursive = TRUE))

  # le référentiel du cache porte un code hors base (22999) et AUCUNE table de
  # passage : la traduction est impossible — l'échec est bruyant, jamais une
  # commune NA publiée
  unlink(file.path(cache, "communes_limites.geojson"))
  geom_22001 <- sf::st_polygon(list(polygone_rectangle(0, 0, 100, 100)))
  geom_22999 <- sf::st_polygon(list(polygone_rectangle(100, 0, 200, 100)))
  sf::st_write(
    sf::st_sf(
      code_insee = c("22001", "22999"),
      code_insee_du_departement = c("22", "22"),
      geometry = sf::st_sfc(list(geom_22001, geom_22999), crs = 2154)
    ),
    file.path(cache, "communes_limites.geojson"), quiet = TRUE
  )

  local_mocked_bindings(lire_epci = function(chemin) base_epci_milieux_ocsge,
                        .package = "lusk")
  expect_error(
    construire_donnees_milieux(cache = cache, sortie = tempfile(fileext = ".rds")),
    "table de passage"
  )
})
