# normaliser_mobilite -----------------------------------------------------------
# Le lecteur et le normaliseur du snapshot porté de Mobilité (issue #137) :
# le CSV bretagne_mobility_super_dashboard_gravity.csv (une ligne par commune,
# ~2 061 colonnes — l'identité, les métriques d'accessibilité aux trois modes,
# les déciles, les signatures de densité, puis les MÊMES familles aux niveaux
# _epci/_dep/_reg déjà agrégés dans le fichier). Le portage EST le fichier :
# la table normalisée conserve TOUTES les colonnes — les tickets #138 (grille
# d'isolation + div_loss + Story), #139 (demande/réseaux) et #140 (sous-bloc)
# consommeront les familles directement depuis cette table.

# COLONNES_REQUISES_MOBILITE ----------------------------------------------------
# Les colonnes REQUISES du snapshot — la garde de forme du portage : l'identité
# (commune COG, nom, département, EPCI nommé) et la mesure signature du thème
# (nb_buildings — le nombre de bâtiments résidentiels analysés, la « Taille »).
# Toute colonne requise manquante (une vague qui change de structure) arrête
# la normalisation bruyamment — jamais un succès partiel silencieux.
COLONNES_REQUISES_MOBILITE <- c(
  "code_insee", "nom_commune", "code_departement_insee", "raison_sociale",
  "nb_buildings"
)

# MOTIF_NUMERIQUES_MOBILITE -----------------------------------------------------
# Le motif des colonnes NUMÉRIQUES du snapshot : tout ce qui n'est pas
# l'identité ou un libellé. Il couvre les familles métriques du dashboard —
# share_* (les parts d'accès), med_*/avg_* (les vulnérabilités), div_*/tot_*
# (les pertes de diversité et de volume), pct_iso_* (les parts isolées), les
# déciles *_dec_*, les parts par service dep_*/res_*, les rangs rank_*, les
# signatures de densité dens_* et la percentile régionale — aux TROIS niveaux
# (commune, _epci, _dep, _reg : le motif opère sur le nom complet). Tout le
# reste (region, raison_sociale, code_*, nom_commune, les libellés unique_*,
# les champs *_raw) reste en caractères — les codes ne sont JAMAIS devinés
# numériques.
MOTIF_NUMERIQUES_MOBILITE <- paste0(
  "^(nb_buildings|share_|med_|avg_|div_|tot_|pct_iso_|dep_|res_|rank_|dens_|",
  "region_percentile)"
)

# lire_snapshot_mobilite ---------------------------------------------------------
# Le lecteur du fichier réel. Tout en caractères : les codes (code_insee,
# code_departement_insee) ne doivent JAMAIS être devinés numériques (le « 29 »
# du département, le « 29011 » de la commune). La numérisation des métriques
# est l'affaire du normaliseur, jamais du lecteur. Non testé dans la boucle de
# test (comme lire_snapshot_sirene) : il lit le vrai fichier ; la
# normalisation, elle, est testée sur la forme réelle.
lire_snapshot_mobilite <- function(chemin) {
  readr::read_csv(
    chemin,
    col_types = readr::cols(.default = readr::col_character()),
    show_col_types = FALSE, progress = FALSE
  )
}

# normaliser_snapshot_mobilite ---------------------------------------------------
# La normalisation pure : un snapshot brut (tibble, une ligne par commune, tout
# en caractères) vers la table normalisée — l'identité vérifiée (la garde de
# forme) et les métriques numérisées. Les gardes s'ARRÊTENT bruyamment : le
# fichier porté est vérifié en production, toute déviation est une corruption,
# jamais une ligne silencieusement perdue. Retourne la table (la forme que
# construire_donnees_mobilite persiste et que le chaînon analytique consomme).
normaliser_snapshot_mobilite <- function(snapshot) {
  # 1. la garde de forme : les colonnes requises du portage
  manquantes <- setdiff(COLONNES_REQUISES_MOBILITE, names(snapshot))
  if (length(manquantes) > 0) {
    stop("Snapshot Mobilité corrompu — colonne(s) requise(s) manquante(s) : ",
         paste(manquantes, collapse = ", "), ".", call. = FALSE)
  }
  if (nrow(snapshot) == 0) {
    stop("Snapshot Mobilité corrompu — le fichier ne porte aucune ligne.",
         call. = FALSE)
  }

  # 2. l'identité : code INSEE COG 5 chiffres, département breton, nom présent
  if (any(!grepl("^[0-9]{5}$", snapshot$code_insee))) {
    stop("Snapshot Mobilité corrompu — un code_insee hors format COG ",
         "(5 chiffres).", call. = FALSE)
  }
  if (any(!snapshot$code_departement_insee %in% DEPT_BRETAGNE)) {
    stop("Snapshot Mobilité corrompu — un département hors Bretagne ",
         "(22/29/35/56).", call. = FALSE)
  }
  if (any(is.na(snapshot$nom_commune) | !nzchar(snapshot$nom_commune))) {
    stop("Snapshot Mobilité corrompu — une commune sans nom.", call. = FALSE)
  }

  # 3. la numérisation des métriques : une valeur qui refuse la conversion est
  # une corruption (une colonne métrique qui porte du texte), jamais une NA
  # silencieuse
  numeriques <- grepl(MOTIF_NUMERIQUES_MOBILITE, names(snapshot))
  table <- snapshot
  for (col in names(snapshot)[numeriques]) {
    converti <- suppressWarnings(as.numeric(table[[col]]))
    nouveaux_na <- is.na(converti) & !is.na(table[[col]])
    if (any(nouveaux_na)) {
      stop("Snapshot Mobilité corrompu — la colonne « ", col,
           " » porte des valeurs non numériques.", call. = FALSE)
    }
    table[[col]] <- converti
  }

  # 4. l'identité normalisée : la forme du contrat (commune / nom / departement
  # / epci_nom), triée par commune — déterministe
  table %>%
    dplyr::rename(
      commune = code_insee,
      nom = nom_commune,
      departement = code_departement_insee,
      epci_nom = raison_sociale
    ) %>%
    dplyr::arrange(commune)
}
