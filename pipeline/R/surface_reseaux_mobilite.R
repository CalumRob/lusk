# surface_reseaux_mobilite ------------------------------------------------------
# La surface du réseau routier (issue #552) : un fait séparé de `reseaux`,
# construit depuis l'usage OCS-GE US4.1.1. Le statut `artif` n'est pas un filtre
# ici : il répond à la question réglementaire de l'artificialisation, pas à la
# question d'occupation du territoire par un réseau routier.

CODE_US_RESEAU_ROUTIER <- "US4.1.1"

# normaliser_ocsge_reseaux_routiers --------------------------------------------
# La normalisation de la couche OCS-GE brute : les codes de couverture/usage et
# la mesure `aire` traversent le seam. Le champ `artif` du produit
# d'artificialisation est volontairement absent de la sortie : il appartient à
# une autre question métier et ne décide pas de la surface d'un réseau routier.
normaliser_ocsge_reseaux_routiers <- function(etat, departement) {
  if (!inherits(etat, "sf")) {
    stop("Surface réseau routier corrompue — la couche OCS-GE doit être un objet sf.",
         call. = FALSE)
  }
  requises <- c("code_us", "aire", "millesime")
  manquantes <- setdiff(requises, names(etat))
  if (length(manquantes) > 0) {
    stop("Surface réseau routier corrompue — colonne(s) OCS-GE manquante(s) : ",
         paste(manquantes, collapse = ", "), ".", call. = FALSE)
  }
  departement <- as.character(departement)
  if (length(departement) != 1L ||
      !grepl("^[0-9]{2}$", departement)) {
    stop("Surface réseau routier corrompue — département invalide : ",
         departement, ".", call. = FALSE)
  }
  if (nrow(etat) == 0L) {
    stop("Surface réseau routier corrompue — aucune ligne OCS-GE.",
         call. = FALSE)
  }

  code_us <- as.character(etat$code_us)
  aire <- as.numeric(etat$aire)
  millesimes <- unique(as.character(etat$millesime))
  if (any(is.na(code_us) | !nzchar(code_us))) {
    stop("Surface réseau routier corrompue — code_us absent.", call. = FALSE)
  }
  if (any(is.na(aire) | !is.finite(aire) | aire <= 0)) {
    stop("Surface réseau routier corrompue — aire doit être positive et présente.",
         call. = FALSE)
  }
  if (length(millesimes) != 1L ||
      !grepl("^[0-9]{4}$", millesimes[[1]])) {
    stop("Surface réseau routier corrompue — un seul millésime AAAA est attendu.",
         call. = FALSE)
  }

  # Keep the normalizer cheap: most OCS-GE polygons are irrelevant to this
  # indicator and geometry repair happens after the US4.1.1 filter at the
  # spatial seam.
  geometrie <- sf::st_transform(sf::st_geometry(etat), 2154)
  donnees <- tibble::tibble(
    code_us = code_us,
    aire_m2 = aire,
    millesime = as.integer(millesimes[[1]]),
    departement = rep(departement, nrow(etat))
  )
  if ("code_cs" %in% names(etat)) {
    donnees$code_cs <- as.character(etat$code_cs)
  }
  sf::st_sf(donnees, geometry = geometrie)
}

