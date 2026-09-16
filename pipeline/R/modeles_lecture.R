# modeles_lecture --------------------------------------------------------------
# Projections statiques destinées à une surface de lecture (ADR-0031). Les
# tables analytiques restent canoniques ; ce module sélectionne et ordonne leur
# sous-ensemble utile sans relire les anciennes projections JSON.

construire_modele_indicateur <- function(
    indicateurs,
    metadata,
    indicateur,
    snapshot_id) {
  if (!is.data.frame(indicateurs)) {
    stop("Modèle d'indicateur : `indicateurs` doit être une table.",
         call. = FALSE)
  }
  if (is.null(metadata$theme) || is.null(metadata$label) ||
      is.null(metadata$indicator_pages[[indicateur]])) {
    stop("Modèle d'indicateur : page `", indicateur,
         "` absente de la métadonnée.", call. = FALSE)
  }
  if (!is.character(snapshot_id) || length(snapshot_id) != 1L ||
      is.na(snapshot_id) || !nzchar(snapshot_id)) {
    stop("Modèle d'indicateur : `snapshot_id` doit être une chaîne non vide.",
         call. = FALSE)
  }

  page <- metadata$indicator_pages[[indicateur]]
  cle <- page$indicator
  niveaux <- unlist(page$levels, use.names = FALSE)
  sources_page <- unlist(page$sources, use.names = FALSE)
  sources <- metadata$source_records
  if (is.null(sources) || !all(sources_page %in% names(sources))) {
    stop("Modèle d'indicateur : source_records incomplets pour `", indicateur,
         "`.", call. = FALSE)
  }
  faits <- indicateurs[
    indicateurs$theme == metadata$theme &
      indicateurs$key == cle &
      indicateurs$type %in% niveaux,
    ,
    drop = FALSE
  ]

  # La sérialisation est stable quelle que soit l'ordre d'arrivée du canon.
  ordre_type <- match(faits$type,
                      c("commune", "epci", "departement", "region"))
  texte_ordre <- function(nom) {
    if (!nom %in% names(faits)) return(rep("", nrow(faits)))
    valeur <- as.character(faits[[nom]])
    valeur[is.na(valeur)] <- ""
    valeur
  }
  ordre <- order(
    ordre_type,
    texte_ordre("territoire"),
    texte_ordre("key"),
    texte_ordre("detail"),
    texte_ordre("sex"),
    texte_ordre("dimension")
  )
  faits <- faits[ordre, , drop = FALSE]
  rownames(faits) <- NULL

  libelles_details <- metadata$detail_labels[[cle]]
  if (is.null(libelles_details)) libelles_details <- setNames(list(), character())

  list(
    schema_version = "1",
    snapshot_id = snapshot_id,
    theme = metadata$theme,
    indicator = indicateur,
    theme_label = metadata$label,
    page = page,
    detail_labels = libelles_details,
    source_records = sources[sources_page],
    facts = faits
  )
}

# identifiant_snapshot ----------------------------------------------------------
# Un modèle porte l'horloge de la donnée, pas la date de génération du fichier.
# La date de référence la plus récente du jeu de vintages est déterministe et
# change dès qu'une source du run avance.
identifiant_snapshot <- function(vintages) {
  if (!is.data.frame(vintages) || !"date_reference" %in% names(vintages)) {
    stop("Modèle d'indicateur : les vintages doivent porter `date_reference`.",
         call. = FALSE)
  }
  dates <- as.Date(as.character(vintages$date_reference))
  dates <- dates[!is.na(dates)]
  if (length(dates) == 0L) {
    stop("Modèle d'indicateur : aucun vintage ne porte de date de référence.",
         call. = FALSE)
  }
  format(max(dates), "%Y-%m-%d")
}

# publier_modele_indicateur ----------------------------------------------------
# Écrit d'abord un voisin temporaire, puis le renomme : un serveur statique ne
# voit jamais un artefact tronqué pendant sa régénération.
publier_modele_indicateur <- function(modele, sortie = "public/data") {
  requis <- c("schema_version", "snapshot_id", "theme", "indicator", "facts")
  manquants <- setdiff(requis, names(modele))
  if (length(manquants) > 0L) {
    stop("Modèle d'indicateur : champ(s) manquant(s) : ",
         paste(manquants, collapse = ", "), ".", call. = FALSE)
  }
  composant_sur <- function(valeur) {
    is.character(valeur) && length(valeur) == 1L && !is.na(valeur) &&
      grepl("^[a-z0-9_-]+$", valeur)
  }
  if (!composant_sur(modele$theme) || !composant_sur(modele$indicator)) {
    stop("Modèle d'indicateur : thème ou indicateur impropre à un chemin.",
         call. = FALSE)
  }

  repertoire <- file.path(
    sortie, "modeles-lecture", "indicateurs", modele$theme
  )
  if (!dir.exists(repertoire)) dir.create(repertoire, recursive = TRUE)
  chemin <- file.path(repertoire, paste0(modele$indicator, ".json"))
  temporaire <- tempfile(
    paste0(".", modele$indicator, "-"), tmpdir = repertoire,
    fileext = ".json"
  )
  on.exit(if (file.exists(temporaire)) unlink(temporaire), add = TRUE)
  jsonlite::write_json(
    modele, temporaire,
    dataframe = "rows", na = "null", digits = 17, pretty = TRUE,
    auto_unbox = TRUE
  )
  if (file.exists(chemin)) unlink(chemin)
  if (!file.rename(temporaire, chemin)) {
    stop("Modèle d'indicateur : impossible de publier `", chemin, "`.",
         call. = FALSE)
  }
  chemin
}

