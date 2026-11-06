# test-publier-theme-metadata ---------------------------------------------------
# L'issue #311 : la publication des métadonnées par thème (theme_<theme>.json).
# Chaque thème construit éPINGLE son fichier de métadonnées sous
# inst/extdata/theme-metadata/ (le contrat #309, la même forme que l'app
# valide côté TypeScript) ; run_pipeline le publie vers la cible que l'app lit
# par le seam publier_theme_metadata. Ce qui est verrouillé ici (acceptance
# #311, étendue par #408) :
#   - les SIX thèmes construits publient chacun theme_<thème>.json, relu
#     valide, avec la politique de source de référence croisée contre SES
#     vintages (le run réel — des projections pures du manifeste, jamais le
#     réseau) ;
#   - le nom du fichier dérive du thème VALIDÉ du contenu, jamais d'un
#     paramètre — la collision est impossible ;
#   - publier les métadonnées ne recompute NI ne réécrit les tables canoniques
#     partagées ; les projections numériques indicateurs_/histoires_ sont
#     retirées et ne réapparaissent pas ;
#   - une collision de thème (le contenu déclare le fichier d'un AUTRE thème)
#     échoue FORT, sans rien écrire — la garde theme_attendu du run ;
#   - le sixième thème (#408) : Programmes et subventions épingle SON canon et
#     publie SON theme_programmes.json, comme les cinq autres.

# publier_metadata_theme --------------------------------------------------------
# Le run réel minimal du seam : les métadonnées épinglées du thème, ses
# vintages réels (projections pures du manifeste — déterministe) et les
# directions de SON module (la croisée des directions #506, ce que run_pipeline
# et le graphe targets passent au seam).
publier_metadata_theme <- function(theme, cible) {
  descripteur <- get(paste0("theme_", theme))()
  publier_theme_metadata(descripteur$metadata(), cible,
                         vintages = descripteur$vintages(),
                         theme_attendu = theme,
                         directions_module = descripteur$directions)
}

test_that("les six thèmes publient theme_<thème>.json — relu valide, sources croisées avec leurs vintages", {
  cible <- tempfile("pub-meta-")
  on.exit(unlink(cible, recursive = TRUE))

  for (theme in THEMES_METADATA) {
    publier_metadata_theme(theme, cible)

    chemin <- file.path(cible, paste0("theme_", theme, ".json"))
    expect_true(file.exists(chemin), info = theme)

    # le fichier publié se relit et se re-valide via le point d'entrée navigateur
    # explicite (#868) — le contexte producteur strict le refuserait (champs projetés)
    relu <- jsonlite::fromJSON(chemin, simplifyVector = FALSE)
    expect_error(valider_projection_navigateur(relu), NA, info = theme)
    expect_error(valider_theme_metadata(relu), "story_keys", info = theme)
    expect_identical(relu$theme, theme)

    # la projection que l'app fetch (fetch().json() — simplifyVector par
    # défaut) porte la même forme : le thème, le label, l'ordre des sous-groupes
    app <- jsonlite::fromJSON(chemin)
    expect_identical(app$theme, theme)
    expect_true(nrow(app$subgroups) > 0)
    expect_true(length(app$indicator_keys) > 0)
  }
})

test_that("le nom du fichier dérive du thème VALIDÉ du contenu, jamais d'un paramètre", {
  cible <- tempfile("pub-meta-")
  on.exit(unlink(cible, recursive = TRUE))

  meta <- lire_theme_metadata("demographie")
  publier_theme_metadata(meta, cible)

  # le fichier écrit s'appelle theme_demographie.json — le nom vient du thème
  # du contenu, pas d'un argument : la machinerie ne peut pas écrire le fichier
  # d'un autre thème
  expect_true(file.exists(file.path(cible, "theme_demographie.json")))
  expect_false(file.exists(file.path(cible, "theme.json")))
})

