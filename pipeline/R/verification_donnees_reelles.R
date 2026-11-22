# verification_donnees_reelles -------------------------------------------------
# Les verrous « données réelles » du pipeline (issue #329, US 13 — ticket
# #342) : les assertions de contrat sur les VRAIS fichiers du cache
# (pipeline/data/raw, gitignoré) que la suite testthat portait sous des skips
# opt-in par variable d'environnement (helper-donnees-reelles.R, supprimé).
# Chaque bloc devient UNE fonction de vérification appelée par UN target LEAF
# du graphe (verif_<slug>, piloté par ses entrées : les fichiers bruts en
# targets format = "file" à hash de contenu, les lecteurs suivis par
# imports) — la vérification rejoue quand la donnée ou le lecteur change,
# saute sinon, SANS variable d'environnement à retenir.
#
# La discipline est celle des blocs convertis (test-passage-cog.R,
# test-qualite-amenagements-reelles.R, test-subventions.R,
# test-theme-milieux-*.R, test-analytics-economie-*.R,
# test-analytics-mobilite-e2e.R, test-programmes-e2e.R,
# test-resoudre-histoires.R) : les verrous de FORMAT sont déplacés tels quels,
# jamais affaiblis — une dérive de la donnée réelle ou du lecteur fait
# ÉCHOUER la fonction (stop()), le target passe en erreur (error =
# "continue" laisse le rapport de run s'écrire — l'alerte est le câblage
# cron #343), jamais un silence.
#
# TOUTES les entrées arrivent en ARGUMENTS — les chemins sont résolus par le
# GRAPHE depuis le manifeste (les cibles fichier_<theme>_<id> / fichier_
# programme_<id> / fichier_epci_extrait, la REGISTRE VERIFICATIONS_* de
# _targets.R) : une fonction ne hard-code JAMAIS un nom de fichier du cache.
# Deux formes (voir la REGISTRE) :
#   - sur les tables NORMALISÉES du thème (les blocs analytiques Économie,
#     le run complet Milieux, le e2e Mobilité) : `donnees` — la liste du
#     BRUT du graphe (brut_<theme> = construire_donnees_<theme>, déjà
#     calculé par le graphe) — JAMAIS re-dérivée (pas de re-normalisation,
#     pas d'écriture, pas de course avec le target brut du graphe) ;
#   - sur les FICHIERS BRUTS directement (la table de passage COG, le
#     snapshot Geovelo, le CSV CONSOENAF, la série historique, les exports
#     SCDL/ANCT) : le chemin arrive en argument (la cible fichier_<theme>_<id>
#     à hash de contenu — la précision du skip par source) ; l'extraction
#     d'un zip se fait dans un répertoire TEMPORAIRE (jamais cache/extracted
#     — pas de course avec les builders du graphe qui y extraient aussi) ;
#   - le référentiel partagé extrait (la base des EPCI) arrive en argument
#     `base_epci` (fichier_epci_extrait — lu par lire_epci, jamais un chemin
#     en dur).
#
# Les fonctions sont appelées PAR SYMBOLE par les commandes du graphe
# (symbole_ns, _targets.R) : le suivi d'imports de targets (hash du corps +
# dépendances transitives) couvre TOUTES les fonctions métier qu'elles
# appellent — un changement de corps d'un lecteur ou d'un normaliseur
# invalide le verrou même sans changement de fichier.
#
# NB : les verrous « byte-identical » / déterminisme des runs de bout en bout
# (un second run produit les mêmes octets) ne sont PAS re-verrouillés ici —
# la propriété est déjà la porte de test-targets-byte-identical.R, hors de la
# portée d'un target (un target est un run unique).
#
# POLITIQUE DES VERROUS DE VALEUR (issue #380) : les verrous de VALEUR des
# couches dérivées de sources VIVANTES (les modes t/c de l'extrait OSM
# `latest`, les flux vivants GTFS/IRVE) sont RELATIFS À L'ÉPOQUE DU CACHE —
# un extrait re-téléchargé bouge les derniers chiffres : ils sont verrouillés
# à leur précision naturelle (densités et parts au 4ᵉ décimale, longueurs au
# 3ᵉ, comptes exacts). Les verrous de FORMAT (comptes du snapshot FIGÉ,
# colonnes, estampilles, règles d'agrégation) restent FORTS — la dérive
# d'époque ne touche que les couches vivantes, jamais le snapshot.

# erreur_verrou_casse ----------------------------------------------------------
# Condition NOMMÉE d'une VALEUR de verrou « données réelles » cassée. C'est le
# SEUL signal que `verifier_avec_attribution()` est autorisé à attribuer
# (dérive de données / régression de code). Toute autre erreur — artefact amont
# absent, lecture Parquet impossible, échec réseau — est une défaillance
# d'exécution : elle doit propager son message d'origine, sans attribution
# (#1118 — le run3 avait étiqueté un Parquet Mobilité manquant « régression de
# code : entrées identiques, sortie modifiée »).
erreur_verrou_casse <- function(message) {
  structure(
    list(message = message, call = NULL),
    class = c("verrou_casse", "error", "condition")
  )
}

# verifier_egale / verifier_vrai ----------------------------------------------
# Les deux micro-gardes des verrous : un échec s'arrête bruyamment en nommant
# le verrou et le fait constaté (jamais un message muet). `obtenu` vs
# `attendu` en égalité (all.equal — les comptes réels sont des entiers ou des
# doubles, jamais une identité au poil près) ; les tolérances sont passées
# explicitement là où la donnée réelle l'exige (les arrondis des comptes
# réels, jamais un flottant comparé sans marge).
verifier_egale <- function(obtenu, attendu, verrou, ...) {
  if (!isTRUE(all.equal(obtenu, attendu, ...))) {
    stop(erreur_verrou_casse(paste0(
      "Verrou « données réelles » cassé — ", verrou, " : attendu « ",
      paste(attendu, collapse = ", "), " », obtenu « ",
      paste(obtenu, collapse = ", "), " »."
    )))
  }
  invisible(TRUE)
}

verifier_vrai <- function(condition, verrou, detail = "") {
  if (!isTRUE(condition)) {
    stop(erreur_verrou_casse(paste0(
      "Verrou « données réelles » cassé — ", verrou, ".",
      if (nzchar(detail)) paste0(" ", detail) else ""
    )))
  }
  invisible(TRUE)
}

# ILES_SANS_EPCI --------------------------------------------------------------
# Les trois îles bretonnes SANS EPCI (le fix #131 : la référence n'a plus
# l'EPCI fantôme « Sans objet » — la base INSEE les code « ZZZZZZZZZ ») :
# leurs rangs-en-contexte portent rang_epci = NA, jamais un rang inventé.
# La constante des verrous rangs (l'ancien fixture du test converti).
ILES_SANS_EPCI <- c("22016", "29083", "29155")

# verifier_passage_cog_reel ----------------------------------------------------
# Verrou du bloc converti de test-passage-cog.R : la table de passage INSEE
# RÉELLE (le zip cog_passage, résolu par le manifeste et passé en argument)
# — les fusions bretonnes 2022→2025 vérifiées sur le fichier réel (Le Cambout
# + Coëtlogon → Plumieux, Pléven → Val-d'Arguenon, Saint-Launeuc →
# Merdrignac, Fleurigné → La Chapelle-Fleurigné), l'identité passe, et
# passage_cog sur de vrais codes Geovelo (COG 2022) ne produit AUCUNE NA —
# des codes 2025 bretons. L'extraction du zip se fait dans un répertoire
# TEMPORAIRE (jamais cache/extracted — pas de course avec le builder
# Mobilité du graphe).
verifier_passage_cog_reel <- function(zip) {
  verifier_vrai(file.exists(zip),
                "passage COG", paste("la source COG est absente :", zip))

  extrait <- tempfile("verif-cog-")
  dir.create(extrait)
  suppressWarnings(
    utils::unzip(zip, exdir = extrait, overwrite = FALSE)
  )
  brut <- lire_table_passage(file.path(extrait, "table_passage_annuelle_2025.xlsx"))
  bretagne <- brut[grepl("^(22|29|35|56)", brut$CODGEO_2025), ]
  mappe <- construire_passage_cog(bretagne)

  lire <- function(code) mappe$code_2025[mappe$code_2022 == code]
  verifier_egale(lire("22027"), "22241", "passage COG — Le Cambout → Plumieux")
  verifier_egale(lire("22043"), "22241", "passage COG — Coëtlogon → Plumieux")
  verifier_egale(lire("22200"), "22237", "passage COG — Pléven → Val-d'Arguenon")
  verifier_egale(lire("22309"), "22147", "passage COG — Saint-Launeuc → Merdrignac")
  verifier_egale(lire("35112"), "35062",
                 "passage COG — Fleurigné → La Chapelle-Fleurigné")
  verifier_egale(lire("22241"), "22241", "passage COG — l'identité Plumieux")

  codes_geovelo <- c("22027", "22043", "22241", "22200", "22309", "35112")
  projetes <- passage_cog(codes_geovelo, mappe)
  verifier_vrai(!anyNA(projetes),
                "passage COG", "des codes Geovelo projetés en NA")
  verifier_vrai(all(grepl("^(22|29|35|56)", projetes)),
                "passage COG", "un code projeté hors Bretagne")

  invisible(TRUE)
}

# verifier_raccordement_reel ----------------------------------------------------
# Verrou du RACCORDEMENT : l'enveloppe VERSIONNÉE publiée (le chemin de
# l'épingle rendu par la cible raccordement_mobilite, passé en argument) est
# relue et vérifiée SANS JAMAIS re-router — le corpus GTFS national épinglé
# est la seule matière. Depuis #728 le raccordement publié est le modèle
# sortant « arrêt à arrêt » (source raccordement_gtfs_national), pas l'ancien
# artefact mairie-à-mairie : le verrou consacre le MÊME lecteur canonique que
# la publication (lire_artefact_raccordement_national, theme_mobilite.R) —
# jamais l'ancien lire_raccordement, dont le répertoire analytique n'est plus
# produit par le graphe depuis #728 (#1070). Ce que le verrou asserte sur les
# sorties PUBLIÉES :
#   - la COUVERTURE : 1 202 communes évaluées, 664 origines éligibles routées,
#     538 zéros structurels complets, une courbe de 73 points par commune ;
#   - LES DOMAINES de valeur : parts dans [0, 1], courbes monotones sur la
#     grille déclarée, zéros structurels portant leur motif source ;
#   - LES ESTAMPILLES : les octets de l'épingle sont vérifiés par le lecteur
#     canonique (une enveloppe altérée échoue AVANT toute assertion) ; le
#     Parquet Mobilité publié porte les trois clés avec la source versionnée
#     et ses dates ;
#   - LES ANCRES du modèle sortant GTFS (qui REMPLACENT les ancres
#     mairie-à-mairie retirées) : plusieurs communes couvrant l'étendue des
#     parts @90, la médiane et des points de courbe — un calcul qui déraille
#     est refusé ICI.
#
# VALEURS DORÉES DU MODÈLE PUBLIÉ (arrêt-à-arrêt GTFS, grille de 73 points).
# Dérivées de l'artefact épinglé puis figées ici comme littéraux : couverture
# aux quatre niveaux pour les trois clés, et ancres indépendantes. Elles sont
# re-vérifiées hors données réelles par test-raccordement-national.R, donc
# un changement de l'artefact épinglé ne peut pas les faire glisser en silence.
COUVERTURE_DOREE_RACCORDEMENT <- list(
  raccordement_tc = c(communes = 1202L, epcis = 61L,
                      departements = 4L, region = 1L),
  raccordement_courbe = c(communes = 87746L, epcis = 4453L,
                          departements = 292L, region = 73L),
  raccordement_reference = c(communes = 0L, epcis = 0L,
                             departements = 0L, region = 73L)
)
# Une seule valeur par fait, à une seule tolérance documentée : t90 vit dans
# ANCRE_DOREE_90 (tolérance 1e-6, suffisante pour 56014 piné à 7 décimales), et
# ANCRE_DOREE_COURBE ne retient que les points HORS t90 (tolérance 1e-9).
# Aucun Combourg dupliqué entre les deux jeux.
ANCRE_DOREE_MEDIANE_90 <- 0.03604382829328254
ANCRE_DOREE_90 <- c(
  "22001" = 0,                   # zéro structurel : aucun arrêt modèle
  "29083" = 0,                   # zéro structurel : l'île de Sein
  "56014" = 0.1321844,           # routée, au voisinage de la médiane des routées
  "35085" = 0.3153225081681583,  # Combourg
  "22093" = 0.3476113029335792,  # Lamballe-Armor
  "35238" = 0.4377219608218312   # Rennes : le maximum de l'échantillon publié
)
ANCRE_DOREE_COURBE <- list(
  "35085" = c(`30` = 0.08970913529137, `60` = 0.20498496826957,
              `180` = 0.66187361750117, `360` = 0.84866250938577),
  "35238" = c(`30` = 0.206793704358, `60` = 0.325023120164,
              `180` = 0.776491649200, `360` = 0.848911830276),
  "22001" = c(`30` = 0, `60` = 0, `180` = 0, `360` = 0)
)

