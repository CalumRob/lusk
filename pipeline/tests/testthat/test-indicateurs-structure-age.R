# La structure par âge (issue #390) : 14 lignes par territoire — 7 tranches
# d'âge × 2 sexes (F / M). `detail` reste la tranche ; `sex` porte le sexe.
# Chaque part = effectif du sexe / population totale, donc les 14 parts
# somment à 1 par territoire.

bandes <- c(
  age_lt15 = "<15", age_15_24 = "15-24", age_25_39 = "25-39",
  age_40_54 = "40-54", age_55_64 = "55-64", age_65_79 = "65-79",
  age_80_plus = "80+"
)

test_that("structure par âge : 14 lignes (7 tranches × 2 sexes) par territoire", {
  p <- compute_payload(load_fixture())
  for (code in unique(p$indicateurs$territoire)) {
    v <- valeur_payload(p, code, "structure_age")
    expect_equal(nrow(v), 14, info = code)
    expect_setequal(v$detail, c("<15", "15-24", "25-39", "40-54", "55-64",
                                "65-79", "80+"))
    expect_setequal(v$sex, c("F", "M"))
  }
})

test_that("structure par âge : chaque part = effectif sexe / population (communes)", {
  p <- compute_payload(load_fixture())
  fx <- load_fixture()
  # le fixture porte les effectifs par sexe pour les communes uniquement
  for (code in fx$code) {
    v <- valeur_payload(p, code, "structure_age")
    pop <- fx$population[fx$code == code]
    for (sx in c("F", "M")) {
      for (bande in names(bandes)) {
        col <- paste0(bande, "_", sx)
        att <- fx[[col]][fx$code == code] / pop
        obs <- v$value[v$detail == bandes[[bande]] & v$sex == sx]
        expect_equal(obs, att, info = paste(code, sx, bande))
      }
    }
  }
})

test_that("structure par âge : les parts somment à 1 pour chaque territoire", {
  p <- compute_payload(load_fixture())
  for (code in unique(p$indicateurs$territoire)) {
    v <- valeur_payload(p, code, "structure_age")
    expect_equal(sum(v$value), 1, info = code)
  }
})

test_that("structure par âge : les agrégats somment les tranches (par sexe)", {
  p <- compute_payload(load_fixture())
  fx <- load_fixture()
  v <- valeur_payload(p, "200000001", "structure_age")
  # EPCI-X = A1 + D : parts sur 2400 habitants, par sexe
  for (sx in c("F", "M")) {
    for (bande in names(bandes)) {
      col <- paste0(bande, "_", sx)
      att <- (fx[[col]][fx$code == "22001"] + fx[[col]][fx$code == "22002"]) / 2400
      obs <- v$value[v$detail == bandes[[bande]] & v$sex == sx]
      expect_equal(obs, att, info = paste(sx, bande))
    }
  }
})

test_that("structure par âge : le rang scalaire (moins de 20 ans / population) est répliqué sur les 14 lignes", {
  p <- compute_payload(load_fixture())
  v <- valeur_payload(p, "22001", "structure_age")
  # la scalarité est portée par le rang ; identique sur les 14 lignes
  expect_equal(length(unique(v$rang_epci)), 1)
})

test_that("structure par âge : le rang porte la part TOTALE des moins de 20 ans, indépendante des 14 parts", {
  # le scalaire de rang (age_lt20 / population) CHEVAUCHE les tranches « <15 »
  # et « 15-24 » : il n'est pas la somme de parts publiées, et son classement ne
  # bouge pas quand l'éclatement par sexe change de forme (issue #390).
  fx <- load_fixture()
  p <- compute_payload(fx)
  # 22001 : age_lt20 = 500 sur 2000 habitants = 0.25 ; 22002 : 100 / 400 = 0.25
  # → l'ordre du rang suit ce scalaire, jamais la part « <15 » d'un seul sexe
  attendu <- fx$age_lt20 / fx$population
  expect_equal(attendu[fx$code == "22001"], 0.25)
  # la part <15 totale (F + M) DIFFÈRE du scalaire des moins de 20 ans : les
  # deux vivent leur vie — la garde est là pour que personne ne les confonde
  v <- valeur_payload(p, "22001", "structure_age")
  part_lt15 <- sum(v$value[v$detail == "<15"])
  expect_false(isTRUE(all.equal(part_lt15, attendu[fx$code == "22001"])))
})

