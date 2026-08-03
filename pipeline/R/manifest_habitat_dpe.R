# manifest_habitat_dpe ----------------------------------------------------------
# La source Habitat ADEME DPE (issue #16) — le PREMIER type « api » du
# pipeline (issue #13) : pas une URL -> fichier, mais une fonction de pull
# paginée, mise en cache dans un .rds par tirer_api()/download_sources().
# La dataset : dpe03existant (logements existants depuis 07/2021), ~15,3 M de
# DPE en France, ~664 k en Bretagne (docs/research/ademe-dpe.md §2.4).
# L'API data-fair (vérifiée en direct le 2026-08-03, §2.2 et §7.1) :
#   https://data.ademe.fr/data-fair/api/v1/datasets/dpe03existant
#   /lines?size=1000&qs=code_departement_ban:<dd>&select=<champs>&after=<curseur>
# Pagination par le curseur `after` renvoyé dans `next` ; limites :
# ~600 requêtes/min anonyme — on dort delai = 0,2 s entre les pages.
# Un pull par département breton (4 lignes, mode « manuel » — premiers runs
# lourds, ADR-0004), une closure qui capture le code du département, un cache
# .rds par département (dpe_<dd>.rds). La vue publique exclut déjà les DPE
# désactivés (dpe_desactive = 0, filtre virtuel) — le pull ne sélectionne donc
# pas cette colonne ; le nettoyage (nettoyer_dpe.R) filtre défensivement si
# elle existe.

# URL_BASE_DPE ----------------------------------------------------------------
# La base de l'API data-fair de la dataset dpe03existant.
URL_BASE_DPE <- "https://data.ademe.fr/data-fair/api/v1/datasets/dpe03existant"

# CHAMPS_DPE ------------------------------------------------------------------
# La sélection LARGE des champs (spec #12, « broad data layer, narrow served
# payload » — principles.md §5) : identité et dates (les deux dates portées),
# étiquettes, logement (type_batiment, nombre_appartement, époque), géocodage,
# registre du bâtiment (id_rnb), enveloppe/isolation, conso/émissions,
# systèmes de chauffage. Noms exacts du schéma ADEME (docs/research/ademe-dpe.md
# §1.4, vérifiés en direct le 2026-08-03).
CHAMPS_DPE <- c(
  # identité et dates
  "numero_dpe", "date_etablissement_dpe", "date_reception_dpe",
  "date_visite_diagnostiqueur", "date_fin_validite_dpe",
  "date_derniere_modification_dpe", "numero_dpe_remplace",
  "numero_dpe_immeuble_associe", "modele_dpe", "version_dpe",
  # étiquettes
  "etiquette_dpe", "etiquette_ges",
  # logement
  "type_batiment", "annee_construction", "periode_construction",
  "typologie_logement", "surface_habitable_logement",
  "surface_habitable_immeuble", "nombre_appartement",
  "position_logement_dans_immeuble", "appartement_non_visite",
  # localisation / géocodage
  "adresse_ban", "numero_voie_ban", "nom_rue_ban", "nom_commune_ban",
  "code_postal_ban", "code_insee_ban", "code_departement_ban",
  "code_region_ban", "identifiant_ban",
  "coordonnee_cartographique_x_ban", "coordonnee_cartographique_y_ban",
  "score_ban", "statut_geocodage", "_geopoint",
  # registre du bâtiment
  "id_rnb", "provenance_id_rnb",
  # enveloppe / isolation
  "isolation_toiture", "qualite_isolation_enveloppe",
  "qualite_isolation_murs", "qualite_isolation_plancher_bas",
  "qualite_isolation_menuiseries", "ubat_w_par_m2_k",
  "zone_climatique", "classe_altitude",
  # consommation / émissions
  "conso_5_usages_ep", "conso_5_usages_par_m2_ep",
  "conso_chauffage_ep", "conso_ecs_ep",
  "emission_ges_5_usages", "emission_ges_5_usages_par_m2",
  "cout_total_5_usages",
  # systèmes
  "type_energie_principale_chauffage", "type_generateur_chauffage_principal",
  "type_installation_chauffage", "type_energie_principale_ecs",
  "type_ventilation", "type_generateur_froid", "presence_production_pv"
)

# page_dpe --------------------------------------------------------------------
# Une page de l'API data-fair : la requête httr2 (retry sur les erreurs
# transitoires — 429/5xx) et le corps JSON parsé. LE seam httr2 du pull : les
# tests le mockent, le réseau n'entre jamais dans la boucle de test.
page_dpe <- function(url) {
  httr2::request(url) |>
    httr2::req_retry(max_tries = 3) |>
    httr2::req_perform() |>
    httr2::resp_body_json()
}

