# manifest_economie_sirene -----------------------------------------------------
# Le fragment de la source « SIRENE — extrait régional data.bretagne.bzh »
# (todo 9, plan economie-pipeline-contracts — la bascule régionale) — la
# première source du thème Économie/Emploi. Depuis le todo 9, la source n'est
# PLUS le fichier stock national INSEE/data.gouv (ZIP ~2,7 Go) mais l'export
# API Opendatasoft du jeu régional « sirene-v3-consolidee » (Base SIRENE -
# Région Bretagne) : pré-découpé à la Bretagne, actifs seuls via le where de
# l'URL, vocabulaire ODS. Convention des vagues 1-3 : chaque source Économie
# vit dans SON fragment (SIRENE ici ; Flores A38/A88 et RP Emploi dans
# d'autres tickets), portant SON manifeste et SA construction de données. Le
# module theme_economie() assemblera les fragments quand le thème sera
# complet. Comme theme_demographie(), ce fichier ne touche pas à la machinerie
# partagée (download/compute/publish) : il la consomme.

# Le manifeste ---------------------------------------------------------------
# Le CONTRAT de la source, pas la donnée : une ligne qui épingle la coupe
# régionale de la Base SIRENE (docs/themes/economie-emploi.md §« SIRENE
# snapshot rules » ; docs/research/relatedness.md §3.1). Ce qui est épinglé,
# une fois, et vérifié par verifier_contrat_sirene_snapshot() :
#   - l'URL STABLE de l'export API ODS (select + where encodés dans l'URL) ;
#   - le nom de cache exact (le cache plat data/raw exige un nom unique) ;
#     le cache EST le CSV d'export — pas de ZIP national à décompresser ;
#   - les trois dates du snapshot selon la convention RÉGIONALE : référence
#     (l'image du répertoire au dernier jour du mois du millésime),
#     extraction (la date data_processed de la coupe ODS) et publication (la
#     mise en ligne réelle sur data.bretagne.bzh) ;
#   - la licence (Licence Ouverte 2.0), la version NAF (rév. 2, APET 5
#     chiffres), les champs exacts du vocabulaire ODS (commune, statut
#     administratif en libellés, code APE, libellé APET via
#     classeetablissement) et la règle de sélection documentée (actifs seuls,
#     diffusion NON retenue).
# Ce qui est EXPLICITEMENT HORS contrat (guardrails du plan) : pas d'ingestion
# du fichier historique (stocketablissementhistorique — un futur
# téléchargement manuel France entière, hors phase), pas d'estimation
# d'effectifs salariés depuis les tranches d'effectifs, pas de jointure ni
# d'alignement de dates avec les autres sources Économie.

# URL_SIRENE_REGIONAL -----------------------------------------------------------
# L'URL STABLE de l'export API ODS du jeu régional « sirene-v3-consolidee »
# (Base SIRENE - Région Bretagne, data.bretagne.bzh) : le select épingle les
# champs du contrat — dont datederniertraitementetablissement, le champ de
# fraîcheur que la normalisation confronte à la date de référence épinglée
# (l'auto-vérification : le fichier a le dernier mot sur sa propre date) — et
# le where restreint l'export aux seuls établissements ACTIFS
# (etatadministratifetablissement = 'Actif' — le libellé ODS enrichi, PAS le
# code national 'A'). Vérifié en direct le 2026-08-05 : 758 569 lignes
# actives, CSV ~58,5 Mo, téléchargement ~112 s. Le jeu est déjà pré-coupé à la
# Bretagne (1 877 987 enregistrements, codeRegionEtablissement = 53) : pas de
# ZIP national 2,7 Go, pas d'étape de décompression. La ressource HISTORIQUE
# (stocketablissementhistorique, data.gouv) porte un autre identifiant — le
# contrat la refuse (la règle : pas d'historique dans cette phase).
URL_SIRENE_REGIONAL <-
  "https://data.bretagne.bzh/api/explore/v2.1/catalog/datasets/sirene-v3-consolidee/exports/csv?select=siret,activiteprincipaleetablissement,codecommuneetablissement,etatadministratifetablissement,trancheeffectifsetablissement,classeetablissement,datederniertraitementetablissement&where=etatadministratifetablissement='Actif'"

