# theme_mobilite ---------------------------------------------------------------
# Le module du thème Mobilité (issue #137, tracer bullet) : le descripteur
# theme_mobilite() que la machinerie partagée (download/compute/publish)
# consomme sans jamais nommer le thème — la même forme de contrat que
# theme_economie() (issue #96) et theme_demographie()/theme_habitat().
#
# Ce qui vit ici, ce qui ne vit pas ici :
#   - le manifeste de la source : le snapshot PORTÉ de l'analyse
#     d'accessibilité « Vingt minutes sans voiture » (manifest_mobilite.R) —
#     UNE source, UNE ligne, la date d'instantané comme référence et la date
#     de portage comme publication ;
#   - la construction des données : la normalisation du snapshot porté (le
#     lecteur du CSV + le normaliseur : identité vérifiée, métriques
#     numérisées, la table complète des 2 061 colonnes conservée) ;
#   - le builder de vintages (la projection générique depuis le manifeste,
#     vintages_depuis_manifest, vintage.R) ;
#   - le SEAM de calcul : construire_analytiques_mobilite enchaîne la
#     table communale (la « Taille » du thème : nb_buildings) et l'agrégation
#     aux quatre niveaux (recalculée depuis les parties — jamais une moyenne).
#     C'est le TRACER BULLET : les 5 parts d'isolation, div_loss, la signature
#     de densité, la saillance et les rangs complets arrivent au ticket #138 ;
#   - le SEAM de publication : publier_mobilite — le payload contractuel
#     (territoires / indicateurs / histoires / apercu) publié par la
#     machinerie partagée publish.
# Ce qui N'y vit PAS : aucun calcul d'indicateur de la grille (ticket #138),
# aucune Story (ticket #138), aucun étage demande/réseaux (ticket #139), aucun
# sous-bloc (ticket #140), aucune modification de theme_demographie / theme_
# economie / theme_habitat ni du cœur partagé (compute.R, publish.R).

# construire_donnees_mobilite --------------------------------------------------
# L'acte « trouver la donnée » du thème : le lecteur lit le snapshot porté
# (le CSV du cache, une ligne par commune), le normaliseur le valide et le
# nettoie (identité vérifiée, métriques numérisées), et la table complète est
# persistée sous data/processed/mobilite/ (idempotent, comme les builders des
# sources). Le paramètre `snapshot` permet aux tests de passer la fixture
# directement : le chemin de code de normalisation et de persistance est le
# même que pour le fichier réel.
construire_donnees_mobilite <- function(cache = "data/raw",
                                        sortie = "data/processed/mobilite/mobilite_snapshot.rds",
                                        snapshot = NULL) {
  if (is.null(snapshot)) {
    snapshot <- lire_snapshot_mobilite(
      file.path(cache, MANIFEST_MOBILITE$fichier)
    )
  }

  table <- normaliser_snapshot_mobilite(snapshot)

  if (!dir.exists(dirname(sortie))) dir.create(dirname(sortie), recursive = TRUE)
  readr::write_rds(table, sortie)

  list(mobilite_snapshot = table)
}

# vintages_mobilite ------------------------------------------------------------
# Le builder de vintages du thème : la projection générique depuis le
# manifeste — une source, SA référence (l'instantané de l'analyse) et SA
# publication (le portage), jamais alignées.
vintages_mobilite <- function() {
  vintages_depuis_manifest(MANIFEST_MOBILITE)
}

# agreger_nb_buildings_territoires ---------------------------------------------
# La « Taille » du thème par niveau : le nombre de bâtiments résidentiels
# analysés (nb_buildings du snapshot porté). La table communale est déclinée
# aux QUATRE niveaux (commune / EPCI / département / région) en appliquant la
# règle d'agrégation décidée — la SOMME des parties, jamais une moyenne :
#   - commune : la valeur communale telle quelle ;
#   - EPCI : la somme des communes membres — les communes sans EPCI (les
#     îles, fix « Sans objet » #131) n'y entrent jamais ;
#   - département : la somme des communes du département ;
#   - région : la somme de toutes les communes.
# Une commune absente du snapshot (les deux non couvertes par l'analyse) n'a
# pas de ligne ici — l'alignement sur la référence du squelette se fait à
# l'assemblage du payload (la ligne existe avec NA, jamais une ligne manquante).
# Déterministe : trié par code.
agreger_nb_buildings_territoires <- function(communes, base_epci) {
  ctx <- communes %>%
    dplyr::left_join(base_epci[c("CODGEO", "EPCI", "DEP")],
                     by = c("commune" = "CODGEO"))

  dplyr::bind_rows(
    ctx %>%
      dplyr::select(commune, nb_buildings) %>%
      dplyr::rename(code = commune),
    ctx %>%
      dplyr::filter(!is.na(EPCI)) %>%
      dplyr::group_by(code = EPCI) %>%
      dplyr::summarise(nb_buildings = sum(nb_buildings), .groups = "drop"),
    ctx %>%
      dplyr::group_by(code = DEP) %>%
      dplyr::summarise(nb_buildings = sum(nb_buildings), .groups = "drop"),
    ctx %>%
      dplyr::summarise(code = "53",
                       nb_buildings = sum(nb_buildings), .groups = "drop")
  ) %>%
    dplyr::rename(value = nb_buildings) %>%
    dplyr::arrange(code)
}

