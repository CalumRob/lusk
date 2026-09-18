# distribution_acces_batiments -------------------------------------------------
# La distribution bivariée de l'accès aux équipements au niveau du bâtiment
# (issue #550). La source est l'export porté
# Accessibility_by_mode_bretagne_v2.csv : une ligne par batiment_groupe_id et
# une colonne transit_walk_<TYPEQU> par type BPE. Les deux dimensions sont
# calculées sur la MÊME ligne : breadth = nombre de colonnes strictement
# positives, depth = somme des comptes d'équipements.
#
# La matrice bâtiment × équipement reste une matière INTERNE. Le seul résultat
# qui franchit le seam analytique est une grille de cellules agrégées, avec le
# dénominateur, l'état de disponibilité, les bornes et les libellés portés par
# chaque ligne. Le renderer ne connaît donc ni les codes TYPEQU ni des tranches
# illustratives.

# The building export is an implementation input of the same carried analysis
# already cited by the other Mobilité facts. It keeps an operational manifest id
# for locating the file, but the public projections inherit this source/vintage.
MOBILITE_SNAPSHOT_SOURCE_ID <- "mobilite_snapshot"
MOBILITE_SNAPSHOT_SOURCE <- "Lusk — analyse d'accessibilité « Vingt minutes sans voiture » (analyse portée, BPE 2024 · OSM 02-2026 · BDNB 2025-07)"
MOBILITE_SNAPSHOT_VERSION <- "2026-02"
MOBILITE_SNAPSHOT_DATE_REFERENCE <- "2026-02-28"
MOBILITE_SNAPSHOT_DATE_PUBLICATION <- "2026-08-06"
MOBILITE_SNAPSHOT_LICENCE <- "odbl"

DISTRIBUTION_ACCES_BATIMENTS_FICHIER <- "Accessibility_by_mode_bretagne_v2.csv"
DISTRIBUTION_ACCES_BATIMENTS_MANIFEST_ID <- "accessibilite_batiments"
DISTRIBUTION_ACCES_BATIMENTS_SOURCE_ID <- MOBILITE_SNAPSHOT_SOURCE_ID
DISTRIBUTION_ACCES_BATIMENTS_SOURCE <- MOBILITE_SNAPSHOT_SOURCE
DISTRIBUTION_ACCES_BATIMENTS_VERSION <- MOBILITE_SNAPSHOT_VERSION
DISTRIBUTION_ACCES_BATIMENTS_DATE_REFERENCE <- MOBILITE_SNAPSHOT_DATE_REFERENCE
DISTRIBUTION_ACCES_BATIMENTS_DATE_PUBLICATION <- MOBILITE_SNAPSHOT_DATE_PUBLICATION
DISTRIBUTION_ACCES_BATIMENTS_LICENCE <- MOBILITE_SNAPSHOT_LICENCE
DISTRIBUTION_ACCES_BATIMENTS_MODE <- "t"
DISTRIBUTION_ACCES_BATIMENTS_MODE_LABEL <- "À pied + TC"
DISTRIBUTION_ACCES_BATIMENTS_BREADTH_LABEL <- "types d’équipements accessibles"
DISTRIBUTION_ACCES_BATIMENTS_DEPTH_LABEL <- "équipements accessibles"

# La rampe d'accès est la distribution marginale du nombre de types accessibles
# par bâtiment, les trois modes étant classés séparément. Elle ne réutilise pas
# les tranches de la matrice : onze quantiles suffisent à dessiner la courbe
# sans publier une ligne bâtimentielle.
RAMPE_ACCES_BATIMENTS_X_LABEL <- "Part cumulée des bâtiments"
RAMPE_ACCES_BATIMENTS_Y_LABEL <- DISTRIBUTION_ACCES_BATIMENTS_BREADTH_LABEL
RAMPE_ACCES_BATIMENTS_QUANTILES <- seq(0, 1, by = 0.1)
RAMPE_ACCES_BATIMENTS_MODES <- tibble::tribble(
  ~mode, ~mode_label,
  "c", "Voiture",
  "b", "À vélo + TC",
  "t", "À pied + TC"
)

# Les quantiles observés sur les 1 235 417 bâtiments (breadth : Q25 = 4,
# médiane = 17, Q75 = 32, Q90 = 43 ; depth : Q25 = 5, médiane = 28,
# Q75 = 98, Q90 = 269) sont arrondis en tranches lisibles. Les zéros restent
# une classe explicite et la dernière tranche reste ouverte pour depth.
DISTRIBUTION_ACCES_BATIMENTS_BREADTH_BINS <- tibble::tribble(
  ~key, ~min_value, ~max_value, ~label,
  "0",       0,  0,  "0",
  "1-9",     1,  9,  "1–9",
  "10-24",  10, 24,  "10–24",
  "25-39",  25, 39,  "25–39",
  "40-53",  40, 53,  "40–53"
)

DISTRIBUTION_ACCES_BATIMENTS_DEPTH_BINS <- tibble::tribble(
  ~key, ~min_value, ~max_value, ~label,
  "0",       0,    0,  "0",
  "1-9",     1,    9,  "1–9",
  "10-49",  10,   49,  "10–49",
  "50-199", 50,  199,  "50–199",
  "200-499",200, 499,  "200–499",
  "500+",   500,   NA,  "500 ou +"
)

CLES_DISTRIBUTION_ACCES_BATIMENTS <- c(
  "territoire", "type", "availability", "total_buildings",
  "breadth_bucket", "breadth_min", "breadth_max", "breadth_label",
  "depth_bucket", "depth_min", "depth_max", "depth_label",
  "building_count", "share", "mode", "mode_label",
  "breadth_axis_label", "depth_axis_label", "source_id", "source",
  "version", "date_reference", "date_publication", "comparison_label",
  "comparison_total_buildings", "comparison_building_count", "comparison_share"
)

CLES_RAMPE_ACCES_BATIMENTS <- c(
  "territoire", "type", "availability", "total_buildings", "mode", "mode_label",
  "quantile", "quantile_label", "accessible_types", "x_axis_label", "y_axis_label",
  "source_id", "source", "version", "date_reference", "date_publication",
  "comparison_label", "comparison_total_buildings", "comparison_accessible_types"
)

# lire_accessibilite_batiments -----------------------------------------------
# Le lecteur ne laisse entrer que l'identité et les 53 colonnes du registre.
# Les colonnes bike/car et geom_adresse de l'export restent hors de ce contrat :
# elles appartiennent à d'autres usages et ne doivent pas contaminer ce calcul.
lire_accessibilite_batiments <- function(
    chemin,
    registre = lire_correspondances_typequ(),
    modes = "t") {
  verifier_contrat_bpe_typequ(registre)
  if (!file.exists(chemin)) {
    stop("Accessibilité bâtiments introuvable : ", chemin, ".", call. = FALSE)
  }

  entetes <- names(readr::read_csv(
    chemin,
    n_max = 0,
    col_types = readr::cols(.default = readr::col_character()),
    show_col_types = FALSE,
    progress = FALSE
  ))
  modes <- unique(as.character(modes))
  if (length(modes) == 0L || any(!modes %in% c("c", "b", "t"))) {
    stop("Accessibilité bâtiments — les modes attendus sont c, b et t.",
         call. = FALSE)
  }
  prefixes <- c(c = "car_", b = "bike_", t = "transit_walk_")
  colonnes <- unlist(lapply(modes, function(mode) {
    paste0(prefixes[[mode]], registre$TYPEQU)
  }), use.names = FALSE)
  manquantes <- setdiff(c("id", colonnes), entetes)
  if (length(manquantes) > 0) {
    stop("Accessibilité bâtiments corrompue — colonne(s) requise(s) manquante(s) : ",
         paste(manquantes, collapse = ", "), ".", call. = FALSE)
  }

  readr::read_csv(
    chemin,
    col_select = dplyr::all_of(c("id", colonnes)),
    col_types = readr::cols(.default = readr::col_character()),
    show_col_types = FALSE,
    progress = FALSE
  )
}

