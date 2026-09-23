# resoudre_contextes_comparaison -----------------------------------------------
# Un seul endroit décide de l'identité des contextes : mode, périmètre,
# libellé et membres. Les projections analytiques ajoutent leurs propres
# mesures, mais ne peuvent pas réinventer ces décisions.
resoudre_contextes_comparaison <- function(reference, cible, type) {
  colonne_presente <- function(nom) nom %in% names(reference)
  valeur_cible <- function(nom) {
    if (!colonne_presente(nom)) return(NA_character_)
    as.character(cible[[nom]][[1L]])
  }
  est_plein <- function(valeur) {
    !is.na(valeur) && nzchar(valeur)
  }
  codes <- function(membres) {
    unique(as.character(reference$territoire[membres]))
  }

  contextes <- list()
  if (type == "commune" &&
      all(c("classe_densite_code", "classe_densite_libelle_public") %in%
          names(reference))) {
    code <- valeur_cible("classe_densite_code")
    label <- valeur_cible("classe_densite_libelle_public")
    if (est_plein(code) && est_plein(label)) {
      contextes$densite <- list(
        mode = "densite",
        kind = "communes-densite",
        label = label,
        member_type = "commune-densite",
        member_code = code,
        member_selector = "classe_densite",
        members = codes(
          reference$type == "commune" &
            as.character(reference$classe_densite_code) == code
        )
      )
    }
  }

  epci <- valeur_cible("epci")
  if (type == "commune" && est_plein(epci)) {
    nom_epci <- reference$nom[
      reference$type == "epci" &
        as.character(reference$territoire) == epci
    ]
    label <- if (length(nom_epci) == 1L) {
      paste("communes de", nom_epci[[1L]])
    } else {
      "communes de l'EPCI"
    }
    contextes$epci <- list(
      mode = "epci",
      kind = "communes-epci",
      label = label,
      member_type = "commune-epci",
      member_code = epci,
      member_selector = "commune-epci",
      members = codes(
        reference$type == "commune" &
          !is.na(reference$epci) &
          as.character(reference$epci) == epci
      )
    )
  }

  regional <- switch(
    type,
    commune = list(
      kind = "communes-bretagne",
      label = "communes bretonnes",
      member_type = "commune",
      member_selector = "commune"
    ),
    epci = list(
      kind = "epcis-bretagne",
      label = "EPCI bretons",
      member_type = "epci",
      member_selector = "epci"
    ),
    departement = list(
      kind = "departements-bretagne",
      label = "départements bretons",
      member_type = "departement",
      member_selector = "departement"
    ),
    NULL
  )
  if (!is.null(regional)) {
    contextes$bretagne <- list(
      mode = "bretagne",
      kind = regional$kind,
      label = regional$label,
      member_type = regional$member_type,
      member_code = NA_character_,
      member_selector = regional$member_selector,
      members = codes(reference$type == regional$member_type)
    )
  }

  contextes
}
