import { describe, expect, it } from 'vitest'

import type {
  ContentFact,
  MobiliteBarsFigureEvidence,
} from '@/fiche/content/themeContent'
import type { NumericFact } from '@/fiche/content/territoryFacts'
import {
  mobiliteBarReadings,
  mobiliteBarTooltipRows,
  mobiliteBarsAccessibleLabel,
} from '@/fiche/prototype/cahierMobiliteReadings'

function fact(
  key: string,
  detail: string | null,
  value: number | null,
  unit: string,
  reference: number | null = null,
  rank: { position: number; size: number; ties?: number } | null = null,
): ContentFact {
  return {
    label: detail ?? key,
    fact: {
      key,
      detail,
      value,
      unit,
      availability: 'complete',
      provenance: null,
      comparison: reference === null ? null : {
        direction: 'plus-est-mieux',
        scope: { kind: 'communes-epci', label: 'communes de EPCI X' },
        reference: { kind: 'median', value: reference },
        rank,
      },
      comparisonBasis: 'territory-median',
      reason: null,
    } satisfies NumericFact,
  }
}

const figure: MobiliteBarsFigureEvidence = {
  figureTitle: 'Longueur du réseau par habitant',
  unit: 'km / 1 000 hab.',
  xAxisTitle: 'Réseau',
  yAxisTitle: 'km / 1 000 hab.',
  comparisonLabel: 'Médiane des communes de EPCI X',
  categories: [
    {
      key: 'walkTransit', label: 'Réseau piéton', axisLabel: 'à pied', tone: 't',
      value: fact('reseaux_par_habitant', 't_km_1000', 12, 'km / 1 000 hab.', 9, { position: 2, size: 3 }),
      rawValue: fact('reseaux', 't_longueur', 10, 'km'),
      segments: [], splitNote: null,
    },
    {
      key: 'bike', label: 'Réseau cyclable', axisLabel: 'à vélo', tone: 'b',
      value: fact('reseaux_par_habitant', 'b_km_1000', 8, 'km / 1 000 hab.', 6, { position: 1, size: 3, ties: 2 }),
      rawValue: fact('reseaux', 'b_longueur', 20, 'km'),
      segments: [
        {
          key: 'protege_km_1000', label: 'Protégé', legendLabel: 'Réseau cyclable protégé',
          value: fact('offre_cyclable', 'protege_km_1000', 5, 'km / 1 000 hab.', 4, { position: 1, size: 4 }),
          rawValue: fact('offre_cyclable', 'protege_longueur', 4, 'km'),
        },
        {
          key: 'partage_km_1000', label: 'Partagé', legendLabel: 'Réseau cyclable partagé',
          value: fact('offre_cyclable', 'partage_km_1000', 3, 'km / 1 000 hab.'),
          rawValue: null,
        },
      ],
      splitNote: 'La répartition publiée est partielle.',
    },
    {
      key: 'car', label: 'Réseau automobile', axisLabel: 'en voiture', tone: 'c',
      value: fact('reseaux_par_habitant', 'c_km_1000', 0, 'km / 1 000 hab.', null),
      rawValue: null,
      segments: [], splitNote: null,
    },
    {
      key: 'absent', label: 'Réseau absent', axisLabel: 'absent', tone: 'neutral',
      value: fact('reseaux_par_habitant', 'absent_km_1000', null, 'km / 1 000 hab.', 2),
      rawValue: null,
      segments: [], splitNote: null,
    },
  ],
}

describe('Mobilité compared-bar readings (#1022)', () => {
  it('keeps raw numerators, segment notes and served ranks distinct from normalized values', () => {
    const bike = mobiliteBarReadings({
      figure, category: figure.categories[1]!, showComparison: true,
    })
    expect(bike.map((reading) => [reading.key, reading.kind, reading.display, reading.unit, reading.raw]))
      .toEqual([
        ['bike:total', 'total', '8', 'km / 1 000 hab.', false],
        ['bike:split-note', 'split-note', 'Indisponible', '', false],
        ['bike:segment:protege_km_1000', 'segment', '5', 'km / 1 000 hab.', false],
        ['bike:segment:protege_km_1000:raw', 'raw', '4', 'km', true],
        ['bike:segment:partage_km_1000', 'segment', '3', 'km / 1 000 hab.', false],
        ['bike:raw', 'raw', '20', 'km', true],
      ])
    expect(bike[0]?.comparison).toMatchObject({
      value: 6,
      display: '6',
      rank: { position: 1, size: 3, ties: 2 },
      rankDisplay: '=1er/3',
      unit: 'km / 1 000 hab.',
    })
    expect(bike[2]?.comparison).toMatchObject({ value: 4, display: '4', unit: 'km / 1 000 hab.' })
    // A raw segment numerator carries no served comparison of its own.
    expect(bike[3]?.comparison).toBeNull()
    expect(bike[4]?.comparison).toBeNull()
  })

  it('keeps a real zero and a missing total distinguishable', () => {
    const car = mobiliteBarReadings({ figure, category: figure.categories[2]!, showComparison: true })
    expect(car[0]).toMatchObject({ value: 0, display: '0', comparison: null })
    const absent = mobiliteBarReadings({ figure, category: figure.categories[3]!, showComparison: true })
    expect(absent[0]).toMatchObject({ value: null, display: 'Indisponible' })
    expect(absent[0]?.comparison).toMatchObject({ value: 2, display: '2' })
  })

  it('withholds every comparison reading when the layer is hidden', () => {
    const bike = mobiliteBarReadings({ figure, category: figure.categories[1]!, showComparison: false })
    expect(bike.every((reading) => reading.comparison === null)).toBe(true)
    const rows = mobiliteBarTooltipRows(bike)
    expect(rows.every((row) => row.comparison === undefined)).toBe(true)
    const label = mobiliteBarsAccessibleLabel({ figure, showComparison: false })
    expect(label).not.toContain('Groupe comparé')
    expect(label).not.toContain('1er/3')
    expect(label).toContain('Total vélo : 8 km / 1 000 hab.')
    expect(label).toContain('Réseau absent : Indisponible')
  })

  it('maps the visible tooltip rows without changing labels, units or rank text', () => {
    const rows = mobiliteBarTooltipRows(mobiliteBarReadings({
      figure, category: figure.categories[0]!, showComparison: true,
    }))
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      label: 'Réseau piéton',
      value: '12',
      ariaLabel: 'Réseau piéton : 12 km / 1 000 hab.',
      comparison: {
        value: '9',
        rank: '2e/3',
        ariaLabel: 'Groupe comparé : 9 km / 1 000 hab. (Médiane des communes de EPCI X). Rang 2e/3 — plus = mieux',
      },
    })
    expect(rows[1]).toMatchObject({
      label: 't_longueur', value: '10', marker: 'slash',
      ariaLabel: 't_longueur : 10 km (valeur brute)',
    })
  })
})
