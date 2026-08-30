# publier_theme_metadata --------------------------------------------------------
# Le seam de publication des métadonnées par thème (issue #311, parent #308) :
# la publication des fichiers theme_<theme>.json que l'app lit — à côté des
# tables de faits (indicateurs_/histoires_/territoires, publish.R), jamais un
# recompute : l'étape n'écrit QUE theme_<theme>.json.
#
# Ce qui vit ici :
#   - lire_theme_metadata : le lecteur du fichier épinglé sous
#     inst/extdata/theme-metadata/theme_<theme>.json (le contrat #309, la même
#     forme que l'app valide côté TypeScript — jamais une seconde grammaire).
#     `chemin` permet aux tests de passer une copie corrompue ; par défaut, la
#     ressource épinglée du package (system.file — résolue aussi sous pkgload,
#     le précédent artefact_egss.R). Un thème sans fichier épinglé (Programmes,
#     ADR-0013 — un contrat de publication SÉPARÉ) s'arrête bruyamment : jamais
#     un fichier theme_programmes.json fabriqué ;
#   - publier_theme_metadata : le seam — valide le contenu (valider_theme_
#     metadata, theme_metadata.R — le contrat #309, sources croisées contre les
#     vintages quand la table est passée (le run réel), DIRECTIONS croisées
#     contre le registre du module de thème (#506) quand il est passé) puis
#     écrit le fichier.
#     Le nom du fichier dérive du thème VALIDÉ du contenu, jamais d'un
#     paramètre : la machinerie ne peut pas écrire le fichier d'un autre thème.
#     La garde `theme_attendu` (le thème du payload, passée par run_pipeline)
#     refuse FORT une collision — un contenu qui déclarerait le fichier d'un
#     autre thème échoue sans rien écrire (un thème ne peut JAMAIS clobber le
#     fichier d'un autre).

# lire_theme_metadata -----------------------------------------------------------
# Le lecteur du fichier épinglé de métadonnées du thème : le JSON canonique
# sous inst/extdata/theme-metadata/theme_<theme>.json.
lire_theme_metadata <- function(theme, chemin = NULL) {
  if (is.null(chemin)) {
    chemin <- system.file("extdata", "theme-metadata",
                          paste0("theme_", theme, ".json"),
                          package = "lusk")
  }
  if (is.na(chemin) || !nzchar(chemin) || !file.exists(chemin)) {
    stop(sprintf(
      paste0(
        "Métadonnées du thème — « %s » : fichier épinglé theme_%s.json ",
        "introuvable sous inst/extdata/theme-metadata/ — jamais un fichier de ",
        "métadonnées fabriqué à la volée."
      ),
      theme, theme
    ), call. = FALSE)
  }
  jsonlite::fromJSON(chemin, simplifyVector = FALSE)
}

# publier_theme_metadata --------------------------------------------------------
# Le seam de publication : valide, puis écrit theme_<theme>.json (le nom du
# thème validé du contenu). La garde theme_attendu refuse la collision ;
# directions_module (theme_<theme>()$directions) branche la croisée des
# directions descripteur ↔ module (#506) — NULL chez le thème qui ne classe
# pas (Programmes, des rangs tous NA), la règle ne vit que là où LES DEUX
# déclarations existent.
publier_theme_metadata <- function(metadata, sortie = "public/data",
                                   vintages = NULL, theme_attendu = NULL,
                                   directions_module = NULL) {
  valider_theme_metadata(metadata, vintages = vintages,
                         directions_module = directions_module)
  if (!is.null(theme_attendu) && !identical(metadata$theme, theme_attendu)) {
    stop(sprintf(
      paste0(
        "Métadonnées du thème — collision : le contenu déclare le thème « %s » ",
        "mais le run publie « %s » — un thème ne peut écrire que SON fichier ",
        "theme_<theme>.json."
      ),
      metadata$theme, theme_attendu
    ), call. = FALSE)
  }
  if (!dir.exists(sortie)) dir.create(sortie, recursive = TRUE)
  # digits = 17 : la même discipline que publish (ADR-0004) — un contenu relu
  # en JSON est BIT À BIT le contenu validé en mémoire. auto_unbox = TRUE :
  # les scalaires (theme, label, ...) sortent en scalaires — jamais la forme
  # ["demographie"] que write_json donnerait à une liste — tandis que les
  # tableaux (story_keys, indicator_keys, template, ...) restent des tableaux
  # (la forme que l'app valide, types.ts).
  jsonlite::write_json(
    metadata,
    file.path(sortie, paste0("theme_", metadata$theme, ".json")),
    dataframe = "rows", na = "null", digits = 17, pretty = TRUE,
    auto_unbox = TRUE
  )
  invisible(metadata)
}
