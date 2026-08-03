# manifest_habitat_dvf ---------------------------------------------------------
# Le fragment de la source Habitat « DVF géolocalisées » (Etalab) — la
# deuxième source du thème Habitat (issue #15). Convention de la vague 2 :
# chaque source Habitat vit dans SON fragment (DVF ici ; RP Logements et DPE
# dans d'autres tickets), portant SON manifeste et SA construction de données.
# Le module theme_habitat() assemblera les trois fragments quand le thème sera
# complet. Comme theme_demographie(), ce fichier ne touche pas à la machinerie
# partagée (download/compute/publish) : il la consomme.

# Le manifeste ---------------------------------------------------------------
# Un fichier par département par année, pour CHAQUE année de la fenêtre
# glissante (2021-2025 aujourd'hui ; docs/research/dvf.md §3.1). Le cache
# idempotent accumule les années à chaque livraison semestrielle (§5) : la
# série ne rétrécit jamais, le manifeste liste donc toutes les années de la
# fenêtre. À la prochaine livraison (octobre 2026, qui ajoute 2026), on élargit
# ANNEE_DVF et on relance — le manifeste reste construit par programme
# (expand_grid année x département), donc auditable ligne à ligne.
# Deux dates par source (point 5) :
#   - date_reference   : la période couverte par le millésime (fin d'année).
#   - date_publication : la livraison qui a régénéré les fichiers départementaux
#     géolocalisées (vérifié le 2026-08-03, docs/research/dvf.md §5).
# Mode et type (issues #8/#13) : « manuel » — premiers runs lourds, le cron les
# saute et les enregistre « à traiter à la main » (ADR-0004) — et « fichier » —
# URL -> fichier, intégrité vérifiée (verifier_fichier traite le .gz comme un
# non-zip : existe + non vide).

NOMS_DEPARTEMENTS_DVF <- c(
  "22" = "Côtes-d'Armor", "29" = "Finistère",
  "35" = "Ille-et-Vilaine", "56" = "Morbihan"
)

# La fenêtre glissante des millésimes DVF — 2021-2025 aujourd'hui ; élargie à
# 2026 à la livraison d'octobre 2026.
ANNEE_DVF <- 2021:2025

# La livraison qui a régénéré les fichiers départementaux géolocalisées
# (docs/research/dvf.md §5 — CSVs régénérés le 2026-05-18).
DATE_PUBLICATION_DVF <- "2026-05-18"

construire_manifest_dvf <- function(annees = ANNEE_DVF,
                                    deps = DEPT_BRETAGNE) {
  tidyr::expand_grid(annee = annees, dep = deps) %>%
    dplyr::mutate(
      id = paste0("dvf_", annee, "_dep", dep),
      source = "Etalab — DVF géolocalisées",
      url = paste0("https://files.data.gouv.fr/geo-dvf/latest/csv/",
                   annee, "/departements/", dep, ".csv.gz"),
      fichier = paste0(id, ".csv.gz"),
      vintage = as.character(annee),
      date_reference = paste0(annee, "-12-31"),
      date_publication = DATE_PUBLICATION_DVF,
      licence = "lov2",
      note = paste0(
        "Transactions immobilières géolocalisées — millésime ", annee,
        ", département ", dep, " (", NOMS_DEPARTEMENTS_DVF[dep],
        "), 40 colonnes dont latitude/longitude (centre de parcelle)"
      ),
      mode = "manuel",
      type = "fichier"
    ) %>%
    dplyr::select(id, source, url, fichier, vintage, date_reference,
                  date_publication, licence, note, mode, type)
}

MANIFEST_HABITAT_DVF <- construire_manifest_dvf()

# Le reshape ---------------------------------------------------------------
# Des fichiers bruts — une ligne par local/parcelle d'une mutation, le prix
# répété sur chaque ligne (notice DGFiP §4) — vers la table des transactions
# traitée : UNE ligne par mutation, la Bretagne, codée commune 5 chiffres
# (docs/research/dvf.md §6.3 et §7 — dédupliquer AVANT d'agréger l'argent).
# Les règles (docs/themes/habitat.md, issue #15) :
#   1. nature_mutation = "Vente" (match exact — VEFA, adjudications,
#      expropriations et échanges tombent ; la VEFA déforme le prix/m², §6.6) ;
#   2. code_type_local 1 (maison) ou 2 (appartement) — les dépendances (3) et
#      les locaux industriels/commerciaux (4) tombent ;
#   3. lignes sans prix ou sans surface bâtie jetées (les valeurs manquantes
#      sont réelles, §6.5 — les parcelles seules n'ont ni local ni prix/m²) ;
#   4. dédupe par id_mutation : le prix est pris UNE fois, jamais compté deux
#      fois. La surface bâtie est sommée sur les locaux DISTINCTS de la
#      mutation (distincts par id_parcelle x code_type_local x surface) : le
#      même local répété pour 2 natures de culture ne compte qu'une fois, mais
#      deux locaux identiques sur deux parcelles comptent deux fois. Le type
#      porté par la ligne est le type DOMINANT — celui qui porte la plus grande
#      surface bâtie distincte (une mutation mêlant maison et appartement est
#      rare ; la règle est déterministe et documentée). n_locaux compte les
#      locaux distincts — la preuve de la dédupe.
#   5. la table garde le code commune 5 chiffres (COG, jamais le code postal —
#      §7) et dérive l'année (de date_mutation ISO-8601) et le département (des
#      2 premiers chiffres du code commune — la garde Bretagne de l'assemblage).