# Le millésime épinglé --------------------------------------------------------
# La coupe régionale épinglée : données basées sur le stock SIRENE 2026-04
# (la description du jeu le dit), data_processed ODS 2026-05-01 (la date de la
# coupe) et mise en ligne le 2026-05-01. La RÉFÉRENCE est une donnée du
# FICHIER, pas de la notice : le maximum de datederniertraitementetablissement
# sur l'export régional est 2026-03-31T23:57:31 (toutes lignes) /
# 2026-03-31T23:41:59 (actifs seuls) — l'extrait reflète le répertoire SIRENE
# à FIN MARS 2026. La convention de référence est donc celle du stock national
# (la règle d'origine du todo 1) : référence = dernier jour du mois PRÉCÉDANT
# le millésime du fichier — pour le millésime 2026-04, la référence est
# 2026-03-31. Les rafraîchissements quotidiens ODS sont suspendus depuis fin
# février 2026 (instabilité de l'API INSEE) : le jeu accuse ~3 mois de retard
# sur le stock mensuel national — retard ACCEPTÉ pour cette phase et documenté
# dans la note. La normalisation AUTO-VÉRIFIE la référence contre le fichier :
# si le dernier traitement observé parmi les lignes retenues diffère de la
# date épinglée, le contrat échoue bruyamment (le fichier a le dernier mot).
VINTAGE_SIRENE_SNAPSHOT <- "2026-04"
DATE_REFERENCE_SIRENE_SNAPSHOT <- "2026-03-31"
DATE_PUBLICATION_SIRENE_SNAPSHOT <- "2026-05-01"

