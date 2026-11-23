# Source vintage bases (issue #1103) --------------------------------------------
# One closed vocabulary, declared EXPLICITLY for every manifest source. There is
# no implicit default and NO load-time mutation of the manifests: the registry
# is resolved at the USE sites (download_sources, vintages_depuis_manifest,
# relock_sources) through `base_vintage()` / `declarer_bases()`. An unknown id
# fails loudly — no DESCRIPTION Collate order and no namespace rewriting.
#
#   declaree          dated release whose identity IS the vintage (INSEE RP/DVF/
#                     BPE, OCS-GE millesimes, frozen static snapshots)
#   contenu_date      file carrying its own update date (bornes `date_maj`, ORT
#                     `Dernière actualisation` par ligne)
#   contenu_timestamp OSM PBF HeaderBlock osmosis_replication_timestamp
#   telechargement    rolling export with no stable content date (ODS exports,
#                     data-fair/DPE, SIRENE, SNCF GTFS, DILA all_latest, any live
#                     `latest` alias): vintage = acquisition date

# BASIS_VINTAGE ------------------------------------------------------------------
BASIS_VINTAGE <- c("declaree", "contenu_date", "contenu_timestamp", "telechargement")
BASIS_VINTAGE_DERIVES <- c("contenu_date", "contenu_timestamp", "telechargement")

# VINTAGE_BASIS_PAR_ID -----------------------------------------------------------
# The single source of truth for the basis of every manifest source. Keys are
# manifest source ids (an id shared by several manifests has ONE basis).
# Rolling exports are deliberately `telechargement`: ODS exports/csv send no
# content date, data-fair DPE is a rolling base, SIRENE's "coupe" label is a
# contract vintage and not a stable content date, SNCF/DILA are rolling feeds.
# ORT is a Grist XLSX BUT carries its own content date (column « Dernière
# actualisation » on every row, read by lire_ort()) — decision #1113: its basis
# is `contenu_date`, the dataset vintage is the newest row actualisation.
# DVF keeps `declaree`: its URL carries an explicit year
# (`geo-dvf/latest/csv/<year>/...`) and the year in the filename is the
# immutable release identity — the `latest` alias only moves the whole tree.
VINTAGE_BASIS_PAR_ID <- c(
  # Shared referential + Démographie + classes
  classe_densite_communale = "declaree",
  classe_littorale_communale = "declaree",
  serie_historique = "declaree",
  menages = "declaree",
  age_detail = "declaree",
  epci = "declaree",
  # Économie
  # SIRENE est un snapshot MENSUEL dont la coupe est portée par la donnée
  # elle-même (VINTAGE_SIRENE_SNAPSHOT = "2026-10", fichier
  # sirene_snapshot_2026-10.csv, référence 2026-09-30) : le millésime de la
  # coupe EST la vintage, pas le mois du téléchargement (#1128). Le relock
  # d'octobre avait dérivé "2026-11" (date d'acquisition) et publié une vintage
  # fausse ; la base `declaree` republie la coupe déclarée.
  sirene_snapshot = "declaree",
  flores_a38 = "declaree",
  flores_a88 = "declaree",
  rp_emploi = "declaree",
  rp_chomage = "declaree",
  # Habitat
  logements = "declaree",
  # Milieux
  consoenaf = "declaree",
  # Mobilité
  rp_logement_princ = "declaree",
  osm_reseaux = "contenu_timestamp",
  `bornes-recharges` = "contenu_date",
  korrigo = "telechargement",
  amenagements_cyclables = "declaree",
  communes_limites = "telechargement",
  `stationnement-velo` = "declaree",
  bpe_b316 = "declaree",
  cog_passage = "declaree",
  sncf_voyageurs = "telechargement",
  dila_bdl = "telechargement",
  # Programmes
  territoires_industrie = "telechargement",
  ort = "contenu_date",
  # #1128 : la source SCDL porte une vintage DÉCLARÉE explicite (2026-08-05,
  # référence et publication 2026-08-05) que le manifeste ET la métadonnée du
  # producteur partagent. La dérivation #1105 l'avait remplacée par le mois
  # d'acquisition (2026-11), faisant échouer la garde de cohérence des subventions
  # annuelles en production. Le millésime déclaré est l'identité de la coupe.
  subventions_scdl = "declaree"
)
# DVF: twenty year/département releases, vintage = the year in the URL/filename.
VINTAGE_BASIS_PAR_ID <- c(VINTAGE_BASIS_PAR_ID, stats::setNames(
  rep("declaree", 20L),
  paste0("dvf_", rep(2021:2025, each = 4L), "_dep", rep(c(22, 29, 35, 56), 5L))
))
# OCS-GE artificialisation states + correctif patches: millesimed releases.
VINTAGE_BASIS_PAR_ID <- c(VINTAGE_BASIS_PAR_ID, stats::setNames(
  rep("declaree", 11L),
  c(
    "ocsge_artificialisation_22_2021", "ocsge_artificialisation_22_2025",
    "ocsge_artificialisation_29_2021", "ocsge_artificialisation_29_2024",
    "ocsge_artificialisation_35_2020", "ocsge_artificialisation_35_2023",
    "ocsge_artificialisation_56_2022", "ocsge_artificialisation_56_2024",
    "ocsge_patch_correctif_22", "ocsge_patch_correctif_29",
    "ocsge_patch_correctif_56"
  )
))
# OCS-GE road-surface states (Mobilité).
VINTAGE_BASIS_PAR_ID <- c(VINTAGE_BASIS_PAR_ID, stats::setNames(
  rep("declaree", 4L),
  c(
    "ocsge_reseaux_22_2025", "ocsge_reseaux_29_2024",
    "ocsge_reseaux_35_2023", "ocsge_reseaux_56_2024"
  )
))
# ADEME DPE data-fair API pulls: rolling base, vintage = pull/acquisition date.
VINTAGE_BASIS_PAR_ID <- c(VINTAGE_BASIS_PAR_ID, stats::setNames(
  rep("telechargement", 4L),
  paste0("dpe_", c(22, 29, 35, 56))
))
# ANCT programme lists on static.data.gouv: dated releases.
VINTAGE_BASIS_PAR_ID <- c(VINTAGE_BASIS_PAR_ID, c(
  acv = "declaree", pvd = "declaree", crte = "declaree"
))