# normaliser_accessibilite_batiments ------------------------------------------
# Joint l'export de comptes à la couche bâtiments sur l'identité BDNB. Une
# identité absente d'un côté ou de l'autre est une corruption : une jointure
# partielle ferait varier silencieusement le dénominateur de la figure.
normaliser_accessibilite_batiments <- function(
    accessibilite,
    batiments,
    registre = lire_correspondances_typequ()) {
  modes <- normaliser_accessibilite_batiments_modes(
    accessibilite, batiments, registre, modes = "t"
  )
  modes %>%
    dplyr::transmute(
      batiment_groupe_id, commune,
      breadth = breadth_t,
      depth = depth_t
    )
}

# normaliser_accessibilite_batiments_modes --------------------------------------
# Même garde d'identité et de valeurs que la projection t, mais conserve les
# trois largeurs de panier nécessaires à la rampe. La fonction reste interne au
# pipeline : son résultat n'est jamais publié tel quel.
normaliser_accessibilite_batiments_modes <- function(
    accessibilite,
    batiments,
    registre = lire_correspondances_typequ(),
    modes = c("c", "b", "t")) {
  verifier_contrat_bpe_typequ(registre)
  if (!is.data.frame(accessibilite)) {
    stop("Accessibilité bâtiments invalide — une table est attendue.",
         call. = FALSE)
  }
  if (!is.data.frame(batiments)) {
    stop("Accessibilité bâtiments invalide — la couche bâtiments est attendue.",
         call. = FALSE)
  }
  if (nrow(accessibilite) == 0) {
    stop("Accessibilité bâtiments corrompue — le fichier ne porte aucune ligne.",
         call. = FALSE)
  }

  modes <- unique(as.character(modes))
  if (length(modes) == 0L || any(!modes %in% c("c", "b", "t"))) {
    stop("Accessibilité bâtiments — les modes attendus sont c, b et t.",
         call. = FALSE)
  }
  prefixes <- c(c = "car_", b = "bike_", t = "transit_walk_")
  colonnes_par_mode <- lapply(modes, function(mode) {
    paste0(prefixes[[mode]], registre$TYPEQU)
  })
  colonnes <- unlist(colonnes_par_mode, use.names = FALSE)
  manquantes <- setdiff(c("id", colonnes), names(accessibilite))
  if (length(manquantes) > 0) {
    stop("Accessibilité bâtiments corrompue — colonne(s) requise(s) manquante(s) : ",
         paste(manquantes, collapse = ", "), ".", call. = FALSE)
  }
  ids <- as.character(accessibilite$id)
  if (any(is.na(ids) | !nzchar(ids))) {
    stop("Accessibilité bâtiments corrompue — un id bâtiment vide.",
         call. = FALSE)
  }
  if (anyDuplicated(ids)) {
    stop("Accessibilité bâtiments corrompue — des id bâtiments dupliqués.",
         call. = FALSE)
  }

  valeurs <- accessibilite
  for (colonne in colonnes) {
    brut <- valeurs[[colonne]]
    numerique <- suppressWarnings(as.numeric(brut))
    invalides <- is.na(numerique) | !is.finite(numerique) |
      numerique < 0 | numerique != floor(numerique)
    if (any(invalides)) {
      motif <- if (any(is.na(numerique))) "une valeur manquante" else
        "une valeur non entière ou négative"
      stop("Accessibilité bâtiments corrompue — la colonne « ", colonne,
           " » porte ", motif, ".", call. = FALSE)
    }
    valeurs[[colonne]] <- numerique
  }

  requis_batiments <- c("batiment_groupe_id", "code_commune_insee")
  manquantes <- setdiff(requis_batiments, names(batiments))
  if (length(manquantes) > 0) {
    stop("Accessibilité bâtiments — colonne(s) manquante(s) dans la couche BDNB : ",
         paste(manquantes, collapse = ", "), ".", call. = FALSE)
  }
  ids_batiments <- as.character(batiments$batiment_groupe_id)
  if (any(is.na(ids_batiments) | !nzchar(ids_batiments)) ||
      anyDuplicated(ids_batiments)) {
    stop("Accessibilité bâtiments — les identités BDNB doivent être non vides et uniques.",
         call. = FALSE)
  }

  absents_dans_batiments <- setdiff(ids, ids_batiments)
  absents_dans_accessibilite <- setdiff(ids_batiments, ids)
  if (length(absents_dans_batiments) > 0 || length(absents_dans_accessibilite) > 0) {
    stop(
      "Accessibilité bâtiments — les identités ne correspondent pas exactement " ,
      "entre l'export de comptes et la couche BDNB (export sans couche : ",
      length(absents_dans_batiments), "; couche sans export : ",
      length(absents_dans_accessibilite), ").",
      call. = FALSE
    )
  }

  table_batiments <- if (inherits(batiments, "sf")) {
    sf::st_drop_geometry(batiments)
  } else {
    batiments
  }
  table_batiments <- table_batiments %>%
    dplyr::transmute(
      batiment_groupe_id = as.character(batiment_groupe_id),
      commune = as.character(code_commune_insee)
    )
  valeurs_numeriques <- lapply(colonnes, function(colonne) valeurs[[colonne]])
  names(valeurs_numeriques) <- colonnes
  resultats <- tibble::tibble(batiment_groupe_id = ids)
  for (mode in modes) {
    colonnes_mode <- colonnes_par_mode[[which(modes == mode)[[1L]]]]
    resultats[[paste0("breadth_", mode)]] <- as.integer(
      rowSums(as.data.frame(valeurs_numeriques[colonnes_mode]) > 0)
    )
    resultats[[paste0("depth_", mode)]] <- as.integer(
      rowSums(as.data.frame(valeurs_numeriques[colonnes_mode]))
    )
  }
  resultats %>%
    dplyr::left_join(table_batiments, by = "batiment_groupe_id") %>%
    dplyr::relocate(commune, .after = batiment_groupe_id) %>%
    dplyr::arrange(commune, batiment_groupe_id)
}

classer_distribution_batiments <- function(valeurs, bins, axe) {
  resultat <- vapply(valeurs, function(valeur) {
    trouve <- which(
      valeur >= bins$min_value &
        (is.na(bins$max_value) | valeur <= bins$max_value)
    )
    if (length(trouve) != 1L) {
      stop("Distribution bâtiments — valeur hors des bornes de l'axe ", axe,
           " : ", valeur, ".", call. = FALSE)
    }
    bins$key[[trouve]]
  }, character(1))
  unname(resultat)
}

territoires_distribution_acces_batiments <- function(base_epci) {
  contexte <- contexte_comparaison_acces_batiments(base_epci)
  contexte %>%
    dplyr::select(territoire, type)
}

