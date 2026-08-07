/**
 * Le registre Méthodes — les faits éditoriaux des sources (CONTEXT.md →
 * Méthodes, docs/themes/README.md §The Méthodes contract). Un registre typé :
 * par id de source → nom, éditeur, URL, thèmes utilisés. Les faits de
 * fraîcheur (version, licence, dates) ne vivent PAS ici — ils viennent en
 * direct de la table vintages (public/data/vintages.json, issue #124), jointe
 * au registre par id dans les selectors du payload (sourcesMethodes).
 *
 * Le contrat de parité : chaque id de la table vintages commise doit avoir une
 * entrée ici (l'union est le contrat) ; une entrée sans ligne vintages en
 * direct est autorisée (dégradation gracieuse) mais signalée. Les id du
 * registre sont les id EXACTS des lignes vintages.
 *
 * Les URL sont les pages publiques réelles des jeux de données (data.gouv.fr,
 * insee.fr, data.bretagne.bzh — ground truth : docs/data-source-map.md et
 * docs/research/*.md). Une URL introuvable resterait null — jamais inventée.
 */

import type { Theme } from '@/payload/types'

/** Les faits éditoriaux d'une source — la moitié « auteur » du registre. */
export interface SourceEditoriale {
  /** Le nom d'affichage de la source (dégradation : pas de ligne vintages en direct). */
  nom: string
  /** L'éditeur / producteur de la donnée. */
  editeur: string
  /** L'URL publique du jeu de données — null seulement si introuvable (jamais inventée). */
  url: string | null
  /** Les thèmes dont la source alimente les indicateurs (demographie / habitat / economie). */
  themes: Theme[]
}

/**
 * L'ancrage stable d'une source dans la table (#source-<slug>). L'id de la
 * ligne vintages est déjà un slug stable (dvf_2021_dep22) ; on le préfixe pour
 * ne jamais entrer en collision avec l'ancrage de section (#sources).
 */
export function ancreSource(id: string): string {
  return `source-${id.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}`
}

/** La fenêtre glissante des millésimes DVF — l'expansion du manifeste (manifest_habitat_dvf.R). */
const ANNEES_DVF = [2021, 2022, 2023, 2024, 2025] as const
const DEPARTEMENTS_BRETAGNE = ['22', '29', '35', '56'] as const

/** La source DVF est UNE donnée (un jeu data.gouv) déclinée en 20 lignes vintages (année × département). */
const SOURCE_DVF: Omit<SourceEditoriale, 'nom'> = {
  editeur: 'Étalab',
  url: 'https://www.data.gouv.fr/datasets/demandes-de-valeurs-foncieres-geolocalisees',
  themes: ['habitat'],
}

/** Les 20 lignes vintages DVF partagent les mêmes faits éditoriaux — générées, jamais dupliquées. */
function sourcesDvf(): Record<string, SourceEditoriale> {
  const sources: Record<string, SourceEditoriale> = {}
  for (const annee of ANNEES_DVF) {
    for (const dep of DEPARTEMENTS_BRETAGNE) {
      sources[`dvf_${annee}_dep${dep}`] = { ...SOURCE_DVF, nom: 'Étalab — DVF géolocalisées' }
    }
  }
  return sources
}

/** La source DPE est UNE donnée (data.ademe.fr, dpe03existant) déclinée en 4 lignes vintages (une par département breton). */
const SOURCE_DPE: Omit<SourceEditoriale, 'nom'> = {
  editeur: 'ADEME',
  url: 'https://data.ademe.fr/data-fair/api/v1/datasets/dpe03existant',
  themes: ['habitat'],
}

/** Les 4 lignes vintages DPE partagent les mêmes faits éditoriaux — générées comme les DVF. */
function sourcesDpe(): Record<string, SourceEditoriale> {
  const sources: Record<string, SourceEditoriale> = {}
  for (const dep of DEPARTEMENTS_BRETAGNE) {
    sources[`dpe_${dep}`] = {
      ...SOURCE_DPE,
      nom: 'ADEME — Observatoire DPE, logements existants (dpe03existant)',
    }
  }
  return sources
}

/**
 * Le registre complet — une entrée par source, indexée par l'id exact de la
 * table vintages. Ordre du registre = ordre d'affichage de la table (les
 * thèmes groupés : démographie, habitat, économie).
 */
