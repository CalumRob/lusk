# artefact_egss -----------------------------------------------------------------
# L'artefact EGSS — la liste opérationnelle Eurostat des activités EGSS
# (plan economie-analytical-phase, todo 3 / T3, gate H = B). C'est l'APPROXIMATION
# documentée du périmètre SDES des éco-activités : SDES publie une liste de
# PRODUITS (CPF), pas une liste NAF (docs/research/sdes-economie-verte.md) — la
# seule correspondance officielle au grain des classes NAF/NAF est la liste
# opérationnelle EGSS d'Eurostat (classes NACE rév. 2 4 chiffres = classes NAF,
# avec les drapeaux 100 %/partiel). Cet artefact est VERSIONNÉ et TESTÉ :
#
#   - id      : egss_operational_activities_2024
#   - source  : Eurostat — « EGSS list of environmental products based on CPA
#     and CN, 2024 », feuille « Activities » (la liste opérationnelle courante
#     des ACTIVITÉS EGSS, vendredi de la collection EGSS du site Eurostat) ;
#   - vintage : 2024 (la liste, pas le millésime des données SIRENE jointes) ;
#   - licence : la politique de réutilisation Eurostat (© Union européenne,
#     réutilisation libre avec mention de la source — la même famille que les
#     autres sources du pipeline) ;
#   - table   : le CSV épinglé pipeline/inst/extdata/
#     egss_operational_activities_2024.csv — une transcription UNE FOIS du
#     fichier officiel (82 activités, une ligne par code NACE), artefact de
#     code, jamais un téléchargement à l'exécution.
#
# La RÈGLE DE JOINTURE (épinglée ici, vérifiée par verifier_contrat_egss) :
# l'APET SIRENE est « NN.NN(L) » (6 caractères, NAF rév. 2) ; la classe NAF =
# substr(activity_code, 1, 5) → « NN.NN ». Un code EGSS couvre une classe quand
# les chiffres du code (sans le point) sont un PREFIXE des chiffres de la
# classe : EGSS « 37 » (division) couvre 37.00 ; EGSS « 38.1 » (groupe) couvre
# 38.11 et 38.12 ; EGSS « 38.21 » (classe) couvre 38.21. Les codes EGSS sont
# donc des formes NACE valides — division NN, groupe NN.N ou classe NN.NN —
# et toute autre forme est un artefact corrompu qui fait échouer le contrat
# FORT, en nommant l'artefact ET la règle de jointure.
#
# Décisions documentées (Méthodes) :
#   - l'approximation : la liste EGSS d'Eurostat est à grain classe (4
#     chiffres), PAS la liste SDES (produits CPF) ; le fichier 2024 étiquette sa
#     colonne « NACE rev 2.1. » mais les codes résolvent sur les classes NAF
#     rév. 2 du snapshot réel (vérifié 2026-08-05 : 174 classes jointes,
#     aucune forme invalide) — la classe NAF rév. 2 = la classe NACE rév. 2 ;
#   - la coquille de source « 28:30 » (Manufacture of electric and more
#     resource-efficient transport equipment) est corrigée en « 28.30 » à la
#     transcription — documentée, jamais silencieuse ;
#   - la ligne « Not available » (Manufacture of other specific equipment for
#     wastewater treatment) n'a PAS de code NACE dans la source : elle reste
#     épinglée comme documentation et ne joint rien.

# EGSS_ARTEFACT_FICHIER ----------------------------------------------------------
# Le nom du CSV épinglé sous inst/extdata/ (un artefact de code, versionné avec
# le pipeline — jamais un téléchargement à l'exécution).
EGSS_ARTEFACT_FICHIER <- "egss_operational_activities_2024.csv"

# lire_egss_activites -----------------------------------------------------------
# Le lecteur du CSV épinglé. Tout en caractères : les codes (même « 01.1 ») ne
# doivent JAMAIS être devinés numériques — un code « 28.3 » lu comme 28.3
# détruirait silencieusement les zéros de tête et la jointure au prefixe.
# `chemin` permet aux tests de passer une copie corrompue ; par défaut, la
# ressource épinglée du package (system.file — résolue aussi sous pkgload).
lire_egss_activites <- function(chemin = NULL) {
  if (is.null(chemin)) {
    chemin <- system.file("extdata", EGSS_ARTEFACT_FICHIER, package = "lusk")
  }
  if (is.na(chemin) || !nzchar(chemin) || !file.exists(chemin)) {
    stop(sprintf(
      "Artefact EGSS — %s introuvable : l'artefact épinglé doit exister (règle de jointure : classe NAF = substr(APET, 1, 5)).",
      EGSS_ARTEFACT_FICHIER
    ), call. = FALSE)
  }
  readr::read_csv(
    chemin,
    col_types = readr::cols(.default = readr::col_character()),
    show_col_types = FALSE
  )
}