# publier_modeles_lecture -------------------------------------------------------
# Le registre `read_model` vit dans la métadonnée de chaque page : la pipeline
# ne maintient donc pas une seconde liste d'indicateurs à publier.
publier_modeles_lecture <- function(payload, metadata, vintages,
                                    sortie = "public/data") {
  if (!is.list(payload) || !is.data.frame(payload$indicateurs)) {
    stop("Modèles d'indicateur : le payload doit porter sa table d'indicateurs.",
         call. = FALSE)
  }
  pages <- metadata$indicator_pages
  if (!is.list(pages) || is.null(names(pages))) {
    stop("Modèles d'indicateur : la métadonnée doit porter ses pages.",
         call. = FALSE)
  }
  a_publier <- names(pages)[vapply(
    pages,
    function(page) isTRUE(page$read_model),
    logical(1)
  )]
  if (length(a_publier) == 0L) return(character(0))

  snapshot_id <- identifiant_snapshot(vintages)
  vapply(a_publier, function(indicateur) {
    publier_modele_indicateur(
      construire_modele_indicateur(
        payload$indicateurs, metadata, indicateur, snapshot_id
      ),
      sortie = sortie
    )
  }, character(1))
}

# construire_modele_territoire -------------------------------------------------
# Une fiche ne doit pas reconstruire son contexte depuis la référence mondiale
# ni attendre plusieurs tables indépendantes. Cette projection garde la cible,
# les parents de son échelle et, pour le thème courant, ses lignes de faits avec
# les résultats compacts de son contexte de comparaison. Les lignes des pairs
# restent dans les tables canoniques et ne franchissent pas la sérialisation.
construire_modele_territoire <- function(payload, metadata, territoire,
                                          snapshot_id, directions = list()) {
  if (!is.list(payload) || !is.data.frame(payload$territoires)) {
    stop("Modèle de territoire : le payload doit porter sa référence de territoires.",
         call. = FALSE)
  }
  if (!is.character(territoire) || length(territoire) != 1L ||
      is.na(territoire) || !nzchar(territoire)) {
    stop("Modèle de territoire : `territoire` doit être une chaîne non vide.",
         call. = FALSE)
  }
  if (!is.character(snapshot_id) || length(snapshot_id) != 1L ||
      is.na(snapshot_id) || !nzchar(snapshot_id)) {
    stop("Modèle de territoire : `snapshot_id` doit être une chaîne non vide.",
         call. = FALSE)
  }
  requis_territoires <- c("territoire", "type", "nom", "departement", "epci")
  manquants <- setdiff(requis_territoires, names(payload$territoires))
  if (length(manquants) > 0L) {
    stop("Modèle de territoire : colonne(s) de référence absente(s) : ",
         paste(manquants, collapse = ", "), ".", call. = FALSE)
  }
  if (!is.list(metadata) || is.null(metadata$theme) || is.null(metadata$label)) {
    stop("Modèle de territoire : métadonnée de thème incomplète.", call. = FALSE)
  }

  reference <- payload$territoires
  cible <- reference[as.character(reference$territoire) == territoire, , drop = FALSE]
  if (nrow(cible) != 1L) {
    stop("Modèle de territoire : territoire `", territoire,
         "` absent ou dupliqué dans la référence.", call. = FALSE)
  }
  type <- as.character(cible$type[[1L]])
  if (!type %in% c("commune", "epci", "departement", "region")) {
    stop("Modèle de territoire : type de territoire inconnu `", type, "`.",
         call. = FALSE)
  }

  region_codes <- as.character(reference$territoire[reference$type == "region"])
  parent_codes <- character(0)
  if (type == "commune") {
    epci <- cible$epci[[1L]]
    departement <- cible$departement[[1L]]
    if (!is.na(epci) && nzchar(as.character(epci))) parent_codes <- c(parent_codes, epci)
    if (!is.na(departement) && nzchar(as.character(departement))) {
      parent_codes <- c(parent_codes, departement)
    }
    membres <- reference$type == "commune" &
      if (is.na(epci) || !nzchar(as.character(epci))) {
        TRUE
      } else {
        !is.na(reference$epci) & as.character(reference$epci) == as.character(epci)
      }
  } else if (type == "epci") {
    parent_codes <- as.character(cible$departement[[1L]])
    membres <- reference$type == "epci"
  } else if (type == "departement") {
    membres <- reference$type == "departement"
  } else {
    membres <- rep(FALSE, nrow(reference))
  }

  codes_contexte <- unique(c(
    territoire,
    as.character(reference$territoire[membres]),
    parent_codes,
    region_codes
  ))
  codes_contexte <- codes_contexte[!is.na(codes_contexte) & nzchar(codes_contexte)]
  contexte <- reference[as.character(reference$territoire) %in% codes_contexte,
                        , drop = FALSE]
  ordre_type <- match(as.character(contexte$type),
                      c("commune", "epci", "departement", "region"))
  contexte <- contexte[order(ordre_type, as.character(contexte$territoire)),
                       , drop = FALSE]
  rownames(contexte) <- NULL
  # La référence publiée ne porte que l'identité et son échelle de navigation.
  # Les membres du groupe restent disponibles ci-dessus pendant la projection,
  # mais leurs identités ne sont pas nécessaires au navigateur pour relire un
  # résultat de comparaison déjà calculé.
  codes_identite <- unique(c(territoire, parent_codes, region_codes))
  contexte_public <- reference[
    as.character(reference$territoire) %in% codes_identite, , drop = FALSE
  ]
  ordre_public <- match(
    as.character(contexte_public$type),
    c("commune", "epci", "departement", "region")
  )
  contexte_public <- contexte_public[
    order(ordre_public, as.character(contexte_public$territoire)), , drop = FALSE
  ]
  rownames(contexte_public) <- NULL

  extraire <- function(nom, codes = codes_contexte) {
    table <- payload[[nom]]
    if (is.null(table)) return(NULL)
    if (!is.data.frame(table) || !"territoire" %in% names(table)) {
      stop("Modèle de territoire : `", nom,
           "` doit être une table portant `territoire`.", call. = FALSE)
    }
    table[as.character(table$territoire) %in% codes, , drop = FALSE]
  }

  indicateurs <- extraire("indicateurs")
  histoires <- extraire("histoires")
  if (is.null(indicateurs) || is.null(histoires)) {
    stop("Modèle de territoire : le payload doit porter indicateurs et histoires.",
         call. = FALSE)
  }
  theme <- as.character(metadata$theme)
  indicateurs <- indicateurs[indicateurs$theme == theme, , drop = FALSE]
  histoires <- histoires[histoires$theme == theme, , drop = FALSE]

  # Le modèle publie le résultat de la comparaison, pas les lignes des pairs
  # nécessaires à son recalcul dans le navigateur (#532). La clé du contexte
  # est stable : #556–#558 pourront ajouter densite / epci / bretagne côte à
  # côte sans remplacer l'enveloppe ni son adresse.
  contexte_comparaison <- NULL
  if (theme == "mobilite" && type != "region") {
    epci_cible <- cible$epci[[1L]]
    mode <- if (type == "commune" && !is.na(epci_cible) &&
                nzchar(as.character(epci_cible))) "epci" else "bretagne"
    kind <- if (type == "commune") {
      if (mode == "epci") "communes-epci" else "communes-bretagne"
    } else if (type == "epci") {
      "epcis-bretagne"
    } else {
      "departements-bretagne"
    }
    label <- if (kind == "communes-epci") {
      nom_epci <- reference$nom[
        reference$type == "epci" &
          as.character(reference$territoire) == as.character(epci_cible)
      ]
      if (length(nom_epci) == 1L) paste("communes de", nom_epci[[1L]]) else
        "communes de l'EPCI"
    } else if (kind == "communes-bretagne") {
      "communes bretonnes"
    } else if (kind == "epcis-bretagne") {
      "EPCI bretons"
    } else {
      "départements bretons"
    }

    valeur_identite <- function(table, nom) {
      if (!nom %in% names(table)) return(rep(NA_character_, nrow(table)))
      as.character(table[[nom]])
    }
    signature_fait <- function(table) {
      paste(
        as.character(table$key),
        dplyr::coalesce(valeur_identite(table, "detail"), "<NA>"),
        dplyr::coalesce(valeur_identite(table, "sex"), "<NA>"),
        dplyr::coalesce(valeur_identite(table, "dimension"), "<NA>"),
        sep = "\r"
      )
    }
    indicateurs_par_signature <- split(indicateurs, signature_fait(indicateurs),
                                        drop = TRUE)
    lignes_cibles <- indicateurs[
      as.character(indicateurs$territoire) == territoire, , drop = FALSE
    ]
    faits <- lapply(seq_len(nrow(lignes_cibles)), function(i) {
      ligne <- lignes_cibles[i, , drop = FALSE]
      cle <- as.character(ligne$key[[1L]])
      direction <- directions[[cle]]
      if (is.null(direction)) return(NULL)
      pairs <- indicateurs_par_signature[[signature_fait(ligne)[[1L]]]]
      pairs <- pairs[
        as.character(pairs$territoire) %in%
          as.character(reference$territoire[membres]),
        , drop = FALSE
      ]
      valeurs <- pairs$value[!is.na(pairs$value)]
      cible_valeur <- ligne$value[[1L]]
      position <- if (is.na(cible_valeur) || length(valeurs) == 0L) {
        NA_real_
      } else if (direction == "low") {
        1 + sum(valeurs < cible_valeur)
      } else {
        1 + sum(valeurs > cible_valeur)
      }
      taille <- if (is.na(cible_valeur) || length(valeurs) == 0L) {
        NA_real_
      } else {
        length(valeurs)
      }
      statistique <- if (startsWith(cle, "avg_")) "mean" else "median"
      reference_valeur <- if (length(valeurs) == 0L) {
        NA_real_
      } else if (statistique == "median") {
        stats::median(valeurs)
      } else {
        poids <- vapply(
          as.character(pairs$territoire[!is.na(pairs$value)]),
          function(code) {
            lignes_poids <- indicateurs[
              as.character(indicateurs$territoire) == code &
                indicateurs$key == "nb_buildings" &
                is.na(valeur_identite(indicateurs, "detail")),
              , drop = FALSE
            ]
            if (nrow(lignes_poids) == 1L) lignes_poids$value[[1L]] else NA_real_
          },
          numeric(1)
        )
        if (anyNA(poids) || any(poids < 0) || sum(poids) == 0) NA_real_ else
          stats::weighted.mean(valeurs, poids)
      }
      tibble::tibble(
        key = cle,
        detail = valeur_identite(ligne, "detail")[[1L]],
        sex = valeur_identite(ligne, "sex")[[1L]],
        dimension = valeur_identite(ligne, "dimension")[[1L]],
        origin = "indicator",
        direction = if (direction == "low") "moins-est-mieux" else
          "plus-est-mieux",
        rank_position = position,
        rank_size = taille,
        reference_kind = statistique,
        reference_value = reference_valeur
      )
    })
    faits <- dplyr::bind_rows(faits)

    creer_fait_derive <- function(cle, valeur_cible, valeurs,
                                  direction = "low", statistique = "median",
                                  poids = NULL, rang = TRUE,
                                  detail = NA_character_) {
      utilisables <- !is.na(valeurs)
      valeurs_utiles <- valeurs[utilisables]
      if (length(valeurs_utiles) == 0L) return(NULL)
      poids_utiles <- if (is.null(poids)) NULL else poids[utilisables]
      position <- if (!rang || is.na(valeur_cible) || length(valeurs_utiles) == 0L) {
        NA_real_
      } else if (direction == "low") {
        1 + sum(valeurs_utiles < valeur_cible)
      } else {
        1 + sum(valeurs_utiles > valeur_cible)
      }
      taille <- if (!rang || is.na(valeur_cible) || length(valeurs_utiles) == 0L) {
        NA_integer_
      } else {
        length(valeurs_utiles)
      }
      reference_valeur <- if (length(valeurs_utiles) == 0L) {
        NA_real_
      } else if (statistique == "median") {
        stats::median(valeurs_utiles)
      } else if (is.null(poids_utiles)) {
        mean(valeurs_utiles)
      } else if (anyNA(poids_utiles) || any(poids_utiles < 0) ||
                 sum(poids_utiles) == 0) {
        NA_real_
      } else {
        stats::weighted.mean(valeurs_utiles, poids_utiles)
      }
      tibble::tibble(
        key = cle,
        detail = detail,
        sex = NA_character_,
        dimension = NA_character_,
        origin = "derived",
        direction = if (direction == "low") "moins-est-mieux" else
          "plus-est-mieux",
        rank_position = position,
        rank_size = taille,
        reference_kind = statistique,
        reference_value = reference_valeur
      )
    }
    codes_pairs <- as.character(reference$territoire[membres])
    lignes_scalaires <- indicateurs[
      is.na(valeur_identite(indicateurs, "detail")), , drop = FALSE
    ]
    cles_scalaires <- paste(
      as.character(lignes_scalaires$territoire),
      as.character(lignes_scalaires$key),
      sep = "\r"
    )
    valeur_indicateur <- function(code, cle) {
      index <- match(paste(code, cle, sep = "\r"), cles_scalaires)
      if (is.na(index)) NA_real_ else lignes_scalaires$value[[index]]
    }
    poids_batiments <- vapply(
      codes_pairs, valeur_indicateur, numeric(1), cle = "nb_buildings"
    )

    pertes <- list(
      avg_loss_tot_b = c("avg_tot_car", "avg_tot_b"),
      avg_loss_tot_t = c("avg_tot_car", "avg_tot_t"),
      avg_loss_div_b = c("avg_div_car", "avg_div_b"),
      avg_loss_div_t = c("avg_div_car", "avg_div_t")
    )
    faits_pertes <- lapply(names(pertes), function(cle) {
      sources <- pertes[[cle]]
      valeurs <- vapply(codes_pairs, function(code) {
        voiture <- valeur_indicateur(code, sources[[1L]])
        mode <- valeur_indicateur(code, sources[[2L]])
        if (is.na(voiture) || is.na(mode)) NA_real_ else max(0, voiture - mode)
      }, numeric(1))
      cible_index <- match(territoire, codes_pairs)
      creer_fait_derive(
        cle, if (is.na(cible_index)) NA_real_ else valeurs[[cible_index]],
        valeurs, direction = "low", statistique = "mean",
        poids = poids_batiments
      )
    })

    services <- c("admin", "food", "health", "bank", "school")
    noms_services <- c(
      admin = "administration", food = "alimentation", health = "sante",
      bank = "banque", school = "ecole"
    )
    faits_ecarts <- unlist(lapply(services, function(service) {
      cles <- list(
        carGap = c(paste0("share_", service, "_c"), paste0("share_", service, "_t")),
        bikeGain = c(paste0("share_", service, "_b"), paste0("share_", service, "_t"))
      )
      lapply(names(cles), function(nom) {
        valeurs <- vapply(codes_pairs, function(code) {
          gauche <- valeur_indicateur(code, cles[[nom]][[1L]])
          droite <- valeur_indicateur(code, cles[[nom]][[2L]])
          if (is.na(gauche) || is.na(droite)) NA_real_ else gauche - droite
        }, numeric(1))
        cible_index <- match(territoire, codes_pairs)
        creer_fait_derive(
          paste0("access.", noms_services[[service]], ".", nom),
          if (is.na(cible_index)) NA_real_ else valeurs[[cible_index]],
          valeurs,
          direction = if (nom == "carGap") "low" else "high",
          rang = FALSE
        )
      })
    }), recursive = FALSE)

    faits_histoires <- lapply(c("div_loss_t", "div_loss_b"), function(cle) {
      if (!cle %in% names(histoires)) return(NULL)
      lignes_pairs <- histoires[
        as.character(histoires$territoire) %in% codes_pairs, , drop = FALSE
      ]
      ligne_cible <- histoires[
        as.character(histoires$territoire) == territoire, , drop = FALSE
      ]
      creer_fait_derive(
        cle,
        if (nrow(ligne_cible) == 0L) NA_real_ else ligne_cible[[cle]][[1L]],
        lignes_pairs[[cle]], direction = "low"
      )
    })

    profils <- payload$profils_acces_bpe
    faits_profils <- list()
    if (is.data.frame(profils) && nrow(profils) > 0L &&
        all(c("territoire", "profil", "nombre_typequ") %in% names(profils))) {
      codes_avec_profils <- intersect(
        codes_pairs, unique(as.character(profils$territoire))
      )
      profils_cibles <- profils[as.character(profils$territoire) == territoire,
                                , drop = FALSE]
      if (nrow(profils_cibles) > 0L) {
        directions_profils <- c(
          "acces-pied-tc" = "high", "velo-compense" = "high",
          "voiture-requise" = "low", "inaccessible-20-minutes" = "low"
        )
        faits_profils <- lapply(names(directions_profils), function(profil) {
          valeurs <- vapply(codes_avec_profils, function(code) {
            lignes <- profils[
              as.character(profils$territoire) == code & profils$profil == profil,
              , drop = FALSE
            ]
            if (nrow(lignes) == 0L) 0 else lignes$nombre_typequ[[1L]]
          }, numeric(1))
          cible <- profils_cibles$nombre_typequ[profils_cibles$profil == profil]
          creer_fait_derive(
            "bpe_profile", if (length(cible) == 0L) 0 else cible[[1L]],
            valeurs, direction = directions_profils[[profil]],
            statistique = "mean", detail = profil
          )
        })
      }
    }
    faits <- dplyr::bind_rows(
      list(faits), faits_pertes, faits_ecarts, faits_histoires, faits_profils
    )
    distribution_cible <- payload$distribution_acces_batiments
    projection_distribution <- NULL
    if (is.data.frame(distribution_cible) && nrow(distribution_cible) > 0L) {
      distribution_cible <- distribution_cible[
        as.character(distribution_cible$territoire) == territoire, , drop = FALSE
      ]
      if (nrow(distribution_cible) > 0L &&
          !is.na(distribution_cible$comparison_label[[1L]])) {
        cellules <- distribution_cible[
          !is.na(distribution_cible$breadth_bucket) &
            !is.na(distribution_cible$depth_bucket),
          c("breadth_bucket", "depth_bucket", "comparison_building_count",
            "comparison_share"),
          drop = FALSE
        ]
        names(cellules) <- c(
          "breadth_bucket", "depth_bucket", "building_count", "share"
        )
        projection_distribution <- list(
          label = distribution_cible$comparison_label[[1L]],
          total_buildings = distribution_cible$comparison_total_buildings[[1L]],
          cells = cellules
        )
      }
    }
    rampe_cible <- payload$rampe_acces_batiments
    projection_rampe <- NULL
    if (is.data.frame(rampe_cible) && nrow(rampe_cible) > 0L) {
      rampe_cible <- rampe_cible[
        as.character(rampe_cible$territoire) == territoire, , drop = FALSE
      ]
      if (nrow(rampe_cible) > 0L && !is.na(rampe_cible$comparison_label[[1L]])) {
        points <- rampe_cible[
          !is.na(rampe_cible$quantile),
          c("mode", "quantile", "comparison_accessible_types"),
          drop = FALSE
        ]
        names(points) <- c("mode", "quantile", "accessible_types")
        projection_rampe <- list(
          label = rampe_cible$comparison_label[[1L]],
          total_buildings = rampe_cible$comparison_total_buildings[[1L]],
          points = points
        )
      }
    }
    contexte_comparaison <- stats::setNames(
      list(list(
        scope = list(kind = kind, label = label),
        faits = faits,
        distribution_batiments = projection_distribution,
        rampe_acces = projection_rampe
      )),
      mode
    )
  }

  # Les comparaisons ne nécessitent pas tous les indicateurs des pairs : elles
  # relisent la même signature (clé, détail et dimensions) que la ligne de la
  # cible. Garder uniquement ces signatures évite de multiplier la table
  # analytique entière par chaque territoire tout en conservant la matière et
  # les poids de la lecture Mobilité.
  signature <- function(table) {
    colonnes <- intersect(c("key", "detail", "sex", "dimension"), names(table))
    if (length(colonnes) == 0L || nrow(table) == 0L) return(character(0))
    valeurs <- lapply(colonnes, function(colonne) {
      valeur <- as.character(table[[colonne]])
      valeur[is.na(valeur)] <- "<NA>"
      valeur
    })
    do.call(paste, c(valeurs, sep = "\r"))
  }
  cible_indicateurs <- indicateurs[indicateurs$territoire == territoire, , drop = FALSE]
  signatures_cibles <- unique(signature(cible_indicateurs))
  if (length(signatures_cibles) > 0L) {
    candidats <- signature(indicateurs)
    indicateurs <- indicateurs[candidats %in% signatures_cibles, , drop = FALSE]
  }
  # `buildingCountValueOf` fournit les poids aux moyennes Mobilité. Il a besoin
  # des bâtiments des pairs même si la cible n'expose pas cette clé comme une
  # matière de lecture distincte.
  if (theme == "mobilite" && "key" %in% names(indicateurs)) {
    est_na_ou_absente <- function(nom) {
      if (!nom %in% names(indicateurs)) return(rep(TRUE, nrow(indicateurs)))
      is.na(indicateurs[[nom]])
    }
    indicateurs <- indicateurs[
      signature(indicateurs) %in% signatures_cibles |
        (indicateurs$key == "nb_buildings" &
           est_na_ou_absente("detail") &
           est_na_ou_absente("sex") &
           est_na_ou_absente("dimension")),
      , drop = FALSE
    ]
  }
  if (theme == "mobilite") {
    # La région reste nécessaire à l'introduction Mobilité (nombre total de
    # bâtiments bretons). Toutes les autres lignes de pairs sont remplacées par
    # `comparaisons` ci-dessus.
    est_total_bretagne <- as.character(indicateurs$territoire) %in% region_codes &
      indicateurs$key == "nb_buildings"
    indicateurs <- indicateurs[
      as.character(indicateurs$territoire) == territoire | est_total_bretagne,
      , drop = FALSE
    ]
    histoires <- histoires[
      as.character(histoires$territoire) == territoire, , drop = FALSE
    ]
  } else {
    indicateurs <- indicateurs[indicateurs$territoire == territoire, , drop = FALSE]
    histoires <- histoires[histoires$territoire == territoire, , drop = FALSE]
  }

  cible_liste <- as.list(cible[1L, , drop = FALSE])
  cible_liste <- lapply(cible_liste, function(valeur) valeur[[1L]])

  distribution_modele <- extraire(
    "distribution_acces_batiments", codes = territoire
  )
  if (is.data.frame(distribution_modele)) {
    for (colonne in c(
      "comparison_label", "comparison_total_buildings",
      "comparison_building_count", "comparison_share"
    )) {
      if (colonne %in% names(distribution_modele)) distribution_modele[[colonne]] <- NA
    }
  }
  rampe_modele <- extraire("rampe_acces_batiments", codes = territoire)
  if (is.data.frame(rampe_modele)) {
    for (colonne in c(
      "comparison_label", "comparison_total_buildings",
      "comparison_accessible_types"
    )) {
      if (colonne %in% names(rampe_modele)) rampe_modele[[colonne]] <- NA
    }
  }

  theme_modele <- list(
    theme = theme,
    indicateurs = indicateurs,
    histoires = histoires,
    theme_metadata = metadata,
    directions_comparaison = directions,
    profils_acces_bpe = extraire("profils_acces_bpe", codes = territoire),
    comparaisons = contexte_comparaison,
    # Les lignes gardent uniquement la preuve du territoire. Leur projection
    # comparée vit sous `comparaisons.<mode>` afin que #557 puisse ajouter
    # d'autres contextes sans remplacer ce contrat.
    distribution_acces_batiments = distribution_modele,
    rampe_acces_batiments = rampe_modele
  )

  list(
    schema_version = "1",
    snapshot_id = snapshot_id,
    territory = cible_liste,
    territoires = contexte_public,
    themes = stats::setNames(list(theme_modele), theme)
  )
}