verifier_raccordement_reel <- function(artefact, payload) {
  # le lecteur normalise lui-même répertoire/fichier à la frontière (#1070)
  enveloppe <- lire_artefact_raccordement_national(
    chemin_enveloppe = artefact)
  calcul <- enveloppe$calculation

  # la COUVERTURE du calcul canonique : toute commune évaluée, les origines
  # éligibles routées et les zéros structurels complets (jamais un NA ni un
  # choix silencieux — c'est le contrat du lecteur épinglé).
  n_assessees <- RECETTE_RACCORDEMENT_NATIONAL$assessed_commune_count
  n_eligibles <- RECETTE_RACCORDEMENT_NATIONAL$eligible_origin_count
  verifier_egale(nrow(calcul$commune_scalars), n_assessees,
                  "raccordement — les 1202 communes évaluées")
  verifier_egale(sum(calcul$commune_scalars$origin_search_completed), n_eligibles,
                  "raccordement — les 664 origines éligibles routées")
  verifier_egale(sum(!calcul$commune_scalars$origin_search_completed),
                 n_assessees - n_eligibles,
                 "raccordement — les zéros structurels complets")
  verifier_vrai(all(calcul$commune_scalars$curve_status %in%
                      c("routed_complete", "structural_model_zero_complete")),
                 "raccordement", "un statut de courbe inattendu")
  zeros <- calcul$commune_scalars[
    !calcul$commune_scalars$origin_search_completed, , drop = FALSE]
  verifier_vrai(all(zeros$structural_zero_reason %in% c(
                      "no_modeled_endpoint_stops",
                      "endpoint_stops_but_no_permitted_first_boarding")),
                 "raccordement", "un zéro structurel sans motif source")

  # la GRILLE PUBLIÉE : 73 points, la grille déclarée de la recette, et des
  # parts bornées et monotones pour chaque commune évaluée.
  grille <- RECETTE_RACCORDEMENT_NATIONAL$grille_publication_min
  verifier_egale(as.integer(sub("^t", "", grille_raccordement_national())), grille,
                  "raccordement — la grille publiée")
  verifier_egale(nrow(calcul$commune_curves), n_assessees * length(grille),
                  "raccordement — une courbe de 73 points par commune")
  verifier_vrai(all(is.finite(calcul$commune_curves$share) &
                      calcul$commune_curves$share >= 0 &
                      calcul$commune_curves$share <= 1),
                 "raccordement", "une part de courbe hors [0, 1]")
  par_commune <- split(calcul$commune_curves$share, calcul$commune_curves$code)
  verifier_vrai(all(vapply(par_commune, function(x) all(diff(x) >= -1e-12),
                           logical(1))),
                 "raccordement", "une courbe communale non monotone")

  # NOUVEAUX VERROUS DU MODÈLE SORTANT GTFS (#728) — ils REMPLACENT les ancres
  # mairie-à-mairie retirées (Rennes/Lamballe/médiane du run #485), qui ne
  # décrivent plus le modèle publié. Plusieurs communes couvrant l'étendue des
  # parts @90 (zéro structurel, bas, médiane des routées, haut, maximum) PLUS la
  # médiane sur toutes les communes évaluées, pinées comme littéraux. Les points
  # MULTIPLES de courbe détectent une cassure ailleurs qu'à t90 — un seul point
  # ne suffirait pas à prouver que la courbe est intacte.
  part_de <- function(code, minute) {
    calcul$commune_curves$share[
      calcul$commune_curves$code == code &
        calcul$commune_curves$minute == minute]
  }
  for (code in names(ANCRE_DOREE_90)) {
    verifier_egale(part_de(code, 90L), ANCRE_DOREE_90[[code]],
                   paste0("raccordement — ancre GTFS @90 (", code, ")"),
                   tolerance = 1e-6)
  }
  # la médiane porte sur TOUTES les communes évaluées, zéros structurels inclus
  verifier_egale(median(calcul$commune_scalars$share_90), ANCRE_DOREE_MEDIANE_90,
                  "raccordement — ancre GTFS : médiane @90",
                  tolerance = 1e-9)
  for (code in names(ANCRE_DOREE_COURBE)) {
    for (minute in names(ANCRE_DOREE_COURBE[[code]])) {
      verifier_egale(part_de(code, as.integer(minute)),
                     ANCRE_DOREE_COURBE[[code]][[minute]],
                     paste0("raccordement — ancre de courbe GTFS (", code,
                            " t", minute, ")"),
                     tolerance = 1e-9)
    }
  }

  # Le calcul ci-dessus n'est pas encore la preuve de publication : le verrou
  # lit aussi le Parquet Mobilité conservé (#619), passé par une cible format
  # = "file". Les projections numériques JSON ont été retirées.
  verifier_vrai(file.exists(payload),
                 "raccordement — payload publié",
                 paste("le Parquet Mobilité est absent :", payload))
  publie <- nanoparquet::read_parquet(payload)
  verifier_vrai(is.data.frame(publie) && all(c("theme", "key", "type", "detail",
                                               "vintage_source", "vintage_version",
                                               "vintage_date_reference",
                                               "vintage_date_publication") %in% names(publie)),
                  "raccordement — payload publié",
                  "le Parquet ne porte pas les colonnes de faits et d'estampille")
  cles <- c("raccordement_tc", "raccordement_courbe", "raccordement_reference")
  raccordement <- publie[publie$theme == "mobilite" & publie$key %in% cles,
                         , drop = FALSE]
  verifier_egale(sort(unique(raccordement$key)), sort(cles),
                  "raccordement — les trois clés publiées")

  # VALEURS DORÉES DU MODÈLE PUBLIÉ (arrêt-à-arrêt GTFS, grille de 73 points) :
  # dérivées de l'artefact épinglé puis figées ici à quatre niveaux pour les
  # trois clés (commune / epci / departement / region). Une couverture qui
  # bouge — territoires manqués ou lignes dupliquées — échoue bruyamment.
  couverture <- function(cle) {
    lignes <- raccordement[raccordement$key == cle, , drop = FALSE]
    c(communes = sum(lignes$type == "commune"),
      epcis = sum(lignes$type == "epci"),
      departements = sum(lignes$type == "departement"),
      region = sum(lignes$type == "region"))
  }
  for (cle in names(COUVERTURE_DOREE_RACCORDEMENT)) {
    verifier_egale(unname(couverture(cle)),
                   unname(COUVERTURE_DOREE_RACCORDEMENT[[cle]]),
                   paste0("raccordement — couverture dorée (", cle, ")"))
  }

  # les estampilles viennent du vintage DÉCLARÉ du raccordement national —
  # jamais de la matrice temps mairie historique (le payload 2026 dit
  # raccordement_gtfs_national, comme le calcul ci-dessus).
  vintages <- vintages_mobilite()
  # L'ID canonique est ÉPINGLÉ ici, pas lu depuis ce que le publisher a écrit :
  # le contrat doit porter les identifiants attendus du modèle publié, sinon la
  # jointure d'estampilles pourrait passer avec n'importe quelle source.
  ids_canoniques <- "raccordement_gtfs_national"
  ids_du_contrat <- unique(as.character(INDICATEURS_MOBILITE$source_reference[
    INDICATEURS_MOBILITE$key %in% cles]))
  verifier_egale(sort(ids_du_contrat), sort(ids_canoniques),
                  "raccordement — les ids de vintage canoniques du contrat")
  verifier_vrai(all(ids_canoniques %in% as.character(vintages$id)),
                 "raccordement", "l'id de vintage canonique est absent du thème")
  vintage <- vintages[as.character(vintages$id) == ids_canoniques,
                      , drop = FALSE]
  verifier_egale(nrow(vintage), 1L,
                  "raccordement — le vintage national est déclaré")
  for (cle in cles) {
    lignes <- raccordement[raccordement$key == cle, , drop = FALSE]
    verifier_vrai(
      all(!is.na(lignes$vintage_source) &
          lignes$vintage_source == vintage$source[[1L]] &
          lignes$vintage_version == vintage$version[[1L]] &
          lignes$vintage_date_reference == vintage$date_reference[[1L]] &
          lignes$vintage_date_publication == vintage$date_publication[[1L]]),
      paste0("raccordement — estampilles du payload publié (", cle, ")"),
      "source, version et dates du vintage national absentes ou divergentes"
    )
  }

  invisible(TRUE)
}

