import { describe, expect, it } from 'vitest'

import {
  collectionAvecValeurs,
  expressionCouleurs,
  indicateurParTerritoire,
} from '../carte/fusion'
import type { CollectionMasque } from '../geo/types'
import {
  indicateursDemographieFixture,
  territoiresFixture,
} from '../payload/fixtures'
import type { Payload } from '../payload/types'

/**
 * The indicator-join onto the masks (ADR-0008): the map reads the territoire
 * code on each feature and joins the payload's KPI rows for the fill and the
 * popups. Pure logic — geometry in, joined features + paint expression out.
 */

const collection: CollectionMasque = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { territoire: '22001', nom: 'Commune A1', type: 'commune' },
      geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [0, 0]]] },
    },
    {
      type: 'Feature',
      properties: { territoire: '22002', nom: 'Commune D', type: 'commune' },
      geometry: { type: 'Polygon', coordinates: [[[1, 0], [2, 0], [1, 0]]] },
    },
    {
      type: 'Feature',
      properties: { territoire: '99999', nom: 'Sans données', type: 'commune' },
      geometry: { type: 'Polygon', coordinates: [[[2, 0], [3, 0], [2, 0]]] },
    },
  ],
}

const payload: Payload = {
  territoires: territoiresFixture,
  indicateurs: indicateursDemographieFixture,
  histoires: [],
  apercu: [],
  runReport: null,
}

describe('indicateurParTerritoire — the rows that feed a choropleth', () => {
  it('keeps only the theme+key rows with detail null (one value per territory)', () => {
    const parTerritoire = indicateurParTerritoire(payload.indicateurs, 'demographie', 'densite')

    expect(parTerritoire.get('22001')?.value).toBe(200)
    expect(parTerritoire.get('22002')?.value).toBe(50)
    expect(parTerritoire.has('99999')).toBe(false)
  })

  it('ignores the multi-detail keys (structure_age is a fiche figure, not a fill)', () => {
    const parTerritoire = indicateurParTerritoire(payload.indicateurs, 'demographie', 'structure_age')
    expect(parTerritoire.size).toBe(0)
  })
})

describe('collectionAvecValeurs — the join onto the features', () => {
  it('bakes the valeur and its formatted French display into each feature', () => {
    const parTerritoire = indicateurParTerritoire(payload.indicateurs, 'demographie', 'densite')
    const jointes = collectionAvecValeurs(collection, parTerritoire)

    const a1 = jointes.features.find((f) => f.properties.territoire === '22001')
    expect(a1?.properties.valeur).toBe(200)
    expect(a1?.properties.valeur_formatee).toBe('200')

    const d = jointes.features.find((f) => f.properties.territoire === '22002')
    expect(d?.properties.valeur).toBe(50)
  })

  it('leaves unknown territories with a null valeur — honest, not invented', () => {
    const parTerritoire = indicateurParTerritoire(payload.indicateurs, 'demographie', 'densite')
    const jointes = collectionAvecValeurs(collection, parTerritoire)

    const sansDonnees = jointes.features.find((f) => f.properties.territoire === '99999')
    expect(sansDonnees?.properties.valeur).toBeNull()
    expect(sansDonnees?.properties.valeur_formatee).toBeNull()
  })

  it('never mutates the input collection', () => {
    const parTerritoire = indicateurParTerritoire(payload.indicateurs, 'demographie', 'densite')
    const jointes = collectionAvecValeurs(collection, parTerritoire)

    expect(jointes).not.toBe(collection)
    expect(jointes.features[0]).not.toBe(collection.features[0])
    expect('valeur' in collection.features[0].properties).toBe(false)
  })
})

describe('expressionCouleurs — the MapLibre fill expression', () => {
  it('builds a step expression over the valeur property', () => {
    const expr = expressionCouleurs([20, 40, 60], ['#c1c1e9', '#a3a3df', '#8e85c4', '#6f67a8'])

    expect(expr[0]).toBe('case')
    const step = expr[2] as unknown[]
    expect(step[0]).toBe('step')
    expect(step[2]).toBe('#c1c1e9')
    // seuils puis couleurs, en alternance
    expect(step.slice(3)).toEqual([20, '#a3a3df', 40, '#8e85c4', 60, '#6f67a8'])
  })

  it('guards null/missing values to the neutral color', () => {
    const expr = expressionCouleurs([10], ['#e8e8f5', '#8e85c4'])
    expect(expr).toContain('#E4ECEA')
  })

  it('collapses to the neutral fill when there are no breaks (no data at all)', () => {
    const expr = expressionCouleurs([], ['#e8e8f5', '#8e85c4'])
    const step = expr[2] as unknown[]
    expect(step[0]).toBe('step')
    expect(step[2]).toBe('#e8e8f5')
    expect(step.length).toBe(3)
  })

  it('throws when fewer than 2 colors are given', () => {
    expect(() => expressionCouleurs([10], ['#8e85c4'])).toThrow(RangeError)
  })
})
