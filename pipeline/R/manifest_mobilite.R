# manifest_mobilite -------------------------------------------------------------
# Le fragment de la source « mobilite_snapshot » du thème Mobilité (issue #137,
# tracer bullet) : le snapshot PORTÉ de l'analyse d'accessibilité « Vingt
# minutes sans voiture » (docs/adr/0012-mobilite-flagship-design.md) — le
# fichier de production bretagne_mobility_super_dashboard_gravity.csv
# (1 200 communes × 2 061 colonnes, niveaux _epci/_dep/_reg inclus). Le thème
# est un INSTANTANÉ (horloge lente, décision ADR-0012 point 3) : la date de
# référence épinglée est la date d'instantané de l'analyse (la génération du
# fichier, 2026-02-28 — les données de référence BPE 2024 · OSM 02-2026 ·
# BDNB 2025-07), la date de publication est la date du portage dans le
# pipeline (2026-08-06). Une seule source, un fragment — comme les manifestes
# Démographie/Habitat, la convention des 11 colonnes standard s'applique.
#
# Ce qui est EXPLICITEMENT HORS contrat (guardrails du PRD #136) :
#   - l'artefact non-production indicateurs_summarized_communes.csv (qui a
#     montré des deltas vélo NÉGATIFS) n'est JAMAIS une base — le contrat de
#     la source refuse tout autre nom de fichier ;
#   - aucune ingestion du dashboard original (E:\Website\Data_handling) au-delà
#     du fichier porté : le portage EST le fichier, le cache est le CSV ;
#   - la matrice complète (le super dashboard) reste un artefact interne —
#     jamais publiée dans le payload (leçon de l'issue #131).
#
# Mode : « manuel » (ADR-0004) — jamais de cron : le snapshot est porté à la
# main, son rafraîchissement suit l'horloge lente de l'analyse (BPE annuel,
# réseaux rarement, calcul lourd), pas un cadencement CI. Type : « fichier » —
# le cache est le CSV porté (intégrité vérifiée par verifier_fichier). Licence
# : « odbl » — l'analyse consomme l'OSM (réseaux, ADR-0001) : attribution
# « © OpenStreetMap contributors » + lien ODbL portée par la note et la
# Méthodes du thème.

# VINTAGE_MOBILITE_SNAPSHOT -----------------------------------------------------
# Le millésime du snapshot porté : l'analyse a été figée le 2026-02-28 (la
# date de génération du fichier de production — ses données de référence sont
# BPE 2024 · OSM 02-2026 · BDNB 2025-07). La RÉFÉRENCE du vintage est CETTE
# date d'instantané (ce que « l'analyse du 28 février 2026 » veut dire) ; la
# PUBLICATION est la date du portage dans le pipeline (2026-08-06 — le jour où
# le snapshot est devenu la source du thème). Les deux dates sont la vérité de
# la source, jamais alignées sur un tampon de thème.
VINTAGE_MOBILITE_SNAPSHOT <- "2026-02"
DATE_REFERENCE_MOBILITE_SNAPSHOT <- "2026-02-28"
DATE_PUBLICATION_MOBILITE_SNAPSHOT <- "2026-08-06"

# MANIFEST_MOBILITE --------------------------------------------------------------
# Les 11 colonnes standard du manifeste (la même forme que SIRENE / Flores /
# RP / Habitat), une ligne : la source portée. `url` pointe le fichier de
# production original (une URL file:// — la source n'a pas de point de
# publication public ; le mode « manuel » fait que le cron ne la touche
# jamais, et le fichier est toujours présent dans le cache du worktree).
MANIFEST_MOBILITE <- tibble::tribble(
  ~id, ~source, ~url, ~fichier, ~vintage, ~date_reference,
  ~date_publication, ~licence, ~note, ~mode, ~type,
  "mobilite_snapshot",
  "Lusk — analyse d'accessibilité « Vingt minutes sans voiture » (analyse portée, BPE 2024 · OSM 02-2026 · BDNB 2025-07)",
  "file:///E:/Website/Data_handling/bretagne_mobility_super_dashboard_gravity.csv",
  "bretagne_mobility_super_dashboard_gravity.csv",
  VINTAGE_MOBILITE_SNAPSHOT,
  DATE_REFERENCE_MOBILITE_SNAPSHOT,
  DATE_PUBLICATION_MOBILITE_SNAPSHOT,
  "odbl",
  paste0(
    "Le snapshot PORTÉ de l'analyse d'accessibilité « Vingt minutes sans ",
    "voiture » (le flagship, docs/adr/0012) : le fichier de production ",
    "bretagne_mobility_super_dashboard_gravity.csv (1 200 communes × 2 061 ",
    "colonnes, les niveaux _epci/_dep/_reg inclus), figé le 2026-02-28 — les ",
    "données de référence BPE 2024 · OSM 02-2026 · BDNB 2025-07, calcul par ",
    "bâtiment (1,2 M de bâtiments résidentiels, routage R5, cap 20 minutes). ",
    "JAMAIS l'artefact non-production indicateurs_summarized_communes.csv : il ",
    "a montré des deltas vélo NÉGATIFS (le contrat refuse tout autre nom de ",
    "fichier). Le portage EST le fichier : le cache est le CSV, aucune autre ",
    "ingestion du dashboard original. La matrice complète du super dashboard ",
    "reste un artefact interne — jamais publiée dans le payload (leçon de ",
    "l'issue #131). INSTANTANÉ sur horloge lente : la date de référence est la ",
    "date d'instantané de l'analyse, la publication la date du portage — le ",
    "thème ne prétend jamais être plus frais que son calcul. Attribution ",
    "ODbL : l'analyse consomme l'OSM (réseaux) — © OpenStreetMap contributors, ",
    "licence ODbL (ADR-0001), code de l'analyse publié avec la Méthodes du thème."
  ),
  "manuel", "fichier"
)

