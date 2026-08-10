# test-theme-metadata ----------------------------------------------------------
# Le contrat de métadonnées par thème (issue #309, parent #308) : chaque thème
# construit publie UN fichier theme_<theme>.json qui déclare l'ordre des
# sous-groupes de la fiche, leurs labels et cadrages, les familles de figures,
# le texte riche TYPÉ des lectures (jamais de HTML brut), le lien vers
# l'histoire résolue de chaque sous-groupe et la politique de source de
# référence des indicateurs. Ce test EST le contrat côté pipeline — le miroir
# de app/src/__tests__/theme-metadata.spec.ts (le même jeu de règles, les
# mêmes fixtures).
#
# Les cas couverts (acceptance #309) :
#   - les fixtures valides passent (un thème à un sous-groupe : Démographie ;
#     un thème à deux sous-groupes : Économie — l'ordre des sous-groupes) ;
#   - la politique de source : chaque indicateur déclare sa source de référence,
#     présente dans les vintages quand la table est passée ;
#   - échouent FORT : thème absent, sous-groupe invalide, figure invalide,
#     texte riche invalide, référence cross-thème et lien d'histoire inconnu ;
#   - la frontière explicite : Programmes & financements est un contrat de
#     publication SÉPARÉ (programmes.json, ADR-0013) — jamais un thème, aucun
#     fichier theme_programmes.json fabriqué.

lire_metadata <- function(nom) {
  jsonlite::fromJSON(
    testthat::test_path("fixtures", "theme-metadata", nom),
    simplifyVector = FALSE
  )
}

test_that("valider_theme_metadata : les fixtures valides passent", {
  for (nom in c("theme-demographie-valide.json", "theme-economie-valide.json")) {
    expect_no_error(valider_theme_metadata(lire_metadata(nom)))
  }
})

test_that("valider_theme_metadata : les sources de référence existent dans les vintages du thème", {
  expect_no_error(
    valider_theme_metadata(lire_metadata("theme-demographie-valide.json"),
                           vintages = vintages_demographie())
  )
  expect_no_error(
    valider_theme_metadata(lire_metadata("theme-economie-valide.json"),
                           vintages = vintages_economie())
  )
})

test_that("valider_theme_metadata : un thème absent est rejeté", {
  meta <- lire_metadata("theme-demographie-valide.json")
  meta$theme <- NULL
  expect_error(valider_theme_metadata(meta), "theme")
})

test_that("valider_theme_metadata : la frontière Programmes — jamais un thème", {
  meta <- lire_metadata("theme-demographie-valide.json")
  meta$theme <- "programmes"
  expect_error(valider_theme_metadata(meta), "SÉPARÉ")
})

test_that("valider_theme_metadata : un sous-groupe invalide est rejeté", {
  # clé de sous-groupe en double
  meta <- lire_metadata("theme-economie-valide.json")
  meta$subgroups[[2]]$key <- meta$subgroups[[1]]$key
  expect_error(valider_theme_metadata(meta), "double")

  # indicateur hors du registre indicator_keys
  meta <- lire_metadata("theme-demographie-valide.json")
  meta$subgroups[[1]]$indicators <- c(meta$subgroups[[1]]$indicators, "fantome")
  expect_error(valider_theme_metadata(meta), "indicator_keys")

  # liste d'indicateurs vide
  meta <- lire_metadata("theme-economie-valide.json")
  meta$subgroups[[2]]$indicators <- list()
  expect_error(valider_theme_metadata(meta), "indicateur")
})

test_that("valider_theme_metadata : une figure invalide est rejetée", {
  # famille hors contrat
  meta <- lire_metadata("theme-demographie-valide.json")
  meta$subgroups[[1]]$figure$family <- "camembert"
  expect_error(valider_theme_metadata(meta), "figure")

  # la figure rend un indicateur que le sous-groupe ne possède pas
  meta <- lire_metadata("theme-demographie-valide.json")
  meta$subgroups[[1]]$figure$indicator <- "fantome"
  expect_error(valider_theme_metadata(meta), "figure")
})

test_that("valider_theme_metadata : un texte riche invalide est rejeté", {
  # type de nœud inconnu (le HTML n'est pas un type)
  meta <- lire_metadata("theme-demographie-valide.json")
  meta$subgroups[[1]]$reading$template[[1]]$type <- "html"
  expect_error(valider_theme_metadata(meta), "HTML")

  # HTML brut dans un nœud text
  meta <- lire_metadata("theme-demographie-valide.json")
  meta$subgroups[[1]]$reading$template[[1]]$content <- "<strong>gras</strong>"
  expect_error(valider_theme_metadata(meta), "HTML")

  # lien sans href
  meta <- lire_metadata("theme-demographie-valide.json")
  template <- meta$subgroups[[1]]$reading$template
  lien_idx <- which(vapply(template, function(n) identical(n$type, "link"), logical(1L)))
  meta$subgroups[[1]]$reading$template[[lien_idx]]$href <- NULL
  expect_error(valider_theme_metadata(meta), "lien")

  # paramètre non déclaré dans reading.params
  meta <- lire_metadata("theme-demographie-valide.json")
  template <- meta$subgroups[[1]]$reading$template
  param_idx <- which(vapply(template, function(n) identical(n$type, "param"), logical(1L)))[1]
  meta$subgroups[[1]]$reading$template[[param_idx]]$key <- "fantome"
  expect_error(valider_theme_metadata(meta), "param")
})

test_that("valider_theme_metadata : une référence cross-thème est rejetée", {
  # une story d'un autre thème dans story_keys (la Mobilité dans la Démographie)
  meta <- lire_metadata("theme-demographie-valide.json")
  meta$story_keys <- c(meta$story_keys, "vingt-minutes-sans-voiture")
  expect_error(valider_theme_metadata(meta), "cross-thème")
})

test_that("valider_theme_metadata : un lien d'histoire inconnu est rejeté", {
  # la lecture d'un sous-groupe pointe une story non déclarée dans story_keys
  meta <- lire_metadata("theme-demographie-valide.json")
  meta$subgroups[[1]]$reading$story_key <- "histoire-inconnue"
  expect_error(valider_theme_metadata(meta), "inconnu")

  # une story déclarée sans sous-groupe qui la lit (orpheline)
  meta <- lire_metadata("theme-economie-valide.json")
  meta$subgroups <- meta$subgroups[1]
  meta$indicator_keys <- meta$subgroups[[1]]$indicators
  meta$sources <- meta$sources[names(meta$sources) %in% meta$indicator_keys]
  expect_error(valider_theme_metadata(meta), "orpheline")
})

test_that("valider_theme_metadata : la politique de source de référence", {
  # une clé d'indicateur sans source déclarée
  meta <- lire_metadata("theme-demographie-valide.json")
  meta$sources <- meta$sources[names(meta$sources) != "densite"]
  expect_error(valider_theme_metadata(meta), "source")

  # une source de référence absente des vintages
  meta <- lire_metadata("theme-demographie-valide.json")
  meta$sources$densite <- "source-fantome"
  expect_error(
    valider_theme_metadata(meta, vintages = vintages_demographie()),
    "vintages"
  )
})
