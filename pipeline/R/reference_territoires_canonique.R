# reference_territoires_canonique ---------------------------------------------
# La référence des territoires est une DIMENSION (#1056, option B), pas le
# reflet de la table de faits du dernier thème publié. Elle est construite UNE
# fois depuis la base INSEE épinglée (lire_epci — 1 202 communes bretonnes)
# et le registre de population épinglé qui porte l'univers communal canonique,
# puis les classifications communales y sont appliquées. Chaque thème publie
# exactement cette projection, indépendamment de ses propres lignes de faits :
# un thème plus étroit (Milieux, 1 200 communes — les deux îles absentes de
# conso-com.csv) ne réduit jamais la référence et n'invente pas de faits
# insulaires. Le même nom public et la même règle de pluralité départementale
# que dans le squelette partagé sont réutilisés : aucune seconde autorité,
# aucun libellé maison, aucune exception insulaire.

POPULATION_COMMUNES_FICHIER <- "population_communes_2023.csv"

# lire_population_communes_canonique -------------------------------------------
# Le registre épinglé (code_commune, population) : l'univers des 1 202 communes
# canoniques ET le poids de la pluralité départementale des EPCI. C'est la même
# épingle que celle déjà consommée par le producteur AEDAR — jamais une seconde
# source de vérité. `population` est explicitement require en entrée pour que
# les tests puissent injecter une épingle synthétique sans toucher au paquet.
lire_population_communes_canonique <- function(chemin = NULL) {
  if (is.null(chemin)) {
    chemin <- system.file("extdata", POPULATION_COMMUNES_FICHIER,
                          package = "lusk")
    if (!nzchar(chemin) || !file.exists(chemin)) {
      chemin <- file.path("inst", "extdata", POPULATION_COMMUNES_FICHIER)
    }
  }
  if (!file.exists(chemin)) {
    stop("Univers communal canonique introuvable : ", chemin, ".",
         call. = FALSE)
  }
  population <- readr::read_csv(
    chemin,
    col_types = readr::cols(.default = readr::col_character()),
    show_col_types = FALSE,
    progress = FALSE
  )
  requis <- c("code_commune", "population")
  manquants <- setdiff(requis, names(population))
  if (length(manquants) > 0L) {
    stop("Univers communal canonique invalide : colonne(s) absente(s) : ",
         paste(manquants, collapse = ", "), ".", call. = FALSE)
  }
  codes <- trimws(as.character(population$code_commune))
  if (length(codes) == 0L || anyNA(codes) || any(!grepl("^[0-9]{5}$", codes))) {
    stop("Univers communal canonique invalide : code(s) communal(aux) mal formé(s).",
         call. = FALSE)
  }
  if (anyDuplicated(codes)) {
    stop("Univers communal canonique invalide : doublon communal.",
         call. = FALSE)
  }
  poids <- suppressWarnings(as.numeric(population$population))
  if (anyNA(poids)) {
    stop("Univers communal canonique invalide : population non numérique.",
         call. = FALSE)
  }
  tibble::tibble(code_commune = codes, population = poids)
}

# codes_communes_canoniques ----------------------------------------------------
# Les codes de l'univers canonique — l'univers que les crosswalks de
# classification doivent couvrir EXACTEMENT, indépendamment de la table de
# faits à laquelle on les applique.
codes_communes_canoniques <- function(population = NULL) {
  if (is.null(population)) population <- lire_population_communes_canonique()
  as.character(population$code_commune)
}

# squelette_territoires_canonique ----------------------------------------------
# Le squelette canonique : communes + EPCI + départements + région, dans
# l'ordre de l'univers épinglé, avec les vrais noms de la base INSEE et la
# règle de pluralité départementale pesée par la population épinglée. La base
# doit couvrir EXACTEMENT l'univers canonique : une commune manquante (les
# deux îles) ou un code fantôme échoue fort — c'est la garde qui rend la
# publication fail-closed.
squelette_territoires_canonique <- function(base_epci, population = NULL,
                                            noms_epci_geo_api = NULL) {
  requis <- c("CODGEO", "LIBGEO", "EPCI", "LIBEPCI", "DEP")
  if (!is.data.frame(base_epci) || !all(requis %in% names(base_epci))) {
    stop("Base EPCI invalide : colonne(s) absente(s) : ",
         paste(setdiff(requis, names(base_epci)), collapse = ", "), ".",
         call. = FALSE)
  }
  if (is.null(population)) population <- lire_population_communes_canonique()
  codes <- codes_communes_canoniques(population)
  presents <- as.character(base_epci$CODGEO)
  manquants <- setdiff(codes, presents)
  if (length(manquants) > 0L) {
    stop(
      "Univers canonique incomplet : la base EPCI ne couvre pas les commune(s) ",
      paste(sort(manquants), collapse = ", "), " — aucune commune canonique ",
      "ne peut être absente du squelette de référence.",
      call. = FALSE
    )
  }
  surnumeraires <- setdiff(presents, codes)
  if (length(surnumeraires) > 0L) {
    stop(
      "Univers canonique en désaccord : code(s) communal(aux) de la base EPCI ",
      "hors de l'épingle : ", paste(sort(surnumeraires), collapse = ", "), ".",
      call. = FALSE
    )
  }

  lignes <- base_epci[match(codes, presents), , drop = FALSE]
  communes <- tibble::tibble(
    code = codes,
    nom = as.character(lignes$LIBGEO),
    departement = as.character(lignes$DEP),
    epci = as.character(lignes$EPCI),
    nom_epci = as.character(lignes$LIBEPCI),
    population = population$population[match(codes, population$code_commune)]
  )
  squelette_territoires(communes, poids = "population",
                        noms_epci_geo_api = noms_epci_geo_api)
}

# reference_territoires_canonique ----------------------------------------------
# LE seam de publication de la dimension : squelette canonique -> classifications
# appliquées là (et non sur les faits d'un thème) -> projection de référence.
# `reference_territoires` reste l'unique projecteur (une seule règle de forme),
# ce qui garantit une projection identique pour tous les thèmes.
reference_territoires_canonique <- function(base_epci,
                                            classes_densite = NULL,
                                            classes_littoral = NULL,
                                            population = NULL,
                                            noms_epci_geo_api = NULL) {
  squelette <- squelette_territoires_canonique(
    base_epci, population = population, noms_epci_geo_api = noms_epci_geo_api
  )
  squelette <- appliquer_classifications_communales(
    squelette,
    classes_densite = classes_densite,
    classes_littoral = classes_littoral
  )
  reference_territoires(squelette)
}
