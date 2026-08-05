# reshape_economie_sirene ------------------------------------------------------
# La normalisation de la source « SIRENE — extrait régional data.bretagne.bzh »
# (todo 9, plan economie-pipeline-contracts — la bascule régionale) : l'export
# API ODS du jeu « sirene-v3-consolidee » (Base SIRENE - Région Bretagne,
# actifs seuls via le where de l'URL, vocabulaire ODS minuscules) vers la
# table communale longue et creuse du thème Économie/Emploi — une ligne par
# cellule commune × code APE (NAF rév. 2, 5 chiffres) × tranche d'effectifs,
# le nombre d'établissements ACTIFS comme valeur. Le statut de diffusion
# n'est PAS une dimension (décision todo 9 : chaque établissement actif avec
# commune et code APE exploitables compte, quelle que soit sa diffusion) — les
# jumelles O/P d'une même cellule fusionnent en une ligne. Comme
# reshape_habitat_rp.R, ce fragment lit le cache brut et produit la table
# processée ; le manifeste (manifest_economie_sirene.R, todo 1) est le CONTRAT
# consommé ici — les champs exacts du vocabulaire ODS
# (codecommuneetablissement, etatadministratifetablissement,
# activiteprincipaleetablissement, classeetablissement), la source, le
# millésime et la version NAF en sont tirés, jamais recopiés à la main.
#
# Règles du contrat appliquées (regle_selection du manifeste) :
#   - actifs seuls : etatadministratifetablissement = 'Actif' (le libellé ODS
#     enrichi — les « Fermé » sont exclus et comptés dans le rapport
#     d'exclusions) ;
#   - la Bretagne est une VALIDATION, pas un filtre : le jeu est pré-découpé
#     (codeRegionEtablissement = 53), les gardes commune COG 5 chiffres +
#     département 22/29/35/56 restent des contrôles défensifs ;
#   - diffusion non retenue : aucun statut de diffusion n'est conservé ;
#   - lignes sans commune bretonne exploitable (22/29/35/56) ou sans code APE
#     valide (APET 5 caractères : NN.NNZ) exclues et comptées ;
#   - trancheeffectifsetablissement reste de la MÉTADONNÉE : jamais convertie
#     en effectifs salariés.
# Guardrails du plan (docs/themes/economie-emploi.md §SIRENE snapshot rules) :
# pas de matrice binaire de présence, pas d'agrégation supra-communale, pas
# d'estimation d'emploi, pas d'ingestion du stock historique.
#
# Le grain « long et creux » : une ligne par cellule observée
# (commune × code APE × tranche d'effectifs), ventilée par la tranche pour que
# la taille reste une VALEUR atomique par ligne (le contrat du thème la
# retient). Les cellules non observées (0 établissement) n'existent pas ; le
# profilage (todo 7) et les futurs agrégats (LQ, matrice M) regroupent à la
# demande — sum(value) par commune × code APE redonne le comptage du grain fin.

# Les champs du vocabulaire ODS NON épinglés par le manifeste mais portés par
# la normalisation : la tranche d'effectifs (métadonnée, en LIBELLÉS ODS) et
# le libellé du code APE (porté par classeetablissement, le champ épinglé
# champ_libelle du manifeste). Les champs épinglés (commune / actif / NAF /
# libellé) viennent du manifeste.
CHAMP_TRANCHE_EFFECTIFS_SIRENE <- "trancheeffectifsetablissement"

# La mesure de la table : le nombre d'établissements ACTIFS par cellule
# (le même style de constante que RP_MEASURE = "DWELLINGS" en Démographie)
MESURE_SIRENE <- "ETABLISSEMENTS_ACTIFS"

# Le motif d'exclusion d'une ligne du snapshot (rapport d'exclusions). L'ordre
# documente la PRIORITÉ d'attribution : un établissement fermé est « ferme »
# même si sa commune manque ; une ligne qui cumule les défauts reçoit le
# premier motif qui s'applique.
RAISONS_EXCLUSION_SIRENE <- c(
  "ferme", "commune_manquante", "commune_invalide", "commune_hors_bretagne",
  "naf_manquante", "naf_invalide"
)

