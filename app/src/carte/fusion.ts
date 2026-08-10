/**
 * The indicator/story-scalar joins onto the territory masks — the map's KPI
 * plumbing (ADR-0008: « features carry the territoire code so the map joins
 * the fiche payload's KPIs »; ADR-0019: every number a fiche renders is a
 * layer — the story scalars join like the indicator rows). Pure functions:
 * rows in, features + paint expression out. The join is by territoire code; a
 * territory without a row keeps a null value (rendered in the neutral no-data
 * color, never invented).
 */

import type { ExpressionSpecification } from 'maplibre-gl'

import type { CollectionMasque, FeatureTerritoire, NiveauMasque } from '../geo/types'
import type { Indicateur, Payload, SigleProgramme, Theme } from '../payload/types'
import { formaterValeur } from '../payload/selectors'
import { typeAdhesionDuNiveau, typeSubventionsDuNiveau } from './programmesCouches'
import { COULEUR_NEUTRE } from './couleurs'

/** The MapLibre paint expression for a choropleth fill (step + null guard). */
export type ExpressionCouleurs = ExpressionSpecification

/** A feature enriched with the joined indicator (the fill + the popup read it). */
export interface FeatureAvecValeur extends FeatureTerritoire {
  properties: FeatureTerritoire['properties'] & {
    valeur: number | null
    valeur_formatee: string | null
  }
}

export interface CollectionAvecValeurs {
  type: 'FeatureCollection'
  features: FeatureAvecValeur[]
}

/** A joined value per territoire — the minimal shape the fill, the legend and
 *  the popup read. The story scalars carry no unit (the histoires table
 *  publishes none) : `unit` is '' there — the legend shows the number alone,
 *  never an invented unit. */
export interface ValeurLigne {
  value: number | null
  unit: string
}

/**
 * The rows that feed one choropleth: the theme's indicator with `detail ===
 * null` (one value per territory) — or, when `detail` is given (a grouped
 * multi-detail layer, ADR-0019), that detail's rows. Returns territoire → row.
 */
export function indicateurParTerritoire(
  lignes: readonly Indicateur[],
  theme: Theme,
  indicateur: string,
  detail: string | null = null,
): Map<string, Indicateur> {
  const parTerritoire = new Map<string, Indicateur>()
  for (const ligne of lignes) {
    if (ligne.theme === theme && ligne.key === indicateur && ligne.detail === detail) {
      parTerritoire.set(ligne.territoire, ligne)
    }
  }
  return parTerritoire
}

/**
 * The story-scalar join (ADR-0019): the theme's Story row per territoire, read
 * at the scalar field `champ` — the layer's one value per territory (a story
 * scalar IS a number per territoire). The histoires table carries no unit
 * column, so the joined lines are unit-less (`unit: ''`, the honest number).
 */
export function valeurHistoireParTerritoire(
  payload: Payload,
  theme: Theme,
  champ: string,
): Map<string, ValeurLigne> {
  const parTerritoire = new Map<string, ValeurLigne>()
  for (const histoire of payload.histoires) {
    if (histoire.theme !== theme) continue
    const valeur = (histoire as unknown as Record<string, unknown>)[champ]
    parTerritoire.set(histoire.territoire, {
      value: typeof valeur === 'number' ? valeur : null,
      unit: '',
    })
  }
  return parTerritoire
}

/**
 * The collection with the joined values baked into each feature's properties
 * (`valeur` for the paint, `valeur_formatee` for the popup/legend). Accepts
 * either join — the indicator rows (Map<string, Indicateur>) or the story
 * scalars (Map<string, ValeurLigne>) — the same shape either way. The
 * geometry itself is untouched — a new FeatureCollection, never a mutation.
 */
export function collectionAvecValeurs(
  collection: CollectionMasque,
  parTerritoire: ReadonlyMap<string, ValeurLigne>,
): CollectionAvecValeurs {
  return {
    type: 'FeatureCollection',
    features: collection.features.map((feature) => {
      const ligne = parTerritoire.get(feature.properties.territoire)
      return {
        ...feature,
        properties: {
          ...feature.properties,
          valeur: ligne?.value ?? null,
          valeur_formatee: ligne ? formaterValeur(ligne) : null,
        },
      }
    }),
  }
}