# verifier_amenagements_cyclables_reel -----------------------------------------
# Verrou du bloc converti de test-qualite-amenagements-reelles.R : le snapshot
# Geovelo RÉEL (le parquet, résolu par le manifeste et passé en argument)
# passe le lecteur (412 681 lignes — le compte réel verrouillé de la research
# note §4), la porte de qualité, et le normaliseur breton (27 797 lignes,
# EPSG:4326, aucun code 2022 breton survivant non mappé par les fusions
# vérifiées). Extraction COG en répertoire TEMPORAIRE (jamais cache/extracted).
verifier_amenagements_cyclables_reel <- function(parquet, zip_cog) {
  verifier_vrai(file.exists(parquet),
                "Aménagements cyclables",
                paste("le snapshot Geovelo est absent :", parquet))

  # la table de passage COG 2022→2025 (depuis le fichier réel, filtrée
  # Bretagne) — la même construction que l'orchestrateur du mode `b`, extraite
  # dans un répertoire temporaire
  extrait <- tempfile("verif-cog-")
  dir.create(extrait)
  suppressWarnings(
    utils::unzip(zip_cog, exdir = extrait, overwrite = FALSE)
  )
  brut_cog <- lire_table_passage(
    file.path(extrait, "table_passage_annuelle_2025.xlsx"))
  bretagne_cog <- brut_cog[grepl("^(22|29|35|56)", brut_cog$CODGEO_2025), ]
  mappe <- construire_passage_cog(bretagne_cog)

  frais <- lire_amenagements_cyclables(parquet)
  verifier_vrai(inherits(frais, "sf"),
                "Aménagements cyclables", "le lecteur ne rend pas un objet sf")
  verifier_egale(nrow(frais), 412681L,
                 "Aménagements cyclables — le compte réel de la France entière")

  # la porte de qualité passe sur le fichier réel (elle s'arrête elle-même
  # bruyamment sinon)
  verifier_qualite_amenagements(frais)

  table <- normaliser_amenagements_cyclables(frais, mappe)
  verifier_egale(nrow(table), 27797L,
                 "Aménagements cyclables — la tranche bretonne réelle")
  verifier_vrai(all(grepl("^(22|29|35|56)", table$code_com_d)),
                "Aménagements cyclables", "une commune non bretonne après filtre")
  verifier_egale(sf::st_crs(table)$input, "EPSG:4326",
                 "Aménagements cyclables — le CRS")
  verifier_vrai(!any(table$code_com_d %in% c("22027", "22043", "22309", "35112")),
                "Aménagements cyclables",
                "un code 2022 breton survit non mappé dans la table normalisée")

  invisible(TRUE)
}

# verifier_consoenaf_reel ------------------------------------------------------
# Verrou du bloc converti de test-theme-milieux-reshape.R : le CSV CONSOENAF
# RÉEL (résolu par le manifeste et passé en argument) — les 172 colonnes du
# dictionnaire, l'anomalie d'unité m²/ha vérifiée sur Rennes (1 233 202 m² ÷
# 50 311 729 m² = 2,45 %, docs/research/zan-rennes.md), et le reshape réel
# (conversion + filtre Bretagne).
verifier_consoenaf_reel <- function(fichier) {
  verifier_vrai(file.exists(fichier),
                "CONSOENAF", paste("le CSV CONSOENAF est absent :", fichier))

  brut <- lire_consoenaf(fichier)
  verifier_egale(ncol(brut), 172L, "CONSOENAF — les colonnes du dictionnaire")

  rennes <- brut[brut$idcom == "35238", ]
  verifier_egale(nrow(rennes), 1L, "CONSOENAF — la ligne Rennes")
  m2 <- as.double(rennes$naf11art25)
  verifier_egale(m2, 1233202,
                 "CONSOENAF — naf11art25 de Rennes en m²")
  part <- as.double(rennes$artcom1125)
  verifier_egale(part, m2 / as.double(rennes$surfcom2025) * 100,
                 "CONSOENAF — la cohérence interne d'artcom1125 de Rennes",
                 tolerance = 1e-2)

  norm <- normaliser_consoenaf(brut)
  verifier_vrai(all(norm$departement %in% DEPT_BRETAGNE),
                "CONSOENAF", "une commune hors Bretagne après le reshape")
  verifier_egale(norm$naf11art25[norm$code == "35238"], 1233202 / 10000,
                 "CONSOENAF — la conversion m² -> ha de Rennes")

  invisible(TRUE)
}

# verifier_serie_historique_reel -----------------------------------------------
# Verrou du bloc converti de test-theme-milieux-histoire.R (premier) : la
# VRAIE série historique du recensement — la fenêtre dérive des deux
# millésimes les plus récents de la donnée (2017 et 2023, jamais codée en
# dur — un nouveau recensement INSEE la fait glisser), et les populations
# réelles ne sont JAMAIS négatives aux deux bornes (le 0 réel des villages
# détruits de la Meuse est un dénombrement exact, jamais une corruption).
# Le zip (résolu par le manifeste et passé en argument) est extrait dans un
# répertoire TEMPORAIRE (jamais cache/extracted — pas de course avec les
# builders du graphe, et jamais une extraction périmée du cache).
verifier_serie_historique_reel <- function(zip) {
  verifier_vrai(file.exists(zip),
                "série historique",
                paste("la série historique réelle est absente :", zip))

  extrait <- tempfile("verif-serie-")
  dir.create(extrait, recursive = TRUE)
  suppressWarnings(
    utils::unzip(zip, exdir = extrait, overwrite = FALSE)
  )
  fichier <- file.path(extrait, NOM_FICHIER_SERIE_HISTORIQUE)

  serie <- lire_serie_historique_pop(fichier)
  verifier_egale(unique(serie$millesime_debut), 2017,
                 "série historique — le millésime de début de la fenêtre")
  verifier_egale(unique(serie$millesime_fin), 2023,
                 "série historique — le millésime de fin de la fenêtre")
  verifier_vrai(all(serie$pop_debut >= 0),
                "série historique", "une population de début négative")
  verifier_vrai(all(serie$pop_fin >= 0),
                "série historique", "une population de fin négative")

  invisible(TRUE)
}

# verifier_milieux_histoires_reel ----------------------------------------------
# Verrou du bloc converti de test-theme-milieux-histoire.R (second) : le run
# complet Milieux sur les vraies données — une lecture par territoire, les
# deux fenêtres 2017-2023, le vocabulaire fermé des lectures, et (quand les
# archives OCS-GE sont dans le cache) l'invariant ratio/delta et la
# renaturation MESURÉE. Reçoit `donnees` — le BRUT du thème (la table des
# communes de construire_donnees_milieux, déjà calculée par le graphe) :
# jamais de re-dérivation, la vérification suit la fraîcheur du brut.
verifier_milieux_histoires_reel <- function(donnees) {
  verifier_vrai(!is.null(donnees) && nrow(donnees) > 0,
                "Milieux — histoires",
                "le brut du thème est vide — la donnée réelle est absente")

  territoires <- construire_territoires_milieux(donnees)
  hist <- compute_histoires_milieux(territoires)

  verifier_egale(nrow(hist), nrow(territoires),
                 "Milieux — une lecture par territoire")
  verifier_vrai(all(hist$periode_pop == "2017-2023"),
                "Milieux — la fenêtre de population dérivée de la donnée réelle")
  lectures <- c("grandir-en-se-densifiant", "grandir-en-setalant",
                "sen-aller-et-consommer-quand-meme",
                "les-departs-laissent-la-place-a-la-renaturation")
  verifier_vrai(all(is.na(hist$classification) |
                      hist$classification %in% lectures),
                "Milieux — le vocabulaire fermé des lectures")

  # quand les archives OCS-GE sont dans le cache, les états sont là (le brut
  # du thème les porte — construire_donnees_milieux) : l'invariant tient sur
  # les lectures publiées et la renaturation est mesurée
  if ("artif_m2" %in% names(territoires)) {
    ok <- !is.na(hist$artif_m2_par_habitant) & hist$artif_m2_par_habitant > 0
    verifier_vrai(all(
      sign(hist$trajectoire_artif_par_habitant[ok] - 1) ==
        sign(hist$artif_m3_par_habitant[ok] - hist$artif_m2_par_habitant[ok])
    ), "Milieux — l'invariant ratio/delta sur les lectures publiées")
    renat <- hist$classification ==
      "les-departs-laissent-la-place-a-la-renaturation"
    verifier_vrai(all(hist$artif_m3[renat] < hist$artif_m2[renat]),
                  "Milieux — la renaturation mesurée (M3 < M2)")
  }

  invisible(TRUE)
}

# verifier_dortoir_economie_reel -----------------------------------------------
# Verrou du bloc converti de test-analytics-economie-dormitory.R : le ratio
# dortoir sur les tables réelles (flores_a88 × rp_emploi, les tables
# normalisées du BRUT du thème) — 100 % des 1202 communes calculables, la
# distribution verrouillée à la construction (304 dortoirs profonds, 55 pôles
# d'emploi, 6 communes sous le plancher), et l'Histoire ne se déclenche
# JAMAIS sur la majorité (médiane ~0,3).
verifier_dortoir_economie_reel <- function(donnees) {
  res <- construire_dortoir_economie(donnees$flores_a88, donnees$rp_emploi)
  d <- res$table

  verifier_egale(nrow(d), 1202L, "dortoir — les 1202 communes")
  verifier_egale(sum(!is.na(d$ratio)), 1202L,
                 "dortoir — un ratio calculable pour chaque commune")
  verifier_vrai(all(d$workplace > 0),
                "dortoir", "un effectif au lieu de travail nul")
  verifier_vrai(all(d$resident > 0),
                "dortoir", "un actif résident nul")

  # la distribution réelle verrouillée (évidence 2026-08-05)
  verifier_egale(sum(d$classification == "dortoir-profond", na.rm = TRUE), 304L,
                 "dortoir — les dortoirs profonds")
  verifier_egale(sum(d$classification == "pole-emploi", na.rm = TRUE), 55L,
                 "dortoir — les pôles d'emploi")
  verifier_egale(sum(is.na(d$classification)), 6L,
                 "dortoir — les communes sous le plancher")
  verifier_egale(nrow(res$suppression), 6L,
                 "dortoir — le rapport de suppression")
  verifier_vrai(all(grepl("plancher", res$suppression$motif)),
                "dortoir", "une suppression hors motif gate D")

  verifier_vrai(sum(d$classification != "equilibre", na.rm = TRUE) / nrow(d) < 0.5,
                "dortoir", "l'Histoire se déclenche sur la majorité des communes")
  verifier_vrai(median(d$ratio) < 0.5 && median(d$ratio) > 0.2,
                "dortoir", "la médiane réelle du ratio hors [0,2 ; 0,5[")

  invisible(TRUE)
}

# verifier_chomage_economie_reel -----------------------------------------------
# Verrou des blocs convertis de test-analytics-economie-chomage.R : la table
# rp_chomage réelle (1202 communes × 3 mesures, aucun doublon, le concept
# censitaire) et le taux construit (une ligne par commune, dans [0, 1],
# aucune suppression, la cohérence structurelle 1T2 = 1 + 2 au dernier
# arrondi près — INSEE publie les deux côtés indépendamment).
verifier_chomage_economie_reel <- function(donnees) {
  rp <- donnees$rp_chomage

  verifier_egale(length(unique(rp$commune)), 1202L,
                 "chômage — les 1202 communes")
  verifier_egale(nrow(rp), 1202L * 3L,
                 "chômage — une ligne par commune × mesure")
  verifier_egale(anyDuplicated(rp[c("commune", "measure")]), 0L,
                 "chômage — aucun doublon (commune × mesure)")
  verifier_egale(sort(unique(rp$measure)),
                 c("actifs_occupes", "chomeurs", "population_active"),
                 "chômage — les trois mesures du contrat")
  verifier_vrai(all(rp$concept == CONCEPT_RP_CHOMAGE),
                "chômage", "le concept censitaire n'est pas porté partout")
  verifier_vrai(all(rp$source == "rp_chomage"),
                "chômage", "la provenance de la source n'est pas portée")
  verifier_vrai(all(rp$vintage == "2023"),
                "chômage", "le millésime n'est pas porté")

  res <- construire_chomage_economie(rp)
  d <- res$table
  verifier_egale(nrow(d), 1202L, "chômage — une ligne par commune")
  verifier_egale(anyDuplicated(d$commune), 0L, "chômage — aucun doublon")
  verifier_vrai(all(d$taux_chomage >= 0 & d$taux_chomage <= 1),
                "chômage", "un taux hors [0, 1]")
  verifier_egale(sum(is.na(d$taux_chomage)), 0L,
                 "chômage — chaque commune a son taux")
  verifier_egale(nrow(res$suppression), 0L,
                 "chômage — aucune commune supprimée")
  verifier_egale(d$population_active, d$actifs_occupes + d$chomeurs,
                 "chômage — la cohérence 1T2 = 1 + 2", tolerance = 1e-4)

  invisible(TRUE)
}