# publier_modele_territoire -----------------------------------------------------
# Publication atomique de la fiche complète : le fichier temporaire est écrit
# dans le même répertoire que sa destination, puis renommé. Le chemin public
# est dérivé uniquement de l'identité portée par le modèle.
publier_modele_territoire <- function(modele, sortie = "public/data") {
  requis <- c("schema_version", "snapshot_id", "territory", "territoires", "themes")
  manquants <- setdiff(requis, names(modele))
  if (length(manquants) > 0L) {
    stop("Modèle de territoire : champ(s) manquant(s) : ",
         paste(manquants, collapse = ", "), ".", call. = FALSE)
  }
  composant_sur <- function(valeur) {
    is.character(valeur) && length(valeur) == 1L && !is.na(valeur) &&
      grepl("^[a-z0-9_-]+$", valeur)
  }
  type <- modele$territory$type
  territoire <- modele$territory$territoire
  if (!composant_sur(type) || !composant_sur(territoire) ||
      !type %in% c("commune", "epci", "departement", "region")) {
    stop("Modèle de territoire : identité impropre à un chemin.", call. = FALSE)
  }

  repertoire <- file.path(sortie, "modeles-lecture", "territoires", type)
  if (!dir.exists(repertoire)) dir.create(repertoire, recursive = TRUE)
  chemin <- file.path(repertoire, paste0(territoire, ".json"))
  temporaire <- tempfile(paste0(".", territoire, "-"), tmpdir = repertoire,
                         fileext = ".json")
  on.exit(if (file.exists(temporaire)) unlink(temporaire), add = TRUE)
  ordre_themes <- c("programmes", "mobilite", "demographie", "habitat",
                    "economie", "milieux")
  presents <- names(modele$themes)
  modele$themes <- modele$themes[c(
    intersect(ordre_themes, presents),
    setdiff(presents, ordre_themes)
  )]
  jsonlite::write_json(
    modele, temporaire,
    dataframe = "rows", na = "null", digits = 17, pretty = FALSE,
    auto_unbox = TRUE
  )
  if (file.exists(chemin)) unlink(chemin)
  if (!file.rename(temporaire, chemin)) {
    stop("Modèle de territoire : impossible de publier `", chemin, "`.",
         call. = FALSE)
  }
  chemin
}

