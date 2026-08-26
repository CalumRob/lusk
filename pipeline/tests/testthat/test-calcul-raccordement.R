# test-calcul-raccordement --------------------------------------------------------
# Le calcul du raccordement (issue #486, parent #482) : la part de la
# population bretonne joignable en 90 minutes en TC, la courbe cumulative et la
# courbe de référence médiane — calculés depuis la matrice temps FIGÉE SEULE
# (+ les dénominateurs de population), sur le squelette COG 2025.
#
# Toute la sémantique est verrouillée sur un MICRO-FIXTURE calculé À LA MAIN
# (quatre communes suffisent, testing decisions du parent #482) :
#   - A « 11111 » : deux points matrice (le sien + le village absorbé
#     « 99999 », pré-fusion) ;
#   - B « 22222 », C « 33333 » : un point chacune ;
#   - D « 44444 » : ABSENTE de la matrice (la commune non routée) — NA avec
#     motif nommé, jamais un zéro silencieux.
# Populations : A = 100, B = 200, C = 300, D = 400 (W = 1 000).
# Le temps effectif vers une commune = le MINIMUM sur ses points (on peut
# rejoindre la commune en atteignant N'IMPORTE lequel de ses points mairie) ;
# l'inclusion propre t = 0 ; les paires absentes ne sont jamais joignables.

# fixture_matrice_micro -----------------------------------------------------------
# La matrice OD du micro-monde : p01 en minutes, une ligne par paire orientée.
fixture_matrice_micro <- function() {
  lignes <- tribble_rows_micro()
  tibble::tibble(
    from_id = lignes$de, to_id = lignes$vers,
    travel_time_p50 = lignes$t + 5,
    travel_time_p01 = lignes$t
  )
}
tribble_rows_micro <- function() {
  tibble::tibble(
    de = c("11111", "99999", "22222", "33333",
           "22222", "22222", "22222",
           "33333", "33333", "33333",
           "11111", "11111",
           "99999", "99999"),
    vers = c("11111", "99999", "22222", "33333",
             "11111", "99999", "33333",
             "11111", "99999", "22222",
             "22222", "33333",
             "22222", "33333"),
    t = c(0, 0, 0, 0,
          60, 90, 40,
          200, 100, 30,
          70, 150,
          80, 160)
  )
}

# fixture_population_micro ---------------------------------------------------------
fixture_population_micro <- function() {
  tibble::tibble(
    code_commune = c("11111", "22222", "33333", "44444"),
    population = c(100, 200, 300, 400)
  )
}

# fixture_codes_cog_micro ----------------------------------------------------------
# La projection des points matrice vers le COG 2025 (le village absorbé
# « 99999 » tombe sous « 11111 ») — la sortie de resoudre_codes_cog().
fixture_codes_cog_micro <- function() {
  stats::setNames(
    c("11111", "11111", "22222", "33333"),
    c("11111", "99999", "22222", "33333")
  )
}

# fixture_base_epci_micro ----------------------------------------------------------
# L'appartenance EPCI/département du micro-monde : EPCI 200000001 = {A, B},
# EPCI 200000002 = {C} ; départements 22 = {A, B}, 35 = {C}.
fixture_base_epci_micro <- function() {
  tibble::tibble(
    CODGEO = c("11111", "22222", "33333", "44444"),
    EPCI = c("200000001", "200000001", "200000002", NA_character_),
    DEP = c("22", "22", "35", "22")
  )
}

test_that("calculer_raccordement : les parts communales @90 sur le micro-fixture (à la main)", {
  calcul <- calculer_raccordement(
    fixture_matrice_micro(), fixture_population_micro(),
    fixture_codes_cog_micro()
  )

  part <- function(code) {
    calcul$communes$part_90[calcul$communes$code == code]
  }
  # A : elle-même (t = 0) + B à 60 min (min de 60/90 sur ses deux points) —
  # C n'arrive qu'à 100 min (min de 200/100) : hors du seuil 90
  expect_equal(part("11111"), 300 / 1000)
  # B : elle-même + C à 30 min + A à 70 min (le minimum de 70/80 sur les
  # deux points d'A passe le seuil)
  expect_equal(part("22222"), 600 / 1000)
  # C : elle-même + B à 40 min ; A n'arrive qu'à 150
  expect_equal(part("33333"), 500 / 1000)
  # D : NON ROUTÉE — NA avec un motif nommé, jamais un zéro silencieux
  expect_true(is.na(part("44444")))
  motif <- calcul$communes$motif[calcul$communes$code == "44444"]
  expect_true(is.character(motif) && nzchar(motif))
  # les communes routées n'ont pas de motif
  expect_true(all(is.na(calcul$communes$motif[
    calcul$communes$code != "44444"])))
})

