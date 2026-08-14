# Les indicateurs de stock du thème Habitat (issue #17) : le mix de logements
# et le split statut / âge du bâti / type (issue #368), des parts du stock RP —
# la colonne `n` y est NA (indicateurs de stock, pas d'échantillon).

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
  # EPCI-X = A1 + D + E + F : 2200 logements, 1790 RP, 200 secondaires, 210 vacants
  expect_equal(v$value[v$detail == "principales"], 1790 / 2200)
  expect_equal(v$value[v$detail == "secondaires"], 200 / 2200)
  expect_equal(v$value[v$detail == "vacants"], 210 / 2200)
  # la région : 4900 logements au total
  expect_equal(valeur_payload(p, "53", "mix_logements")$value[
    valeur_payload(p, "53", "mix_logements")$detail == "principales"], 3990 / 4900)
})

test_that("statut : les 4 parts (HLM comprise) en part des RP, elles somment à 1", {
  p <- payload_habitat()
  v <- valeur_payload(p, "22001", "statut")

  expect_equal(nrow(v), 4)
  expect_setequal(v$detail,
                  c("proprietaire", "hlm", "locataire_prive", "loge_gratuit"))
  # statut : 500 + 100 (HLM) + 150 (privé) + 100 (gratuit) = 850 RP de A1
  expect_equal(v$value[v$detail == "proprietaire"], 500 / 850)
  expect_equal(v$value[v$detail == "hlm"], 100 / 850)
  expect_equal(v$value[v$detail == "locataire_prive"], 150 / 850)
  expect_equal(v$value[v$detail == "loge_gratuit"], 100 / 850)
  # indicateur de stock : pas de n publié
  expect_true(all(is.na(v$n)))
  # les 4 parts somment à 1 partout
  for (code in unique(p$indicateurs$territoire)) {
    expect_equal(sum(valeur_payload(p, code, "statut")$value), 1, info = code)
  }
})

test_that("âge du bâti : les 6 tranches de la période d'achèvement, somment à 1 sur le stock connu", {
  p <- payload_habitat()
  v <- valeur_payload(p, "22001", "age_du_bati")

  expect_equal(nrow(v), 6)
  expect_setequal(v$detail, c("lt1919", "1919_1945", "1946_1970",
                              "1971_1990", "1991_2005", "2006_plus"))
  # bâti : 100 + 150 + 200 + 200 + 100 + 100 = 850 = RP de A1 (stock connu)
  expect_equal(v$value[v$detail == "lt1919"], 100 / 850)
  expect_equal(v$value[v$detail == "2006_plus"], 100 / 850)
  expect_true(all(is.na(v$n)))
  # les 6 tranches somment à 1 partout (le stock connu)
  for (code in unique(p$indicateurs$territoire)) {
    expect_equal(sum(valeur_payload(p, code, "age_du_bati")$value), 1,
                 info = code)
  }
})

test_that("type : maison / appartement, la part d'appartements publiée", {
  p <- payload_habitat()
  v <- valeur_payload(p, "22001", "type")

  expect_equal(nrow(v), 2)
  expect_setequal(v$detail, c("maison", "appartement"))
  # type : 550 maisons + 300 appartements = 850 RP de A1 (l'univers type)
  expect_equal(v$value[v$detail == "maison"], 550 / 850)
  expect_equal(v$value[v$detail == "appartement"], 300 / 850)
  expect_true(all(is.na(v$n)))
  for (code in unique(p$indicateurs$territoire)) {
    expect_equal(sum(valeur_payload(p, code, "type")$value), 1, info = code)
  }
})