test_that("changer les métadonnées ne réécrit PAS les tables de faits", {
  cible <- tempfile("pub-meta-")
  on.exit(unlink(cible, recursive = TRUE))

  # 1) le payload producteur passe par publish ; seules les ressources
  # partagées retenues sont sérialisées, les faits restent en mémoire.
  payload <- compute_payload(load_fixture())
  publish(payload, cible)
  expect_false(file.exists(file.path(cible, "indicateurs_demographie.json")))
  expect_false(file.exists(file.path(cible, "histoires_demographie.json")))
  octets <- function(fichier) {
    readBin(file.path(cible, fichier), "raw",
            n = file.info(file.path(cible, fichier))$size)
  }
  partages_avant <- lapply(c("territoires.json", "territoires.parquet"), octets)

  # 2) la publication des métadonnées — un contenu DIFFÉRENT du précédent
  meta <- lire_theme_metadata("demographie")
  publier_theme_metadata(meta, cible)
  meta$label <- "Démographie — label modifié"
  publier_theme_metadata(meta, cible)

  # la publication de métadonnées ne touche pas aux ressources partagées et ne
  # recrée aucune projection numérique retirée.
  partages_apres <- lapply(c("territoires.json", "territoires.parquet"), octets)
  for (i in seq_along(partages_avant))
    expect_identical(partages_apres[[i]], partages_avant[[i]])
  expect_false(file.exists(file.path(cible, "indicateurs_demographie.json")))
  expect_false(file.exists(file.path(cible, "histoires_demographie.json")))

  # le fichier de métadonnées, lui, porte la nouvelle valeur (l'upsert de
  # métadonnées ne touche que SA cible)
  relu <- jsonlite::fromJSON(file.path(cible, "theme_demographie.json"),
                             simplifyVector = FALSE)
  expect_identical(relu$label, "Démographie — label modifié")
})

test_that("une collision de thème échoue FORT et n'écrit RIEN", {
  cible <- tempfile("pub-meta-")
  on.exit(unlink(cible, recursive = TRUE))

  # le contenu déclare le fichier d'un AUTRE thème que le run publie : un run
  # Démographie dont les métadonnées déclareraient « habitat » écraserait le
  # fichier d'Habitat — la garde theme_attendu refuse, sans rien écrire
  meta_habitat <- lire_theme_metadata("habitat")
  expect_error(
    publier_theme_metadata(meta_habitat, cible, theme_attendu = "demographie"),
    "collision"
  )
  expect_false(file.exists(file.path(cible, "theme_habitat.json")))
  expect_false(file.exists(file.path(cible, "theme_demographie.json")))
})

test_that("le sixième thème : le canon épinglé de Programmes et subventions publie SON fichier (#408)", {
  cible <- tempfile("pub-meta-")
  on.exit(unlink(cible, recursive = TRUE))

  # Le verdict #408 : Programmes et subventions EST un thème — son canon
  # épinglé passe la même porte que les cinq autres et écrit SON
  # theme_programmes.json (registre d'histoires vide, jamais une lecture
  # inventée). Un contenu qui déclarerait le thème d'un AUTRE échoue toujours.
  meta_programmes <- lire_theme_metadata("programmes")
  expect_no_error(
    publier_theme_metadata(meta_programmes, cible, theme_attendu = "programmes")
  )
  expect_true(file.exists(file.path(cible, "theme_programmes.json")))

  meta <- lire_theme_metadata("demographie")
  meta$theme <- "financements"
  expect_error(publier_theme_metadata(meta, cible), "thème inconnu")
})

# La concordance des directions à la publication (issue #506) : le seam reçoit
# les directions du module et refuse FORT un descripteur qui contredit les
# rangs publiés — sans rien écrire ; les cas concordants publient à l'identique
# (octets stables, aucun changement du payload publié).
test_that("publier_theme_metadata : une direction contradictoire échoue FORT sans rien écrire (#506)", {
  cible <- tempfile("pub-meta-directions-")
  on.exit(unlink(cible, recursive = TRUE))

  # le canon Habitat épinglé, UN descripteur retourné (prix_m2 : le module
  # Habitat déclare « low » — un prix élevé pèse sur l'accès au logement)
  meta_casse <- lire_theme_metadata("habitat")
  meta_casse$indicator_pages$prix_m2$direction <- "high"

  erreur <- expect_error(
    publier_theme_metadata(meta_casse, cible,
                           directions_module = theme_habitat()$directions),
    "indicator_pages\\.prix_m2\\.direction")
  expect_match(conditionMessage(erreur),
               "descripteur (« high »)", fixed = TRUE)
  expect_false(file.exists(file.path(cible, "theme_habitat.json")))
})

test_that("publier_theme_metadata : les cas concordants publient à l'identique — octets stables (#506)", {
  cible_sans <- tempfile("pub-meta-sans-")
  cible_avec <- tempfile("pub-meta-avec-")
  on.exit(unlink(c(cible_sans, cible_avec), recursive = TRUE))

  # le MÊME contenu publié avec et sans la croisée des directions : le happy
  # path est BIT À BIT identique — la garde n'ajoute rien au payload publié
  meta <- lire_theme_metadata("habitat")
  publier_theme_metadata(meta, cible_sans)
  publier_theme_metadata(meta, cible_avec,
                         directions_module = theme_habitat()$directions)

  octets <- function(chemin) {
    readBin(chemin, "raw", n = file.info(chemin)$size)
  }
  expect_identical(
    octets(file.path(cible_avec, "theme_habitat.json")),
    octets(file.path(cible_sans, "theme_habitat.json")))
})

