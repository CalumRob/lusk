# manifest_programmes -----------------------------------------------------------
# Le manifeste du thème Programmes & financements (issue #175, ADR-0013) : les
# CINQ sources officielles du payload `programmes` — une ligne par source, la
# même convention que les manifestes des autres thèmes (issue #13) :
#   - acv   : ANCT, data.gouv.fr — « Programme Action cœur de ville » : la
#     liste des communes sélectionnées (COG 2025). Les villes lauréates — le
#     label, ancré à la commune. 11 villes bretonnes.
#   - pvd   : ANCT, data.gouv.fr — « Programme Petites villes de demain » :
#     la liste des communes sélectionnées (COG 2025). Le label, ancré à la
#     commune. 135 communes bretonnes (identiques dans les deux sources ANCT).
#   - crte  : ANCT, data.gouv.fr — « Contrat de relance et de transition
#     écologique » : le fichier de SUIVI DU PÉRIMÈTRE (COG 2025), qui recense
#     les groupements couverts par chaque CRTE — LE grain signataire : les EPCI
#     porteurs (siren_epci), jamais la liste des communes couvertes (qui ne
#     dit pas qui a signé). 40 CRTE bretons.
#   - territoires_industrie : CDC/ANCT, opendata.caissedesdepots.fr (moissonné
#     sur data.gouv.fr) — « liste des Territoires d'industrie et des communes
#     concernées » : les territoires arrêtés fin 2022 et les EPCI qu'ils
#     regroupent. Le badge contractuel, ancré à l'EPCI. 10 territoires bretons,
#     32 EPCIs.
#   - ort   : DGALN/ANCT, data.gouv.fr — « Liste des communes couvertes par
#     des opérations de revitalisation de territoire » : la ressource XLSX
#     UNIQUEMENT (id ec3eb2fc-…) — la ressource CSV sert un sous-ensemble
#     Lot-et-Garonne cassé, jamais une base. Les conventions signées (statut
#     Signée / Terminée / Non signée), ancrées à la commune ET à l'EPCI.
#
# La discipline des fragments (issue #13) : chaque source garde SON vintage, SA
# référence et SA publication — aucun alignement de date. L'ORT fait exception
# assumée : la fraîcheur du fichier est l'actualisation PAR LIGNE (la colonne
# « Dernière actualisation » du classeur), jamais la métadonnée de page — la
# page data.gouv annonce une dernière modification de mai 2025, périmée
# d'environ 15 mois au moment du portage (août 2026). La référence et la
# publication source de l'ORT sont donc NA : les lignes d'adhésion ORT portent
# chacune l'actualisation de leur convention, et le contrat refuse d'inventer
# une date de page. verifier_contrat_programmes (ci-dessous) valide le
# manifeste concaténé et ses fragments.

# MANIFEST_PROGRAMMES_ACV -------------------------------------------------------
# Le fragment ACV : le jeu ANCT « Programme Action cœur de ville »
# (data.gouv.fr, id 5acc7eddc751df5e21efdf20), fichier « Liste des communes
# bénéficiaires (COG 2025) » (liste-acv-com2025-20250704.csv, mise en ligne le
# 2025-09-24). Colonnes : insee_com, lib_com, id_acv, lib_acv, date_signature.
MANIFEST_PROGRAMMES_ACV <- tibble::tribble(
  ~id, ~source, ~url, ~fichier, ~vintage, ~date_reference,
  ~date_publication, ~licence, ~note, ~mode, ~type,
  "acv",
  "ANCT — Programme Action cœur de ville : liste des communes sélectionnées (COG 2025)",
  "https://static.data.gouv.fr/resources/programme-action-coeur-de-ville/20250924-154200/liste-acv-com2025-20250704.csv",
  "liste-acv-com2025-20250704.csv",
  "2025", "2025-01-01", "2025-09-24", "lov2",
  paste0(
    "Le label ACV (Action cœur de ville) : la liste officielle des communes ",
    "sélectionnées, publiée par l'ANCT sur data.gouv.fr (jeu 5acc7eddc751df5e21",
    "efdf20, Licence Ouverte 2.0). Le fichier « Liste des communes ",
    "bénéficiaires (COG 2025) » porte les colonnes insee_com, lib_com, id_acv, ",
    "lib_acv, date_signature. Le label est ancré à la COMMUNE — 11 villes ",
    "bretonnes (Lannion, Saint-Brieuc, Morlaix, Quimper, Fougères, Redon, ",
    "Saint-Malo, Vitré, Lorient, Pontivy, Vannes). Référence : le cadre COG ",
    "2025 (2025-01-01) ; publication : la mise en ligne du fichier (2025-09-24)."
  ),
  "cron", "fichier"
)