test_that("calculer_raccordement : le minimum SUR LES POINTS gouverne (la fusion)", {
  # sans le village absorbé « 99999 », C n'atteindrait A qu'à 200 min ; avec,
  # le minimum (100) passe le seuil 90 ? NON — 100 > 90 : la part de A reste
  # 0.3. En revanche la COURBE saute à x = 100 exactement grâce au point
  # absorbé (sans lui, il faudrait attendre 200).
  calcul <- calculer_raccordement(
    fixture_matrice_micro(), fixture_population_micro(),
    fixture_codes_cog_micro()
  )
  courbe_a <- calcul$courbes_communes[
    calcul$courbes_communes$code == "11111", ]
  lire <- function(minute) courbe_a$part[courbe_a$minute == minute]
  expect_equal(lire(90), 300 / 1000)
  expect_equal(lire(100), 600 / 1000)   # le point absorbé ouvre la porte
  expect_equal(lire(90), 300 / 1000)
  # monotone croissante, plafonnée par W (hors D)
  expect_true(all(diff(courbe_a$part[order(courbe_a$minute)]) >= 0))
})

test_that("calculer_raccordement : la courbe cumulative, l'inclusion propre et l'inconnu", {
  calcul <- calculer_raccordement(
    fixture_matrice_micro(), fixture_population_micro(),
    fixture_codes_cog_micro()
  )
  courbe_b <- calcul$courbes_communes[
    calcul$courbes_communes$code == "22222", ]
  lire <- function(minute) courbe_b$part[courbe_b$minute == minute]
  # B seule à t = 0 (l'inclusion propre), C la rejoint à 30, A à 70
  expect_equal(lire(0), 200 / 1000)
  expect_equal(lire(30), 500 / 1000)
  expect_equal(lire(60), 500 / 1000)
  expect_equal(lire(70), 600 / 1000)
  expect_equal(lire(600), 600 / 1000)
  # la grille couvre [0, cap] au pas demandé — 61 points de 0 à 600
  expect_setequal(unique(courbe_b$minute), seq(0, 600, by = 10))
  # la commune NON ROUTÉE n'a pas de courbe (aucune valeur inventée)
  expect_false(any(calcul$courbes_communes$code == "44444"))
})

test_that("calculer_raccordement : les niveaux EPCI et département (l'union, jamais une moyenne)", {
  calcul <- calculer_raccordement(
    fixture_matrice_micro(), fixture_population_micro(),
    fixture_codes_cog_micro(), base_epci = fixture_base_epci_micro()
  )
  part <- function(table, code) table$part_90[table$code == code]
  # EPCI 200000001 {A, B} : on peut rejoindre L'EPCI en atteignant A OU B —
  # C n'y entre qu'à min(100, 30) = 30 min. Part @90 = A + B + C = 0.6.
  # (Une moyenne pondérée donnerait (0.3×100 + 0.4×200)/300 ≈ 0.367 — JAMAIS ça.)
  expect_equal(part(calcul$epcis, "200000001"), 600 / 1000)
  # EPCI 200000002 {C} : elle-même + B à 30 ; A à 150 hors seuil
  expect_equal(part(calcul$epcis, "200000002"), 500 / 1000)
  # département 22 {A, B, D} : l'union + l'inclusion propre de D — le
  # territoire de D fait partie du département, chacun se rejoint soi-même :
  # A, B et D à t = 0, C les rejoint à 30 min → TOUTE la population
  expect_equal(part(calcul$departements, "22"), 1000 / 1000)
  # département 35 {C}
  expect_equal(part(calcul$departements, "35"), 500 / 1000)
  # région {A, B, C, D} : chacun se rejoint soi-même — routée ou non, tout
  # Breton habite la Bretagne : la part vaut exactement 1
  expect_equal(part(calcul$region, "53"), 1000 / 1000)
  # les courbes existent aux trois niveaux
  expect_true(nrow(calcul$courbes_epcis[
    calcul$courbes_epcis$code == "200000001", ]) == 61L)
  expect_true(nrow(calcul$courbes_departements[
    calcul$courbes_departements$code == "22", ]) == 61L)
  expect_true(nrow(calcul$courbe_region) == 61L)
  # la courbe EPCI saute à 30 (l'union ouvre plus tôt que chaque commune)
  e1 <- calcul$courbes_epcis[calcul$courbes_epcis$code == "200000001", ]
  expect_equal(e1$part[e1$minute == 20], 300 / 1000)
  expect_equal(e1$part[e1$minute == 30], 600 / 1000)
})

