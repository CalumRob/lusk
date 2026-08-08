# test-territoire-ocsge --------------------------------------------------------
# Le câblage territorial des valeurs OCS-GE (issue #237, spec #225) : les états
# d'artificialisation par commune (ingestion #234) entrent dans la table des
# territoires à CHAQUE niveau — commune = ses propres valeurs, EPCI /
# département / région = la somme naïve des membres, NA PROPAGÉ (une commune
# sans donnée OCS-GE rend son niveau NA, jamais un 0 inventé). La fenêtre
# `periode_artif` d'un territoire dérive de LA DONNÉE — les couples
# (département -> millésimes OCS-GE) distincts de ses membres : un territoire
# mono-département dit son couple simplement (« 2021-2025 »), un EPCI
# transfrontalier dit le SPAN (« 2020-2023 (35) · 2022-2024 (56) », trié par
# code de département), la région dit ses quatre fenêtres. Les dénominateurs de
# population (les millésimes RP 2017/2023 de la série historique) restent
# INTACTS — les millésimes OCS-GE sont renommés millesime_ocsge_debut/fin avant
# la jointure (la collision de noms est le piège du ticket). Le raccord se fait
# dans construire_donnees_milieux quand les archives OCS-GE sont présentes dans
# le cache ; archives absentes -> la table de base inchangée (le chemin
# rétro-compatible, les tests existants continuent de passer).
#
# La table des territoires porte les valeurs en m² — l'unité native de
# l'ingestion ; la conversion en hectares se fait au moment de construire le
# payload (ticket #238).

# rattacher_ocsge_communes -----------------------------------------------------

test_that("rattacher_ocsge_communes : renomme les millésimes OCS-GE avant la jointure — jamais de collision avec les millésimes RP", {
  communes <- tibble::tibble(
    code = c("22001", "22002"),
    millesime_debut = 2017, millesime_fin = 2023
  )
  ocsge <- tibble::tibble(
    code = c("22001", "22002"),
    artif_m2 = c(0, 0), artif_m3 = c(1200, 800), flux_net = c(1200, 800),
    millesime_debut = c(2021, 2021), millesime_fin = c(2025, 2025)
  )
  joint <- rattacher_ocsge_communes(communes, ocsge)

  # les millésimes RP (la population) passent intacts — le piège du ticket
  expect_equal(joint$millesime_debut, c(2017, 2017))
  expect_equal(joint$millesime_fin, c(2023, 2023))
  # les millésimes OCS-GE sont portés SOUS LEUR PROPRE NOM
  expect_equal(joint$millesime_ocsge_debut, c(2021, 2021))
  expect_equal(joint$millesime_ocsge_fin, c(2025, 2025))
  expect_equal(joint$artif_m2, c(0, 0))
  expect_equal(joint$artif_m3, c(1200, 800))
  expect_equal(joint$flux_net, c(1200, 800))
})