# construire_analytiques_mobilite ----------------------------------------------
# LE seam de calcul : la table communale (la matière du poids du thème — le
# nombre de bâtiments analysés, comme Démographie pèse par la population et
# Économie par les établissements) et l'agrégation par niveau (la matière de
# l'indicateur du payload). Les artefacts sont persistés sous data/processed/
# mobilite/ (le dossier analytique du run). Le seam ne CALCULE RIEN lui-même
# (l'agrégation vit dans agreger_nb_buildings_territoires) — la grille
# d'isolation et la Story arrivent au ticket #138 dans ce même seam.
construire_analytiques_mobilite <- function(donnees, base_epci,
                                            sortie = "data/processed/mobilite") {
  # la garde de forme : le chaînon consomme la table normalisée du snapshot —
  # un input corrompu (une colonne requise manquante) s'arrête ICI, avant la
  # moindre écriture (jamais un succès partiel silencieux)
  snapshot <- donnees$mobilite_snapshot
  manquantes <- setdiff(c("commune", "nb_buildings"), names(snapshot))
  if (length(manquantes) > 0) {
    stop("construire_analytiques_mobilite : colonne(s) requise(s) manquante(s) ",
         "du snapshot porté : ", paste(manquantes, collapse = ", "),
         " — un input corrompu arrête le run avant payload partiel.",
         call. = FALSE)
  }

  mobilite_communes <- snapshot %>%
    dplyr::select(commune, nb_buildings)
  nb_buildings_territoires <- agreger_nb_buildings_territoires(
    mobilite_communes, base_epci
  )

  if (!dir.exists(sortie)) dir.create(sortie, recursive = TRUE)
  readr::write_rds(mobilite_communes, file.path(sortie, "mobilite_communes.rds"))
  readr::write_rds(nb_buildings_territoires,
                   file.path(sortie, "nb_buildings_territoires.rds"))

  list(
    mobilite_communes = mobilite_communes,
    nb_buildings_territoires = nb_buildings_territoires
  )
}

# INDICATEURS_MOBILITE ---------------------------------------------------------
# La table déclarative des indicateurs du thème (issue #9/#97) : chaque clé du
# payload y est déclarée avec sa source de référence (l'id du manifeste qui
# l'estampille — les vintages T7) et sa multiplicité. Le TRACER BULLET ne
# publie qu'UNE clé : « nb_buildings » (la « Taille » du thème — le nombre de
# bâtiments résidentiels analysés par commune, le poids du thème dans le
# squelette), une ligne PAR TERRITOIRE (commune / EPCI / département / région :
# les agrégats sont recalculés depuis les parties, jamais une moyenne de
# parts). La grille des 5 parts d'isolation arrive au ticket #138.
INDICATEURS_MOBILITE <- tibble::tibble(
  key = "nb_buildings",
  libelle = "Bâtiments résidentiels analysés",
  sources = list("mobilite_snapshot"),
  source_reference = "mobilite_snapshot",
  multiplicite = 1L
)

# APERCU_MOBILITE ---------------------------------------------------------------
# La table déclarative des clés de l'Aperçu du thème (issue #32, ADR-0007) :
# VIDE — le gating par thème. Mobilité ne déclare aucune clé aujourd'hui : la
# table `apercu` du payload d'un run Mobilité est présente mais vide (jamais
# un « under construction »).
APERCU_MOBILITE <- tibble::tibble(
  key = character(),
  libelle = character(),
  multiplicite = integer()
)

