# test-theme-milieux-trajectoire-zan -------------------------------------------
# L'indicateur « Trajectoire ZAN » (issue #173) : le rapport des rythmes de
# consommation d'ENAF — la fenêtre post-loi 2021-2025 contre la décennie de
# référence 2011-2021 — la réponse à « est-ce que le territoire ralentit vers
# l'objectif −50 % ? ». La FORMULE (décision #173, docs/research/zan-rennes.md) :
# les deux fenêtres natives sont ANNUALISÉES avant le rapport — des fenêtres de
# longueurs différentes (10 ans contre 4 ans) ne sont pas comparables brutes :
#   rythme_reference = naf11art21 / 10   (1er janv. 2011 -> 1er janv. 2021,
#                                         la décennie de référence de la loi)
#   rythme_post_loi  = naf21art25 / 4    (1er janv. 2021 -> 1er janv. 2025,
#                                         quatre tranches annuelles Cerema)
#   trajectoire_zan  = rythme_post_loi / rythme_reference
# Un rapport < 1 = le territoire ralentit (0,5 = le −50 % de l'objectif ZAN) ;
# > 1 = il accélère. Échelle libre : le scalaire classé est la valeur elle-même
# (compute_ranks — aucun scalaire déclaré dans scalaires_milieux).

# Les extractions de la clé trajectoire_zan depuis le payload.
valeur_zan <- function(payload, code) {
  payload$indicateurs$value[
    payload$indicateurs$key == "trajectoire_zan" &
      payload$indicateurs$territoire == code]
}
rang_zan <- function(payload, code, niveau) {
  payload$indicateurs[[niveau]][
    payload$indicateurs$key == "trajectoire_zan" &
      payload$indicateurs$territoire == code]
}

test_that("trajectoire_zan est déclaré dans INDICATEURS_MILIEUX avec sa multiplicité", {
  ligne <- INDICATEURS_MILIEUX[INDICATEURS_MILIEUX$key == "trajectoire_zan", ]

  expect_equal(nrow(ligne), 1L)
  expect_equal(ligne$multiplicite, 1L)            # une ligne par territoire
  expect_identical(ligne$sources[[1]], "consoenaf")
  expect_equal(ligne$source_reference, "consoenaf")
})

test_that("trajectoire_zan : le rapport des rythmes annualisés, vérifié à la main pour chaque territoire", {
  payload <- compute_payload(communes_fixture_milieux(),
                             theme = theme_milieux())

  expect_setequal(unique(payload$indicateurs$key),
                  c("conso_enaf", "trajectoire_zan"))
  zan <- payload$indicateurs[payload$indicateurs$key == "trajectoire_zan", ]
  # une ligne par territoire (la multiplicité déclarée) — chaque territoire du
  # fixture publie SON rapport, y compris les agrégats
  expect_equal(nrow(zan), nrow(payload$territoires))
  expect_true(all(zan$unit == "×"))
  expect_true(all(is.na(zan$detail)))

  # commune 22001 : référence = 1 000 000 m² = 100 ha -> 100 / 10 = 10 ha/an ;
  # post-loi = 233 202 m² = 23,3202 ha -> 23,3202 / 4 = 5,83005 ha/an ;
  # rapport = 5,83005 / 10 = 0,583005 (< 1 : le territoire ralentit)
  expect_equal(valeur_zan(payload, "22001"), 0.583005, tolerance = 1e-9)
  # commune 22002 : (10 / 4) / (15 / 10) = 2,5 / 1,5 = 5/3 — le rythme AUGMENTE
  expect_equal(valeur_zan(payload, "22002"), 5 / 3, tolerance = 1e-9)
  # commune 29001 : (15 / 4) / (35 / 10) = 3,75 / 3,5 = 15/14 — un léger
  # ralentissement (le rapport reste > 1 : pas encore la moitié)
  expect_equal(valeur_zan(payload, "29001"), 15 / 14, tolerance = 1e-9)
  # commune 29002 : (2,5 / 4) / (5 / 10) = 0,625 / 0,5 = 1,25 — le rythme accélère
  expect_equal(valeur_zan(payload, "29002"), 5 / 4, tolerance = 1e-9)
  # EPCI X (200000001) et département 22 : mêmes parties (22001 + 22002) —
  # (33,3202 / 4) / (115 / 10) = 8,33005 / 11,5 = 0,7243522
  expect_equal(valeur_zan(payload, "200000001"), 0.7243522, tolerance = 1e-6)
  expect_equal(valeur_zan(payload, "22"), 0.7243522, tolerance = 1e-6)
})