# MANIFEST_PROGRAMMES_PVD -------------------------------------------------------
# Le fragment PVD : le jeu ANCT « Programme Petites villes de demain »
# (data.gouv.fr, id 5fc1259b703620ed60a49d97), fichier « Liste des communes
# bénéficiaires (COG 2025) » (liste-pvd-com2025-20260427.csv, mise en ligne le
# 2026-04-27). Colonnes : insee_com, lib_com, id_pvd, date_signature.
MANIFEST_PROGRAMMES_PVD <- tibble::tribble(
  ~id, ~source, ~url, ~fichier, ~vintage, ~date_reference,
  ~date_publication, ~licence, ~note, ~mode, ~type,
  "pvd",
  "ANCT — Programme Petites villes de demain : liste des communes sélectionnées (COG 2025)",
  "https://static.data.gouv.fr/resources/programme-petites-villes-de-demain/20260427-160836/liste-pvd-com2025-20260427.csv",
  "liste-pvd-com2025-20260427.csv",
  "2025", "2025-01-01", "2026-04-27", "lov2",
  paste0(
    "Le label PVD (Petites villes de demain) : la liste officielle des communes ",
    "sélectionnées, publiée par l'ANCT sur data.gouv.fr (jeu 5fc1259b703620ed60",
    "a49d97, Licence Ouverte 2.0). Le fichier « Liste des communes ",
    "bénéficiaires (COG 2025) » porte les colonnes insee_com, lib_com, id_pvd, ",
    "date_signature. Le label est ancré à la COMMUNE — 135 communes bretonnes ",
    "(le même compte dans les deux sources ANCT : la liste et le croisement des ",
    "dispositifs). Référence : le cadre COG 2025 (2025-01-01) ; publication : la ",
    "mise en ligne du fichier (2026-04-27)."
  ),
  "cron", "fichier"
)

# MANIFEST_PROGRAMMES_CRTE ------------------------------------------------------
# Le fragment CRTE : le jeu ANCT « Contrat de relance et de transition
# écologique » (data.gouv.fr, id 60799532757dbdef335c00c5). LA source est le
# fichier « Suivi du périmètre (COG 2025) » (liste-crte-grpt2025-20250717.csv,
# mis en ligne le 2025-09-24) : il recense les GROUPEMENTS couverts par chaque
# CRTE — au grain EPCI signataire (siren_epci, lib_groupement, type_grp_crte
# mono/pluri), avec la date de signature. Les deux autres fichiers du jeu (la
# liste des contrats, la liste des communes couvertes) ne disent pas qui a
# signé : le premier n'a pas le grain EPCI, le second associe des communes à
# des contrats sans les intercommunalités signataires.
MANIFEST_PROGRAMMES_CRTE <- tibble::tribble(
  ~id, ~source, ~url, ~fichier, ~vintage, ~date_reference,
  ~date_publication, ~licence, ~note, ~mode, ~type,
  "crte",
  "ANCT — Contrat de relance et de transition écologique : suivi du périmètre (COG 2025), les groupements couverts par CRTE",
  "https://static.data.gouv.fr/resources/contrat-de-relance-et-de-transition-ecologique/20250924-161900/liste-crte-grpt2025-20250717.csv",
  "liste-crte-grpt2025-20250717.csv",
  "2025", "2025-07-17", "2025-09-24", "lov2",
  paste0(
    "Le badge contractuel CRTE : les intercommunalités signataires, au grain ",
    "EPCI. LE fichier est le « Suivi du périmètre (COG 2025) » du jeu ANCT ",
    "60799532757dbdef335c00c5 (data.gouv.fr, Licence Ouverte 2.0) : il recense ",
    "les GROUPEMENTS couverts par chaque CRTE — une ligne par groupement, qui ",
    "peut être une commune signataire individuelle (nature_juridique « COM ») ",
    "ou un EPCI (« CC » / « CA » / « METRO ») ; siren_epci porte le SIREN du ",
    "groupement lui-même (jamais l'EPCI de la commune pour une ligne COM), avec ",
    "type_grp_crte (mono/pluri) et date_signature. Le badge est ancré aux SEULES ",
    "lignes EPCI du fichier : une commune qui signe individuellement n'engage ",
    "pas son EPCI. Les deux autres fichiers du jeu sont exclus : la liste des ",
    "contrats (id_crte, lib_crte, date_signature — aucun EPCI) et la liste des ",
    "communes couvertes (insee_com × id_crte — des communes, pas les ",
    "signataires). 40 CRTE bretons, 58 paires (contrat × EPCI signataire) — les ",
    "CRTE pluri portent leurs plusieurs EPCIs ; les îles du Ponant signent sans ",
    "EPCI. Référence : les données du périmètre au 17/07/2025 ; publication : ",
    "la mise en ligne (2025-09-24)."
  ),
  "cron", "fichier"
)