contexte_comparaison_acces_batiments <- function(base_epci) {
  requis <- c("CODGEO", "EPCI", "DEP")
  manquantes <- setdiff(requis, names(base_epci))
  if (length(manquantes) > 0) {
    stop("Distribution bâtiments — colonne(s) manquante(s) dans le référentiel : ",
         paste(manquantes, collapse = ", "), ".", call. = FALSE)
  }
  base <- base_epci %>%
    dplyr::transmute(
      commune = as.character(CODGEO),
      epci = as.character(EPCI),
      departement = as.character(DEP)
    ) %>%
    dplyr::filter(departement %in% DEPT_BRETAGNE)

  dplyr::bind_rows(
    base %>% dplyr::distinct(territoire = commune) %>%
      dplyr::left_join(
        base %>% dplyr::distinct(territoire = commune, epci),
        by = "territoire"
      ) %>%
      dplyr::mutate(
        type = "commune",
        scope_key = dplyr::if_else(
          !is.na(epci) & nzchar(epci),
          paste0("communes-epci:", epci),
          "communes-bretagne"
        ),
        comparison_label = dplyr::if_else(
          !is.na(epci) & nzchar(epci),
          "communes de l'EPCI",
          "communes bretonnes"
        )
      ),
    base %>% dplyr::filter(!is.na(epci) & nzchar(epci)) %>%
      dplyr::distinct(territoire = epci) %>%
      dplyr::mutate(
        type = "epci", scope_key = "epcis-bretagne",
        comparison_label = "EPCI bretons"
      ),
    base %>% dplyr::distinct(territoire = departement) %>%
      dplyr::mutate(
        type = "departement", scope_key = "departements-bretagne",
        comparison_label = "départements bretons"
      ),
    tibble::tibble(
      territoire = "53", type = "region", scope_key = NA_character_,
      comparison_label = NA_character_
    )
  ) %>%
    dplyr::select(territoire, type, scope_key, comparison_label) %>%
    dplyr::distinct() %>%
    dplyr::arrange(type, territoire)
}