export const SOURCES_METHODES: Record<string, SourceEditoriale> = {
  // ---- Démographie (docs/themes/demographie.md) ----
  serie_historique: {
    nom: 'INSEE — Série historique du recensement',
    editeur: 'INSEE',
    url: 'https://www.data.gouv.fr/datasets/serie-historique-du-recensement-de-la-population',
    themes: ['demographie', 'milieux'],
  },
  menages: {
    nom: 'INSEE — Ménages (dossier complet)',
    editeur: 'INSEE',
    url: 'https://www.data.gouv.fr/datasets/menages-principaux-indicateurs-dossier-complet',
    themes: ['demographie'],
  },
  age_detail: {
    nom: 'INSEE — Population par sexe et âge (PRINC)',
    editeur: 'INSEE',
    url: 'https://www.data.gouv.fr/datasets/evolution-et-structure-de-la-population-principaux-indicateurs-dossier-complet-1',
    themes: ['demographie'],
  },
  epci: {
    nom: 'INSEE — Base des EPCI à fiscalité propre au 01/01/2025',
    editeur: 'INSEE',
    url: 'https://www.insee.fr/fr/information/2510634',
    themes: ['demographie'],
  },

  // ---- Habitat (docs/themes/habitat.md) ----
  logements: {
    nom: 'INSEE — Logements (dossier complet)',
    editeur: 'INSEE',
    url: 'https://www.data.gouv.fr/datasets/logements-principaux-indicateurs-dossier-complet',
    themes: ['habitat'],
  },
  ...sourcesDvf(),
  ...sourcesDpe(),

  // ---- Économie/Emploi (docs/themes/economie-emploi.md) ----
  sirene_snapshot: {
    nom: 'data.bretagne.bzh — Base SIRENE — Région Bretagne (sirene-v3-consolidee)',
    editeur: 'INSEE',
    url: 'https://data.bretagne.bzh/explore/dataset/sirene-v3-consolidee/',
    themes: ['economie'],
  },
  flores_a38: {
    nom: 'INSEE — Flores : nombre d\u2019établissements et effectifs salariés par secteur d\u2019activité (A38)',
    editeur: 'INSEE',
    url: 'https://www.insee.fr/fr/statistiques/8266010',
    themes: ['economie'],
  },
  flores_a88: {
    nom: 'INSEE — Flores : nombre d\u2019établissements et effectifs salariés par secteur d\u2019activité (A88)',
    editeur: 'INSEE',
    url: 'https://www.insee.fr/fr/statistiques/8266010',
    themes: ['economie'],
  },
  rp_emploi: {
    nom: 'INSEE — Emploi au lieu de résidence (dossier complet, ACT4/ACT5)',
    editeur: 'INSEE',
    url: 'https://www.data.gouv.fr/datasets/population-active-selon-la-pcs-et-lactivite-economique-donnees-detaillees-act4-et-act5/',
    themes: ['economie'],
  },
  rp_chomage: {
    nom: 'INSEE — Population active et chômage (dossier complet, principaux indicateurs, exploitation principale)',
    editeur: 'INSEE',
    url: 'https://www.insee.fr/fr/statistiques/9002680',
    themes: ['economie'],
  },

  // ---- Mobilité (docs/themes/mobilite.md) ----
  // L'ordre du manifeste (manifest_mobilite.R) : le snapshot porté (l'horloge
  // lente du flagship, issue #137), les trois sources de l'étage
  // demande/réseaux (issue #139), puis les quatre sources du sous-bloc
  // « L'offre de mobilité alternative » (issue #140).
  mobilite_snapshot: {
    nom: 'Lusk \u2014 analyse d\u2019accessibilit\u00e9 \u00ab Vingt minutes sans voiture \u00bb (analyse port\u00e9e, BPE 2024 \u00b7 OSM 02-2026 \u00b7 BDNB 2025-07)',
    editeur: 'Lusk',
    url: null,
    themes: ['mobilite'],
  },
  rp_logement_princ: {
    nom: 'INSEE \u2014 Recensement de la population, exploitations principales (Logements) \u2014 tableau LOG T12 \u00ab \u00c9quipement automobile des m\u00e9nages \u00bb (le jeu DS_RP_LOGEMENT_PRINC, la dimension CARS)',
    editeur: 'INSEE',
    url: 'https://api.insee.fr/melodi/file/DS_RP_LOGEMENT_PRINC/DS_RP_LOGEMENT_PRINC_2023_CSV_FR',
    themes: ['mobilite'],
  },
  osm_reseaux: {
    nom: 'OpenStreetMap \u2014 r\u00e9seaux routier/cyclable/pi\u00e9ton (extrait Geofabrik Bretagne) \u2014 \u00a9 OpenStreetMap contributors, licence ODbL 1.0 (ADR-0001)',
    editeur: 'OpenStreetMap',
    url: 'https://download.geofabrik.de/europe/france/bretagne-latest.osm.pbf',
    themes: ['mobilite'],
  },
  communes_limites: {
    nom: 'IGN \u2014 Admin Express COG, limites communales (WFS data.geopf.fr, Licence Ouverte 2.0)',
    editeur: 'IGN',
    url: 'https://data.geopf.fr/wfs/ows?service=WFS&version=2.0.0&request=GetFeature&typeNames=ADMINEXPRESS-COG.LATEST:commune&count=3000&outputFormat=application/json&bbox=47.0,-5.5,49.0,-0.5,urn:ogc:def:crs:EPSG::4326',
    themes: ['mobilite'],
  },
  korrigo: {
    nom: 'Bretagne Mobilit\u00e9 \u2014 Korrigo : base multimodale GTFS des transports publics en Bretagne (les 24+ r\u00e9seaux : BreizhGo TER/car/maritime + les r\u00e9seaux urbains STAR, Bibus, QUB, TUB, MAT, Izilo, TBK, Kic\u00e9o\u2026)',
    editeur: 'Bretagne Mobilit\u00e9',
    url: 'https://data.bretagne.bzh/api/explore/v2.1/catalog/datasets/korrigo/alternative_exports/korrigo',
    themes: ['mobilite'],
  },
  batiments_residentiels: {
    nom: 'BDNB (Base Nationale des B\u00e2timents) \u2014 couche des b\u00e2timents r\u00e9sidentiels de Bretagne, port\u00e9e pour l\u2019offre TC (geom_adresse POINT EPSG:2154, code_commune_insee)',
    editeur: 'CSTB (BDNB)',
    url: null,
    themes: ['mobilite'],
  },
  'bornes-recharges': {
    nom: 'Etalab / data.bretagne.bzh \u2014 Fichier consolid\u00e9 des Bornes de Recharge pour V\u00e9hicules \u00c9lectriques (IRVE), sch\u00e9ma 2.2.0',
    editeur: 'Etalab',
    url: 'https://data.bretagne.bzh/api/explore/v2.1/catalog/datasets/bornes-recharges/exports/csv?limit=-1&timezone=UTC&use_labels=false&delimiter=%3B',
    themes: ['mobilite'],
  },
  'stationnement-velo': {
    nom: 'Ecolab \u2014 Nombre de places de stationnement v\u00e9lo pour 1 000 hab. (hub d\u2019indicateurs territoriaux de transition \u00e9cologique ; source OSM : Base Nationale du Stationnement Cyclable)',
    editeur: 'Ecolab',
    url: 'https://static.data.gouv.fr/resources/nombre-de-places-de-stationnement-velo-pour-1000-hab/20260203-170506/nombre-de-places-de-stationnement-velo-pour-1000-hab-commune.csv',
    themes: ['mobilite'],
  },

  // ---- Milieux (docs/themes/milieux.md — l'axe terre, ADR-0014) ----
  // L'ordre du manifeste (manifest_milieux.R) : la source CONSOENAF (l'horloge
  // annuelle de l'indicateur, l'anomalie d'unité documentée) et la série
  // historique du recensement — la source PARTAGÉE de la population de
  // l'Histoire (la même ligne que Démographie, la règle de source d'ADR-0014 :
  // la population vient TOUJOURS de là, jamais des champs embarqués de
  // CONSOENAF).
  consoenaf: {
    nom: 'Cerema \u2014 Consommation d\u2019espaces naturels, agricoles et forestiers (CONSOENAF) 2011-2025 : indicateurs communaux (Fichiers Fonciers) \u2014 le dictionnaire Cerema annonce les consommations \u00aben hectares \u00bb, le fichier les distribue en m\u00e8tres carr\u00e9s : le pipeline convertit explicitement (\u00f7 10 000) et le teste, jamais silencieusement (docs/research/zan-rennes.md)',
    editeur: 'Cerema',
    url: 'https://www.data.gouv.fr/datasets/consommation-despaces-naturels-agricoles-et-forestiers-du-1er-janvier-2011-au-1er-janvier-2025',
    themes: ['milieux'],
  },
}
