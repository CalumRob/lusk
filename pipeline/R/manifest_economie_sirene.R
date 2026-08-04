# manifest_economie_sirene -----------------------------------------------------
# Le fragment de la source « SIRENE — fichier stock des établissements »
# (INSEE / data.gouv) — la première source du thème Économie/Emploi
# (plan economie-pipeline-contracts, todo 1). Convention des vagues 1-3 :
# chaque source Économie vit dans SON fragment (SIRENE ici ; Flores A38/A88 et
# RP Emploi dans d'autres tickets), portant SON manifeste et SA construction
# de données. Le module theme_economie() assemblera les fragments quand le
# thème sera complet. Comme theme_demographie(), ce fichier ne touche pas à la
# machinerie partagée (download/compute/publish) : il la consomme.

# Le manifeste ---------------------------------------------------------------
# Le CONTRAT de la source, pas la donnée : une ligne qui épingle le DERNIER
# stock mensuel disponible des établissements (docs/themes/economie-emploi.md
# §« SIRENE snapshot rules » ; docs/research/relatedness.md §3.1). Ce qui est
# épinglé, une fois, et vérifié par verifier_contrat_sirene_snapshot() :
#   - l'URL STABLE de la ressource « StockEtablissement » (format zip/CSV) ;
#   - le nom de cache exact (le cache plat data/raw exige un nom unique) ;
#   - les trois dates du snapshot : référence (l'image du répertoire), mise en
#     ligne réelle (la publication) et extraction (la même image) ;
#   - la licence (Licence Ouverte 2.0), la version NAF (rév. 2, APET 5
#     chiffres), les champs exacts du dessin de fichier INSEE (commune, statut
#     administratif, statut de diffusion, code APE) et la règle de sélection
#     documentée (actifs seuls, diffusion partielle « P » conservée).
# Ce qui est EXPLICITEMENT HORS contrat (guardrails du plan) : pas d'ingestion
# du fichier historique (stocketablissementhistorique), pas d'estimation
# d'effectifs salariés depuis les tranches d'effectifs, pas de jointure ni
# d'alignement de dates avec les autres sources Économie.

# URL_SIRENE_STOCK_ETABLISSEMENTS ----------------------------------------------
# L'URL STABLE de la ressource « Sirene : Fichier StockEtablissement » sur
# data.gouv — celle que la notice recommande pour l'automatisation (« il faut
# utiliser les URL stables ») : chaque mois, l'Insee remplace le fichier
# DERRIÈRE cette URL (302 vers static.data.gouv.fr), jamais l'URL elle-même.
# Vérifié en direct le 2026-08-04 : le 302 pointe sur
# stock-stocketablissement-csv.zip (image du répertoire au 2026-07-31, mise en
# ligne le 2026-08-01). La ressource HISTORIQUE (stocketablissementhistorique)
# porte un autre identifiant de ressource — le contrat la refuse (la règle :
# pas d'historique dans cette phase).
URL_SIRENE_STOCK_ETABLISSEMENTS <-
  "https://www.data.gouv.fr/api/1/datasets/r/0651fb76-bcf3-4f6a-a38d-bc04fa708576"

# Le millésime épinglé --------------------------------------------------------
# Le stock mensuel mis en ligne le 1er août 2026 (dernier mois disponible le
# 2026-08-04). Notice data.gouv : « les fichiers mis en ligne à partir du 1er
# du mois sont une image du répertoire Sirene à la date du dernier jour du mois
# précédent » — donc référence ET extraction au 2026-07-31, publication au
# 2026-08-01 (last_modified de la ressource : 2026-08-01T07:34:40Z).
VINTAGE_SIRENE_SNAPSHOT <- "2026-08"
DATE_REFERENCE_SIRENE_SNAPSHOT <- "2026-07-31"
DATE_PUBLICATION_SIRENE_SNAPSHOT <- "2026-08-01"