# verifier_contrat_mobilite_snapshot ---------------------------------------------
# La VALIDATION du contrat du manifeste (la discipline des fragments, comme
# verifier_contrat_sirene_snapshot) : le contrat épingle LE fichier de
# production porté, jamais l'artefact non-production. Elle s'exécute sur le
# manifeste réel ET sur des fixtures négatives : toute violation — id hors
# contrat, fichier hors contrat, dates mal formées, publication antérieure à
# la référence, licence non ODbL, mode non manuel — échoue bruyamment en
# nommant le champ fautif.
verifier_contrat_mobilite_snapshot <- function(manifest) {
  manquer <- function(champ, detail) {
    stop(sprintf("Contrat Mobilité snapshot violé — %s : %s.", champ, detail),
         call. = FALSE)
  }
  valeur <- function(champ) {
    x <- manifest[[champ]]
    if (is.null(x) || length(x) == 0) NA_character_ else as.character(x[1])
  }

  # UNE source, un id unique
  if (!inherits(manifest, "tbl_df")) {
    manquer("forme", "le manifeste doit être un tibble")
  }
  if (nrow(manifest) != 1L) {
    manquer("id", "le contrat épingle UNE source — une seule ligne")
  }
  if (anyDuplicated(manifest$id)) manquer("id", "id dupliqué")
  if (valeur("id") != "mobilite_snapshot") {
    manquer("id", "id attendu : 'mobilite_snapshot'")
  }

  # LE fichier de production, jamais l'artefact non-production aux deltas vélo
  # négatifs — la garde du « jamais cette base » du PRD #136
  fichier <- valeur("fichier")
  if (is.na(fichier)) manquer("fichier", "nom de cache absent")
  if (fichier != "bretagne_mobility_super_dashboard_gravity.csv") {
    manquer("fichier", paste0(
      "le contrat épingle le fichier de production ",
      "bretagne_mobility_super_dashboard_gravity.csv — l'artefact ",
      "non-production (indicateurs_summarized_communes.csv, deltas vélo ",
      "négatifs) est refusé"
    ))
  }

  # mode manuel (ADR-0004 — le snapshot est porté à la main, horloge lente) et
  # type fichier (le cache EST le CSV)
  mode <- valeur("mode")
  if (is.na(mode) || mode != "manuel") {
    manquer("mode", "mode attendu : 'manuel' (snapshot porté, jamais de cron)")
  }
  type <- valeur("type")
  if (is.na(type) || type != "fichier") {
    manquer("type", "type attendu : 'fichier'")
  }

  # la licence ODbL (l'analyse consomme l'OSM — ADR-0001)
  if (valeur("licence") != "odbl") {
    manquer("licence", "licence attendue : 'odbl' (OSM, ADR-0001)")
  }

  # les dates — ISO ; la référence (l'instantané de l'analyse) antérieure ou
  # égale à la publication (le portage)
  vintage <- valeur("vintage")
  date_ref <- valeur("date_reference")
  date_pub <- valeur("date_publication")
  toutes <- c(vintage, date_ref, date_pub)
  if (any(is.na(toutes)) ||
      any(!grepl("^[0-9]{4}-[0-9]{2}(-[0-9]{2})?$", toutes))) {
    manquer("dates", "vintage / date_reference / date_publication manquants ou mal formés")
  }
  if (as.Date(date_pub) < as.Date(date_ref)) {
    manquer("date_publication", paste0(
      "la publication (le portage, ", date_pub, ") doit être postérieure ou ",
      "égale à la référence (l'instantané de l'analyse, ", date_ref, ")"
    ))
  }

  invisible(TRUE)
}
