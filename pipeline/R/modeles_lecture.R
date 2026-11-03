# modeles_lecture --------------------------------------------------------------
# Projections statiques destinées à une surface de lecture (ADR-0031). Les
# tables analytiques restent canoniques ; ce module ne contient plus AUCUN
# générateur de modèles de lecture.
#
# Issue #890 : la génération PLANIFIÉE est retirée — plus aucune cible du
# graphe _targets.R n'appelle ce module (modeles_lecture_<thème>,
# manifeste_modeles_lecture et modeles_territoire supprimées, de même que les
# générateurs/publieurs d'indicateurs et de manifeste). Issue #891 : le
# rafraîchissement MANUEL depuis les JSON publiés est retiré à son tour, avec
# le script publish-territory-models.R et les builders/publieurs de territoire.
# Les artefacts déjà
# publiés (public/data/modeles-lecture/**, app/dist/data/**) et leurs
# validateurs (validate:territory-model, validateurs d'artefacts d'indicateurs
# et leurs tests de contrat) restent inchangés.
#
# Ce qui reste ici sont les seuls helpers encore appelé hors génération :
# - verifier_integrite_projections_acces_batiments : contrôle d'intégrité des
#   projections de comparaison bâtiment, appelé par
#   scripts/publish-building-comparisons.R (publieur manuel retenu) ;
# - construire_payload_territoire_programmes : adaptateur du payload Programmes
#   vers le contrat atomique, appelé par la cible projection_programmes.

