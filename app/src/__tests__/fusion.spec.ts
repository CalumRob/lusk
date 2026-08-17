import { describe, expect, it } from 'vitest'

import {
  collectionAvecValeurs,
  expressionCouleurs,
  indicateurParTerritoire,
  valeurHistoireParTerritoire,
} from '../carte/fusion'
import { COULEUR_NEUTRE } from '../carte/couleurs'
import type { CollectionMasque } from '../geo/types'
import {
  histoiresDemographieFixture,
  indicateursDemographieFixture,
  territoiresFixture,
  vintagesFixture,
} from '../payload/fixtures'
import type { HistoireMilieux, Indicateur, Payload } from '../payload/types'

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
  histoires: histoiresDemographieFixture,
  apercu: [],
  runReport: null,
  vintages: vintagesFixture,
  programmes: null,
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

  it('reads one detail of a multi-detail key when the layer names it (ADR-0019 grouped layers)', () => {
    const parTerritoire = indicateurParTerritoire(
      payload.indicateurs,
      'demographie',
      'structure_age',
      '<15',
    )

    // issue #390 : structure_age est désormais éclaté par sexe (F / M). La carte
    // reste groupée par key + detail (jamais par sexe) : les parts F (0.18) et
    // M (0.12) de la tranche <15 se combinent en UNE valeur de territoire (0.30).
    expect(parTerritoire.get('22001')?.value).toBeCloseTo(0.3)
    expect(parTerritoire.get('22001')?.detail).toBe('<15')
    expect(parTerritoire.get('22001')?.sex).toBeNull()
    expect(parTerritoire.size).toBe(1)
  })
})

/**
 * Issue #390 — the sex aggregation seam (structure_age éclaté F / M). The carte
 * stays grouped by key + detail : the F / M rows of one tranche collapse into
 * ONE territory value (sum of the non-null sex shares), preserving the shared
 * rank / unit / vintage from the indicator rows. A legacy single-row detail is
 * untouched.
 */
describe('indicateurParTerritoire — sex aggregation (issue #390)', () => {
  const vintage = {
    vintage_source: 'INSEE — Population par sexe et âge',
    vintage_version: '2023',
    vintage_date_reference: '2023-01-01',
    vintage_date_publication: '2026-06-30',
  }

  function ligneStructure(
    territoire: string,
    detail: string,
    sex: 'F' | 'M',
    value: number | null,
  ): Indicateur {
    return {
      territoire,
      type: 'commune',
      theme: 'demographie',
      key: 'structure_age',
      detail,
      sex,
      value,
      unit: '%',
      rang_epci: 1,
      rang_epci_n: 2,
      rang_dep: null,
      rang_dep_n: null,
      rang_reg: null,
      rang_reg_n: null,
      ...vintage,
    }
  }

  it('sums the non-null F+M shares of a sex-split tranche into one territory value', () => {
    const lignes = [
      ligneStructure('T1', '<15', 'F', 0.18),
      ligneStructure('T1', '<15', 'M', 0.12),
    ]
    const parTerritoire = indicateurParTerritoire(lignes, 'demographie', 'structure_age', '<15')

    expect(parTerritoire.get('T1')?.value).toBeCloseTo(0.3)
    expect(parTerritoire.get('T1')?.sex).toBeNull()
  })

  it('preserves the shared rank / unit / vintage from the indicator rows', () => {
    const lignes = [
      ligneStructure('T1', '<15', 'F', 0.18),
      ligneStructure('T1', '<15', 'M', 0.12),
    ]
    const ligne = indicateurParTerritoire(lignes, 'demographie', 'structure_age', '<15').get('T1')

    expect(ligne?.unit).toBe('%')
    expect(ligne?.rang_epci).toBe(1)
    expect(ligne?.rang_epci_n).toBe(2)
    expect(ligne?.vintage_source).toBe('INSEE — Population par sexe et âge')
  })

  it('leaves a legacy single-row detail (non sex) untouched', () => {
    const lignes: Indicateur[] = [
      {
        territoire: 'T1',
        type: 'commune',
        theme: 'demographie',
        key: 'densite',
        detail: null,
        value: 200,
        unit: 'hab/km²',
        rang_epci: 1,
        rang_epci_n: 2,
        rang_dep: null,
        rang_dep_n: null,
        rang_reg: null,
        rang_reg_n: null,
        ...vintage,
      },
    ]
    const parTerritoire = indicateurParTerritoire(lignes, 'demographie', 'densite')

    expect(parTerritoire.get('T1')?.value).toBe(200)
    expect(parTerritoire.get('T1')?.sex).toBeUndefined()
  })

  it('returns null (never 0) when both sexes are null', () => {
    const lignes = [ligneStructure('T1', '<15', 'F', null), ligneStructure('T1', '<15', 'M', null)]
    const parTerritoire = indicateurParTerritoire(lignes, 'demographie', 'structure_age', '<15')

    expect(parTerritoire.get('T1')?.value).toBeNull()
  })

  it('sums only the non-null sex when one sex is missing', () => {
    const lignes = [ligneStructure('T1', '<15', 'F', 0.18), ligneStructure('T1', '<15', 'M', null)]
    const parTerritoire = indicateurParTerritoire(lignes, 'demographie', 'structure_age', '<15')

    expect(parTerritoire.get('T1')?.value).toBeCloseTo(0.18)
  })
})

