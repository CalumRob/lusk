# theme_economie ---------------------------------------------------------------
# Le module du thème Économie/Emploi (issue #96, gate A) : le descripteur
# LÉGER theme_economie() que la machinerie partagée (download/compute/publish)
# consomme sans jamais nommer le thème — la même forme de contrat que
# theme_demographie() (issue #13) et theme_habitat() (issue #17).
#
# Ce qui vit ici, ce qui ne vit pas ici :
#   - le manifeste CONCATÉNÉ du thème : les quatre fragments par source
#     (SIRENE régional, Flores A38/A88, RP Emploi, RP Chômage), chacun gardant
#     SON contrat, SON vintage, SA référence et SA publication — AUCUN
#     alignement de date entre sources ;
#   - la construction des données : les QUATRE builders de sources (les
#     normalisateurs des fragments) assemblés en une liste nommée ;
#   - le builder de vintages (la projection générique depuis le manifeste,
#     vintages_depuis_manifest, vintage.R) ;
#   - le SEAM de calcul de T8 : construire_analytiques_economie enchaîne les
#     builders analytiques des T1-T5 (analytics_economie_{lq,lq_flores,green,
#     dormitory,chomage}), les rangs-en-contexte de T6 (analytics_economie_
#     ranks) et l'agrégation au niveau des territoires (issue #131 —
#     analytics_economie_territoires.R) — le seam ne CALCULE RIEN lui-même,
#     les indicateurs vivent dans les T1-T5 (MUST NOT du plan) ;
#   - le SEAM de publication de T8 : publier_economie, STUB — T8 câble la
#     publication du payload Économie ; tant qu'il n'est pas livré, un appel
#     échoue fort (jamais un « under construction » silencieux).
# Ce qui N'y vit PAS : aucun calcul d'indicateur (T1-T5), aucune publication
# (T8), aucun alignement de dates, aucune modification de
# theme_demographie/theme_habitat.

# MANIFEST_ECONOMIE ------------------------------------------------------------
# Le manifeste du thème : les QUATRE fragments concaténés (la convention des
# fragments par source, issue #13) — une ligne par source, jamais de doublon de
# cache. Chaque source garde son vintage : SIRENE 2026-04 (référence
# 2026-03-31, publication 2026-05-01), Flores A38/A88 2024 (référence
# 2024-12-31, publication 2026-03-31), RP Emploi 2023 (référence 2023-01-01,
# publication 2026-06-30), RP Chômage 2023 (référence 2023-01-01, publication
# 2026-07-15). Le référentiel partagé « epci » n'est PAS une source Économie :
# la base des EPCI bretonne est la ressource transversale que les
# normalisateurs lisent dans le cache partagé (déclarée par les manifestes
# Démographie/Habitat) — jamais re-déclarée ici.
MANIFEST_ECONOMIE <- dplyr::bind_rows(
  MANIFEST_ECONOMIE_SIRENE,
  MANIFEST_ECONOMIE_FLORES,
  MANIFEST_ECONOMIE_RP,
  MANIFEST_ECONOMIE_CHOMAGE
)

# construire_donnees_economie --------------------------------------------------
# L'acte « trouver la donnée » du thème : les quatre builders de sources —
# chacun décompresse son cache, normalise, persiste SA table sous
# data/processed/economie/ (idempotent, comme les builders des sources) — et
# assemble les tables normalisées en UNE liste nommée (la forme que le chaînon
# analytique et T8 consomment). Les builders gardent leurs signatures et leurs
# sorties ; l'assembleur ne ré-implémente RIEN. Le référentiel EPCI partagé est
# lu par les builders dans le cache (lire_epci), comme dans la phase
# source-table (test-run-economie-contracts.R) — pas une source du thème.
construire_donnees_economie <- function(cache = "data/raw") {
  flores <- construire_donnees_brut_flores(cache = cache)

  list(
    sirene_snapshot = construire_sirene_normalise(cache = cache),
    flores_a38 = flores$flores_a38$table,
    flores_a88 = flores$flores_a88$table,
    rp_emploi = construire_donnees_brut_emploi_rp(cache = cache)$table,
    rp_chomage = construire_donnees_brut_chomage(cache = cache)$table
  )
}