# verifier_lq_flores_reel -------------------------------------------------------
# Verrou des blocs convertis de test-analytics-economie-lq-flores.R : les
# tables Flores réelles passent la MÊME fonction (les deux grains natifs) —
# 48 821 lignes A88 / 109 413 A38, 1202 communes, les 6 communes sous le
# plancher gate D (min 2 salariés) TOUTES comptées, 1196 retenues, des LQ
# continues, finies, positives.
verifier_lq_flores_reel <- function(donnees) {
  # 2026-11-18 : la livraison Flores rechargée le 2026-08-27 en géographie 2026
  # diffuse des zéros EXPLICITES pour les cellules vides (la livraison 2025 les
  # omettait) — 209 148 lignes A88 / 872 652 A38, contre 48 821 / 109 413. Les
  # artefacts aval sont inchangés : 22 616 et 16 019 cellules de LQ, les mêmes
  # six communes sous le plancher, 1 196 communes retenues.
  verifier_egale(nrow(donnees$flores_a88), 209148L,
                 "Flores A88 — le compte réel des lignes")
  verifier_egale(dplyr::n_distinct(donnees$flores_a88$commune), 1202L,
                 "Flores A88 — les 1202 communes")

  res <- calculer_lq_emploi_flores(donnees$flores_a88, "A88")
  verifier_egale(nrow(res$suppression), 6L,
                 "Flores A88 — les communes sous le plancher")
  verifier_egale(min(res$suppression$n_total), 2L,
                 "Flores A88 — le minimum observé (2 salariés)")
  verifier_egale(sort(res$suppression$commune),
                 c("22057", "22169", "22350", "35026", "35325", "56025"),
                 "Flores A88 — les six communes supprimées")
  verifier_egale(dplyr::n_distinct(res$lq$commune), 1196L,
                 "Flores A88 — les communes retenues")
  verifier_vrai(all(is.finite(res$lq$lq)) && all(res$lq$lq > 0),
                "Flores A88", "une LQ non finie ou non positive")
  verifier_vrai(any(res$lq$lq < 1) && any(res$lq$lq > 1),
                "Flores A88", "des LQ toutes égales à 1")

  verifier_egale(nrow(donnees$flores_a38), 872652L,
                 "Flores A38 — le compte réel des lignes")
  verifier_egale(dplyr::n_distinct(donnees$flores_a38$commune), 1202L,
                 "Flores A38 — les 1202 communes")
  res38 <- calculer_lq_emploi_flores(donnees$flores_a38, "A38")
  verifier_egale(nrow(res38$suppression), 6L,
                 "Flores A38 — les mêmes six communes sous le plancher")
  verifier_egale(min(res38$suppression$n_total), 2L,
                 "Flores A38 — le minimum observé")
  verifier_egale(dplyr::n_distinct(res38$lq$commune), 1196L,
                 "Flores A38 — les communes retenues")
  verifier_vrai(all(is.finite(res38$lq$lq)) && all(res38$lq$lq > 0),
                "Flores A38", "une LQ non finie ou non positive")

  invisible(TRUE)
}

# PLANCHER_CODES_OBSERVES_A17 ---------------------------------------------------
# Le plancher de POSTES A17 distincts observés dans la table LQ réelle (issue
# #428, parent #154) : 12. La réalité verrouillée 2026-08-21 observe 16 postes
# sur les 17 du vocabulaire officiel (seul C2 — cokéfaction et raffinage —
# n'a aucun établissement dans le tissu productif breton,
# docs/research/naf-grain-lq.md) ; un repli A10 observerait ≤ 10 codes et une
# jointure partiellement cassée en perdrait davantage. Le plancher laisse une
# marge de quatre postes à la dérive d'époque du stock et déclenche sur tout
# effondrement du mapping. C'est la défense en profondeur CÔTÉ MANQUE : côté
# trop, la règle de vocabulaire refuse déjà tout code hors A17.
PLANCHER_CODES_OBSERVES_A17 <- 12L

# SEUIL_EPAISSEUR_MEDIANE_LQ ----------------------------------------------------
# L'épaisseur médiane de cellule (le n d'une cellule commune × activité) que
# la LQ réelle doit atteindre (issue #428) : 8. La recherche empirique mesure
# une médiane de 13 au grain A17 décidé (docs/research/naf-grain-lq.md),
# contre 2 en sous-classe, 2 en classe, 2 en groupe, 3 en division/A88 et 6 à
# A38 : 8 sépare STRICTEMENT l'A17 de toute autre granularité mesurée — un
# retour au grain fin ou un autre agrégat fait échouer le verrou bruyamment —
# tandis que la marge sous la médiane réelle (13 − 8) tolère la dérive
# d'époque du stock SIRENE.
SEUIL_EPAISSEUR_MEDIANE_LQ <- 8

# verifier_forme_lq_a17 ---------------------------------------------------------
# Les RÈGLES de forme de la LQ Économie au grain A17 (issue #428 — le pattern
# « dé-magic-number » remplace les comptes figés d'antan : 135 784 cellules,
# 835 390 lignes de M, 695 codes APET) :
#   - VOCABULAIRE : les codes portés par la table sont un sous-ensemble du
#     vocabulaire FERMÉ des 17 postes A17 officiels (VOCABULAIRE_NA17_OFFICIEL,
#     l'artefact épinglé #426). Le tripwire du bypass bas-niveau : les
#     sous-classes APET (« NN.NNL ») de l'ancien chemin sans mapper sont hors
#     vocabulaire — la règle échoue en les nommant ;
#   - PLANCHER de codes distincts observés (PLANCHER_CODES_OBSERVES_A17) :
#     l'effondrement du mapping (tout vers un poste, ou perdu) échoue ;
#   - ÉPAISSEUR médiane de cellule ≥ SEUIL_EPAISSEUR_MEDIANE_LQ : la régression
#     au grain fin (médiane 2 en sous-classe vs 13 à A17) échoue ;
#   - la SANITÉ de la LQ continue reste verrouillée : finie, positive, jamais
#     toutes ≡ 1.
verifier_forme_lq_a17 <- function(lq, verrou,
                                  plancher_codes = PLANCHER_CODES_OBSERVES_A17,
                                  seuil_epaisseur = SEUIL_EPAISSEUR_MEDIANE_LQ) {
  inconnus <- sort(unique(setdiff(lq$activity_code,
                                  names(VOCABULAIRE_NA17_OFFICIEL))))
  verifier_vrai(length(inconnus) == 0L, verrou, paste0(
    "code(s) hors du vocabulaire officiel des 17 postes A17 : ",
    paste(inconnus, collapse = ", "),
    " — le grain n'est plus A17 (bypass du mapper ou jointure cassée)."))

  observes <- dplyr::n_distinct(lq$activity_code)
  verifier_vrai(observes >= plancher_codes, verrou, sprintf(paste0(
    "%d poste(s) A17 observé(s), sous le plancher de %d — le mapping est ",
    "effondré."), observes, plancher_codes))

  epaisseur <- stats::median(lq$n)
  verifier_vrai(epaisseur >= seuil_epaisseur, verrou, sprintf(paste0(
    "l'épaisseur médiane de cellule (%g établissements) est sous le seuil %g ",
    "— retour au grain fin (médiane 13 à A17, 2 en sous-classe)."),
    epaisseur, seuil_epaisseur))

  verifier_vrai(all(is.finite(lq$lq)) && all(lq$lq > 0),
                verrou, "une LQ non finie ou non positive")
  verifier_vrai(any(lq$lq < 1) && any(lq$lq > 1),
                verrou, "des LQ toutes égales à 1")

  invisible(TRUE)
}

# verifier_exclusions_a17 -------------------------------------------------------
# La règle du RAPPORT D'EXCLUSION (issue #428) — le tripwire de la jointure
# cassée : exactement l'ensemble connu, découvert sur la vraie table
# (2026-08-21) — « 00.00Z », l'inconnue qui n'est pas une activité NAF
# officielle, porteuse d'UN SEUL établissement — et un motif qui nomme
# l'artefact épinglé. TOUT autre code exclu (une sous-classe post-2008 absente
# de la correspondance épinglée, un code corrompu) échoue bruyamment ici.
verifier_exclusions_a17 <- function(exclusions, verrou) {
  # 2026-11-18 : la coupe SIRENE 2026-10 ne porte plus AUCUN code hors
  # correspondance (« 00.00Z » a disparu de l'export). La règle est donc
  # « aucun code inconnu » — un ensemble vide est le meilleur cas, pas une
  # anomalie ; « 00.00Z » reste le seul code toléré, et il ne porte alors qu'un
  # établissement. Tout autre code (sous-classe post-2008 absente de
  # l'artefact épinglé, code corrompu) échoue toujours bruyamment.
  codes <- sort(unique(exclusions$activity_code))
  inconnus <- setdiff(codes, "00.00Z")
  verifier_vrai(length(inconnus) == 0L, verrou,
                paste("un code exclu hors « 00.00Z » :",
                      paste(inconnus, collapse = ", ")))
  if ("00.00Z" %in% codes) {
    verifier_egale(sum(exclusions$n[exclusions$activity_code == "00.00Z"]), 1L,
                   paste(verrou,
                         "— l'inconnue 00.00Z ne porte qu'un seul établissement"))
  }
  verifier_vrai(all(grepl("naf2_na17_2008", exclusions$motif)),
                verrou, "un motif hors artefact épinglé naf2_na17_2008")
  invisible(TRUE)
}

# verifier_forme_sidecar_m ------------------------------------------------------
# La règle du SIDECAR M (issue #428) : aligné sur l'univers EXACT des cellules
# retenues de la LQ — le croisement complet communes × activités, une ligne
# par cellule, les zéros explicites compris — et strictement binaire. La règle
# remplace le compte magique 835 390 (le compte du grain fin d'antan).
verifier_forme_sidecar_m <- function(m, lq, verrou) {
  verifier_egale(
    nrow(m),
    dplyr::n_distinct(lq$commune) * dplyr::n_distinct(lq$activity_code),
    paste(verrou, "— le croisement complet commune × activité"))
  verifier_vrai(all(m$m %in% c(0, 1)),
                verrou, "une valeur de matrice hors {0, 1}")
  invisible(TRUE)
}

