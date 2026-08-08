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
#     chaque succès (le plus récent bon).
#   - Échec de la porte : repli sur le `dernier_bon` du cache — la liste
#     {vintage, table} du dernier bon est retournée avec SON vintage (la date
#     du dernier bon, jamais celle du cassé, jamais « aujourd'hui »). Un
#     échec SANS dernier bon en cache est une erreur dure.
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
    return(readRDS(sortie))
  }

  # le succès : normalise, met en cache, retourne la table + le vintage frais
  table <- normaliser_amenagements_cyclables(frais, mappe)
  readr::write_rds(list(vintage = vintage, table = table), sortie)
  list(vintage = vintage, table = table)
}