# artefact_egss ----------------------------------------------------------------
# L'artefact VERSIONNÉ : les métadonnées du contrat (id, source, vintage,
# licence, note) + la table épinglée. Construit à la demande — la table est
# relue et REVÉRIFIÉE à chaque appel : un artefact corrompu sur disque échoue
# au moment où il est consommé, jamais plus tard.
artefact_egss <- function() {
  table <- lire_egss_activites()

  list(
    id = "egss_operational_activities_2024",
    source = paste0(
      "Eurostat — « EGSS list of environmental products based on CPA and CN, ",
      "2024 » (feuille Activities : la liste opérationnelle des activités ",
      "EGSS, classes NACE rév. 2 avec drapeaux 100 %/partiel)"
    ),
    url = paste0(
      "https://ec.europa.eu/eurostat/documents/1798247/6191549/",
      "EGSS+list+of+environmental+products+based+on+CPA+and+CN%2C+2024.xlsx"
    ),
    vintage = "2024",
    licence = paste0(
      "Réutilisation des données Eurostat (© Union européenne — réutilisation ",
      "libre avec mention de la source et du millésime)"
    ),
    note = paste0(
      "Approximation documentée (gate H = B, plan economie-analytical-phase) : ",
      "la liste opérationnelle EGSS d'Eurostat est à grain CLASSE NACE/NAF 4 ",
      "chiffres — le périmètre SDES des éco-activités est, lui, une liste de ",
      "produits CPF sans correspondance NAF publiée. Ce n'est PAS la liste ",
      "officielle SDES. Règle de jointure : classe NAF = substr(APET, 1, 5) ; ",
      "un code EGSS couvre une classe quand ses chiffres sont un préfixe des ",
      "chiffres de la classe. Décision de pondération : count-all — chaque ",
      "établissement d'une classe EGSS compte entier (le drapeau 100 %/partiel ",
      "est retenu dans n_eco_100/n_eco_partial, jamais supprimé). APET ",
      "spéciaux : 00.00Z (inconnue) et NULL ne sont jamais verts mais restent ",
      "au dénominateur (établissements actifs)."
    ),
    table = table
  )
}

# verifier_contrat_egss ---------------------------------------------------------
# L'INTÉGRITÉ de l'artefact — la barrière du contrat. Toute violation échoue
# FORT en nommant l'artefact (son id) ET la règle de jointure : un code au
# mauvais format (ex. « 38.21Z », une forme alphabétique, un numérique) est une
# corruption qui casserait la jointure au grain classe — il est refusé ici.
# L'acceptance du plan : « a corrupted artifact (wrong class format) fails
# loudly naming the artifact and the join rule ».
verifier_contrat_egss <- function(artefact) {
  # l'enveloppe : id, source, vintage, licence, note, table — toute métadonnée
  # absente ou vide est une corruption
  requis <- c("id", "source", "vintage", "licence", "note", "table")
  manquants <- setdiff(requis, names(artefact))
  if (length(manquants) > 0) {
    stop(sprintf(
      "Artefact EGSS invalide — %s : métadonnée(s) absente(s) : %s (règle de jointure : classe NAF = substr(APET, 1, 5)).",
      artefact$id %||% "(sans id)", paste(manquants, collapse = ", ")
    ), call. = FALSE)
  }
  for (champ in c("id", "source", "vintage", "licence", "note")) {
    v <- artefact[[champ]]
    if (length(v) != 1 || is.na(v) || !nzchar(v)) {
      stop(sprintf(
        "Artefact EGSS invalide — %s : métadonnée %s absente ou vide (règle de jointure : classe NAF = substr(APET, 1, 5)).",
        artefact$id, champ
      ), call. = FALSE)
    }
  }

  table <- artefact$table
  # les colonnes du contrat de la table épinglée
  cols <- c("activity_id", "activity", "nace_code", "flag", "cepa_crema_class")
  manquantes <- setdiff(cols, names(table))
  if (length(manquantes) > 0) {
    stop(sprintf(
      "Artefact EGSS invalide — %s : colonne(s) manquante(s) dans la table : %s (règle de jointure : classe NAF = substr(APET, 1, 5)).",
      artefact$id, paste(manquantes, collapse = ", ")
    ), call. = FALSE)
  }

  # le vocabulaire fermé des drapeaux : h (100 % de la classe est
  # environnementale) ou v (partielle) — toute autre valeur est une corruption
  flags <- unique(table$flag)
  if (length(setdiff(flags, c("h", "v"))) > 0) {
    stop(sprintf(
      "Artefact EGSS invalide — %s : drapeau inconnu : %s (règle de jointure : classe NAF = substr(APET, 1, 5)).",
      artefact$id, paste(setdiff(flags, c("h", "v")), collapse = ", ")
    ), call. = FALSE)
  }

  # le format de chaque code EGSS : division NN, groupe NN.N ou classe NN.NN —
  # la FORME qui rend la jointure au prefixe possible ; « Not available » est
  # la seule exception documentée (aucun code NACE dans la source pour cette
  # activité)
  codes <- table$nace_code
  speciaux <- codes == "Not available"
  invalides <- unique(codes[!speciaux & !grepl("^[0-9]{2}(\\.[0-9]{1,2})?$", codes)])
  if (length(invalides) > 0) {
    stop(sprintf(
      paste0(
        "Artefact EGSS invalide — %s : code(s) de classe au mauvais format : %s. ",
        "La règle de jointure exige des divisions (NN), groupes (NN.N) ou ",
        "classes (NN.NN) NACE/NAF — tout autre format casserait la jointure au ",
        "grain classe (substr(APET, 1, 5))."
      ),
      artefact$id, paste(invalides, collapse = ", ")
    ), call. = FALSE)
  }

  # pas de doublon (activity_id × nace_code) : la table est une partition
  if (anyDuplicated(table[c("activity_id", "nace_code")]) > 0) {
    stop(sprintf(
      "Artefact EGSS invalide — %s : lignes en double (activity_id × nace_code) (règle de jointure : classe NAF = substr(APET, 1, 5)).",
      artefact$id
    ), call. = FALSE)
  }

  invisible(TRUE)
}

# %||% --------------------------------------------------------------------------
# L'opérateur de repli : la première valeur non NULL (utilisé pour nommer
# l'artefact même quand son id est corrompu).
`%||%` <- function(a, b) if (is.null(a) || length(a) == 0 || is.na(a)) b else a