test_that("calculer_raccordement : la courbe de référence médiane bretonne", {
  calcul <- calculer_raccordement(
    fixture_matrice_micro(), fixture_population_micro(),
    fixture_codes_cog_micro()
  )
  ref <- calcul$reference
  lire <- function(minute) ref$part_mediane[ref$minute == minute]
  # la médiane des TROIS communes routées (jamais la moyenne) :
  #   x = 0  -> parts (0.1, 0.2, 0.3)  -> médiane 0.2
  #   x = 30 -> (0.1, 0.5, 0.3)        -> 0.3
  #   x = 90 -> (0.3, 0.6, 0.5)        -> 0.5
  #   x = 100-> (0.6, 0.6, 0.5)        -> 0.6
  expect_equal(lire(0), 200 / 1000)
  expect_equal(lire(30), 300 / 1000)
  expect_equal(lire(90), 500 / 1000)
  expect_equal(lire(100), 600 / 1000)
  expect_equal(length(ref$minute), 61L)
})

test_that("resoudre_codes_cog : la projection MULTI-MILLÉSIMES (un village pré-2022)", {
  # la table COM réelle porte UNE ligne par commune 2025, les anciens codes
  # dans les colonnes CODGEO_<année> : un code qui a quitté le COG AVANT 2022
  # ne vit dans AUCUNE colonne 2022 — la résolution doit balayer TOUS les
  # millésimes de la feuille.
  large <- tibble::tibble(
    CODGEO_2025 = c("11111", "22222", "33333", "44444"),
    CODGEO_2022 = c("11111", "22222", "33333", "44444"),
    CODGEO_2020 = c("99999", "22222", "33333", "44444")
  )
  codes <- resoudre_codes_cog(c("99999", "11111", "44444", "22222"), large)
  expect_equal(unname(codes["99999"]), "11111")
  expect_equal(unname(codes["11111"]), "11111")
  expect_equal(unname(codes["44444"]), "44444")
  expect_equal(unname(codes["22222"]), "22222")
  # déterministe : l'ordre d'entrée conservé
  expect_equal(names(codes), c("99999", "11111", "44444", "22222"))
})

test_that("TRIPWIRES resoudre_codes_cog : code inconnu et scission refusés bruyamment", {
  large <- tibble::tibble(
    CODGEO_2025 = c("11111", "22222"),
    CODGEO_2022 = c("11111", "22222")
  )
  # un code absent de toutes les colonnes : jamais une NA silencieuse
  expect_error(resoudre_codes_cog("88888", large), "88888")
  # une scission (le même ancien code dans DEUX lignes) : jamais un choix
  scindee <- tibble::tibble(
    CODGEO_2025 = c("11111", "22222", "33333"),
    CODGEO_2022 = c("88888", "22222", "88888")
  )
  expect_error(resoudre_codes_cog("88888", scindee), "88888")
})

test_that("TRIPWIRE calculer_raccordement : un point matrice sans projection COG s'arrête", {
  codes_tronques <- fixture_codes_cog_micro()["11111"]
  names(codes_tronques) <- "11111"
  expect_error(
    calculer_raccordement(fixture_matrice_micro(),
                          fixture_population_micro(), codes_tronques),
    "99999"
  )
})

# LA POPULATION ÉPINGLÉE ---------------------------------------------------------
# Le dénominateur RP 2023 transcrit de la recherche vérifiée (W = 3 449 370),
# artefact de code épinglé sous inst/extdata — le même pattern que la matrice
# (#485). Le contrat refuse tout substitut : empreinte recalculée SUR LE DISQUE.

test_that("la population épinglée passe son contrat (W verrouillé)", {
  pop <- lire_population_raccordement()
  expect_invisible(verifier_contrat_population_raccordement(pop))
  expect_equal(nrow(pop), 1202L)
  expect_equal(sum(pop$population), 3449370L)
  expect_setequal(unique(substr(pop$code_commune, 1, 2)),
                  c("22", "29", "35", "56"))
  expect_false(anyNA(pop$population))
  expect_true(all(pop$population >= 0))
  expect_equal(anyDuplicated(pop$code_commune), 0L)
})

test_that("TRIPWIRE — une population substituée (deux habitants échangés) est refusée par l'empreinte", {
  source <- system.file("extdata", POPULATION_RACCORDEMENT_FICHIER,
                        package = "lusk")
  stopifnot(nzchar(source))
  faux <- lire_population_raccordement()
  # l'échange garde la somme (le verrou W ne crie pas) : seule l'EMPREINTE
  # des octets relus sur le disque convainct le substitut
  faux$population[c(1, 2)] <- faux$population[c(2, 1)]
  expect_invisible(verifier_contrat_population_raccordement(faux))

  chemin <- tempfile("population-octet-", fileext = ".csv")
  on.exit(unlink(chemin), add = TRUE)
  write.csv(faux, chemin, row.names = FALSE)
  expect_error(verifier_contrat_population_raccordement(
    lire_population_raccordement(), chemin = chemin), "sha256")
})