# construire_donnees_ocsge_reseaux_routiers ------------------------------------
# Le builder des états courants OCS-GE : une archive par département, les
# couches sont lues dans leur ordre de manifeste puis concaténées. Le
# département et le millésime sont des faits contrôlés par l'id de la source ;
# une archive déplacée sous un mauvais nom arrête le run.
construire_donnees_ocsge_reseaux_routiers <- function(
    cache = "data/raw",
    manifest,
    extrait = file.path(cache, "extracted", "ocsge")) {
  if (!inherits(manifest, "tbl_df") ||
      !all(c("id", "fichier") %in% names(manifest))) {
    stop("Surface réseau routier corrompue — le manifeste doit porter id et ",
         "fichier.", call. = FALSE)
  }

  ids <- manifest$id[grepl("^ocsge_reseaux_[0-9]{2}_[0-9]{4}$",
                           manifest$id)]
  if (length(ids) == 0L || anyDuplicated(ids)) {
    stop("Surface réseau routier corrompue — le manifeste doit porter au moins",
         " une source OCS-GE par département, avec des ids uniques.",
         call. = FALSE)
  }

  donnees <- lapply(ids, function(id) {
    ligne <- manifest[manifest$id == id, , drop = FALSE]
    departement <- sub("^ocsge_reseaux_([0-9]{2})_[0-9]{4}$", "\\1", id)
    millesime_attendu <- as.integer(
      sub("^ocsge_reseaux_[0-9]{2}_([0-9]{4})$", "\\1", id)
    )
    archive <- file.path(cache, ligne$fichier[[1]])
    gpkg <- extraire_gpkg_ocsge(archive, extrait)
    etat <- normaliser_ocsge_reseaux_routiers(
      lire_ocsge_artificialisation(gpkg), departement
    )
    if (!all(etat$millesime == millesime_attendu)) {
      stop("L'archive OCS-GE ", basename(archive), " porte le millésime ",
           paste(unique(etat$millesime), collapse = ", "),
           " mais le manifeste épingle ", millesime_attendu,
           " — la couche a dérivé.", call. = FALSE)
    }
    etat
  })

  do.call(rbind, donnees)
}

# calculer_surface_reseaux_routiers_communes ------------------------------------
# Le seam communal : une surface OCS-GE est découpée par les limites communales
# de son département, puis sa mesure `aire_m2` est répartie au prorata de la
# géométrie découpée. Les polygones d'un autre département ne sont jamais
# attribués à une commune voisine. Toutes les communes du référentiel sortent,
# y compris celles sans polygone US4.1.1 (surface et part à zéro).
#
# Entrées :
#   - `ocsge` : sf normalisé, avec code_us, aire_m2, departement ;
#   - `limites` : sf Admin Express, avec code_insee.
# Sortie : commune × aire_m2 × surface_routiere_m2 × part_surface_routiere.
calculer_surface_reseaux_routiers_communes <- function(ocsge, limites) {
  if (!inherits(ocsge, "sf") || !inherits(limites, "sf")) {
    stop("Surface réseau routier corrompue — OCS-GE et limites communales ",
         "doivent être des objets sf.", call. = FALSE)
  }
  requises_ocsge <- c("code_us", "aire_m2", "departement")
  manquantes_ocsge <- setdiff(requises_ocsge, names(ocsge))
  if (length(manquantes_ocsge) > 0) {
    stop("Surface réseau routier corrompue — colonne(s) OCS-GE manquante(s) : ",
         paste(manquantes_ocsge, collapse = ", "), ".", call. = FALSE)
  }
  if (!"code_insee" %in% names(limites)) {
    stop("Surface réseau routier corrompue — les limites communales ne portent ",
         "pas code_insee.", call. = FALSE)
  }
  if (anyDuplicated(limites$code_insee)) {
    stop("Surface réseau routier corrompue — des communes sont en double.",
         call. = FALSE)
  }

  ocsge <- ocsge[ocsge$code_us == CODE_US_RESEAU_ROUTIER, , drop = FALSE]
  if (nrow(ocsge) > 0) {
    ocsge <- sf::st_transform(sf::st_make_valid(ocsge), 2154)
    if (any(is.na(ocsge$aire_m2) | !is.finite(ocsge$aire_m2) |
            ocsge$aire_m2 <= 0)) {
      stop("Surface réseau routier corrompue — aire_m2 doit être positive ",
           "et présente.", call. = FALSE)
    }
    ocsge$aire_geom_m2 <- as.numeric(sf::st_area(ocsge))
    if (any(!is.finite(ocsge$aire_geom_m2) | ocsge$aire_geom_m2 <= 0)) {
      stop("Surface réseau routier corrompue — une géométrie OCS-GE est vide ",
           "ou sans surface.", call. = FALSE)
    }
    ocsge$surface_source_m2 <- as.numeric(ocsge$aire_m2)
  }

  limites <- sf::st_transform(sf::st_make_valid(limites), 2154)
  limites$aire_commune_m2 <- as.numeric(sf::st_area(limites))

  morceaux <- list()
  if (nrow(ocsge) > 0) {
    departements <- unique(as.character(ocsge$departement))
    for (departement in departements) {
      ocsge_dep <- ocsge[as.character(ocsge$departement) == departement, ,
                         drop = FALSE]
      limites_dep <- limites[
        substr(as.character(limites$code_insee), 1, 2) == departement,
        , drop = FALSE
      ]
      if (nrow(limites_dep) == 0) next

      morceaux[[length(morceaux) + 1L]] <- suppressWarnings(
        sf::st_intersection(
          ocsge_dep[c("surface_source_m2", "aire_geom_m2")],
          limites_dep["code_insee"]
        )
      )
    }
  }

  surface_par_commune <- if (length(morceaux) == 0) {
    tibble::tibble(
      commune = character(),
      surface_routiere_m2 = numeric()
    )
  } else {
    pieces <- dplyr::bind_rows(morceaux)
    pieces$part <- as.numeric(sf::st_area(pieces)) / pieces$aire_geom_m2
    pieces$surface_routiere_m2 <- pieces$surface_source_m2 * pieces$part
    sf::st_drop_geometry(pieces) %>%
      dplyr::group_by(commune = code_insee) %>%
      dplyr::summarise(
        surface_routiere_m2 = sum(surface_routiere_m2),
        .groups = "drop"
      )
  }

  sf::st_drop_geometry(limites) %>%
    dplyr::transmute(
      commune = as.character(code_insee),
      aire_m2 = aire_commune_m2
    ) %>%
    dplyr::left_join(surface_par_commune, by = "commune") %>%
    dplyr::mutate(
      surface_routiere_m2 = dplyr::coalesce(surface_routiere_m2, 0),
      part_surface_routiere = surface_routiere_m2 / aire_m2
    ) %>%
    dplyr::arrange(commune)
}

