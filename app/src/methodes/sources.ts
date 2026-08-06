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
    themes: ['demographie'],
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
}