# MANIFEST_PROGRAMMES_TI --------------------------------------------------------
# Le fragment Territoires d'industrie : le jeu « liste des Territoires
# d'industrie et des communes concernées » (opendata.caissedesdepots.fr,
# moissonné sur data.gouv.fr, id 5fa9901d5a498251f21963ea), ressource CSV
# (délimiteur ';', une ligne par commune du territoire, avec le code officiel
# de l'EPCI). Le territoire (id_ti) regroupe des EPCIs : le badge est ancré à
# l'EPCI. 10 territoires bretons, 32 EPCIs.
MANIFEST_PROGRAMMES_TI <- tibble::tribble(
  ~id, ~source, ~url, ~fichier, ~vintage, ~date_reference,
  ~date_publication, ~licence, ~note, ~mode, ~type,
  "territoires_industrie",
  "ANCT/Banque des Territoires — liste des Territoires d'industrie et des communes concernées (les territoires arrêtés fin 2022)",
  "https://opendata.caissedesdepots.fr/api/explore/v2.1/catalog/datasets/liste-des-territoires-dindustrie-et-des-communes-concernees/exports/csv?use_labels=true",
  "liste-ti-communes.csv",
  "2022", "2022-12-31", "2025-09-30", "lov2",
  paste0(
    "Le badge contractuel Territoires d'industrie : les EPCIs qui portent un ",
    "territoire labellisé. Le jeu « liste des Territoires d'industrie et des ",
    "communes concernées » (opendata.caissedesdepots.fr, moissonné sur ",
    "data.gouv.fr 5fa9901d5a498251f21963ea, Licence Ouverte 2.0) liste les ",
    "communes de chaque territoire avec le code officiel de leur EPCI — une ",
    "ligne par commune, fichier CSV délimité ';' (avec la géométrie en colonne, ",
    "jamais lue). Le badge est ancré à l'EPCI : les EPCIs distincts de chaque ",
    "territoire. 10 territoires bretons (Baie d'Armor Industrie, Centre ",
    "Morbihan, Dinan, Finistère, Fougères-Vitré, Lannion-Trégor, Pays de ",
    "Lorient-Quimperlé, Pays de Vannes, Ploërmel, Sud Vilaine), 32 EPCIs. ",
    "Référence : les territoires arrêtés fin 2022 (2022-12-31) ; publication : ",
    "le moissonnage du jeu (2025-09-30)."
  ),
  "cron", "fichier"
)