# construire_territoires_mobilite ----------------------------------------------
# La table des territoires du thème : le squelette PARTAGÉ (squelette_territoires,
# compute.R) — communes/EPCIs/départements/région avec les noms réels de la
# base des EPCI (lire_epci), la règle de pluralité départementale — avec le
# POIDS du thème : le nombre de bâtiments analysés par commune (nb_buildings du
# snapshot porté — la mesure signature de l'analyse d'accessibilité).
construire_territoires_mobilite <- function(base_epci, analytiques) {
  poids <- analytiques$mobilite_communes %>%
    dplyr::select(commune, nb_buildings)
  communes <- base_epci %>%
    dplyr::transmute(
      code = CODGEO, nom = LIBGEO, departement = DEP,
      epci = EPCI, nom_epci = LIBEPCI
    ) %>%
    dplyr::left_join(poids, by = c("code" = "commune")) %>%
    dplyr::mutate(nb_buildings = dplyr::coalesce(nb_buildings, 0))
  squelette_territoires(communes, poids = "nb_buildings")
}

# construire_indicateurs_mobilite ----------------------------------------------
# L'indicateur publié du tracer bullet : UNE ligne par territoire (commune /
# EPCI / département / région), la valeur d'un agrégat RECALCULÉE depuis les
# parties communales (jamais une moyenne de parts — la table agrégée de
# agreger_nb_buildings_territoires). L'assemblage réutilise la MACHINERIE
# PARTAGÉE telle quelle : compute_ranks (les rangs-en-contexte par niveau
# entre pairs) et assembler_indicateurs (la forme du contrat — rangs +
# estampilles T7 depuis INDICATEURS_MOBILITE + vintages). La table est ALIGNÉE
# sur la référence : un territoire sans donnée porte NA — jamais une ligne
# manquante (la multiplicité 1 de la table déclarative l'exige).
construire_indicateurs_mobilite <- function(analytiques, territoires, vintages) {
  aligner <- function(table_agregee, key, unit) {
    dplyr::left_join(territoires["code"], table_agregee, by = "code") %>%
      dplyr::transmute(
        code = code, key = key, detail = NA_character_,
        value = value, unit = unit
      )
  }

  tables <- list(
    nb_buildings = aligner(analytiques$nb_buildings_territoires,
                           "nb_buildings", "bâtiments")
  )

  rangs <- compute_ranks(territoires, tables, scalaires = list())

  assembler_indicateurs(territoires, tables, rangs, theme = "mobilite",
                        indicateurs_table = INDICATEURS_MOBILITE,
                        vintages = vintages)
}

# compute_histoires_mobilite ---------------------------------------------------
# L'Histoire du thème (issue #137) : VIDE par design — le tracer bullet ne
# porte pas encore de Story. La table existe avec la forme de base du contrat
# (territoire | type | theme | story_key), prête pour le ticket #138 qui
# assemble « Vingt minutes sans voiture » (div_loss_t) et « Ce que le vélo
# préserve » (saillance) avec leurs lignes multi-niveaux et leurs estampilles.
# Jamais un « under construction » : la table est présente et vide, comme
# l'apercu du gating.
compute_histoires_mobilite <- function(analytiques, vintages) {
  tibble::tibble(
    territoire = character(),
    type = character(),
    theme = character(),
    story_key = character()
  )
}

# construire_apercu_mobilite ---------------------------------------------------
# Les stats de base de l'onglet Aperçu (ADR-0007) : AUCUNE aujourd'hui — le
# gating par thème (APERCU_MOBILITE vide). Retourne la liste vide ; la table
# `apercu` du payload reste présente et vide (la forme du contrat).
construire_apercu_mobilite <- function(territoires) {
  list()
}

# validations_mobilite ---------------------------------------------------------
# Les vérifications de valeur propres au thème (point 7) : déclarées ici,
# exécutées par validate_payload() après ses vérifications génériques.
validations_mobilite <- list(
  # la « Taille » du thème est un total non négatif (une valeur NA — commune
  # hors snapshot — est un cas légitime, jamais une corruption)
  function(payload) {
    nb <- payload$indicateurs$value[payload$indicateurs$key == "nb_buildings"]
    if (any(!is.na(nb) & nb < 0)) {
      stop("Payload invalide : des bâtiments analysés négatifs.",
           call. = FALSE)
    }
    invisible(payload)
  }
)

