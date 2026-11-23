# helper-programmes-scdl --------------------------------------------------------
# Le 2026-11-23 la nomenclature SCDL a changé (issue #1151) : la déclaration
# épinglée porte les 43 domaines courants, alors que le Parquet producteur
# retenu (vintage 2026-08-05) reste une snapshot des 39 anciens domaines.
# Ces gardes de test ne fabriquent pas de faits : elles ramènent les détails
# de la snapshot au vocabulaire courant pour vérifier qu'aucun détail publié
# n'est inconnu de la déclaration. La parité inverse (43 déclarés ↔ source)
# est verrouillée par test-theme-programmes-domaines-scdl.R et par le garde
# d'exécution project_programme_period_details().

# Les quatre renommages adoptés : le nouveau domaine prend la place de son
# prédécesseur dans l'ordre éditorial de theme_programmes.json.
RENOMS_DOMAINES_SCDL <- c(
  "Accompagnement des investissements immobiliers des établissements privés" =
    "Accompagnement des investissements des établissements privés",
  "Contractualisation avec les territoires" = "Soutien au développement local",
  "Formations sanitaires et sociales" = "Formations sanitaires et sociales et santé",
  "Infrastructures de mobilités" = "Infrastructures de mobilités, matériels et gares"
)

# Les trois domaines retirés du jeu source, encore présents dans la snapshot.
DOMAINES_SCDL_RETIRES_SNAPSHOT <- c(
  "Formation qualifiante",
  "Projets individuels de formation et qualification",
  "Vie des stagiaires de la formation professionnelle"
)

detail_scdl_courant <- function(detail) {
  detail <- as.character(detail)
  map <- unname(RENOMS_DOMAINES_SCDL[detail])
  out <- detail
  remplaces <- !is.na(map)
  out[remplaces] <- map[remplaces]
  out
}

# Détails de la snapshot ramenés au vocabulaire courant, moins les domaines
# retirés. Ce qui reste DOIT être déclaré — sinon la snapshot a dérivé sans
# que la déclaration suive.
details_scdl_snapshot <- function(details) {
  courants <- detail_scdl_courant(details)
  setdiff(unique(courants), DOMAINES_SCDL_RETIRES_SNAPSHOT)
}