# MANIFEST_ECONOMIE_SIRENE ------------------------------------------------------
# Les 11 colonnes standard du manifeste (même forme que MANIFEST_DEMOGRAPHIE et
# MANIFEST_HABITAT_DVF), puis les champs spécifiques au snapshot SIRENE :
#   - naf_version       : la nomenclature épinglée (NAF rév. 2, APET 5 chiffres
#     — le jeu régional porte nomenclatureactiviteprincipaleetablissement =
#     'NAFRev2') ;
#   - date_extraction   : la date de la coupe ODS (data_processed du jeu —
#     quand la coupe a été extraite du répertoire SIRENE) ;
#   - champ_*           : les champs EXACTS du vocabulaire ODS exposé par
#     l'API data.bretagne.bzh (minuscules) : la commune
#     (codecommuneetablissement, 5 chiffres COG), le statut administratif
#     (etatadministratifetablissement, en LIBELLÉS « Actif »/« Fermé » — l'ODS
#     enrichit, il ne renvoie pas les codes nationaux A/F), le code APE
#     (activiteprincipaleetablissement, 5 chiffres), le libellé du code APE
#     (classeetablissement — il n'y a PAS de libelleActivitePrincipaleEtablissement
#     dans ce jeu) et le champ de fraîcheur
#     (datederniertraitementetablissement, la date/heure ISO du dernier
#     traitement INSEE de l'établissement — le fichier a le dernier mot sur sa
#     propre date, la normalisation la confronte à date_reference). PAS de
#     champ diffusion : le statut de diffusion n'est pas retenu (décision
#     todo 9 — la diffusion partielle compte comme les autres tant que commune
#     et code APE restent exploitables) ;
#   - regle_selection   : la règle de sélection documentée du snapshot.
# Mode : « manuel » — pas de cron : la fraîcheur du jeu régional dépend des
# rafraîchissements ODS (suspendus depuis février 2026), le téléchargement se
# fait à la main (ADR-0004, même famille que OSM/BDNB/OCS GE). Type :
# « fichier » — URL -> fichier, le cache est le CSV d'export (intégrité
# vérifiée par verifier_fichier ; issue #13).
MANIFEST_ECONOMIE_SIRENE <- tibble::tribble(
  ~id, ~source, ~url, ~fichier, ~vintage, ~date_reference,
  ~date_publication, ~licence, ~note, ~mode, ~type,
  "sirene_snapshot",
  "data.bretagne.bzh — Base SIRENE — Région Bretagne",
  URL_SIRENE_REGIONAL,
  "sirene_snapshot_2026-04.csv",
  VINTAGE_SIRENE_SNAPSHOT,
  DATE_REFERENCE_SIRENE_SNAPSHOT,
  DATE_PUBLICATION_SIRENE_SNAPSHOT,
  "lov2",
  paste0(
    "Extraction régionale de la Base SIRENE (data.bretagne.bzh, jeu ",
    "sirene-v3-consolidee « Base SIRENE - Région Bretagne ») : 1 877 987 ",
    "enregistrements pré-découpés à la Bretagne (codeRegionEtablissement = ",
    "53), restreints à l'export aux seuls établissements ACTIFS ",
    "(etatadministratifetablissement = 'Actif', le where de l'URL) — 758 569 ",
    "lignes actives, CSV ~58,5 Mo, vérifié le 2026-08-05. Pas de ZIP national ",
    "2,7 Go : le cache est le CSV d'export. La fraîcheur est celle de la coupe ",
    "ODS : données basées sur le stock INSEE 2026-04 — le dernier traitement ",
    "observé dans le fichier (maximum de datederniertraitementetablissement) ",
    "est 2026-03-31, la date de référence épinglée ; data_processed du jeu : ",
    "2026-05-01, les rafraîchissements quotidiens ODS étant suspendus depuis ",
    "fin février 2026 (instabilité de l'API INSEE) — le jeu accuse ~3 mois de ",
    "retard sur le stock mensuel national, retard ACCEPTÉ pour cette phase. La ",
    "normalisation auto-vérifie la référence : si le dernier traitement ",
    "observé dans le fichier diffère de la date épinglée, le contrat échoue ",
    "bruyamment. Vocabulaire ODS : etatadministratifetablissement en libellés ",
    "« Actif »/« Fermé », trancheeffectifsetablissement en libellés de ",
    "tranche, libellé APET porté par classeetablissement. Le statut de ",
    "diffusion n'est PAS retenu : les établissements en diffusion partielle ",
    "comptent quand leur commune et leur code APE restent exploitables. Jeu ",
    "data.bretagne.bzh, producteur INSEE, Licence Ouverte 2.0."
  ),
  "manuel", "fichier"
) %>%
  dplyr::mutate(
    naf_version = paste0(
      "NAF rév. 2 — APET 5 chiffres (732 sous-classes) ; ",
      "nomenclatureactiviteprincipaleetablissement = 'NAFRev2'"
    ),
    date_extraction = "2026-05-01",
    champ_commune = "codecommuneetablissement",
    champ_actif = "etatadministratifetablissement",
    champ_naf = "activiteprincipaleetablissement",
    champ_libelle = "classeetablissement",
    champ_traitement = "datederniertraitementetablissement",
    regle_selection = paste0(
      "Seuls les établissements ACTIFS entrent : le where de l'URL de ",
      "l'export filtre etatadministratifetablissement = 'Actif' ET la ",
      "normalisation revérifie le libellé ODS 'Actif' ; la Bretagne n'est ",
      "PAS un filtre du normaliseur — le jeu est pré-découpé à la Bretagne ",
      "(codeRegionEtablissement = 53), les gardes commune COG 5 chiffres + ",
      "département 22/29/35/56 restent des validations défensives ; le statut ",
      "de diffusion n'est PAS retenu — chaque établissement actif avec ",
      "commune et code APE exploitables compte, quelle que soit sa diffusion ; ",
      "les lignes sans commune exploitable ou sans code APE sont exclues et ",
      "comptées ; PAS d'ingestion du stock historique ",
      "(stocketablissementhistorique) ; les tranches d'effectifs ",
      "(trancheeffectifsetablissement) restent de la métadonnée — jamais ",
      "converties en effectifs salariés."
    )
  )

