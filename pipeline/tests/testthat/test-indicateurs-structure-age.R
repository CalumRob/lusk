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
