# Les indicateurs de stock du thème Habitat (issue #17) : le mix de logements
# et le statut/ancienneté/taille, des parts du stock RP — la colonne `n` y est
# NA (indicateurs de stock, pas d'échantillon).

test_that("mix de logements : une ligne par catégorie, part du total", {
  p <- payload_habitat()
  v <- valeur_payload(p, "22001", "mix_logements")

  expect_equal(nrow(v), 3)
  expect_setequal(v$detail, c("principales", "secondaires", "vacants"))
  expect_equal(v$value[v$detail == "principales"], 850 / 1000)
  expect_equal(v$value[v$detail == "secondaires"], 50 / 1000)
  expect_equal(v$value[v$detail == "vacants"], 100 / 1000)
  expect_equal(unique(v$unit), "%")
  # indicateur de stock : pas de n publié
  expect_true(all(is.na(v$n)))
})

test_that("mix de logements : les agrégats somment les communes", {
  p <- payload_habitat()
  v <- valeur_payload(p, "200000001", "mix_logements")
  # EPCI-X = A1 + D : 1300 logements, 1090 RP, 90 secondaires, 120 vacants
  expect_equal(v$value[v$detail == "principales"], 1090 / 1300)
  expect_equal(v$value[v$detail == "secondaires"], 90 / 1300)
  expect_equal(v$value[v$detail == "vacants"], 120 / 1300)
  # la région : 4000 logements au total
  expect_equal(valeur_payload(p, "53", "mix_logements")$value[
    valeur_payload(p, "53", "mix_logements")$detail == "principales"], 3290 / 4000)
})

test_that("statut / ancienneté / taille : 14 modalités en part des RP", {
  p <- payload_habitat()
  v <- valeur_payload(p, "22001", "statut_anciennete_taille")

  expect_equal(nrow(v), 14)
  expect_setequal(v$detail, c(
    "statut_proprietaire", "statut_locataire", "statut_loge_gratuit",
    "anciennete_lt2", "anciennete_2_4", "anciennete_5_9",
    "anciennete_10_19", "anciennete_20_29", "anciennete_30_plus",
    "taille_r1", "taille_r2", "taille_r3", "taille_r4", "taille_5_plus"
  ))
  # statut : 500 + 250 + 100 = 850 RP de A1
  expect_equal(v$value[v$detail == "statut_proprietaire"], 500 / 850)
  expect_equal(v$value[v$detail == "statut_locataire"], 250 / 850)
  expect_equal(v$value[v$detail == "statut_loge_gratuit"], 100 / 850)
  # ancienneté : 6 tranches = 850
  expect_equal(v$value[v$detail == "anciennete_lt2"], 150 / 850)
  expect_equal(v$value[v$detail == "anciennete_30_plus"], 100 / 850)
  # taille : 5 tranches = 850
  expect_equal(v$value[v$detail == "taille_r1"], 100 / 850)
  expect_equal(v$value[v$detail == "taille_5_plus"], 200 / 850)
  # indicateur de stock : pas de n publié
  expect_true(all(is.na(v$n)))
})

test_that("statut / ancienneté / taille : chaque sous-métrique somme à 1", {
  p <- payload_habitat()
  for (code in unique(p$indicateurs$territoire)) {
    v <- valeur_payload(p, code, "statut_anciennete_taille")
    v$sous_metrique <- sub("_.*$", "", v$detail)
    for (sm in unique(v$sous_metrique)) {
      expect_equal(sum(v$value[v$sous_metrique == sm]), 1, info = paste(code, sm))
    }
  }
})
