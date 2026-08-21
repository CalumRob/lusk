# artefact_naf_a17 ---------------------------------------------------------------
# L'artefact de correspondance officielle NAF rév. 2 → NA A17 (issue #426,
# parent #154 : le grain NAF sous-classe est trop fin pour la LQ « Spécialisation
# des établissements » — décision de basculer sur A17, recommandation provisoire
# du grain LQ). C'est le même pattern que l'artefact EGSS
# (artefact_egss.R) : un référentiel épinglé VERSIONNÉ et TESTÉ.
#
#   - id      : naf2_na17_2008 ;
#   - source  : INSEE — « table_NAF2-NA.xls », la table de passage entre le
#     niveau détaillé de la NAF rév. 2, les niveaux de regroupement de la NAF
#     rév. 2 et les niveaux de la NA (feuille « Version avec niveau A 17 ») ;
#   - vintage : 2008 (la nomenclature agrégée NA, 2008, associée à la NAF rév.
#     2 — la page INSEE « La nomenclature agrégée - NA, 2008 », dernière mise à
#     jour 06/07/2016 ; la NAF rév. 2 est en vigueur jusqu'à fin 2026) ;
#   - licence : Licence Ouverte 2.0 / conditions de réutilisation des
#     informations publiées sur le site de l'INSEE (mention de la source) ;
#   - table   : le CSV épinglé pipeline/inst/extdata/table_naf2_na17.csv — une
#     transcription UNE FOIS du fichier officiel (732 sous-classes NAF rév. 2,
#     une ligne par code NN.NNL avec son code A17 et son libellé A17 officiels),
#     artefact de code, jamais un téléchargement à l'exécution.
#
# La RÈGLE DE JOINTURE (épinglée ici, vérifiée par verifier_contrat_naf_a17) :
# l'APET SIRENE est « NN.NN(L) » (6 caractères, NAF rév. 2) ; la jointure au
# grain sous-classe est EXACTE : sous_classe = activity_code, et le code A17
# remonte à la sous-classe entière (ex. « 01.11Z » → AZ). Les codes A17 sont le
# vocabulaire FERMÉ des 17 postes de la nomenclature agrégée (A 17) — tout
# autre code est un artefact corrompu qui fait échouer le contrat FORT, en
# nommant l'artefact ET la règle de jointure.
#
# Décisions documentées (Méthodes) :
#   - les libellés A17 officiels ne sont PAS portés par le XLS (la feuille ne
#     porte que des codes) : ils sont transcrits de la documentation INSEE du
#     vocabulaire A17 (« Activité (NAF rév2) en nomenclature agrégée
#     (17 postes) ») et épinglés dans VOCABULAIRE_NA17_OFFICIEL — le
#     vérificateur refuse toute ligne dont le libellé s'écarte du libellé
#     officiel de son code ;
#   - « 00.00Z » (inconnue) n'est pas une activité NAF officielle : son absence
#     de la table est ATTENDUE — son exclusion est le travail du consommateur
#     (ticket #427), pas de l'artefact ;
#   - la NAF 2025 entrera en vigueur en janvier 2027 : cet artefact est épinglé
#     à la NAF rév. 2 — une correspondance successorale sera un NOUVEL artefact
#     versionné, jamais une réécriture silencieuse de celui-ci.

# NAF_A17_ARTEFACT_FICHIER -------------------------------------------------------
# Le nom du CSV épinglé sous inst/extdata/ (un artefact de code, versionné avec
# le pipeline — jamais un téléchargement à l'exécution).
NAF_A17_ARTEFACT_FICHIER <- "table_naf2_na17.csv"

# VOCABULAIRE_NA17_OFFICIEL ------------------------------------------------------
# Le vocabulaire FERMÉ des 17 postes de la nomenclature agrégée A 17 : le code
# officiel → son libellé officiel français (documentation INSEE du vocabulaire
# A17). Le vérificateur y valide les codes ET les libellés de la table épinglée.
VOCABULAIRE_NA17_OFFICIEL <- c(
  "AZ" = "Agriculture, sylviculture et pêche",
  "C1" = "Fabrication de denrées alimentaires, de boissons et de produits à base de tabac",
  "C2" = "Cokéfaction et raffinage",
  "C3" = "Fabrication d'équipements électriques, électroniques, informatiques, fabrication de machines",
  "C4" = "Fabrication de matériels de transport",
  "C5" = "Fabrication d'autres produits industriels",
  "DE" = "Industries extractives, énergie, eau, gestion des déchets et dépollution",
  "FZ" = "Construction",
  "GZ" = "Commerce, réparation d'automobiles et de motocycles",
  "HZ" = "Transports et entreposage",
  "IZ" = "Hébergement et restauration",
  "JZ" = "Information et communication",
  "KZ" = "Activités financières et d'assurance",
  "LZ" = "Activités immobilières",
  "MN" = "Activités scientifiques et techniques, services administratifs et de soutien",
  "OQ" = "Administration publique, enseignement, santé humaine et action sociale",
  "RU" = "Autres activités de services"
)

