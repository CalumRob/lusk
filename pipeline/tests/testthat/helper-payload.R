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

# payload_producteur_fixture ----------------------------------------------------
# Fixture seam des tests : les cinq thèmes sans Parquet de faits thématique sont
# produits par leurs builders avec les fixtures d'entrée déjà présentes dans
# testthat. Mobilité reste l'unique exception avec ses Parquets conservés
# (#619). Programmes reprend ses deux Parquets d'entrée conservés puis appelle
# le vrai builder des faits ; aucun ancien JSON numérique ni RDS de secours.
payload_producteur_fixture <- function(
    theme,
    public = file.path(pkgload::pkg_path(), "..", "public", "data")) {
  if (!is.character(theme) || length(theme) != 1L || is.na(theme) || !nzchar(theme))
    stop("Producer fixture theme is required", call.=FALSE)
  if (!theme %in% THEMES_METADATA)
    stop("Unknown producer fixture theme: ", theme, call.=FALSE)

  switch(theme,
    demographie = compute_payload(load_fixture()),
    habitat = payload_habitat(),
    economie = construire_payload_economie(
      fixture_analytiques_economie(), base_epci_economie, vintages_economie()),
    milieux = compute_payload(
      communes_fixture_milieux_ocsge(), theme=theme_milieux()),
    mobilite = list(
      indicateurs=nanoparquet::read_parquet(
        file.path(public, "indicateurs_mobilite.parquet")),
      histoires=nanoparquet::read_parquet(
        file.path(public, "histoires_mobilite.parquet"))),
    programmes = {
      membres_path <- file.path(public, "programmes_membres.parquet")
      subventions_path <- file.path(public, "programmes_subventions.parquet")
      if (!file.exists(membres_path) || !file.exists(subventions_path))
        stop("Retained Programmes producer Parquets are required", call.=FALSE)
      list(indicateurs=construire_indicateurs_programmes(
        nanoparquet::read_parquet(membres_path),
        nanoparquet::read_parquet(subventions_path)))
    }
  )
}

lire_faits_producteur_fixture <- function(
    theme, kind,
    public = file.path(pkgload::pkg_path(), "..", "public", "data")) {
  if (!kind %in% c("indicateurs", "histoires"))
    stop("Producer fixture kind must be 'indicateurs' or 'histoires'", call.=FALSE)
  payload <- payload_producteur_fixture(theme, public)
  value <- payload[[kind]]
  if (is.null(value))
    stop("Producer fixture has no ", kind, " table for theme ", theme, call.=FALSE)
  value
}

lire_indicateurs_producteur_fixture <- function(theme, public = file.path(
    pkgload::pkg_path(), "..", "public", "data")) {
  lire_faits_producteur_fixture(theme, "indicateurs", public)
}

lire_histoires_producteur_fixture <- function(theme, public = file.path(
    pkgload::pkg_path(), "..", "public", "data")) {
  lire_faits_producteur_fixture(theme, "histoires", public)
}

territoires_producteur_fixture <- function(themes, public = file.path(
    pkgload::pkg_path(), "..", "public", "data")) {
  canonical <- nanoparquet::read_parquet(file.path(public, "territoires.parquet"))
  tables <- lapply(themes, function(theme)
    payload_producteur_fixture(theme, public)$territoires)
  tables <- Filter(is.data.frame, tables)
  id_column <- if ("territoire" %in% names(canonical)) "territoire" else "code"
  if (id_column == "code") names(canonical)[names(canonical) == "code"] <- "territoire"
  tables <- lapply(tables, function(table) {
    if (!"territoire" %in% names(table) && "code" %in% names(table))
      names(table)[names(table) == "code"] <- "territoire"
    table
  })
  combined <- dplyr::bind_rows(canonical, tables)
  combined <- combined[!duplicated(as.character(combined$territoire)), , drop=FALSE]
  rownames(combined) <- NULL
  combined
}