# identifiant_snapshot_territoires ---------------------------------------------
# Un run complet peut assembler plusieurs thèmes ; l'enveloppe porte une seule
# horloge, choisie de façon déterministe parmi les vintages effectivement
# publiés.
identifiant_snapshot_territoires <- function(vintages) {
  tables <- if (is.data.frame(vintages)) list(vintages) else vintages
  if (!is.list(tables) || length(tables) == 0L) {
    stop("Modèles de territoire : aucune table de vintages.", call. = FALSE)
  }
  dates <- do.call(c, lapply(tables, function(table) {
    if (!is.data.frame(table) || !"date_reference" %in% names(table)) {
      stop("Modèles de territoire : table de vintages sans `date_reference`.",
           call. = FALSE)
    }
    as.Date(as.character(table$date_reference))
  }))
  dates <- dates[!is.na(dates)]
  if (length(dates) == 0L) {
    stop("Modèles de territoire : aucun vintage ne porte de date de référence.",
         call. = FALSE)
  }
  format(max(dates), "%Y-%m-%d")
}

# construire_modeles_territoire -----------------------------------------------
# Assemble les projections de thèmes déjà calculées dans un seul fichier par
# territoire. Les payloads sont ceux retournés par les seams de publication :
# cela couvre aussi les thèmes spécialisés qui n'ont pas de target payload_*.
construire_modeles_territoire <- function(payloads, metadatas, vintages,
                                           snapshot_id = NULL,
                                           territoires = NULL,
                                           directions = NULL,
                                           publier = NULL) {
  if (!is.list(payloads) || length(payloads) == 0L || is.null(names(payloads))) {
    stop("Modèles de territoire : payloads nommés attendus.", call. = FALSE)
  }
  if (!is.list(metadatas) || !identical(names(payloads), names(metadatas))) {
    stop("Modèles de territoire : métadonnées non alignées sur les payloads.",
         call. = FALSE)
  }
  if (!is.list(vintages) || !identical(names(payloads), names(vintages))) {
    stop("Modèles de territoire : vintages non alignés sur les payloads.",
         call. = FALSE)
  }
  if (is.null(directions)) {
    directions <- stats::setNames(rep(list(list()), length(payloads)), names(payloads))
  }
  if (!is.list(directions) || !identical(names(payloads), names(directions))) {
    stop("Modèles de territoire : directions non alignées sur les payloads.",
         call. = FALSE)
  }
  premiere <- payloads[[1L]]
  if (!is.list(premiere) || !is.data.frame(premiere$territoires)) {
    stop("Modèles de territoire : premier payload sans référence de territoires.",
         call. = FALSE)
  }
  codes_disponibles <- as.character(premiere$territoires$territoire)
  codes <- if (is.null(territoires)) {
    codes_disponibles
  } else {
    if (!is.character(territoires) || anyNA(territoires) ||
        any(!nzchar(territoires))) {
      stop("Modèles de territoire : `territoires` doit être un vecteur de codes non vides.",
           call. = FALSE)
    }
    inconnus <- setdiff(territoires, codes_disponibles)
    if (length(inconnus) > 0L) {
      stop("Modèles de territoire : territoire(s) absent(s) de la référence : ",
           paste(inconnus, collapse = ", "), ".", call. = FALSE)
    }
    unique(territoires)
  }
  if (is.null(snapshot_id)) snapshot_id <- identifiant_snapshot_territoires(vintages)
  # Indexer une fois les grandes tables canoniques. Sans cet index, chaque
  # fiche Mobilité rescannerait la table mondiale pour chacun de ses ~80 faits
  # comparés : le run complet devient quadratique et ne publie rien avant
  # d'avoir construit les 1 268 modèles en mémoire.
  champs_indexables <- c(
    "indicateurs", "histoires", "profils_acces_bpe",
    "distribution_acces_batiments", "rampe_acces_batiments"
  )
  indexer <- function(table) {
    if (!is.data.frame(table) || !"territoire" %in% names(table)) return(NULL)
    split(table, as.character(table$territoire), drop = TRUE)
  }
  indexes <- lapply(payloads, function(payload) {
    stats::setNames(
      lapply(champs_indexables, function(champ) indexer(payload[[champ]])),
      champs_indexables
    )
  })
  sous_table <- function(table, index, codes) {
    if (!is.data.frame(table) || is.null(index)) return(table)
    morceaux <- unname(index[intersect(codes, names(index))])
    if (length(morceaux) == 0L) return(table[0, , drop = FALSE])
    dplyr::bind_rows(morceaux)
  }
  reference_complete <- premiere$territoires
  region_codes <- as.character(
    reference_complete$territoire[reference_complete$type == "region"]
  )
  codes_calcul <- function(code) {
    cible <- reference_complete[
      as.character(reference_complete$territoire) == code, , drop = FALSE
    ]
    type <- as.character(cible$type[[1L]])
    pairs <- if (type == "commune") {
      epci <- cible$epci[[1L]]
      if (!is.na(epci) && nzchar(as.character(epci))) {
        as.character(reference_complete$territoire[
          reference_complete$type == "commune" &
            !is.na(reference_complete$epci) &
            as.character(reference_complete$epci) == as.character(epci)
        ])
      } else {
        as.character(reference_complete$territoire[
          reference_complete$type == "commune"
        ])
      }
    } else if (type == "epci") {
      as.character(reference_complete$territoire[reference_complete$type == "epci"])
    } else if (type == "departement") {
      as.character(reference_complete$territoire[
        reference_complete$type == "departement"
      ])
    } else {
      character(0)
    }
    unique(c(code, pairs, region_codes))
  }
  modeles <- lapply(codes, function(code) {
    codes_mobilite <- codes_calcul(code)
    payloads_locaux <- Map(function(payload, index, nom_theme) {
      local <- payload
      local$territoires <- reference_complete
      codes_faits <- if (nom_theme == "mobilite") codes_mobilite else code
      local$indicateurs <- sous_table(
        payload$indicateurs, index$indicateurs, codes_faits
      )
      local$histoires <- sous_table(
        payload$histoires, index$histoires,
        if (nom_theme == "mobilite") codes_mobilite else code
      )
      local$profils_acces_bpe <- sous_table(
        payload$profils_acces_bpe, index$profils_acces_bpe,
        if (nom_theme == "mobilite") codes_mobilite else code
      )
      local$distribution_acces_batiments <- sous_table(
        payload$distribution_acces_batiments,
        index$distribution_acces_batiments,
        code
      )
      local$rampe_acces_batiments <- sous_table(
        payload$rampe_acces_batiments, index$rampe_acces_batiments,
        code
      )
      local
    }, payloads, indexes, names(payloads))
    projections <- Map(
      function(payload, metadata, registre_directions) {
        construire_modele_territoire(
          payload, metadata, code, snapshot_id,
          directions = registre_directions
        )
      },
      payloads_locaux,
      metadatas,
      directions
    )
    modele <- projections[[1L]]
    modele$themes <- lapply(projections, function(projection) {
      projection$themes[[1L]]
    })
    names(modele$themes) <- names(payloads)
    if (is.null(publier)) modele else publier(modele)
  })
  stats::setNames(modeles, codes)
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
    rampe_acces_batiments = NULL
  )
}

