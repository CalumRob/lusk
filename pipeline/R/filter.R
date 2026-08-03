# filter ----------------------------------------------------------------------
# Étape 2 : filtrage + remodelage. Garde la Bretagne (22 · 29 · 35 · 56) et
# transforme les fichiers longs INSEE (GEO/RP_MEASURE/.../OBS_VALUE) en la
# forme du contrat de compute (le fixture).
# Issue #13 : la construction des données EST spécifique au thème — elle vit
# dans le module du thème (theme_demographie.R). Ici ne restent que les pièces
# partagées : le filtre Bretagne et le lecteur CSV long.

DEPT_BRETAGNE <- c("22", "29", "35", "56")

filter_bretagne <- function(donnees) {
  donnees %>%
    dplyr::mutate(departement = as.character(departement)) %>%
    dplyr::filter(departement %in% DEPT_BRETAGNE)
}

# Le lecteur CSV long INSEE (GEO/RP_MEASURE/.../OBS_VALUE) — partagé par les
# thèmes qui lisent les fichiers longs du recensement. Non testé dans la boucle
# (comme le téléchargement) : il lit les vrais fichiers. Les pivots, eux, sont
# testés sur la forme réelle (test-reshape.R).
lire_csv_long <- function(chemin) {
  readr::read_delim(
    chemin, delim = ";",
    col_types = readr::cols(
      .default = readr::col_character(),
      TIME_PERIOD = readr::col_double(),
      OBS_VALUE = readr::col_double()
    ),
    show_col_types = FALSE, progress = FALSE
  )
}