# agreger_surface_reseaux_routiers_territoires -------------------------------
# Les parts aux quatre niveaux sont recalculées depuis les deux mesures
# additives (surface routière / surface du territoire), jamais comme une
# moyenne de parts communales. Les communes sans EPCI restent exclues du
# niveau EPCI, comme pour les autres agrégations du thème.
agreger_surface_reseaux_routiers_territoires <- function(communes, base_epci) {
  requises <- c("commune", "aire_m2", "surface_routiere_m2")
  manquantes <- setdiff(requises, names(communes))
  if (length(manquantes) > 0) {
    stop("Surface réseau routier corrompue — colonne(s) communale(s) ",
         "manquante(s) : ", paste(manquantes, collapse = ", "), ".",
         call. = FALSE)
  }
  if (!all(c("CODGEO", "EPCI", "DEP") %in% names(base_epci))) {
    stop("Surface réseau routier corrompue — la base EPCI doit porter ",
         "CODGEO, EPCI et DEP.", call. = FALSE)
  }

  ctx <- communes %>%
    dplyr::left_join(base_epci[c("CODGEO", "EPCI", "DEP")],
                     by = c("commune" = "CODGEO"))

  agregat <- function(groupe) {
    ctx %>%
      dplyr::group_by(code = .data[[groupe]]) %>%
      dplyr::summarise(
        value = sum(surface_routiere_m2) / sum(aire_m2),
        .groups = "drop"
      )
  }

  dplyr::bind_rows(
    ctx %>% dplyr::transmute(code = commune, value = surface_routiere_m2 / aire_m2),
    agregat("EPCI") %>% dplyr::filter(!is.na(code)),
    agregat("DEP"),
    ctx %>% dplyr::summarise(
      code = "53",
      value = sum(surface_routiere_m2) / sum(aire_m2)
    )
  ) %>%
    dplyr::arrange(code)
}
