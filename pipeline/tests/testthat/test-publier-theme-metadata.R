# test-publier-theme-metadata ---------------------------------------------------
# L'issue #311 : la publication des métadonnées par thème (theme_<theme>.json).
# Chaque thème construit éPINGLE son fichier de métadonnées sous
# inst/extdata/theme-metadata/ (le contrat #309, la même forme que l'app
# valide côté TypeScript) ; run_pipeline le publie vers la cible que l'app lit
# par le seam publier_theme_metadata. Ce qui est verrouillé ici (acceptance
# #311) :
#   - les CINQ thèmes construits publient chacun theme_<thème>.json, relu
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
#   - Programmes & financements n'a PAS de métadonnées : jamais un fichier
#     theme_programmes.json fabriqué (testé dans test-publish-programmes.R).

# publier_metadata_theme --------------------------------------------------------
# Le run réel minimal du seam : les métadonnées épinglées du thème, ses
# vintages réels (projections pures du manifeste — déterministe).
publier_metadata_theme <- function(theme, cible) {
  descripteur <- get(paste0("theme_", theme))()
  publier_theme_metadata(descripteur$metadata(), cible,
                         vintages = descripteur$vintages(),
                         theme_attendu = theme)
}

test_that("les cinq thèmes publient theme_<thème>.json — relu valide, sources croisées avec leurs vintages", {
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

test_that("la frontière Programmes : jamais un fichier theme_programmes.json fabriqué", {
  cible <- tempfile("pub-meta-")
  on.exit(unlink(cible, recursive = TRUE))

  # le validateur (#309) refuse le thème « programmes » — le seam hérite de la
  # frontière : un contenu qui déclarerait Programmes échoue, rien n'est écrit
  meta <- lire_theme_metadata("demographie")
  meta$theme <- "programmes"
  expect_error(publier_theme_metadata(meta, cible), "SÉPARÉ")
  expect_false(file.exists(file.path(cible, "theme_programmes.json")))
})

test_that("lire_theme_metadata : un thème sans fichier épinglé s'arrête bruyamment", {
  expect_error(lire_theme_metadata("programmes"), "introuvable")
  expect_error(lire_theme_metadata("theme-inexistant"), "introuvable")
})