# verifier_lq_economie_reel -----------------------------------------------------
# Verrou du bloc converti de test-analytics-economie-lq.R : la vraie table
# sirene_snapshot (181 481 lignes, 1202 communes) passe par LE CHAÎNON LIVRÉ
# (construire_analytique_lq_economie — agrégation → MAPPING A17 + rapport
# d'exclusion → plancher → Balassa → histoires → M), JAMAIS par un
# re-enchaînement bas-niveau qui contournerait le mapper : l'ancien verrou
# figeait ainsi le grain sous-classe abandonné (135 784 cellules / 695 codes
# APET) pendant que la production calculait en A17 (#427, parent #154).
# Depuis l'issue #428, ce que le verrou asserte sont des RÈGLES au grain A17
# (verifier_forme_lq_a17, verifier_exclusions_a17, verifier_forme_sidecar_m)
# plus les contrats réels conservés (les comptes du snapshot source, 0
# suppression au plancher gate D, les histoires 1202 × TOP_N).
verifier_lq_economie_reel <- function(donnees) {
  snapshot <- donnees$sirene_snapshot

  # 2026-11-18 : la coupe SIRENE régionale est passée au millésime 2026-10
  # (dernier traitement observé 2026-09-30) — 182 247 établissements actifs.
  verifier_egale(nrow(snapshot), 182247L, "LQ Économie — le compte réel du snapshot")
  verifier_egale(dplyr::n_distinct(snapshot$commune), 1202L,
                 "LQ Économie — les 1202 communes")

  sortie <- tempfile("verif-lq-economie-")
  dir.create(sortie)
  analytique <- construire_analytique_lq_economie(snapshot, sortie = sortie)

  verifier_forme_lq_a17(analytique$lq, "LQ Économie — le grain A17")
  verifier_exclusions_a17(analytique$exclusions, "LQ Économie")

  # le plancher gate D sur la vraie table : 0 suppression (minimum observé :
  # 10 établissements/commune), les 1202 communes retenues
  verifier_egale(nrow(analytique$suppression), 0L,
                 "LQ Économie — aucune commune sous le plancher")
  verifier_egale(dplyr::n_distinct(analytique$lq$commune), 1202L,
                 "LQ Économie — les communes retenues")

  verifier_egale(nrow(analytique$histoires), 1202L * TOP_N_SPECIALISATIONS_LQ,
                 "LQ Économie — les 5 lignes d'Histoire par commune")

  verifier_forme_sidecar_m(analytique$m, analytique$lq,
                           "LQ Économie — la matrice M sidecar")

  invisible(TRUE)
}

# verifier_eco_activites_economie_reel -----------------------------------------
# Verrou du bloc converti de test-analytics-economie-green.R : la part des
# éco-activités sur les 1202 communes réelles — 0 suppression (le minimum
# observé : 10 établissements actifs), des parts dans [0, 1], et la
# distribution verrouillée à la construction (moyenne ~0,32 — un déplacement
# de plusieurs points signalerait une liste EGSS ou un snapshot changé).
verifier_eco_activites_economie_reel <- function(donnees) {
  res <- construire_eco_activites_economie(donnees$sirene_snapshot,
                                           artefact_egss())
  d <- res$table

  verifier_egale(nrow(d), 1202L, "éco-activités — les 1202 communes")
  verifier_egale(nrow(res$suppression), 0L,
                 "éco-activités — aucune commune supprimée")
  verifier_egale(anyDuplicated(d$commune), 0L, "éco-activités — aucun doublon")
  verifier_vrai(all(d$part_economie_verte >= 0 & d$part_economie_verte <= 1),
                "éco-activités", "une part hors [0, 1]")
  verifier_vrai(mean(d$part_economie_verte) < 0.35 &&
                  mean(d$part_economie_verte) > 0.29,
                "éco-activités", "la part moyenne réelle a bougé")
  verifier_vrai(min(d$part_economie_verte) > 0.05 &&
                  max(d$part_economie_verte) < 0.75,
                "éco-activités", "l'étendue réelle des parts a bougé")
  verifier_egale(sort(unique(substr(d$commune, 1, 2))),
                 c("22", "29", "35", "56"),
                 "éco-activités — les quatre départements bretons")

  invisible(TRUE)
}

# verifier_rangs_economie_reel --------------------------------------------------
# Verrou des blocs convertis de test-analytics-economie-ranks.R : les
# rangs-en-contexte des quatre indicateurs sur les tables réelles — des
# ordinaux (entiers ≥ 1, 1 = meilleur) ou NA, les îles sans EPCI portant
# rang_epci = NA (jamais un rang inventé, ADR-0021), la région et les
# départements ne se classant que parmi leurs pairs. `base_epci` est le
# chemin du référentiel partagé extrait (fichier_epci_extrait), lu par
# lire_epci — jamais un chemin en dur.
verifier_rangs_economie_reel <- function(donnees, base_epci) {
  base <- lire_epci(base_epci)

  verifier_ordinaux <- function(r, verrou) {
    verifier_vrai(all(is.na(r$rang_reg) |
                        (r$rang_reg >= 1 & r$rang_reg == floor(r$rang_reg))),
                  verrou, "un rang régional non ordinal")
    verifier_vrai(all(is.na(r$rang_dep)),
                  verrou, "une commune classée au niveau département")
    verifier_vrai(all(is.na(r$rang_epci[!r$commune %in% ILES_SANS_EPCI]) |
                        (r$rang_epci[!r$commune %in% ILES_SANS_EPCI] >= 1 &
                           r$rang_epci[!r$commune %in% ILES_SANS_EPCI] ==
                           floor(r$rang_epci[!r$commune %in% ILES_SANS_EPCI]))),
                  verrou, "un rang EPCI non ordinal")
    verifier_egale(sort(unique(r$commune[is.na(r$rang_epci)])),
                   ILES_SANS_EPCI, paste(verrou, "— les îles sans EPCI"))
  }

  # LQ (SIRENE) : 1202 communes, une ligne par cellule commune × activité
  lq <- construire_analytique_lq_economie(donnees$sirene_snapshot)$lq
  r <- attacher_rangs_lq(lq, base)
  verifier_egale(nrow(r), nrow(lq), "rangs LQ — une ligne par cellule")
  verifier_egale(dplyr::n_distinct(r$commune), 1202L,
                 "rangs LQ — les 1202 communes")
  verifier_ordinaux(r, "rangs LQ")

  # LQ d'emploi (A88) : 1196 communes retenues (1202 − 6 sous le plancher)
  lq_emploi <- calculer_lq_emploi_flores(donnees$flores_a88, "A88")$lq
  r_emploi <- attacher_rangs_lq_emploi(lq_emploi, base)
  verifier_egale(dplyr::n_distinct(r_emploi$commune), 1196L,
                 "rangs LQ d'emploi — les 1196 communes retenues")
  verifier_egale(nrow(r_emploi), nrow(lq_emploi),
                 "rangs LQ d'emploi — une ligne par cellule")
  verifier_ordinaux(r_emploi, "rangs LQ d'emploi")

  # score vert : 1202 communes, 0 suppression
  eco <- construire_eco_activites_economie(
    donnees$sirene_snapshot, artefact_egss())$table
  r_eco <- attacher_rangs_eco_activites(eco, base)
  verifier_egale(nrow(r_eco), 1202L, "rangs score vert — les 1202 communes")
  verifier_ordinaux(r_eco, "rangs score vert")

  # chômage : 1202 communes, une ligne par commune
  r_chomage <- attacher_rangs_chomage(
    construire_chomage_economie(donnees$rp_chomage)$table, base)
  verifier_egale(nrow(r_chomage), 1202L, "rangs chômage — les 1202 communes")
  verifier_egale(anyDuplicated(r_chomage$commune), 0L,
                 "rangs chômage — aucune ligne en double")
  verifier_ordinaux(r_chomage, "rangs chômage")

  invisible(TRUE)
}

# verifier_economie_e2e_reel ----------------------------------------------------
# Verrou du bloc converti de test-analytics-economie-e2e.R (T10) : le chaînon
# analytique complet sur les tables réelles — les comptes verrouillés des
# tables normalisées, des artefacts analytiques T1-T6 (la LQ Économie aux
# RÈGLES du grain A17 depuis l'issue #428 ; les autres artefacts aux comptes
# de leurs runs) et du payload publié (les trois clés de l'issue #131, une
# ligne par territoire). La stabilité octet-pour-octet entre deux runs reste la
# porte de test-targets-byte-identical.R (un target est un run unique). Les
# artefacts analytiques sont écrits dans un répertoire TEMPORAIRE (jamais la
# sortie analytique du run — pas de course avec publie_economie).
verifier_economie_e2e_reel <- function(donnees, base_epci) {
  comptes_normalises <- c(
    sirene_snapshot = 182247L, flores_a38 = 872652L, flores_a88 = 209148L,
    rp_emploi = 7212L, rp_chomage = 1202L * 3L
  )
  for (nom in names(comptes_normalises)) {
    verifier_egale(nrow(donnees[[nom]]), unname(comptes_normalises[[nom]]),
                   paste("Économie e2e — la table normalisée", nom))
  }

  base <- lire_epci(base_epci)
  sortie_analytiques <- tempfile("verif-economie-")
  dir.create(sortie_analytiques)
  analytiques <- construire_analytiques_economie(
    donnees, base, artefact_egss(), sortie = sortie_analytiques)

  # issue #428 — la LQ Économie n'y est plus un compte magique (135 784
  # cellules au grain sous-classe d'antan) : elle passe par les RÈGLES du
  # grain A17 ; les autres artefacts gardent leurs comptes verrouillés.
  comptes_analytiques <- c(
    lq_emploi_a88 = 22616L,
    eco_activites_economie = 1202L, dormitory_economie = 1202L,
    chomage_economie = 1202L
  )
  tables_analytiques <- list(
    lq_emploi_a88 = analytiques$lq_emploi_a88,
    eco_activites_economie = analytiques$eco_activites,
    dormitory_economie = analytiques$dortoir,
    chomage_economie = analytiques$chomage
  )
  for (nom in names(comptes_analytiques)) {
    verifier_egale(nrow(tables_analytiques[[nom]]),
                   unname(comptes_analytiques[[nom]]),
                   paste("Économie e2e — l'artefact analytique", nom))
  }
  verifier_forme_lq_a17(analytiques$lq, "Économie e2e — la LQ Économie")
  verifier_egale(nrow(analytiques$lq_emploi_a38), 16019L,
                 "Économie e2e — l'artefact support lq_emploi_a38")
  verifier_egale(nrow(analytiques$histoires_lq), 1202L * TOP_N_SPECIALISATIONS_LQ,
                 "Économie e2e — l'artefact support histoires_lq")
  verifier_forme_sidecar_m(analytiques$m, analytiques$lq,
                           "Économie e2e — l'artefact support m_economie")

  # #1057 : la référence est une entrée OBLIGATOIRE du payload. Le référentiel
  # canonique se construit depuis les mêmes épingles du cache que le run —
  # jamais depuis les lignes de faits du thème vérifié.
  reference <- reference_territoires_canonique_du_cache(
    dirname(dirname(base_epci))
  )
  payload <- construire_payload_economie(analytiques, base,
                                         vintages_economie(),
                                         reference = reference)
  comptes_payload <- c(
    indicateurs = 1268L * 3L, territoires = 1268L, apercu = 0L
  )
  verifier_egale(nrow(payload$indicateurs),
                 unname(comptes_payload[["indicateurs"]]),
                 "Économie e2e — le payload indicateurs")
  # issue #428 — vérité minimale : le compte d'antan (1268) datait d'AVANT la
  # #370, qui a retiré la lecture régionale Économie du payload. Depuis, chaque
  # territoire SAUF la région porte exactement UNE lecture résolue — la RÈGLE
  # remplace le compte figé (une lecture par territoire porteur).
  sans_region <- payload$territoires[payload$territoires$type != "region", ]
  verifier_egale(nrow(payload$histoires), nrow(sans_region),
                 paste("Économie e2e — le payload histoires (une lecture par",
                       "territoire porteur ; la région sans Histoire Économie",
                       "depuis #370)"))
  verifier_egale(nrow(payload$territoires),
                 unname(comptes_payload[["territoires"]]),
                 "Économie e2e — le payload territoires")
  verifier_egale(nrow(payload$apercu),
                 unname(comptes_payload[["apercu"]]),
                 "Économie e2e — le payload apercu (vide par gating)")
  verifier_egale(sort(unique(payload$indicateurs$key)),
                 c("chomage", "eco_activites", "effectifs_salaries"),
                 "Économie e2e — les trois clés publiées")
  for (cle in c("effectifs_salaries", "chomage", "eco_activites")) {
    verifier_egale(sum(payload$indicateurs$key == cle), 1268L,
                   paste("Économie e2e — la clé", cle, "sur 1268 territoires"))
  }

  invisible(TRUE)
}