# verifier_contrat_sirene_snapshot ---------------------------------------------
# La VALIDATION du contrat — pas une validation de données (celle-ci viendra
# avec la normalisation, todo 4) mais une validation du manifeste lui-même.
# Elle s'exécute sur le manifeste réel ET sur des fixtures négatives : toute
# violation — URL historique data.gouv, version NAF manquante, id dupliqué,
# règle de sélection absente, ... — fait échouer la validation bruyamment, en
# nommant le champ fautif. Le contrat est la barrière qui empêche d'ingérer la
# mauvaise source (le fichier historique national) par erreur.
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

  # URL : HTTPS et EXACTEMENT l'URL stable de l'export régional ODS
  # (sirene-v3-consolidee) — la ressource historique
  # (stocketablissementhistorique, data.gouv) a un autre identifiant et doit
  # être refusée
  url <- valeur("url")
  if (is.na(url)) manquer("url", "URL absente")
  if (!startsWith(url, "https://")) manquer("url", "URL non HTTPS")
  if (is.na(URL_SIRENE_REGIONAL) || url != URL_SIRENE_REGIONAL) {
    manquer("url", paste0(
      "l'URL doit être l'URL stable de l'export régional data.bretagne.bzh ",
      "(sirene-v3-consolidee) ; la ressource HISTORIQUE data.gouv ",
      "(stocketablissementhistorique) est refusée"
    ))
  }

  # nom de cache : unique, au motif exact, il encode id + millésime — jamais
  # le fichier historique ; le cache est le CSV d'export (pas de zip)
  fichier <- valeur("fichier")
  vintage <- valeur("vintage")
  if (is.na(fichier)) manquer("fichier", "nom de cache absent")
  if (grepl("historique", fichier, ignore.case = TRUE)) {
    manquer("fichier", paste0(
      "nom de fichier du stock historique — interdit ",
      "(stocketablissementhistorique)"
    ))
  }
  if (!grepl("^sirene_snapshot_[0-9]{4}-[0-9]{2}\\.csv$", fichier)) {
    manquer("fichier", "nom de cache attendu : sirene_snapshot_<AAAA-MM>.csv")
  }
  if (fichier != paste0(valeur("id"), "_", vintage, ".csv")) {
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

  # les dates — ISO ; la convention de référence du stock (rétablie) : la
  # référence est l'image du répertoire au dernier jour du mois PRÉCÉDANT le
  # millésime du fichier (pour le millésime 2026-04 : 2026-03-31 — le dernier
  # traitement observé dans le fichier régional, voir champ_traitement) ;
  # l'extraction (data_processed de la coupe ODS) est postérieure ou égale à
  # la référence ; la publication (mise en ligne réelle) est postérieure ou
  # égale à l'extraction
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
  dernier_du_mois_precedent <- as.character(as.Date(paste0(vintage, "-01")) - 1)
  if (date_ref != dernier_du_mois_precedent) {
    manquer("date_reference", paste0(
      "la référence doit être le dernier jour du mois précédant le millésime ",
      "du fichier (l'image du répertoire SIRENE — le maximum de ",
      "datederniertraitementetablissement)"
    ))
  }
  if (as.Date(date_ext) < as.Date(date_ref)) {
    manquer("date_extraction", paste0(
      "l'extraction (data_processed de la coupe ODS) doit être postérieure ",
      "ou égale à la référence"
    ))
  }
  if (as.Date(date_pub) < as.Date(date_ext)) {
    manquer("date_publication", paste0(
      "la publication doit être postérieure ou égale à l'extraction"
    ))
  }

  # version NAF déclarée (rév. 2)
  naf <- valeur("naf_version")
  if (is.na(naf) || !grepl("NAF", naf) ||
      !grepl("r[ée]v\\.? ?2", naf, ignore.case = TRUE)) {
    manquer("naf_version", "version NAF déclarée attendue (NAF rév. 2)")
  }

  # les champs exacts du vocabulaire ODS régional (minuscules) — commune,
  # statut administratif, code APE, libellé APET (classeetablissement) et le
  # champ de fraîcheur (datederniertraitementetablissement) ; PAS de champ
  # diffusion : la diffusion n'est pas retenue (todo 9)
  champs <- c(
    champ_commune = "codecommuneetablissement",
    champ_actif = "etatadministratifetablissement",
    champ_naf = "activiteprincipaleetablissement",
    champ_libelle = "classeetablissement",
    champ_traitement = "datederniertraitementetablissement"
  )
  for (nom in names(champs)) {
    if (is.na(valeur(nom)) || valeur(nom) != champs[[nom]]) {
      manquer(nom, sprintf("champ attendu : %s", champs[[nom]]))
    }
  }

  # la règle de sélection documentée : actifs seuls (le libellé ODS 'Actif',
  # pas le code national 'A') + les exclusions explicites dans le texte de la
  # règle ; aucune référence au vocabulaire de diffusion du fichier national
  regle <- valeur("regle_selection")
  if (is.na(regle) || !nzchar(regle)) {
    manquer("regle_selection", "règle de sélection absente")
  }
  if (!grepl("etatadministratifetablissement", regle)) {
    manquer("regle_selection", paste0(
      "la règle doit documenter le filtre actif ",
      "(etatadministratifetablissement = 'Actif')"
    ))
  }
  if (!grepl("'Actif'", regle)) {
    manquer("regle_selection", paste0(
      "la règle doit documenter la valeur de filtre 'Actif' (le libellé ODS)"
    ))
  }

  invisible(TRUE)
}