# lire_naf_a17 -------------------------------------------------------------------
# Le lecteur du CSV épinglé. Tout en caractères : les codes (même « 01.11Z »)
# ne doivent JAMAIS être devinés numériques — un code « 06.10Z » lu comme 6.1
# détruirait silencieusement les zéros de tête et la jointure exacte au grain
# sous-classe. `chemin` permet aux tests de passer une copie corrompue ; par
# défaut, la ressource épinglée du package (system.file — résolue aussi sous
# pkgload).
lire_naf_a17 <- function(chemin = NULL) {
  if (is.null(chemin)) {
    chemin <- system.file("extdata", NAF_A17_ARTEFACT_FICHIER, package = "lusk")
  }
  if (is.na(chemin) || !nzchar(chemin) || !file.exists(chemin)) {
    stop(sprintf(
      "Artefact NAF→A17 — %s introuvable : l'artefact épinglé doit exister (règle de jointure : sous_classe = activity_code, le code A17 remonte à la sous-classe entière).",
      NAF_A17_ARTEFACT_FICHIER
    ), call. = FALSE)
  }
  readr::read_csv(
    chemin,
    col_types = readr::cols(.default = readr::col_character()),
    show_col_types = FALSE
  )
}

# artefact_naf_a17 ---------------------------------------------------------------
# L'artefact VERSIONNÉ : les métadonnées du contrat (id, source, url, vintage,
# licence, note) + la table épinglée. Construit à la demande — la table est
# relue et REVÉRIFIÉE à chaque appel : un artefact corrompu sur disque échoue
# au moment où il est consommé, jamais plus tard.
artefact_naf_a17 <- function() {
  table <- lire_naf_a17()

  list(
    id = "naf2_na17_2008",
    source = paste0(
      "INSEE — « table_NAF2-NA.xls » : la table de passage entre le niveau ",
      "détaillé de la NAF rév. 2, les niveaux de regroupement de la NAF rév. 2 ",
      "et les niveaux de la NA (feuille « Version avec niveau A 17 »)"
    ),
    url = paste0(
      "https://www.insee.fr/fr/statistiques/fichier/2028155/table_NAF2-NA.xls"
    ),
    vintage = "2008",
    licence = paste0(
      "Licence Ouverte 2.0 / conditions de réutilisation des informations ",
      "publiées sur le site de l'INSEE (mention de la source)"
    ),
    note = paste0(
      "Correspondance officielle NAF rév. 2 → NA A17 épinglée comme artefact ",
      "de code (issue #426, parent #154 : bascule du grain de la LQ ",
      "« Spécialisation des établissements » de la sous-classe vers A17). ",
      "Règle de jointure : l'APET SIRENE est « NN.NN(L) » ; la jointure au ",
      "grain sous-classe est EXACTE — sous_classe = activity_code, le code ",
      "A17 remonte à la sous-classe entière. Les libellés A17 officiels ne ",
      "sont pas portés par le XLS : transcrits de la documentation INSEE du ",
      "vocabulaire A17 (17 postes), verrouillés dans ",
      "VOCABULAIRE_NA17_OFFICIEL. « 00.00Z » (inconnue) n'est pas une ",
      "activité NAF officielle : son absence de la table est ATTENDUE — son ",
      "exclusion est le travail du consommateur (#427), pas de l'artefact. ",
      "Millésime : la nomenclature agrégée NA, 2008 (page INSEE mise à jour ",
      "le 06/07/2016) ; la NAF rév. 2 est en vigueur jusqu'à fin 2026 — la ",
      "NAF 2025 (janvier 2027) exigera un NOUVEL artefact versionné, jamais ",
      "une réécriture silencieuse de celui-ci."
    ),
    table = table
  )
}