# verifier_integrite_projections_acces_batiments -------------------------------
# Les projections de comparaison sont des tables contractuelles complètes, pas
# des fragments que chaque fiche peut filtrer avant de les comprendre. Vérifier
# leurs clés et leur identité de contexte avant la projection par territoire
# rend les lignes inconnues, les modes invalides et les doublons bruyants.
verifier_integrite_projections_acces_batiments <- function(payload) {
  reference <- payload$territoires
  if (!is.data.frame(reference) ||
      !all(c("territoire", "type") %in% names(reference))) {
    stop("Modèle de territoire : référence territoriale invalide pour les projections bâtiment.",
         call. = FALSE)
  }

  contextes_attendus <- dplyr::bind_rows(lapply(seq_len(nrow(reference)), function(i) {
    cible <- reference[i, , drop = FALSE]
    contextes <- resoudre_contextes_comparaison(
      reference, cible, as.character(cible$type[[1L]])
    )
    if (length(contextes) == 0L) return(tibble::tibble())
    dplyr::bind_rows(lapply(contextes, function(contexte) {
      tibble::tibble(
        territoire = as.character(cible$territoire[[1L]]),
        type = as.character(cible$type[[1L]]),
        comparison_mode = contexte$mode,
        scope_kind = contexte$kind,
        scope_label = contexte$label
      )
    }))
  }))

  verifier_table <- function(table, nom, niveau) {
    if (is.null(table)) return(invisible(NULL))
    if (!is.data.frame(table)) {
      stop("Modèle de territoire : la projection bâtiment `", nom,
           "` doit être une table.", call. = FALSE)
    }
    requis <- c("territoire", "type", "comparison_mode", "scope_kind", "scope_label")
    manquants <- setdiff(requis, names(table))
    if (length(manquants) > 0L) {
      stop("Modèle de territoire : la projection bâtiment `", nom,
           "` ne porte pas ses métadonnées de contexte : ",
           paste(manquants, collapse = ", "), ".", call. = FALSE)
    }
    codes <- as.character(table$territoire)
    codes_reference <- as.character(reference$territoire)
    if (any(is.na(codes) | !nzchar(codes) | !codes %in% codes_reference)) {
      ligne <- which(is.na(codes) | !nzchar(codes) | !codes %in% codes_reference)[[1L]]
      stop("Modèle de territoire : territoire inconnu dans la projection bâtiment `",
           nom, "` à la ligne ", ligne, ".", call. = FALSE)
    }
    modes <- as.character(table$comparison_mode)
    modes_connus <- c("densite", "epci", "bretagne")
    if (any(is.na(modes) | !modes %in% modes_connus)) {
      ligne <- which(is.na(modes) | !modes %in% modes_connus)[[1L]]
      stop("Modèle de territoire : mode de comparaison inconnu dans la projection bâtiment `",
           nom, "` à la ligne ", ligne, ".", call. = FALSE)
    }

    cles <- paste(codes, modes, sep = "\r")
    cles_attendues <- paste(
      contextes_attendus$territoire,
      contextes_attendus$comparison_mode,
      sep = "\r"
    )
    index <- match(cles, cles_attendues)
    if (anyNA(index)) {
      ligne <- which(is.na(index))[[1L]]
      stop("Modèle de territoire : mode de comparaison `",
           modes[[ligne]], "` indisponible pour le territoire `",
           codes[[ligne]], "` dans `", nom, "`.", call. = FALSE)
    }
    attendu <- contextes_attendus[index, , drop = FALSE]
    incoherentes <- is.na(table$type) |
      as.character(table$type) != as.character(attendu$type) |
      is.na(table$scope_kind) |
      as.character(table$scope_kind) != as.character(attendu$scope_kind) |
      is.na(table$scope_label) |
      as.character(table$scope_label) != as.character(attendu$scope_label)
    if (any(incoherentes)) {
      ligne <- which(incoherentes)[[1L]]
      stop("Modèle de territoire : la projection bâtiment `", nom,
           "` porte un périmètre ou une identité incohérente pour `",
           codes[[ligne]], "`.", call. = FALSE)
    }

    if (niveau == "distribution") {
      requis_cellules <- c("breadth_bucket", "depth_bucket")
      manquantes_cellules <- setdiff(requis_cellules, names(table))
      if (length(manquantes_cellules) > 0L) {
        stop("Modèle de territoire : la projection bâtiment `", nom,
             "` ne porte pas ses cellules.", call. = FALSE)
      }
      signature <- paste(
        codes, modes, as.character(table$breadth_bucket),
        as.character(table$depth_bucket), sep = "\r"
      )
    } else {
      requis_points <- c("mode", "quantile")
      manquantes_points <- setdiff(requis_points, names(table))
      if (length(manquantes_points) > 0L) {
        stop("Modèle de territoire : la projection bâtiment `", nom,
             "` ne porte pas ses points de rampe.", call. = FALSE)
      }
      signature <- paste(
        codes, modes, as.character(table$mode),
        as.character(table$quantile), sep = "\r"
      )
    }
    if (anyDuplicated(signature)) {
      stop("Modèle de territoire : projection bâtiment `", nom,
           "` contient une ligne en double.", call. = FALSE)
    }
    invisible(NULL)
  }

  verifier_table(
    payload$distribution_acces_batiments_comparaisons,
    "distribution_acces_batiments_comparaisons", "distribution"
  )
  verifier_table(
    payload$rampe_acces_batiments_comparaisons,
    "rampe_acces_batiments_comparaisons", "rampe"
  )
  invisible(payload)
}

# construire_payload_territoire_programmes ------------------------------------
# Programmes publie historiquement un payload partagé {membres, subventions},
# distinct du contrat indicateurs/histoires des fiches. Cet adaptateur garde ce
# contrat de publication intact et expose seulement la projection nécessaire à
# l'agrégateur atomique par territoire.
construire_payload_territoire_programmes <- function(programmes, territoires) {
  if (!is.list(programmes) || !is.data.frame(programmes$membres) ||
      !is.data.frame(programmes$subventions)) {
    stop("Modèles de territoire : payload Programmes incomplet.", call. = FALSE)
  }
  if (!is.data.frame(territoires) ||
      !all(c("territoire", "type") %in% names(territoires))) {
    stop("Modèles de territoire : référence de territoires invalide pour Programmes.",
         call. = FALSE)
  }
  list(
    territoires = territoires,
    indicateurs = construire_indicateurs_programmes(
      programmes$membres, programmes$subventions
    ),
    histoires = data.frame(
      territoire = character(), type = character(), theme = character(),
      stringsAsFactors = FALSE
    ),
    profils_acces_bpe = NULL,
      distribution_acces_batiments = NULL,
      rampe_acces_batiments = NULL,
      distribution_acces_batiments_comparaisons = NULL,
      rampe_acces_batiments_comparaisons = NULL
  )
}