# verifier_ravitaillement_mobilite ----------------------------------------------
# Le verrou des densités de ravitaillement (issue #953), isolé pour être testé
# sur son SEAM DE VÉRIFICATION avec des entrées synthétiques mélangées : les
# comptes et les ratios sont ALIGNÉS PAR CLÉ DE TERRITOIRE (jamais par
# recyclage positionnel d'un vecteur de codes) et la preuve comptable manquante
# est une erreur nommée, jamais un NA silencieux.
#   - le compte régional B316 est la somme des parties communales du
#     référentiel ; une observation BPE absente propage l'indisponibilité ;
#   - une commune couverte dont la BPE observe zéro station publie un zéro
#     (compte ET taux), jamais un NA ;
#   - un ratio EV/fuel publié exige ses deux comptes et un dénominateur > 0,
#     et recompose exactement le compte de bornes du territoire.
verifier_ravitaillement_mobilite <- function(offre, donnees, base, analytiques) {
  valeurs_scalaires <- function(code, key) {
    lignes <- offre[offre$key == key & is.na(offre$detail),
                    c("code", "value"), drop = FALSE]
    lignes$value[match(as.character(code), as.character(lignes$code))]
  }

  ref_communes <- sort(unique(as.character(base$CODGEO)))
  bpe <- donnees$stations_service
  if (!all(c("commune", "fuel") %in% names(bpe))) {
    stop("Verrou à données réelles cassé - Mobilité e2e : la table BPE ",
         "normalisée doit porter commune et fuel.", call. = FALSE)
  }
  bpe <- bpe[as.character(bpe$commune) %in% ref_communes,
             c("commune", "fuel"), drop = FALSE]
  obs <- tibble::tibble(commune = ref_communes) %>%
    dplyr::left_join(bpe, by = "commune")
  population <- analytiques$stationnement_velo_communes$population

  if (!anyNA(obs$fuel)) {
    verifier_egale(valeurs_scalaires("53", "stations_service"),
                   sum(obs$fuel),
                   "Mobilité e2e — les stations-service de la région")
    verifier_egale(
      round(valeurs_scalaires("53", "stations_service_1000"), 6),
      round(sum(obs$fuel) / sum(population) * 1000, 6),
      "Mobilité e2e — les stations-service / 1 000 hab. de la région")
  } else {
    # une observation absente propage l'indisponibilité — jamais un compte
    # régional amputé en silence, jamais un zéro inventé
    verifier_vrai(is.na(valeurs_scalaires("53", "stations_service")),
                  "Mobilité e2e",
                  "un compte régional de stations-service malgré une BPE incomplète")
    verifier_vrai(is.na(valeurs_scalaires("53", "stations_service_1000")),
                  "Mobilité e2e",
                  "un taux régional de stations-service malgré une BPE incomplète")
  }
  verifier_egale(
    round(valeurs_scalaires("53", "bornes_recharge_1000"), 6),
    round(valeurs_scalaires("53", "bornes_recharge") /
            sum(population) * 1000, 6),
    "Mobilité e2e — les bornes / 1 000 hab. de la région")

  # une observation BPE à zéro est un FAIT : le compte et son taux sont publiés
  # à zéro, jamais convertis en indisponibilité
  zeros <- as.character(obs$commune[!is.na(obs$fuel) & obs$fuel == 0])
  if (length(zeros) > 0L) {
    comptes <- valeurs_scalaires(zeros, "stations_service")
    taux <- valeurs_scalaires(zeros, "stations_service_1000")
    verifier_vrai(length(comptes) == length(zeros) &&
                    all(!is.na(comptes) & comptes == 0),
                  "Mobilité e2e",
                  "une commune couverte avec zéro station n'a pas son compte zéro")
    verifier_vrai(length(taux) == length(zeros) &&
                    all(!is.na(taux) & taux == 0),
                  "Mobilité e2e",
                  "une commune couverte avec zéro station n'a pas son taux zéro")
  }

  # la paire de ravitaillement : jointure PAR CODE (jamais une égalité
  # vectorielle recyclée), la preuve comptable manquante est explicite
  cles <- c("bornes_recharge", "stations_service",
            "bornes_ev_par_station_service")
  preuves <- offre[offre$key %in% cles & is.na(offre$detail) &
                     !is.na(offre$code), c("code", "key", "value"), drop = FALSE]
  preuves <- preuves[!duplicated(preuves[c("code", "key")]), , drop = FALSE]
  large <- tidyr::pivot_wider(preuves, names_from = "key", values_from = "value")
  for (colonne in cles) {
    if (!colonne %in% names(large)) large[[colonne]] <- NA_real_
  }
  avec_ratio <- large[!is.na(large$bornes_ev_par_station_service), , drop = FALSE]
  if (nrow(avec_ratio) > 0L) {
    verifier_vrai(all(!is.na(avec_ratio$bornes_recharge) &
                        !is.na(avec_ratio$stations_service)),
                  "Mobilité e2e",
                  "une preuve comptable manque pour un ratio EV/fuel publié")
    verifier_vrai(all(avec_ratio$stations_service > 0),
                  "Mobilité e2e",
                  "un ratio EV/fuel publié sans station-service")
    verifier_vrai(
      all(abs(avec_ratio$bornes_recharge -
                avec_ratio$bornes_ev_par_station_service *
                  avec_ratio$stations_service) < 1e-8),
      "Mobilité e2e",
      "le ratio EV/fuel ne recompose pas ses deux comptes")
  }
  invisible(TRUE)
}

