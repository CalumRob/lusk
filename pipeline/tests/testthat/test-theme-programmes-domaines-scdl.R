# test-theme-programmes-domaines-scdl ------------------------------------------
# La nomenclature des domaines SCDL est déclarée dans theme_programmes.json
# (issue #1151). Deux structures portent la MÊME énumération fermée :
#   - indicator_pages$subventions_par_domaine$list$categories : le profil et la
#     coordonnée lue par project_programme_period_details() ;
#   - detail_labels$subventions_par_domaine : le libellé canonique servi.
# Le producteur fait autorité : depuis la relève du 2026-11-23 le jeu source
# émet 43 domaines. La liste attendue ci-dessous est transcrite de l'écart
# mesuré dans l'issue — (39 déclarés ∪ 11 émis/non déclarés) ∖ 7 déclarés
# absents du source — avec l'ordre éditorial prescrit : les survivants gardent
# leur rang, chaque renommé prend la place de son prédécesseur, et les domaines
# réellement nouveaux jouxtent leur sibling le plus proche.
# Le garde d'exécution reste project_programme_period_details() : ces tests
# verrouillent la déclaration, pas les faits du jeu source.

domaines_scdl_attendus <- function() {
  c(
    "Accompagnement de projets éducatifs des lycées et des initiatives des jeunes",
    "Accompagnement des dynamiques territoriales emploi formation",
    "Accompagnement des entreprises et de l'emploi",
    "Accompagnement des investissements des établissements privés",
    "Actions européennes et internationales",
    "Agriculture, filière bois et alimentation",
    "Apprentissage",
    "Biodiversité",
    "Cinéma, livre, radio et pratiques culturelles",
    "Soutien au développement local",
    "Création, développement et transmission d'entreprises",
    "Dynamiques territoriales",
    "Développement des secteurs clés de l'économie bretonne",
    "Eau",
    "Economie sociale et solidaire et innovation sociale",
    "Energie et ressources",
    "Enseignement supérieur et vie étudiante",
    "Equipements des lycées publics",
    "Fonctionnement des lycées publics",
    "Patrimoine bâti des lycées publics",
    "Fonds d'intervention régional",
    "Accès à la formation",
    "Aide aux apprenants",
    "Offre de formation",
    "Formations sanitaires et sociales et santé",
    "Information et promotion",
    "Infrastructures de mobilités, matériels et gares",
    "Ports",
    "Aéroports",
    "Canaux de Bretagne",
    "Innovation et économie de la connaissance",
    "Inventaire et valorisation du patrimoine",
    "Jeunesse, égalité des droits et vie associative",
    "Langues de Bretagne",
    "Orientation et information sur les métiers",
    "Participation au fonctionnement des établissements privés",
    "Pêche, aquaculture et développement maritime",
    "Recherche",
    "Spectacle vivant, arts plastiques et pratiques culturelles",
    "Sports",
    "Structuration de l'économie bretonne et économie circulaire",
    "Tourisme",
    "Usages numériques et cybersécurité"
  )
}

test_that("detail_labels et list$categories sont la même énumération fermée pour chaque page liste (#1151)", {
  for (theme in THEMES_METADATA) {
    meta <- lire_theme_metadata(theme)
    pages <- meta$indicator_pages %||% list()
    for (cle in names(pages)) {
      page <- pages[[cle]]
      categories <- page$list$categories
      labels <- meta$detail_labels[[cle]]
      if (is.null(categories) || is.null(labels)) next

      declarees <- unlist(categories, use.names = FALSE)
      libelles <- names(unlist(labels, use.names = TRUE))
      expect_true(length(declarees) > 0L, info = paste(theme, cle, "catégories vides"))
      expect_true(length(libelles) > 0L, info = paste(theme, cle, "libellés vides"))
      expect_false(anyDuplicated(declarees) > 0L, info = paste(theme, cle, "catégorie en double"))
      expect_false(anyDuplicated(libelles) > 0L, info = paste(theme, cle, "libellé en double"))
      expect_true(setequal(libelles, declarees),
                  info = paste(theme, cle, "detail_labels ≠ list$categories"))
    }
  }
})

test_that("subventions_par_domaine déclare exactement les 43 domaines SCDL, dans l'ordre éditorial (#1151)", {
  meta <- lire_theme_metadata("programmes")
  page <- meta$indicator_pages$subventions_par_domaine

  attendus <- domaines_scdl_attendus()
  expect_length(attendus, 43L) # verrou de la transcription de l'issue
  expect_false(anyDuplicated(attendus) > 0L)

  declarees <- unlist(page$list$categories, use.names = FALSE)
  expect_identical(declarees, attendus)

  libelles <- names(unlist(meta$detail_labels$subventions_par_domaine, use.names = TRUE))
  expect_identical(libelles, attendus)

  # L'axe de la facette et son détail par défaut suivent la même nomenclature.
  expect_setequal(unlist(page$comparison$details, use.names = FALSE), attendus)
  expect_true(page$comparison$detail %in% attendus)
})