# vintages_economie ------------------------------------------------------------
# Le builder de vintages du thème : la projection générique depuis le manifeste
# (vintages_depuis_manifest, vintage.R) — chaque source garde SA référence et
# SA publication, AUCUN alignement (les sources RP sœurs rp_emploi / rp_chomage
# partagent le millésime 2023 mais pas la publication : 2026-06-30 vs
# 2026-07-15).
vintages_economie <- function() {
  vintages_depuis_manifest(MANIFEST_ECONOMIE)
}

# construire_analytiques_economie ----------------------------------------------
# LE seam de calcul de T8 : le chaînon analytique complet T1→T6 + l'agrégation
# au niveau des territoires (issue #131). Il enchaîne les builders EXISTANTS —
# jamais un calcul dans l'assembleur (les indicateurs vivent dans les T1-T5,
# MUST NOT du plan) :
#   - T1 la LQ continue (SIRENE, analytics_economie_lq.R) ;
#   - T2 la LQ d'emploi (Flores, les DEUX grains natifs A88 et A38, jamais
#     fusionnés — analytics_economie_lq_flores.R ; A88 est le grain livré) ;
#   - T3 le score vert (SIRENE × EGSS, analytics_economie_green.R) ;
#   - T4 le ratio dortoir (Flores A88 × RP Emploi, analytics_economie_
#     dormitory.R) — PARKED (2026-08-06) : aucun artefact de payload, sa
#     perspective lieu de travail ressuscite l'indicateur « Taille » ;
#   - T5 le chômage (RP Chômage, analytics_economie_chomage.R) ;
#   - T6 les rangs-en-contexte des tables analytiques — les artefacts
#     *_rangs.rds (analytics_economie_ranks.R) ;
#   - l'AGRÉGATION (analytics_economie_territoires.R) : les tables communales
#     → les tables du payload aux quatre niveaux (effectifs/chomage/eco
#     RECALCULÉS depuis les parties, jamais une moyenne de parts) + les lignes
#     d'Histoire multi-niveaux (top-5, LQ même-échelle, présence régionale).
# `donnees` est la liste nommée de construire_donnees_economie ; `base_epci`
# la base des EPCI (la forme de lire_epci : CODGEO/EPCI/DEP) ; `artefact` la
# liste EGSS épinglée (artefact_egss) que T3 consomme. Retourne la liste des
# tables analytiques — la forme de test et l'entrée du seam de publication de
# T8.
construire_analytiques_economie <- function(donnees, base_epci, artefact,
                                            sortie = "data/processed/economie") {
  # T1 — la LQ continue (SIRENE) : lq + histoires + matrice M + suppression
  lq <- construire_analytique_lq_economie(donnees$sirene_snapshot, sortie = sortie)
  # T2 — la LQ d'emploi (Flores, les deux grains natifs)
  lq_emploi_a88 <- construire_analytique_lq_flores(donnees$flores_a88, "A88",
                                                   sortie = sortie)
  lq_emploi_a38 <- construire_analytique_lq_flores(donnees$flores_a38, "A38",
                                                   sortie = sortie)
  # T3 — le score vert (SIRENE × EGSS) + son rapport de suppression
  eco <- construire_eco_activites_economie(donnees$sirene_snapshot, artefact)
  persister_eco_activites_economie(eco, sortie = sortie)
  # T4 — le ratio dortoir (Flores A88 × RP Emploi) + son rapport de suppression
  dortoir <- construire_dortoir_economie(donnees$flores_a88, donnees$rp_emploi)
  persister_dortoir_economie(dortoir, sortie = sortie)
  # T5 — le chômage (RP Chômage) + son rapport de suppression
  chomage <- construire_chomage_economie(donnees$rp_chomage)
  persister_chomage_economie(chomage, sortie = sortie)
  # T6 — les rangs-en-contexte (les artefacts *_rangs.rds)
  rangs <- construire_rangs_analytiques_economie(
    lq$lq, lq_emploi_a88$lq, eco$table, chomage$table,
    base_epci, sortie = sortie
  )
  # Issue #131 — la « Taille » : le total effectifs salariés au lieu de travail
  # (Flores A88), l'agrégation du dortoir ressuscitée (workplace), commune par
  # commune — la matière de l'indicateur et de son agrégation par niveau.
  effectifs <- dplyr::transmute(dortoir$table, commune,
                                effectifs_salaries = workplace)
  # L'agrégation au niveau des territoires : les trois indicateurs aux quatre
  # niveaux (recalculés depuis les parties) + les lignes d'Histoire.
  agregats <- construire_territoires_agregats_economie(
    effectifs, eco$table, chomage$table, rangs$lq, base_epci
  )

  list(
    lq = rangs$lq,
    histoires_lq = lq$histoires,
    m = lq$m,
    lq_emploi_a88 = rangs$lq_emploi,
    lq_emploi_a38 = lq_emploi_a38$lq,
    eco_activites = rangs$eco,
    dortoir = dortoir$table,
    chomage = rangs$chomage,
    effectifs = effectifs,
    effectifs_territoires = agregats$effectifs,
    chomage_territoires = agregats$chomage,
    eco_territoires = agregats$eco,
    histoires = agregats$histoires
  )
}