# MANIFEST_ECONOMIE_SIRENE ------------------------------------------------------
# Les 11 colonnes standard du manifeste (même forme que MANIFEST_DEMOGRAPHIE et
# MANIFEST_HABITAT_DVF), puis les champs spécifiques au snapshot SIRENE :
#   - naf_version       : la nomenclature épinglée (NAF rév. 2, APET 5 chiffres
#     — la colonne informative NAF2025 existe en fin de fichier depuis le
#     2025-12-16, elle ne devient le code courant qu'au 1er janvier 2027) ;
#   - date_extraction   : la date de l'image du répertoire (même date que la
#     référence : le fichier stock n'a pas de champ dateExtraction, la notice
#     data.gouv la définit comme le dernier jour du mois précédent) ;
#   - champ_*           : les champs EXACTS du dessin de fichier INSEE
#     StockEtablissement (version 311) pour le filtrage Bretagne
#     (codeCommuneEtablissement, 5 chiffres COG), le statut administratif
#     (etatAdministratifEtablissement : A = actif, F = fermé), le statut de
#     diffusion (statutDiffusionEtablissement : O = diffusible, P = partiel —
#     adresse/géoloc masquées, commune et code APE restent exploitables) et le
#     code APE (activitePrincipaleEtablissement, 5 chiffres + nomenclature
#     associée) ;
#   - regle_selection   : la règle de sélection documentée du snapshot.
# Mode : « manuel » — le ZIP fait ~2,7 Go, trop gros pour le cron de GitHub
# Actions (ADR-0004, même famille que OSM/BDNB/OCS GE). Type : « fichier » —
# URL -> fichier, intégrité vérifiée par verifier_fichier (le .zip s'ouvre ;
# issue #13).
MANIFEST_ECONOMIE_SIRENE <- tibble::tribble(
  ~id, ~source, ~url, ~fichier, ~vintage, ~date_reference,
  ~date_publication, ~licence, ~note, ~mode, ~type,
  "sirene_snapshot",
  "INSEE — Base SIRENE, fichier stock des établissements (StockEtablissement)",
  URL_SIRENE_STOCK_ETABLISSEMENTS,
  "sirene_snapshot_2026-08.zip",
  VINTAGE_SIRENE_SNAPSHOT,
  DATE_REFERENCE_SIRENE_SNAPSHOT,
  DATE_PUBLICATION_SIRENE_SNAPSHOT,
  "lov2",
  paste0(
    "Stock mensuel des établissements (actifs et fermés) de la Base SIRENE — ",
    "image du répertoire au 2026-07-31. ZIP ~2,7 Go contenant ",
    "StockEtablissement_utf8.csv (54 variables, dessin de fichier INSEE 311) ; ",
    "alternative parquet sur la même ressource depuis 2025-06 ; l'Insee arrête ",
    "le CSV au 2e semestre 2027. Jeu de données data.gouv : ",
    "base-sirene-des-entreprises-et-de-leurs-etablissements-siren-siret ",
    "(producteur INSEE, Licence Ouverte 2.0)."
  ),
  "manuel", "fichier"
) %>%
  dplyr::mutate(
    naf_version = paste0(
      "NAF rév. 2 — APET 5 chiffres (732 sous-classes) ; ",
      "nomenclatureActivitePrincipaleEtablissement = 'NAFRev2'"
    ),
    date_extraction = DATE_REFERENCE_SIRENE_SNAPSHOT,
    champ_commune = "codeCommuneEtablissement",
    champ_actif = "etatAdministratifEtablissement",
    champ_diffusion = "statutDiffusionEtablissement",
    champ_naf = "activitePrincipaleEtablissement",
    regle_selection = paste0(
      "Seuls les établissements ACTIFS (etatAdministratifEtablissement = 'A') ",
      "entrent ; les établissements en diffusion partielle ",
      "(statutDiffusionEtablissement = 'P') sont CONSERVÉS quand leur commune ",
      "(codeCommuneEtablissement, 5 chiffres COG) et leur code APE ",
      "(activitePrincipaleEtablissement) sont exploitables ; les lignes sans ",
      "commune bretonne exploitable (22/29/35/56) ou sans code APE sont ",
      "exclues et comptées ; PAS d'ingestion du stock historique ",
      "(stocketablissementhistorique) ; les tranches d'effectifs ",
      "(trancheEffectifsEtablissement) restent de la métadonnée — jamais ",
      "converties en effectifs salariés."
    )
  )

