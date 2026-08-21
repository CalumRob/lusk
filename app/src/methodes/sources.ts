/**
 * Le registre Méthodes — les faits éditoriaux des sources (CONTEXT.md →
 * Méthodes, docs/themes/README.md §The Méthodes contract). Un registre typé :
 * par id de source → nom, libellé éditorial, éditeur, URL, thèmes utilisés.
 * Les faits de fraîcheur (version, licence, dates) ne vivent PAS ici — ils
 * viennent en direct de la table vintages (public/data/vintages.json, issue
 * #124), jointe au registre par id dans les selectors du payload
 * (sourcesMethodes).
 *
 * La granularité jeu de données (ADR-0022) : une entrée est une LIGNE vintage
 * d'un jeu ; les familles générées (sourcesDvf/sourcesDpe/sourcesOcsGe/
 * sourcesOcsGePatches) partagent une clé `dataset` (le même jeu data.gouv),
 * et chaque ligne porte son `libelle` éditorial (le label de la ligne
 * vintage : « Millésime 2021 · Côtes-d'Armor (22) »). Une entrée sans clé
 * `dataset` est son propre jeu (une seule ligne vintage).
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

import { slugifierAncre } from '@/methodes/ancres'
import type { Theme } from '@/payload/types'

/** Les faits éditoriaux d'une source — la moitié « auteur » du registre. */
export interface SourceEditoriale {
  /** Le nom d'affichage du jeu de données (l'en-tête de la table, ADR-0022). */
  nom: string
  /** Le libellé éditorial de la ligne vintage — le label de la ligne enfant
   *  (« Millésime 2021 · Côtes-d'Armor (22) »), jamais la fraîcheur. */
  libelle: string
  /** L'éditeur / producteur de la donnée. */
  editeur: string
  /** L'URL publique du jeu de données — null seulement si introuvable (jamais inventée). */
  url: string | null
  /** Les thèmes dont la source alimente les indicateurs (demographie / habitat / economie). */
  themes: Theme[]
  /** L'id du jeu de données auquel la ligne appartient (ADR-0022) — les
   *  familles générées partagent la clé ; absente, la ligne est son propre jeu. */
  dataset?: string
}

/**
 * L'ancrage stable d'une source dans la table (#source-<slug>). L'id de la
 * ligne vintages est déjà un slug stable (dvf_2021_dep22) ; on le préfixe pour
 * ne jamais entrer en collision avec l'ancrage de section (#sources).
 */
export function ancreSource(id: string): string {
  return slugifierAncre('source', id)
}

/**
 * L'id du jeu d'une entrée du registre — la clé de groupement de la table à
 * granularité jeu de données (source.dataset ?? id, ADR-0022). C'est CETTE clé
 * que portent les en-têtes de la table (sourcesMethodes) : la jointure inverse
 * de la matrice (#336) résout un sourceId vers son jeu.
 */
export function datasetDeSource(id: string): string {
  return SOURCES_METHODES[id]?.dataset ?? id
}

/**
 * L'ancre de l'en-tête du jeu d'une source — le lien « Source » des blocs
 * d'indicateurs pointe l'en-tête du jeu (#source-dvf), jamais une ligne
 * vintage (la matrice #336 : les deux directions s'ancrent sur les mêmes
 * en-têtes).
 */
export function ancreDuJeu(id: string): string {
  return ancreSource(datasetDeSource(id))
}

/** La fenêtre glissante des millésimes DVF — l'expansion du manifeste (manifest_habitat_dvf.R). */
const ANNEES_DVF = [2021, 2022, 2023, 2024, 2025] as const
const DEPARTEMENTS_BRETAGNE = ['22', '29', '35', '56'] as const

/** Les noms des quatre départements bretons — les libellés éditoriaux des lignes vintage (ADR-0022). */
const NOMS_DEPARTEMENTS: Record<string, string> = {
  '22': 'Côtes-d\u2019Armor',
  '29': 'Finistère',
  '35': 'Ille-et-Vilaine',
  '56': 'Morbihan',
}

/** La source DVF est UNE donnée (un jeu data.gouv) déclinée en 20 lignes vintages (année × département). */
const SOURCE_DVF: Omit<SourceEditoriale, 'nom' | 'libelle'> = {
  editeur: 'Étalab',
  url: 'https://www.data.gouv.fr/datasets/demandes-de-valeurs-foncieres-geolocalisees',
  themes: ['habitat'],
  dataset: 'dvf',
}