# construire_contextes_acces_batiments ----------------------------------------
# Les tables historiques portent une seule comparaison canonique par territoire.
# Les modèles de lecture ont besoin des trois mondes applicables à une commune,
# mais la rampe ne peut pas être recomposée à partir de quantiles déjà agrégés.
# Cette projection conserve donc la matière bâtiment jusqu'à l'agrégation de
# chaque contexte, puis publie une petite table dédiée au modèle de lecture.
construire_contextes_acces_batiments <- function(
    batiments,
    rampe,
    base_epci,
    classes_densite = NULL) {
  requis_base <- c("CODGEO", "EPCI", "LIBEPCI", "DEP")
  manquantes <- setdiff(requis_base, names(base_epci))
  if (length(manquantes) > 0L) {
    stop("Comparaisons bâtiments — colonne(s) manquante(s) dans le référentiel : ",
         paste(manquantes, collapse = ", "), ".", call. = FALSE)
  }
  requis_densite <- c("CODGEO", "DENS7", "LIBDENS7")
  if (!is.data.frame(classes_densite)) {
    stop("Comparaisons bâtiments — le référentiel de densité est requis.",
         call. = FALSE)
  }
  manquantes_densite <- setdiff(requis_densite, names(classes_densite))
  if (length(manquantes_densite) > 0L) {
    stop("Comparaisons bâtiments — colonne(s) manquante(s) dans le référentiel de densité : ",
         paste(manquantes_densite, collapse = ", "), ".", call. = FALSE)
  }
  if (anyDuplicated(classes_densite$CODGEO)) {
    doublons <- unique(classes_densite$CODGEO[duplicated(classes_densite$CODGEO)])
    stop("Comparaisons bâtiments — jointure communale ambiguë dans le référentiel de densité pour ",
         paste(doublons, collapse = ", "), ".", call. = FALSE)
  }
  base <- base_epci %>%
    dplyr::transmute(
      commune = as.character(CODGEO),
      epci = as.character(EPCI),
      nom_epci = as.character(LIBEPCI),
      departement = as.character(DEP)
    ) %>%
    dplyr::filter(departement %in% DEPT_BRETAGNE)
  sans_nom_epci <- base$commune[
    !is.na(base$epci) & nzchar(base$epci) &
      (is.na(base$nom_epci) | !nzchar(base$nom_epci))
  ]
  if (length(sans_nom_epci) > 0L) {
    stop("Comparaisons bâtiments — EPCI sans libellé pour la/les commune(s) : ",
         paste(sans_nom_epci, collapse = ", "), ".", call. = FALSE)
  }

  base <- base %>%
    dplyr::left_join(
      classes_densite %>%
        dplyr::transmute(
          commune = as.character(CODGEO),
          classe_densite_code = as.character(DENS7),
          classe_densite_libelle_insee = as.character(LIBDENS7)
        ),
      by = "commune"
    ) %>%
    dplyr::left_join(
      registre_classes_densite() %>%
        dplyr::rename(
          classe_densite_libelle_insee = classe_densite_libelle_insee
        ),
      by = c("classe_densite_code", "classe_densite_libelle_insee")
    )
  sans_classe <- base$commune[
    is.na(base$classe_densite_code) |
      is.na(base$classe_densite_libelle_insee) |
      is.na(base$classe_densite_libelle_public)
  ]
  if (length(sans_classe) > 0L) {
    stop("Comparaisons bâtiments — commune(s) sans classe de densité valide : ",
         paste(sans_classe, collapse = ", "), ".", call. = FALSE)
  }

  communes <- base %>% dplyr::filter(!is.na(commune) & nzchar(commune))
  epcis <- communes %>%
    dplyr::filter(!is.na(epci) & nzchar(epci)) %>%
    dplyr::distinct(epci)
  departements <- communes %>% dplyr::distinct(departement)

  contextes <- dplyr::bind_rows(
    communes %>%
      dplyr::filter(!is.na(classe_densite_code) & nzchar(classe_densite_code)) %>%
      dplyr::transmute(
        territoire = commune, type = "commune", comparison_mode = "densite",
        scope_kind = "communes-densite",
        scope_label = classe_densite_libelle_public,
        member_type = "commune-densite", member_code = classe_densite_code,
        member_selector = "classe_densite"
      ),
    communes %>%
      dplyr::filter(!is.na(epci) & nzchar(epci)) %>%
      dplyr::transmute(
        territoire = commune, type = "commune", comparison_mode = "epci",
        scope_kind = "communes-epci",
        scope_label = paste("communes de", nom_epci),
        member_type = "commune-epci", member_code = epci,
        member_selector = "commune-epci"
      ),
    communes %>%
      dplyr::transmute(
        territoire = commune, type = "commune", comparison_mode = "bretagne",
        scope_kind = "communes-bretagne", scope_label = "communes bretonnes",
        member_type = "region-communes", member_code = "53",
        member_selector = "commune"
      ),
    epcis %>%
      dplyr::transmute(
        territoire = epci, type = "epci", comparison_mode = "bretagne",
        scope_kind = "epcis-bretagne", scope_label = "EPCI bretons",
        member_type = "region-epcis", member_code = "53",
        member_selector = "epci"
      ),
    departements %>%
      dplyr::transmute(
        territoire = departement, type = "departement", comparison_mode = "bretagne",
        scope_kind = "departements-bretagne", scope_label = "départements bretons",
        member_type = "region-departements", member_code = "53",
        member_selector = "departement"
      )
  ) %>%
    dplyr::distinct()

  context_members <- dplyr::bind_rows(
    contextes %>%
      dplyr::filter(member_selector == "classe_densite") %>%
      dplyr::select(
        territoire, type, comparison_mode, scope_kind, scope_label,
        member_type, member_code
      ) %>%
      dplyr::left_join(
        communes %>% dplyr::transmute(
          member_type = "commune-densite", member_code = classe_densite_code,
          actual_member_code = commune
        ),
        by = c("member_type", "member_code"),
        relationship = "many-to-many"
      ),
    contextes %>%
      dplyr::filter(member_selector == "commune-epci") %>%
      dplyr::select(
        territoire, type, comparison_mode, scope_kind, scope_label,
        member_type, member_code
      ) %>%
      dplyr::left_join(
        communes %>% dplyr::transmute(
          member_type = "commune-epci", member_code = epci,
          actual_member_code = commune
        ),
        by = c("member_type", "member_code"),
        relationship = "many-to-many"
      ),
    contextes %>%
      dplyr::filter(member_selector == "commune") %>%
      dplyr::select(
        territoire, type, comparison_mode, scope_kind, scope_label
      ) %>%
      dplyr::mutate(
        member_type = "commune", member_code = NA_character_
      ) %>%
      dplyr::left_join(
        communes %>% dplyr::transmute(
          member_type = "commune", actual_member_code = commune
        ),
        by = "member_type",
        relationship = "many-to-many"
      ),
    contextes %>%
      dplyr::filter(member_selector == "epci") %>%
      dplyr::select(
        territoire, type, comparison_mode, scope_kind, scope_label
      ) %>%
      dplyr::mutate(
        member_type = "epci", member_code = NA_character_
      ) %>%
      dplyr::left_join(
        epcis %>% dplyr::transmute(
          member_type = "epci", actual_member_code = epci
        ),
        by = "member_type",
        relationship = "many-to-many"
      ),
    contextes %>%
      dplyr::filter(member_selector == "departement") %>%
      dplyr::select(
        territoire, type, comparison_mode, scope_kind, scope_label
      ) %>%
      dplyr::mutate(
        member_type = "departement", member_code = NA_character_
      ) %>%
      dplyr::left_join(
        departements %>% dplyr::transmute(
          member_type = "departement", actual_member_code = departement
        ),
        by = "member_type",
        relationship = "many-to-many"
      )
  ) %>%
    dplyr::filter(!is.na(actual_member_code)) %>%
    dplyr::distinct()

  mapped_distribution <- if (is.data.frame(batiments) && nrow(batiments) > 0L) {
    batiments %>%
      dplyr::transmute(
        commune = as.character(commune),
        breadth = as.integer(breadth), depth = as.integer(depth)
      ) %>%
      dplyr::left_join(base, by = "commune") %>%
      dplyr::mutate(
        breadth_bucket = classer_distribution_batiments(
          breadth, DISTRIBUTION_ACCES_BATIMENTS_BREADTH_BINS, "breadth"
        ),
        depth_bucket = classer_distribution_batiments(
          depth, DISTRIBUTION_ACCES_BATIMENTS_DEPTH_BINS, "depth"
        )
      )
  } else {
    tibble::tibble()
  }
  mapped_rampe <- if (is.data.frame(rampe) && nrow(rampe) > 0L) {
    rampe %>%
      dplyr::transmute(
        commune = as.character(commune),
        c = as.numeric(breadth_c), b = as.numeric(breadth_b),
        t = as.numeric(breadth_t)
      ) %>%
      dplyr::left_join(base, by = "commune")
  } else {
    tibble::tibble()
  }

  members_for <- function(mapped, level) {
    if (!is.data.frame(mapped) || nrow(mapped) == 0L) return(tibble::tibble())
    if (level == "commune") {
      dplyr::bind_rows(
        mapped %>% dplyr::transmute(
          member_type = "commune-densite", actual_member_code = commune,
          dplyr::across(-commune)
        ),
        mapped %>% dplyr::filter(!is.na(epci) & nzchar(epci)) %>%
          dplyr::transmute(
            member_type = "commune-epci", actual_member_code = commune,
            dplyr::across(-commune)
          ),
        mapped %>% dplyr::transmute(
          member_type = "commune", actual_member_code = commune,
          dplyr::across(-commune)
        )
      )
    } else if (level == "epci") {
      mapped %>%
        dplyr::filter(!is.na(epci) & nzchar(epci)) %>%
        dplyr::transmute(member_type = "epci", actual_member_code = epci, dplyr::across(-commune))
    } else {
      mapped %>%
        dplyr::transmute(member_type = "departement", actual_member_code = departement, dplyr::across(-commune))
    }
  }

  expand_members <- function(mapped, level) {
    membres <- members_for(mapped, level)
    if (nrow(membres) == 0L) return(tibble::tibble())
    member_types <- switch(
      level,
      commune = c("commune-densite", "commune-epci", "commune"),
      epci = "epci",
      departement = "departement"
    )
    joined <- context_members %>%
      dplyr::filter(.data$member_type %in% member_types) %>%
      dplyr::inner_join(
        membres,
        by = c("member_type", "actual_member_code"),
        relationship = "many-to-many"
      )
    joined
  }

  distribution <- if (nrow(mapped_distribution) > 0L) {
    distribution_values <- dplyr::bind_rows(
      expand_members(mapped_distribution, "commune"),
      expand_members(mapped_distribution, "epci"),
      expand_members(mapped_distribution, "departement")
    )
    utilisables <- distribution_values %>%
      dplyr::group_by(
        .data$territoire, .data$comparison_mode, .data$scope_kind,
        .data$scope_label
      ) %>%
      dplyr::summarise(
        member_count = dplyr::n_distinct(.data$actual_member_code),
        .groups = "drop"
      ) %>%
      dplyr::filter(.data$member_count >= 2L)
    valeurs_utilisables <- distribution_values %>%
      dplyr::semi_join(
        utilisables,
        by = c("territoire", "comparison_mode", "scope_kind", "scope_label")
      )
    cles <- c(
      "territoire", "type", "comparison_mode", "scope_kind", "scope_label"
    )
    totaux <- valeurs_utilisables %>%
      dplyr::group_by(dplyr::across(dplyr::all_of(cles))) %>%
      dplyr::summarise(
        comparison_total_buildings = dplyr::n(),
        .groups = "drop"
      )
    comptes <- valeurs_utilisables %>%
      dplyr::group_by(
        .data$territoire, .data$type, .data$comparison_mode,
        .data$scope_kind, .data$scope_label,
        .data$breadth_bucket, .data$depth_bucket
      ) %>%
      dplyr::summarise(
        comparison_building_count = dplyr::n(),
        .groups = "drop"
      )
    tidyr::crossing(
      totaux,
      tidyr::crossing(
        breadth_bucket = DISTRIBUTION_ACCES_BATIMENTS_BREADTH_BINS$key,
        depth_bucket = DISTRIBUTION_ACCES_BATIMENTS_DEPTH_BINS$key
      )
    ) %>%
      dplyr::left_join(
        comptes,
        by = c(cles, "breadth_bucket", "depth_bucket")
      ) %>%
      dplyr::mutate(
        comparison_building_count = as.integer(
          dplyr::coalesce(.data$comparison_building_count, 0L)
        ),
        comparison_share = .data$comparison_building_count /
          .data$comparison_total_buildings
      )
  } else {
    tibble::tibble()
  }

  rampe <- if (nrow(mapped_rampe) > 0L) {
    rampe_values <- dplyr::bind_rows(
      expand_members(mapped_rampe, "commune"),
      expand_members(mapped_rampe, "epci"),
      expand_members(mapped_rampe, "departement")
    ) %>%
      tidyr::pivot_longer(
        cols = c("c", "b", "t"),
        names_to = "mode", values_to = "accessible_types"
      ) %>%
      dplyr::filter(!is.na(.data$accessible_types))
    rampe_values %>%
      dplyr::group_by(
        .data$territoire, .data$type, .data$comparison_mode,
        .data$scope_kind, .data$scope_label, .data$mode
      ) %>%
      dplyr::group_modify(~ {
        if (dplyr::n_distinct(.x$actual_member_code) < 2L) {
          return(tibble::tibble())
        }
        tibble::tibble(
          comparison_total_buildings = nrow(.x),
          quantile = RAMPE_ACCES_BATIMENTS_QUANTILES,
          comparison_accessible_types = as.numeric(stats::quantile(
            .x$accessible_types,
            probs = RAMPE_ACCES_BATIMENTS_QUANTILES,
            names = FALSE, type = 1
          ))
        )
      }) %>%
      dplyr::ungroup() %>%
      dplyr::select(
        territoire, type, comparison_mode, scope_kind, scope_label, mode,
        quantile, comparison_total_buildings, comparison_accessible_types
      )
  } else {
    tibble::tibble()
  }

  list(distribution = distribution, rampe = rampe)
}

