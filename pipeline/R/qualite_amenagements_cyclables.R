# qualite_amenagements_cyclables -------------------------------------------------
# La porte de qualité + le repli du snapshot Geovelo « Aménagements cyclables »
# (issue #222, ticket #229) — la source du mode `b` de `reseaux`.
# L'incident du 01/08/2026 (un snapshot publié VIDE — FeatureCollection de
# 169 octets, corrigé 5 jours plus tard, signalé par la DDT Haute-Marne)
# impose la garde : un indicateur n'est JAMAIS publié depuis un snapshot frais
# sans contrôle de forme.
#   - verifier_qualite_amenagements : la porte à DEUX niveaux, des modes
#     d'échec distincts (France entière vs Bretagne) ;
#   - construire_amenagements_cyclables : l'orchestrateur — lit le parquet
#     frais (via le lecteur injecté), normalise, passe la porte. Succès : la
#     table normalisée est mise en cache comme `dernier_bon` (le .rds du
#     ticket, avec SA date de snapshot) et la table + le vintage frais sont
#     retournés. Échec : repli sur le `dernier_bon` du cache — la table + SON
#     vintage (la date du dernier bon, jamais celle du cassé, jamais
#     « aujourd'hui ») ; un échec SANS dernier bon en cache est une erreur
#     dure (le run ne publie jamais de la donnée inventée).

# SEUIL_LIGNES_AMENAGEMENTS ------------------------------------------------------
# Le seuil de la porte France entière : le fichier réel porte 412 681 lignes ;
# un seuil à 10 000 (deux ordres de grandeur sous la norme) attrape les
# snapshots vides ET les troncatures, sans jamais frôler la variance
# légitime.
SEUIL_LIGNES_AMENAGEMENTS <- 10000

# SEUIL_REGRESSION_COUVERTURE ---------------------------------------------------
# Le seuil du signal de régression du diagnostic de couverture (issue #233) :
# un département dont les LIGNES ou les KM tombent sous la MOITIÉ de son
# snapshot précédent est un signal pour l'humain — jamais un crash (à la
# différence de la porte de qualité, qui s'arrête sur la forme d'ensemble).
# Le seuil est volontairement éloigné de la variance légitime d'un mois à
# l'autre : une chute de plus de 50 % sur un département est un effondrement,
# pas un bruit.
SEUIL_REGRESSION_COUVERTURE <- 0.5

# diagnostic_couverture_amenagements --------------------------------------------
# Le diagnostic de couverture PAR DÉPARTEMENT (issue #233) : pour chaque
# département breton, les LIGNES et les KM du snapshot COURANT vs le PRÉCÉDENT
# (le dernier bon du cache) — le signal de régression DISTINCT de la porte de
# qualité. La porte vérifie la forme d'ENSEMBLE (France entière, Bretagne non
# vide) et s'arrête bruyamment ; le diagnostic, lui, regarde CHAQUE département
# — une chute nette (lignes ou km qui s'effondrent, un département qui
# disparaît) est un signal, jamais un crash. Le premier run (sans précédent)
# porte le courant et NA pour le précédent : un signal est impossible sans
# base. Les km sont mesurés en EPSG:2154 (la consigne du contrat — jamais en
# degrés), chaque segment compté une fois (géométrie unique, la convention du
# ratio de la figure). Déterministe : trié par département.
diagnostic_couverture_amenagements <- function(actuel, precedent = NULL) {
  verifier <- function(table, quoi) {
    if (!inherits(table, "sf") || !"code_com_d" %in% names(table)) {
      stop("Diagnostic de couverture — ", quoi, " doit être un sf portant ",
           "code_com_d.", call. = FALSE)
    }
  }
  verifier(actuel, "le snapshot actuel")

  resume <- function(table) {
    if (is.null(table)) return(NULL)
    verifier(table, "le snapshot précédent")
    tbl <- sf::st_drop_geometry(table)
    tbl$km <- as.numeric(sf::st_length(
      sf::st_transform(sf::st_geometry(table), 2154)
    )) / 1000
    tbl %>%
      dplyr::mutate(departement = substr(code_com_d, 1, 2)) %>%
      dplyr::group_by(departement) %>%
      dplyr::summarise(lignes = dplyr::n(), km = sum(km), .groups = "drop")
  }

  sur_quatre_departements <- function(mesures) {
    if (is.null(mesures)) {
      tibble::tibble(departement = DEPT_BRETAGNE,
                     lignes = NA_integer_, km = NA_real_)
    } else {
      # un département ABSENT d'un snapshot porte 0 (jamais une ligne
      # manquante, jamais un NA) : disparaître du courant EST un signal
      tibble::tibble(departement = DEPT_BRETAGNE) %>%
        dplyr::left_join(mesures, by = "departement") %>%
        dplyr::mutate(lignes = dplyr::coalesce(lignes, 0L),
                      km = dplyr::coalesce(km, 0))
    }
  }

  dplyr::left_join(
    sur_quatre_departements(resume(actuel)) %>%
      dplyr::rename(lignes_actuel = lignes, km_actuel = km),
    sur_quatre_departements(resume(precedent)) %>%
      dplyr::rename(lignes_precedent = lignes, km_precedent = km),
    by = "departement"
  ) %>%
    dplyr::mutate(
      regression = lignes_actuel < SEUIL_REGRESSION_COUVERTURE * lignes_precedent |
        km_actuel < SEUIL_REGRESSION_COUVERTURE * km_precedent
    ) %>%
    dplyr::arrange(departement)
}