/** Les 20 lignes vintages DVF partagent les faits éditoriaux du jeu — générées, jamais dupliquées. */
function sourcesDvf(): Record<string, SourceEditoriale> {
  const sources: Record<string, SourceEditoriale> = {}
  for (const annee of ANNEES_DVF) {
    for (const dep of DEPARTEMENTS_BRETAGNE) {
      sources[`dvf_${annee}_dep${dep}`] = {
        ...SOURCE_DVF,
        nom: 'Étalab — DVF géolocalisées',
        libelle: `Millésime ${annee} · ${NOMS_DEPARTEMENTS[dep]} (${dep})`,
      }
    }
  }
  return sources
}

/** La source DPE est UNE donnée (data.ademe.fr, dpe03existant) déclinée en 4 lignes vintages (une par département breton). */
const SOURCE_DPE: Omit<SourceEditoriale, 'nom' | 'libelle'> = {
  editeur: 'ADEME',
  url: 'https://data.ademe.fr/data-fair/api/v1/datasets/dpe03existant',
  themes: ['habitat'],
  dataset: 'dpe',
}

/** Les 4 lignes vintages DPE partagent les faits éditoriaux du jeu — générées comme les DVF. */
function sourcesDpe(): Record<string, SourceEditoriale> {
  const sources: Record<string, SourceEditoriale> = {}
  for (const dep of DEPARTEMENTS_BRETAGNE) {
    sources[`dpe_${dep}`] = {
      ...SOURCE_DPE,
      // Le nom PUBLIC du jeu — le même que les citations des indicateurs et
      // que la source des lignes vintages du payload ; l'id d'artefact
      // (dpe03existant) vit dans l'URL, jamais dans le nom affiché.
      nom: 'ADEME — Observatoire DPE, logements existants',
      libelle: `${NOMS_DEPARTEMENTS[dep]} (${dep})`,
    }
  }
  return sources
}

/** Les 8 lignes vintages OCS-GE (2 millésimes × 4 départements) partagent les faits éditoriaux du jeu — générées comme les DVF/DPE. */
const SOURCE_OCSGE: Omit<SourceEditoriale, 'nom' | 'libelle'> = {
  editeur: 'IGN',
  url: 'https://data.geopf.fr/telechargement/resource/OCSGE-ARTIFICIALISATION',
  themes: ['milieux'],
  dataset: 'ocsge_artificialisation',
}

/** Les millésimes d'état du produit « surfaces artificialisées » par département (ADR-0017, la paire M2/M3). */
const MILLESIMES_OCSGE: Record<string, number[]> = {
  '22': [2021, 2025],
  '29': [2021, 2024],
  '35': [2020, 2023],
  '56': [2022, 2024],
}

/**
 * Les 8 lignes vintages OCS-GE (une par département × millésime) — l'état
 * artificialisé du pivot #225, amendé par #243 : le produit millésimé
 * « surfaces artificialisées » (le DIFF est sorti, la couche différentielle
 * n'est pas un état).
 */
function sourcesOcsGe(): Record<string, SourceEditoriale> {
  const sources: Record<string, SourceEditoriale> = {}
  for (const dep of DEPARTEMENTS_BRETAGNE) {
    for (const millesime of MILLESIMES_OCSGE[dep]) {
      sources[`ocsge_artificialisation_${dep}_${millesime}`] = {
        ...SOURCE_OCSGE,
        nom: 'IGN — OCS GE « surfaces artificialisées » v2.0 (Nouvelle Génération)',
        libelle: `Millésime ${millesime} · ${NOMS_DEPARTEMENTS[dep]} (${dep})`,
      }
    }
  }
  return sources
}

/**
 * Les 3 patchs correctifs OCS-GE (22/29/56 — le 35 n'a pas de patch,
 * amendement #243 d'ADR-0017) : l'outil de traçabilité officiel des anomalies
 * du millésime M2, appliqué « au niveau matrice sur les polygones qui
 * inversent le statut » (approximation documentée dans Méthodes). Le même
 * produit OCS GE Géoplateforme que les archives d'état — mêmes faits
 * éditoriaux (le même jeu, un seul en-tête), nom dédié, libellé propre.
 */