# Le contrat âge×sexe, refusé fort (issue #390) --------------------------------
# Les tranches attendues sont DÉCLARÉES (TRANCHES_STRUCTURE_AGE), jamais
# dérivées de ce que le payload porte : c'est ce qui permet d'attraper une
# tranche entièrement absente. Chaque cas ci-dessous est une dérive que la
# validation doit nommer, jamais absorber.
#
# DEUX niveaux sont testés séparément, et c'est volontaire :
#   - `contrat` : LA validation du contrat âge×sexe, visée directement par son
#     nom. C'est elle qui NOMME la paire fautive — les gardes génériques de
#     validate_payload (multiplicité 14, clé d'unicité) parlent souvent les
#     premières et disent seulement « inattendues » / « en double » ;
#   - `validate_payload` complet : le refus de bout en bout, quelle que soit la
#     garde qui parle. Une dérive ne passe JAMAIS, par aucun chemin.
contrat <- validations_demographie$contrat_age_sexe

test_that("contrat âge×sexe : le payload du fixture passe la validation du thème", {
  p <- compute_payload(load_fixture())
  expect_no_error(validate_payload(p, validations = validations_demographie))
  expect_no_error(contrat(p))
})

test_that("contrat âge×sexe : une TRANCHE entièrement absente (ses deux sexes) -> erreur nommée", {
  p <- compute_payload(load_fixture())
  # on retire les DEUX lignes de « 55-64 » : les tranches restantes sont encore
  # cohérentes PAR PAIRES (chaque tranche présente a bien F et M) — une attente
  # dérivée de l'observé trouverait ça impeccable. Seule l'attente FIXE voit le
  # trou, et le nomme.
  p$indicateurs <- p$indicateurs[!(p$indicateurs$key == "structure_age" &
                                     p$indicateurs$detail == "55-64"), ]

  expect_error(contrat(p), "manquantes")
  expect_error(contrat(p), "55-64 F")
  expect_error(contrat(p), "55-64 M")
  # et de bout en bout : le payload est refusé (ici par la garde de multiplicité)
  expect_error(validate_payload(p, validations = validations_demographie))
})

test_that("contrat âge×sexe : un SEXE manquant sur une tranche -> erreur nommée", {
  p <- compute_payload(load_fixture())
  p$indicateurs <- p$indicateurs[!(p$indicateurs$key == "structure_age" &
                                     p$indicateurs$detail == "<15" &
                                     p$indicateurs$sex == "M"), ]

  expect_error(contrat(p), "manquantes")
  expect_error(contrat(p), "<15 M")
  expect_error(validate_payload(p, validations = validations_demographie))
})

test_that("contrat âge×sexe : une représentation mixte sexe/NA -> erreur", {
  p <- compute_payload(load_fixture())
  cible <- p$indicateurs$key == "structure_age" &
    p$indicateurs$detail == "<15" & p$indicateurs$sex == "F"
  p$indicateurs$sex[cible] <- NA_character_

  expect_error(contrat(p), "sexe hors contrat")
  expect_error(contrat(p), "NA")
  expect_error(validate_payload(p, validations = validations_demographie))
})

test_that("contrat âge×sexe : un sexe INVALIDE (« _T » — le total n'est pas une ligne) -> erreur", {
  p <- compute_payload(load_fixture())
  cible <- p$indicateurs$key == "structure_age" &
    p$indicateurs$detail == "<15" & p$indicateurs$sex == "F"
  p$indicateurs$sex[cible] <- "_T"

  expect_error(contrat(p), "sexe hors contrat")
  expect_error(contrat(p), "_T")
  expect_error(validate_payload(p, validations = validations_demographie))
})

test_that("contrat âge×sexe : une paire âge×sexe EN DOUBLE -> erreur", {
  p <- compute_payload(load_fixture())
  ligne <- p$indicateurs[p$indicateurs$key == "structure_age" &
                           p$indicateurs$detail == "<15" &
                           p$indicateurs$sex == "F", ][1, ]
  p$indicateurs <- rbind(p$indicateurs, ligne)

  expect_error(contrat(p), "en double")
  expect_error(contrat(p), "<15 F")
  # de bout en bout, la clé d'unicité générique parle la première — les deux
  # messages disent « double », c'est le refus qui compte
  expect_error(validate_payload(p, validations = validations_demographie),
               "double")
})

test_that("contrat âge×sexe : une tranche HORS CONTRAT (« 90+ » n'est pas un étage bonus) -> erreur", {
  p <- compute_payload(load_fixture())
  p$indicateurs$detail[p$indicateurs$key == "structure_age" &
                         p$indicateurs$detail == "80+"] <- "90+"

  expect_error(contrat(p), "tranche hors contrat")
  expect_error(contrat(p), "90\\+")
  expect_error(validate_payload(p, validations = validations_demographie),
               "tranche hors contrat")
})

test_that("contrat âge×sexe : la colonne `sex` absente -> erreur (dérive de schéma)", {
  p <- compute_payload(load_fixture())
  p$indicateurs$sex <- NULL

  expect_error(contrat(p), "colonne `sex`")
  # de bout en bout : sans la colonne `sex`, les 14 lignes deviennent 7 paires
  # (territoire × key × detail) en double — la garde générique parle la première
  expect_error(validate_payload(p, validations = validations_demographie),
               "double")
})
