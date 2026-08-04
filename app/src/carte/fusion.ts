/**
 * The indicator-join onto the territory masks — the map's KPI plumbing
 * (ADR-0008: « features carry the territoire code so the map joins the fiche
 * payload's KPIs »). Pure functions: rows in, features + paint expression out.
 * The join is by territoire code; a territory without a row keeps a null
 * value (rendered in the neutral no-data color, never invented).
 */

import type { ExpressionSpecification } from 'maplibre-gl'

import type { CollectionMasque, FeatureTerritoire } from '../geo/types'
import type { Indicateur, Theme } from '../payload/types'
import { formaterValeur } from '../payload/selectors'
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

/**
 * The rows that feed one choropleth: the theme's indicator with `detail ===
 * null` (one value per territory — the multi-detail keys like structure_age
 * are fiche figures, never a map fill). Returns territoire → row.
 */
export function indicateurParTerritoire(
  lignes: readonly Indicateur[],
  theme: Theme,
  indicateur: string,
): Map<string, Indicateur> {
  const parTerritoire = new Map<string, Indicateur>()
  for (const ligne of lignes) {
    if (ligne.theme === theme && ligne.key === indicateur && ligne.detail === null) {
      parTerritoire.set(ligne.territoire, ligne)
    }
  }
  return parTerritoire
}

/**
 * The collection with the joined values baked into each feature's properties
 * (`valeur` for the paint, `valeur_formatee` for the popup/legend). The
 * geometry itself is untouched — a new FeatureCollection, never a mutation.
 */
export function collectionAvecValeurs(
  collection: CollectionMasque,
  parTerritoire: ReadonlyMap<string, Indicateur>,
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