test_that("rattacher_ocsge_communes : une commune absente de la table OCS-GE garde NA, jamais un 0", {
  communes <- tibble::tibble(code = c("22001", "29003"), pop_debut = c(2200, 500))
  ocsge <- tibble::tibble(
    code = "22001", artif_m2 = 0, artif_m3 = 1200, flux_net = 1200,
    millesime_debut = 2021, millesime_fin = 2025
  )
  joint <- rattacher_ocsge_communes(communes, ocsge)

  ligne <- joint[joint$code == "29003", ]
  expect_true(is.na(ligne$artif_m2))
  expect_true(is.na(ligne$artif_m3))
  expect_true(is.na(ligne$flux_net))
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

test_that("les communes portent LEURS propres valeurs (mono-département), et la commune sans donnée porte NA", {
  communes <- communes_fixture_milieux_ocsge()
  territoires <- construire_territoires_milieux(communes)

  t <- function(code) territoires[territoires$code == code, ]
  # 22001 : le polygone entier (400 m²) + la moitié du polygone qui traverse
  # la frontière 22001|22002 (800 m²) — la fenêtre du 22, dérivée de la donnée
  expect_equal(t("22001")$artif_m2, 0)
  expect_equal(t("22001")$artif_m3, 1200)
  expect_equal(t("22001")$flux_net, 1200)
  expect_equal(t("22001")$periode_artif, "2021-2025")
  # 22002 : la moitié du polygone qui traverse (800 m²) — le flux passe signé
  expect_equal(t("22002")$artif_m3, 800)
  expect_equal(t("22002")$periode_artif, "2021-2025")
  # 29001 : les valeurs de SON département (29 : 2021-2024), jamais celles du 22
  expect_equal(t("29001")$artif_m3, 1200)
  expect_equal(t("29001")$periode_artif, "2021-2024")
  # 35001 : sa fenêtre (35 : 2020-2023)
  expect_equal(t("35001")$artif_m3, 400)
  expect_equal(t("35001")$periode_artif, "2020-2023")
  # 56001 : le polygone de DÉSARTIFICIALISATION — m2 porté, m3 nul, flux négatif
  expect_equal(t("56001")$artif_m2, 400)
  expect_equal(t("56001")$artif_m3, 0)
  expect_equal(t("56001")$flux_net, -400)
  expect_equal(t("56001")$periode_artif, "2022-2024")
  # 29003 : SANS donnée OCS-GE -> NA partout, jamais un 0 inventé
  expect_true(is.na(t("29003")$artif_m2))
  expect_true(is.na(t("29003")$artif_m3))
  expect_true(is.na(t("29003")$flux_net))
  expect_true(is.na(t("29003")$periode_artif))
  # l'invariant de la spec : flux_net == artif_m3 - artif_m2, par commune
  expect_equal(territoires$flux_net[territoires$type == "commune"],
               territoires$artif_m3[territoires$type == "commune"] -
                 territoires$artif_m2[territoires$type == "commune"])
})

test_that("les agrégats : EPCI/département/région = la SOMME naïve des membres, NA propagé au niveau", {
  territoires <- construire_territoires_milieux(communes_fixture_milieux_ocsge())
  t <- function(code) territoires[territoires$code == code, ]

  # EPCI X (mono-département 22) : 22001 + 22002
  expect_equal(t("200000001")$artif_m2, 0)
  expect_equal(t("200000001")$artif_m3, 2000)
  expect_equal(t("200000001")$flux_net, 2000)
  # le département 22 suit ses communes
  expect_equal(t("22")$artif_m3, 2000)
  # EPCI Y : 29003 est SANS donnée -> le total de son niveau est NA, JAMAIS un
  # 0 inventé (la somme incomplète n'est pas publiée comme complète)
  expect_true(is.na(t("200000002")$artif_m2))
  expect_true(is.na(t("200000002")$artif_m3))
  expect_true(is.na(t("200000002")$flux_net))
  # le département 29 et la région (qui contiennent 29003) sont NA aussi
  expect_true(is.na(t("29")$artif_m3))
  expect_true(is.na(t("53")$artif_m3))
  # EPCI Z (transfrontalier 35+56) : la somme signée des deux membres — le flux
  # net de 56001 est NÉGATIF, la somme ne fait jamais un abs()
  expect_equal(t("200000003")$artif_m2, 400)
  expect_equal(t("200000003")$artif_m3, 400)
  expect_equal(t("200000003")$flux_net, 0)
  # l'invariant flux_net == artif_m3 - artif_m2 tient aux niveaux agrégés aussi
  expect_equal(territoires$flux_net[territoires$type != "commune"],
               territoires$artif_m3[territoires$type != "commune"] -
                 territoires$artif_m2[territoires$type != "commune"])
})

test_that("periode_artif : la fenêtre dérive de la DONNÉE — le couple du département, le SPAN pour le transfrontalier, les quatre fenêtres pour la région", {
  territoires <- construire_territoires_milieux(communes_fixture_milieux_ocsge())
  t <- function(code) territoires[territoires$code == code, ]

  # mono-département : le couple se dit simplement, sans parenthèses
  expect_equal(t("200000001")$periode_artif, "2021-2025")  # EPCI X
  expect_equal(t("200000002")$periode_artif, "2021-2024")  # EPCI Y (29003 sans donnée n'ajoute rien)
  expect_equal(t("22")$periode_artif, "2021-2025")
  expect_equal(t("29")$periode_artif, "2021-2024")
  expect_equal(t("35")$periode_artif, "2020-2023")
  expect_equal(t("56")$periode_artif, "2022-2024")
  # EPCI transfrontalier : le SPAN avec les dates par département, trié par code
  expect_equal(t("200000003")$periode_artif, "2020-2023 (35) · 2022-2024 (56)")
  # la région : SES QUATRE fenêtres, triées par code de département
  expect_equal(t("53")$periode_artif,
               "2021-2025 (22) · 2021-2024 (29) · 2020-2023 (35) · 2022-2024 (56)")
  # un territoire SANS membre porteur de donnée OCS-GE -> fenêtre NA (29003)
  expect_true(is.na(t("29003")$periode_artif))
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
  expect_true(all(c("artif_m2", "artif_m3", "flux_net",
                    "millesime_ocsge_debut", "millesime_ocsge_fin") %in%
                    names(communes)))
  expect_equal(nrow(communes), 7L)
  # la commune sans donnée (29003) : NA, jamais un 0
  expect_true(is.na(communes$artif_m3[communes$code == "29003"]))
  # une commune du 35 porte SA fenêtre (2020-2023) sous le nom renommé
  expect_equal(communes$millesime_ocsge_debut[communes$code == "35001"], 2020)
  expect_equal(communes$millesime_ocsge_fin[communes$code == "35001"], 2023)
  # les millésimes RP de la population restent ceux de la série historique
  expect_equal(unique(communes$millesime_debut), 2017)
  expect_equal(unique(communes$millesime_fin), 2023)
})

test_that("chemin rétro-compatible : les archives OCS-GE ABSENTES du cache -> la table de base inchangée", {
  communes <- communes_fixture_milieux()

  # la base du fixture sans OCS-GE ne porte AUCUNE colonne d'état
  expect_false(any(c("artif_m2", "artif_m3", "flux_net") %in% names(communes)))
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