# verifier_contrat_sirene_snapshot ---------------------------------------------
# La VALIDATION du contrat — pas une validation de données (celle-ci viendra
# avec la normalisation, todo 4) mais une validation du manifeste lui-même.
# Elle s'exécute sur le manifeste réel ET sur des fixtures négatives : toute
# violation — URL historique, version NAF manquante, id dupliqué, règle de
# sélection absente, ... — fait échouer la validation bruyamment, en nommant
# le champ fautif. Le contrat est la barrière qui empêche d'ingérer la mauvaise
# source (le fichier historique) par erreur.
verifier_contrat_sirene_snapshot <- function(manifest) {
  manquer <- function(champ, detail) {
    stop(sprintf("Contrat SIRENE snapshot violé — %s : %s.", champ, detail),
         call. = FALSE)
  }
  # lit une colonne du manifeste comme une chaîne ; NA si absente — le contrat
  # refuse toute colonne manquante
  valeur <- function(champ) {
    x <- manifest[[champ]]
    if (is.null(x) || length(x) == 0) NA_character_ else as.character(x[1])
  }

  # UNE source, un id unique
  if (!inherits(manifest, "tbl_df")) {
    manquer("forme", "le manifeste doit être un tibble")
  }
  if (nrow(manifest) != 1L) {
    manquer("id", "le contrat épingle UNE source — une seule ligne")
  }
  if (anyDuplicated(manifest$id)) manquer("id", "id dupliqué")
  if (valeur("id") != "sirene_snapshot") {
    manquer("id", "id attendu : 'sirene_snapshot'")
  }

  # URL : HTTPS et EXACTEMENT l'URL stable de la ressource StockEtablissement —
  # la ressource historique (stocketablissementhistorique) a un autre
  # identifiant et doit être refusée
  url <- valeur("url")
  if (is.na(url)) manquer("url", "URL absente")
  if (!startsWith(url, "https://")) manquer("url", "URL non HTTPS")
  if (is.na(URL_SIRENE_STOCK_ETABLISSEMENTS) ||
      url != URL_SIRENE_STOCK_ETABLISSEMENTS) {
    manquer("url", paste0(
      "l'URL doit être l'URL stable de la ressource StockEtablissement ",
      "(stocketablissementhistorique refusé)"
    ))
  }

  # nom de cache : unique, au motif exact, il encode id + millésime — jamais
  # le fichier historique
  fichier <- valeur("fichier")
  vintage <- valeur("vintage")
  if (is.na(fichier)) manquer("fichier", "nom de cache absent")
  if (grepl("historique", fichier, ignore.case = TRUE)) {
    manquer("fichier", paste0(
      "nom de fichier du stock historique — interdit ",
      "(stocketablissementhistorique)"
    ))
  }
  if (!grepl("^sirene_snapshot_[0-9]{4}-[0-9]{2}\\.zip$", fichier)) {
    manquer("fichier", "nom de cache attendu : sirene_snapshot_<AAAA-MM>.zip")
  }
  if (fichier != paste0(valeur("id"), "_", vintage, ".zip")) {
    manquer("fichier", "le nom de cache doit encoder id + millésime")
  }

  # licence, source, note
  if (valeur("licence") != "lov2") {
    manquer("licence", "Licence Ouverte 2.0 attendue ('lov2')")
  }
  source <- valeur("source")
  if (is.na(source) || !grepl("SIRENE", source)) {
    manquer("source", "la source doit nommer SIRENE")
  }
  if (is.na(valeur("note"))) manquer("note", "note absente")

  # mode (ADR-0004) et type (issue #13)
  mode <- valeur("mode")
  if (is.na(mode) || !mode %in% c("cron", "manuel")) {
    manquer("mode", "mode inconnu (cron|manuel, ADR-0004)")
  }
  type <- valeur("type")
  if (is.na(type) || !type %in% c("fichier", "api")) {
    manquer("type", "type inconnu (fichier|api)")
  }

  # les dates — ISO ; la référence est l'image du répertoire au dernier jour
  # du mois PRÉCÉDENT le millésime du fichier ; l'extraction est cette image
  date_ref <- valeur("date_reference")
  date_pub <- valeur("date_publication")
  date_ext <- valeur("date_extraction")
  toutes_dates <- c(vintage, date_ref, date_pub, date_ext)
  if (any(is.na(toutes_dates)) ||
      any(!grepl("^[0-9]{4}-[0-9]{2}(-[0-9]{2})?$", toutes_dates))) {
    manquer("dates", paste0(
      "vintage / date_reference / date_publication / date_extraction ",
      "manquants ou mal formés"
    ))
  }
  if (date_ref != as.character(as.Date(paste0(vintage, "-01")) - 1)) {
    manquer("date_reference", paste0(
      "la référence doit être le dernier jour du mois précédant le millésime ",
      "du fichier"
    ))
  }
  if (date_ext != date_ref) {
    manquer("date_extraction", paste0(
      "l'extraction est l'image du répertoire — même date que la référence"
    ))
  }

  # version NAF déclarée (rév. 2)
  naf <- valeur("naf_version")
  if (is.na(naf) || !grepl("NAF", naf) ||
      !grepl("r[ée]v\\.? ?2", naf, ignore.case = TRUE)) {
    manquer("naf_version", "version NAF déclarée attendue (NAF rév. 2)")
  }

  # les champs exacts du dessin de fichier StockEtablissement (INSEE 311)
  champs <- c(
    champ_commune = "codeCommuneEtablissement",
    champ_actif = "etatAdministratifEtablissement",
    champ_diffusion = "statutDiffusionEtablissement",
    champ_naf = "activitePrincipaleEtablissement"
  )
  for (nom in names(champs)) {
    if (is.na(valeur(nom)) || valeur(nom) != champs[[nom]]) {
      manquer(nom, sprintf("champ attendu : %s", champs[[nom]]))
    }
  }

  # la règle de sélection documentée : actifs seuls + diffusion partielle « P »
  # conservée (+ exclusions explicites dans le texte de la règle)
  regle <- valeur("regle_selection")
  if (is.na(regle) || !nzchar(regle)) {
    manquer("regle_selection", "règle de sélection absente")
  }
  if (!grepl("etatAdministratifEtablissement", regle)) {
    manquer("regle_selection", paste0(
      "la règle doit documenter le filtre actif ",
      "(etatAdministratifEtablissement = 'A')"
    ))
  }
  if (!grepl("statutDiffusionEtablissement", regle)) {
    manquer("regle_selection", paste0(
      "la règle doit documenter la diffusion partielle ",
      "(statutDiffusionEtablissement = 'P')"
    ))
  }

  invisible(TRUE)
}