# MANIFEST_PROGRAMMES_ORT -------------------------------------------------------
# Le fragment ORT : le jeu DGALN/ANCT « Liste des communes couvertes par des
# opérations de revitalisation de territoire » (data.gouv.fr, id
# 63c69d70de98bf9a1fa11948). LA ressource est le classeur XLSX (id
# ec3eb2fc-c7a6-4c9f-b9ee-b471ed88e6fc, un doc Grist DGALN) — la ressource CSV
# du même jeu sert un sous-ensemble Lot-et-Garonne cassé (le contrat refuse
# tout autre fichier de cache). La feuille « Suivi conventions » porte une
# ligne par commune-convention : Région, Département, EPCI, Code commune, ACV,
# PVD, Statut de la commune, « Signée ? » (Signée / Terminée / Non signée /
# En cours), dates, « Dernière actualisation » (PAR LIGNE), doublon.
# La fraîcheur du fichier est l'actualisation par ligne : la métadonnée de
# page (dernière modification mai 2025) est périmée d'environ 15 mois — elle
# n'est jamais citée (référence et publication source NA).
MANIFEST_PROGRAMMES_ORT <- tibble::tribble(
  ~id, ~source, ~url, ~fichier, ~vintage, ~date_reference,
  ~date_publication, ~licence, ~note, ~mode, ~type,
  "ort",
  "DGALN/ANCT — Liste des communes couvertes par des opérations de revitalisation de territoire (ORT) : conventions signées (classeur XLSX, feuille « Suivi conventions »)",
  "https://grist.numerique.gouv.fr/o/dgaln/api/docs/j4i9oKD3jzFtgEUuM9sXnL/download/xlsx?",
  "ort-conventions.xlsx",
  "en continu", NA_character_, NA_character_, "lov2",
  paste0(
    "L'outil ORT (opération de revitalisation de territoire, loi Elan 2018) : ",
    "la liste officielle des communes couvertes par une convention, produite ",
    "par la DGALN et l'ANCT à partir des campagnes de reporting des DDT (jeu ",
    "data.gouv.fr 63c69d70de98bf9a1fa11948, Licence Ouverte 2.0). LA ressource ",
    "est le classeur XLSX (id ec3eb2fc-c7a6-4c9f-b9ee-b471ed88e6fc, doc Grist ",
    "DGALN) : la ressource CSV du même jeu sert un sous-ensemble Lot-et-Garonne ",
    "cassé, jamais une base. La feuille « Suivi conventions » porte une ligne ",
    "par commune-convention : Région, Département, EPCI, Code commune, les ",
    "drapeaux ACV/PVD, Statut de la commune (1. Commune ACV / 2. Commune PVD / ",
    "3. Autre), « Signée ? » (Signée / Terminée / Non signée / En cours), les ",
    "dates de signature, « Dernière actualisation » PAR LIGNE et le drapeau ",
    "doublon. Le badge ne s'allume QUE sur les conventions « Signée » (jamais ",
    "Terminée ni Non signée). La fraîcheur est l'actualisation par ligne : la ",
    "métadonnée de page (dernière modification mai 2025) est périmée d'environ ",
    "15 mois — la référence et la publication source sont donc NA, chaque ligne ",
    "d'adhésion ORT porte l'actualisation de SA convention."
  ),
  "cron", "fichier"
)

# MANIFEST_PROGRAMMES -----------------------------------------------------------
# Le manifeste CONCATÉNÉ du thème (la même forme que MANIFEST_ECONOMIE /
# MANIFEST_MOBILITE) : les fragments, dans l'ordre — les deux labels ANCT
# (ACV, PVD), les deux contrats (CRTE, Territoires d'industrie), puis l'outil
# ORT. CINQ lignes, cinq ids uniques, chaque source garde SON vintage. Validé
# par verifier_contrat_programmes.
MANIFEST_PROGRAMMES <- dplyr::bind_rows(
  MANIFEST_PROGRAMMES_ACV,
  MANIFEST_PROGRAMMES_PVD,
  MANIFEST_PROGRAMMES_CRTE,
  MANIFEST_PROGRAMMES_TI,
  MANIFEST_PROGRAMMES_ORT
)