# publier_economie -------------------------------------------------------------
# LE seam de publication de T8 : le chaînon analytique T1-T6 → payload →
# publish, câblé par T8 (plan economie-analytical-phase, todo 8). Il consomme
# la MÊME machinerie partagée que theme_demographie/theme_habitat —
# squelette_territoires (la référence), assembler_indicateurs (la forme du
# contrat), validate_payload (le garde-fou) et publish (le backend "static"
# par défaut) — avec les pièces du thème : les artefacts analytiques T6
# classés (les rangs-en-contexte viennent de T6, jamais recalculés ici) et la
# table déclarative INDICATEURS_ECONOMIE (les estampilles T7).
# run_pipeline(theme = theme_economie()) route par ce seam (issue #97) ; les
# thèmes classiques gardent compute_payload + publish, inchangés.

# INDICATEURS_ECONOMIE ---------------------------------------------------------
# La table déclarative des indicateurs du thème (issue #9/#97) : chaque clé du
# payload y est déclarée avec sa source de référence (l'id du manifeste qui
# l'estampille — les vintages T7) et sa multiplicité. Issue #131 (reshape du
# payload, décisions 2026-08-06) : le bloc est REDUIT à trois clés — « Taille »
# (effectifs_salaries, Flores A88), « santé » (chomage, RP Chômage), « verdure »
# (eco_activites, SIRENE × EGSS) — toutes à une ligne PAR TERRITOIRE
# (commune / EPCI / département / région : les agrégats sont recalculés depuis
# les parties, jamais une moyenne de parts). `lq` et `lq_emploi` QUITTENT le
# bloc : la matrice reste un artefact interne (data/processed/economie/),
# jamais publiée ; le Story top-5 porte les quelques nombres par territoire.
INDICATEURS_ECONOMIE <- tibble::tibble(
  key = c("effectifs_salaries", "chomage", "eco_activites"),
  libelle = c(
    "Effectifs salariés (lieu de travail)",
    "Chômage (population active)",
    "Part des éco-activités"
  ),
  sources = list(
    "flores_a88",
    "rp_chomage",
    "sirene_snapshot"
  ),
  source_reference = c("flores_a88", "rp_chomage", "sirene_snapshot"),
  multiplicite = c(1L, 1L, 1L)
)

# APERCU_ECONOMIE ---------------------------------------------------------------
# La table déclarative des clés de l'Aperçu du thème (issue #32, ADR-0007) :
# VIDE — le gating par thème. L'Économie ne déclare aucune clé aujourd'hui :
# ses stats de base de l'Aperçu n'existent pas encore, la table `apercu` du
# payload d'un run Économie est présente mais vide (jamais un « under
# construction »).
APERCU_ECONOMIE <- tibble::tibble(
  key = character(),
  libelle = character(),
  multiplicite = integer()
)

# construire_territoires_economie ----------------------------------------------
# La table des territoires du thème : le squelette PARTAGÉ (squelette_territoires,
# compute.R) — communes/EPCIs/départements/région avec les noms réels de la
# base des EPCI (lire_epci), la règle de pluralité départementale — avec le
# POIDS du thème : le nombre total d'établissements actifs par commune (la
# mesure signature SIRENE, comme Démographie pèse par la population et Habitat
# par les logements).
construire_territoires_economie <- function(base_epci, analytiques) {
  poids <- analytiques$lq %>%
    dplyr::select(commune, n_c) %>%
    dplyr::distinct()
  communes <- base_epci %>%
    dplyr::transmute(
      code = CODGEO, nom = LIBGEO, departement = DEP,
      epci = EPCI, nom_epci = LIBEPCI
    ) %>%
    dplyr::left_join(poids, by = c("code" = "commune")) %>%
    dplyr::mutate(n_c = dplyr::coalesce(n_c, 0))
  squelette_territoires(communes, poids = "n_c")
}