# verifier_mobilite_e2e_reel ----------------------------------------------------
# Verrou des blocs convertis de test-analytics-mobilite-e2e.R : le chaînon
# retenu (#1048) sur les sources réelles — l'étage demande/réseaux, le
# sous-bloc « L'offre de mobilité alternative » (issue #140), la figure
# « L'offre cyclable » (issue #231) et le raccordement. Le snapshot porté,
# la couche bâtiments et les Stories ont été retirés. Les verrous de VALEUR
# d'Offre TC sont re-dérivés au republish (slice 4). `donnees` est le BRUT du
# thème (construire_donnees_mobilite — le spine d'adresses et les sources du
# sous-bloc normalisées y sont) ; `base_epci` est le chemin du référentiel
# extrait) ; les artefacts analytiques sont écrits dans un répertoire
# TEMPORAIRE (jamais la sortie analytique du run — pas de course avec
# publie_mobilite) ; `raccordement` est le chemin de l'épingle versionnée
# rendu par la cible du graphe, jamais un re-routage lancé par le verrou.
verifier_mobilite_e2e_reel <- function(donnees, base_epci, raccordement) {
  # BPE25 is an equipment-row source, normalized to one aggregate count per
  # commune.  Keep this at the real-data seam: a successful run must prove that
  # the B316 source was actually carried into the normalized theme input.
  stations <- donnees$stations_service
  verifier_egale(names(stations), c("commune", "fuel"),
                 "Mobilité e2e — la forme normalisée de BPE B316")
  verifier_egale(nrow(stations), 1202L,
                 "Mobilité e2e — les communes couvertes par BPE")
  verifier_egale(sum(stations$fuel > 0), 349L,
                 "Mobilité e2e — les communes avec B316")
  verifier_egale(dplyr::n_distinct(stations$commune), 1202L,
                 "Mobilité e2e — les communes BPE distinctes")
  verifier_egale(sum(stations$fuel), 567L,
                 "Mobilité e2e — le total des équipements B316")
  verifier_vrai(all(!is.na(stations$commune) & !is.na(stations$fuel) &
                      stations$fuel >= 0),
                "Mobilité e2e", "une valeur B316 normalisée invalide")

  base <- lire_epci(base_epci)
  sortie_analytiques <- tempfile("verif-mobilite-")
  dir.create(sortie_analytiques)
  analytiques <- construire_analytiques_mobilite(donnees, base,
                                                 sortie = sortie_analytiques)
  # Le verrou lit LA MÊME épingle canonique que la publication (theme_mobilite.R
  # : analytiques$raccordement <- lire_artefact_raccordement_national()) ; le
  # lecteur normalise le chemin rendu par la cible à la frontière (#1070),
  # jamais l'ancien artefact mairie ni son répertoire analytique disparu.
  analytiques$raccordement <- lire_artefact_raccordement_national(
    chemin_enveloppe = raccordement)

  # l'étage demande/réseaux (issue #139) : les parts voitures/ménage et les
  # longueurs/densités des réseaux aux comptes verrouillés. Depuis l'issue
  # #368, la demande publie les TROIS parties réelles (0 / 1 / 2+ — la
  # catégorie du milieu C1 est dans le cube RP et manquait au payload) : les
  # parts somment à 1 par territoire.
  vt <- analytiques$voitures_territoires
  verifier_egale(nrow(analytiques$voitures_communes), 1202L,
                 "Mobilité e2e — les voitures par commune")
  verifier_egale(nrow(vt), 3804L, "Mobilité e2e — les voitures par territoire (3 parts)")
  verifier_egale(sort(unique(vt$detail)),
                 c("deux_plus", "sans_voiture", "une_voiture"),
                 "Mobilité e2e — les trois parts voitures (0 / 1 / 2+, #368)")
  lire_vt <- function(code, detail) vt$value[vt$code == code & vt$detail == detail]
  verifier_egale(round(lire_vt("53", "sans_voiture"), 6), 0.118268,
                 "Mobilité e2e — la région sans voiture")
  verifier_egale(round(lire_vt("53", "une_voiture"), 6), 0.479502,
                 "Mobilité e2e — la région à 1 voiture")
  verifier_egale(round(lire_vt("53", "deux_plus"), 6), 0.402230,
                 "Mobilité e2e — la région à 2+ voitures")
  verifier_egale(round(lire_vt("35238", "sans_voiture"), 6), 0.319333,
                 "Mobilité e2e — Rennes sans voiture")
  verifier_egale(round(lire_vt("29083", "sans_voiture"), 6), 0.603082,
                 "Mobilité e2e — l'île de Sein sans voiture")
  verifier_vrai(all(!is.na(vt$value) & vt$value >= 0 & vt$value <= 1),
                "Mobilité e2e", "une part voitures/ménage hors [0, 1]")
  # les trois parts somment à 1 sur chaque territoire (la dimension CARS du
  # cube partitionne les ménages — tolérance 1e-6, l'arrondi flottant du cube)
  parts_par_code <- stats::aggregate(value ~ code, vt, sum)
  verifier_vrai(all(abs(parts_par_code$value - 1) < 1e-6),
                "Mobilité e2e", "les trois parts voitures ne somment pas à 1")

  rt <- analytiques$reseaux_territoires
  verifier_egale(nrow(analytiques$reseaux_communes), 1202L,
                 "Mobilité e2e — les réseaux par commune")
   verifier_egale(nrow(rt), 3804L, "Mobilité e2e — les réseaux par territoire")
  lire_rt <- function(code, detail) rt$value[rt$code == code & rt$detail == detail]
    # Verrous de VALEUR des couches dérivées de l'extrait OSM `latest` (les
    # modes t/c) : relatifs à l'ÉPOQUE du cache (issue #380) et au contrat
    # canonique des réseaux vraisemblablement accessibles (ADR-0029) —
    # re-baselinés à la précision naturelle (longueurs au 3ᵉ — le 6ᵉ chahute
    # entre extraits re-téléchargés) ; les modes b (Geovelo épinglé) restent
    # FORTS
   verifier_egale(round(lire_rt("53", "c_longueur"), 3), 93688.551,
                  "Mobilité e2e — les routes de la région")
   verifier_egale(round(lire_rt("53", "t_longueur"), 3), 46240.240,
                  "Mobilité e2e — les trottoirs de la région")
  verifier_egale(round(lire_rt("53", "b_longueur"), 3), 4940.309,
                 "Mobilité e2e — le réseau cyclable de la région (mode b)")
  verifier_egale(lire_rt("29083", "b_longueur"), 0,
                 "Mobilité e2e — l'île de Sein sans réseau cyclable")
   verifier_vrai(all(!is.na(rt$value) & rt$value >= 0),
                 "Mobilité e2e", "une longueur de réseau négative")

  # le sous-bloc « L'offre de mobilité alternative » (issue #140) : les
  # sources normalisées du BRUT et les artefacts du chaînon aux comptes
  # verrouillés. Korrigo (GTFS) et bornes (IRVE) sont des sources VIVANTES
  # (flux vivants) : leurs comptes sont relatifs à l'époque du cache (issue
  # #380) — re-baselinés sur le cache restauré (27 543 arrêts, 9 900 lignes /
  # 1 909 stations, 707 communes)
  verifier_egale(nrow(donnees$korrigo), 27543L,
                 "Mobilité e2e — les arrêts GTFS korrigo")
  verifier_egale(nrow(donnees$bornes_recharges), 9900L,
                 "Mobilité e2e — les points de charge")
  verifier_egale(nrow(donnees$stationnement_velo), 4808L,
                 "Mobilité e2e — le hub stationnement vélo")
  verifier_egale(nrow(analytiques$offre_tc_communes), 1200L,
                 "Mobilité e2e — l'offre TC par commune")
  verifier_egale(nrow(analytiques$bornes_communes), 707L,
                 "Mobilité e2e — les bornes par commune")
  verifier_egale(nrow(analytiques$stationnement_velo_communes), 1202L,
                 "Mobilité e2e — le stationnement vélo par commune")
  verifier_egale(nrow(analytiques$offre_cyclable_communes), 1202L,
                 "Mobilité e2e — l'offre cyclable par commune")
  # 10 142 lignes avant #369 + trois familles complètes ajoutées par #369
  # (1 268 territoires chacune) = 13 946 lignes, + les trois densités de
  # ravitaillement de #953 (une ligne par territoire et par clé).
  n_territoires_offre <- length(unique(analytiques$offre_territoires$code))
  verifier_egale(nrow(analytiques$offre_territoires),
                 13946L + 3L * n_territoires_offre,
                 "Mobilité e2e — l'offre par territoire")

  offre <- analytiques$offre_territoires
  # Alignement PAR CLÉ : un vecteur de codes ne se compare jamais positionnellement
  # à offre$code (le recyclage produirait des sous-ensembles faux et de
  # longueurs décalées). `match` lit le fait du code demandé.
  lire_offre <- function(code, key, detail = NA) {
    lignes <- offre[offre$key == key &
                      (if (is.na(detail)) is.na(offre$detail)
                       else offre$detail %in% detail),
                    c("code", "value"), drop = FALSE]
    lignes$value[match(as.character(code), as.character(lignes$code))]
  }
  ratio <- offre[offre$key == "bornes_ev_par_station_service", ]
  n_epci <- length(unique(base$EPCI[!is.na(base$EPCI)]))
  n_dep <- length(unique(base$DEP[!is.na(base$DEP)]))
  verifier_egale(nrow(ratio), nrow(base) + n_epci + n_dep + 1L,
                 "Mobilité e2e — le ratio B316 aux quatre niveaux")
  verifier_vrai(all(c("35238", "242900314", "35", "53") %in% ratio$code),
                "Mobilité e2e", "le ratio B316 n'atteint pas tous les niveaux")
  verifier_vrai(is.na(lire_offre("29083", "bornes_ev_par_station_service")),
                "Mobilité e2e",
                "un ratio EV/fuel publié sans station-service (dénominateur nul)")

  # Offre TC (#1048) — verrous STRUCTURELS. Le dénominateur est le nombre
  # d'adresses résidentielles du spine AEDAR. Les verrous de VALEUR exacts
  # (Rennes 0,9957 · région 0,5731 · Brest 0,9412 · Finistère 0,6761) reviennent
  # en slice 4, quand `data/raw` permet de les re-dériver sur le nouveau
  # dénominateur : ne pas les réécrire à la main ici.
  tc_communes <- analytiques$offre_tc_communes
  verifier_egale(nrow(tc_communes), 1200L,
                 "Mobilité e2e — les 1 200 communes de l'offre TC par adresse")
  verifier_egale(sum(!is.na(tc_communes$part_proche)), 1200L,
                 "Mobilité e2e — aucune part d'offre TC manquante par commune")
  verifier_vrai(all(tc_communes$n_adresses > 0L), "Mobilité e2e",
                "un dénominateur d'adresses résidentielles non positif")
  tc_valeurs <- offre$value[offre$key == "offre_tc"]
  verifier_egale(length(tc_valeurs), nrow(base) + n_epci + n_dep + 1L,
                 "Mobilité e2e — l'offre TC aux quatre niveaux")
  verifier_vrai(all(!is.na(tc_valeurs)), "Mobilité e2e",
                "une part d'offre TC absente du payload")
  verifier_vrai(all(tc_valeurs >= 0 & tc_valeurs <= 1), "Mobilité e2e",
                "une part d'offre TC hors [0, 1]")

  # Les bornes (IRVE) sont une source VIVANTE (issue #380) : verrous de
  # VALEUR relatifs à l'époque du cache (comptes exacts, re-baselinés)
  verifier_egale(lire_offre("53", "bornes_recharge"), 1909L,
                 "Mobilité e2e — les bornes de la région")
  verifier_egale(lire_offre("35", "bornes_recharge"), 623L,
                 "Mobilité e2e — les bornes de l'Ille-et-Vilaine")
  # les densités de ravitaillement (issue #953) : la règle est portée par son
  # seam de vérification (testé sur des entrées synthétiques mélangées) — le
  # compte B316 somme les parties, les taux se recalculent, une observation
  # absente propage l'indisponibilité, un zéro observé reste un fait. Aucun
  # chiffre d'époque n'est recopié : le verrou porte la RÈGLE.
  verifier_ravitaillement_mobilite(offre, donnees, base, analytiques)
  # l'île de Sein est COUVERTE par la BPE avec un zéro OBSERVÉ : son compte de
  # stations reste 0 ; seul le ratio EV/fuel, au dénominateur nul, est
  # indisponible.
  verifier_egale(lire_offre("29083", "stations_service"), 0,
                 "Mobilité e2e — l'île de Sein couverte avec zéro station")
  verifier_vrai(is.na(lire_offre("29083", "bornes_ev_par_station_service")),
                "Mobilité e2e",
                "un ratio EV/fuel publié sans station-service")
  verifier_egale(round(lire_offre("53", "places_stationnement_velo_1000"), 4),
                 18.4989, "Mobilité e2e — le stationnement vélo de la région")
  verifier_egale(round(lire_offre("35238", "places_stationnement_velo_1000"), 4),
                 72.8043, "Mobilité e2e — le stationnement vélo de Rennes")
  verifier_vrai(all(!is.na(offre$value[offre$key == "offre_tc"]) &
                      offre$value[offre$key == "offre_tc"] >= 0 &
                      offre$value[offre$key == "offre_tc"] <= 1),
                "Mobilité e2e", "une part d'offre TC hors [0, 1]")

  # la figure « L'offre cyclable » (issue #231) : la longueur en GÉOMÉTRIE
  # UNIQUE (protégé + partagé = total) et les km/1 000 hab recomposés
  lire_cyclable <- function(code, detail) {
    lire_offre(code, "offre_cyclable", detail)
  }
  verifier_egale(round(lire_cyclable("53", "protege_longueur"), 3), 3290.494,
                 "Mobilité e2e — le protégé de la région")
  verifier_egale(round(lire_cyclable("53", "partage_longueur"), 3), 1622.739,
                 "Mobilité e2e — le partagé de la région")
  verifier_egale(round(lire_cyclable("53", "total_longueur"), 3), 4913.233,
                 "Mobilité e2e — le total cyclable de la région")
  verifier_egale(round(lire_cyclable("35238", "total_longueur"), 3), 263.108,
                 "Mobilité e2e — le total cyclable de Rennes")
  verifier_egale(lire_cyclable("22241", "total_longueur"), 0,
                 "Mobilité e2e — Plumieux sans aménagement (le zéro porté)")
  verifier_egale(lire_cyclable("29083", "total_longueur"), 0,
                 "Mobilité e2e — l'île de Sein sans aménagement")
  verifier_egale(round(lire_cyclable("29084", "partage_longueur"), 3), 7.239,
                 "Mobilité e2e — le partagé de l'île de Molène")
  v_cyclable <- offre$value[offre$key == "offre_cyclable"]
  verifier_vrai(all(!is.na(v_cyclable) & v_cyclable >= 0),
                "Mobilité e2e", "une longueur cyclable négative")

  # la couche communale de l'offre cyclable : UNE ligne par commune de
  # l'univers population, 437 communes à zéro (un fait, jamais une ligne
  # manquante)
  cyclable_communes <- analytiques$offre_cyclable_communes
  verifier_egale(nrow(cyclable_communes), 1202L,
                 "Mobilité e2e — l'offre cyclable par commune")
  verifier_egale(sum(cyclable_communes$total_longueur == 0), 437L,
                 "Mobilité e2e — les communes sans aménagement")

  # les Stories résolues (issue #312) : une lecture par (territoire, groupe),
  # la saillance vélo REMPLACE le défaut là où elle tire (139 territoires)
  # #1057 : la référence canonique est une entrée OBLIGATOIRE du payload.
  reference <- reference_territoires_canonique_du_cache(
    dirname(dirname(base_epci))
  )
  payload <- construire_payload_mobilite(analytiques, base,
                                          vintages_mobilite(),
                                          reference = reference)
  verifier_egale(sum(payload$indicateurs$key ==
                       "bornes_ev_par_station_service"), nrow(ratio),
                 "Mobilité e2e — la clé B316 du payload publié")

  # les rangs-en-contexte du payload (ADR-0021, #380) : des ORDINAUX
  # directionnels (Rennes 1re de Rennes Métropole — jamais une fraction), une
  # commune avec EPCI n'a PAS de rang régional (le repli régional n'est que
  # pour les communes SANS EPCI), rang_dep est vide partout (la colonne reste
   # dans le contrat, NA). Le payload porte la taille target-scoped des
   # bâtiments ainsi que les faits de Mobilité, et voitures_menage porte ses
   # trois parts (1268 territoires × 3).
  verifier_egale(sum(payload$indicateurs$key == "voitures_menage"), 3804L,
                 "Mobilité e2e — les trois parts voitures du payload")
  lire_ind <- function(territoire, key, detail) {
    payload$indicateurs[
      payload$indicateurs$territoire == territoire &
        payload$indicateurs$key == key &
        ifelse(is.na(payload$indicateurs$detail), is.na(detail),
               payload$indicateurs$detail == detail), ]
  }
  rennes_sans <- lire_ind("35238", "voitures_menage", "sans_voiture")
  verifier_egale(rennes_sans$rang_epci, 1L,
                 "Mobilité e2e — Rennes 1re de Rennes Métropole (rang ordinal)")
  verifier_vrai(is.na(rennes_sans$rang_reg),
                "Mobilité e2e", "un rang régional pour une commune avec EPCI")
  sein_sans <- lire_ind("29083", "voitures_menage", "sans_voiture")
  verifier_vrai(is.na(sein_sans$rang_dep),
                "Mobilité e2e", "un rang départemental porté (rang_dep vide par design)")
  invisible(TRUE)
}