test_that("trajectoire_zan : la NA honnête — une fenêtre manquante rend le rapport NA, jamais un 0 inventé", {
  payload <- compute_payload(communes_fixture_milieux(),
                             theme = theme_milieux())

  # la commune sans donnée (29003), son EPCI (200000002), son département (29)
  # et la région : au moins une fenêtre manque -> rapport NA, pas de valeur
  expect_true(is.na(valeur_zan(payload, "29003")))
  expect_true(is.na(valeur_zan(payload, "200000002")))
  expect_true(is.na(valeur_zan(payload, "29")))
  expect_true(is.na(valeur_zan(payload, "53")))
})

test_that("trajectoire_zan : le rang-en-contexte est classé TEL QUEL (échelle libre) dans les groupes standard", {
  payload <- compute_payload(communes_fixture_milieux(),
                             theme = theme_milieux())

  # les valeurs des communes (le tri du groupe régional) :
  #   22001 0,5830 < 29001 1,0714 < 29002 1,25 < 22002 1,6667
  # rang_reg (groupe « communes », n = 4) : 0 / 0,25 / 0,5 / 0,75
  expect_equal(rang_zan(payload, "22001", "rang_reg"), 0)
  expect_equal(rang_zan(payload, "29001", "rang_reg"), 0.25)
  expect_equal(rang_zan(payload, "29002", "rang_reg"), 0.5)
  expect_equal(rang_zan(payload, "22002", "rang_reg"), 0.75)
  # rang_epci : 22001 vs 22002 dans l'EPCI X -> 0 / 0,5 ; 29001 vs 29002 dans
  # l'EPCI Y (la commune NA n'empoisonne pas le dénominateur) -> 0 / 0,5
  expect_equal(rang_zan(payload, "22001", "rang_epci"), 0)
  expect_equal(rang_zan(payload, "22002", "rang_epci"), 0.5)
  expect_equal(rang_zan(payload, "29001", "rang_epci"), 0)
  expect_equal(rang_zan(payload, "29002", "rang_epci"), 0.5)
  # rang_dep : « commune|22 » -> 0 / 0,5 ; « commune|29 » -> 0 / 0,5
  expect_equal(rang_zan(payload, "22001", "rang_dep"), 0)
  expect_equal(rang_zan(payload, "22002", "rang_dep"), 0.5)
  expect_equal(rang_zan(payload, "29001", "rang_dep"), 0)
  expect_equal(rang_zan(payload, "29002", "rang_dep"), 0.5)
  # la commune NA n'a pas de rang
  expect_true(is.na(rang_zan(payload, "29003", "rang_epci")))
  expect_true(is.na(rang_zan(payload, "29003", "rang_reg")))
  # l'EPCI X : pas de groupe EPCI (seules les communes s'y comparent) ; groupes
  # département (n = 1) et région (n = 1) -> 0
  expect_true(is.na(rang_zan(payload, "200000001", "rang_epci")))
  expect_equal(rang_zan(payload, "200000001", "rang_dep"), 0)
  expect_equal(rang_zan(payload, "200000001", "rang_reg"), 0)
  # le département 22 se classe seul dans sa région (n = 1) -> 0 ; le 29 (NA)
  # n'a pas de rang
  expect_equal(rang_zan(payload, "22", "rang_reg"), 0)
  expect_true(is.na(rang_zan(payload, "29", "rang_reg")))
  # la région ne se classe pas
  expect_true(is.na(rang_zan(payload, "53", "rang_reg")))
})

test_that("trajectoire_zan : la décennie de référence à ZÉRO — aucun rythme à diviser par deux, rapport NA (documenté)", {
  # Un territoire qui n'a RIEN consommé sur 2011-2021 (un 0,0 réel — le fichier
  # Cerema remplit les zéros) n'a pas de rythme de référence à diviser par
  # deux : ZAN est un objectif zéro — le rapport n'existe pas, il est NA
  # (jamais une valeur inventée, jamais un infini). Une fenêtre post-loi à
  # zéro, elle, est un 0 RÉEL publié : le territoire a cessé de consommer.
  territoires <- tibble::tribble(
    ~code, ~type, ~naf11art21, ~naf21art25,
    "29004", "commune", 0, 2,     # référence à zéro, post-loi > 0 -> NA
    "29005", "commune", 0, 0,     # les deux fenêtres à zéro -> NA
    "29006", "commune", 10, 0,    # post-loi à zéro -> un 0 RÉEL publié
    "29007", "commune", 10, 5,    # le cas normal (pour mémoire)
    "29008", "commune", NA, 5     # référence NA -> NA
  )

  zan <- trajectoire_zan_territoires(territoires)

  expect_true(is.na(zan$value[zan$code == "29004"]))
  expect_true(is.na(zan$value[zan$code == "29005"]))
  expect_equal(zan$value[zan$code == "29006"], 0)
  expect_equal(zan$value[zan$code == "29007"], 1.25)
  expect_true(is.na(zan$value[zan$code == "29008"]))
})