# publier_modeles_territoire ----------------------------------------------------
# Un payload de thème partage la même référence de territoires ; chaque ligne
# devient une fiche adressable. Le registre de thème reste dans l'enveloppe,
# de sorte que l'ajout d'un thème ne crée pas une nouvelle URL.
publier_modeles_territoire <- function(payload, metadata, vintages,
                                       sortie = "public/data",
                                       directions = list()) {
  if (!is.list(payload) || !is.data.frame(payload$territoires)) {
    stop("Modèles de territoire : payload sans référence de territoires.",
         call. = FALSE)
  }
  snapshot_id <- identifiant_snapshot(vintages)
  territoires <- as.character(payload$territoires$territoire)
  vapply(territoires, function(territoire) {
    publier_modele_territoire(
      construire_modele_territoire(
        payload, metadata, territoire, snapshot_id, directions = directions
      ),
      sortie = sortie
    )
  }, character(1))
}

# publier_modeles_territoire_complet --------------------------------------------
publier_modeles_territoire_complet <- function(payloads, metadatas, vintages,
                                                sortie = "public/data",
                                                snapshot_id = NULL,
                                                territoires = NULL,
                                                directions = NULL) {
  themes_requis <- c("programmes", "mobilite", "demographie", "habitat",
                     "economie", "milieux")
  if (!identical(names(payloads), themes_requis)) {
    stop("Modèles de territoire : la publication complète exige exactement les six thèmes canoniques.",
         call. = FALSE)
  }
  chemins <- construire_modeles_territoire(
    payloads, metadatas, vintages, snapshot_id = snapshot_id,
    territoires = territoires,
    directions = directions,
    publier = function(modele) publier_modele_territoire(modele, sortie = sortie)
  )
  unname(unlist(chemins, use.names = FALSE))
}