# verifier_subventions_reel -----------------------------------------------------
# Verrou du bloc converti de test-subventions.R : l'export SCDL réel
# s'ingère et agrège sans dérive de format — la forme du contrat, l'ancre
# TOUJOURS valide (le marqueur « Non disponible » n'y figure jamais), des
# montants non négatifs, l'année complète la plus récente porte des
# conventions, et les agrégats sont estampillés du vintage hebdomadaire.
# `scdl` est le chemin de l'export (résolu par le manifeste), `base_epci`
# celui du référentiel partagé extrait.
verifier_subventions_reel <- function(scdl, base_epci) {
  conventions <- normaliser_subventions_scdl(lire_subventions_scdl(scdl))

  verifier_egale(names(conventions),
                 c("commune", "annee", "programme_libl", "montant"),
                 "subventions — la forme du contrat")
  verifier_vrai(all(grepl("^[0-9]{5}$", conventions$commune)),
                "subventions", "un code commune hors format INSEE")
  verifier_vrai(all(conventions$montant >= 0),
                "subventions", "un montant négatif")

  annee_ref <- annee_reference_subventions(conventions$annee)
  verifier_vrai(annee_ref %in% conventions$annee,
                "subventions", "l'année de référence sans convention")

  base <- lire_epci(base_epci)
  analytiques <- construire_analytiques_subventions(
    conventions, base, vintages_subventions())
  ref <- vintages_subventions()
  verifier_vrai(all(analytiques$vintage_source == ref$source),
                "subventions", "une estampille de source hors contrat")
  verifier_vrai(all(analytiques$montant >= 0),
                "subventions", "un montant d'agrégat négatif")

  invisible(TRUE)
}

# verifier_programmes_reel ------------------------------------------------------
# Verrou des blocs convertis de test-programmes-e2e.R : les inputs FERMÉS du
# contrat (les listes lauréates, qui ne grandissent pas — ACV 11 communes
# NOMINATIVEMENT, PVD 135, CRTE 40 contrats, Territoires d'industrie 10) et
# les règles de dérivation (le drapeau « convention valant ORT » ⟺ la commune
# est présente AU STATUT « Signée » dans le fichier ORT, les lignes ORT des
# seules communes signées NON labellisées, jamais de double badge, une ligne
# par (territoire × sigle), les estampilles vintage de SA source) — la RÈGLE,
# jamais un compte figé pour la partie dérivée. Les agrégats de subventions
# du payload partagé sont vérifiés par verifier_subventions_reel. TOUS les
# chemins arrivent en arguments (résolus par le manifeste — la REGISTRE
# VERIFICATIONS_PROGRAMMES de _targets.R), jamais un nom de fichier en dur.
verifier_programmes_reel <- function(acv, pvd, crte, ti, ort, scdl,
                                     base_epci) {
  donnees <- list(
    acv = lire_acv(acv),
    pvd = lire_pvd(pvd),
    crte = lire_crte(crte),
    territoires_industrie = lire_ti(ti),
    ort = lire_ort(ort)
  )
  base <- lire_epci(base_epci)
  vintages <- vintages_programmes()
  membres <- construire_membres_programmes(donnees, base, vintages)

  # le contrat de forme ET la validation forte du payload (elle s'arrête
  # elle-même bruyamment sur toute dérive)
  verifier_egale(names(membres),
                 c("territoire", "type", "sigle", "convention_valant_ort",
                   "vintage_source", "vintage_version",
                   "vintage_date_reference", "vintage_date_publication"),
                 "programmes — la forme de la table des adhésions")
  verifier_membres_programmes(membres, base, vintages)

  # les inputs FERMÉS : ACV 11 villes lauréates, NOMINATIVEMENT
  acv <- membres[membres$sigle == "ACV", ]
  verifier_egale(nrow(acv), 11L, "programmes — les villes ACV")
  # ACV : le drapeau suit la RÈGLE (TRUE ⟺ présente AU STATUT « Signée » dans
  # le fichier ORT réel), jamais un compte — Lannion (22113) porte une
  # convention « Terminée » dans le cache restauré : le drapeau est FALSE par
  # la règle, la ville reste ACV (l'input FERMÉ, verrouillé nominativement —
  # #380, politique des verrous de valeur).
  ort_source <- donnees$ort
  signees_ort <- unique(ort_source$code_commune[ort_source$statut == "Signée"])
  verifier_egale(acv$convention_valant_ort, acv$territoire %in% signees_ort,
                 "programmes - le drapeau ACV suit la règle « Signée »")
  verifier_egale(sort(acv$territoire),
                 sort(c("22113", "22278", "29151", "29232", "35115", "35236",
                        "35288", "35360", "56121", "56178", "56260")),
                 "programmes — les 11 villes ACV lauréates")

  # PVD : 135 communes — le drapeau suit la RÈGLE (TRUE ⟺ présente AU STATUT
  # « Signée » dans le fichier ORT réel), jamais un compte
  pvd <- membres[membres$sigle == "PVD", ]
  verifier_egale(nrow(pvd), 135L, "programmes — les communes PVD")
  verifier_egale(pvd$convention_valant_ort, pvd$territoire %in% signees_ort,
                 "programmes — le drapeau PVD suit la règle « Signée »")

  # les règles de badge : JAMAIS de double badge (aucune commune labellisée
  # ne porte de ligne ORT), les lignes ORT = les communes signées NON
  # labellisées, le drapeau n'existe que sur les labels
  ort <- membres[membres$sigle == "ORT", ]
  labellisees <- c(acv$territoire, pvd$territoire)
  verifier_vrai(!any(ort$territoire[ort$type == "commune"] %in% labellisees),
                "programmes", "un double badge (une commune labellisée avec une ligne ORT)")
  ort_communes_attendues <- setdiff(signees_ort, labellisees)
  verifier_egale(sort(ort$territoire[ort$type == "commune"]),
                 sort(ort_communes_attendues),
                 "programmes — les lignes ORT des communes signées non labellisées")
  verifier_vrai(all(membres$convention_valant_ort[membres$sigle == "ORT"] == FALSE),
                "programmes", "le drapeau ORT sur une ligne ORT")

  # CRTE : les 40 contrats bretons (l'input FERMÉ) — les lignes EPCI sont les
  # paires (contrat × EPCI signataire) du fichier de suivi, une ligne par
  # EPCI, aucun doublon
  crte <- membres[membres$sigle == "CRTE", ]
  crte_source <- donnees$crte
  verifier_egale(length(unique(crte_source$id_crte)), 40L,
                 "programmes — les contrats CRTE")
  epcis_crte_attendus <- unique(crte_source$siren_epci[
    crte_source$nature_juridique != "COM"])
  verifier_egale(sort(crte$territoire), sort(epcis_crte_attendus),
                 "programmes — les EPCIs signataires CRTE")
  verifier_egale(anyDuplicated(crte[c("territoire", "sigle")]), 0L,
                 "programmes — aucun doublon CRTE")

  # Territoires d'industrie : les 10 territoires (l'input FERMÉ)
  ti <- membres[membres$sigle == "Territoires d'industrie", ]
  ti_source <- donnees$territoires_industrie
  verifier_egale(length(unique(ti_source$id_ti)), 10L,
                 "programmes — les territoires d'industrie")
  verifier_egale(sort(ti$territoire), sort(unique(ti_source$siren_epci)),
                 "programmes — les EPCIs des territoires d'industrie")

  # les estampilles vintage : les mises à jour ANCT sur les labels/contrats,
  # l'actualisation PAR LIGNE sur l'ORT (jamais la métadonnée de page)
  verifier_vrai(all(acv$vintage_source ==
                      vintages_programmes()$source[
                        vintages_programmes()$id == "acv"]),
                "programmes", "l'estampille ACV hors contrat")
  # #1113 : la version du JEU ORT est dérivée de l'actualisation maximale des
  # lignes lues (base `contenu_date`) — l'estampille de chaque ligne ORT doit
  # l'égaler, sans aucune date de publication inventée. Rien n'est figé ici :
  # la valeur attendue vient des données du run, pas d'un littéral de contrat.
  version_ort_attendue <- format(max(as.Date(ort_source$actualisation)), "%Y-%m")
  verifier_vrai(all(ort$vintage_version == version_ort_attendue),
                "programmes", "le vintage ORT ne vient pas de l'actualisation maximale")
  verifier_vrai(all(is.na(ort$vintage_date_publication)),
                "programmes", "une date de publication sur une ligne ORT")
  verifier_vrai(all(!is.na(ort$vintage_date_reference) &
                      grepl("^[0-9]{4}-[0-9]{2}-[0-9]{2}$",
                            ort$vintage_date_reference)),
                "programmes", "une actualisation ORT hors format ISO")

  # une ligne par (territoire × sigle) — l'ingestion ne duplique rien
  verifier_egale(anyDuplicated(membres[c("territoire", "sigle")]), 0L,
                 "programmes — aucune ligne en double")

  # les agrégats de subventions du payload partagé (issue #178) : la table
  # estampillée hebdomadaire de la source SCDL, avec une ligne de région
  conventions <- normaliser_subventions_scdl(lire_subventions_scdl(scdl))
  subventions <- construire_analytiques_subventions(conventions, base,
                                                    vintages)
  verifier_vrai(all(subventions$vintage_source ==
                      vintages_programmes()$source[
                        vintages_programmes()$id == "subventions_scdl"]),
                "programmes", "une estampille de subventions hors contrat")
  verifier_vrai(all(!is.na(subventions$montant)),
                "programmes", "un montant de subventions NA")
  verifier_vrai(any(subventions$type == "region"),
                "programmes", "aucune ligne de région dans les subventions")
  verifier_vrai(sum(subventions$montant[subventions$type == "region"]) > 0,
                "programmes", "le total régional des subventions est nul")

  invisible(TRUE)
}
