# test-verrous-lq-a17 -----------------------------------------------------------
# Les RÈGLES du grain A17 des verrous « données réelles » LQ (issue #428,
# parent #154), en FIXTURE : le dé-magic-number éprouvé — les comptes figés
# d'antan (135 784 cellules / 835 390 lignes de M / 695 codes APET) deviennent
# les règles verifier_forme_lq_a17, verifier_exclusions_a17 et
# verifier_forme_sidecar_m, partagées par verifier_lq_economie_reel et
# verifier_economie_e2e_reel. Chaque règle est exercée des DEUX CÔTÉS sans
# donnée réelle :
#   - le côté vert : une sortie du CHAÎNON LIVRÉ (fixture_lq_analytique →
#     construire_analytique_lq_economie — mapping A17 compris) passe ;
#   - LE TRIPWIRE (l'acceptance de l'issue) : le grain fin d'antan — la table
#     calculée par l'ancien chemin bas-niveau qui contournait le mapper —, une
#     jointure cassée (un code exclu hors l'inconnue « 00.00Z » connue) et un
#     effondrement d'épaisseur (la médiane 2 de la sous-classe) ÉCHOUENT
#     bruyamment, en nommant le fait constaté.
# Les seuils sont paramétrables comme le plancher gate D
# (appliquer_plancher_communes) ; leurs VALEURS verrouillent la séparation
# documentée de la recherche empirique (docs/research/naf-grain-lq.md :
# médiane de cellule 13 à A17, jamais au-dessus de 6 pour un autre grain).

# --- la règle de vocabulaire ----------------------------------------------------

test_that("TRIPWIRE — la table de l'ancien chemin bas-niveau (sans mapper) échoue au vocabulaire", {
  # le bypass que l'ancien verrou figeait : agreger → plancher → Balassa,
  # JAMAIS mapper_activites_a17 — les sous-classes APET « NN.NNL » sont hors
  # du vocabulaire fermé des 17 postes A17
  agrege <- agreger_sirene_par_activite(fixture_lq_analytique())
  lq_sous_classe <- calculer_lq_balassa(
    appliquer_plancher_communes(agrege)$retenu)

  expect_error(
    verifier_forme_lq_a17(lq_sous_classe, "verrou"),
    "vocabulaire officiel des 17 postes A17")
  expect_error(
    verifier_forme_lq_a17(lq_sous_classe, "verrou"),
    "01\\.11Z")  # le code fautif est NOMMÉ, jamais un échec muet
})

test_that("la règle de vocabulaire passe sur la sortie du chaînon livré", {
  sortie <- tempfile("verrous-lq-a17-")
  on.exit(unlink(sortie, recursive = TRUE), add = TRUE)
  res <- construire_analytique_lq_economie(fixture_lq_analytique(), sortie)

  # les postes remontent de l'artefact épinglé : la règle passe (plancher et
  # seuil d'épaisseur abaissés — la fixture est minuscule : trois postes, une
  # médiane sans la portée statistique de la vraie table ; les valeurs RÉELLES
  # des deux seuils sont verrouillées plus bas et exercées sur la vraie table)
  expect_invisible(verifier_forme_lq_a17(res$lq, "verrou",
                                         plancher_codes = 1,
                                         seuil_epaisseur = 1))
})

test_that("un effondrement du mapping passe sous le plancher de codes observés", {
  # tout vers UN même poste (une jointure qui ne remonte plus que GZ) : dans
  # le vocabulaire oui, sous PLANCHER_CODES_OBSERVES_A17 — échec bruyant
  effondre <- tibble::tibble(
    commune = c("22001", "22001"),
    activity_code = c("GZ", "GZ"),
    activity_label = unname(VOCABULAIRE_NA17_OFFICIEL["GZ"]),
    lq = c(1.5, 0.5),
    n = c(30L, 40L)
  )
  expect_error(
    verifier_forme_lq_a17(effondre, "verrou"),
    "plancher")
})

# --- la règle d'épaisseur --------------------------------------------------------

# Une table à l'allure de la vraie : les SEIZE postes observés dans la preuve
# réelle (#428, au-dessus du plancher de 12), des LQ des deux côtés de 1.
fixture_lq_a16_postes <- function(n_cellules) {
  codes <- c("AZ", "C1", "C3", "C4", "C5", "DE", "FZ", "GZ",
             "HZ", "IZ", "JZ", "KZ", "LZ", "MN", "OQ", "RU")
  tibble::tibble(
    commune = "22001",
    activity_code = codes,
    activity_label = unname(VOCABULAIRE_NA17_OFFICIEL[codes]),
    lq = c(0.5, 1.5, 2.0, 0.9, 1.1, 3.0, 1.4, 0.6,
           0.8, 1.2, 0.7, 0.9, 1.6, 0.5, 2.5, 1.0),
    n = n_cellules
  )
}