# lire_transactions_dvf -------------------------------------------------------
# Lit un fichier DVF géolocalisées (40 colonnes, docs/research/dvf.md §3.2).
# Tout en caractère : le fichier est un CSV de déclarations, les valeurs
# manquantes sont réelles. readr décompresse le .csv.gz transparentement.
lire_transactions_dvf <- function(chemin) {
  readr::read_csv(
    chemin,
    col_types = readr::cols(.default = readr::col_character()),
    show_col_types = FALSE, progress = FALSE
  )
}

# nettoyer_transactions_dvf ---------------------------------------------------
# Le cœur du reshape, pur : une table au schéma du fichier brut (40 colonnes)
# en entrée, la table des transactions traitée en sortie. Testé sur la forme
# réelle (le fixture reproduit l'en-tête), jamais contre le réseau.
nettoyer_transactions_dvf <- function(transactions) {
  # filtres (1-3) : Vente, maison/appartement, prix et surface renseignés
  locaux <- transactions %>%
    dplyr::filter(
      nature_mutation == "Vente",
      code_type_local %in% c("1", "2"),
      !is.na(valeur_fonciere), !is.na(surface_reelle_bati)
    ) %>%
    dplyr::mutate(
      valeur_fonciere = as.numeric(valeur_fonciere),
      surface_reelle_bati = as.numeric(surface_reelle_bati)
    ) %>%
    dplyr::filter(valeur_fonciere > 0, surface_reelle_bati > 0)

  # les locaux distincts de chaque mutation — la clé de la dédupe (4) : le même
  # local apparaît sur plusieurs lignes (natures de culture), il ne compte
  # qu'une fois dans la surface ; deux parcelles distinctes comptent deux fois
  distincts <- locaux %>%
    dplyr::select(id_mutation, id_parcelle, code_type_local,
                  surface_reelle_bati) %>%
    dplyr::distinct()

  # le type dominant de la mutation : celui qui porte la plus grande surface
  # bâtie distincte (règle déterministe — la première ligne en cas d'égalité)
  type_dominant <- distincts %>%
    dplyr::group_by(id_mutation, code_type_local) %>%
    dplyr::summarise(surface_type = sum(surface_reelle_bati), .groups = "drop") %>%
    dplyr::group_by(id_mutation) %>%
    dplyr::slice_max(surface_type, n = 1, with_ties = FALSE) %>%
    dplyr::mutate(
      type_local = dplyr::recode(code_type_local,
                                 "1" = "maison", "2" = "appartement")
    ) %>%
    dplyr::select(id_mutation, type_local)

  mutations <- distincts %>%
    dplyr::group_by(id_mutation) %>%
    dplyr::summarise(
      surface_reelle_bati = sum(surface_reelle_bati),
      n_locaux = dplyr::n(),
      .groups = "drop"
    ) %>%
    dplyr::left_join(type_dominant, by = "id_mutation")

  # les attributs de la mutation sont identiques sur toutes ses lignes (le prix
  # est répété, notice DGFiP §4) — on prend la première
  attributs <- locaux %>%
    dplyr::group_by(id_mutation) %>%
    dplyr::summarise(
      code_commune = dplyr::first(code_commune),
      date_mutation = dplyr::first(date_mutation),
      valeur_fonciere = dplyr::first(valeur_fonciere),
      .groups = "drop"
    )

  attributs %>%
    dplyr::inner_join(mutations, by = "id_mutation") %>%
    dplyr::mutate(
      annee = substr(date_mutation, 1, 4),
      departement = substr(code_commune, 1, 2)
    ) %>%
    dplyr::select(id_mutation, code_commune, date_mutation, annee, departement,
                  type_local, valeur_fonciere, surface_reelle_bati, n_locaux)
}

# construire_transactions_dvf -------------------------------------------------
# L'acte « trouver la donnée » de la source : lit chaque fichier du manifeste
# dans le cache brut, assemble (bind_rows), nettoie, garde la Bretagne et
# persiste la table des transactions traitée (data/processed). Idempotent par
# construction : les fichiers du cache ne sont jamais relus tant qu'ils n'ont
# pas changé (download_sources gère le cache). `manifest` est paramétrable pour
# que les tests pointent un mini-manifeste sur des fixtures locales — jamais de
# réseau dans la boucle de test.
construire_transactions_dvf <- function(cache = "data/raw",
                                        sortie = "data/processed/transactions_dvf.rds",
                                        manifest = MANIFEST_HABITAT_DVF) {
  tables <- lapply(file.path(cache, manifest$fichier), lire_transactions_dvf)
  brut <- dplyr::bind_rows(tables)

  propres <- nettoyer_transactions_dvf(brut) %>%
    # la garde explicite du schéma (comme Démographie) : les fichiers sont par
    # département breton par construction, mais une ligne parasite (ou une
    # commune rattachée entre temps) ne doit jamais entrer dans la table
    filter_bretagne() %>%
    # tri déterministe : la sortie est stable d'un run à l'autre
    dplyr::arrange(code_commune, date_mutation, id_mutation)

  if (!dir.exists(dirname(sortie))) dir.create(dirname(sortie), recursive = TRUE)
  readr::write_rds(propres, sortie)
  propres
}