# verifier_contrat_naf_a17 -------------------------------------------------------
# L'INTÉGRITÉ de l'artefact — la barrière du contrat. Toute violation échoue
# FORT en nommant l'artefact (son id) ET la règle de jointure : une sous-classe
# au mauvais format (ex. « 01.11 » sans lettre finale, « 6.1Z », un numérique),
# un code A17 hors vocabulaire officiel, un libellé réécrit ou une sous-classe
# dupliquée sont des corruptions qui casseraient la jointure exacte au grain
# sous-classe — elles sont refusées ici. L'acceptance de l'issue #426 : le
# vérificateur « échoue FORT en nommant l'artefact ET la règle de jointure ».
verifier_contrat_naf_a17 <- function(artefact) {
  # l'enveloppe : id, source, url, vintage, licence, note, table — toute
  # métadonnée absente ou vide est une corruption
  requis <- c("id", "source", "url", "vintage", "licence", "note", "table")
  manquants <- setdiff(requis, names(artefact))
  if (length(manquants) > 0) {
    stop(sprintf(
      "Artefact NAF→A17 invalide — %s : métadonnée(s) absente(s) : %s (règle de jointure : sous_classe = activity_code, le code A17 remonte à la sous-classe entière).",
      artefact$id %||% "(sans id)", paste(manquants, collapse = ", ")
    ), call. = FALSE)
  }
  for (champ in c("id", "source", "url", "vintage", "licence", "note")) {
    v <- artefact[[champ]]
    if (length(v) != 1 || is.na(v) || !nzchar(v)) {
      stop(sprintf(
        "Artefact NAF→A17 invalide — %s : métadonnée %s absente ou vide (règle de jointure : sous_classe = activity_code, le code A17 remonte à la sous-classe entière).",
        artefact$id, champ
      ), call. = FALSE)
    }
  }

  table <- artefact$table
  # les colonnes du contrat de la table épinglée
  cols <- c("sous_classe", "na17_code", "na17_libelle")
  manquantes <- setdiff(cols, names(table))
  if (length(manquantes) > 0) {
    stop(sprintf(
      "Artefact NAF→A17 invalide — %s : colonne(s) manquante(s) dans la table : %s (règle de jointure : sous_classe = activity_code, le code A17 remonte à la sous-classe entière).",
      artefact$id, paste(manquantes, collapse = ", ")
    ), call. = FALSE)
  }

  # le format de chaque sous-classe : « NN.NNL » (6 caractères, NAF rév. 2) —
  # la FORME que porte l'APET SIRENE et qu'exige la jointure exacte ; une forme
  # numérique (« 6.1Z ») détruirait silencieusement les zéros de tête
  codes <- table$sous_classe
  invalides <- unique(codes[!grepl("^[0-9]{2}\\.[0-9]{2}[A-Z]$", codes)])
  if (length(invalides) > 0) {
    stop(sprintf(
      paste0(
        "Artefact NAF→A17 invalide — %s : sous-classe(s) au mauvais format : %s. ",
        "La règle de jointure exige des sous-classes NAF rév. 2 « NN.NNL » ",
        "(6 caractères) — tout autre format casserait la jointure exacte au ",
        "grain sous-classe (sous_classe = activity_code)."
      ),
      artefact$id, paste(invalides, collapse = ", ")
    ), call. = FALSE)
  }

  # le vocabulaire FERMÉ des 17 postes A17 : tout code hors vocabulaire est
  # une corruption (la correspondance officielle ne connaît que ces postes)
  inconnus <- unique(table$na17_code[!table$na17_code %in%
                                        names(VOCABULAIRE_NA17_OFFICIEL)])
  if (length(inconnus) > 0) {
    stop(sprintf(
      paste0(
        "Artefact NAF→A17 invalide — %s : code(s) A17 hors vocabulaire ",
        "officiel des 17 postes : %s (règle de jointure : sous_classe = ",
        "activity_code, le code A17 remonte à la sous-classe entière)."
      ),
      artefact$id, paste(inconnus, collapse = ", ")
    ), call. = FALSE)
  }

  # le libellé porté doit être exactement le libellé officiel du code : le XLS
  # ne porte pas les libellés, ils sont transcrits — toute réécriture est une
  # transcription corrompue, refusée ici
  attendus <- unname(VOCABULAIRE_NA17_OFFICIEL[table$na17_code])
  ecart <- unique(table$na17_code[unname(table$na17_libelle) != attendus])
  if (length(ecart) > 0) {
    stop(sprintf(
      paste0(
        "Artefact NAF→A17 invalide — %s : libellé(s) A17 qui s'écartent du ",
        "libellé officiel pour le(s) code(s) : %s (règle de jointure : ",
        "sous_classe = activity_code, le code A17 remonte à la sous-classe ",
        "entière)."
      ),
      artefact$id, paste(ecart, collapse = ", ")
    ), call. = FALSE)
  }

  # pas de doublon de sous-classe : la table est une partition (une ligne par
  # sous-classe NAF rév. 2)
  if (anyDuplicated(table$sous_classe) > 0) {
    stop(sprintf(
      "Artefact NAF→A17 invalide — %s : sous-classe(s) en double (règle de jointure : sous_classe = activity_code, le code A17 remonte à la sous-classe entière).",
      artefact$id
    ), call. = FALSE)
  }

  invisible(TRUE)
}

# %||% --------------------------------------------------------------------------
# L'opérateur de repli : la première valeur non NULL (utilisé pour nommer
# l'artefact même quand son id est corrompu).
`%||%` <- function(a, b) if (is.null(a) || length(a) == 0 || is.na(a)) b else a