/**
 * The choropleth fill expression: `step` over the feature's `valeur`, with a
 * null/missing guard falling back to the neutral no-data color. Empty breaks
 * (no data at all) collapse to the neutral fill — the honest empty map.
 */
export function expressionCouleurs(seuils: readonly number[], couleurs: readonly string[]): ExpressionCouleurs {
  if (couleurs.length < 2) throw new RangeError('Il faut au moins 2 couleurs pour une choroplèthe')
  const [couleurBase, ...autres] = couleurs
  const step: unknown[] = ['step', ['get', 'valeur'], couleurBase]
  for (let i = 0; i < seuils.length; i++) {
    step.push(seuils[i], autres[i] ?? couleurBase)
  }
  return [
    'case',
    ['all', ['has', 'valeur'], ['!=', ['get', 'valeur'], null]],
    step,
    COULEUR_NEUTRE,
  ] as unknown as ExpressionCouleurs
}

/** The membership join (ADR-0013, #282) — the programmes' anchor rows read at
 *  the niveau's anchor type: `membre: true` for a covered territory, the
 *  territory ABSENT from the map otherwise. A sigle not anchored at the level
 *  (CRTE at commune) joins nothing — the honest empty highlight. */
export function membresParTerritoire(
  payload: Payload,
  sigle: SigleProgramme,
  niveau: NiveauMasque,
): Map<string, boolean> {
  const parTerritoire = new Map<string, boolean>()
  const type = typeAdhesionDuNiveau(niveau)
  if (!type) return parTerritoire
  for (const membre of payload.programmes?.membres ?? []) {
    if (membre.sigle === sigle && membre.type === type) parTerritoire.set(membre.territoire, true)
  }
  return parTerritoire
}

/** The subvention join (#282) — the total € per territory at the niveau's
 *  aggregate type: the sum of the territory's `montant` rows (the commune's
 *  by-area split or the EPCI/département annual total, ADR-0013). A territory
 *  without rows keeps null (rendered in the neutral no-data color, never an
 *  invented zero). */
export function subventionsParTerritoire(
  payload: Payload,
  niveau: NiveauMasque,
): Map<string, ValeurLigne> {
  const parTerritoire = new Map<string, ValeurLigne>()
  const type = typeSubventionsDuNiveau(niveau)
  for (const subvention of payload.programmes?.subventions ?? []) {
    if (subvention.type !== type) continue
    const actuel = parTerritoire.get(subvention.territoire)?.value ?? 0
    parTerritoire.set(subvention.territoire, {
      value: actuel + subvention.montant,
      unit: '€',
    })
  }
  return parTerritoire
}

/** A feature enriched with the membership boolean (the categorical fill reads it). */
export interface FeatureAvecMembre extends FeatureTerritoire {
  properties: FeatureTerritoire['properties'] & {
    membre: boolean
  }
}

export interface CollectionAvecMembres {
  type: 'FeatureCollection'
  features: FeatureAvecMembre[]
}

/** The collection with the membership baked into each feature's properties —
 *  `membre: true` for a covered territory, false otherwise (the in/out
 *  categorical paint). The geometry itself is untouched. */
export function collectionAvecMembres(
  collection: CollectionMasque,
  parTerritoire: ReadonlyMap<string, boolean>,
): CollectionAvecMembres {
  return {
    type: 'FeatureCollection',
    features: collection.features.map((feature) => ({
      ...feature,
      properties: {
        ...feature.properties,
        membre: parTerritoire.get(feature.properties.territoire) ?? false,
      },
    })),
  }
}

/**
 * The membership highlight expression (ADR-0019 #282) — CATEGORICAL, beside
 * the value `expressionCouleurs`: a covered territory lights up in the
 * highlight color, a non-member renders in the neutral fill. Two classes,
 * never a ramp.
 */
export function expressionMembres(couleurMembre: string): ExpressionCouleurs {
  return ['case', ['==', ['get', 'membre'], true], couleurMembre, COULEUR_NEUTRE] as unknown as ExpressionCouleurs
}