# pull_departement -------------------------------------------------------------
# Le pull paginé d'un département : boucle `after` -> `next`, sélection large,
# respect des limites (delai entre les pages). Filtre DÉFENSIF sur le
# département en sortie : si le serveur ignorait qs (régression silencieuse),
# on ne cache pas la France entière — on garde les lignes du département par
# code_departement_ban, avec le repli code_insee_ban (préfixe 2 chiffres) pour
# les lignes sans code département (docs/research/ademe-dpe.md §7.3). Garde-fou
# anti-boucle : max_pages pages maximum, puis arrêt fort — un qs ignoré
# paginerait ~15 000 pages.
pull_departement <- function(departement, base = URL_BASE_DPE, taille = 1000L,
                             delai = 0.2, max_pages = 1000L) {
  select <- paste(CHAMPS_DPE, collapse = ",")
  url_page <- function(apres = NULL) {
    u <- paste0(base, "/lines?size=", taille,
                "&qs=code_departement_ban:", departement,
                "&select=", select)
    if (!is.null(apres)) u <- paste0(u, "&after=", apres)
    u
  }

  lignes <- list()
  apres <- NULL
  fini <- FALSE
  for (page in seq_len(max_pages)) {
    corps <- page_dpe(url_page(apres))
    lignes <- c(lignes, corps$results)
    if (is.null(corps$`next`)) {
      fini <- TRUE
      break
    }
    apres <- sub(".*after=", "", corps$`next`)
    Sys.sleep(delai)  # ~600 req/min anonyme : on reste large sous la limite
  }
  if (!fini) {
    stop("Pagination DPE interrompue après ", max_pages,
         " pages : le curseur `after` ne se termine pas (le filtre qs est-il ignoré ?).",
         call. = FALSE)
  }

  brut <- if (length(lignes) > 0) {
    # Le premier run réel (#22) : l'API data-fair ajoute `_score` (pertinence
    # de recherche) à chaque ligne — hors CHAMPS_DPE, NULL sur les requêtes par
    # filtre — et des champs DÉCLARÉS peuvent être NULL ligne à ligne (ex.
    # nombre_appartement). tibble::as_tibble() refuse une colonne NULL. Seuls
    # les champs DÉCLARÉS entrent dans le cache, dans l'ordre du manifeste ;
    # une valeur absente de l'API est portée en NA, jamais en colonne NULL.
    lignes <- lapply(lignes, function(ligne) {
      gardes <- ligne[intersect(names(ligne), CHAMPS_DPE)]
      gardes[lengths(gardes) == 0] <- NA
      gardes
    })
    dplyr::bind_rows(lapply(lignes, tibble::as_tibble))
  } else {
    # aucun DPE pour ce département : une table vide mais de forme stable
    tibble::as_tibble(stats::setNames(
      rep(list(logical(0)), length(CHAMPS_DPE)), CHAMPS_DPE
    ))
  }

  if (!all(c("code_departement_ban", "code_insee_ban") %in% names(brut))) {
    stop("Réponse data-fair incompréhensible : champs de localisation absents.",
         call. = FALSE)
  }

  brut %>%
    dplyr::filter(
      (code_departement_ban %in% departement) |
        (substr(code_insee_ban, 1, 2) %in% departement)
    )
}

# MANIFEST_HABITAT_DPE ---------------------------------------------------------
# La table des sources DPE vérifiées — une ligne par département breton
# (22 · 29 · 35 · 56). Mêmes colonnes que MANIFEST_DEMOGRAPHIE (le contrat du
# manifeste, issue #13) PLUS la colonne `pull` (une closure par ligne qui
# capture le code du département). Deux dates : date_reference et
# date_publication sont NA — la base DPE est ROULANTE (mise à jour
# hebdomadaire/mensuelle) : le vintage du thème est construit à partir de la
# date du pull (spec #12, « DPE (rolling base — date_reference NA,
# date_publication = pull date, version = pull date) ») par le module du thème,
# ticket ultérieur.
# Mode « manuel » (ADR-0004) : le premier run est lourd (~664 k DPE), le cron
# ne doit jamais tenter le pull tout seul (issue #12, user story 8).
MANIFEST_HABITAT_DPE <- tibble::tibble(
  id = c("dpe_22", "dpe_29", "dpe_35", "dpe_56"),
  source = rep(
    "ADEME — Observatoire DPE, logements existants (dpe03existant)",
    4
  ),
  url = rep(URL_BASE_DPE, 4),
  fichier = c("dpe_22.rds", "dpe_29.rds", "dpe_35.rds", "dpe_56.rds"),
  vintage = rep(NA_character_, 4),
  date_reference = rep(NA_character_, 4),
  date_publication = rep(NA_character_, 4),
  licence = rep("lov2", 4),
  note = rep(
    paste0(
      "Base ADEME dpe03existant (logements existants depuis 07/2021) — pull ",
      "paginé data-fair par code_departement_ban, champs larges, cache .rds ; ",
      "la vue publique exclut déjà les DPE désactivés ; base roulante, ",
      "vintage = date du pull"
    ),
    4
  ),
  mode = rep("manuel", 4),
  type = rep("api", 4),
  pull = list(
    function() pull_departement("22"),
    function() pull_departement("29"),
    function() pull_departement("35"),
    function() pull_departement("56")
  )
)

# lire_dpe_caches --------------------------------------------------------------
# Lit les caches .rds du manifeste (un par département) et les combine en une
# seule table brute — l'entrée du nettoyage. Échoue fort si un cache manque :
# une source manuelle jamais téléchargée doit être visible, pas silencieuse.
lire_dpe_caches <- function(cache = "data/raw", manifest = MANIFEST_HABITAT_DPE) {
  cibles <- file.path(cache, manifest$fichier)
  manquants <- cibles[!file.exists(cibles)]
  if (length(manquants) > 0) {
    stop("Cache DPE absent : ",
         paste(basename(manquants), collapse = ", "), ".", call. = FALSE)
  }
  dplyr::bind_rows(lapply(cibles, readRDS))
}

# construire_dpe_processe ------------------------------------------------------
# La construction des données du thème Habitat côté DPE : le seam du module
# du thème (construire_donnees) — lire les caches et nettoyer en table DPE
# processée (une ligne par logement-équivalent, nettoyer_dpe.R).
construire_dpe_processe <- function(cache = "data/raw") {
  nettoyer_dpe(lire_dpe_caches(cache))
}