membres_comparaison_acces_batiments <- function(mapped, scopes) {
  scope_rows <- scopes %>%
    dplyr::filter(!is.na(scope_key)) %>%
    dplyr::distinct(scope_key, comparison_label)
  dplyr::bind_rows(lapply(scope_rows$scope_key, function(scope_key) {
    membres <- if (startsWith(scope_key, "communes-epci:")) {
      code_epci <- sub("^communes-epci:", "", scope_key)
      mapped %>% dplyr::filter(epci == code_epci)
    } else if (scope_key == "epcis-bretagne") {
      mapped %>% dplyr::filter(!is.na(epci) & nzchar(epci))
    } else {
      mapped
    }
    membres %>%
      dplyr::mutate(scope_key = scope_key) %>%
      dplyr::select(scope_key, breadth_bucket, depth_bucket,
                    breadth, depth)
  }))
}

membres_comparaison_rampe_acces_batiments <- function(mapped, scopes) {
  scope_rows <- scopes %>%
    dplyr::filter(!is.na(scope_key)) %>%
    dplyr::distinct(scope_key)
  dplyr::bind_rows(lapply(scope_rows$scope_key, function(scope_key) {
    membres <- if (startsWith(scope_key, "communes-epci:")) {
      code_epci <- sub("^communes-epci:", "", scope_key)
      mapped %>% dplyr::filter(epci == code_epci)
    } else if (scope_key == "epcis-bretagne") {
      mapped %>% dplyr::filter(!is.na(epci) & nzchar(epci))
    } else {
      mapped
    }
    membres %>%
      dplyr::mutate(scope_key = scope_key) %>%
      dplyr::select(scope_key, breadth_c, breadth_b, breadth_t)
  }))
}

# agreger_distribution_acces_batiments ---------------------------------------
# Produit 5 × 6 cellules pour chaque territoire couvert. Les territoires sans
# bâtiment joignent une ligne « absent » explicite ; ils ne reçoivent jamais une
# grille de zéros qui prétendrait avoir observé des bâtiments.
agreger_distribution_acces_batiments <- function(
    batiments,
    base_epci,
    registre = lire_correspondances_typequ()) {
  verifier_contrat_bpe_typequ(registre)
  requis <- c("commune", "breadth", "depth")
  manquantes <- setdiff(requis, names(batiments))
  if (length(manquantes) > 0) {
    stop("Distribution bâtiments — colonne(s) manquante(s) : ",
         paste(manquantes, collapse = ", "), ".", call. = FALSE)
  }
  if (nrow(batiments) == 0) {
    stop("Distribution bâtiments — aucun bâtiment à agréger.", call. = FALSE)
  }

  base <- base_epci %>%
    dplyr::transmute(
      commune = as.character(CODGEO),
      epci = as.character(EPCI),
      departement = as.character(DEP)
    ) %>%
    dplyr::filter(departement %in% DEPT_BRETAGNE)
  mapped <- batiments %>%
    dplyr::transmute(
      commune = as.character(commune), breadth = as.integer(breadth),
      depth = as.integer(depth)
    ) %>%
    dplyr::left_join(base, by = "commune")
  if (any(is.na(mapped$departement))) {
    stop("Distribution bâtiments — un code commune absent du référentiel Bretagne.",
         call. = FALSE)
  }

  mapped <- mapped %>%
    dplyr::mutate(
      breadth_bucket = classer_distribution_batiments(
        breadth, DISTRIBUTION_ACCES_BATIMENTS_BREADTH_BINS, "breadth"
      ),
      depth_bucket = classer_distribution_batiments(
        depth, DISTRIBUTION_ACCES_BATIMENTS_DEPTH_BINS, "depth"
      )
    )
  membres <- dplyr::bind_rows(
    mapped %>% dplyr::transmute(
      territoire = commune, type = "commune", breadth_bucket, depth_bucket
    ),
    mapped %>% dplyr::filter(!is.na(epci) & nzchar(epci)) %>%
      dplyr::transmute(
        territoire = epci, type = "epci", breadth_bucket, depth_bucket
      ),
    mapped %>% dplyr::transmute(
      territoire = departement, type = "departement", breadth_bucket, depth_bucket
    ),
    mapped %>% dplyr::transmute(
      territoire = "53", type = "region", breadth_bucket, depth_bucket
    )
  )

  scopes <- contexte_comparaison_acces_batiments(base_epci)
  groupes <- membres %>%
    dplyr::count(territoire, type, name = "total_buildings") %>%
    dplyr::left_join(
      scopes %>% dplyr::select(territoire, type, scope_key, comparison_label),
      by = c("territoire", "type")
    )
  comptes <- membres %>%
    dplyr::count(territoire, type, breadth_bucket, depth_bucket,
                 name = "building_count")
  grille <- tidyr::crossing(
    breadth_bucket = DISTRIBUTION_ACCES_BATIMENTS_BREADTH_BINS$key,
    depth_bucket = DISTRIBUTION_ACCES_BATIMENTS_DEPTH_BINS$key
  )
  cellules <- tidyr::crossing(groupes, grille) %>%
    dplyr::left_join(
      comptes,
      by = c("territoire", "type", "breadth_bucket", "depth_bucket")
    ) %>%
    dplyr::mutate(
      building_count = as.integer(dplyr::coalesce(building_count, 0L)),
      share = building_count / total_buildings,
      availability = "complete"
    ) %>%
    dplyr::left_join(
      DISTRIBUTION_ACCES_BATIMENTS_BREADTH_BINS %>%
        dplyr::rename(
          breadth_bucket = key,
          breadth_min = min_value, breadth_max = max_value,
          breadth_label = label
        ),
      by = "breadth_bucket"
    ) %>%
    dplyr::left_join(
      DISTRIBUTION_ACCES_BATIMENTS_DEPTH_BINS %>%
        dplyr::rename(
          depth_bucket = key,
          depth_min = min_value, depth_max = max_value,
          depth_label = label
      ),
      by = "depth_bucket"
    )

  reference_members <- membres_comparaison_acces_batiments(
    mapped %>% dplyr::mutate(
      breadth_bucket = classer_distribution_batiments(
        breadth, DISTRIBUTION_ACCES_BATIMENTS_BREADTH_BINS, "breadth"
      ),
      depth_bucket = classer_distribution_batiments(
        depth, DISTRIBUTION_ACCES_BATIMENTS_DEPTH_BINS, "depth"
      )
    ),
    scopes
  )
  reference_scopes <- scopes %>%
    dplyr::filter(!is.na(scope_key)) %>%
    dplyr::distinct(scope_key, comparison_label)
  reference_totals <- reference_scopes %>%
    dplyr::left_join(
      reference_members %>% dplyr::count(scope_key, name = "comparison_total_buildings"),
      by = "scope_key"
    ) %>%
    dplyr::mutate(
      comparison_total_buildings = as.integer(
        dplyr::coalesce(comparison_total_buildings, 0L)
      )
    )
  reference_cells <- tidyr::crossing(
    reference_scopes %>% dplyr::select(scope_key),
    grille
  ) %>%
    dplyr::left_join(
      reference_members %>%
        dplyr::count(scope_key, breadth_bucket, depth_bucket,
                     name = "comparison_building_count"),
      by = c("scope_key", "breadth_bucket", "depth_bucket")
    ) %>%
    dplyr::left_join(
      reference_totals %>% dplyr::select(
        scope_key, comparison_total_buildings, comparison_label
      ),
      by = "scope_key"
    ) %>%
    dplyr::mutate(
      comparison_building_count = as.integer(
        dplyr::coalesce(comparison_building_count, 0L)
      ),
      comparison_share = dplyr::if_else(
        comparison_total_buildings > 0L,
        comparison_building_count / comparison_total_buildings,
        NA_real_
      )
    )

  cellules <- cellules %>%
    dplyr::left_join(
      reference_cells,
      by = c("scope_key", "breadth_bucket", "depth_bucket")
    ) %>%
    dplyr::mutate(
      comparison_label = dplyr::coalesce(comparison_label.y, comparison_label.x)
    ) %>%
    dplyr::select(-comparison_label.x, -comparison_label.y)

  attendus <- scopes %>% dplyr::select(territoire, type, comparison_label)
  absents <- attendus %>%
    dplyr::anti_join(groupes, by = c("territoire", "type")) %>%
    dplyr::mutate(
      total_buildings = 0L,
      breadth_bucket = NA_character_,
      breadth_min = NA_real_, breadth_max = NA_real_, breadth_label = NA_character_,
      depth_bucket = NA_character_,
      depth_min = NA_real_, depth_max = NA_real_, depth_label = NA_character_,
      building_count = NA_integer_, share = NA_real_, availability = "absent",
      comparison_label = NA_character_,
      comparison_total_buildings = NA_integer_,
      comparison_building_count = NA_integer_, comparison_share = NA_real_
    )

  dplyr::bind_rows(cellules, absents) %>%
    dplyr::mutate(
      mode = DISTRIBUTION_ACCES_BATIMENTS_MODE,
      mode_label = DISTRIBUTION_ACCES_BATIMENTS_MODE_LABEL,
      breadth_axis_label = DISTRIBUTION_ACCES_BATIMENTS_BREADTH_LABEL,
      depth_axis_label = DISTRIBUTION_ACCES_BATIMENTS_DEPTH_LABEL,
      source_id = DISTRIBUTION_ACCES_BATIMENTS_SOURCE_ID,
       source = DISTRIBUTION_ACCES_BATIMENTS_SOURCE,
      version = DISTRIBUTION_ACCES_BATIMENTS_VERSION,
      date_reference = DISTRIBUTION_ACCES_BATIMENTS_DATE_REFERENCE,
      date_publication = DISTRIBUTION_ACCES_BATIMENTS_DATE_PUBLICATION
    ) %>%
    dplyr::select(dplyr::all_of(CLES_DISTRIBUTION_ACCES_BATIMENTS)) %>%
    dplyr::arrange(type, territoire, breadth_bucket, depth_bucket)
}