# normaliser_sirene_snapshot ---------------------------------------------------
# La normalisation pure : un snapshot brut (tibble, une ligne par
# établissement) vers la liste {table, exclusions}. Le manifeste fournit les
# champs exacts du vocabulaire ODS et la métadonnée d'enveloppe (source,
# millésime, version NAF). Le contrat est vérifié AVANT tout filtrage : une
# violation du manifeste (URL historique, règle absente, ...) arrête la
# normalisation.
normaliser_sirene_snapshot <- function(snapshot,
                                       manifest = MANIFEST_ECONOMIE_SIRENE) {
  # le contrat d'abord — la normalisation consomme un manifeste valide
  verifier_contrat_sirene_snapshot(manifest)

  champ_commune <- manifest$champ_commune
  champ_actif <- manifest$champ_actif
  champ_naf <- manifest$champ_naf
  champ_libelle <- manifest$champ_libelle
  champ_traitement <- manifest$champ_traitement

  # les champs épinglés par le contrat doivent exister dans le snapshot :
  # un export qui ne porte pas le vocabulaire ODS est refusé. Le libellé APET
  # (classeetablissement) et la date de traitement
  # (datederniertraitementetablissement) sont OBLIGATOIRES quand le manifeste
  # les déclare — c'est le cas de l'export régional
  manquants <- setdiff(c(champ_commune, champ_actif, champ_naf),
                       names(snapshot))
  if (!is.na(champ_libelle) && nzchar(champ_libelle)) {
    manquants <- union(manquants, setdiff(champ_libelle, names(snapshot)))
  }
  if (!is.na(champ_traitement) && nzchar(champ_traitement)) {
    manquants <- union(manquants, setdiff(champ_traitement, names(snapshot)))
  }
  if (length(manquants)) {
    stop(sprintf(
      "Snapshot SIRENE incomplet — champs absents : %s.",
      paste(manquants, collapse = ", ")
    ), call. = FALSE)
  }

  # identifiant d'établissement : le siret quand l'export le porte (toujours
  # dans le vrai CSV), sinon la ligne — le rapport d'exclusions a besoin
  # d'un identifiant stable même sur un snapshot allégé
  if (!"siret" %in% names(snapshot)) snapshot$siret <- seq_len(nrow(snapshot))

  norm <- snapshot %>%
    # les champs du contrat, rebaptisés en colonnes de travail
    dplyr::mutate(
      commune = .data[[champ_commune]],
      etat = .data[[champ_actif]],
      naf = .data[[champ_naf]],
      tranche = .data[[CHAMP_TRANCHE_EFFECTIFS_SIRENE]],
      libelle = .data[[champ_libelle]]
    ) %>%
    # l'exploitabilité des deux clés : commune COG 5 chiffres (le premier
    # groupe de 2 chiffres = le département) et code APE APET 5 caractères ;
    # l'actif est le libellé ODS enrichi 'Actif' (jamais le code national 'A')
    dplyr::mutate(
      commune_ok = !is.na(commune) & nzchar(commune) &
        grepl("^[0-9]{5}$", commune),
      dept = dplyr::if_else(commune_ok, substr(commune, 1, 2), NA_character_),
      bretonne = commune_ok & dept %in% DEPT_BRETAGNE,
      naf_ok = !is.na(naf) & nzchar(naf) &
        grepl("^[0-9]{2}\\.[0-9]{2}[A-Z]$", naf),
      actif = etat %in% "Actif"
    )

  # L'AUTO-VÉRIFICATION de fraîcheur : le FICHIER a le dernier mot sur sa
  # propre date. Le maximum de datederniertraitementetablissement parmi les
  # lignes RETENUES (actif × bretonne × naf_ok) doit égaler EXACTEMENT la date
  # de référence épinglée par le manifeste — aucune tolérance d'un jour :
  # as.Date lit la composante date UTC telle qu'écrite dans l'ISO (un
  # traitement à 2026-03-31T23:41:59+00:00 reste le 2026-03-31 — pas de
  # débordement au jour suivant), et un fichier rafraîchi vers un stock plus
  # récent déplace le maximum et fait échouer le contrat bruyamment : le seam
  # du watchdog, qui force la mise à jour CONSCIENTE du manifeste quand l'ODS
  # repasse à un stock plus frais. Une colonne entièrement vide (fichier non
  # téléchargé / non conforme) est aussi une violation : on ne vérifie jamais
  # silencieusement la fraîcheur d'un fichier muet.
  traites <- as.Date(norm[[champ_traitement]][
    norm$actif & norm$bretonne & norm$naf_ok
  ])
  if (length(traites) == 0 || all(is.na(traites))) {
    stop(sprintf(
      paste0(
        "Contrat SIRENE snapshot violé — date_reference : %s est entièrement ",
        "vide parmi les lignes retenues — impossible de vérifier la fraîcheur ",
        "du fichier."
      ), champ_traitement
    ), call. = FALSE)
  }
  date_observee <- as.character(max(traites, na.rm = TRUE))
  if (date_observee != manifest$date_reference) {
    stop(sprintf(
      paste0(
        "Contrat SIRENE snapshot violé — date_reference : le manifeste ",
        "épingle %s mais le dernier traitement observé dans le fichier est %s."
      ), manifest$date_reference, date_observee
    ), call. = FALSE)
  }

  # LA table : actifs seuls, communes bretonnes, code APE exploitable — une
  # ligne par cellule observée (commune × code APE × tranche ; la diffusion
  # n'est pas retenue)
  table <- norm %>%
    dplyr::filter(actif, bretonne, naf_ok) %>%
    dplyr::group_by(commune, naf, tranche) %>%
    dplyr::summarise(
      activity_label = premier_libelle(libelle),
      value = dplyr::n(),
      .groups = "drop"
    ) %>%
    dplyr::rename(activity_code = naf, tranche_effectifs = tranche) %>%
    dplyr::mutate(
      measure = MESURE_SIRENE,
      source = manifest$source,
      vintage = manifest$vintage,
      etat_administratif = "Actif",
      naf_version = manifest$naf_version
    ) %>%
    dplyr::select(commune, activity_code, activity_label, value, measure,
                  source, vintage, etat_administratif, tranche_effectifs,
                  naf_version) %>%
    dplyr::arrange(commune, activity_code, tranche_effectifs)

  # Le rapport d'exclusions : une ligne par établissement rejeté, avec son
  # motif (prioritaire) et les valeurs fautives pour inspection — le statut
  # de diffusion n'y figure plus (non retenu)
  exclusions <- norm %>%
    dplyr::filter(!(actif & bretonne & naf_ok)) %>%
    dplyr::mutate(raison = dplyr::case_when(
      !actif ~ "ferme",
      !commune_ok & (is.na(commune) | !nzchar(commune)) ~ "commune_manquante",
      !commune_ok ~ "commune_invalide",
      !(dept %in% DEPT_BRETAGNE) ~ "commune_hors_bretagne",
      is.na(naf) | !nzchar(naf) ~ "naf_manquante",
      TRUE ~ "naf_invalide"
    )) %>%
    dplyr::select(siret, raison, commune, naf, etat_administratif = etat) %>%
    dplyr::arrange(siret)

  list(table = table, exclusions = exclusions)
}

