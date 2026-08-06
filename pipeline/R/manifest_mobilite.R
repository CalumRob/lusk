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
DATE_PUBLICATION_MOBILITE_SNAPSHOT <- "2026-08-06"# MANIFEST_MOBILITE --------------------------------------------------------------
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
  "manuel", "fichier",
  # ————————————————————————————————————————————————————————————————————————
  # rp_logement_princ — la demande : voitures/ménage (issue #139)
  # Le code de table RP épinglé en recherche (2026-08-06, l'item 🔶 du contrat
  # mobilite.md) : la table LOG T12 « Équipement automobile des ménages » du
  # dossier complet INSEE, alimentée par le jeu MELODI DS_RP_LOGEMENT_PRINC
  # (les exploitations PRINCIPALES du recensement — la source du tableau
  # « Équipement automobile des ménages » de la fiche dossier complet). La
  # dimension CARS du cube porte les comptes DWELLINGS par commune : C0 (aucune
  # voiture), C1 (une voiture), C_GE1 (au moins une), C_GE2 (deux ou plus), _T
  # (total des ménages). Les fichiers longs MELODI du dossier complet
  # (DS_RP_MENAGES_COMP — DWELLINGS/DWELLINGS_POPSIZE seulement — et
  # DS_RP_POPULATION_PRINC — POP seulement) ne portent PAS les voitures :
  # vérifié par scan complet des deux fichiers le 2026-08-06. La RÉFÉRENCE est
  # le millésime du recensement RP 2023 (2023-01-01) ; la PUBLICATION est la
  # date de la base du dossier complet qui porte le tableau LOG T12
  # (29/07/2026, vérifiée). Licence Ouverte 2.0 (INSEE).
  "rp_logement_princ",
  "INSEE — Recensement de la population, exploitations principales (Logements) — tableau LOG T12 « Équipement automobile des ménages » (le jeu DS_RP_LOGEMENT_PRINC, la dimension CARS)",
  "https://api.insee.fr/melodi/file/DS_RP_LOGEMENT_PRINC/DS_RP_LOGEMENT_PRINC_2023_CSV_FR",
  "DS_RP_LOGEMENT_PRINC_2023_CSV_FR.zip", "2023", "2023-01-01", "2026-07-29", "lov2",
  paste0(
    "La demande du bloc Mobilité : les voitures par ménage (parts sans ",
    "voiture / 2+). Le code de table RP ÉPINGLÉ en recherche (2026-08-06, ",
    "l'item 🔶 du contrat) : la table LOG T12 « Équipement automobile des ",
    "ménages » du dossier complet, alimentée par le jeu MELODI ",
    "DS_RP_LOGEMENT_PRINC (les exploitations principales du recensement). La ",
    "dimension CARS du cube porte les comptes DWELLINGS par commune : C0 ",
    "(aucune voiture), C1 (une), C_GE1 (au moins une), C_GE2 (deux ou plus), ",
    "_T (total des ménages). Les fichiers longs MELODI du dossier complet ",
    "(DS_RP_MENAGES_COMP — DWELLINGS/DWELLINGS_POPSIZE seulement — et ",
    "DS_RP_POPULATION_PRINC — POP seulement) ne portent PAS les voitures : ",
    "vérifié par scan complet des deux fichiers le 2026-08-06. Référence : le ",
    "millésime RP 2023 (2023-01-01) ; publication : la base du dossier complet ",
    "qui porte le tableau LOG T12 (2026-07-29, vérifiée). Licence Ouverte 2.0."
  ),
  "cron", "fichier",
  # ————————————————————————————————————————————————————————————————————————
  # osm_reseaux — les réseaux t/b/c (issue #139)
  # L'extrait Geofabrik Bretagne (bretagne-latest.osm.pbf, ~312 Mo, reconstruit
  # chaque jour) — la couche `lines` highway=* que le pipeline projette en
  # EPSG:2154 AVANT toute mesure (la consigne du contrat). Le vintage est le
  # TIMESTAMP D'EXTRACTION (la donnée « up to » de l'extrait, jamais
  # « aujourd'hui ») : référence 2026-08-05 (l'extrait contient les données
  # jusqu'au 2026-08-05T20:21:23Z, vérifié sur la page Geofabrik), publication
  # 2026-08-06 (le portage). ODbL (ADR-0001) : attribution « © OpenStreetMap
  # contributors » + lien ODbL portée par la note, le code d'extraction publié
  # avec la Méthodes (ODbL §4.6). Mode « manuel » (312 Mo, jamais un cron).
  "osm_reseaux",
  "OpenStreetMap — réseaux routier/cyclable/piéton (extrait Geofabrik Bretagne) — © OpenStreetMap contributors, licence ODbL 1.0 (ADR-0001)",
  "https://download.geofabrik.de/europe/france/bretagne-latest.osm.pbf",
  "bretagne-latest.osm.pbf", "2026-08", "2026-08-05", "2026-08-06", "odbl",
  paste0(
    "Les réseaux du bloc Mobilité : longueurs et densités par mode t/b/c ",
    "(à pied / vélo / voiture), lues sur la couche `lines` de l'extrait ",
    "Geofabrik Bretagne (highway=*), projetée en EPSG:2154 AVANT toute mesure. ",
    "Le VINTAGE est le timestamp d'EXTRACTION — jamais « aujourd'hui » : ",
    "l'extrait du 5 août 2026 contient les données OSM jusqu'au ",
    "2026-08-05T20:21:23Z (vérifié sur la page Geofabrik). ODbL 1.0 ",
    "(ADR-0001) : attribution « © OpenStreetMap contributors » + lien ODbL, ",
    "code d'extraction publié avec la Méthodes (ODbL §4.6). Mode « manuel » : ",
    "l'extrait fait ~312 Mo — le portage suit l'horloge lente du flagship."
  ),
  "manuel", "fichier",
  # ————————————————————————————————————————————————————————————————————————
  # communes_limites — le référentiel géométrique des réseaux (issue #139)
  # Les limites communales Admin Express COG (WFS data.geopf.fr, Licence
  # Ouverte 2.0 — la même famille que le fond de carte ADR-0008, mais en
  # géométrie COG complète pour le CALCUL) : l'attribution des lignes OSM aux
  # communes ET la surface (le dénominateur des densités). Le WFS renvoie la
  # Bretagne + les communes des régions voisines débordant de la bbox — le
  # filtre breton se fait au chargement (le code département ∈ 22/29/35/56).
  "communes_limites",
  "IGN — Admin Express COG, limites communales (WFS data.geopf.fr, Licence Ouverte 2.0)",
  "https://data.geopf.fr/wfs/ows?service=WFS&version=2.0.0&request=GetFeature&typeNames=ADMINEXPRESS-COG.LATEST:commune&count=3000&outputFormat=application/json&bbox=47.0,-5.5,49.0,-0.5,urn:ogc:def:crs:EPSG::4326",
  "communes_limites.geojson", "2025", "2025-01-01", NA_character_, "lov2",
  paste0(
    "Le référentiel géométrique des réseaux t/b/c : les limites communales ",
    "Admin Express COG (IGN, Licence Ouverte 2.0) — l'attribution des lignes ",
    "OSM aux communes (le centroïde de chaque ligne) et la SURFACE communale ",
    "(le dénominateur des densités, EPSG:2154). La même famille que le fond de ",
    "carte (ADR-0008) mais en géométrie COG complète, pour le calcul. Le WFS ",
    "renvoie la Bretagne plus les communes voisines qui débordent de la bbox : ",
    "le filtre breton (département 22/29/35/56) se fait au chargement. La ",
    "publication du WFS n'est pas exposée (NA, à compléter par le watchdog)."
  ),
  "cron", "fichier"
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
  # le fragment peut vivre dans le manifeste COMPLET du thème (issue #139 —
  # quatre sources) : on isole la ligne de la source avant de valider son
  # contrat — la discipline du fragment reste entière (une ligne, un id)
  if (inherits(manifest, "tbl_df") && "id" %in% names(manifest)) {
    manifest <- manifest[manifest$id == "mobilite_snapshot", ]
  }
  manquer <- function(champ, detail) {
    stop(sprintf("Contrat Mobilité snapshot violé — %s : %s.", champ, detail),
         call. = FALSE)
  }
  valeur <- function(champ) {
    x <- manifest[[champ]]
    if (is.null(x) || length(x) == 0) NA_character_ else as.character(x[1])
  }

  # UNE source, un id unique — la source absente du manifeste est nommée
  if (!inherits(manifest, "tbl_df")) {
    manquer("forme", "le manifeste doit être un tibble")
  }
  if (nrow(manifest) == 0L) {
    manquer("id", "la source 'mobilite_snapshot' est absente du manifeste")
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

# verifier_contrat_mobilite_demande_reseaux --------------------------------------
# La VALIDATION du contrat des trois sources de l'étage demande/réseaux
# (issue #139), dans le manifeste COMPLET du thème : chaque fragment est
# isolé par son id puis vérifié sur son contrat — le fichier épinglé, la
# licence, le mode et les dates. Toute violation — id absent, fichier hors
# contrat, licence non attendue, mode non attendu, dates mal formées,
# publication antérieure à la référence — échoue bruyamment en nommant le
# champ fautif. Le snapshot porté a SA propre validation
# (verifier_contrat_mobilite_snapshot) ; le manifeste réel et les fixtures
# négatives exécutent les deux.
verifier_contrat_mobilite_demande_reseaux <- function(manifest) {
  manquer <- function(champ, detail) {
    stop(sprintf("Contrat Mobilité demande/réseaux violé — %s : %s.", champ,
                 detail), call. = FALSE)
  }
  fragment <- function(id) {
    ligne <- manifest[manifest$id == id, ]
    if (nrow(ligne) != 1L) {
      manquer("id", paste0("la source '", id, "' doit porter exactement une ",
                           "ligne dans le manifeste"))
    }
    ligne
  }
  valeur <- function(ligne, champ) {
    x <- ligne[[champ]]
    if (is.null(x) || length(x) == 0) NA_character_ else as.character(x[1])
  }
  dates_iso <- function(ligne) {
    toutes <- c(valeur(ligne, "vintage"), valeur(ligne, "date_reference"),
                valeur(ligne, "date_publication"))
    if (any(is.na(toutes[1:2])) ||
        any(!grepl("^[0-9]{4}(-[0-9]{2}(-[0-9]{2})?)?$",
                   toutes[!is.na(toutes)]))) {
      manquer("dates", "vintage / date_reference / date_publication manquants ou mal formés")
    }
    if (!is.na(valeur(ligne, "date_publication")) &&
        as.Date(valeur(ligne, "date_publication")) <
        as.Date(valeur(ligne, "date_reference"))) {
      manquer("date_publication", "la publication doit être postérieure ou égale à la référence")
    }
  }

  # — rp_logement_princ : le cube RP exploitation principale épinglé (le code
  # de table LOG T12 — jamais un autre fichier MELODI du dossier complet, qui
  # ne porte pas les voitures), licence Ouverte, mode cron (fichier melodi)
  rp <- fragment("rp_logement_princ")
  if (valeur(rp, "fichier") != "DS_RP_LOGEMENT_PRINC_2023_CSV_FR.zip") {
    manquer("fichier", paste0(
      "le contrat épingle le cube DS_RP_LOGEMENT_PRINC (le code de table ",
      "LOG T12 « Équipement automobile des ménages ») — les fichiers longs ",
      "du dossier complet (DS_RP_MENAGES_COMP, DS_RP_POPULATION_PRINC) ne ",
      "portent pas les voitures"
    ))
  }
  if (valeur(rp, "licence") != "lov2") {
    manquer("licence", "licence attendue : 'lov2' (INSEE, Licence Ouverte)")
  }
  if (valeur(rp, "mode") != "cron") {
    manquer("mode", "mode attendu : 'cron' (un fichier melodi standard)")
  }
  if (valeur(rp, "vintage") != "2023") {
    manquer("vintage", "vintage attendu : '2023' (le millésime RP 2023)")
  }
  dates_iso(rp)

  # — osm_reseaux : le pbf Geofabrik Bretagne épinglé, ODbL (ADR-0001), mode
  # manuel (312 Mo, jamais un cron), et la RÉFÉRENCE est le timestamp
  # d'EXTRACTION (le vintage n'est JAMAIS « aujourd'hui » : la référence doit
  # précéder strictement la publication — l'extrait est antérieur au portage)
  osm <- fragment("osm_reseaux")
  if (valeur(osm, "fichier") != "bretagne-latest.osm.pbf") {
    manquer("fichier", paste0(
      "le contrat épingle l'extrait Geofabrik Bretagne (bretagne-latest.",
      "osm.pbf) — jamais un autre extrait"
    ))
  }
  if (valeur(osm, "licence") != "odbl") {
    manquer("licence", "licence attendue : 'odbl' (OSM, ADR-0001)")
  }
  if (valeur(osm, "mode") != "manuel") {
    manquer("mode", "mode attendu : 'manuel' (l'extrait ~312 Mo, horloge lente)")
  }
  dates_iso(osm)
  if (!grepl("^[0-9]{4}-[0-9]{2}$", valeur(osm, "vintage"))) {
    manquer("vintage", "vintage attendu : le mois d'extraction (AAAA-MM)")
  }
  if (as.Date(valeur(osm, "date_reference")) >=
      as.Date(valeur(osm, "date_publication"))) {
    manquer("date_reference", paste0(
      "la référence est le timestamp d'extraction — jamais « aujourd'hui » : ",
      "elle doit précéder strictement la publication (le portage)"
    ))
  }

  # — communes_limites : le WFS Admin Express épinglé, Licence Ouverte
  limites <- fragment("communes_limites")
  if (valeur(limites, "fichier") != "communes_limites.geojson") {
    manquer("fichier", "le contrat épingle communes_limites.geojson (WFS Admin Express)")
  }
  if (valeur(limites, "licence") != "lov2") {
    manquer("licence", "licence attendue : 'lov2' (IGN, Licence Ouverte)")
  }
  dates_iso(limites)

  invisible(TRUE)
}