# agreger_rampe_acces_batiments -----------------------------------------------
# Une courbe = les onze quantiles de la largeur du panier, pour un mode et un
# territoire. Les bâtiments sont triés séparément pour chaque mode : le point
# P50 d'une courbe ne prétend donc pas désigner le même bâtiment qu'une autre.
agreger_rampe_acces_batiments <- function(
    batiments,
    base_epci) {
  requis <- c("commune", "breadth_c", "breadth_b", "breadth_t")
  manquantes <- setdiff(requis, names(batiments))
  if (length(manquantes) > 0) {
    stop("Rampe d'accès — colonne(s) manquante(s) : ",
         paste(manquantes, collapse = ", "), ".", call. = FALSE)
  }
  if (nrow(batiments) == 0) {
    stop("Rampe d'accès — aucun bâtiment à agréger.", call. = FALSE)
  }

  base <- base_epci %>%
    dplyr::transmute(
      commune = as.character(CODGEO),
      epci = as.character(EPCI),
      departement = as.character(DEP)
    ) %>%
    dplyr::filter(departement %in% DEPT_BRETAGNE)
  mapped <- batiments %>%
    dplyr::transmute(
      commune = as.character(commune),
      breadth_c = as.numeric(breadth_c),
      breadth_b = as.numeric(breadth_b),
      breadth_t = as.numeric(breadth_t)
    ) %>%
    dplyr::left_join(base, by = "commune")
  if (any(is.na(mapped$departement))) {
    stop("Rampe d'accès — un code commune absent du référentiel Bretagne.",
         call. = FALSE)
  }

  membres <- dplyr::bind_rows(
    mapped %>% dplyr::transmute(
      territoire = commune, type = "commune", c = breadth_c, b = breadth_b,
      t = breadth_t
    ),
    mapped %>% dplyr::filter(!is.na(epci) & nzchar(epci)) %>%
      dplyr::transmute(
        territoire = epci, type = "epci", c = breadth_c, b = breadth_b,
        t = breadth_t
      ),
    mapped %>% dplyr::transmute(
      territoire = departement, type = "departement", c = breadth_c,
      b = breadth_b, t = breadth_t
    ),
    mapped %>% dplyr::transmute(
      territoire = "53", type = "region", c = breadth_c, b = breadth_b,
      t = breadth_t
    )
  ) %>%
    tidyr::pivot_longer(
      cols = c("c", "b", "t"), names_to = "mode",
      values_to = "accessible_types"
    )

  scopes <- contexte_comparaison_acces_batiments(base_epci)

  courbes <- membres %>%
    dplyr::group_by(territoire, type, mode) %>%
    dplyr::group_modify(~ tibble::tibble(
      total_buildings = nrow(.x),
      quantile = RAMPE_ACCES_BATIMENTS_QUANTILES,
      quantile_label = paste0(
        as.integer(RAMPE_ACCES_BATIMENTS_QUANTILES * 100), " %"
      ),
       accessible_types = as.numeric(stats::quantile(
         .x$accessible_types,
         probs = RAMPE_ACCES_BATIMENTS_QUANTILES,
         names = FALSE,
         type = 1
       ))
    )) %>%
    dplyr::ungroup() %>%
    dplyr::left_join(RAMPE_ACCES_BATIMENTS_MODES, by = "mode") %>%
    dplyr::mutate(
      availability = "complete",
      x_axis_label = RAMPE_ACCES_BATIMENTS_X_LABEL,
      y_axis_label = RAMPE_ACCES_BATIMENTS_Y_LABEL,
      source_id = DISTRIBUTION_ACCES_BATIMENTS_SOURCE_ID,
       source = DISTRIBUTION_ACCES_BATIMENTS_SOURCE,
      version = DISTRIBUTION_ACCES_BATIMENTS_VERSION,
      date_reference = DISTRIBUTION_ACCES_BATIMENTS_DATE_REFERENCE,
      date_publication = DISTRIBUTION_ACCES_BATIMENTS_DATE_PUBLICATION
    ) %>%
    dplyr::left_join(
      scopes %>% dplyr::select(territoire, type, scope_key, comparison_label),
      by = c("territoire", "type")
    )

  reference_members <- membres_comparaison_rampe_acces_batiments(
    mapped,
    scopes
  )
  reference_scopes <- scopes %>%
    dplyr::filter(!is.na(scope_key)) %>%
    dplyr::distinct(scope_key, comparison_label)
  reference_curves <- reference_members %>%
    tidyr::pivot_longer(
      cols = c("breadth_c", "breadth_b", "breadth_t"),
      names_to = "mode", values_to = "accessible_types"
    ) %>%
    dplyr::mutate(mode = sub("^breadth_", "", mode)) %>%
    dplyr::group_by(scope_key, mode) %>%
    dplyr::group_modify(~ tibble::tibble(
      comparison_total_buildings = nrow(.x),
      quantile = RAMPE_ACCES_BATIMENTS_QUANTILES,
      comparison_accessible_types = as.numeric(stats::quantile(
        .x$accessible_types,
        probs = RAMPE_ACCES_BATIMENTS_QUANTILES,
        names = FALSE,
        type = 1
      ))
    )) %>%
    dplyr::ungroup() %>%
    dplyr::left_join(reference_scopes, by = "scope_key")

  courbes <- courbes %>%
    dplyr::left_join(
      reference_curves,
      by = c("scope_key", "mode", "quantile")
    ) %>%
    dplyr::mutate(
      comparison_label = dplyr::coalesce(comparison_label.y, comparison_label.x)
    ) %>%
    dplyr::select(-comparison_label.x, -comparison_label.y)

  attendus <- scopes %>% dplyr::select(territoire, type)
  presentes <- courbes %>%
    dplyr::distinct(territoire, type, mode)
  absents <- tidyr::crossing(
    attendus,
    RAMPE_ACCES_BATIMENTS_MODES
  ) %>%
    dplyr::anti_join(presentes, by = c("territoire", "type", "mode")) %>%
    dplyr::mutate(
      availability = "absent",
      total_buildings = 0L,
      quantile = NA_real_,
      quantile_label = NA_character_,
      accessible_types = NA_real_,
      x_axis_label = RAMPE_ACCES_BATIMENTS_X_LABEL,
      y_axis_label = RAMPE_ACCES_BATIMENTS_Y_LABEL,
      source_id = DISTRIBUTION_ACCES_BATIMENTS_SOURCE_ID,
      source = DISTRIBUTION_ACCES_BATIMENTS_SOURCE,
      version = DISTRIBUTION_ACCES_BATIMENTS_VERSION,
      date_reference = DISTRIBUTION_ACCES_BATIMENTS_DATE_REFERENCE,
      date_publication = DISTRIBUTION_ACCES_BATIMENTS_DATE_PUBLICATION,
      comparison_label = NA_character_,
      comparison_total_buildings = NA_integer_,
      comparison_accessible_types = NA_real_
    )

  dplyr::bind_rows(courbes, absents) %>%
    dplyr::select(dplyr::all_of(CLES_RAMPE_ACCES_BATIMENTS)) %>%
    dplyr::arrange(type, territoire, mode, quantile)
}