describe('valeurHistoireParTerritoire — the story-scalar join (ADR-0019)', () => {
  it('reads the theme’s story scalar per territoire — one value per territory', () => {
    const parTerritoire = valeurHistoireParTerritoire(payload, 'demographie', 'taux_solde_naturel')

    expect(parTerritoire.get('22001')).toEqual({ value: 5.982905982905983, unit: '' })
    expect(parTerritoire.get('22002')?.value).toBe(-8.080808080808081)
    expect(parTerritoire.has('99999')).toBe(false)
  })

  it('carries no unit — the histoires table publishes none (the legend shows the number alone, honest)', () => {
    const parTerritoire = valeurHistoireParTerritoire(payload, 'demographie', 'taux_solde_naturel')

    expect(parTerritoire.get('22001')?.unit).toBe('')
  })

  it('maps a null scalar (the honest NA hole, e.g. an absent OCS-GE state) to a null value', () => {
    const histoire: HistoireMilieux = {
      territoire: '22001',
      type: 'commune',
      theme: 'milieux',
      story_key: 'se-densifier-setaler-ou-sen-aller',
      groupe: 'artificialisation',
      salience_reason: 'defaut',
      periode_pop: '2017-2023',
      periode_artif: null,
      delta_population: 0,
      taux_variation_population: 0,
      artif_m2: null,
      artif_m3: null,
      artif_m2_par_habitant: null,
      artif_m3_par_habitant: null,
      trajectoire_artif_par_habitant: null,
      classification: null,
    }
    const payloadSansEtat: Payload = { ...payload, histoires: [histoire] }
    const parTerritoire = valeurHistoireParTerritoire(
      payloadSansEtat,
      'milieux',
      'trajectoire_artif_par_habitant',
    )

    expect(parTerritoire.get('22001')).toEqual({ value: null, unit: '' })
  })

  it('maps an unknown scalar field to a null value — never an invented number', () => {
    const parTerritoire = valeurHistoireParTerritoire(payload, 'demographie', 'champ_inconnu')

    expect(parTerritoire.get('22001')?.value).toBeNull()
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

  it('joins a multi-detail layer by clef + detail (the grouped-layer read)', () => {
    const parTerritoire = indicateurParTerritoire(
      payload.indicateurs,
      'demographie',
      'structure_age',
      '<15',
    )
    const jointes = collectionAvecValeurs(collection, parTerritoire)

    // issue #390 : la tranche <15 éclatée F (0.18) + M (0.12) se combine en
    // 0.30 → '30' (unit % → fraction × 100).
    const a1 = jointes.features.find((f) => f.properties.territoire === '22001')
    expect(a1?.properties.valeur).toBeCloseTo(0.3)
    expect(a1?.properties.valeur_formatee).toBe('30') // unit % → fraction × 100
  })

  it('joins the story scalars onto the features — the same join shape as the indicator rows', () => {
    const parTerritoire = valeurHistoireParTerritoire(payload, 'demographie', 'taux_solde_naturel')
    const jointes = collectionAvecValeurs(collection, parTerritoire)

    const a1 = jointes.features.find((f) => f.properties.territoire === '22001')
    expect(a1?.properties.valeur).toBe(5.982905982905983)
    expect(a1?.properties.valeur_formatee).toBe('5,98')

    const sansDonnees = jointes.features.find((f) => f.properties.territoire === '99999')
    expect(sansDonnees?.properties.valeur).toBeNull()
    expect(sansDonnees?.properties.valeur_formatee).toBeNull()
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
    expect(expr).toContain(COULEUR_NEUTRE)
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