test_that("lire_theme_metadata : un thème sans fichier épinglé s'arrête bruyamment", {
  expect_error(lire_theme_metadata("theme-inexistant"), "introuvable")
})

# #868 — la projection navigateur : le fichier publié ne porte plus les champs
# producer-only (semantic_resources, story_keys, observed_collection_contracts)
# que ni le navigateur ni les lecteurs du payload commité ne lisent ; les clauses
# factuelles conservées (cadrages, libellés, source_records, indicator_pages,
# sources) restent bit-à-bit celles du canon. Le canon extdata reste complet.
test_that("projection_navigateur : le fichier publié exclut les champs hors navigateur et se re-valide", {
  cible <- tempfile("pub-meta-proj-")
  on.exit(unlink(cible, recursive = TRUE))

  for (theme in THEMES_METADATA) {
    meta <- lire_theme_metadata(theme)
    publier_theme_metadata(meta, cible, theme_attendu = theme)
    chemin <- file.path(cible, paste0("theme_", theme, ".json"))
    relu <- jsonlite::fromJSON(chemin, simplifyVector = FALSE)

    # champs producer-only absents du fichier servi au navigateur
    for (champ in CHAMPS_HORS_NAVIGATEUR) {
      expect_false(champ %in% names(relu), info = paste(theme, champ))
    }
    # ces trois contrats sont toujours présents dans le canon producteur, mais
    # ne font pas partie de la projection navigateur (#827).
    for (champ in c("scalar_contracts", "profile_contracts", "map_layers")) {
      expect_false(champ %in% names(relu), info = paste(theme, champ))
      expect_identical(meta[[champ]], lire_theme_metadata(theme)[[champ]],
                       info = paste(theme, champ, "canon producteur inchangé"))
    }
    # le fichier projeté se re-valide via le contexte navigateur explicite, et le
    # contexte producteur strict le refuse (story_keys projeté absent) : la distinction
    # est explicite, jamais devinée par champ absent
    expect_error(valider_projection_navigateur(relu), NA, info = theme)
    expect_error(valider_theme_metadata(relu), "story_keys", info = theme)

    # les déclarations factuelles conservées sont bit-à-bit celles du canon
    # (les sous-groupes perdent seulement leur figure de présentation, app-owned)
    sous_groupes_canon_sans_figure <- lapply(meta$subgroups, function(g) { g$figure <- NULL; g })
    expect_identical(relu$subgroups, sous_groupes_canon_sans_figure, info = theme)
    expect_identical(relu$indicator_labels, meta$indicator_labels, info = theme)
    expect_identical(relu$detail_labels, meta$detail_labels, info = theme)
    expect_identical(relu$source_records, meta$source_records, info = theme)
    expect_identical(relu$indicator_pages, meta$indicator_pages, info = theme)
    expect_identical(relu$sources, meta$sources, info = theme)
    expect_identical(relu$indicator_keys, meta$indicator_keys, info = theme)
    # les deux clauses factuelles retenues (#827) restent servies
    if (theme %in% c("mobilite", "programmes")) {
      cadrages <- vapply(relu$subgroups, function(g) g$framing %||% "", character(1))
      expect_true(any(nzchar(cadrages)), info = theme)
    }
  }
})

test_that("valider_projection_navigateur accepte les exclusions sans relâcher les faits retenus (#827)", {
  meta <- lire_theme_metadata("habitat")
  expect_true(length(meta$scalar_contracts) > 0L)
  expect_true(length(meta$profile_contracts) > 0L)

  projetee <- projection_navigateur(meta)
  expect_false(any(c("scalar_contracts", "profile_contracts", "map_layers") %in%
                     names(projetee)))
  expect_no_error(valider_projection_navigateur(projetee))

  # Une unité factuelle obligatoire reste contrôlée dans le contexte navigateur.
  projetee_invalide <- projetee
  projetee_invalide$indicator_pages$prix_m2$unit <- NULL
  expect_error(valider_projection_navigateur(projetee_invalide),
               "descripteur scalaire est incomplet")
})