# verifier_contrat_distribution_acces_batiments -------------------------------
verifier_contrat_distribution_acces_batiments <- function(distribution) {
  if (!is.data.frame(distribution) ||
      !identical(names(distribution), CLES_DISTRIBUTION_ACCES_BATIMENTS)) {
    stop("Distribution bâtiments invalide — colonnes inattendues.", call. = FALSE)
  }
  if (nrow(distribution) == 0) {
    stop("Distribution bâtiments invalide — aucune ligne.", call. = FALSE)
  }
  if (any(!distribution$type %in% c("commune", "epci", "departement", "region"))) {
    stop("Distribution bâtiments invalide — type de territoire inconnu.", call. = FALSE)
  }
  if (any(!distribution$availability %in% c("complete", "incomplete", "absent"))) {
    stop("Distribution bâtiments invalide — état de disponibilité inconnu.", call. = FALSE)
  }
  metadonnees <- c(
    "mode", "mode_label", "breadth_axis_label", "depth_axis_label",
    "source_id", "source", "version", "date_reference", "date_publication"
  )
  for (colonne in metadonnees) {
    if (any(is.na(distribution[[colonne]]) |
            !nzchar(as.character(distribution[[colonne]])))) {
      stop("Distribution bâtiments invalide — la métadonnée « ", colonne,
           " » est vide.", call. = FALSE)
    }
  }
  if (any(distribution$mode != DISTRIBUTION_ACCES_BATIMENTS_MODE) ||
      any(distribution$mode_label != DISTRIBUTION_ACCES_BATIMENTS_MODE_LABEL) ||
      any(distribution$breadth_axis_label != DISTRIBUTION_ACCES_BATIMENTS_BREADTH_LABEL) ||
      any(distribution$depth_axis_label != DISTRIBUTION_ACCES_BATIMENTS_DEPTH_LABEL)) {
    stop("Distribution bâtiments invalide — métadonnée d'axe ou de mode incohérente.",
         call. = FALSE)
  }

  completes <- distribution$availability == "complete"
  absents <- distribution$availability == "absent"
  if (any(distribution$total_buildings[completes] < 1 |
          !is.finite(distribution$total_buildings[completes]) |
          distribution$total_buildings[completes] != floor(distribution$total_buildings[completes]))) {
    stop("Distribution bâtiments invalide — un dénominateur complet est invalide.",
         call. = FALSE)
  }
  if (any(!is.na(distribution$share[completes]) &
          (distribution$share[completes] < 0 | distribution$share[completes] > 1))) {
    stop("Distribution bâtiments invalide — une part n'est pas dans [0, 1].",
         call. = FALSE)
  }
  if (any(!is.na(distribution$building_count[completes]) &
          (distribution$building_count[completes] < 0 |
           distribution$building_count[completes] != floor(distribution$building_count[completes])))) {
    stop("Distribution bâtiments invalide — un compte de cellule est invalide.",
         call. = FALSE)
  }
  avec_comparaison <- !is.na(distribution$comparison_label)
  if (any(!avec_comparaison &
          (!is.na(distribution$comparison_total_buildings) |
           !is.na(distribution$comparison_building_count) |
           !is.na(distribution$comparison_share)))) {
    stop("Distribution bâtiments invalide — valeurs comparées sans libellé.",
         call. = FALSE)
  }
  if (any(avec_comparaison &
          (is.na(distribution$comparison_total_buildings) |
           distribution$comparison_total_buildings < 1 |
           distribution$comparison_total_buildings != floor(distribution$comparison_total_buildings) |
           is.na(distribution$comparison_building_count) |
           distribution$comparison_building_count < 0 |
           distribution$comparison_building_count > distribution$comparison_total_buildings |
           distribution$comparison_building_count != floor(distribution$comparison_building_count) |
           is.na(distribution$comparison_share) |
           distribution$comparison_share < 0 |
           distribution$comparison_share > 1))) {
    stop("Distribution bâtiments invalide — une valeur comparée est invalide.",
         call. = FALSE)
  }
  if (any(distribution$total_buildings[absents] != 0) ||
      any(!is.na(distribution$building_count[absents])) ||
      any(!is.na(distribution$share[absents])) ||
      any(!is.na(distribution$comparison_label[absents])) ||
      any(!is.na(distribution$comparison_total_buildings[absents])) ||
      any(!is.na(distribution$comparison_building_count[absents])) ||
      any(!is.na(distribution$comparison_share[absents]))) {
    stop("Distribution bâtiments invalide — une absence porte des valeurs de cellule.",
         call. = FALSE)
  }

  identite <- paste(distribution$territoire, distribution$type, sep = "::")
  groupes <- split(seq_len(nrow(distribution)), identite)
  for (indices in groupes) {
    etat <- unique(distribution$availability[indices])
    if (length(etat) != 1L) {
      stop("Distribution bâtiments invalide — états mélangés pour un territoire.",
           call. = FALSE)
    }
    if (etat == "absent") {
      if (length(indices) != 1L) {
        stop("Distribution bâtiments invalide — une absence doit tenir sur une ligne.",
             call. = FALSE)
      }
      next
    }
    cellules <- distribution[indices, , drop = FALSE]
    if (nrow(cellules) != nrow(DISTRIBUTION_ACCES_BATIMENTS_BREADTH_BINS) *
        nrow(DISTRIBUTION_ACCES_BATIMENTS_DEPTH_BINS)) {
      stop("Distribution bâtiments invalide — grille incomplète.", call. = FALSE)
    }
    metadonnees_groupe <- c(
      "total_buildings", "mode", "mode_label", "breadth_axis_label",
      "depth_axis_label", "source_id", "source", "version", "date_reference",
      "date_publication", "comparison_label", "comparison_total_buildings"
    )
    for (colonne in metadonnees_groupe) {
      if (length(unique(cellules[[colonne]])) != 1L) {
        stop("Distribution bâtiments invalide — métadonnée divergente dans un territoire.",
             call. = FALSE)
      }
    }
    if (anyDuplicated(cellules[c("breadth_bucket", "depth_bucket")])) {
      stop("Distribution bâtiments invalide — cellule dupliquée.", call. = FALSE)
    }
    if (abs(sum(cellules$share) - 1) > 1e-12 ||
        sum(cellules$building_count) != cellules$total_buildings[[1]]) {
      stop("Distribution bâtiments invalide — les cellules ne recomposent pas le total.",
           call. = FALSE)
    }
    if (!is.na(cellules$comparison_label[[1L]]) &&
        (abs(sum(cellules$comparison_share) - 1) > 1e-12 ||
         sum(cellules$comparison_building_count) != cellules$comparison_total_buildings[[1L]])) {
      stop("Distribution bâtiments invalide — les cellules comparées ne recomposent pas le total.",
           call. = FALSE)
    }
  }
  invisible(distribution)
}