# construire_indicateurs_economie ----------------------------------------------
# Les trois indicateurs publiés du thème (issue #131) : UNE ligne par
# territoire (commune / EPCI / département / région), la valeur d'un agrégat
# RECALCULÉE depuis les parties communales (jamais une moyenne de parts — les
# tables agrégées de construire_territoires_agregats_economie). L'assemblage
# réutilise la MACHINERIE PARTAGÉE telle quelle :
#   - compute_ranks(territoires, tables) : les rangs-en-contexte par niveau
#     entre pairs (commune dans son EPCI, EPCI dans son département, département
#     dans la région — groupes_comparaison, compute.R) ;
#   - assembler_indicateurs : la forme du contrat (rangs + estampilles T7
#     depuis INDICATEURS_ECONOMIE + vintages).
# Les tables sont ALIGNÉES sur la référence (left_join sur les codes de
# territoires) : un territoire sans donnée porte NA — jamais une ligne
# manquante (la multiplicité 1 de la table déclarative l'exige).
construire_indicateurs_economie <- function(analytiques, territoires, vintages,
                                            directions = DIRECTIONS_ECONOMIE) {
  aligner <- function(table_agregee, key, unit) {
    dplyr::left_join(territoires["code"], table_agregee, by = "code") %>%
      dplyr::transmute(
        code = code, key = key, detail = NA_character_,
        value = value, unit = unit
      )
  }

  tables <- list(
    effectifs_salaries = aligner(analytiques$effectifs_territoires,
                                 "effectifs_salaries", "salariés"),
    chomage = aligner(analytiques$chomage_territoires, "chomage", "%"),
    eco_activites = aligner(analytiques$eco_territoires, "eco_activites", "%")
  )

  rangs <- compute_ranks(territoires, tables, scalaires = list(),
                         directions = directions)

  assembler_indicateurs(territoires, tables, rangs, theme = "economie",
                        indicateurs_table = INDICATEURS_ECONOMIE,
                        vintages = vintages)
}

# compute_histoires_economie ---------------------------------------------------
# L'Histoire du thème (issue #131, décision 2026-08-06 — thème à Story UNIQUE,
# ADR-0002 : le pool de saillance se réduit à un défaut toujours allumé).
# Le top-5 multi-lignes (une ligne par rang de la lecture « ce que la commune
# abrite » — calculé par construire_histoires_economie_payload, LQ à référence
# même-échelle pour les agrégats — et de la lecture régionale « ce que la
# Bretagne abrite », présence n + part du parc) est REPLIÉ en UNE ligne par
# (territoire, story_key) : les paramètres plats top1_*..top5_* (issue #312 —
# l'identité (territoire × groupe) est unique, jamais le top-5 comme autant de
# lectures). Le Story dortoir est PARKED : aucune colonne
# classification/ratio/workplace/resident ne part dans le payload.
# Issue #74 : les Stories portent leurs estampilles vintage — les DEUX
# lectures sourcent le snapshot SIRENE (la LQ et la structure régionale sont
# toutes deux la matière du parc des établissements) : chaque ligne est
# estampillée du vintage de SA source de référence, comme les indicateurs.
compute_histoires_economie <- function(analytiques, vintages) {
  sirene <- vintages %>%
    dplyr::filter(id == "sirene_snapshot")
  if (nrow(sirene) != 1) {
    stop("compute_histoires_economie : la source de référence « sirene_snapshot » ",
         "est absente des vintages — les Stories ne peuvent pas être estampillées.",
         call. = FALSE)
  }

  tampon <- sirene %>%
    dplyr::transmute(
      vintage_source = source,
      vintage_version = version,
      vintage_date_reference = date_reference,
      vintage_date_publication = date_publication
    )

  dplyr::bind_cols(
    # Issue #312 : le top-5 multi-lignes devient la MATIÈRE d'une lecture par
    # (territoire, story_key) — les paramètres plats top1_*..top5_* (jamais le
    # top-5 comme autant de lectures dans le payload, l'identité (territoire ×
    # groupe) est unique, parent #308)
    replier_top5_en_lecture(analytiques$histoires) %>%
      dplyr::mutate(theme = "economie"),
    tampon
  )
}