# construire_payload_mobilite --------------------------------------------------
# L'assembleur du payload du thème : les quatre tables du contrat (la forme
# d'compute_payload, compute.R) — indicateurs (avec rangs + estampilles T7),
# histoires (vide — le Story arrive au ticket #138), territoires (référence
# partagée) et apercu (vide — gating). Validé par la validation GÉNÉRIQUE
# avec les tables déclaratives du thème — un payload invalide s'arrête là.
construire_payload_mobilite <- function(analytiques, base_epci, vintages) {
  territoires <- construire_territoires_mobilite(base_epci, analytiques)

  payload <- list(
    indicateurs = construire_indicateurs_mobilite(analytiques, territoires, vintages),
    histoires = compute_histoires_mobilite(analytiques, vintages),
    territoires = reference_territoires(territoires),
    apercu = assemble_apercu(territoires, construire_apercu_mobilite(territoires))
  )

  validate_payload(payload,
                   indicateurs = INDICATEURS_MOBILITE,
                   vintages = vintages,
                   validations = validations_mobilite,
                   apercu = APERCU_MOBILITE)
  payload
}

# publier_mobilite -------------------------------------------------------------
# Le seam de publication du thème : lit le référentiel partagé (base_epci du
# cache), enchaîne le calcul (construire_analytiques_mobilite — les artefacts
# sont régénérés sous data/processed/mobilite/), assemble le payload, le
# valide et le publie via la machinerie PARTAGÉE publish (backend "static"
# par défaut — parquet + projections JSON + vintages). Retourne le payload,
# comme run_pipeline l'attend.
publier_mobilite <- function(donnees, cache = "data/raw", vintages = NULL,
                             sortie = "public/data",
                             sortie_analytiques = file.path(dirname(cache),
                                                            "processed", "mobilite")) {
  if (is.null(vintages)) vintages <- vintages_mobilite()

  base_epci <- lire_epci(file.path(cache, "extracted", "EPCI_au_01-01-2025.xlsx"))
  analytiques <- construire_analytiques_mobilite(donnees, base_epci,
                                                 sortie = sortie_analytiques)
  payload <- construire_payload_mobilite(analytiques, base_epci, vintages)
  publish(payload, sortie)
  payload
}

# MEMBRES_DESCRIPTEUR_MOBILITE -------------------------------------------------
# Les membres requis du descripteur — le contrat de FORME du thème (ce que la
# machinerie partagée consomme : theme, manifest, vintages, construire_donnees
# — et ce que le run branche : construire_analytiques, publier). La même idée
# que MEMBRES_DESCRIPTEUR_ECONOMIE : un descripteur incomplet échoue FORT, en
# nommant le membre fautif.
MEMBRES_DESCRIPTEUR_MOBILITE <- c(
  "theme", "manifest", "vintages", "construire_donnees",
  "construire_analytiques", "publier"
)

# verifier_descripteur_mobilite -------------------------------------------------
# La validation de FORME du descripteur : tout membre requis manquant fait
# échouer la validation bruyamment, en nommant le membre fautif. Exécutée par
# theme_mobilite() sur son propre résultat (la construction échoue si le
# descripteur est cassé) et par les tests sur des fixtures négatives.
verifier_descripteur_mobilite <- function(descripteur) {
  manquants <- setdiff(MEMBRES_DESCRIPTEUR_MOBILITE, names(descripteur))
  if (length(manquants) > 0) {
    stop("Descripteur Mobilité invalide — membre(s) requis manquant(s) : ",
         paste(manquants, collapse = ", "), ".", call. = FALSE)
  }
  invisible(TRUE)
}

# theme_mobilite ---------------------------------------------------------------
# Le descripteur du thème Mobilité : la même forme de contrat que
# theme_economie() / theme_demographie(), avec les pièces du thème. Le
# descripteur est validé à la construction (verifier_descripteur_mobilite) :
# un membre manquant échoue là où il est construit, jamais plus tard dans la
# machinerie.
theme_mobilite <- function() {
  descripteur <- list(
    theme = "mobilite",
    manifest = MANIFEST_MOBILITE,
    vintages = vintages_mobilite,
    construire_donnees = construire_donnees_mobilite,
    construire_analytiques = construire_analytiques_mobilite,
    publier = publier_mobilite
  )
  verifier_descripteur_mobilite(descripteur)
  descripteur
}