# verifier_contrat_rampe_acces_batiments --------------------------------------
verifier_contrat_rampe_acces_batiments <- function(rampe) {
  if (!is.data.frame(rampe) ||
      !identical(names(rampe), CLES_RAMPE_ACCES_BATIMENTS)) {
    stop("Rampe d'accès invalide — colonnes inattendues.", call. = FALSE)
  }
  if (nrow(rampe) == 0) {
    stop("Rampe d'accès invalide — aucune ligne.", call. = FALSE)
  }
  if (any(!rampe$type %in% c("commune", "epci", "departement", "region")) ||
      any(!rampe$mode %in% RAMPE_ACCES_BATIMENTS_MODES$mode) ||
      any(!rampe$availability %in% c("complete", "incomplete", "absent"))) {
    stop("Rampe d'accès invalide — territoire, mode ou disponibilité inconnu.",
         call. = FALSE)
  }
  metadonnees <- c(
    "mode_label", "x_axis_label", "y_axis_label", "source_id", "source",
    "version", "date_reference", "date_publication"
  )
  for (colonne in metadonnees) {
    if (any(is.na(rampe[[colonne]]) |
            !nzchar(as.character(rampe[[colonne]])))) {
      stop("Rampe d'accès invalide — la métadonnée « ", colonne,
           " » est vide.", call. = FALSE)
    }
  }
  if (any(rampe$x_axis_label != RAMPE_ACCES_BATIMENTS_X_LABEL) ||
      any(rampe$y_axis_label != RAMPE_ACCES_BATIMENTS_Y_LABEL)) {
    stop("Rampe d'accès invalide — libellé d'axe incohérent.", call. = FALSE)
  }
  avec_comparaison <- !is.na(rampe$comparison_label)
  if (any(!avec_comparaison &
          (!is.na(rampe$comparison_total_buildings) |
           !is.na(rampe$comparison_accessible_types)))) {
    stop("Rampe d'accès invalide — valeurs comparées sans libellé.", call. = FALSE)
  }
  if (any(avec_comparaison &
          (is.na(rampe$comparison_total_buildings) |
           rampe$comparison_total_buildings < 1 |
           rampe$comparison_total_buildings != floor(rampe$comparison_total_buildings) |
           is.na(rampe$comparison_accessible_types) |
           rampe$comparison_accessible_types < 0))) {
    stop("Rampe d'accès invalide — une valeur comparée est invalide.", call. = FALSE)
  }

  identite <- paste(rampe$territoire, rampe$type, rampe$mode, sep = "::")
  groupes <- split(seq_len(nrow(rampe)), identite)
  for (indices in groupes) {
    groupe <- rampe[indices, , drop = FALSE]
    etat <- unique(groupe$availability)
    if (length(etat) != 1L) {
      stop("Rampe d'accès invalide — états mélangés pour un territoire et un mode.",
           call. = FALSE)
    }
    if (length(unique(groupe$total_buildings)) != 1L ||
        length(unique(groupe$mode_label)) != 1L ||
        length(unique(groupe$x_axis_label)) != 1L ||
        length(unique(groupe$y_axis_label)) != 1L ||
        length(unique(groupe$source_id)) != 1L ||
        length(unique(groupe$source)) != 1L ||
        length(unique(groupe$version)) != 1L ||
        length(unique(groupe$date_reference)) != 1L ||
        length(unique(groupe$date_publication)) != 1L ||
        length(unique(groupe$comparison_label)) != 1L) {
      stop("Rampe d'accès invalide — métadonnée divergente dans un groupe.",
           call. = FALSE)
    }
    if (etat == "absent") {
      if (nrow(groupe) != 1L || groupe$total_buildings[[1L]] != 0L ||
           !is.na(groupe$quantile[[1L]]) ||
           !is.na(groupe$quantile_label[[1L]]) ||
           !is.na(groupe$accessible_types[[1L]]) ||
           !is.na(groupe$comparison_label[[1L]]) ||
           !is.na(groupe$comparison_total_buildings[[1L]]) ||
           !is.na(groupe$comparison_accessible_types[[1L]])) {
        stop("Rampe d'accès invalide — absence porte des valeurs de courbe.",
             call. = FALSE)
      }
      next
    }
    if (nrow(groupe) != length(RAMPE_ACCES_BATIMENTS_QUANTILES) ||
        anyDuplicated(groupe$quantile) ||
        !setequal(groupe$quantile, RAMPE_ACCES_BATIMENTS_QUANTILES) ||
        any(!is.finite(groupe$accessible_types)) ||
        any(groupe$accessible_types < 0 | groupe$accessible_types >
            nrow(lire_correspondances_typequ()))) {
      stop("Rampe d'accès invalide — points de courbe incohérents.",
           call. = FALSE)
    }
    expected_labels <- paste0(
      as.integer(groupe$quantile * 100), " %"
    )
    if (any(groupe$quantile_label != expected_labels)) {
      stop("Rampe d'accès invalide — libellé de quantile incohérent.",
           call. = FALSE)
    }
    ordered <- groupe[order(groupe$quantile), ]
    if (any(diff(ordered$accessible_types) < 0)) {
      stop("Rampe d'accès invalide — la courbe n'est pas croissante.",
           call. = FALSE)
    }
    if (!is.na(groupe$comparison_label[[1L]])) {
      ordered_comparison <- ordered$comparison_accessible_types
      if (any(diff(ordered_comparison) < 0)) {
        stop("Rampe d'accès invalide — la courbe comparée n'est pas croissante.",
             call. = FALSE)
      }
    }
  }
  territoires <- split(seq_len(nrow(rampe)),
                       paste(rampe$territoire, rampe$type, sep = "::"))
  for (indices in territoires) {
    lignes <- rampe[indices, , drop = FALSE]
    if (!setequal(lignes$mode, RAMPE_ACCES_BATIMENTS_MODES$mode)) {
      stop("Rampe d'accès invalide — un territoire ne porte pas les trois modes.",
           call. = FALSE)
    }
    if (length(unique(lignes$availability)) != 1L) {
      stop("Rampe d'accès invalide — états mélangés entre les modes d'un territoire.",
           call. = FALSE)
    }
  }
  invisible(rampe)
}