# verifier_qualite_amenagements ---------------------------------------------------
# La porte de qualité du snapshot : DEUX niveaux, des échecs distincts.
#   1. France entière : nrow > SEUIL_LIGNES_AMENAGEMENTS et les colonnes
#      requises (ame_d, ame_g, code_com_d, code_com_g) présentes — attrape le
#      snapshot vide (le 169 octets) ET le parquet à schéma géométrie-seule
#      (le 01/08 : 0 ligne, que geometry) ;
#   2. Bretagne : après le filtre code_com_d ∈ 22/29/35/56, nrow > 0 — attrape
#      un filtre cassé ou un snapshot cassé seulement en Bretagne.
# Retourne TRUE ; tout échec s'arrête bruyamment en nommant le niveau fautif.
verifier_qualite_amenagements <- function(brut) {
  requises <- c("ame_d", "ame_g", "code_com_d", "code_com_g")
  manquantes <- setdiff(requises, names(brut))
  if (length(manquantes) > 0) {
    stop("Porte de qualité Aménagements cyclables — colonne(s) requise(s) ",
         "manquante(s) : ", paste(manquantes, collapse = ", "),
         " (le parquet à schéma géométrie-seule du 01/08/2026).",
         call. = FALSE)
  }
  if (nrow(brut) < SEUIL_LIGNES_AMENAGEMENTS) {
    stop("Porte de qualité Aménagements cyclables — snapshot France entière ",
         "sous le seuil (", nrow(brut), " < ", SEUIL_LIGNES_AMENAGEMENTS,
         " lignes — le FeatureCollection vide du 01/08/2026).", call. = FALSE)
  }
  bretagne <- sum(grepl("^(22|29|35|56)", as.character(brut$code_com_d)))
  if (bretagne == 0) {
    stop("Porte de qualité Aménagements cyclables — aucune ligne bretonne ",
         "après le filtre (filtre cassé ou snapshot cassé seulement en ",
         "Bretagne).", call. = FALSE)
  }
  invisible(TRUE)
}

# construire_amenagements_cyclables -------------------------------------------------
# L'orchestrateur du snapshot : lit le parquet frais (lecteur injecté — la
# convention du pipeline, jamais le réseau dans la boucle), passe la porte de
# qualité sur le BRUT (le snapshot entier — un snapshot vide ou tronqué est
# un fait de la SOURCE, pas une corruption du normaliseur), puis normalise
# (avec la table de passage COG, #227 — les gardes du normaliseur attrapent
# les corruptions APRÈS le filtre).
#   - Succès : la table normalisée est mise en cache comme `dernier_bon` —
#     une liste {vintage, table} écrite en .rds sous `sortie` — et la liste
#     {vintage, table} fraîche est retournée. Le dernier bon est REMPLACÉ à
#     chaque succès (le plus récent bon). Depuis l'issue #233, la liste porte
#     aussi `couverture` : le diagnostic par département (lignes/km) du
#     snapshot frais vs le PRÉCÉDENT dernier bon — le signal de régression
#     distinct de la porte, la matière du rapport de run.
#   - Échec de la porte : repli sur le `dernier_bon` du cache — la liste
#     {vintage, table} du dernier bon est retournée avec SON vintage (la date
#     du dernier bon, jamais celle du cassé, jamais « aujourd'hui »), et le
#     diagnostic compare le publié à lui-même (la couverture publiée ne bouge
#     pas — aucun signal). Un échec SANS dernier bon en cache est une erreur
#     dure.
# `vintage` est la date du snapshot déclarée par le manifeste (le pin) ; le
# repli retourne le vintage du cache, le run report enregistre échec + repli.
construire_amenagements_cyclables <- function(chemin_parquet,
                                              sortie,
                                              vintage,
                                              mappe,
                                              lire = lire_amenagements_cyclables) {
  frais <- lire(chemin_parquet)

  ok <- tryCatch({
    verifier_qualite_amenagements(frais)
    TRUE
  }, error = function(e) FALSE)

  if (!ok) {
    # l'échec : repli sur le dernier bon, avec SON vintage
    if (!file.exists(sortie)) {
      stop("Aménagements cyclables — le snapshot frais a échoué la porte de ",
           "qualité ET aucun dernier bon n'est en cache : le run s'arrête, ",
           "jamais de donnée publiée depuis un snapshot cassé.",
           call. = FALSE)
    }
    precedent <- readRDS(sortie)
    return(list(
      vintage = precedent$vintage,
      table = precedent$table,
      couverture = diagnostic_couverture_amenagements(precedent$table,
                                                      precedent$table)
    ))
  }

  # le succès : normalise, diagnostique vs le précédent, met en cache,
  # retourne la table + le vintage frais + le diagnostic de couverture
  table <- normaliser_amenagements_cyclables(frais, mappe)
  precedent <- if (file.exists(sortie)) readRDS(sortie) else NULL
  couverture <- diagnostic_couverture_amenagements(
    table, if (is.null(precedent)) NULL else precedent$table
  )
  readr::write_rds(list(vintage = vintage, table = table), sortie)
  list(vintage = vintage, table = table, couverture = couverture)
}
