# reshape_economie_sirene ------------------------------------------------------
# La normalisation de la source « SIRENE — fichier stock des établissements »
# (todo 4, plan economie-pipeline-contracts) : le snapshot mensuel brut (une
# ligne par établissement, dessin de fichier INSEE StockEtablissement v311)
# vers la table communale longue et creuse du thème Économie/Emploi — une
# ligne par cellule commune × code APE (NAF rév. 2, 5 chiffres) ventilée par
# les dimensions sources conservées (statut de diffusion, tranche d'effectifs),
# le nombre d'établissements ACTIFS comme valeur. Comme reshape_habitat_rp.R,
# ce fragment lit le cache brut et produit la table processée ; le manifeste
# (manifest_economie_sirene.R, todo 1) est le CONTRAT consommé ici — les champs
# exacts du dessin de fichier (codeCommuneEtablissement,
# etatAdministratifEtablissement, statutDiffusionEtablissement,
# activitePrincipaleEtablissement), la source, le millésime et la version NAF
# en sont tirés, jamais recopiés à la main.
#
# Règles du contrat appliquées (regle_selection du manifeste) :
#   - actifs seuls : etatAdministratifEtablissement = 'A' (les fermés 'F' sont
#     exclus et comptés dans le rapport d'exclusions) ;
#   - diffusion partielle 'P' conservée quand commune et code APE exploitables
#     (adresse et géoloc masquées, commune et code APE restent utilisables) ;
#   - lignes sans commune bretonne exploitable (22/29/35/56) ou sans code APE
#     valide (APET 5 caractères : NN.NNZ) exclues et comptées ;
#   - trancheEffectifsEtablissement reste de la MÉTADONNÉE : jamais convertie
#     en effectifs salariés.
# Guardrails du plan (docs/themes/economie-emploi.md §SIRENE snapshot rules) :
# pas de matrice binaire de présence, pas d'agrégation supra-communale, pas
# d'estimation d'emploi, pas d'ingestion du stock historique.
#
# Le grain « long et creux » : une ligne par cellule observée
# (commune × code APE × statut de diffusion × tranche d'effectifs), ventilée
# par les dimensions sources pour que le statut, la taille et la diffusion
# restent des VALEURS atomiques par ligne (le contrat du thème les retient).
# Les cellules non observées (0 établissement) n'existent pas ; le profilage
# (todo 7) et les futurs agrégats (LQ, matrice M) regroupent à la demande —
# sum(value) par commune × code APE redonne le comptage du grain fin.

# Les champs du dessin de fichier StockEtablissement (INSEE v311) NON épinglés
# par le manifeste mais portés par la normalisation : la tranche d'effectifs
# (métadonnée) et le libellé du code APE (porté « quand disponible » par
# l'enveloppe commune — les fichiers antérieurs ne le portent pas). Les champs
# épinglés (commune / actif / diffusion / NAF) viennent du manifeste.
CHAMP_TRANCHE_EFFECTIFS_SIRENE <- "trancheEffectifsEtablissement"
CHAMP_LIBELLE_NAF_SIRENE <- "libelleActivitePrincipaleEtablissement"

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
# champs exacts du dessin de fichier et la métadonnée d'enveloppe (source,
# millésime, version NAF). Le contrat est vérifié AVANT tout filtrage : une
# violation du manifeste (URL historique, règle absente, ...) arrête la
# normalisation.
normaliser_sirene_snapshot <- function(snapshot,
                                       manifest = MANIFEST_ECONOMIE_SIRENE) {
  # le contrat d'abord — la normalisation consomme un manifeste valide
  verifier_contrat_sirene_snapshot(manifest)

  champ_commune <- manifest$champ_commune
  champ_actif <- manifest$champ_actif
  champ_diffusion <- manifest$champ_diffusion
  champ_naf <- manifest$champ_naf

  # les champs épinglés par le contrat doivent exister dans le snapshot :
  # un fichier qui ne porte pas le dessin de fichier INSEE est refusé
  manquants <- setdiff(c(champ_commune, champ_actif, champ_diffusion,
                         champ_naf), names(snapshot))
  if (length(manquants)) {
    stop(sprintf(
      "Snapshot SIRENE incomplet — champs absents : %s.",
      paste(manquants, collapse = ", ")
    ), call. = FALSE)
  }

  # identifiant d'établissement : le siret quand le fichier le porte (toujours
  # dans le vrai stock), sinon la ligne — le rapport d'exclusions a besoin
  # d'un identifiant stable même sur un snapshot allégé
  if (!"siret" %in% names(snapshot)) snapshot$siret <- seq_len(nrow(snapshot))

  norm <- snapshot %>%
    # les champs du contrat, rebaptisés en colonnes de travail
    dplyr::mutate(
      commune = .data[[champ_commune]],
      etat = .data[[champ_actif]],
      diffusion = .data[[champ_diffusion]],
      naf = .data[[champ_naf]],
      tranche = .data[[CHAMP_TRANCHE_EFFECTIFS_SIRENE]],
      libelle = if (CHAMP_LIBELLE_NAF_SIRENE %in% names(snapshot)) {
        .data[[CHAMP_LIBELLE_NAF_SIRENE]]
      } else {
        NA_character_
      }
    ) %>%
    # l'exploitabilité des deux clés : commune COG 5 chiffres (le premier
    # groupe de 2 chiffres = le département) et code APE APET 5 caractères
    dplyr::mutate(
      commune_ok = !is.na(commune) & nzchar(commune) &
        grepl("^[0-9]{5}$", commune),
      dept = dplyr::if_else(commune_ok, substr(commune, 1, 2), NA_character_),
      bretonne = commune_ok & dept %in% DEPT_BRETAGNE,
      naf_ok = !is.na(naf) & nzchar(naf) &
        grepl("^[0-9]{2}\\.[0-9]{2}[A-Z]$", naf),
      actif = etat %in% "A"
    )

  # LA table : actifs seuls, communes bretonnes, code APE exploitable — une
  # ligne par cellule observée (commune × code APE × diffusion × tranche)
  table <- norm %>%
    dplyr::filter(actif, bretonne, naf_ok) %>%
    dplyr::group_by(commune, naf, diffusion, tranche) %>%
    dplyr::summarise(
      activity_label = premier_libelle(libelle),
      value = dplyr::n(),
      .groups = "drop"
    ) %>%
    dplyr::rename(activity_code = naf, statut_diffusion = diffusion,
                  tranche_effectifs = tranche) %>%
    dplyr::mutate(
      measure = MESURE_SIRENE,
      source = manifest$source,
      vintage = manifest$vintage,
      etat_administratif = "A",
      naf_version = manifest$naf_version
    ) %>%
    dplyr::select(commune, activity_code, activity_label, value, measure,
                  source, vintage, etat_administratif, statut_diffusion,
                  tranche_effectifs, naf_version) %>%
    dplyr::arrange(commune, activity_code, statut_diffusion, tranche_effectifs)

  # Le rapport d'exclusions : une ligne par établissement rejeté, avec son
  # motif (prioritaire) et les valeurs fautives pour inspection
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
    dplyr::select(siret, raison, commune, naf,
                  etat_administratif = etat, statut_diffusion = diffusion) %>%
    dplyr::arrange(siret)

  list(table = table, exclusions = exclusions)
}