# verifier_contrat_programmes ---------------------------------------------------
# La validation du contrat du manifeste (la discipline des fragments, comme
# verifier_contrat_manifest_mobilite) : CINQ sources, cinq ids uniques et
# exacts, chaque fragment sur SON contrat — le fichier épinglé, la licence
# Ouverte, le mode cron, le type fichier, les dates bien formées (la
# publication jamais antérieure à la référence), et la règle ORT : la
# fraîcheur PAR LIGNE, la référence et la publication NA — le contrat refuse
# d'inventer une date de page périmée. Un manifeste corrompu échoue
# bruyamment en nommant le champ fautif.
verifier_contrat_programmes <- function(manifest) {
  manquer <- function(champ, detail) {
    stop(sprintf("Contrat Programmes manifeste violé — %s : %s.", champ,
                 detail), call. = FALSE)
  }
  if (!inherits(manifest, "tbl_df")) {
    manquer("forme", "le manifeste doit être un tibble")
  }
  if (anyDuplicated(manifest$id)) manquer("id", "id dupliqué")
  if (nrow(manifest) != 5L) {
    manquer("forme", paste0("le manifeste concaténé porte CINQ sources (ACV, ",
                            "PVD, CRTE, Territoires d'industrie, ORT), pas ",
                            nrow(manifest)))
  }
  attendus <- c("acv", "pvd", "crte", "territoires_industrie", "ort")
  if (!setequal(manifest$id, attendus)) {
    manquer("id", paste0("ids attendus : ", paste(attendus, collapse = " / ")))
  }

  # le contrat commun des fragments : fichier téléchargeable en cron (les
  # jeux officiels ouverts — jamais un portage à la main), Licence Ouverte 2.0
  if (any(manifest$mode != "cron")) {
    manquer("mode", "mode attendu : 'cron' pour les cinq sources (jeux officiels)")
  }
  if (any(manifest$type != "fichier")) {
    manquer("type", "type attendu : 'fichier'")
  }
  if (any(manifest$licence != "lov2")) {
    manquer("licence", "licence attendue : 'lov2' (Licence Ouverte 2.0)")
  }

  # les fragments épinglés : le fichier de cache exact de chaque source
  fichiers <- stats::setNames(manifest$fichier, manifest$id)
  if (fichiers[["acv"]] != "liste-acv-com2025-20250704.csv") {
    manquer("fichier", "le contrat épingle le fichier ACV liste-acv-com2025-20250704.csv")
  }
  if (fichiers[["pvd"]] != "liste-pvd-com2025-20260427.csv") {
    manquer("fichier", "le contrat épingle le fichier PVD liste-pvd-com2025-20260427.csv")
  }
  if (fichiers[["crte"]] != "liste-crte-grpt2025-20250717.csv") {
    manquer("fichier", paste0(
      "le contrat épingle le SUIVI DU PÉRIMÈTRE CRTE (liste-crte-grpt2025-",
      "20250717.csv) — les signataires y sont au grain EPCI, jamais la liste ",
      "des contrats ni la liste des communes couvertes"))
  }
  if (fichiers[["territoires_industrie"]] != "liste-ti-communes.csv") {
    manquer("fichier", "le contrat épingle le fichier TI liste-ti-communes.csv")
  }
  if (!grepl("xlsx", fichiers[["ort"]])) {
    manquer("fichier", paste0(
      "le contrat épingle la ressource XLSX du jeu ORT — la ressource CSV sert ",
      "un sous-ensemble Lot-et-Garonne cassé, jamais une base"))
  }

  # les dates : ISO et bien formées pour les quatre jeux ANCT (la publication
  # jamais antérieure à la référence) ; l'ORT fait exception ASSUMÉE — la
  # fraîcheur est PAR LIGNE, la référence et la publication source NA (la
  # métadonnée de page est périmée d'environ 15 mois, jamais citée)
  iso <- grepl("^[0-9]{4}-[0-9]{2}(-[0-9]{2})?$", manifest$date_reference) |
    is.na(manifest$date_reference)
  if (!all(iso)) manquer("date_reference", "dates ISO bien formées (ou NA pour l'ORT)")
  iso_pub <- grepl("^[0-9]{4}-[0-9]{2}(-[0-9]{2})?$",
                   manifest$date_publication) | is.na(manifest$date_publication)
  if (!all(iso_pub)) {
    manquer("date_publication", "dates ISO bien formées (ou NA pour l'ORT)")
  }
  hors_ort <- manifest[manifest$id != "ort", ]
  if (any(is.na(hors_ort$date_reference)) || any(is.na(hors_ort$date_publication))) {
    manquer("dates", "les quatre jeux ANCT portent référence ET publication")
  }
  if (any(as.Date(hors_ort$date_publication) < as.Date(hors_ort$date_reference))) {
    manquer("date_publication", "la publication doit être postérieure ou égale à la référence")
  }
  ort <- manifest[manifest$id == "ort", ]
  if (!is.na(ort$date_reference) || !is.na(ort$date_publication)) {
    manquer("dates", paste0(
      "la fraîcheur ORT est PAR LIGNE — la référence et la publication source ",
      "doivent rester NA (la métadonnée de page, mai 2025, est périmée ",
      "d'environ 15 mois)"))
  }

  invisible(TRUE)
}