const PATCHS_OCSGE: Record<string, { millesime: number }> = {
  '22': { millesime: 2021 },
  '29': { millesime: 2021 },
  '56': { millesime: 2022 },
}

function sourcesOcsGePatches(): Record<string, SourceEditoriale> {
  const sources: Record<string, SourceEditoriale> = {}
  for (const [dep, { millesime }] of Object.entries(PATCHS_OCSGE)) {
    sources[`ocsge_patch_correctif_${dep}`] = {
      // Le MÊME jeu que les archives d'état (la relecture #361) : un seul
      // en-tête OCS-GE — le patch reste une ligne distincte, jamais un second
      // en-tête (les faits de fraîcheur diffèrent, la ligne reste visible).
      ...SOURCE_OCSGE,
      nom: 'IGN — OCS GE « patch correctif » (Nouvelle Génération)',
      libelle: `Patch correctif — ${NOMS_DEPARTEMENTS[dep]} (${dep}), millésime corrigé ${millesime}`,
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
    libelle: 'Millésime 2023',
    editeur: 'INSEE',
    url: 'https://www.data.gouv.fr/datasets/serie-historique-du-recensement-de-la-population',
    themes: ['demographie', 'milieux'],
  },
  menages: {
    nom: 'INSEE — Ménages (dossier complet)',
    libelle: 'Millésime 2023',
    editeur: 'INSEE',
    url: 'https://www.data.gouv.fr/datasets/menages-principaux-indicateurs-dossier-complet',
    themes: ['demographie'],
  },
  age_detail: {
    nom: 'INSEE — Population par sexe et âge (PRINC)',
    libelle: 'Millésime 2023',
    editeur: 'INSEE',
    url: 'https://www.data.gouv.fr/datasets/evolution-et-structure-de-la-population-principaux-indicateurs-dossier-complet-1',
    themes: ['demographie'],
  },
  epci: {
    nom: 'INSEE — Base des EPCI à fiscalité propre au 01/01/2025',
    libelle: 'Millésime 2025',
    editeur: 'INSEE',
    url: 'https://www.insee.fr/fr/information/2510634',
    themes: ['demographie'],
  },

  // ---- Habitat (docs/themes/habitat.md) ----
  logements: {
    nom: 'INSEE — Logements (dossier complet)',
    libelle: 'Millésime 2023',
    editeur: 'INSEE',
    url: 'https://www.data.gouv.fr/datasets/logements-principaux-indicateurs-dossier-complet',
    themes: ['habitat'],
  },
  ...sourcesDvf(),
  ...sourcesDpe(),

  // ---- Économie/Emploi (docs/themes/economie-emploi.md) ----
  sirene_snapshot: {
    nom: 'data.bretagne.bzh — Base SIRENE — Région Bretagne',
    libelle: 'Snapshot 2026-04',
    editeur: 'INSEE',
    url: 'https://data.bretagne.bzh/explore/dataset/sirene-v3-consolidee/',
    themes: ['economie'],
  },
  flores_a38: {
    nom: 'INSEE — Flores : nombre d\u2019établissements et effectifs salariés par secteur d\u2019activité (A38)',
    libelle: 'Millésime 2024',
    editeur: 'INSEE',
    url: 'https://www.insee.fr/fr/statistiques/8266010',
    themes: ['economie'],
  },
  flores_a88: {
    nom: 'INSEE — Flores : nombre d\u2019établissements et effectifs salariés par secteur d\u2019activité (A88)',
    libelle: 'Millésime 2024',
    editeur: 'INSEE',
    url: 'https://www.insee.fr/fr/statistiques/8266010',
    themes: ['economie'],
  },
  rp_emploi: {
    nom: 'INSEE — Emploi au lieu de résidence (dossier complet, ACT4/ACT5)',
    libelle: 'Millésime 2023',
    editeur: 'INSEE',
    url: 'https://www.data.gouv.fr/datasets/population-active-selon-la-pcs-et-lactivite-economique-donnees-detaillees-act4-et-act5/',
    themes: ['economie'],
  },
  rp_chomage: {
    nom: 'INSEE — Population active et chômage (dossier complet, principaux indicateurs, exploitation principale)',
    libelle: 'Millésime 2023',
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
    libelle: 'Snapshot 2026-02',
    editeur: 'Lusk',
    url: null,
    themes: ['mobilite'],
  },
  rp_logement_princ: {
    nom: 'INSEE \u2014 Recensement de la population, exploitations principales (Logements) \u2014 tableau LOG T12 \u00ab \u00c9quipement automobile des m\u00e9nages \u00bb (le jeu DS_RP_LOGEMENT_PRINC, la dimension CARS)',
    libelle: 'Millésime 2023',
    editeur: 'INSEE',
    url: 'https://api.insee.fr/melodi/file/DS_RP_LOGEMENT_PRINC/DS_RP_LOGEMENT_PRINC_2023_CSV_FR',
    themes: ['mobilite'],
  },
  osm_reseaux: {
    nom: 'OpenStreetMap \u2014 r\u00e9seaux routier/cyclable/pi\u00e9ton (extrait Geofabrik Bretagne) \u2014 \u00a9 OpenStreetMap contributors, licence ODbL 1.0 (ADR-0001)',
    libelle: 'Extrait 2026-08',
    editeur: 'OpenStreetMap',
    url: 'https://download.geofabrik.de/europe/france/bretagne-latest.osm.pbf',
    themes: ['mobilite'],
  },
  // Le jeu Geovelo « Aménagements cyclables France Métropolitaine » (issue
  // #222, ADR-0016) : la source du mode `b` de `reseaux` ET du numérateur de
  // la figure « L'offre cyclable » (issue #231) — le réseau cyclable OSM
  // normalisé au schéma national, snapshots mensuels, ODbL (la même famille
  // qu'ADR-0001). La source de RÉFÉRENCE du ratio reste osm_reseaux (le
  // dénominateur routier — l'horloge lente) : les deux horloges sont
  // documentées sur la fiche, le gap jamais dissimulé.
  amenagements_cyclables: {
    nom: 'Geovelo \u2014 Am\u00e9nagements cyclables France M\u00e9tropolitaine (sch\u00e9ma national v0.3.5, ODbL \u2014 \u00a9 OpenStreetMap contributors, ADR-0001)',
    libelle: 'Snapshot 2026-08',
    editeur: 'Geovelo',
    url: 'https://www.data.gouv.fr/datasets/amenagements-cyclables-france-metropolitaine/',
    themes: ['mobilite'],
  },
  // La table de passage COG (issue #222, ticket #227) : la projection des codes
  // COG 2022 du jeu Geovelo vers le COG 2025 du squelette — un composant
  // partagé du référentiel (geometrie.R, passage_cog), jamais une source
  // thématique au sens fraîcheur : sa ligne vintage documente le millésime
  // porté, pas une horloge de contenu.
  cog_passage: {
    nom: 'INSEE \u2014 Table de passage annuelle des communes (COG 2025)',
    libelle: 'Millésime 2025',
    editeur: 'INSEE',
    url: 'https://www.insee.fr/fr/statistiques/fichier/7671867/table_passage_annuelle_2025.zip',
    themes: ['mobilite'],
  },
  communes_limites: {
    nom: 'IGN \u2014 Admin Express COG, limites communales (WFS data.geopf.fr, Licence Ouverte 2.0)',
    libelle: 'Millésime 2025',
    editeur: 'IGN',
    url: 'https://data.geopf.fr/wfs/ows?service=WFS&version=2.0.0&request=GetFeature&typeNames=ADMINEXPRESS-COG.LATEST:commune&count=3000&outputFormat=application/json&bbox=47.0,-5.5,49.0,-0.5,urn:ogc:def:crs:EPSG::4326',
    themes: ['mobilite'],
  },
  korrigo: {
    nom: 'Bretagne Mobilit\u00e9 \u2014 Korrigo : base multimodale GTFS des transports publics en Bretagne (les 24+ r\u00e9seaux : BreizhGo TER/car/maritime + les r\u00e9seaux urbains STAR, Bibus, QUB, TUB, MAT, Izilo, TBK, Kic\u00e9o\u2026)',
    libelle: 'Snapshot 2026-02',
    editeur: 'Bretagne Mobilit\u00e9',
    url: 'https://data.bretagne.bzh/api/explore/v2.1/catalog/datasets/korrigo/alternative_exports/korrigo',
    themes: ['mobilite'],
  },
  batiments_residentiels: {
    nom: 'BDNB (Base Nationale des B\u00e2timents) \u2014 couche des b\u00e2timents r\u00e9sidentiels de Bretagne, port\u00e9e pour l\u2019offre TC (geom_adresse POINT EPSG:2154, code_commune_insee)',
    libelle: 'Extrait 2025-07',
    editeur: 'CSTB (BDNB)',
    url: null,
    themes: ['mobilite'],
  },
  'bornes-recharges': {
    nom: 'Etalab / data.bretagne.bzh \u2014 Fichier consolid\u00e9 des Bornes de Recharge pour V\u00e9hicules \u00c9lectriques (IRVE), sch\u00e9ma 2.2.0',
    libelle: 'Snapshot 2026-07',
    editeur: 'Etalab',
    url: 'https://data.bretagne.bzh/api/explore/v2.1/catalog/datasets/bornes-recharges/exports/csv?limit=-1&timezone=UTC&use_labels=false&delimiter=%3B',
    themes: ['mobilite'],
  },
  'stationnement-velo': {
    nom: 'Ecolab \u2014 Nombre de places de stationnement v\u00e9lo pour 1 000 hab. (hub d\u2019indicateurs territoriaux de transition \u00e9cologique ; source OSM : Base Nationale du Stationnement Cyclable)',
    libelle: 'Snapshot 2022-2025',
    editeur: 'Ecolab',
    url: 'https://static.data.gouv.fr/resources/nombre-de-places-de-stationnement-velo-pour-1000-hab/20260203-170506/nombre-de-places-de-stationnement-velo-pour-1000-hab-commune.csv',
    themes: ['mobilite'],
  },
  // Le stationnement voiture (#369, triage 2026-08-12) : les PLACES ESTIMÉES
  // depuis la surface des aires OSM (amenity=parking — ways fermés + relations,
  // jamais les nodes sans déduplication, jamais capacity), divisée par les
  // facteurs documentés (25 m²/place en parc de surface, ~11,5 m²/place en
  // voirie). Le même extrait Geofabrik que les réseaux (ADR-0001) — le
  // dénominateur du ratio stationnement vélo ÷ voiture. La ligne vintages
  // arrive avec la publication pipeline (#369) : dégradation gracieuse
  // jusqu'alors (faits éditoriaux rendus, dates jamais inventées).
  // Les aires de stationnement et les réseaux partagent le même jeu OSM :
  // osm_reseaux est l'identité canonique, jamais un doublon osm_parkings.
  // Les stations-service (BPE B316) — le dénominateur du ratio bornes
  // électriques ÷ stations-service (#369, triage 2026-08-12) : la source
  // officielle INSEE (définition : stations ayant vendu ≥ 500 000 L l'année
  // précédente). La ligne vintages arrive avec la publication pipeline
  // (#369) : dégradation gracieuse jusqu'alors.
  'bpe_b316': {
    nom: 'INSEE — Base permanente des équipements (BPE25), fichier détail géolocalisé, filtre analytique B316 stations-service',
    libelle: 'Millésime 2025',
    editeur: 'INSEE',
    url: 'https://www.insee.fr/fr/statistiques/fichier/8217525/BPE25.parquet',
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
    libelle: 'Millésime 2025',
    editeur: 'Cerema',
    url: 'https://www.data.gouv.fr/datasets/consommation-despaces-naturels-agricoles-et-forestiers-du-1er-janvier-2011-au-1er-janvier-2025',
    themes: ['milieux'],
  },
  // Les HUIT sources OCS-GE d'état (le pivot #225, ADR-0017 amendé #243) : une
  // entrée par id vintage — la même forme générée que les DVF/DPE (sourcesDvf/
  // sourcesDpe, une donnée déclinée en lignes par département). L'état
  // artificialisé (OCS GE Artificialisation v2.0, Licence Ouverte 2.0), la
  // référence officielle ZAN — les huit archives millésimées du produit
  // « surfaces artificialisées » (le DIFF est sorti).
  ...sourcesOcsGe(),
  // Les TROIS patchs correctifs M2 (22/29/56, amendement #243) : des sources à
  // part entière de la table vintages — l'entrée de registre par id, même forme
  // que les archives d'état.
  ...sourcesOcsGePatches(),
}