# premier_libelle -------------------------------------------------------------
# Le libellé du code APE d'une cellule : la première valeur non manquante
# (toutes les lignes d'une cellule portent le même libellé ; certaines lignes
# plus anciennes peuvent l'avoir vide).
premier_libelle <- function(x) {
  x <- x[!is.na(x) & nzchar(x)]
  if (length(x) == 0) NA_character_ else x[1]
}

# lire_snapshot_sirene ---------------------------------------------------------
# Le lecteur du fichier réel (StockEtablissement_utf8.csv, séparateur « ; »).
# Tout en caractères : les codes (siret, commune, APE) ne doivent JAMAIS être
# devinés numériques. Non testé dans la boucle de test (comme lire_csv_long) :
# il lit le vrai fichier de ~2,7 Go ; la normalisation, elle, est testée sur
# la forme réelle (test-reshape-economie-sirene.R).
lire_snapshot_sirene <- function(chemin) {
  readr::read_delim(
    chemin, delim = ";",
    col_types = readr::cols(.default = readr::col_character()),
    show_col_types = FALSE, progress = FALSE
  )
}

# construire_sirene_normalise --------------------------------------------------
# L'acte « trouver la donnée » de la source : décompresse le cache brut, lit
# le snapshot, normalise, et persiste la table + le rapport d'exclusions sous
# la localisation dédiée Économie/Emploi des données processées
# (data/processed/economie/). Idempotent (overwrite = FALSE à l'extraction,
# comme construire_donnees_brut_rp). Le paramètre `snapshot` permet aux tests
# de passer la fixture directement : le chemin de code de normalisation et de
# persistance est le même que pour le fichier réel.
construire_sirene_normalise <- function(cache = "data/raw",
                                        sortie = "data/processed/economie/sirene_snapshot.rds",
                                        manifest = MANIFEST_ECONOMIE_SIRENE,
                                        snapshot = NULL) {
  if (is.null(snapshot)) {
    extrait <- file.path(cache, "extracted")
    if (!dir.exists(extrait)) dir.create(extrait, recursive = TRUE)
    for (f in manifest$fichier) {
      suppressWarnings(
        utils::unzip(file.path(cache, f), exdir = extrait, overwrite = FALSE)
      )
    }
    snapshot <- lire_snapshot_sirene(
      file.path(extrait, "StockEtablissement_utf8.csv")
    )
  }

  normalise <- normaliser_sirene_snapshot(snapshot, manifest)

  if (!dir.exists(dirname(sortie))) dir.create(dirname(sortie), recursive = TRUE)
  readr::write_rds(normalise$table, sortie)
  readr::write_rds(normalise$exclusions,
                   sub("\\.rds$", "_exclusions.rds", sortie))

  normalise$table
}