# publier_modeles_territoire_depuis_json ---------------------------------------
# L'oracle séquentiel ne republie un modèle qu'une fois les six paires de thème
# présentes. Il relit alors le même état canonique que le graphe complet : aucun
# artefact partiel ou assemblage de snapshots ne peut être servi entre deux runs.
publier_modeles_territoire_depuis_json <- function(input, sortie = input,
                                                    territoires = NULL,
                                                    strict = TRUE) {
  themes <- c("programmes", "mobilite", "demographie", "habitat",
              "economie", "milieux")
  fichiers_theme <- unlist(lapply(themes, function(theme) {
    file.path(input, paste0(c("indicateurs_", "histoires_", "theme_"),
                            theme, ".json"))
  }), use.names = FALSE)
  fichiers_requis <- c(file.path(input, "territoires.json"),
                        file.path(input, "vintages.json"), fichiers_theme)
  manquants <- fichiers_requis[!file.exists(fichiers_requis)]
  if (length(manquants) > 0L) {
    if (!strict) return(character(0))
    stop("Modèles de territoire : fichiers canoniques manquants : ",
         paste(basename(manquants), collapse = ", "), ".", call. = FALSE)
  }
  lire_table <- function(chemin, obligatoire = TRUE) {
    if (!file.exists(chemin)) {
      if (!obligatoire) return(NULL)
      stop("Fichier canonique absent : ", chemin, ".", call. = FALSE)
    }
    valeur <- jsonlite::fromJSON(chemin, simplifyVector = TRUE,
                                 simplifyDataFrame = TRUE)
    if (is.data.frame(valeur)) return(valeur)
    if (is.null(valeur) || length(valeur) == 0L) return(data.frame())
    as.data.frame(valeur, stringsAsFactors = FALSE)
  }
  reference <- lire_table(file.path(input, "territoires.json"))
  vintages_partages <- lire_table(file.path(input, "vintages.json"))
  descripteurs <- list(
    programmes = theme_programmes(), mobilite = theme_mobilite(),
    demographie = theme_demographie(), habitat = theme_habitat(),
    economie = theme_economie(), milieux = theme_milieux()
  )
  payloads <- metadatas <- vintages <- directions <- stats::setNames(vector("list", 6L), themes)
  for (theme in themes) {
    histoires <- lire_table(file.path(input, paste0("histoires_", theme, ".json")))
    if (nrow(histoires) == 0L && !"territoire" %in% names(histoires)) {
      histoires <- data.frame(
        territoire = character(), type = character(), theme = character(),
        stringsAsFactors = FALSE
      )
    }
    payloads[[theme]] <- list(
      territoires = reference,
      indicateurs = lire_table(file.path(input, paste0("indicateurs_", theme, ".json"))),
      histoires = histoires,
      profils_acces_bpe = if (theme == "mobilite") lire_table(
        file.path(input, "profils_acces_bpe.json")
      ) else NULL,
      distribution_acces_batiments = if (theme == "mobilite") lire_table(
        file.path(input, "distribution_acces_batiments.json")
      ) else NULL,
      rampe_acces_batiments = if (theme == "mobilite") lire_table(
        file.path(input, "rampe_acces_batiments.json")
      ) else NULL
    )
    metadatas[[theme]] <- jsonlite::fromJSON(
      file.path(input, paste0("theme_", theme, ".json")),
      simplifyVector = FALSE, simplifyDataFrame = FALSE
    )
    vintages[[theme]] <- vintages_partages
    registre_directions <- descripteurs[[theme]]$directions
    directions[[theme]] <- if (is.null(registre_directions)) list() else registre_directions
  }
  publier_modeles_territoire_complet(
    payloads, metadatas, vintages, sortie = sortie,
    snapshot_id = identifiant_snapshot_territoires(vintages),
    territoires = territoires, directions = directions
  )
}