# construire_apercu_economie ---------------------------------------------------
# Les stats de base de l'onglet Aperçu (ADR-0007) : AUCUNE aujourd'hui — le
# gating par thème (APERCU_ECONOMIE vide). Retourne la liste vide ; la table
# `apercu` du payload reste présente et vide (la forme du contrat).
construire_apercu_economie <- function(territoires) {
  list()
}

# validations_economie ---------------------------------------------------------
# Les vérifications de valeur propres au thème (point 7) : déclarées ici,
# exécutées par validate_payload() après ses vérifications génériques.
validations_economie <- list(
  # le chômage est une part dans [0, 1] (une valeur NA — territoire sans taux
  # calculable — est un cas légitime, jamais une corruption)
  function(payload) {
    tx <- payload$indicateurs$value[payload$indicateurs$key == "chomage"]
    if (any(!is.na(tx) & (tx < 0 | tx > 1))) {
      stop("Payload invalide : un taux de chômage hors [0, 1].",
           call. = FALSE)
    }
    invisible(payload)
  },
  # la part des éco-activités est une part dans [0, 1]
  function(payload) {
    pe <- payload$indicateurs$value[payload$indicateurs$key == "eco_activites"]
    if (any(!is.na(pe) & (pe < 0 | pe > 1))) {
      stop("Payload invalide : une part d'éco-activités hors [0, 1].",
           call. = FALSE)
    }
    invisible(payload)
  },
  # les effectifs salariés sont un total non négatif (une valeur NA — cellule
  # non diffusée d'une commune, somme d'un niveau incomplète — est légitime)
  function(payload) {
    ef <- payload$indicateurs$value[
      payload$indicateurs$key == "effectifs_salaries"]
    if (any(!is.na(ef) & ef < 0)) {
      stop("Payload invalide : des effectifs salariés négatifs.",
           call. = FALSE)
    }
    invisible(payload)
  }
)

# construire_payload_economie --------------------------------------------------
# L'assembleur du payload du thème : les quatre tables du contrat (la forme
# d'compute_payload, compute.R) — indicateurs (avec rangs T6 + estampilles T7),
# histoires (story_key ADR-0002), territoires (référence partagée) et apercu
# (vide — gating). Validé par la validation GÉNÉRIQUE avec les tables
# déclaratives du thème — un payload invalide s'arrête là.
construire_payload_economie <- function(analytiques, base_epci, vintages) {
  territoires <- construire_territoires_economie(base_epci, analytiques)

  payload <- list(
    indicateurs = construire_indicateurs_economie(
      analytiques, territoires, vintages,
      directions = DIRECTIONS_ECONOMIE
    ),
    # Issue #312 : la lecture résolue par (territoire, groupe) — le top-5
    # replié en paramètres, le groupe de fiche et la raison de saillance
    # portés par la résolution partagée (resoudre_histoires)
    histoires = resoudre_histoires(
      compute_histoires_economie(analytiques, vintages), "economie"),
    territoires = reference_territoires(territoires),
    apercu = assemble_apercu(territoires, construire_apercu_economie(territoires))
  )

  validate_payload(payload,
                   indicateurs = INDICATEURS_ECONOMIE,
                   vintages = vintages,
                   validations = validations_economie,
                   apercu = APERCU_ECONOMIE)
  payload
}