test_that("TRIPWIRE — la médiane 2 du grain fin déclenche le seuil d'épaisseur", {
  # des cellules minces à la sous-classe (médiane 2 — le profil mesuré de
  # l'ancien grain, docs/research/naf-grain-lq.md) : les seize postes DANS le
  # vocabulaire et AU-DESSUS du plancher de codes, l'épaisseur SOUS le seuil —
  # c'est bien l'épaisseur qui doit parler
  mince <- fixture_lq_a16_postes(
    c(1L, 1L, 1L, 1L, 1L, 1L, 1L, 2L, 2L, 3L, 3L, 3L, 3L, 3L, 3L, 3L))
  stopifnot(median(mince$n) == 2)

  expect_error(
    verifier_forme_lq_a17(mince, "verrou"),
    "épaisseur médiane")
  expect_error(
    verifier_forme_lq_a17(mince, "verrou"),
    "retour au grain fin")
})

test_that("une table épaisse au profil A17 passe le seuil par défaut", {
  epais <- fixture_lq_a16_postes(rep(13L, 16))   # la médiane mesurée à A17 : 13
  expect_invisible(verifier_forme_lq_a17(epais, "verrou"))
})

test_that("le seuil verrouillé sépare strictement l'A17 de tout autre grain mesuré", {
  # les médianes mesurées par la recherche (docs/research/naf-grain-lq.md) :
  # tout grain autre qu'A17 reste SOUS le seuil, l'A17 réel (13) garde SA marge
  medians <- c(sous_classe = 2, classe = 2, groupe = 2,
               division_a88 = 3, a38 = 6)
  expect_true(all(medians < SEUIL_EPAISSEUR_MEDIANE_LQ))
  expect_true(SEUIL_EPAISSEUR_MEDIANE_LQ < 13)
})

# --- la règle du rapport d'exclusion ---------------------------------------------

motif_artefact <- function() {
  sprintf(paste0(
    "code absent de la correspondance officielle NAF rév. 2 → A17 ",
    "(artefact %s) : exclu du calcul, rapporté ici."), "naf2_na17_2008")
}

exclusions_connues <- function() {
  tibble::tibble(
    activity_code = "00.00Z",
    n = 1L,
    n_communes = 1L,
    communes = "29006",
    motif = motif_artefact()
  )
}

test_that("le rapport d'exclusion connu (« 00.00Z », un établissement) passe", {
  expect_invisible(verifier_exclusions_a17(exclusions_connues(), "verrou"))
})

test_that("TRIPWIRE — une jointure cassée ajoute un code exclu hors l'inconnue : échec", {
  # « 12.34Z » : bien formé mais absent de la correspondance épinglée — si le
  # rapport le porte, la jointure est cassée ou l'artefact périmé : ÉCHOUER
  cassee <- dplyr::bind_rows(
    exclusions_connues(),
    tibble::tibble(activity_code = "12.34Z", n = 500L, n_communes = 42L,
                   communes = "22001, 29006", motif = motif_artefact())
  )
  expect_error(verifier_exclusions_a17(cassee, "verrou"), "12\\.34Z")
})

test_that("TRIPWIRE — un rapport vide (l'inconnue n'est plus exclue) échoue aussi", {
  vide <- exclusions_connues()[0L, ]
  expect_error(verifier_exclusions_a17(vide, "verrou"), "00\\.00Z")
})

test_that("TRIPWIRE — l'inconnue qui porte plus d'un établissement échoue", {
  derivee <- exclusions_connues()
  derivee$n <- 3L
  expect_error(verifier_exclusions_a17(derivee, "verrou"),
               "un seul établissement")
})

test_that("un motif hors artefact épinglé échoue", {
  anonyme <- exclusions_connues()
  anonyme$motif <- "exclu."
  expect_error(verifier_exclusions_a17(anonyme, "verrou"), "naf2_na17_2008")
})

test_that("la règle d'exclusion passe sur la sortie du chaînon livré", {
  sortie <- tempfile("verrous-lq-a17-excl-")
  on.exit(unlink(sortie, recursive = TRUE), add = TRUE)
  res <- construire_analytique_lq_economie(fixture_lq_analytique(), sortie)
  expect_invisible(verifier_exclusions_a17(res$exclusions, "verrou"))
})

# --- la règle du sidecar M --------------------------------------------------------

test_that("la règle du sidecar M exige le croisement complet et le binaire strict", {
  sortie <- tempfile("verrous-lq-a17-m-")
  on.exit(unlink(sortie, recursive = TRUE), add = TRUE)
  res <- construire_analytique_lq_economie(fixture_lq_analytique(), sortie)

  # la sortie du chaînon : alignée, binaire — passe
  expect_invisible(verifier_forme_sidecar_m(res$m, res$lq, "verrou"))

  # une matrice tronquée (des lignes perdues — l'ancien compte magique aurait
  # pu rater une dérive silencieuse) : échec
  tronquee <- res$m[-(1:2), ]
  expect_error(verifier_forme_sidecar_m(tronquee, res$lq, "verrou"),
               "croisement complet")

  # une valeur non binaire : échec
  seuillee <- res$m %>% dplyr::mutate(
    m = ifelse(dplyr::row_number() == 1L, 2L, m))
  expect_error(verifier_forme_sidecar_m(seuillee, res$lq, "verrou"),
               "hors \\{0, 1\\}")
})
