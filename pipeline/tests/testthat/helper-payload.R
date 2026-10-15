# helper-payload ---------------------------------------------------------------
# Accès de test au payload tabulaire : les lignes d'un indicateur pour un
# territoire (et une tranche de détail, pour la structure par âge).
valeur_payload <- function(payload, territoire, key, detail = NULL) {
  tab <- payload$indicateurs
  lignes <- tab[tab$territoire == territoire & tab$key == key, , drop = FALSE]
  if (!is.null(detail)) {
    lignes <- lignes[lignes$detail == detail, , drop = FALSE]
  }
  lignes
}

# verifier_non_derivee ----------------------------------------------------------
# Le contrat de non-dérive (issue #10, ADR-0004) : le JSON se relit EXACTEMENT
# comme les tables parquet — colonne pour colonne, valeur pour valeur (bit à
# bit). Le texte JSON d'un entier relu par jsonlite est un entier (70) quand
# le parquet le relit en double (70) — une différence de STOCKAGE, pas de
# valeur ; en double (as.numeric), l'aller-retour à digits = 17 est identique.
# Issue #131 : une colonne ENTIÈREMENT NA (ex. `detail` du payload Économie,
# dont les trois clés sont scalaires) est relue par jsonlite en LOGICAL (un
# tableau JSON de null ne porte aucune chaîne pour inférer le type) quand le
# parquet la relit en CHARACTER — deux encodages de la MÊME information :
# une colonne sans aucune valeur n'a pas de type à préserver, les deux
# sérialisations sont égales.
verifier_non_derivee <- function(parquet, json, nom) {
  # colonne pour colonne : le même ordre, les mêmes noms
  testthat::expect_identical(names(json), names(parquet), info = nom)
  testthat::expect_equal(nrow(json), nrow(parquet), info = nom)
  for (col in names(parquet)) {
    if (is.numeric(parquet[[col]])) {
      testthat::expect_identical(as.numeric(json[[col]]), as.numeric(parquet[[col]]),
                                 info = paste(nom, col))
    } else if (all(is.na(parquet[[col]])) && all(is.na(json[[col]]))) {
      # colonne entièrement NA : l'inférence de type de jsonlite diffère (null →
      # logical vs character) — la valeur est identique (rien à préserver)
      testthat::expect_equal(length(json[[col]]), length(parquet[[col]]),
                             info = paste(nom, col))
    } else {
      testthat::expect_identical(json[[col]], parquet[[col]], info = paste(nom, col))
    }
  }
}

# verifier_projection_sur_table -------------------------------------------------
# Le contrat de non-dérive (issue #10, ADR-0004) appliqué à la projection JSON
# SEULE. Depuis #757, la sérialisation parquet par-thème est retirée pour les
# cinq thèmes non-mobilité : il n'y a plus de parquet par-thème à relire en
# retour. La projection JSON se compare donc directement à la table EN MÉMOIRE
# dont elle est issue — même rigueur, colonne pour colonne, valeur pour valeur.
verifier_projection_sur_table <- function(table, json, nom) {
  verifier_non_derivee(table, json, nom)
}

# lire_indicateurs_commis -------------------------------------------------------
# Les faits canoniques d'un thème depuis le snapshot commis (public/data). #757 :
# la Mobilité garde son parquet de faits (#619) ; les cinq thèmes non-mobilité
# ne sont plus servis qu'en JSON — leur projection commise, paritaire (ADR-0004),
# sert de source de fixture producteur. La bascule est dérivée du prédicat
# theme_parquet_retire(), jamais d'une liste recopiée.
lire_indicateurs_commis <- function(theme,
                                    public = file.path(pkgload::pkg_path(), "..", "public", "data")) {
  if (theme_parquet_retire(theme)) {
    jsonlite::fromJSON(file.path(public, paste0("indicateurs_", theme, ".json")),
                       simplifyVector = TRUE)
  } else {
    nanoparquet::read_parquet(file.path(public, paste0("indicateurs_", theme, ".parquet")))
  }
}

# lire_histoires_commis ---------------------------------------------------------
# Même contrat que lire_indicateurs_commis, pour la table des histoires d'un
# thème (voir #757).
lire_histoires_commis <- function(theme,
                                  public = file.path(pkgload::pkg_path(), "..", "public", "data")) {
  if (theme_parquet_retire(theme)) {
    jsonlite::fromJSON(file.path(public, paste0("histoires_", theme, ".json")),
                       simplifyVector = TRUE)
  } else {
    nanoparquet::read_parquet(file.path(public, paste0("histoires_", theme, ".parquet")))
  }
}
