# vintage ---------------------------------------------------------------------
# Étape 4 : vintages. Écrit source / version / licence / dates pour chaque jeu
# de données, depuis le manifeste — la table des fraîcheurs et le SEAM du
# watchdog (ADR-0001 : la licence y figure). Deux dates par source (point 5) :
# date_reference (ce que « RP 2023 » veut dire) et date_publication (la mise
# en ligne réelle — ce que le watchdog comparera à data.gouv pour déclencher
# le pipeline). `id` reste dans la table pour un pointage explicite par source.
# Issue #13 : le build des vintages est générique — il se projette depuis le
# manifeste DU THÈME ; le module du thème expose son builder (vintages_<theme>)
# qui passe son propre manifeste.

vintages_depuis_manifest <- function(manifest) {
  manifest %>%
    dplyr::transmute(
      id = id,
      source = source,
      version = vintage,
      licence = licence,
      date_reference = date_reference,
      date_publication = date_publication
    )
}

# fusionner_vintages -----------------------------------------------------------
# Issue #124 : la table des vintages est PARTAGÉE (pas par-thème) — un run doit
# FUSIONNER ses sources dans la table déjà sur disque au lieu d'écraser le
# fichier commun avec les seules sources de son thème (last-writer-wins par
# thème, le même bug que #116 a corrigé pour apercu). Sémantique d'upsert par
# source : lire l'existante (le parquet canonique, ADR-0004) si présente,
# bind_rows avec les vintages du thème — les sources du run sont les plus
# fraîches et gagnent sur leur id — puis dédupliquer par `id`. Une source ne
# disparaît jamais de la table partagée parce qu'un autre thème a tourné.
# Issue #243 : `retires` — les ids que le thème ne déclare PLUS (sa source a
# été remplacée dans son manifeste, ex. les quatre différentielles OCS-GE
# sorties par l'amendement) sont RETIRÉS de la table partagée : une source
# remplacée ne doit pas rester estampillée « fraîche » à côté de son
# remplaçante. Déclaré par le thème (retire_vintages du descripteur), jamais
# inféré — le thème sait quelles sources il a retirées.
fusionner_vintages <- function(vintages, sortie = "public/data",
                               retires = character(0)) {
  chemin <- file.path(sortie, "vintages.parquet")
  if (!file.exists(chemin)) {
    return(vintages)
  }
  existantes <- nanoparquet::read_parquet(chemin)
  existantes <- existantes[!existantes$id %in% retires, ]
  dplyr::bind_rows(vintages, existantes) %>%
    dplyr::distinct(id, .keep_all = TRUE)
}
