# INDICATEURS_DEMOGRAPHIE ------------------------------------------------------
# La table déclarative des indicateurs du thème (issue #9) : chaque clé du
# payload y est déclarée avec ses sources (ids du manifeste), sa source de
# référence et sa multiplicité. La validation et l'estampillage vintage
# s'appuient dessus — une clé non déclarée, ou une estampille hors source de
# référence, échoue fort. La source de référence est DÉCLARÉE, jamais
# inférée : la règle est « la source du composant signature de l'indicateur,
# jamais un dénominateur partagé ».

test_that("INDICATEURS_DEMOGRAPHIE : les 4 indicateurs du thème, multiplicité comprise", {
  tab <- INDICATEURS_DEMOGRAPHIE
  expect_named(tab, c("key", "libelle", "sources", "source_reference", "multiplicite"))
  expect_equal(tab$key,
               c("densite", "structure_age", "evolution_1968", "taille_menages"))
  expect_equal(tab$multiplicite, c(1L, 7L, 1L, 1L))
})

test_that("INDICATEURS_DEMOGRAPHIE : chaque clé déclare sa source de référence", {
  tab <- INDICATEURS_DEMOGRAPHIE
  expect_equal(tab$source_reference,
               c("serie_historique", "age_detail", "serie_historique", "menages"))

  # la source de référence est toujours parmi les sources de l'indicateur
  for (i in seq_len(nrow(tab))) {
    expect_true(tab$source_reference[i] %in% tab$sources[[i]], info = tab$key[i])
  }
  # et toutes les sources citées existent dans le manifeste
  ids_manifest <- MANIFEST_DEMOGRAPHIE$id
  for (i in seq_len(nrow(tab))) {
    expect_true(all(tab$sources[[i]] %in% ids_manifest), info = tab$key[i])
  }
})

test_that("structure_age est multi-source : tranches PRINC, dénominateur série historique", {
  ligne <- INDICATEURS_DEMOGRAPHIE[INDICATEURS_DEMOGRAPHIE$key == "structure_age", ]
  expect_setequal(ligne$sources[[1]], c("age_detail", "serie_historique"))
  # la référence est le composant signature (les tranches, PRINC) — jamais le
  # dénominateur partagé (la population, série historique)
  expect_equal(ligne$source_reference, "age_detail")
})