# CONTENT_DATE_EXTRACTOR_PAR_ID --------------------------------------------------
# One content-date extractor per `contenu_date` source, keyed by source id,
# declared next to the basis registry (issue #1113). Values are the NAMES of
# extractor functions, resolved lazily at call time by extracteur_date_contenu()
# so there is no DESCRIPTION Collate dependency: every extractor returns the
# max content date found in the file (a Date), or NULL when none is readable.
# A `contenu_date` source with no registration is a contract error, enforced by
# test-source-basis.R. `deriver_vintage()` falls back to `telechargement` when
# the extractor finds no date, recording the basis it actually used.
CONTENT_DATE_EXTRACTOR_PAR_ID <- c(
  `bornes-recharges` = "deriver_date_maj",
  ort = "deriver_actualisation_ort"
)

extracteur_date_contenu <- function(id) {
  nom <- unname(CONTENT_DATE_EXTRACTOR_PAR_ID[as.character(id)])
  if (length(nom) != 1L || is.na(nom) || !nzchar(nom)) {
    stop("Aucun extracteur de date de contenu (issue #1113) pour : ",
         as.character(id), ".", call. = FALSE)
  }
  get(nom, envir = asNamespace("lusk"), mode = "function", inherits = FALSE)
}

# base_vintage -------------------------------------------------------------------
# The single resolver for EVERY source the pipeline can digest (issue #1122):
# manifest ids from VINTAGE_BASIS_PAR_ID AND non-manifest network reads from
# LECTURES_RESEAU (source_digests.R — the three Admin Express WFS layers
# `geometrie_{communes,epcis,departements}`, basis `telechargement`). There is
# NO second, merged registry: both existing sources of truth are consulted
# here, at call time, so a new source declared in either one resolves at once.
# An id in neither stays a hard error — a new source cannot inherit a basis
# silently. With no basis resolver covering the whole run, relock_sources()
# could never relock a complete run and the release guard could never pass.
base_vintage <- function(id) {
  id <- as.character(id)
  base <- unname(VINTAGE_BASIS_PAR_ID[id])
  if (length(base) != 1L || is.na(base) || !nzchar(base)) {
    lecture <- LECTURES_RESEAU[[id]]
    if (!is.null(lecture)) base <- champ_caractere(lecture$vintage_basis)
  }
  if (length(base) != 1L || is.na(base) || !nzchar(base) || !base %in% BASIS_VINTAGE) {
    stop("Aucune base de vintage déclarée (issue #1103/#1122) pour : ",
         id, ".", call. = FALSE)
  }
  base
}

# declarer_bases -----------------------------------------------------------------
# Resolve the declared `vintage_basis` for every row of a manifest, at the use
# site. Unknown ids are a hard error (no default). An existing inline column
# must agree with the registry, so a stale literal cannot survive unnoticed.
declarer_bases <- function(manifest) {
  if (!"id" %in% names(manifest)) {
    stop("Manifeste sans colonne `id` — base de vintage indéterminable.", call. = FALSE)
  }
  ids <- as.character(manifest$id)
  registre <- VINTAGE_BASIS_PAR_ID[ids]
  declarees <- if ("vintage_basis" %in% names(manifest)) {
    as.character(manifest$vintage_basis)
  } else {
    rep(NA_character_, length(ids))
  }
  connues <- !is.na(registre)
  bases <- declarees
  # Le registre est AUTORITAIRE pour les sources de manifeste réelles. Les ids
  # synthétiques de tests (absents du registre) doivent porter une déclaration
  # explicite dans leur propre colonne — il n'y a toujours aucun défaut.
  bases[connues] <- as.character(registre[connues])
  manquantes <- ids[is.na(bases) | !nzchar(bases)]
  if (length(manquantes)) {
    stop(
      "Aucune base de vintage déclarée (issue #1103) pour : ",
      paste(unique(manquantes), collapse = ", "), ".",
      call. = FALSE
    )
  }
  invalides <- unique(bases[!bases %in% BASIS_VINTAGE])
  if (length(invalides)) {
    stop("Base de vintage inconnue : ", paste(invalides, collapse = ", "), ".",
         call. = FALSE)
  }
  divergeantes <- ids[connues & !is.na(declarees) & declarees != bases]
  if (length(divergeantes)) {
    stop(
      "Base de vintage déclarée en désaccord avec le registre pour : ",
      paste(unique(divergeantes), collapse = ", "), ".",
      call. = FALSE
    )
  }
  manifest$vintage_basis <- bases
  manifest
}