# premier_libelle -------------------------------------------------------------
# Le libellé du code APE d'une cellule : la première valeur non manquante
# (toutes les lignes d'une cellule portent le même libellé ; certaines lignes
# peuvent l'avoir vide).
premier_libelle <- function(x) {
  x <- x[!is.na(x) & nzchar(x)]
  if (length(x) == 0) NA_character_ else x[1]
}

# lire_snapshot_sirene ---------------------------------------------------------
# Le lecteur du fichier réel (l'export CSV data.bretagne.bzh, séparateur
# « ; », en-tête de colonnes ODS). Tout en caractères : les codes (siret,
# commune, APE) ne doivent JAMAIS être devinés numériques. Non testé dans la
# boucle de test (comme lire_csv_long) : il lit le vrai fichier de ~58,5 Mo ;
# la normalisation, elle, est testée sur la forme réelle
# (test-reshape-economie-sirene.R).
lire_snapshot_sirene <- function(chemin) {
  readr::read_delim(
    chemin, delim = ";",
    col_types = readr::cols(.default = readr::col_character()),
    show_col_types = FALSE, progress = FALSE
  )
}

# construire_sirene_normalise --------------------------------------------------
# L'acte « trouver la donnée » de la source : lit le cache brut — qui EST le
# CSV d'export (pas de ZIP à décompresser depuis la bascule régionale) —,
# normalise, et persiste la table + le rapport d'exclusions sous la
# localisation dédiée Économie/Emploi des données processées
# (data/processed/economie/). Idempotent (overwrite = FALSE à l'écriture,
# comme construire_donnees_brut_rp). Le paramètre `snapshot` permet aux tests
# de passer la fixture directement : le chemin de code de normalisation et de
# persistance est le même que pour le fichier réel.
construire_sirene_normalise <- function(cache = "data/raw",
                                        sortie = "data/processed/economie/sirene_snapshot.rds",
                                        manifest = MANIFEST_ECONOMIE_SIRENE,
                                        snapshot = NULL) {
  if (is.null(snapshot)) {
    snapshot <- lire_snapshot_sirene(file.path(cache, manifest$fichier))
  }

  normalise <- normaliser_sirene_snapshot(snapshot, manifest)

  if (!dir.exists(dirname(sortie))) dir.create(dirname(sortie), recursive = TRUE)
  readr::write_rds(normalise$table, sortie)
  readr::write_rds(normalise$exclusions,
                   sub("\\.rds$", "_exclusions.rds", sortie))

  normalise$table
}
