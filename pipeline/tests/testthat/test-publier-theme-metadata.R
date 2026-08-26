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
#   - publier les métadonnées ne recompute NI ne réécrit les tables de faits :
#     l'étape n'écrit QUE theme_<theme>.json (les fichiers indicateurs_/
#     histoires_/territoires restent byte-identical) ;
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

    # le fichier publié se relit et se re-valide (la forme du contrat #309) —
    # le JSON publié est exactement ce que l'app lira
    relu <- jsonlite::fromJSON(chemin, simplifyVector = FALSE)
    expect_error(valider_theme_metadata(relu), NA, info = theme)
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

  # 1) les faits du thème sont publiés (publish réel, le payload du fixture)
  payload <- compute_payload(load_fixture())
  publish(payload, cible)
  octets <- function(fichier) {
    readBin(file.path(cible, fichier), "raw",
            n = file.info(file.path(cible, fichier))$size)
  }
  faits_avant <- lapply(c("indicateurs_demographie.json",
                          "indicateurs_demographie.parquet",
                          "histoires_demographie.json",
                          "histoires_demographie.parquet",
                          "territoires.json"), octets)

  # 2) la publication des métadonnées — un contenu DIFFÉRENT du précédent
  meta <- lire_theme_metadata("demographie")
  publier_theme_metadata(meta, cible)
  meta$label <- "Démographie — label modifié"
  publier_theme_metadata(meta, cible)

  # les tables de faits restent byte-identical : l'étape métadonnées n'écrit
  # QUE theme_<theme>.json, jamais un recompute ni une réécriture des faits
  faits_apres <- lapply(c("indicateurs_demographie.json",
                          "indicateurs_demographie.parquet",
                          "histoires_demographie.json",
                          "histoires_demographie.parquet",
                          "territoires.json"), octets)
  for (i in seq_along(faits_avant)) expect_identical(faits_apres[[i]], faits_avant[[i]])

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