test_that("publier_theme_metadata valide encore les contrats canoniques avant leur projection (#827)", {
  meta <- lire_theme_metadata("mobilite")
  meta$map_layers$raccordement_tc <- "oui"
  cible <- tempfile("projection-canon-invalide-")
  on.exit(unlink(cible, recursive = TRUE), add = TRUE)

  expect_error(publier_theme_metadata(meta, cible), "booléen")
  expect_false(file.exists(file.path(cible, "theme_mobilite.json")))
})

# #868 — RED : le canon producteur reste STRICT (contexte par défaut). Un registre
# story_keys absent est une dérive, jamais un « mode navigateur » ; un registre
# vide déclaré n'autorise aucune lecture orpheline.
# #868 RED : un registre story_keys EXPLICITEMENT VIDE ne s'étend jamais au
# portefeuille du thème — une lecture same-theme encore déclarée doit être refusée
# dans les DEUX contextes. (Le test cross-thème ci-dessous échoue indépendamment et
# ne couvrait pas ce contournement.)
test_that("registre story_keys explicitement vide : aucune lecture non déclarée n'est autorisée (#868)", {
  # mobilite a une lecture same-theme déclarée (acces-aux-services)
  avec_lecture <- lire_theme_metadata("mobilite")
  expect_true(any(vapply(avec_lecture$subgroups, function(g) !is.null(g$reading), logical(1))))
  vide_avec_lecture <- avec_lecture
  vide_avec_lecture$story_keys <- list() # [] explicite
  expect_error(valider_theme_metadata(vide_avec_lecture), "histoire|story_keys")
  expect_error(valider_projection_navigateur(vide_avec_lecture), "histoire|story_keys")

  # contrôle : registre vide et AUCUNE lecture déclarée = valide (Programmes, #408)
  vide_sans_lecture <- lire_theme_metadata("programmes")
  vide_sans_lecture$story_keys <- list()
  expect_no_error(valider_theme_metadata(vide_sans_lecture))
  expect_no_error(valider_projection_navigateur(vide_sans_lecture))

  # le registre absent reste : refusé en producteur, accepté (projection) en navigateur
  absent <- avec_lecture
  absent$story_keys <- NULL
  expect_error(valider_theme_metadata(absent), "story_keys")
  expect_no_error(valider_projection_navigateur(absent))
})

test_that("contexte producteur strict : story_keys absent refusé, registre vide + lecture orpheline refusé (#868)", {
  meta <- lire_theme_metadata("demographie")
  sans_registre <- meta
  sans_registre$story_keys <- NULL
  expect_error(valider_theme_metadata(sans_registre), "story_keys")

  # registre vide déclaré (légal, #408) : OK tant qu'aucune lecture n'en sort
  vide_ok <- lire_theme_metadata("programmes")
  expect_no_error(valider_theme_metadata(vide_ok))

  # registre vide + lecture orpheline vers une story d'un AUTRE thème : refusé
  # dans les deux contextes (l'appartenance au portefeuille reste contrôlée)
  orpheline <- vide_ok
  orpheline$subgroups[[1]]$reading <- list(story_key = "vingt-minutes-sans-voiture",
                                          params = list(), template = list())
  expect_error(valider_theme_metadata(orpheline), "cross-thème|story_keys|histoire")
  expect_error(valider_projection_navigateur(orpheline), "cross-thème|story_keys|histoire")

  # la projection navigateur accepte bien l'objet allégé servi (figure absente)
  projete <- projection_navigateur(meta)
  expect_error(valider_projection_navigateur(projete), NA)
  expect_error(valider_theme_metadata(projete), "story_keys")
})

test_that("la parité registre ↔ métadonnées : chaque thème déclare les stories que sa résolution peut émettre", {
  # La parité bidirectionnelle du contrat (#316) : le fichier épinglé
  # theme_<theme>.json déclare EXACTEMENT les story_keys du registre de
  # résolution (STORIES_RESOLUES_PAR_THEME) — ni moins (une story résolue
  # non déclarée : le pool Mobilité qui publierait « ce-que-le-velo-preserve »
  # sans le déclarer) ni plus (une story déclarée que la résolution ne peut
  # jamais émettre). Le registre est la source de vérité de ce que le
  # pipeline peut résoudre ; les métadonnées déclarent ce que la fiche lit.
  # #408 : Programmes n'a ni story déclarée ni registre de résolution — le
  # thème sans lecture fait la preuve des deux côtés vides.
  for (theme in THEMES_METADATA) {
    meta <- lire_theme_metadata(theme)
    declarees <- unlist(meta$story_keys, use.names = FALSE)
    resolvables <- STORIES_RESOLUES_PAR_THEME[[theme]]$story_key
    expect_true(setequal(declarees, resolvables), info = theme)
  }
})