# publier_economie ---------------------------------------------------------------
# Le seam de publication du thème, câblé par T8 : lit le référentiel partagé
# (base_epci du cache), enchaîne le calcul analytique T1-T6 (construire_analytiques
# — les artefacts *_rangs.rds sont régénérés sous data/processed/economie/),
# assemble le payload, le valide et le publie via la machinerie PARTAGÉE
# publish (backend "static" par défaut — parquet + projections JSON + vintages).
# Retourne le payload, comme run_pipeline l'attend.
publier_economie <- function(donnees, cache = "data/raw", vintages = NULL,
                             sortie = "public/data",
                             sortie_analytiques = file.path(dirname(cache),
                                                            "processed", "economie")) {
  if (is.null(vintages)) vintages <- vintages_economie()

  base_epci <- lire_epci(file.path(cache, "extracted", "EPCI_au_01-01-2025.xlsx"))
  analytiques <- construire_analytiques_economie(donnees, base_epci,
                                                 artefact_egss(),
                                                 sortie = sortie_analytiques)
  payload <- construire_payload_economie(analytiques, base_epci, vintages)
  publish(payload, sortie)
  payload
}

# MEMBRES_DESCRIPTEUR_ECONOMIE -------------------------------------------------
# Les membres requis du descripteur — le contrat de FORME du thème (ce que la
# machinerie partagée consomme : theme, manifest, vintages, construire_donnees
# — et ce que T8 branche : construire_analytiques, publier). La même idée que
# les contrats de manifeste des fragments (verifier_contrat_flores, ...) :
# un descripteur incomplet échoue FORT, en nommant le membre fautif.
MEMBRES_DESCRIPTEUR_ECONOMIE <- c(
  "theme", "manifest", "vintages", "construire_donnees",
  "construire_analytiques", "publier", "metadata"
)

# verifier_descripteur_economie -------------------------------------------------
# La validation de FORME du descripteur : tout membre requis manquant fait
# échouer la validation bruyamment, en nommant le membre fautif. Exécutée par
# theme_economie() sur son propre résultat (la construction échoue si le
# descripteur est cassé) et par les tests sur des fixtures négatives.
verifier_descripteur_economie <- function(descripteur) {
  manquants <- setdiff(MEMBRES_DESCRIPTEUR_ECONOMIE, names(descripteur))
  if (length(manquants) > 0) {
    stop("Descripteur Économie invalide — membre(s) requis manquant(s) : ",
         paste(manquants, collapse = ", "), ".", call. = FALSE)
  }
  invisible(TRUE)
}

# DIRECTIONS_ECONOMIE ----------------------------------------------------------
# La désirabilité par clé (ADR-0015, l'audit ordinal de l'issue #368) — AUCUNE
# clé ne se repose sur le défaut high-is-good : le chômage est low-is-good (la
# plus petite valeur est la meilleure — la machinerie du payload la consomme
# dans construire_indicateurs_economie, corrigeant le défaut silencieux qui
# classait le chômage high) ; les effectifs salariés et la part des
# éco-activités sont high-is-good (explicites). La constante est la SOURCE
# UNIQUE : le descripteur (theme_economie) et la machinerie de rangs
# (construire_indicateurs_economie / construire_payload_economie) la
# consomment — jamais un appel à theme_economie() depuis un builder (le graphe
# targets ne peut pas suivre le cycle descriptor → builder → descriptor).
DIRECTIONS_ECONOMIE <- list(
  effectifs_salaries = "high",
  chomage = "low",
  eco_activites = "high"
)

# theme_economie ---------------------------------------------------------------
# Le descripteur du thème Économie/Emploi : la même forme de contrat que
# theme_demographie() / theme_habitat(), avec les pièces du thème. Le
# descripteur est validé à la construction (verifier_descripteur_economie) :
# un membre manquant échoue là où il est construit, jamais plus tard dans la
# machinerie.
theme_economie <- function() {
  descripteur <- list(
    theme = "economie",
    manifest = MANIFEST_ECONOMIE,
    vintages = vintages_economie,
    construire_donnees = construire_donnees_economie,
    construire_analytiques = construire_analytiques_economie,
    publier = publier_economie,
    # la désirabilité par clé — la constante DIRECTIONS_ECONOMIE (l'audit
    # ordinal de l'issue #368 : aucune clé ne se repose sur le défaut
    # high-is-good, le chômage est low-is-good)
    directions = DIRECTIONS_ECONOMIE,
    # Issue #311 : les métadonnées du thème (le fichier épinglé
    # inst/extdata/theme-metadata/) — publiées par run_pipeline après le
    # payload, jamais un recompute des tables de faits
    metadata = function() lire_theme_metadata("economie")
  )
  verifier_descripteur_economie(descripteur)
  descripteur
}
